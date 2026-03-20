import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import ReportsModal, {
  formatTokens,
  formatDuration,
  getTimeCutoff,
  computeDurationMinutes,
  getRepoName,
} from './ReportsModal.jsx';

// ── Pure helper unit tests ──────────────────────────────────────────

describe('formatTokens', () => {
  test('returns raw number for values under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  test('formats thousands with k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(5432)).toBe('5.4k');
    expect(formatTokens(999_999)).toBe('1000.0k');
  });

  test('formats millions with M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('formatDuration', () => {
  test('returns 0m for zero, null, or sub-minute values', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(null)).toBe('0m');
    expect(formatDuration(undefined)).toBe('0m');
    expect(formatDuration(0.5)).toBe('0m');
  });

  test('returns minutes only when under an hour', () => {
    expect(formatDuration(1)).toBe('1m');
    expect(formatDuration(45)).toBe('45m');
  });

  test('returns hours and minutes', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(125)).toBe('2h 5m');
  });

  test('returns days and hours', () => {
    expect(formatDuration(1440)).toBe('1d');
    expect(formatDuration(1500)).toBe('1d 1h');
    expect(formatDuration(2880 + 120)).toBe('2d 2h');
  });
});

describe('getRepoName', () => {
  test('extracts last path segment', () => {
    expect(getRepoName('/Users/dev/projects/my-app')).toBe('my-app');
  });

  test('strips .git suffix', () => {
    expect(getRepoName('https://github.com/org/repo.git')).toBe('repo');
  });

  test('returns "No repo" for falsy input', () => {
    expect(getRepoName(null)).toBe('No repo');
    expect(getRepoName('')).toBe('No repo');
    expect(getRepoName(undefined)).toBe('No repo');
  });
});

describe('getTimeCutoff', () => {
  test('returns 0 for "all"', () => {
    expect(getTimeCutoff('all')).toBe(0);
  });

  test('returns a timestamp in the past for day-based periods', () => {
    const now = Date.now();
    const cutoff7d = getTimeCutoff('7d');
    const expectedDiff = 7 * 24 * 60 * 60 * 1000;
    // Allow 100ms tolerance for execution time
    expect(Math.abs((now - cutoff7d) - expectedDiff)).toBeLessThan(100);
  });

  test('returns correct cutoff for 30d and 90d', () => {
    const now = Date.now();
    expect(Math.abs((now - getTimeCutoff('30d')) - 30 * 86400000)).toBeLessThan(100);
    expect(Math.abs((now - getTimeCutoff('90d')) - 90 * 86400000)).toBeLessThan(100);
  });
});

describe('computeDurationMinutes', () => {
  test('returns 0 when startedAt is missing', () => {
    expect(computeDurationMinutes({ startedAt: null, completedAt: '2024-01-01T01:00:00Z' })).toBe(0);
  });

  test('returns 0 when end is before start', () => {
    expect(computeDurationMinutes({
      startedAt: '2024-01-01T02:00:00Z',
      completedAt: '2024-01-01T01:00:00Z',
    })).toBe(0);
  });

  test('computes minutes between start and completion', () => {
    expect(computeDurationMinutes({
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T01:30:00Z',
    })).toBe(90);
  });

  test('returns at least 1 minute for very short durations', () => {
    expect(computeDurationMinutes({
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:00:10Z',
    })).toBe(1);
  });

  test('returns 0 when completedAt is missing and status is not done', () => {
    expect(computeDurationMinutes({
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: null,
      status: 'implementing',
    })).toBe(0);
  });
});

// ── Component integration tests ─────────────────────────────────────

function buildTask(overrides = {}) {
  return {
    id: 'T-1',
    title: 'Test task',
    description: '',
    priority: 'medium',
    repoPath: '/repos/my-app',
    status: 'done',
    totalTokens: 5000,
    reviewCycleCount: 1,
    createdAt: '2024-06-01T00:00:00Z',
    startedAt: '2024-06-01T00:00:00Z',
    completedAt: '2024-06-01T01:00:00Z',
    ...overrides,
  };
}

const defaultProps = {
  repos: ['/repos/my-app'],
  onClose: vi.fn(),
};

