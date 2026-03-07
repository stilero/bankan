import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import config from './config.js';
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
  res.json({ repos: config.REPOS });
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
      repos: config.REPOS,
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
      case 'INJECT_MESSAGE': {
        const { agentId, message } = msg.payload || {};
        const agent = agentManager.get(agentId);
        if (agent) agent.write(message + '\n');
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
bus.on('plan:ready', (data) => broadcast('PLAN_READY', data));
bus.on('review:passed', (data) => broadcast('REVIEW_PASSED', data));
bus.on('review:failed', (data) => broadcast('REVIEW_FAILED', data));
bus.on('pr:created', (data) => broadcast('PR_CREATED', data));
bus.on('task:blocked', (data) => broadcast('TASK_BLOCKED', data));

// Startup
store.restartRecovery();

// Import orchestrator after everything is set up
const { default: orchestrator } = await import('./orchestrator.js');
orchestrator.start();

server.listen(config.PORT, () => {
  console.log(`AI Factory server running on http://localhost:${config.PORT}`);
});
