import { randomUUID } from 'node:crypto';

export const WORKFLOW_SCHEMA_VERSION = 2;
export const KANBAN_PHASES = ['Intake', 'Planning', 'Implementation', 'Review', 'Delivery'];
export const NODE_TYPES = ['Interview', 'Agent', 'Check', 'Approval', 'HumanDecision', 'Condition', 'Fork', 'Join', 'Phase', 'Action', 'Terminal'];

export const PROVIDER_CAPABILITIES = {
  codex: {
    models: ['', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    accessModes: ['read', 'write'],
  },
  claude: {
    models: ['', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    efforts: ['low', 'medium', 'high'],
    accessModes: ['read', 'write'],
  },
};

const EXECUTABLE_TYPES = new Set(['Interview', 'Agent', 'Check', 'Approval', 'HumanDecision', 'Action']);
const DEFAULT_RETRY = { maxAttempts: 2, backoffMs: 1000 };
const DEFAULTS = {
  provider: 'codex', model: '', effort: 'medium', timeoutMs: 30 * 60 * 1000,
  retry: DEFAULT_RETRY, budgets: { tokens: 500000, costUsd: 100 },
};
const LEGACY_AGENT_CONFIG = {
  planner: {
    instructions: 'Create a concrete implementation plan for the task.',
    contract: { resultType: 'plan', outcomes: ['success', 'failure'] },
  },
  implementer: {
    instructions: 'Implement the approved plan and verify the result.',
    contract: { resultType: 'implementation', outcomes: ['success', 'failure'] },
  },
  'general-review': {
    instructions: 'Review the implementation and provide actionable feedback.',
    contract: { resultType: 'review', outcomes: ['pass', 'fail', 'failure'] },
  },
  'security-review': {
    instructions: 'Review the implementation for security risks and provide actionable feedback.',
    contract: { resultType: 'review', outcomes: ['pass', 'fail', 'failure'] },
  },
};

export function normalizeWorkflowDefinition(definition) {
  const source = structuredClone(definition || {});
  const defaults = source.defaults || {};
  if (source.schemaVersion === WORKFLOW_SCHEMA_VERSION) {
    source.defaults = {
      ...DEFAULTS,
      ...defaults,
      retry: { ...DEFAULT_RETRY, ...(defaults.retry || {}) },
      budgets: { ...DEFAULTS.budgets, ...(defaults.budgets || {}) },
    };
    source.nodes ||= [];
    source.edges ||= [];
    return source;
  }
  source.compatibility = { ...(source.compatibility || {}), sourceSchemaVersion: source.schemaVersion || 1 };
  source.schemaVersion = WORKFLOW_SCHEMA_VERSION;
  source.defaults = {
    ...DEFAULTS,
    ...defaults,
    retry: { ...DEFAULT_RETRY, ...(defaults.retry || {}) },
    budgets: { ...DEFAULTS.budgets, ...(defaults.budgets || {}) },
  };
  source.nodes = (source.nodes || []).map(node => {
    const config = { ...(node.config || {}) };
    if (node.type === 'Agent') {
      const legacy = LEGACY_AGENT_CONFIG[config.preset] || {
        instructions: `Complete the ${node.id} step.`,
        contract: { resultType: 'agent-result', outcomes: ['success', 'failure'] },
      };
      config.agentInstructions ||= legacy.instructions;
      config.artifactBindings ||= [];
      config.executionContract ||= legacy.contract;
      config.accessMode ||= 'read';
    }
    return { ...node, config };
  });
  source.edges = source.edges || [];
  const failureTarget = source.nodes.find(node => node.type === 'Terminal' && node.config?.outcome === 'Failure')?.id;
  if (failureTarget) {
    for (const node of source.nodes.filter(candidate => candidate.type === 'Agent')) {
      const outcomes = node.config.executionContract?.outcomes || [];
      for (const outcome of outcomes) {
        if (!source.edges.some(edge => edge.source === node.id && edge.outcome === outcome)) {
          source.edges.push({ id: `migrated-${node.id}-${outcome}`, source: node.id, target: failureTarget, outcome });
        }
      }
    }
  }
  return source;
}

function reaches(edges, start, wanted, visited = new Set()) {
  if (start === wanted) return true;
  if (visited.has(start)) return false;
  visited.add(start);
  return edges
    .filter(edge => edge.source === start)
    .some(edge => reaches(edges, edge.target, wanted, visited));
}

export function validateWorkflowDefinition(definition, capabilities = PROVIDER_CAPABILITIES) {
  const errors = [];
  if (!definition || definition.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${WORKFLOW_SCHEMA_VERSION}`);
  }
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  if (nodes.length === 0) errors.push('Workflow requires at least one node');
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node?.id) {
      errors.push('Every node requires an id');
      continue;
    }
    if (nodeIds.has(node.id)) errors.push(`Duplicate node id ${node.id}`);
    nodeIds.add(node.id);
    if (!NODE_TYPES.includes(node.type)) errors.push(`Node ${node.id} has unsupported type ${node.type}`);
    const config = node.config || {};
    if (node.type === 'Phase' && !KANBAN_PHASES.includes(config.phase)) {
      errors.push(`Phase node ${node.id} requires a valid phase`);
    }
    if (node.type === 'Terminal' && !['Success', 'Failure', 'Cancelled'].includes(config.outcome)) {
      errors.push(`Terminal node ${node.id} requires Success, Failure, or Cancelled outcome`);
    }
    if (EXECUTABLE_TYPES.has(node.type)) {
      const timeoutMs = config.timeoutMs ?? definition.defaults?.timeoutMs;
      const retry = config.retry ?? definition.defaults?.retry;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        errors.push(`${node.type} node ${node.id} requires a positive timeoutMs`);
      }
      if (!Number.isInteger(retry?.maxAttempts) || retry.maxAttempts < 1 || !Number.isFinite(retry?.backoffMs)) {
        errors.push(`${node.type} node ${node.id} requires a retry policy`);
      }
    }
    if (node.type === 'Agent') {
      if (!definition.compatibility?.sourceSchemaVersion) {
        if (!String(config.name || config.label || '').trim()) errors.push(`Agent node ${node.id} requires a display name`);
        if (!String(config.purpose || '').trim()) errors.push(`Agent node ${node.id} requires a purpose`);
      }
      if (!String(config.agentInstructions || '').trim()) errors.push(`Agent node ${node.id} requires Agent Instructions`);
      if (!Array.isArray(config.artifactBindings)) errors.push(`Agent node ${node.id} requires Artifact bindings`);
      if (!config.executionContract?.resultType || !Array.isArray(config.executionContract?.outcomes) || config.executionContract.outcomes.length === 0) {
        errors.push(`Agent node ${node.id} requires an Execution Contract`);
      }
      const providerName = config.provider ?? definition.defaults?.provider;
      const provider = capabilities[providerName];
      if (!provider) {
        errors.push(`Agent node ${node.id} uses unsupported provider ${providerName}`);
      } else {
        const model = config.model ?? definition.defaults?.model ?? '';
        const effort = config.effort ?? definition.defaults?.effort;
        if (!provider.models.includes(model)) errors.push(`Agent node ${node.id} uses unsupported ${providerName} model ${model}`);
        if (!provider.efforts.includes(effort)) errors.push(`Agent node ${node.id} uses unsupported effort ${effort}`);
        if (!provider.accessModes.includes(config.accessMode)) errors.push(`Agent node ${node.id} uses unsupported access mode ${config.accessMode}`);
      }
    }
    if (node.type === 'Check' && !['test', 'lint', 'build', 'coverage', 'custom'].includes(config.adapter)) {
      errors.push(`Check node ${node.id} requires a supported adapter`);
    }
    if (node.type === 'Check' && config.adapter === 'custom') {
      if (!Array.isArray(config.command) || config.command.length === 0 || !config.command.every(part => typeof part === 'string' && part.trim())) {
        errors.push(`Custom Check node ${node.id} requires a non-empty command`);
      }
      if (!['read', 'write'].includes(config.accessMode)) errors.push(`Custom Check node ${node.id} requires explicit read or write access`);
    }
  }
  const edgeIds = new Set();
  const unboundedEdges = edges.filter(edge => !edge.loop);
  for (const edge of edges) {
    if (!edge?.id) errors.push('Every edge requires an id');
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references an unknown node`);
      continue;
    }
    const isUnboundedCycle = !edge.loop && reaches(unboundedEdges.filter(candidate => candidate.id !== edge.id), edge.target, edge.source);
    const hasInvalidLoop = edge.loop && (!Number.isInteger(edge.loop.maxIterations) || edge.loop.maxIterations < 1 || !nodeIds.has(edge.loop.exhaustionTarget));
    if (isUnboundedCycle || hasInvalidLoop) {
      errors.push(`Cycle edge ${edge.id} requires maxIterations and exhaustionTarget`);
    }
    if (edge.loop?.feedbackArtifact && !nodes.some(node => node.id === edge.source && (
      node.config?.executionContract?.resultType === edge.loop.feedbackArtifact || node.config?.produces?.includes(edge.loop.feedbackArtifact)
    ))) {
      errors.push(`Loop edge ${edge.id} references incompatible feedback Artifact ${edge.loop.feedbackArtifact}`);
    }
  }
  for (const node of nodes.filter(candidate => candidate.config?.executionContract?.outcomes && !definition.compatibility?.sourceSchemaVersion)) {
    const routed = new Set(edges.filter(edge => edge.source === node.id).map(edge => edge.outcome));
    for (const outcome of node.config.executionContract.outcomes) {
      if (!routed.has(outcome) && !edges.some(edge => edge.source === node.id && edge.fallback)) {
        errors.push(`Node ${node.id} outcome ${outcome} has no Route`);
      }
    }
  }
  for (const node of nodes.filter(candidate => candidate.type === 'Condition')) {
    const fallbackCount = edges.filter(edge => edge.source === node.id && edge.fallback === true).length;
    if (fallbackCount !== 1) errors.push(`Condition node ${node.id} requires exactly one fallback edge`);
  }
  const starts = nodes.filter(node => !edges.some(edge =>
    (!edge.loop && edge.target === node.id) || edge.loop?.exhaustionTarget === node.id
  ));
  if (nodes.length > 0 && starts.length !== 1) errors.push('Workflow requires exactly one start node');
  if (!nodes.some(node => node.type === 'Terminal')) errors.push('Workflow requires at least one Terminal node');
  return [...new Set(errors)];
}

