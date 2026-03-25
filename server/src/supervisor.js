import { execFile } from 'node:child_process';
import store from './store.js';

const SUPERVISOR_TIMEOUT = 60_000;

const DECISION_START = '=== SUPERVISOR DECISION START ===';
const DECISION_END = '=== SUPERVISOR DECISION END ===';

const PLAN_DECISIONS = new Set(['APPROVE', 'REJECT', 'ESCALATE']);
const REVIEW_DECISIONS = new Set(['RETRY', 'ESCALATE']);

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

function runSupervisorQuery(cli, model, prompt) {
  return new Promise((resolve) => {
    const args = ['--print'];
    if (model) args.push('--model', model);
    args.push(prompt);

    const cliCmd = cli === 'codex' ? 'codex' : 'claude';
    execFile(cliCmd, args, {
      timeout: SUPERVISOR_TIMEOUT,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => {
      if (err) {
        return resolve({ decision: 'ESCALATE', feedback: `Supervisor error: ${err.message}` });
      }
      const parsed = parseDecisionBlock(stdout);
      if (!parsed) {
        return resolve({ decision: 'ESCALATE', feedback: 'Supervisor returned unparseable output' });
      }
      resolve(parsed);
    });
  });
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
  store.appendLog(task.id, `Supervisor evaluated plan: ${result.decision}${result.feedback ? ' — ' + result.feedback : ''}`);
  return result;
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
  store.appendLog(task.id, `Supervisor evaluated review failure: ${result.decision}${result.feedback ? ' — ' + result.feedback : ''}`);
  return { decision: result.decision, enhancedFeedback: result.feedback };
}

// Exported for testing
export { parseDecisionBlock, runSupervisorQuery, validateDecision, PLAN_DECISIONS, REVIEW_DECISIONS };
