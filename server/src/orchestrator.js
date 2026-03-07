import { simpleGit } from 'simple-git';
import config from './config.js';
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
Repository: ${config.REPO_PATH}

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

function buildImplementorPrompt(task) {
  let prompt = `You are an expert software engineer implementing a feature on a real codebase.

TASK: ${task.title}
TASK ID: ${task.id}
BRANCH: ${task.branch}
REPO: ${config.REPO_PATH}`;

  if (task.reviewFeedback) {
    prompt += `\n\nPREVIOUS REVIEW — ISSUES TO FIX:\n${task.reviewFeedback}\n`;
  }

  prompt += `

IMPLEMENTATION PLAN:
${task.plan}

Instructions:
- You are already on branch ${task.branch}
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
REPO: ${config.REPO_PATH}

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

// --- Stage Transitions ---

function startPlanning(task) {
  const planner = agentManager.get('plan');
  if (planner.status !== 'idle') return false;

  store.updateTask(task.id, { status: 'planning', assignedTo: 'plan' });
  planner.currentTask = task.id;
  planner.taskLabel = `Planning: ${task.title}`;
  planner.status = 'active';

  const prompt = buildPlannerPrompt(task);
  const cmd = `claude --print '${escapePrompt(prompt)}'`;
  planner.spawn(config.REPO_PATH, cmd);
  bus.emit('agent:updated', planner.getStatus());
  return true;
}

function onPlanComplete(taskId) {
  const planner = agentManager.get('plan');
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

  // Checkout branch
  if (config.REPO_PATH) {
    try {
      const git = simpleGit(config.REPO_PATH);
      const branches = await git.branchLocal();
      if (branches.all.includes(task.branch)) {
        await git.checkout(task.branch);
      } else {
        await git.checkoutLocalBranch(task.branch);
      }
    } catch (err) {
      console.error(`Git checkout failed for ${task.branch}:`, err.message);
    }
  }

  store.updateTask(task.id, { status: 'implementing', assignedTo: agent.id });
  agent.currentTask = task.id;
  agent.taskLabel = `Implementing: ${task.title}`;

  const cliTool = agent.id === 'imp1' ? config.IMPLEMENTOR_1_CLI : config.IMPLEMENTOR_2_CLI;
  const prompt = buildImplementorPrompt(task);

  let cmd;
  if (cliTool === 'codex') {
    cmd = `codex --quiet '${escapePrompt(prompt)}'`;
  } else {
    cmd = `claude --dangerously-skip-permissions '${escapePrompt(prompt)}'`;
  }

  agent.spawn(config.REPO_PATH, cmd);
  bus.emit('agent:updated', agent.getStatus());
}

async function onImplementationComplete(agentId) {
  const agent = agentManager.get(agentId);
  const taskId = agent.currentTask;
  if (!taskId) return;

  // Push branch
  if (config.REPO_PATH) {
    try {
      const task = store.getTask(taskId);
      const git = simpleGit(config.REPO_PATH);
      await git.push('origin', task.branch);
    } catch (err) {
      console.error(`Git push failed:`, err.message);
    }
  }

  store.updateTask(taskId, { status: 'review', assignedTo: 'rev' });
  agent.kill();

  const task = store.getTask(taskId);
  startReview(task);
}

function startReview(task) {
  const reviewer = agentManager.get('rev');
  if (reviewer.status !== 'idle') return;

  reviewer.currentTask = task.id;
  reviewer.taskLabel = `Reviewing: ${task.title}`;
  reviewer.status = 'active';

  const prompt = buildReviewerPrompt(task);
  const cmd = `claude --print '${escapePrompt(prompt)}'`;
  reviewer.spawn(config.REPO_PATH, cmd);
  bus.emit('agent:updated', reviewer.getStatus());
}

async function onReviewComplete(taskId) {
  const reviewer = agentManager.get('rev');
  const bufStr = reviewer.getBufferString(100);

  const startIdx = bufStr.indexOf('=== REVIEW START ===');
  const endIdx = bufStr.indexOf('=== REVIEW END ===');
  if (startIdx === -1 || endIdx === -1) return;

  const reviewText = bufStr.slice(startIdx, endIdx + '=== REVIEW END ==='.length);
  const verdictMatch = reviewText.match(/VERDICT:\s*(PASS|FAIL)/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FAIL';

  store.updateTask(taskId, { review: reviewText });
  reviewer.kill();

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
}

// --- Signal Detection ---

function checkSignals() {
  // Check planner
  const planner = agentManager.get('plan');
  if (planner.status === 'active' && planner.currentTask) {
    const buf = planner.getBufferString(50);
    if (buf.includes('=== PLAN END ===')) {
      onPlanComplete(planner.currentTask);
    } else if (planner.startedAt && Date.now() - planner.startedAt > PLANNER_TIMEOUT) {
      markBlocked(planner, 'Planner timed out');
    }
  }

  // Check implementors
  for (const id of ['imp1', 'imp2']) {
    const agent = agentManager.get(id);
    if (agent.status === 'active' && agent.currentTask) {
      const buf = agent.getBufferString(50);
      if (buf.includes('=== IMPLEMENTATION COMPLETE ===')) {
        onImplementationComplete(id);
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
          agent.status = 'blocked';
          bus.emit('task:blocked', { taskId: agent.currentTask, reason });
          bus.emit('agent:updated', agent.getStatus());
        } else if (agent.startedAt && Date.now() - agent.startedAt > IMPLEMENTOR_TIMEOUT) {
          markBlocked(agent, 'Implementor timed out');
        }
      }
    }
  }

  // Check reviewer
  const reviewer = agentManager.get('rev');
  if (reviewer.status === 'active' && reviewer.currentTask) {
    const buf = reviewer.getBufferString(50);
    if (buf.includes('=== REVIEW END ===')) {
      onReviewComplete(reviewer.currentTask);
    } else if (reviewer.startedAt && Date.now() - reviewer.startedAt > REVIEWER_TIMEOUT) {
      markBlocked(reviewer, 'Reviewer timed out');
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
  agent.status = 'blocked';
  bus.emit('agent:updated', agent.getStatus());
}

// --- Poll Loop ---

function pollLoop() {
  const tasks = store.getAllTasks();

  // Assign backlog → planner
  const planner = agentManager.get('plan');
  if (planner.status === 'idle') {
    const backlogTask = tasks
      .filter(t => t.status === 'backlog')
      .sort((a, b) => {
        const prio = { critical: 0, high: 1, medium: 2, low: 3 };
        return (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2);
      })[0];
    if (backlogTask) {
      startPlanning(backlogTask);
    }
  }

  // Assign queued → implementor
  const queuedTasks = tasks.filter(t => t.status === 'queued');
  for (const task of queuedTasks) {
    const imp = agentManager.getAvailableImplementor();
    if (imp) {
      startImplementation(task);
    } else {
      break;
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
};

export default orchestrator;
