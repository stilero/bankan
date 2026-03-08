import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import config, { refreshRepos, getRepos, loadSettings } from './config.js';
import store from './store.js';
import agentManager from './agents.js';
import bus from './events.js';

const POLL_INTERVAL = 4000;
const SIGNAL_CHECK_INTERVAL = 2500;
const PLANNER_TIMEOUT = 5 * 60 * 1000;
const IMPLEMENTOR_TIMEOUT = 60 * 60 * 1000;
const REVIEWER_TIMEOUT = 30 * 60 * 1000;
const STUCK_TIMEOUT = 10 * 60 * 1000;

let pollTimer = null;
let signalTimer = null;

function escapePrompt(text) {
  return text.replace(/'/g, "'\\''");
}

function buildPlannerPrompt(task) {
  let prompt = `You are a senior software architect. A task has been assigned to you.
Repository: ${task.repoPath}

TASK ID: ${task.id}
TITLE: ${task.title}
DESCRIPTION: ${task.description || 'No additional description provided.'}
PRIORITY: ${task.priority}`;

  if (task.planFeedback) {
    prompt += `\n\nPrevious plan was rejected. Feedback: ${task.planFeedback}\nPlease revise accordingly.`;
  }

  prompt += `

Produce a detailed step-by-step implementation plan.
Output ONLY in this exact format, with no text before or after the delimiters:

=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (feature/${task.id.toLowerCase()}-short-descriptive-slug)
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
2. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`;

  return prompt;
}

function buildImplementorPrompt(task, workspacePath) {
  const repoDir = workspacePath || task.repoPath;
  let prompt = `You are an expert software engineer implementing a feature on a real codebase.

TASK: ${task.title}
TASK ID: ${task.id}
BRANCH: ${task.branch}
REPO: ${repoDir}`;

  if (task.reviewFeedback) {
    prompt += `\n\nPREVIOUS REVIEW — ISSUES TO FIX:\n${task.reviewFeedback}\n`;
  }

  prompt += `

IMPLEMENTATION PLAN:
${task.plan}

Instructions:
- You are already on branch ${task.branch} in ${repoDir}
- Follow the plan step by step
- Commit after each logical unit of work with descriptive commit messages
- Run existing tests after implementation to verify nothing broke
- When fully complete, output this exact string on its own line:
  === IMPLEMENTATION COMPLETE ===
- If you encounter a blocker you cannot resolve, output:
  === BLOCKED: {reason} ===

Begin implementation now.`;

  return prompt;
}

function buildReviewerPrompt(task) {
  return `You are a senior code reviewer. A feature branch is ready for review.

TASK: ${task.title}
BRANCH: ${task.branch}
REPO: ${task.repoPath}

ORIGINAL PLAN:
${task.plan}

Instructions:
1. Run: git diff main...${task.branch}
2. Review for: correctness, security vulnerabilities, code quality, test coverage, edge cases
3. Classify each issue as CRITICAL (blocks merge), MINOR (should fix), or STYLE (optional)
4. VERDICT must be PASS if there are zero CRITICAL issues

Output ONLY in this exact format:

=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- (issue description, or 'none')
SUMMARY: (2-3 sentences summarising the review)
=== REVIEW END ===`;
}

// --- Workspace Helpers ---

async function setupWorkspace(task) {
  const settings = loadSettings();
  const reposDir = settings.reposDir;
  const workspaceRoot = join(reposDir, 'workspaces', task.id);

  // Crash recovery: remove partial clone if exists
  if (existsSync(workspaceRoot)) {
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  mkdirSync(workspaceRoot, { recursive: true });

  // Clone from the original repo (local clone, no SSH needed)
  await simpleGit().clone(task.repoPath, workspaceRoot);

  const wsGit = simpleGit(workspaceRoot);
  await wsGit.addConfig('user.email', 'ai-factory@local');
  await wsGit.addConfig('user.name', 'AI Factory');
  await wsGit.pull('origin', 'main');

  // Delete remote branch if it already exists (handles re-runs after abort)
  try { await wsGit.push('origin', `:${task.branch}`); } catch { /* ignore */ }

  await wsGit.checkoutLocalBranch(task.branch);

  return workspaceRoot;
}

async function cleanupWorkspace(task) {
  if (task.workspacePath && existsSync(task.workspacePath)) {
    await rm(task.workspacePath, { recursive: true, force: true });
    store.updateTask(task.id, { workspacePath: null });
  }
}

// --- Stage Transitions ---

function startPlanning(task) {
  const planner = agentManager.getAvailablePlanner();
  if (!planner) return false;

  store.updateTask(task.id, { status: 'planning', assignedTo: planner.id });
  planner.currentTask = task.id;
  planner.taskLabel = `Planning: ${task.title}`;
  planner.status = 'active';

  const prompt = buildPlannerPrompt(task);
  const cmd = `claude --print '${escapePrompt(prompt)}'`;
  const settings = loadSettings();
  const plannerCwd = settings.reposDir;
  const ok = planner.spawn(plannerCwd, cmd);
  if (!ok) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Invalid planner working directory: ${plannerCwd}`,
      assignedTo: null,
    });
    planner.currentTask = null;
    planner.taskLabel = '';
    planner.status = 'idle';
    bus.emit('agent:updated', planner.getStatus());
    return false;
  }
  bus.emit('agent:updated', planner.getStatus());
  return true;
}

function onPlanComplete(agentId, taskId) {
  const planner = agentManager.get(agentId);
  if (!planner) return;
  const bufStr = planner.getBufferString(100);

  // Extract plan text
  const startIdx = bufStr.indexOf('=== PLAN START ===');
  const endIdx = bufStr.indexOf('=== PLAN END ===');
  if (startIdx === -1 || endIdx === -1) return;

  const planText = bufStr.slice(startIdx, endIdx + '=== PLAN END ==='.length);

  // Parse branch name
  const branchMatch = planText.match(/BRANCH:\s*(.+)/);
  const branch = branchMatch ? branchMatch[1].trim() : `feature/${taskId.toLowerCase()}-auto`;

  // Save plan
  store.savePlan(taskId, planText);
  store.updateTask(taskId, {
    status: 'awaiting_approval',
    plan: planText,
    branch,
    assignedTo: null,
  });

  planner.kill();
  if (planner.draining) agentManager.removeAgent(agentId);
  bus.emit('plan:ready', { taskId, plan: planText });
}

function approvePlan(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status !== 'awaiting_approval') return;
  startImplementation(task);
}

function rejectPlan(taskId, feedback) {
  const task = store.getTask(taskId);
  if (!task || task.status !== 'awaiting_approval') return;

  store.updateTask(taskId, {
    status: 'backlog',
    planFeedback: feedback,
    assignedTo: null,
  });
}

async function startImplementation(task) {
  const agent = agentManager.getAvailableImplementor();
  if (!agent) {
    store.updateTask(task.id, { status: 'queued' });
    return;
  }

  store.updateTask(task.id, { status: 'workspace_setup', assignedTo: agent.id });
  agent.currentTask = task.id;
  agent.taskLabel = `Setting up: ${task.title}`;
  agent.status = 'active';
  bus.emit('agent:updated', agent.getStatus());

  let workspacePath;
  try {
    workspacePath = await setupWorkspace(task);
  } catch (err) {
    console.error(`Workspace setup failed for ${task.id}:`, err.message);
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Workspace setup failed: ${err.message}`,
      assignedTo: null,
    });
    agent.currentTask = null;
    agent.taskLabel = '';
    agent.status = 'idle';
    bus.emit('agent:updated', agent.getStatus());
    return;
  }

  store.updateTask(task.id, { status: 'implementing', workspacePath });

  const cliTool = agent.cli;
  const prompt = buildImplementorPrompt(task, workspacePath);

  let cmd;
  if (cliTool === 'codex') {
    cmd = `codex --quiet '${escapePrompt(prompt)}'`;
  } else {
    cmd = `claude --dangerously-skip-permissions '${escapePrompt(prompt)}'`;
  }

  const ok = agent.spawn(workspacePath, cmd);
  if (!ok) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Invalid workspace path: ${workspacePath}`,
      assignedTo: null,
    });
    agent.currentTask = null;
    agent.taskLabel = '';
    agent.status = 'idle';
    bus.emit('agent:updated', agent.getStatus());
    return;
  }
  bus.emit('agent:updated', agent.getStatus());
}

async function onImplementationComplete(agentId) {
  const agent = agentManager.get(agentId);
  if (!agent) return;
  const taskId = agent.currentTask;
  if (!taskId) return;

  const task = store.getTask(taskId);

  // Push branch from workspace
  if (task?.workspacePath) {
    try {
      const git = simpleGit(task.workspacePath);
      await git.push('origin', task.branch);
    } catch (err) {
      console.error(`Git push failed:`, err.message);
      store.updateTask(taskId, {
        status: 'blocked',
        blockedReason: `Branch push failed: ${err.message}`,
        assignedTo: null,
      });
      agent.kill();
      if (agent.draining) agentManager.removeAgent(agentId);
      return;
    }
  }

  store.updateTask(taskId, { status: 'review', assignedTo: null });
  agent.kill();
  if (agent.draining) agentManager.removeAgent(agentId);

  const taskForReview = store.getTask(taskId);
  startReview(taskForReview);
}

function startReview(task) {
  const reviewer = agentManager.getAvailableReviewer();
  if (!reviewer) return;

  store.updateTask(task.id, { assignedTo: reviewer.id });
  reviewer.currentTask = task.id;
  reviewer.taskLabel = `Reviewing: ${task.title}`;
  reviewer.status = 'active';

  const prompt = buildReviewerPrompt(task);
  const cmd = `claude --print '${escapePrompt(prompt)}'`;
  const ok = reviewer.spawn(task.workspacePath, cmd);
  if (!ok) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Invalid workspace path for review: ${task.workspacePath}`,
      assignedTo: null,
    });
    reviewer.currentTask = null;
    reviewer.taskLabel = '';
    reviewer.status = 'idle';
    bus.emit('agent:updated', reviewer.getStatus());
    return;
  }
  bus.emit('agent:updated', reviewer.getStatus());
}

