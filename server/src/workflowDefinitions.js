import { randomUUID } from 'node:crypto';

export const WORKFLOW_SCHEMA_VERSION = 1;
export const KANBAN_PHASES = ['Intake', 'Planning', 'Implementation', 'Review', 'Delivery'];
export const NODE_TYPES = ['Interview', 'Agent', 'Approval', 'Condition', 'Fork', 'Join', 'Phase', 'Action', 'Terminal'];

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

const EXECUTABLE_TYPES = new Set(['Interview', 'Agent', 'Approval', 'Action']);

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
      if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
        errors.push(`${node.type} node ${node.id} requires a positive timeoutMs`);
      }
      if (!Number.isInteger(config.retry?.maxAttempts) || config.retry.maxAttempts < 1 || !Number.isFinite(config.retry?.backoffMs)) {
        errors.push(`${node.type} node ${node.id} requires a retry policy`);
      }
    }
    if (node.type === 'Agent') {
      const provider = capabilities[config.provider];
      if (!provider) {
        errors.push(`Agent node ${node.id} uses unsupported provider ${config.provider}`);
      } else {
        if (!provider.models.includes(config.model ?? '')) errors.push(`Agent node ${node.id} uses unsupported ${config.provider} model ${config.model}`);
        if (!provider.efforts.includes(config.effort)) errors.push(`Agent node ${node.id} uses unsupported effort ${config.effort}`);
        if (!provider.accessModes.includes(config.accessMode)) errors.push(`Agent node ${node.id} uses unsupported access mode ${config.accessMode}`);
      }
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
  const definition = linearDefinition();
  const reviewerIndex = definition.nodes.findIndex(node => node.id === 'reviewer');
  definition.nodes.splice(reviewerIndex, 1,
    { id: 'fork-reviews', type: 'Fork', position: { x: 1760, y: 0 }, config: {} },
    { id: 'general-review', type: 'Agent', position: { x: 1960, y: -100 }, config: agent('general-review') },
    { id: 'security-review', type: 'Agent', position: { x: 1960, y: 100 }, config: agent('security-review') },
    { id: 'join-reviews', type: 'Join', position: { x: 2180, y: 0 }, config: { policy: 'all', remainingBranches: 'cancel' } },
  );
  definition.nodes.find(node => node.id === 'delivery-phase').position.x = 2400;
  definition.nodes.find(node => node.id === 'delivery').position.x = 2620;
  definition.nodes.find(node => node.id === 'success').position.x = 2840;
  definition.edges = definition.edges.filter(candidate => !['e-8', 'e-9', 'review-fix'].includes(candidate.id));
  definition.edges.push(
    edge('review-start', 'review-phase', 'fork-reviews'),
    edge('review-general', 'fork-reviews', 'general-review'),
    edge('review-security', 'fork-reviews', 'security-review'),
    edge('general-done', 'general-review', 'join-reviews', 'pass'),
    edge('security-done', 'security-review', 'join-reviews', 'pass'),
    edge('reviews-done', 'join-reviews', 'delivery-phase'),
    edge('general-fix', 'general-review', 'implementer', 'fail', { loop: { maxIterations: 3, exhaustionTarget: 'failure' } }),
    edge('security-fix', 'security-review', 'implementer', 'fail', { loop: { maxIterations: 3, exhaustionTarget: 'failure' } }),
  );
  return definition;
}

export function createBuiltinWorkflows() {
  return [
    { id: 'standard-development', name: 'Standard Development', description: 'Interview, plan approval, implementation, parallel reviews, delivery.', definition: standardDefinition(), isDefault: true },
    { id: 'simple-linear', name: 'Simple Linear', description: 'A compact sequential development workflow.', definition: linearDefinition() },
    { id: 'security-focused', name: 'Security Focused', description: 'A sequential workflow with a security review gate.', definition: linearDefinition({ security: true }) },
    { id: 'legacy-pipeline', name: 'Legacy Pipeline', description: 'Imported planner, implementer, reviewer behavior for migration.', definition: linearDefinition({ legacy: true }) },
  ];
}

export function createWorkflowId() {
  return `wf-${randomUUID().slice(0, 8)}`;
}
