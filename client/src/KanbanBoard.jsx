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

const STAGE_ICONS = {
  backlog: (
    <StageIcon>
      <rect x='3' y='2.75' width='10' height='10.5' rx='1.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
      <path d='M4.75 5.25h5.75' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M4.75 7.75h4.25' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M4.75 10.25h3' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M9.75 3.25h0.5M9.75 12.75h0.5M3.5 3.25h0.5M3.5 12.75h0.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
    </StageIcon>
  ),
  planning: (
    <StageIcon>
      <path d='M4 2.75h5.75a.75.75 0 0 1 .75.75v1.5h2a.75.75 0 0 1 .75.75v7.75a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75V3.5A.75.75 0 0 1 4 2.75Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
      <path d='M9.75 2.75v2h2.25' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
      <path d='M4.75 6.5h6.25M4.75 8.5h5M4.75 10.5h4' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M5.5 6v-1.25M7.75 6v-1.25M10 6v-1.25' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
    </StageIcon>
  ),
  implementation: (
    <StageIcon>
      <path d='M3.25 5.5 5.5 7.75 3.25 10' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
      <path d='M12.75 5.5 10.5 7.75 12.75 10' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
      <path d='M6.5 12.5h3' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M2.75 8h10.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <circle cx='8' cy='8' r='3.75' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
    </StageIcon>
  ),
  review: (
    <StageIcon>
      <circle cx='7.5' cy='7.5' r='3.8' fill='none' stroke='currentColor' strokeWidth='1.5' />
      <path d='M10.5 10.5l2.5 2.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M5.9 7.35 6.9 8.35 9.35 5.9' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
      <circle cx='12.5' cy='3.5' r='1.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
      <path d='M11.5 3.5l.6.6 1.1-1.1' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
    </StageIcon>
  ),
  done: (
    <StageIcon>
      <circle cx='8' cy='8' r='5.5' fill='none' stroke='currentColor' strokeWidth='1.5' />
      <path d='m5.2 8 1.8 1.8 4-4' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
      <path d='M11.75 6.25l-1.5 1.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
    </StageIcon>
  ),
};

const COLUMNS = [
  {
    id: 'backlog',
    title: 'Backlog',
    icon: STAGE_ICONS.backlog,
    statuses: ['backlog', 'paused', 'aborted'],
    agentPrefix: null,
    color: 'var(--text3)',
  },
  {
    id: 'planning',
    title: 'Planning',
    icon: STAGE_ICONS.planning,
    statuses: ['workspace_setup', 'planning', 'awaiting_approval'],
    agentPrefix: 'plan',
    color: 'var(--steel2)',
  },
  {
    id: 'implementation',
    title: 'Implementation',
    icon: STAGE_ICONS.implementation,
    statuses: ['queued', 'implementing'],
    agentPrefix: 'imp',
    color: 'var(--green)',
  },
  {
    id: 'review',
    title: 'Review',
    icon: STAGE_ICONS.review,
    statuses: ['review'],
    agentPrefix: 'rev',
    color: 'var(--yellow)',
  },
  {
    id: 'done',
    title: 'Done',
    icon: STAGE_ICONS.done,
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
  onTaskClick,
  canCreateTask,
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
        const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });
    }

    return result;
  }, [tasks]);

  return (
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
          onTaskClick={onTaskClick}
          canCreateTask={canCreateTask}
        />
      ))}
    </div>
  );
}
