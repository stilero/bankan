#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_FILE = join(ROOT, '.env.local');

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function dim(text) { return `\x1b[2m${text}\x1b[0m`; }
function green(text) { return `\x1b[32m${text}\x1b[0m`; }
function yellow(text) { return `\x1b[33m${text}\x1b[0m`; }
function red(text) { return `\x1b[31m${text}\x1b[0m`; }
function bold(text) { return `\x1b[1m${text}\x1b[0m`; }
function cyan(text) { return `\x1b[36m${text}\x1b[0m`; }

function checkCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getNodeVersion() {
  try {
    const ver = execSync('node --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    return parseInt(ver.replace('v', '').split('.')[0], 10);
  } catch {
    return 0;
  }
}

function loadExistingEnv() {
  const vars = {};
  try {
    if (existsSync(ENV_FILE)) {
      const content = readFileSync(ENV_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  } catch { /* ignore */ }
  return vars;
}

async function main() {
  console.clear();
  console.log('');
  console.log(cyan(bold('  ╔═══════════════════════════════════════╗')));
  console.log(cyan(bold('  ║         AI FACTORY  Setup             ║')));
  console.log(cyan(bold('  ╚═══════════════════════════════════════╝')));
  console.log('');
  console.log('  Local AI agent orchestration dashboard.');
  console.log('  This wizard will configure your environment.\n');

  // Step 1: Prerequisites
  console.log(bold('  Prerequisites\n'));

  const nodeVer = getNodeVersion();
  if (nodeVer < 18) {
    console.log(`  ${red('✗')} Node.js >= 18 required (found v${nodeVer})`);
    console.log(`    Install: ${dim('https://nodejs.org')}`);
    process.exit(1);
  }
  console.log(`  ${green('✓')} Node.js v${nodeVer}`);

  const tools = [
    { cmd: 'git', hint: 'Install via system package manager' },
    { cmd: 'claude', hint: 'npm install -g @anthropic-ai/claude-code' },
    { cmd: 'codex', hint: 'npm install -g @openai/codex' },
  ];

  let hasAnyCLI = false;
  for (const tool of tools) {
    if (checkCommand(tool.cmd)) {
      console.log(`  ${green('✓')} ${tool.cmd}`);
      if (tool.cmd === 'claude' || tool.cmd === 'codex') hasAnyCLI = true;
    } else {
      console.log(`  ${yellow('⚠')} ${tool.cmd} not found ${dim(`(${tool.hint})`)}`);
    }
  }

  if (!hasAnyCLI) {
    console.log(`\n  ${red('⚠')} Neither claude nor codex CLI found. At least one is required.\n`);
  }

  // Check native build tools
  const platform = process.platform;
  if (platform === 'darwin') {
    try {
      execSync('xcode-select -p', { stdio: 'pipe' });
      console.log(`  ${green('✓')} Xcode command line tools`);
    } catch {
      console.log(`  ${yellow('⚠')} Xcode CLI tools missing ${dim('(xcode-select --install)')}`);
    }
  } else if (platform === 'linux') {
    if (checkCommand('cc')) {
      console.log(`  ${green('✓')} C compiler`);
    } else {
      console.log(`  ${yellow('⚠')} C compiler missing ${dim('(apt install build-essential)')}`);
    }
  }

  console.log('');

  // Step 2: Load existing config
  const existing = loadExistingEnv();
  const config = { ...existing };

  // Step 3: Project Config
  console.log(bold('  Project Configuration\n'));

  const reposHint = existing.REPOS ? dim(` (${existing.REPOS}), Enter to keep`) : '';
  const reposAnswer = await ask(`  REPOS (comma-separated git repo paths)${reposHint}: `);
  if (reposAnswer.trim()) {
    config.REPOS = reposAnswer.trim();
  }

  if (config.REPOS) {
    const repoPaths = config.REPOS.split(',').map(s => s.trim()).filter(Boolean);
    for (const repoPath of repoPaths) {
      try {
        execSync(`git -C "${repoPath}" rev-parse HEAD`, { stdio: 'pipe' });
        console.log(`  ${green('✓')} ${repoPath} — valid git repo`);
      } catch {
        console.log(`  ${yellow('⚠')} ${repoPath} — not a git repo or no commits yet`);
      }
    }
  }

  const ghRepoHint = existing.GITHUB_REPO ? dim(` (${existing.GITHUB_REPO}), Enter to keep`) : dim(' (optional, owner/repo)');
  const ghRepoAnswer = await ask(`  GITHUB_REPO${ghRepoHint}: `);
  if (ghRepoAnswer.trim()) config.GITHUB_REPO = ghRepoAnswer.trim();

  const ghTokenHint = existing.GITHUB_TOKEN ? dim(' (already set, Enter to keep)') : dim(' (optional)');
  const ghTokenAnswer = await ask(`  GITHUB_TOKEN${ghTokenHint}: `);
  if (ghTokenAnswer.trim()) config.GITHUB_TOKEN = ghTokenAnswer.trim();

  console.log('');

  // Step 5: Agent Config
  console.log(bold('  Agent Configuration\n'));

  const imp1Default = existing.IMPLEMENTOR_1_CLI || 'claude';
  const imp1Answer = await ask(`  IMPLEMENTOR_1_CLI ${dim(`[${imp1Default}]`)}: `);
  config.IMPLEMENTOR_1_CLI = imp1Answer.trim() || imp1Default;

  const imp2Default = existing.IMPLEMENTOR_2_CLI || 'codex';
  const imp2Answer = await ask(`  IMPLEMENTOR_2_CLI ${dim(`[${imp2Default}]`)}: `);
  config.IMPLEMENTOR_2_CLI = imp2Answer.trim() || imp2Default;

  config.PORT = existing.PORT || '3001';

  console.log('');

  // Step 6: Write .env.local
  const envLines = [
    `REPOS=${config.REPOS || ''}`,
    `GITHUB_REPO=${config.GITHUB_REPO || ''}`,
    `GITHUB_TOKEN=${config.GITHUB_TOKEN || ''}`,
    `IMPLEMENTOR_1_CLI=${config.IMPLEMENTOR_1_CLI || 'claude'}`,
    `IMPLEMENTOR_2_CLI=${config.IMPLEMENTOR_2_CLI || 'codex'}`,
    `PORT=${config.PORT}`,
  ];
  writeFileSync(ENV_FILE, envLines.join('\n') + '\n');
  console.log(`  ${green('✓')} .env.local written\n`);

  // Step 7: Install Dependencies
  console.log(bold('  Installing dependencies...\n'));

  const installSteps = [
    { label: 'root', cmd: 'npm install' },
    { label: 'server', cmd: `npm install --prefix "${join(ROOT, 'server')}"` },
    { label: 'client', cmd: `npm install --prefix "${join(ROOT, 'client')}"` },
  ];

  for (const step of installSteps) {
    console.log(`  Installing ${step.label} dependencies...`);
    try {
      execSync(step.cmd, { cwd: ROOT, stdio: 'inherit' });
      console.log(`  ${green('✓')} ${step.label}\n`);
    } catch (err) {
      console.log(`  ${red('✗')} ${step.label} install failed. Try running manually: ${step.cmd}\n`);
    }
  }

  // Step 8: Success
  console.log('');
  console.log(green(bold('  ✓ Setup complete!')));
  console.log('');
  console.log('  To start:');
  console.log(cyan('    npm start'));
  console.log('');
  console.log(`  Then open: ${cyan('http://localhost:5173')}`);
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
