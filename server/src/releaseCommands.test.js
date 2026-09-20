import { describe, expect, test, vi } from 'vitest';

import { prepareRelease, publishRelease } from '../../scripts/release.js';

function createRunner(overrides = {}) {
  const calls = [];
  const outputs = new Map([
    ['git status --porcelain', ''],
    ['git branch --show-current', 'main'],
    ['git rev-parse HEAD', 'abc123'],
    ['git rev-parse origin/main', 'abc123'],
    ['git ls-remote --tags origin refs/tags/v1.3.0', ''],
    ['npm view @stilero/bankan versions --json', '["1.2.0","1.2.1"]'],
    ['gh pr create --base main --head release/v1.3.0 --title Bump version to 1.3.0 --body Automated release preparation for v1.3.0. All release verification commands passed locally.', 'https://github.com/stilero/bankan/pull/70'],
    ['gh release create v1.3.0 --target abc123 --title v1.3.0 --generate-notes', 'https://github.com/stilero/bankan/releases/tag/v1.3.0'],
  ]);
  for (const [key, value] of Object.entries(overrides)) outputs.set(key, value);

  return {
    calls,
    run(command, args = []) {
      const key = [command, ...args].join(' ');
      calls.push(key);
      return outputs.get(key) ?? '';
    },
  };
}

describe('release commands', () => {
  test('prepares a verified minor-version pull request from synchronized main', () => {
    const runner = createRunner();
    const result = prepareRelease('minor', {
      runner,
      currentVersion: '1.2.1',
      log: vi.fn(),
    });

    expect(result).toEqual({
      version: '1.3.0',
      branch: 'release/v1.3.0',
      pullRequestUrl: 'https://github.com/stilero/bankan/pull/70',
    });
    expect(runner.calls).toContain('npm version 1.3.0 --no-git-tag-version');
    expect(runner.calls).toContain('npm run coverage');
    expect(runner.calls).toContain('npm pack --dry-run');
    expect(runner.calls.at(-1)).toContain('gh pr create');
  });

  test('refuses to prepare a release from a dirty or stale checkout', () => {
    const dirtyRunner = createRunner({ 'git status --porcelain': ' M package.json' });
    expect(() => prepareRelease('patch', {
      runner: dirtyRunner,
      currentVersion: '1.2.1',
      log: vi.fn(),
    })).toThrow(/working tree must be clean/i);
    expect(dirtyRunner.calls).toEqual(['git status --porcelain']);

    const staleRunner = createRunner({ 'git rev-parse origin/main': 'def456' });
    expect(() => prepareRelease('patch', {
      runner: staleRunner,
      currentVersion: '1.2.1',
      log: vi.fn(),
    })).toThrow(/not synchronized/i);
    expect(staleRunner.calls).not.toContain('npm version 1.2.2 --no-git-tag-version');
  });

  test('publishes the merged version only when its npm version and tag are new', () => {
    const runner = createRunner();
    const result = publishRelease({
      runner,
      currentVersion: '1.3.0',
      packageName: '@stilero/bankan',
      log: vi.fn(),
    });

    expect(result).toEqual({
      version: '1.3.0',
      releaseUrl: 'https://github.com/stilero/bankan/releases/tag/v1.3.0',
    });
    expect(runner.calls.at(-1)).toBe('gh release create v1.3.0 --target abc123 --title v1.3.0 --generate-notes');

    const publishedRunner = createRunner({
      'npm view @stilero/bankan versions --json': '["1.2.1","1.3.0"]',
    });
    expect(() => publishRelease({
      runner: publishedRunner,
      currentVersion: '1.3.0',
      packageName: '@stilero/bankan',
      log: vi.fn(),
    })).toThrow(/already published/i);
  });
});
