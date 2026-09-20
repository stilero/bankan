import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createBuiltinWorkflows, createWorkflowId, validateWorkflowDefinition } from './workflowDefinitions.js';

const parse = (value, fallback = null) => value ? JSON.parse(value) : fallback;
const stringify = value => JSON.stringify(value ?? null);
const now = () => new Date().toISOString();

export class WorkflowRepository {
  constructor({ databasePath, capabilities } = {}) {
    if (!databasePath) throw new Error('databasePath is required');
    mkdirSync(dirname(databasePath), { recursive: true });
    this.capabilities = capabilities;
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.#migrate();
    this.#seed();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        draft_json TEXT NOT NULL, latest_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_versions (
        workflow_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
        published_at TEXT NOT NULL, PRIMARY KEY (workflow_id, version),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS workflow_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL, workflow_snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL, phase TEXT NOT NULL, active_nodes_json TEXT NOT NULL,
        completed_nodes_json TEXT NOT NULL, loop_counters_json TEXT NOT NULL,
        join_arrivals_json TEXT NOT NULL, budgets_json TEXT NOT NULL,
        workspace_path TEXT, input_checkpoint TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS node_runs (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
        attempt INTEGER NOT NULL, status TEXT NOT NULL, input_json TEXT,
        output_json TEXT, checkpoint TEXT, started_at TEXT, completed_at TEXT,
        FOREIGN KEY (execution_id) REFERENCES task_executions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
        type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES task_executions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS supervisor_memory (
        execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, summary TEXT NOT NULL,
        decision_json TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS user_exchanges (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, execution_id TEXT, event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }

  #seed() {
    if (this.db.prepare('SELECT COUNT(*) AS count FROM workflows').get().count > 0) return;
    const insertWorkflow = this.db.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertVersion = this.db.prepare('INSERT INTO workflow_versions VALUES (?, ?, ?, ?)');
    const timestamp = now();
    this.db.transaction(() => {
      for (const template of createBuiltinWorkflows()) {
        insertWorkflow.run(template.id, template.name, template.description, stringify(template.definition), 1, timestamp, timestamp);
        insertVersion.run(template.id, 1, stringify(template.definition), timestamp);
        if (template.isDefault) this.db.prepare('INSERT INTO workflow_settings VALUES (?, ?)').run('defaultWorkflow', stringify({ workflowId: template.id, version: 1 }));
      }
    })();
  }

  close() { this.db.close(); }

  listWorkflows() {
    const selected = this.getDefault();
    return this.db.prepare('SELECT * FROM workflows ORDER BY created_at, name').all().map(row => {
      const definition = parse(row.draft_json, { nodes: [] });
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        latestVersion: row.latest_version,
        defaultVersion: selected?.workflowId === row.id ? selected.version : null,
        isDefault: selected?.workflowId === row.id,
        summary: {
          nodeCount: definition.nodes.length,
          phases: definition.nodes.filter(node => node.type === 'Phase').map(node => node.config?.phase).filter(Boolean),
          agentPresets: definition.nodes.filter(node => node.type === 'Agent').map(node => node.config?.preset).filter(Boolean),
        },
        updatedAt: row.updated_at,
      };
    });
  }

  getWorkflow(id) {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!row) return null;
    return { id: row.id, name: row.name, description: row.description, definition: parse(row.draft_json), latestVersion: row.latest_version };
  }

