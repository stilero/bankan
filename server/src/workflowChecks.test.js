import { describe, expect, test, vi } from 'vitest';

import { runWorkflowCheck } from './workflowChecks.js';

describe('workflow Check adapters', () => {
  test('runs a named adapter in the task workspace and returns concise structured failure details', async () => {
    const runner = vi.fn(async () => ({ exitCode: 1, stdout: '2 passing', stderr: 'Assertion failed\nlong trace' }));

    const result = await runWorkflowCheck(
      { workspacePath: '/work/task' },
      { config: { adapter: 'test' } },
      { runner }
    );

    expect(runner).toHaveBeenCalledWith('npm', ['test'], { cwd: '/work/task', timeoutMs: 30 * 60 * 1000 });
    expect(result).toEqual({ passed: false, exitCode: 1, summary: 'Assertion failed\nlong trace' });
  });
});
