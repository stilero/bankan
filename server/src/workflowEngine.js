function valueAtPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function matchesRule(value, rule) {
  const actual = valueAtPath(value, rule.field);
  if (rule.operator === 'equals') return actual === rule.value;
  if (rule.operator === 'notEquals') return actual !== rule.value;
  if (rule.operator === 'exists') return actual !== undefined && actual !== null;
  if (rule.operator === 'includes') return Array.isArray(actual) ? actual.includes(rule.value) : String(actual || '').includes(rule.value);
  return false;
}

export class WorkflowEngine {
  constructor(repository) {
    this.repository = repository;
  }

  start(executionId) {
    let run = this.repository.getExecution(executionId);
    if (!run) throw new Error('Execution not found');
    if (run.status !== 'queued') return run;
    const incoming = new Set(run.workflowSnapshot.edges.flatMap(edge => [
      ...(!edge.loop ? [edge.target] : []),
      ...(edge.loop?.exhaustionTarget ? [edge.loop.exhaustionTarget] : []),
    ]));
    const starts = run.workflowSnapshot.nodes.filter(node => !incoming.has(node.id));
    run = this.repository.updateExecution(executionId, { status: 'running' });
    for (const node of starts) run = this.#activate(run, node.id);
    return run;
  }

  completeNode(executionId, nodeId, { outcome = 'success', artifacts = [], output = null } = {}) {
    let run = this.repository.getExecution(executionId);
    if (!run?.activeNodes.includes(nodeId)) throw new Error(`Node ${nodeId} is not active`);
    for (const artifact of artifacts) this.repository.addArtifact(executionId, nodeId, artifact);
    this.repository.completeNodeRun(executionId, nodeId, output || { outcome, artifacts });
    run = this.repository.updateExecution(executionId, {
      activeNodes: run.activeNodes.filter(id => id !== nodeId),
      completedNodes: [...run.completedNodes, nodeId],
    });
    this.repository.recordAudit(executionId, 'node.completed', { nodeId, outcome });
    return this.#route(run, nodeId, outcome);
  }

  pause(executionId) {
    const run = this.repository.updateExecution(executionId, { status: 'paused' });
    this.repository.recordAudit(executionId, 'execution.paused');
    return run;
  }

  resume(executionId) {
    const run = this.repository.getExecution(executionId);
    if (run?.status !== 'paused') throw new Error('Execution is not paused');
    this.repository.recordAudit(executionId, 'execution.resumed');
    return this.repository.updateExecution(executionId, { status: 'running' });
  }

  cancel(executionId) {
    const run = this.repository.updateExecution(executionId, { status: 'cancelled', activeNodes: [] });
    this.repository.recordAudit(executionId, 'execution.cancelled');
    return run;
  }

  pauseNode(executionId, nodeId) {
    const run = this.repository.getExecution(executionId);
    if (!run?.activeNodes.includes(nodeId)) throw new Error(`Node ${nodeId} is not active`);
    this.repository.updateActiveNodeRun(executionId, nodeId, 'paused');
    this.repository.recordAudit(executionId, 'node.paused', { nodeId });
    return run;
  }

  resumeNode(executionId, nodeId) {
    const run = this.repository.getExecution(executionId);
    if (!run?.activeNodes.includes(nodeId)) throw new Error(`Node ${nodeId} is not active`);
    this.repository.updateActiveNodeRun(executionId, nodeId, 'running');
    this.repository.recordAudit(executionId, 'node.resumed', { nodeId });
    return run;
  }

  cancelNode(executionId, nodeId) {
    const run = this.repository.getExecution(executionId);
    if (!run?.activeNodes.includes(nodeId)) throw new Error(`Node ${nodeId} is not active`);
    this.repository.updateActiveNodeRun(executionId, nodeId, 'cancelled');
    return this.completeNode(executionId, nodeId, { outcome: 'cancelled', output: { cancelled: true } });
  }

