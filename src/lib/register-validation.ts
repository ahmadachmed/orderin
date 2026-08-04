/**
 * REG-08: client-side registration password validation.
 * Pure helpers so the match rule is unit-testable without a DOM.
 */

/** Returns an error message when the confirmation doesn't match, else null. */
export function validatePasswordMatch(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) return "Password tidak cocok";
  return null;
}
