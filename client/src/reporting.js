/**
 * Pure reporting helpers for filtering and aggregating completed task data.
 */

export const NO_REPO_LABEL = 'No repository';

function getTaskDurationMs(task) {
  if (!task.startedAt || !task.completedAt) return 0;
  const start = new Date(task.startedAt).getTime();
  const end = new Date(task.completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return end - start;
}

/**
 * Filter tasks to only completed ones matching the given period and repo.
 * Returns enriched task objects with normalizedRepo and durationMs.
 */
export function filterTasks(tasks, { period, date, repo }) {
  // Parse YYYY-MM-DD parts and build local-time boundaries so that the
  // calendar date chosen in the modal matches the user's local clock,
  // not UTC.
  const [year, month, day] = date.split('-').map(Number);
  const refDayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const refDayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

  return tasks
    .filter(t => t.status === 'done')
    .filter(t => {
      // For 'all' period, include every done task regardless of timestamp
      if (period === 'all') return true;

      // Date-based periods require a valid completedAt
      if (!t.completedAt) return false;
      const completed = new Date(t.completedAt);
      if (Number.isNaN(completed.getTime())) return false;

      if (period === 'day') {
        return completed >= refDayStart && completed <= refDayEnd;
      }
      if (period === 'week') {
        const weekStart = new Date(year, month - 1, day - 6, 0, 0, 0, 0);
        return completed >= weekStart && completed <= refDayEnd;
      }
      if (period === 'month') {
        const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
        return completed >= monthStart && completed <= monthEnd;
      }
      return false;
    })
    .filter(t => repo === 'all' || (t.repoPath || '') === repo)
    .map(t => ({
      ...t,
      normalizedRepo: t.repoPath || NO_REPO_LABEL,
      durationMs: getTaskDurationMs(t),
    }));
}

/**
 * Aggregate filtered tasks into a report view model.
 */
export function aggregateReport(filteredTasks) {
  if (filteredTasks.length === 0) {
    return { totalTasks: 0, totalTokens: 0, totalDurationMs: 0, repos: [], tasks: filteredTasks };
  }

  const totalTokens = filteredTasks.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
  const totalDurationMs = filteredTasks.reduce((sum, t) => sum + (t.durationMs || 0), 0);

  const repoMap = {};
  for (const t of filteredTasks) {
    const key = t.normalizedRepo;
    if (!repoMap[key]) {
      repoMap[key] = { repo: key, taskCount: 0, tokens: 0, durationMs: 0 };
    }
    repoMap[key].taskCount += 1;
    repoMap[key].tokens += t.totalTokens || 0;
    repoMap[key].durationMs += t.durationMs || 0;
  }

  const repos = Object.values(repoMap).sort((a, b) => b.taskCount - a.taskCount);

  return {
    totalTasks: filteredTasks.length,
    totalTokens,
    totalDurationMs,
    repos,
    tasks: filteredTasks,
  };
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) return 'N/A';
  const totalMinutes = Math.max(1, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function formatTokenCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n || 0);
}
