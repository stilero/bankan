import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { simpleGit } from 'simple-git';
import config, { loadSettings, getWorkspacesDir } from './config.js';
import store from './store.js';
import agentManager from './agents.js';
import bus from './events.js';
import { parseReviewResult, reviewShouldPass } from './workflow.js';

const POLL_INTERVAL = 4000;
const SIGNAL_CHECK_INTERVAL = 2500;
const PLANNER_TIMEOUT = 5 * 60 * 1000;
const IMPLEMENTOR_TIMEOUT = 60 * 60 * 1000;
const REVIEWER_TIMEOUT = 30 * 60 * 1000;
const STUCK_TIMEOUT = 10 * 60 * 1000;
const MAX_REVIEW_CYCLES = 3;

let pollTimer = null;
let signalTimer = null;

function escapePrompt(text) {
  return text.replace(/'/g, "'\\''");
}

function buildCodexExecCommand(prompt, { captureLastMessage = false, sandbox = 'read-only' } = {}) {
  const escapedPrompt = escapePrompt(prompt);
  if (!captureLastMessage) {
    return `codex exec --sandbox ${sandbox} '${escapedPrompt}'`;
  }

  return `tmpfile=$(mktemp); codex exec --sandbox ${sandbox} -o "$tmpfile" '${escapedPrompt}'; status=$?; printf '\\n=== CODEX_LAST_MESSAGE_FILE:%s ===\\n' "$tmpfile"; exit $status`;
}

function buildAgentCommand(cliTool, prompt, mode = 'interactive') {
  if (cliTool === 'codex') {
    if (mode === 'plan' || mode === 'review') {
      return buildCodexExecCommand(prompt, { captureLastMessage: true, sandbox: 'read-only' });
    }
    if (mode === 'interactive') {
      return buildCodexExecCommand(prompt, { captureLastMessage: true, sandbox: 'danger-full-access' });
    }
    return buildCodexExecCommand(prompt, { captureLastMessage: false, sandbox: 'read-only' });
  }

  if (mode === 'print') {
    return `claude --print '${escapePrompt(prompt)}'`;
  }

  return `claude --dangerously-skip-permissions '${escapePrompt(prompt)}'`;
}

function getLastStructuredBlock(text, startMarker, endMarker) {
  if (typeof text !== 'string' || !text) return null;
  const endIdx = text.lastIndexOf(endMarker);
  if (endIdx === -1) return null;
  const startIdx = text.lastIndexOf(startMarker, endIdx);
  if (startIdx === -1) return null;
  return text.slice(startIdx, endIdx + endMarker.length);
}

function getCodexLastMessagePath(buffer) {
  if (typeof buffer !== 'string' || !buffer) return null;
  const matches = [...buffer.matchAll(/=== CODEX_LAST_MESSAGE_FILE:(.+?) ===/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

function readCapturedCodexMessage(buffer, { remove = true } = {}) {
  const outputPath = getCodexLastMessagePath(buffer);
  if (!outputPath || !existsSync(outputPath)) return null;

  try {
    return readFileSync(outputPath, 'utf-8');
  } catch {
    return null;
  } finally {
    if (remove) {
      try { unlinkSync(outputPath); } catch { /* ignore */ }
    }
  }
}

function hasCodexStructuredOutput(buffer, endMarker) {
  const captured = readCapturedCodexMessage(buffer, { remove: false });
  return Boolean(captured && captured.includes(endMarker));
}

function getImplementationCompletionState(agent, taskId) {
  const completionMarker = `=== IMPLEMENTATION COMPLETE ${taskId} ===`;
  const buf = agent.getBufferString(100);

  if (agent.cli === 'codex') {
    const captured = readCapturedCodexMessage(buf, { remove: false });
    if (captured) {
      if (captured.includes(completionMarker)) {
        return { complete: true, blockedReason: null };
      }
      const blockedMatch = captured.match(/=== BLOCKED: (.+?) ===/);
      return { complete: false, blockedReason: blockedMatch ? blockedMatch[1] : null };
    }

    return { complete: false, blockedReason: null };
  }

  if (buf.includes(completionMarker)) {
    return { complete: true, blockedReason: null };
  }

  const blockedMatch = buf.match(/=== BLOCKED: (.+?) ===/);
  return { complete: false, blockedReason: blockedMatch ? blockedMatch[1] : null };
}

function summarizeProcessError(prefix, err) {
  const raw = typeof err?.message === 'string' ? err.message : String(err || '');
  const normalized = raw.replace(/\s+/g, ' ').trim();

  const graphqlMatch = normalized.match(/GraphQL:\s*([^]+?)(?:\(createPullRequest\)|$)/i);
  if (graphqlMatch) {
    return `${prefix}: ${graphqlMatch[1].trim()}`;
  }

  const failedMatch = normalized.match(/failed:\s*(.+)$/i);
  if (failedMatch) {
    return `${prefix}: ${failedMatch[1].trim()}`;
  }

  const compact = normalized.slice(0, 240);
  return `${prefix}: ${compact}`;
}

function extractSection(text, label, nextLabels = []) {
  if (typeof text !== 'string' || !text) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextPattern = nextLabels.length > 0
    ? `(?=${nextLabels.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
    : '$';
  const regex = new RegExp(`${escapedLabel}\\s*([\\s\\S]*?)${nextPattern}`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function parseBulletList(sectionText) {
  return (sectionText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(Boolean);
}

function extractSingleLine(text, label) {
  if (typeof text !== 'string' || !text) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escapedLabel}\\s*(.+)`, 'i'));
  return match ? match[1].trim() : '';
}

function getPromptBody(stage) {
  const settings = loadSettings();
  return settings.prompts?.[stage] || '';
}

function isStageDisabled(stage) {
  const settings = loadSettings();
  if (stage === 'planning') return settings.agents?.planners?.max === 0;
  if (stage === 'review') return settings.agents?.reviewers?.max === 0;
  return false;
}

function slugifyTitle(title) {
  const slug = String(title || 'auto')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'auto';
}

function generateBranchName(task) {
  return `feature/${task.id.toLowerCase()}-${slugifyTitle(task.title)}`;
}

function buildSyntheticPlan(task) {
  return `=== PLAN START ===
SUMMARY: Planning skipped because planner max is set to 0. Implement the requested task directly.
BRANCH: ${generateBranchName(task)}
FILES_TO_MODIFY:
- Determine the affected files based on the task description during implementation
STEPS:
1. Review the repository context and task details.
2. Implement the requested changes for "${task.title}".
3. Run the most relevant existing verification before handing off.
TESTS_NEEDED:
- Run the most relevant existing tests or checks for the modified area
RISKS:
- Planning was skipped, so implementation must validate scope and touched files carefully
=== PLAN END ===`;
}

function buildPullRequestBody(task) {
  const planSummary = extractSingleLine(task.plan, 'SUMMARY:');
  const filesToModify = parseBulletList(
    extractSection(task.plan, 'FILES_TO_MODIFY:', ['STEPS:', 'TESTS_NEEDED:', 'RISKS:'])
  );
  const testsNeeded = parseBulletList(
    extractSection(task.plan, 'TESTS_NEEDED:', ['RISKS:', '=== PLAN END ==='])
  );
  const risks = parseBulletList(
    extractSection(task.plan, 'RISKS:', ['=== PLAN END ==='])
  );

  const reviewVerdict = extractSingleLine(task.review, 'VERDICT:') || 'N/A';
  const reviewSummary = extractSingleLine(task.review, 'SUMMARY:');
  const criticalIssues = parseBulletList(
    extractSection(task.review, 'CRITICAL_ISSUES:', ['MINOR_ISSUES:', 'SUMMARY:', '=== REVIEW END ==='])
  ).filter(item => item.toLowerCase() !== 'none');
  const minorIssues = parseBulletList(
    extractSection(task.review, 'MINOR_ISSUES:', ['SUMMARY:', '=== REVIEW END ==='])
  ).filter(item => item.toLowerCase() !== 'none');

  const sections = [
    `## Summary\n\n${planSummary || task.title}`,
  ];

  if (filesToModify.length > 0) {
    sections.push(`## Key Changes\n\n${filesToModify.slice(0, 6).map(item => `- ${item}`).join('\n')}`);
  }

  if (testsNeeded.length > 0) {
    sections.push(`## Validation\n\n${testsNeeded.map(item => `- ${item}`).join('\n')}`);
  }

  const reviewLines = [
    `- Verdict: ${reviewVerdict}`,
  ];
  if (reviewSummary) reviewLines.push(`- Summary: ${reviewSummary}`);
  if (criticalIssues.length > 0) reviewLines.push(`- Critical issues: ${criticalIssues.join('; ')}`);
  if (minorIssues.length > 0) reviewLines.push(`- Minor issues: ${minorIssues.join('; ')}`);
  sections.push(`## Review\n\n${reviewLines.join('\n')}`);

  if (risks.length > 0) {
    sections.push(`## Risks\n\n${risks.map(item => `- ${item}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function getAuthBlockedReason(buffer, cli = '') {
  const text = typeof buffer === 'string' ? buffer : '';
  if (!text) return null;

  const authPatterns = [
    /not logged in[^\n\r]*/i,
    /please run\s+\/login[^\n\r]*/i,
    /run\s+\/login[^\n\r]*/i,
    /authentication required[^\n\r]*/i,
    /login required[^\n\r]*/i,
  ];

  for (const pattern of authPatterns) {
    const match = text.match(pattern);
    if (match) {
      const detail = match[0].replace(/\s+/g, ' ').trim();
      const cliLabel = cli || 'agent CLI';
      return `${cliLabel} authentication required: ${detail}`;
    }
  }

  return null;
}

function buildPlannerPrompt(task) {
  const promptBody = getPromptBody('planning');
  let prompt = `You are a senior software architect. A task has been assigned to you.
Repository: ${task.repoPath}
Workspace: ${task.workspacePath}

TASK ID: ${task.id}
TITLE: ${task.title}
DESCRIPTION: ${task.description || 'No additional description provided.'}
PRIORITY: ${task.priority}`;

  if (task.planFeedback) {
    prompt += `\n\nPrevious plan was rejected. Feedback: ${task.planFeedback}\nPlease revise accordingly.`;
  }

  prompt += `

${promptBody}
Output ONLY in this exact format, with no text before or after the delimiters:

=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (${generateBranchName(task).replace(slugifyTitle(task.title), 'short-descriptive-slug')})
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
  const promptBody = getPromptBody('implementation');
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
${promptBody}
- When fully complete, output this exact string on its own line:
  === IMPLEMENTATION COMPLETE ${task.id} ===
- If you encounter a blocker you cannot resolve, output:
  === BLOCKED: {reason} ===

Begin implementation now.`;

  return prompt;
}

function buildReviewerPrompt(task) {
  const promptBody = getPromptBody('review').replaceAll('{branch}', task.branch || 'main');
  return `You are a senior code reviewer. A feature branch is ready for review.

TASK: ${task.title}
BRANCH: ${task.branch}
REPO: ${task.workspacePath || task.repoPath}

ORIGINAL PLAN:
${task.plan}

Instructions:
${promptBody}

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
  const workspaceRoot = join(getWorkspacesDir(settings), task.id);
  const existingWorkspace = task.workspacePath;

  if (existingWorkspace && existsSync(existingWorkspace)) {
    return existingWorkspace;
  }

  if (existsSync(workspaceRoot)) {
    try {
      const entries = readdirSync(workspaceRoot);
      if (entries.length === 0) {
        await rm(workspaceRoot, { recursive: true, force: true });
      } else if (existsSync(join(workspaceRoot, '.git'))) {
        try {
          const wsGit = simpleGit(workspaceRoot);
          const remotes = await wsGit.getRemotes(true);
          const origin = remotes.find(remote => remote.name === 'origin');
          const fetchUrl = origin?.refs?.fetch || '';
          const pushUrl = origin?.refs?.push || '';

          if ([fetchUrl, pushUrl].includes(task.repoPath)) {
            await wsGit.addConfig('user.email', 'ai-factory@local');
            await wsGit.addConfig('user.name', 'AI Factory');
            try { await wsGit.fetch('origin'); } catch { /* ignore */ }
            return workspaceRoot;
          }
        } catch {
          // Fall through to remove and recreate the workspace.
        }

        await rm(workspaceRoot, { recursive: true, force: true });
      } else {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    } catch {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }

  mkdirSync(workspaceRoot, { recursive: true });

  await simpleGit().clone(task.repoPath, workspaceRoot);

  const wsGit = simpleGit(workspaceRoot);
  await wsGit.addConfig('user.email', 'ai-factory@local');
  await wsGit.addConfig('user.name', 'AI Factory');
  await wsGit.pull('origin', 'main');

  return workspaceRoot;
}

async function prepareWorkspaceBranch(task) {
  const workspacePath = await setupWorkspace(task);
  const git = simpleGit(workspacePath);
  const branches = await git.branchLocal();

  if (!branches.current) {
    await git.checkout('main');
  }

  if (!branches.all.includes(task.branch)) {
    await git.checkout('main');
    await git.pull('origin', 'main');
    try { await git.push('origin', `:${task.branch}`); } catch { /* ignore */ }
    await git.checkoutLocalBranch(task.branch);
  } else {
    await git.checkout(task.branch);
  }

  return workspacePath;
}

async function cleanupWorkspace(task) {
  if (task.workspacePath && existsSync(task.workspacePath)) {
    await rm(task.workspacePath, { recursive: true, force: true });
    store.updateTask(task.id, { workspacePath: null });
  }
}

// --- Stage Transitions ---

async function startPlanning(task) {
  if (isStageDisabled('planning')) {
    const planText = buildSyntheticPlan(task);
    const branch = extractSingleLine(planText, 'BRANCH:') || generateBranchName(task);
    store.savePlan(task.id, planText);
    store.updateTask(task.id, {
      status: 'queued',
      plan: planText,
      branch,
      review: null,
      reviewFeedback: null,
      reviewCycleCount: 0,
      blockedReason: null,
      assignedTo: null,
    });
    return true;
  }

  const planner = agentManager.getAvailablePlanner();
  if (!planner) return false;

  store.updateTask(task.id, { status: 'workspace_setup', assignedTo: planner.id, blockedReason: null });
  planner.currentTask = task.id;
  planner.taskLabel = `Preparing: ${task.title}`;
  planner.status = 'active';
  bus.emit('agent:updated', planner.getStatus());

  let workspacePath;
  try {
    workspacePath = await setupWorkspace(task);
  } catch (err) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Workspace setup failed: ${err.message}`,
      assignedTo: null,
    });
    planner.currentTask = null;
    planner.taskLabel = '';
    planner.status = 'idle';
    bus.emit('agent:updated', planner.getStatus());
    bus.emit('task:blocked', { taskId: task.id, reason: 'Workspace setup failed' });
    return false;
  }

  store.updateTask(task.id, {
    status: 'planning',
    assignedTo: planner.id,
    workspacePath,
    blockedReason: null,
  });
  planner.taskLabel = `Planning: ${task.title}`;

  const prompt = buildPlannerPrompt({ ...task, workspacePath });
  const cmd = buildAgentCommand(planner.cli, prompt, 'plan');
  const plannerCwd = workspacePath;
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
  const captured = planner.cli === 'codex' ? readCapturedCodexMessage(bufStr) : null;
  const sourceText = captured || bufStr;

  // Extract plan text
  const planText = getLastStructuredBlock(sourceText, '=== PLAN START ===', '=== PLAN END ===');
  if (!planText) return;

  // Parse branch name
  const branchMatch = planText.match(/BRANCH:\s*(.+)/);
  const branch = branchMatch ? branchMatch[1].trim() : generateBranchName(store.getTask(taskId) || { id: taskId, title: 'auto' });

  // Save plan
  store.savePlan(taskId, planText);
  store.updateTask(taskId, {
    status: 'awaiting_approval',
    plan: planText,
    branch,
    review: null,
    reviewFeedback: null,
    reviewCycleCount: 0,
    blockedReason: null,
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
    blockedReason: null,
    assignedTo: null,
  });
}

async function startImplementation(task) {
  const agent = agentManager.getAvailableImplementor();
  if (!agent) {
    store.updateTask(task.id, { status: 'queued' });
    return;
  }

  store.updateTask(task.id, {
    status: 'workspace_setup',
    assignedTo: agent.id,
    blockedReason: null,
    startedAt: task.startedAt || new Date().toISOString(),
  });
  agent.currentTask = task.id;
  agent.taskLabel = `Setting up: ${task.title}`;
  agent.status = 'active';
  bus.emit('agent:updated', agent.getStatus());

  let workspacePath;
  try {
    workspacePath = await prepareWorkspaceBranch(task);
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

  store.updateTask(task.id, { status: 'implementing', workspacePath, blockedReason: null });

  const cliTool = agent.cli;
  const prompt = buildImplementorPrompt(task, workspacePath);
  const cmd = buildAgentCommand(cliTool, prompt, 'interactive');

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

  store.updateTask(taskId, { status: 'review', assignedTo: null, blockedReason: null });
  agent.kill();
  if (agent.draining) agentManager.removeAgent(agentId);

  const taskForReview = store.getTask(taskId);
  startReview(taskForReview);
}

function startReview(task) {
  if (isStageDisabled('review')) {
    store.updateTask(task.id, {
      status: 'review',
      assignedTo: 'orch',
      blockedReason: null,
      review: `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- none
SUMMARY: Review skipped because reviewer max is set to 0.
=== REVIEW END ===`,
    });
    bus.emit('review:passed', { taskId: task.id });
    createPR(task.id);
    return;
  }

  const reviewer = agentManager.getAvailableReviewer();
  if (!reviewer) return;

  store.updateTask(task.id, { status: 'review', assignedTo: reviewer.id, blockedReason: null });
  reviewer.currentTask = task.id;
  reviewer.taskLabel = `Reviewing: ${task.title}`;
  reviewer.status = 'active';

  const prompt = buildReviewerPrompt(task);
  const cmd = buildAgentCommand(reviewer.cli, prompt, 'review');
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

  const captured = reviewer.cli === 'codex' ? readCapturedCodexMessage(bufStr) : null;
  const sourceText = captured || bufStr;
  const reviewText = getLastStructuredBlock(sourceText, '=== REVIEW START ===', '=== REVIEW END ===');
  if (!reviewText) return;
  const reviewResult = parseReviewResult(reviewText);
  const shouldPass = reviewShouldPass(reviewResult);

  store.updateTask(taskId, { review: reviewText });
  reviewer.kill();
  if (reviewer.draining) agentManager.removeAgent(agentId);

  if (shouldPass) {
    if (reviewResult.verdict !== 'PASS') {
      store.appendLog(taskId, 'Reviewer returned FAIL without critical issues; normalized to PASS.');
    }
    bus.emit('review:passed', { taskId });
    await createPR(taskId);
  } else {
    const criticalIssues = reviewResult.criticalIssues.join('\n');

    const task = store.getTask(taskId);
    const nextReviewCycleCount = (task?.reviewCycleCount || 0) + 1;

    if (nextReviewCycleCount >= MAX_REVIEW_CYCLES) {
      store.updateTask(taskId, {
        status: 'blocked',
        reviewFeedback: criticalIssues,
        reviewCycleCount: nextReviewCycleCount,
        blockedReason: `Reached maximum review cycles (${MAX_REVIEW_CYCLES}). Human input required.`,
        assignedTo: null,
      });
      bus.emit('task:blocked', { taskId, reason: 'Reached maximum review cycles' });
      return;
    }

    store.updateTask(taskId, {
      status: 'queued',
      reviewFeedback: criticalIssues,
      reviewCycleCount: nextReviewCycleCount,
      blockedReason: null,
      assignedTo: null,
    });
    bus.emit('review:failed', { taskId, issues: criticalIssues });
  }
}

async function createPR(taskId) {
  const task = store.getTask(taskId);
  try {
    if (!task?.workspacePath || !existsSync(task.workspacePath)) {
      throw new Error('Workspace is missing before PR creation');
    }

    const git = simpleGit(task.workspacePath);
    await git.fetch('origin', 'main');
    await git.checkout(task.branch);

    try {
      await git.rebase(['origin/main']);
    } catch (err) {
      try { await git.raw(['rebase', '--abort']); } catch { /* ignore */ }
      throw new Error(`Rebase against origin/main failed: ${err.message}`);
    }

    await git.raw(['push', '--force-with-lease', 'origin', task.branch]);
    const prBody = buildPullRequestBody(task);
    const prUrl = execFileSync('gh', [
      'pr', 'create',
      '--title', `[${task.id}] ${task.title}`,
      '--body', prBody,
      '--head', task.branch,
      '--base', 'main',
    ], { cwd: task.workspacePath, encoding: 'utf-8' }).trim();
    store.updateTask(taskId, {
      prUrl,
      assignedTo: null,
      completedAt: new Date().toISOString(),
    });
    bus.emit('pr:created', { taskId, prUrl });

    await cleanupWorkspace(store.getTask(taskId));
    store.updateTask(taskId, { status: 'done', assignedTo: null });
  } catch (err) {
    console.error(`PR creation error:`, err.message);
    store.updateTask(taskId, {
      status: 'blocked',
      blockedReason: summarizeProcessError('PR finalization failed', err),
      assignedTo: null,
    });
    bus.emit('task:blocked', { taskId, reason: 'PR finalization failed' });
  }
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
    status: 'aborted',
    assignedTo: null,
    workspacePath: null,
    blockedReason: null,
    reviewFeedback: null,
    previousStatus: null,
    reviewCycleCount: 0,
  });

  bus.emit('task:aborted', { taskId });
}

async function resetTask(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status === 'done') return;

  if (task.assignedTo) {
    const agent = agentManager.get(task.assignedTo);
    if (agent) agent.kill();
  }

  await cleanupWorkspace(task);
  store.removePlan(taskId);

  store.updateTask(taskId, {
    status: 'backlog',
    assignedTo: null,
    workspacePath: null,
    branch: null,
    plan: null,
    review: null,
    prUrl: null,
    prNumber: null,
    blockedReason: null,
    reviewFeedback: null,
    planFeedback: null,
    previousStatus: null,
    reviewCycleCount: 0,
    progress: 0,
    totalTokens: 0,
    startedAt: null,
    completedAt: null,
  });
  store.appendLog(taskId, 'Task reset to backlog and workspace deleted');

  bus.emit('task:reset', { taskId });
}

