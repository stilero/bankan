import { afterEach, describe, expect, test, vi } from 'vitest';

const previousMode = process.env.BANKAN_RUNTIME_MODE;
const previousHome = process.env.BANKAN_HOME;

afterEach(() => {
  if (previousMode === undefined) {
    delete process.env.BANKAN_RUNTIME_MODE;
  } else {
    process.env.BANKAN_RUNTIME_MODE = previousMode;
  }

  if (previousHome === undefined) {
    delete process.env.BANKAN_HOME;
  } else {
    process.env.BANKAN_HOME = previousHome;
  }

  vi.resetModules();
});

describe('runtime path resolution', () => {
  test('uses repository .data in development mode', async () => {
    delete process.env.BANKAN_RUNTIME_MODE;
    delete process.env.BANKAN_HOME;
    vi.resetModules();

    const { getRuntimePaths } = await import('./paths.js');
    const paths = getRuntimePaths();

    expect(paths.packaged).toBe(false);
    expect(paths.dataDir.endsWith('/.data')).toBe(true);
    expect(paths.envFile.endsWith('/.env.local')).toBe(true);
  });

  test('uses BANKAN_HOME in packaged mode', async () => {
    process.env.BANKAN_RUNTIME_MODE = 'packaged';
    process.env.BANKAN_HOME = '/tmp/bankan-home';
    vi.resetModules();

    const { getAppDataDir, getEnvFilePath, getRuntimePaths } = await import('./paths.js');
    const paths = getRuntimePaths();

    expect(paths.packaged).toBe(true);
    expect(getAppDataDir()).toBe('/tmp/bankan-home');
    expect(getEnvFilePath()).toBe('/tmp/bankan-home/.env.local');
    expect(paths.bridgesDir.endsWith('/bankan/terminal-bridges')).toBe(true);
  });
});
