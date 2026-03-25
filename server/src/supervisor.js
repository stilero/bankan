import { execFile } from 'node:child_process';

const SUPERVISOR_TIMEOUT = 60_000;

const DECISION_START = '=== SUPERVISOR DECISION START ===';
const DECISION_END = '=== SUPERVISOR DECISION END ===';

const PLAN_DECISIONS = new Set(['APPROVE', 'REJECT', 'ESCALATE']);
const REVIEW_DECISIONS = new Set(['RETRY', 'ESCALATE']);

const MAX_CONCURRENT_SUPERVISORS = 3;
let activeSupervisors = 0;
const supervisorQueue = [];

function acquireSupervisorSlot() {
  return new Promise((resolve) => {
    if (activeSupervisors < MAX_CONCURRENT_SUPERVISORS) {
      activeSupervisors++;
      resolve();
    } else {
      supervisorQueue.push(resolve);
    }
  });
}

function releaseSupervisorSlot() {
  activeSupervisors--;
  if (supervisorQueue.length > 0) {
    activeSupervisors++;
    supervisorQueue.shift()();
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

async function runSupervisorQuery(cli, model, prompt) {
  await acquireSupervisorSlot();
  try {
    return await new Promise((resolve) => {
      let cliCmd, args;
      if (cli === 'codex') {
        cliCmd = 'codex';
        args = ['exec', '--sandbox', 'read-only'];
        if (model) args.push('-m', model);
        args.push(prompt);
      } else {
        cliCmd = 'claude';
        args = ['--print'];
        if (model) args.push('--model', model);
        args.push(prompt);
      }

      execFile(cliCmd, args, {
        timeout: SUPERVISOR_TIMEOUT,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          const detail = stderr ? `${err.message}\nstderr: ${stderr}` : err.message;
          return resolve({ decision: 'ESCALATE', feedback: `Supervisor error: ${detail}` });
        }
        const parsed = parseDecisionBlock(stdout);
        if (!parsed) {
          console.error('Supervisor returned unparseable output:', stdout?.slice(0, 500));
          return resolve({ decision: 'ESCALATE', feedback: 'Supervisor returned unparseable output' });
        }
        resolve(parsed);
      });
    });
  } finally {
    releaseSupervisorSlot();
  }
}

export async function evaluatePlan(task, settings) {
  const cli = settings.agents?.planners?.cli || 'claude';
  const model = settings.agents?.planners?.model || '';

  const prompt = `You are a supervisor agent evaluating a generated plan for quality and completeness.

TASK: ${task.title}
DESCRIPTION: ${task.description || 'No description provided.'}
PRIORITY: ${task.priority}

GENERATED PLAN:
${task.plan}

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

  const raw = await runSupervisorQuery(cli, model, prompt);
  const result = validateDecision(raw, PLAN_DECISIONS)
    || { decision: 'ESCALATE', feedback: `Invalid supervisor decision: ${raw?.decision || 'none'}` };
  const logMessage = `Supervisor evaluated plan: ${result.decision}${result.feedback ? ' — ' + result.feedback : ''}`;
  return { ...result, logMessage };
}

export async function evaluateReviewFailure(task, reviewText, criticalIssues, settings) {
  const cli = settings.agents?.planners?.cli || 'claude';
  const model = settings.agents?.planners?.model || '';

  const prompt = `You are a supervisor agent analyzing a failed code review to decide the next action.

TASK: ${task.title}
DESCRIPTION: ${task.description || 'No description provided.'}
REVIEW CYCLE: ${(task.reviewCycleCount || 0) + 1} of ${task.maxReviewCycles || 3}

REVIEW OUTPUT:
${reviewText}

CRITICAL ISSUES:
${criticalIssues}

Decide whether the implementation should retry with enhanced guidance or if this needs human intervention.

Respond ONLY in this exact format:

${DECISION_START}
DECISION: RETRY or ESCALATE
ENHANCED_FEEDBACK: (if RETRY: specific, actionable instructions for the implementor to fix the critical issues. If ESCALATE: explanation of why human input is needed)
${DECISION_END}

- RETRY if the issues are fixable by an AI implementor with better instructions
- ESCALATE if the issues require architectural decisions, clarification, or human judgement`;

  const raw = await runSupervisorQuery(cli, model, prompt);
  const result = validateDecision(raw, REVIEW_DECISIONS)
    || { decision: 'ESCALATE', feedback: `Invalid supervisor decision: ${raw?.decision || 'none'}` };
  const logMessage = `Supervisor evaluated review failure: ${result.decision}${result.feedback ? ' — ' + result.feedback : ''}`;
  return { decision: result.decision, enhancedFeedback: result.feedback, logMessage };
}

// Exported for testing
export { parseDecisionBlock, runSupervisorQuery, validateDecision, PLAN_DECISIONS, REVIEW_DECISIONS, MAX_CONCURRENT_SUPERVISORS };
