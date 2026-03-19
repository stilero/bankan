import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import useFactory from './useFactory.js';

class WebSocketMock {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = WebSocketMock.CONNECTING;
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    WebSocketMock.instances.push(this);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = WebSocketMock.OPEN;
    this.onopen?.();
  }

  emit(type, payload) {
    this.onmessage?.({
      data: JSON.stringify({ type, payload, ts: Date.now() }),
    });
  }
}

describe('useFactory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    WebSocketMock.instances = [];
    global.WebSocket = WebSocketMock;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete global.WebSocket;
  });

  test('connects, initializes state, and dispatches task commands', () => {
    const { result } = renderHook(() => useFactory());
    const socket = WebSocketMock.instances[0];

    expect(socket.url).toContain('ws://');

    act(() => {
      socket.open();
      socket.emit('INIT', {
        tasks: [{ id: 'T-1', status: 'backlog' }],
        agents: [{ id: 'orch', status: 'active' }],
        repos: ['/repo'],
        settings: { defaultRepoPath: '/repo' },
        capabilities: { ghAvailable: true, ghAuthenticated: true, canCreatePullRequests: true },
      });
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.isInitialized).toBe(true);
    expect(result.current.tasks).toEqual([{ id: 'T-1', status: 'backlog' }]);
    expect(result.current.agents).toEqual([{ id: 'orch', status: 'active' }]);
    expect(result.current.repos).toEqual(['/repo']);
    expect(result.current.settings).toEqual({ defaultRepoPath: '/repo' });
    expect(result.current.capabilities).toEqual({
      ghAvailable: true,
      ghAuthenticated: true,
      canCreatePullRequests: true,
    });

    act(() => {
      result.current.addTask('Add tests', 'high', 'Critical path', '/repo');
      result.current.approvePlan('T-1');
      result.current.updateSettings({ repos: ['/repo'] });
    });

    expect(socket.sent.map(message => message.type)).toEqual([
      'ADD_TASK',
      'APPROVE_PLAN',
      'UPDATE_SETTINGS',
    ]);
  });

  test('tracks agent updates, notifications, and terminal subscriptions', () => {
    const { result } = renderHook(() => useFactory());
    const socket = WebSocketMock.instances[0];
    const terminalCallback = vi.fn();

    act(() => {
      socket.open();
      socket.emit('INIT', {
        tasks: [],
        agents: [{ id: 'imp-1', status: 'idle' }],
        repos: [],
        settings: {},
        capabilities: { ghAvailable: true, ghAuthenticated: true, canCreatePullRequests: true },
      });
    });

    let unsubscribe;
    act(() => {
      unsubscribe = result.current.subscribeTerminal('imp-1', terminalCallback);
    });

    expect(socket.sent.at(-1)).toMatchObject({
      type: 'SUBSCRIBE_TERMINAL',
      payload: { agentId: 'imp-1' },
    });

    act(() => {
      socket.emit('AGENT_UPDATED', {
        agent: { id: 'imp-1', status: 'active' },
      });
      socket.emit('AGENT_UPDATED', {
        agent: { id: 'rev-1', status: 'idle' },
      });
      socket.emit('TASK_BLOCKED', {
        taskId: 'T-9',
        reason: 'Waiting for credentials',
      });
      socket.emit('TERMINAL_DATA', {
        agentId: 'imp-1',
        data: 'stdout',
      });
    });

    expect(result.current.agents).toEqual([
      { id: 'imp-1', status: 'active' },
      { id: 'rev-1', status: 'idle' },
    ]);
    expect(result.current.notifications[0].msg).toContain('T-9 blocked');
    expect(terminalCallback).toHaveBeenCalledWith('stdout');

    act(() => {
      unsubscribe();
    });

    expect(socket.sent.at(-1)).toMatchObject({
      type: 'UNSUBSCRIBE_TERMINAL',
      payload: { agentId: 'imp-1' },
    });
  });

  test('reconnects after socket close and resubscribes terminal listeners', () => {
    const { result, unmount } = renderHook(() => useFactory());
    const firstSocket = WebSocketMock.instances[0];

    act(() => {
      firstSocket.open();
      result.current.subscribeTerminal('imp-2', vi.fn());
      firstSocket.close();
    });

    expect(result.current.connected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const secondSocket = WebSocketMock.instances[1];
    act(() => {
      secondSocket.open();
    });

    expect(secondSocket.sent.at(-1)).toMatchObject({
      type: 'SUBSCRIBE_TERMINAL',
      payload: { agentId: 'imp-2' },
    });

    unmount();
    expect(secondSocket.closed).toBe(true);
  });

  test('caps notifications at five and removes them after timeout', () => {
    const { result } = renderHook(() => useFactory());
    const socket = WebSocketMock.instances[0];

    act(() => {
      socket.open();
      socket.emit('INIT', { tasks: [], agents: [], repos: [], settings: {} });
      for (let index = 0; index < 6; index += 1) {
        socket.emit('TASK_RESET', { taskId: `T-${index}` });
      }
    });

    expect(result.current.notifications).toHaveLength(5);
    expect(result.current.notifications[0].msg).toContain('T-5');

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  test('handles additional websocket event types and exposes all command helpers', () => {
    const { result } = renderHook(() => useFactory());
    const socket = WebSocketMock.instances[0];

    act(() => {
      socket.open();
      socket.emit('INIT', {
        tasks: [{ id: 'T-1', plan: null }],
        agents: [{ id: 'imp-1', status: 'idle' }],
        repos: ['/repo-a'],
        settings: { repos: ['/repo-a'] },
        capabilities: { ghAvailable: true, ghAuthenticated: true, canCreatePullRequests: true },
      });
      socket.emit('TASKS_UPDATED', { tasks: [{ id: 'T-2', status: 'queued' }] });
      socket.emit('TASK_ADDED', { task: { id: 'T-3', status: 'backlog' } });
      socket.emit('AGENTS_UPDATED', { agents: [{ id: 'rev-1', status: 'idle' }] });
      socket.emit('AGENT_REMOVED', { agentId: 'rev-1' });
      socket.emit('SETTINGS_UPDATED', { repos: ['/repo-b'] });
      socket.emit('REPOS_UPDATED', { repos: ['/repo-b', '/repo-c'] });
      socket.emit('PLAN_PARTIAL', { taskId: 'T-2', plan: 'Partial plan' });
      socket.emit('PLAN_READY', { taskId: 'T-2' });
      socket.emit('PR_CREATED', { taskId: 'T-2' });
      socket.emit('REVIEW_FAILED', { taskId: 'T-2' });
      socket.emit('REVIEW_PASSED', { taskId: 'T-2' });
      socket.emit('TASK_ABORTED', { taskId: 'T-2' });
      socket.emit('TASK_RETRIED', { taskId: 'T-2', retryStatus: 'queued' });
      socket.emit('TASK_DELETED', { taskId: 'T-2' });
      socket.emit('BRIDGE_OPENED', { agentName: 'Implementor 1' });
      socket.emit('BRIDGE_RETURNED', { agentName: 'Implementor 1' });
      socket.emit('BRIDGE_ERROR', { message: 'Bridge failed' });
      socket.emit('TASK_WORKSPACE_OPENED', { message: 'Workspace opened' });
      socket.emit('TASK_WORKSPACE_ERROR', { message: 'Workspace failed' });
      socket.emit('MAX_REVIEW_BLOCKER_APPROVED', { taskId: 'T-2' });
      socket.emit('MAX_REVIEW_BLOCKER_EXTENDED', { taskId: 'T-2', maxReviewCycles: 4 });
      socket.emit('SETTINGS_ERROR', { errors: ['Invalid settings'] });
      socket.onmessage({ data: 'not-json' });
    });

    expect(result.current.tasks).toEqual([
      { id: 'T-2', status: 'queued', plan: 'Partial plan' },
      { id: 'T-3', status: 'backlog' },
    ]);
    expect(result.current.repos).toEqual(['/repo-b', '/repo-c']);
    expect(result.current.settings).toEqual({ repos: ['/repo-b'] });
    expect(result.current.notifications[0].msg).toBe('Invalid settings');

    act(() => {
      result.current.rejectPlan('T-2', 'More detail');
      result.current.injectMessage('imp-1', 'continue');
      result.current.sendRaw('imp-1', 'raw');
      result.current.resizeTerminal('imp-1', 120, 40);
      result.current.pauseAgent('imp-1');
      result.current.resumeAgent('imp-1');
      result.current.pauseTask('T-2');
      result.current.resumeTask('T-2');
      result.current.editTask('T-2', { title: 'Updated' });
      result.current.abortTask('T-2');
      result.current.resetTask('T-2');
      result.current.retryTask('T-2');
      result.current.completeManualPr('T-2');
      result.current.approveMaxReviewBlocker('T-2');
      result.current.extendMaxReviewBlocker('T-2');
      result.current.deleteTask('T-2');
      result.current.openTaskWorkspace('T-2');
      result.current.openAgentTerminal('imp-1');
      result.current.returnAgentTerminal('imp-1');
    });

    expect(socket.sent.map(message => message.type)).toEqual([
      'REJECT_PLAN',
      'INJECT_MESSAGE',
      'INJECT_RAW',
      'RESIZE_TERMINAL',
      'PAUSE_AGENT',
      'RESUME_AGENT',
      'PAUSE_TASK',
      'RESUME_TASK',
      'EDIT_TASK',
      'ABORT_TASK',
      'RESET_TASK',
      'RETRY_TASK',
      'COMPLETE_MANUAL_PR',
      'APPROVE_MAX_REVIEW_BLOCKER',
      'EXTEND_MAX_REVIEW_BLOCKER',
      'DELETE_TASK',
      'OPEN_TASK_WORKSPACE',
      'OPEN_AGENT_TERMINAL',
      'RETURN_AGENT_TERMINAL',
    ]);

    act(() => {
      socket.onerror();
    });

    expect(socket.closed).toBe(true);
  });

  test('notifies early when automatic PR creation is unavailable', () => {
    const { result } = renderHook(() => useFactory());
    const socket = WebSocketMock.instances[0];

    act(() => {
      socket.open();
      socket.emit('INIT', {
        tasks: [],
        agents: [],
        repos: ['/repo'],
        settings: { defaultRepoPath: '/repo' },
        capabilities: { ghAvailable: false, ghAuthenticated: false, canCreatePullRequests: false },
      });
    });

    expect(result.current.capabilities).toEqual({
      ghAvailable: false,
      ghAuthenticated: false,
      canCreatePullRequests: false,
    });
    expect(result.current.notifications[0].msg).toContain('GitHub CLI');
    expect(result.current.notifications[0].msg).toContain('manual');
  });
});
