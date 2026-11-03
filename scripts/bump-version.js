// Version bump tool for Lead Atlas.
//
//   node scripts/bump-version.js          → print the current version
//   node scripts/bump-version.js patch    → bug fix / tiny change   (1.1.0 → 1.1.1)
//   node scripts/bump-version.js minor    → new feature             (1.1.9 → 1.2.0)
//   node scripts/bump-version.js major    → minor rolled past 9     (1.9.4 → 2.0.0)
//
// The rules live in src/version.js; this file only does the file I/O so tests
// can call bumpPackageVersion() without spawning a process.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BUMP_KINDS, bumpVersion, formatVersion, parseVersion } from '../src/version.js';

/**
 * Bump the `version` field of the package.json in projectRoot and rewrite the
 * file in place (2-space indent, trailing newline — the existing format).
 * Returns the new version string.
 */
export async function bumpPackageVersion(projectRoot, kind) {
  const file = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  const next = bumpVersion(pkg.version, kind);
  if (!next) {
    throw new Error(
      `Cannot bump "${kind}" from version "${pkg.version}". Check package.json and src/version.js.`,
    );
  }
  const serialized = `${JSON.stringify({ ...pkg, version: next }, null, 2)}\n`;
  await writeFile(file, serialized, 'utf8');
  return next;
}

/** Read the current version field of the package.json in projectRoot. */
export async function readPackageVersion(projectRoot) {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  return formatVersion(parseVersion(pkg.version));
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const kind = process.argv[2] || '';

  try {
    if (!kind) {
      console.log(await readPackageVersion(projectRoot));
    } else if (BUMP_KINDS.includes(kind)) {
      const next = await bumpPackageVersion(projectRoot, kind);
      console.log(`Version bumped to ${next}. Commit it with the change that caused the bump.`);
    } else {
      console.error(`Unknown kind "${kind}". Use: ${BUMP_KINDS.join(', ')} — or no argument to print the current version.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[bump-version] ${error?.message || error}`);
    process.exitCode = 1;
  }
}
