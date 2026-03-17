import pty from 'node-pty';
import { existsSync, statSync, appendFileSync } from 'node:fs';
import bus from './events.js';
import { loadSettings } from './config.js';
import store from './store.js';

const ROLE_META = {
  planner: {
    prefix: 'plan',
    namePrefix: 'Planner',
    role: 'Plan Generation',
    icon: '\u270E',
    color: '#6AABDB',
  },
  implementor: {
    prefix: 'imp',
    namePrefix: 'Implementor',
    role: 'Code Generation',
    icon: '\u2692',
    colors: ['#A78BFA', '#34D399', '#60A5FA', '#F472B6', '#FB923C', '#A3E635', '#22D3EE', '#E879F9'],
  },
  reviewer: {
    prefix: 'rev',
    namePrefix: 'Reviewer',
    role: 'Code Review',
    icon: '\u2714',
    color: '#FFD166',
  },
};

const TOKEN_PATTERNS = [
  /tokens used\s*[:\r\n]+\s*(\d[\d, ]*)/i,
  /total tokens\s*[:=]\s*(\d[\d, ]*)/i,
  /total[_ ]tokens["'\s:=>]+(\d[\d, ]*)/i,
  /context(?: used)?\s*:\s*(\d[\d, ]*)/i,
  /(\d[\d, ]*)\s+(?:input\s+)?tokens\b/i,
];

const STRUCTURED_BLOCK_MARKERS = {
  plan: {
    start: '=== PLAN START ===',
    end: '=== PLAN END ===',
  },
  review: {
    start: '=== REVIEW START ===',
    end: '=== REVIEW END ===',
  },
  implementation: {
    start: '=== IMPLEMENTATION RESULT START ===',
    end: '=== IMPLEMENTATION RESULT END ===',
  },
};

function stripAnsi(text) {
  if (typeof text !== 'string') return text;
  // Replace cursor forward codes (\x1b[nC) with a space to preserve word boundaries.
  // eslint-disable-next-line no-control-regex
  let result = text.replace(/\x1b\[\d*C/g, ' ');
  return result.replace(
    // eslint-disable-next-line no-control-regex
    /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|\x1b\].*?(?:\x07|\x1b\\)|\r/g,
    ''
  );
}

function getLastStructuredBlock(text, startMarker, endMarker) {
  if (typeof text !== 'string' || !text) return null;
  const endIdx = text.lastIndexOf(endMarker);
  if (endIdx === -1) return null;
  const startIdx = text.lastIndexOf(startMarker, endIdx);
  if (startIdx === -1) return null;
  return text.slice(startIdx, endIdx + endMarker.length);
}

class Agent {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.role = def.role;
    this.icon = def.icon;
    this.color = def.color;
    this.cli = def.cli || 'claude';
    this.model = def.model || '';
    this.draining = false;
    this.status = 'idle';
    this.currentTask = null;
    this.taskLabel = '';
    this.tokens = 0;
    this.taskTokenBase = 0;
    this.maxTokens = 200000;
    this.startedAt = null;
    this.process = null;
    this.terminalBuffer = [];
    this.subscribers = new Set();
    this.lastOutputAt = null;
    this.bridge = {
      active: false,
      mode: null,
      owner: null,
      openedAt: null,
      outputPath: null,
    };
    this._lastTokenSync = null;
    this.structuredOutput = this._createStructuredOutputState();
    this.terminalSize = {
      cols: 220,
      rows: 50,
    };
  }

  _createStructuredOutputState() {
    return {
      plan: { pending: '', completed: null, allCompleted: [] },
      review: { pending: '', completed: null, allCompleted: [] },
      implementation: { pending: '', completed: null, allCompleted: [] },
    };
  }

  _resetStructuredOutput() {
    this.structuredOutput = this._createStructuredOutputState();
  }

  spawn(cwd, command) {
    if (this.process) this.kill();

    // Validate cwd is an existing directory
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
      const errorMsg = `\r\n[ERROR] Invalid working directory: ${cwd}\r\n`;
      this.terminalBuffer.push(errorMsg);
      for (const ws of this.subscribers) {
        try {
          ws.send(JSON.stringify({
            type: 'TERMINAL_DATA',
            payload: { agentId: this.id, data: errorMsg },
            ts: Date.now(),
          }));
        } catch { this.subscribers.delete(ws); }
      }
      return false;
    }

    this.status = 'active';
    this.startedAt = Date.now();
    this.terminalBuffer = [];
    this.tokens = 0;
    this.taskTokenBase = this.currentTask ? (store.getTask(this.currentTask)?.totalTokens || 0) : 0;
    this.lastOutputAt = Date.now();
    this._lastTokenSync = null;
    this.bridge = {
      active: false,
      mode: null,
      owner: null,
      openedAt: null,
      outputPath: null,
    };
    this._resetStructuredOutput();

    const env = { ...process.env, TERM: 'xterm-256color' };
    delete env.CLAUDECODE;
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : 'bash';
    const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-l', '-c', command];
    this.process = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: this.terminalSize.cols,
      rows: this.terminalSize.rows,
      cwd,
      env,
      // On Windows, use the ConPTY DLL path to avoid a node-pty bug where
      // the kill() method crashes when consoleProcessList resolves undefined.
      ...(isWindows ? { useConptyDll: true } : {}),
    });

    this.process.onData((data) => {
      this.terminalBuffer.push(data);
      if (this.terminalBuffer.length > 500) {
        this.terminalBuffer.shift();
      }
      this.lastOutputAt = Date.now();
      this._parseTokens(data);
      this._captureStructuredOutput(data);
      this._syncTaskTokens();
      if (this.bridge.active && this.bridge.outputPath) {
        try { appendFileSync(this.bridge.outputPath, data); } catch { /* ignore */ }
      }

      for (const ws of this.subscribers) {
        try {
          ws.send(JSON.stringify({
            type: 'TERMINAL_DATA',
            payload: { agentId: this.id, data },
            ts: Date.now(),
          }));
        } catch {
          this.subscribers.delete(ws);
        }
      }
    });

    this.process.onExit(() => {
      this.process = null;
      if (this.status === 'active') {
        this.status = 'idle';
        if (this.currentTask) {
          bus.emit('agent:unexpected-exit', { agentId: this.id, taskId: this.currentTask });
        }
      }
    });

    bus.emit('agent:updated', this.getStatus());
    return true;
  }

  _parseTokens(data) {
    const recentBuffer = this.getBufferString(80);
    for (const source of [recentBuffer, data]) {
      for (const pattern of TOKEN_PATTERNS) {
        const match = source.match(pattern);
        if (!match) continue;
        const parsed = parseInt(match[1].replace(/[,\s]/g, ''), 10);
        if (Number.isFinite(parsed) && parsed > this.tokens) {
          this.tokens = parsed;
        }
      }
    }
  }

  _captureStructuredOutput(data) {
    for (const [kind, markers] of Object.entries(STRUCTURED_BLOCK_MARKERS)) {
      const state = this.structuredOutput[kind];
      // Accumulate raw data so ANSI sequences split across chunks
      // are stripped correctly when we process the combined text.
      const rawCombined = `${state.pending}${data}`;
      const combined = stripAnsi(rawCombined);
      const completed = getLastStructuredBlock(combined, markers.start, markers.end);
      if (completed) {
        state.completed = completed;
        state.allCompleted.push(completed);
      }

      const lastStartIdx = combined.lastIndexOf(markers.start);
      const lastEndIdx = combined.lastIndexOf(markers.end);
      if (lastStartIdx !== -1 && lastStartIdx > lastEndIdx) {
        // Inside an open block — keep raw data for re-stripping next time
        state.pending = rawCombined;
      } else {
        const tailLength = Math.max(markers.start.length, markers.end.length) * 4;
        state.pending = rawCombined.slice(-tailLength);
      }
    }
  }

  getStructuredBlock(kind) {
    return this.structuredOutput[kind]?.completed || null;
  }

  getAllCapturedBlocks(kind) {
    return this.structuredOutput[kind]?.allCompleted || [];
  }

  _syncTaskTokens() {
    if (!this.currentTask || this.tokens <= 0) return;
    const now = Date.now();
    if (this._lastTokenSync && now - this._lastTokenSync < 2000) return;
    this._lastTokenSync = now;
    store.updateTaskTokens(this.currentTask, this.taskTokenBase + this.tokens);
    bus.emit('agent:updated', this.getStatus());
  }

  write(data) {
    if (this.process) {
      this.process.write(data);
      return true;
    }

    const errorMsg = '\r\n[ERROR] Agent is not running. Resolve the blocker and retry the task before sending input.\r\n';
    this.terminalBuffer.push(errorMsg);
    if (this.terminalBuffer.length > 500) {
      this.terminalBuffer.shift();
    }
    for (const ws of this.subscribers) {
      try {
        ws.send(JSON.stringify({
          type: 'TERMINAL_DATA',
          payload: { agentId: this.id, data: errorMsg },
          ts: Date.now(),
        }));
      } catch {
        this.subscribers.delete(ws);
      }
    }
    return false;
  }

  resize(cols, rows) {
    const nextCols = Math.max(20, Math.floor(Number(cols) || 0));
    const nextRows = Math.max(5, Math.floor(Number(rows) || 0));

    if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
      return false;
    }

    this.terminalSize = {
      cols: nextCols,
      rows: nextRows,
    };

    if (!this.process) return true;

    try {
      this.process.resize(nextCols, nextRows);
      return true;
    } catch {
      return false;
    }
  }

  kill() {
    if (this.process) {
      try { this.process.kill(); } catch { /* ignore */ }
      this.process = null;
    }
    this.status = 'idle';
    this.currentTask = null;
    this.taskLabel = '';
    this.taskTokenBase = 0;
    this.bridge = {
      active: false,
      mode: null,
      owner: null,
      openedAt: null,
      outputPath: null,
    };
    this._resetStructuredOutput();
    bus.emit('agent:updated', this.getStatus());
  }

  getBufferString(chunks = 50) {
    return this.terminalBuffer.slice(-chunks).join('');
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      icon: this.icon,
      color: this.color,
      status: this.draining ? 'draining' : this.status,
      task: this.taskLabel,
      currentTask: this.currentTask,
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      bridgeActive: this.bridge.active,
      bridgeMode: this.bridge.mode,
      bridgeOwner: this.bridge.owner,
      bridgeOpenedAt: this.bridge.openedAt,
      terminalSize: this.terminalSize,
      aggregatedTokens: this.currentTask
        ? Math.max(store.getTask(this.currentTask)?.totalTokens || 0, this.taskTokenBase + this.tokens)
        : 0,
    };
  }
}