async function onReviewComplete(agentId, taskId) {
  const reviewer = agentManager.get(agentId);
  if (!reviewer) return;
  const bufStr = reviewer.getBufferString(100);

  const startIdx = bufStr.indexOf('=== REVIEW START ===');
  const endIdx = bufStr.indexOf('=== REVIEW END ===');
  if (startIdx === -1 || endIdx === -1) return;

  const reviewText = bufStr.slice(startIdx, endIdx + '=== REVIEW END ==='.length);
  const verdictMatch = reviewText.match(/VERDICT:\s*(PASS|FAIL)/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FAIL';

  store.updateTask(taskId, { review: reviewText });
  reviewer.kill();
  if (reviewer.draining) agentManager.removeAgent(agentId);

  if (verdict === 'PASS') {
    bus.emit('review:passed', { taskId });
    await createPR(taskId);
  } else {
    // Extract critical issues
    const issuesMatch = reviewText.match(/CRITICAL_ISSUES:\s*([\s\S]*?)(?=MINOR_ISSUES:|SUMMARY:|=== REVIEW END ===)/i);
    const criticalIssues = issuesMatch ? issuesMatch[1].trim() : 'Critical issues found';

    store.updateTask(taskId, {
      status: 'implementing',
      reviewFeedback: criticalIssues,
      assignedTo: null,
    });
    bus.emit('review:failed', { taskId, issues: criticalIssues });

    // Re-assign to implementor
    const task = store.getTask(taskId);
    startImplementation(task);
  }
}

async function createPR(taskId) {
  const task = store.getTask(taskId);
  if (!config.GITHUB_TOKEN || !config.GITHUB_REPO) {
    store.updateTask(taskId, { status: 'awaiting_human_review' });
    console.log(`GitHub not configured — skipping PR creation for ${taskId}`);
    // Cleanup workspace since task is terminal
    const updatedTask = store.getTask(taskId);
    cleanupWorkspace(updatedTask).catch(err => console.error(`Workspace cleanup error:`, err.message));
    return;
  }

  try {
    const [owner, repo] = config.GITHUB_REPO.split('/');
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({
        title: `[${task.id}] ${task.title}`,
        head: task.branch,
        base: 'main',
        body: `## Plan\n\n${task.plan}\n\n## Review\n\n${task.review || 'N/A'}`,
      }),
    });

    if (response.ok) {
      const pr = await response.json();
      store.updateTask(taskId, {
        status: 'awaiting_human_review',
        prUrl: pr.html_url,
        prNumber: pr.number,
      });
      bus.emit('pr:created', { taskId, prUrl: pr.html_url });
    } else {
      console.error(`PR creation failed:`, await response.text());
      store.updateTask(taskId, { status: 'awaiting_human_review' });
    }
  } catch (err) {
    console.error(`PR creation error:`, err.message);
    store.updateTask(taskId, { status: 'awaiting_human_review' });
  }

  // Cleanup workspace since task is now terminal
  const finalTask = store.getTask(taskId);
  cleanupWorkspace(finalTask).catch(err => console.error(`Workspace cleanup error:`, err.message));
}

