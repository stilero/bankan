import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readdirSync, statSync, existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname as pathDirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config, { loadSettings, saveSettings, validateSettings, getWorkspacesDir, getRuntimeStatePaths } from './config.js';
import store from './store.js';
import agentManager from './agents.js';
import bus from './events.js';
import { getLiveTaskAgent, stageToRetryStatus } from './workflow.js';
import { createSessionEntry } from './sessionHistory.js';

const app = express();
app.use(cors());
app.use(express.json());

function stageToResumeStatus(task) {
  const settings = loadSettings();
  const planningDisabled = settings.agents?.planners?.max === 0;
  const previousStatus = task.previousStatus;
  if (previousStatus) {
    if (previousStatus === 'blocked') {
      return 'blocked';
    }
    if (previousStatus === 'awaiting_approval') {
      return 'awaiting_approval';
    }
    if (['workspace_setup', 'planning', 'backlog', 'queued', 'implementing', 'review'].includes(previousStatus)) {
      if (planningDisabled && ['workspace_setup', 'planning', 'backlog'].includes(previousStatus)) {
        return 'queued';
      }
      return previousStatus;
    }
  }
  if (task.lastActiveStage === 'review') {
    return 'review';
  }
  if (task.lastActiveStage === 'implementation') {
    return 'queued';
  }
  if (task.lastActiveStage === 'planning') {
    return task.plan ? 'awaiting_approval' : (planningDisabled ? 'queued' : 'backlog');
  }
  return planningDisabled ? 'queued' : 'backlog';
}

function resolveRetryStatus(task) {
  const settings = loadSettings();
  const planningDisabled = settings.agents?.planners?.max === 0;
  const liveAgent = getLiveTaskAgent(task, agentManager);
  return stageToRetryStatus(task, { planningDisabled, liveAgent });
}

// REST API
app.get('/api/status', (req, res) => {
  res.json({
    agents: agentManager.getAllStatus(),
    tasks: store.getAllTasks(),
    uptime: process.uptime(),
  });
});

app.get('/api/repos', (req, res) => {
  res.json({ repos: loadSettings().repos || [] });
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

app.delete('/api/tasks/:id', async (req, res) => {
  const task = store.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'done') return res.status(400).json({ error: 'Only completed tasks can be deleted' });
  await orchestrator.deleteTask(task.id);
  broadcast('TASK_DELETED', { taskId: task.id });
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
  const persistedSettings = loadSettings();
  bus.emit('settings:changed', persistedSettings);
  broadcast('SETTINGS_UPDATED', persistedSettings);
  res.json(persistedSettings);
});

const runtimePaths = getRuntimeStatePaths();
const CLIENT_DIST_DIR = runtimePaths.clientDistDir;

if (existsSync(CLIENT_DIST_DIR)) {
  app.use(express.static(CLIENT_DIST_DIR));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(join(CLIENT_DIST_DIR, 'index.html'));
  });
}

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

const wsClients = new Set();
const bridgeSessions = new Map();
const BRIDGES_DIR = runtimePaths.bridgesDir;

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { wsClients.delete(ws); }
  }
}

