import { describe, expect, test, vi } from 'vitest';

import {
  extractPlannerPlanText,
  extractReviewerReviewText,
} from './orchestrator.js';

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
});
