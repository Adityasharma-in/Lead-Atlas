import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countDirtyPaths,
  createSelfUpdater,
  isUpdateAvailable,
  needsDependencyInstall,
  parseCommitLine,
  parseLsRemoteOutput,
  parseRepository,
} from '../src/selfupdate.js';

const LOCAL_SHA = '1111111111111111111111111111111111111111';
const REMOTE_SHA = '2222222222222222222222222222222222222222';
const BRANCH = 'main';
const ISO = '2026-10-27T10:00:00Z';

function fakeGit({ head = LOCAL_SHA, remote = null, branch = BRANCH, dirty = 0, changed = [] } = {}) {
  const state = {
    head,
    branch,
    dirty,
    changed,
    remoteHead: remote || head,
    stashCalls: 0,
    fetched: false,
    resetted: false,
  };
  const calls = [];
  const reject = (args) => { throw new Error(`unexpected git command: ${args.join(' ')}`); };

  const run = async (args) => {
    calls.push(args.join(' '));
    const [cmd, ...rest] = args;
    if (cmd === 'rev-parse' && rest[0] === '--is-inside-work-tree') return { stdout: 'true\n' };
    if (cmd === 'rev-parse' && rest[0] === '--abbrev-ref') return { stdout: `${state.branch}\n` };
    if (cmd === 'rev-parse' && rest[0] === 'HEAD') return { stdout: `${state.head}\n` };
    if (cmd === 'config') return { stdout: 'https://github.com/Adityasharma-in/Lead-Atlas.git\n' };
    if (cmd === 'log') {
      return { stdout: `${state.head}\x1f${state.head.slice(0, 7)}\x1f${ISO}\x1ffeat: stub commit\n` };
    }
    if (cmd === 'status') return { stdout: state.dirty ? ' M src/server.js\n' : '' };
    if (cmd === 'stash') { state.stashCalls += 1; return { stdout: '' }; }
    if (cmd === 'fetch') { state.fetched = true; return { stdout: '' }; }
    if (cmd === 'reset') { state.head = state.remoteHead; state.resetted = true; return { stdout: '' }; }    if (cmd === 'ls-remote') return { stdout: `${state.remoteHead}\trefs/heads/${state.branch}\n` };
    if (cmd === 'diff') return { stdout: state.changed.length ? `${state.changed.join('\n')}\n` : '' };
    reject(args);
  };

  run.calls = calls;
  run.state = state;
  return run;
}

function fakeFetch({ sha = REMOTE_SHA, fail = false } = {}) {
  const calls = [];
  const run = async () => {
    calls.push('fetch');
    if (fail) {
      const error = new Error('GitHub API responded 403');
      error.status = 403;
      throw error;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        commit: {
          sha,
          commit: {
            message: 'feat: remote tip\n\nBody line',
            committer: { date: '2026-10-27T11:00:00Z' },
          },
        },
      }),
    };
  };
  run.calls = calls;
  return run;
}

const npmCalls = [];
const runNpm = async (args) => { npmCalls.push(args.join(' ')); return { stdout: '' }; };

function buildUpdater(options = {}) {
  npmCalls.length = 0;
  const runGit = options.runGit || fakeGit(options.git);
  const fetchStub = options.fetchImpl || fakeFetch(options.fetch);
  const updater = createSelfUpdater({
    projectRoot: 'C:/repo',
    canRestart: options.canRestart === true,
    runGit,
    runNpm,
    fetchImpl: fetchStub,
    env: options.env || {},
  });
  return { updater, runGit, fetchStub };
}

const SHA = 'b12f47a5c500706277a6e8efee173472068fdb98';
const SHA2 = 'aabbccdd00001111222233334444555566667778';

