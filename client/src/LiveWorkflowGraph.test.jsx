import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }) => <div data-testid="live-canvas">{nodes.map(node => `${node.data.label}:${node.data.status}`).join(', ')}</div>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
}));

import LiveWorkflowGraph from './LiveWorkflowGraph.jsx';

describe('LiveWorkflowGraph', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url, options = {}) => {
      if (!options.method) return { ok: true, json: async () => ({
        taskId: 'T-1', status: 'running', phase: 'Planning', activeNodes: ['plan'], completedNodes: ['intake'],
        workflowSnapshot: { nodes: [{ id: 'intake', type: 'Phase', config: { phase: 'Intake' } }, { id: 'plan', type: 'Agent', config: {} }], edges: [] },
        artifacts: [{ id: 'a-1', type: 'brief', data: { summary: 'Build it' } }], budgets: { tokens: 1000 },
      }) };
      return { ok: true, json: async () => ({}) };
    });
  });

  test('shows durable run state, artifacts, budgets, and run controls', async () => {
    render(<LiveWorkflowGraph taskId="T-1" onBack={vi.fn()} />);

    expect(await screen.findByText('Planning')).toBeTruthy();
    expect(screen.getByTestId('live-canvas').textContent).toContain('Agent:running');
    expect(screen.getByText('brief')).toBeTruthy();
    expect(screen.getByText(/1,000 tokens/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause Task' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/tasks/T-1/workflow-run/pause',
      expect.objectContaining({ method: 'POST' })
    ));
  });
});
