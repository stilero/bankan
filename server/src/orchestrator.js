import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { simpleGit } from 'simple-git';
import { loadSettings, getWorkspacesDir } from './config.js';
import { getGithubCapabilities, isManualPullRequestRequired } from './capabilities.js';
import store from './store.js';
import agentManager from './agents.js';
import bus from './events.js';
import {
  isReviewResultPlaceholder,
  isPlanPlaceholder,
  isImplementationPlaceholder,
  parseReviewResult,
  resolveTaskMaxReviewCycles,
  reviewShouldPass,
} from './workflow.js';
import { createSessionEntry } from './sessionHistory.js';

const POLL_INTERVAL = 4000;
const SIGNAL_CHECK_INTERVAL = 2500;
const PLANNER_TIMEOUT = 5 * 60 * 1000;
const IMPLEMENTOR_TIMEOUT = 60 * 60 * 1000;
const REVIEWER_TIMEOUT = 30 * 60 * 1000;
const STUCK_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_MAX_REVIEW_CYCLES = 3;

let pollTimer = null;
let signalTimer = null;

function stripAnsi(text) {
  if (typeof text !== 'string') return text;
  // Replace cursor forward codes (\x1b[nC) with a space to preserve word boundaries.
  // eslint-disable-next-line no-control-regex
  let result = text.replace(/\x1b\[\d*C/g, ' ');
  // Strip remaining ANSI control sequences.
  return result.replace(
    // eslint-disable-next-line no-control-regex
    /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|\x1b\].*?(?:\x07|\x1b\\)|\r/g,
    ''
  );
}

const isWindows = process.platform === 'win32';

