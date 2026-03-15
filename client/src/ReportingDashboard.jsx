import React, { useMemo } from 'react';

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0 mins';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} mins`;
  return `${hours} hrs ${minutes} mins`;
}

function getRepoName(repoPath) {
  if (!repoPath) return 'Unknown';
  return repoPath;
}

export default function ReportingDashboard({ tasks, onClose }) {
  const doneTasks = useMemo(() =>
    tasks.filter(t => t.status === 'done'),
    [tasks]
  );

  const metrics = useMemo(() => {
    const completedCount = doneTasks.length;
    const totalTokens = doneTasks.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
    const totalTime = doneTasks.reduce((sum, t) => {
      if (!t.startedAt || !t.completedAt) return sum;
      const start = new Date(t.startedAt).getTime();
      const end = new Date(t.completedAt).getTime();
      return sum + (end - start);
    }, 0);

    return {
      completedCount,
      totalTokens,
      totalTime,
    };
  }, [doneTasks]);

  const repoBreakdown = useMemo(() => {
    const breakdown = {};
    doneTasks.forEach(task => {
      const repo = task.repoPath || 'Unknown';
      if (!breakdown[repo]) {
        breakdown[repo] = {
          repoPath: repo,
          count: 0,
          tokens: 0,
          time: 0,
        };
      }
      breakdown[repo].count += 1;
      breakdown[repo].tokens += task.totalTokens || 0;
      if (task.startedAt && task.completedAt) {
        const start = new Date(task.startedAt).getTime();
        const end = new Date(task.completedAt).getTime();
        breakdown[repo].time += end - start;
      }
    });
    return Object.values(breakdown);
  }, [doneTasks]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      onClick={handleOverlayClick}
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
          width: 680, maxWidth: 'calc(100vw - 32px)', padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18 }}>
            Reporting Dashboard
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text3)',
              fontSize: 20,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Empty state */}
        {doneTasks.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text3)',
          }}>
            <p style={{ fontSize: 14 }}>No completed tasks yet</p>
          </div>
        ) : (
          <>
            {/* Overall metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
              {/* Tasks completed card */}
              <div style={{
                padding: 18,
                background: 'linear-gradient(135deg, rgba(122, 162, 247, 0.1), rgba(122, 162, 247, 0.05))',
                border: '1px solid rgba(122, 162, 247, 0.2)',
                borderRadius: 8,
              }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>Tasks Completed</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
                  {metrics.completedCount}
                </div>
              </div>

              {/* Tokens consumed card */}
              <div style={{
                padding: 18,
                background: 'linear-gradient(135deg, rgba(245, 166, 35, 0.1), rgba(245, 166, 35, 0.05))',
                border: '1px solid rgba(245, 166, 35, 0.2)',
                borderRadius: 8,
              }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>Total Tokens</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
                  {formatTokens(metrics.totalTokens)}
                </div>
              </div>

              {/* Time spent card */}
              <div style={{
                padding: 18,
                background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.1), rgba(76, 175, 80, 0.05))',
                border: '1px solid rgba(76, 175, 80, 0.2)',
                borderRadius: 8,
              }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>Total Time</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
                  {formatDuration(metrics.totalTime)}
                </div>
              </div>
            </div>

            {/* Per-repo breakdown */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                Per-Repository Breakdown
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {repoBreakdown.map((repo) => (
                  <div
                    key={repo.repoPath}
                    style={{
                      padding: 14,
                      background: 'var(--bg2)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                      {getRepoName(repo.repoPath)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Tasks</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{repo.count}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Tokens</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{formatTokens(repo.tokens)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Time</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{formatDuration(repo.time)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
