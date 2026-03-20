import { describe, expect, test } from 'vitest';

import { parseDecisionBlock } from './supervisor.js';

describe('supervisor decision parsing', () => {
  test('parses APPROVE decision with feedback', () => {
    const output = `Some preamble text...
=== SUPERVISOR DECISION START ===
DECISION: APPROVE
FEEDBACK: Plan is well-structured and addresses all requirements.
=== SUPERVISOR DECISION END ===
Some trailing text...`;

    const result = parseDecisionBlock(output);
    expect(result).toEqual({
      decision: 'APPROVE',
      feedback: 'Plan is well-structured and addresses all requirements.',
    });
  });

  test('parses REJECT decision', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: REJECT
FEEDBACK: Missing test coverage for edge cases.
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('REJECT');
    expect(result.feedback).toBe('Missing test coverage for edge cases.');
  });

  test('parses ESCALATE decision', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: ESCALATE
FEEDBACK: Task requires architectural decision beyond scope.
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('ESCALATE');
  });

  test('parses RETRY decision with ENHANCED_FEEDBACK', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: RETRY
ENHANCED_FEEDBACK: Fix the null check in parseConfig and add validation for empty inputs.
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('RETRY');
    expect(result.feedback).toContain('Fix the null check');
  });

  test('normalizes decision to uppercase', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: approve
FEEDBACK: Looks good.
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('APPROVE');
  });

  test('returns null for missing markers', () => {
    expect(parseDecisionBlock('no markers here')).toBeNull();
    expect(parseDecisionBlock('=== SUPERVISOR DECISION START === no end')).toBeNull();
  });

  test('returns null for missing DECISION line', () => {
    const output = `=== SUPERVISOR DECISION START ===
FEEDBACK: No decision line present.
=== SUPERVISOR DECISION END ===`;

    expect(parseDecisionBlock(output)).toBeNull();
  });

  test('captures multi-line feedback without truncation', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: REJECT
FEEDBACK: The plan has several issues:
1. Missing error handling for the API endpoint
2. No test coverage for edge cases
3. The branch name does not follow conventions

Please address all of the above before re-submitting.
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('REJECT');
    expect(result.feedback).toContain('1. Missing error handling');
    expect(result.feedback).toContain('2. No test coverage');
    expect(result.feedback).toContain('3. The branch name');
    expect(result.feedback).toContain('Please address all of the above');
  });

  test('captures multi-line ENHANCED_FEEDBACK without truncation', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: RETRY
ENHANCED_FEEDBACK: Fix the following critical issues:
- The null check in parseConfig is missing
- Add validation for empty inputs
- Ensure the error message is user-friendly
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('RETRY');
    expect(result.feedback).toContain('The null check in parseConfig is missing');
    expect(result.feedback).toContain('Add validation for empty inputs');
    expect(result.feedback).toContain('Ensure the error message is user-friendly');
  });

  test('returns empty feedback when no FEEDBACK line', () => {
    const output = `=== SUPERVISOR DECISION START ===
DECISION: APPROVE
=== SUPERVISOR DECISION END ===`;

    const result = parseDecisionBlock(output);
    expect(result.decision).toBe('APPROVE');
    expect(result.feedback).toBe('');
  });
});