  createDraft({ name, description = '', definition = { schemaVersion: 1, nodes: [], edges: [] } }) {
    const id = createWorkflowId();
    const timestamp = now();
    this.db.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, 0, ?, ?)').run(id, name, description, stringify(definition), timestamp, timestamp);
    return this.getWorkflow(id);
  }

  updateDraft(id, definition, metadata = {}) {
    const result = this.db.prepare(`UPDATE workflows SET draft_json = ?, name = COALESCE(?, name),
      description = COALESCE(?, description), updated_at = ? WHERE id = ?`)
      .run(stringify(definition), metadata.name ?? null, metadata.description ?? null, now(), id);
    if (!result.changes) throw new Error('Workflow not found');
    return this.getWorkflow(id);
  }

  validate(id) {
    const workflow = this.getWorkflow(id);
    if (!workflow) throw new Error('Workflow not found');
    return validateWorkflowDefinition(workflow.definition, this.capabilities);
  }

  publish(id) {
    const workflow = this.getWorkflow(id);
    if (!workflow) throw new Error('Workflow not found');
    const errors = validateWorkflowDefinition(workflow.definition, this.capabilities);
    if (errors.length > 0) throw new Error(`Workflow validation failed: ${errors.join('; ')}`);
    const version = workflow.latestVersion + 1;
    const timestamp = now();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO workflow_versions VALUES (?, ?, ?, ?)').run(id, version, stringify(workflow.definition), timestamp);
      this.db.prepare('UPDATE workflows SET latest_version = ?, updated_at = ? WHERE id = ?').run(version, timestamp, id);
    })();
    return this.getVersion(id, version);
  }

  getVersion(workflowId, version) {
    const row = this.db.prepare('SELECT * FROM workflow_versions WHERE workflow_id = ? AND version = ?').get(workflowId, version);
    return row ? { workflowId, version: row.version, definition: parse(row.definition_json), publishedAt: row.published_at } : null;
  }

  listVersions(workflowId) {
    return this.db.prepare('SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC').all(workflowId)
      .map(row => ({ workflowId, version: row.version, definition: parse(row.definition_json), publishedAt: row.published_at }));
  }

  getDefault() {
    return parse(this.db.prepare('SELECT value FROM workflow_settings WHERE key = ?').get('defaultWorkflow')?.value);
  }

  setDefault(workflowId, version) {
    if (!this.getVersion(workflowId, version)) throw new Error('Published workflow version not found');
    this.db.prepare(`INSERT INTO workflow_settings (key, value) VALUES ('defaultWorkflow', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(stringify({ workflowId, version }));
    return this.getDefault();
  }

  exportWorkflow(workflowId) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error('Workflow not found');
    return {
      schemaVersion: 1,
      name: workflow.name,
      description: workflow.description,
      draft: workflow.definition,
      versions: this.listVersions(workflowId).map(({ version, definition, publishedAt }) => ({ version, definition, publishedAt })),
    };
  }

  importWorkflow(payload) {
    const definition = payload?.definition || payload?.draft;
    const errors = validateWorkflowDefinition(definition, this.capabilities);
    if (errors.length > 0) throw new Error(`Workflow validation failed: ${errors.join('; ')}`);
    const workflow = this.createDraft({ name: payload.name || 'Imported Workflow', description: payload.description || '', definition });
    this.publish(workflow.id);
    return this.getWorkflow(workflow.id);
  }

  createTaskExecution({ taskId, workflowId, workflowVersion, repoPath = '', workspacePath = null }) {
    const selected = workflowId
      ? { workflowId, version: workflowVersion || this.getWorkflow(workflowId)?.latestVersion }
      : this.getDefault();
    const published = selected && this.getVersion(selected.workflowId, selected.version);
    if (!published) throw new Error('Published workflow version not found');
    const executionId = `run-${randomUUID().slice(0, 10)}`;
    const timestamp = now();
    const budgets = published.definition.defaults?.budgets || {};
    this.db.prepare('INSERT INTO task_executions VALUES (?, ?, ?, ?, ?, \'queued\', \'Intake\', \'[]\', \'[]\', \'{}\', \'{}\', ?, ?, NULL, ?, ?)')
      .run(executionId, taskId, selected.workflowId, selected.version, stringify(published.definition), stringify(budgets), workspacePath || repoPath || null, timestamp, timestamp);
    this.recordAudit(executionId, 'execution.created', { workflowId: selected.workflowId, version: selected.version });
    return this.getExecution(executionId);
  }

  getExecution(id) {
    const row = this.db.prepare('SELECT * FROM task_executions WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id, taskId: row.task_id, workflowId: row.workflow_id, workflowVersion: row.workflow_version,
      workflowSnapshot: parse(row.workflow_snapshot_json), status: row.status, phase: row.phase,
      activeNodes: parse(row.active_nodes_json, []), completedNodes: parse(row.completed_nodes_json, []),
      loopCounters: parse(row.loop_counters_json, {}), joinArrivals: parse(row.join_arrivals_json, {}),
      budgets: parse(row.budgets_json, {}), workspacePath: row.workspace_path,
      inputCheckpoint: row.input_checkpoint, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  getExecutionForTask(taskId) {
    const row = this.db.prepare('SELECT id FROM task_executions WHERE task_id = ?').get(taskId);
    return row ? this.getExecution(row.id) : null;
  }

  listExecutions() {
    return this.db.prepare('SELECT id FROM task_executions ORDER BY created_at DESC').all().map(row => this.getExecution(row.id));
  }

  updateExecution(id, updates) {
    const current = this.getExecution(id);
    if (!current) throw new Error('Execution not found');
    const next = { ...current, ...updates };
    this.db.prepare(`UPDATE task_executions SET status = ?, phase = ?, active_nodes_json = ?, completed_nodes_json = ?,
      loop_counters_json = ?, join_arrivals_json = ?, budgets_json = ?, workspace_path = ?, input_checkpoint = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, next.phase, stringify(next.activeNodes), stringify(next.completedNodes), stringify(next.loopCounters),
        stringify(next.joinArrivals), stringify(next.budgets), next.workspacePath, next.inputCheckpoint, now(), id);
    return this.getExecution(id);
  }

  createNodeRun(executionId, nodeId, input = null) {
    const attempt = this.db.prepare('SELECT COUNT(*) AS count FROM node_runs WHERE execution_id = ? AND node_id = ?').get(executionId, nodeId).count + 1;
    const id = `node-${randomUUID().slice(0, 10)}`;
    this.db.prepare(`INSERT INTO node_runs (id, execution_id, node_id, attempt, status, input_json, started_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)`).run(id, executionId, nodeId, attempt, stringify(input), now());
    return { id, executionId, nodeId, attempt, status: 'running' };
  }

  completeNodeRun(executionId, nodeId, output, status = 'succeeded') {
    this.db.prepare(`UPDATE node_runs SET status = ?, output_json = ?, completed_at = ? WHERE id = (
      SELECT id FROM node_runs WHERE execution_id = ? AND node_id = ? AND status = 'running' ORDER BY attempt DESC LIMIT 1
    )`).run(status, stringify(output), now(), executionId, nodeId);
  }

  updateActiveNodeRun(executionId, nodeId, status, output = null) {
    this.db.prepare(`UPDATE node_runs SET status = ?, output_json = COALESCE(?, output_json),
      completed_at = CASE WHEN ? IN ('cancelled', 'skipped', 'failed') THEN ? ELSE completed_at END
      WHERE id = (SELECT id FROM node_runs WHERE execution_id = ? AND node_id = ? ORDER BY attempt DESC LIMIT 1)`)
      .run(status, output == null ? null : stringify(output), status, now(), executionId, nodeId);
  }

  listNodeRuns(executionId) {
    return this.db.prepare('SELECT * FROM node_runs WHERE execution_id = ? ORDER BY started_at, attempt').all(executionId).map(row => ({
      id: row.id, nodeId: row.node_id, attempt: row.attempt, status: row.status,
      input: parse(row.input_json), output: parse(row.output_json), checkpoint: row.checkpoint,
    }));
  }

  addArtifact(executionId, nodeId, artifact) {
    const id = `artifact-${randomUUID().slice(0, 10)}`;
    this.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)').run(id, executionId, nodeId, artifact.type, stringify(artifact.data), now());
    return id;
  }

  listArtifacts(executionId) {
    return this.db.prepare('SELECT * FROM artifacts WHERE execution_id = ? ORDER BY created_at').all(executionId)
      .map(row => ({ id: row.id, nodeId: row.node_id, type: row.type, data: parse(row.data_json), createdAt: row.created_at }));
  }

  appendSupervisorSummary(executionId, summary, decision = null) {
    const sequence = this.db.prepare('SELECT COUNT(*) AS count FROM supervisor_memory WHERE execution_id = ?').get(executionId).count + 1;
    this.db.prepare('INSERT INTO supervisor_memory VALUES (?, ?, ?, ?, ?)')
      .run(executionId, sequence, summary, stringify(decision), now());
    return { sequence, summary, decision };
  }

  appendUserExchange(executionId, nodeId, role, content) {
    const id = `exchange-${randomUUID().slice(0, 10)}`;
    this.db.prepare('INSERT INTO user_exchanges VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, executionId, nodeId, role, content, now());
    return id;
  }

  listUserExchanges(executionId) {
    return this.db.prepare('SELECT * FROM user_exchanges WHERE execution_id = ? ORDER BY created_at').all(executionId)
      .map(row => ({ id: row.id, nodeId: row.node_id, role: row.role, content: row.content, createdAt: row.created_at }));
  }

  getSupervisorContext(executionId) {
    const summaries = this.db.prepare('SELECT * FROM supervisor_memory WHERE execution_id = ? ORDER BY sequence').all(executionId)
      .map(row => ({ sequence: row.sequence, summary: row.summary, decision: parse(row.decision_json), createdAt: row.created_at }));
    return {
      execution: this.getExecution(executionId),
      artifacts: this.listArtifacts(executionId),
      summaries,
    };
  }

  recordAudit(executionId, eventType, payload = {}) {
    this.db.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)').run(`audit-${randomUUID().slice(0, 10)}`, executionId, eventType, stringify(payload), now());
  }

  listAuditEvents(executionId) {
    return this.db.prepare('SELECT * FROM audit_events WHERE execution_id = ? ORDER BY created_at').all(executionId)
      .map(row => ({ type: row.event_type, payload: parse(row.payload_json), createdAt: row.created_at }));
  }
}
