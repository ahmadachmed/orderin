/**
 * T25-12 (docs/T25-ux-plan.md §T25-12): E2E — settings jam operasional flow.
 * Real browser against the dev server (:3000) + local Postgres.
 *
 *   1. The "Jam Operasional" section renders with all 6 fields (openTime,
 *      closeTime, timezone, isOpen, prepTimeBuffer, maxQueueSize)
 *      pre-populated from GET /api/admin/settings
 *   2. Change openTime + toggle isOpen → save → "✓ Tersimpan" → verify
 *      GET /api/admin/settings returns the new values → reload shows them
 *   3. Client-side validation (T25-10, mirrors PATCH route): out-of-bounds
 *      prepTimeBuffer / maxQueueSize / empty timezone block the save with an
 *      inline error and nothing is persisted
 *
 * Requires: dev server on :3000 (npm run dev) + Postgres + DATABASE_URL.
 * Conventions mirror pickup-flow.spec.ts / customer-account.spec.ts:
 *  - ONE tenant registered per file via API (register is rate-limited
 *    60s/3 per IP — no UI registration in setup)
 *  - beforeEach: POST /api/admin/auth (login is not rate-limited) so the
 *    settings page's fetchSettings() sees a valid session
 *  - Direct DB access (node-pg) only for tenant cleanup
 */
import "dotenv/config";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
const tenantsToClean: string[] = [];

let shop: { slug: string } | null = null;
let adminCreds: { username: string; password: string } = { username: "", password: "" };

/** POST with 429 backoff — register is rate-limited 60s/3 per IP on the shared dev server. */
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
  // Timeout > the 61s 429 backoff: a full-suite run may leave register
  // windows live on the shared dev server.
  test.setTimeout(120_000);
  await db.connect();

  const stamp = Date.now();
  const slug = `e2e-set-${stamp}`;
  const username = `admin${stamp}`;
  const password = "e2e-test-pass-123";

  await postWithRetry(request, "/api/register", {
    name: `E2E Settings Kedai ${stamp}`,
    slug,
    username,
    password,
  }, 201);

  const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Tenant" WHERE slug = $1`, [slug]);
  if (rows.length !== 1) throw new Error("tenant not found after register");
  tenantsToClean.push(rows[0].id);
  shop = { slug };
  adminCreds = { username, password };
});

// Each test runs in a fresh browser context — log the admin in so the
// settings page's fetchSettings() sees a valid session (login is not
// rate-limited; register is, hence one register in beforeAll).
test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/admin/auth", {
    data: {
      tenantSlug: shop!.slug,
      username: adminCreds.username,
      password: adminCreds.password,
    },
  });
  expect(res.ok()).toBeTruthy();
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
      await db.query(`DELETE FROM "Customer" WHERE "tenantId" = $1`, [tenantId]);
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

/** The "Jam Operasional" section of the settings form. */
function jamOperasionalSection(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Jam Operasional" }) });
}

/** The 6 jam-operasional fields, scoped to the section (label elements have no htmlFor). */
function jamFields(page: Page) {
  const section = jamOperasionalSection(page);
  return {
    openTime: section.locator('input[type="time"]').nth(0),
    closeTime: section.locator('input[type="time"]').nth(1),
    timezone: section.locator('input[list="timezone-options"]'),
    prepTimeBuffer: section.locator('input[type="number"]').nth(0),
    maxQueueSize: section.locator('input[type="number"]').nth(1),
    isOpen: section.getByRole("switch"),
  };
}

/** The jam-operasional fields as returned by GET /api/admin/settings.
 *  NOTE: ok() in src/lib/api.ts returns the tenant object as the raw JSON
 *  body (no { success, data } envelope) — parse the body directly. */
async function fetchJamSettings(request: APIRequestContext) {
  const res = await request.get("/api/admin/settings");
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    openTime: string;
    closeTime: string;
    timezone: string | null;
    isOpen: boolean;
    prepTimeBuffer: number;
    maxQueueSize: number;
  };
}

