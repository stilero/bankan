import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';

vi.mock('./DirectoryPicker.jsx', () => ({
  default: ({ onSelect, onClose }) => (
    <div>
      <button onClick={() => onSelect('/tmp/workspaces')}>Pick directory</button>
      <button onClick={onClose}>Close picker</button>
    </div>
  ),
}));

import ReportingDashboard from './ReportingDashboard.jsx';

describe('ReportingDashboard', () => {
  const mockOnClose = vi.fn();

  test('renders empty state when no tasks are done', () => {
    render(
      <ReportingDashboard
        tasks={[]}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('Reporting Dashboard')).toBeTruthy();
    expect(screen.getByText(/No completed tasks yet/i)).toBeTruthy();
  });

  test('displays overall metrics and per-repo breakdown for completed tasks', () => {
    const tasks = [
      {
        id: 'T-1',
        title: 'Task 1',
        repoPath: '/repo-a',
        status: 'done',
        totalTokens: 1000,
        startedAt: '2026-03-14T10:00:00Z',
        completedAt: '2026-03-14T11:00:00Z',
      },
      {
        id: 'T-2',
        title: 'Task 2',
        repoPath: '/repo-a',
        status: 'done',
        totalTokens: 500,
        startedAt: '2026-03-14T12:00:00Z',
        completedAt: '2026-03-14T12:30:00Z',
      },
      {
        id: 'T-3',
        title: 'Task 3',
        repoPath: '/repo-b',
        status: 'done',
        totalTokens: 2000,
        startedAt: '2026-03-14T13:00:00Z',
        completedAt: '2026-03-14T14:15:00Z',
      },
      {
        id: 'T-4',
        title: 'Task 4',
        repoPath: '/repo-b',
        status: 'backlog',
        totalTokens: 0,
        startedAt: null,
        completedAt: null,
      },
    ];

    render(
      <ReportingDashboard
        tasks={tasks}
        onClose={mockOnClose}
      />
    );

    // Check overall metrics
    expect(screen.getByText('3')).toBeTruthy(); // 3 completed tasks
    expect(screen.getByText('3.5k')).toBeTruthy(); // 3500 total tokens
    expect(screen.getByText(/2 hrs 45 mins/)).toBeTruthy(); // Total time

    // Check per-repo breakdowns
    expect(screen.getByText('/repo-a')).toBeTruthy();
    expect(screen.getByText('/repo-b')).toBeTruthy();
  });

  test('closes dashboard when close button is clicked', () => {
    render(
      <ReportingDashboard
        tasks={[]}
        onClose={mockOnClose}
      />
    );

    const closeButton = screen.getByText('×');
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  test('closes dashboard when clicking on overlay', () => {
    render(
      <ReportingDashboard
        tasks={[]}
        onClose={mockOnClose}
      />
    );

    const overlay = screen.getByText('Reporting Dashboard').closest('div').parentElement;
    fireEvent.click(overlay);

    expect(mockOnClose).toHaveBeenCalled();
  });

  test('does not close dashboard when clicking on content', () => {
    render(
      <ReportingDashboard
        tasks={[]}
        onClose={mockOnClose}
      />
    );

    const content = screen.getByText('Reporting Dashboard').closest('div');
    fireEvent.click(content);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  test('calculates correct metrics for tasks with null timestamps', () => {
    const tasks = [
      {
        id: 'T-1',
        title: 'Task 1',
        repoPath: '/repo-a',
        status: 'done',
        totalTokens: 1000,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 'T-2',
        title: 'Task 2',
        repoPath: '/repo-a',
        status: 'done',
        totalTokens: 500,
        startedAt: '2026-03-14T12:00:00Z',
        completedAt: '2026-03-14T13:00:00Z',
      },
    ];

    render(
      <ReportingDashboard
        tasks={tasks}
        onClose={mockOnClose}
      />
    );

    // Should still show 2 completed tasks and 1500 tokens
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1.5k')).toBeTruthy();
  });

  test('displays correct token formatting (k for thousands)', () => {
    const tasks = [
      {
        id: 'T-1',
        title: 'Task 1',
        repoPath: '/repo-a',
        status: 'done',
        totalTokens: 5500,
        startedAt: '2026-03-14T10:00:00Z',
        completedAt: '2026-03-14T11:00:00Z',
      },
    ];

    render(
      <ReportingDashboard
        tasks={tasks}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('5.5k')).toBeTruthy();
  });
});
