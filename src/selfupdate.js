// Self-update support for Lead Atlas.
//
// The app is served from the same git clone it ships in, so "update" means
// syncing the working copy to the tip of `origin/<current branch>` on GitHub
// and restarting the local server.
//
// The module is split in two layers:
//  - pure helpers (below): URL/output parsers and sha/packaging comparisons
//  - side effects (createSelfUpdater): git + GitHub API runners, injectable
//    so tests never need a real repository or network.

const COMMIT_FIELDS = '\x1f';

/**
 * Extract { host, owner, repo } from a git remote URL.
 * Accepts https / ssh / scp-style forms, optional user info, optional .git suffix.
 * Returns null for anything that is not a GitHub-hosted repository path.
 */
export function parseRepository(remoteUrl) {
  let raw = String(remoteUrl || '').trim();
  if (!raw) return null;
  raw = raw.replace(/\.git$/i, '');

  // scheme://[user[:pass]@]host[:port][/path] or ssh://git@host/owner/repo
  const urlForm = raw.match(
    /^[a-z][\w+.-]*:\/\/(?:[^/?#]*@)?([^/?#,]+?)(?::\d+)?[:/](.+)$/i,
  );
  // scp style: [user@]host:owner/repo
  const scpForm = urlForm ? null : raw.match(/^(?:[^@]+@)?([^:/]+):(.+)$/);
  const match = urlForm || scpForm;
  if (!match) return null;

  const [, host, rawPath] = match;
  if (!/^(?:[\w-]+\.)*github\.com$/i.test(host)) return null;

  const path = rawPath.split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, repo] = segments.slice(-2);
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { host: host.toLowerCase(), owner, repo };
}

/**
 * Parse the single line produced by `git log -1 --format="%H%x1f%h%x1f%cI%x1f%s"`.
 * Extra separators inside the subject are tolerated.
 */
export function parseCommitLine(raw) {
  const line = String(raw || '').split(/\r?\n/)[0].trim();
  if (!line) return null;
  const parts = line.split(COMMIT_FIELDS);
  if (parts.length < 4) return null;
  const sha = parts[0].trim().toLowerCase();
  const short = parts[1].trim();
  const committedAt = parts[2].trim();
  const subject = parts.slice(3).join(COMMIT_FIELDS).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(committedAt)) return null;
  return { sha, short, committedAt, subject };
}

/**
 * Given `git ls-remote origin` output, return the sha of the target branch.
 * `branch` may be passed as `refs/heads/main` or plain `main`; `HEAD` is ignored.
 */
export function parseLsRemoteOutput(raw, branch = 'main') {
  const target = normalizeBranch(branch);
  if (target === 'HEAD') return null;
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = trimmed.split(/\t/, 2);
    if (entry.length !== 2) continue;
    const sha = entry[0].trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    if (normalizeBranch(entry[1]) !== target) continue;
    return sha;
  }
  return null;
}

function normalizeBranch(branch) {
  const value = String(branch || '').trim();
  return value.replace(/^refs\/heads\//, '') || 'HEAD';
}

/**
 * Count changed paths from `git status --porcelain` output. Untracked and
 * ignored lines are both real local state, so every non-empty line counts.
 */
export function countDirtyPaths(raw) {
  return String(raw || '').split(/\r?\n/).filter((line) => line.trim() !== '').length;
}

/**
 * True when the remote tip differs from the local commit. Accepts full or
 * abbreviated shas on either side; both must be present.
 */
export function isUpdateAvailable(currentSha, latestSha) {
  const current = String(currentSha || '').trim().toLowerCase();
  const latest = String(latestSha || '').trim().toLowerCase();
  if (!current || !latest) return false;
  // Compare over the shared width so an abbreviated sha of the same commit
  // never reads as an update.
  const width = Math.min(current.length, latest.length);
  if (width < 8) return false;
  return current.slice(0, width) !== latest.slice(0, width);
}

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
]);

/**
 * True when the commit-to-commit change list touches the root package files,
 * meaning the new code depends on packages that may not be installed yet.
 */
export function needsDependencyInstall(changedPaths) {
  return (changedPaths || []).some((entry) =>
    DEPENDENCY_FILES.has(String(entry).replace(/\\/g, '/').replace(/^\.\//, '')),
  );
}
