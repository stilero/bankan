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
      '/api/tasks/T-1/workflow-run/decide',
      expect.objectContaining({ method: 'POST' })
    ));
  });

  test('explains effective step execution, artifacts, feedback loops, and named human choices', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      taskId: 'T-9', status: 'running', phase: 'Review', activeNodes: ['decision'], completedNodes: ['implement'],
      workflowSnapshot: {
        defaults: { provider: 'codex', model: 'gpt-5.4', effort: 'high' },
        nodes: [
          { id: 'implement', type: 'Agent', config: { label: 'Implement', purpose: 'Apply the approved plan', accessMode: 'write', inputs: [{ artifactType: 'plan' }] } },
          { id: 'decision', type: 'HumanDecision', config: { label: 'Review exhausted loop', purpose: 'Choose how to continue', choices: [
            { outcome: 'accept', label: 'Accept current work' },
            { outcome: 'extend', label: 'Add feedback and extend loop', requiresFeedback: true },
            { outcome: 'cancel', label: 'Cancel task' },
          ] } },
        ],
        edges: [{ id: 'fix', source: 'review', target: 'implement', outcome: 'changes_requested', feedbackArtifact: 'review-feedback', loop: { maxIterations: 3, exhaustionTarget: 'decision' } }],
      },
      actionableNodes: [{ nodeId: 'decision', type: 'HumanDecision', label: 'Review exhausted loop', action: 'decide', allowedOutcomes: ['accept', 'extend', 'cancel'] }],
      nodeRuns: [
        { nodeId: 'implement', attempt: 2, status: 'succeeded', input: { artifacts: [{ type: 'plan' }], feedback: { type: 'review-feedback', data: { summary: 'Handle empty input' } } }, output: { outcome: 'changes_requested' } },
        { nodeId: 'decision', attempt: 1, status: 'running', input: { exhaustion: { edgeId: 'fix', iteration: 4, limit: 3 } } },
      ],
      artifacts: [{ id: 'code-1', nodeId: 'implement', type: 'implementation', data: { summary: 'Input handled' } }],
      loopCounters: { fix: 3 },
      budgets: {},
    }) }));

    render(<LiveWorkflowGraph taskId="T-9" onBack={vi.fn()} />);

    expect(await screen.findByText('Apply the approved plan')).toBeTruthy();
    expect(screen.getByText(/Agent · codex · gpt-5.4 · high · write/)).toBeTruthy();
    expect(screen.getByText(/Attempt 2 · succeeded/)).toBeTruthy();
    expect(screen.getByText(/Inputs: plan/)).toBeTruthy();
    expect(screen.getByText(/Artifacts: implementation/)).toBeTruthy();
    expect(screen.getByText(/Outcome: changes requested/)).toBeTruthy();
    expect(screen.getByText(/Loop 3 of 3/)).toBeTruthy();
    expect(screen.getByText(/Returned with review-feedback: Handle empty input/)).toBeTruthy();
    expect(screen.getByText(/When exhausted: Review exhausted loop requires a human decision/)).toBeTruthy();
    expect(screen.getByText('Loop exhausted after 3 of 3 iterations; human decision required.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review exhausted loop: Accept current work' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review exhausted loop: Add feedback and extend loop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review exhausted loop: Cancel task' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Review exhausted loop feedback'), { target: { value: 'Address the remaining edge case' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review exhausted loop: Add feedback and extend loop' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/tasks/T-9/workflow-run/decide',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ nodeId: 'decision', outcome: 'extend', feedback: 'Address the remaining edge case' }),
      })
    ));
  });

  test('refreshes enriched actionable steps after submitting interview input', async () => {
    let reads = 0;
    global.fetch = vi.fn(async (_url, options = {}) => {
      if (options.method) return { ok: true, json: async () => ({ activeNodes: ['review'] }) };
      reads += 1;
      const reviewActive = reads > 1;
      return { ok: true, json: async () => ({
        taskId: 'T-refresh', status: 'running', phase: 'Intake',
        activeNodes: [reviewActive ? 'review' : 'input'], completedNodes: reviewActive ? ['input'] : [],
        workflowSnapshot: { nodes: [
          { id: 'input', type: 'Interview', config: { label: 'Gather input' } },
          { id: 'review', type: 'Approval', config: { label: 'Review result', choices: [{ outcome: 'changes', label: 'Request changes' }] } },
        ], edges: [] },
        actionableNodes: reviewActive
          ? [{ nodeId: 'review', type: 'Approval', label: 'Review result', action: 'decide', allowedOutcomes: ['changes'] }]
          : [{ nodeId: 'input', type: 'Interview', label: 'Gather input', action: 'submitInput', allowedOutcomes: ['success'] }],
        nodeRuns: [], artifacts: [], budgets: {},
      }) };
    });

    render(<LiveWorkflowGraph taskId="T-refresh" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Your response'), { target: { value: 'Ready for review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));

    expect(await screen.findByRole('button', { name: 'Review result: Request changes' })).toBeTruthy();
    expect(screen.queryByLabelText('Your response')).toBeNull();
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
