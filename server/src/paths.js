import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const APP_NAME = 'bankan';

function isPackagedRuntime() {
  return process.env.BANKAN_RUNTIME_MODE === 'packaged';
}

function getDefaultAppDataDir() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_NAME);
  }

  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), APP_NAME);
  }

  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), APP_NAME);
}

export function getRuntimePaths() {
  const packaged = isPackagedRuntime();
  const dataDir = packaged
    ? resolve(process.env.BANKAN_HOME || getDefaultAppDataDir())
    : join(ROOT_DIR, '.data');
  const tempRoot = packaged
    ? join(tmpdir(), APP_NAME)
    : dataDir;

  return {
    appName: APP_NAME,
    packaged,
    rootDir: ROOT_DIR,
    dataDir,
    envFile: packaged ? join(dataDir, '.env.local') : join(ROOT_DIR, '.env.local'),
    settingsFile: join(dataDir, 'config.json'),
    tasksFile: join(dataDir, 'tasks.json'),
    plansDir: join(dataDir, 'plans'),
    workspacesDir: join(dataDir, 'workspaces'),
    bridgesDir: join(tempRoot, 'terminal-bridges'),
    clientDistDir: join(ROOT_DIR, 'client', 'dist'),
  };
}

export function getAppDataDir() {
  return getRuntimePaths().dataDir;
}

export function getEnvFilePath() {
  return getRuntimePaths().envFile;
}
