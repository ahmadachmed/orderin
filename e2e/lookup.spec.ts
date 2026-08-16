/**
 * T25-9 (docs/T25-ux-plan.md ITEM 1, issue #172): E2E for the order-lookup
 * entry point — landing CTA + shop-header OrderLookupForm.
 *
 *   1. landing page renders the "Lacak Pesanan" CTA + helper text
 *   2. shop header dialog: empty / invalid phone → inline validation
 *   3. phone with an active order → redirect to /[slug]/order/[orderId]
 *   4. phone with no order → "Pesanan tidak ditemukan untuk nomor ini"
 *   5. rate limit (5/min per IP) → "Terlalu banyak percobaan, coba lagi nanti"
 *
 * Requires: dev server on :3000 (npm run dev) + local Postgres (orderin-pg).
 * Setup mirrors happy-path.spec.ts: tenant registered once at the API level
 * (register is rate-limited 60s/3 per IP → postWithRetry), hours widened to
 * all-day so the order step is deterministic, one menu item created via API.
 * The lookup API itself is rate-limited 5/min per IP — the rate-limit test
 * runs LAST and keeps submitting until the 429 message surfaces (earlier
 * tests already consumed part of the window).
 */
import "dotenv/config";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
const tenantsToClean: string[] = [];

let shop: { slug: string } | null = null;
let itemName = "";

/** POST with 429 backoff — register is rate-limited 60s/3 per IP. */
async function postWithRetry(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  expectStatus: number
) {
  for (let attempt = 1; ; attempt++) {
    const res = await request.post(path, { data });
    if (res.status() === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 61_000));
      continue;
    }
    expect(res.status()).toBe(expectStatus);
    return res;
  }
}

test.beforeAll(async ({ request }) => {
  // postWithRetry waits up to 61s per 429 backoff (register is limited to
  // 3/60s per IP and other spec files share the dev server's window), which
  // exceeds the default 60s hook budget — give setup room for 2 backoffs.
  test.setTimeout(180_000);
  await db.connect();

  const stamp = Date.now();
  const slug = `e2e-lookup-${stamp}`;
  const username = `admin${stamp}`;
  const password = "e2e-test-pass-123";
  itemName = `Kopi Lacak ${stamp}`;

  await postWithRetry(request, "/api/register", {
    name: `E2E Lookup Kedai ${stamp}`,
    slug,
    username,
    password,
    contactEmail: `e2e-lookup-${stamp}@example.com`,
  }, 201);

  // Keep the order step deterministic regardless of run time.
  const settingsRes = await request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "23:59" },
  });
  expect(settingsRes.ok()).toBeTruthy();

  const menuRes = await request.post("/api/admin/menu", {
    data: { name: itemName, price: 15000, prepTimeSeconds: 600, isAvailable: true },
  });
  expect(menuRes.ok()).toBeTruthy();

  const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Tenant" WHERE slug = $1`, [slug]);
  if (rows.length !== 1) throw new Error("tenant not found after register");
  tenantsToClean.push(rows[0].id);
  shop = { slug };
});

test.afterAll(async () => {
  for (const id of tenantsToClean) await cleanupTenant(id);
  await db.end();
});

