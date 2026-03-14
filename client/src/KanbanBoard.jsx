import React, { useRef, useState, useEffect, useMemo } from 'react';
import KanbanColumn from './KanbanColumn.jsx';

function StageIcon({ children }) {
  return (
    <svg
      viewBox='0 0 16 16'
      aria-hidden='true'
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    >
      {children}
    </svg>
  );
}

const COLUMNS = [
  {
    id: 'backlog',
    title: 'Backlog',
    icon: (
      <StageIcon>
        <rect x='2.5' y='3' width='11' height='10' rx='2' fill='none' stroke='currentColor' strokeWidth='1.5' />
        <path d='M5 6h6M5 8.5h6M5 11h3.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      </StageIcon>
    ),
    statuses: ['backlog', 'paused', 'aborted'],
    agentPrefix: null,
    color: 'var(--text3)',
  },
  {
    id: 'planning',
    title: 'Planning',
    icon: (
      <StageIcon>
        <path d='M4 12.5h2.25l5.75-5.75-2.25-2.25L4 10.25v2.25Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
        <path d='M8.75 5.75 11 8' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
        <path d='M3.5 13h9' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      </StageIcon>
    ),
    statuses: ['workspace_setup', 'planning', 'awaiting_approval'],
    agentPrefix: 'plan',
    color: 'var(--steel2)',
  },
  {
    id: 'implementation',
    title: 'Implementation',
    icon: (
      <StageIcon>
        <path d='m6.25 4.5 1.25-1.25 5 5L11.25 9.5l-.9-.9-1.6 1.6a1.5 1.5 0 0 1-2.12 0l-.83-.83a1.5 1.5 0 0 1 0-2.12l1.6-1.6-.9-.9Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
        <path d='M4 12.25 7.5 8.75' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
        <path d='m3.5 10.5 2 2' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      </StageIcon>
    ),
    statuses: ['queued', 'implementing'],
    agentPrefix: 'imp',
    color: 'var(--green)',
  },
  {
    id: 'review',
    title: 'Review',
    icon: (
      <StageIcon>
        <path d='M1.75 8s2.25-3.75 6.25-3.75S14.25 8 14.25 8 12 11.75 8 11.75 1.75 8 1.75 8Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
        <circle cx='8' cy='8' r='1.75' fill='none' stroke='currentColor' strokeWidth='1.5' />
      </StageIcon>
    ),
    statuses: ['review'],
    agentPrefix: 'rev',
    color: 'var(--yellow)',
  },
  {
    id: 'done',
    title: 'Done',
    icon: (
      <StageIcon>
        <circle cx='8' cy='8' r='5.25' fill='none' stroke='currentColor' strokeWidth='1.5' />
        <path d='m5.5 8 1.5 1.5 3.5-3.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
      </StageIcon>
    ),
    statuses: ['done'],
    agentPrefix: null,
    color: 'var(--green)',
  },
];

export default function KanbanBoard({
  tasks,
  agents,
  onApprove,
  onReject,
  onAgentClick,
  onAddTask,
  hasConfiguredRepos,
  shouldShowRepoSetup,
  onOpenSettings,
  onTaskClick,
}) {
  const prevTaskStatusRef = useRef(new Map());
  const [animatingTasks, setAnimatingTasks] = useState(new Set());

  // Track status changes for card-enter animation
  useEffect(() => {
    const prev = prevTaskStatusRef.current;
    const newAnimating = new Set();

    tasks.forEach(task => {
      const prevStatus = prev.get(task.id);
      if (prevStatus && prevStatus !== task.status) {
        newAnimating.add(task.id);
      }
    });

    if (newAnimating.size > 0) {
      setAnimatingTasks(newAnimating);
      const timer = setTimeout(() => setAnimatingTasks(new Set()), 350);
      return () => clearTimeout(timer);
    }

    // Update ref
    const next = new Map();
    tasks.forEach(t => next.set(t.id, t.status));
    prevTaskStatusRef.current = next;
  }, [tasks]);

  // Also update ref when no animations triggered
  useEffect(() => {
    const next = new Map();
    tasks.forEach(t => next.set(t.id, t.status));
    prevTaskStatusRef.current = next;
  }, [tasks]);

  // Sort tasks into columns
  const columnTasks = useMemo(() => {
    const result = {};
    COLUMNS.forEach(col => { result[col.id] = []; });

    tasks.forEach(task => {
      if (task.status === 'blocked') {
        const stageColumn = COLUMNS.find(c => c.id === task.lastActiveStage);
        if (stageColumn) {
          result[stageColumn.id].push(task);
          return;
        }
        if (task.assignedTo) {
          const assignedColumn = COLUMNS.find(c => c.agentPrefix && task.assignedTo.startsWith(c.agentPrefix));
          if (assignedColumn) {
            result[assignedColumn.id].push(task);
            return;
          }
        }
        result['backlog'].push(task);
        return;
      }

      const col = COLUMNS.find(c => c.statuses.includes(task.status));
      if (col) {
        result[col.id].push(task);
      } else {
        result['backlog'].push(task);
      }
    });

    for (const column of COLUMNS) {
      result[column.id].sort((a, b) => {
        if (a.status === 'blocked' && b.status !== 'blocked') return -1;
        if (a.status !== 'blocked' && b.status === 'blocked') return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    return result;
  }, [tasks]);

  if (shouldShowRepoSetup) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 20,
        background: 'var(--bg)',
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          width: 'min(860px, 100%)',
          margin: '0 auto',
          padding: '36px 40px',
          background: 'linear-gradient(135deg, rgba(245, 166, 35, 0.12), rgba(122, 162, 247, 0.08))',
          border: '1px solid rgba(245, 166, 35, 0.24)',
          borderRadius: 16,
          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.22)',
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: 'var(--amber)',
            marginBottom: 10,
          }}>
            Welcome to Ban Kan
          </div>
          <h2 style={{
            margin: '0 0 12px',
            fontFamily: 'var(--font-head)',
            fontSize: 28,
            lineHeight: 1.1,
          }}>
            Configure a repository before creating your first task
          </h2>
          <p style={{
            margin: '0 0 10px',
            maxWidth: 760,
            color: 'var(--text2)',
            fontSize: 14,
            lineHeight: 1.6,
          }}>
            Open Settings, add at least one repository in the General tab, then review the Planning, Implementation, and Review tabs so your agents are configured before work begins.
          </p>
          <p style={{
            margin: '0 0 20px',
            maxWidth: 760,
            color: 'var(--text3)',
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            Once a repository is saved, this board will switch back to the normal task workflow and task creation will be enabled automatically.
          </p>
          <button
            onClick={onOpenSettings}
            style={{
              padding: '10px 16px',
              background: 'var(--amber)',
              color: '#000',
              border: 'none',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
              cursor: 'pointer',
            }}
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 1,
        background: 'var(--border)',
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {COLUMNS.map(column => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={columnTasks[column.id]}
            agents={agents}
            animatingTasks={animatingTasks}
            onApprove={onApprove}
            onReject={onReject}
            onAgentClick={onAgentClick}
            onAddTask={onAddTask}
            hasConfiguredRepos={hasConfiguredRepos}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
    </div>
  );
}
