// App versioning for Lead Atlas.
//
// The scheme is semver-like with one house rule: the minor part stops at 9.
//
//   MAJOR.MINOR.PATCH    e.g. 1.2.11
//   - PATCH  bug fixes, tiny tweaks, copy/docs nits. No cap (1.1.9 → 1.1.10).
//   - MINOR  a new feature or a notable change. When it would pass 9 it rolls
//            over: major + 1 and minor back to 0 (1.9.4 → 2.0.0).
//   - MAJOR  rises only on that rollover (or a truly breaking change).
//
// The single source of truth is the `version` field in package.json. Bump it
// with `npm run bump:patch` / `bump:minor` / `bump:major`, never by hand.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MINOR_CEILING = 9;

export const BUMP_KINDS = ['patch', 'minor', 'major'];

/**
 * Parse "1.2.3" (a bare "v" prefix is not accepted) into numeric parts.
 * Returns null for anything that is not a plain three-part version.
 */
export function parseVersion(value) {
  const raw = String(value || '').trim();
  if (!VERSION_PATTERN.test(raw)) return null;
  const [major, minor, patch] = raw.split('.').map((part) => Number(part));
  return { major, minor, patch };
}

/** Format numeric parts back into "major.minor.patch". Returns null if invalid. */
export function formatVersion(parts) {
  if (
    !parts ||
    !Number.isInteger(parts.major) ||
    !Number.isInteger(parts.minor) ||
    !Number.isInteger(parts.patch) ||
    parts.major < 0 ||
    parts.minor < 0 ||
    parts.patch < 0
  ) {
    return null;
  }
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

/**
 * Bump a version string one step.
 *
 * - "patch": patch + 1 (uncapped).
 * - "minor": minor + 1 with patch reset; a minor already at 9 rolls over to
 *   major + 1, minor 0.
 * - "major": major + 1 with minor and patch reset.
 *
 * Returns the bumped string, or null for an unparseable version or kind.
 */
export function bumpVersion(value, kind) {
  const version = parseVersion(value);
  if (!version || !BUMP_KINDS.includes(kind)) return null;

  if (kind === 'patch') {
    version.patch += 1;
  } else if (kind === 'minor') {
    if (version.minor >= MINOR_CEILING) {
      version.major += 1;
      version.minor = 0;
    } else {
      version.minor += 1;
    }
    version.patch = 0;
  } else {
    version.major += 1;
    version.minor = 0;
    version.patch = 0;
  }

  return formatVersion(version);
}

/** Read the app version from package.json (the repo root, next to src/). */
function readAppVersion() {
  const raw = readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  const version = parseVersion(JSON.parse(raw).version);
  if (!version) {
    throw new Error('package.json has no valid version field (expected "major.minor.patch").');
  }
  return formatVersion(version);
}

export const APP_VERSION = readAppVersion();
