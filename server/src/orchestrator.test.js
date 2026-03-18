import { describe, expect, test, vi } from 'vitest';

vi.mock('./store.js', () => ({
  default: {
    getTask: vi.fn(),
    deleteTask: vi.fn(),
    removePlan: vi.fn(),
    updateTask: vi.fn(),
    appendLog: vi.fn(),
    addTask: vi.fn(),
    getAllTasks: vi.fn(() => []),
    restartRecovery: vi.fn(),
  },
}));

vi.mock('./agents.js', () => ({
  default: {
    get: vi.fn(),
    getAllStatus: vi.fn(() => []),
    agents: new Map(),
  },
}));

vi.mock('./events.js', () => ({
  default: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('./config.js', () => ({
  default: { PORT: 3001 },
  loadSettings: vi.fn(() => ({ repos: [] })),
  getWorkspacesDir: vi.fn(() => '/tmp/test-workspaces'),
}));

vi.mock('./sessionHistory.js', () => ({
  createSessionEntry: vi.fn(),
}));

import orchestratorDefault, {
  buildAgentCommand,
  buildImplementorPrompt,
  cleanTerminalArtifacts,
  extractImplementationResult,
  extractPlannerPlanText,
  extractReviewerReviewText,
  sanitizeBranchName,
} from './orchestrator.js';
import { isImplementationPlaceholder } from './workflow.js';
import store from './store.js';

describe('structured output extraction', () => {
  test('planner extraction falls back to agent structured capture when the PTY tail lost the full block', () => {
    const readCaptured = vi.fn(() => null);
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => '...tail...\n=== PLAN END ==='),
      getStructuredBlock: vi.fn(() => `=== PLAN START ===
SUMMARY: Persist completed planner output.
BRANCH: feature/test-plan
FILES_TO_MODIFY:
- server/src/agents.js (capture plan output)
STEPS:
1. Read from stable structured state.
TESTS_NEEDED:
- Run npm run test:server
RISKS:
- none
=== PLAN END ===`),
    };

    expect(extractPlannerPlanText(agent, { readCapturedCodexMessage: readCaptured })).toContain(
      'Persist completed planner output.'
    );
    expect(readCaptured).not.toHaveBeenCalled();
  });

  test('review extraction prefers Codex captured output before agent structured capture', () => {
    const readCaptured = vi.fn(() => `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- none
SUMMARY: Captured Codex output should win.
=== REVIEW END ===`);
    const agent = {
      cli: 'codex',
      getBufferString: vi.fn(() => '=== CODEX_LAST_MESSAGE_FILE:/tmp/test ==='),
      getStructuredBlock: vi.fn(() => `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- none
SUMMARY: Agent fallback should not be used here.
=== REVIEW END ===`),
    };

    expect(extractReviewerReviewText(agent, { readCapturedCodexMessage: readCaptured })).toContain(
      'Captured Codex output should win.'
    );
    expect(readCaptured).toHaveBeenCalledOnce();
  });

  test('planner extraction finds real plan via getAllCapturedBlocks when buffer is exhausted', () => {
    const readCaptured = vi.fn(() => null);
    const realPlan = `=== PLAN START ===
SUMMARY: Real plan found via captured blocks.
BRANCH: feature/test-captured
FILES_TO_MODIFY:
- server/src/agents.js (fix capture)
STEPS:
1. Store all captured blocks.
TESTS_NEEDED:
- Run npm run test:server
RISKS:
- none
=== PLAN END ===`;
    const templateBlock = `=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (feature/t-xxx-short-descriptive-slug)
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`;
    const agent = {
      cli: 'claude',
      // Buffer exhausted — only noise, no plan markers
      getBufferString: vi.fn(() => 'lots of noise without any plan markers'),
      // Structured capture has the placeholder (overwritten real plan)
      getStructuredBlock: vi.fn(() => templateBlock),
      // But getAllCapturedBlocks has the full history
      getAllCapturedBlocks: vi.fn(() => [templateBlock, realPlan, templateBlock]),
    };

    const result = extractPlannerPlanText(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('Real plan found via captured blocks.');
    expect(result).not.toContain('(one sentence describing');
  });

  test('planner extraction falls back to buffer scan when getStructuredBlock returns null', () => {
    const readCaptured = vi.fn(() => null);
    const planBlock = `=== PLAN START ===
SUMMARY: Buffer scan fallback works.
BRANCH: feature/buffer-fallback
FILES_TO_MODIFY:
- server/src/orchestrator.js (add fallback)
STEPS:
1. Try structured capture first, then scan buffer.
TESTS_NEEDED:
- Run npm run test:server
RISKS:
- none
=== PLAN END ===`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => `some noise\n${planBlock}\nmore noise`),
      getStructuredBlock: vi.fn(() => null),
    };

    const result = extractPlannerPlanText(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('Buffer scan fallback works.');
    expect(result).toContain('=== PLAN START ===');
    expect(result).toContain('=== PLAN END ===');
    expect(agent.getStructuredBlock).toHaveBeenCalledWith('plan');
  });

  test('planner extraction skips placeholder blocks to find real plan in buffer', () => {
    // The CLI echoes the prompt template (1st block), agent outputs real plan (2nd),
    // then CLI re-renders the template in the status area (3rd). The last block is a
    // placeholder, but the 2nd block has real content.
    const templateBlock = `=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (feature/t-xxx-short-descriptive-slug)
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`;

    const realBlock = `=== PLAN START ===
SUMMARY: Add a Reports modal accessible from the top bar with per-repo task counts and token stats.
BRANCH: feature/t-91eadd-reports-dashboard
FILES_TO_MODIFY:
- client/src/ReportsModal.jsx (new reporting modal)
- server/src/index.js (add reports endpoint)
STEPS:
1. Create ReportsModal component.
2. Wire up the top-bar button.
TESTS_NEEDED:
- Run npm run test
RISKS:
- none
=== PLAN END ===`;

    const readCaptured = vi.fn(() => null);
    const bufferContent = `noise\n${templateBlock}\nmore noise\n${realBlock}\neven more\n${templateBlock}\ntrailing`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => bufferContent),
      // Structured capture got the template (last completed block)
      getStructuredBlock: vi.fn(() => templateBlock),
    };

    const result = extractPlannerPlanText(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('Reports modal accessible from the top bar');
    expect(result).not.toContain('(one sentence describing what will be built)');
  });

  test('review extraction finds real review via getAllCapturedBlocks when template overwrites capture', () => {
    const readCaptured = vi.fn(() => null);
    const realReview = `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- Minor typo in variable name
SUMMARY: All changes look good. Tests pass and code follows conventions.
=== REVIEW END ===`;
    const templateBlock = `=== REVIEW START ===
VERDICT: PASS or FAIL
CRITICAL_ISSUES:
- concrete issue, or none
MINOR_ISSUES:
- concrete issue, or none
SUMMARY: 2-3 concrete sentences summarising the review, including changed files and strengths
=== REVIEW END ===`;
    const agent = {
      cli: 'claude',
      // Buffer exhausted — no review markers
      getBufferString: vi.fn(() => 'noise without markers'),
      // Structured capture has the placeholder (overwritten real review)
      getStructuredBlock: vi.fn(() => templateBlock),
      // But getAllCapturedBlocks has the full history
      getAllCapturedBlocks: vi.fn(() => [templateBlock, realReview, templateBlock]),
    };

    const result = extractReviewerReviewText(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('All changes look good.');
    expect(result).not.toContain('2-3 concrete sentences');
  });

  test('review extraction falls back to agent structured capture when the live tail only contains the end marker', () => {
    const readCaptured = vi.fn(() => null);
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => '...tail...\n=== REVIEW END ==='),
      getStructuredBlock: vi.fn(() => `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- none
SUMMARY: Stable review capture prevents timeout.
=== REVIEW END ===`),
    };

    expect(extractReviewerReviewText(agent, { readCapturedCodexMessage: readCaptured })).toContain(
      'Stable review capture prevents timeout.'
    );
  });

  test('implementation extraction returns real completion block via structured capture', () => {
    const readCaptured = vi.fn(() => null);
    const realBlock = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE T-ABC123 ===
  === IMPLEMENTATION RESULT END ===`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => 'noise'),
      getStructuredBlock: vi.fn(() => realBlock),
    };

    const result = extractImplementationResult(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('IMPLEMENTATION COMPLETE T-ABC123');
  });

  test('implementation extraction rejects echoed prompt template and finds real block in history', () => {
    const readCaptured = vi.fn(() => null);
    const templateBlock = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE {task.id} ===
  === IMPLEMENTATION RESULT END ===`;
    const realBlock = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE T-ABC123 ===
  === IMPLEMENTATION RESULT END ===`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => 'noise'),
      getStructuredBlock: vi.fn(() => templateBlock),
      getAllCapturedBlocks: vi.fn(() => [templateBlock, realBlock, templateBlock]),
    };

    const result = extractImplementationResult(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('IMPLEMENTATION COMPLETE T-ABC123');
    expect(result).not.toContain('{task.id}');
  });

  test('implementation extraction rejects echoed prompt with {TASK_ID} placeholder and finds real block', () => {
    // After the fix, the prompt template uses {TASK_ID} instead of the
    // interpolated task ID, so the streaming parser captures a block with
    // {TASK_ID} which isImplementationPlaceholder correctly rejects.
    const readCaptured = vi.fn(() => null);
    const echoedBlock = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE {TASK_ID} ===
  === IMPLEMENTATION RESULT END ===`;
    const realBlock = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE T-ABC123 ===
  === IMPLEMENTATION RESULT END ===`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => 'noise'),
      getStructuredBlock: vi.fn(() => echoedBlock),
      getAllCapturedBlocks: vi.fn(() => [echoedBlock, realBlock]),
    };

    const result = extractImplementationResult(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('IMPLEMENTATION COMPLETE T-ABC123');
    expect(result).not.toContain('{TASK_ID}');
  });

  test('implementation extraction returns null when only echoed {TASK_ID} block exists', () => {
    // When the agent has only echoed the prompt and hasn't produced real
    // output yet, extraction should return the placeholder (which the
    // signal checker will then reject via isImplementationPlaceholder).
    const readCaptured = vi.fn(() => null);
    const echoedBlock = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE {TASK_ID} ===
  === IMPLEMENTATION RESULT END ===`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => echoedBlock),
      getStructuredBlock: vi.fn(() => echoedBlock),
      getAllCapturedBlocks: vi.fn(() => [echoedBlock]),
    };

    const result = extractImplementationResult(agent, { readCapturedCodexMessage: readCaptured });
    // Should return the placeholder block (caller checks isImplementationPlaceholder)
    expect(result).toContain('{TASK_ID}');
  });

  test('implementation extraction falls back to buffer scan when structured capture is placeholder', () => {
    const readCaptured = vi.fn(() => null);
    const templateBlock = `=== IMPLEMENTATION RESULT START ===
  === BLOCKED: {describe the blocker here} ===
  === IMPLEMENTATION RESULT END ===`;
    const realBlock = `=== IMPLEMENTATION RESULT START ===
  === BLOCKED: npm install failed with EACCES ===
  === IMPLEMENTATION RESULT END ===`;
    const agent = {
      cli: 'claude',
      getBufferString: vi.fn(() => `noise\n${realBlock}\nmore noise\n${templateBlock}`),
      getStructuredBlock: vi.fn(() => templateBlock),
      getAllCapturedBlocks: vi.fn(() => [templateBlock]),
    };

    const result = extractImplementationResult(agent, { readCapturedCodexMessage: readCaptured });
    expect(result).toContain('npm install failed with EACCES');
  });
});

