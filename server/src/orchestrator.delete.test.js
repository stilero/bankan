import { beforeEach, describe, expect, test, vi } from 'vitest';

const getTask = vi.fn();
const deleteTaskStore = vi.fn();
const removePlan = vi.fn();
const appendLog = vi.fn();
const updateTask = vi.fn();
const repoRaw = vi.fn();

vi.mock('./store.js', () => ({
  default: {
    getTask,
    deleteTask: deleteTaskStore,
    removePlan,
    appendLog,
    updateTask,
    restartRecovery: vi.fn(),
    getAllTasks: vi.fn(() => []),
  },
}));

vi.mock('./events.js', () => ({
  default: {
    emit: vi.fn(),
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
  simpleGit: vi.fn((cwd) => {
    if (cwd === '/repo') {
      return { raw: repoRaw };
    }
    return {};
  }),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    readdirSync: vi.fn(() => []),
    unlinkSync: vi.fn(),
  };
});

const rm = vi.fn();
vi.mock('node:fs/promises', () => ({
  rm,
}));

const orchestrator = (await import('./orchestrator.js')).default;
const deleteTask = orchestrator.deleteTask;

describe('deleteTask', () => {
  beforeEach(() => {
    getTask.mockReset();
    deleteTaskStore.mockReset();
    removePlan.mockReset();
    updateTask.mockReset();
    repoRaw.mockReset();
    rm.mockReset();
  });

  test('succeeds for a task with status done', async () => {
    getTask.mockReturnValue({ id: 'T-1', status: 'done', workspacePath: null });
    const result = await deleteTask('T-1');
    expect(result).toBe(true);
    expect(removePlan).toHaveBeenCalledWith('T-1');
    expect(deleteTaskStore).toHaveBeenCalledWith('T-1');
  });

  test('succeeds for a task with status aborted', async () => {
    getTask.mockReturnValue({ id: 'T-2', status: 'aborted', workspacePath: null });
    const result = await deleteTask('T-2');
    expect(result).toBe(true);
    expect(removePlan).toHaveBeenCalledWith('T-2');
    expect(deleteTaskStore).toHaveBeenCalledWith('T-2');
  });

  test('rejects tasks in non-terminal statuses', async () => {
    for (const status of ['backlog', 'planning', 'implementing', 'review', 'blocked']) {
      getTask.mockReturnValue({ id: 'T-3', status, workspacePath: null });
      const result = await deleteTask('T-3');
      expect(result).toBe(false);
      expect(deleteTaskStore).not.toHaveBeenCalled();
      deleteTaskStore.mockReset();
    }
  });

  test('returns false when task does not exist', async () => {
    getTask.mockReturnValue(undefined);
    const result = await deleteTask('T-999');
    expect(result).toBe(false);
  });

  test('removes a task worktree before deleting terminal tasks', async () => {
    getTask.mockReturnValue({
      id: 'T-4',
      status: 'done',
      workspacePath: '/tmp/workspaces/T-4',
      repoPath: '/repo',
    });

    const result = await deleteTask('T-4');

    expect(result).toBe(true);
    expect(repoRaw).toHaveBeenCalledWith(['worktree', 'remove', '--force', '/tmp/workspaces/T-4']);
    expect(updateTask).toHaveBeenCalledWith('T-4', { workspacePath: null });
    expect(deleteTaskStore).toHaveBeenCalledWith('T-4');
    expect(rm).not.toHaveBeenCalled();
  });
});
