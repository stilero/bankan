import { afterEach, describe, expect, test, vi } from 'vitest';

import { WorkflowDispatcher } from './workflowDispatcher.js';

afterEach(() => vi.useRealTimers());

function harness({ max = 1, spawn = true } = {}) {
  const listeners = new Map();
  const bus = {
    on: vi.fn((event, listener) => listeners.set(event, listener)),
    off: vi.fn(),
  };
  const agent = {
    id: 'plan-1', status: 'idle', currentTask: null, process: null,
    getBufferString: vi.fn(() => '=== PLAN START ===\nplanned output\n=== PLAN END ==='),
    spawn: vi.fn(() => spawn),
    kill: vi.fn(),
  };
  const manager = {
    getMaxForRole: vi.fn(() => max),
    getAvailablePlanner: vi.fn(() => agent),
    scaleUp: vi.fn(),
    removeAgent: vi.fn(),
    get: vi.fn(id => id === agent.id ? agent : null),
  };
  const repository = {
    updateExecution: vi.fn((id, updates) => ({ id, ...updates })),
    addArtifact: vi.fn(),
    recordAudit: vi.fn(),
    listNodeRuns: vi.fn(() => [{ id: 'attempt-1', nodeId: 'planner' }]),
    listArtifacts: vi.fn(() => [{ type: 'interview-answers', data: { answers: { goal: 'Use human context' } } }]),
  };
  const completeNode = vi.fn();
  const dispatcher = new WorkflowDispatcher({
    bus, agentManager: manager, repository, completeNode,
    resolveWorkspace: vi.fn(async () => '/workspace'),
    buildCommand: vi.fn(() => 'agent command'),
    executeAction: vi.fn(async () => ({ ok: true })),
    executeCheck: vi.fn(async () => ({ passed: true, summary: 'All tests passed' })),
  });
  const execution = {
    id: 'run-1', taskId: 'T-1', status: 'running', activeNodes: ['planner'],
    workflowSnapshot: { nodes: [{ id: 'planner', type: 'Agent', config: {
      preset: 'planner', provider: 'codex', model: 'gpt-5.4', effort: 'high', accessMode: 'read',
    } }] },
  };
  return { dispatcher, execution, listeners, agent, manager, repository, completeNode };
}