describe('selfupdate parseRepository', () => {
  const cases = [
    ['https://github.com/Adityasharma-in/Lead-Atlas.git', 'Adityasharma-in', 'Lead-Atlas'],
    ['https://github.com/Adityasharma-in/Lead-Atlas', 'Adityasharma-in', 'Lead-Atlas'],
    ['https://user@github.com/Adityasharma-in/Lead-Atlas.git', 'Adityasharma-in', 'Lead-Atlas'],
    ['git@github.com:Adityasharma-in/Lead-Atlas.git', 'Adityasharma-in', 'Lead-Atlas'],
    ['ssh://git@github.com/Adityasharma-in/Lead-Atlas.git', 'Adityasharma-in', 'Lead-Atlas'],
    ['GITHUB.COM/Adityasharma-in/Lead-Atlas', null, null], // no scheme/scp separator
  ];

  for (const [input, owner, repo] of cases) {
    it(`parses ${input}`, () => {
      const parsed = parseRepository(input);
      if (owner === null) {
        assert.equal(parsed, null);
      } else {
        assert.deepEqual(parsed, {
          host: 'github.com',
          owner,
          repo,
        });
      }
    });
  }

  it('rejects non-GitHub hosts and junk', () => {
    assert.equal(parseRepository('https://gitlab.com/a/b.git'), null);
    assert.equal(parseRepository('https://github.com/only-owner'), null);
    assert.equal(parseRepository('   '), null);
    assert.equal(parseRepository('not a url'), null);
    assert.equal(parseRepository(null), null);
  });
});

describe('selfupdate parseCommitLine', () => {
  it('parses a normal log line', () => {
    const parsed = parseCommitLine(
      `${SHA}\x1fb12f47a\x1f2026-10-27T08:00:00+05:30\x1fInitial commit`,
    );
    assert.deepEqual(parsed, {
      sha: SHA,
      short: 'b12f47a',
      committedAt: '2026-10-27T08:00:00+05:30',
      subject: 'Initial commit',
    });
  });

  it('keeps separators inside the subject', () => {
    const parsed = parseCommitLine(`${SHA}\x1fb12f47a\x1f2026-10-27T08:00:00Z\x1fa\x1fb`);
    assert.equal(parsed?.subject, 'a\x1fb');
  });

  it('rejects malformed lines', () => {
    assert.equal(parseCommitLine(''), null);
    assert.equal(parseCommitLine('deadbeef\x1fshort2001-01-01'), null);
    assert.equal(parseCommitLine(`\x1f\x1f\x1f${SHA}`), null);
    assert.equal(parseCommitLine(`zzz\x1fb12f47a\x1f2026-10-27\x1fsha-not-hex`), null);
  });
});

describe('selfupdate parseLsRemoteOutput', () => {
  const output = [
    `${SHA2}\trefs/heads/dev/scratch`,
    `${SHA}\trefs/heads/main`,
    `${SHA.slice(0, 20)}\trefs/heads/broken`, // invalid sha ignored
    `${999}tooshort\trefs/heads/other`,
  ].join('\n');

  it('finds the plain branch name', () => {
    assert.equal(parseLsRemoteOutput(output, 'main'), SHA);
  });

  it('finds the full ref form', () => {
    assert.equal(parseLsRemoteOutput(output, 'refs/heads/main'), SHA);
  });

  it('returns null when the branch is absent or HEAD is requested', () => {
    assert.equal(parseLsRemoteOutput(output, 'release'), null);
    assert.equal(parseLsRemoteOutput(output, 'HEAD'), null);
    assert.equal(parseLsRemoteOutput('', 'main'), null);
  });
});

describe('selfupdate countDirtyPaths', () => {
  it('counts every non-empty porcelain line', () => {
    assert.equal(countDirtyPaths(` M src/a.js\n?? new.txt\r\n\n`), 2);
    assert.equal(countDirtyPaths(''), 0);
    assert.equal(countDirtyPaths(null), 0);
  });
});

describe('selfupdate isUpdateAvailable', () => {
  it('detects different commits', () => {
    assert.equal(isUpdateAvailable(SHA, SHA2), true);
  });

  it('handles abbreviated shas on either side', () => {
    assert.equal(isUpdateAvailable(SHA, SHA.slice(0, 12)), false);
    assert.equal(isUpdateAvailable(SHA.slice(0, 10), SHA), false);
    assert.equal(isUpdateAvailable(SHA.slice(0, 10), SHA2), true);
  });

  it('never claims an update when either sha is unknown', () => {
    assert.equal(isUpdateAvailable(SHA, ''), false);
    assert.equal(isUpdateAvailable('', SHA), false);
    assert.equal(isUpdateAvailable(null, null), false);
    assert.equal(isUpdateAvailable('short7', SHA2), false);
  });
});

