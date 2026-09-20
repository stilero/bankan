import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { WorkflowEngine } from './workflowEngine.js';
import { WorkflowRepository } from './workflowRepository.js';

const directories = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop(), { recursive: true, force: true });
});

describe('Standard Development end-to-end', () => {
  test('survives restart through check and review feedback before successful delivery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bankan-workflow-e2e-'));
    directories.push(directory);
    const databasePath = join(directory, 'workflow.sqlite');
    let repository = new WorkflowRepository({ databasePath });
    let engine = new WorkflowEngine(repository);
    const run = repository.createTaskExecution({ taskId: 'T-E2E' });
    const fakeProvider = (nodeId, outcome, type, data) => engine.completeNode(run.id, nodeId, {
      outcome,
      artifacts: type ? [{ type, data }] : [],
    });

    engine.start(run.id);
    fakeProvider('interview', 'success', 'interview-answers', { goal: 'Ship safely' });
    fakeProvider('planner', 'success', 'plan', { summary: 'Plan' });
    fakeProvider('approval', 'approve', 'human-feedback', { outcome: 'approve', feedback: '' });
    fakeProvider('implementer', 'success', 'implementation', { revision: 1 });
    fakeProvider('run-checks', 'fail', 'check-result', { passed: false, summary: 'One test failed' });

    expect(repository.getExecution(run.id).activeNodes).toEqual(['implementer']);
    expect(repository.listNodeRuns(run.id).find(nodeRun => nodeRun.nodeId === 'implementer' && nodeRun.attempt === 2).input)
      .toMatchObject({ feedback: { type: 'check-result', data: { passed: false, summary: 'One test failed' } } });
    repository.close();

    repository = new WorkflowRepository({ databasePath });
    engine = new WorkflowEngine(repository);
    fakeProvider('implementer', 'success', 'implementation', { revision: 2 });
    fakeProvider('run-checks', 'pass', 'check-result', { passed: true, summary: 'All tests passed' });
    expect(repository.getExecution(run.id).activeNodes.sort()).toEqual(['general-review', 'security-review']);

    fakeProvider('general-review', 'changes', 'review-feedback', { summary: 'Clarify rollback' });
    expect(repository.getExecution(run.id).activeNodes).toEqual(['implementer']);
    fakeProvider('implementer', 'success', 'implementation', { revision: 3 });
    fakeProvider('run-checks', 'pass', 'check-result', { passed: true, summary: 'All tests passed' });
    fakeProvider('general-review', 'pass', 'review-feedback', { summary: 'Approved' });
    fakeProvider('security-review', 'pass', 'review-feedback', { summary: 'Secure' });
    fakeProvider('delivery', 'success', 'delivery', { pullRequest: 42 });

    const completed = repository.getExecution(run.id);
    expect(completed.status).toBe('succeeded');
    expect(completed.workflowSnapshot.schemaVersion).toBe(2);
    expect(completed.loopCounters).toMatchObject({ 'checks-failed': 1, 'general-changes': 1 });
    expect(repository.listAuditEvents(run.id).map(event => event.type)).toEqual(expect.arrayContaining(['loop.returned', 'execution.completed']));
    expect(repository.listArtifacts(run.id).map(artifact => artifact.type)).toEqual(expect.arrayContaining(['plan', 'check-result', 'review-feedback', 'delivery']));
    repository.close();
  });
});
