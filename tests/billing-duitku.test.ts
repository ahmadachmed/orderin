// @vitest-environment node
/**
 * Monetisation Phase 3 / T21 — unit tests for lib/duitku.ts (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.2 / §10.
 *
 * createInvoice is exercised with a stubbed global fetch (no network):
 *   - request headers: x-duitku-merchantcode, x-duitku-timestamp (ms WIB),
 *     x-duitku-signature = HMAC_SHA256(merchantCode + timestamp, apiKey) hex
 *   - payload shape (paymentAmount 99000, merchantOrderId, productDetails,
 *     paymentMethod "", customerVaName, email, callbackUrl, returnUrl,
 *     expiryPeriod 4320)
 *   - error mapping → DuitkuError { status, code, message } — including the
 *     Duitku quirk: HTTP 200 with statusCode != "00" is still an error
 *   - network failure → status 0 NETWORK_ERROR
 *   - missing secret → 500 ENV_MISSING
 * verifyCallbackSignature: HMAC(merchantCode + amount + merchantOrderId) —
 * NOTE the ORDER is different from the request signature (request uses
 * merchantCode + timestamp). verifyCronSecret is a plain constant-time compare.
 */
import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInvoice,
  verifyCallbackSignature,
  verifyCronSecret,
  DuitkuError,
  DUITKU_CREATE_INVOICE_URL_DEFAULT,
} from "../src/lib/duitku";

const MERCHANT = "D1234";
const API_KEY = "test-api-key-abc";
const CRON = "cron-secret-xyz";

function hmacSha256Hex(data: string, key: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function invoiceResponse(overrides: Record<string, unknown> = {}) {
  return {
    merchantCode: MERCHANT,
    reference: "DUITKU123",
    paymentUrl: "https://app.duitku.com/payment/DUITKU123",
    amount: 99000,
    statusCode: "00",
    statusMessage: "Success",
    ...overrides,
  };
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 401 ? "Unauthorized" : "",
      json: async () => body,
    })
  );
}

beforeEach(() => {
  process.env.DUITKU_MERCHANT_CODE = MERCHANT;
  process.env.DUITKU_API_KEY = API_KEY;
  process.env.CRON_SECRET = CRON;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DUITKU_MERCHANT_CODE;
  delete process.env.DUITKU_API_KEY;
  delete process.env.CRON_SECRET;
});

const BASE_INPUT = {
  externalId: "pay_tnt_123_1787200000000",
  amount: 99000,
  description: "HeadwayBrew PRO — langganan 30 hari",
  customerVaName: "Kopi Makassar",
  callbackUrl: "https://app.example.com/api/webhooks/duitku",
  returnUrl: "https://app.example.com/admin/kopi/settings?billing=success",
};

