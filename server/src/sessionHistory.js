export function getAgentStage(agentId = '') {
  if (agentId.startsWith('plan-')) return 'planning';
  if (agentId.startsWith('imp-')) return 'implementation';
  if (agentId.startsWith('rev-')) return 'review';
  return 'unknown';
}

export function createSessionEntry(agent, {
  taskId = null,
  outcome = 'completed',
  transcript = '',
  finishedAt = new Date().toISOString(),
} = {}) {
  return {
    id: `${agent.id}:${finishedAt}`,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    stage: getAgentStage(agent.id),
    taskId,
    outcome,
    finishedAt,
    transcript: transcript || '',
    tokens: agent.tokens || 0,
  };
}
