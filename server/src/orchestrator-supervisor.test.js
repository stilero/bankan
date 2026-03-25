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
      enhancedFeedback: 'Needs human judgement.',
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
      stage: 'review-failure',
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
      enhancedFeedback: 'Try once more.',
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
});
