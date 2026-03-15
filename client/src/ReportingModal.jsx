import React, { useMemo } from 'react';

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatTotalTime(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;

  const totalMinutes = Math.max(1, Math.floor((end - start) / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export default function ReportingModal({ tasks = [], onClose }) {
  const aggregatedStats = useMemo(() => {
    const doneTasks = tasks.filter(t => t.status === 'done');

    if (doneTasks.length === 0) {
      return { repos: {}, globalTotals: { taskCount: 0, totalTokens: 0, totalTime: 0 } };
    }

    const repoStats = {};
    let globalTokens = 0;
    let globalTimeMs = 0;

    doneTasks.forEach(task => {
      const repoKey = task.repoPath || 'Uncategorized';

      if (!repoStats[repoKey]) {
        repoStats[repoKey] = { taskCount: 0, totalTokens: 0, totalTimeMs: 0 };
      }

      repoStats[repoKey].taskCount += 1;
      repoStats[repoKey].totalTokens += task.totalTokens || 0;

      // Calculate time for this task
      const timeStr = formatTotalTime(task.startedAt, task.completedAt);
      if (timeStr && task.startedAt && task.completedAt) {
        const start = new Date(task.startedAt).getTime();
        const end = new Date(task.completedAt).getTime();
        const taskTimeMs = Math.max(0, end - start);
        repoStats[repoKey].totalTimeMs += taskTimeMs;
        globalTimeMs += taskTimeMs;
      }

      globalTokens += task.totalTokens || 0;
    });

    return {
      repos: repoStats,
      globalTotals: {
        taskCount: doneTasks.length,
        totalTokens: globalTokens,
        totalTimeMs: globalTimeMs,
      },
    };
  }, [tasks]);

  const formatTimeFromMs = (ms) => {
    if (ms <= 0) return '0m';
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };

  const repoPaths = Object.keys(aggregatedStats.repos).sort();
  const hasData = repoPaths.length > 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 700, maxWidth: 'calc(100vw - 32px)', maxHeight: '80vh', overflowY: 'auto',
          padding: 28,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 24,
        }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 20 }}>
            Reports
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: 16 }}>
            {'\u2715'}
          </button>
        </div>

        {!hasData ? (
          <div style={{
            padding: 32,
            textAlign: 'center',
            color: 'var(--text2)',
            fontSize: 14,
          }}>
            No completed tasks yet. Complete some tasks to see reporting metrics.
          </div>
        ) : (
          <>
            {/* Grid of repo cards */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16, marginBottom: 24,
            }}>
              {repoPaths.map(repoPath => {
                const stats = aggregatedStats.repos[repoPath];
                const repoName = repoPath === 'Uncategorized' ? repoPath : repoPath.split('/').pop();
                const displayRepoPath = repoPath === 'Uncategorized' ? '' : repoPath;
                const bgColor = repoPath === 'Uncategorized' ? 'var(--bg2)' : 'var(--bg2)';

                return (
                  <div
                    key={repoPath}
                    style={{
                      padding: 18,
                      background: bgColor,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      display: 'flex', flexDirection: 'column', gap: 14,
                    }}
                  >
                    {/* Repo header with colored dot */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: 'var(--green)',
                        flexShrink: 0, marginTop: 3,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                          {repoName}
                        </div>
                        {displayRepoPath && (
                          <div style={{
                            fontSize: 10, color: 'var(--text3)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }} title={displayRepoPath}>
                            {displayRepoPath}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>Tasks Done</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)' }}>
                          {stats.taskCount}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>Total Tokens</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                          {formatTokens(stats.totalTokens)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>Total Time</span>
                        <span style={{ fontSize: 12, color: 'var(--steel2)' }}>
                          {formatTimeFromMs(stats.totalTimeMs)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Global totals summary */}
            <div style={{
              padding: 18,
              background: 'rgba(61, 220, 132, 0.08)',
              border: '1px solid rgba(61, 220, 132, 0.3)',
              borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
                Global Totals
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                gap: 16,
              }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4 }}>
                    TASKS COMPLETED
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--green)' }}>
                    {aggregatedStats.globalTotals.taskCount}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4 }}>
                    TOTAL TOKENS
                  </div>
                  <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text)' }}>
                    {formatTokens(aggregatedStats.globalTotals.totalTokens)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4 }}>
                    TOTAL TIME
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--steel2)' }}>
                    {formatTimeFromMs(aggregatedStats.globalTotals.totalTimeMs)}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
