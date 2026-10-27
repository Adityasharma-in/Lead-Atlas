import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countDirtyPaths,
  isUpdateAvailable,
  needsDependencyInstall,
  parseCommitLine,
  parseLsRemoteOutput,
  parseRepository,
} from '../src/selfupdate.js';

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
