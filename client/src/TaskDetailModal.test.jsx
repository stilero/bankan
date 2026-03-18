import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import TaskDetailModal from './TaskDetailModal.jsx';

const baseTask = {
  id: 'T-TEST01',
  title: 'Test task',
  priority: 'medium',
  status: 'backlog',
  description: '',
  log: [],
};

const noop = () => {};
const defaultProps = {
  onClose: noop,
  onApprove: noop,
  onReject: noop,
  onPause: noop,
  onResume: noop,
  onEdit: noop,
  onAbort: noop,
  onReset: noop,
  onRetry: noop,
  onDelete: vi.fn(),
  onOpenWorkspace: noop,
};

describe('TaskDetailModal delete button', () => {
  test('shows delete button for done tasks', () => {
    render(
      <TaskDetailModal
        task={{ ...baseTask, status: 'done' }}
        {...defaultProps}
      />
    );
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  test('shows delete button for aborted tasks', () => {
    render(
      <TaskDetailModal
        task={{ ...baseTask, status: 'aborted' }}
        {...defaultProps}
      />
    );
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  test('does not show delete button for backlog tasks', () => {
    render(
      <TaskDetailModal
        task={{ ...baseTask, status: 'backlog' }}
        {...defaultProps}
      />
    );
    expect(screen.queryByText('Delete')).toBeNull();
  });

  test('requires confirmation click before calling onDelete for aborted task', () => {
    const onDelete = vi.fn();
    render(
      <TaskDetailModal
        task={{ ...baseTask, status: 'aborted' }}
        {...defaultProps}
        onDelete={onDelete}
      />
    );

    const deleteBtn = screen.getByText('Delete');
    fireEvent.click(deleteBtn);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm Delete')).toBeTruthy();

    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDelete).toHaveBeenCalledWith('T-TEST01');
  });

  test('requires confirmation click before calling onDelete for done task', () => {
    const onDelete = vi.fn();
    render(
      <TaskDetailModal
        task={{ ...baseTask, status: 'done' }}
        {...defaultProps}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDelete).toHaveBeenCalledWith('T-TEST01');
  });
});
