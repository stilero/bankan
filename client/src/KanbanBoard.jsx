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
        <path d='M4 3.5h8c0.83 0 1.5 0.67 1.5 1.5v6c0 0.83-0.67 1.5-1.5 1.5h-8c-0.83 0-1.5-0.67-1.5-1.5v-6c0-0.83 0.67-1.5 1.5-1.5Z' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
        <path d='M5 7h6M5 10h4' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1' />
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
        <path d='M3.5 4h9c0.83 0 1.5 0.67 1.5 1.5v7c0 0.83-0.67 1.5-1.5 1.5h-9c-0.83 0-1.5-0.67-1.5-1.5v-7c0-0.83 0.67-1.5 1.5-1.5Z' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
        <path d='M5.5 7h3M5.5 9.5h5M5.5 12h3' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1' />
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
        <path d='M2 6.5L6 3l4 3.5M2 6.5v4c0 0.83 0.67 1.5 1.5 1.5h9c0.83 0 1.5-0.67 1.5-1.5v-4' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
        <path d='M8 8v3.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1' />
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
        <circle cx='8' cy='8' r='4.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
        <path d='M6 8l1.5 1.5 2.5-2.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
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
        <path d='M3 3h10c0.83 0 1.5 0.67 1.5 1.5v7c0 0.83-0.67 1.5-1.5 1.5H3c-0.83 0-1.5-0.67-1.5-1.5v-7c0-0.83 0.67-1.5 1.5-1.5Z' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
        <path d='M5 8.5l1.5 2 3.5-4' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.2' />
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