describe('implementation prompt echo safety', () => {
  test('completion block in implementor prompt is detected as placeholder by isImplementationPlaceholder', () => {
    // This is the core bug: the prompt template interpolates ${task.id} into
    // the example completion block. When the CLI echoes the prompt, the
    // streaming parser captures a block with the real task ID, and
    // isImplementationPlaceholder fails to detect it as a template echo.
    const task = {
      id: 'T-4F66CF',
      title: 'Reporting',
      branch: 'feature/t-4f66cf-reporting',
      plan: 'Add reporting feature',
    };
    const prompt = buildImplementorPrompt(task, '/tmp/workspace');

    // Extract the completion block from the prompt the same way the
    // streaming parser would when the CLI echoes the prompt.
    const startMarker = '=== IMPLEMENTATION RESULT START ===';
    const endMarker = '=== IMPLEMENTATION RESULT END ===';
    const startIdx = prompt.indexOf(startMarker);
    const endIdx = prompt.indexOf(endMarker, startIdx);
    const echoedBlock = prompt.slice(startIdx, endIdx + endMarker.length);

    // The echoed completion block from the prompt MUST be detected as a
    // placeholder — otherwise the signal checker treats it as real completion.
    expect(isImplementationPlaceholder(echoedBlock)).toBe(true);
  });
});

