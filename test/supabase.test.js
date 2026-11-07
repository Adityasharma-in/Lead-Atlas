import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildContentSecurityPolicy } from '../src/config.js';
import {
  projectRefFromUrl,
  readSupabaseConfig,
  supabaseConnectSources,
} from '../src/supabase.js';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.public-anon-key';

describe('readSupabaseConfig', () => {
  it('reads and normalizes a complete project configuration', () => {
    const config = readSupabaseConfig({
      SUPABASE_URL: '  https://demo-project.supabase.co/  ',
      SUPABASE_ANON_KEY: `  ${ANON_KEY}  `,
    });

    assert.equal(config.configured, true);
    assert.equal(config.url, 'https://demo-project.supabase.co');
    assert.equal(config.anonKey, ANON_KEY);
    assert.equal(config.projectRef, 'demo-project');
  });

  it('keeps a non-default port in the project origin', () => {
    const config = readSupabaseConfig({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: ANON_KEY,
    });

    assert.equal(config.configured, true);
    assert.equal(config.url, 'http://127.0.0.1:54321');
    assert.equal(config.projectRef, null);
  });

  it('recognizes Supabase .in domains', () => {
    assert.equal(projectRefFromUrl('https://my-project.supabase.in'), 'my-project');
  });

  it('stays unconfigured when either value is missing', () => {
    for (const env of [
      {},
      { SUPABASE_URL: 'https://demo-project.supabase.co' },
      { SUPABASE_ANON_KEY: ANON_KEY },
    ]) {
      const config = readSupabaseConfig(env);
      assert.equal(config.configured, false);
      assert.equal(config.url, null);
      assert.equal(config.anonKey, null);
      assert.equal(config.projectRef, null);
    }
  });

  it('rejects malformed URLs, non-HTTP protocols, and short keys', () => {
    const invalid = [
      { SUPABASE_URL: 'not a url', SUPABASE_ANON_KEY: ANON_KEY },
      { SUPABASE_URL: 'ftp://demo-project.supabase.co', SUPABASE_ANON_KEY: ANON_KEY },
      { SUPABASE_URL: 'https://demo-project.supabase.co', SUPABASE_ANON_KEY: 'short' },
      { SUPABASE_URL: 'https://demo-project.supabase.co', SUPABASE_ANON_KEY: 'bad key with spaces' },
    ];

    for (const env of invalid) {
      const config = readSupabaseConfig(env);
      assert.equal(config.configured, false, `expected unconfigured for ${JSON.stringify(env)}`);
    }
  });
});

describe('supabaseConnectSources', () => {
  it('returns the project origin once, without a trailing path', () => {
    assert.deepEqual(
      supabaseConnectSources({ url: 'https://demo-project.supabase.co/' }),
      ['https://demo-project.supabase.co'],
    );
  });

  it('returns no sources when Supabase is not configured', () => {
    assert.deepEqual(supabaseConnectSources(null), []);
    assert.deepEqual(supabaseConnectSources({ url: null }), []);
    assert.deepEqual(supabaseConnectSources({ url: 'not a url' }), []);
  });
});

describe('buildContentSecurityPolicy', () => {
  it('keeps self-only connections when there are no extra sources', () => {
    const policy = buildContentSecurityPolicy();
    assert.match(policy, /(?:^|; )connect-src 'self'(?:;|$)/);
  });

  it('adds the Supabase origin and removes duplicate sources', () => {
    const policy = buildContentSecurityPolicy([
      'https://demo-project.supabase.co',
      'https://demo-project.supabase.co',
      '',
    ]);
    assert.match(
      policy,
      /connect-src 'self' https:\/\/demo-project\.supabase\.co(?:;|$)/,
    );
  });
});