describe("createInvoice", () => {
  it("POSTs the specced payload to {DUITKU_BASE_URL} with the 3 signature headers", async () => {
    stubFetch(200, invoiceResponse());
    const result = await createInvoice(BASE_INPUT);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DUITKU_CREATE_INVOICE_URL_DEFAULT);

    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-duitku-merchantcode"]).toBe(MERCHANT);

    // Timestamp must be UNIX ms in Jakarta time (UTC+7) — we assert it is
    // within a few seconds of Date.now() + 7h.
    const ts = Number(headers["x-duitku-timestamp"]);
    expect(Number.isFinite(ts)).toBe(true);
    const wibNow = Date.now() + 7 * 3_600_000;
    expect(Math.abs(ts - wibNow)).toBeLessThan(5_000);

    // Request signature = HMAC(merchantCode + timestamp, apiKey), hex lowercase.
    const expectedSig = hmacSha256Hex(`${MERCHANT}${headers["x-duitku-timestamp"]}`, API_KEY);
    expect(headers["x-duitku-signature"]).toBe(expectedSig);
    expect(headers["x-duitku-signature"]).toMatch(/^[0-9a-f]{64}$/);

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      paymentAmount: 99000,
      merchantOrderId: BASE_INPUT.externalId,
      productDetails: BASE_INPUT.description,
      paymentMethod: "", // all channels — hosted page lets the customer choose
      customerVaName: BASE_INPUT.customerVaName,
      callbackUrl: BASE_INPUT.callbackUrl,
      returnUrl: BASE_INPUT.returnUrl,
      expiryPeriod: 4320, // minutes == 3-day grace
    });
    expect(result).toEqual(invoiceResponse());
  });

  it("omits email when none is provided", async () => {
    stubFetch(200, invoiceResponse());
    await createInvoice(BASE_INPUT);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.email).toBeUndefined();
  });

  it("includes email when provided", async () => {
    stubFetch(200, invoiceResponse());
    await createInvoice({ ...BASE_INPUT, email: "owner@kopi.id" });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.email).toBe("owner@kopi.id");
  });

  it("honours DUITKU_BASE_URL override (prod endpoint)", async () => {
    process.env.DUITKU_BASE_URL = "https://api-prod.duitku.com/api/merchant/createInvoice";
    stubFetch(200, invoiceResponse());
    await createInvoice(BASE_INPUT);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      "https://api-prod.duitku.com/api/merchant/createInvoice"
    );
  });

  it("maps HTTP 400 with a Duitku statusCode to DuitkuError", async () => {
    stubFetch(400, { statusCode: "01", statusMessage: "Invalid merchant" });
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      name: "DuitkuError",
      status: 400,
      code: "01",
      message: "Invalid merchant",
    });
  });

  it("maps HTTP 401 (bad key) to DuitkuError status 401", async () => {
    stubFetch(401, { statusCode: "01", statusMessage: "Unauthorized" });
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({ status: 401 });
  });

  it("maps HTTP 200 with statusCode != 00 to DuitkuError (Duitku business-error quirk)", async () => {
    // Duitku returns 200 with statusCode "01" for business errors (e.g.
    // duplicate merchantOrderId) — must NOT be treated as success.
    stubFetch(200, { statusCode: "01", statusMessage: "MerchantOrderId already used" });
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      name: "DuitkuError",
      status: 200,
      code: "01",
      message: "MerchantOrderId already used",
    });
  });

  it("throws DuitkuError(0, NETWORK_ERROR) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("throws DuitkuError(500, ENV_MISSING) when DUITKU_API_KEY is unset", async () => {
    delete process.env.DUITKU_API_KEY;
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      status: 500,
      code: "ENV_MISSING",
      message: "DUITKU_API_KEY is not configured",
    });
  });

  it("throws DuitkuError(500, ENV_MISSING) when DUITKU_MERCHANT_CODE is unset", async () => {
    delete process.env.DUITKU_MERCHANT_CODE;
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      status: 500,
      code: "ENV_MISSING",
    });
  });

  it("returns the created invoice (reference, paymentUrl, statusCode)", async () => {
    stubFetch(200, invoiceResponse({ reference: "DUITKU999", statusCode: "00" }));
    const inv = await createInvoice(BASE_INPUT);
    expect(inv.reference).toBe("DUITKU999");
    expect(inv.paymentUrl).toContain("app.duitku.com/payment");
    expect(inv.statusCode).toBe("00");
  });

  it("is a DuitkuError instance", async () => {
    stubFetch(400, { statusCode: "01", statusMessage: "y" });
    const err = await createInvoice(BASE_INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(DuitkuError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("verifyCallbackSignature", () => {
  const cbAmount = "99000.00"; // Duitku may send the amount with decimals
  const cbOrderId = "pay_tnt_123_1787200000000";

  it("accepts the correct HMAC(merchantCode + amount + merchantOrderId)", () => {
    const sig = hmacSha256Hex(`${MERCHANT}${cbAmount}${cbOrderId}`, API_KEY);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, sig)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, "deadbeef".repeat(8))).toBe(false);
  });

  it("rejects when the stringToSign order is wrong (amount before merchantCode)", () => {
    // This is the T21 pitfall: callback stringToSign is merchantCode+amount+merchantOrderId,
    // NOT the request-signature order (merchantCode+timestamp).
    const wrongOrderSig = hmacSha256Hex(`${cbAmount}${MERCHANT}${cbOrderId}`, API_KEY);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, wrongOrderSig)).toBe(false);
  });

  it("rejects empty / null / undefined signature", () => {
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, "")).toBe(false);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, null)).toBe(false);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, undefined)).toBe(false);
  });

  it("rejects when the api key env is not configured", () => {
    delete process.env.DUITKU_API_KEY;
    const sig = hmacSha256Hex(`${MERCHANT}${cbAmount}${cbOrderId}`, API_KEY);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, sig)).toBe(false);
  });

  it("rejects empty merchantCode / merchantOrderId / amount", () => {
    const sig = hmacSha256Hex(`${MERCHANT}${cbAmount}${cbOrderId}`, API_KEY);
    expect(verifyCallbackSignature("", cbAmount, cbOrderId, sig)).toBe(false);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, "", sig)).toBe(false);
    expect(verifyCallbackSignature(MERCHANT, "", cbOrderId, sig)).toBe(false);
  });

  it("accepts an explicit apiKey argument (test-time override)", () => {
    const sig = hmacSha256Hex(`${MERCHANT}${cbAmount}${cbOrderId}`, API_KEY);
    expect(verifyCallbackSignature(MERCHANT, cbAmount, cbOrderId, sig, API_KEY)).toBe(true);
  });
});

describe("verifyCronSecret", () => {
  it("accepts the exact secret", () => {
    expect(verifyCronSecret(CRON)).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(verifyCronSecret("wrong")).toBe(false);
  });
  it("rejects empty / missing env", () => {
    expect(verifyCronSecret("")).toBe(false);
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret(CRON)).toBe(false);
  });
});
