import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const emitMock = vi.fn();
const onMock = vi.fn();
const removeAgentMock = vi.fn();
const appendSessionMock = vi.fn();
const appendLogMock = vi.fn();
const savePlanMock = vi.fn();
const createSessionEntryMock = vi.fn((_agent, data) => data);
const evaluatePlanMock = vi.fn();
const evaluateReviewFailureMock = vi.fn();

let taskState;
let agentState;
let settingsState;

vi.mock('./config.js', () => ({
  loadSettings: () => settingsState,
  getWorkspacesDir: () => '/tmp/workspaces',
}));

vi.mock('./supervisor.js', () => ({
  evaluatePlan: (...args) => evaluatePlanMock(...args),
  evaluateReviewFailure: (...args) => evaluateReviewFailureMock(...args),
}));

vi.mock('./capabilities.js', () => ({
  getGithubCapabilities: vi.fn(() => ({})),
  isManualPullRequestRequired: vi.fn(() => false),
}));

vi.mock('./store.js', () => ({
  default: {
    getTask: (taskId) => taskState.get(taskId) || null,
    updateTask: (taskId, update) => {
      const current = taskState.get(taskId) || { id: taskId };
      taskState.set(taskId, { ...current, ...update });
    },
    savePlan: (...args) => savePlanMock(...args),
    appendSession: (...args) => appendSessionMock(...args),
    appendLog: (...args) => appendLogMock(...args),
  },
}));

vi.mock('./agents.js', () => ({
  default: {
    get: (agentId) => agentState.get(agentId) || null,
    removeAgent: (...args) => removeAgentMock(...args),
    getAvailableImplementor: vi.fn(() => null),
  },
}));

vi.mock('./events.js', () => ({
  default: {
    emit: (...args) => emitMock(...args),
    on: (...args) => onMock(...args),
  },
}));

