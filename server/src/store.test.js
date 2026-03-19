import { afterEach, describe, expect, test } from 'vitest';

import { createRuntimeHarness } from '../test-utils.js';

let harness = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe('TaskStore persistence and recovery', () => {
  test('addTask populates default fields and update helpers persist changes', async () => {
    harness = createRuntimeHarness();
    const storeModule = await harness.importModule('./src/store.js');
    const store = storeModule.default;

    const task = store.addTask({
      title: 'Add tests',
      priority: 'high',
      description: 'Focus on critical paths',
      repoPath: '/repo',
    });

    expect(task.id).toMatch(/^T-/);
    expect(task.status).toBe('backlog');
    expect(task.lastActiveStage).toBe('backlog');
    expect(task.log.at(-1).message).toBe('Task created');
    expect(task.maxReviewCycles).toBe(3);

    store.updateTask(task.id, { status: 'planning', assignedTo: 'plan-1' });
    store.appendLog(task.id, 'Planner started');
    store.appendSession(task.id, { id: 'session-1' });
    store.updateTaskTokens(task.id, 250);
    store.updateTaskTokens(task.id, 100);

    const updated = store.getTask(task.id);
    expect(updated.assignedTo).toBe('plan-1');
    expect(updated.lastActiveStage).toBe('planning');
    expect(updated.totalTokens).toBe(250);
    expect(updated.sessionHistory).toEqual([{ id: 'session-1' }]);
    expect(updated.log.map(entry => entry.message)).toEqual([
      'Task created',
      'Status changed to planning',
      'Planner started',
    ]);
  });

  test('savePlan, removePlan, and deleteTask update persisted task state', async () => {
    harness = createRuntimeHarness();
    const storeModule = await harness.importModule('./src/store.js');
    const configModule = await harness.importModule('./src/config.js');
    const store = storeModule.default;

    const task = store.addTask({ title: 'Delete me' });
    store.savePlan(task.id, 'Plan content');

    expect(configModule.getRuntimeStatePaths().plansDir).toContain(harness.runtimeDir);

    store.removePlan(task.id);
    const removed = store.deleteTask(task.id);

    expect(removed.id).toBe(task.id);
    expect(store.getTask(task.id)).toBeNull();
    expect(store.deleteTask('missing')).toBeNull();
  });

  test('restartRecovery normalizes in-flight and legacy blocked tasks', async () => {
    harness = createRuntimeHarness();
    const storeModule = await harness.importModule('./src/store.js');
    const store = storeModule.default;

    const planningTask = store.addTask({ title: 'Planning task', repoPath: '/repo' });
    const reviewTask = store.addTask({ title: 'Review task', repoPath: '/repo' });
    const pausedTask = store.addTask({ title: 'Paused task', repoPath: '/repo' });
    const doneTask = store.addTask({ title: 'Done task', repoPath: '/repo' });
    const legacyBlockedTask = store.addTask({
      title: 'Legacy blocker',
      repoPath: 'https://github.com/stilero/bankan.git',
    });

    store.updateTask(planningTask.id, { status: 'planning', assignedTo: 'plan-1' });
    store.updateTask(reviewTask.id, { status: 'review', assignedTo: 'rev-1' });
    store.updateTask(pausedTask.id, { status: 'paused', assignedTo: 'imp-1' });
    store.updateTask(doneTask.id, { status: 'awaiting_human_review', assignedTo: 'rev-2', workspacePath: '/tmp/work' });
    store.updateTask(legacyBlockedTask.id, {
      status: 'blocked',
      blockedReason: 'Invalid repository path: https://github.com/stilero/bankan.git',
      workspacePath: null,
      assignedTo: 'plan-2',
    });

    store.restartRecovery();

    expect(store.getTask(planningTask.id).status).toBe('backlog');
    expect(store.getTask(reviewTask.id).status).toBe('review');
    expect(store.getTask(reviewTask.id).assignedTo).toBeNull();
    expect(store.getTask(pausedTask.id).status).toBe('paused');
    expect(store.getTask(pausedTask.id).assignedTo).toBeNull();
    expect(store.getTask(doneTask.id).status).toBe('done');
    expect(store.getTask(doneTask.id).workspacePath).toBeNull();
    expect(store.getTask(legacyBlockedTask.id).status).toBe('backlog');
    expect(store.getTask(legacyBlockedTask.id).blockedReason).toBeNull();
  });

  test('corrupt task files fall back to an empty store', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');
    const { writeFileSync } = await import('node:fs');

    writeFileSync(configModule.getRuntimeStatePaths().tasksFile, '{not-json');

    const storeModule = await harness.importModule('./src/store.js');
    expect(storeModule.default.getAllTasks()).toEqual([]);
  });

  test('normalizes legacy task records on load and handles null update helpers', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');
    const { writeFileSync } = await import('node:fs');

    writeFileSync(configModule.getRuntimeStatePaths().tasksFile, JSON.stringify([
      {
        id: 'T-LEGACY',
        title: 'Legacy',
        status: 'awaiting_human_review',
        repoPath: '/repo',
        reviewCycleCount: -2,
        maxReviewCycles: -1,
        totalTokens: -10,
        startedAt: 42,
        completedAt: 24,
        sessionHistory: null,
        assignedTo: 'rev-1',
        workspacePath: '/tmp/work',
        log: [],
      },
    ]));

    const storeModule = await harness.importModule('./src/store.js');
    const store = storeModule.default;
    const task = store.getTask('T-LEGACY');

    expect(task.status).toBe('done');
    expect(task.assignedTo).toBeNull();
    expect(task.workspacePath).toBeNull();
    expect(task.reviewCycleCount).toBe(0);
    expect(task.maxReviewCycles).toBe(3);
    expect(task.totalTokens).toBe(0);
    expect(task.startedAt).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.sessionHistory).toEqual([]);

    expect(store.updateTask('missing', { status: 'done' })).toBeNull();
    expect(store.appendLog('missing', 'nope')).toBeNull();
    expect(store.appendSession('missing', { id: 's-1' })).toBeNull();
    expect(store.appendSession('T-LEGACY', null)).toBeNull();
    expect(store.updateTaskTokens('missing', 10)).toBeNull();
  });

  test('restartRecovery handles planner-path blockers and invalid counters', async () => {
    harness = createRuntimeHarness();
    const storeModule = await harness.importModule('./src/store.js');
    const store = storeModule.default;

    const task = store.addTask({
      title: 'Planner dir blocker',
      repoPath: 'git@github.com:stilero/bankan.git',
    });

    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: 'Invalid planner working directory: git@github.com:stilero/bankan.git',
      workspacePath: null,
      reviewCycleCount: -1,
      maxReviewCycles: -1,
      totalTokens: -1,
      lastActiveStage: null,
    });

    store.restartRecovery();

    const recovered = store.getTask(task.id);
    expect(recovered.status).toBe('backlog');
    expect(recovered.previousStatus).toBeNull();
    expect(recovered.lastActiveStage).toBe('backlog');
    expect(recovered.reviewCycleCount).toBe(0);
    expect(recovered.maxReviewCycles).toBe(3);
    expect(recovered.totalTokens).toBe(0);
  });
});
