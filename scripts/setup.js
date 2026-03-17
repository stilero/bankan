#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimePaths } from '../server/src/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_PACKAGED_RUNTIME = process.env.BANKAN_RUNTIME_MODE === 'packaged';
const runtimePaths = getRuntimePaths();
const ENV_FILE = runtimePaths.envFile;

const rl = createInterface({ input: process.stdin, output: process.stdout });

function dim(text) { return `\x1b[2m${text}\x1b[0m`; }
function green(text) { return `\x1b[32m${text}\x1b[0m`; }
function yellow(text) { return `\x1b[33m${text}\x1b[0m`; }
function red(text) { return `\x1b[31m${text}\x1b[0m`; }
function bold(text) { return `\x1b[1m${text}\x1b[0m`; }
function cyan(text) { return `\x1b[36m${text}\x1b[0m`; }

function checkCommand(cmd) {
  try {
    const check = process.platform === 'win32' ? `where.exe ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: 'pipe' });
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
  console.log(cyan(bold('  ║           BAN KAN Setup               ║')));
  console.log(cyan(bold('  ╚═══════════════════════════════════════╝')));
  console.log('');
  console.log('  Local AI agent orchestration dashboard.');
  console.log(`  This wizard will configure your environment${IS_PACKAGED_RUNTIME ? ' and save it under your user profile' : ''}.\n`);

  // Step 1: Prerequisites
  console.log(bold('  Prerequisites\n'));

  const nodeVer = getNodeVersion();
  if (nodeVer < 18) {
    console.log(`  ${red('✗')} Node.js >= 18 required (found v${nodeVer})`);
    console.log(`    Install: ${dim('https://nodejs.org')}`);
    process.exit(1);
  }
  console.log(`  ${green('✓')} Node.js v${nodeVer}`);

  // git is required — exit immediately if missing
  if (checkCommand('git')) {
    console.log(`  ${green('✓')} git`);
  } else {
    const gitUrl = process.platform === 'win32'
      ? 'https://git-scm.com/download/win'
      : 'https://git-scm.com/downloads';
    console.log(`  ${red('✗')} git not found`);
    console.log(`    Install: ${dim(gitUrl)}`);
    console.log(`\n  ${red('git is required — setup cannot continue without it.')}\n`);
    rl.close();
    process.exit(1);
  }

  // gh CLI (needed for PR creation)
  if (checkCommand('gh')) {
    console.log(`  ${green('✓')} gh`);
  } else {
    console.log(`  ${yellow('⚠')} gh not found ${dim('(needed for PR creation: https://cli.github.com/)')}`);
  }

  const cliTools = [
    { cmd: 'claude', hint: 'npm install -g @anthropic-ai/claude-code' },
    { cmd: 'codex', hint: 'npm install -g @openai/codex' },
  ];

  let hasAnyCLI = false;
  for (const tool of cliTools) {
    if (checkCommand(tool.cmd)) {
      console.log(`  ${green('✓')} ${tool.cmd}`);
      hasAnyCLI = true;
    } else {
      console.log(`  ${yellow('⚠')} ${tool.cmd} not found ${dim(`(${tool.hint})`)}`);
    }
  }

  if (!hasAnyCLI) {
    console.log(`\n  ${red('⚠')} Neither claude nor codex CLI found. At least one is required.`);
    console.log(`    ${dim('npm install -g @anthropic-ai/claude-code')}`);
    console.log(`    ${dim('npm install -g @openai/codex')}`);
    if (process.platform === 'win32') {
      console.log(`    ${dim('Note: you may need to restart your terminal after installing npm global packages.')}`);
    }
    console.log('');
  }

  if (!IS_PACKAGED_RUNTIME) {
    console.log(`  ${dim('Note: native build tools may be needed if npm has to compile node-pty during install.')}`);

    const platform = process.platform;
    if (platform === 'darwin') {
      try {
        execSync('xcode-select -p', { stdio: 'pipe' });
        console.log(`  ${green('✓')} Xcode command line tools available`);
      } catch {
        console.log(`  ${yellow('⚠')} Xcode CLI tools not found ${dim('(only needed if node-pty builds from source: xcode-select --install)')}`);
      }
    } else if (platform === 'linux') {
      if (checkCommand('cc')) {
        console.log(`  ${green('✓')} C compiler available`);
      } else {
        console.log(`  ${yellow('⚠')} C compiler not found ${dim('(only needed if node-pty builds from source: apt install build-essential)')}`);
      }
    } else if (platform === 'win32') {
      if (checkCommand('cl')) {
        console.log(`  ${green('✓')} MSVC compiler available`);
      } else {
        console.log(`  ${yellow('⚠')} MSVC compiler not found ${dim('(only needed if node-pty builds from source: install Visual Studio Build Tools)')}`);
      }
    }
  }

  console.log('');

  // Step 2: Load existing config
  const existing = loadExistingEnv();
  const config = { ...existing };

  // Step 3: Project Config
  console.log(bold('  Project Configuration\n'));
  console.log(`  ${dim('Repositories are configured in the app under Settings → General → Repositories.')}`);
  console.log(`  ${dim('Use the workspace folder in Settings to choose where task workspaces are created.')}`);
  console.log('');

  // Step 4: Runtime Config
  console.log(bold('  Runtime Configuration\n'));
  console.log(`  ${dim('Agent CLI selection is configured in the app under Settings.')}`);
  console.log('');

  config.PORT = existing.PORT || '3001';

  // Step 5: Write .env.local
  mkdirSync(runtimePaths.dataDir, { recursive: true });
  const envLines = [
    `PORT=${config.PORT}`,
  ];
  writeFileSync(ENV_FILE, envLines.join('\n') + '\n');
  console.log(`  ${green('✓')} Config written to ${ENV_FILE}\n`);

  if (IS_PACKAGED_RUNTIME) {
    console.log(green(bold('  ✓ Setup complete!')));
    console.log('');
    console.log(`  Configuration stored at: ${cyan(runtimePaths.dataDir)}`);
    console.log('');
    rl.close();
    return;
  }

  // Step 6: Install Dependencies
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
    } catch {
      console.log(`  ${red('✗')} ${step.label} install failed. Try running manually: ${step.cmd}\n`);
    }
  }

  // Step 7: Success
  console.log('');
  console.log(green(bold('  ✓ Setup complete!')));
  console.log('');
  console.log('  To start:');
  console.log(cyan('    npm start'));
  console.log('');
  console.log(`  Then open: ${cyan('http://localhost:5173')}`);
  console.log(`  Configure repositories in ${cyan('Settings → General → Repositories')}.`);
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
