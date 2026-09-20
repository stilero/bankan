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

  test('delivers the configured feedback Artifact on loop re-entry and exposes exhaustion as a Human Decision', () => {
    const { repository, engine, run } = setup({
      schemaVersion: 2,
      defaults: { provider: 'codex', model: '', effort: 'medium', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } },
      nodes: [
        { id: 'implement', type: 'Approval', config: { outcomes: ['done'], timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'review', type: 'Approval', config: { outcomes: ['changes'], produces: ['review-feedback'], timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'decision', type: 'HumanDecision', config: { label: 'Review loop exhausted', outcomes: ['accept', 'extend', 'cancel'], timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [
        { id: 'to-review', source: 'implement', target: 'review', outcome: 'done' },
        { id: 'changes', source: 'review', target: 'implement', outcome: 'changes', loop: { maxIterations: 1, feedbackArtifact: 'review-feedback', exhaustionTarget: 'decision' } },
        { id: 'accepted', source: 'decision', target: 'done', outcome: 'accept' },
      ],
    });

    engine.start(run.id);
    engine.completeNode(run.id, 'implement', { outcome: 'done' });
    engine.completeNode(run.id, 'review', { outcome: 'changes', artifacts: [{ type: 'review-feedback', data: { summary: 'Add a test' } }] });

    expect(repository.listNodeRuns(run.id).find(nodeRun => nodeRun.nodeId === 'implement' && nodeRun.attempt === 2).input)
      .toMatchObject({ feedback: { type: 'review-feedback', data: { summary: 'Add a test' } }, loop: { edgeId: 'changes', iteration: 1, limit: 1 } });

    engine.completeNode(run.id, 'implement', { outcome: 'done' });
    const exhausted = engine.completeNode(run.id, 'review', { outcome: 'changes', artifacts: [{ type: 'review-feedback', data: { summary: 'Still failing' } }] });
    expect(exhausted.activeNodes).toEqual(['decision']);
    expect(repository.listNodeRuns(run.id).find(nodeRun => nodeRun.nodeId === 'decision').input)
      .toMatchObject({ exhaustion: { edgeId: 'changes', iteration: 2, limit: 1 } });
    repository.close();
  });

  test('fails visibly when a node returns an outcome with no route', () => {
    const { repository, engine, run } = setup({
      schemaVersion: 1,
      nodes: [
        { id: 'agent', type: 'Agent', config: { provider: 'codex', model: '', effort: 'medium', accessMode: 'read', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [{ id: 'success', source: 'agent', target: 'done', outcome: 'success' }],
    });

    engine.start(run.id);
    const failed = engine.completeNode(run.id, 'agent', { outcome: 'failure' });

    expect(failed.status).toBe('failed');
    expect(failed.activeNodes).toEqual([]);
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

  test('supports node pause, resume, retry budgets, and cancellation', () => {
    const { repository, engine, run } = setup({
      schemaVersion: 1,
      nodes: [
        { id: 'agent', type: 'Agent', config: { provider: 'codex', model: '', effort: 'medium', accessMode: 'read', timeoutMs: 1000, retry: { maxAttempts: 2, backoffMs: 0 } } },
        { id: 'cancelled', type: 'Terminal', config: { outcome: 'Cancelled' } },
      ],
      edges: [{ id: 'cancel', source: 'agent', target: 'cancelled', outcome: 'cancelled' }],
    });

    engine.start(run.id);
    expect(engine.pauseNode(run.id, 'agent').activeNodes).toContain('agent');
    expect(engine.resumeNode(run.id, 'agent').activeNodes).toContain('agent');
    expect(engine.retryNode(run.id, 'agent').activeNodes).toContain('agent');
    expect(() => engine.retryNode(run.id, 'agent')).toThrow('Retry budget exhausted');
    expect(engine.cancelNode(run.id, 'agent').status).toBe('cancelled');
    repository.close();
  });

  test('evaluates conditions and waits for all fork branches at a join', () => {
    const executable = { timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } };
    const { repository, engine, run } = setup({
      schemaVersion: 1,
      nodes: [
        { id: 'condition', type: 'Condition', config: { rules: [{ field: 'choice.value', operator: 'equals', value: 'parallel', outcome: 'parallel' }] } },
        { id: 'fork', type: 'Fork', config: {} },
        { id: 'left', type: 'Approval', config: { ...executable, outcomes: ['success'] } },
        { id: 'right', type: 'Approval', config: { ...executable, outcomes: ['success'] } },
        { id: 'join', type: 'Join', config: { policy: 'all' } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
        { id: 'failed', type: 'Terminal', config: { outcome: 'Failure' } },
      ],
      edges: [
        { id: 'parallel', source: 'condition', target: 'fork', outcome: 'parallel' },
        { id: 'fallback', source: 'condition', target: 'failed', fallback: true },
        { id: 'fork-left', source: 'fork', target: 'left', outcome: 'success' },
        { id: 'fork-right', source: 'fork', target: 'right', outcome: 'success' },
        { id: 'left-join', source: 'left', target: 'join', outcome: 'success' },
        { id: 'right-join', source: 'right', target: 'join', outcome: 'success' },
        { id: 'joined', source: 'join', target: 'done', outcome: 'success' },
      ],
    });
    repository.addArtifact(run.id, 'input', { type: 'choice', data: { value: 'parallel' } });

    const started = engine.start(run.id);
    expect(started.activeNodes.sort()).toEqual(['left', 'right']);
    expect(engine.completeNode(run.id, 'left').status).toBe('running');
    expect(engine.completeNode(run.id, 'right').status).toBe('succeeded');
    repository.close();
  });
});