vi.mock('./sessionHistory.js', () => ({
  createSessionEntry: (...args) => createSessionEntryMock(...args),
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(),
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function makePlanner(planText) {
  return {
    id: 'plan-1',
    cli: 'claude',
    currentTask: 'T-PLAN',
    getBufferString: vi.fn(() => planText),
    getStructuredBlock: vi.fn(() => planText),
    kill: vi.fn(),
  };
}

function makeReviewer(reviewText) {
  return {
    id: 'rev-1',
    cli: 'claude',
    currentTask: 'T-REVIEW',
    getBufferString: vi.fn(() => reviewText),
    getStructuredBlock: vi.fn(() => reviewText),
    kill: vi.fn(),
  };
}

beforeEach(() => {
  taskState = new Map();
  agentState = new Map();
  settingsState = {
    autopilotMode: 'manual',
    maxReviewCycles: 3,
    agents: {
      planners: { cli: 'claude', model: '' },
    },
  };
  emitMock.mockReset();
  onMock.mockReset();
  removeAgentMock.mockReset();
  appendSessionMock.mockReset();
  appendLogMock.mockReset();
  savePlanMock.mockReset();
  createSessionEntryMock.mockClear();
  evaluatePlanMock.mockReset();
  evaluateReviewFailureMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('orchestrator supervisor flows', () => {
  test('auto-approves plans only in hybrid/autopilot modes', async () => {
    const planText = `=== PLAN START ===
SUMMARY: Ship autopilot.
BRANCH: feature/t-plan-autopilot
FILES_TO_MODIFY:
- server/src/orchestrator.js (wire auto approval)
STEPS:
1. Evaluate plan with supervisor.
TESTS_NEEDED:
- npm run test:server
RISKS:
- none
=== PLAN END ===`;

    const planner = makePlanner(planText);
    agentState.set('plan-1', planner);
    taskState.set('T-PLAN', {
      id: 'T-PLAN',
      title: 'Plan task',
      priority: 'medium',
      status: 'planning',
    });

    evaluatePlanMock.mockResolvedValue({ decision: 'APPROVE', feedback: 'Looks good.' });

    const { __test__ } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'manual';
    __test__.onPlanComplete('plan-1', 'T-PLAN');
    await flushPromises();
    expect(evaluatePlanMock).not.toHaveBeenCalled();
    expect(taskState.get('T-PLAN').status).toBe('awaiting_approval');

    settingsState.autopilotMode = 'hybrid';
    taskState.set('T-PLAN', {
      id: 'T-PLAN',
      title: 'Plan task',
      priority: 'medium',
      status: 'planning',
    });
    agentState.set('plan-1', makePlanner(planText));
    __test__.onPlanComplete('plan-1', 'T-PLAN');
    await flushPromises();

    expect(evaluatePlanMock).toHaveBeenCalledOnce();
    expect(emitMock).toHaveBeenCalledWith('supervisor:decision', {
      taskId: 'T-PLAN',
      stage: 'plan',
      decision: 'APPROVE',
      feedback: 'Looks good.',
    });
    expect(taskState.get('T-PLAN').status).toBe('queued');
  });

  test('does not auto-approve a plan after the task leaves awaiting_approval', async () => {
    const planText = `=== PLAN START ===
SUMMARY: Guard plan approval races.
BRANCH: feature/t-plan-race
FILES_TO_MODIFY:
- server/src/orchestrator.js (add race guard)
STEPS:
1. Leave task untouched when a human already acted.
TESTS_NEEDED:
- npm run test:server
RISKS:
- none
=== PLAN END ===`;

    settingsState.autopilotMode = 'autopilot';
    const planner = makePlanner(planText);
    agentState.set('plan-1', planner);
    taskState.set('T-PLAN', {
      id: 'T-PLAN',
      title: 'Plan race',
      priority: 'medium',
      status: 'planning',
    });

    let resolvePlan;
    evaluatePlanMock.mockReturnValue(new Promise((resolve) => {
      resolvePlan = resolve;
    }));

    const { __test__ } = await import('./orchestrator.js');
    __test__.onPlanComplete('plan-1', 'T-PLAN');

    taskState.set('T-PLAN', {
      ...taskState.get('T-PLAN'),
      status: 'queued',
    });

    resolvePlan({ decision: 'APPROVE', feedback: 'Late approval.' });
    await flushPromises();

    expect(emitMock).not.toHaveBeenCalledWith(
      'supervisor:decision',
      expect.objectContaining({ taskId: 'T-PLAN', stage: 'plan' })
    );
    expect(taskState.get('T-PLAN').status).toBe('queued');
  });

  test('routes review failures differently in manual and autopilot modes', async () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- fix null handling
MINOR_ISSUES:
- none
SUMMARY: Needs one more pass.
=== REVIEW END ===`;

    const { __test__ } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'manual';
    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Review task',
      status: 'review',
      reviewCycleCount: 0,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    await __test__.onReviewComplete('rev-1', 'T-REVIEW');
    expect(evaluateReviewFailureMock).not.toHaveBeenCalled();
    expect(taskState.get('T-REVIEW')).toMatchObject({
      status: 'queued',
      reviewFeedback: 'fix null handling',
      reviewCycleCount: 1,
    });

    settingsState.autopilotMode = 'autopilot';
    evaluateReviewFailureMock.mockResolvedValue({
      decision: 'ESCALATE',
      feedback: 'Needs human judgement.',
    });
    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Review task',
      status: 'review',
      reviewCycleCount: 0,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    await __test__.onReviewComplete('rev-1', 'T-REVIEW');
    await flushPromises();

    expect(evaluateReviewFailureMock).toHaveBeenCalledOnce();
    expect(emitMock).toHaveBeenCalledWith('supervisor:decision', {
      taskId: 'T-REVIEW',
      stage: 'review',
      decision: 'ESCALATE',
      feedback: 'Needs human judgement.',
    });
    expect(taskState.get('T-REVIEW')).toMatchObject({
      status: 'blocked',
      reviewFeedback: 'fix null handling',
      reviewCycleCount: 1,
      blockedReason: 'Supervisor escalated: Needs human judgement.',
    });
  });

  test('blocks when supervisor extension cap is exhausted', async () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- fix flaky retry loop
MINOR_ISSUES:
- none
SUMMARY: Another retry would exceed the cap.
=== REVIEW END ===`;

    const { __test__, MAX_SUPERVISOR_EXTENSIONS } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'autopilot';
    settingsState.maxReviewCycles = 3;
    evaluateReviewFailureMock.mockResolvedValue({
      decision: 'RETRY',
      feedback: 'Try once more.',
    });
    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Review cap',
      status: 'review',
      reviewCycleCount: settingsState.maxReviewCycles + MAX_SUPERVISOR_EXTENSIONS - 1,
      maxReviewCycles: settingsState.maxReviewCycles + MAX_SUPERVISOR_EXTENSIONS,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    await __test__.onReviewComplete('rev-1', 'T-REVIEW');
    await flushPromises();

    expect(taskState.get('T-REVIEW')).toMatchObject({
      status: 'blocked',
      reviewFeedback: 'fix flaky retry loop',
      reviewCycleCount: settingsState.maxReviewCycles + MAX_SUPERVISOR_EXTENSIONS,
    });
    expect(taskState.get('T-REVIEW').blockedReason)
      .toContain(`Supervisor exhausted ${MAX_SUPERVISOR_EXTENSIONS} extension(s)`);
    expect(emitMock).toHaveBeenCalledWith('task:blocked', {
      taskId: 'T-REVIEW',
      reason: 'Supervisor exhausted cycle extensions',
    });
  });

  test('T1: RETRY on cycles-remaining autopilot path queues with enhanced feedback', async () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- handle edge case
MINOR_ISSUES:
- none
SUMMARY: Needs a fix.
=== REVIEW END ===`;

    const { __test__ } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'autopilot';
    settingsState.maxReviewCycles = 3;
    evaluateReviewFailureMock.mockResolvedValue({
      decision: 'RETRY',
      feedback: 'Fix the edge case in parser.',
      logMessage: 'Supervisor evaluated review failure: RETRY',
    });
    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Review retry',
      status: 'review',
      reviewCycleCount: 0,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    await __test__.onReviewComplete('rev-1', 'T-REVIEW');
    await flushPromises();

    expect(evaluateReviewFailureMock).toHaveBeenCalledOnce();
    expect(taskState.get('T-REVIEW')).toMatchObject({
      status: 'queued',
      reviewFeedback: 'Fix the edge case in parser.',
      reviewCycleCount: 1,
    });
  });

  test('T2: successful cycle extension when RETRY at max cycles with extensions remaining', async () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- flaky test
MINOR_ISSUES:
- none
SUMMARY: One more try.
=== REVIEW END ===`;

    const { __test__ } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'autopilot';
    settingsState.maxReviewCycles = 3;
    evaluateReviewFailureMock.mockResolvedValue({
      decision: 'RETRY',
      feedback: 'Try fixing the flaky test.',
      logMessage: 'Supervisor evaluated review failure: RETRY',
    });
    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Review extend',
      status: 'review',
      reviewCycleCount: 2,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    await __test__.onReviewComplete('rev-1', 'T-REVIEW');
    await flushPromises();

    expect(taskState.get('T-REVIEW')).toMatchObject({
      status: 'queued',
      maxReviewCycles: 4,
      reviewCycleCount: 3,
    });
  });

  test('T3: catch fallback blocks at max cycles and retries when cycles remain', async () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- error
MINOR_ISSUES:
- none
SUMMARY: Crash test.
=== REVIEW END ===`;

    const { __test__ } = await import('./orchestrator.js');
    settingsState.autopilotMode = 'autopilot';
    settingsState.maxReviewCycles = 3;

    // Max cycles path: supervisor crash should block
    evaluateReviewFailureMock.mockRejectedValue(new Error('CLI crashed'));
    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Crash at max',
      status: 'review',
      reviewCycleCount: 2,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    await __test__.onReviewComplete('rev-1', 'T-REVIEW');
    await flushPromises();

    expect(taskState.get('T-REVIEW').status).toBe('blocked');

    // Cycles remaining path: supervisor crash should auto-retry
    evaluateReviewFailureMock.mockRejectedValue(new Error('CLI crashed'));
    taskState.set('T-REVIEW2', {
      id: 'T-REVIEW2',
      title: 'Crash with cycles',
      status: 'review',
      reviewCycleCount: 0,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));
    agentState.get('rev-1').currentTask = 'T-REVIEW2';

    await __test__.onReviewComplete('rev-1', 'T-REVIEW2');
    await flushPromises();

    expect(taskState.get('T-REVIEW2').status).toBe('queued');
    expect(appendLogMock).toHaveBeenCalledWith('T-REVIEW2', expect.stringContaining('Supervisor crashed'));
  });

  test('T4: plan auto-approval catch leaves task in awaiting_approval and logs', async () => {
    const planText = `=== PLAN START ===
SUMMARY: Crash plan test.
BRANCH: feature/t-plan-crash
FILES_TO_MODIFY:
- server/src/orchestrator.js
STEPS:
1. Test crash handling.
TESTS_NEEDED:
- npm run test:server
RISKS:
- none
=== PLAN END ===`;

    const { __test__ } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'autopilot';
    evaluatePlanMock.mockRejectedValue(new Error('Supervisor process died'));

    const planner = makePlanner(planText);
    agentState.set('plan-1', planner);
    taskState.set('T-PLAN', {
      id: 'T-PLAN',
      title: 'Plan crash',
      priority: 'medium',
      status: 'planning',
    });

    __test__.onPlanComplete('plan-1', 'T-PLAN');
    await flushPromises();

    expect(taskState.get('T-PLAN').status).toBe('awaiting_approval');
    expect(appendLogMock).toHaveBeenCalledWith('T-PLAN', expect.stringContaining('Supervisor failed during plan auto-approval'));
  });

  test('plan rejection escalates to human after maxPlanRejections', async () => {
    const planText = `=== PLAN START ===
SUMMARY: Rejection limit test.
BRANCH: feature/t-plan-reject-limit
FILES_TO_MODIFY:
- server/src/orchestrator.js
STEPS:
1. Test rejection limit.
TESTS_NEEDED:
- npm run test:server
RISKS:
- none
=== PLAN END ===`;

    const { __test__ } = await import('./orchestrator.js');

    settingsState.autopilotMode = 'autopilot';
    settingsState.maxPlanRejections = 2;

    // First rejection: should re-plan (go to backlog)
    evaluatePlanMock.mockResolvedValue({ decision: 'REJECT', feedback: 'Missing steps.', logMessage: 'Rejected' });
    const planner1 = makePlanner(planText);
    agentState.set('plan-1', planner1);
    taskState.set('T-PLAN', {
      id: 'T-PLAN', title: 'Reject limit', priority: 'medium',
      status: 'planning', planRejectionCount: 0,
    });

    __test__.onPlanComplete('plan-1', 'T-PLAN');
    await flushPromises();

    expect(taskState.get('T-PLAN').status).toBe('backlog');
    expect(taskState.get('T-PLAN').planRejectionCount).toBe(1);

    // Second rejection (at limit): should escalate, stay in awaiting_approval
    const planner2 = makePlanner(planText);
    agentState.set('plan-1', planner2);
    taskState.set('T-PLAN', {
      ...taskState.get('T-PLAN'),
      status: 'planning', planRejectionCount: 1,
    });

    __test__.onPlanComplete('plan-1', 'T-PLAN');
    await flushPromises();

    expect(taskState.get('T-PLAN').status).toBe('awaiting_approval');
    expect(taskState.get('T-PLAN').planRejectionCount).toBe(2);
    expect(appendLogMock).toHaveBeenCalledWith('T-PLAN', expect.stringContaining('escalating to human review'));
    expect(emitMock).toHaveBeenCalledWith('supervisor:decision', expect.objectContaining({
      taskId: 'T-PLAN', stage: 'plan', decision: 'ESCALATE',
    }));
  });

  test('review callback does not clobber task when status changed during supervisor evaluation', async () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- race condition check
MINOR_ISSUES:
- none
SUMMARY: Race guard test.
=== REVIEW END ===`;

    const { __test__ } = await import('./orchestrator.js');
    settingsState.autopilotMode = 'autopilot';
    settingsState.maxReviewCycles = 3;

    let resolveReview;
    evaluateReviewFailureMock.mockReturnValue(new Promise((resolve) => {
      resolveReview = resolve;
    }));

    taskState.set('T-REVIEW', {
      id: 'T-REVIEW',
      title: 'Race guard',
      status: 'review',
      reviewCycleCount: 0,
      maxReviewCycles: 3,
      workspacePath: '/tmp/workspace',
    });
    agentState.set('rev-1', makeReviewer(reviewText));

    const promise = __test__.onReviewComplete('rev-1', 'T-REVIEW');

    // Simulate human changing task status during supervisor evaluation
    taskState.set('T-REVIEW', { ...taskState.get('T-REVIEW'), status: 'queued' });

    resolveReview({ decision: 'RETRY', feedback: 'Late retry.', logMessage: 'log' });
    await promise;
    await flushPromises();

    // Task should remain in queued (human's action), not be clobbered
    expect(taskState.get('T-REVIEW').status).toBe('queued');
  });
});
