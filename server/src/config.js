import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

export function getDefaults() {
  return {
    agents: {
      planners:     { count: 1, max: 4, cli: 'claude' },
      implementors: { count: 2, max: 8, cli: config.IMPLEMENTOR_1_CLI },
      reviewers:    { count: 1, max: 4, cli: 'claude' },
    },
  };
}

export function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
      // Merge with defaults to ensure all keys exist
      const defaults = getDefaults();
      for (const role of Object.keys(defaults.agents)) {
        if (!data.agents?.[role]) {
          data.agents = data.agents || {};
          data.agents[role] = defaults.agents[role];
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

  const validClis = ['claude', 'codex'];
  let totalCount = 0;

  for (const role of ['planners', 'implementors', 'reviewers']) {
    const cfg = settings.agents[role];
    if (!cfg) { errors.push(`Missing ${role} configuration`); continue; }

    if (typeof cfg.count !== 'number' || cfg.count < 1) {
      errors.push(`${role}.count must be >= 1`);
    }
    if (typeof cfg.max !== 'number' || cfg.max < 1 || cfg.max > 10) {
      errors.push(`${role}.max must be between 1 and 10`);
    }
    if (cfg.count > cfg.max) {
      errors.push(`${role}.count cannot exceed max`);
    }
    if (!validClis.includes(cfg.cli)) {
      errors.push(`${role}.cli must be one of: ${validClis.join(', ')}`);
    }
    totalCount += cfg.count || 0;
  }

  if (totalCount > 10) {
    errors.push('Total agent count cannot exceed 10');
  }

  return errors;
}

export default config;
