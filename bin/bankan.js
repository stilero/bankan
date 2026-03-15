#!/usr/bin/env node

import { existsSync } from 'node:fs';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

function parseArgs(argv) {
  const args = { noOpen: false, port: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--no-open') {
      args.noOpen = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--port' || arg === '-p') {
      const value = argv[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error('`--port` expects a numeric value.');
      }
      args.port = parseInt(value, 10);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  process.stdout.write('Ban Kan\n\nUsage:\n  bankan [--port <number>] [--no-open]\n');
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function findAvailablePort(preferredPort, host, { exact = false } = {}) {
  if (exact) {
    const available = await isPortAvailable(preferredPort, host);
    if (!available) {
      throw new Error(`Port ${preferredPort} is already in use.`);
    }
    return preferredPort;
  }

  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }

  throw new Error(`Unable to find an open port near ${preferredPort}.`);
}

function openBrowser(url) {
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function runSetup() {
  execFileSync(process.execPath, [join(ROOT_DIR, 'scripts', 'setup.js')], {
    env: process.env,
    stdio: 'inherit',
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  process.env.BANKAN_RUNTIME_MODE = 'packaged';

  const { getRuntimePaths } = await import('../server/src/paths.js');
  const runtimePaths = getRuntimePaths();

  if (!existsSync(runtimePaths.clientDistDir)) {
    throw new Error('Built client assets are missing. Rebuild the package before publishing.');
  }

  if (!existsSync(runtimePaths.envFile) && !existsSync(runtimePaths.settingsFile)) {
    runSetup();
  }

  const { default: config } = await import('../server/src/config.js');
  const { startServer } = await import('../server/src/index.js');

  const host = '127.0.0.1';
  const preferredPort = args.port ?? config.PORT;
  const port = await findAvailablePort(preferredPort, host, { exact: args.port !== null });
  const { server, port: resolvedPort } = await startServer({ port, host });
  const url = `http://${host}:${resolvedPort}`;

  process.stdout.write(`Ban Kan available at ${url}\n`);

  if (!args.noOpen) {
    try {
      openBrowser(url);
    } catch (err) {
      process.stderr.write(`Failed to open browser automatically: ${err.message}\n`);
    }
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