function escapePrompt(text) {
  if (isWindows) {
    // PowerShell: escape single quotes by doubling them
    return text.replace(/'/g, "''");
  }
  // Bash: break out of single quotes, insert escaped quote, re-enter
  return text.replace(/'/g, "'\\''");
}

function buildCodexExecCommand(prompt, { captureLastMessage = false, sandbox = 'read-only', model = '' } = {}) {
  const escapedPrompt = escapePrompt(prompt);
  const modelFlag = model ? `-m ${model} ` : '';
  if (!captureLastMessage) {
    return `codex exec ${modelFlag}--sandbox ${sandbox} '${escapedPrompt}'`;
  }

  return `tmpfile=$(mktemp); codex exec ${modelFlag}--sandbox ${sandbox} -o "$tmpfile" '${escapedPrompt}'; status=$?; printf '\\n=== CODEX_LAST_MESSAGE_FILE:%s ===\\n' "$tmpfile"; exit $status`;
}

// On Windows the agent shell is PowerShell, so the bash-syntax
// captureLastMessage path cannot work — the structured-capture and
// terminal-buffer fallbacks in extractStructuredStageText still apply.
export function buildAgentCommand(cliTool, prompt, mode = 'interactive', model = '') {
  if (cliTool === 'codex') {
    const capture = !isWindows;
    if (mode === 'plan' || mode === 'review') {
      return buildCodexExecCommand(prompt, { captureLastMessage: capture, sandbox: 'read-only', model });
    }
    if (mode === 'interactive') {
      return buildCodexExecCommand(prompt, { captureLastMessage: capture, sandbox: 'danger-full-access', model });
    }
    return buildCodexExecCommand(prompt, { captureLastMessage: false, sandbox: 'read-only', model });
  }

  const modelFlag = model ? `--model ${model} ` : '';

  if (mode === 'print') {
    return `claude ${modelFlag}--print '${escapePrompt(prompt)}'`;
  }

  return `claude ${modelFlag}--dangerously-skip-permissions '${escapePrompt(prompt)}'`;
}

function getLastStructuredBlock(text, startMarker, endMarker) {
  if (typeof text !== 'string' || !text) return null;
  const endIdx = text.lastIndexOf(endMarker);
  if (endIdx === -1) return null;
  const startIdx = text.lastIndexOf(startMarker, endIdx);
  if (startIdx === -1) return null;
  return text.slice(startIdx, endIdx + endMarker.length);
}

function getAllStructuredBlocks(text, startMarker, endMarker) {
  if (typeof text !== 'string' || !text) return [];
  const blocks = [];
  let searchFrom = 0;
  while (true) {
    const startIdx = text.indexOf(startMarker, searchFrom);
    if (startIdx === -1) break;
    const endIdx = text.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) break;
    blocks.push(text.slice(startIdx, endIdx + endMarker.length));
    searchFrom = endIdx + endMarker.length;
  }
  return blocks;
}

// Terminal UI noise patterns left behind after ANSI stripping.
// Matches entire lines that are purely artifacts.
const TERMINAL_ARTIFACT_LINE_RE = /^(?:.*(?:⏵⏵bypass|bypasspermission|shift\+tab\s*to\s*cycle)|.*Opus\s*4\.\d.*(?:│|context)|.*Claude(?:Code|Max)|.*▐▛|.*▝▜|.*[░▓█]{3,}|[─━═]{10,}|^\s*[❯›]\s*$|.*\.data\/workspaces\/T-)/i;

// Prompt echo lines: CLI echoes the full prompt and org messages into the terminal.
// These lines are noise when captured as part of the plan/review text.
const PROMPT_ECHO_LINE_RE = /^(?:❯\s+\S|.*\bOrganization:|\s*(?:Repository|Workspace):\s|.*(?:TASK\s+ID|PRIORITY):\s|.*Plan\s+Mode\s+Instructions|.*Core\s+constraints:|.*Output\s+ONLY\s+in\s+this\s+exact\s+format|.*Do\s+not\s+edit\s+files.*change\s+system\s+state|.*Treat\s+this\s+stage\s+as\s+planning\s+only)/i;

// Inline artifacts that can appear at the end of or within content lines.
// These are stripped from each line individually.
const TRAILING_ARTIFACT_RE = /\s*[❯›]\s*[─━═]{4,}.*$/;
const INLINE_ARTIFACT_RE = /[─━═]{10,}/g;

export function cleanTerminalArtifacts(text) {
  if (typeof text !== 'string') return text;

  // If the text contains a second === PLAN START === or === REVIEW START ===,
  // truncate at that point — everything after is echoed prompt/template noise.
  // Also strip noise lines between the real plan content and the truncation point.
  let truncated = text;
  for (const marker of ['=== PLAN START ===', '=== REVIEW START ===', '=== IMPLEMENTATION RESULT START ===']) {
    const firstIdx = truncated.indexOf(marker);
    if (firstIdx !== -1) {
      const secondIdx = truncated.indexOf(marker, firstIdx + marker.length);
      if (secondIdx !== -1) {
        truncated = truncated.slice(0, secondIdx).trimEnd();
        // Find where real plan content ends by locating the last structured
        // section header and its items, then strip everything after.
        const contentLines = truncated.split('\n');
        const planHeaderRe = /^(?:SUMMARY:|BRANCH:|FILES_TO_MODIFY:|STEPS:|TESTS_NEEDED:|RISKS:|VERDICT:|CRITICAL_ISSUES:|MINOR_ISSUES:|CHANGED_FILES:)/;
        let lastFieldLine = contentLines.length - 1;
        let sectionIdx = -1;
        for (let i = 0; i < contentLines.length; i++) {
          if (planHeaderRe.test(contentLines[i].trim())) sectionIdx = i;
        }
        if (sectionIdx !== -1) {
          lastFieldLine = sectionIdx;
          for (let i = sectionIdx + 1; i < contentLines.length; i++) {
            const trimmed = contentLines[i].trim();
            if (!trimmed) break;
            if (trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
              lastFieldLine = i;
            } else {
              break;
            }
          }
        }
        truncated = contentLines.slice(0, lastFieldLine + 1).join('\n');
        // Re-add the end marker if it was lost
        const endMarker = marker.replace('START', 'END');
        if (!truncated.includes(endMarker)) {
          truncated += '\n' + endMarker;
        }
      }
    }
  }

  const lines = truncated.split('\n');
  const cleaned = lines
    .map(line => {
      // Trim trailing box-drawing and prompt artifacts from content lines
      let result = line.replace(TRAILING_ARTIFACT_RE, '');
      result = result.replace(INLINE_ARTIFACT_RE, '');
      // Strip trailing prompt characters (❯/›) from content lines
      result = result.replace(/\s*[❯›]\s*$/, '');
      return result.trimEnd();
    })
    .filter(line => {
      if (!line) return true; // keep blank lines
      if (TERMINAL_ARTIFACT_LINE_RE.test(line)) return false;
      if (PROMPT_ECHO_LINE_RE.test(line)) return false;
      return true;
    });
  // Collapse runs of 3+ blank lines down to a single blank line
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n');
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

function extractStructuredStageText(agent, {
  startMarker,
  endMarker,
  kind,
  removeCaptured = false,
  readCapturedCodexMessage: readCaptured = readCapturedCodexMessage,
} = {}) {
  if (!agent) return null;
  const bufStr = agent.getBufferString(100);
  if (agent.cli === 'codex') {
    const captured = readCaptured(bufStr, { remove: removeCaptured });
    if (captured) {
      return getLastStructuredBlock(captured, startMarker, endMarker);
    }
  }

  const structured = agent.getStructuredBlock?.(kind) || null;
  if (structured) return structured;

  // Fallback: scan terminal buffer directly (handles edge cases
  // where structured capture missed the block)
  const cleanBuf = stripAnsi(agent.getBufferString(100));
  return getLastStructuredBlock(cleanBuf, startMarker, endMarker);
}

export function extractPlannerPlanText(agent, options = {}) {
  const startMarker = '=== PLAN START ===';
  const endMarker = '=== PLAN END ===';
  const result = extractStructuredStageText(agent, {
    startMarker,
    endMarker,
    kind: 'plan',
    ...options,
  });

  // If the extracted block is a placeholder (echoed prompt template),
  // search all captured blocks first, then fall back to the full buffer.
  // The CLI can re-render the prompt template after the real plan, causing
  // getLastStructuredBlock to return the template instead of the real plan.
  if (result && isPlanPlaceholder(result)) {
    // Check all blocks captured by the agent's streaming parser
    const capturedBlocks = agent.getAllCapturedBlocks?.('plan') || [];
    for (let i = capturedBlocks.length - 1; i >= 0; i--) {
      if (!isPlanPlaceholder(capturedBlocks[i])) return capturedBlocks[i];
    }

    // Final fallback: scan the full terminal buffer
    const cleanBuf = stripAnsi(agent.getBufferString(500));
    const blocks = getAllStructuredBlocks(cleanBuf, startMarker, endMarker);
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!isPlanPlaceholder(blocks[i])) return blocks[i];
    }
  }

  return result;
}

