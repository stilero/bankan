const PRESET_ROLES = {
  planner: { settingsKey: 'planners', getter: 'getAvailablePlanner' },
  implementer: { settingsKey: 'implementors', getter: 'getAvailableImplementor' },
  'general-review': { settingsKey: 'reviewers', getter: 'getAvailableReviewer' },
  'security-review': { settingsKey: 'reviewers', getter: 'getAvailableReviewer' },
};

function promptFor(task, node, artifacts = []) {
  const contracts = {
    planner: 'End with a concrete === PLAN START === ... === PLAN END === block.',
    implementer: 'Commit all intended changes on the current branch. End with === IMPLEMENTATION RESULT START === ... === IMPLEMENTATION RESULT END ===.',
    'general-review': 'End with === REVIEW START ===, a VERDICT: PASS or FAIL line, and === REVIEW END ===.',
    'security-review': 'End with === REVIEW START ===, a VERDICT: PASS or FAIL line, and === REVIEW END ===.',
  };
  return [
    `Workflow node: ${node.config.preset}`,
    `Task: ${task.title || task.id}`,
    task.description ? `Description: ${task.description}` : '',
    `Effort: ${node.config.effort || 'medium'}`,
    artifacts.length > 0 ? `Prior workflow context:\n${JSON.stringify(artifacts.map(artifact => ({ type: artifact.type, data: artifact.data })), null, 2)}` : '',
    'Complete this workflow step and return a concise result.',
    contracts[node.config.preset] || '',
  ].filter(Boolean).join('\n');
}

function promptForV2(task, node, artifacts) {
  const contract = node.config.executionContract;
  return [
    `Step: ${node.config.name || node.id}`,
    `Task: ${task.title || task.id}`,
    task.description ? `Description: ${task.description}` : '',
    `Effort: ${node.config.effort || 'medium'}`,
    node.config.agentInstructions,
    artifacts.length > 0 ? `Selected Artifacts:\n${JSON.stringify(artifacts.map(({ type, data }) => ({ type, data })), null, 2)}` : '',
    'SYSTEM-OWNED EXECUTION CONTRACT',
    `Result type: ${contract.resultType}`,
    `Allowed outcomes: ${contract.outcomes.join(', ')}`,
    'End with <workflow-result>{"outcome":"<allowed outcome>","artifacts":[{"type":"<artifact type>","data":{}}]}</workflow-result>.',
  ].filter(Boolean).join('\n');
}

function parseV2Result(text, contract) {
  const match = text.match(/<workflow-result>\s*([\s\S]*?)\s*<\/workflow-result>/i);
  if (!match) return null;
  try {
    const result = JSON.parse(match[1]);
    if (!contract.outcomes.includes(result.outcome) || !Array.isArray(result.artifacts || [])) return null;
    return { outcome: result.outcome, artifacts: result.artifacts || [] };
  } catch {
    return null;
  }
}

export class WorkflowDispatcher {
  constructor({ bus, agentManager, repository, completeNode, resolveWorkspace, buildCommand, executeAction, executeCheck, onExecutionUpdated }) {
    this.bus = bus;
    this.agentManager = agentManager;
    this.repository = repository;
    this.completeNode = completeNode;
    this.resolveWorkspace = resolveWorkspace;
    this.buildCommand = buildCommand;
    this.executeAction = executeAction;
    this.executeCheck = executeCheck;
    this.onExecutionUpdated = onExecutionUpdated;
    this.claims = new Map();
    this.settledClaims = new Set();
    this.agentClaims = new Map();
    this.waiting = new Map();
    this.onAgentExit = payload => this.#onAgentExit(payload);
    this.onAgentUpdated = () => {
      for (const { execution, task } of this.waiting.values()) {
        this.dispatch(execution, task).catch(() => {});
      }
    };
    this.bus.on('agent:unexpected-exit', this.onAgentExit);
    this.bus.on('agent:updated', this.onAgentUpdated);
  }

