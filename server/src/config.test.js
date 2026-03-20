import { afterEach, describe, expect, test } from 'vitest';

import { createRuntimeHarness } from '../test-utils.js';

let harness = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe('config settings lifecycle', () => {
  test('loadSettings falls back to defaults and normalizes repo selection', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    const defaults = configModule.getDefaults();
    expect(defaults.agents.planners.max).toBe(4);
    expect(configModule.loadSettings().defaultRepoPath).toBe(defaults.defaultRepoPath);
    expect(configModule.getWorkspacesDir()).toContain(harness.runtimeDir);
  });

  test('saveSettings persists normalized settings shape', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    configModule.saveSettings({
      repos: ['/repo-a', '/repo-b'],
      defaultRepoPath: '/missing',
      reposDir: '/legacy-root',
      workspaceRoot: '',
      agents: {
        planners: { max: 0, cli: 'claude', count: 1 },
        implementors: { max: 2, cli: 'codex', count: 8 },
        reviewers: { max: 1, cli: 'claude', count: 3 },
      },
      prompts: {
        implementation: 'Custom implementation prompt',
      },
    });

    const loaded = configModule.loadSettings();
    expect(loaded.defaultRepoPath).toBe('/repo-a');
    expect(loaded.workspaceRoot).toBe('/legacy-root');
    expect(loaded.agents.planners.count).toBeUndefined();
    expect(loaded.prompts.planning).toContain('Plan Mode Instructions');
    expect(loaded.prompts.implementation).toBe('Custom implementation prompt');
  });

  test('validateSettings reports invalid values across roles and prompts', async () => {
    harness = createRuntimeHarness();
    const { validateSettings } = await harness.importModule('./src/config.js');

    const errors = validateSettings({
      repos: ['/repo-a'],
      defaultRepoPath: '/repo-b',
      workspaceRoot: '',
      agents: {
        planners: { max: -1, cli: 'bad-cli' },
        implementors: { max: 0, cli: 'codex' },
        reviewers: { max: 11, cli: 'claude' },
      },
      prompts: {
        planning: 'ok',
        implementation: 12,
      },
    });

    expect(errors).toContain('workspaceRoot is required');
    expect(errors).toContain('defaultRepoPath must match one of the configured repos');
    expect(errors).toContain('planners.max must be between 0 and 10');
    expect(errors).toContain('planners.cli must be one of: claude, codex');
    expect(errors).toContain('implementors.max must be between 1 and 10');
    expect(errors).toContain('reviewers.max must be between 0 and 10');
    expect(errors).toContain('prompts.implementation must be a string');
    expect(errors).toContain('prompts.review must be a string');
  });

  test('getDefaults includes maxReviewCycles and normalizeSettingsShape corrects invalid values', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    const defaults = configModule.getDefaults();
    expect(defaults.maxReviewCycles).toBe(3);

    configModule.saveSettings({
      ...defaults,
      maxReviewCycles: -5,
    });
    const loaded = configModule.loadSettings();
    expect(loaded.maxReviewCycles).toBe(3);

    configModule.saveSettings({
      ...defaults,
      maxReviewCycles: 'bad',
    });
    expect(configModule.loadSettings().maxReviewCycles).toBe(3);

    configModule.saveSettings({
      ...defaults,
      maxReviewCycles: 10,
    });
    expect(configModule.loadSettings().maxReviewCycles).toBe(10);
  });

  test('validateSettings rejects out-of-range maxReviewCycles', async () => {
    harness = createRuntimeHarness();
    const { validateSettings, getDefaults } = await harness.importModule('./src/config.js');
    const base = {
      ...getDefaults(),
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
    };

    expect(validateSettings({ ...base, maxReviewCycles: 0 }))
      .toContain('maxReviewCycles must be a number between 1 and 20');
    expect(validateSettings({ ...base, maxReviewCycles: 21 }))
      .toContain('maxReviewCycles must be a number between 1 and 20');
    expect(validateSettings({ ...base, maxReviewCycles: 'bad' }))
      .toContain('maxReviewCycles must be a number between 1 and 20');
    expect(validateSettings({ ...base, maxReviewCycles: 5 }))
      .not.toContain('maxReviewCycles must be a number between 1 and 20');
  });

  test('reads env defaults for repos, port, and legacy implementor cli', async () => {
    harness = createRuntimeHarness();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${harness.runtimeDir}/.env.local`, [
      'PORT=4010',
      'REPOS=/repo-a,/repo-b',
      'IMPLEMENTOR_1_CLI=codex',
      '# comment',
      'MALFORMED',
    ].join('\n'));

    const configModule = await harness.importModule('./src/config.js');

    expect(configModule.default.PORT).toBe(4010);
    expect(configModule.default.REPOS).toEqual(['/repo-a', '/repo-b']);
    expect(configModule.getDefaults().agents.implementors.cli).toBe('codex');
  });

  test('defaults include model field for all agent roles', async () => {
    harness = createRuntimeHarness();
    const { getDefaults } = await harness.importModule('./src/config.js');
    const defaults = getDefaults();
    for (const role of ['planners', 'implementors', 'reviewers']) {
      expect(defaults.agents[role].model).toBe('');
    }
  });

  test('normalizeSettingsShape backfills missing model field', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    configModule.saveSettings({
      repos: ['/repo-a'],
      defaultRepoPath: '/repo-a',
      workspaceRoot: '/tmp/ws',
      agents: {
        planners: { max: 2, cli: 'claude' },
        implementors: { max: 4, cli: 'claude' },
        reviewers: { max: 2, cli: 'claude' },
      },
      prompts: {
        planning: 'p', implementation: 'i', review: 'r',
      },
    });

    const loaded = configModule.loadSettings();
    expect(loaded.agents.planners.model).toBe('');
    expect(loaded.agents.implementors.model).toBe('');
    expect(loaded.agents.reviewers.model).toBe('');
  });

  test('validateSettings accepts valid model strings and rejects non-strings', async () => {
    harness = createRuntimeHarness();
    const { validateSettings } = await harness.importModule('./src/config.js');

    const base = {
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
      maxReviewCycles: 3,
      agents: {
        planners: { max: 1, cli: 'claude', model: 'claude-haiku-4-5' },
        implementors: { max: 1, cli: 'claude', model: 'claude-opus-4-6' },
        reviewers: { max: 1, cli: 'claude', model: '' },
      },
      prompts: { planning: 'p', implementation: 'i', review: 'r' },
    };
    expect(validateSettings(base)).toEqual([]);

    const bad = JSON.parse(JSON.stringify(base));
    bad.agents.planners.model = 42;
    const errors = validateSettings(bad);
    expect(errors).toContain('planners.model must be a string');
  });

  test('validateSettings rejects models that do not belong to the selected CLI', async () => {
    harness = createRuntimeHarness();
    const { validateSettings } = await harness.importModule('./src/config.js');

    const mismatch = {
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
      maxReviewCycles: 3,
      agents: {
        planners: { max: 1, cli: 'codex', model: 'claude-haiku-4-5' },
        implementors: { max: 1, cli: 'claude', model: 'gpt-5.4' },
        reviewers: { max: 1, cli: 'codex', model: '' },
      },
      prompts: { planning: 'p', implementation: 'i', review: 'r' },
    };
    const errors = validateSettings(mismatch);
    expect(errors).toContain("planners.model 'claude-haiku-4-5' is not valid for the 'codex' CLI");
    expect(errors).toContain("implementors.model 'gpt-5.4' is not valid for the 'claude' CLI");
    expect(errors).not.toContain(expect.stringContaining('reviewers.model'));
  });

  test('validateSettings accepts valid codex models', async () => {
    harness = createRuntimeHarness();
    const { validateSettings } = await harness.importModule('./src/config.js');

    const valid = {
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
      maxReviewCycles: 3,
      agents: {
        planners: { max: 1, cli: 'codex', model: 'gpt-5.3-codex' },
        implementors: { max: 1, cli: 'codex', model: 'gpt-5.4' },
        reviewers: { max: 1, cli: 'claude', model: 'claude-sonnet-4-6' },
      },
      prompts: { planning: 'p', implementation: 'i', review: 'r' },
    };
    expect(validateSettings(valid)).toEqual([]);
  });

  test('returns early when agents are missing and validates repo types', async () => {
    harness = createRuntimeHarness();
    const { validateSettings } = await harness.importModule('./src/config.js');

    expect(validateSettings({})).toEqual(['Missing agents configuration']);
    expect(validateSettings({
      agents: {
        planners: { max: 0, cli: 'claude' },
        implementors: { max: 1, cli: 'codex' },
        reviewers: { max: 0, cli: 'claude' },
      },
      workspaceRoot: '/tmp/workspaces',
      repos: 'not-an-array',
      defaultRepoPath: 123,
      prompts: {},
    })).toContain('repos must be an array');
  });
});