export function extractReviewerReviewText(agent, options = {}) {
  const startMarker = '=== REVIEW START ===';
  const endMarker = '=== REVIEW END ===';
  const result = extractStructuredStageText(agent, {
    startMarker,
    endMarker,
    kind: 'review',
    ...options,
  });

  // Same fallback as extractPlannerPlanText: if the captured block is a
  // placeholder (echoed prompt template), search all captured blocks and
  // the full buffer for the real review output.
  const reviewResult = result ? parseReviewResult(result) : null;
  if (result && isReviewResultPlaceholder(result, reviewResult)) {
    const capturedBlocks = agent.getAllCapturedBlocks?.('review') || [];
    for (let i = capturedBlocks.length - 1; i >= 0; i--) {
      const parsed = parseReviewResult(capturedBlocks[i]);
      if (!isReviewResultPlaceholder(capturedBlocks[i], parsed)) return capturedBlocks[i];
    }

    const cleanBuf = stripAnsi(agent.getBufferString(500));
    const blocks = getAllStructuredBlocks(cleanBuf, startMarker, endMarker);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const parsed = parseReviewResult(blocks[i]);
      if (!isReviewResultPlaceholder(blocks[i], parsed)) return blocks[i];
    }
  }

  return result;
}

export function extractImplementationResult(agent, options = {}) {
  const startMarker = '=== IMPLEMENTATION RESULT START ===';
  const endMarker = '=== IMPLEMENTATION RESULT END ===';
  const result = extractStructuredStageText(agent, {
    startMarker,
    endMarker,
    kind: 'implementation',
    ...options,
  });

  if (result && isImplementationPlaceholder(result)) {
    const capturedBlocks = agent.getAllCapturedBlocks?.('implementation') || [];
    for (let i = capturedBlocks.length - 1; i >= 0; i--) {
      if (!isImplementationPlaceholder(capturedBlocks[i])) return capturedBlocks[i];
    }

    const cleanBuf = stripAnsi(agent.getBufferString(500));
    const blocks = getAllStructuredBlocks(cleanBuf, startMarker, endMarker);
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!isImplementationPlaceholder(blocks[i])) return blocks[i];
    }
  }

  return result;
}

