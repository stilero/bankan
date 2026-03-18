import React, { useState, useMemo, useEffect } from 'react';
import useFactory from './useFactory.js';
import KanbanBoard from './KanbanBoard.jsx';
import TerminalDrawer from './TerminalDrawer.jsx';
import DirectoryPicker from './DirectoryPicker.jsx';
import TaskDetailModal from './TaskDetailModal.jsx';
import ReportsModal from './ReportsModal.jsx';
import logoUrl from './assets/ban_kan_logo.svg';

const PRIORITY_COLORS = {
  critical: 'var(--red)',
  high: 'var(--amber)',
  medium: 'var(--steel2)',
  low: 'var(--text3)',
};

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getDefaultRepo(repos, settings) {
  if (!Array.isArray(repos) || repos.length === 0) return '';
  if (settings?.defaultRepoPath && repos.includes(settings.defaultRepoPath)) {
    return settings.defaultRepoPath;
  }
  return repos[0] || '';
}

function Logo() {
  return (
    <div style={{
      height: 34,
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
    }}>
      <img
        src={logoUrl}
        alt="Ban Kan"
        style={{
          height: 34,
          width: 'auto',
          display: 'block',
        }}
      />
    </div>
  );
}

export default function App() {
  const {
    connected, isInitialized, agents, tasks, repos, settings, notifications,
    addTask, approvePlan, rejectPlan,
    pauseTask, resumeTask, editTask, abortTask, resetTask, retryTask, deleteTask, openTaskWorkspace,
    injectMessage, sendRaw, resizeTerminal,
    updateSettings, subscribeTerminal, openAgentTerminal, returnAgentTerminal,
  } = useFactory();

  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);
  const hasRepos = repos.length > 0;
  const canCreateTask = hasRepos;
  const showStartupGreeting = isInitialized && !hasRepos && tasks.length === 0;

  // Derived values
  const needAttention = useMemo(() =>
    tasks.filter(t => t.status === 'awaiting_approval' || t.status === 'blocked'),
    [tasks]
  );
  const totalTokens = useMemo(() =>
    tasks.reduce((sum, task) => sum + (task.totalTokens || 0), 0),
    [tasks]
  );
  const activeCount = useMemo(() => agents.filter(a => a.status === 'active').length, [agents]);
  const blockedCount = useMemo(() => agents.filter(a => a.status === 'blocked').length, [agents]);
  const inFlight = useMemo(() =>
    tasks.filter(t => !['backlog', 'done', 'aborted'].includes(t.status)),
    [tasks]
  );

  const selectedAgentData = useMemo(() =>
    agents.find(a => a.id === selectedAgent),
    [agents, selectedAgent]
  );

  useEffect(() => {
    if (!canCreateTask && showAddModal) {
      setShowAddModal(false);
    }
  }, [canCreateTask, showAddModal]);

  const handleAgentClick = (agentId) => {
    if (agentId === 'orch') return;
    setSelectedAgent(prev => prev === agentId ? null : agentId);
  };

  const openAddTaskModal = () => {
    if (!canCreateTask) return;
    setShowAddModal(true);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* TOP BAR */}
      <div style={{
        height: 54, minHeight: 54,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 16px',
        background: 'var(--bg1)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <Logo />
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text2)', marginLeft: 24 }}>
          <span>Active <span style={{ color: 'var(--green)' }}>{activeCount}</span>/{agents.length}</span>
          {blockedCount > 0 && <span>Blocked <span style={{ color: 'var(--red)' }}>{blockedCount}</span></span>}
          <span>In Flight <span style={{ color: 'var(--amber)' }}>{inFlight.length}</span></span>
          <span>Context <span style={{ color: 'var(--text)' }}>{formatTokens(totalTokens)}</span></span>
        </div>

        {/* Attention badge */}
        {needAttention.length > 0 && (
          <button
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

        {/* Connection indicator */}
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: connected ? 'var(--green)' : 'var(--red)',
        }} />

        {/* Reports */}
        <button
          onClick={() => setShowReportsModal(true)}
          style={{
            padding: '6px 10px',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--text2)',
            cursor: 'pointer',
          }}
          title="Reports"
        >
          Reports
        </button>

        {/* Settings */}
        <button
          onClick={() => setShowSettingsModal(true)}
          style={{
            padding: '6px 10px',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 14,
            color: 'var(--text2)',
            cursor: 'pointer',
          }}
          title="Settings"
        >
          {'\u2699'}
        </button>

        {/* Add Task */}
        <button
          onClick={openAddTaskModal}
          disabled={!canCreateTask}
          style={{
            padding: '6px 14px',
            background: canCreateTask ? 'var(--amber)' : 'var(--bg2)',
            color: canCreateTask ? '#000' : 'var(--text3)',
            border: `1px solid ${canCreateTask ? 'var(--amber)' : 'var(--border)'}`,
            borderRadius: 4,
            fontWeight: 500,
            fontSize: 12,
            cursor: canCreateTask ? 'pointer' : 'not-allowed',
            opacity: canCreateTask ? 1 : 0.7,
          }}
          title={canCreateTask ? 'Add Task' : 'Configure at least one repository in Settings before adding a task'}
        >
          + ADD TASK
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {showStartupGreeting && (
          <div style={{
            margin: '16px 16px 0',
            padding: '18px 20px',
            borderRadius: 10,
            border: '1px solid rgba(245, 166, 35, 0.35)',
            background: 'linear-gradient(135deg, rgba(245, 166, 35, 0.18), rgba(122, 162, 247, 0.08))',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              <div style={{ maxWidth: 720 }}>
                <div style={{
                  fontFamily: 'var(--font-head)',
                  fontSize: 20,
                  fontWeight: 700,
                  marginBottom: 6,
                }}>
                  Welcome to Ban Kan
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                  Open Settings to add at least one repository, choose a default repository, and review the agent configuration before creating your first task.
                </div>
              </div>
              <button
                onClick={() => setShowSettingsModal(true)}
                style={{
                  padding: '10px 14px',
                  background: 'var(--amber)',
                  color: '#000',
                  border: '1px solid var(--amber)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Open Settings
              </button>
            </div>
          </div>
        )}

        {/* KANBAN BOARD */}
        <KanbanBoard
          tasks={tasks}
          agents={agents}
          onApprove={approvePlan}
          onReject={rejectPlan}
          onAgentClick={handleAgentClick}
          onAddTask={openAddTaskModal}
          onTaskClick={(task) => setSelectedTask(task)}
          canCreateTask={canCreateTask}
        />
      </div>

      {/* TERMINAL DRAWER */}
      {selectedAgent && selectedAgentData && (
        <TerminalDrawer
          agent={selectedAgentData}
          subscribeTerminal={subscribeTerminal}
          injectMessage={injectMessage}
          sendRaw={sendRaw}
          resizeTerminal={resizeTerminal}
          openAgentTerminal={openAgentTerminal}
          returnAgentTerminal={returnAgentTerminal}
          onClose={() => setSelectedAgent(null)}
        />
      )}

      {/* TASK DETAIL MODAL */}
      {selectedTask && (
        <TaskDetailModal
          task={tasks.find(t => t.id === selectedTask.id) || selectedTask}
          repos={repos}
          onClose={() => setSelectedTask(null)}
          onApprove={(id) => { approvePlan(id); setSelectedTask(null); }}
          onReject={(id, fb) => { rejectPlan(id, fb); setSelectedTask(null); }}
          onPause={(id) => { pauseTask(id); setSelectedTask(null); }}
          onResume={(id) => { resumeTask(id); }}
          onEdit={(id, updates) => { editTask(id, updates); }}
          onAbort={(id) => { abortTask(id); setSelectedTask(null); }}
          onReset={(id) => { resetTask(id); setSelectedTask(null); }}
          onRetry={(id) => { retryTask(id); setSelectedTask(null); }}
          onDelete={(id) => { deleteTask(id); setSelectedTask(null); }}
          onOpenWorkspace={(id) => { openTaskWorkspace(id); }}
        />
      )}

      {/* ADD TASK MODAL */}
      {showAddModal && (
        <AddTaskModal
          repos={repos}
          settings={settings}
          onClose={() => setShowAddModal(false)}
          onSubmit={(title, priority, description, repoPath) => {
            addTask(title, priority, description, repoPath);
            setShowAddModal(false);
          }}
        />
      )}

      {/* SETTINGS MODAL */}
      {showSettingsModal && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettingsModal(false)}
          onApply={(newSettings) => {
            updateSettings(newSettings);
            setShowSettingsModal(false);
          }}
        />
      )}

      {/* REPORTS MODAL */}
      {showReportsModal && (
        <ReportsModal
          tasks={tasks}
          repos={repos}
          onClose={() => setShowReportsModal(false)}
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

// --- Add Task Modal ---
function AddTaskModal({ repos, settings, onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState(() => getDefaultRepo(repos, settings));

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit(title.trim(), priority, description.trim(), repoPath);
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

        {repos.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Repository</label>
            <select
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
              style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}
            >
              <option value="">No repository</option>
              {repos.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

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

// Canonical mapping of CLI providers to their supported models.
// Must stay in sync with CLI_MODEL_MAP in server/src/config.js.
const CLI_MODEL_MAP = {
  claude: [
    { value: '', label: 'Default (CLI default)' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6 (most intelligent)' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5 (fastest, cheapest)' },
  ],
  codex: [
    { value: '', label: 'Default (CLI default)' },
    { value: 'gpt-5.4', label: 'GPT-5.4 (flagship)' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex (best coding)' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark (fast)' },
  ],
};

// Encode cli + model into a single select value, decode it back.
function encodeCliModel(cli, model) {
  return `${cli}:${model}`;
}
function decodeCliModel(encoded) {
  const idx = encoded.indexOf(':');
  if (idx === -1) return { cli: 'claude', model: '' };
  return { cli: encoded.slice(0, idx), model: encoded.slice(idx + 1) };
}

// --- Settings Modal ---
function SettingsModal({ settings, onClose, onApply }) {
  const [local, setLocal] = useState(() => JSON.parse(JSON.stringify(settings)));
  const [newRepoPath, setNewRepoPath] = useState('');
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const updateRole = (role, field, value) => {
    setLocal(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.agents[role][field] = value;
      return next;
    });
  };

  const updatePrompt = (stage, value) => {
    setLocal(prev => ({
      ...prev,
      prompts: {
        ...(prev.prompts || {}),
        [stage]: value,
      },
    }));
  };

  const addRepo = () => {
    const path = newRepoPath.trim();
    if (!path) return;
    setLocal(prev => {
      if ((prev.repos || []).includes(path)) return prev;
      const repos = [...(prev.repos || []), path];
      return {
        ...prev,
        repos,
        defaultRepoPath: prev.defaultRepoPath || path,
      };
    });
    setNewRepoPath('');
  };

  const removeRepo = (path) => {
    setLocal(prev => {
      const repos = (prev.repos || []).filter(r => r !== path);
      return {
        ...prev,
        repos,
        defaultRepoPath: prev.defaultRepoPath === path ? (repos[0] || '') : prev.defaultRepoPath,
      };
    });
  };

  const maxRules = {
    planners: { min: 0, max: 10 },
    implementors: { min: 1, max: 10 },
    reviewers: { min: 0, max: 10 },
  };

  const isValid = Boolean(local.workspaceRoot?.trim()) &&
    Object.entries(local.agents || {}).every(([role, cfg]) => {
      const range = maxRules[role] || { min: 1, max: 10 };
      return cfg.max >= range.min && cfg.max <= range.max;
    }) &&
    ['planning', 'implementation', 'review'].every(stage => typeof local.prompts?.[stage] === 'string');

  const tabs = [
    { key: 'general', label: 'General' },
    { key: 'planning', label: 'Planning' },
    { key: 'implementation', label: 'Implementation' },
    { key: 'review', label: 'Review' },
  ];

  const stageConfig = {
    planning: {
      roleKey: 'planners',
      promptKey: 'planning',
      description: 'Set max agents to 0 to disable planning and skip directly into implementation.',
    },
    implementation: {
      roleKey: 'implementors',
      promptKey: 'implementation',
      description: 'Implementation cannot be disabled. The prompt body customizes the engineer instructions only.',
    },
    review: {
      roleKey: 'reviewers',
      promptKey: 'review',
      description: 'Set max agents to 0 to disable review and create the PR immediately after implementation.',
    },
  };

  const renderStageTab = (stage) => {
    const cfgMeta = stageConfig[stage];
    const cfg = local.agents[cfgMeta.roleKey];
    const range = maxRules[cfgMeta.roleKey];

    return (
      <>
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text2)',
            letterSpacing: 1, marginBottom: 10,
          }}>
            AGENTS
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text2)', width: 45 }}>Max:</span>
            <input
              type="number"
              min={range.min}
              max={range.max}
              value={cfg.max}
              onChange={e => {
                const fallback = range.min;
                const parsed = parseInt(e.target.value, 10);
                const newMax = Number.isNaN(parsed) ? fallback : Math.max(range.min, Math.min(range.max, parsed));
                updateRole(cfgMeta.roleKey, 'max', newMax);
              }}
              style={{
                width: 60, padding: '4px 6px', fontSize: 12,
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 4, textAlign: 'center',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text2)', width: 45 }}>Model:</span>
            <select
              data-testid={`model-select-${cfgMeta.roleKey}`}
              value={encodeCliModel(cfg.cli, cfg.model || '')}
              onChange={e => {
                const { cli, model } = decodeCliModel(e.target.value);
                setLocal(prev => {
                  const next = JSON.parse(JSON.stringify(prev));
                  next.agents[cfgMeta.roleKey].cli = cli;
                  next.agents[cfgMeta.roleKey].model = model;
                  return next;
                });
              }}
              style={{
                padding: '4px 8px', fontSize: 12,
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            >
              {Object.entries(CLI_MODEL_MAP).map(([cli, models]) => (
                <optgroup key={cli} label={`${cli} CLI`}>
                  {models.map(opt => (
                    <option key={encodeCliModel(cli, opt.value)} value={encodeCliModel(cli, opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            {cfgMeta.description}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text2)',
            letterSpacing: 1, marginBottom: 8,
          }}>
            PROMPT BODY
          </div>
          <textarea
            value={local.prompts?.[cfgMeta.promptKey] || ''}
            onChange={e => updatePrompt(cfgMeta.promptKey, e.target.value)}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 220,
              resize: 'vertical',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.5,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
            This edits the stage instructions only. Required output markers and parser-critical formatting stay fixed.
          </div>
        </div>
      </>
    );
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
          width: 760, maxWidth: 'calc(100vw - 32px)', padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18 }}>
            Settings
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: 16 }}>
            {'\u2715'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '7px 12px',
                background: activeTab === tab.key ? 'var(--amber)' : 'var(--bg2)',
                color: activeTab === tab.key ? '#000' : 'var(--text2)',
                border: '1px solid',
                borderColor: activeTab === tab.key ? 'var(--amber)' : 'var(--border)',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
          {activeTab === 'general' && (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                  letterSpacing: 1, marginBottom: 8,
                }}>
                  WORKSPACE FOLDER
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input
                    type="text"
                    value={local.workspaceRoot || ''}
                    onChange={e => setLocal(prev => ({ ...prev, workspaceRoot: e.target.value }))}
                    placeholder="/path/to/workspaces"
                    style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                  />
                  <button
                    onClick={() => setShowWorkspacePicker(true)}
                    style={{
                      fontSize: 12, padding: '6px 10px',
                      background: 'var(--bg2)', border: '1px solid var(--border)',
                      borderRadius: 4, color: 'var(--text)', cursor: 'pointer',
                    }}
                  >
                    Browse
                  </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                  Local folder used when the app creates per-task working copies.
                </div>
                {showWorkspacePicker && (
                  <DirectoryPicker
                    initialPath={local.workspaceRoot || ''}
                    onSelect={(path) => {
                      setLocal(prev => ({ ...prev, workspaceRoot: path }));
                      setShowWorkspacePicker(false);
                    }}
                    onClose={() => setShowWorkspacePicker(false)}
                  />
                )}
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                  letterSpacing: 1, marginBottom: 8,
                }}>
                  REPOSITORIES
                </div>
                {(local.repos || []).map(r => (
                  <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span
                      style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={r}
                    >
                      {r}
                    </span>
                    <button onClick={() => removeRepo(r)} style={{ color: 'var(--red)', fontSize: 12, flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    type="text"
                    value={newRepoPath}
                    onChange={e => setNewRepoPath(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addRepo(); }}
                    placeholder="https://github.com/org/repo"
                    style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                  />
                  <button
                    onClick={addRepo}
                    disabled={!newRepoPath.trim()}
                    style={{
                      fontSize: 12, padding: '6px 10px',
                      background: newRepoPath.trim() ? 'var(--bg2)' : 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 4, color: newRepoPath.trim() ? 'var(--text)' : 'var(--text3)',
                      cursor: newRepoPath.trim() ? 'pointer' : 'default',
                    }}
                  >
                    Add Repo
                  </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
                  Add repository URLs for task assignment. The workspace folder above controls where the app checks them out locally.
                </div>
              </div>

              {local.repos?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                    letterSpacing: 1, marginBottom: 8,
                  }}>
                    DEFAULT REPOSITORY
                  </div>
                  <select
                    value={local.defaultRepoPath || ''}
                    onChange={e => setLocal(prev => ({ ...prev, defaultRepoPath: e.target.value }))}
                    style={{ width: '100%', fontSize: 12, padding: '6px 10px' }}
                  >
                    <option value="">No default repository</option>
                    {(local.repos || []).map(repo => (
                      <option key={repo} value={repo}>{repo}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
                    New tasks preselect this repository. If it is removed, the first remaining repository becomes the default.
                  </div>
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16, fontStyle: 'italic' }}>
                Orchestrator scales agents up on demand, up to the max per role. Planning and Review can be disabled by setting max to 0.
              </div>
            </>
          )}

          {activeTab !== 'general' && renderStageTab(activeTab)}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', color: 'var(--text2)', fontSize: 12 }}
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(local)}
            disabled={!isValid}
            style={{
              padding: '8px 20px',
              background: isValid ? 'var(--amber)' : 'var(--border)',
              color: isValid ? '#000' : 'var(--text3)',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 12,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
