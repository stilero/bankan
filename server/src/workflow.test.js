import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLiveTaskAgent,
  parseReviewResult,
  reviewShouldPass,
  stageToRetryStatus,
} from './workflow.js';

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

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.criticalIssues, []);
  assert.equal(result.minorIssues.length, 1);
  assert.equal(reviewShouldPass(result), true);
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

  assert.equal(result.hasCriticalIssues, true);
  assert.equal(reviewShouldPass(result), false);
});

test('retry ignores stale assigned agent process from another task', () => {
  const task = {
    id: 'T-123',
    assignedTo: 'imp-1',
    blockedReason: 'Agent is awaiting user input',
    lastActiveStage: 'implementation',
  };
  const agentManager = {
    get(id) {
      assert.equal(id, 'imp-1');
      return {
        id: 'imp-1',
        process: { pid: 1234 },
        currentTask: 'T-999',
      };
    },
  };

  const liveAgent = getLiveTaskAgent(task, agentManager);
  const retryStatus = stageToRetryStatus(task, { liveAgent, planningDisabled: false });

  assert.equal(liveAgent, null);
  assert.equal(retryStatus, 'queued');
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

  assert.equal(liveAgent, liveAgentDef);
  assert.equal(retryStatus, 'implementing');
});
