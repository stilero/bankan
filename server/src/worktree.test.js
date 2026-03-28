import { describe, test, expect } from 'vitest';
import { parseWorktreeList } from './worktree.js';

describe('parseWorktreeList', () => {
  test('parses standard porcelain output with paths and branches', () => {
    const output = [
      'worktree /repo/main',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /tmp/workspaces/T-101',
      'HEAD def456',
      'branch refs/heads/feature/task-101',
      '',
    ].join('\n');

    const result = parseWorktreeList(output);
    expect(result).toEqual([
      { path: '/repo/main', branchRef: 'refs/heads/main' },
      { path: '/tmp/workspaces/T-101', branchRef: 'refs/heads/feature/task-101' },
    ]);
  });

  test('handles detached HEAD entries (no branch line)', () => {
    const output = [
      'worktree /tmp/workspaces/T-200',
      'HEAD abc123',
      'detached',
      '',
    ].join('\n');

    const result = parseWorktreeList(output);
    expect(result).toEqual([{ path: '/tmp/workspaces/T-200' }]);
    expect(result[0].branchRef).toBeUndefined();
  });

  test('handles bare worktree entries', () => {
    const output = [
      'worktree /repo/bare.git',
      'bare',
      '',
    ].join('\n');

    const result = parseWorktreeList(output);
    expect(result).toEqual([{ path: '/repo/bare.git' }]);
  });

  test('returns empty array for empty string', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });

  test('returns empty array for null/undefined input', () => {
    expect(parseWorktreeList(null)).toEqual([]);
    expect(parseWorktreeList(undefined)).toEqual([]);
  });

  test('returns empty array for whitespace-only input', () => {
    expect(parseWorktreeList('   \n  \n  ')).toEqual([]);
  });

  test('handles output without trailing newline', () => {
    const output = 'worktree /repo/main\nbranch refs/heads/main';

    const result = parseWorktreeList(output);
    expect(result).toEqual([{ path: '/repo/main', branchRef: 'refs/heads/main' }]);
  });
});
