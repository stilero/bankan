import React, { useState, useMemo } from 'react';

const TIME_PERIODS = [
  { key: 'all', label: 'All Time' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
];

export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(minutes) {
  if (!minutes || minutes < 1) return '0m';
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = Math.round(minutes % 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export function getRepoName(repoPath) {
  if (!repoPath) return 'No repo';
  // Extract repo name from URL or path
  const parts = repoPath.replace(/\.git$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

export function getTimeCutoff(period) {
  if (period === 'all') return 0;
  const days = parseInt(period, 10);
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

export function computeDurationMinutes(task) {
  const start = task.startedAt ? new Date(task.startedAt).getTime() : null;
  const end = task.completedAt ? new Date(task.completedAt).getTime() : (task.status === 'done' ? Date.now() : null);
  if (!start || !end || Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.max(1, Math.floor((end - start) / 60000));
}

// Simple horizontal bar chart rendered with divs
function BarChart({ items, valueKey, formatValue, color, maxItems = 10 }) {
  if (!items.length) return <div style={{ fontSize: 11, color: 'var(--text3)', padding: '12px 0' }}>No data</div>;
  const displayed = items.slice(0, maxItems);
  const maxVal = Math.max(...displayed.map(d => d[valueKey] || 0), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {displayed.map((item, i) => (
        <div key={item.label + i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 120, fontSize: 11, color: 'var(--text2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flexShrink: 0,
          }} title={item.label}>
            {item.label}
          </span>
          <div style={{ flex: 1, height: 18, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(2, (item[valueKey] / maxVal) * 100)}%`,
              height: '100%',
              background: color,
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text)', minWidth: 48, textAlign: 'right', flexShrink: 0 }}>
            {formatValue(item[valueKey])}
          </span>
        </div>
      ))}
    </div>
  );
}

// Status distribution as colored segments
function StatusBar({ counts, total }) {
  if (!total) return null;
  const segments = [
    { key: 'done', label: 'Done', color: 'var(--green)' },
    { key: 'implementing', label: 'Implementing', color: 'var(--steel2)' },
    { key: 'review', label: 'Review', color: 'var(--purple)' },
    { key: 'planning', label: 'Planning', color: 'var(--blue)' },
    { key: 'blocked', label: 'Blocked', color: 'var(--red)' },
    { key: 'other', label: 'Other', color: 'var(--text3)' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
        {segments.map(seg => {
          const pct = ((counts[seg.key] || 0) / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${counts[seg.key]}`}
              style={{
                width: `${pct}%`,
                background: seg.color,
                transition: 'width 0.3s ease',
                minWidth: pct > 0 ? 2 : 0,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {segments.map(seg => {
          const count = counts[seg.key] || 0;
          if (!count) return null;
          return (
            <span key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text2)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              {seg.label} {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportsModal({ tasks, repos, onClose }) {
  const [timePeriod, setTimePeriod] = useState('all');
  const [repoFilter, setRepoFilter] = useState('all');

  // Filter tasks by time period and repo
  const filteredTasks = useMemo(() => {
    const cutoff = getTimeCutoff(timePeriod);
    return tasks.filter(t => {
      // Time filter: task was created or completed within the period
      if (cutoff > 0) {
        const created = new Date(t.createdAt).getTime();
        const completed = t.completedAt ? new Date(t.completedAt).getTime() : 0;
        if (created < cutoff && (!completed || completed < cutoff)) return false;
      }
      // Repo filter
      if (repoFilter !== 'all' && t.repoPath !== repoFilter) return false;
      return true;
    });
  }, [tasks, timePeriod, repoFilter]);

  // Summary stats
  const stats = useMemo(() => {
    const completed = filteredTasks.filter(t => t.status === 'done');
    const totalTokens = filteredTasks.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
    const totalMinutes = filteredTasks.reduce((sum, t) => sum + computeDurationMinutes(t), 0);
    const avgMinutes = completed.length > 0
      ? completed.reduce((sum, t) => sum + computeDurationMinutes(t), 0) / completed.length
      : 0;
    const avgTokens = completed.length > 0
      ? completed.reduce((sum, t) => sum + (t.totalTokens || 0), 0) / completed.length
      : 0;
    const totalReviewCycles = filteredTasks.reduce((sum, t) => sum + (t.reviewCycleCount || 0), 0);
    return { completed: completed.length, total: filteredTasks.length, totalTokens, totalMinutes, avgMinutes, avgTokens, totalReviewCycles };
  }, [filteredTasks]);

  // Status distribution
  const statusCounts = useMemo(() => {
    const counts = { done: 0, implementing: 0, review: 0, planning: 0, blocked: 0, other: 0 };
    for (const t of filteredTasks) {
      if (t.status === 'done') counts.done++;
      else if (t.status === 'implementing') counts.implementing++;
      else if (t.status === 'review' || t.status === 'awaiting_approval') counts.review++;
      else if (t.status === 'planning' || t.status === 'workspace_setup') counts.planning++;
      else if (t.status === 'blocked') counts.blocked++;
      else counts.other++;
    }
    return counts;
  }, [filteredTasks]);

  // Tokens by repo
  const tokensByRepo = useMemo(() => {
    const map = {};
    for (const t of filteredTasks) {
      const name = getRepoName(t.repoPath);
      map[name] = (map[name] || 0) + (t.totalTokens || 0);
    }
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTasks]);

  // Tasks by repo
  const tasksByRepo = useMemo(() => {
    const map = {};
    for (const t of filteredTasks) {
      const name = getRepoName(t.repoPath);
      map[name] = (map[name] || 0) + 1;
    }
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTasks]);

  // Time by repo
  const timeByRepo = useMemo(() => {
    const map = {};
    for (const t of filteredTasks) {
      const name = getRepoName(t.repoPath);
      map[name] = (map[name] || 0) + computeDurationMinutes(t);
    }
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTasks]);

  // Priority breakdown
  const priorityCounts = useMemo(() => {
    const map = {};
    for (const t of filteredTasks) {
      const p = t.priority || 'medium';
      map[p] = (map[p] || 0) + 1;
    }
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTasks]);

  const statCardStyle = {
    flex: 1,
    minWidth: 120,
    padding: '14px 16px',
    background: 'var(--bg2)',
    borderRadius: 8,
    border: '1px solid var(--border)',
  };

  const sectionStyle = {
    marginBottom: 24,
  };

  const sectionTitleStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text2)',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  };

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
          width: 720, maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 0',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18 }}>
              Reports
            </h2>
            <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: 16 }}>
              {'\u2715'}
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {TIME_PERIODS.map(tp => (
                <button
                  key={tp.key}
                  onClick={() => setTimePeriod(tp.key)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 4,
                    fontSize: 11,
                    border: '1px solid',
                    borderColor: timePeriod === tp.key ? 'var(--amber)' : 'var(--border)',
                    background: timePeriod === tp.key ? 'rgba(245, 166, 35, 0.15)' : 'transparent',
                    color: timePeriod === tp.key ? 'var(--amber)' : 'var(--text2)',
                  }}
                >
                  {tp.label}
                </button>
              ))}
            </div>
            {repos.length > 1 && (
              <select
                value={repoFilter}
                onChange={e => setRepoFilter(e.target.value)}
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                <option value="all">All repositories</option>
                {repos.map(r => (
                  <option key={r} value={r}>{getRepoName(r)}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '0 24px 24px',
        }}>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
            <div style={statCardStyle}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Completed</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{stats.completed}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>of {stats.total} tasks</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Total Tokens</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--steel2)' }}>{formatTokens(stats.totalTokens)}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>avg {formatTokens(Math.round(stats.avgTokens))}/task</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Total Time</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>{formatDuration(stats.totalMinutes)}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>avg {formatDuration(Math.round(stats.avgMinutes))}/task</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Review Cycles</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>{stats.totalReviewCycles}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>across all tasks</div>
            </div>
          </div>

          {/* Status distribution */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Status Distribution</div>
            <StatusBar counts={statusCounts} total={filteredTasks.length} />
          </div>

          {/* Charts in a 2-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Tasks by Repository</div>
              <BarChart items={tasksByRepo} valueKey="value" formatValue={v => String(v)} color="var(--green)" />
            </div>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Tokens by Repository</div>
              <BarChart items={tokensByRepo} valueKey="value" formatValue={formatTokens} color="var(--steel2)" />
            </div>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Time by Repository</div>
              <BarChart items={timeByRepo} valueKey="value" formatValue={formatDuration} color="var(--amber)" />
            </div>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Priority Breakdown</div>
              <BarChart
                items={priorityCounts}
                valueKey="value"
                formatValue={v => String(v)}
                color="var(--purple)"
              />
            </div>
          </div>

          {/* Completed tasks table */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Completed Tasks</div>
            {filteredTasks.filter(t => t.status === 'done').length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text3)', padding: '12px 0' }}>No completed tasks in this period</div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg2)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text2)', fontWeight: 600 }}>Task</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text2)', fontWeight: 600 }}>Repo</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text2)', fontWeight: 600 }}>Tokens</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text2)', fontWeight: 600 }}>Time</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text2)', fontWeight: 600 }}>Reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks
                      .filter(t => t.status === 'done')
                      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
                      .map(t => (
                        <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>
                            <span style={{ color: 'var(--text3)', marginRight: 6 }}>{t.id}</span>
                            {t.title}
                          </td>
                          <td style={{ padding: '8px 10px', color: 'var(--text2)' }}>{getRepoName(t.repoPath)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--steel2)' }}>{formatTokens(t.totalTokens || 0)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--amber)' }}>{formatDuration(computeDurationMinutes(t))}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--purple)' }}>{t.reviewCycleCount || 0}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
