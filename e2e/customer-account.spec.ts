/**
 * T17-13 (docs/T17-hybrid-plan.md §T17-3/4/5/7/9 + §T16-7/8): E2E customer
 * account flow — real browser against the dev server (:3000) + Postgres.
 *
 *   1. T17-7 banner: guest order → status page shows "Buat akun" banner →
 *      register → banner gone, order bound to the account
 *   2. Register + history: guest order with phone → register with the SAME
 *      phone (bind-on-register) → login → account history shows the order
 *      with the correct status
 *   3. Login + bind-on-login: guest order with phone → login as an existing
 *      account with that phone → order appears in history; logout works
 *
 * Requires: dev server on :3000 (npm run dev) + Postgres + DATABASE_URL.
 * The tenant created by register defaults to openTime 07:00–21:00 UTC, so
 * operating hours are widened via PATCH /api/admin/settings (same trick as
 * happy-path.spec.ts / pickup-flow.spec.ts).
 *
 * Setup notes (mirror pickup-flow.spec.ts):
 *  - ONE tenant is registered per file via request.post("/api/register"):
 *    register is rate-limited 60s/3 per IP, so no UI registration in setup.
 *  - POST /api/customer/register is ALSO rate-limited 60s/3 per IP — the
 *    file uses exactly 3 registrations total (test 3's account in beforeAll,
 *    test 2 via API, test 1 via the banner UI), all inside the 3/min budget.
 *  - beforeEach: POST /api/admin/auth (login is not rate-limited).
 *  - The `request` fixture has its OWN cookie jar; page.request shares the
 *    browser context's jar — customer login is done via page.request so the
 *    session cookie reaches the pages under test.
 *  - Direct DB access (node-pg) is used only for tenant cleanup.
 *  - Banner form is a client component; clicking "Buat Akun" before React
 *    hydrates is a no-op (cold-compile race, happy-path.spec.ts lines
 *    21-31) — retry the click until the password form appears.
 */
import "dotenv/config";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
const tenantsToClean: string[] = [];

const ITEM_NAME = "Kopi Akun";
const CUSTOMER_PASSWORD = "e2e-cust-pass-123";

let shop: { slug: string } | null = null;
// Existing account created in beforeAll, used by test 3 (login + bind-on-login).
let existingCustomer: { name: string; phone: string } = { name: "", phone: "" };

test.beforeAll(async ({ request }) => {
  // Timeout > the 61s 429 backoff in postWithRetry: a full-suite run leaves
  // tenant/customer register windows live on the shared dev server, and the
  // first spec in the next run may need one backoff cycle before registering.
  test.setTimeout(120_000);
  await db.connect();
  const stamp = Date.now();
  const slug = `e2e-acct-${stamp}`;
  const username = `admin${stamp}`;
  const password = "e2e-test-pass-123";

  await postWithRetry(request, "/api/register", {
    name: `E2E Akun Kedai ${stamp}`,
    slug,
    username,
    password,
  }, 201);

  // Widening jam: keep the order step deterministic regardless of run time.
  const settingsRes = await request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "23:59" },
  });
  expect(settingsRes.ok()).toBeTruthy();

  const menuRes = await request.post("/api/admin/menu", {
    data: { name: ITEM_NAME, price: 15000, prepTimeSeconds: 600, isAvailable: true },
  });
  expect(menuRes.ok()).toBeTruthy();

  // Account for test 3 — registered here (not per-test) to stay inside the
  // 60s/3 customer-register budget. Its phone is unique per tenant.
  const phone3 = `0812${String(stamp).slice(-8)}3`;
  await postWithRetry(request, "/api/customer/register", {
    slug,
    name: "Login Cust",
    phone: phone3,
    password: CUSTOMER_PASSWORD,
  }, 201);
  existingCustomer = { name: "Login Cust", phone: phone3 };

  const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Tenant" WHERE slug = $1`, [slug]);
  if (rows.length !== 1) throw new Error("tenant not found after register");
  tenantsToClean.push(rows[0].id);
  shop = { slug };
});

// NOTE: no admin login here. Unlike pickup-flow.spec.ts (which drives the
// /admin dashboard and therefore needs an admin session per test), this spec
// only touches public customer pages. The shared dev server's in-memory rate
// limiter caps POST /api/admin/auth at 5/min/IP across ALL specs hitting
// :3000 — an unnecessary admin login per test would push pickup-flow's own
// three logins over the budget and flake it.

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
      // T17: customers FK from Order.customerId — delete after orders.
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

/** Place a guest order on the public shop; returns the status page URL. */
async function placeOrder(page: Page, customerName: string, phone: string) {
  await page.goto(`/${shop!.slug}`);
  await page.getByRole("button", { name: `Tambah ${ITEM_NAME}` }).click();
  await page.getByPlaceholder("Nama").fill(customerName);
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill(phone);
  await page.getByRole("button", { name: "Buat Pesanan" }).click();
  await page.waitForURL(new RegExp(`/${shop!.slug}/order/[0-9a-f-]{36}$`));
  return page.url();
}

/** Open the "Buat akun" banner form, hydration-safe (cold-compile race). */
async function openBannerForm(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Buat Akun" }).click();
    await expect(page.getByPlaceholder("Password (min 6 karakter)")).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });
}

/** Register the customer through the banner UI (test 1 path). */
async function registerViaBanner(page: Page) {
  await openBannerForm(page);
  await page.getByPlaceholder("Password (min 6 karakter)").fill(CUSTOMER_PASSWORD);
  await page.getByRole("button", { name: "Daftar" }).click();
}

