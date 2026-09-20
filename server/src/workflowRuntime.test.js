import { afterEach, describe, expect, test } from 'vitest';

import { createRuntimeHarness } from '../test-utils.js';

let harness;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe('workflow task migration boundary', () => {
  test('new tasks snapshot the default workflow while pre-existing tasks remain legacy', async () => {
    harness = createRuntimeHarness();
    const store = (await harness.importModule('./src/store.js')).default;
    const legacy = store.addTask({ title: 'Already running' });
    const runtime = await harness.importModule('./src/workflowRuntime.js');

    const workflowTask = runtime.createWorkflowTask({ title: 'New workflow task', repoPath: '/repo' });
    const run = runtime.getWorkflowRun(workflowTask.id);

    expect(legacy.executionMode).toBe('legacy');
    expect(workflowTask).toMatchObject({
      executionMode: 'workflow',
      workflowId: 'standard-development',
      workflowVersion: 1,
      currentPhase: 'Intake',
    });
    expect(run.workflowSnapshot.nodes.length).toBeGreaterThan(0);
    expect(run.activeNodes).toEqual(['interview']);
    runtime.resetWorkflowRuntimeForTests();
  });
});
