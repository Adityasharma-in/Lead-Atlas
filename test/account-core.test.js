import test from "node:test";
import assert from "node:assert/strict";

import {
  isMissingTokenColumnError,
  normalizeApifyToken,
  resolveAccountToken,
} from "../public/account-core.js";

test("normalizeApifyToken trims strings and rejects other values", () => {
  assert.equal(normalizeApifyToken("  apify_api_abc  "), "apify_api_abc");
  assert.equal(normalizeApifyToken(""), "");
  assert.equal(normalizeApifyToken(null), "");
  assert.equal(normalizeApifyToken(undefined), "");
  assert.equal(normalizeApifyToken(123), "");
});

test("the account token wins over a stale browser copy", () => {
  assert.deepEqual(
    resolveAccountToken({ profileToken: "apify_api_account", cachedToken: "apify_api_cache" }),
    { source: "account", token: "apify_api_account" },
  );
});

test("a legacy browser token migrates when the account has none", () => {
  assert.deepEqual(
    resolveAccountToken({ profileToken: "", cachedToken: "apify_api_cache" }),
    { source: "migrate", token: "apify_api_cache" },
  );
});

test("no account and no browser token resolves to none", () => {
  assert.deepEqual(resolveAccountToken({ profileToken: null, cachedToken: "" }), {
    source: "none",
    token: "",
  });
});

test("a missing profiles column keeps the browser token without migrating", () => {
  assert.deepEqual(
    resolveAccountToken({
      profileToken: "",
      cachedToken: "apify_api_cache",
      columnMissing: true,
    }),
    { source: "cached", token: "apify_api_cache" },
  );
});

test("an unavailable profile falls back to the browser token", () => {
  assert.deepEqual(
    resolveAccountToken({
      profileToken: "apify_api_account",
      cachedToken: "apify_api_cache",
      profileAvailable: false,
    }),
    { source: "account", token: "apify_api_account" },
  );
  assert.deepEqual(
    resolveAccountToken({
      profileToken: "",
      cachedToken: "apify_api_cache",
      profileAvailable: false,
    }),
    { source: "cached", token: "apify_api_cache" },
  );
  assert.deepEqual(resolveAccountToken({ profileAvailable: false }), {
    source: "none",
    token: "",
  });
});

test("missing-column errors are recognized by code or message", () => {
  assert.equal(isMissingTokenColumnError({ code: "42703" }), true);
  assert.equal(isMissingTokenColumnError({ code: "PGRST204", message: "schema cache" }), true);
  assert.equal(
    isMissingTokenColumnError({ message: "column profiles.apify_token does not exist" }),
    true,
  );
  assert.equal(isMissingTokenColumnError({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingTokenColumnError(null), false);
});
