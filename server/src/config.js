import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const DATA_DIR = join(rootDir, '.data');
const SETTINGS_FILE = join(DATA_DIR, 'config.json');

export const DEFAULT_WORKSPACES_DIR = join(DATA_DIR, 'workspaces');

let envVars = {};
try {
  const envPath = join(rootDir, '.env.local');
  const content = readFileSync(envPath, 'utf-8');
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
  IMPLEMENTOR_1_CLI: get('IMPLEMENTOR_1_CLI', 'claude'),
  IMPLEMENTOR_2_CLI: get('IMPLEMENTOR_2_CLI', 'codex'),
  ROOT_DIR: rootDir,
};

const DEFAULT_PROMPTS = {
  planning: `Produce a detailed step-by-step implementation plan.`,
  implementation: `Follow the plan step by step
- If required tools or dependencies are missing in the workspace, install them before continuing
- Commit after each logical unit of work with descriptive commit messages
- Run existing tests after implementation to verify nothing broke`,
  review: `1. Run: git diff main...{branch}
2. Review for: correctness, security vulnerabilities, code quality, test coverage, edge cases
3. Classify each issue as CRITICAL (blocks merge), MINOR (should fix), or STYLE (optional)
4. VERDICT must be PASS if there are zero CRITICAL issues`,
};

export function getDefaults() {
  return {
    repos: config.REPOS.length > 0 ? [...config.REPOS] : [],
    defaultRepoPath: config.REPOS[0] || '',
    workspaceRoot: DEFAULT_WORKSPACES_DIR,
    agents: {
      planners:     { max: 4, cli: 'claude' },
      implementors: { max: 8, cli: config.IMPLEMENTOR_1_CLI },
      reviewers:    { max: 4, cli: 'claude' },
    },
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
    }
  }

  data.prompts = {
    ...defaults.prompts,
    ...(data.prompts || {}),
  };

  return data;
}

export function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
      return normalizeSettingsShape(data);
    }
  } catch {
    // Fall through to defaults
  }
  return getDefaults();
}

export function saveSettings(settings) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(normalizeSettingsShape(settings), null, 2));
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

export { DEFAULT_PROMPTS };
export default config;
