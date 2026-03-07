import React, { useState, useMemo } from 'react';
import useFactory from './useFactory.js';
import TerminalPane from './TerminalPane.jsx';

const STAGE_COLORS = {
  planning: 'var(--steel2)',
  awaiting_approval: 'var(--amber)',
  queued: 'var(--text3)',
  implementing: 'var(--green)',
  review: '#A78BFA',
  awaiting_human_review: '#60A5FA',
  blocked: 'var(--red)',
  backlog: 'var(--text3)',
  done: 'var(--green)',
};

const PRIORITY_COLORS = {
  critical: 'var(--red)',
  high: 'var(--amber)',
  medium: 'var(--steel2)',
  low: 'var(--text3)',
};

const STAGE_ORDER = ['backlog', 'planning', 'awaiting_approval', 'queued', 'implementing', 'review', 'awaiting_human_review', 'done'];

function formatAge(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatUptime(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// --- Logo SVG ---
function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="#F5A623" strokeWidth="1.5" fill="none" />
      <polygon points="12,6 17,9 17,15 12,18 7,15 7,9" fill="#F5A623" opacity="0.3" />
    </svg>
  );
}

export default function App() {
  const {
    connected, agents, tasks, notifications,
    addTask, approvePlan, rejectPlan,
    injectMessage, pauseAgent, resumeAgent,
    subscribeTerminal,
  } = useFactory();

  const [view, setView] = useState('floor'); // 'floor' | 'queue'
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [rejectingTask, setRejectingTask] = useState(null);
  const [rejectFeedback, setRejectFeedback] = useState('');

  // Derived values
  const needAttention = useMemo(() =>
    tasks.filter(t => t.status === 'awaiting_approval' || t.status === 'awaiting_human_review'),
    [tasks]
  );
  const totalTokens = useMemo(() =>
    agents.reduce((a, b) => a + (b.tokens || 0), 0),
    [agents]
  );
  const activeCount = useMemo(() => agents.filter(a => a.status === 'active').length, [agents]);
  const blockedCount = useMemo(() => agents.filter(a => a.status === 'blocked').length, [agents]);
  const inFlight = useMemo(() =>
    tasks.filter(t => !['backlog', 'done'].includes(t.status)),
    [tasks]
  );

  const selectedAgentData = useMemo(() =>
    agents.find(a => a.id === selectedAgent),
    [agents, selectedAgent]
  );

  const handleAgentClick = (agentId) => {
    if (agentId === 'orch') return;
    setSelectedAgent(prev => prev === agentId ? null : agentId);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* TOP BAR */}
      <div style={{
        height: 44, minHeight: 44,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 16px',
        background: 'var(--bg1)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo />
          <span style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>
            AI FACTORY
          </span>
        </div>

        {/* Nav tabs */}
        <div style={{ display: 'flex', gap: 0, marginLeft: 24 }}>
          {[['floor', 'Factory Floor'], ['queue', 'Task Queue']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                padding: '10px 16px',
                fontSize: 12,
                color: view === key ? 'var(--text)' : 'var(--text2)',
                borderBottom: view === key ? '2px solid var(--amber)' : '2px solid transparent',
                fontWeight: view === key ? 500 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Attention badge */}
        {needAttention.length > 0 && (
          <button
            onClick={() => setView('queue')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              background: 'rgba(245, 166, 35, 0.1)',
              border: '1px solid rgba(245, 166, 35, 0.3)',
              borderRadius: 12,
              color: 'var(--amber)',
              fontSize: 11,
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--amber)',
              animation: 'pulse 2s infinite',
            }} />
            {needAttention.length} need{needAttention.length === 1 ? 's' : ''} attention
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text2)' }}>
          <span>Active <span style={{ color: 'var(--green)' }}>{activeCount}</span>/{agents.length}</span>
          {blockedCount > 0 && <span>Blocked <span style={{ color: 'var(--red)' }}>{blockedCount}</span></span>}
          <span>In Flight <span style={{ color: 'var(--amber)' }}>{inFlight.length}</span></span>
          <span>Context <span style={{ color: 'var(--text)' }}>{formatTokens(totalTokens)}</span></span>
        </div>

        {/* Connection indicator */}
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: connected ? 'var(--green)' : 'var(--red)',
        }} />

        {/* Add Task */}
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            padding: '6px 14px',
            background: 'var(--amber)',
            color: '#000',
            borderRadius: 4,
            fontWeight: 500,
            fontSize: 12,
          }}
        >
          + ADD TASK
        </button>
      </div>

      {/* CONVEYOR BELT */}
      <div style={{
        height: 56, minHeight: 56,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 16px',
        borderBottom: '1px solid var(--border)',
        borderTop: '1px solid var(--border)',
        background: `repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 8px,
          rgba(245, 166, 35, 0.03) 8px,
          rgba(245, 166, 35, 0.03) 16px
        )`,
        backgroundSize: '40px 40px',
        animation: 'conveyor-stripes 2s linear infinite',
        overflow: 'hidden',
      }}>
        {inFlight.length === 0 ? (
          <span style={{ color: 'var(--text3)', fontSize: 11, letterSpacing: 2 }}>CONVEYOR CLEAR</span>
        ) : (
          inFlight.map(task => (
            <div key={task.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              background: 'var(--bg2)',
              borderLeft: `3px solid ${STAGE_COLORS[task.status] || 'var(--text3)'}`,
              borderRadius: 3,
              fontSize: 11,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: 1,
                background: PRIORITY_COLORS[task.priority] || 'var(--text3)',
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text2)' }}>{task.id}</span>
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
              <span style={{
                padding: '1px 6px',
                background: (STAGE_COLORS[task.status] || 'var(--text3)') + '20',
                color: STAGE_COLORS[task.status] || 'var(--text3)',
                borderRadius: 3,
                fontSize: 10,
              }}>
                {task.status.replace(/_/g, ' ')}
              </span>
            </div>
          ))
        )}
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT RAIL */}
        <div style={{
          width: 220, minWidth: 220,
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          background: 'var(--bg1)',
        }}>
          {agents.map(agent => {
            const isSelected = selectedAgent === agent.id;
            const isClickable = agent.id !== 'orch';
            const contextPct = agent.maxTokens ? (agent.tokens / agent.maxTokens) * 100 : 0;
            const contextColor = contextPct > 85 ? 'var(--red)' : contextPct > 70 ? 'var(--yellow)' : agent.color;

            return (
              <div
                key={agent.id}
                onClick={() => handleAgentClick(agent.id)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  borderTop: isSelected ? `3px solid ${agent.color}` : agent.status === 'blocked' ? '3px solid var(--red)' : '3px solid transparent',
                  cursor: isClickable ? 'pointer' : 'default',
                  background: isSelected ? 'var(--bg2)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: agent.status === 'active' ? 'var(--green)' : agent.status === 'blocked' ? 'var(--red)' : 'var(--text3)',
                    animation: agent.status === 'active' ? 'pulse 2s infinite' : 'none',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 13 }}>{agent.name}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{agent.role}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.currentTask ? (
                    <><span style={{ color: agent.color }}>{agent.currentTask}</span> {agent.task}</>
                  ) : (
                    <span style={{ fontStyle: 'italic', color: 'var(--text3)' }}>idle</span>
                  )}
                </div>
                {/* Context bar */}
                <div style={{ height: 2, background: 'var(--border)', borderRadius: 1, marginBottom: 4 }}>
                  <div style={{
                    height: '100%', borderRadius: 1,
                    width: `${Math.min(contextPct, 100)}%`,
                    background: contextColor,
                    transition: 'width 0.3s, background 0.3s',
                  }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{formatUptime(agent.uptime)}</div>
              </div>
            );
          })}
        </div>

        {/* MAIN AREA */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {view === 'floor' ? (
            <FloorView
              tasks={tasks}
              rejectingTask={rejectingTask}
              setRejectingTask={setRejectingTask}
              rejectFeedback={rejectFeedback}
              setRejectFeedback={setRejectFeedback}
              approvePlan={approvePlan}
              rejectPlan={rejectPlan}
            />
          ) : (
            <QueueView
              tasks={tasks}
              needAttention={needAttention}
              rejectingTask={rejectingTask}
              setRejectingTask={setRejectingTask}
              rejectFeedback={rejectFeedback}
              setRejectFeedback={setRejectFeedback}
              approvePlan={approvePlan}
              rejectPlan={rejectPlan}
            />
          )}
        </div>

        {/* TERMINAL DRAWER */}
        {selectedAgent && selectedAgentData && (
          <TerminalPane
            agent={selectedAgentData}
            subscribeTerminal={subscribeTerminal}
            injectMessage={injectMessage}
            onClose={() => setSelectedAgent(null)}
          />
        )}
      </div>

      {/* ADD TASK MODAL */}
      {showAddModal && (
        <AddTaskModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(title, priority, description) => {
            addTask(title, priority, description);
            setShowAddModal(false);
          }}
        />
      )}

      {/* NOTIFICATIONS */}
      <div style={{
        position: 'fixed', bottom: 16, right: 16,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 1000,
      }}>
        {notifications.map(n => (
          <div key={n.id} style={{
            padding: '10px 14px',
            background: 'var(--bg2)',
            borderLeft: `3px solid ${n.type === 'error' ? 'var(--red)' : n.type === 'success' ? 'var(--green)' : n.type === 'warning' ? 'var(--amber)' : 'var(--steel2)'}`,
            borderRadius: 4,
            fontSize: 12,
            maxWidth: 320,
            animation: 'toast-in 0.3s ease-out',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            {n.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Pipeline Bar ---
function PipelineBar({ tasks }) {
  return (
    <div style={{
      display: 'flex', gap: 1, marginBottom: 16, background: 'var(--border)',
      borderRadius: 4, overflow: 'hidden',
    }}>
      {STAGE_ORDER.map(stage => {
        const stageTasks = tasks.filter(t => t.status === stage);
        return (
          <div key={stage} style={{
            flex: 1, padding: '8px 6px',
            background: 'var(--bg1)',
            minWidth: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              marginBottom: 4,
            }}>
              <span style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: 0.5 }}>
                {stage.replace(/_/g, ' ')}
              </span>
              {stageTasks.length > 0 && (
                <span style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: STAGE_COLORS[stage] + '30',
                  color: STAGE_COLORS[stage],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 500,
                }}>
                  {stageTasks.length}
                </span>
              )}
            </div>
            {stageTasks.map(t => (
              <div key={t.id} style={{
                fontSize: 10, padding: '2px 4px',
                color: 'var(--text2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{ color: STAGE_COLORS[stage] }}>{t.id}</span> {t.title}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// --- Task Table ---
function TaskTable({ tasks, rejectingTask, setRejectingTask, rejectFeedback, setRejectFeedback, approvePlan, rejectPlan }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr 70px 80px 120px',
        padding: '8px 12px',
        background: 'var(--bg2)',
        fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5,
        position: 'sticky', top: 0,
      }}>
        <span></span>
        <span>Task</span>
        <span>Age</span>
        <span>Progress</span>
        <span>Status</span>
      </div>
      {/* Rows */}
      {tasks.map(task => (
        <React.Fragment key={task.id}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px 1fr 70px 80px 120px',
            padding: '8px 12px',
            borderTop: '1px solid var(--border)',
            alignItems: 'center',
            fontSize: 12,
          }}>
            {/* Priority */}
            <span style={{
              width: 6, height: 6, borderRadius: 1,
              background: PRIORITY_COLORS[task.priority] || 'var(--text3)',
            }} />
            {/* Task */}
            <div style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--text3)', marginRight: 6 }}>{task.id}</span>
              <span>{task.title}</span>
              {task.branch && (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{task.branch}</div>
              )}
            </div>
            {/* Age */}
            <span style={{ color: 'var(--text2)', fontSize: 11 }}>{formatAge(task.createdAt)}</span>
            {/* Progress */}
            <div>
              {task.progress > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ flex: 1, height: 2, background: 'var(--border)', borderRadius: 1 }}>
                    <div style={{ height: '100%', width: `${task.progress}%`, background: 'var(--green)', borderRadius: 1 }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text2)' }}>{task.progress}%</span>
                </div>
              )}
            </div>
            {/* Status/Actions */}
            <div>
              {task.status === 'awaiting_approval' ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => approvePlan(task.id)}
                    style={{
                      padding: '3px 8px', borderRadius: 3,
                      background: 'rgba(61, 220, 132, 0.15)',
                      color: 'var(--green)', fontSize: 11,
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => { setRejectingTask(task.id); setRejectFeedback(''); }}
                    style={{
                      padding: '3px 8px', borderRadius: 3,
                      background: 'rgba(255, 77, 77, 0.1)',
                      color: 'var(--text2)', fontSize: 11,
                    }}
                  >
                    ↩ Revise
                  </button>
                </div>
              ) : task.status === 'awaiting_human_review' ? (
                task.prUrl ? (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '3px 8px', borderRadius: 3,
                      background: 'rgba(96, 165, 250, 0.15)',
                      color: '#60A5FA', fontSize: 11,
                      textDecoration: 'none',
                    }}
                  >
                    ↗ PR
                  </a>
                ) : (
                  <span style={{ fontSize: 11, color: '#60A5FA' }}>awaiting review</span>
                )
              ) : task.status === 'blocked' ? (
                <span style={{ fontSize: 11, color: 'var(--red)' }}>blocked</span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: STAGE_COLORS[task.status] || 'var(--text3)',
                  }} />
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>{task.status.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>
          </div>
          {/* Rejection inline drawer */}
          {rejectingTask === task.id && (
            <div style={{
              padding: '8px 12px 8px 40px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg2)',
              animation: 'fade-in 0.15s ease-out',
            }}>
              <input
                autoFocus
                type="text"
                placeholder="Feedback for planner..."
                value={rejectFeedback}
                onChange={e => setRejectFeedback(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && rejectFeedback.trim()) {
                    rejectPlan(task.id, rejectFeedback.trim());
                    setRejectingTask(null);
                    setRejectFeedback('');
                  }
                  if (e.key === 'Escape') { setRejectingTask(null); setRejectFeedback(''); }
                }}
                style={{ width: '100%', fontSize: 12 }}
              />
            </div>
          )}
        </React.Fragment>
      ))}
      {tasks.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
          No tasks yet. Click + ADD TASK to get started.
        </div>
      )}
    </div>
  );
}

