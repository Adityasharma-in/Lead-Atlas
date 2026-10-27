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

import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { ApiError } from './errors.js';

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

/* ------------------------------------------------------------------ */
/* Side-effect layer: git + GitHub runners (all injectable).           */
/* ------------------------------------------------------------------ */

const execFileP = promisify(execFile);

const COMMIT_FORMAT = '%H%x1f%h%x1f%cI%x1f%s';
const CHECK_TTL_MS = 60_000;
const GIT_TIMEOUT_MS = 30_000;
const REMOTE_TIMEOUT_MS = 15_000;
const NPM_TIMEOUT_MS = 300_000;
const RESTART_EXIT_DELAY_MS = 1_200;

export const UPDATE_TTL_MS = CHECK_TTL_MS;

function defaultRunGit(projectRoot) {
  return async (args) =>
    execFileP('git', args, {
      cwd: projectRoot,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
}

async function defaultRunNpm(args, cwd) {
  // Node refuses to spawn npm.cmd without a shell, so Windows goes via cmd.
  if (process.platform === 'win32') {
    return execFileP('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], {
      cwd,
      timeout: NPM_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  }
  return execFileP('npm', args, {
    cwd,
    timeout: NPM_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function updateError(status, code, message, details = null) {
  return new ApiError(status, code, message, details);
}

/**
 * Build the self-update controller.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot]  Folder the app runs from (git repo root).
 * @param {boolean} [options.canRestart]  True only for the standalone server process.
 * @param {(args: string[]) => Promise<{stdout: string}>} [options.runGit]   Injectable git runner.
 * @param {(args: string[], cwd: string) => Promise<{stdout: string}>} [options.runNpm]
 * @param {typeof fetch} [options.fetchImpl] Injectable fetch for the GitHub API.
 * @param {NodeJS.ProcessEnv} [options.env] Injectable environment for feature flags.
 */
export function createSelfUpdater(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const canRestart = options.canRestart === true;
  const runGit = options.runGit || defaultRunGit(projectRoot);
  const runNpm = options.runNpm || defaultRunNpm;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || process.env;

  // Cache of the last known remote tip; refreshed at most every CHECK_TTL_MS.
  let remoteTip = null;
  let lastCheckedAt = null;
  let checking = null;
  let applying = false;

  const updateDisabled = () =>
    ['off', '0', 'false'].includes(String(env.SELF_UPDATE || '').toLowerCase());

  async function localContext() {
    let repository;
    try {
      const inside = (await runGit(['rev-parse', '--is-inside-work-tree']))?.stdout;
      if (String(inside).trim() !== 'true') {
        return { enabled: false, reason: 'NOT_A_GIT_REPO' };
      }
    } catch {
      return { enabled: false, reason: 'NOT_A_GIT_REPO' };
    }

    try {
      const branch = String((await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout).trim();
      if (!branch || branch === 'HEAD') {
        return { enabled: false, reason: 'DETACHED_HEAD' };
      }

      const remoteUrl = String((await runGit(['config', '--get', 'remote.origin.url'])).stdout).trim();
      repository = parseRepository(remoteUrl);
      if (!repository) {
        return { enabled: false, reason: 'UNSUPPORTED_REMOTE' };
      }

      const commit = parseCommitLine(
        (await runGit(['log', '-1', `--format=${COMMIT_FORMAT}`]))?.stdout,
      );
      if (!commit) {
        return { enabled: false, reason: 'UNKNOWN_LOCAL_VERSION' };
      }

      const dirtyFiles = countDirtyPaths((await runGit(['status', '--porcelain']))?.stdout);
      return {
        enabled: true,
        repository,
        branch,
        commit,
        dirtyFiles,
      };
    } catch (error) {
      console.error('[update] Could not read local git state:', error?.message || error);
      return { enabled: false, reason: 'LOCAL_CHECK_FAILED' };
    }
  }

  async function remoteVersion(repository, branch, { force }) {
    if (
      !force &&
      remoteTip &&
      lastCheckedAt &&
      Date.now() - lastCheckedAt < CHECK_TTL_MS
    ) {
      return { ...remoteTip, cached: true };
    }
    if (checking) return checking;

    checking = fetchRemoteTip(repository, branch)
      .then((tip) => {
        remoteTip = tip;
        lastCheckedAt = Date.now();
        return { ...tip, cached: false };
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  async function fetchRemoteTip(repository, branch) {
    const url = `https://api.github.com/repos/${repository.owner}/${repository.repo}/branches/${encodeURIComponent(branch)}`;
    const headers = {
      'User-Agent': 'lead-atlas-selfupdate',
      Accept: 'application/vnd.github+json',
    };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

    let apiError = null;
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
      });
      if (!response.ok) {
        apiError = new Error(`GitHub API responded ${response.status}`);
        apiError.status = response.status;
      } else {
        const payload = await response.json();
        const commitInfo = payload?.commit;
        const sha = String(commitInfo?.sha || '').toLowerCase();
        if (/^[0-9a-f]{40}$/.test(sha)) {
          return {
            sha,
            short: sha.slice(0, 7),
            subject: firstCommitSubject(commitInfo?.commit?.message),
            committedAt:
              commitInfo?.commit?.committer?.date || commitInfo?.commit?.author?.date || null,
            via: 'github',
          };
        }
        apiError = new Error('GitHub API returned an unexpected branch payload');
      }
    } catch (error) {
      apiError = error;
    }

    // GitHub API unavailable or unexpected: fall back to plain git.
    const remote = (await runGit(['ls-remote', 'origin', branch]))?.stdout || '';
    const sha = parseLsRemoteOutput(remote, branch);
    if (sha) {
      return { sha, short: sha.slice(0, 7), subject: null, committedAt: null, via: 'git' };
    }
    throw apiError || new Error('Could not read the latest commit from the repository.');
  }

  function firstCommitSubject(message) {
    const line = String(message || '').split(/\r?\n/)[0];
    return line ? line.slice(0, 200) : null;
  }

  async function status({ force = false } = {}) {
    const shared = {
      canRestart,
      latest: null,
      updateAvailable: false,
      lastCheckedAt,
      checkError: null,
    };

    if (updateDisabled()) {
      return {
        ...shared,
        enabled: false,
        reason: 'SELF_UPDATE_DISABLED',
        message: describeDisabledReason('SELF_UPDATE_DISABLED'),
      };
    }

    const context = await localContext();

    if (!context.enabled) {
      return {
        ...shared,
        enabled: false,
        reason: context.reason,
        message: describeDisabledReason(context.reason),
      };
    }

    let latest = null;
    let checkError = null;
    try {
      latest = await remoteVersion(context.repository, context.branch, { force });
    } catch (error) {
      checkError = friendlyRemoteError(error);
      console.warn('[update] Update check failed:', checkError);
    }

    return {
      ...shared,
      enabled: true,
      reason: null,
      repository: context.repository,
      branch: context.branch,
      current: { ...context.commit, dirtyFiles: context.dirtyFiles },
      latest,
      updateAvailable: Boolean(latest?.sha) && isUpdateAvailable(context.commit.sha, latest.sha),
      lastCheckedAt: lastCheckedAt || null,
      checkError,
    };
  }

  function friendlyRemoteError(error) {
    if (error?.name === 'AbortError' || /aborted|ETIMEDOUT|ENOTFOUND/i.test(error?.message || '')) {
      return 'GitHub could not be reached in time. The check will retry automatically.';
    }
    if (error?.status === 403 || error?.status === 429) {
      return 'GitHub rate limit reached for the update check. It will retry automatically.';
    }
    return error?.message || 'The update check failed. It will retry automatically.';
  }

  async function apply() {
    if (applying) {
      throw updateError(409, 'UPDATE_IN_PROGRESS', 'Another update is already running. Try again in a moment.');
    }
    applying = true;
    try {
      const context = await localContext();
      if (!context.enabled) {
        throw updateError(409, context.reason, describeDisabledReason(context.reason));
      }

      const fresh = await status({ force: true });
      if (!fresh.updateAvailable || !fresh.latest?.sha) {
        throw updateError(
          409,
          'UP_TO_DATE',
          'The local build is already at the newest commit on GitHub.',
        );
      }

      const beforeSha = fresh.current.sha;
      const notes = [];
      let stashCreated = false;

      if (fresh.current.dirtyFiles > 0) {
        try {
          await runGit([
            'stash',
            'push',
            '-m',
            `Lead Atlas pre-update snapshot ${new Date().toISOString()}`,
          ]);
          stashCreated = true;
          notes.push(
            'Uncommitted local changes were kept in a git stash. Recover them with: git stash list',
          );
        } catch (error) {
          console.error('[update] Stash before update failed:', error);
          throw updateError(
            500,
            'STASH_FAILED',
            'Local changes could not be stashed before updating, so nothing was changed. Inspect the folder with git status and commit or resolve the edits first.',
            { stderr: stderrOf(error) },
          );
        }
      }

      try {
        await runGit(['fetch', 'origin', context.branch]);
        await runGit(['reset', '--hard', `origin/${context.branch}`]);
      } catch (error) {
        console.error('[update] git fetch/reset failed:', error);
        throw updateError(
          502,
          'FETCH_FAILED',
          'The update could download no new code from GitHub. Your local build is unchanged — try again later.',
          { stderr: stderrOf(error) },
        );
      }

      const afterCommit = parseCommitLine(
        (await runGit(['log', '-1', `--format=${COMMIT_FORMAT}`]))?.stdout,
      );
      const afterSha = afterCommit?.sha || String((await runGit(['rev-parse', 'HEAD']))?.stdout).trim();
      if (!/^[0-9a-f]{40}$/.test(afterSha)) {
        throw updateError(500, 'UNKNOWN_LOCAL_VERSION', 'The repository is in an unexpected state after the update; check the terminal.');
      }

      const diff = (await runGit(['diff', '--name-only', beforeSha, afterSha]))?.stdout || '';
      const changedPaths = diff.split(/\r?\n/).filter(Boolean);

      let npmInstalled = false;
      if (needsDependencyInstall(changedPaths)) {
        try {
          await runNpm(['install', '--no-audit', '--no-fund'], projectRoot);
          npmInstalled = true;
        } catch (error) {
          console.error('[update] npm install failed:', error);
          notes.push(
            'npm install could not finish automatically. Run it manually, then restart the server if anything misbehaves.',
          );
        }
      }

      return {
        beforeSha,
        afterSha,
        short: afterSha.slice(0, 7),
        branch: context.branch,
        repository: context.repository,
        stashCreated,
        npmInstalled,
        notes,
      };
    } finally {
      applying = false;
    }
  }

  function describeDisabledReason(reason) {
    switch (reason) {
      case 'SELF_UPDATE_DISABLED':
        return 'Self-update is turned off (SELF_UPDATE=off). Update this folder with git manually.';
      case 'DETACHED_HEAD':
        return 'The repository is on a detached commit, not a branch. Run: git switch main';
      case 'UNSUPPORTED_REMOTE':
        return 'This folder is not connected to a GitHub repository, so self-update is unavailable.';
      case 'NOT_A_GIT_REPO':
        return 'This copy of Lead Atlas is not a git clone. Run: git clone https://github.com/Adityasharma-in/Lead-Atlas.git';
      default:
        return 'The local repository state could not be read. Run the update from a terminal instead.';
    }
  }

  function stderrOf(error) {
    const raw = error?.stderr || error?.message || '';
    return String(raw).slice(0, 500);
  }

  function scheduleRestart() {
    if (!canRestart) return null;
    const entry = process.argv?.[1] ? path.resolve(process.argv[1]) : null;
    if (!entry) {
      console.warn('[update] Cannot locate the server entry point for a restart.');
      return null;
    }

    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, LA_UPDATE_CHILD: '1' },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
      cwd: projectRoot,
    });
    child.unref();
    console.log(`[update] Spawning the updated server (pid ${child.pid})…`);

    // Give the HTTP response time to flush, then let the child take the port.
    const exitTimer = setTimeout(() => process.exit(0), RESTART_EXIT_DELAY_MS);
    exitTimer.unref();
    return { pid: child.pid, exitDelayMs: RESTART_EXIT_DELAY_MS };
  }

  return { status, apply, scheduleRestart, describeDisabledReason, isDisabled: updateDisabled };
}
