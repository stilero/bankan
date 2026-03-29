import { execFile } from 'node:child_process';

const SUPERVISOR_TIMEOUT = 60_000;
const SLOT_ACQUIRE_TIMEOUT = 30_000;
const MAX_QUEUE_DEPTH = 20;

const DECISION_START = '=== SUPERVISOR DECISION START ===';
const DECISION_END = '=== SUPERVISOR DECISION END ===';

const PLAN_DECISIONS = new Set(['APPROVE', 'REJECT', 'ESCALATE']);
const REVIEW_DECISIONS = new Set(['RETRY', 'ESCALATE']);

const MAX_CONCURRENT_SUPERVISORS = 3;
let activeSupervisors = 0;
const supervisorQueue = [];

function acquireSupervisorSlot() {
  if (supervisorQueue.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new Error(`Supervisor queue full (${MAX_QUEUE_DEPTH} pending). Try again later.`));
  }
  return new Promise((resolve, reject) => {
    if (activeSupervisors < MAX_CONCURRENT_SUPERVISORS) {
      activeSupervisors++;
      resolve();
    } else {
      const timer = setTimeout(() => {
        const idx = supervisorQueue.indexOf(entry);
        if (idx !== -1) supervisorQueue.splice(idx, 1);
        reject(new Error(`Supervisor slot acquisition timed out after ${SLOT_ACQUIRE_TIMEOUT}ms`));
      }, SLOT_ACQUIRE_TIMEOUT);
      const entry = { resolve, reject, timer };
      supervisorQueue.push(entry);
    }
  });
}

function releaseSupervisorSlot() {
  if (supervisorQueue.length > 0) {
    const entry = supervisorQueue.shift();
    clearTimeout(entry.timer);
    // Transfer the slot to the next waiter — don't decrement activeSupervisors
    entry.resolve();
  } else {
    activeSupervisors = Math.max(0, activeSupervisors - 1);
  }
}

function resetSupervisorState() {
  activeSupervisors = 0;
  while (supervisorQueue.length > 0) {
    const entry = supervisorQueue.shift();
    clearTimeout(entry.timer);
    entry.reject(new Error('Supervisor state reset'));
  }
}

function parseDecisionBlock(output) {
  const startIdx = output.indexOf(DECISION_START);
  const endIdx = output.indexOf(DECISION_END, startIdx + DECISION_START.length);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const block = output.slice(startIdx + DECISION_START.length, endIdx).trim();
  const decisionMatch = block.match(/^DECISION:\s*(.+)/m);
  if (!decisionMatch) return null;

  // Extract feedback: find the label and take everything after it to end of block.
  // Using slice instead of a regex with $ avoids multi-line truncation issues.
  const feedbackLabelMatch = block.match(/^(?:FEEDBACK|ENHANCED_FEEDBACK):\s*/m);
  const feedback = feedbackLabelMatch
    ? block.slice(feedbackLabelMatch.index + feedbackLabelMatch[0].length).trim()
    : '';

  return {
    decision: decisionMatch[1].trim().toUpperCase(),
    feedback,
  };
}

function validateDecision(result, validSet) {
  if (!result || !validSet.has(result.decision)) return null;
  return result;
}

function sanitizeStderr(stderr) {
  if (!stderr) return '';
  // Strip potential secrets/internal details from stderr before storing
  return stderr
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, 'sk-***')
    .replace(/key[=:]\s*\S+/gi, 'key=***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/ghp_[a-zA-Z0-9_]+/g, 'ghp_***')
    .replace(/github_pat_[a-zA-Z0-9_]+/g, 'github_pat_***')
    .replace(/AKIA[A-Z0-9]{16}/g, 'AKIA***')
    .replace(/(token|password|secret)[=:]\s*\S+/gi, '$1=***')
    .slice(0, 500);
}

function stripDecisionMarkers(text) {
  if (typeof text !== 'string') return text;
  return text
    .replaceAll(DECISION_START, '[MARKER STRIPPED]')
    .replaceAll(DECISION_END, '[MARKER STRIPPED]');
}

