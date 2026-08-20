/**
 * Monetisation Phase 3 / T14 — Xendit Invoice API (legacy v2) client (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.
 *
 * ALL Xendit calls are isolated in this module — migrating to Payment
 * Sessions v3 later means replacing this file + webhook event names, nothing
 * else (plan §3.3 risk mitigation).
 *
 * Env (server-only — never imported by client components):
 *   XENDIT_SECRET_KEY     API key (create invoice)
 *   XENDIT_WEBHOOK_TOKEN  token from Dashboard → Settings → Webhooks
 *   XENDIT_BASE_URL       default https://api.xendit.co (xnd_development_ key for test mode)
 *   CRON_SECRET           token for POST /api/cron/rebill
 *   NEXT_PUBLIC_APP_URL   origin for success_redirect_url
 *
 * Env is read LAZILY inside functions so tests can set process.env per case
 * and a missing key fails the specific call (not the module import).
 */
import { timingSafeEqual } from "node:crypto";
import { XENDIT_INVOICE_DURATION_HOURS } from "@/lib/billing";

export const XENDIT_BASE_URL_DEFAULT = "https://api.xendit.co";

/** Xendit API error — status = HTTP status (0 = network failure), code = error_code. */
export class XenditError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "XenditError";
  }
}

export interface XenditCreateInvoiceInput {
  externalId: string;
  amount: number;
  description: string;
  successRedirectUrl: string;
  customerEmail?: string | null;
}

export interface XenditInvoice {
  id: string;
  invoice_url: string;
  status: string;
  [key: string]: unknown;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new XenditError(500, "ENV_MISSING", `${name} is not configured`);
  return value;
}

/** POST {XENDIT_BASE_URL}/v2/invoices — create a hosted payment page. */
export async function createInvoice(
  input: XenditCreateInvoiceInput
): Promise<XenditInvoice> {
  const secretKey = getEnv("XENDIT_SECRET_KEY");
  const baseUrl = process.env.XENDIT_BASE_URL ?? XENDIT_BASE_URL_DEFAULT;

  const body = {
    external_id: input.externalId,
    amount: input.amount, // caller always passes PRO_PRICE_IDR
    description: input.description,
    invoice_duration: XENDIT_INVOICE_DURATION_HOURS, // 72h — pay window == grace period
    success_redirect_url: input.successRedirectUrl,
    currency: "IDR",
    ...(input.customerEmail
      ? { customer: { email: input.customerEmail } }
      : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v2/invoices`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new XenditError(0, "NETWORK_ERROR", `Xendit unreachable: ${(err as Error).message}`);
  }

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error_code?: string; message?: string };
      if (data.error_code) code = data.error_code;
      if (data.message) message = data.message;
    } catch {
      // non-JSON error body — keep defaults
    }
    throw new XenditError(res.status, code, message);
  }

  return (await res.json()) as XenditInvoice;
}

/** Constant-time verify of the webhook `x-callback-token` header. */
export function verifyWebhookToken(headerValue: string | null | undefined): boolean {
  return verifySecret(headerValue, process.env.XENDIT_WEBHOOK_TOKEN);
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
