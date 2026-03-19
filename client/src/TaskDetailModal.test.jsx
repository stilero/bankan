import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import TaskDetailModal from './TaskDetailModal.jsx';

function buildTask(overrides = {}) {
  return {
    id: 'T-1',
    title: 'Review override task',
    priority: 'high',
    status: 'blocked',
    description: '',
    repoPath: '/repo',
    branch: 'feature/t-1-review-override',
    review: null,
    blockedReason: 'Reached maximum review cycles (3). Human input required.',
    reviewCycleCount: 3,
    maxReviewCycles: 3,
    totalTokens: 0,
    workspacePath: '/tmp/workspace',
    sessionHistory: [],
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('TaskDetailModal', () => {
  test('shows max review blocker actions and dynamic review limit', () => {
    const onApproveToDone = vi.fn();
    const onAllowMoreReview = vi.fn();

    render(
      <TaskDetailModal
        task={buildTask()}
        repos={[]}
        onClose={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onEdit={() => {}}
        onAbort={() => {}}
        onReset={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenWorkspace={() => {}}
        onApproveToDone={onApproveToDone}
        onAllowMoreReview={onAllowMoreReview}
      />
    );

    expect(screen.getByText('3 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve to Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow 1 More Review' }));

    expect(onApproveToDone).toHaveBeenCalledWith('T-1');
    expect(onAllowMoreReview).toHaveBeenCalledWith('T-1');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  test('keeps generic retry for non-review blockers', () => {
    const onRetry = vi.fn();

    render(
      <TaskDetailModal
        task={buildTask({
          blockedReason: 'Invalid workspace path for review: /tmp/workspace',
          maxReviewCycles: 5,
        })}
        repos={[]}
        onClose={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onEdit={() => {}}
        onAbort={() => {}}
        onReset={() => {}}
        onRetry={onRetry}
        onDelete={() => {}}
        onOpenWorkspace={() => {}}
      />
    );

    expect(screen.getByText('3 / 5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve to Done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow 1 More Review' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('T-1');
  });

  test('recognizes max review blockers even when the message has no trailing period after the cycle count', () => {
    const onApproveToDone = vi.fn();
    const onAllowMoreReview = vi.fn();

    render(
      <TaskDetailModal
        task={buildTask({
          blockedReason: 'Reached maximum review cycles (3) Human input required.',
        })}
        repos={[]}
        onClose={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onEdit={() => {}}
        onAbort={() => {}}
        onReset={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenWorkspace={() => {}}
        onApproveToDone={onApproveToDone}
        onAllowMoreReview={onAllowMoreReview}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve to Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow 1 More Review' }));

    expect(onApproveToDone).toHaveBeenCalledWith('T-1');
    expect(onAllowMoreReview).toHaveBeenCalledWith('T-1');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
