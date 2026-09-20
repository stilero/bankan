import { getRuntimeStatePaths, loadSettings } from './config.js';
import store from './store.js';
import bus from './events.js';
import { WorkflowEngine } from './workflowEngine.js';
import { WorkflowRepository } from './workflowRepository.js';
import agentManager from './agents.js';
import { buildAgentCommand, createPR, prepareWorkspaceBranch, setupWorkspace } from './orchestrator.js';
import { WorkflowDispatcher } from './workflowDispatcher.js';
import { runWorkflowCheck } from './workflowChecks.js';

let repository;
let engine;
let dispatcher;

function getWorkflowDispatcher() {
  if (process.env.NODE_ENV === 'test') return null;
  if (!dispatcher) {
    dispatcher = new WorkflowDispatcher({
      bus,
      agentManager,
      repository: getWorkflowRepository(),
      completeNode: (taskId, nodeId, payload) => controlWorkflowRun(taskId, 'completeNode', { nodeId, ...payload }),
      resolveWorkspace: async (task, node) => {
        let currentTask = task;
        if (node.config?.accessMode === 'write' && !task.branch) {
          currentTask = store.updateTask(task.id, { branch: `workflow/${task.id.toLowerCase()}` });
        }
        const workspacePath = node.config?.accessMode === 'write'
          ? await prepareWorkspaceBranch(currentTask)
          : await setupWorkspace(currentTask);
        store.updateTask(task.id, { workspacePath });
        return workspacePath;
      },
      buildCommand: buildAgentCommand,
      executeCheck: runWorkflowCheck,
      executeAction: async (task, node) => {
        if (node.config?.action !== 'create-pr') throw new Error(`Unsupported action ${node.config?.action || '(missing)'}`);
        const before = store.getTask(task.id);
        if (before.prUrl) return { prUrl: before.prUrl, prNumber: before.prNumber, recovered: true };
        if (before.status === 'awaiting_manual_pr') return { pending: true, reason: before.blockedReason };
        await createPR(task.id);
        const updated = store.getTask(task.id);
        if (updated.status === 'blocked') throw new Error(updated.blockedReason || 'Pull request creation failed');
        if (updated.status === 'awaiting_manual_pr') return { pending: true, reason: updated.blockedReason };
        return { prUrl: updated.prUrl, prNumber: updated.prNumber };
      },
      onExecutionUpdated: (execution, reason) => {
        syncTaskFromExecution(execution);
        if (reason) store.updateTask(execution.taskId, { blockedReason: reason });
      },
    });
  }
  return dispatcher;
}

export function getWorkflowRepository() {
  if (!repository) {
    repository = new WorkflowRepository({ databasePath: getRuntimeStatePaths().workflowDatabase, legacySettings: loadSettings() });
  }
  return repository;
}

export function getWorkflowEngine() {
  if (!engine) engine = new WorkflowEngine(getWorkflowRepository());
  return engine;
}

function phaseStatus(phase, runStatus) {
  if (runStatus === 'succeeded') return 'done';
  if (runStatus === 'failed') return 'blocked';
  if (runStatus === 'cancelled') return 'aborted';
  if (runStatus === 'paused') return 'paused';
  return {
    Intake: 'backlog',
    Planning: 'planning',
    Implementation: 'implementing',
    Review: 'review',
    Delivery: 'awaiting_manual_pr',
  }[phase] || 'backlog';
}

export function syncTaskFromExecution(execution) {
  const task = store.getTask(execution.taskId);
  if (!task) return null;
  const status = phaseStatus(execution.phase, execution.status);
  const updated = store.updateTask(task.id, {
    status,
    currentPhase: execution.phase,
    workflowRunId: execution.id,
    workflowId: execution.workflowId,
    workflowVersion: execution.workflowVersion,
    blockedReason: execution.status === 'failed' ? 'Workflow finished with a failure outcome' : null,
  });
  bus.emit('workflow:run-updated', execution);
  getWorkflowDispatcher()?.dispatch(execution, updated).catch(error => {
    getWorkflowRepository().recordAudit(execution.id, 'dispatcher.failed', { reason: error.message });
    const failed = getWorkflowRepository().updateExecution(execution.id, { status: 'failed', activeNodes: [] });
    store.updateTask(task.id, { status: 'blocked', blockedReason: error.message });
    bus.emit('workflow:run-updated', failed);
  });
  return updated;
}

