import React from 'react';

function formatTokens(tokens = 0) {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens || 0));
}

function formatDuration(durationMs = 0) {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatRepoSubtitle(repo) {
  if (repo.doneCount === 0) return 'No completed tasks yet';
  return `${repo.doneCount} completed task${repo.doneCount === 1 ? '' : 's'}`;
}

export default function ReportingModal({ report, onClose }) {
  const maxDone = Math.max(...report.repos.map(repo => repo.doneCount), 1);
  const maxDuration = Math.max(...report.repos.map(repo => repo.activeDurationMs), 1);
  const maxTokens = Math.max(...report.repos.map(repo => repo.totalTokens), 1);

  return (
    <div
      className="reporting-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 110,
      }}
    >
      <div
        className="reporting-shell"
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(1120px, 100%)',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: 24,
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(180deg, rgba(17,17,20,0.98) 0%, rgba(12,12,14,0.98) 100%)',
          boxShadow: '0 40px 90px rgba(0,0,0,0.55)',
          animation: 'reporting-rise 0.28s ease-out',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}>
          <div style={{ maxWidth: 680 }}>
            <div style={{
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: 'var(--amber)',
              marginBottom: 10,
            }}>
              Reporting
            </div>
            <h2 style={{
              fontFamily: 'var(--font-head)',
              fontSize: 'clamp(28px, 5vw, 46px)',
              lineHeight: 1,
              marginBottom: 12,
            }}>
              Repository throughput at a glance
            </h2>
            <p style={{
              color: 'var(--text2)',
              fontSize: 13,
              lineHeight: 1.7,
              maxWidth: 600,
            }}>
              Completed delivery, active work time, and token usage are derived directly from persisted task state.
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              alignSelf: 'flex-start',
              width: 36,
              height: 36,
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--text2)',
              fontSize: 16,
            }}
            aria-label="Close reporting"
          >
            {'\u2715'}
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}>
          {[
            {
              label: 'Completed Tasks',
              value: report.totals.doneCount,
              accent: 'var(--green)',
              tone: 'rgba(61,220,132,0.14)',
            },
            {
              label: 'Active Work Time',
              value: formatDuration(report.totals.activeDurationMs),
              accent: 'var(--amber)',
              tone: 'rgba(245,166,35,0.14)',
            },
            {
              label: 'Total Tokens',
              value: formatTokens(report.totals.totalTokens),
              accent: 'var(--steel2)',
              tone: 'rgba(106,171,219,0.14)',
            },
            {
              label: 'Repositories',
              value: report.totals.repoCount,
              accent: 'var(--purple)',
              tone: 'rgba(167,139,250,0.14)',
            },
          ].map(metric => (
            <div
              key={metric.label}
              className="reporting-card"
              style={{
                position: 'relative',
                overflow: 'hidden',
                padding: 18,
                borderRadius: 18,
                border: '1px solid rgba(255,255,255,0.08)',
                background: `linear-gradient(160deg, ${metric.tone} 0%, rgba(255,255,255,0.02) 100%)`,
              }}
            >
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, color: 'var(--text3)' }}>
                {metric.label}
              </div>
              <div style={{
                marginTop: 14,
                fontSize: 'clamp(24px, 4vw, 34px)',
                fontFamily: 'var(--font-head)',
                color: metric.accent,
                lineHeight: 1,
              }}>
                {metric.value}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 18,
        }}>
          <div style={{
            padding: 18,
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text3)' }}>
                  Per Repository
                </div>
                <div style={{ fontSize: 18, color: 'var(--text)', marginTop: 4 }}>
                  Ranked output and spend
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Sorted by completed tasks, then work time, then tokens
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.repos.length === 0 && (
                <div style={{
                  padding: 24,
                  borderRadius: 18,
                  border: '1px dashed rgba(255,255,255,0.12)',
                  color: 'var(--text2)',
                  textAlign: 'center',
                }}>
                  No repository-linked task data has been recorded yet.
                </div>
              )}

              {report.repos.map((repo, index) => (
                <div
                  key={repo.key}
                  className="reporting-card"
                  style={{
                    padding: 16,
                    borderRadius: 18,
                    border: '1px solid rgba(255,255,255,0.06)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)',
                    animationDelay: `${index * 45}ms`,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 14,
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 11,
                        letterSpacing: 1.5,
                        color: 'var(--text3)',
                        textTransform: 'uppercase',
                        marginBottom: 6,
                      }}>
                        #{String(index + 1).padStart(2, '0')}
                      </div>
                      <div style={{
                        fontSize: 16,
                        color: 'var(--text)',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {repo.label}
                      </div>
                      <div style={{ marginTop: 4, color: 'var(--text2)', fontSize: 12 }}>
                        {formatRepoSubtitle(repo)}
                      </div>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(78px, 1fr))',
                      gap: 10,
                      minWidth: 'min(100%, 280px)',
                    }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' }}>Done</div>
                        <div style={{ marginTop: 4, fontSize: 18, color: 'var(--green)' }}>{repo.doneCount}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' }}>Time</div>
                        <div style={{ marginTop: 4, fontSize: 18, color: 'var(--amber)' }}>{formatDuration(repo.activeDurationMs)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' }}>Tokens</div>
                        <div style={{ marginTop: 4, fontSize: 18, color: 'var(--steel2)' }}>{formatTokens(repo.totalTokens)}</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    {[
                      {
                        label: 'Completed',
                        value: repo.doneCount,
                        max: maxDone,
                        accent: 'linear-gradient(90deg, rgba(61,220,132,0.95) 0%, rgba(61,220,132,0.35) 100%)',
                      },
                      {
                        label: 'Active Time',
                        value: repo.activeDurationMs,
                        max: maxDuration,
                        accent: 'linear-gradient(90deg, rgba(245,166,35,0.95) 0%, rgba(245,166,35,0.35) 100%)',
                      },
                      {
                        label: 'Tokens',
                        value: repo.totalTokens,
                        max: maxTokens,
                        accent: 'linear-gradient(90deg, rgba(106,171,219,0.95) 0%, rgba(106,171,219,0.35) 100%)',
                      },
                    ].map(bar => (
                      <div key={bar.label}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          fontSize: 11,
                          color: 'var(--text3)',
                          marginBottom: 4,
                        }}>
                          <span>{bar.label}</span>
                          <span>{Math.max(0, Math.round((bar.value / bar.max) * 100))}%</span>
                        </div>
                        <div style={{
                          height: 8,
                          borderRadius: 999,
                          background: 'rgba(255,255,255,0.06)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: bar.value <= 0 ? '0%' : `${Math.max(4, (bar.value / bar.max) * 100)}%`,
                            height: '100%',
                            borderRadius: 999,
                            background: bar.accent,
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gap: 18,
            alignContent: 'start',
          }}>
            <div style={{
              padding: 18,
              borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(180deg, rgba(245,166,35,0.12) 0%, rgba(245,166,35,0.03) 100%)',
            }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--amber)' }}>
                Leading Repository
              </div>
              <div style={{
                marginTop: 10,
                fontSize: 24,
                fontFamily: 'var(--font-head)',
                lineHeight: 1.1,
              }}>
                {report.topRepo?.label || 'No repository data'}
              </div>
              <div style={{ marginTop: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                {report.topRepo
                  ? `${report.topRepo.doneCount} completed tasks with ${formatDuration(report.topRepo.activeDurationMs)} of active work and ${formatTokens(report.topRepo.totalTokens)} tokens consumed.`
                  : 'Complete some work to populate ranked repository insights.'}
              </div>
            </div>

            <div style={{
              padding: 18,
              borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
            }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text3)' }}>
                Metric Notes
              </div>
              <div style={{ marginTop: 12, display: 'grid', gap: 10, color: 'var(--text2)', lineHeight: 1.6 }}>
                <div>Completed tasks count only tasks currently in `done`.</div>
                <div>Active work time tracks `workspace_setup`, `planning`, `implementing`, and `review`.</div>
                <div>Token totals reflect the persisted per-task `totalTokens` values already streamed to the dashboard.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