/** Delete every row belonging to the tenant (children first — no FK cascade). */
async function cleanupTenant(tenantId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query(`DELETE FROM "OrderStatusLog" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = $1)`, [tenantId]);
      await db.query(`DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = $1)`, [tenantId]);
      await db.query(`DELETE FROM "Order" WHERE "tenantId" = $1`, [tenantId]);
      await db.query(`DELETE FROM "MenuItem" WHERE "tenantId" = $1`, [tenantId]);
      await db.query(`DELETE FROM "TenantAdmin" WHERE "tenantId" = $1`, [tenantId]);
      await db.query(`DELETE FROM "Sprint" WHERE "tenantId" = $1`, [tenantId]);
      await db.query(`DELETE FROM "Tenant" WHERE id = $1`, [tenantId]);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Place an order on the public shop; returns the order status page URL. */
async function placeOrder(page: Page, phone: string, customerName = "Lookup Cust") {
  await page.goto(`/${shop!.slug}`);
  await page.getByRole("button", { name: `Tambah ${itemName}` }).click();
  await page.getByPlaceholder("Nama").fill(customerName);
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill(phone);
  await page.getByRole("button", { name: "Buat Pesanan" }).click();
  await page.waitForURL(new RegExp(`/${shop!.slug}/order/[0-9a-f-]{36}$`));
  return page.url();
}

/** Open the lookup dialog on the shop page and return the dialog locator. */
async function openLookupDialog(page: Page) {
  await page.goto(`/${shop!.slug}`);
  await page.getByRole("button", { name: "Lacak Pesanan" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Lacak Pesanan" })).toBeVisible();
  return dialog;
}

test("landing page renders the Lacak Pesanan CTA + helper text", async ({ page }) => {
  await page.goto("/");
  // ITEM 1 AC: landing shows the CTA pointing users to the shop search grid.
  const cta = page.getByRole("link", { name: "Lacak Pesanan" });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", "#shop-search");
  await expect(
    page.getByText("Cari kedai lalu gunakan tombol Lacak di halaman kedai.")
  ).toBeVisible();
});

test("shop header lookup dialog validates phone input (empty / invalid)", async ({ page }) => {
  const dialog = await openLookupDialog(page);

  // Empty submit → validation error, no API call.
  await dialog.getByRole("button", { name: "Lacak Pesanan", exact: true }).click();
  await expect(dialog.getByText("Masukkan nomor HP dulu.")).toBeVisible();

  // Malformed number → format error.
  await dialog.getByLabel("Nomor HP").fill("123");
  await dialog.getByRole("button", { name: "Lacak Pesanan", exact: true }).click();
  await expect(dialog.getByText("Nomor HP tidak valid — contoh: 081234567890")).toBeVisible();
});

test("lookup with active order phone → redirect to status page", async ({ page }) => {
  const phone = "081234567890";

  // Create an active (PENDING) order for this phone via the real customer flow.
  const orderUrl = await placeOrder(page, phone);
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();

  // Look it up from the shop header — must land on the same status page.
  const dialog = await openLookupDialog(page);
  await dialog.getByLabel("Nomor HP").fill(phone);
  await dialog.getByRole("button", { name: "Lacak Pesanan", exact: true }).click();
  await expect(page).toHaveURL(orderUrl, { timeout: 10_000 });
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();
});

test("lookup with phone that has no order → Pesanan tidak ditemukan", async ({ page }) => {
  const dialog = await openLookupDialog(page);
  await dialog.getByLabel("Nomor HP").fill("081355544433");
  await dialog.getByRole("button", { name: "Lacak Pesanan", exact: true }).click();
  await expect(dialog.getByText("Pesanan tidak ditemukan untuk nomor ini")).toBeVisible();
  // Still on the shop page — no redirect happened.
  await expect(page).toHaveURL(new RegExp(`/${shop!.slug}$`));
});

test("lookup rate limit (5/min per IP) → Terlalu banyak percobaan", async ({ page }) => {
  const dialog = await openLookupDialog(page);
  await dialog.getByLabel("Nomor HP").fill("081244433322");

  // The limiter is 5/min per IP on the shared dev server; earlier tests in
  // this file already consumed part of the window, so keep submitting until
  // the 429 message surfaces (guaranteed within 6 submits).
  let seen = false;
  for (let i = 0; i < 6 && !seen; i++) {
    await dialog.getByRole("button", { name: "Lacak Pesanan", exact: true }).click();
    try {
      await expect(
        dialog.getByText("Terlalu banyak percobaan, coba lagi nanti")
      ).toBeVisible({ timeout: 3000 });
      seen = true;
    } catch {
      // Still within the limit — submit again.
    }
  }
  expect(seen).toBe(true);
});
