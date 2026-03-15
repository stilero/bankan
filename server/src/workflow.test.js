import { describe, expect, test } from 'vitest';

import {
  getLiveTaskAgent,
  getAgentStage,
  isImplementationPlaceholder,
  isReviewResultPlaceholder,
  isPlanPlaceholder,
  parseReviewResult,
  reviewShouldPass,
  stageToRetryStatus,
} from './workflow.js';

describe('review parsing', () => {
  test('minor-only review output is normalized to pass', () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- server/src/index.js: stale status label in toast copy
SUMMARY: Only minor issues were found.
=== REVIEW END ===`;

    const result = parseReviewResult(reviewText);

    expect(result.verdict).toBe('FAIL');
    expect(result.criticalIssues).toEqual([]);
    expect(result.minorIssues).toHaveLength(1);
    expect(reviewShouldPass(result)).toBe(true);
  });

  test('review with critical issues still fails', () => {
    const reviewText = `=== REVIEW START ===
VERDICT: FAIL
CRITICAL_ISSUES:
- server/src/orchestrator.js: review failures can loop indefinitely
MINOR_ISSUES:
- none
SUMMARY: A must-fix issue remains.
=== REVIEW END ===`;

    const result = parseReviewResult(reviewText);

    expect(result.hasCriticalIssues).toBe(true);
    expect(reviewShouldPass(result)).toBe(false);
  });

  test('placeholder review template is rejected', () => {
    const reviewText = `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- (issue description, or 'none')
SUMMARY: (2-3 sentences summarising the review)
=== REVIEW END ===`;

    const result = parseReviewResult(reviewText);

    expect(isReviewResultPlaceholder(reviewText, result)).toBe(true);
  });

  test('concrete review output is not treated as placeholder', () => {
    const reviewText = `=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- none
SUMMARY: Changed files: server/src/orchestrator.js, server/src/workflow.js. The review completion gate now rejects placeholder output and the branch otherwise looks consistent with existing task flow. Strengths: the change is narrowly scoped and adds regression coverage.
=== REVIEW END ===`;

    const result = parseReviewResult(reviewText);

    expect(isReviewResultPlaceholder(reviewText, result)).toBe(false);
  });

  test('plan placeholders are detected from default prompt scaffolding', () => {
    expect(isPlanPlaceholder(`=== PLAN START ===
SUMMARY: (one sentence describing what will be built)
BRANCH: feature/example
FILES_TO_MODIFY:
- path/to/file.ts (reason for modification)
STEPS:
1. (detailed, actionable step)
TESTS_NEEDED:
- (test description, or 'none')
RISKS:
- (potential issue or edge case, or 'none')
=== PLAN END ===`)).toBe(true);
  });

  test('review prompt template is detected as placeholder', () => {
    const templateText = `=== REVIEW START ===
VERDICT: PASS or FAIL
CRITICAL_ISSUES:
- concrete issue, or none
MINOR_ISSUES:
- concrete issue, or none
SUMMARY: 2-3 concrete sentences summarising the review, including changed files and strengths
=== REVIEW END ===`;
    expect(isReviewResultPlaceholder(templateText)).toBe(true);
  });

  test('blank and summary-free reviews are treated as placeholders', () => {
    expect(isReviewResultPlaceholder('')).toBe(true);
    expect(isReviewResultPlaceholder(`=== REVIEW START ===
VERDICT: PASS
CRITICAL_ISSUES:
- none
MINOR_ISSUES:
- none
SUMMARY:
=== REVIEW END ===`)).toBe(true);
  });

  test('concrete plans are not treated as placeholders', () => {
    expect(isPlanPlaceholder(`=== PLAN START ===
SUMMARY: Add automated tests for the workflow helpers.
BRANCH: feature/add-workflow-tests
FILES_TO_MODIFY:
- server/src/workflow.test.js (expand retry and placeholder coverage)
STEPS:
1. Add tests for retry status edge cases.
TESTS_NEEDED:
- Run npm run test --prefix server
RISKS:
- none
=== PLAN END ===`)).toBe(false);
  });

  test('real plan contaminated with echoed prompt template is not a placeholder', () => {
    // When Claude CLI echoes the prompt, terminal artifacts mix template
    // placeholder text into the real plan block after ANSI stripping.
    const contaminated = `=== PLAN START ===
after the delimiters: === PLAN START === SUMMARY: (one sentence describing what will be built) BRANCH: (feature/t-91eadd-short-descriptive-slug) FILES_TO_MODIFY: - path/to/file.ts (reason for modification) STEPS: 1. (detailed, actionable step) 2. (detailed, actionable step) TESTS_NEEDED: - (test description, or 'none') RISKS: - (potential issue or edge case, or 'none') === PLAN END ===
SUMMARY: Add a Reports modal accessible from the top bar that shows per-repo task counts, total time spent, and total tokens spent with visually stunning charts.
BRANCH: feature/t-91eadd-reports-dashboard
FILES_TO_MODIFY:
- client/src/ReportsModal.jsx (new reporting modal component)
- client/src/App.jsx (add reports button and modal state)
- server/src/index.js (add REST endpoint for aggregated task stats)
STEPS:
1. Create the ReportsModal component with per-repo breakdown.
2. Wire up the top-bar button in App.jsx.
3. Add GET /api/reports endpoint in index.js.
TESTS_NEEDED:
- Run npm run test to verify no regressions
RISKS:
- none
=== PLAN END ===`;
    expect(isPlanPlaceholder(contaminated)).toBe(false);
  });
});

describe('implementation placeholder detection', () => {
  test('echoed prompt template is detected as placeholder', () => {
    const template = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE {task.id} ===
  === IMPLEMENTATION RESULT END ===`;
    expect(isImplementationPlaceholder(template)).toBe(true);
  });

  test('blocked placeholder from prompt template is detected', () => {
    const template = `=== IMPLEMENTATION RESULT START ===
  === BLOCKED: {describe the blocker here} ===
  === IMPLEMENTATION RESULT END ===`;
    expect(isImplementationPlaceholder(template)).toBe(true);
  });

  test('real completion block is not a placeholder', () => {
    const real = `=== IMPLEMENTATION RESULT START ===
  === IMPLEMENTATION COMPLETE T-ABC123 ===
  === IMPLEMENTATION RESULT END ===`;
    expect(isImplementationPlaceholder(real)).toBe(false);
  });

  test('real blocked result is not a placeholder', () => {
    const real = `=== IMPLEMENTATION RESULT START ===
  === BLOCKED: npm install failed with EACCES ===
  === IMPLEMENTATION RESULT END ===`;
    expect(isImplementationPlaceholder(real)).toBe(false);
  });

  test('empty or blank text is a placeholder', () => {
    expect(isImplementationPlaceholder('')).toBe(true);
    expect(isImplementationPlaceholder('   ')).toBe(true);
    expect(isImplementationPlaceholder(null)).toBe(true);
  });

  test('block without completion or blocked marker is a placeholder', () => {
    const noise = `=== IMPLEMENTATION RESULT START ===
some random text without markers
=== IMPLEMENTATION RESULT END ===`;
    expect(isImplementationPlaceholder(noise)).toBe(true);
  });
});

