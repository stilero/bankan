import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import DirectoryPicker from './DirectoryPicker.jsx';

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('DirectoryPicker', () => {
  test('loads the current directory, navigates, and selects a path', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current: '/workspace',
          parent: '/home',
          dirs: ['alpha', 'beta'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current: '/workspace/alpha',
          parent: '/workspace',
          dirs: ['nested'],
        }),
      });

    render(
      <DirectoryPicker
        initialPath="/workspace"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(await screen.findByText('alpha')).toBeTruthy();
    fireEvent.click(screen.getByText('alpha'));

    await screen.findByText('nested');
    fireEvent.click(screen.getByText('Select'));

    expect(onSelect).toHaveBeenCalledWith('/workspace/alpha');
  });

  test('shows API and connection errors', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Permission denied' }),
      })
      .mockRejectedValueOnce(new Error('offline'));

    const firstView = render(
      <DirectoryPicker
        initialPath="/forbidden"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );

    expect(await screen.findByText('Permission denied')).toBeTruthy();

    firstView.unmount();

    render(
      <DirectoryPicker
        initialPath="/offline"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to connect to server')).toBeTruthy();
    });
  });

  test('supports parent navigation, enter-key lookup, and overlay close', async () => {
    const onClose = vi.fn();

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current: '/workspace/project',
          parent: '/workspace',
          dirs: ['src'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current: '/workspace',
          parent: '/home',
          dirs: ['project'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current: '/custom',
          parent: '/home',
          dirs: [],
        }),
      });

    const { container } = render(
      <DirectoryPicker
        initialPath="/workspace/project"
        onSelect={() => {}}
        onClose={onClose}
      />
    );

    expect(await screen.findByText('(parent)')).toBeTruthy();
    fireEvent.click(screen.getByText('(parent)'));
    await screen.findByText('project');

    const input = screen.getByDisplayValue('/workspace');
    fireEvent.change(input, { target: { value: '/custom' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByDisplayValue('/custom');
    fireEvent.click(container.firstChild);

    expect(onClose).toHaveBeenCalled();
  });
});
