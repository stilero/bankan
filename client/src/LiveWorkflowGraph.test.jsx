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
        workflowName: 'Standard Development', workflowVersion: 2,
        actionableNodes: [
          { nodeId: 'interview', type: 'Interview', label: 'Describe request', action: 'submitInput', allowedOutcomes: ['success'] },
          { nodeId: 'plan', type: 'Approval', label: 'Approve plan', action: 'decide', allowedOutcomes: ['approved', 'changes_requested'] },
        ],
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
    expect(screen.getByText(/1,000 token budget/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause Task' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/tasks/T-1/workflow-run/pause',
      expect.objectContaining({ method: 'POST' })
    ));
    expect(screen.getByText('Standard Development v2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your response'), { target: { value: 'Build a safe guided flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/tasks/T-1/workflow-run/submitInput',
      expect.objectContaining({ method: 'POST' })
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan: approved' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/tasks/T-1/workflow-run/completeNode',
      expect.objectContaining({ method: 'POST' })
    ));
  });

  test('hides task controls after a run reaches a terminal state', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      taskId: 'T-2', status: 'succeeded', phase: 'Delivery', activeNodes: [], completedNodes: [],
      workflowSnapshot: { nodes: [], edges: [] }, actionableNodes: [], artifacts: [], budgets: {},
    }) }));
    render(<LiveWorkflowGraph taskId="T-2" onBack={vi.fn()} />);
    expect(await screen.findByText('Delivery')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause Task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel Task' })).toBeNull();
  });

  test('resumes a paused run and requires confirmation before cancelling', async () => {
    global.fetch = vi.fn(async (_url, options = {}) => ({ ok: true, json: async () => options.method ? {} : ({
      taskId: 'T-3', status: 'paused', phase: 'Review', activeNodes: [], completedNodes: [],
      workflowSnapshot: { nodes: [], edges: [] }, actionableNodes: [], artifacts: [], budgets: {},
    }) }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LiveWorkflowGraph taskId="T-3" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Task' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/tasks/T-3/workflow-run/resume', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Task' }));
    expect(global.fetch).not.toHaveBeenCalledWith('/api/tasks/T-3/workflow-run/cancel', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Task' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/tasks/T-3/workflow-run/cancel', expect.anything()));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
