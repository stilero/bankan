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

const iconStrokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const COLUMNS = [
  {
    id: 'backlog',
    title: 'Backlog',
    icon: (
      <StageIcon>
        <circle cx='3.75' cy='4.65' r='0.65' {...iconStrokeProps} />
        <path d='M5 4.65h6.25' {...iconStrokeProps} />
        <circle cx='3.75' cy='7.15' r='0.65' {...iconStrokeProps} />
        <path d='M5 7.15h6.25' {...iconStrokeProps} />
        <circle cx='3.75' cy='9.65' r='0.65' {...iconStrokeProps} />
        <path d='M5 9.65h6.25' {...iconStrokeProps} />
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
        <rect x='2.75' y='2.75' width='8.75' height='10.75' rx='1' {...iconStrokeProps} />
        <path d='M10.75 2.75V5h2.25' {...iconStrokeProps} />
        <path d='M4.5 6.75h5.5' {...iconStrokeProps} />
        <path d='M4.5 8.75h5' {...iconStrokeProps} />
        <path d='M4.5 10.75h4.25' {...iconStrokeProps} />
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
        <path d='M3.95 5.5 5.75 6.75 3.95 8' {...iconStrokeProps} />
        <path d='M12.05 5.5 10.25 6.75 12.05 8' {...iconStrokeProps} />
        <rect x='3.25' y='3.75' width='9.5' height='8.25' rx='1.15' {...iconStrokeProps} />
        <path d='M5.25 10.5h2.25' {...iconStrokeProps} />
        <path d='M5.25 6.25h5.75' {...iconStrokeProps} />
        <path d='M5.25 8.25h4.25' {...iconStrokeProps} />
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
        <circle cx='6.75' cy='6.75' r='3.25' {...iconStrokeProps} />
        <path d='M8.9 8.9 11 11' {...iconStrokeProps} />
        <path d='M5.25 6.5 6.75 8 9.35 5.4' {...iconStrokeProps} />
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
        <path
          d='M6 4.25h4l2.25 2.25v2.65a2.75 2.75 0 1 1-4.5 0V4.25Z'
          {...iconStrokeProps}
        />
        <path d='M7.25 4.25h1.25V6' {...iconStrokeProps} />
        <path d='M8 8 9.5 9.5 12 7' {...iconStrokeProps} />
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