describe('sanitizeBranchName', () => {
  test('strips garbage text appended by ANSI cursor collapse', () => {
    expect(sanitizeBranchName('feature/t-a811ca-reporting FILES_TO_MODIFY:'))
      .toBe('feature/t-a811ca-reporting');
  });

  test('strips trailing prompt characters and whitespace', () => {
    expect(sanitizeBranchName('feature/t-b60f78-repo-reports  ❯'))
      .toBe('feature/t-b60f78-repo-reports');
  });

  test('preserves clean branch names unchanged', () => {
    expect(sanitizeBranchName('feature/t-91eadd-reports-dashboard'))
      .toBe('feature/t-91eadd-reports-dashboard');
  });

  test('handles branch names with dots and underscores', () => {
    expect(sanitizeBranchName('fix/v2.1_hotfix'))
      .toBe('fix/v2.1_hotfix');
  });

  test('strips trailing dots from branch names', () => {
    expect(sanitizeBranchName('feature/test.'))
      .toBe('feature/test');
  });
});

describe('buildAgentCommand model flag', () => {
  test('claude CLI includes --model flag when model is non-empty', () => {
    const cmd = buildAgentCommand('claude', 'do stuff', 'plan', 'claude-haiku-4-5');
    expect(cmd).toContain('--model claude-haiku-4-5');
    expect(cmd).toContain('--dangerously-skip-permissions');
  });

  test('claude CLI omits --model flag when model is empty', () => {
    const cmd = buildAgentCommand('claude', 'do stuff', 'plan', '');
    expect(cmd).not.toContain('--model');
  });

  test('claude CLI omits --model flag when model is not provided', () => {
    const cmd = buildAgentCommand('claude', 'do stuff', 'plan');
    expect(cmd).not.toContain('--model');
  });

  test('codex CLI includes -m flag when model is non-empty', () => {
    const cmd = buildAgentCommand('codex', 'do stuff', 'plan', 'gpt-5.4');
    expect(cmd).toContain('-m gpt-5.4');
    expect(cmd).toContain('codex exec');
  });

  test('codex CLI omits -m flag when model is empty', () => {
    const cmd = buildAgentCommand('codex', 'do stuff', 'interactive', '');
    expect(cmd).not.toContain('-m ');
  });

  test('claude print mode includes --model flag', () => {
    const cmd = buildAgentCommand('claude', 'do stuff', 'print', 'claude-sonnet-4-6');
    expect(cmd).toContain('--model claude-sonnet-4-6');
    expect(cmd).toContain('--print');
  });
});

