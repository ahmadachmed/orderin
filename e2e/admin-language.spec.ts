/**
 * T25-9 (docs/T25-ux-plan.md, issue #172): E2E for ITEM 2 (admin UI fully
 * Indonesian) + ITEM 3 (overnight opening-hours display) — the second file
 * of the T25-9 manifest (e2e/lookup.spec.ts covers ITEM 1).
 *
 * ITEM 2 — admin language:
 *   1. login page renders "Login Admin" / "Masuk"
 *   2. dashboard + full order flow: Dasbor Barista, nav, status badges,
 *      "Tandai Lunas", "→ dikonfirmasi" etc., payment-gate hint, PIN modal
 *   3. menu CRUD: Manajemen Menu, "+ Tambah", "Item Baru"/"Ubah Item",
 *      "Nama *", "Harga (IDR) *", "Tersedia"/"Tersembunyi", Ubah/Hapus
 *
 * ITEM 3 — overnight hours:
 *   4. landing card: overnight tenant shows "Buka 17:00–03:00 besok"
 *   5. landing card: invalid/empty timezone falls back to raw UTC (no marker)
 *   6. landing card: same-day tenant shows no "besok" marker
 *   7. shop page header: overnight tenant shows "Buka 17:00–03:00 besok"
 *   8. shop page header: same-day tenant shows no "besok" marker
 *
 * Requires: dev server on :3000 (npm run dev) + local Postgres (orderin-pg).
 * Three tenants are registered at the API level (register is rate-limited
 * 60s/3 per IP → postWithRetry). Lang tenant runs the admin flows; ovn/day
 * tenants only render hour displays (no orders → hours stay fixed).
 */
import "dotenv/config";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
const tenantsToClean: string[] = [];

