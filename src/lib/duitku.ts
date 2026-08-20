/**
 * Monetisation Phase 3 / T21 — Duitku Pop (hosted payment page) client (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.2 / §9.
 *
 * ALL Duitku calls are isolated in this module — swapping gateways again means
 * replacing this file + the webhook route, nothing else.
 *
 * Env (server-only — never imported by client components):
 *   DUITKU_MERCHANT_CODE  merchant code (dashboard Duitku, format DXXXX)
 *   DUITKU_API_KEY        API key (request signature + callback verification)
 *   DUITKU_BASE_URL       full create-invoice endpoint:
 *                         sandbox https://api-sandbox.duitku.com/api/merchant/createInvoice
 *                         prod    https://api-prod.duitku.com/api/merchant/createInvoice
 *   CRON_SECRET           token for POST /api/cron/rebill
 *   NEXT_PUBLIC_APP_URL   origin for callbackUrl + returnUrl
 *
 * Env is read LAZILY inside functions so tests can set process.env per case
 * and a missing key fails the specific call (not the module import).
 *
 * ⚠️ TWO DIFFERENT SIGNATURES (docs.duitku.com — do not mix up):
 *   1. Request (createInvoice) header: HMAC_SHA256(merchantCode + timestamp, apiKey)
 *      where timestamp = UNIX ms in Jakarta time (UTC+7) → Date.now() + 7*3600e3.
 *   2. Callback form field `signature`: HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { DUITKU_EXPIRY_MINUTES } from "@/lib/billing";

export const DUITKU_CREATE_INVOICE_URL_DEFAULT =
  "https://api-sandbox.duitku.com/api/merchant/createInvoice";

/** Duitku API error — status = HTTP status (0 = network failure), code = statusCode. */
export class DuitkuError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "DuitkuError";
  }
}

export interface DuitkuCreateInvoiceInput {
  /** Payment.externalId — idempotency key, sent as merchantOrderId. */
  externalId: string;
  /** Always PRO_PRICE_IDR (99000). */
  amount: number;
  /** productDetails — shown on the hosted page. */
  description: string;
  /** customerVaName — tenant display name. */
  customerVaName: string;
  email?: string | null;
  /** Where Duitku POSTs the payment callback. */
  callbackUrl: string;
  /** Where the customer is redirected after paying. */
  returnUrl: string;
}

export interface DuitkuInvoice {
  merchantCode: string;
  /** Duitku transaction reference — stored as Payment.gatewayReference. */
  reference: string;
  /** Hosted payment page URL (QRIS/VA/e-wallet — customer picks the channel). */
  paymentUrl: string;
  amount: number;
  statusCode: string;
  statusMessage: string;
  [key: string]: unknown;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new DuitkuError(500, "ENV_MISSING", `${name} is not configured`);
  return value;
}

/** Constant-time hex compare (both sides lowercase). */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * POST {DUITKU_BASE_URL} — create a Duitku Pop invoice (hosted payment page).
 * Request signature (header): HMAC_SHA256(merchantCode + timestamp, apiKey),
 * timestamp = UNIX ms in Jakarta time (UTC+7) — computed explicitly because
 * the rest of the codebase is all-UTC. The timestamp is only used for the
 * signature, never for business logic.
 */
export async function createInvoice(input: DuitkuCreateInvoiceInput): Promise<DuitkuInvoice> {
  const merchantCode = getEnv("DUITKU_MERCHANT_CODE");
  const apiKey = getEnv("DUITKU_API_KEY");
  const baseUrl = process.env.DUITKU_BASE_URL ?? DUITKU_CREATE_INVOICE_URL_DEFAULT;

  const timestamp = String(Date.now() + 7 * 3_600_000); // WIB (UTC+7), ms
  const signature = createHmac("sha256", apiKey).update(merchantCode + timestamp).digest("hex");

  const body = {
    paymentAmount: input.amount, // always PRO_PRICE_IDR
    merchantOrderId: input.externalId, // = Payment.externalId — idempotency key
    productDetails: input.description,
    paymentMethod: "", // "" = all channels (hosted page lets the customer choose)
    customerVaName: input.customerVaName,
    ...(input.email ? { email: input.email } : {}),
    callbackUrl: input.callbackUrl,
    returnUrl: input.returnUrl,
    expiryPeriod: DUITKU_EXPIRY_MINUTES, // minutes = 3 days (pay window == grace)
  };

  let res: Response;
  try {
    res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-duitku-merchantcode": merchantCode,
        "x-duitku-timestamp": timestamp,
        "x-duitku-signature": signature,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new DuitkuError(0, "NETWORK_ERROR", `Duitku unreachable: ${(err as Error).message}`);
  }

  const data = (await res.json().catch(() => null)) as Partial<DuitkuInvoice> | null;
  const statusCode = data?.statusCode ?? "";
  const statusMessage = data?.statusMessage ?? res.statusText;

  if (!res.ok || statusCode !== "00") {
    // Duitku returns HTTP 200 with statusCode != "00" for business errors
    // (invalid merchant, duplicate merchantOrderId, ...) — map both to DuitkuError.
    throw new DuitkuError(res.status, statusCode || "HTTP_ERROR", statusMessage || "Unknown error");
  }

  return data as DuitkuInvoice;
}

/**
 * Constant-time verification of the callback form field `signature`.
 * stringToSign = merchantCode + amount + merchantOrderId (RAW form values —
 * the amount string is signed exactly as Duitku sent it, e.g. "99000" or
 * "99000.00"; numeric normalisation happens later for the amount check).
 */
export function verifyCallbackSignature(
  merchantCode: string,
  amount: string | number,
  merchantOrderId: string,
  signature: string | null | undefined,
  apiKey?: string
): boolean {
  const key = apiKey ?? process.env.DUITKU_API_KEY;
  if (!key || !signature || !merchantCode || !merchantOrderId || amount === "" || amount === null || amount === undefined) {
    return false;
  }
  const stringToSign = merchantCode + String(amount) + merchantOrderId;
  const calc = createHmac("sha256", key).update(stringToSign).digest("hex");
  return constantTimeEqualHex(calc, signature);
}

/** Constant-time verify of the cron `x-cron-secret` header. */
export function verifyCronSecret(headerValue: string | null | undefined): boolean {
  return verifySecret(headerValue, process.env.CRON_SECRET);
}

function verifySecret(headerValue: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
