import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { getRuntimePaths } from './paths.js';

const runtimePaths = getRuntimePaths();

export const DEFAULT_WORKSPACES_DIR = runtimePaths.workspacesDir;

let envVars = {};
try {
  const content = readFileSync(runtimePaths.envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    envVars[key] = value;
  }
} catch {
  // .env.local not found, rely on process.env
}

function get(key, fallback = '') {
  return envVars[key] || process.env[key] || fallback;
}

const config = {
  PORT: parseInt(get('PORT', '3001'), 10),
  REPOS: get('REPOS').split(',').map(s => s.trim()).filter(Boolean),
  ROOT_DIR: runtimePaths.rootDir,
  DATA_DIR: runtimePaths.dataDir,
  CLIENT_DIST_DIR: runtimePaths.clientDistDir,
  BRIDGES_DIR: runtimePaths.bridgesDir,
  ENV_FILE: runtimePaths.envFile,
  PACKAGED_RUNTIME: runtimePaths.packaged,
};

function getLegacyImplementorCli() {
  const legacyCli = get('IMPLEMENTOR_1_CLI', '');
  return legacyCli === 'claude' || legacyCli === 'codex' ? legacyCli : 'claude';
}

// Canonical mapping of CLI providers to their supported models.
// Each model entry has a value (passed as --model / -m flag) and a label for the UI.
// An empty value means "use the CLI's default model" (no flag passed).
export const CLI_MODEL_MAP = {
  claude: [
    { value: '', label: 'Default (CLI default)' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6 (most intelligent)' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5 (fastest, cheapest)' },
  ],
  codex: [
    { value: '', label: 'Default (CLI default)' },
    { value: 'gpt-5.4', label: 'GPT-5.4 (flagship)' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex (best coding)' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark (fast)' },
  ],
};

export function isValidModelForCli(cli, model) {
  const models = CLI_MODEL_MAP[cli];
  if (!models) return false;
  return models.some(m => m.value === model);
}

const DEFAULT_PROMPTS = {
  planning: `Plan Mode Instructions

Core constraints:
- Do not edit files, change system state, or use non-readonly tools while planning
- Treat this stage as planning only; implementation happens after plan approval
- Focus on discovering reusable existing code before proposing new structures

Workflow:
1. Initial understanding
- Explore the codebase with the minimum investigation needed to understand the task
- Prioritize finding existing modules, helpers, patterns, and file locations that can be reused
2. Design
- Design the implementation approach in enough detail that another engineer can execute it without making product or architectural decisions
- Skip unnecessary complexity for trivial tasks, but still capture the concrete change and verification
3. Review
- Read the critical files needed to validate the design
- If prior plan feedback exists, incorporate it directly into the revised plan
4. Final plan
- Produce a plan that includes context, the recommended approach, critical file paths, reusable utilities or patterns, and verification
5. Exit
- End by returning the final plan in the required structured format only

Key rules:
- Ask for clarification only when a blocking unknown cannot be resolved from the repository context
- Do not ask for approval in free-form prose; the human approval flow happens outside your response
- Keep the plan specific, implementation-ready, and grounded in the current codebase`,
  implementation: `Follow the plan step by step
- If required tools or dependencies are missing in the workspace, install them before continuing
- Commit after each logical unit of work with descriptive commit messages
- Run existing tests after implementation to verify nothing broke
- After all work is done, make a final commit if there are any uncommitted changes`,
  review: `You are an expert code reviewer.

Step 1 — Gather the diff
- Run: git diff main
- Run: git diff --name-only main
- Review only the changes on the current branch versus main; do not flag pre-existing issues in unchanged code
- If a project rules file such as CLAUDE.md exists in the repository, read it and apply those rules during review

Step 2 — Review dimensions
- Correctness and bugs: check logic errors, edge cases, async misuse, null or undefined handling, and other behavioral regressions
- Project pattern compliance: verify changed code follows the repository's established architecture and avoids unnecessary abstractions or legacy patterns
- Test quality: verify tests meaningfully cover the changed behavior and relevant edge cases
- Silent failures and error handling: catch swallowed errors, missing propagation, and fallback values that can leak into user-visible behavior
- Code clarity and simplicity: prefer direct, maintainable code over over-engineered abstractions
- API and contract behavior: verify serialization, ordering, and other observable behavior remain intentional and consistent

Step 3 — Confidence scoring
- Score each potential issue from 0 to 100
- Only report issues with confidence 76 or higher
- Treat 91 to 100 as must-fix critical issues
- Treat 76 to 90 as important issues that should be fixed

Step 4 — Output requirements
- Include the changed files from git diff --name-only main in your review summary
- For each reported issue, include the file and line when possible, what is wrong, why it matters, and a concrete fix
- Include strengths observed in the branch
- Set VERDICT to PASS only when there are no critical issues`,
};

