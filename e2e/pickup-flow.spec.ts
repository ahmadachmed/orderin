/**
 * T16-10 (docs/T17-hybrid-plan.md §T16-10): E2E pickup flow with the PIN gate
 * (PICKUP-01). Real browser against the dev server (:3000) + local Postgres.
 *
 *   1. full customer journey: order → advance to READY → enter PIN → PICKED_UP
 *   2. wrong PIN → 403 → order stays READY_FOR_PICKUP
 *   3. legacy order (pickupCode "") → transitions without a PIN
 *
 * Requires: dev server on :3000 (npm run dev) + local Postgres (orderin-pg) +
 * DATABASE_URL. The tenant created by register defaults to openTime 07:00–21:00
 * UTC, so operating hours are widened via PATCH /api/admin/settings to keep the
 * order step deterministic regardless of when it runs (same trick as
 * happy-path.spec.ts).
 *
 * Setup notes:
 *  - ONE tenant is registered per file (not per test): POST /api/register is
 *    rate-limited 60s/3 per IP (src/lib/rate-limit.ts), and happy-path.spec.ts
 *    registers its own tenant in the same CI run. Tenant isolation is not this
 *    task's concern (that's T17-12); each test gets its own ORDER instead.
 *  - The register form UI is covered by happy-path.spec.ts; under `next dev`
 *    its debounced slug-check + on-demand compile can HMR-reload the form
 *    mid-submit and strand the navigation — flaky for setup that is not the
 *    feature under test, so registration is done at the API level here.
 *  - Session scoping: the `request` fixture has its OWN cookie jar, and each
 *    Playwright test gets a fresh browser context. The register/Set-Cookie
 *    therefore never reaches the pages under test — each test logs in via
 *    POST /api/admin/auth in a beforeEach (login is not rate-limited;
 *    register is, so it stays a single beforeAll call).
 *  - Direct DB access (node-pg) is used only for fixtures the public API
 *    cannot produce: a legacy order with pickupCode "" and tenant cleanup.
 *    Table/enum names follow Prisma defaults ("Order", "Tenant", "MenuItem",
 *    "OrderItem", "OrderStatusLog", "Sprint", "TenantAdmin").
 */
import "dotenv/config";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
const tenantsToClean: string[] = [];

let shop: { slug: string } | null = null;
let adminCreds: { username: string; password: string } = { username: "", password: "" };

/**
 * POST with 429 backoff. Register is rate-limited 60s/3 per IP on the shared
 * dev server and other specs register their own tenants in the same run, so a
 * previous window can still be live when this file starts. Retry after the
 * window slides (same pattern as happy-path.spec.ts / customer-account.spec.ts).
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

test.beforeAll(async ({ request }) => {
  await db.connect();

  // Register one tenant + widen hours + create the shared menu item at the
  // API level. The `request` fixture's jar keeps the register session cookie,
  // so the follow-up admin calls authenticate without a login round-trip.
  const stamp = Date.now();
  const slug = `e2e-pin-${stamp}`;
  const username = `admin${stamp}`;
  const password = "e2e-test-pass-123";

  await postWithRetry(request, "/api/register", {
    name: `E2E PIN Kedai ${stamp}`,
    slug,
    username,
    password,
  }, 201);

  const settingsRes = await request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "23:59" },
  });
  expect(settingsRes.ok()).toBeTruthy();

  const menuRes = await request.post("/api/admin/menu", {
    data: { name: "Kopi PIN", price: 15000, prepTimeSeconds: 600, isAvailable: true },
  });
  expect(menuRes.ok()).toBeTruthy();

  const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Tenant" WHERE slug = $1`, [slug]);
  if (rows.length !== 1) throw new Error("tenant not found after register");
  tenantsToClean.push(rows[0].id);
  shop = { slug };
  adminCreds = { username, password };
});

// Each Playwright test runs in a fresh browser context that knows nothing of
// the `request` fixture's cookies — log the admin in so the dashboard's
// fetchOrders() call sees a valid session. Login is not rate-limited
// (register is, hence one register in beforeAll).
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
  // Retry: the final pickup PATCH may still be committing its statusLog row
  // when the test ends; a retry after a beat avoids the FK race.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query(`DELETE FROM "OrderStatusLog" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = $1)`, [tenantId]);
      await db.query(`DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = $1)`, [tenantId]);
      await db.query(`DELETE FROM "Order" WHERE "tenantId" = $1`, [tenantId]);
      await db.query(`DELETE FROM "MenuItem" WHERE "tenantId" = $1`, [tenantId]);
      await db.query(`DELETE FROM "TenantAdmin" WHERE "tenantId" = $1`, [tenantId]);
      // POST /api/order auto-creates an OPEN sprint — delete sprints before the
      // tenant (FK ON DELETE RESTRICT).
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
async function placeOrder(page: Page, customerName: string) {
  await page.goto(`/${shop!.slug}`);
  await page.getByRole("button", { name: "Tambah Kopi PIN" }).click();
  await page.getByPlaceholder("Nama").fill(customerName);
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill("081234567890");
  await page.getByRole("button", { name: "Buat Pesanan" }).click();
  await page.waitForURL(new RegExp(`/${shop!.slug}/order/[0-9a-f-]{36}$`));
  return page.url();
}

/** The admin dashboard card for one order, scoped by customer name. */
function orderCard(page: Page, customerName: string) {
  return page.locator("div.rounded-xl.border.bg-card", { hasText: customerName });
}

