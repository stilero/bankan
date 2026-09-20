import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    ReactFlow: ({ nodes }) => <div data-testid="workflow-canvas">{nodes.map(node => node.data.label).join(', ')}</div>,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useNodesState: value => {
      const [nodes, setNodes] = React.useState(value);
      return [nodes, setNodes, vi.fn()];
    },
    useEdgesState: value => {
      const [edges, setEdges] = React.useState(value);
      return [edges, setEdges, vi.fn()];
    },
  };
});

import WorkflowStudio from './WorkflowStudio.jsx';

describe('WorkflowStudio', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url, options = {}) => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 1, isDefault: true }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({
        id: 'standard-development',
        name: 'Standard Development',
        definition: { nodes: [{ id: 'intake', type: 'Phase', position: { x: 0, y: 0 }, config: { phase: 'Intake' } }], edges: [] },
      }) };
      if (url.endsWith('/validate')) return { ok: true, json: async () => ({ valid: true, errors: [] }) };
      if (url.endsWith('/publish')) return { ok: true, json: async () => ({ version: 2 }) };
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected request ${url}`);
    });
  });

  test('opens a published workflow in the visual editor and validates it before publishing', async () => {
    render(<WorkflowStudio onBack={vi.fn()} />);

    expect(await screen.findByText('Standard Development')).toBeTruthy();
    fireEvent.click(screen.getByText('Standard Development'));

    expect((await screen.findByTestId('workflow-canvas')).textContent).toContain('Phase: Intake');
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByText('Ready to publish')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/workflows/standard-development/publish',
      expect.objectContaining({ method: 'POST' })
    ));
  });
});
