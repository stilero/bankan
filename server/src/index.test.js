import { beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockStore = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
  appendLog: vi.fn(),
  restartRecovery: vi.fn(),
};

const mockBus = {
  emit: vi.fn(),
  on: vi.fn(),
};

vi.mock('./store.js', () => ({
  default: mockStore,
}));

vi.mock('./events.js', () => ({
  default: mockBus,
}));

const { approveMaxReviewBlocker } = await import('./index.js');

describe('approveMaxReviewBlocker', () => {
  beforeEach(() => {
    mockStore.getTask.mockReset();
    mockStore.updateTask.mockReset();
    mockStore.appendLog.mockReset();
    mockStore.restartRecovery.mockReset();
    mockBus.emit.mockReset();
    mockBus.on.mockClear();
  });

  test('cleans up the workspace directory and clears workspacePath when approving to done', () => {
    const workspacePath = join(tmpdir(), `bankan-approve-${Date.now()}`);
    mkdirSync(workspacePath, { recursive: true });
    const task = {
      id: 'T-1',
      status: 'blocked',
      blockedReason: 'Reached maximum review cycles (3). Human input required.',
      workspacePath,
    };
    mockStore.getTask.mockReturnValue(task);

    expect(existsSync(workspacePath)).toBe(true);

    expect(approveMaxReviewBlocker('T-1')).toBe(true);

    expect(existsSync(workspacePath)).toBe(false);
    expect(mockStore.updateTask).toHaveBeenCalledWith('T-1', expect.objectContaining({
      status: 'done',
      workspacePath: null,
    }));
    expect(mockStore.appendLog).toHaveBeenCalledWith(
      'T-1',
      'Human override: approved task to done after max review cycles.'
    );
    expect(mockBus.emit).toHaveBeenCalledWith('max-review-blocker:approved', { taskId: 'T-1' });
    rmSync(workspacePath, { recursive: true, force: true });
  });
});