export function getDefaults() {
  return {
    repos: config.REPOS.length > 0 ? [...config.REPOS] : [],
    defaultRepoPath: config.REPOS[0] || '',
    workspaceRoot: DEFAULT_WORKSPACES_DIR,
    agents: {
      planners:     { max: 4, cli: 'claude', model: '' },
      implementors: { max: 8, cli: getLegacyImplementorCli(), model: '' },
      reviewers:    { max: 4, cli: 'claude', model: '' },
    },
    maxReviewCycles: 3,
    prompts: { ...DEFAULT_PROMPTS },
  };
}

function normalizeDefaultRepoPath(repos, defaultRepoPath) {
  if (!Array.isArray(repos) || repos.length === 0) return '';
  if (typeof defaultRepoPath === 'string' && repos.includes(defaultRepoPath)) {
    return defaultRepoPath;
  }
  return repos[0];
}

function normalizeSettingsShape(data) {
  const defaults = getDefaults();
  if (!Array.isArray(data.repos)) data.repos = defaults.repos;
  if (typeof data.workspaceRoot !== 'string' || !data.workspaceRoot.trim()) {
    data.workspaceRoot = typeof data.reposDir === 'string' && data.reposDir.trim()
      ? data.reposDir
      : defaults.workspaceRoot;
  }
  data.defaultRepoPath = normalizeDefaultRepoPath(data.repos, data.defaultRepoPath);

  for (const role of Object.keys(defaults.agents)) {
    if (!data.agents?.[role]) {
      data.agents = data.agents || {};
      data.agents[role] = defaults.agents[role];
    } else {
      delete data.agents[role].count;
      if (typeof data.agents[role].model !== 'string') {
        data.agents[role].model = '';
      }
    }
  }

  if (typeof data.maxReviewCycles !== 'number' || data.maxReviewCycles < 1) {
    data.maxReviewCycles = defaults.maxReviewCycles;
  }

  data.prompts = {
    ...defaults.prompts,
    ...(data.prompts || {}),
  };

  return data;
}

export function loadSettings() {
  try {
    if (existsSync(runtimePaths.settingsFile)) {
      const data = JSON.parse(readFileSync(runtimePaths.settingsFile, 'utf-8'));
      return normalizeSettingsShape(data);
    }
  } catch {
    // Fall through to defaults
  }
  return getDefaults();
}

export function saveSettings(settings) {
  mkdirSync(runtimePaths.dataDir, { recursive: true });
  writeFileSync(runtimePaths.settingsFile, JSON.stringify(normalizeSettingsShape(settings), null, 2));
}

export function validateSettings(settings) {
  const errors = [];
  if (!settings?.agents) {
    return ['Missing agents configuration'];
  }

  if (typeof settings.workspaceRoot !== 'string' || !settings.workspaceRoot.trim()) {
    errors.push('workspaceRoot is required');
  }

  if (!Array.isArray(settings.repos)) {
    errors.push('repos must be an array');
  }
  if (typeof settings.defaultRepoPath !== 'string') {
    errors.push('defaultRepoPath must be a string');
  } else if (Array.isArray(settings.repos) && settings.defaultRepoPath && !settings.repos.includes(settings.defaultRepoPath)) {
    errors.push('defaultRepoPath must match one of the configured repos');
  }

  const validClis = ['claude', 'codex'];
  const allowedRanges = {
    planners: { min: 0, max: 10 },
    implementors: { min: 1, max: 10 },
    reviewers: { min: 0, max: 10 },
  };

  for (const role of ['planners', 'implementors', 'reviewers']) {
    const cfg = settings.agents[role];
    if (!cfg) { errors.push(`Missing ${role} configuration`); continue; }

    const range = allowedRanges[role];
    if (typeof cfg.max !== 'number' || cfg.max < range.min || cfg.max > range.max) {
      errors.push(`${role}.max must be between ${range.min} and ${range.max}`);
    }
    if (!validClis.includes(cfg.cli)) {
      errors.push(`${role}.cli must be one of: ${validClis.join(', ')}`);
    }
    if (cfg.model !== undefined && typeof cfg.model !== 'string') {
      errors.push(`${role}.model must be a string`);
    } else if (typeof cfg.model === 'string' && validClis.includes(cfg.cli) && !isValidModelForCli(cfg.cli, cfg.model)) {
      errors.push(`${role}.model '${cfg.model}' is not valid for the '${cfg.cli}' CLI`);
    }
  }

  if (typeof settings.maxReviewCycles !== 'number' || settings.maxReviewCycles < 1 || settings.maxReviewCycles > 20) {
    errors.push('maxReviewCycles must be a number between 1 and 20');
  }

  if (!settings.prompts || typeof settings.prompts !== 'object') {
    errors.push('prompts configuration is required');
  } else {
    for (const stage of Object.keys(DEFAULT_PROMPTS)) {
      if (typeof settings.prompts[stage] !== 'string') {
        errors.push(`prompts.${stage} must be a string`);
      }
    }
  }

  return errors;
}

export function getWorkspacesDir(settings = loadSettings()) {
  return settings.workspaceRoot || settings.reposDir || DEFAULT_WORKSPACES_DIR;
}

export function getRuntimeStatePaths() {
  return { ...runtimePaths };
}

export { DEFAULT_PROMPTS };
export default config;
