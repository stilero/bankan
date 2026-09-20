import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { WorkflowEngine } from './workflowEngine.js';
import { WorkflowRepository } from './workflowRepository.js';

const directories = [];

function setup(definition) {
  const directory = mkdtempSync(join(tmpdir(), 'bankan-engine-'));
  directories.push(directory);
  const repository = new WorkflowRepository({ databasePath: join(directory, 'workflow.sqlite') });
  const draft = repository.createDraft({ name: 'Engine Test' });
  repository.updateDraft(draft.id, definition);
  repository.publish(draft.id);
  const run = repository.createTaskExecution({ taskId: 'T-ENGINE', workflowId: draft.id, workflowVersion: 1 });
  return { repository, engine: new WorkflowEngine(repository), run };
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop(), { recursive: true, force: true });
});

describe('deterministic workflow engine', () => {
  test('moves Kanban phase only when a Phase node executes and waits at executable nodes', () => {
    const { repository, engine, run } = setup({
      schemaVersion: 1,
      nodes: [
        { id: 'intake', type: 'Phase', config: { phase: 'Intake' } },
        { id: 'planning', type: 'Phase', config: { phase: 'Planning' } },
        { id: 'plan', type: 'Agent', config: { provider: 'codex', model: '', effort: 'medium', accessMode: 'read', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [
        { id: 'a', source: 'intake', target: 'planning', outcome: 'success' },
        { id: 'b', source: 'planning', target: 'plan', outcome: 'success' },
        { id: 'c', source: 'plan', target: 'done', outcome: 'success' },
      ],
    });

    const waiting = engine.start(run.id);
    expect(waiting.phase).toBe('Planning');
    expect(waiting.status).toBe('running');
    expect(waiting.activeNodes).toEqual(['plan']);

    const completed = engine.completeNode(run.id, 'plan', { outcome: 'success', artifacts: [{ type: 'plan', data: { summary: 'Ready' } }] });
    expect(completed.status).toBe('succeeded');
    expect(repository.listArtifacts(run.id)[0].data.summary).toBe('Ready');
    repository.close();
  });

  test('enforces bounded cycles and follows the exhaustion edge', () => {
    const { repository, engine, run } = setup({
      schemaVersion: 1,
      nodes: [
        { id: 'review', type: 'Approval', config: { outcomes: ['reject', 'approve'], timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'failed', type: 'Terminal', config: { outcome: 'Failure' } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [
        { id: 'again', source: 'review', target: 'review', outcome: 'reject', loop: { maxIterations: 2, exhaustionTarget: 'failed' } },
        { id: 'approved', source: 'review', target: 'done', outcome: 'approve' },
      ],
    });

    engine.start(run.id);
    engine.completeNode(run.id, 'review', { outcome: 'reject' });
    engine.completeNode(run.id, 'review', { outcome: 'reject' });
    const exhausted = engine.completeNode(run.id, 'review', { outcome: 'reject' });

    expect(exhausted.status).toBe('failed');
    expect(exhausted.loopCounters.again).toBe(3);
    repository.close();
  });

  test('guards skip and preserves branch state across pause and resume', () => {
    const { repository, engine, run } = setup({
      schemaVersion: 1,
      nodes: [
        { id: 'action', type: 'Action', config: { action: 'tests', skippable: true, substituteArtifact: 'test-waiver', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [{ id: 'done-edge', source: 'action', target: 'done', outcome: 'skipped' }],
    });

    engine.start(run.id);
    expect(engine.pause(run.id).activeNodes).toEqual(['action']);
    expect(engine.resume(run.id).activeNodes).toEqual(['action']);
    const completed = engine.skipNode(run.id, 'action', { reason: 'Covered externally' });

    expect(completed.status).toBe('succeeded');
    expect(repository.listArtifacts(run.id)[0]).toMatchObject({
      nodeId: 'action',
      type: 'test-waiver',
      data: { reason: 'Covered externally' },
    });
    repository.close();
  });
});
