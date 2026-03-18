import React, { useState, useMemo } from 'react';
import { filterTasks, aggregateReport, formatDuration, formatTokenCount, NO_REPO_LABEL } from './reporting.js';

const PERIOD_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All Time' },
];

function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function SummaryCard({ label, value, sub }) {
  return (
    <div style={{
      flex: '1 1 140px',
      padding: '16px 18px',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-head)', color: 'var(--text)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function RepoBar({ repos, maxTasks }) {
  const COLORS = ['var(--amber)', 'var(--steel2)', 'var(--green)', 'var(--purple)', 'var(--red)', 'var(--blue)'];
  if (repos.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text2)',
        letterSpacing: 1, marginBottom: 10,
      }}>
        REPOSITORIES
      </div>
      {repos.map((r, i) => {
        const pct = maxTasks > 0 ? (r.taskCount / maxTasks) * 100 : 0;
        const color = COLORS[i % COLORS.length];
        return (
          <div key={r.repo} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={r.repo}>
                {r.repo}
              </span>
              <span style={{ color: 'var(--text3)', flexShrink: 0 }}>
                {r.taskCount} task{r.taskCount !== 1 ? 's' : ''} · {formatTokenCount(r.tokens)} tokens · {formatDuration(r.durationMs)}
              </span>
            </div>
            <div style={{
              height: 6, borderRadius: 3,
              background: 'var(--bg)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: color,
                width: `${Math.max(2, pct)}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ReportsModal({ tasks, onClose }) {
  const [period, setPeriod] = useState('week');
  const [date, setDate] = useState(() => toLocalDateString(new Date()));
  const [selectedRepo, setSelectedRepo] = useState('all');

  // Derive available repos from actual completed task data so that
  // historical repos and tasks without a repo are always selectable.
  const availableRepos = useMemo(() => {
    const set = new Set();
    for (const t of tasks) {
      if (t.status === 'done') {
        set.add(t.repoPath || NO_REPO_LABEL);
      }
    }
    return [...set].sort();
  }, [tasks]);

  const report = useMemo(() => {
    const filtered = filterTasks(tasks, { period, date, repo: selectedRepo });
    return aggregateReport(filtered);
  }, [tasks, period, date, selectedRepo]);

  const maxRepoTasks = report.repos.length > 0 ? report.repos[0].taskCount : 0;

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
          width: 680, maxWidth: 'calc(100vw - 32px)',
          maxHeight: '85vh', overflowY: 'auto',
          padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18 }}>
            Reports
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: 16 }}>
            {'\u2715'}
          </button>
        </div>

        {/* Filter bar */}
        <div style={{
          display: 'flex', gap: 10, marginBottom: 20,
          flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                style={{
                  padding: '6px 12px',
                  background: period === opt.value ? 'var(--amber)' : 'var(--bg2)',
                  color: period === opt.value ? '#000' : 'var(--text2)',
                  border: '1px solid',
                  borderColor: period === opt.value ? 'var(--amber)' : 'var(--border)',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {period !== 'all' && (
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              aria-label="Report date"
              style={{
                padding: '5px 8px', fontSize: 11,
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text)',
                colorScheme: 'dark',
              }}
            />
          )}

          <select
            value={selectedRepo}
            onChange={e => setSelectedRepo(e.target.value)}
            style={{
              padding: '5px 10px', fontSize: 11,
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text)',
            }}
          >
            <option value="all">All repositories</option>
            {availableRepos.map(r => (
              <option key={r} value={r === NO_REPO_LABEL ? '' : r}>{r}</option>
            ))}
          </select>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <SummaryCard
            label="Tasks Completed"
            value={report.totalTasks}
          />
          <SummaryCard
            label="Total Time"
            value={formatDuration(report.totalDurationMs)}
            sub="End-to-end task time"
          />
          <SummaryCard
            label="Tokens Used"
            value={formatTokenCount(report.totalTokens)}
          />
        </div>

        {/* Repo breakdown */}
        <RepoBar repos={report.repos} maxTasks={maxRepoTasks} />

        {/* Task list */}
        {report.tasks.length > 0 && (
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text2)',
              letterSpacing: 1, marginBottom: 10,
            }}>
              TASKS
            </div>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}>
              {/* Header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1.5fr 100px 80px 80px',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--bg2)',
                fontSize: 10,
                color: 'var(--text3)',
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}>
                <span>Task</span>
                <span>Repository</span>
                <span>Completed</span>
                <span style={{ textAlign: 'right' }}>Tokens</span>
                <span style={{ textAlign: 'right' }}>Time</span>
              </div>
              {report.tasks.map(t => (
                <div
                  key={t.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.5fr 100px 80px 80px',
                    gap: 8,
                    padding: '8px 12px',
                    fontSize: 11,
                    borderTop: '1px solid var(--border)',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>
                    {t.title}
                  </span>
                  <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.normalizedRepo}>
                    {t.normalizedRepo}
                  </span>
                  <span style={{ color: 'var(--text3)' }}>
                    {t.completedAt ? new Date(t.completedAt).toLocaleDateString() : '\u2014'}
                  </span>
                  <span style={{ color: 'var(--text2)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {formatTokenCount(t.totalTokens || 0)}
                  </span>
                  <span style={{ color: 'var(--text2)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {formatDuration(t.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.tasks.length === 0 && (
          <div style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--text3)',
            fontSize: 12,
          }}>
            No completed tasks for this period.
          </div>
        )}
      </div>
    </div>
  );
}
