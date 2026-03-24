import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockStore = {
  getTask: vi.fn(),
  getAllTasks: vi.fn(() => []),
  updateTask: vi.fn(),
  appendLog: vi.fn(),
  restartRecovery: vi.fn(),
};

const mockBus = {
  emit: vi.fn(),
  on: vi.fn(),
};

const removeTaskWorktree = vi.fn(async () => true);
const orchestratorStart = vi.fn();

const existsSync = vi.fn();
const readdirSync = vi.fn();
const rmSync = vi.fn();
const statSync = vi.fn();
const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
const readFileSync = vi.fn(() => '');
const chmodSync = vi.fn();
const repoRaw = vi.fn();

vi.mock('./store.js', () => ({
  default: mockStore,
}));

vi.mock('./events.js', () => ({
  default: mockBus,
}));

vi.mock('./config.js', () => ({
  default: { PORT: 3001 },
  loadSettings: vi.fn(() => ({
    workspaceRoot: '/tmp/workspaces',
    agents: {
      planners: { max: 1, cli: 'codex', model: '' },
      implementors: { max: 1, cli: 'codex', model: '' },
      reviewers: { max: 1, cli: 'codex', model: '' },
    },
  })),
  saveSettings: vi.fn(),
  validateSettings: vi.fn(() => []),
  getWorkspacesDir: vi.fn(() => '/tmp/workspaces'),
  getRuntimeStatePaths: vi.fn(() => ({
    clientDistDir: '/tmp/client-dist',
    rootDir: '/tmp/root',
    dataDir: '/tmp/data',
    bridgesDir: '/tmp/bridges',
    envFile: '/tmp/.env.local',
    packaged: false,
  })),
}));

vi.mock('./agents.js', () => ({
  default: {
    get: vi.fn(),
    getAllStatus: vi.fn(() => []),
  },
}));

vi.mock('./orchestrator.js', () => ({
  default: {
    start: orchestratorStart,
    deleteTask: vi.fn(),
  },
  removeTaskWorktree,
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn((cwd) => {
    if (cwd === '/repo') return { raw: repoRaw };
    return { raw: vi.fn() };
  }),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync,
    readdirSync,
    rmSync,
    statSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    chmodSync,
  };
});

const {
  approveMaxReviewBlocker,
  cleanupOrphanTaskWorktrees,
} = await import('./index.js');

describe('approveMaxReviewBlocker', () => {
  beforeEach(() => {
    mockStore.getTask.mockReset();
    mockStore.updateTask.mockReset();
    mockStore.appendLog.mockReset();
    mockStore.restartRecovery.mockReset();
    mockBus.emit.mockReset();
    removeTaskWorktree.mockReset();
  });

  test('removes the task worktree through the orchestrator cleanup path before approving to done', async () => {
    const task = {
      id: 'T-1',
      status: 'blocked',
      blockedReason: 'Reached maximum review cycles (3). Human input required.',
      workspacePath: '/tmp/workspaces/T-1',
      repoPath: '/repo',
    };
    mockStore.getTask.mockReturnValue(task);

    expect(await approveMaxReviewBlocker('T-1')).toBe(true);

    expect(removeTaskWorktree).toHaveBeenCalledWith(task);
    expect(mockStore.updateTask).toHaveBeenCalledWith('T-1', expect.objectContaining({
      status: 'done',
      workspacePath: null,
    }));
    expect(mockStore.appendLog).toHaveBeenCalledWith(
      'T-1',
      'Human override: approved task to done after max review cycles.'
    );
    expect(mockBus.emit).toHaveBeenCalledWith('max-review-blocker:approved', { taskId: 'T-1' });
  });
});

describe('cleanupOrphanTaskWorktrees', () => {
  beforeEach(() => {
    mockStore.getTask.mockReset();
    mockStore.getAllTasks.mockReset();
    existsSync.mockReset();
    readdirSync.mockReset();
    rmSync.mockReset();
    repoRaw.mockReset();
  });

  test('preserves active and registered task worktrees while removing orphan task directories', async () => {
    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue(['T-active', 'T-registered', 'T-orphan', 'notes']);
    mockStore.getTask.mockImplementation((id) => {
      if (id === 'T-active') return { id, status: 'implementing', workspacePath: '/tmp/workspaces/T-active', repoPath: '/repo' };
      return null;
    });
    mockStore.getAllTasks.mockReturnValue([
      { id: 'T-active', status: 'implementing', workspacePath: '/tmp/workspaces/T-active', repoPath: '/repo' },
      { id: 'T-done', status: 'done', workspacePath: '/tmp/workspaces/T-registered', repoPath: '/repo' },
    ]);
    repoRaw.mockResolvedValue('worktree /repo\nbranch refs/heads/main\n\nworktree /tmp/workspaces/T-registered\nbranch refs/heads/feature/t-registered\n\n');

    await cleanupOrphanTaskWorktrees();

    expect(rmSync).toHaveBeenCalledTimes(1);
    expect(rmSync).toHaveBeenCalledWith('/tmp/workspaces/T-orphan', expect.objectContaining({ recursive: true, force: true }));
  });
});