const retry = { maxAttempts: 2, backoffMs: 1000 };
const executable = { timeoutMs: 30 * 60 * 1000, retry };
const agent = (preset, accessMode = 'read', overrides = {}) => ({
  preset,
  provider: 'codex',
  model: '',
  effort: 'medium',
  accessMode,
  capabilityProfile: accessMode === 'read' ? 'repository-read' : 'repository-write',
  ...executable,
  budgets: { tokens: 100000, costUsd: 25 },
  ...overrides,
});
const edge = (id, source, target, outcome = 'success', extra = {}) => ({ id, source, target, outcome, ...extra });

function linearDefinition({ security = false, legacy = false } = {}) {
  const nodes = [
    { id: 'intake', type: 'Phase', position: { x: 0, y: 0 }, config: { phase: 'Intake' } },
    ...(!legacy ? [{ id: 'interview', type: 'Interview', position: { x: 220, y: 0 }, config: { ...executable, requiredFields: ['goal', 'acceptanceCriteria'], requiresApproval: true } }] : []),
    { id: 'planning-phase', type: 'Phase', position: { x: 440, y: 0 }, config: { phase: 'Planning' } },
    { id: 'planner', type: 'Agent', position: { x: 660, y: 0 }, config: agent('planner') },
    { id: 'approval', type: 'Approval', position: { x: 880, y: 0 }, config: { ...executable, outcomes: ['approve', 'reject'], label: 'Approve plan' } },
    { id: 'implementation-phase', type: 'Phase', position: { x: 1100, y: 0 }, config: { phase: 'Implementation' } },
    { id: 'implementer', type: 'Agent', position: { x: 1320, y: 0 }, config: agent('implementer', 'write') },
    { id: 'review-phase', type: 'Phase', position: { x: 1540, y: 0 }, config: { phase: 'Review' } },
    { id: 'reviewer', type: 'Agent', position: { x: 1760, y: 0 }, config: agent(security ? 'security-review' : 'general-review') },
    { id: 'delivery-phase', type: 'Phase', position: { x: 1980, y: 0 }, config: { phase: 'Delivery' } },
    { id: 'delivery', type: 'Action', position: { x: 2200, y: 0 }, config: { ...executable, action: 'create-pr', skippable: true, substituteArtifact: 'manual-pr' } },
    { id: 'success', type: 'Terminal', position: { x: 2420, y: 0 }, config: { outcome: 'Success' } },
    { id: 'failure', type: 'Terminal', position: { x: 1760, y: 180 }, config: { outcome: 'Failure' } },
  ];
  const ordered = nodes.filter(node => !['failure'].includes(node.id));
  const edges = ordered.slice(0, -1).map((node, index) => edge(`e-${index + 1}`, node.id, ordered[index + 1].id));
  const approvalEdge = edges.find(candidate => candidate.source === 'approval');
  approvalEdge.outcome = 'approve';
  edges.push(edge('approval-reject', 'approval', 'planner', 'reject', { loop: { maxIterations: 3, exhaustionTarget: 'failure' } }));
  const reviewEdge = edges.find(candidate => candidate.source === 'reviewer');
  reviewEdge.outcome = 'pass';
  edges.push(edge('review-fix', 'reviewer', 'implementer', 'fail', { loop: { maxIterations: 3, exhaustionTarget: 'failure' } }));
  return { schemaVersion: 1, defaults: { timeoutMs: executable.timeoutMs, retry, budgets: { tokens: 500000, costUsd: 100 } }, nodes, edges };
}