describe('retry status resolution', () => {
  test('retry ignores stale assigned agent process from another task', () => {
    const task = {
      id: 'T-123',
      assignedTo: 'imp-1',
      blockedReason: 'Agent is awaiting user input',
      lastActiveStage: 'implementation',
    };
    const agentManager = {
      get(id) {
        expect(id).toBe('imp-1');
        return {
          id: 'imp-1',
          process: { pid: 1234 },
          currentTask: 'T-999',
        };
      },
    };

    const liveAgent = getLiveTaskAgent(task, agentManager);
    const retryStatus = stageToRetryStatus(task, { liveAgent, planningDisabled: false });

    expect(liveAgent).toBeNull();
    expect(retryStatus).toBe('queued');
  });

  test('retry reuses live agent only when it still owns the task', () => {
    const task = {
      id: 'T-123',
      assignedTo: 'imp-1',
      blockedReason: 'Agent is awaiting user input',
      lastActiveStage: 'implementation',
    };
    const liveAgentDef = {
      id: 'imp-1',
      process: { pid: 1234 },
      currentTask: 'T-123',
    };
    const agentManager = {
      get() {
        return liveAgentDef;
      },
    };

    const liveAgent = getLiveTaskAgent(task, agentManager);
    const retryStatus = stageToRetryStatus(task, { liveAgent, planningDisabled: false });

    expect(liveAgent).toBe(liveAgentDef);
    expect(retryStatus).toBe('implementing');
  });

  test('planning tasks return to approval when a plan already exists', () => {
    expect(stageToRetryStatus({
      lastActiveStage: 'planning',
      plan: 'ready',
      blockedReason: '',
    }, { planningDisabled: false })).toBe('awaiting_approval');
  });

  test('maximum review cycle blockers return to queue', () => {
    expect(stageToRetryStatus({
      lastActiveStage: 'review',
      blockedReason: 'Reached maximum review cycles for this task',
    }, { planningDisabled: false })).toBe('queued');
  });

  test('live planner and reviewer agents preserve their active stage', () => {
    expect(stageToRetryStatus({
      lastActiveStage: 'implementation',
      blockedReason: '',
    }, { liveAgent: { id: 'plan-1' }, planningDisabled: false })).toBe('planning');

    expect(stageToRetryStatus({
      lastActiveStage: 'implementation',
      blockedReason: '',
    }, { liveAgent: { id: 'rev-1' }, planningDisabled: false })).toBe('review');
  });

  test('planning-disabled tasks skip back to queue and backlog defaults respect planner availability', () => {
    expect(stageToRetryStatus({
      lastActiveStage: 'planning',
      plan: null,
      blockedReason: '',
    }, { planningDisabled: true })).toBe('queued');

    expect(stageToRetryStatus({
      lastActiveStage: null,
      blockedReason: '',
    }, { planningDisabled: false })).toBe('backlog');

    expect(stageToRetryStatus({
      lastActiveStage: null,
      blockedReason: '',
    }, { planningDisabled: true })).toBe('queued');
  });
});

describe('live agent lookup', () => {
  test('returns null when task has no assigned agent or no live process', () => {
    expect(getLiveTaskAgent({ assignedTo: null }, { get: () => null })).toBeNull();
    expect(getLiveTaskAgent({ assignedTo: 'imp-1', id: 'T-1' }, {
      get: () => ({ id: 'imp-1', process: null, currentTask: 'T-1' }),
    })).toBeNull();
  });
});

describe('agent stage helper', () => {
  test('maps known agent prefixes to stages', () => {
    expect(getAgentStage('plan-2')).toBe('planning');
    expect(getAgentStage('imp-2')).toBe('implementation');
    expect(getAgentStage('rev-2')).toBe('review');
    expect(getAgentStage('orch')).toBeNull();
  });
});
