import { beforeEach, describe, expect, test, vi } from 'vitest';

const task = {
  id: 'T-42',
  title: 'Manual PR fallback',
  description: 'Fallback when gh is missing',
  priority: 'high',
  branch: 'feature/t-42-manual-pr',
  workspacePath: '/tmp/workspaces/T-42',
  assignedTo: 'orch',
  status: 'review',
  repoPath: '/repo',
  review: 'Looks good',
  plan: 'Do the thing',
  reviewFeedback: null,
  blockedReason: null,
};

const getTask = vi.fn();
const updateTask = vi.fn();
const appendLog = vi.fn();
const emit = vi.fn();
const fetchMock = vi.fn();
const checkoutMock = vi.fn();
const rebaseMock = vi.fn();
const rawMock = vi.fn();
const existsSyncMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock('./store.js', () => ({
  default: {
    getTask,
    updateTask,
    appendLog,
  },
}));

vi.mock('./events.js', () => ({
  default: {
    emit,
    on: vi.fn(),
  },
}));

vi.mock('./agents.js', () => ({
  default: {
    get: vi.fn(),
    getAvailablePlanner: vi.fn(),
    getAvailableImplementor: vi.fn(),
    getAvailableReviewer: vi.fn(),
    getAllStatus: vi.fn(() => []),
    agents: new Map(),
    reconfigure: vi.fn(),
  },
}));

vi.mock('./config.js', () => ({
  loadSettings: vi.fn(() => ({
    agents: {
      planners: { max: 1 },
      implementors: { max: 1 },
      reviewers: { max: 1 },
    },
  })),
  getWorkspacesDir: vi.fn(() => '/tmp/workspaces'),
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    fetch: fetchMock,
    checkout: checkoutMock,
    rebase: rebaseMock,
    raw: rawMock,
  })),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    readdirSync: vi.fn(() => []),
    unlinkSync: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  rm: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('./workflow.js', () => ({
  isReviewResultPlaceholder: vi.fn(() => false),
  isPlanPlaceholder: vi.fn(() => false),
  isImplementationPlaceholder: vi.fn(() => false),
  parseReviewResult: vi.fn(() => ({ verdict: 'PASS', criticalIssues: [], minorIssues: [] })),
  resolveTaskMaxReviewCycles: vi.fn((task, fallback = 3) => task?.maxReviewCycles || fallback),
  reviewShouldPass: vi.fn(() => true),
}));

vi.mock('./sessionHistory.js', () => ({
  createSessionEntry: vi.fn(() => ({ id: 'session-1' })),
}));

describe('createPR', () => {
  beforeEach(() => {
    vi.resetModules();
    getTask.mockReset();
    updateTask.mockReset();
    appendLog.mockReset();
    emit.mockReset();
    fetchMock.mockReset();
    checkoutMock.mockReset();
    rebaseMock.mockReset();
    rawMock.mockReset();
    existsSyncMock.mockReset();
    execFileSyncMock.mockReset();

    getTask.mockReturnValue(task);
    existsSyncMock.mockReturnValue(true);
    execFileSyncMock.mockImplementation((cmd, args) => {
      if (cmd === 'gh' && args?.[0] === 'pr') {
        const error = new Error('spawn gh ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      return '';
    });
  });

  test('falls back to awaiting manual PR instead of blocking when gh is unavailable', async () => {
    const { createPR } = await import('./orchestrator.js');

    await createPR('T-42');

    expect(fetchMock).toHaveBeenCalledWith('origin', 'main');
    expect(checkoutMock).toHaveBeenCalledWith('feature/t-42-manual-pr');
    expect(rebaseMock).toHaveBeenCalledWith(['origin/main']);
    expect(rawMock).toHaveBeenCalledWith(['push', '--force-with-lease', 'origin', 'feature/t-42-manual-pr']);
    expect(updateTask).toHaveBeenCalledWith('T-42', expect.objectContaining({
      status: 'awaiting_manual_pr',
      assignedTo: null,
      blockedReason: expect.stringContaining('create the PR manually'),
    }));
    expect(emit).toHaveBeenCalledWith('task:manual-pr-required', expect.objectContaining({ taskId: 'T-42' }));
  });
});
