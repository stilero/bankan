import React from 'react';
import KanbanCard from './KanbanCard.jsx';

export default function KanbanColumn({
  column,
  tasks,
  agents,
  animatingTasks,
  onApprove,
  onReject,
  onAgentClick,
  onAddTask,
  hasConfiguredRepos,
  onTaskClick,
}) {
  // Get agents for this column's role
  const columnAgents = column.agentPrefix
    ? agents.filter(a => a.id.startsWith(column.agentPrefix + '-') || a.id === column.agentPrefix)
    : [];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: `2px solid ${column.color}30` }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: columnAgents.length > 0 ? 8 : 0 }}>
          <span style={{
            width: 16,
            height: 16,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: column.color,
            flexShrink: 0,
          }}>
            {column.icon}
          </span>
          <span style={{
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}>
            {column.title}
          </span>
          <span style={{ flex: 1 }} />
          {tasks.length > 0 && (
            <span style={{
              width: 20, height: 20, borderRadius: '50%',
              background: column.color + '33',
              color: column.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600,
            }}>
              {tasks.length}
            </span>
          )}
        </div>

        {/* Agent avatars */}
        {columnAgents.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {columnAgents.map(agent => {
              const isActive = agent.status === 'active';
              const isBlocked = agent.status === 'blocked';
              const isDraining = agent.status === 'draining';
              const isIdle = !isActive && !isBlocked && !isDraining;

              return (
                <div
                  key={agent.id}
                  onClick={() => onAgentClick(agent.id)}
                  title={`${agent.name} — ${agent.status}`}
                  style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: isIdle ? 'transparent' : (agent.color || column.color),
                    border: isIdle
                      ? `1px solid ${(agent.color || column.color)}66`
                      : isDraining
                        ? `2px dashed ${agent.color || column.color}`
                        : isBlocked
                          ? '2px solid var(--red)'
                          : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10,
                    cursor: 'pointer',
                    position: 'relative',
                    opacity: isIdle ? 0.4 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {agent.icon || agent.id.charAt(0).toUpperCase()}
                  {/* Status dot */}
                  {isActive && (
                    <span style={{
                      position: 'absolute', bottom: -1, right: -1,
                      width: 5, height: 5, borderRadius: '50%',
                      background: 'var(--green)',
                      border: '1px solid var(--bg)',
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {tasks.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text3)',
            fontSize: 11,
            textAlign: 'center',
            padding: 16,
          }}>
            {column.id === 'backlog' ? (
              hasConfiguredRepos ? (
                <span
                  onClick={onAddTask}
                  style={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  No tasks — click + ADD TASK
                </span>
              ) : (
                'Set up a repository in Settings to unlock task creation'
              )
            ) : column.id === 'done' ? (
              'No completed tasks'
            ) : (
              'All clear'
            )}
          </div>
        )}
        {tasks.map(task => (
          <KanbanCard
            key={task.id}
            task={task}
            columnColor={column.color}
            agents={agents}
            isAnimating={animatingTasks.has(task.id)}
            onApprove={onApprove}
            onReject={onReject}
            onAgentClick={onAgentClick}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
    </div>
  );
}