async function deleteTask(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status !== 'done') return false;

  if (task.workspacePath) {
    await cleanupWorkspace(task);
  }

  store.removePlan(taskId);
  store.deleteTask(taskId);
  return true;
}

// --- Signal Detection ---

function checkSignals() {
  // Check planners
  for (const agent of agentManager.getAgentsByRole('plan')) {
    if (agent.status === 'active' && agent.currentTask) {
      const buf = agent.getBufferString(50);
      const planReady = agent.cli === 'codex'
        ? hasCodexStructuredOutput(buf, '=== PLAN END ===')
        : buf.includes('=== PLAN END ===');
      if (planReady) {
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
      const implementationState = getImplementationCompletionState(agent, agent.currentTask);
      if (implementationState.complete) {
        onImplementationComplete(agent.id);
      } else {
        const trustMatch = buf.match(/trust the files|Do you trust|allow.*to run in this/i);
        if (trustMatch && !implementationState.complete) {
          store.updateTask(agent.currentTask, {
            status: 'blocked',
            blockedReason: 'Agent is awaiting user input — open the terminal and respond to the prompt',
            assignedTo: agent.id,
          });
          agent.status = 'blocked';
          bus.emit('task:blocked', { taskId: agent.currentTask, reason: 'Awaiting user input' });
          bus.emit('agent:updated', agent.getStatus());
        } else {
          if (implementationState.blockedReason) {
            const reason = implementationState.blockedReason;
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
  }

  // Check reviewers
  for (const agent of agentManager.getAgentsByRole('rev')) {
    if (agent.status === 'active' && agent.currentTask) {
      const buf = agent.getBufferString(50);
      const reviewReady = agent.cli === 'codex'
        ? hasCodexStructuredOutput(buf, '=== REVIEW END ===')
        : buf.includes('=== REVIEW END ===');
      if (reviewReady) {
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
    if (isStageDisabled('planning')) {
      startPlanning(backlogTask);
      continue;
    }
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
      if (task && !['blocked', 'done', 'aborted', 'backlog', 'paused', 'workspace_setup'].includes(task.status)) {
        const buf = agent.getBufferString(100);
        const isPlanner = agent.id.startsWith('plan-');
        const isImplementor = agent.id.startsWith('imp-');
        const isReviewer = agent.id.startsWith('rev-');

        if (isPlanner) {
          const planReady = agent.cli === 'codex'
            ? hasCodexStructuredOutput(buf, '=== PLAN END ===')
            : buf.includes('=== PLAN END ===');
          if (planReady) {
            onPlanComplete(agent.id, taskId);
          } else {
            store.updateTask(taskId, {
              status: 'blocked',
              blockedReason: 'Agent process exited unexpectedly',
              assignedTo: null,
            });
          }
        } else if (isImplementor) {
          const implementationState = getImplementationCompletionState(agent, taskId);
          if (implementationState.complete) {
            onImplementationComplete(agent.id);
          } else if (implementationState.blockedReason) {
            store.updateTask(taskId, {
              status: 'blocked',
              blockedReason: implementationState.blockedReason,
              assignedTo: null,
            });
          } else {
            store.updateTask(taskId, {
              status: 'blocked',
              blockedReason: 'Agent process exited unexpectedly',
              assignedTo: null,
            });
          }
        } else if (isReviewer) {
          const reviewReady = agent.cli === 'codex'
            ? hasCodexStructuredOutput(buf, '=== REVIEW END ===')
            : buf.includes('=== REVIEW END ===');
          if (reviewReady) {
            onReviewComplete(agent.id, taskId);
          } else {
            store.updateTask(taskId, {
              status: 'blocked',
              blockedReason: 'Agent process exited unexpectedly',
              assignedTo: null,
            });
          }
        } else {
          onPlanComplete(agent.id, taskId);
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
  let authBlockedReason = null;
  if (agent) {
    const buf = agent.getBufferString(100);
    authBlockedReason = getAuthBlockedReason(buf, agent.cli);
    const isPlanner = agentId.startsWith('plan-');
    const isImplementor = agentId.startsWith('imp-');
    const isReviewer = agentId.startsWith('rev-');

    if (isPlanner) {
      const planReady = agent.cli === 'codex'
        ? hasCodexStructuredOutput(buf, '=== PLAN END ===')
        : buf.includes('=== PLAN END ===');
      if (planReady) {
        onPlanComplete(agentId, taskId);
        return;
      }
    } else if (isImplementor) {
      const implementationState = getImplementationCompletionState(agent, taskId);
      if (implementationState.complete) {
        onImplementationComplete(agentId);
        return;
      }
      if (implementationState.blockedReason) {
        authBlockedReason = implementationState.blockedReason;
      }
    } else if (isReviewer) {
      const reviewReady = agent.cli === 'codex'
        ? hasCodexStructuredOutput(buf, '=== REVIEW END ===')
        : buf.includes('=== REVIEW END ===');
      if (reviewReady) {
        onReviewComplete(agentId, taskId);
        return;
      }
    }
    console.error(`[unexpected-exit] agent=${agentId} task=${taskId} last output:\n${buf.slice(-500)}`);
    agent.currentTask = null;
    agent.taskLabel = '';
    agent.status = 'idle';
    bus.emit('agent:updated', agent.getStatus());
  }
  const task = store.getTask(taskId);
  if (task && !['blocked', 'done', 'aborted', 'backlog', 'paused'].includes(task.status)) {
    store.updateTask(taskId, {
      status: 'blocked',
      blockedReason: authBlockedReason || 'Agent process exited unexpectedly',
      assignedTo: null,
    });
  }
});

bus.on('settings:changed', (settings) => {
  agentManager.reconfigure(settings);
  bus.emit('agents:updated', agentManager.getAllStatus());
  bus.emit('repos:updated', settings.repos || []);
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
  resetTask,
  deleteTask,
};

export default orchestrator;