async function abortTask(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status === 'done') return;

  if (task.assignedTo) {
    const agent = agentManager.get(task.assignedTo);
    if (agent) agent.kill();
  }

  await cleanupWorkspace(task);

  store.updateTask(taskId, {
    status: 'backlog',
    assignedTo: null,
    workspacePath: null,
    reviewFeedback: null,
  });

  bus.emit('task:aborted', { taskId });
}

// --- Signal Detection ---

function checkSignals() {
  // Check planners
  for (const agent of agentManager.getAgentsByRole('plan')) {
    if (agent.status === 'active' && agent.currentTask) {
      const buf = agent.getBufferString(50);
      if (buf.includes('=== PLAN END ===')) {
        onPlanComplete(agent.id, agent.currentTask);
      } else {
        // Live plan streaming
        if (!buf.includes('=== PLAN END ===') && buf.includes('=== PLAN START ===')) {
          const partial = buf.slice(buf.indexOf('=== PLAN START ==='));
          bus.emit('plan:partial', { taskId: agent.currentTask, plan: partial });
        }
        if (agent.startedAt && Date.now() - agent.startedAt > PLANNER_TIMEOUT) {
          markBlocked(agent, 'Planner timed out');
        }
      }
    }
  }

  // Check implementors
  for (const agent of agentManager.getAgentsByRole('imp')) {
    if (agent.status === 'active' && agent.currentTask) {
      const buf = agent.getBufferString(50);
      if (buf.includes('=== IMPLEMENTATION COMPLETE ===')) {
        onImplementationComplete(agent.id);
      } else {
        const blockedMatch = buf.match(/=== BLOCKED: (.+?) ===/);
        if (blockedMatch) {
          const reason = blockedMatch[1];
          store.updateTask(agent.currentTask, {
            status: 'blocked',
            blockedReason: reason,
            assignedTo: null,
          });
          agent.kill();
          if (agent.draining) agentManager.removeAgent(agent.id);
          else {
            agent.status = 'blocked';
            bus.emit('task:blocked', { taskId: agent.currentTask, reason });
            bus.emit('agent:updated', agent.getStatus());
          }
        } else if (agent.startedAt && Date.now() - agent.startedAt > IMPLEMENTOR_TIMEOUT) {
          markBlocked(agent, 'Implementor timed out');
        }
      }
    }
  }

  // Check reviewers
  for (const agent of agentManager.getAgentsByRole('rev')) {
    if (agent.status === 'active' && agent.currentTask) {
      const buf = agent.getBufferString(50);
      if (buf.includes('=== REVIEW END ===')) {
        onReviewComplete(agent.id, agent.currentTask);
      } else if (agent.startedAt && Date.now() - agent.startedAt > REVIEWER_TIMEOUT) {
        markBlocked(agent, 'Reviewer timed out');
      }
    }
  }
}