describe('selfupdate needsDependencyInstall', () => {
  it('flags root package files only', () => {
    assert.equal(
      needsDependencyInstall(['src/server.js', 'package.json', 'docs/x.md']),
      true,
    );
    assert.equal(needsDependencyInstall(['package-lock.json']), true);
    assert.equal(needsDependencyInstall(['README.md', 'src/csv.js']), false);
    assert.equal(needsDependencyInstall(['nested/package.json']), false);
    assert.equal(needsDependencyInstall([]), false);
    assert.equal(needsDependencyInstall(null), false);
  });
});

describe('selfupdate status', () => {
  it('reports an available update when the remote tip is newer', async () => {
    const { updater } = buildUpdater({
      git: { head: LOCAL_SHA, remote: REMOTE_SHA, dirty: 1 },
      fetch: { sha: REMOTE_SHA },
    });
    const status = await updater.status();

    assert.equal(status.enabled, true);
    assert.equal(status.updateAvailable, true);
    assert.equal(status.branch, BRANCH);
    assert.deepEqual(status.repository, {
      host: 'github.com',
      owner: 'Adityasharma-in',
      repo: 'Lead-Atlas',
    });
    assert.equal(status.current.sha, LOCAL_SHA);
    assert.equal(status.current.dirtyFiles, 1);
    assert.equal(status.latest.sha, REMOTE_SHA);
    assert.equal(status.latest.via, 'github');
    assert.equal(status.latest.subject, 'feat: remote tip');
    assert.equal(status.checkError, null);
    assert.equal(status.canRestart, false);
  });

  it('reports up to date when both shas match', async () => {
    const { updater } = buildUpdater({ fetch: { sha: LOCAL_SHA } });
    const status = await updater.status();
    assert.equal(status.enabled, true);
    assert.equal(status.updateAvailable, false);
  });

  it('caches the remote tip within the TTL and forces-refresh on demand', async () => {
    const { updater, fetchStub } = buildUpdater({ fetch: { sha: REMOTE_SHA } });

    const first = await updater.status();
    const second = await updater.status();
    const forced = await updater.status({ force: true });

    assert.equal(fetchStub.calls.length, 2); // cached, forced refresh
    assert.equal(first.latest.cached, false);
    assert.equal(second.latest.cached, true);
    assert.equal(second.latest.sha, REMOTE_SHA);
    assert.equal(forced.latest.cached, false);
  });

  it('falls back to git ls-remote when the GitHub API fails', async () => {
    const { updater } = buildUpdater({
      git: { head: LOCAL_SHA, remote: REMOTE_SHA },
      fetch: { fail: true },
    });
    const status = await updater.status();

    assert.equal(status.latest?.sha, REMOTE_SHA);
    assert.equal(status.latest?.via, 'git');
    assert.equal(status.updateAvailable, true);
    // The check itself succeeded (via git), so it must not be reported as an error.
    assert.equal(status.checkError, null);
  });

  it('surfaces the error when neither the API nor git can read the tip', async () => {
    const base = fakeGit();
    const runGit = async (args) => {
      if (args[0] === 'ls-remote') throw new Error('git ls-remote failed');
      return base(args);
    };
    const { updater } = buildUpdater({ runGit, fetch: { fail: true } });
    const status = await updater.status();
    assert.equal(status.latest, null);
    assert.equal(status.updateAvailable, false);
    assert.ok(typeof status.checkError === 'string' && status.checkError.length > 0);
  });

  it('marks the updater disabled outside a git repo', async () => {
    const { updater } = buildUpdater({
      runGit: async () => {
        throw new Error('fatal: not a git repository');
      },
    });
    const status = await updater.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'NOT_A_GIT_REPO');
    assert.match(status.message || '', /not a git clone/i);
  });

  it('stays disabled on a detached HEAD', async () => {
    const { updater } = buildUpdater({
      runGit: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'true\n' };
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'HEAD\n' };
        throw new Error(`unexpected git command: ${args.join(' ')}`);
      },
    });
    const status = await updater.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'DETACHED_HEAD');
    assert.match(status.message || '', /git switch/i);
  });

  it('honours SELF_UPDATE=off', async () => {
    const { updater } = buildUpdater({ env: { SELF_UPDATE: 'off' } });
    const status = await updater.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'SELF_UPDATE_DISABLED');
  });
});

