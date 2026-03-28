import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
const RECONNECT_INTERVAL = 3000;
const MAX_NOTIFICATIONS = 5;
const NOTIFICATION_TIMEOUT = 5000;

export default function useFactory() {
  const [connected, setConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [repos, setRepos] = useState([]);
  const [settings, setSettings] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const wsRef = useRef(null);
  const termSubsRef = useRef(new Map()); // agentId → callback
  const reconnectRef = useRef(null);

  const addNotification = useCallback((msg, type = 'info') => {
    const notif = { id: Date.now() + Math.random(), msg, type };
    setNotifications(prev => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notif.id));
    }, NOTIFICATION_TIMEOUT);
  }, []);

  const send = useCallback((type, payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectRef.current) {
        clearInterval(reconnectRef.current);
        reconnectRef.current = null;
      }
      // Re-subscribe to any terminal subscriptions
      for (const [agentId] of termSubsRef.current) {
        send('SUBSCRIBE_TERMINAL', { agentId });
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case 'INIT':
          setTasks(msg.payload.tasks || []);
          setAgents(msg.payload.agents || []);
          setRepos(msg.payload.repos || []);
          if (msg.payload.settings) setSettings(msg.payload.settings);
          if (msg.payload.capabilities) {
            setCapabilities(msg.payload.capabilities);
            if (!msg.payload.capabilities.canCreatePullRequests) {
              addNotification('GitHub CLI pull request automation is unavailable. PRs will need to be created manually.', 'warning');
            }
          }
          setIsInitialized(true);
          break;
        case 'TASKS_UPDATED':
          setTasks(msg.payload.tasks || []);
          break;
        case 'TASK_ADDED':
          setTasks(prev => [...prev, msg.payload.task]);
          break;
        case 'AGENTS_UPDATED':
          setAgents(msg.payload.agents || []);
          break;
        case 'AGENT_UPDATED':
          setAgents(prev => {
            const exists = prev.some(a => a.id === msg.payload.agent.id);
            if (exists) {
              return prev.map(a => a.id === msg.payload.agent.id ? msg.payload.agent : a);
            }
            // New agent (from scale-up) — append it
            return [...prev, msg.payload.agent];
          });
          break;
        case 'AGENT_REMOVED':
          setAgents(prev => prev.filter(a => a.id !== msg.payload.agentId));
          break;
        case 'SETTINGS_UPDATED':
          setSettings(msg.payload);
          break;
        case 'REPOS_UPDATED':
          setRepos(msg.payload.repos || []);
          break;
        case 'TERMINAL_DATA': {
          const cb = termSubsRef.current.get(msg.payload.agentId);
          if (cb) cb(msg.payload.data);
          break;
        }
        case 'PLAN_READY':
          addNotification(`Plan ready for ${msg.payload.taskId} — approval needed`, 'warning');
          break;
        case 'PLAN_PARTIAL':
          setTasks(prev => prev.map(t =>
            t.id === msg.payload.taskId ? { ...t, plan: msg.payload.plan } : t
          ));
          break;
        case 'PR_CREATED':
          addNotification(`PR created for ${msg.payload.taskId}`, 'success');
          break;
        case 'TASK_BLOCKED':
          addNotification(`${msg.payload.taskId} blocked: ${msg.payload.reason}`, 'error');
          break;
        case 'TASK_MANUAL_PR_REQUIRED':
          addNotification(`${msg.payload.taskId} requires a manual PR before it can be marked done`, 'warning');
          break;
        case 'REVIEW_FAILED':
          addNotification(`Review failed for ${msg.payload.taskId} — returning to implementor`, 'warning');
          break;
        case 'REVIEW_PASSED':
          addNotification(`Review passed for ${msg.payload.taskId}`, 'success');
          break;
        case 'TASK_ABORTED':
          addNotification(`Task ${msg.payload.taskId} aborted`, 'info');
          break;
        case 'TASK_RESET':
          addNotification(`Task ${msg.payload.taskId} reset to backlog`, 'info');
          break;
        case 'TASK_RETRIED':
          addNotification(`Task ${msg.payload.taskId} retrying from ${msg.payload.retryStatus}`, 'info');
          break;
        case 'TASK_DELETED':
          addNotification(`Task ${msg.payload.taskId} deleted from Done`, 'info');
          break;
        case 'BRIDGE_OPENED':
          addNotification(`${msg.payload.agentName} opened in Terminal`, 'info');
          break;
        case 'BRIDGE_RETURNED':
          addNotification(`${msg.payload.agentName} returned to Ban Kan`, 'info');
          break;
        case 'BRIDGE_ERROR':
          addNotification(msg.payload?.message || 'Terminal bridge failed', 'error');
          break;
        case 'TASK_WORKSPACE_OPENED':
          addNotification(msg.payload?.message || `Opened workspace for ${msg.payload?.taskId}`, 'success');
          break;
        case 'TASK_WORKSPACE_ERROR':
          addNotification(msg.payload?.message || 'Failed to open task workspace', 'error');
          break;
        case 'MAX_REVIEW_BLOCKER_APPROVED':
          addNotification(`Task ${msg.payload.taskId} approved to done`, 'success');
          break;
        case 'MAX_REVIEW_BLOCKER_EXTENDED':
          addNotification(`Task ${msg.payload.taskId} allowed one more review (${msg.payload.maxReviewCycles} max)`, 'info');
          break;
        case 'SUPERVISOR_DECISION': {
          const { taskId: sTaskId, stage, decision, feedback } = msg.payload || {};
          const label = stage === 'plan' ? 'plan' : 'review';
          if (decision === 'APPROVE') {
            addNotification(`Supervisor auto-approved ${label} for ${sTaskId}`, 'success');
          } else if (decision === 'REJECT') {
            addNotification(`Supervisor rejected ${label} for ${sTaskId}: ${feedback || ''}`, 'warning');
          } else if (decision === 'RETRY') {
            addNotification(`Supervisor retrying ${label} for ${sTaskId}`, 'info');
          } else if (decision === 'ESCALATE') {
            addNotification(`Supervisor escalated ${label} for ${sTaskId} — human input needed`, 'error');
          }
          break;
        }
        case 'SETTINGS_ERROR':
          addNotification((msg.payload?.errors || []).join(', ') || 'Settings update failed', 'error');
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!reconnectRef.current) {
        reconnectRef.current = setInterval(connect, RECONNECT_INTERVAL);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [addNotification, send]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearInterval(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const addTask = useCallback((title, priority, description, repoPath) => {
    send('ADD_TASK', { title, priority, description, repoPath });
  }, [send]);

  const approvePlan = useCallback((taskId) => {
    send('APPROVE_PLAN', { taskId });
  }, [send]);

  const rejectPlan = useCallback((taskId, feedback) => {
    send('REJECT_PLAN', { taskId, feedback });
  }, [send]);

  const injectMessage = useCallback((agentId, message) => {
    send('INJECT_MESSAGE', { agentId, message });
  }, [send]);

  const sendRaw = useCallback((agentId, data) => {
    send('INJECT_RAW', { agentId, data });
  }, [send]);

  const resizeTerminal = useCallback((agentId, cols, rows) => {
    send('RESIZE_TERMINAL', { agentId, cols, rows });
  }, [send]);

  const pauseAgent = useCallback((agentId) => {
    send('PAUSE_AGENT', { agentId });
  }, [send]);

  const resumeAgent = useCallback((agentId) => {
    send('RESUME_AGENT', { agentId });
  }, [send]);

  const pauseTask = useCallback((taskId) => {
    send('PAUSE_TASK', { taskId });
  }, [send]);

  const resumeTask = useCallback((taskId) => {
    send('RESUME_TASK', { taskId });
  }, [send]);

  const editTask = useCallback((taskId, updates) => {
    send('EDIT_TASK', { taskId, updates });
  }, [send]);

  const abortTask = useCallback((taskId) => {
    send('ABORT_TASK', { taskId });
  }, [send]);

  const resetTask = useCallback((taskId) => {
    send('RESET_TASK', { taskId });
  }, [send]);

  const retryTask = useCallback((taskId) => {
    send('RETRY_TASK', { taskId });
  }, [send]);

  const completeManualPr = useCallback((taskId) => {
    send('COMPLETE_MANUAL_PR', { taskId });
  }, [send]);

  const approveMaxReviewBlocker = useCallback((taskId) => {
    send('APPROVE_MAX_REVIEW_BLOCKER', { taskId });
  }, [send]);

  const extendMaxReviewBlocker = useCallback((taskId) => {
    send('EXTEND_MAX_REVIEW_BLOCKER', { taskId });
  }, [send]);

  const deleteTask = useCallback((taskId) => {
    send('DELETE_TASK', { taskId });
  }, [send]);

  const openTaskWorkspace = useCallback((taskId) => {
    send('OPEN_TASK_WORKSPACE', { taskId });
  }, [send]);

  const updateSettings = useCallback((newSettings) => {
    send('UPDATE_SETTINGS', newSettings);
  }, [send]);

  const openAgentTerminal = useCallback((agentId) => {
    send('OPEN_AGENT_TERMINAL', { agentId });
  }, [send]);

  const returnAgentTerminal = useCallback((agentId) => {
    send('RETURN_AGENT_TERMINAL', { agentId });
  }, [send]);

  const subscribeTerminal = useCallback((agentId, callback) => {
    termSubsRef.current.set(agentId, callback);
    send('SUBSCRIBE_TERMINAL', { agentId });
    return () => {
      termSubsRef.current.delete(agentId);
      send('UNSUBSCRIBE_TERMINAL', { agentId });
    };
  }, [send]);

  return {
    connected,
    isInitialized,
    tasks,
    agents,
    repos,
    settings,
    capabilities,
    notifications,
    addTask,
    approvePlan,
    rejectPlan,
    pauseTask,
    resumeTask,
    editTask,
    abortTask,
    resetTask,
    retryTask,
    completeManualPr,
    approveMaxReviewBlocker,
    extendMaxReviewBlocker,
    deleteTask,
    openTaskWorkspace,
    injectMessage,
    sendRaw,
    resizeTerminal,
    pauseAgent,
    resumeAgent,
    updateSettings,
    subscribeTerminal,
    openAgentTerminal,
    returnAgentTerminal,
  };
}
