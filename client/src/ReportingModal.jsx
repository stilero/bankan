import React, { useMemo } from 'react';

function formatTokens(tokens = 0) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens || 0);
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

export default function ReportingModal({ tasks, onClose }) {
  // Aggregate completed tasks data
  const reportData = useMemo(() => {
    const completed = tasks.filter(t => t.status === 'done');

    const byRepo = {};
    let totalTokens = 0;
    let totalTime = 0;

    completed.forEach(task => {
      const repo = task.repoPath || 'No Repository';

      if (!byRepo[repo]) {
        byRepo[repo] = {
          count: 0,
          tokens: 0,
          time: 0,
        };
      }

      byRepo[repo].count += 1;
      byRepo[repo].tokens += task.totalTokens || 0;

      const taskTime = formatTotalTime(task.startedAt, task.completedAt);
      if (taskTime) {
        // Parse time string to minutes
        const timeStr = taskTime;
        let minutes = 0;

        if (timeStr.includes('d')) {
          const [days] = timeStr.split('d');
          minutes += parseInt(days, 10) * 24 * 60;
          const rest = timeStr.split('d')[1]?.trim() || '';
          if (rest.includes('h')) {
            const [hours] = rest.split('h');
            minutes += parseInt(hours, 10) * 60;
          }
        } else if (timeStr.includes('h')) {
          const [hours] = timeStr.split('h');
          minutes += parseInt(hours, 10) * 60;
          const rest = timeStr.split('h')[1]?.trim() || '';
          if (rest.includes('m')) {
            const [mins] = rest.split('m');
            minutes += parseInt(mins, 10);
          }
        } else if (timeStr.includes('m')) {
          const [mins] = timeStr.split('m');
          minutes += parseInt(mins, 10);
        }

        byRepo[repo].time += minutes;
      }

      totalTokens += task.totalTokens || 0;
      totalTime += byRepo[repo].time;
    });

    return {
      byRepo,
      totalTokens,
      totalTime,
      completedCount: completed.length,
    };
  }, [tasks]);

  const repos = Object.entries(reportData.byRepo)
    .map(([name, stats]) => ({
      name,
      ...stats,
    }))
    .sort((a, b) => b.count - a.count);

  const maxCount = Math.max(...repos.map(r => r.count), 1);
  const maxTokens = Math.max(...repos.map(r => r.tokens), 1);

  const formatTimeFromMinutes = (minutes) => {
    const days = Math.floor(minutes / (60 * 24));
    const hours = Math.floor((minutes % (60 * 24)) / 60);
    const mins = minutes % 60;

    if (days > 0) {
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18 }}>
            Reporting Dashboard
          </h2>
          <button
            onClick={onClose}
            style={{ color: 'var(--text3)', fontSize: 16, cursor: 'pointer' }}
          >
            {'\u2715'}
          </button>
        </div>

        {/* Summary stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
          <div
            style={{
              padding: 16,
              background: 'var(--bg2)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
              Completed Tasks
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
              {reportData.completedCount}
            </div>
          </div>

          <div
            style={{
              padding: 16,
              background: 'var(--bg2)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
              Total Tokens
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--amber)' }}>
              {formatTokens(reportData.totalTokens)}
            </div>
          </div>

          <div
            style={{
              padding: 16,
              background: 'var(--bg2)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
              Total Time
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#A78BFA' }}>
              {formatTimeFromMinutes(reportData.totalTime)}
            </div>
          </div>
        </div>

        {/* Per-repo breakdown */}
        {repos.length > 0 ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                letterSpacing: 1, marginBottom: 16,
              }}>
                TASKS PER REPOSITORY
              </div>

              {repos.map(repo => (
                <div key={repo.name} style={{ marginBottom: 24 }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {repo.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {repo.count} task{repo.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {/* Animated bar chart for tasks */}
                    <div
                      style={{
                        width: '100%',
                        height: 20,
                        background: 'var(--bg2)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${(repo.count / maxCount) * 100}%`,
                          background: 'linear-gradient(90deg, var(--green), var(--text))',
                          borderRadius: 4,
                          animation: 'slide-in 0.6s ease-out',
                        }}
                      />
                    </div>
                  </div>

                  {/* Tokens bar */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                        Tokens
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--amber)' }}>
                        {formatTokens(repo.tokens)}
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: 16,
                        background: 'var(--bg2)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${(repo.tokens / maxTokens) * 100}%`,
                          background: 'linear-gradient(90deg, var(--amber), rgba(245, 166, 35, 0.5))',
                          borderRadius: 4,
                          animation: 'slide-in 0.7s ease-out',
                        }}
                      />
                    </div>
                  </div>

                  {/* Time display */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                      Time Spent
                    </span>
                    <span style={{ fontSize: 11, color: '#A78BFA', fontWeight: 500 }}>
                      {formatTimeFromMinutes(repo.time)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--text2)',
              fontSize: 13,
            }}
          >
            No completed tasks yet. Complete a task to see reporting data.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: 'var(--amber)',
              color: '#000',
              border: '1px solid var(--amber)',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* CSS animations */}
        <style>{`
          @keyframes slide-in {
            from {
              width: 0;
            }
            to {
              width: 100%;
            }
          }

          @keyframes fade-in {
            from {
              opacity: 0;
              transform: scale(0.95);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>
      </div>
    </div>
  );
}