const ROLE_MAP = {
  planners:     { meta: ROLE_META.planner,     prefix: 'plan' },
  implementors: { meta: ROLE_META.implementor,  prefix: 'imp' },
  reviewers:    { meta: ROLE_META.reviewer,      prefix: 'rev' },
};

class AgentManager {
  constructor() {
    this.agents = new Map();
    this._maxSettings = {};  // { planners: 4, implementors: 8, reviewers: 4 }
    this._cliSettings = {};  // { planners: 'claude', implementors: 'claude', reviewers: 'claude' }
    this._modelSettings = {}; // { planners: '', implementors: 'opus', reviewers: 'haiku' }
    this._sessionCounters = { plan: 0, imp: 0, rev: 0 };

    // Orchestrator is always present
    const orch = new Agent({
      id: 'orch',
      name: 'Orchestrator',
      role: 'Pipeline Control',
      icon: '\u2699',
      color: '#F5A623',
    });
    orch.status = 'active';
    orch.startedAt = Date.now();
    orch.taskLabel = 'Pipeline Control';
    this.agents.set('orch', orch);

    this.reconfigure(loadSettings());
  }

  reconfigure(settings) {
    for (const [settingsKey, { prefix }] of Object.entries(ROLE_MAP)) {
      const cfg = settings.agents[settingsKey];
      this._maxSettings[settingsKey] = cfg.max;
      this._cliSettings[settingsKey] = cfg.cli;
      this._modelSettings[settingsKey] = cfg.model || '';

      // Scale down if current count exceeds new max
      const currentAgents = this.getAgentsByRole(prefix);
      if (currentAgents.length > cfg.max) {
        const toRemove = currentAgents.slice(cfg.max);
        for (const agent of toRemove) {
          if (agent.status === 'idle') {
            this.removeAgent(agent.id);
          } else {
            agent.draining = true;
            bus.emit('agent:updated', agent.getStatus());
          }
        }
      }

      // Update CLI and model on all existing non-draining agents for this role
      for (const agent of this.getAgentsByRole(prefix)) {
        if (!agent.draining) {
          agent.cli = cfg.cli;
          agent.model = cfg.model || '';
        }
      }
    }
  }

