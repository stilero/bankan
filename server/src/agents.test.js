import test from 'node:test';
import assert from 'node:assert/strict';

import agentManager from './agents.js';

test('planner with stale task binding is not treated as available', () => {
  const originalAgents = agentManager.agents;

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

  try {
    const planner = agentManager.getAvailablePlanner();
    assert.equal(planner?.id, 'plan-2');
  } finally {
    agentManager.agents = originalAgents;
  }
});

test('planner with a live process is not treated as available', () => {
  const originalAgents = agentManager.agents;

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

  try {
    const planner = agentManager.getAvailablePlanner();
    assert.equal(planner?.id, 'plan-2');
  } finally {
    agentManager.agents = originalAgents;
  }
});

test('planner sessions get fresh ids after removal', () => {
  const originalAgents = agentManager.agents;
  const originalMaxSettings = { ...agentManager._maxSettings };
  const originalCliSettings = { ...agentManager._cliSettings };
  const originalSessionCounters = { ...agentManager._sessionCounters };

  agentManager.agents = new Map([
    ['orch', { id: 'orch' }],
  ]);
  agentManager._maxSettings = { ...originalMaxSettings, planners: 2 };
  agentManager._cliSettings = { ...originalCliSettings, planners: 'claude' };
  agentManager._sessionCounters = { ...originalSessionCounters, plan: 0 };

  try {
    const first = agentManager.scaleUp('planners');
    assert.equal(first?.id, 'plan-1');

    agentManager.removeAgent('plan-1');

    const second = agentManager.scaleUp('planners');
    assert.equal(second?.id, 'plan-2');
  } finally {
    agentManager.agents = originalAgents;
    agentManager._maxSettings = originalMaxSettings;
    agentManager._cliSettings = originalCliSettings;
    agentManager._sessionCounters = originalSessionCounters;
  }
});