function sendToClient(ws, type, payload) {
  try {
    ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  } catch {
    wsClients.delete(ws);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ensureBridgeFiles() {
  mkdirSync(BRIDGES_DIR, { recursive: true });
}

function getBridgeStatus(outputPath) {
  return {
    active: true,
    mode: 'terminal-app',
    owner: 'Terminal.app',
    openedAt: new Date().toISOString(),
    outputPath,
  };
}

function closeBridge(agent, { broadcastEvent = true, notifyType = 'BRIDGE_RETURNED' } = {}) {
  const session = bridgeSessions.get(agent.id);
  if (session) {
    clearInterval(session.pollTimer);
    try { rmSync(session.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    bridgeSessions.delete(agent.id);
  }

  if (agent.bridge.active) {
    agent.bridge = {
      active: false,
      mode: null,
      owner: null,
      openedAt: null,
      outputPath: null,
    };
    bus.emit('agent:updated', agent.getStatus());
    if (broadcastEvent) {
      broadcast(notifyType, { agentId: agent.id, agentName: agent.name });
    }
  }
}

function retireAgent(agent, { taskId = agent?.currentTask || null, outcome = 'completed' } = {}) {
  if (!agent || agent.id === 'orch') return;
  if (taskId) {
    store.appendSession(taskId, createSessionEntry(agent, {
      taskId,
      outcome,
      transcript: agent.getBufferString(500),
    }));
  }
  agent.kill();
  agentManager.removeAgent(agent.id);
}

function readBridgeAppend(session, key) {
  try {
    const content = readFileSync(session[key], 'utf-8');
    const previousLength = session.offsets[key] || 0;
    const chunk = content.slice(previousLength);
    session.offsets[key] = content.length;
    return chunk;
  } catch {
    return '';
  }
}

function processBridgeInput(agent, session) {
  const controlChunk = readBridgeAppend(session, 'controlPath');
  if (controlChunk.includes('RETURN')) {
    closeBridge(agent);
    return;
  }

  const inputChunk = readBridgeAppend(session, 'inputPath');
  if (!inputChunk) return;

  const lines = inputChunk
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(Boolean);

  for (const line of lines) {
    agent.write(line + '\n');
  }
}

function openBridgeInTerminal(agent) {
  if (!agent?.process || !agent.currentTask) {
    return { ok: false, message: 'Agent session is not running.' };
  }

  const task = store.getTask(agent.currentTask);
  if (!task) {
    return { ok: false, message: 'Task state was not found for this agent.' };
  }

  if (agent.bridge.active) {
    return { ok: true };
  }

  ensureBridgeFiles();
  const sessionDir = join(BRIDGES_DIR, agent.id);
  mkdirSync(sessionDir, { recursive: true });

  const inputPath = join(sessionDir, 'input.log');
  const controlPath = join(sessionDir, 'control.log');
  const outputPath = join(sessionDir, 'output.log');
  const scriptPath = join(sessionDir, 'bridge.sh');

  writeFileSync(inputPath, '');
  writeFileSync(controlPath, '');
  writeFileSync(outputPath, agent.getBufferString(500));
  writeFileSync(scriptPath, `#!/bin/bash
clear
echo "Ban Kan terminal bridge for ${agent.name}"
echo "Task: ${task.title}"
echo
echo "Type a line and press Enter to send it to the live agent session."
echo "Type /return to hand control back to Ban Kan."
echo
tail -n +1 -f ${shellQuote(outputPath)} &
TAIL_PID=$!
trap 'kill $TAIL_PID 2>/dev/null' EXIT

while IFS= read -r line; do
  if [ "$line" = "/return" ]; then
    printf "RETURN\\n" >> ${shellQuote(controlPath)}
    break
  fi
  printf "%s\\n" "$line" >> ${shellQuote(inputPath)}
done
`);
  chmodSync(scriptPath, 0o755);

  const session = {
    dir: sessionDir,
    inputPath,
    controlPath,
    outputPath,
    offsets: {
      inputPath: 0,
      controlPath: 0,
    },
    pollTimer: null,
  };

  session.pollTimer = setInterval(() => {
    if (!agent.process) {
      closeBridge(agent, { broadcastEvent: false });
      return;
    }
    processBridgeInput(agent, session);
  }, 250);

  bridgeSessions.set(agent.id, session);
  agent.bridge = getBridgeStatus(outputPath);
  bus.emit('agent:updated', agent.getStatus());

  try {
    const shellCommand = `bash ${shellQuote(scriptPath)}`;
    execFileSync('osascript', [
      '-e', 'tell application "Terminal" to activate',
      '-e', `tell application "Terminal" to do script ${JSON.stringify(shellCommand)}`,
    ]);
  } catch (err) {
    closeBridge(agent, { broadcastEvent: false });
    return { ok: false, message: `Failed to open Terminal.app: ${err.message}` };
  }

  broadcast('BRIDGE_OPENED', { agentId: agent.id, agentName: agent.name });
  return { ok: true };
}

function launchVsCodeWorkspace(workspacePath) {
  const attempts = [];

  const tryCommand = (command, args) => {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
      return true;
    } catch (err) {
      attempts.push(`${command}: ${err.message}`);
      return false;
    }
  };

  if (process.platform === 'darwin') {
    if (
      tryCommand('code', ['-n', workspacePath]) ||
      tryCommand('open', ['-a', 'Visual Studio Code', workspacePath]) ||
      tryCommand('open', ['-a', 'Visual Studio Code - Insiders', workspacePath])
    ) {
      return { ok: true };
    }
  } else if (process.platform === 'win32') {
    if (
      tryCommand('code.cmd', ['-n', workspacePath]) ||
      tryCommand('cmd', ['/c', 'start', '', 'code', '-n', workspacePath])
    ) {
      return { ok: true };
    }
  } else {
    if (
      tryCommand('code', ['-n', workspacePath]) ||
      tryCommand('code-insiders', ['-n', workspacePath])
    ) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    message: `Failed to launch VS Code. Tried: ${attempts.join('; ') || 'no launcher commands available'}`,
  };
}

function openTaskWorkspace(taskId) {
  const task = store.getTask(taskId);
  if (!task) {
    return { ok: false, message: 'Task not found.' };
  }

  if (!task.workspacePath) {
    return { ok: false, message: `Task ${task.id} does not have a local workspace yet.` };
  }

  if (!existsSync(task.workspacePath)) {
    return { ok: false, message: `Workspace path does not exist: ${task.workspacePath}` };
  }

  try {
    if (!statSync(task.workspacePath).isDirectory()) {
      return { ok: false, message: `Workspace path is not a directory: ${task.workspacePath}` };
    }
  } catch (err) {
    return { ok: false, message: `Unable to inspect workspace path: ${err.message}` };
  }

  const launchResult = launchVsCodeWorkspace(task.workspacePath);
  if (!launchResult.ok) {
    return launchResult;
  }

  return {
    ok: true,
    message: `Opened ${task.id} in VS Code`,
  };
}

wss.on('connection', (ws) => {
  wsClients.add(ws);

  // Send INIT
  ws.send(JSON.stringify({
    type: 'INIT',
    payload: {
      tasks: store.getAllTasks(),
      agents: agentManager.getAllStatus(),
      repos: loadSettings().repos || [],
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
        const persistedSettings = loadSettings();
        bus.emit('settings:changed', persistedSettings);
        broadcast('SETTINGS_UPDATED', persistedSettings);
        break;
      }
      case 'PAUSE_TASK': {
        const { taskId } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task && !['done', 'paused', 'aborted'].includes(task.status)) {
          const previousStatus = task.status;
          // Kill assigned agent if any
          if (task.assignedTo) {
            const agent = agentManager.get(task.assignedTo);
            if (agent) {
              retireAgent(agent, { taskId, outcome: 'paused' });
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
          const resumeTo = stageToResumeStatus(task);
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
      case 'RESET_TASK': {
        const { taskId } = msg.payload || {};
        if (taskId) orchestrator.resetTask(taskId);
        break;
      }
      case 'DELETE_TASK': {
        const { taskId } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task?.status === 'done') {
          orchestrator.deleteTask(taskId);
          broadcast('TASK_DELETED', { taskId });
        }
        break;
      }
      case 'RETRY_TASK': {
        const { taskId } = msg.payload || {};
        const task = store.getTask(taskId);
        if (task && task.status === 'blocked') {
          const retryStatus = resolveRetryStatus(task);
          const agent = getLiveTaskAgent(task, agentManager);

          if (agent) {
            agent.status = 'active';
            bus.emit('agent:updated', agent.getStatus());
          }

          store.updateTask(taskId, {
            status: retryStatus,
            blockedReason: null,
            assignedTo: agent ? task.assignedTo : null,
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
        if (agent?.bridge.active) {
          try {
            ws.send(JSON.stringify({
              type: 'BRIDGE_ERROR',
              payload: { message: `${agent.name} input is currently locked to Terminal.app.` },
              ts: Date.now(),
            }));
          } catch { /* ignore */ }
        } else if (agent) {
          agent.write(message + '\n');
        }
        break;
      }
      case 'INJECT_RAW': {
        const { agentId, data } = msg.payload || {};
        const agent = agentManager.get(agentId);
        if (agent?.bridge.active) {
          try {
            ws.send(JSON.stringify({
              type: 'BRIDGE_ERROR',
              payload: { message: `${agent.name} input is currently locked to Terminal.app.` },
              ts: Date.now(),
            }));
          } catch { /* ignore */ }
        } else if (agent) {
          agent.write(data);
        }
        break;
      }
      case 'RESIZE_TERMINAL': {
        const { agentId, cols, rows } = msg.payload || {};
        const agent = agentManager.get(agentId);
        if (agent) {
          agent.resize(cols, rows);
          bus.emit('agent:updated', agent.getStatus());
        }
        break;
      }
      case 'OPEN_TASK_WORKSPACE': {
        const { taskId } = msg.payload || {};
        const result = openTaskWorkspace(taskId);
        if (result.ok) {
          sendToClient(ws, 'TASK_WORKSPACE_OPENED', { taskId, message: result.message });
        } else {
          sendToClient(ws, 'TASK_WORKSPACE_ERROR', { taskId, message: result.message });
        }
        break;
      }
      case 'OPEN_AGENT_TERMINAL': {
        const agent = agentManager.get(msg.payload?.agentId);
        const result = openBridgeInTerminal(agent);
        if (!result.ok) {
          sendToClient(ws, 'BRIDGE_ERROR', { message: result.message });
        }
        break;
      }
      case 'RETURN_AGENT_TERMINAL': {
        const agent = agentManager.get(msg.payload?.agentId);
        if (agent) closeBridge(agent);
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
bus.on('task:reset', (data) => broadcast('TASK_RESET', data));
bus.on('agent:updated', (agentStatus) => {
  broadcast('AGENT_UPDATED', { agent: agentStatus });
  if (!agentStatus.bridgeActive && bridgeSessions.has(agentStatus.id)) {
    const agent = agentManager.get(agentStatus.id);
    if (agent) closeBridge(agent, { broadcastEvent: false });
  }
});

let orchestrator = null;
let startupPromise = null;

async function ensureAppStarted() {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    store.restartRecovery();

    const workspacesDir = getWorkspacesDir();
    if (existsSync(workspacesDir)) {
      const terminalStatuses = ['done', 'backlog', 'aborted', 'awaiting_human_review'];
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

    const imported = await import('./orchestrator.js');
    orchestrator = imported.default;
    orchestrator.start();
  })();

  return startupPromise;
}

let started = false;

export async function startServer({ port = config.PORT, host = '127.0.0.1' } = {}) {
  if (started) {
    const address = server.address();
    if (address && typeof address === 'object') {
      return { server, port: address.port, host };
    }
    return { server, port, host };
  }

  await ensureAppStarted();

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.off('error', rejectPromise);
      started = true;
      resolvePromise();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Ban Kan server running on http://${host}:${resolvedPort}`);
  return { server, port: resolvedPort, host };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentModulePath = fileURLToPath(import.meta.url);

if (entryPath === currentModulePath) {
  startServer().catch((err) => {
    console.error('Failed to start Ban Kan:', err);
    process.exit(1);
  });
}
