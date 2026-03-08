import pty from 'node-pty';
import bus from './events.js';
import { loadSettings } from './config.js';

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

const CLAUDE_TOKEN_RE = /(\d[\d,]+)\s+(?:input\s+)?tokens/i;
const CODEX_TOKEN_RE = /context:\s*(\d[\d,]+)/i;

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
    this.maxTokens = 200000;
    this.startedAt = null;
    this.process = null;
    this.terminalBuffer = [];
    this.subscribers = new Set();
    this.lastOutputAt = null;
  }

  spawn(cwd, command) {
    if (this.process) this.kill();

    this.status = 'active';
    this.startedAt = Date.now();
    this.terminalBuffer = [];
    this.tokens = 0;
    this.lastOutputAt = Date.now();

    this.process = pty.spawn('bash', ['-l', '-c', command], {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this.process.onData((data) => {
      this.terminalBuffer.push(data);
      if (this.terminalBuffer.length > 500) {
        this.terminalBuffer.shift();
      }
      this.lastOutputAt = Date.now();
      this._parseTokens(data);

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
      }
    });

    bus.emit('agent:updated', this.getStatus());
  }

  _parseTokens(data) {
    let match = data.match(CLAUDE_TOKEN_RE) || data.match(CODEX_TOKEN_RE);
    if (match) {
      const parsed = parseInt(match[1].replace(/,/g, ''), 10);
      if (parsed > this.tokens) {
        this.tokens = parsed;
      }
    }
  }

  write(data) {
    if (this.process) {
      this.process.write(data);
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
    };
  }
}

class AgentManager {
  constructor() {
    this.agents = new Map();

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

    // Create agents from settings
    this.reconfigure(loadSettings());
  }

  reconfigure(settings) {
    const roleMap = {
      planners:     { meta: ROLE_META.planner,     settingsKey: 'planners' },
      implementors: { meta: ROLE_META.implementor,  settingsKey: 'implementors' },
      reviewers:    { meta: ROLE_META.reviewer,      settingsKey: 'reviewers' },
    };

    for (const [settingsKey, { meta }] of Object.entries(roleMap)) {
      const cfg = settings.agents[settingsKey];
      const desired = cfg.count;
      const prefix = meta.prefix;

      // Get current agents for this role
      const current = this.getAgentsByRole(prefix);
      const currentCount = current.length;

      if (desired > currentCount) {
        // Scale up: create new agents
        for (let i = currentCount + 1; i <= desired; i++) {
          const color = meta.colors ? meta.colors[(i - 1) % meta.colors.length] : meta.color;
          const agent = new Agent({
            id: `${prefix}-${i}`,
            name: `${meta.namePrefix} ${i}`,
            role: meta.role,
            icon: meta.icon,
            color,
            cli: cfg.cli,
          });
          this.agents.set(agent.id, agent);
          bus.emit('agent:updated', agent.getStatus());
        }
      } else if (desired < currentCount) {
        // Scale down: remove highest-numbered agents first
        const toRemove = current.slice(desired);
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
    return this.getAgentsByRole(prefix).find(a => a.status === 'idle' && !a.draining) || null;
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
