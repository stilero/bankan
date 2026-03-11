import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import bus from './events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', '.data');
const TASKS_FILE = join(DATA_DIR, 'tasks.json');
const PLANS_DIR = join(DATA_DIR, 'plans');

function statusToStage(status) {
  if (['workspace_setup', 'planning', 'awaiting_approval'].includes(status)) return 'planning';
  if (['queued', 'implementing'].includes(status)) return 'implementation';
  if (status === 'review') return 'review';
  if (status === 'done') return 'done';
  if (['backlog', 'aborted'].includes(status)) return 'backlog';
  return null;
}

function isLikelyRemoteRepoRef(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) || /^git@[^:]+:.+/i.test(trimmed) || /^ssh:\/\//i.test(trimmed);
}

function isLegacyPlannerPathBlocker(task) {
  if (task.status !== 'blocked' || task.workspacePath) return false;
  if (typeof task.blockedReason !== 'string' || !task.blockedReason.trim()) return false;

  const reason = task.blockedReason.trim();

  if (reason.startsWith('Invalid repository path:')) {
    return isLikelyRemoteRepoRef(task.repoPath);
  }

  if (reason.startsWith('Invalid planner working directory:')) {
    const blockedPath = reason.slice('Invalid planner working directory:'.length).trim();
    return blockedPath === task.repoPath && isLikelyRemoteRepoRef(task.repoPath);
  }

  return false;
}

class TaskStore {
  constructor() {
    this.tasks = [];
    this._ensureDirs();
    this._load();
  }

  _ensureDirs() {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(PLANS_DIR, { recursive: true });
  }

  _load() {
    try {
      if (existsSync(TASKS_FILE)) {
        this.tasks = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
        this.tasks = this.tasks.map(task => {
          const normalized = {
            reviewCycleCount: 0,
            lastActiveStage: statusToStage(task.status) || 'backlog',
            previousStatus: null,
            ...task,
          };

          if (normalized.status === 'awaiting_human_review') {
            normalized.status = 'done';
          }
          if (normalized.status === 'done') {
            normalized.assignedTo = null;
            normalized.workspacePath = null;
          }
          if (typeof normalized.reviewCycleCount !== 'number' || normalized.reviewCycleCount < 0) {
            normalized.reviewCycleCount = 0;
          }
          if (!normalized.lastActiveStage) {
            normalized.lastActiveStage = statusToStage(normalized.status) || 'backlog';
          }
          if (normalized.previousStatus === undefined) {
            normalized.previousStatus = null;
          }

          return normalized;
        });
      }
    } catch {
      this.tasks = [];
    }
  }

  _save() {
    writeFileSync(TASKS_FILE, JSON.stringify(this.tasks, null, 2));
  }

  addTask({ title, priority = 'medium', description = '', repoPath = '' }) {
    const task = {
      id: 'T-' + uuidv4().slice(0, 6).toUpperCase(),
      title,
      priority,
      description,
      repoPath,
      status: 'backlog',
      branch: null,
      plan: null,
      review: null,
      prUrl: null,
      prNumber: null,
      assignedTo: null,
      reviewFeedback: null,
      planFeedback: null,
      blockedReason: null,
      workspacePath: null,
      reviewCycleCount: 0,
      lastActiveStage: 'backlog',
      previousStatus: null,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      log: [{ ts: new Date().toISOString(), message: 'Task created' }],
    };
    this.tasks.push(task);
    this._save();
    bus.emit('task:added', task);
    bus.emit('tasks:changed', this.tasks);
    return task;
  }

  getTask(id) {
    return this.tasks.find(t => t.id === id) || null;
  }

  getAllTasks() {
    return this.tasks;
  }

  updateTask(id, updates) {
    const task = this.getTask(id);
    if (!task) return null;
    const nextStatus = updates.status;
    if (nextStatus) {
      const nextStage = statusToStage(nextStatus);
      if (nextStage) {
        updates.lastActiveStage = nextStage;
      }
    }
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    if (nextStatus) {
      task.log.push({ ts: new Date().toISOString(), message: `Status changed to ${updates.status}` });
    }
    this._save();
    bus.emit('task:updated', task);
    bus.emit('tasks:changed', this.tasks);
    return task;
  }

  savePlan(taskId, planText) {
    writeFileSync(join(PLANS_DIR, `${taskId}.md`), planText);
  }

  removePlan(taskId) {
    rmSync(join(PLANS_DIR, `${taskId}.md`), { force: true });
  }

  appendLog(id, message) {
    const task = this.getTask(id);
    if (!task) return null;
    task.log.push({ ts: new Date().toISOString(), message });
    task.updatedAt = new Date().toISOString();
    this._save();
    bus.emit('task:updated', task);
    bus.emit('tasks:changed', this.tasks);
    return task;
  }

  restartRecovery() {
    const recoveryMap = {
      planning: 'backlog',
      workspace_setup: 'backlog',
      queued: 'queued',
      implementing: 'queued',
      review: 'review',
    };
    let changed = false;
    for (const task of this.tasks) {
      if (!task.lastActiveStage) {
        task.lastActiveStage = statusToStage(task.status) || 'backlog';
        changed = true;
      }
      if (typeof task.reviewCycleCount !== 'number' || task.reviewCycleCount < 0) {
        task.reviewCycleCount = 0;
        changed = true;
      }
      if (task.status === 'awaiting_human_review') {
        task.status = 'done';
        task.assignedTo = null;
        task.workspacePath = null;
        task.lastActiveStage = 'done';
        task.updatedAt = new Date().toISOString();
        task.log.push({ ts: new Date().toISOString(), message: 'Restart recovery: normalized awaiting_human_review to done' });
        changed = true;
        continue;
      }
      // Leave paused tasks as paused but clear assignedTo
      if (task.status === 'paused') {
        if (task.assignedTo) {
          task.assignedTo = null;
          task.updatedAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }
      const resetTo = recoveryMap[task.status];
      if (resetTo) {
        task.status = resetTo;
        task.assignedTo = null;
        task.lastActiveStage = statusToStage(resetTo) || task.lastActiveStage;
        task.updatedAt = new Date().toISOString();
        task.log.push({ ts: new Date().toISOString(), message: `Restart recovery: reset to ${resetTo}` });
        changed = true;
      }

      if (isLegacyPlannerPathBlocker(task)) {
        task.status = 'backlog';
        task.assignedTo = null;
        task.blockedReason = null;
        task.lastActiveStage = 'backlog';
        task.previousStatus = null;
        task.updatedAt = new Date().toISOString();
        task.log.push({
          ts: new Date().toISOString(),
          message: 'Restart recovery: reset legacy planner path blocker to backlog',
        });
        changed = true;
      }
    }
    if (changed) {
      this._save();
      bus.emit('tasks:changed', this.tasks);
    }
  }
}

const store = new TaskStore();
export default store;
