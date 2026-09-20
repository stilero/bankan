import { getRuntimeStatePaths } from './config.js';
import store from './store.js';
import bus from './events.js';
import { WorkflowEngine } from './workflowEngine.js';
import { WorkflowRepository } from './workflowRepository.js';

let repository;
let engine;

export function getWorkflowRepository() {
  if (!repository) {
    repository = new WorkflowRepository({ databasePath: getRuntimeStatePaths().workflowDatabase });
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
  let updated;
  if (command === 'pause') updated = getWorkflowEngine().pause(execution.id);
  else if (command === 'resume') updated = getWorkflowEngine().resume(execution.id);
  else if (command === 'cancel') updated = getWorkflowEngine().cancel(execution.id);
  else if (command === 'completeNode') updated = getWorkflowEngine().completeNode(execution.id, payload.nodeId, payload);
  else if (command === 'pauseNode') updated = getWorkflowEngine().pauseNode(execution.id, payload.nodeId);
  else if (command === 'resumeNode') updated = getWorkflowEngine().resumeNode(execution.id, payload.nodeId);
  else if (command === 'cancelNode') updated = getWorkflowEngine().cancelNode(execution.id, payload.nodeId);
  else if (command === 'retryNode') updated = getWorkflowEngine().retryNode(execution.id, payload.nodeId);
  else if (command === 'skipNode') updated = getWorkflowEngine().skipNode(execution.id, payload.nodeId, payload.substitute);
  else throw new Error(`Unsupported workflow command ${command}`);
  syncTaskFromExecution(updated);
  return updated;
}

export function getWorkflowRun(taskId) {
  const repo = getWorkflowRepository();
  const execution = repo.getExecutionForTask(taskId);
  if (!execution) return null;
  return {
    ...execution,
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

export function resetWorkflowRuntimeForTests() {
  repository?.close();
  repository = undefined;
  engine = undefined;
}