test("Jam Operasional section renders with 6 fields pre-populated from GET", async ({ page }) => {
  await page.goto(`/admin/${shop!.slug}/settings`);

  const section = jamOperasionalSection(page);
  await expect(section.getByRole("heading", { name: "Jam Operasional" })).toBeVisible();
  // Labels for all 6 fields (exact — getByText is case-insensitive by
  // default and "jam buka/tutup" appears in the section description).
  await expect(section.getByText("Jam buka", { exact: true })).toBeVisible();
  await expect(section.getByText("Jam tutup", { exact: true })).toBeVisible();
  await expect(section.getByText("Timezone", { exact: true })).toBeVisible();
  await expect(section.getByText("Status kedai", { exact: true })).toBeVisible();
  await expect(section.getByText("Buffer waktu racik (menit)", { exact: true })).toBeVisible();
  await expect(section.getByText("Maks antrean", { exact: true })).toBeVisible();

  // Pre-populated from GET (fresh tenant → page defaults 07:00/21:00,
  // Asia/Makassar, open, 0, 20).
  const f = jamFields(page);
  await expect(f.openTime).toHaveValue("07:00");
  await expect(f.closeTime).toHaveValue("21:00");
  await expect(f.timezone).toHaveValue("Asia/Makassar");
  await expect(f.prepTimeBuffer).toHaveValue("0");
  await expect(f.maxQueueSize).toHaveValue("20");
  await expect(f.isOpen).toHaveAttribute("aria-checked", "true");
});

test("change openTime + toggle isOpen → save → success → GET returns new values, persist on reload", async ({ page }) => {
  await page.goto(`/admin/${shop!.slug}/settings`);

  const f = jamFields(page);
  await f.openTime.fill("08:30");
  await f.isOpen.click(); // Buka → Tutup

  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await expect(page.getByText(/✓ Tersimpan/)).toBeVisible({ timeout: 15_000 });

  // Verify the PATCH actually persisted — GET returns the new values.
  const saved = await fetchJamSettings(page.request);
  expect(saved.openTime).toBe("08:30");
  expect(saved.isOpen).toBe(false);

  // Reload → form re-populates from GET with the saved values.
  await page.reload();
  await expect(f.openTime).toHaveValue("08:30");
  await expect(f.isOpen).toHaveAttribute("aria-checked", "false");
});

test("out-of-bounds buffer/queue and empty timezone never persist; timezone shows inline error", async ({ page }) => {
  await page.goto(`/admin/${shop!.slug}/settings`);

  // page.request shares the browser context's session cookie (set by the
  // beforeEach login) — the standalone `request` fixture has its own jar.
  const before = await fetchJamSettings(page.request);
  const f = jamFields(page);
  const saveButton = page.getByRole("button", { name: "Simpan pengaturan" });

  // prepTimeBuffer out of bounds (700 > 600): the number input's native
  // min/max constraint blocks form submission (browser bubble), so the
  // React onSubmit never fires and nothing persists.
  await f.prepTimeBuffer.fill("700");
  await saveButton.click();
  await expect(page.getByText(/✓ Tersimpan/)).toHaveCount(0);

  // maxQueueSize out of bounds (0 < 1): same native block, no persist.
  await f.prepTimeBuffer.fill("0");
  await f.maxQueueSize.fill("0");
  await saveButton.click();
  await expect(page.getByText(/✓ Tersimpan/)).toHaveCount(0);

  // timezone is required — the one invalid case native validation lets
  // through (text input, no required attr), so the form's client-side
  // validation error renders inline and blocks the save.
  await f.maxQueueSize.fill("20");
  await f.timezone.fill("");
  await saveButton.click();
  await expect(page.getByText("Timezone wajib diisi (contoh: Asia/Jakarta)")).toBeVisible();
  await expect(page.getByText(/✓ Tersimpan/)).toHaveCount(0);

  // Nothing was persisted by the rejected submits.
  const after = await fetchJamSettings(page.request);
  expect(after).toEqual(before);
});
