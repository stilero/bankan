import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

let factoryState;

const terminalDrawerMock = vi.fn();
const taskDetailModalMock = vi.fn();
const boardMock = vi.fn();

vi.mock('./useFactory.js', () => ({
  default: () => factoryState,
}));

vi.mock('./KanbanBoard.jsx', () => ({
  default: (props) => {
    boardMock(props);
    return (
      <div>
        <button onClick={() => props.onTaskClick(props.tasks[0])}>Open task</button>
        <button onClick={() => props.onAgentClick('imp-1')}>Open agent</button>
      </div>
    );
  },
}));

vi.mock('./TerminalDrawer.jsx', () => ({
  default: (props) => {
    terminalDrawerMock(props);
    return <button onClick={props.onClose}>Close drawer</button>;
  },
}));

vi.mock('./TaskDetailModal.jsx', () => ({
  default: (props) => {
    taskDetailModalMock(props);
    return (
      <div>
        <span>Task modal</span>
        <button onClick={props.onClose}>Close task</button>
      </div>
    );
  },
}));

vi.mock('./DirectoryPicker.jsx', () => ({
  default: ({ onSelect, onClose }) => (
    <div>
      <button onClick={() => onSelect('/tmp/workspaces')}>Pick directory</button>
      <button onClick={onClose}>Close picker</button>
    </div>
  ),
}));

