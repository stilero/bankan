import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('linting integration', () => {
  test('exposes a working root lint command', () => {
    expect(() => execFileSync('npm', ['run', 'lint'], {
      cwd: repoRoot,
      stdio: 'pipe',
    })).not.toThrow();
  });

  test('checks in Claude project hooks for lint enforcement', () => {
    const settingsPath = resolve(repoRoot, '.claude', 'settings.json');

    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const postToolUseHooks = settings.hooks?.PostToolUse || [];
    const taskCompletedHooks = settings.hooks?.TaskCompleted || [];

    expect(postToolUseHooks).toHaveLength(1);
    expect(postToolUseHooks[0].matcher).toBe('Edit|Write|MultiEdit');
    expect(postToolUseHooks[0].hooks[0].type).toBe('command');
    expect(postToolUseHooks[0].hooks[0].command).toContain('.claude/hooks/run-lint-on-edit.sh');
    expect(postToolUseHooks[0].hooks[0].timeout).toBe(60);

    expect(taskCompletedHooks).toHaveLength(1);
    expect(taskCompletedHooks[0].hooks[0].type).toBe('command');
    expect(taskCompletedHooks[0].hooks[0].command).toContain('.claude/hooks/run-lint-on-task-complete.sh');
    expect(taskCompletedHooks[0].hooks[0].timeout).toBe(300);
  });
});
