import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    addEdge: (edge, edges) => [...edges, edge],
    ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, onNodesChange, onEdgesChange, onConnect }) => <div data-testid="workflow-canvas">
      {nodes.map(node => <button key={node.id} onClick={() => onNodeClick?.({}, node)}>{node.data.label}</button>)}
      {edges.map(edge => <button key={edge.id} onClick={() => onEdgeClick?.({}, edge)}>Connection {edge.id}</button>)}
      <button onClick={() => onNodesChange?.([{ type: 'dimensions', id: nodes[0]?.id }])}>Simulate initialization</button>
      <button onClick={() => onNodesChange?.([{ type: 'position', id: nodes[0]?.id, dragging: false, position: { x: 10, y: 10 } }])}>Move node</button>
      <button onClick={() => onEdgesChange?.([{ type: 'remove', id: edges[0]?.id }])}>Remove edge</button>
      <button onClick={() => onConnect?.({ source: nodes[0]?.id, target: nodes[1]?.id })}>Connect steps</button>
    </div>,
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
    let createdName = 'Untitled workflow';
    global.fetch = vi.fn(async (url, options = {}) => {
      if (url === '/api/workflows' && !options.method) return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 1, isDefault: true }] }) };
      if (url === '/api/workflows' && options.method === 'POST') { createdName = JSON.parse(options.body).name; return { ok: true, json: async () => ({
        id: 'new-workflow', name: createdName, latestVersion: 0, definition: JSON.parse(options.body).definition,
      }) }; }
      if (url === '/api/workflows/new-workflow') return { ok: true, json: async () => ({ id: 'new-workflow', name: createdName, latestVersion: 0, definition: { schemaVersion: 1, nodes: [], edges: [] } }) };
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
    fireEvent.click(screen.getByRole('button', { name: 'Validate draft' }));
    expect(await screen.findByText('Ready to publish')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/workflows/standard-development/publish',
      expect.objectContaining({ method: 'POST' })
    ));
    expect(screen.getByText('Draft editor · published v2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' }).disabled).toBe(true);
  });

  test('shows workflow context and sets an exact published version as default', async () => {
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (url === '/api/workflows' && !options.method) return { ok: true, json: async () => ({
        workflows: [{ id: 'standard-development', name: 'Standard Development', description: 'Plan, build, and review.', latestVersion: 2 }],
        defaultWorkflow: { workflowId: 'standard-development', version: 1 },
      }) };
      if (url === '/api/workflows/default') return { ok: true, json: async () => ({ workflowId: 'standard-development', version: 2 }) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    expect(await screen.findByText('Plan, build, and review.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set v2 as default' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/workflows/default', expect.objectContaining({ method: 'PUT' })));
    expect(screen.getByText('Default v2')).toBeTruthy();
  });

  test('keeps publish disabled until the current saved draft validates and edits node settings', async () => {
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 1 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({
        id: 'standard-development', name: 'Standard Development',
        definition: { schemaVersion: 1, nodes: [{ id: 'plan', type: 'Agent', position: { x: 0, y: 0 }, config: { provider: 'codex', model: '', effort: 'medium', accessMode: 'read', timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } } }], edges: [] },
      }) };
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      if (url.endsWith('/validate')) return { ok: true, json: async () => ({ valid: true, errors: [] }) };
      if (url.endsWith('/publish')) return { ok: true, json: async () => ({ version: 2 }) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    const publish = await screen.findByRole('button', { name: 'Publish' });
    expect(publish.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'high' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: '← Workflows' }));
    expect(screen.getByText('Draft editor · published v—')).toBeTruthy();
    expect(confirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Validate draft' }));
    await waitFor(() => expect(publish.disabled).toBe(false));
  });

  test('does not mark React Flow initialization measurements as user edits', async () => {
    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate initialization' }));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save draft' }).disabled).toBe(true);
  });

  test('creates and configures steps and branching connections', async () => {
    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    await screen.findByRole('button', { name: 'Phase: Intake' });
    fireEvent.click(screen.getByRole('button', { name: '+ Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect steps' }));
    fireEvent.click(screen.getByRole('button', { name: /Connection edge-/ }));
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'approved' } });
    fireEvent.click(screen.getByLabelText('Fallback path'));
    fireEvent.click(screen.getByLabelText('Bounded loop'));
    fireEvent.change(screen.getByLabelText('Maximum iterations'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Exhaustion target'), { target: { value: 'intake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move node' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove edge' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  test('allows the user to explicitly discard draft changes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    await screen.findByRole('button', { name: 'Phase: Intake' });
    fireEvent.click(screen.getByRole('button', { name: '+ Terminal' }));
    fireEvent.click(screen.getByRole('button', { name: '← Workflows' }));
    expect(await screen.findByRole('heading', { name: 'Workflows' })).toBeTruthy();
  });

  test('creates a new draft and duplicates an existing workflow', async () => {
    const { unmount } = render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New workflow' }));
    expect(await screen.findByRole('heading', { name: 'Untitled workflow' })).toBeTruthy();
    unmount();
    global.fetch.mockClear();

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByRole('heading', { name: 'Standard Development copy' })).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith('/api/workflows', expect.objectContaining({ body: expect.stringContaining('Standard Development copy') }));
  });
});
