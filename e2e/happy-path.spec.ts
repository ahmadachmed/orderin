/**
 * TEST-03 — E2E happy path (PLAN §11 / issue #24).
 *
 * register → admin dashboard → payment config (QRIS + bank) → create menu
 * item → public order → status page shows PENDING with payment options.
 *
 * Requires: dev server on :3000 (npm run dev) + local Postgres (orderin-pg).
 * The tenant created by register defaults to openTime 07:00–21:00 UTC, so the
 * test widens operating hours via PATCH /api/admin/settings to keep the order
 * step deterministic regardless of when it runs.
 */
import { test, expect } from "@playwright/test";

const stamp = Date.now();
const slug = `e2e-${stamp}`;
const shopName = `E2E Kedai ${stamp}`;
const username = `admin${stamp}`;
const password = "e2e-test-pass-123";
const itemName = `Es Teh E2E ${stamp}`;

test("happy path: register → admin → menu → order → status", async ({ page }) => {
  // 1. Register a new tenant → lands on the admin dashboard (REG-10).
  await page.goto("/register");
  // Hydration gate (cold-compile race, see pickup-flow.spec.ts setup notes):
  // clicking "Daftar" before React attaches onSubmit fires a native form GET
  // submit that strands navigation. The auto-suggested slug only appears once
  // React hydrates — wait for it (re-fill if hydration wiped the value).
  await expect(async () => {
    await page.getByPlaceholder("Kopi Senja Makassar").fill(shopName);
    await expect(page.getByPlaceholder("kopi-senja")).not.toHaveValue("", {
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });
  await page.getByPlaceholder("kopi-senja").fill(slug);
  await page.getByLabel("Username Admin").fill(username);
  await page.getByLabel("Password Admin").fill(password);
  await page.getByLabel("Konfirmasi Password").fill(password);
  await page.getByRole("button", { name: "Daftar" }).click();

  await page.waitForURL(`**/admin/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Barista Dashboard" })
  ).toBeVisible();

  // 2. Configure payment methods so the status page shows options (QRIS + bank).
  await page.goto(`/admin/${slug}/settings`);
  await page.getByPlaceholder("0002010102112665").fill("0002010102112665E2E");
  await page.getByPlaceholder("BCA").fill("BCA");
  await page.getByPlaceholder("1234567890").fill("1234567890");
  await page.getByRole("button", { name: "Simpan pengaturan pembayaran" }).click();
  await expect(page.getByText("✓ Tersimpan")).toBeVisible();

  // 3. Keep the order step deterministic: force operating hours to all-day
  // via the admin settings API (session cookie shared with the page context).
  const settingsRes = await page.request.patch("/api/admin/settings", {
    data: { openTime: "00:00", closeTime: "23:59" },
  });
  expect(settingsRes.ok()).toBeTruthy();

  // 4. Create a menu item via the admin UI.
  await page.goto(`/admin/${slug}/menu`);
  await page.getByRole("button", { name: "+ Add item" }).click();
  await page.getByLabel("Name *").fill(itemName);
  await page.getByLabel("Price (IDR) *").fill("15000");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByText(itemName)).toBeVisible();

  // 5. Public shop: add to cart and submit the order.
  await page.goto(`/${slug}`);
  await page.getByRole("button", { name: `Tambah ${itemName}` }).click();
  await page.getByPlaceholder("Nama").fill("E2E Customer");
  await page.getByPlaceholder("Nomor HP (mis. 0812xxxx)").fill("081234567890");
  await page.getByRole("button", { name: "Buat Pesanan" }).click();

  // 6. Status page: PENDING badge + payment options.
  await page.waitForURL(new RegExp(`/${slug}/order/[0-9a-f-]{36}$`));
  await expect(page.getByText("Menunggu konfirmasi")).toBeVisible();
  await expect(page.getByText("Pembayaran")).toBeVisible();
  await expect(page.getByRole("button", { name: "QRIS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Transfer Bank" })).toBeVisible();
});