function getImplementationCompletionState(agent, taskId) {
  const resultText = extractImplementationResult(agent);

  if (resultText && !isImplementationPlaceholder(resultText)) {
    const completionMarker = `=== IMPLEMENTATION COMPLETE ${taskId} ===`;
    if (resultText.includes(completionMarker)) {
      return { complete: true, blockedReason: null };
    }
    const blockedMatch = resultText.match(/=== BLOCKED: (.+?) ===/);
    if (blockedMatch) {
      return { complete: false, blockedReason: blockedMatch[1] };
    }
  }

  // Fallback for codex: check captured message directly
  if (agent.cli === 'codex') {
    const buf = agent.getBufferString(100);
    const captured = readCapturedCodexMessage(buf, { remove: false });
    if (captured) {
      const completionMarker = `=== IMPLEMENTATION COMPLETE ${taskId} ===`;
      if (captured.includes(completionMarker)) {
        return { complete: true, blockedReason: null };
      }
      const blockedMatch = captured.match(/=== BLOCKED: (.+?) ===/);
      return { complete: false, blockedReason: blockedMatch ? blockedMatch[1] : null };
    }
  }

  return { complete: false, blockedReason: null };
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

// Strip garbage from branch names caused by ANSI cursor positioning collapse
// (e.g. "feature/t-a811ca-reporting FILES_TO_MODIFY:" → "feature/t-a811ca-reporting").
// Stops at the first character that's invalid in a git branch name.
export function sanitizeBranchName(raw) {
  if (typeof raw !== 'string') return raw;
  // Trim leading/trailing whitespace, then keep only valid branch chars.
  // Git branch names allow: alphanumeric, -, _, /, .
  // Stop at first space or other invalid char (catches appended field headers).
  const match = raw.trim().match(/^[a-zA-Z0-9/_.-]+/);
  return match ? match[0].replace(/\.+$/, '') : raw.trim();
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

export function buildImplementorPrompt(task, workspacePath) {
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
- Before signaling completion, ensure ALL changes are committed to git on branch ${task.branch}
- When fully complete and all changes are committed, output the completion block below — replace {TASK_ID} with the actual TASK ID shown above:
  === IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE {TASK_ID} ===
  === IMPLEMENTATION RESULT END ===
- If you encounter a blocker you cannot resolve, output:
  === IMPLEMENTATION RESULT START ===
  === BLOCKED: {describe the blocker here} ===
  === IMPLEMENTATION RESULT END ===

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

Output ONLY a completed review block in this format.
Do not copy placeholder text. Replace every field with concrete findings from the actual diff.
Do not emit the review block until after you have run the required git diff commands and finished the review.

=== REVIEW START ===
VERDICT: PASS or FAIL
CRITICAL_ISSUES:
- concrete issue, or none
MINOR_ISSUES:
- concrete issue, or none
SUMMARY: 2-3 concrete sentences summarising the review, including changed files and strengths
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
  if (task.workspacePath) {
    try {
      await rm(task.workspacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    } catch (err) {
      console.warn(`Could not remove workspace ${task.workspacePath}: ${err.message}`);
    }
    store.updateTask(task.id, { workspacePath: null });
  }
}

function buildManualPrGuidance(task, capabilities = getGithubCapabilities()) {
  const reason = !capabilities.ghAvailable
    ? 'GitHub CLI is not installed'
    : !capabilities.ghAuthenticated
      ? 'GitHub CLI is not authenticated'
      : 'Automatic pull request creation is unavailable';

  return `${reason}, so Ban Kan could not create the pull request automatically. Your branch has been pushed${task?.branch ? ` (${task.branch})` : ''}. Open the workspace, create the PR manually, then mark this task done.`;
}

function isManualPrAutomationError(err) {
  if (!err) return false;
  const message = typeof err.message === 'string' ? err.message : '';
  const path = typeof err.path === 'string' ? err.path : '';
  const spawnargs = Array.isArray(err.spawnargs) ? err.spawnargs : [];
  const firstSpawnArg = typeof spawnargs[0] === 'string' ? spawnargs[0] : '';
  return path === 'gh'
    || firstSpawnArg === 'gh'
    || /spawn(?:sync)? gh ENOENT/i.test(message)
    || /gh.*not authenticated/i.test(message);
}

async function transitionTaskToManualPr(taskId, capabilities = getGithubCapabilities()) {
  const task = store.getTask(taskId);
  if (!task) return;

  const blockedReason = buildManualPrGuidance(task, capabilities);
  store.updateTask(taskId, {
    status: 'awaiting_manual_pr',
    assignedTo: null,
    blockedReason,
  });
  store.appendLog(taskId, 'Automatic PR creation unavailable; waiting for manual PR completion.');
  bus.emit('task:manual-pr-required', { taskId, reason: blockedReason });
}

function retireAgentSession(agent, {
  taskId = agent?.currentTask || null,
  outcome = 'completed',
  transcript = null,
} = {}) {
  if (!agent || agent.id === 'orch') return;

  const transcriptText = typeof transcript === 'string'
    ? transcript
    : agent.getBufferString(500);

  if (taskId) {
    store.appendSession(taskId, createSessionEntry(agent, {
      taskId,
      outcome,
      transcript: transcriptText,
    }));
  }

  agent.kill();
  agentManager.removeAgent(agent.id);
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
      maxReviewCycles: resolveTaskMaxReviewCycles(task, DEFAULT_MAX_REVIEW_CYCLES),
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
    retireAgentSession(planner, { taskId: task.id, outcome: 'blocked' });
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
  const cmd = buildAgentCommand(planner.cli, prompt, 'plan', planner.model);
  const plannerCwd = workspacePath;
  const ok = planner.spawn(plannerCwd, cmd);
  if (!ok) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Invalid planner working directory: ${plannerCwd}`,
      assignedTo: null,
    });
    retireAgentSession(planner, { taskId: task.id, outcome: 'blocked' });
    return false;
  }
  bus.emit('agent:updated', planner.getStatus());
  return true;
}

function onPlanComplete(agentId, taskId) {
  const planner = agentManager.get(agentId);
  if (!planner) return;
  const rawPlanText = extractPlannerPlanText(planner, { removeCaptured: true });

  if (!rawPlanText) return;
  if (isPlanPlaceholder(rawPlanText)) return;

  const planText = cleanTerminalArtifacts(rawPlanText);

  // Parse branch name
  const branchMatch = planText.match(/BRANCH:\s*(.+)/);
  const branch = branchMatch
    ? sanitizeBranchName(branchMatch[1])
    : generateBranchName(store.getTask(taskId) || { id: taskId, title: 'auto' });

  // Save plan
  store.savePlan(taskId, planText);
  const task = store.getTask(taskId);
  store.updateTask(taskId, {
    status: 'awaiting_approval',
    plan: planText,
    branch,
    review: null,
    reviewFeedback: null,
    reviewCycleCount: 0,
    maxReviewCycles: resolveTaskMaxReviewCycles(task, DEFAULT_MAX_REVIEW_CYCLES),
    blockedReason: null,
    assignedTo: null,
  });

  retireAgentSession(planner, { taskId, outcome: 'completed', transcript: planText });
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
    retireAgentSession(agent, { taskId: task.id, outcome: 'blocked' });
    return;
  }

  store.updateTask(task.id, { status: 'implementing', workspacePath, blockedReason: null });

  const cliTool = agent.cli;
  const prompt = buildImplementorPrompt(task, workspacePath);
  const cmd = buildAgentCommand(cliTool, prompt, 'interactive', agent.model);

  const ok = agent.spawn(workspacePath, cmd);
  if (!ok) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Invalid workspace path: ${workspacePath}`,
      assignedTo: null,
    });
    retireAgentSession(agent, { taskId: task.id, outcome: 'blocked' });
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
      console.error('Git push failed:', err.message);
      store.updateTask(taskId, {
        status: 'blocked',
        blockedReason: `Branch push failed: ${err.message}`,
        assignedTo: null,
      });
      retireAgentSession(agent, { taskId, outcome: 'blocked' });
      return;
    }
  }

  store.updateTask(taskId, { status: 'review', assignedTo: null, blockedReason: null });
  retireAgentSession(agent, { taskId, outcome: 'completed' });

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
  const cmd = buildAgentCommand(reviewer.cli, prompt, 'review', reviewer.model);
  const ok = reviewer.spawn(task.workspacePath, cmd);
  if (!ok) {
    store.updateTask(task.id, {
      status: 'blocked',
      blockedReason: `Invalid workspace path for review: ${task.workspacePath}`,
      assignedTo: null,
    });
    retireAgentSession(reviewer, { taskId: task.id, outcome: 'blocked' });
    return;
  }
  bus.emit('agent:updated', reviewer.getStatus());
}