// --- Floor View ---
function FloorView({ tasks, rejectingTask, setRejectingTask, rejectFeedback, setRejectFeedback, approvePlan, rejectPlan }) {
  return (
    <>
      <PipelineBar tasks={tasks} />
      <TaskTable
        tasks={tasks}
        rejectingTask={rejectingTask}
        setRejectingTask={setRejectingTask}
        rejectFeedback={rejectFeedback}
        setRejectFeedback={setRejectFeedback}
        approvePlan={approvePlan}
        rejectPlan={rejectPlan}
      />
    </>
  );
}

// --- Queue View ---
function QueueView({ tasks, needAttention, rejectingTask, setRejectingTask, rejectFeedback, setRejectFeedback, approvePlan, rejectPlan }) {
  return (
    <>
      {needAttention.length > 0 && (
        <>
          <h3 style={{
            fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14,
            marginBottom: 12, color: 'var(--amber)',
          }}>
            Needs Attention
          </h3>
          <TaskTable
            tasks={needAttention}
            rejectingTask={rejectingTask}
            setRejectingTask={setRejectingTask}
            rejectFeedback={rejectFeedback}
            setRejectFeedback={setRejectFeedback}
            approvePlan={approvePlan}
            rejectPlan={rejectPlan}
          />
          <div style={{ height: 24 }} />
        </>
      )}
      <h3 style={{
        fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14,
        marginBottom: 12,
      }}>
        All Tasks
      </h3>
      <TaskTable
        tasks={tasks}
        rejectingTask={rejectingTask}
        setRejectingTask={setRejectingTask}
        rejectFeedback={rejectFeedback}
        setRejectFeedback={setRejectFeedback}
        approvePlan={approvePlan}
        rejectPlan={rejectPlan}
      />
    </>
  );
}

// --- Add Task Modal ---
function AddTaskModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit(title.trim(), priority, description.trim());
  };

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
          width: 440, padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>
          Add Task
        </h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Title</label>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="What needs to be built?"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Priority</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {['critical', 'high', 'medium', 'low'].map(p => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 4,
                  fontSize: 12,
                  border: `1px solid ${priority === p ? PRIORITY_COLORS[p] : 'var(--border)'}`,
                  background: priority === p ? PRIORITY_COLORS[p] + '20' : 'transparent',
                  color: priority === p ? PRIORITY_COLORS[p] : 'var(--text2)',
                  textTransform: 'capitalize',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Additional context..."
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', color: 'var(--text2)', fontSize: 12 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            style={{
              padding: '8px 20px',
              background: title.trim() ? 'var(--amber)' : 'var(--border)',
              color: title.trim() ? '#000' : 'var(--text3)',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 12,
            }}
          >
            Add Task
          </button>
        </div>
      </div>
    </div>
  );
}
