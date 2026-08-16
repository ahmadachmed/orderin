/**
 * TEST-03 — E2E happy path (PLAN §11 / issue #24).
 *
 * landing search (#shop-search → Lanjut) → shop menu → admin dashboard →
 * payment config (QRIS + bank) → create menu item → public order → status
 * page shows PENDING with payment options.
 *
 * Issue #134: the happy path now STARTS at the landing page — the search card
 * is the customer's entry point, so this spec pins its selectors (#shop-search,
 * "Lanjut") against regressions. The landing search redirects to /[slug]; the
 * tenant's 404 notFound() handles unknown slugs (no extra logic here).
 *
 * Requires: dev server on :3000 (npm run dev) + local Postgres (orderin-pg).
 * Register is rate-limited 60s/3 per IP on the shared dev server, so it is
 * done once at the API level with postWithRetry (same pattern as
 * customer-account.spec.ts); the tenant created by register defaults to
 * openTime 07:00–21:00 UTC, so operating hours are widened via PATCH
 * /api/admin/settings to keep the order step deterministic. Admin login
 * (not rate-limited) runs per test so the browser context carries the session.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const stamp = Date.now();
const slug = `e2e-${stamp}`;
const shopName = `E2E Kedai ${stamp}`;
const username = `admin${stamp}`;
const password = "e2e-test-pass-123";
const itemName = `Es Teh E2E ${stamp}`;

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

test.beforeAll(async ({ request }) => {
  // postWithRetry waits up to 61s per 429 backoff (register is limited to
  // 3/60s per IP and other spec files share the dev server's window), which
  // exceeds the default 60s hook budget — give setup room for backoffs.
  test.setTimeout(180_000);
  // Register one tenant at the API level (rate-limited, hence postWithRetry).
  await postWithRetry(request, "/api/register", {
    name: shopName,
    slug,
    username,
    password,
    contactEmail: `e2e-${stamp}@example.com`,
  }, 201);

  // Keep the order step deterministic: force operating hours to all-day.
  const settingsRes = await request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "23:59" },
  });
  expect(settingsRes.ok()).toBeTruthy();
});

// Each Playwright test runs in a fresh browser context that knows nothing of
// the `request` fixture's cookies — log the admin in so the dashboard's
// fetchOrders() call sees a valid session. Login is not rate-limited.
test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/admin/auth", {
    data: { tenantSlug: slug, username, password },
  });
  expect(res.ok()).toBeTruthy();
});

test("happy path: landing search → shop → admin → menu → order → status", async ({ page }) => {
  // 1. Landing search card (issue #134): the happy path starts HERE. Type the
  //    slug, hit Lanjut → redirected to /[slug]. Retried until React hydrates
  //    (cold-compile race, see pickup-flow.spec.ts setup notes): clicking the
  //    button before the client component attaches onSubmit fires a native
  //    form GET that strands navigation.
  await expect(async () => {
    await page.goto("/");
    await page.locator("#shop-search").fill(slug);
    await expect(page.locator("#shop-search")).toHaveValue(slug, { timeout: 2000 });
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`), { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // 2. Configure payment methods so the status page shows options (QRIS + bank).
  await page.goto(`/admin/${slug}/settings`);
  await page.getByPlaceholder("0002010102112665").fill("0002010102112665E2E");
  await page.getByPlaceholder("BCA").fill("BCA");
  await page.getByPlaceholder("1234567890").fill("1234567890");
  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await expect(page.getByText("✓ Tersimpan")).toBeVisible();

  // 3. Create a menu item via the admin UI.
  await page.goto(`/admin/${slug}/menu`);
  await page.getByRole("button", { name: "+ Tambah" }).click();
  await page.getByLabel("Nama *").fill(itemName);
  await page.getByLabel("Harga (IDR) *").fill("15000");
  await page.getByRole("button", { name: "Tambah Item", exact: true }).click();
  await expect(page.getByText(itemName)).toBeVisible();

  // 4. Public shop via the landing search again — same entry point a real
  //    customer uses. Add to cart and submit the order.
  await expect(async () => {
    await page.goto("/");
    await page.locator("#shop-search").fill(slug);
    await expect(page.locator("#shop-search")).toHaveValue(slug, { timeout: 2000 });
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`), { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: `Tambah ${itemName}` }).click();
  await page.getByPlaceholder("Nama").fill("E2E Customer");
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill("081234567890");
  await page.getByRole("button", { name: "Buat Pesanan" }).click();

  // 5. Status page: PENDING badge + payment options.
  await page.waitForURL(new RegExp(`/${slug}/order/[0-9a-f-]{36}$`));
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();
  // T19 / issue #147: fresh tenant → this is the only order in the queue,
  // so the status page must show the 1-based position "Antrean ke-1".
  await expect(page.getByText("Antrean ke-1")).toBeVisible();
  // Issue #135 fix run: page also renders "Pembayaran akan diarahkan oleh
  // kasir…" hint text — scope to the section heading (strict-mode safe).
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
  await expect(page.getByRole("button", { name: "QRIS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Transfer Bank" })).toBeVisible();
});