  // Scale up a role by one agent, returns the new agent or null if at max
  scaleUp(settingsKey) {
    const { meta, prefix } = ROLE_MAP[settingsKey];
    const max = this._maxSettings[settingsKey] ?? 1;
    const cli = this._cliSettings[settingsKey] || 'claude';
    const model = this._modelSettings[settingsKey] || '';
    const current = this.getAgentsByRole(prefix);

    if (current.length >= max) return null;

    const nextNum = (this._sessionCounters[prefix] ?? 0) + 1;
    this._sessionCounters[prefix] = nextNum;

    const color = meta.colors ? meta.colors[(nextNum - 1) % meta.colors.length] : meta.color;
    const agent = new Agent({
      id: `${prefix}-${nextNum}`,
      name: `${meta.namePrefix} ${nextNum}`,
      role: meta.role,
      icon: meta.icon,
      color,
      cli,
      model,
    });
    this.agents.set(agent.id, agent);
    bus.emit('agent:updated', agent.getStatus());
    return agent;
  }

  getMaxForRole(settingsKey) {
    return this._maxSettings[settingsKey] ?? 1;
  }

  get(id) {
    return this.agents.get(id);
  }

  getAllStatus() {
    return Array.from(this.agents.values()).map(a => a.getStatus());
  }

