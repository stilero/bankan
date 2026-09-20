import { afterEach, describe, expect, test } from 'vitest';

import { createRuntimeHarness } from '../test-utils.js';

let harness;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe('workflow task migration boundary', () => {
  test('materializes persisted legacy settings when the runtime creates its repository', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const { loadSettings } = await harness.importModule('./src/config.js');
    const settings = loadSettings();
    const planner = runtime.getWorkflowRepository().getWorkflow('legacy-pipeline').definition.nodes.find(node => node.id === 'planner');

    expect(planner.config).toMatchObject({
      provider: settings.agents.planners.cli,
      model: settings.agents.planners.model,
      agentInstructions: settings.prompts.planning,
    });
    runtime.resetWorkflowRuntimeForTests();
  });
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

  test('uses the configured default version exactly after a newer version is published', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const repository = runtime.getWorkflowRepository();
    const workflow = repository.getWorkflow('standard-development');

    repository.updateDraft(workflow.id, {
      ...workflow.definition,
      metadata: { revision: 'newer-than-default' },
    });
    repository.publish(workflow.id);

    const task = runtime.createWorkflowTask({ title: 'Pinned default' });
    const run = runtime.getWorkflowRun(task.id);

    expect(task.workflowVersion).toBe(1);
    expect(run.workflowVersion).toBe(1);
    expect(run.workflowSnapshot.metadata).toBeUndefined();
    runtime.resetWorkflowRuntimeForTests();
  });

  test('describes active human nodes as actionable and automated nodes as server controlled', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const task = runtime.createWorkflowTask({ title: 'Actionable task' });

    expect(runtime.getWorkflowRun(task.id).actionableNodes).toEqual([
      expect.objectContaining({ nodeId: 'interview', type: 'Interview', action: 'submitInput' }),
    ]);

    runtime.controlWorkflowRun(task.id, 'completeNode', {
      nodeId: 'interview',
      outcome: 'success',
      artifacts: [{ type: 'brief', data: { goal: 'Ship it' } }],
    });

    expect(runtime.getWorkflowRun(task.id).actionableNodes).toEqual([
      expect.objectContaining({ nodeId: 'planner', type: 'Agent', action: 'awaitingExecution' }),
    ]);
    runtime.resetWorkflowRuntimeForTests();
  });

  test('exposes named Human Decision choices and persists optional decision feedback', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const task = runtime.createWorkflowTask({ title: 'Decision task' });
    runtime.controlWorkflowRun(task.id, 'submitInput', { nodeId: 'interview', answers: { goal: 'Ship' } });
    runtime.controlWorkflowRun(task.id, 'completeNode', { nodeId: 'planner', outcome: 'success' });

    expect(runtime.getWorkflowRun(task.id).actionableNodes).toEqual([
      expect.objectContaining({
        nodeId: 'approval', type: 'HumanDecision', action: 'decide', actor: 'human', acceptsFeedback: true,
        choices: [{ outcome: 'approve', label: 'Approve plan' }, { outcome: 'reject', label: 'Request changes' }],
      }),
    ]);

    runtime.controlWorkflowRun(task.id, 'decide', { nodeId: 'approval', outcome: 'reject', feedback: 'Address rollback risk' });
    expect(runtime.getWorkflowRun(task.id).artifacts).toContainEqual(expect.objectContaining({
      nodeId: 'approval', type: 'human-feedback', data: { outcome: 'reject', feedback: 'Address rollback risk' },
    }));
    runtime.controlWorkflowRun(task.id, 'completeNode', { nodeId: 'planner', outcome: 'success' });
    runtime.controlWorkflowRun(task.id, 'completeNode', { nodeId: 'approval', outcome: 'approve', feedback: 'Accepted after revision' });
    expect(runtime.getWorkflowRun(task.id).artifacts).toContainEqual(expect.objectContaining({
      nodeId: 'approval', type: 'human-feedback', data: { outcome: 'approve', feedback: 'Accepted after revision' },
    }));
    runtime.resetWorkflowRuntimeForTests();
  });

  test('recovers running executions without changing paused runs', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const running = runtime.createWorkflowTask({ title: 'Running' });
    const paused = runtime.createWorkflowTask({ title: 'Paused' });
    runtime.controlWorkflowRun(paused.id, 'pause');

    runtime.recoverWorkflowExecutions();

    const events = runtime.getWorkflowRepository().listAuditEvents(runtime.getWorkflowRun(running.id).id);
    expect(events.some(event => event.type === 'execution.recovered')).toBe(true);
    expect(runtime.getWorkflowRun(paused.id).status).toBe('paused');
    runtime.resetWorkflowRuntimeForTests();
  });

  test('persists interview answers as an artifact before advancing to planning', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const task = runtime.createWorkflowTask({ title: 'Interviewed task' });

    runtime.controlWorkflowRun(task.id, 'submitInput', {
      nodeId: 'interview',
      answers: { goal: 'Make workflow setup understandable', acceptanceCriteria: ['A guided path'] },
    });

    const run = runtime.getWorkflowRun(task.id);
    expect(run.artifacts).toContainEqual(expect.objectContaining({
      nodeId: 'interview',
      type: 'interview-answers',
      data: { answers: { goal: 'Make workflow setup understandable', acceptanceCriteria: ['A guided path'] } },
    }));
    expect(run.activeNodes).toEqual(['planner']);
    expect(run.exchanges).toContainEqual(expect.objectContaining({ nodeId: 'interview', role: 'user', content: expect.stringContaining('Make workflow setup understandable') }));
    runtime.resetWorkflowRuntimeForTests();
  });

  test('validates interview input and supports pause, resume, and cancel lifecycle', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const task = runtime.createWorkflowTask({ title: 'Controlled task' });

    expect(() => runtime.controlWorkflowRun(task.id, 'submitInput', { nodeId: 'interview', answers: [] }))
      .toThrow('Interview answers must be an object');
    expect(() => runtime.controlWorkflowRun(task.id, 'submitInput', { nodeId: 'interview', answers: {} }))
      .toThrow('Interview answers cannot be empty');
    expect(runtime.controlWorkflowRun(task.id, 'pause').status).toBe('paused');
    expect(runtime.controlWorkflowRun(task.id, 'resume').status).toBe('running');
    expect(runtime.controlWorkflowRun(task.id, 'cancel').status).toBe('cancelled');
    expect(() => runtime.controlWorkflowRun(task.id, 'unsupported')).toThrow(/Unsupported workflow command/);
    runtime.resetWorkflowRuntimeForTests();
  });

  test('records explicit user exchanges only for active nodes', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const task = runtime.createWorkflowTask({ title: 'Conversation' });

    const exchange = runtime.appendWorkflowExchange(task.id, { nodeId: 'interview', role: 'user', content: 'Keep it simple' });
    expect(exchange.id).toMatch(/^exchange-/);
    expect(runtime.getWorkflowRun(task.id).exchanges).toContainEqual(expect.objectContaining({ content: 'Keep it simple' }));
    expect(() => runtime.appendWorkflowExchange(task.id, { nodeId: 'planner', role: 'user', content: 'Too early' }))
      .toThrow('Node planner is not active');
    runtime.resetWorkflowRuntimeForTests();
  });

  test('does not replay an uncertain create-pr action during restart recovery', async () => {
    harness = createRuntimeHarness();
    const runtime = await harness.importModule('./src/workflowRuntime.js');
    const repository = runtime.getWorkflowRepository();
    const draft = repository.createDraft({ name: 'Delivery only' });
    repository.updateDraft(draft.id, {
      schemaVersion: 1,
      nodes: [
        { id: 'delivery', type: 'Action', config: { action: 'create-pr', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [{ id: 'delivered', source: 'delivery', target: 'done', outcome: 'success' }],
    });
    repository.publish(draft.id);
    repository.setDefault(draft.id, 1);
    const task = runtime.createWorkflowTask({ title: 'Ambiguous delivery' });

    runtime.recoverWorkflowExecutions();

    expect(runtime.getWorkflowRun(task.id).activeNodes).toEqual(['delivery']);
    expect((await harness.importModule('./src/store.js')).default.getTask(task.id)).toMatchObject({
      status: 'awaiting_manual_pr',
      blockedReason: expect.stringContaining('Confirm the pull request'),
    });
    expect(repository.listAuditEvents(runtime.getWorkflowRun(task.id).id))
      .toContainEqual(expect.objectContaining({ type: 'action.recovery-needs-confirmation' }));
    runtime.resetWorkflowRuntimeForTests();
  });
});
