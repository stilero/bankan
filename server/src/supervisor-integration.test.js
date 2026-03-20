import { describe, expect, test, vi, beforeEach } from 'vitest';

// Mock child_process before importing supervisor so runSupervisorQuery uses the mock
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock store to prevent filesystem access
vi.mock('./store.js', () => ({
  default: { appendLog: vi.fn() },
}));

import { execFile } from 'node:child_process';
import { evaluatePlan, evaluateReviewFailure } from './supervisor.js';

function supervisorOutput(decision, feedbackLabel, feedbackText) {
  return `=== SUPERVISOR DECISION START ===
DECISION: ${decision}
${feedbackLabel}: ${feedbackText}
=== SUPERVISOR DECISION END ===`;
}

function mockExecFileResponse(stdout) {
  execFile.mockImplementation((_cmd, _args, _opts, cb) => {
    cb(null, stdout);
    return { on: vi.fn() };
  });
}

function mockExecFileError(errorMessage) {
  execFile.mockImplementation((_cmd, _args, _opts, cb) => {
    cb(new Error(errorMessage), '');
    return { on: vi.fn() };
  });
}

const mockTask = { id: 'T-TEST01', title: 'Test task', description: 'A test', priority: 'medium', plan: 'Step 1: do stuff' };
const mockSettings = { agents: { planners: { cli: 'claude', model: '' } } };

describe('supervisor integration — plan approval', () => {
  beforeEach(() => vi.clearAllMocks());

  test('evaluatePlan returns APPROVE for valid APPROVE response', async () => {
    mockExecFileResponse(supervisorOutput('APPROVE', 'FEEDBACK', 'Plan looks solid.'));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('APPROVE');
    expect(result.feedback).toBe('Plan looks solid.');
  });

  test('evaluatePlan returns REJECT for valid REJECT response', async () => {
    mockExecFileResponse(supervisorOutput('REJECT', 'FEEDBACK', 'Missing tests.'));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('REJECT');
    expect(result.feedback).toBe('Missing tests.');
  });

  test('evaluatePlan returns ESCALATE for valid ESCALATE response', async () => {
    mockExecFileResponse(supervisorOutput('ESCALATE', 'FEEDBACK', 'Needs human review.'));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('ESCALATE');
  });

  test('evaluatePlan falls back to ESCALATE for invalid decision (RETRY is not valid for plans)', async () => {
    mockExecFileResponse(supervisorOutput('RETRY', 'FEEDBACK', 'Should not be allowed.'));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('ESCALATE');
    expect(result.feedback).toContain('Invalid supervisor decision: RETRY');
  });

  test('evaluatePlan falls back to ESCALATE for garbage decision', async () => {
    mockExecFileResponse(supervisorOutput('MAYBE', 'FEEDBACK', 'Not sure.'));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('ESCALATE');
    expect(result.feedback).toContain('Invalid supervisor decision: MAYBE');
  });

  test('evaluatePlan falls back to ESCALATE on CLI error', async () => {
    mockExecFileError('Command timed out');
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('ESCALATE');
    expect(result.feedback).toContain('Supervisor error');
  });

  test('evaluatePlan falls back to ESCALATE on unparseable output', async () => {
    mockExecFileResponse('Random garbage with no markers');
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result.decision).toBe('ESCALATE');
  });
});

describe('supervisor integration — review failure', () => {
  beforeEach(() => vi.clearAllMocks());

  test('evaluateReviewFailure returns RETRY with enhanced feedback', async () => {
    mockExecFileResponse(supervisorOutput('RETRY', 'ENHANCED_FEEDBACK', 'Fix the null checks.'));
    const result = await evaluateReviewFailure(mockTask, 'review output', 'null pointer', mockSettings);
    expect(result.decision).toBe('RETRY');
    expect(result.enhancedFeedback).toBe('Fix the null checks.');
  });

  test('evaluateReviewFailure returns ESCALATE for valid ESCALATE', async () => {
    mockExecFileResponse(supervisorOutput('ESCALATE', 'ENHANCED_FEEDBACK', 'Needs human input.'));
    const result = await evaluateReviewFailure(mockTask, 'review output', 'critical', mockSettings);
    expect(result.decision).toBe('ESCALATE');
  });

  test('evaluateReviewFailure falls back to ESCALATE for invalid decision (APPROVE not valid for reviews)', async () => {
    mockExecFileResponse(supervisorOutput('APPROVE', 'ENHANCED_FEEDBACK', 'Should not work.'));
    const result = await evaluateReviewFailure(mockTask, 'review output', 'issues', mockSettings);
    expect(result.decision).toBe('ESCALATE');
    expect(result.enhancedFeedback).toContain('Invalid supervisor decision: APPROVE');
  });

  test('evaluateReviewFailure falls back to ESCALATE for REJECT (not valid for reviews)', async () => {
    mockExecFileResponse(supervisorOutput('REJECT', 'ENHANCED_FEEDBACK', 'Should not work.'));
    const result = await evaluateReviewFailure(mockTask, 'review output', 'issues', mockSettings);
    expect(result.decision).toBe('ESCALATE');
    expect(result.enhancedFeedback).toContain('Invalid supervisor decision: REJECT');
  });

  test('evaluateReviewFailure falls back to ESCALATE on CLI error', async () => {
    mockExecFileError('Process killed');
    const result = await evaluateReviewFailure(mockTask, 'review output', 'issues', mockSettings);
    expect(result.decision).toBe('ESCALATE');
  });
});

describe('supervisor integration — result structure contract', () => {
  beforeEach(() => vi.clearAllMocks());

  test('evaluatePlan always returns { decision, feedback } strings', async () => {
    mockExecFileResponse(supervisorOutput('APPROVE', 'FEEDBACK', ''));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('feedback');
    expect(typeof result.decision).toBe('string');
    expect(typeof result.feedback).toBe('string');
  });

  test('evaluateReviewFailure always returns { decision, enhancedFeedback } strings', async () => {
    mockExecFileResponse(supervisorOutput('RETRY', 'ENHANCED_FEEDBACK', 'Fix it.'));
    const result = await evaluateReviewFailure(mockTask, 'text', 'issues', mockSettings);
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('enhancedFeedback');
    expect(typeof result.decision).toBe('string');
    expect(typeof result.enhancedFeedback).toBe('string');
  });

  test('evaluatePlan result decision is always one of APPROVE/REJECT/ESCALATE', async () => {
    // Even when CLI returns garbage, validation ensures valid decision
    mockExecFileResponse(supervisorOutput('INVALID', 'FEEDBACK', 'bad'));
    const result = await evaluatePlan(mockTask, mockSettings);
    expect(['APPROVE', 'REJECT', 'ESCALATE']).toContain(result.decision);
  });

  test('evaluateReviewFailure result decision is always one of RETRY/ESCALATE', async () => {
    mockExecFileResponse(supervisorOutput('INVALID', 'ENHANCED_FEEDBACK', 'bad'));
    const result = await evaluateReviewFailure(mockTask, 'text', 'issues', mockSettings);
    expect(['RETRY', 'ESCALATE']).toContain(result.decision);
  });
});