/** Advance an order card PENDING → CONFIRMED → PAID → BREWING → READY_FOR_PICKUP. */
async function advanceToReady(page: Page, customerName: string, opts: { expectPin?: boolean } = {}) {
  const card = orderCard(page, customerName);
  await card.getByRole("button", { name: /→ dikonfirmasi/ }).click();
  await card.getByRole("button", { name: "Tandai Lunas" }).click();
  await card.getByRole("button", { name: /→ diracik/ }).click();
  await card.getByRole("button", { name: /→ siap diambil/ }).click();
  if (opts.expectPin !== false) {
    await expect(card.getByText(/^PIN: \d{4}$/)).toBeVisible();
  }
}

/** Read the 4-digit PIN from the READY_FOR_PICKUP card. */
async function readPin(page: Page, customerName: string): Promise<string> {
  const text = (await orderCard(page, customerName).getByText(/^PIN: \d{4}$/).textContent()) ?? "";
  const m = text.match(/\d{4}/);
  if (!m) throw new Error("PIN not found on order card");
  return m[0];
}

/** Open the pickup modal and submit a PIN. */
async function submitPin(page: Page, pin: string) {
  await expect(page.getByRole("heading", { name: "Verifikasi PIN pengambilan" })).toBeVisible();
  await page.getByPlaceholder("••••").fill(pin);
  await page.getByRole("button", { name: "Konfirmasi" }).click();
}

test("full customer journey: order → READY → enter PIN → PICKED_UP", async ({ page }) => {
  const customer = `Pin Cust ${Date.now()}`;

  const orderUrl = await placeOrder(page, customer);

  // Customer status page: PENDING + the pickup code is not shown yet.
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();
  await expect(page.getByText(/^\d{4}$/)).toHaveCount(0);

  // Barista advances the order to READY_FOR_PICKUP via the dashboard.
  await page.goto(`/admin/${shop!.slug}`);
  await expect(orderCard(page, customer)).toBeVisible();
  await advanceToReady(page, customer);
  const pin = await readPin(page, customer);
  expect(pin).toMatch(/^[1-9]\d{3}$/);

  // Wrong PIN handling is covered by its own test — here we verify the gate
  // end-to-end with the correct PIN.
  await orderCard(page, customer).getByRole("button", { name: /→ selesai/ }).click();
  await submitPin(page, pin);

  // Card terminal: Picked up badge, PIN hidden, no advance button left.
  const card = orderCard(page, customer);
  await expect(card.getByText("Selesai")).toBeVisible();
  await expect(card.getByText(/PIN:/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: /→/ })).toHaveCount(0);

  // Customer status page reflects the terminal state. The timeline is filled
  // by the tracker's 5s polling of GET /api/order/[orderId] (initial server
  // render carries no statusLogs), so allow for the poll.
  await page.goto(orderUrl);
  await expect(page.getByText("Sudah diambil")).toBeVisible({ timeout: 15_000 });
});