  retryNode(executionId, nodeId) {
    const run = this.repository.getExecution(executionId);
    const node = run?.workflowSnapshot.nodes.find(candidate => candidate.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const attempts = this.repository.listNodeRuns(executionId).filter(nodeRun => nodeRun.nodeId === nodeId).length;
    if (attempts >= (node.config.retry?.maxAttempts || 1)) throw new Error(`Retry budget exhausted for node ${nodeId}`);
    this.repository.updateActiveNodeRun(executionId, nodeId, 'failed', { retrying: true });
    this.repository.createNodeRun(executionId, nodeId, { checkpoint: run.inputCheckpoint, artifacts: this.repository.listArtifacts(executionId) });
    this.repository.recordAudit(executionId, 'node.retried', { nodeId, attempt: attempts + 1, checkpoint: run.inputCheckpoint });
    return run;
  }

  skipNode(executionId, nodeId, substitute = {}) {
    const run = this.repository.getExecution(executionId);
    const node = run?.workflowSnapshot.nodes.find(candidate => candidate.id === nodeId);
    if (!node || !run.activeNodes.includes(nodeId)) throw new Error(`Node ${nodeId} is not active`);
    if (!node.config?.skippable || !node.config.substituteArtifact) throw new Error(`Node ${nodeId} is not skippable`);
    this.repository.addArtifact(executionId, nodeId, { type: node.config.substituteArtifact, data: substitute });
    return this.completeNode(executionId, nodeId, { outcome: 'skipped', output: { skipped: true, substitute } });
  }

  #route(run, sourceId, outcome) {
    const edges = run.workflowSnapshot.edges.filter(edge => edge.source === sourceId);
    let selected = edges.filter(edge => edge.outcome === outcome);
    if (selected.length === 0) selected = edges.filter(edge => edge.fallback);
    for (const edge of selected) {
      let target = edge.target;
      if (edge.loop) {
        const count = (run.loopCounters[edge.id] || 0) + 1;
        run = this.repository.updateExecution(run.id, { loopCounters: { ...run.loopCounters, [edge.id]: count } });
        if (count > edge.loop.maxIterations) target = edge.loop.exhaustionTarget;
      }
      run = this.#activate(run, target, sourceId);
    }
    return run;
  }

  #activate(run, nodeId, sourceId = null) {
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    const node = run.workflowSnapshot.nodes.find(candidate => candidate.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (node.type === 'Terminal') {
      const statuses = { Success: 'succeeded', Failure: 'failed', Cancelled: 'cancelled' };
      this.repository.recordAudit(run.id, 'execution.completed', { outcome: node.config.outcome, nodeId });
      return this.repository.updateExecution(run.id, { status: statuses[node.config.outcome], activeNodes: [], completedNodes: [...run.completedNodes, nodeId] });
    }
    if (node.type === 'Phase') {
      run = this.repository.updateExecution(run.id, { phase: node.config.phase, completedNodes: [...run.completedNodes, nodeId] });
      this.repository.recordAudit(run.id, 'phase.changed', { phase: node.config.phase, nodeId });
      return this.#route(run, node.id, 'success');
    }
    if (node.type === 'Fork') {
      run = this.repository.updateExecution(run.id, { completedNodes: [...run.completedNodes, nodeId] });
      return this.#route(run, node.id, 'success');
    }
    if (node.type === 'Join') {
      const arrivals = [...new Set([...(run.joinArrivals[nodeId] || []), sourceId].filter(Boolean))];
      run = this.repository.updateExecution(run.id, { joinArrivals: { ...run.joinArrivals, [nodeId]: arrivals } });
      const incoming = run.workflowSnapshot.edges.filter(edge => edge.target === nodeId).length;
      const policy = node.config.policy || 'all';
      const threshold = policy === 'any' ? 1 : policy === 'threshold' ? Number(node.config.threshold || incoming) : incoming;
      if (arrivals.length < threshold) return run;
      run = this.repository.updateExecution(run.id, { completedNodes: [...run.completedNodes, nodeId] });
      return this.#route(run, node.id, 'success');
    }
    if (node.type === 'Condition') {
      const artifacts = this.repository.listArtifacts(run.id);
      const context = Object.fromEntries(artifacts.map(artifact => [artifact.type, artifact.data]));
      const rule = (node.config.rules || []).find(candidate => matchesRule(context, candidate));
      run = this.repository.updateExecution(run.id, { completedNodes: [...run.completedNodes, nodeId] });
      return this.#route(run, node.id, rule?.outcome || '__fallback__');
    }
    if (!run.activeNodes.includes(nodeId)) {
      this.repository.createNodeRun(run.id, nodeId, { artifacts: this.repository.listArtifacts(run.id) });
      run = this.repository.updateExecution(run.id, { activeNodes: [...run.activeNodes, nodeId] });
      this.repository.recordAudit(run.id, 'node.started', { nodeId, type: node.type });
    }
    return run;
  }
}
