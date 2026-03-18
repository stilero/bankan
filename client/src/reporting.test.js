import { describe, expect, test } from 'vitest';
import { filterTasks, aggregateReport, formatDuration, formatTokenCount, NO_REPO_LABEL } from './reporting.js';

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

describe('filterTasks', () => {
  const tasks = [
    makeDoneTask({ id: 'T-1', completedAt: '2026-03-18T08:00:00Z', repoPath: '/repo-a' }),
    makeDoneTask({ id: 'T-2', completedAt: '2026-03-17T08:00:00Z', repoPath: '/repo-b' }),
    makeDoneTask({ id: 'T-3', completedAt: '2026-03-12T08:00:00Z', repoPath: '/repo-a' }),
    makeDoneTask({ id: 'T-4', completedAt: '2026-03-01T08:00:00Z', repoPath: '/repo-a' }),
    makeDoneTask({ id: 'T-5', completedAt: '2026-02-15T08:00:00Z', repoPath: '/repo-b' }),
    { id: 'T-6', status: 'implementing', repoPath: '/repo-a', completedAt: null },
  ];

  test('filters by day period', () => {
    const result = filterTasks(tasks, { period: 'day', date: '2026-03-18', repo: 'all' });
    expect(result.map(t => t.id)).toEqual(['T-1']);
  });

  test('filters by week period (rolling 7-day window)', () => {
    const result = filterTasks(tasks, { period: 'week', date: '2026-03-18', repo: 'all' });
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-2', 'T-3']);
  });

  test('filters by month period', () => {
    const result = filterTasks(tasks, { period: 'month', date: '2026-03-18', repo: 'all' });
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
  });

  test('filters by all-time', () => {
    const result = filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: 'all' });
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4', 'T-5']);
  });

  test('filters by specific repository', () => {
    const result = filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: '/repo-b' });
    expect(result.map(t => t.id)).toEqual(['T-2', 'T-5']);
  });

  test('excludes non-done tasks', () => {
    const result = filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: 'all' });
    expect(result.find(t => t.id === 'T-6')).toBeUndefined();
  });

  test('handles tasks with missing completedAt', () => {
    const withMissing = [
      ...tasks,
      makeDoneTask({ id: 'T-7', completedAt: null }),
    ];
    const result = filterTasks(withMissing, { period: 'all', date: '2026-03-18', repo: 'all' });
    expect(result.find(t => t.id === 'T-7')).toBeUndefined();
  });

  test('normalizes empty repoPath to "No repository"', () => {
    const withEmpty = [makeDoneTask({ id: 'T-8', repoPath: '', completedAt: '2026-03-18T10:00:00Z' })];
    const result = filterTasks(withEmpty, { period: 'all', date: '2026-03-18', repo: 'all' });
    expect(result[0].normalizedRepo).toBe('No repository');
    expect(result[0].normalizedRepo).toBe(NO_REPO_LABEL);
  });

  test('can filter by empty repoPath using empty string', () => {
    const mixed = [
      makeDoneTask({ id: 'T-8', repoPath: '', completedAt: '2026-03-18T10:00:00Z' }),
      makeDoneTask({ id: 'T-9', repoPath: '/repo-a', completedAt: '2026-03-18T10:00:00Z' }),
    ];
    const result = filterTasks(mixed, { period: 'all', date: '2026-03-18', repo: '' });
    expect(result.map(t => t.id)).toEqual(['T-8']);
  });
});

describe('aggregateReport', () => {
  test('computes totals and per-repo breakdown', () => {
    const tasks = [
      makeDoneTask({ id: 'T-1', repoPath: '/repo-a', totalTokens: 1000, startedAt: '2026-03-10T10:00:00Z', completedAt: '2026-03-10T11:30:00Z' }),
      makeDoneTask({ id: 'T-2', repoPath: '/repo-a', totalTokens: 2000, startedAt: '2026-03-11T10:00:00Z', completedAt: '2026-03-11T12:00:00Z' }),
      makeDoneTask({ id: 'T-3', repoPath: '/repo-b', totalTokens: 500, startedAt: '2026-03-12T10:00:00Z', completedAt: '2026-03-12T10:45:00Z' }),
    ];

    const report = aggregateReport(filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: 'all' }));

    expect(report.totalTasks).toBe(3);
    expect(report.totalTokens).toBe(3500);
    expect(report.totalDurationMs).toBeGreaterThan(0);
    expect(report.repos).toHaveLength(2);
    expect(report.repos.find(r => r.repo === '/repo-a').taskCount).toBe(2);
    expect(report.repos.find(r => r.repo === '/repo-b').taskCount).toBe(1);
  });

  test('handles tasks with missing timestamps gracefully', () => {
    const tasks = [
      makeDoneTask({ id: 'T-1', totalTokens: 500, startedAt: null, completedAt: '2026-03-10T11:30:00Z' }),
      makeDoneTask({ id: 'T-2', totalTokens: 300, startedAt: '2026-03-11T10:00:00Z', completedAt: '2026-03-11T11:00:00Z' }),
    ];

    const report = aggregateReport(filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: 'all' }));

    expect(report.totalTasks).toBe(2);
    expect(report.totalTokens).toBe(800);
    // Only the second task contributes duration
    expect(report.totalDurationMs).toBe(60 * 60 * 1000);
  });

  test('handles zero tokens', () => {
    const tasks = [makeDoneTask({ totalTokens: 0 })];
    const report = aggregateReport(filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: 'all' }));
    expect(report.totalTokens).toBe(0);
  });

  test('returns empty report for no tasks', () => {
    const report = aggregateReport([]);
    expect(report.totalTasks).toBe(0);
    expect(report.totalTokens).toBe(0);
    expect(report.totalDurationMs).toBe(0);
    expect(report.repos).toEqual([]);
    expect(report.tasks).toEqual([]);
  });

  test('sorts repos by task count descending', () => {
    const tasks = [
      makeDoneTask({ id: 'T-1', repoPath: '/repo-b', completedAt: '2026-03-10T11:30:00Z' }),
      makeDoneTask({ id: 'T-2', repoPath: '/repo-a', completedAt: '2026-03-10T11:30:00Z' }),
      makeDoneTask({ id: 'T-3', repoPath: '/repo-a', completedAt: '2026-03-10T11:30:00Z' }),
    ];

    const report = aggregateReport(filterTasks(tasks, { period: 'all', date: '2026-03-18', repo: 'all' }));
    expect(report.repos[0].repo).toBe('/repo-a');
    expect(report.repos[1].repo).toBe('/repo-b');
  });
});

describe('formatDuration', () => {
  test('formats minutes only', () => {
    expect(formatDuration(45 * 60 * 1000)).toBe('45m');
  });

  test('formats hours and minutes', () => {
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
  });

  test('formats days and hours', () => {
    expect(formatDuration(26 * 60 * 60 * 1000)).toBe('1d 2h');
  });

  test('returns N/A for zero or invalid', () => {
    expect(formatDuration(0)).toBe('N/A');
    expect(formatDuration(-1000)).toBe('N/A');
    expect(formatDuration(null)).toBe('N/A');
  });
});

describe('formatTokenCount', () => {
  test('formats thousands', () => {
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(25000)).toBe('25.0k');
  });

  test('formats millions', () => {
    expect(formatTokenCount(1500000)).toBe('1.5M');
  });

  test('returns raw number below 1000', () => {
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(0)).toBe('0');
  });
});
