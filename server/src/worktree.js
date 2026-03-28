/**
 * Shared parser for `git worktree list --porcelain` output.
 */
export function parseWorktreeList(rawOutput) {
  const worktrees = [];
  if (typeof rawOutput !== 'string' || !rawOutput.trim()) return worktrees;

  const blocks = rawOutput.trim().split('\n\n');
  for (const block of blocks) {
    const entry = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length).trim();
      if (line.startsWith('branch ')) entry.branchRef = line.slice('branch '.length).trim();
    }
    if (entry.path) worktrees.push(entry);
  }
  return worktrees;
}
