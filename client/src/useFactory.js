import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://localhost:3001';
const RECONNECT_INTERVAL = 3000;
const MAX_NOTIFICATIONS = 5;
const NOTIFICATION_TIMEOUT = 5000;

export default function useFactory() {
  const [connected, setConnected] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [repos, setRepos] = useState([]);
  const [settings, setSettings] = useState(null);
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
        case 'TERMINAL_DATA': {
          const cb = termSubsRef.current.get(msg.payload.agentId);
          if (cb) cb(msg.payload.data);
          break;
        }
        case 'PLAN_READY':
          addNotification(`Plan ready for ${msg.payload.taskId} — approval needed`, 'warning');
          break;
        case 'PR_CREATED':
          addNotification(`PR created for ${msg.payload.taskId}`, 'success');
          break;
        case 'TASK_BLOCKED':
          addNotification(`${msg.payload.taskId} blocked: ${msg.payload.reason}`, 'error');
          break;
        case 'REVIEW_FAILED':
          addNotification(`Review failed for ${msg.payload.taskId} — returning to implementor`, 'warning');
          break;
        case 'REVIEW_PASSED':
          addNotification(`Review passed for ${msg.payload.taskId}`, 'success');
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

  const pauseAgent = useCallback((agentId) => {
    send('PAUSE_AGENT', { agentId });
  }, [send]);

  const resumeAgent = useCallback((agentId) => {
    send('RESUME_AGENT', { agentId });
  }, [send]);

  const updateSettings = useCallback((newSettings) => {
    send('UPDATE_SETTINGS', newSettings);
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
    tasks,
    agents,
    repos,
    settings,
    notifications,
    addTask,
    approvePlan,
    rejectPlan,
    injectMessage,
    pauseAgent,
    resumeAgent,
    updateSettings,
    subscribeTerminal,
  };
}
