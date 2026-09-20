import { describe, expect, test } from 'vitest';

import {
  createBuiltinWorkflows,
  validateWorkflowDefinition,
} from './workflowDefinitions.js';

describe('published workflow validation', () => {
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
