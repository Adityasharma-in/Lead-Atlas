import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  APP_VERSION,
  BUMP_KINDS,
  bumpVersion,
  formatVersion,
  parseVersion,
} from '../src/version.js';
import { bumpPackageVersion, readPackageVersion } from '../scripts/bump-version.js';

describe('parseVersion', () => {
  it('parses a plain three-part version', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
  });

  it('accepts multi-digit parts', () => {
    assert.deepEqual(parseVersion('12.0.11'), { major: 12, minor: 0, patch: 11 });
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(parseVersion('  1.2.3  '), { major: 1, minor: 2, patch: 3 });
  });

  it('rejects a v-prefix, partial, and non-numeric versions', () => {
    for (const value of ['v1.2.3', '1.2', '1.2.3.4', '1.2.x', '', null, 'latest']) {
      assert.equal(parseVersion(value), null, `expected null for ${value}`);
    }
  });
});

describe('formatVersion', () => {
  it('joins numeric parts back into a string', () => {
    assert.equal(formatVersion({ major: 1, minor: 2, patch: 3 }), '1.2.3');
  });

  it('round-trips with parseVersion', () => {
    assert.equal(formatVersion(parseVersion('4.9.13')), '4.9.13');
  });

  it('returns null for missing or negative parts', () => {
    assert.equal(formatVersion(null), null);
    assert.equal(formatVersion({ major: 1, minor: 2 }), null);
    assert.equal(formatVersion({ major: 1, minor: -1, patch: 0 }), null);
  });
});

describe('bumpVersion', () => {
  it('increments the patch for bug fixes', () => {
    assert.equal(bumpVersion('1.1.0', 'patch'), '1.1.1');
  });

  it('lets the patch pass 9 without rollover', () => {
    assert.equal(bumpVersion('1.1.9', 'patch'), '1.1.10');
    assert.equal(bumpVersion('1.1.10', 'patch'), '1.1.11');
  });

  it('bumps the minor for a feature and resets the patch', () => {
    assert.equal(bumpVersion('1.1.11', 'minor'), '1.2.0');
  });

  it('rolls a minor at 9 over to the next major', () => {
    assert.equal(bumpVersion('1.9.4', 'minor'), '2.0.0');
    assert.equal(bumpVersion('2.9.9', 'minor'), '3.0.0');
  });

  it('keeps bumping the minor below the ceiling of 9', () => {
    assert.equal(bumpVersion('1.8.7', 'minor'), '1.9.0');
  });

  it('bumps the major and resets minor and patch', () => {
    assert.equal(bumpVersion('1.9.3', 'major'), '2.0.0');
  });

  it('returns null for a bad version or an unknown kind', () => {
    assert.equal(bumpVersion('1.2', 'patch'), null);
    assert.equal(bumpVersion('1.2.3', 'build'), null);
    assert.equal(bumpVersion('1.2.3', null), null);
  });
});

describe('readAppVersion', () => {
  it('exposes the package.json version as APP_VERSION', async () => {
    const raw = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(APP_VERSION, raw.version);
  });

  it('lists exactly the three bump kinds', () => {
    assert.deepEqual(BUMP_KINDS, ['patch', 'minor', 'major']);
  });
});

describe('bumpPackageVersion', () => {
  let dir;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lead-atlas-bump-'));
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('walks patch bumps far past 9 in a real package.json', async () => {
    const file = path.join(dir, 'package.json');
    await writeFile(
      file,
      `${JSON.stringify({ name: 'fixture', version: '1.1.9' }, null, 2)}\n`,
      'utf8',
    );

    assert.equal(await bumpPackageVersion(dir, 'patch'), '1.1.10');
    assert.equal(await bumpPackageVersion(dir, 'patch'), '1.1.11');

    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.version, '1.1.11');
    assert.equal(await readPackageVersion(dir), '1.1.11');
  });

  it('rolls the minor over to the next major and keeps the file format', async () => {
    const file = path.join(dir, 'package.json');
    await writeFile(file, `{\n  "name": "fixture",\n  "version": "1.9.5"\n}\n`, 'utf8');

    assert.equal(await bumpPackageVersion(dir, 'minor'), '2.0.0');
    assert.equal(await readFile(file, 'utf8'), `{\n  "name": "fixture",\n  "version": "2.0.0"\n}\n`);
  });

  it('refuses an unknown kind without touching the file', async () => {
    const file = path.join(dir, 'package.json');
    const before = await readFile(file, 'utf8');

    await assert.rejects(
      () => bumpPackageVersion(dir, 'build'),
      /Cannot bump/,
    );
    assert.equal(await readFile(file, 'utf8'), before);
  });
});
