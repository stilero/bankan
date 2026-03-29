import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import TaskDetailModal from './TaskDetailModal.jsx';

function buildTask(overrides = {}) {
  return {
    id: 'T-1',
    title: 'Review override task',
    description: '',
    priority: 'high',
    repoPath: '/repo',
    branch: 'feature/t-1-review-override',
    status: 'blocked',
    review: null,
    blockedReason: 'Reached maximum review cycles (3). Human input required.',
    reviewCycleCount: 3,
    maxReviewCycles: 3,
    totalTokens: 0,
    workspacePath: '/tmp/workspace',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionHistory: [],
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('TaskDetailModal', () => {
  test('shows manual PR guidance and lets the user mark the task done', () => {
    const onCompleteManualPr = vi.fn();

    render(
      <TaskDetailModal
        task={buildTask({
          id: 'T-42',
          title: 'Ship manual PR flow',
          description: 'Implement fallback when gh is missing',
          branch: null,
          status: 'awaiting_manual_pr',
          blockedReason: 'GitHub CLI is unavailable. Create the PR manually, then mark this task done.',
          workspacePath: '/tmp/workspaces/T-42',
          startedAt: new Date().toISOString(),
        })}
        repos={['/repo']}
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEdit={vi.fn()}
        onAbort={vi.fn()}
        onReset={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onCompleteManualPr={onCompleteManualPr}
      />
    );

    expect(screen.getByText(/create the PR manually/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /mark done/i }));

    expect(onCompleteManualPr).toHaveBeenCalledWith('T-42');
  });

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

  test('renders delete button when task status is aborted', () => {
    const onDelete = vi.fn();
    render(
      <TaskDetailModal
        task={buildTask({ status: 'aborted', blockedReason: null, reviewCycleCount: 0 })}
        onClose={() => {}}
        onAbort={() => {}}
        onReset={() => {}}
        onRetry={() => {}}
        onDelete={onDelete}
        onOpenWorkspace={() => {}}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: 'Delete Task' });
    expect(deleteBtn).toBeTruthy();
  });

  test('displays supervisor feedback with rejection count when planFeedback exists', () => {
    render(
      <TaskDetailModal
        task={buildTask({
          status: 'awaiting_approval',
          plan: 'Some plan content',
          planFeedback: 'Missing implementation steps for the auth module.',
          planRejectionCount: 2,
          maxPlanRejections: 3,
        })}
        repos={['/repo']}
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEdit={vi.fn()}
        onAbort={vi.fn()}
        onReset={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onCompleteManualPr={vi.fn()}
      />
    );

    expect(screen.getByText('Supervisor Feedback')).toBeTruthy();
    expect(screen.getByText(/rejected 2\/3/)).toBeTruthy();
    expect(screen.getByText('Missing implementation steps for the auth module.')).toBeTruthy();
  });
});