let lang: { slug: string; username: string; password: string } | null = null;
let ovnSlug = "";
let daySlug = "";
let apiItemName = "";

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
  // 3/60s per IP and other spec files share the dev server's window — this
  // file alone registers 3 tenants), which exceeds the default 60s hook
  // budget — give setup room for 2 backoffs.
  test.setTimeout(180_000);
  await db.connect();

  const stamp = Date.now();
  const password = "e2e-test-pass-123";

  // Tenant 1 — admin flows. All-day UTC hours so ordering is deterministic;
  // timezone "" exercises the raw-UTC fallback on the landing card.
  const langSlug = `e2e-lang-${stamp}`;
  await postWithRetry(request, "/api/register", {
    name: `E2E Bahasa Kedai ${stamp}`,
    slug: langSlug,
    username: `admin${stamp}`,
    password,
    contactEmail: `e2e-lang-${stamp}@example.com`,
  }, 201);
  const langSettings = await request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "23:59", timezone: "" },
  });
  expect(langSettings.ok()).toBeTruthy();
  apiItemName = `Kopi Lang ${stamp}`;
  const menuRes = await request.post("/api/admin/menu", {
    data: { name: apiItemName, price: 15000, prepTimeSeconds: 600, isAvailable: true },
  });
  expect(menuRes.ok()).toBeTruthy();

  // Tenant 2 — overnight range in Asia/Jakarta: 10:00–20:00 UTC → 17:00–03:00 WIB.
  ovnSlug = `e2e-ovn-${stamp}`;
  await postWithRetry(request, "/api/register", {
    name: `E2E Overnight Kedai ${stamp}`,
    slug: ovnSlug,
    username: `ovn${stamp}`,
    password,
    contactEmail: `e2e-ovn-${stamp}@example.com`,
  }, 201);
  const ovnSettings = await request.patch("/api/admin/settings", {
    data: { openTime: "10:00", closeTime: "20:00", timezone: "Asia/Jakarta" },
  });
  expect(ovnSettings.ok()).toBeTruthy();

  // Tenant 3 — same-day range in Asia/Jakarta: 00:00–10:00 UTC → 07:00–17:00 WIB.
  daySlug = `e2e-day-${stamp}`;
  await postWithRetry(request, "/api/register", {
    name: `E2E SameDay Kedai ${stamp}`,
    slug: daySlug,
    username: `day${stamp}`,
    password,
    contactEmail: `e2e-day-${stamp}@example.com`,
  }, 201);
  const daySettings = await request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "10:00", timezone: "Asia/Jakarta" },
  });
  expect(daySettings.ok()).toBeTruthy();

  const { rows } = await db.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM "Tenant" WHERE slug = ANY($1)`,
    [[langSlug, ovnSlug, daySlug]]
  );
  expect(rows).toHaveLength(3);
  tenantsToClean.push(...rows.map((r) => r.id));
  lang = { slug: langSlug, username: `admin${stamp}`, password };
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

// Admin auth is rate-limited 5/60s per IP (src/lib/rate-limit.ts), so logging
// in per-test in beforeEach (like happy-path's single test) would 429 on the
// later tests of this file. Instead, auth only where the admin session is
// actually needed — the dashboard and menu tests — via this helper.
async function loginAsLang(page: Page) {
  const res = await page.request.post("/api/admin/auth", {
    data: {
      tenantSlug: lang!.slug,
      username: lang!.username,
      password: lang!.password,
    },
  });
  expect(res.ok()).toBeTruthy();
}

/** Place an order on the public shop; returns the order status page URL. */
async function placeOrder(page: Page, customerName: string, phone = "081234567890") {
  await page.goto(`/${lang!.slug}`);
  await page.getByRole("button", { name: `Tambah ${apiItemName}` }).click();
  await page.getByPlaceholder("Nama").fill(customerName);
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill(phone);
  await page.getByRole("button", { name: "Buat Pesanan" }).click();
  await page.waitForURL(new RegExp(`/${lang!.slug}/order/[0-9a-f-]{36}$`));
  return page.url();
}

/** The admin dashboard card for one order, scoped by customer name. */
function orderCard(page: Page, customerName: string) {
  return page.locator("div.rounded-xl.border.bg-card", { hasText: customerName });
}

test("admin login page renders Indonesian labels", async ({ page }) => {
  // No admin session yet (login is per-test only where needed) — the login
  // form must render, not auto-redirect to the dashboard.
  await page.goto(`/admin/${lang!.slug}/login`);
  await expect(page.getByRole("heading", { name: "Login Admin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
});

test("dashboard + full order flow uses Indonesian labels throughout", async ({ page }) => {
  await loginAsLang(page);
  // Empty dashboard: title (T28-3: "Antrean Pesanan"), nav, all 5 status badges
  // + 5 empty columns.
  await page.goto(`/admin/${lang!.slug}`);
  await expect(page.getByRole("heading", { name: "Antrean Pesanan" })).toBeVisible();
  for (const label of ["Dasbor", "Menu", "Riwayat", "Pengaturan"]) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
  }
  // "Keluar" is a <button>, not a link — assert by role accordingly.
  await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
  // D2: "Lihat Toko" was dropped from the rail.
  await expect(page.getByText("Lihat Toko")).toHaveCount(0);
  // CANCELLED is a card action, not a drop column — only the 5 STATUS_FLOW
  // badges render as column headers on the dashboard.
  for (const badge of ["Menunggu Konfirmasi", "Dikonfirmasi", "Diracik", "Siap Diambil", "Selesai"]) {
    await expect(page.getByText(badge)).toBeVisible();
  }
  await expect(page.getByText("Kosong")).toHaveCount(5);
  // ITEM 5: tip bar (T28-3) — no emoji.
  await expect(
    page.getByText("Seret kartu untuk majukan status. Meracik (Brewing) membutuhkan pembayaran LUNAS.")
  ).toBeVisible();

  // Place an order, then drive the card PENDING → CONFIRMED → PAID → BREWING → READY.
  const customer = `Lang Cust ${Date.now()}`;
  await placeOrder(page, customer);
  await page.goto(`/admin/${lang!.slug}`);
  const card = orderCard(page, customer);
  await expect(card).toBeVisible();

  // PENDING + UNPAID: mark-paid and advance buttons.
  await expect(card.getByText("Menunggu Konfirmasi")).toBeVisible();
  await expect(card.getByRole("button", { name: "Tandai Lunas" })).toBeVisible();
  await expect(card.getByRole("button", { name: "→ Konfirmasi" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Batal" })).toBeVisible();

  // PENDING → CONFIRMED: notice + badge translate; brewing stays gated.
  await card.getByRole("button", { name: "→ Konfirmasi" }).click();
  await expect(page.getByText("Pesanan dipindah ke dikonfirmasi")).toBeVisible();
  await expect(card.getByText("Dikonfirmasi")).toBeVisible();
  await expect(card.getByRole("button", { name: "→ Mulai Meracik" })).toBeDisabled();
  await expect(card.getByText("Tandai pembayaran LUNAS sebelum meracik")).toBeVisible();

  // Mark paid → gate lifts.
  await card.getByRole("button", { name: "Tandai Lunas" }).click();
  await expect(page.getByText("Pembayaran ditandai LUNAS — peracikan terbuka")).toBeVisible();
  await expect(card.getByText(/Lunas/)).toBeVisible();
  await expect(card.getByRole("button", { name: "→ Mulai Meracik" })).toBeEnabled();

  // CONFIRMED → BREWING → READY_FOR_PICKUP.
  await card.getByRole("button", { name: "→ Mulai Meracik" }).click();
  await expect(page.getByText("Pesanan dipindah ke diracik")).toBeVisible();
  await expect(card.getByText("Diracik")).toBeVisible();
  await card.getByRole("button", { name: "→ Tandai Siap" }).click();
  await expect(page.getByText("Pesanan dipindah ke siap diambil")).toBeVisible();
  await expect(card.getByText("Siap Diambil")).toBeVisible();
  await expect(card.getByText(/^PIN: \d{4}$/)).toBeVisible();

  // READY → PICKED_UP opens the PIN modal with Indonesian labels (cancel it).
  await card.getByRole("button", { name: "→ Selesai" }).click();
  await expect(page.getByRole("heading", { name: "Verifikasi PIN pengambilan" })).toBeVisible();
  await page.getByRole("button", { name: "Batal" }).click();
});

test("menu CRUD uses Indonesian labels throughout", async ({ page }) => {
  await loginAsLang(page);
  const itemName = `Es Kopi Lang ${Date.now()}`;
  await page.goto(`/admin/${lang!.slug}/menu`);

  await expect(page.getByRole("heading", { name: "Manajemen Menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Tambah" })).toBeVisible();
  for (const header of ["Item", "Harga", "Waktu", "Status", "Aksi"]) {
    await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
  }

  // Create: "+ Tambah" opens the "Item Baru" form.
  await page.getByRole("button", { name: "+ Tambah" }).click();
  await expect(page.getByRole("heading", { name: "Item Baru" })).toBeVisible();
  await page.getByLabel("Nama *").fill(itemName);
  await page.getByLabel("Harga (IDR) *").fill("18000");
  await expect(page.getByRole("checkbox", { name: "Tersedia" })).toBeVisible();
  await page.getByRole("button", { name: "Tambah Item", exact: true }).click();

  const row = page.getByRole("row", { name: new RegExp(itemName) });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Tersedia" })).toBeVisible();

  // Edit: "Ubah" reopens the form as "Ubah Item" with a "Simpan" submit.
  await row.getByRole("button", { name: "Ubah" }).click();
  await expect(page.getByRole("heading", { name: "Ubah Item" })).toBeVisible();
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(itemName) })).toBeVisible();

  // Delete: "Hapus" confirms with the Indonesian message, row disappears.
  let confirmMsg = "";
  page.once("dialog", (d) => {
    confirmMsg = d.message();
    void d.accept();
  });
  await page.getByRole("row", { name: new RegExp(itemName) }).getByRole("button", { name: "Hapus" }).click();
  expect(confirmMsg).toBe("Hapus item menu ini?");
  await expect(page.getByRole("row", { name: new RegExp(itemName) })).toHaveCount(0);
});

test("landing card shows the 'besok' marker for an overnight tenant", async ({ page }) => {
  await page.goto("/");
  // T29-A: the landing grid previews max 5 kedai — search first so the card
  // is deterministic regardless of how many tenants the DB has accumulated.
  await page.locator("#shop-search").fill(`E2E Overnight Kedai`);
  const card = page.locator("li", { hasText: `E2E Overnight Kedai` });
  // 10:00–20:00 UTC → 17:00–03:00 Asia/Jakarta → wraps past midnight.
  await expect(card.getByText(`Buka 17:00\u201303:00 besok`)).toBeVisible();
});

test("landing card falls back to raw UTC when timezone is empty (no marker)", async ({ page }) => {
  await page.goto("/");
  await page.locator("#shop-search").fill(`E2E Bahasa Kedai`);
  const card = page.locator("li", { hasText: `E2E Bahasa Kedai` });
  await expect(card.getByText("Buka 00:00–23:59 UTC")).toBeVisible();
  await expect(card.getByText(/besok/)).toHaveCount(0);
});

test("landing card shows no 'besok' marker for a same-day tenant", async ({ page }) => {
  await page.goto("/");
  await page.locator("#shop-search").fill(`E2E SameDay Kedai`);
  const card = page.locator("li", { hasText: `E2E SameDay Kedai` });
  // 00:00–10:00 UTC → 07:00–17:00 Asia/Jakarta → same day.
  await expect(card.getByText(`Buka 07:00\u201317:00`)).toBeVisible();
  await expect(card.getByText(/besok/)).toHaveCount(0);
});

test("shop page header shows the 'besok' marker for an overnight tenant", async ({ page }) => {
  await page.goto(`/${ovnSlug}`);
  await expect(page.getByText(`Buka 17:00\u201303:00 besok`)).toBeVisible();
});

test("shop page header shows no 'besok' marker for a same-day tenant", async ({ page }) => {
  await page.goto(`/${daySlug}`);
  await expect(page.getByText(`Buka 07:00\u201317:00`)).toBeVisible();
  await expect(page.getByText(/besok/)).toHaveCount(0);
});