export function createWorkflowTask({ title, priority, description, repoPath, workflowId, workflowVersion }) {
  const task = store.addTask({ title, priority, description, repoPath, executionMode: 'workflow' });
  try {
    const execution = getWorkflowRepository().createTaskExecution({
      taskId: task.id,
      workflowId,
      workflowVersion,
      repoPath,
    });
    const started = getWorkflowEngine().start(execution.id);
    syncTaskFromExecution(started);
    return store.getTask(task.id);
  } catch (error) {
    store.deleteTask(task.id);
    throw error;
  }
}

export function controlWorkflowRun(taskId, command, payload = {}) {
  const repo = getWorkflowRepository();
  const execution = repo.getExecutionForTask(taskId);
  if (!execution) throw new Error('Workflow execution not found');
  const completeDecision = node => {
    const outcomes = node.config?.outcomes || execution.workflowSnapshot.edges.filter(edge => edge.source === payload.nodeId).map(edge => edge.outcome).filter(Boolean);
    if (!outcomes.includes(payload.outcome)) throw new Error(`Unsupported decision outcome ${payload.outcome}`);
    const data = { outcome: payload.outcome, feedback: payload.feedback || '' };
    if (payload.feedback) repo.appendUserExchange(execution.id, payload.nodeId, 'user', payload.feedback);
    return getWorkflowEngine().completeNode(execution.id, payload.nodeId, {
      outcome: payload.outcome,
      output: data,
      artifacts: [{ type: node.config?.produces?.[0] || 'human-feedback', data }],
    });
  };
  let updated;
  if (command === 'pause') {
    getWorkflowDispatcher()?.releaseExecution(execution.id);
    updated = getWorkflowEngine().pause(execution.id);
  }
  else if (command === 'resume') updated = getWorkflowEngine().resume(execution.id);
  else if (command === 'cancel') {
    getWorkflowDispatcher()?.releaseExecution(execution.id);
    updated = getWorkflowEngine().cancel(execution.id);
  }
  else if (command === 'completeNode') {
    const node = execution.workflowSnapshot.nodes.find(candidate => candidate.id === payload.nodeId);
    updated = node?.type === 'HumanDecision' || (execution.workflowSnapshot.schemaVersion === 2 && node?.type === 'Approval')
      ? completeDecision(node)
      : getWorkflowEngine().completeNode(execution.id, payload.nodeId, payload);
  }
  else if (command === 'pauseNode') updated = getWorkflowEngine().pauseNode(execution.id, payload.nodeId);
  else if (command === 'resumeNode') updated = getWorkflowEngine().resumeNode(execution.id, payload.nodeId);
  else if (command === 'cancelNode') updated = getWorkflowEngine().cancelNode(execution.id, payload.nodeId);
  else if (command === 'retryNode') updated = getWorkflowEngine().retryNode(execution.id, payload.nodeId);
  else if (command === 'skipNode') updated = getWorkflowEngine().skipNode(execution.id, payload.nodeId, payload.substitute);
  else if (command === 'decide') {
    const node = execution.workflowSnapshot.nodes.find(candidate => candidate.id === payload.nodeId);
    if (!['Approval', 'HumanDecision'].includes(node?.type)) throw new Error(`Node ${payload.nodeId} is not a Human Decision node`);
    updated = completeDecision(node);
  }
  else if (command === 'submitInput') {
    const node = execution.workflowSnapshot.nodes.find(candidate => candidate.id === payload.nodeId);
    if (node?.type !== 'Interview') throw new Error(`Node ${payload.nodeId} is not an Interview node`);
    if (!payload.answers || typeof payload.answers !== 'object' || Array.isArray(payload.answers)) {
      throw new Error('Interview answers must be an object');
    }
    if (Object.keys(payload.answers).length === 0) throw new Error('Interview answers cannot be empty');
    repo.appendUserExchange(execution.id, payload.nodeId, 'user', JSON.stringify(payload.answers));
    updated = getWorkflowEngine().completeNode(execution.id, payload.nodeId, {
      outcome: 'success',
      output: { answers: payload.answers },
      artifacts: [{ type: 'interview-answers', data: { answers: payload.answers } }],
    });
  }
  else throw new Error(`Unsupported workflow command ${command}`);
  syncTaskFromExecution(updated);
  return updated;
}

