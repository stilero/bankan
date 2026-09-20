import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { WorkflowRepository } from './workflowRepository.js';

const directories = [];

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'bankan-workflows-'));
  directories.push(directory);
  return new WorkflowRepository({ databasePath: join(directory, 'workflow.sqlite') });
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop(), { recursive: true, force: true });
});

describe('workflow repository', () => {
  test('upgrades editable v1 drafts idempotently while preserving published v1 snapshots', () => {
    const repository = createRepository();
    const draft = repository.createDraft({ name: 'Legacy editable', definition: {
      schemaVersion: 1,
      nodes: [
        { id: 'agent', type: 'Agent', config: { preset: 'planner', provider: 'codex', effort: 'medium', accessMode: 'read', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } },
        { id: 'done', type: 'Terminal', config: { outcome: 'Success' } },
        { id: 'failed', type: 'Terminal', config: { outcome: 'Failure' } },
      ],
      edges: [
        { id: 'ok', source: 'agent', target: 'done', outcome: 'success' },
        { id: 'bad', source: 'agent', target: 'failed', outcome: 'failure' },
      ],
    } });

    expect(draft.definition.schemaVersion).toBe(2);
    repository.db.prepare('INSERT INTO workflow_versions VALUES (?, ?, ?, ?)').run(
      draft.id, 7, JSON.stringify({ schemaVersion: 1, marker: 'immutable' }), new Date().toISOString()
    );
    const databasePath = repository.db.name;
    repository.close();

    const restarted = new WorkflowRepository({ databasePath });
    expect(restarted.getWorkflow(draft.id).definition.schemaVersion).toBe(2);
    expect(restarted.getVersion(draft.id, 7).definition).toEqual({ schemaVersion: 1, marker: 'immutable' });
    restarted.close();
  });
  test('materializes legacy application behavior into the editable Legacy Pipeline draft', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bankan-workflows-'));
    directories.push(directory);
    const databasePath = join(directory, 'workflow.sqlite');
    const legacySettings = {
        agents: {
          planners: { cli: 'claude', model: 'claude-sonnet-4-6' },
          implementors: { cli: 'codex', model: 'gpt-5.4' },
          reviewers: { cli: 'claude', model: 'claude-opus-4-6' },
        },
        prompts: { planning: 'Plan from legacy settings', implementation: 'Implement from legacy settings', review: 'Review from legacy settings' },
    };
    let repository = new WorkflowRepository({ databasePath, legacySettings });
    const legacy = repository.getWorkflow('legacy-pipeline');

    expect(legacy.definition.nodes.find(node => node.id === 'planner').config).toMatchObject({
      agentInstructions: 'Plan from legacy settings', provider: 'claude', model: 'claude-sonnet-4-6',
    });
    expect(legacy.definition.nodes.find(node => node.id === 'implementer').config).toMatchObject({
      agentInstructions: 'Implement from legacy settings', provider: 'codex', model: 'gpt-5.4',
    });
    expect(repository.getVersion('legacy-pipeline', 1).definition.nodes.find(node => node.id === 'planner').config.agentInstructions)
      .toBe('Plan from legacy settings');
    const edited = structuredClone(legacy.definition);
    edited.nodes.find(node => node.id === 'planner').config.agentInstructions = 'My independent v2 edit';
    repository.updateDraft('legacy-pipeline', edited);
    repository.close();

    repository = new WorkflowRepository({ databasePath, legacySettings });
    expect(repository.getWorkflow('legacy-pipeline').definition.nodes.find(node => node.id === 'planner').config.agentInstructions)
      .toBe('My independent v2 edit');
    repository.close();
  });
  test('seeds templates, publishes immutable versions, and snapshots the default for a task', () => {
    const repository = createRepository();
    const workflows = repository.listWorkflows();
    const standard = workflows.find(workflow => workflow.name === 'Standard Development');

    expect(workflows).toHaveLength(4);
    expect(standard.isDefault).toBe(true);
    expect(standard.latestVersion).toBe(1);
    expect(standard.summary).toMatchObject({ phases: expect.arrayContaining(['Intake', 'Planning']), agentPresets: expect.arrayContaining(['planner']) });

    const draft = repository.createDraft({ name: 'Release Flow' });
    repository.updateDraft(draft.id, {
      ...repository.getWorkflow(standard.id).definition,
      metadata: { copiedFrom: standard.id },
    });
    const published = repository.publish(draft.id);
    repository.updateDraft(draft.id, { nodes: [], edges: [] });

    expect(published.version).toBe(1);
    expect(repository.getVersion(draft.id, 1).definition.nodes.length).toBeGreaterThan(0);

    repository.setDefault(draft.id, 1);
    const run = repository.createTaskExecution({ taskId: 'T-NEW', repoPath: '/repo' });
    expect(run.workflowId).toBe(draft.id);
    expect(run.workflowVersion).toBe(1);
    expect(run.workflowSnapshot.nodes.length).toBeGreaterThan(0);
    expect(run.phase).toBe('Intake');
    repository.close();
  });

  test('exports definitions without execution history and rejects invalid imports', () => {
    const repository = createRepository();
    const standard = repository.listWorkflows().find(workflow => workflow.name === 'Standard Development');
    const exported = repository.exportWorkflow(standard.id);

    expect(exported.versions).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain('T-');
    expect(() => repository.importWorkflow({ name: 'Broken', definition: { nodes: [], edges: [] } }))
      .toThrow(/validation failed/i);
    repository.close();
  });

  test('reports the exact default version even when a newer version exists', () => {
    const repository = createRepository();
    const standard = repository.getWorkflow('standard-development');
    repository.publish(standard.id);

    const summary = repository.listWorkflows().find(workflow => workflow.id === standard.id);

    expect(summary).toMatchObject({ latestVersion: 2, defaultVersion: 1, isDefault: true });
    repository.close();
  });

  test('reconstructs supervisor context from summaries and artifacts without transcript flooding', () => {
    const repository = createRepository();
    const run = repository.createTaskExecution({ taskId: 'T-CONTEXT' });
    repository.addArtifact(run.id, 'interview', { type: 'brief', data: { goal: 'Ship safely' } });
    repository.appendSupervisorSummary(run.id, 'User approved the brief.', { outcome: 'approved' });
    repository.appendUserExchange(run.id, 'interview', 'user', 'A very long raw interview answer');

    const context = repository.getSupervisorContext(run.id);

    expect(context.artifacts[0].data.goal).toBe('Ship safely');
    expect(context.summaries[0].summary).toBe('User approved the brief.');
    expect(JSON.stringify(context)).not.toContain('A very long raw interview answer');
    repository.close();
  });
});
