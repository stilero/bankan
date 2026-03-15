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

class Agent {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.role = def.role;
    this.icon = def.icon;
    this.color = def.color;
    this.cli = def.cli || 'claude';
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
    this.bridge = {
      active: false,
      mode: null,
      owner: null,
      openedAt: null,
      outputPath: null,
    };

    const env = { ...process.env, TERM: 'xterm-256color' };
    delete env.CLAUDECODE;
    this.process = pty.spawn('bash', ['-l', '-c', command], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env,
    });

    this.process.onData((data) => {
      this.terminalBuffer.push(data);
      if (this.terminalBuffer.length > 500) {
        this.terminalBuffer.shift();
      }
      this.lastOutputAt = Date.now();
      this._parseTokens(data);
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

  _syncTaskTokens() {
    if (!this.currentTask || this.tokens <= 0) return;
    store.updateTaskTokens(this.currentTask, this.taskTokenBase + this.tokens);
    bus.emit('agent:updated', this.getStatus());
  }

  resize(cols, rows) {
    if (this.process) {
      try { this.process.resize(cols, rows); } catch { /* ignore */ }
    }
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
    for (const [settingsKey, { meta, prefix }] of Object.entries(ROLE_MAP)) {
      const cfg = settings.agents[settingsKey];
      this._maxSettings[settingsKey] = cfg.max;
      this._cliSettings[settingsKey] = cfg.cli;

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

      // Update CLI on all existing non-draining agents for this role
      for (const agent of this.getAgentsByRole(prefix)) {
        if (!agent.draining) {
          agent.cli = cfg.cli;
        }
      }
    }
  }

  // Scale up a role by one agent, returns the new agent or null if at max
  scaleUp(settingsKey) {
    const { meta, prefix } = ROLE_MAP[settingsKey];
    const max = this._maxSettings[settingsKey] ?? 1;
    const cli = this._cliSettings[settingsKey] || 'claude';
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