describe('cleanTerminalArtifacts', () => {
  test('removes CLI status bar, permission toggle, box drawings, and header lines', () => {
    const dirty = `=== PLAN START ===
Opus4.6(1Mcontext) │T-91EADD ░░░░░░░░░░6%
⏵⏵bypasspermissionson (shift+tabtocycle)
SUMMARY: Add a Reports modal with per-repo task counts.
⏵⏵bypasspermissionson (shift+tabtocycle)
BRANCH: feature/t-91eadd-reports-dashboard
────────────────────────────────────────────────────────
Opus4.6(1Mcontext) │T-91EADD ░░░░░░░░░░6%
⏵⏵bypasspermissionson (shift+tabtocycle)
FILES_TO_MODIFY:
- client/src/ReportsModal.jsx (new modal component)
 ▐▛███▜▌ClaudeCodev2.1.76
▝▜█████▛▘Opus4.6(1Mcontext)·ClaudeMax
 ~/Developer/stilero/bankan/.data/workspaces/T-91EADD
STEPS:
1. Create the ReportsModal component.
❯
TESTS_NEEDED:
- Run npm run test
RISKS:
- none
=== PLAN END ===`;

    const cleaned = cleanTerminalArtifacts(dirty);
    expect(cleaned).toContain('SUMMARY: Add a Reports modal');
    expect(cleaned).toContain('BRANCH: feature/t-91eadd-reports-dashboard');
    expect(cleaned).toContain('- client/src/ReportsModal.jsx');
    expect(cleaned).toContain('1. Create the ReportsModal component.');
    expect(cleaned).not.toContain('Opus4.6');
    expect(cleaned).not.toContain('bypasspermission');
    expect(cleaned).not.toContain('────');
    expect(cleaned).not.toContain('▐▛███');
    expect(cleaned).not.toContain('ClaudeCode');
    expect(cleaned).not.toContain('ClaudeMax');
    expect(cleaned).not.toContain('.data/workspaces');
    expect(cleaned).not.toContain('❯');
  });

  test('strips trailing artifacts from content lines', () => {
    // The terminal can put artifacts on the same line as real content
    const dirty = '=== PLAN START ===                     ❯  ──────────────────────────────────\nSUMMARY: Real plan.\n=== PLAN END ===';
    const cleaned = cleanTerminalArtifacts(dirty);
    expect(cleaned).toContain('=== PLAN START ===');
    expect(cleaned).toContain('SUMMARY: Real plan.');
    expect(cleaned).not.toContain('❯');
    expect(cleaned).not.toContain('────');
  });

  test('preserves clean plan text unchanged', () => {
    const clean = `=== PLAN START ===
SUMMARY: Add automated tests.
BRANCH: feature/add-tests
FILES_TO_MODIFY:
- server/src/workflow.test.js (expand coverage)
STEPS:
1. Add tests for retry status edge cases.
TESTS_NEEDED:
- Run npm run test:server
RISKS:
- none
=== PLAN END ===`;

    expect(cleanTerminalArtifacts(clean)).toBe(clean);
  });

  test('removes embedded prompt echo and template block from captured plan', () => {
    // When the real plan's END marker is lost in ANSI rendering, the extraction
    // grabs from the first START to the template's END, including echoed prompt text.
    const dirty = `=== PLAN START ===
SUMMARY: Add a Reports modal from the top bar.
BRANCH: feature/t-b60f78-repo-reports
FILES_TO_MODIFY:
- client/src/App.jsx (add Reports button)
STEPS:
1. Create ReportsModal component
TESTS_NEEDED:
- Run npm run test
RISKS:
- none

Message from org:
Make sure to update CLAUDE.md

❯ You are a senior software architect. A task has been assigned to you.
Repository: https://github.com/stilero/bankan
TASK ID: T-B60F78
TITLE: Reports

Plan Mode Instructions
- Do not edit files
Output ONLY in this exact format:

=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: (feature/t-b60f78-short-descriptive-slug)
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`;

    const cleaned = cleanTerminalArtifacts(dirty);
    expect(cleaned).toContain('SUMMARY: Add a Reports modal');
    expect(cleaned).toContain('BRANCH: feature/t-b60f78-repo-reports');
    expect(cleaned).toContain('client/src/App.jsx');
    // Should NOT contain the echoed prompt template
    expect(cleaned).not.toContain('(one sentence describing');
    expect(cleaned).not.toContain('You are a senior software architect');
    expect(cleaned).not.toContain('Plan Mode Instructions');
    expect(cleaned).not.toContain('Message from org');
  });

  test('removes inline prompt character from content lines', () => {
    const dirty = `=== PLAN START ===
SUMMARY: Fix the bug.
BRANCH: feature/fix  ❯
FILES_TO_MODIFY:
- file.js (fix)
STEPS:
1. Fix it
TESTS_NEEDED:
- none
RISKS:
- none
=== PLAN END ===`;

    const cleaned = cleanTerminalArtifacts(dirty);
    expect(cleaned).toContain('BRANCH: feature/fix');
    expect(cleaned).not.toContain('❯');
  });
});