  getAgentsByRole(prefix) {
    return Array.from(this.agents.values())
      .filter(a => a.id.startsWith(prefix + '-'))
      .sort((a, b) => {
        const numA = parseInt(a.id.split('-')[1], 10);
        const numB = parseInt(b.id.split('-')[1], 10);
        return numA - numB;
      });
  }

  getAvailableByRole(prefix) {
    return this.getAgentsByRole(prefix).find(a => (
      a.status === 'idle'
      && !a.draining
      && !a.currentTask
      && !a.process
    )) || null;
  }

  getAvailablePlanner() {
    return this.getAvailableByRole('plan');
  }

  getAvailableImplementor() {
    return this.getAvailableByRole('imp');
  }

  getAvailableReviewer() {
    return this.getAvailableByRole('rev');
  }

  removeAgent(id) {
    const agent = this.agents.get(id);
    if (!agent) return;
    // Clean up subscribers
    for (const ws of agent.subscribers) {
      try {
        ws.send(JSON.stringify({
          type: 'TERMINAL_DATA',
          payload: { agentId: id, data: '\r\n[Agent removed]\r\n' },
          ts: Date.now(),
        }));
      } catch { /* ignore */ }
    }
    agent.subscribers.clear();
    this.agents.delete(id);
    bus.emit('agent:removed', { agentId: id });
  }
}

const agentManager = new AgentManager();
export default agentManager;