describe('workflow agent dispatcher', () => {
  test('dispatches schema v2 agents from snapshot instructions, selected Artifacts, defaults, and the system-owned contract', async () => {
    const state = harness();
    state.execution.workflowSnapshot = {
      schemaVersion: 2,
      defaults: { provider: 'codex', model: 'gpt-5.4', effort: 'high', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } },
      nodes: [{ id: 'planner', type: 'Agent', config: {
        name: 'Release plan', agentInstructions: 'Use the approved release policy.', accessMode: 'read',
        artifactBindings: ['interview-answers'], executionContract: { resultType: 'plan', outcomes: ['ready', 'blocked'] },
      } }],
    };
    state.repository.listArtifacts.mockReturnValue([
      { type: 'interview-answers', data: { goal: 'Ship safely' } },
      { type: 'secret-notes', data: { text: 'must not leak' } },
    ]);

    await state.dispatcher.dispatch(state.execution, { id: 'T-1', title: 'Plan release' });
    const prompt = state.dispatcher.buildCommand.mock.calls[0][1];

    expect(prompt).toContain('Use the approved release policy.');
    expect(prompt).toContain('Ship safely');
    expect(prompt).not.toContain('must not leak');
    expect(prompt.indexOf('Use the approved release policy.')).toBeLessThan(prompt.indexOf('SYSTEM-OWNED EXECUTION CONTRACT'));
    expect(state.dispatcher.buildCommand).toHaveBeenCalledWith('codex', expect.any(String), 'plan', 'gpt-5.4');

    state.agent.getBufferString.mockReturnValue('work\n<workflow-result>{"outcome":"ready","artifacts":[{"type":"plan","data":{"summary":"Safe rollout"}}]}</workflow-result>');
    await state.listeners.get('agent:unexpected-exit')({ agentId: 'plan-1', taskId: 'T-1', exitCode: 0, signal: 0 });
    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'planner', expect.objectContaining({
      outcome: 'ready', artifacts: [{ type: 'plan', data: { summary: 'Safe rollout' } }],
    }));
  });
  test('claims an agent node once and launches with immutable snapshot configuration', async () => {
    const state = harness();
    await state.dispatcher.dispatch(state.execution, { id: 'T-1', title: 'Plan release' });
    await state.dispatcher.dispatch(state.execution, { id: 'T-1', title: 'Plan release' });

    expect(state.agent.spawn).toHaveBeenCalledTimes(1);
    expect(state.agent).toMatchObject({ cli: 'codex', model: 'gpt-5.4', currentTask: 'T-1' });
    expect(state.dispatcher.buildCommand).toHaveBeenCalledWith('codex', expect.stringContaining('Effort: high'), 'plan', 'gpt-5.4');
    expect(state.dispatcher.buildCommand).toHaveBeenCalledWith('codex', expect.stringContaining('Use human context'), 'plan', 'gpt-5.4');
    expect(state.repository.recordAudit).toHaveBeenCalledWith('run-1', 'node.dispatched', expect.objectContaining({ nodeId: 'planner' }));
  });

  test('completes the claimed node with captured output when its process exits', async () => {
    const state = harness();
    await state.dispatcher.dispatch(state.execution, { id: 'T-1', title: 'Plan release' });
    await state.listeners.get('agent:unexpected-exit')({ agentId: 'plan-1', taskId: 'T-1', exitCode: 0, signal: 0 });

    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'planner', expect.objectContaining({
      outcome: 'success', output: expect.objectContaining({ text: expect.stringContaining('planned output'), exitCode: 0 }),
    }));
    expect(state.manager.removeAgent).toHaveBeenCalledWith('plan-1');
  });

  test('fails visibly for disabled capacity, unsupported presets, and spawn errors', async () => {
    const disabled = harness({ max: 0 });
    await disabled.dispatcher.dispatch(disabled.execution, { id: 'T-1', title: 'Plan release' });
    expect(disabled.repository.updateExecution).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed' }));

    const unsupported = harness();
    unsupported.execution.workflowSnapshot.nodes[0].config.preset = 'unknown';
    await unsupported.dispatcher.dispatch(unsupported.execution, { id: 'T-1' });
    expect(unsupported.repository.updateExecution).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed' }));

    const failedSpawn = harness({ spawn: false });
    await failedSpawn.dispatcher.dispatch(failedSpawn.execution, { id: 'T-1' });
    expect(failedSpawn.repository.updateExecution).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed' }));
  });

  test('releases a claimed agent on cancellation and permits a later redispatch', async () => {
    const state = harness();
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    state.dispatcher.releaseExecution('run-1');
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });

    expect(state.agent.kill).toHaveBeenCalledTimes(1);
    expect(state.agent.spawn).toHaveBeenCalledTimes(2);
  });

  test('executes supported server actions once and completes the node', async () => {
    const state = harness();
    state.execution.activeNodes = ['delivery'];
    state.execution.workflowSnapshot.nodes = [{ id: 'delivery', type: 'Action', config: { action: 'create-pr' } }];

    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });

    expect(state.completeNode).toHaveBeenCalledTimes(1);
    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'delivery', expect.objectContaining({ outcome: 'success' }));
  });

  test('turns a Check adapter result into a structured Artifact and outcome', async () => {
    const state = harness();
    state.execution.activeNodes = ['checks'];
    state.execution.workflowSnapshot.nodes = [{ id: 'checks', type: 'Check', config: { adapter: 'test', command: 'npm test' } }];

    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });

    expect(state.dispatcher.executeCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), expect.objectContaining({ id: 'checks' }));
    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'checks', {
      outcome: 'pass',
      output: { passed: true, summary: 'All tests passed' },
      artifacts: [{ type: 'check-result', data: { adapter: 'test', passed: true, summary: 'All tests passed' } }],
    });
  });

  test('routes reviewer output using its explicit verdict', async () => {
    const state = harness();
    state.execution.workflowSnapshot.nodes[0].config.preset = 'general-review';
    state.agent.getBufferString.mockReturnValue('=== REVIEW START ===\nVERDICT: FAIL\n=== REVIEW END ===');
    state.manager.getAvailablePlanner.mockReturnValue(null);
    state.manager.getAvailableReviewer = vi.fn(() => state.agent);

    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await state.listeners.get('agent:unexpected-exit')({ agentId: 'plan-1', taskId: 'T-1', exitCode: 0, signal: 0 });

    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'planner', expect.objectContaining({ outcome: 'fail' }));
  });

  test('does not accept non-zero or unstructured process output as success', async () => {
    const state = harness();
    state.agent.getBufferString.mockReturnValue('shell error');
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await state.listeners.get('agent:unexpected-exit')({ agentId: 'plan-1', taskId: 'T-1', exitCode: 1, signal: 0 });
    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'planner', expect.objectContaining({ outcome: 'failure' }));
  });

  test('allows a loop revisit when the engine creates a new node-run attempt', async () => {
    const state = harness();
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await state.listeners.get('agent:unexpected-exit')({ agentId: 'plan-1', taskId: 'T-1', exitCode: 0, signal: 0 });
    state.repository.listNodeRuns.mockReturnValue([{ id: 'attempt-1', nodeId: 'planner' }, { id: 'attempt-2', nodeId: 'planner' }]);
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    expect(state.agent.spawn).toHaveBeenCalledTimes(2);
  });

  test('does not complete an in-flight action after cancellation releases its claim', async () => {
    const state = harness();
    state.execution.activeNodes = ['delivery'];
    state.execution.workflowSnapshot.nodes = [{ id: 'delivery', type: 'Action', config: { action: 'create-pr' } }];
    state.repository.listNodeRuns.mockReturnValue([{ id: 'action-1', nodeId: 'delivery' }]);
    let finish;
    state.dispatcher.executeAction = vi.fn(() => new Promise(resolve => { finish = resolve; }));

    const pending = state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await Promise.resolve();
    state.dispatcher.releaseExecution('run-1');
    finish({ ok: true });
    await pending;

    expect(state.completeNode).not.toHaveBeenCalled();
  });

  test('kills and fails an agent node when its snapshot timeout expires', async () => {
    vi.useFakeTimers();
    const state = harness();
    state.execution.workflowSnapshot.nodes[0].config.timeoutMs = 10;
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await vi.advanceTimersByTimeAsync(11);
    expect(state.agent.kill).toHaveBeenCalled();
    expect(state.completeNode).toHaveBeenCalledWith('T-1', 'planner', expect.objectContaining({ outcome: 'failure' }));
  });

  test('retries a capacity-waiting node when an agent becomes available', async () => {
    const state = harness();
    state.manager.getAvailablePlanner.mockReturnValue(null);
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    expect(state.repository.recordAudit).toHaveBeenCalledWith('run-1', 'node.waiting-capacity', expect.anything());

    state.manager.getAvailablePlanner.mockReturnValue(state.agent);
    state.listeners.get('agent:updated')();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.agent.spawn).toHaveBeenCalledTimes(1);
  });

  test('turns action errors into a visible failed execution', async () => {
    const state = harness();
    state.execution.activeNodes = ['delivery'];
    state.execution.workflowSnapshot.nodes = [{ id: 'delivery', type: 'Action', config: { action: 'unsupported' } }];
    state.repository.listNodeRuns.mockReturnValue([{ id: 'action-1', nodeId: 'delivery' }]);
    state.dispatcher.executeAction = vi.fn(async () => { throw new Error('Unsupported action unsupported'); });

    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });

    expect(state.repository.updateExecution).toHaveBeenCalledWith('run-1', { status: 'failed', activeNodes: [] });
    expect(state.repository.recordAudit).toHaveBeenCalledWith('run-1', 'node.dispatch-failed', expect.objectContaining({ reason: 'Unsupported action unsupported' }));
  });

  test('keeps manual actions active while awaiting human confirmation', async () => {
    const state = harness();
    state.execution.activeNodes = ['delivery'];
    state.execution.workflowSnapshot.nodes = [{ id: 'delivery', type: 'Action', config: { action: 'create-pr' } }];
    state.repository.listNodeRuns.mockReturnValue([{ id: 'action-1', nodeId: 'delivery' }]);
    state.dispatcher.executeAction = vi.fn(async () => ({ pending: true, reason: 'Create PR manually' }));

    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });

    expect(state.completeNode).not.toHaveBeenCalled();
    expect(state.repository.recordAudit).toHaveBeenCalledWith('run-1', 'node.awaiting-human', {
      nodeId: 'delivery', reason: 'Create PR manually',
    });
  });

  test('unsubscribes lifecycle listeners when the dispatcher closes', () => {
    const state = harness();
    state.dispatcher.close();
    expect(state.dispatcher.bus.off).toHaveBeenCalledWith('agent:unexpected-exit', expect.any(Function));
    expect(state.dispatcher.bus.off).toHaveBeenCalledWith('agent:updated', expect.any(Function));
  });

  test('does not dispatch paused executions or human nodes', async () => {
    const state = harness();
    state.execution.status = 'paused';
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    state.execution.status = 'running';
    state.execution.activeNodes = ['interview'];
    state.execution.workflowSnapshot.nodes = [{ id: 'interview', type: 'Interview', config: {} }];
    await state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    expect(state.agent.spawn).not.toHaveBeenCalled();
  });

  test('does not spawn when cancellation wins during workspace preparation', async () => {
    const state = harness();
    let resolveWorkspace;
    state.dispatcher.resolveWorkspace = vi.fn(() => new Promise(resolve => { resolveWorkspace = resolve; }));
    const pending = state.dispatcher.dispatch(state.execution, { id: 'T-1' });
    await Promise.resolve();
    state.dispatcher.releaseExecution('run-1');
    resolveWorkspace('/workspace');
    await pending;
    expect(state.agent.spawn).not.toHaveBeenCalled();
  });
});