/** Login as a customer via API, cookies landing in the browser context. */
async function customerLogin(request: APIRequestContext, phone: string) {
  const res = await request.post("/api/customer/login", {
    data: { slug: shop!.slug, phone, password: CUSTOMER_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
}

/**
 * POST with 429 backoff. The dev server's in-memory rate limiter is shared
 * across all worktrees/specs hitting :3000 (60s/3 per IP for tenant AND
 * customer register), so a previous run's windows can still be live when
 * this file starts. Retry once after the window slides.
 */
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

test("guest order shows 'Buat akun' banner; registering hides it and binds the order", async ({ page }) => {
  const stamp = Date.now();
  const customer = `Banner Cust ${stamp}`;
  const phone = `0812${String(stamp).slice(-8)}1`;

  // Guest order → status page carries the T17-7 banner (phone pre-filled
  // from the order, active status only).
  await placeOrder(page, customer, phone);
  await expect(page.getByText("Buat akun & simpan pesanan ini")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buat Akun" })).toBeVisible();

  // Register through the banner → server reloads the page; with a valid
  // session the status page renders customerPhone=null, so the banner is gone.
  await registerViaBanner(page);
  await expect(page.getByText("Buat akun & simpan pesanan ini")).toHaveCount(0, {
    timeout: 15_000,
  });
  // The banner's register handler calls window.location.reload() right after
  // React hides it (done=true) — a page.goto issued while that reload is
  // still in flight aborts with ERR_ABORTED. Wait for the reload to settle.
  await page.waitForLoadState("networkidle");

  // The register call phone-matched this order (bind-on-register): the order
  // shows up in the account history right after registration (auto-login).
  await page.goto(`/${shop!.slug}/account/orders`);
  await expect(page.getByRole("heading", { name: "Riwayat Pesanan" })).toBeVisible();
  await expect(page.getByText(`1× ${ITEM_NAME}`)).toBeVisible();
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();
});

test("register + same-phone order: bound order appears in account history", async ({ page, request }) => {
  const stamp = Date.now();
  const customer = `Reg Cust ${stamp}`;
  const phone = `0812${String(stamp).slice(-8)}2`;

  // 1. Guest order placed BEFORE registration — bind-on-register (T17-5)
  //    attaches it to the account created with the same phone.
  await placeOrder(page, customer, phone);

  // 2. Register an account with the SAME phone (API — 2nd of the 3/min budget).
  await postWithRetry(request, "/api/customer/register", {
    slug: shop!.slug,
    name: customer,
    phone,
    password: CUSTOMER_PASSWORD,
  }, 201);

  // 3. Login (register already auto-logged-in, but exercise the explicit
  //    login path the task calls out) → account history shows the bound order.
  await customerLogin(page.request, phone);
  await page.goto(`/${shop!.slug}/account/orders`);
  await expect(page.getByRole("heading", { name: "Riwayat Pesanan" })).toBeVisible();
  await expect(page.getByText(`1× ${ITEM_NAME}`)).toBeVisible();
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();
});

test("login + bind-on-login: existing account picks up the order; logout works", async ({ page }) => {
  const stamp = Date.now();
  const customer = `Login Cust ${stamp}`;

  // Guest order with the existing account's phone — not yet bound.
  await placeOrder(page, customer, existingCustomer.phone);

  // Login as the existing account → phone-match bind (T17-5) attaches the
  // order on login.
  await customerLogin(page.request, existingCustomer.phone);
  await page.goto(`/${shop!.slug}/account/orders`);
  await expect(page.getByRole("heading", { name: "Riwayat Pesanan" })).toBeVisible();
  await expect(page.getByText(`1× ${ITEM_NAME}`)).toBeVisible();
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();

  // Logout → redirected to the shop; the account page no longer resolves
  // without a session (T20 ACCT-03: it now redirects to login with ?next
  // instead of silently back to the shop).
  await page.getByRole("button", { name: "Keluar" }).click();
  await page.waitForURL(`**/${shop!.slug}`);
  await page.goto(`/${shop!.slug}/account/orders`);
  await page.waitForURL(`**/${shop!.slug}/login**`);
  expect(page.url()).toContain("next=account/orders");
});

test("guest riwayat link redirects to login?next=account/orders; login returns to riwayat", async ({ page }) => {
  const stamp = Date.now();
  const customer = `Riwayat Cust ${stamp}`;

  // Guest order → status page carries the "Lihat riwayat pesananmu" link.
  // Use the existing account's phone so bind-on-login attaches this order.
  await placeOrder(page, customer, existingCustomer.phone);
  // Button asChild wraps a Link → role is link, not button.
  await page.getByRole("link", { name: "Lihat riwayat pesananmu" }).click();

  // T20 ACCT-03: no silent redirect — guest lands on login with the target.
  await page.waitForURL(`**/${shop!.slug}/login**`);
  expect(page.url()).toContain("next=account/orders");
  await expect(page.getByText("Login untuk lihat riwayat")).toBeVisible();

  // Login → back to the riwayat page (next target), order visible.
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill(existingCustomer.phone);
  await page.getByPlaceholder("Password").fill(CUSTOMER_PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`**/${shop!.slug}/account/orders`);
  await expect(page.getByRole("heading", { name: "Riwayat Pesanan" })).toBeVisible();
  // Test 3 bound an earlier order to the same account — this test's order is
  // one of possibly several with the same item/status, so scope to the first.
  await expect(page.getByText(`1× ${ITEM_NAME}`).first()).toBeVisible();
  await expect(page.getByText("Menunggu konfirmasi").first()).toBeVisible();
});