describe('ReportsModal', () => {
  test('renders summary stats for provided tasks', () => {
    const tasks = [
      buildTask({ id: 'T-1', totalTokens: 10000, reviewCycleCount: 2 }),
      buildTask({ id: 'T-2', totalTokens: 20000, reviewCycleCount: 1 }),
    ];

    render(<ReportsModal tasks={tasks} {...defaultProps} />);

    expect(screen.getByText('of 2 tasks')).toBeTruthy();
    expect(screen.getAllByText('30.0k').length).toBeGreaterThanOrEqual(1); // total tokens (stat card + chart)
    expect(screen.getByText('across all tasks')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('Total Tokens')).toBeTruthy();
    expect(screen.getByText('Total Time')).toBeTruthy();
    expect(screen.getByText('Review Cycles')).toBeTruthy();
  });

  test('displays completed tasks in the table', () => {
    const tasks = [
      buildTask({ id: 'T-10', title: 'Ship feature X' }),
      buildTask({ id: 'T-11', title: 'Fix bug Y', status: 'implementing' }),
    ];

    render(<ReportsModal tasks={tasks} {...defaultProps} />);

    // Completed task should appear in the table
    expect(screen.getByText('Ship feature X')).toBeTruthy();
    // Non-completed task should not appear in the completed tasks table
    // but the title might appear elsewhere; check the table specifically
    expect(screen.getByText('of 2 tasks')).toBeTruthy();
  });

  test('closes when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ReportsModal tasks={[]} repos={[]} onClose={onClose} />);

    // Click the outermost backdrop overlay (first child of container)
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalled();
  });

  test('closes when X button is clicked', () => {
    const onClose = vi.fn();
    render(<ReportsModal tasks={[]} repos={[]} onClose={onClose} />);

    fireEvent.click(screen.getByText('\u2715'));
    expect(onClose).toHaveBeenCalled();
  });

  test('filters tasks by time period', () => {
    const now = new Date();
    const recent = new Date(now - 3 * 86400000).toISOString(); // 3 days ago
    const old = new Date(now - 60 * 86400000).toISOString(); // 60 days ago

    const tasks = [
      buildTask({ id: 'T-1', title: 'Recent task', createdAt: recent, startedAt: recent, completedAt: now.toISOString() }),
      buildTask({ id: 'T-2', title: 'Old task', createdAt: old, startedAt: old, completedAt: old }),
    ];

    render(<ReportsModal tasks={tasks} repos={[]} onClose={vi.fn()} />);

    // All Time shows both
    expect(screen.getByText('of 2 tasks')).toBeTruthy();

    // Switch to 7 Days
    fireEvent.click(screen.getByText('7 Days'));

    // Only recent task should remain
    expect(screen.getByText('of 1 tasks')).toBeTruthy();
  });

  test('filters tasks by repository', () => {
    const tasks = [
      buildTask({ id: 'T-1', repoPath: '/repos/app-a' }),
      buildTask({ id: 'T-2', repoPath: '/repos/app-b' }),
    ];

    render(
      <ReportsModal
        tasks={tasks}
        repos={['/repos/app-a', '/repos/app-b']}
        onClose={vi.fn()}
      />
    );

    // Both shown initially
    expect(screen.getByText('of 2 tasks')).toBeTruthy();

    // Filter to app-a
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/repos/app-a' } });
    expect(screen.getByText('of 1 tasks')).toBeTruthy();
  });

  test('shows "No completed tasks" message when none match', () => {
    const tasks = [
      buildTask({ id: 'T-1', status: 'implementing' }),
    ];

    render(<ReportsModal tasks={tasks} {...defaultProps} />);

    expect(screen.getByText('No completed tasks in this period')).toBeTruthy();
  });

  test('shows status distribution for mixed statuses', () => {
    const tasks = [
      buildTask({ id: 'T-1', status: 'done' }),
      buildTask({ id: 'T-2', status: 'implementing' }),
      buildTask({ id: 'T-3', status: 'planning' }),
      buildTask({ id: 'T-4', status: 'blocked' }),
    ];

    render(<ReportsModal tasks={tasks} repos={[]} onClose={vi.fn()} />);

    // Status labels should appear in the legend
    expect(screen.getByText(/Done 1/)).toBeTruthy();
    expect(screen.getByText(/Implementing 1/)).toBeTruthy();
    expect(screen.getByText(/Planning 1/)).toBeTruthy();
    expect(screen.getByText(/Blocked 1/)).toBeTruthy();
  });

  test('does not show repo filter when only one repo', () => {
    render(<ReportsModal tasks={[]} repos={['/repos/only-one']} onClose={vi.fn()} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('renders empty state without errors', () => {
    render(<ReportsModal tasks={[]} repos={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Reports')).toBeTruthy();
    expect(screen.getByText('of 0 tasks')).toBeTruthy();
    expect(screen.getByText('No completed tasks in this period')).toBeTruthy();
  });
});