  async dispatch(execution, task) {
    if (execution.status !== 'running') return;
    for (const nodeId of execution.activeNodes) {
      const snapshotNode = execution.workflowSnapshot.nodes.find(candidate => candidate.id === nodeId);
      const defaults = execution.workflowSnapshot.schemaVersion === 2 ? execution.workflowSnapshot.defaults || {} : {};
      const node = snapshotNode && execution.workflowSnapshot.schemaVersion === 2
        ? { ...snapshotNode, config: { ...defaults, ...snapshotNode.config, retry: { ...defaults.retry, ...snapshotNode.config?.retry }, budgets: { ...defaults.budgets, ...snapshotNode.config?.budgets } } }
        : snapshotNode;
      if (!['Agent', 'Action', 'Check'].includes(node?.type)) continue;
      const attempt = (this.repository.listNodeRuns?.(execution.id) || [])
        .filter(run => run.nodeId === nodeId).at(-1)?.id || nodeId;
      const claimKey = `${execution.id}:${nodeId}:${attempt}`;
      if (this.claims.has(claimKey) || this.settledClaims.has(claimKey)) continue;
      this.claims.set(claimKey, { state: 'claiming' });
      if (node.type === 'Action') await this.#dispatchAction(execution, task, node, claimKey);
      else if (node.type === 'Check') await this.#dispatchCheck(execution, task, node, claimKey);
      else await this.#dispatchNode(execution, task, node, claimKey);
    }
  }

  releaseExecution(executionId) {
    for (const [claimKey, claim] of this.claims) {
      if (!claimKey.startsWith(`${executionId}:`)) continue;
      const agent = claim.agentId ? this.agentManager.get(claim.agentId) : null;
      if (agent) {
        if (claim.timeout) clearTimeout(claim.timeout);
        agent.kill();
        this.agentManager.removeAgent(agent.id);
      }
      if (claim.agentId) this.agentClaims.delete(claim.agentId);
      this.waiting.delete(claimKey);
      this.claims.delete(claimKey);
    }
  }

  close() {
    this.bus.off?.('agent:unexpected-exit', this.onAgentExit);
    this.bus.off?.('agent:updated', this.onAgentUpdated);
  }

  async #dispatchNode(execution, task, node, claimKey) {
    const v2 = execution.workflowSnapshot.schemaVersion === 2;
    const defaults = execution.workflowSnapshot.defaults || {};
    node = { ...node, config: { ...defaults, ...node.config, retry: { ...defaults.retry, ...node.config?.retry }, budgets: { ...defaults.budgets, ...node.config?.budgets } } };
    const resultType = node.config.executionContract?.resultType;
    const role = v2
      ? resultType === 'review'
        ? { settingsKey: 'reviewers', getter: 'getAvailableReviewer' }
        : node.config.accessMode === 'write'
          ? { settingsKey: 'implementors', getter: 'getAvailableImplementor' }
          : { settingsKey: 'planners', getter: 'getAvailablePlanner' }
      : PRESET_ROLES[node.config?.preset];
    if (!role) return this.#fail(execution, node, claimKey, `Unsupported agent preset ${node.config?.preset || '(missing)'}`);
    if (this.agentManager.getMaxForRole(role.settingsKey) < 1) {
      return this.#fail(execution, node, claimKey, `${role.settingsKey} capacity is disabled in Settings`);
    }

    let agent = this.agentManager[role.getter]();
    if (!agent) {
      this.agentManager.scaleUp(role.settingsKey);
      agent = this.agentManager[role.getter]();
    }
    if (!agent) {
      this.claims.delete(claimKey);
      this.waiting.set(claimKey, { execution, task });
      this.repository.recordAudit(execution.id, 'node.waiting-capacity', { nodeId: node.id, role: role.settingsKey });
      return;
    }

    try {
      const workspace = await this.resolveWorkspace(task, node);
      if (!this.claims.has(claimKey)) return;
      agent.cli = node.config.provider;
      agent.model = node.config.model || '';
      agent.currentTask = task.id;
      agent.taskLabel = `${node.config.name || node.config.preset || node.id}: ${task.title || task.id}`;
      const mode = node.config.accessMode === 'write' ? 'interactive' : resultType === 'review' ? 'review' : 'plan';
      const allArtifacts = this.repository.listArtifacts?.(execution.id) || [];
      const bindings = node.config.artifactBindings || [];
      const artifacts = v2 ? allArtifacts.filter(artifact => bindings.some(binding => (binding.type || binding) === artifact.type)) : allArtifacts;
      const prompt = v2 ? promptForV2(task, node, artifacts) : promptFor(task, node, artifacts);
      const command = this.buildCommand(agent.cli, prompt, mode, agent.model);
      if (!agent.spawn(workspace, command)) throw new Error(`Unable to start agent in ${workspace}`);
      const timeout = setTimeout(() => this.#timeoutClaim(claimKey), node.config.timeoutMs || 30 * 60 * 1000);
      timeout.unref?.();
      this.claims.set(claimKey, {
        agentId: agent.id, taskId: task.id, nodeId: node.id, executionId: execution.id,
        preset: node.config.preset, executionContract: v2 ? node.config.executionContract : null, timeout,
      });
      this.waiting.delete(claimKey);
      this.agentClaims.set(agent.id, claimKey);
      this.repository.recordAudit(execution.id, 'node.dispatched', { nodeId: node.id, agentId: agent.id, provider: agent.cli, model: agent.model });
    } catch (error) {
      if (agent) {
        agent.currentTask = null;
        agent.taskLabel = '';
      }
      this.#fail(execution, node, claimKey, error.message);
    }
  }

