/* ============================================================
   Lead Atlas — account-level Apify token rules
   ============================================================
   The signed-in account's `profiles.apify_token` is the source
   of truth. These helpers stay pure so node:test can cover the
   account/browser precedence without a network or a DOM.
   ============================================================ */

export function normalizeApifyToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isMissingTokenColumnError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "42703" || code === "PGRST204" || /apify_token/i.test(message);
}

/**
 * Decide which token belongs to the signed-in account.
 *
 * - `account` — the profile row already has the token (source of truth)
 * - `migrate` — no account token yet, but a legacy browser token should be
 *   written to the account once
 * - `cached`  — the profile is unavailable or lacks the column; use this
 *   browser's copy for the session instead of blocking the scanner
 * - `none`    — no token anywhere
 */
export function resolveAccountToken({
  profileToken,
  cachedToken,
  profileAvailable = true,
  columnMissing = false,
} = {}) {
  const accountToken = normalizeApifyToken(profileToken);
  if (accountToken) return { source: "account", token: accountToken };

  const browserToken = normalizeApifyToken(cachedToken);
  if (!profileAvailable) {
    return browserToken ? { source: "cached", token: browserToken } : { source: "none", token: "" };
  }
  if (!browserToken) return { source: "none", token: "" };
  if (columnMissing) return { source: "cached", token: browserToken };
  return { source: "migrate", token: browserToken };
}
