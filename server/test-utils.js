import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

export function createRuntimeHarness() {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'bankan-test-'));
  const previousEnv = {
    BANKAN_RUNTIME_MODE: process.env.BANKAN_RUNTIME_MODE,
    BANKAN_HOME: process.env.BANKAN_HOME,
  };

  process.env.BANKAN_RUNTIME_MODE = 'packaged';
  process.env.BANKAN_HOME = runtimeDir;
  vi.resetModules();

  return {
    runtimeDir,
    async importModule(modulePath) {
      vi.resetModules();
      return import(`${modulePath}?test=${Date.now()}-${Math.random()}`);
    },
    cleanup() {
      if (previousEnv.BANKAN_RUNTIME_MODE === undefined) {
        delete process.env.BANKAN_RUNTIME_MODE;
      } else {
        process.env.BANKAN_RUNTIME_MODE = previousEnv.BANKAN_RUNTIME_MODE;
      }

      if (previousEnv.BANKAN_HOME === undefined) {
        delete process.env.BANKAN_HOME;
      } else {
        process.env.BANKAN_HOME = previousEnv.BANKAN_HOME;
      }

      rmSync(runtimeDir, { recursive: true, force: true });
      vi.resetModules();
    },
  };
}
