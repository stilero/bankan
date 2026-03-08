import React, { useRef, useState, useEffect, useMemo } from 'react';
import KanbanColumn from './KanbanColumn.jsx';

const COLUMNS = [
  { id: 'backlog',        title: 'Backlog',        icon: '\u25CB', statuses: ['backlog'],                       agentPrefix: null,   color: 'var(--text3)'  },
  { id: 'planning',       title: 'Planning',       icon: '\u270E', statuses: ['planning', 'awaiting_approval'], agentPrefix: 'plan', color: 'var(--steel2)' },
  { id: 'implementation', title: 'Implementation', icon: '\u2692', statuses: ['queued', 'implementing'],        agentPrefix: 'imp',  color: 'var(--green)'  },
  { id: 'review',         title: 'Review',         icon: '\u2714', statuses: ['review'],                        agentPrefix: 'rev',  color: 'var(--yellow)' },
  { id: 'done',           title: 'Done',           icon: '\u2713', statuses: ['awaiting_human_review', 'done'], agentPrefix: null,   color: 'var(--green)'  },
];

export default function KanbanBoard({
  tasks,
  agents,
  onApprove,
  onReject,
  onAgentClick,
  onAddTask,
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
        // Place blocked tasks by assigned agent prefix
        if (task.assignedTo) {
          const col = COLUMNS.find(c => c.agentPrefix && task.assignedTo.startsWith(c.agentPrefix));
          if (col) {
            result[col.id].push(task);
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
        />
      ))}
    </div>
  );
}
