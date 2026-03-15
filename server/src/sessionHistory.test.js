import { describe, expect, test } from 'vitest';

import { createSessionEntry, getAgentStage } from './sessionHistory.js';

describe('session history helpers', () => {
  test('maps agent ids to stages', () => {
    expect(getAgentStage('plan-1')).toBe('planning');
    expect(getAgentStage('imp-1')).toBe('implementation');
    expect(getAgentStage('rev-1')).toBe('review');
    expect(getAgentStage('orch')).toBe('unknown');
  });

  test('creates session entries with stable shape', () => {
    const entry = createSessionEntry({
      id: 'imp-1',
      name: 'Implementor 1',
      role: 'Code Generation',
      tokens: 320,
    }, {
      taskId: 'T-123',
      outcome: 'blocked',
      transcript: 'Need input',
      finishedAt: '2026-03-15T12:00:00.000Z',
    });

    expect(entry).toEqual({
      id: 'imp-1:2026-03-15T12:00:00.000Z',
      agentId: 'imp-1',
      agentName: 'Implementor 1',
      role: 'Code Generation',
      stage: 'implementation',
      taskId: 'T-123',
      outcome: 'blocked',
      finishedAt: '2026-03-15T12:00:00.000Z',
      transcript: 'Need input',
      tokens: 320,
    });
  });
});
