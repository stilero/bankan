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

export function getDefaults() {
  return {
    repos: config.REPOS.length > 0 ? [...config.REPOS] : [],
    workspaceRoot: DEFAULT_WORKSPACES_DIR,
    agents: {
      planners:     { max: 4, cli: 'claude' },
      implementors: { max: 8, cli: config.IMPLEMENTOR_1_CLI },
      reviewers:    { max: 4, cli: 'claude' },
    },
  };
}

export function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
      const defaults = getDefaults();
      if (!Array.isArray(data.repos)) data.repos = defaults.repos;
      if (typeof data.workspaceRoot !== 'string' || !data.workspaceRoot.trim()) {
        data.workspaceRoot = typeof data.reposDir === 'string' && data.reposDir.trim()
          ? data.reposDir
          : defaults.workspaceRoot;
      }
      // Merge agent defaults
      for (const role of Object.keys(defaults.agents)) {
        if (!data.agents?.[role]) {
          data.agents = data.agents || {};
          data.agents[role] = defaults.agents[role];
        } else {
          // Remove legacy 'count' field if present
          delete data.agents[role].count;
        }
      }
      return data;
    }
  } catch {
    // Fall through to defaults
  }
  return getDefaults();
}

export function saveSettings(settings) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
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

  const validClis = ['claude', 'codex'];

  for (const role of ['planners', 'implementors', 'reviewers']) {
    const cfg = settings.agents[role];
    if (!cfg) { errors.push(`Missing ${role} configuration`); continue; }

    if (typeof cfg.max !== 'number' || cfg.max < 1 || cfg.max > 10) {
      errors.push(`${role}.max must be between 1 and 10`);
    }
    if (!validClis.includes(cfg.cli)) {
      errors.push(`${role}.cli must be one of: ${validClis.join(', ')}`);
    }
  }

  return errors;
}

export function getWorkspacesDir(settings = loadSettings()) {
  return settings.workspaceRoot || settings.reposDir || DEFAULT_WORKSPACES_DIR;
}

export default config;