function markBlocked(agent, reason) {
  if (agent.currentTask) {
    store.updateTask(agent.currentTask, {
      status: 'blocked',
      blockedReason: reason,
      assignedTo: null,
    });
    bus.emit('task:blocked', { taskId: agent.currentTask, reason });
  }
  agent.kill();
  if (agent.draining) {
    agentManager.removeAgent(agent.id);
  } else {
    agent.status = 'blocked';
    bus.emit('agent:updated', agent.getStatus());
  }
}

// --- Poll Loop ---

function pollLoop() {
  const tasks = store.getAllTasks();

  // Assign backlog → available planners (loop to fill multiple planners)
  const backlogTasks = tasks
    .filter(t => t.status === 'backlog')
    .sort((a, b) => {
      const prio = { critical: 0, high: 1, medium: 2, low: 3 };
      return (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2);
    });
  for (const backlogTask of backlogTasks) {
    if (!agentManager.getAvailablePlanner()) {
      // Try to scale up if there's demand
      agentManager.scaleUp('planners');
      if (!agentManager.getAvailablePlanner()) break;
    }
    startPlanning(backlogTask);
  }

  // Assign queued → implementor
  const queuedTasks = tasks.filter(t => t.status === 'queued');
  for (const task of queuedTasks) {
    if (!agentManager.getAvailableImplementor()) {
      agentManager.scaleUp('implementors');
    }
    const imp = agentManager.getAvailableImplementor();
    if (imp) {
      startImplementation(task);
    } else {
      break;
    }
  }

  // Assign review tasks with no assignee → available reviewers
  const reviewTasks = tasks.filter(t => t.status === 'review' && !t.assignedTo);
  for (const task of reviewTasks) {
    if (!agentManager.getAvailableReviewer()) {
      agentManager.scaleUp('reviewers');
      if (!agentManager.getAvailableReviewer()) break;
    }
    startReview(task);
  }

  // Detect orphaned tasks: agents that are idle with no process but still have currentTask
  for (const [, agent] of agentManager.agents) {
    if (agent.id === 'orch') continue;
    if (agent.status === 'idle' && !agent.process && agent.currentTask) {
      const taskId = agent.currentTask;
      agent.currentTask = null;
      agent.taskLabel = '';
      bus.emit('agent:updated', agent.getStatus());
      const task = store.getTask(taskId);
      if (task && !['blocked', 'done', 'backlog', 'paused', 'workspace_setup'].includes(task.status)) {
        const buf = agent.getBufferString(100);
        if (buf.includes('=== PLAN END ===')) {
          onPlanComplete(agent.id, taskId);
        } else if (buf.includes('=== IMPLEMENTATION COMPLETE ===')) {
          onImplementationComplete(agent.id);
        } else if (buf.includes('=== REVIEW END ===')) {
          onReviewComplete(agent.id, taskId);
        } else {
          store.updateTask(taskId, {
            status: 'blocked',
            blockedReason: 'Agent process exited unexpectedly',
            assignedTo: null,
          });
        }
      }
    }
  }

  // Check stuck agents
  for (const [, agent] of agentManager.agents) {
    if (agent.id === 'orch') continue;
    if (agent.status === 'active' && agent.lastOutputAt) {
      if (Date.now() - agent.lastOutputAt > STUCK_TIMEOUT) {
        markBlocked(agent, 'No output for 10 minutes');
      }
    }
  }

  // Broadcast agent status
  bus.emit('agents:updated', agentManager.getAllStatus());
}

