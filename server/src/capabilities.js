import { execFileSync } from 'node:child_process';

const CAPABILITIES_TTL_MS = 30_000;

let cachedCapabilities = null;
let cachedAt = 0;

function canRunGhCommand(args) {
  try {
    execFileSync('gh', args, { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function getGithubCapabilities() {
  const now = Date.now();
  if (cachedCapabilities && now - cachedAt < CAPABILITIES_TTL_MS) {
    return cachedCapabilities;
  }

  const ghAvailable = canRunGhCommand(['--version']);
  const ghAuthenticated = ghAvailable ? canRunGhCommand(['auth', 'status']) : false;

  cachedCapabilities = {
    ghAvailable,
    ghAuthenticated,
    canCreatePullRequests: ghAvailable && ghAuthenticated,
  };
  cachedAt = now;
  return cachedCapabilities;
}

export function isManualPullRequestRequired(capabilities = getGithubCapabilities()) {
  return !capabilities.canCreatePullRequests;
}

export function resetGithubCapabilitiesCache() {
  cachedCapabilities = null;
  cachedAt = 0;
}
