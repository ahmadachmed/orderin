// @vitest-environment node
/**
 * Monetisation Phase 3 / T20 — unit tests for lib/xendit.ts (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.2 / §10.
 *
 * createInvoice is exercised with a stubbed global fetch (no network):
 *   - payload shape (external_id, amount 99000, invoice_duration 72, currency,
 *     success_redirect_url, customer.email when provided)
 *   - Basic auth header from XENDIT_SECRET_KEY
 *   - 400/401/429 error mapping → XenditError { status, code, message }
 *   - network failure → status 0 NETWORK_ERROR
 *   - missing secret → 500 ENV_MISSING
 * verifyWebhookToken / verifyCronSecret are pure constant-time compares.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInvoice,
  verifyWebhookToken,
  verifyCronSecret,
  XenditError,
} from "../src/lib/xendit";

const SECRET = "xnd_development_testkey123";
const TOKEN = "webhook-token-abc";
const CRON = "cron-secret-xyz";

function invoiceResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_123",
    invoice_url: "https://checkout.xendit.co/web/inv_123",
    status: "PENDING",
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
  process.env.XENDIT_SECRET_KEY = SECRET;
  process.env.XENDIT_WEBHOOK_TOKEN = TOKEN;
  process.env.CRON_SECRET = CRON;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.XENDIT_SECRET_KEY;
  delete process.env.XENDIT_WEBHOOK_TOKEN;
  delete process.env.CRON_SECRET;
});

const BASE_INPUT = {
  externalId: "pay_tnt_123_1787200000000",
  amount: 99000,
  description: "HeadwayBrew PRO — langganan 30 hari",
  successRedirectUrl: "https://app.example.com/admin/kopi/settings?billing=success",
};

describe("createInvoice", () => {
  it("POSTs the specced payload to {base}/v2/invoices with Basic auth", async () => {
    stubFetch(201, invoiceResponse());
    const result = await createInvoice(BASE_INPUT);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.xendit.co/v2/invoices");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`${SECRET}:`).toString("base64")}`,
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      external_id: BASE_INPUT.externalId,
      amount: 99000,
      invoice_duration: 72, // pay window == grace period
      success_redirect_url: BASE_INPUT.successRedirectUrl,
      currency: "IDR",
    });
    expect(result).toEqual(invoiceResponse());
  });

  it("omits customer when no email is provided", async () => {
    stubFetch(201, invoiceResponse());
    await createInvoice(BASE_INPUT);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.customer).toBeUndefined();
  });

  it("includes customer.email when provided", async () => {
    stubFetch(201, invoiceResponse());
    await createInvoice({ ...BASE_INPUT, customerEmail: "owner@kopi.id" });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.customer).toEqual({ email: "owner@kopi.id" });
  });

  it("honours XENDIT_BASE_URL override", async () => {
    process.env.XENDIT_BASE_URL = "https://xendit.test";
    stubFetch(201, invoiceResponse());
    await createInvoice(BASE_INPUT);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://xendit.test/v2/invoices");
  });

  it("maps 400 to XenditError with API error_code", async () => {
    stubFetch(400, { error_code: "INVALID_EXTERNAL_ID", message: "external_id too long" });
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      name: "XenditError",
      status: 400,
      code: "INVALID_EXTERNAL_ID",
      message: "external_id too long",
    });
  });

  it("maps 401 (bad key) to XenditError status 401", async () => {
    stubFetch(401, { error_code: "API_VALIDATION_ERROR", message: "Unauthorized" });
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({ status: 401 });
  });

  it("maps 429 (rate limit) to XenditError status 429", async () => {
    stubFetch(429, { error_code: "MAXIMUM_RETRY_COUNT", message: "Too many requests" });
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({ status: 429 });
  });

  it("throws XenditError(0, NETWORK_ERROR) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("throws XenditError(500, ENV_MISSING) when the secret is unset", async () => {
    delete process.env.XENDIT_SECRET_KEY;
    await expect(createInvoice(BASE_INPUT)).rejects.toMatchObject({
      status: 500,
      code: "ENV_MISSING",
      message: "XENDIT_SECRET_KEY is not configured",
    });
  });

  it("returns the created invoice (id, invoice_url, status)", async () => {
    stubFetch(201, invoiceResponse({ id: "inv_999", status: "PENDING" }));
    const inv = await createInvoice(BASE_INPUT);
    expect(inv.id).toBe("inv_999");
    expect(inv.invoice_url).toContain("checkout.xendit.co");
    expect(inv.status).toBe("PENDING");
  });

  it("is an XenditError instance", async () => {
    stubFetch(400, { error_code: "X", message: "y" });
    const err = await createInvoice(BASE_INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(XenditError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("verifyWebhookToken", () => {
  it("accepts the exact token", () => {
    expect(verifyWebhookToken(TOKEN)).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(verifyWebhookToken("wrong")).toBe(false);
  });
  it("rejects empty / null / undefined", () => {
    expect(verifyWebhookToken("")).toBe(false);
    expect(verifyWebhookToken(null)).toBe(false);
    expect(verifyWebhookToken(undefined)).toBe(false);
  });
  it("rejects when the env token is not configured", () => {
    delete process.env.XENDIT_WEBHOOK_TOKEN;
    expect(verifyWebhookToken(TOKEN)).toBe(false);
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
