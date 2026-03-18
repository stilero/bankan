import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ReportsModal from './ReportsModal.jsx';

const makeDoneTask = (overrides = {}) => ({
  id: 'T-1',
  title: 'Test task',
  status: 'done',
  repoPath: '/repo-a',
  totalTokens: 1000,
  startedAt: '2026-03-10T10:00:00Z',
  completedAt: '2026-03-10T11:30:00Z',
  ...overrides,
});

describe('ReportsModal', () => {
  test('changing the date updates the displayed report', () => {
    const tasks = [
      makeDoneTask({ id: 'T-1', completedAt: '2026-03-18T08:00:00Z', totalTokens: 500 }),
      makeDoneTask({ id: 'T-2', completedAt: '2026-03-10T08:00:00Z', totalTokens: 1200 }),
    ];

    render(<ReportsModal tasks={tasks} onClose={vi.fn()} />);

    // Default period is 'week' — only T-1 (2026-03-18) should be in the
    // rolling 7-day window from today (test assumes modal opens with current
    // date which is 2026-03-18 per CLAUDE.md).
    // Click 'Day' to narrow to a single day.
    fireEvent.click(screen.getByText('Day'));
    expect(screen.getByText('1')).toBeTruthy(); // 1 task completed

    // Change date to 2026-03-10 — now only T-2 should appear
    const dateInput = screen.getByLabelText('Report date');
    fireEvent.change(dateInput, { target: { value: '2026-03-10' } });

    // The summary card and task row should both show 1.2k tokens
    expect(screen.getAllByText('1.2k').length).toBeGreaterThanOrEqual(1);
  });

  test('date input is hidden when period is All Time', () => {
    render(<ReportsModal tasks={[]} onClose={vi.fn()} />);

    // Default period is 'week', date input should be visible
    expect(screen.getByLabelText('Report date')).toBeTruthy();

    // Switch to All Time
    fireEvent.click(screen.getByText('All Time'));
    expect(screen.queryByLabelText('Report date')).toBeNull();
  });

  test('renders empty state when no tasks match', () => {
    render(<ReportsModal tasks={[]} onClose={vi.fn()} />);
    expect(screen.getByText('No completed tasks for this period.')).toBeTruthy();
  });

  test('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ReportsModal tasks={[]} onClose={onClose} />);
    fireEvent.click(screen.getByText('\u2715'));
    expect(onClose).toHaveBeenCalled();
  });
});
