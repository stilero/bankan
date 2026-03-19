import React, { useState } from 'react';

const PRIORITY_COLORS = {
  critical: 'var(--red)',
  high: 'var(--amber)',
  medium: 'var(--steel2)',
  low: 'var(--text3)',
};

const STAGE_COLORS = {
  planning: 'var(--steel2)',
  awaiting_approval: 'var(--amber)',
  queued: 'var(--text3)',
  workspace_setup: 'var(--steel2)',
  implementing: 'var(--green)',
  review: '#A78BFA',
  awaiting_manual_pr: 'var(--amber)',
  blocked: 'var(--red)',
  paused: 'var(--amber)',
  backlog: 'var(--text3)',
  aborted: 'var(--text3)',
  done: 'var(--green)',
};

function formatAge(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function truncateText(text, maxLength = 72) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 1).trimEnd() + '…';
}

export default function KanbanCard({
  task,
  columnColor,
  agents,
  isAnimating,
  onApprove,
  onReject,
  onAgentClick,
  onTaskClick,
}) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [hovered, setHovered] = useState(false);

  const isBlocked = task.status === 'blocked';
  const assignedAgent = agents.find(a => a.id === task.assignedTo);

  const borderColor = isBlocked ? 'var(--red)' : columnColor;
  const bgTint = isBlocked ? 'rgba(255,77,77,0.05)' : 'transparent';

  return (
    <div
      onClick={() => onTaskClick && onTaskClick(task)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer',
        background: hovered ? 'var(--bg2)' : `linear-gradient(${bgTint}, ${bgTint}), var(--bg1)`,
        borderRadius: 6,
        borderLeft: `3px solid ${borderColor}`,
        padding: '10px 12px',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
        transition: 'transform 0.15s, box-shadow 0.15s, background 0.15s',
        animation: isAnimating ? 'card-enter 0.3s ease-out' : 'none',
      }}
    >
      {/* Row 1: Priority + ID + Age */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: PRIORITY_COLORS[task.priority] || 'var(--text3)',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
          {task.id}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>
          {formatAge(task.createdAt)}
        </span>
      </div>

      {/* Row 2: Title */}
      <div style={{
        fontSize: 12,
        lineHeight: 1.4,
        marginBottom: 8,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {task.title}
      </div>

      {/* Row 3: Sub-status pill + Agent avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: task.progress > 0 ? 6 : 0 }}>
        <span style={{
          padding: '1px 6px',
          borderRadius: 3,
          fontSize: 10,
          background: (STAGE_COLORS[task.status] || 'var(--text3)') + '20',
          color: STAGE_COLORS[task.status] || 'var(--text3)',
        }}>
          {task.status.replace(/_/g, ' ')}
        </span>
        <span style={{ flex: 1 }} />
        {assignedAgent && (
          <span
            onClick={(e) => { e.stopPropagation(); onAgentClick(assignedAgent.id); }}
            title={`Open ${assignedAgent.name} terminal`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 6px',
              borderRadius: 9,
              background: (assignedAgent.color || 'var(--text3)') + '26',
              color: assignedAgent.color || 'var(--text3)',
              fontSize: 10, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = (assignedAgent.color || 'var(--text3)') + '40'}
            onMouseLeave={(e) => e.currentTarget.style.background = (assignedAgent.color || 'var(--text3)') + '26'}
          >
            <span style={{ fontSize: 10, lineHeight: 1 }}>
              {assignedAgent.icon || assignedAgent.id.charAt(0).toUpperCase()}
            </span>
            {assignedAgent.name}
          </span>
        )}
      </div>

      {/* Row 4: Progress bar */}
      {task.progress > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }}>
            <div style={{
              height: '100%', borderRadius: 1,
              width: `${task.progress}%`,
              background: columnColor,
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'right', marginTop: 2 }}>
            {task.progress}%
          </div>
        </div>
      )}

      {/* Row 5: Actions */}
      {task.status === 'awaiting_approval' && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(task.id); }}
            style={{
              padding: '3px 8px', borderRadius: 3,
              background: 'rgba(61, 220, 132, 0.15)',
              color: 'var(--green)', fontSize: 11,
            }}
          >
            Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setRejecting(true); setFeedback(''); }}
            style={{
              padding: '3px 8px', borderRadius: 3,
              background: 'rgba(255, 77, 77, 0.1)',
              color: 'var(--text2)', fontSize: 11,
            }}
          >
            Revise
          </button>
        </div>
      )}

      {task.status === 'done' && task.prUrl && (
        <div style={{ marginTop: 4 }}>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '3px 8px', borderRadius: 3,
              background: 'rgba(96, 165, 250, 0.15)',
              color: '#60A5FA', fontSize: 11,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            PR
          </a>
        </div>
      )}

      {task.status === 'awaiting_manual_pr' && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>MANUAL PR REQUIRED</span>
        </div>
      )}

      {isBlocked && task.blockedReason && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 600 }}>AWAITING HUMAN INPUT</span>
          <span
            title={task.blockedReason}
            style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}
          >
            {truncateText(task.blockedReason)}
          </span>
        </div>
      )}

      {/* Reject feedback inline */}
      {rejecting && (
        <div style={{ marginTop: 6, animation: 'fade-in 0.15s ease-out' }}>
          <input
            autoFocus
            type="text"
            placeholder="Feedback for planner..."
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && feedback.trim()) {
                onReject(task.id, feedback.trim());
                setRejecting(false);
                setFeedback('');
              }
              if (e.key === 'Escape') { setRejecting(false); setFeedback(''); }
            }}
            style={{ width: '100%', fontSize: 11, padding: '4px 8px' }}
          />
        </div>
      )}
    </div>
  );
}