import App from './App.jsx';

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    terminalDrawerMock.mockReset();
    taskDetailModalMock.mockReset();
    boardMock.mockReset();

    factoryState = {
      connected: true,
      isInitialized: true,
      agents: [{ id: 'imp-1', status: 'active' }, { id: 'orch', status: 'active' }],
      tasks: [{ id: 'T-1', status: 'blocked', title: 'Add tests', totalTokens: 1400, executionMode: 'workflow' }],
      repos: ['/repo-a', '/repo-b'],
      settings: {
        defaultRepoPath: '/repo-b',
        workspaceRoot: '/tmp/original',
        repos: ['/repo-a', '/repo-b'],
        maxReviewCycles: 3,
        agents: {
          planners: { max: 1, cli: 'claude', model: '' },
          implementors: { max: 2, cli: 'codex', model: '' },
          reviewers: { max: 1, cli: 'claude', model: '' },
        },
        prompts: {
          planning: 'Plan prompt',
          implementation: 'Implement prompt',
          review: 'Review prompt',
        },
      },
      notifications: [{ id: 1, type: 'warning', msg: 'Needs attention' }],
      addTask: vi.fn(),
      approvePlan: vi.fn(),
      rejectPlan: vi.fn(),
      pauseTask: vi.fn(),
      resumeTask: vi.fn(),
      editTask: vi.fn(),
      abortTask: vi.fn(),
      resetTask: vi.fn(),
      retryTask: vi.fn(),
      approveMaxReviewBlocker: vi.fn(),
      extendMaxReviewBlocker: vi.fn(),
      deleteTask: vi.fn(),
      openTaskWorkspace: vi.fn(),
      injectMessage: vi.fn(),
      sendRaw: vi.fn(),
      resizeTerminal: vi.fn(),
      pauseAgent: vi.fn(),
      resumeAgent: vi.fn(),
      updateSettings: vi.fn(),
      subscribeTerminal: vi.fn(),
      openAgentTerminal: vi.fn(),
      returnAgentTerminal: vi.fn(),
    };
  });

  test('renders stats, add-task modal, task modal, and terminal drawer interactions', () => {
    render(<App />);

    expect(screen.getByText(/Active/i).textContent).toContain('2/2');
    expect(screen.getByText(/Context/i).textContent).toContain('1.4k');
    expect(screen.getByText('Needs attention')).toBeTruthy();

    fireEvent.click(screen.getByText('+ ADD TASK'));
    fireEvent.change(screen.getByPlaceholderText('What needs to be built?'), {
      target: { value: 'Ship tests' },
    });
    fireEvent.click(screen.getByText('critical'));
    fireEvent.change(screen.getByPlaceholderText('Additional context...'), {
      target: { value: 'Focus on critical paths' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));

    expect(factoryState.addTask).toHaveBeenCalledWith(
      'Ship tests',
      'critical',
      'Focus on critical paths',
      '/repo-b'
    );

    fireEvent.click(screen.getByText('Open task'));
    expect(screen.getByText('Task modal')).toBeTruthy();
    fireEvent.click(screen.getByText('Close task'));

    fireEvent.click(screen.getByText('Open agent'));
    expect(screen.getByText('Close drawer')).toBeTruthy();
    fireEvent.click(screen.getByText('Close drawer'));
  });

  test('shows startup guidance when no repositories are configured', () => {
    factoryState.repos = [];
    factoryState.tasks = [];

    render(<App />);

    expect(screen.getByText('Welcome to Ban Kan')).toBeTruthy();
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.getByTitle(/Configure at least one repository/i).disabled).toBe(true);
  });

  test('shows blocked stats and allows settings cancel without applying', () => {
    factoryState.connected = false;
    factoryState.agents = [{ id: 'imp-1', status: 'blocked' }, { id: 'orch', status: 'active' }];

    render(<App />);

    expect(screen.getByText(/Blocked/i).textContent).toContain('1');
    expect(screen.getByTitle('Settings')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(factoryState.updateSettings).not.toHaveBeenCalled();
  });

  test('keeps application settings focused on repositories, shared capacity, and the default workflow', () => {
    factoryState.workflows = [{ id: 'standard', name: 'Standard Development', latestVersion: 3 }];
    factoryState.defaultWorkflow = { workflowId: 'standard', version: 2 };

    render(<App />);
    fireEvent.click(screen.getByTitle('Settings'));

    expect(screen.getByText('Shared capacity')).toBeTruthy();
    expect(screen.getByText(/Standard Development v2/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Planning' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Implementation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Configure Standard Development/ }));
    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeTruthy();
  });

  test('supports add-task cancel and enter-key submission', () => {
    render(<App />);

    fireEvent.click(screen.getByText('+ ADD TASK'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(factoryState.addTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('+ ADD TASK'));
    const titleInput = screen.getByPlaceholderText('What needs to be built?');
    fireEvent.change(titleInput, { target: { value: 'Keyboard submit' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    expect(factoryState.addTask).toHaveBeenCalledWith(
      'Keyboard submit',
      'medium',
      '',
      '/repo-b'
    );
  });

  test('creates a task with the exact pinned default workflow version', () => {
    factoryState.workflows = [{ id: 'standard', name: 'Standard', description: 'Plan, build, review.', latestVersion: 3 }];
    factoryState.defaultWorkflow = { workflowId: 'standard', version: 2 };
    render(<App />);

    fireEvent.click(screen.getByText('+ ADD TASK'));
    expect(screen.getByText(/snapshot Standard v2/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('What needs to be built?'), { target: { value: 'Pinned task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));

    expect(factoryState.addTask).toHaveBeenCalledWith('Pinned task', 'medium', '', '/repo-b', 'standard', 2);
  });

  test('resolves the workflow display name for task details', () => {
    factoryState.tasks[0] = {
      ...factoryState.tasks[0],
      workflowId: 'standard',
      workflowVersion: 2,
    };
    factoryState.workflows = [{ id: 'standard', name: 'Standard Development', latestVersion: 3 }];

    render(<App />);
    fireEvent.click(screen.getByText('Open task'));

    expect(taskDetailModalMock).toHaveBeenLastCalledWith(expect.objectContaining({
      task: expect.objectContaining({ workflowName: 'Standard Development', workflowVersion: 2 }),
    }));
  });

  test('keeps settings open and shows an acknowledged save error', async () => {
    factoryState.updateSettings.mockRejectedValueOnce(new Error('Settings could not be saved'));
    render(<App />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Settings could not be saved');
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  test('keeps settings invalid until workspace root is restored and updates default repo after removal', () => {
    render(<App />);

    fireEvent.click(screen.getByTitle('Settings'));

    const workspaceInput = screen.getByPlaceholderText('/path/to/workspaces');
    fireEvent.change(workspaceInput, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(true);

    fireEvent.change(workspaceInput, { target: { value: '/tmp/restored' } });
    fireEvent.click(screen.getAllByText('×')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(factoryState.updateSettings).toHaveBeenCalledWith({
      defaultRepoPath: '/repo-a',
      workspaceRoot: '/tmp/restored',
      repos: ['/repo-a'],
      maxReviewCycles: 3,
      agents: {
        planners: { max: 1, cli: 'claude', model: '' },
        implementors: { max: 2, cli: 'codex', model: '' },
        reviewers: { max: 1, cli: 'claude', model: '' },
      },
      prompts: {
        planning: 'Plan prompt',
        implementation: 'Implement prompt',
        review: 'Review prompt',
      },
    });
  });

  test('edits settings, browses workspace, and applies the updated configuration', () => {
    render(<App />);

    const settingsButton = screen.getByTitle('Settings');
    fireEvent.click(settingsButton);

    fireEvent.click(screen.getByText('Browse'));
    fireEvent.click(screen.getByText('Pick directory'));

    const repoInput = screen.getByPlaceholderText('https://github.com/org/repo');
    fireEvent.change(repoInput, { target: { value: '/repo-c' } });
    fireEvent.click(screen.getByText('Add Repo'));
    fireEvent.click(screen.getAllByText('×')[0]);

    const maxInput = screen.getByLabelText('planning provider capacity');
    fireEvent.change(maxInput, { target: { value: '3' } });

    fireEvent.click(screen.getByText('Apply'));

    expect(factoryState.updateSettings).toHaveBeenCalledWith({
      defaultRepoPath: '/repo-b',
      workspaceRoot: '/tmp/workspaces',
      repos: ['/repo-b', '/repo-c'],
      maxReviewCycles: 3,
      agents: {
        planners: { max: 3, cli: 'claude', model: '' },
        implementors: { max: 2, cli: 'codex', model: '' },
        reviewers: { max: 1, cli: 'claude', model: '' },
      },
      prompts: {
        planning: 'Plan prompt',
        implementation: 'Implement prompt',
        review: 'Review prompt',
      },
    });
  });

  test('shows preserved legacy behavior controls only while a legacy task needs them', () => {
    factoryState.tasks = [{ id: 'legacy-1', status: 'review', title: 'Legacy task', executionMode: 'legacy' }];
    render(<App />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('button', { name: 'Legacy compatibility' }));

    expect(screen.getByText('Compatibility configuration')).toBeTruthy();
    expect(screen.getByText(/New tasks do not/)).toBeTruthy();

    const cyclesInput = screen.getByTestId('max-review-cycles');
    expect(cyclesInput).toBeTruthy();
    expect(cyclesInput.value).toBe('3');

    fireEvent.change(cyclesInput, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(factoryState.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ maxReviewCycles: 5 })
    );
  });
});
