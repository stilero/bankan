import pty from 'node-pty';
import bus from './events.js';

const AGENT_DEFS = [
  { id: 'orch', name: 'Orchestrator', role: 'Pipeline Control', icon: '\u2699', color: '#F5A623' },
  { id: 'plan', name: 'Planner', role: 'Plan Generation', icon: '\u270E', color: '#6AABDB' },
  { id: 'imp1', name: 'Implementor 1', role: 'Code Generation', icon: '\u2692', color: '#A78BFA' },
  { id: 'imp2', name: 'Implementor 2', role: 'Code Generation', icon: '\u2692', color: '#34D399' },
  { id: 'rev', name: 'Reviewer', role: 'Code Review', icon: '\u2714', color: '#FFD166' },
];

const CLAUDE_TOKEN_RE = /(\d[\d,]+)\s+(?:input\s+)?tokens/i;
const CODEX_TOKEN_RE = /context:\s*(\d[\d,]+)/i;

class Agent {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.role = def.role;
    this.icon = def.icon;
    this.color = def.color;
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
      status: this.status,
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
    for (const def of AGENT_DEFS) {
      this.agents.set(def.id, new Agent(def));
    }
    // Orchestrator is virtual — always active
    const orch = this.agents.get('orch');
    orch.status = 'active';
    orch.startedAt = Date.now();
    orch.taskLabel = 'Pipeline Control';
  }

  get(id) {
    return this.agents.get(id);
  }

  getAllStatus() {
    return Array.from(this.agents.values()).map(a => a.getStatus());
  }

  getAvailableImplementor() {
    const imp1 = this.agents.get('imp1');
    const imp2 = this.agents.get('imp2');
    if (imp1.status === 'idle') return imp1;
    if (imp2.status === 'idle') return imp2;
    return null;
  }
}

const agentManager = new AgentManager();
export default agentManager;