describe('selfupdate apply', () => {
  it('stashes, resets, installs dependencies and reports the new build', async () => {
    const { updater, runGit } = buildUpdater({
      git: {
        head: LOCAL_SHA,
        remote: REMOTE_SHA,
        dirty: 1,
        changed: ['public/app.js', 'package.json'],
      },
      fetch: { sha: REMOTE_SHA },
    });

    const result = await updater.apply();

    assert.equal(result.beforeSha, LOCAL_SHA);
    assert.equal(result.afterSha, REMOTE_SHA);
    assert.equal(result.short, REMOTE_SHA.slice(0, 7));
    assert.equal(result.stashCreated, true);
    assert.equal(result.npmInstalled, true);
    assert.equal(runGit.state.fetched, true);
    assert.equal(runGit.state.resetted, true);
    assert.equal(runGit.state.stashCalls, 1);
    assert.deepEqual(npmCalls, ['install --no-audit --no-fund']);
    assert.match(result.notes.join(' '), /stash/i);
  });

  it('does not stash a clean working tree', async () => {
    const { updater, runGit } = buildUpdater({
      git: { head: LOCAL_SHA, remote: REMOTE_SHA, dirty: 0 },
      fetch: { sha: REMOTE_SHA },
    });
    const result = await updater.apply();
    assert.equal(result.stashCreated, false);
    assert.equal(runGit.state.stashCalls, 0);
    assert.equal(result.afterSha, REMOTE_SHA);
  });

  it('skips npm when the update touches no package files', async () => {
    const { updater } = buildUpdater({
      git: { head: LOCAL_SHA, remote: REMOTE_SHA, dirty: 0, changed: ['README.md'] },
      fetch: { sha: REMOTE_SHA },
    });
    const result = await updater.apply();
    assert.equal(result.npmInstalled, false);
    assert.deepEqual(npmCalls, []);
  });

  it('refuses to run when the local build is already current', async () => {
    const { updater, runGit } = buildUpdater({ fetch: { sha: LOCAL_SHA } });
    await assert.rejects(updater.apply(), (error) => {
      assert.equal(error.code, 'UP_TO_DATE');
      assert.equal(error.status, 409);
      return true;
    });
    assert.equal(runGit.state.resetted, false);
  });

  it('aborts safely when the pre-update stash fails', async () => {
    const base = fakeGit({ head: LOCAL_SHA, remote: REMOTE_SHA, dirty: 1 });
    const runGit = async (args) => {
      if (args[0] === 'stash') {
        const error = new Error('cannot stash');
        error.stderr = 'cannot stash';
        throw error;
      }
      return base(args);
    };
    const { updater } = buildUpdater({ runGit, fetch: { sha: REMOTE_SHA } });
    await assert.rejects(updater.apply(), (error) => error.code === 'STASH_FAILED');
    assert.equal(base.state.resetted, false);
  });

  it('reports the disabled reason when applied outside a git repo', async () => {
    const { updater } = buildUpdater({
      runGit: async () => {
        throw new Error('fatal: not a git repository');
      },
    });
    await assert.rejects(updater.apply(), (error) => error.code === 'NOT_A_GIT_REPO');
  });
});

describe('selfupdate restart scheduling', () => {
  it('never schedules a restart for library consumers', () => {
    const { updater } = buildUpdater({});
    assert.equal(updater.scheduleRestart(), null);
  });

  it('marks canRestart when the host allows it', async () => {
    const { updater } = buildUpdater({ canRestart: true, fetch: { sha: LOCAL_SHA } });
    const status = await updater.status();
    assert.equal(status.canRestart, true);
    assert.equal(status.updateAvailable, false);
  });
});
