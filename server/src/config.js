import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const DATA_DIR = join(rootDir, '.data');
const SETTINGS_FILE = join(DATA_DIR, 'config.json');

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
  GITHUB_REPO: get('GITHUB_REPO'),
  GITHUB_TOKEN: get('GITHUB_TOKEN'),
  IMPLEMENTOR_1_CLI: get('IMPLEMENTOR_1_CLI', 'claude'),
  IMPLEMENTOR_2_CLI: get('IMPLEMENTOR_2_CLI', 'codex'),
  ROOT_DIR: rootDir,
};

// Derive default reposDir from the first REPOS entry's parent, or project root
function defaultReposDir() {
  if (config.REPOS.length > 0) {
    return dirname(config.REPOS[0]);
  }
  return rootDir;
}

export function getDefaults() {
  return {
    reposDir: defaultReposDir(),
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
      // Ensure reposDir exists
      if (!data.reposDir) {
        data.reposDir = defaults.reposDir;
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

  if (typeof settings.reposDir !== 'string' || !settings.reposDir.trim()) {
    errors.push('Repos directory must be a non-empty string');
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

// Discover git repos in a directory
export function discoverRepos(dir) {
  if (!dir || !existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir);
    const repos = [];
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
        const gitDir = join(fullPath, '.git');
        if (existsSync(gitDir)) {
          repos.push(fullPath);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
    return repos.sort();
  } catch {
    return [];
  }
}

// Current repos list — discovered from reposDir setting, falling back to env REPOS
let currentRepos = config.REPOS.length > 0 ? [...config.REPOS] : [];

export function refreshRepos(reposDir) {
  const discovered = discoverRepos(reposDir);
  currentRepos = discovered.length > 0 ? discovered : config.REPOS;
}

export function getRepos() {
  return currentRepos;
}

// Initialize repos from saved settings
const initialSettings = loadSettings();
if (initialSettings.reposDir) {
  refreshRepos(initialSettings.reposDir);
}

export default config;
