import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname as pathDirname, join } from 'node:path';
import config, { loadSettings, saveSettings, validateSettings, getRepos, refreshRepos } from './config.js';
import store from './store.js';
import agentManager from './agents.js';
import bus from './events.js';

const app = express();
app.use(cors());
app.use(express.json());

// REST API
app.get('/api/status', (req, res) => {
  res.json({
    agents: agentManager.getAllStatus(),
    tasks: store.getAllTasks(),
    uptime: process.uptime(),
  });
});

app.get('/api/repos', (req, res) => {
  res.json({ repos: getRepos() });
});

app.get('/api/browse-dir', (req, res) => {
  const requestedPath = req.query.path || homedir();
  const absPath = resolve(requestedPath);

  if (!existsSync(absPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }

  try {
    const stat = statSync(absPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = readdirSync(absPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const parent = pathDirname(absPath);
    res.json({
      current: absPath,
      parent: parent !== absPath ? parent : null,
      dirs,
    });
  } catch (err) {
    res.status(403).json({ error: 'Permission denied' });
  }
});

app.post('/api/tasks', (req, res) => {
  const { title, priority, description, repoPath } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const task = store.addTask({ title, priority, description, repoPath });
  res.status(201).json(task);
});

app.patch('/api/tasks/:id/approve', (req, res) => {
  const task = store.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  bus.emit('plan:approved', task.id);
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/reject', (req, res) => {
  const task = store.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { feedback } = req.body || {};
  bus.emit('plan:rejected', { taskId: task.id, feedback: feedback || '' });
  res.json({ ok: true });
});

app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

app.put('/api/settings', (req, res) => {
  const settings = req.body;
  const errors = validateSettings(settings);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  saveSettings(settings);
  bus.emit('settings:changed', settings);
  broadcast('SETTINGS_UPDATED', settings);
  res.json(settings);
});

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

const wsClients = new Set();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { wsClients.delete(ws); }
  }
}

wss.on('connection', (ws) => {
  wsClients.add(ws);

  // Send INIT
  ws.send(JSON.stringify({
    type: 'INIT',
    payload: {
      tasks: store.getAllTasks(),
      agents: agentManager.getAllStatus(),
      repos: getRepos(),
      settings: loadSettings(),
    },
    ts: Date.now(),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'ADD_TASK': {
        const { title, priority, description, repoPath } = msg.payload || {};
        if (title) store.addTask({ title, priority, description, repoPath });
        break;
      }
      case 'APPROVE_PLAN': {
        const { taskId } = msg.payload || {};
        if (taskId) bus.emit('plan:approved', taskId);
        break;
      }
      case 'REJECT_PLAN': {
        const { taskId, feedback } = msg.payload || {};
        if (taskId) bus.emit('plan:rejected', { taskId, feedback: feedback || '' });
        break;
      }
      case 'UPDATE_SETTINGS': {
        const settings = msg.payload;
        const errors = validateSettings(settings);
        if (errors.length > 0) {
          try {
            ws.send(JSON.stringify({
              type: 'SETTINGS_ERROR',
              payload: { errors },
              ts: Date.now(),
            }));
          } catch { /* ignore */ }
          break;
        }
        saveSettings(settings);
        bus.emit('settings:changed', settings);
        broadcast('SETTINGS_UPDATED', settings);
        break;
      }
      case 'PAUSE_TASK': {
        const { taskId } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task && !['done', 'paused'].includes(task.status)) {
          const previousStatus = task.status;
          // Kill assigned agent if any
          if (task.assignedTo) {
            const agent = agentManager.get(task.assignedTo);
            if (agent) {
              agent.kill();
            }
          }
          store.updateTask(taskId, {
            status: 'paused',
            previousStatus,
            assignedTo: null,
          });
        }
        break;
      }
      case 'RESUME_TASK': {
        const { taskId } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task && task.status === 'paused') {
          // Map previous status to a safe re-entry point
          const safeStatus = {
            planning: 'backlog',
            implementing: 'queued',
            review: 'queued',
            queued: 'queued',
            awaiting_approval: 'awaiting_approval',
            awaiting_human_review: 'awaiting_human_review',
            workspace_setup: 'awaiting_approval',
          };
          const resumeTo = safeStatus[task.previousStatus] || 'backlog';
          store.updateTask(taskId, {
            status: resumeTo,
            previousStatus: null,
          });
        }
        break;
      }
      case 'ABORT_TASK': {
        const { taskId } = msg.payload || {};
        if (taskId) orchestrator.abortTask(taskId);
        break;
      }
      case 'RETRY_TASK': {
        const { taskId } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task && task.status === 'blocked') {
          const retryStatus = task.plan ? 'awaiting_approval' : 'backlog';
          store.updateTask(taskId, {
            status: retryStatus,
            blockedReason: null,
            assignedTo: null,
            workspacePath: null,
          });
          broadcast('TASK_RETRIED', { taskId, retryStatus });
        }
        break;
      }
      case 'EDIT_TASK': {
        const { taskId, updates } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task && updates) {
          const allowed = {};
          if (updates.title !== undefined) allowed.title = updates.title;
          if (updates.description !== undefined) allowed.description = updates.description;
          if (updates.priority !== undefined) allowed.priority = updates.priority;
          if (updates.repoPath !== undefined) allowed.repoPath = updates.repoPath;
          if (Object.keys(allowed).length > 0) {
            store.updateTask(taskId, allowed);
          }
        }
        break;
      }
      case 'INJECT_MESSAGE': {
        const { agentId, message } = msg.payload || {};
        const agent = agentManager.get(agentId);
        if (agent) agent.write(message + '\n');
        break;
      }
      case 'INJECT_RAW': {
        const { agentId, data } = msg.payload || {};
        const agent = agentManager.get(agentId);
        if (agent) agent.write(data);
        break;
      }
      case 'PAUSE_AGENT': {
        const agent = agentManager.get(msg.payload?.agentId);
        if (agent) { agent.status = 'paused'; bus.emit('agent:updated', agent.getStatus()); }
        break;
      }
      case 'RESUME_AGENT': {
        const agent = agentManager.get(msg.payload?.agentId);
        if (agent && agent.process) { agent.status = 'active'; bus.emit('agent:updated', agent.getStatus()); }
        break;
      }
      case 'SUBSCRIBE_TERMINAL': {
        const agent = agentManager.get(msg.payload?.agentId);
        if (agent) {
          agent.subscribers.add(ws);
          // Replay buffer
          for (const chunk of agent.terminalBuffer) {
            try {
              ws.send(JSON.stringify({
                type: 'TERMINAL_DATA',
                payload: { agentId: agent.id, data: chunk },
                ts: Date.now(),
              }));
            } catch { break; }
          }
        }
        break;
      }
      case 'UNSUBSCRIBE_TERMINAL': {
        const agent = agentManager.get(msg.payload?.agentId);
        if (agent) agent.subscribers.delete(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    // Remove from all agent subscriber sets
    for (const [, agent] of agentManager.agents) {
      agent.subscribers.delete(ws);
    }
  });
});

