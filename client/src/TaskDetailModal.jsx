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
  blocked: 'var(--red)',
  paused: 'var(--amber)',
  backlog: 'var(--text3)',
  aborted: 'var(--text3)',
  done: 'var(--green)',
};

function truncateText(text, maxLength = 120) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 1).trimEnd() + '…';
}

export default function TaskDetailModal({
  task,
  onClose,
  onApprove,
  onReject,
  onPause,
  onResume,
  onEdit,
  onAbort,
  onRetry,
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description || '');
  const [editPriority, setEditPriority] = useState(task.priority);
  const [editRepoPath, setEditRepoPath] = useState(task.repoPath || '');
  const [showPlan, setShowPlan] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const canPause = !['done', 'paused', 'aborted'].includes(task.status);
  const canResume = task.status === 'paused';
  const canAbort = !['done', 'aborted'].includes(task.status);
  const canRetry = task.status === 'blocked';

  const handleSave = () => {
    onEdit(task.id, {
      title: editTitle,
      description: editDescription,
      priority: editPriority,
      repoPath: editRepoPath,
    });
    setEditing(false);
  };

  const handleReject = () => {
    if (feedback.trim()) {
      onReject(task.id, feedback.trim());
      setRejecting(false);
      setFeedback('');
    }
  };

  const labelStyle = {
    fontSize: 10, fontWeight: 600, color: 'var(--text3)',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4,
  };

  const valueStyle = { fontSize: 12, color: 'var(--text)', marginBottom: 14 };

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
          width: 540, maxHeight: '80vh', overflowY: 'auto',
          padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{task.id}</span>
            <span style={{
              padding: '2px 8px', borderRadius: 3, fontSize: 10,
              background: (STAGE_COLORS[task.status] || 'var(--text3)') + '20',
              color: STAGE_COLORS[task.status] || 'var(--text3)',
            }}>
              {task.status.replace(/_/g, ' ')}
            </span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: 16 }}>
            {'\u2715'}
          </button>
        </div>

        {editing ? (
          /* Edit mode */
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Title</div>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 12 }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Description</div>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, resize: 'vertical' }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Priority</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['critical', 'high', 'medium', 'low'].map(p => (
                  <button
                    key={p}
                    onClick={() => setEditPriority(p)}
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 11,
                      border: `1px solid ${editPriority === p ? PRIORITY_COLORS[p] : 'var(--border)'}`,
                      background: editPriority === p ? PRIORITY_COLORS[p] + '20' : 'transparent',
                      color: editPriority === p ? PRIORITY_COLORS[p] : 'var(--text2)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Repository Path</div>
              <input
                type="text"
                value={editRepoPath}
                onChange={e => setEditRepoPath(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditing(false)}
                style={{ padding: '6px 14px', color: 'var(--text2)', fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                style={{
                  padding: '6px 16px', background: 'var(--amber)', color: '#000',
                  borderRadius: 4, fontWeight: 500, fontSize: 12,
                }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          /* View mode */
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Title</div>
              <div style={{ ...valueStyle, fontSize: 14 }}>{task.title}</div>
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
              <div>
                <div style={labelStyle}>Priority</div>
                <span style={{
                  padding: '2px 8px', borderRadius: 3, fontSize: 11,
                  background: (PRIORITY_COLORS[task.priority] || 'var(--text3)') + '20',
                  color: PRIORITY_COLORS[task.priority] || 'var(--text3)',
                  textTransform: 'capitalize',
                }}>
                  {task.priority}
                </span>
              </div>
              {task.repoPath && (
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Repository</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', wordBreak: 'break-all' }}>
                    {task.repoPath}
                  </div>
                </div>
              )}
            </div>

            {task.description && (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Description</div>
                <div style={valueStyle}>{task.description}</div>
              </div>
            )}

            {task.branch && (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Branch</div>
                <div style={{ fontSize: 12, color: 'var(--steel2)' }}>{task.branch}</div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Review Cycles</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                {task.reviewCycleCount || 0} / 3
              </div>
            </div>

            {task.prUrl && (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Pull Request</div>
                <a
                  href={task.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#60A5FA' }}
                >
                  {task.prUrl}
                </a>
              </div>
            )}

            {task.blockedReason && (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Blocked Reason</div>
                <div
                  title={task.blockedReason}
                  style={{ fontSize: 12, color: 'var(--red)', lineHeight: 1.5 }}
                >
                  {truncateText(task.blockedReason)}
                </div>
              </div>
            )}

            {/* Plan (collapsible) */}
            {task.plan && (
              <div style={{ marginBottom: 14 }}>
                <div
                  onClick={() => setShowPlan(!showPlan)}
                  style={{
                    ...labelStyle, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: 4, userSelect: 'none',
                  }}
                >
                  {showPlan ? '\u25BC' : '\u25B6'} Plan
                </div>
                {showPlan && (
                  <pre style={{
                    fontSize: 11, color: 'var(--text2)',
                    background: 'var(--bg)', padding: 10, borderRadius: 4,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 200, overflowY: 'auto',
                    border: '1px solid var(--border)',
                  }}>
                    {task.plan}
                  </pre>
                )}
              </div>
            )}

            {/* Review (collapsible) */}
            {task.review && (
              <div style={{ marginBottom: 14 }}>
                <div
                  onClick={() => setShowReview(!showReview)}
                  style={{
                    ...labelStyle, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: 4, userSelect: 'none',
                  }}
                >
                  {showReview ? '\u25BC' : '\u25B6'} Review
                </div>
                {showReview && (
                  <pre style={{
                    fontSize: 11, color: 'var(--text2)',
                    background: 'var(--bg)', padding: 10, borderRadius: 4,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 200, overflowY: 'auto',
                    border: '1px solid var(--border)',
                  }}>
                    {task.review}
                  </pre>
                )}
              </div>
            )}

            {/* Log history */}
            {task.log && task.log.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>History</div>
                <div style={{
                  maxHeight: 120, overflowY: 'auto',
                  border: '1px solid var(--border)', borderRadius: 4,
                  background: 'var(--bg)',
                }}>
                  {task.log.slice().reverse().map((entry, i) => (
                    <div key={i} style={{
                      padding: '4px 10px', fontSize: 10,
                      borderBottom: '1px solid var(--border)',
                      display: 'flex', gap: 8,
                    }}>
                      <span style={{ color: 'var(--text3)', flexShrink: 0 }}>
                        {new Date(entry.ts).toLocaleTimeString()}
                      </span>
                      <span style={{ color: 'var(--text2)' }}>{entry.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{
              display: 'flex', gap: 8, justifyContent: 'flex-end',
              borderTop: '1px solid var(--border)', paddingTop: 16,
              marginTop: 8,
            }}>
              <button
                onClick={() => {
                  setEditTitle(task.title);
                  setEditDescription(task.description || '');
                  setEditPriority(task.priority);
                  setEditRepoPath(task.repoPath || '');
                  setEditing(true);
                }}
                style={{
                  padding: '6px 14px', fontSize: 12,
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--text)',
                }}
              >
                Edit
              </button>

              {canPause && (
                <button
                  onClick={() => onPause(task.id)}
                  style={{
                    padding: '6px 14px', fontSize: 12,
                    background: 'rgba(245, 166, 35, 0.15)',
                    border: '1px solid rgba(245, 166, 35, 0.3)',
                    borderRadius: 4, color: 'var(--amber)',
                  }}
                >
                  Pause
                </button>
              )}

              {canResume && (
                <button
                  onClick={() => onResume(task.id)}
                  style={{
                    padding: '6px 14px', fontSize: 12,
                    background: 'rgba(61, 220, 132, 0.15)',
                    border: '1px solid rgba(61, 220, 132, 0.3)',
                    borderRadius: 4, color: 'var(--green)',
                  }}
                >
                  Resume
                </button>
              )}

              {task.status === 'awaiting_approval' && (
                <>
                  <button
                    onClick={() => onApprove(task.id)}
                    style={{
                      padding: '6px 14px', fontSize: 12,
                      background: 'rgba(61, 220, 132, 0.15)',
                      borderRadius: 4, color: 'var(--green)',
                    }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setRejecting(true)}
                    style={{
                      padding: '6px 14px', fontSize: 12,
                      background: 'rgba(255, 77, 77, 0.1)',
                      borderRadius: 4, color: 'var(--text2)',
                    }}
                  >
                    Revise
                  </button>
                </>
              )}

              {canRetry && onRetry && (
                <button
                  onClick={() => onRetry(task.id)}
                  style={{
                    padding: '6px 14px', fontSize: 12,
                    background: 'rgba(100, 160, 255, 0.15)',
                    border: '1px solid rgba(100, 160, 255, 0.3)',
                    borderRadius: 4, color: 'var(--steel2)',
                  }}
                >
                  Retry
                </button>
              )}

              {canAbort && onAbort && (
                <button
                  onClick={() => onAbort(task.id)}
                  style={{
                    padding: '6px 14px', fontSize: 12,
                    background: 'rgba(255, 77, 77, 0.15)',
                    border: '1px solid rgba(255, 77, 77, 0.3)',
                    borderRadius: 4, color: 'var(--red)',
                  }}
                >
                  Abort
                </button>
              )}
            </div>

            {rejecting && (
              <div style={{ marginTop: 10, animation: 'fade-in 0.15s ease-out' }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Feedback for planner..."
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleReject();
                    if (e.key === 'Escape') { setRejecting(false); setFeedback(''); }
                  }}
                  style={{ width: '100%', fontSize: 11, padding: '6px 10px' }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
