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

  test('getDefaults includes maxPlanRejections and normalizeSettingsShape corrects invalid values', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    const defaults = configModule.getDefaults();
    expect(defaults.maxPlanRejections).toBe(3);

    configModule.saveSettings({ ...defaults, maxPlanRejections: -1 });
    expect(configModule.loadSettings().maxPlanRejections).toBe(3);

    configModule.saveSettings({ ...defaults, maxPlanRejections: 'bad' });
    expect(configModule.loadSettings().maxPlanRejections).toBe(3);

    configModule.saveSettings({ ...defaults, maxPlanRejections: 7 });
    expect(configModule.loadSettings().maxPlanRejections).toBe(7);
  });

  test('validateSettings rejects out-of-range maxPlanRejections', async () => {
    harness = createRuntimeHarness();
    const { validateSettings, getDefaults } = await harness.importModule('./src/config.js');
    const base = {
      ...getDefaults(),
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
    };

    expect(validateSettings({ ...base, maxPlanRejections: 0 }))
      .toContain('maxPlanRejections must be a number between 1 and 10');
    expect(validateSettings({ ...base, maxPlanRejections: 11 }))
      .toContain('maxPlanRejections must be a number between 1 and 10');
    expect(validateSettings({ ...base, maxPlanRejections: 5 }))
      .not.toContain('maxPlanRejections must be a number between 1 and 10');
    // undefined is allowed (backward compat)
    expect(validateSettings({ ...base, maxPlanRejections: undefined }))
      .not.toContain('maxPlanRejections must be a number between 1 and 10');
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

  test('defaults include supervisor with cli and model but no max', async () => {
    harness = createRuntimeHarness();
    const { getDefaults } = await harness.importModule('./src/config.js');
    const defaults = getDefaults();
    expect(defaults.agents.supervisor).toEqual({ cli: 'claude', model: '' });
    expect(defaults.agents.supervisor.max).toBeUndefined();
  });

  test('normalizeSettingsShape backfills missing supervisor entry', async () => {
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
      prompts: { planning: 'p', implementation: 'i', review: 'r' },
    });

    const loaded = configModule.loadSettings();
    expect(loaded.agents.supervisor).toEqual({ cli: 'claude', model: '' });
  });

  test('validateSettings validates supervisor cli and model', async () => {
    harness = createRuntimeHarness();
    const { validateSettings, getDefaults } = await harness.importModule('./src/config.js');
    const base = {
      ...getDefaults(),
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
    };

    // Valid supervisor config passes
    expect(validateSettings({
      ...base,
      agents: { ...base.agents, supervisor: { cli: 'claude', model: 'claude-haiku-4-5' } },
    })).toEqual([]);

    // Invalid CLI rejected
    expect(validateSettings({
      ...base,
      agents: { ...base.agents, supervisor: { cli: 'bad', model: '' } },
    })).toContain('supervisor.cli must be one of: claude, codex');

    // Model mismatch rejected
    expect(validateSettings({
      ...base,
      agents: { ...base.agents, supervisor: { cli: 'codex', model: 'claude-haiku-4-5' } },
    })).toContain("supervisor.model 'claude-haiku-4-5' is not valid for the 'codex' CLI");

    // Non-string model rejected
    expect(validateSettings({
      ...base,
      agents: { ...base.agents, supervisor: { cli: 'claude', model: 42 } },
    })).toContain('supervisor.model must be a string');
  });

  test('validateSettings accepts settings without supervisor entry (backward compat)', async () => {
    harness = createRuntimeHarness();
    const { validateSettings, getDefaults } = await harness.importModule('./src/config.js');
    const base = {
      ...getDefaults(),
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
    };
    const { supervisor: _supervisor, ...agentsWithoutSupervisor } = base.agents;
    const errors = validateSettings({ ...base, agents: agentsWithoutSupervisor });
    expect(errors).toEqual([]);
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

  test('normalizeSettingsShape resets invalid model values to empty string', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    configModule.saveSettings({
      repos: ['/repo-a'],
      defaultRepoPath: '/repo-a',
      workspaceRoot: '/tmp/ws',
      agents: {
        planners: { max: 2, cli: 'claude', model: 'haiku' },
        implementors: { max: 4, cli: 'codex', model: 'claude-opus-4-6' },
        reviewers: { max: 2, cli: 'claude', model: 'nonexistent' },
        supervisor: { cli: 'claude', model: 'bad-model' },
      },
      prompts: { planning: 'p', implementation: 'i', review: 'r' },
    });

    const loaded = configModule.loadSettings();
    expect(loaded.agents.planners.model).toBe('');
    expect(loaded.agents.implementors.model).toBe('');
    expect(loaded.agents.reviewers.model).toBe('');
    expect(loaded.agents.supervisor.model).toBe('');
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

  test('getDefaults includes autopilotMode and normalizeSettingsShape corrects invalid values', async () => {
    harness = createRuntimeHarness();
    const configModule = await harness.importModule('./src/config.js');

    const defaults = configModule.getDefaults();
    expect(defaults.autopilotMode).toBe('manual');

    // Invalid string falls back to default
    configModule.saveSettings({ ...defaults, autopilotMode: 'invalid' });
    expect(configModule.loadSettings().autopilotMode).toBe('manual');

    // Missing field falls back to default
    configModule.saveSettings({ ...defaults, autopilotMode: undefined });
    expect(configModule.loadSettings().autopilotMode).toBe('manual');

    // Valid values are preserved
    for (const mode of ['manual', 'autopilot', 'hybrid']) {
      configModule.saveSettings({ ...defaults, autopilotMode: mode });
      expect(configModule.loadSettings().autopilotMode).toBe(mode);
    }
  });

  test('validateSettings rejects invalid autopilotMode', async () => {
    harness = createRuntimeHarness();
    const { validateSettings, getDefaults } = await harness.importModule('./src/config.js');
    const base = {
      ...getDefaults(),
      repos: ['/repo'],
      defaultRepoPath: '/repo',
      workspaceRoot: '/tmp/ws',
    };

    expect(validateSettings({ ...base, autopilotMode: 'bad' }))
      .toContain('autopilotMode must be one of: manual, autopilot, hybrid');
    expect(validateSettings({ ...base, autopilotMode: 'autopilot' }))
      .not.toContain('autopilotMode must be one of: manual, autopilot, hybrid');
    // undefined is allowed (treated as manual)
    expect(validateSettings({ ...base, autopilotMode: undefined }))
      .not.toContain('autopilotMode must be one of: manual, autopilot, hybrid');
  });

  test('exports VALID_AUTOPILOT_MODES with expected values', async () => {
    harness = createRuntimeHarness();
    const { VALID_AUTOPILOT_MODES } = await harness.importModule('./src/config.js');
    expect(VALID_AUTOPILOT_MODES).toEqual(['manual', 'autopilot', 'hybrid']);
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