// --- Event Handlers ---

bus.on('plan:approved', (taskId) => approvePlan(taskId));
bus.on('plan:rejected', ({ taskId, feedback }) => rejectPlan(taskId, feedback));

bus.on('agent:unexpected-exit', ({ agentId, taskId }) => {
  const agent = agentManager.get(agentId);
  if (agent) {
    const buf = agent.getBufferString(100);
    // Check if agent actually completed — process may have exited before checkSignals ran
    if (buf.includes('=== PLAN END ===')) {
      onPlanComplete(agentId, taskId);
      return;
    }
    if (buf.includes('=== IMPLEMENTATION COMPLETE ===')) {
      onImplementationComplete(agentId);
      return;
    }
    if (buf.includes('=== REVIEW END ===')) {
      onReviewComplete(agentId, taskId);
      return;
    }
    console.error(`[unexpected-exit] agent=${agentId} task=${taskId} last output:\n${buf.slice(-500)}`);
    agent.currentTask = null;
    agent.taskLabel = '';
    agent.status = 'idle';
    bus.emit('agent:updated', agent.getStatus());
  }
  const task = store.getTask(taskId);
  if (task && !['blocked', 'done', 'backlog', 'paused'].includes(task.status)) {
    store.updateTask(taskId, {
      status: 'blocked',
      blockedReason: 'Agent process exited unexpectedly',
      assignedTo: null,
    });
  }
});

bus.on('settings:changed', (settings) => {
  agentManager.reconfigure(settings);
  bus.emit('agents:updated', agentManager.getAllStatus());

  // Re-discover repos if reposDir changed
  if (settings.reposDir) {
    refreshRepos(settings.reposDir);
    bus.emit('repos:updated', getRepos());
  }
});

// --- Public API ---

const orchestrator = {
  start() {
    console.log('Orchestrator started');
    pollTimer = setInterval(pollLoop, POLL_INTERVAL);
    signalTimer = setInterval(checkSignals, SIGNAL_CHECK_INTERVAL);
    // Run once immediately
    pollLoop();
  },
  stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (signalTimer) clearInterval(signalTimer);
  },
  abortTask,
};

export default orchestrator;