async function onReviewComplete(agentId, taskId) {
  const reviewer = agentManager.get(agentId);
  if (!reviewer) return;
  const rawReviewText = extractReviewerReviewText(reviewer, { removeCaptured: true });
  if (!rawReviewText) return;
  const reviewText = cleanTerminalArtifacts(rawReviewText);
  const reviewResult = parseReviewResult(reviewText);
  if (isReviewResultPlaceholder(reviewText, reviewResult)) return;
  const shouldPass = reviewShouldPass(reviewResult);

  store.updateTask(taskId, { review: reviewText });
  retireAgentSession(reviewer, {
    taskId,
    outcome: shouldPass ? 'completed' : 'failed_review',
    transcript: reviewText,
  });

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
    const maxReviewCycles = Math.max(1, task?.maxReviewCycles || DEFAULT_MAX_REVIEW_CYCLES);

    if (nextReviewCycleCount >= maxReviewCycles) {
      store.updateTask(taskId, {
        status: 'blocked',
        reviewFeedback: criticalIssues,
        reviewCycleCount: nextReviewCycleCount,
        blockedReason: `Reached maximum review cycles (${maxReviewCycles}). Human input required.`,
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

export async function createPR(taskId) {
  const task = store.getTask(taskId);
  try {
    if (!task?.workspacePath || !existsSync(task.workspacePath)) {
      throw new Error('Workspace is missing before PR creation');
    }

    const git = simpleGit(task.workspacePath);
    await git.fetch('origin', 'main');
    await git.checkout(task.branch);

    // Discard any uncommitted changes left by the agent (e.g. package-lock.json
    // from npm installs during review) so they don't block the rebase.
    await git.raw(['checkout', '--', '.']);
    await git.raw(['clean', '-fd']);

    try {
      await git.rebase(['origin/main']);
    } catch (err) {
      try { await git.raw(['rebase', '--abort']); } catch { /* ignore */ }
      throw new Error(`Rebase against origin/main failed: ${err.message}`);
    }

    await git.raw(['push', '--force-with-lease', 'origin', task.branch]);
    const githubCapabilities = getGithubCapabilities();
    if (isManualPullRequestRequired(githubCapabilities)) {
      await transitionTaskToManualPr(taskId, githubCapabilities);
      return;
    }

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
    if (isManualPrAutomationError(err)) {
      await transitionTaskToManualPr(taskId);
      return;
    }
    console.error('PR creation error:', err.message);
    store.updateTask(taskId, {
      status: 'blocked',
      blockedReason: summarizeProcessError('PR finalization failed', err),
      assignedTo: null,
    });
    bus.emit('task:blocked', { taskId, reason: 'PR finalization failed' });
  }
}

async function completeManualPr(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status !== 'awaiting_manual_pr') return;

  await cleanupWorkspace(task);
  store.updateTask(taskId, {
    status: 'done',
    assignedTo: null,
    blockedReason: null,
    completedAt: new Date().toISOString(),
  });
  bus.emit('task:manual-pr-completed', { taskId });
}

async function abortTask(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status === 'done') return;

  if (task.assignedTo) {
    const agent = agentManager.get(task.assignedTo);
    if (agent) retireAgentSession(agent, { taskId, outcome: 'aborted' });
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
    maxReviewCycles: DEFAULT_MAX_REVIEW_CYCLES,
  });

  bus.emit('task:aborted', { taskId });
}

async function resetTask(taskId) {
  const task = store.getTask(taskId);
  if (!task || task.status === 'done') return;

  if (task.assignedTo) {
    const agent = agentManager.get(task.assignedTo);
    if (agent) retireAgentSession(agent, { taskId, outcome: 'reset' });
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
    maxReviewCycles: DEFAULT_MAX_REVIEW_CYCLES,
    sessionHistory: [],
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
  if (!task || !['done', 'aborted'].includes(task.status)) return false;

  if (task.workspacePath) {
    await cleanupWorkspace(task);
  }

  store.removePlan(taskId);
  store.deleteTask(taskId);
  return true;
}

// --- Signal Detection ---

const TRUST_PROMPT_RE = /trust the files|Do you trust|allow.*to run in this/i;

function checkTrustPrompt(agent, buf) {
  if (agent.status === 'blocked') return true; // already handled
  if (!TRUST_PROMPT_RE.test(stripAnsi(buf))) return false;

  store.updateTask(agent.currentTask, {
    status: 'blocked',
    blockedReason: 'Agent is awaiting user input — open the terminal and respond to the prompt',
    assignedTo: agent.id,
  });
  agent.status = 'blocked';
  bus.emit('task:blocked', { taskId: agent.currentTask, reason: 'Awaiting user input' });
  bus.emit('agent:updated', agent.getStatus());
  return true;
}

function checkSignals() {
  // Check planners
  for (const agent of agentManager.getAgentsByRole('plan')) {
    if (agent.status === 'active' && agent.currentTask) {
      // Skip checks during initial startup to avoid matching the completion
      // marker in the echoed prompt text (interactive mode echoes the prompt)
      const elapsed = agent.startedAt ? Date.now() - agent.startedAt : 0;
      if (elapsed < 20000) continue;

      const buf = agent.getBufferString(50);
      const cleanBuf = stripAnsi(buf);
      const planText = extractPlannerPlanText(agent);
      const hasConcretePlan = Boolean(planText && !isPlanPlaceholder(planText));
      if (hasConcretePlan) {
        onPlanComplete(agent.id, agent.currentTask);
      } else if (!checkTrustPrompt(agent, buf)) {
        // Live plan streaming
        if (!cleanBuf.includes('=== PLAN END ===') && cleanBuf.includes('=== PLAN START ===')) {
          const partial = cleanBuf.slice(cleanBuf.indexOf('=== PLAN START ==='));
          if (!isPlanPlaceholder(partial)) {
            bus.emit('plan:partial', { taskId: agent.currentTask, plan: cleanTerminalArtifacts(partial) });
          }
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
      // Skip checks during initial startup to avoid matching the completion
      // marker in the echoed prompt text (interactive mode echoes the prompt)
      const elapsed = agent.startedAt ? Date.now() - agent.startedAt : 0;
      if (elapsed < 20000) continue;

      const buf = agent.getBufferString(50);
      const implementationState = getImplementationCompletionState(agent, agent.currentTask);
      if (implementationState.complete) {
        onImplementationComplete(agent.id);
      } else if (!checkTrustPrompt(agent, buf)) {
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

  // Check reviewers
  for (const agent of agentManager.getAgentsByRole('rev')) {
    if (agent.status === 'active' && agent.currentTask) {
      // Skip checks during initial startup to avoid matching the completion
      // marker in the echoed prompt text (interactive mode echoes the prompt)
      const elapsed = agent.startedAt ? Date.now() - agent.startedAt : 0;
      if (elapsed < 20000) continue;

      const buf = agent.getBufferString(50);
      const reviewText = extractReviewerReviewText(agent);
      const reviewResult = reviewText ? parseReviewResult(reviewText) : null;
      const hasConcreteReview = Boolean(
        reviewText && reviewResult && !isReviewResultPlaceholder(reviewText, reviewResult)
      );
      if (hasConcreteReview) {
        onReviewComplete(agent.id, agent.currentTask);
      } else if (!checkTrustPrompt(agent, buf)) {
        if (agent.startedAt && Date.now() - agent.startedAt > REVIEWER_TIMEOUT) {
          markBlocked(agent, 'Reviewer timed out');
        }
      }
    }
  }
}

function markBlocked(agent, reason) {
  if (agent.currentTask) {
    const taskId = agent.currentTask;
    store.updateTask(agent.currentTask, {
      status: 'blocked',
      blockedReason: reason,
      assignedTo: null,
    });
    bus.emit('task:blocked', { taskId, reason });
    retireAgentSession(agent, { taskId, outcome: 'blocked' });
    return;
  }
  retireAgentSession(agent, { outcome: 'blocked' });
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
      const task = store.getTask(taskId);
      if (task && !['blocked', 'done', 'aborted', 'backlog', 'paused', 'workspace_setup'].includes(task.status)) {
        const isPlanner = agent.id.startsWith('plan-');
        const isImplementor = agent.id.startsWith('imp-');
        const isReviewer = agent.id.startsWith('rev-');

        if (isPlanner) {
          const planText = extractPlannerPlanText(agent);
          if (planText && !isPlanPlaceholder(planText)) {
            onPlanComplete(agent.id, taskId);
          } else {
            store.updateTask(taskId, {
              status: 'blocked',
              blockedReason: planText
                ? 'Planner exited after returning placeholder output'
                : 'Agent process exited unexpectedly',
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
          const reviewText = extractReviewerReviewText(agent);
          const reviewResult = reviewText ? parseReviewResult(reviewText) : null;
          if (reviewText && reviewResult && !isReviewResultPlaceholder(reviewText, reviewResult)) {
            onReviewComplete(agent.id, taskId);
          } else {
            store.updateTask(taskId, {
              status: 'blocked',
              blockedReason: reviewText
                ? 'Reviewer exited after returning placeholder output'
                : 'Agent process exited unexpectedly',
              assignedTo: null,
            });
          }
        } else {
          onPlanComplete(agent.id, taskId);
        }
      } else {
        retireAgentSession(agent, { taskId, outcome: 'unexpected_exit' });
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
    const cleanBuf = stripAnsi(buf);
    authBlockedReason = getAuthBlockedReason(cleanBuf, agent.cli);
    const isPlanner = agentId.startsWith('plan-');
    const isImplementor = agentId.startsWith('imp-');
    const isReviewer = agentId.startsWith('rev-');

    if (isPlanner) {
      const planText = extractPlannerPlanText(agent);
      if (planText && !isPlanPlaceholder(planText)) {
        onPlanComplete(agentId, taskId);
        return;
      }
      if (planText) {
        authBlockedReason = 'Planner exited after returning placeholder output';
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
      const reviewText = extractReviewerReviewText(agent);
      const reviewResult = reviewText ? parseReviewResult(reviewText) : null;
      if (reviewText && reviewResult && !isReviewResultPlaceholder(reviewText, reviewResult)) {
        onReviewComplete(agentId, taskId);
        return;
      }
      if (reviewText) {
        authBlockedReason = 'Reviewer exited after returning placeholder output';
      }
    }
    console.error(`[unexpected-exit] agent=${agentId} task=${taskId} last output:\n${buf.slice(-500)}`);
    retireAgentSession(agent, {
      taskId,
      outcome: authBlockedReason ? 'blocked' : 'unexpected_exit',
    });
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
  completeManualPr,
};

export default orchestrator;