function standardDefinition() {
  const v2Agent = (id, name, instructions, accessMode, resultType, outcomes) => ({
    id, type: 'Agent', config: {
      name, label: name, purpose: instructions, agentInstructions: instructions, accessMode,
      artifactBindings: id === 'planner' ? ['interview-answers'] : ['plan', 'implementation', 'check-result', 'review-feedback'],
      executionContract: { resultType, outcomes },
    },
  });
  const decision = (id, label) => ({
    id, type: 'HumanDecision', config: {
      label,
      outcomes: ['accept', 'extend', 'cancel'],
      choices: [
        { outcome: 'accept', label: 'Accept current work' },
        { outcome: 'extend', label: 'Add feedback and extend loop' },
        { outcome: 'cancel', label: 'Cancel' },
      ],
      produces: ['human-feedback'],
      ...executable,
    },
  });
  const nodes = [
    { id: 'intake', type: 'Phase', config: { phase: 'Intake' } },
    { id: 'interview', type: 'Interview', config: { label: 'Gather input', requiredFields: ['goal', 'acceptanceCriteria'], requiresApproval: true, ...executable } },
    { id: 'planning-phase', type: 'Phase', config: { phase: 'Planning' } },
    v2Agent('planner', 'Plan', 'Create a concrete implementation plan from the gathered input.', 'read', 'plan', ['success', 'failure']),
    { id: 'approval', type: 'HumanDecision', config: {
      label: 'Approve plan', outcomes: ['approve', 'reject'],
      choices: [{ outcome: 'approve', label: 'Approve plan' }, { outcome: 'reject', label: 'Request changes' }],
      produces: ['human-feedback'], ...executable,
    } },
    { id: 'implementation-phase', type: 'Phase', config: { phase: 'Implementation' } },
    v2Agent('implementer', 'Implement', 'Implement the approved plan and verify the change.', 'write', 'implementation', ['success', 'failure']),
    { id: 'run-checks', type: 'Check', config: { label: 'Run checks', adapter: 'test', produces: ['check-result'], executionContract: { resultType: 'check-result', outcomes: ['pass', 'fail'] }, ...executable } },
    { id: 'review-phase', type: 'Phase', config: { phase: 'Review' } },
    { id: 'fork-reviews', type: 'Fork', config: {} },
    v2Agent('general-review', 'Code Review', 'Review correctness and return actionable feedback when changes are needed.', 'read', 'review-feedback', ['pass', 'changes', 'failure']),
    v2Agent('security-review', 'Security Review', 'Review security risks and return actionable feedback when changes are needed.', 'read', 'review-feedback', ['pass', 'changes', 'failure']),
    { id: 'join-reviews', type: 'Join', config: { policy: 'all', remainingBranches: 'cancel' } },
    { id: 'delivery-phase', type: 'Phase', config: { phase: 'Delivery' } },
    { id: 'delivery', type: 'Action', config: { label: 'Deliver', action: 'create-pr', skippable: true, substituteArtifact: 'manual-pr', ...executable } },
    decision('plan-exhausted', 'Plan feedback loop exhausted'),
    decision('check-exhausted', 'Check feedback loop exhausted'),
    decision('review-exhausted', 'Review feedback loop exhausted'),
    { id: 'success', type: 'Terminal', config: { outcome: 'Success' } },
    { id: 'cancelled', type: 'Terminal', config: { outcome: 'Cancelled' } },
  ];
  const loop = (maxIterations, feedbackArtifact, exhaustionTarget) => ({ maxIterations, feedbackArtifact, exhaustionTarget });
  const edges = [
    edge('intake-gather', 'intake', 'interview'),
    edge('gather-plan-phase', 'interview', 'planning-phase'),
    edge('phase-plan', 'planning-phase', 'planner'),
    edge('plan-approval', 'planner', 'approval'),
    edge('plan-failed', 'planner', 'plan-exhausted', 'failure'),
    edge('plan-approved', 'approval', 'implementation-phase', 'approve'),
    edge('plan-rejected', 'approval', 'planner', 'reject', { loop: loop(3, 'human-feedback', 'plan-exhausted') }),
    edge('phase-implement', 'implementation-phase', 'implementer'),
    edge('implemented-checks', 'implementer', 'run-checks'),
    edge('implementation-failed', 'implementer', 'check-exhausted', 'failure'),
    edge('checks-passed', 'run-checks', 'review-phase', 'pass'),
    edge('checks-failed', 'run-checks', 'implementer', 'fail', { loop: loop(3, 'check-result', 'check-exhausted') }),
    edge('review-start', 'review-phase', 'fork-reviews'),
    edge('review-general', 'fork-reviews', 'general-review'),
    edge('review-security', 'fork-reviews', 'security-review'),
    edge('general-passed', 'general-review', 'join-reviews', 'pass'),
    edge('security-passed', 'security-review', 'join-reviews', 'pass'),
    edge('general-changes', 'general-review', 'implementer', 'changes', { loop: loop(3, 'review-feedback', 'review-exhausted') }),
    edge('security-changes', 'security-review', 'implementer', 'changes', { loop: loop(3, 'review-feedback', 'review-exhausted') }),
    edge('general-failed', 'general-review', 'review-exhausted', 'failure'),
    edge('security-failed', 'security-review', 'review-exhausted', 'failure'),
    edge('reviews-done', 'join-reviews', 'delivery-phase'),
    edge('delivery-action', 'delivery-phase', 'delivery'),
    edge('delivered', 'delivery', 'success'),
    edge('plan-accept', 'plan-exhausted', 'implementation-phase', 'accept'),
    edge('plan-extend', 'plan-exhausted', 'planner', 'extend', { loop: loop(3, 'human-feedback', 'cancelled') }),
    edge('plan-cancel', 'plan-exhausted', 'cancelled', 'cancel'),
    edge('check-accept', 'check-exhausted', 'review-phase', 'accept'),
    edge('check-extend', 'check-exhausted', 'implementer', 'extend', { loop: loop(3, 'human-feedback', 'cancelled') }),
    edge('check-cancel', 'check-exhausted', 'cancelled', 'cancel'),
    edge('review-accept', 'review-exhausted', 'delivery-phase', 'accept'),
    edge('review-extend', 'review-exhausted', 'implementer', 'extend', { loop: loop(3, 'human-feedback', 'cancelled') }),
    edge('review-cancel', 'review-exhausted', 'cancelled', 'cancel'),
  ];
  return { schemaVersion: 2, defaults: structuredClone(DEFAULTS), nodes, edges };
}

export function createBuiltinWorkflows() {
  return [
    { id: 'standard-development', name: 'Standard Development', description: 'Interview, plan approval, implementation, parallel reviews, delivery.', definition: standardDefinition(), isDefault: true },
    { id: 'simple-linear', name: 'Simple Linear', description: 'A compact sequential development workflow.', definition: linearDefinition() },
    { id: 'security-focused', name: 'Security Focused', description: 'A sequential workflow with a security review gate.', definition: linearDefinition({ security: true }) },
    { id: 'legacy-pipeline', name: 'Legacy Pipeline', description: 'Imported planner, implementer, reviewer behavior for migration.', definition: linearDefinition({ legacy: true }) },
  ].map(workflow => ({ ...workflow, definition: normalizeWorkflowDefinition(workflow.definition) }));
}

export function createWorkflowId() {
  return `wf-${randomUUID().slice(0, 8)}`;
}
