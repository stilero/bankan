import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import TaskDetailModal from './TaskDetailModal.jsx';

const baseProps = {
  onClose: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onEdit: vi.fn(),
  onAbort: vi.fn(),
  onReset: vi.fn(),
  onRetry: vi.fn(),
  onDelete: vi.fn(),
  onOpenWorkspace: vi.fn(),
};

function makeTask(overrides = {}) {
  return {
    id: 'T-TEST01',
    title: 'Test task',
    status: 'backlog',
    priority: 'medium',
    description: '',
    ...overrides,
  };
}

describe('TaskDetailModal delete action', () => {
  test('shows delete button for done tasks', () => {
    render(<TaskDetailModal {...baseProps} task={makeTask({ status: 'done' })} />);
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  test('shows delete button for aborted tasks', () => {
    render(<TaskDetailModal {...baseProps} task={makeTask({ status: 'aborted' })} />);
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  test('does not show delete button for backlog tasks', () => {
    render(<TaskDetailModal {...baseProps} task={makeTask({ status: 'backlog' })} />);
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.queryByText('Confirm Delete')).toBeNull();
  });

  test('requires confirmation before calling onDelete for aborted task', () => {
    const onDelete = vi.fn();
    render(<TaskDetailModal {...baseProps} onDelete={onDelete} task={makeTask({ status: 'aborted' })} />);

    const deleteBtn = screen.getByText('Delete');
    fireEvent.click(deleteBtn);

    // First click shows confirmation
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm Delete')).toBeTruthy();

    // Second click triggers delete
    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDelete).toHaveBeenCalledWith('T-TEST01');
  });

  test('requires confirmation before calling onDelete for done task', () => {
    const onDelete = vi.fn();
    render(<TaskDetailModal {...baseProps} onDelete={onDelete} task={makeTask({ status: 'done' })} />);

    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDelete).toHaveBeenCalledWith('T-TEST01');
  });
});