describe('deleteTask', () => {
  test('deletes an aborted task and clears its plan', async () => {
    store.getTask.mockReturnValue({ id: 'T-ABORT', status: 'aborted' });
    store.removePlan.mockClear();
    store.deleteTask.mockClear();

    const result = await orchestratorDefault.deleteTask('T-ABORT');

    expect(result).toBe(true);
    expect(store.removePlan).toHaveBeenCalledWith('T-ABORT');
    expect(store.deleteTask).toHaveBeenCalledWith('T-ABORT');
  });

  test('deletes a done task', async () => {
    store.getTask.mockReturnValue({ id: 'T-DONE', status: 'done' });
    store.removePlan.mockClear();
    store.deleteTask.mockClear();

    const result = await orchestratorDefault.deleteTask('T-DONE');

    expect(result).toBe(true);
    expect(store.removePlan).toHaveBeenCalledWith('T-DONE');
    expect(store.deleteTask).toHaveBeenCalledWith('T-DONE');
  });

  test('refuses to delete a non-terminal task', async () => {
    store.getTask.mockReturnValue({ id: 'T-ACTIVE', status: 'backlog' });
    store.removePlan.mockClear();
    store.deleteTask.mockClear();

    const result = await orchestratorDefault.deleteTask('T-ACTIVE');

    expect(result).toBe(false);
    expect(store.removePlan).not.toHaveBeenCalled();
    expect(store.deleteTask).not.toHaveBeenCalled();
  });

  test('refuses to delete a non-existent task', async () => {
    store.getTask.mockReturnValue(null);
    store.removePlan.mockClear();
    store.deleteTask.mockClear();

    const result = await orchestratorDefault.deleteTask('T-MISSING');

    expect(result).toBe(false);
    expect(store.deleteTask).not.toHaveBeenCalled();
  });
});