export function getWorkflowRun(taskId) {
  const repo = getWorkflowRepository();
  const execution = repo.getExecutionForTask(taskId);
  if (!execution) return null;
  const actionableNodes = execution.activeNodes.map(nodeId => {
    const node = execution.workflowSnapshot.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return null;
    const actions = {
      Interview: 'submitInput',
      Approval: 'decide',
      HumanDecision: 'decide',
      Agent: 'awaitingExecution',
      Check: 'awaitingExecution',
      Action: 'awaitingExecution',
    };
    return {
      nodeId,
      type: node.type,
      label: node.config?.label || node.data?.label || node.type,
      action: actions[node.type] || 'complete',
      actor: ['Interview', 'Approval', 'HumanDecision'].includes(node.type) ? 'human' : 'server',
      allowedOutcomes: [...new Set(execution.workflowSnapshot.edges
        .filter(edge => edge.source === nodeId && edge.outcome)
        .map(edge => edge.outcome))],
      choices: ['Approval', 'HumanDecision'].includes(node.type)
        ? (node.config?.choices || (node.config?.outcomes || execution.workflowSnapshot.edges.filter(edge => edge.source === nodeId).map(edge => edge.outcome).filter(Boolean))
          .map(outcome => ({ outcome, label: outcome })))
        : undefined,
      acceptsFeedback: node.type === 'HumanDecision',
    };
  }).filter(Boolean);
  return {
    ...execution,
    actionableNodes,
    nodeRuns: repo.listNodeRuns(execution.id),
    artifacts: repo.listArtifacts(execution.id),
    exchanges: repo.listUserExchanges(execution.id),
    auditEvents: repo.listAuditEvents(execution.id),
  };
}

export function appendWorkflowExchange(taskId, { nodeId, role, content }) {
  const repo = getWorkflowRepository();
  const execution = repo.getExecutionForTask(taskId);
  if (!execution) throw new Error('Workflow execution not found');
  if (!execution.activeNodes.includes(nodeId)) throw new Error(`Node ${nodeId} is not active`);
  const id = repo.appendUserExchange(execution.id, nodeId, role, content);
  repo.recordAudit(execution.id, 'user.exchange', { nodeId, role, exchangeId: id });
  bus.emit('workflow:run-updated', repo.getExecution(execution.id));
  return { id };
}

export function recoverWorkflowExecutions() {
  for (const execution of getWorkflowRepository().listExecutions()) {
    if (!['running', 'paused'].includes(execution.status)) continue;
    if (execution.status === 'paused') continue;
    const hasUncertainExternalAction = execution.activeNodes.some(nodeId => {
      const node = execution.workflowSnapshot.nodes.find(candidate => candidate.id === nodeId);
      return node?.type === 'Action' && node.config?.action === 'create-pr';
    });
    if (hasUncertainExternalAction) {
      getWorkflowRepository().recordAudit(execution.id, 'action.recovery-needs-confirmation', { activeNodes: execution.activeNodes });
      store.updateTask(execution.taskId, {
        status: 'awaiting_manual_pr',
        blockedReason: 'Delivery was interrupted. Confirm the pull request before completing this workflow.',
      });
      bus.emit('workflow:run-updated', execution);
      continue;
    }
    getWorkflowRepository().recordAudit(execution.id, 'execution.recovered', { activeNodes: execution.activeNodes });
    syncTaskFromExecution(execution);
  }
}

export function resetWorkflowRuntimeForTests() {
  dispatcher?.close();
  dispatcher = undefined;
  repository?.close();
  repository = undefined;
  engine = undefined;
}