// Event bus → WS broadcast
bus.on('tasks:changed', (tasks) => broadcast('TASKS_UPDATED', { tasks }));
bus.on('task:added', (task) => broadcast('TASK_ADDED', { task }));
bus.on('agent:updated', (agent) => broadcast('AGENT_UPDATED', { agent }));
bus.on('agents:updated', (agents) => broadcast('AGENTS_UPDATED', { agents }));
bus.on('agent:removed', (data) => broadcast('AGENT_REMOVED', data));
bus.on('plan:ready', (data) => broadcast('PLAN_READY', data));
bus.on('review:passed', (data) => broadcast('REVIEW_PASSED', data));
bus.on('review:failed', (data) => broadcast('REVIEW_FAILED', data));
bus.on('pr:created', (data) => broadcast('PR_CREATED', data));
bus.on('task:blocked', (data) => broadcast('TASK_BLOCKED', data));
bus.on('repos:updated', (repos) => broadcast('REPOS_UPDATED', { repos }));
bus.on('plan:partial', (data) => broadcast('PLAN_PARTIAL', data));
bus.on('task:aborted', (data) => broadcast('TASK_ABORTED', data));

// Startup
store.restartRecovery();

// Startup orphan workspace cleanup
{
  const settings = loadSettings();
  const workspacesDir = join(settings.reposDir, 'workspaces');
  if (existsSync(workspacesDir)) {
    const terminalStatuses = ['done', 'backlog', 'awaiting_human_review'];
    let entries;
    try { entries = readdirSync(workspacesDir); } catch { entries = []; }
    for (const entry of entries) {
      const task = store.getTask(entry);
      if (!task || terminalStatuses.includes(task.status)) {
        try {
          rmSync(join(workspacesDir, entry), { recursive: true, force: true });
          console.log(`Cleaned up orphan workspace: ${entry}`);
        } catch (err) {
          console.error(`Failed to cleanup workspace ${entry}:`, err.message);
        }
      }
    }
  }
}

// Import orchestrator after everything is set up
const { default: orchestrator } = await import('./orchestrator.js');
orchestrator.start();

server.listen(config.PORT, () => {
  console.log(`AI Factory server running on http://localhost:${config.PORT}`);
});
