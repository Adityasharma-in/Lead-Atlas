const SUPABASE_KEY_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Reads the public Supabase project settings. Only the anon key is exposed to
 * the browser — it is designed to be public and every table is protected by
 * row level security. A service-role key must never be placed here.
 */
export function readSupabaseConfig(env = process.env) {
  const url = cleanUrl(env.SUPABASE_URL);
  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const validKey = SUPABASE_KEY_PATTERN.test(anonKey);
  const configured = Boolean(url && validKey);

  return {
    configured,
    url: configured ? url : null,
    anonKey: configured ? anonKey : null,
    projectRef: configured ? projectRefFromUrl(url) : null,
  };
}

export function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.(co|in)$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * The browser talks to GoTrue (auth) and PostgREST (database) directly. The CSP
 * therefore needs the project origin in connect-src, and nowhere else.
 */
export function supabaseConnectSources(config) {
  if (!config?.url) return [];
  try {
    const url = new URL(config.url);
    return [url.origin];
  } catch {
    return [];
  }
}
