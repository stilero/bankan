import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import agentManager from './agents.js';
import store from './store.js';

let originalAgents;
let originalMaxSettings;
let originalCliSettings;
let originalSessionCounters;

beforeEach(() => {
  originalAgents = agentManager.agents;
  originalMaxSettings = { ...agentManager._maxSettings };
  originalCliSettings = { ...agentManager._cliSettings };
  originalSessionCounters = { ...agentManager._sessionCounters };
});

afterEach(() => {
  agentManager.agents = originalAgents;
  agentManager._maxSettings = originalMaxSettings;
  agentManager._cliSettings = originalCliSettings;
  agentManager._sessionCounters = originalSessionCounters;
  vi.restoreAllMocks();
});

describe('AgentManager availability', () => {
  test('planner with stale task binding is not treated as available', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch' }],
      ['plan-1', {
        id: 'plan-1',
        status: 'idle',
        draining: false,
        currentTask: 'T-123',
        process: null,
      }],
      ['plan-2', {
        id: 'plan-2',
        status: 'idle',
        draining: false,
        currentTask: null,
        process: null,
      }],
    ]);

    const planner = agentManager.getAvailablePlanner();
    expect(planner?.id).toBe('plan-2');
  });

  test('planner with a live process is not treated as available', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch' }],
      ['plan-1', {
        id: 'plan-1',
        status: 'idle',
        draining: false,
        currentTask: null,
        process: { pid: 42 },
      }],
      ['plan-2', {
        id: 'plan-2',
        status: 'idle',
        draining: false,
        currentTask: null,
        process: null,
      }],
    ]);

    const planner = agentManager.getAvailablePlanner();
    expect(planner?.id).toBe('plan-2');
  });

  test('planner sessions get fresh ids after removal', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 2 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const first = agentManager.scaleUp('planners');
    expect(first?.id).toBe('plan-1');

    agentManager.removeAgent('plan-1');

    const second = agentManager.scaleUp('planners');
    expect(second?.id).toBe('plan-2');
  });
});

