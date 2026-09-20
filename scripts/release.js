import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');
const RELEASE_TYPES = new Set(['patch', 'minor', 'major']);

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

export function createCommandRunner({ cwd = repoRoot, log = console.log } = {}) {
  return {
    run(command, args = [], options = {}) {
      log(`> ${commandLabel(command, args)}`);
      const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || '').trim();
        throw new Error(`${commandLabel(command, args)} failed${detail ? `: ${detail}` : ''}`);
      }
      return (result.stdout || '').trim();
    },
  };
}

function readPackageMetadata() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8'));
}

export function getNextVersion(currentVersion, releaseType) {
  if (!RELEASE_TYPES.has(releaseType)) {
    throw new Error('Release type must be patch, minor, or major');
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion || '');
  if (!match) throw new Error(`Unsupported package version: ${currentVersion}`);
  const [, majorText, minorText, patchText] = match;
  let major = Number(majorText);
  let minor = Number(minorText);
  let patch = Number(patchText);
  if (releaseType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (releaseType === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function assertCleanSynchronizedMain(runner) {
  if (runner.run('git', ['status', '--porcelain'])) {
    throw new Error('Working tree must be clean before running a release command');
  }
  const branch = runner.run('git', ['branch', '--show-current']);
  if (branch !== 'main') throw new Error(`Release commands must run from main, not ${branch || 'detached HEAD'}`);
  runner.run('git', ['fetch', 'origin', 'main']);
  const localSha = runner.run('git', ['rev-parse', 'HEAD']);
  const remoteSha = runner.run('git', ['rev-parse', 'origin/main']);
  if (localSha !== remoteSha) {
    throw new Error('Local main is not synchronized with origin/main; update it with git pull --ff-only origin main');
  }
  runner.run('gh', ['auth', 'status']);
  return localSha;
}

export function prepareRelease(releaseType, options = {}) {
  const log = options.log || console.log;
  const runner = options.runner || createCommandRunner({ log });
  const currentVersion = options.currentVersion || readPackageMetadata().version;
  const version = getNextVersion(currentVersion, releaseType);
  const branch = `release/v${version}`;

  assertCleanSynchronizedMain(runner);
  runner.run('git', ['switch', '-c', branch]);
  runner.run('npm', ['version', version, '--no-git-tag-version'], { inherit: true });

  const verification = [
    ['npm', ['run', 'lint']],
    ['npm', ['test']],
    ['npm', ['run', 'coverage']],
    ['npm', ['run', 'build']],
    ['npm', ['pack', '--dry-run']],
  ];
  for (const [command, args] of verification) runner.run(command, args, { inherit: true });

  runner.run('git', ['add', 'package.json', 'package-lock.json']);
  runner.run('git', ['commit', '-m', `Bump version to ${version}`]);
  runner.run('git', ['push', '-u', 'origin', branch]);
  const pullRequestUrl = runner.run('gh', [
    'pr', 'create',
    '--base', 'main',
    '--head', branch,
    '--title', `Bump version to ${version}`,
    '--body', `Automated release preparation for v${version}. All release verification commands passed locally.`,
  ]);

  log(`Release PR created: ${pullRequestUrl}`);
  return { version, branch, pullRequestUrl };
}

export function publishRelease(options = {}) {
  const log = options.log || console.log;
  const runner = options.runner || createCommandRunner({ log });
  const metadata = options.currentVersion && options.packageName
    ? { version: options.currentVersion, name: options.packageName }
    : readPackageMetadata();
  const version = metadata.version;
  const tag = `v${version}`;
  const localSha = assertCleanSynchronizedMain(runner);

  const versionsOutput = runner.run('npm', ['view', metadata.name, 'versions', '--json']);
  const published = JSON.parse(versionsOutput || '[]');
  const versions = Array.isArray(published) ? published : [published];
  if (versions.includes(version)) throw new Error(`${metadata.name}@${version} is already published`);

  const remoteTag = runner.run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteTag) throw new Error(`Tag ${tag} already exists on origin`);

  const releaseUrl = runner.run('gh', [
    'release', 'create', tag,
    '--target', localSha,
    '--title', tag,
    '--generate-notes',
  ]);
  log(`GitHub release published: ${releaseUrl}`);
  log('The publish workflow is now running. Monitor it with: gh run list --workflow=publish.yml --limit=1');
  return { version, releaseUrl };
}

function printUsage() {
  console.log(`Usage:
  npm run release -- patch|minor|major
  npm run release:publish`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const [action, releaseType] = process.argv.slice(2);
  try {
    if (action === 'prepare') prepareRelease(releaseType);
    else if (action === 'publish') publishRelease();
    else {
      printUsage();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Release command failed: ${error.message}`);
    process.exitCode = 1;
  }
}
