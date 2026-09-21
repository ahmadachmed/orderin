/**
 * UU PDP — explicit consent gate shared by registration flows.
 * Every register route that collects PII (customer: name + phone + password;
 * tenant owner: name + email + username + password) must reject requests
 * whose body does not carry `consent: true`.
 */
export const PRIVACY_CONSENT_VERSION = "2026-08-28";

export const CONSENT_REQUIRED_MESSAGE =
  "Anda harus menyetujui Kebijakan Privasi dan Syarat & Ketentuan untuk mendaftar";

/** True only when the request body carries an explicit consent: true. */
export function hasConsent(
  body: Record<string, unknown> | null
): body is Record<string, unknown> & { consent: true } {
  return body?.consent === true;
}