  async #dispatchAction(execution, task, node, claimKey) {
    if (!this.executeAction) return this.#fail(execution, node, claimKey, `Unsupported action ${node.config?.action || '(missing)'}`);
    try {
      const output = await this.executeAction(task, node);
      if (!this.claims.has(claimKey)) return;
      this.claims.delete(claimKey);
      this.settledClaims.add(claimKey);
      if (output?.pending) {
        this.repository.recordAudit(execution.id, 'node.awaiting-human', { nodeId: node.id, reason: output.reason });
        return;
      }
      await this.completeNode(task.id, node.id, { outcome: 'success', output: output || { ok: true } });
    } catch (error) {
      this.#fail(execution, node, claimKey, error.message);
    }
  }

  async #dispatchCheck(execution, task, node, claimKey) {
    if (!this.executeCheck) return this.#fail(execution, node, claimKey, `Unsupported check adapter ${node.config?.adapter || '(missing)'}`);
    try {
      const output = await this.executeCheck(task, node);
      if (!this.claims.has(claimKey)) return;
      this.claims.delete(claimKey);
      this.settledClaims.add(claimKey);
      const data = { adapter: node.config.adapter, ...output };
      await this.completeNode(task.id, node.id, {
        outcome: output.passed ? 'pass' : 'fail',
        output,
        artifacts: [{ type: 'check-result', data }],
      });
    } catch (error) {
      this.#fail(execution, node, claimKey, error.message);
    }
  }

  async #onAgentExit({ agentId, taskId, exitCode, signal }) {
    const claimKey = this.agentClaims.get(agentId);
    if (!claimKey) return;
    const claim = this.claims.get(claimKey);
    const agent = this.agentManager.get(agentId);
    const text = agent?.getBufferString(500)?.trim() || '';
    this.agentClaims.delete(agentId);
    if (claim.timeout) clearTimeout(claim.timeout);
    this.claims.delete(claimKey);
    this.waiting.delete(claimKey);
    this.settledClaims.add(claimKey);
    if (agent) {
      agent.kill();
      this.agentManager.removeAgent(agentId);
    }
    const v2Result = exitCode === 0 && claim.executionContract ? parseV2Result(text, claim.executionContract) : null;
    const review = claim.preset?.includes('review');
    const valid = exitCode === 0 && (claim.executionContract
      ? Boolean(v2Result)
      : review
      ? /=== REVIEW END ===/i.test(text) && /VERDICT:\s*(PASS|FAIL)/i.test(text)
      : claim.preset === 'planner'
        ? /=== PLAN END ===/i.test(text)
        : /=== IMPLEMENTATION RESULT END ===/i.test(text));
    const outcome = v2Result?.outcome || (review && valid ? (/VERDICT:\s*PASS/i.test(text) ? 'pass' : 'fail') : valid ? 'success' : 'failure');
    await this.completeNode(taskId, claim.nodeId, {
      outcome,
      output: { text, exitCode, signal },
      artifacts: v2Result?.artifacts || (text ? [{ type: `${claim.nodeId}-result`, data: { text } }] : []),
    });
  }

  #fail(execution, node, claimKey, reason) {
    this.claims.delete(claimKey);
    this.repository.recordAudit(execution.id, 'node.dispatch-failed', { nodeId: node.id, reason });
    const failed = this.repository.updateExecution(execution.id, { status: 'failed', activeNodes: [] });
    this.onExecutionUpdated?.(failed, reason);
    return failed;
  }

  async #timeoutClaim(claimKey) {
    const claim = this.claims.get(claimKey);
    if (!claim) return;
    const agent = this.agentManager.get(claim.agentId);
    this.claims.delete(claimKey);
    this.agentClaims.delete(claim.agentId);
    if (agent) {
      agent.kill();
      this.agentManager.removeAgent(agent.id);
    }
    await this.completeNode(claim.taskId, claim.nodeId, {
      outcome: 'failure',
      output: { error: 'Agent node timed out' },
    });
  }
}