test("wrong PIN → 403 → order stays READY_FOR_PICKUP", async ({ page }) => {
  const customer = `Pin Wrong ${Date.now()}`;

  await placeOrder(page, customer);
  await page.goto(`/admin/${shop!.slug}`);
  await expect(orderCard(page, customer)).toBeVisible();
  await advanceToReady(page, customer);
  const pin = await readPin(page, customer);
  expect(pin).toMatch(/^[1-9]\d{3}$/);

  // 0000 is never a generated PIN (generator is 1000–9999) → gate must reject.
  await orderCard(page, customer).getByRole("button", { name: /→ selesai/ }).click();
  await submitPin(page, "0000");

  // Server 403 surfaces in the modal; the order must not move.
  await expect(page.getByText("PIN tidak cocok — verifikasi gagal")).toBeVisible();
  await page.getByRole("button", { name: "Batal" }).click();

  const card = orderCard(page, customer);
  await expect(card.getByText("Siap Diambil")).toBeVisible();
  await expect(card.getByText(/^PIN: \d{4}$/)).toBeVisible();
  await expect(card.getByRole("button", { name: /→ selesai/ })).toBeVisible();
});

test("legacy order (empty PIN) → transitions without a PIN", async ({ page }) => {
  const customer = `Legacy Cust ${Date.now()}`;

  // Legacy orders predate the PIN feature: POST /api/order always generates a
  // pickupCode, so create this one directly in the DB with pickupCode "".
  // The board shows orders from the tenant's OPEN sprint (+ sprintless legacy
  // rows); ensure an OPEN sprint exists and attach the order to it (a tenant
  // with no OPEN sprint 500s the board — pre-existing main bug: the fallback
  // `sprintId ?? ""` is an invalid uuid cast, not a match-nothing sentinel).
  const tenant = await db.query<{ id: string }>(`SELECT id FROM "Tenant" WHERE slug = $1`, [shop!.slug]);
  const item = await db.query<{ id: string }>(`SELECT id FROM "MenuItem" WHERE "tenantId" = $1 AND name = 'Kopi PIN' LIMIT 1`, [
    tenant.rows[0].id,
  ]);
  await db.query(
    `INSERT INTO "Sprint" (id, "tenantId", "startAt", status)
     SELECT gen_random_uuid(), $1, now(), 'OPEN'
     WHERE NOT EXISTS (SELECT 1 FROM "Sprint" WHERE "tenantId" = $1 AND status = 'OPEN')`,
    [tenant.rows[0].id],
  );
  await db.query(
    `INSERT INTO "Order" (id, "tenantId", "customerName", "customerPhone", "pickupCode", status, "paymentStatus", "sprintId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, '', 'PENDING', 'UNPAID',
             (SELECT id FROM "Sprint" WHERE "tenantId" = $1 AND status = 'OPEN' LIMIT 1), now(), now())`,
    [tenant.rows[0].id, customer, "081299887766"],
  );
  await db.query(`INSERT INTO "OrderItem" (id, "orderId", "menuItemId", quantity, "unitPrice") VALUES (gen_random_uuid(), $1, $2, 1, 15000)`, [
    (
      await db.query<{ id: string }>(
        `SELECT id FROM "Order" WHERE "tenantId" = $1 AND "customerName" = $2 ORDER BY "createdAt" DESC LIMIT 1`,
        [tenant.rows[0].id, customer],
      )
    ).rows[0].id,
    item.rows[0].id,
  ]);

  await page.goto(`/admin/${shop!.slug}`);
  await expect(orderCard(page, customer)).toBeVisible();
  await advanceToReady(page, customer, { expectPin: false });

  // Legacy cards carry no PIN (nothing to show the customer).
  await expect(orderCard(page, customer).getByText(/PIN:/)).toHaveCount(0);

  // The modal still opens, but the gate is skipped server-side — Konfirmasi
  // with an empty PIN succeeds.
  await orderCard(page, customer).getByRole("button", { name: /→ selesai/ }).click();
  await expect(page.getByRole("heading", { name: "Verifikasi PIN pengambilan" })).toBeVisible();
  await page.getByRole("button", { name: "Konfirmasi" }).click();

  await expect(orderCard(page, customer).getByText("Selesai")).toBeVisible();
});
