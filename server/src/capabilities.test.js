import { beforeEach, describe, expect, test, vi } from 'vitest';

const execFileSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

describe('GitHub capabilities', () => {
  beforeEach(async () => {
    vi.resetModules();
    execFileSyncMock.mockReset();
    const { resetGithubCapabilitiesCache } = await import('./capabilities.js');
    resetGithubCapabilitiesCache();
  });

  test('caches capability checks within the TTL', async () => {
    execFileSyncMock.mockImplementation(() => 'ok');
    const { getGithubCapabilities } = await import('./capabilities.js');

    const first = getGithubCapabilities();
    const second = getGithubCapabilities();

    expect(first).toEqual({
      ghAvailable: true,
      ghAuthenticated: true,
      canCreatePullRequests: true,
    });
    expect(second).toEqual(first);
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
  });

  test('recomputes capabilities after cache reset', async () => {
    execFileSyncMock
      .mockImplementationOnce(() => 'ok')
      .mockImplementationOnce(() => 'ok')
      .mockImplementationOnce(() => {
        throw new Error('gh missing');
      });
    const { getGithubCapabilities, resetGithubCapabilitiesCache } = await import('./capabilities.js');

    expect(getGithubCapabilities().canCreatePullRequests).toBe(true);
    resetGithubCapabilitiesCache();
    expect(getGithubCapabilities()).toEqual({
      ghAvailable: false,
      ghAuthenticated: false,
      canCreatePullRequests: false,
    });
  });
});
