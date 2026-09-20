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

  test('edits workflow-owned defaults and identifies the published snapshot separately from the draft', async () => {
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 2 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({
        id: 'standard-development', name: 'Standard Development', description: 'Plan, build, review.', latestVersion: 2,
        definition: { schemaVersion: 2, defaults: { provider: 'codex', model: 'gpt-5', effort: 'medium', timeoutMs: 1800000, retry: { maxAttempts: 2 }, budgets: {} }, nodes: [], edges: [] },
      }) };
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    expect(await screen.findByText('Published v2 · immutable snapshot')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'gpt-5.1' } });
    fireEvent.change(screen.getByLabelText('Default timeout (minutes)'), { target: { value: '45' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/workflows/standard-development/draft', expect.objectContaining({
      body: expect.stringContaining('gpt-5.1'),
    })));
  });

  test('searches Step Templates and adds an independent configured copy', async () => {
    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.change(await screen.findByLabelText('Search Step Templates'), { target: { value: 'review' } });
    expect(screen.getByRole('button', { name: '+ Code Review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Security Review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Code Review' }));
    expect((await screen.findByLabelText('Agent Instructions')).value).toContain('Review');
    expect(screen.getByText('Copied from Code Review template')).toBeTruthy();
  });

  test('edits Agent behavior and structured inputs while explaining inherited and overridden configuration', async () => {
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 3 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({
        id: 'standard-development', name: 'Standard Development', latestVersion: 3,
        definition: { schemaVersion: 2, defaults: { provider: 'codex', model: 'gpt-5.4', effort: 'high', timeoutMs: 1800000, retry: { maxAttempts: 2 }, budgets: {} }, nodes: [{ id: 'plan', type: 'Agent', position: { x: 0, y: 0 }, config: { label: 'Plan', purpose: 'Make a plan.', agentInstructions: 'Create a plan.', accessMode: 'read', artifactBindings: ['task-input'], executionContract: { resultType: 'plan', outcomes: ['planned', 'failed'] } } }], edges: [] },
      }) };
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }));
    expect(screen.getByRole('heading', { name: 'Behavior' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Input and result' })).toBeTruthy();
    expect(screen.getByText('Codex · gpt-5.4 · high (inherited)')).toBeTruthy();
    expect(screen.getByText('System-owned contract: plan → planned, failed')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Agent Instructions'), { target: { value: 'Plan safely and cite risks.' } });
    fireEvent.change(screen.getByLabelText('Input Artifact bindings'), { target: { value: 'task-input, requirements' } });
    fireEvent.click(screen.getByLabelText('Override model'));
    fireEvent.change(screen.getByLabelText('Model override'), { target: { value: 'gpt-5.3-codex' } });
    expect(screen.getByText('Effective model: gpt-5.3-codex (override)')).toBeTruthy();
  });

  test('configures a deterministic Check Step with a visible result contract', async () => {
    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.click(await screen.findByRole('button', { name: '+ Test' }));
    expect(await screen.findByText('Deterministic Check Step')).toBeTruthy();
    expect(screen.getByLabelText('Check adapter').value).toBe('test');
    expect(screen.getByText('Produces check-result with outcomes pass, fail')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Check adapter'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom command'), { target: { value: 'npm run verify' } });
    expect(screen.getByLabelText('Custom command').value).toBe('npm run verify');
    expect(screen.getByText('Custom commands require explicit write access when they modify the workspace.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const body = JSON.parse(global.fetch.mock.calls.find(([url]) => url.endsWith('/draft'))[1].body);
      expect(body.definition.nodes.find(node => node.type === 'Check').config.command).toEqual(['npm', 'run', 'verify']);
    });
  });

  test('edits a bounded feedback Route as a sentence-like rule', async () => {
    global.fetch.mockImplementation(async url => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 2 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({
        id: 'standard-development', name: 'Standard Development', latestVersion: 2,
        definition: { schemaVersion: 2, defaults: {}, nodes: [
          { id: 'implement', type: 'Agent', config: { label: 'Implement' } },
          { id: 'review', type: 'Agent', config: { label: 'Code Review', executionContract: { resultType: 'review', outcomes: ['approved', 'changes_requested'] } } },
          { id: 'decision', type: 'HumanDecision', config: { label: 'Human Decision' } },
        ], edges: [{ id: 'changes', source: 'review', target: 'implement', outcome: 'changes_requested', loop: { feedbackArtifact: 'review', maxIterations: 3, exhaustionTarget: 'decision' } }] },
      }) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.click(await screen.findByRole('button', { name: 'Connection changes' }));
    expect(screen.getByText('When Code Review returns changes requested, go to Implement, include review, at most 3 times, then require Human Decision.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Maximum iterations'), { target: { value: '4' } });
    expect(screen.getByText(/at most 4 times/)).toBeTruthy();
  });

  test('navigates from validation findings to the affected Step and keeps warnings non-blocking', async () => {
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 2 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({ id: 'standard-development', name: 'Standard Development', latestVersion: 2, definition: { schemaVersion: 2, defaults: {}, nodes: [{ id: 'plan', type: 'Agent', config: { label: 'Plan', agentInstructions: '', artifactBindings: [], executionContract: { resultType: 'plan', outcomes: ['planned'] }, accessMode: 'read' } }], edges: [] } }) };
      if (url.endsWith('/validate')) return { ok: true, json: async () => ({ valid: true, errors: [], warnings: [{ message: 'Consider a more specific purpose', nodeId: 'plan' }] }) };
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.click(await screen.findByRole('button', { name: 'Validate draft' }));
    const warning = await screen.findByRole('button', { name: 'Consider a more specific purpose' });
    expect(screen.getByRole('button', { name: 'Publish' }).disabled).toBe(false);
    fireEvent.click(warning);
    expect(await screen.findByLabelText('Agent Instructions')).toBeTruthy();
  });

  test('previews primary, alternative, feedback-loop, and Human Decision paths before publication', async () => {
    global.fetch.mockImplementation(async url => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 1 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({ id: 'standard-development', name: 'Standard Development', latestVersion: 1, definition: { schemaVersion: 2, defaults: {}, nodes: [
        { id: 'input', type: 'Interview', config: { label: 'Gather Input' } },
        { id: 'plan', type: 'Agent', config: { label: 'Plan' } },
        { id: 'decision', type: 'HumanDecision', config: { label: 'Resolve exhausted loop' } },
        { id: 'done', type: 'Terminal', config: { label: 'Deliver', outcome: 'Success' } },
      ], edges: [
        { id: 'start', source: 'input', target: 'plan', outcome: 'submitted' },
        { id: 'success', source: 'plan', target: 'done', outcome: 'planned' },
        { id: 'alternative', source: 'plan', target: 'decision', outcome: 'cancelled', fallback: true },
        { id: 'feedback', source: 'decision', target: 'plan', outcome: 'extend', loop: { feedbackArtifact: 'human-feedback', maxIterations: 2, exhaustionTarget: 'decision' } },
      ] } }) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    expect(await screen.findByRole('heading', { name: 'Path preview' })).toBeTruthy();
    expect(screen.getByText('Primary: Gather Input → Plan → Deliver')).toBeTruthy();
    expect(screen.getByText('Alternative: Plan returns cancelled → Resolve exhausted loop')).toBeTruthy();
    expect(screen.getByText('Loop: Resolve exhausted loop → Plan · maximum 2 · then Resolve exhausted loop')).toBeTruthy();
    expect(screen.getByText('Human Decision: Resolve exhausted loop')).toBeTruthy();
  });

  test('keeps workflow name and description in the editable draft', async () => {
    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.change(await screen.findByLabelText('Workflow name'), { target: { value: 'Safer delivery' } });
    fireEvent.change(screen.getByLabelText('Workflow description'), { target: { value: 'Plan, check, and review changes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/workflows/standard-development/draft', expect.objectContaining({
      body: expect.stringContaining('Safer delivery'),
    })));
  });

  test('edits Workflow Default budgets and distinguishes inherited and overridden Agent budgets', async () => {
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (url === '/api/workflows') return { ok: true, json: async () => ({ workflows: [{ id: 'standard-development', name: 'Standard Development', latestVersion: 3 }] }) };
      if (url === '/api/workflows/standard-development') return { ok: true, json: async () => ({ id: 'standard-development', name: 'Standard Development', latestVersion: 3, definition: { schemaVersion: 2, defaults: { budgets: { tokens: 500000, costUsd: 100 } }, nodes: [{ id: 'plan', type: 'Agent', config: { label: 'Plan', agentInstructions: 'Plan.', artifactBindings: [], executionContract: { resultType: 'plan', outcomes: ['planned'] }, accessMode: 'read' } }], edges: [] } }) };
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected request ${url}`);
    });

    render(<WorkflowStudio onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Standard Development'));
    fireEvent.change(await screen.findByLabelText('Default token budget'), { target: { value: '600000' } });
    fireEvent.change(screen.getByLabelText('Default cost budget (USD)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByText('Effective budget: 600000 tokens · $120 (inherited)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Override budgets'));
    fireEvent.change(screen.getByLabelText('Token budget override'), { target: { value: '80000' } });
    fireEvent.change(screen.getByLabelText('Cost budget override (USD)'), { target: { value: '20' } });
    expect(screen.getByText('Effective budget: 80000 tokens · $20 (override)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const body = JSON.parse(global.fetch.mock.calls.find(([url]) => url.endsWith('/draft'))[1].body);
      expect(body.definition.defaults.budgets).toEqual({ tokens: 600000, costUsd: 120 });
      expect(body.definition.nodes[0].config.budgets).toEqual({ tokens: 80000, costUsd: 20 });
    });
  });
});
