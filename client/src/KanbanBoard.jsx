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
        <rect x='2.5' y='3.5' width='11' height='1.8' rx='0.3' fill='none' stroke='currentColor' strokeWidth='1.5' />
        <rect x='2.5' y='6.5' width='11' height='1.8' rx='0.3' fill='none' stroke='currentColor' strokeWidth='1.5' />
        <rect x='2.5' y='9.5' width='11' height='1.8' rx='0.3' fill='none' stroke='currentColor' strokeWidth='1.5' />
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
        <path d='M8 2.5c-2 0-3 1.5-3 3 0 1.5 0.5 2.5 1 3v1.5c0 0.5 0.5 1 1 1h2c0.5 0 1-0.5 1-1V8.5c0.5-0.5 1-1.5 1-3 0-1.5-1-3-3-3Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
        <path d='M6.5 11.5h3M7 13h2' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
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
        <circle cx='8' cy='8' r='2.5' fill='none' stroke='currentColor' strokeWidth='1.5' />
        <path d='M8 4.5v-1.5M8 12v1.5M10.5 5.5l1-1M4.5 10.5l1-1M12.5 8h1.5M1.5 8h1.5M10.5 10.5l1 1M4.5 5.5l1-1' fill='none' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
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
        <path d='M2 8s2-3.5 6-3.5S14 8 14 8s-2 3.5-6 3.5S2 8 2 8Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='1.5' />
        <circle cx='8' cy='8' r='1.5' fill='none' stroke='currentColor' strokeWidth='1.5' />
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
        <circle cx='8' cy='8' r='5' fill='none' stroke='currentColor' strokeWidth='1.5' />
        <path d='m5.5 8 1.5 1.5 3.5-3.5' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='1.5' />
      </StageIcon>
    ),
    statuses: ['done', 'awaiting_manual_pr'],
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
