import { execFileSync } from 'node:child_process';

function canRunGhCommand(args) {
  try {
    execFileSync('gh', args, { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function getGithubCapabilities() {
  const ghAvailable = canRunGhCommand(['--version']);
  const ghAuthenticated = ghAvailable ? canRunGhCommand(['auth', 'status']) : false;

  return {
    ghAvailable,
    ghAuthenticated,
    canCreatePullRequests: ghAvailable && ghAuthenticated,
  };
}

export function isManualPullRequestRequired(capabilities = getGithubCapabilities()) {
  return !capabilities.canCreatePullRequests;
}
