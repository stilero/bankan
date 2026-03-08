import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import bus from './events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', '.data');
const TASKS_FILE = join(DATA_DIR, 'tasks.json');
const PLANS_DIR = join(DATA_DIR, 'plans');

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
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    if (updates.status) {
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

  restartRecovery() {
    const recoveryMap = {
      planning: 'backlog',
      implementing: 'awaiting_approval',
      review: 'awaiting_approval',
      queued: 'awaiting_approval',
      workspace_setup: 'awaiting_approval',
    };
    let changed = false;
    for (const task of this.tasks) {
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
        task.updatedAt = new Date().toISOString();
        task.log.push({ ts: new Date().toISOString(), message: `Restart recovery: reset to ${resetTo}` });
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
