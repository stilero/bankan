import { describe, expect, test } from 'vitest';

import {
  createBuiltinWorkflows,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
} from './workflowDefinitions.js';

describe('published workflow validation', () => {
  test('normalizes a legacy editable draft into a complete schema v2 agent contract', () => {
    const migrated = normalizeWorkflowDefinition({
      schemaVersion: 1,
      defaults: { timeoutMs: 5000, retry: { maxAttempts: 2, backoffMs: 10 } },
      nodes: [
        { id: 'agent', type: 'Agent', config: { preset: 'planner', provider: 'codex', model: '', effort: 'high', accessMode: 'read' } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
        { id: 'failed', type: 'Terminal', config: { outcome: 'Failure' } },
      ],
      edges: [
        { id: 'done', source: 'agent', target: 'done', outcome: 'success' },
        { id: 'failed', source: 'agent', target: 'failed', outcome: 'failure' },
      ],
    });

    expect(migrated).toMatchObject({
      schemaVersion: 2,
      defaults: { provider: 'codex', model: '', effort: 'medium', timeoutMs: 5000, retry: { maxAttempts: 2, backoffMs: 10 } },
    });
    expect(migrated.nodes[0].config).toMatchObject({
      agentInstructions: expect.stringContaining('plan'),
      accessMode: 'read',
      artifactBindings: [],
      executionContract: { resultType: 'plan', outcomes: ['success', 'failure'] },
    });
    expect(validateWorkflowDefinition(migrated)).toEqual([]);
  });
  test('built-in workflow templates are publishable', () => {
    const templates = createBuiltinWorkflows();

    expect(templates.map(template => template.name)).toEqual([
      'Standard Development',
      'Simple Linear',
      'Security Focused',
      'Legacy Pipeline',
    ]);
    for (const template of templates) {
      expect(validateWorkflowDefinition(template.definition)).toEqual([]);
    }
  });

  test('seeds Standard Development with checks, feedback loops, and human exhaustion decisions', () => {
    const standard = createBuiltinWorkflows().find(workflow => workflow.id === 'standard-development').definition;

    expect(standard.schemaVersion).toBe(2);
    expect(standard.compatibility).toBeUndefined();
    expect(standard.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-checks', type: 'Check', config: expect.objectContaining({ adapter: 'test' }) }),
      expect.objectContaining({ id: 'check-exhausted', type: 'HumanDecision' }),
      expect.objectContaining({ id: 'review-exhausted', type: 'HumanDecision' }),
    ]));
    expect(standard.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'run-checks', target: 'implementer', outcome: 'fail', loop: expect.objectContaining({ feedbackArtifact: 'check-result', exhaustionTarget: 'check-exhausted' }) }),
      expect.objectContaining({ source: 'general-review', target: 'implementer', outcome: 'changes', loop: expect.objectContaining({ feedbackArtifact: 'review-feedback', exhaustionTarget: 'review-exhausted' }) }),
    ]));
  });

  test('rejects custom Check adapters without an explicit command and access requirement', () => {
    const definition = {
      schemaVersion: 2,
      defaults: { provider: 'codex', model: '', effort: 'medium', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } },
      nodes: [
        { id: 'check', type: 'Check', config: { adapter: 'custom', executionContract: { resultType: 'check-result', outcomes: ['pass', 'fail'] } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [
        { id: 'pass', source: 'check', target: 'done', outcome: 'pass' },
        { id: 'fail', source: 'check', target: 'done', outcome: 'fail' },
      ],
    };

    expect(validateWorkflowDefinition(definition)).toEqual(expect.arrayContaining([
      'Custom Check node check requires a non-empty command',
      'Custom Check node check requires explicit read or write access',
    ]));
  });

  test('requires a display name and purpose for native v2 Agent Steps', () => {
    const definition = {
      schemaVersion: 2,
      defaults: { provider: 'codex', model: '', effort: 'medium', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } },
      nodes: [
        { id: 'agent', type: 'Agent', config: { agentInstructions: 'Do the work', accessMode: 'read', artifactBindings: [], executionContract: { resultType: 'result', outcomes: ['success'] } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [{ id: 'done', source: 'agent', target: 'done', outcome: 'success' }],
    };

    expect(validateWorkflowDefinition(definition)).toEqual(expect.arrayContaining([
      'Agent node agent requires a display name',
      'Agent node agent requires a purpose',
    ]));
    const planner = createBuiltinWorkflows().find(workflow => workflow.id === 'standard-development').definition.nodes.find(node => node.id === 'planner');
    expect(planner.config).toMatchObject({ name: 'Plan', label: 'Plan', purpose: expect.any(String) });
  });

  test('rejects unsafe routing and unsupported agent capabilities', () => {
    const definition = {
      schemaVersion: 1,
      nodes: [
        { id: 'condition', type: 'Condition', config: { rules: [] } },
        { id: 'agent', type: 'Agent', config: { provider: 'codex', model: 'unknown', effort: 'extreme', accessMode: 'write' } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
      ],
      edges: [
        { id: 'match', source: 'condition', target: 'agent', outcome: 'matched' },
        { id: 'loop', source: 'agent', target: 'agent', outcome: 'retry' },
        { id: 'finish', source: 'agent', target: 'done', outcome: 'success' },
      ],
    };

    const errors = validateWorkflowDefinition(definition);

    expect(errors).toContain('Condition node condition requires exactly one fallback edge');
    expect(errors).toContain('Agent node agent uses unsupported codex model unknown');
    expect(errors).toContain('Agent node agent uses unsupported effort extreme');
    expect(errors).toContain('Cycle edge loop requires maxIterations and exhaustionTarget');
  });
});