describe('Agent behavior through managed instances', () => {
  test('spawn rejects invalid working directory and writes an error to subscribers', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, implementors: 1 };
    agentManager._cliSettings = { ...originalCliSettings, implementors: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, imp: 0 };

    const agent = agentManager.scaleUp('implementors');
    const ws = { send: vi.fn() };
    agent.subscribers.add(ws);

    expect(agent.spawn('/definitely/missing', 'echo test')).toBe(false);
    expect(agent.getBufferString()).toContain('Invalid working directory');
    expect(ws.send).toHaveBeenCalledOnce();
  });

  test('write returns a helpful error when the agent is not running', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, reviewers: 1 };
    agentManager._cliSettings = { ...originalCliSettings, reviewers: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, rev: 0 };

    const agent = agentManager.scaleUp('reviewers');

    expect(agent.write('hello')).toBe(false);
    expect(agent.getBufferString()).toContain('Agent is not running');
  });

  test('resize normalizes invalid values and keeps the terminal size usable', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');

    expect(agent.resize(1, 1)).toBe(true);
    expect(agent.terminalSize).toEqual({ cols: 20, rows: 5 });
  });

  test('token parsing keeps the highest observed count and aggregates task totals', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, implementors: 1 };
    agentManager._cliSettings = { ...originalCliSettings, implementors: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, imp: 0 };

    const agent = agentManager.scaleUp('implementors');
    const taskId = 'T-123';
    const updateTokens = vi.spyOn(store, 'updateTaskTokens').mockImplementation(() => ({
      id: taskId,
      totalTokens: 1225,
    }));
    const getTask = vi.spyOn(store, 'getTask').mockImplementation((id) => (
      id === taskId ? { id: taskId, totalTokens: 1225 } : null
    ));

    agent.currentTask = taskId;
    agent.taskTokenBase = 25;
    agent._parseTokens('context: 1,200');
    agent._parseTokens('total tokens: 900');
    agent._syncTaskTokens();

    expect(agent.tokens).toBe(1200);
    expect(updateTokens).toHaveBeenCalledWith(taskId, 1225);
    expect(getTask).toHaveBeenCalledWith(taskId);
    expect(agent.getStatus().aggregatedTokens).toBe(1225);
  });

  test('captures a completed plan block even after the terminal tail loses the start marker', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');
    const filler = '0123456789'.repeat(30);

    agent._captureStructuredOutput('=== PLAN START ===\n');
    agent._captureStructuredOutput('SUMMARY: Keep completion detection stable.\n');
    agent._captureStructuredOutput('BRANCH: feature/test-plan-capture\n');
    agent._captureStructuredOutput('FILES_TO_MODIFY:\n- server/src/agents.js (store structured block state)\n');
    agent._captureStructuredOutput('STEPS:\n1. Capture the block outside the PTY tail.\n');

    for (let i = 0; i < 130; i += 1) {
      agent.terminalBuffer.push(`noise-${i}-${filler}`);
    }

    agent._captureStructuredOutput('TESTS_NEEDED:\n- Run npm run test:server\n');
    agent._captureStructuredOutput('RISKS:\n- none\n');
    agent._captureStructuredOutput('=== PLAN END ===');

    expect(agent.getStructuredBlock('plan')).toContain('SUMMARY: Keep completion detection stable.');
    expect(agent.getStructuredBlock('plan')).toContain('=== PLAN END ===');
    expect(agent.getBufferString(100)).not.toContain('=== PLAN START ===');
  });

  test('detects markers when ANSI escape is split mid-marker across chunks', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');

    // The plan content arrives cleanly
    agent._captureStructuredOutput('=== PLAN START ===\n');
    agent._captureStructuredOutput('SUMMARY: ANSI split within end marker.\n');
    agent._captureStructuredOutput('BRANCH: feature/ansi-fix\n');
    agent._captureStructuredOutput('FILES_TO_MODIFY:\n- agents.js (fix capture)\n');
    agent._captureStructuredOutput('STEPS:\n1. Fix the bug.\n');
    agent._captureStructuredOutput('TESTS_NEEDED:\n- none\n');
    agent._captureStructuredOutput('RISKS:\n- none\n');
    // End marker has an ANSI reset code split RIGHT in the middle:
    // chunk ends with "=== PLAN END =\x1b" and next chunk starts with "[0m=="
    // Per-chunk stripping leaves residual \x1b and [0m, corrupting the marker
    agent._captureStructuredOutput('=== PLAN END =\x1b');
    agent._captureStructuredOutput('[0m==');

    const block = agent.getStructuredBlock('plan');
    expect(block).not.toBeNull();
    expect(block).toContain('SUMMARY: ANSI split within end marker.');
    expect(block).toContain('=== PLAN END ===');
    // eslint-disable-next-line no-control-regex
    expect(block).not.toMatch(/\x1b/);
  });

  test('captured plan text contains no ANSI residue from split sequences', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');

    // ANSI bold applied to SUMMARY line, split across chunks
    agent._captureStructuredOutput('=== PLAN START ===\n');
    agent._captureStructuredOutput('SUMMARY: \x1b[1mBold summ\x1b');
    agent._captureStructuredOutput('[0mary text.\n');
    agent._captureStructuredOutput('BRANCH: feature/clean-text\n');
    agent._captureStructuredOutput('FILES_TO_MODIFY:\n- file.js (test)\n');
    agent._captureStructuredOutput('STEPS:\n1. Step one.\n');
    agent._captureStructuredOutput('TESTS_NEEDED:\n- none\n');
    agent._captureStructuredOutput('RISKS:\n- none\n');
    agent._captureStructuredOutput('=== PLAN END ===');

    const block = agent.getStructuredBlock('plan');
    expect(block).not.toBeNull();
    // The captured text should be free of ANSI artifacts
    // eslint-disable-next-line no-control-regex
    expect(block).not.toMatch(/\x1b/);
    expect(block).not.toContain('[0m');
    expect(block).not.toContain('[1m');
    expect(block).toContain('SUMMARY: Bold summary text.');
  });

  test('captures plan text with spaces preserved when CLI uses cursor forward codes', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');

    // CLI uses cursor forward (\x1b[nC) instead of spaces
    agent._captureStructuredOutput('=== PLAN START ===\n');
    agent._captureStructuredOutput('SUMMARY:\x1b[1C' + 'Add\x1b[1C' + 'a\x1b[1C' + 'feature.\n');
    agent._captureStructuredOutput('BRANCH: feature/test\n');
    agent._captureStructuredOutput('FILES_TO_MODIFY:\n- file.js (test)\n');
    agent._captureStructuredOutput('STEPS:\n1. Do it.\n');
    agent._captureStructuredOutput('TESTS_NEEDED:\n- none\n');
    agent._captureStructuredOutput('RISKS:\n- none\n');
    agent._captureStructuredOutput('=== PLAN END ===');

    const block = agent.getStructuredBlock('plan');
    expect(block).toContain('SUMMARY: Add a feature.');
    expect(block).not.toContain('Adda');
  });

  test('captures review blocks when markers are split across chunks', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, reviewers: 1 };
    agentManager._cliSettings = { ...originalCliSettings, reviewers: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, rev: 0 };

    const agent = agentManager.scaleUp('reviewers');

    agent._captureStructuredOutput('=== REVIEW STA');
    agent._captureStructuredOutput('RT ===\nVERDICT: PASS\nCRITICAL_ISSUES:\n- none\n');
    agent._captureStructuredOutput('MINOR_ISSUES:\n- none\nSUMMARY: Completed from split markers.\n=== REVIEW ');
    agent._captureStructuredOutput('END ===');

    expect(agent.getStructuredBlock('review')).toContain('SUMMARY: Completed from split markers.');
    expect(agent.getStructuredBlock('review')).toContain('=== REVIEW END ===');
  });

  test('getAllCapturedBlocks returns all completed blocks including overwritten ones', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');

    // First block: prompt template (placeholder)
    agent._captureStructuredOutput(`=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (feature/t-xxx-short-descriptive-slug)
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`);

    // Second block: real plan
    agent._captureStructuredOutput(`=== PLAN START ===
SUMMARY: Add model selection dropdown to settings.
BRANCH: feature/t-abc123-model-selection
FILES_TO_MODIFY:
- server/src/config.js (add model field)
STEPS:
1. Add model to defaults
TESTS_NEEDED:
- Run npm run test:server
RISKS:
- none
=== PLAN END ===`);

    // Third block: CLI re-renders template (overwrites real plan)
    agent._captureStructuredOutput(`=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (feature/t-xxx-short-descriptive-slug)
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`);

    // getStructuredBlock returns the LAST block (placeholder)
    expect(agent.getStructuredBlock('plan')).toContain('(one sentence describing');

    // getAllCapturedBlocks returns ALL blocks including the real plan
    const allBlocks = agent.getAllCapturedBlocks('plan');
    expect(allBlocks).toHaveLength(3);
    expect(allBlocks[1]).toContain('Add model selection dropdown to settings.');
  });

  test('structured capture resets when the agent is killed', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, planners: 1 };
    agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

    const agent = agentManager.scaleUp('planners');

    agent._captureStructuredOutput(`=== PLAN START ===
SUMMARY: Temporary plan.
BRANCH: feature/tmp
FILES_TO_MODIFY:
- server/src/agents.js (temporary)
STEPS:
1. Demonstrate reset.
TESTS_NEEDED:
- none
RISKS:
- none
=== PLAN END ===`);

    expect(agent.getStructuredBlock('plan')).toContain('Temporary plan.');

    agent.kill();

    expect(agent.getStructuredBlock('plan')).toBeNull();
    expect(agent.getStructuredBlock('review')).toBeNull();
    expect(agent.getAllCapturedBlocks('plan')).toEqual([]);
    expect(agent.getAllCapturedBlocks('review')).toEqual([]);
  });

  test('_syncTaskTokens throttles updates to avoid rapid-fire broadcasts', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
    ]);
    agentManager._maxSettings = { ...originalMaxSettings, implementors: 1 };
    agentManager._cliSettings = { ...originalCliSettings, implementors: 'claude' };
    agentManager._sessionCounters = { ...originalSessionCounters, imp: 0 };

    const agent = agentManager.scaleUp('implementors');
    const taskId = 'T-THROTTLE';
    const updateTokens = vi.spyOn(store, 'updateTaskTokens').mockImplementation(() => ({
      id: taskId,
      totalTokens: 100,
    }));
    vi.spyOn(store, 'getTask').mockImplementation((id) => (
      id === taskId ? { id: taskId, totalTokens: 100 } : null
    ));

    agent.currentTask = taskId;
    agent.taskTokenBase = 0;
    agent.tokens = 100;

    // First call should go through
    agent._syncTaskTokens();
    expect(updateTokens).toHaveBeenCalledTimes(1);

    // Immediate second call should be throttled
    agent.tokens = 200;
    agent._syncTaskTokens();
    expect(updateTokens).toHaveBeenCalledTimes(1);

    // Simulate 2+ seconds elapsed
    agent._lastTokenSync = Date.now() - 2100;
    agent.tokens = 300;
    agent._syncTaskTokens();
    expect(updateTokens).toHaveBeenCalledTimes(2);
  });

  test('reconfigure removes extra idle agents and marks active overflow agents as draining', () => {
    agentManager.agents = new Map([
      ['orch', { id: 'orch', getStatus: () => ({ id: 'orch' }) }],
      ['imp-1', {
        id: 'imp-1',
        status: 'idle',
        draining: false,
        currentTask: null,
        process: null,
        cli: 'claude',
        subscribers: new Set(),
        getStatus() {
          return { id: this.id, draining: this.draining, cli: this.cli };
        },
      }],
      ['imp-2', {
        id: 'imp-2',
        status: 'active',
        draining: false,
        currentTask: 'T-1',
        process: { pid: 1 },
        cli: 'claude',
        subscribers: new Set(),
        getStatus() {
          return { id: this.id, draining: this.draining, cli: this.cli };
        },
      }],
    ]);

    agentManager.reconfigure({
      agents: {
        planners: { max: 4, cli: 'claude' },
        implementors: { max: 1, cli: 'codex' },
        reviewers: { max: 4, cli: 'claude' },
      },
    });

    expect(agentManager.get('imp-1').cli).toBe('codex');
    expect(agentManager.get('imp-2').draining).toBe(true);
    expect(agentManager.get('imp-2').cli).toBe('claude');
  });
});