async function runSupervisorQuery(cli, model, prompt, context = {}) {
  const startTime = Date.now();
  let slotAcquired = false;
  await acquireSupervisorSlot();
  slotAcquired = true;
  try {
    return await new Promise((resolve, reject) => {
      let cliCmd, args;
      if (cli === 'codex') {
        cliCmd = 'codex';
        args = ['exec', '--sandbox', 'read-only'];
        if (model) args.push('-m', model);
        args.push('-'); // read from stdin
      } else {
        cliCmd = 'claude';
        args = ['--print'];
        if (model) args.push('--model', model);
        args.push('-'); // read from stdin
      }

      try {
        const child = execFile(cliCmd, args, {
          timeout: SUPERVISOR_TIMEOUT,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        }, (err, stdout, stderr) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            const safeStderr = sanitizeStderr(stderr);
            const detail = safeStderr ? `${err.message}\nstderr: ${safeStderr}` : err.message;
            console.error('Supervisor subprocess failed', { ...context, cli, elapsed, errorCode: err.code });
            return resolve({ decision: 'ESCALATE', feedback: `Supervisor error: ${detail}` });
          }
          const parsed = parseDecisionBlock(stdout);
          if (!parsed) {
            console.error('Supervisor returned unparseable output', { ...context, cli, elapsed, output: stdout?.slice(0, 500) });
            return resolve({ decision: 'ESCALATE', feedback: 'Supervisor returned unparseable output' });
          }
          resolve(parsed);
        });
        child.stdin.write(prompt);
        child.stdin.end();
      } catch (err) {
        reject(err);
      }
    });
  } finally {
    if (slotAcquired) releaseSupervisorSlot();
  }
}

function getSupervisorCliModel(settings) {
  const sup = settings.agents?.supervisor;
  const plan = settings.agents?.planners;
  return {
    cli: sup?.cli || plan?.cli || 'claude',
    model: sup?.model ?? plan?.model ?? '',
  };
}

export async function evaluatePlan(task, settings) {
  const { cli, model } = getSupervisorCliModel(settings);

  const prompt = `You are a supervisor agent evaluating a generated plan for quality and completeness.

TASK: ${stripDecisionMarkers(task.title)}
DESCRIPTION: ${stripDecisionMarkers(task.description || 'No description provided.')}
PRIORITY: ${task.priority}

GENERATED PLAN:
${stripDecisionMarkers(task.plan)}

Evaluate the plan on these criteria:
1. Does it address the task requirements?
2. Are the steps actionable and specific?
3. Are risks and tests identified?
4. Is the branch name reasonable?

Respond ONLY in this exact format:

${DECISION_START}
DECISION: APPROVE or REJECT or ESCALATE
FEEDBACK: (brief explanation of your decision, or specific issues if rejecting)
${DECISION_END}

- APPROVE if the plan is solid and ready for implementation
- REJECT if the plan has clear deficiencies that can be fixed by re-planning
- ESCALATE if you are uncertain or the task needs human judgement`;

  const raw = await runSupervisorQuery(cli, model, prompt, { taskId: task.id, stage: 'plan' });
  const result = validateDecision(raw, PLAN_DECISIONS)
    || { decision: 'ESCALATE', feedback: `Invalid supervisor decision: ${raw?.decision || 'none'}` };
  const logMessage = `Supervisor evaluated plan: ${result.decision}${result.feedback ? ' — ' + result.feedback : ''}`;
  return { decision: result.decision, feedback: result.feedback, logMessage };
}

export async function evaluateReviewFailure(task, reviewText, criticalIssues, settings) {
  const { cli, model } = getSupervisorCliModel(settings);

  const prompt = `You are a supervisor agent analyzing a failed code review to decide the next action.

TASK: ${stripDecisionMarkers(task.title)}
DESCRIPTION: ${stripDecisionMarkers(task.description || 'No description provided.')}
REVIEW CYCLE: ${(task.reviewCycleCount || 0) + 1} of ${task.maxReviewCycles || 3}

REVIEW OUTPUT:
${stripDecisionMarkers(reviewText)}

CRITICAL ISSUES:
${stripDecisionMarkers(criticalIssues)}

Decide whether the implementation should retry with enhanced guidance or if this needs human intervention.

Respond ONLY in this exact format:

${DECISION_START}
DECISION: RETRY or ESCALATE
ENHANCED_FEEDBACK: (if RETRY: specific, actionable instructions for the implementor to fix the critical issues. If ESCALATE: explanation of why human input is needed)
${DECISION_END}

- RETRY if the issues are fixable by an AI implementor with better instructions
- ESCALATE if the issues require architectural decisions, clarification, or human judgement`;

  const raw = await runSupervisorQuery(cli, model, prompt, { taskId: task.id, stage: 'review' });
  const result = validateDecision(raw, REVIEW_DECISIONS)
    || { decision: 'ESCALATE', feedback: `Invalid supervisor decision: ${raw?.decision || 'none'}` };
  const logMessage = `Supervisor evaluated review failure: ${result.decision}${result.feedback ? ' — ' + result.feedback : ''}`;
  return { decision: result.decision, feedback: result.feedback, logMessage };
}

// Exported for testing
export { parseDecisionBlock, runSupervisorQuery, validateDecision, stripDecisionMarkers, PLAN_DECISIONS, REVIEW_DECISIONS, MAX_CONCURRENT_SUPERVISORS, resetSupervisorState };
