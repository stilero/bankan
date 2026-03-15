import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const {
  terminalInstances,
  fitAddonInstances,
  resizeObserverInstances,
  MockTerminal,
  MockFitAddon,
  MockWebLinksAddon,
  MockResizeObserver,
} = vi.hoisted(() => {
  const terminalInstances = [];
  const fitAddonInstances = [];
  const resizeObserverInstances = [];

  class MockTerminal {
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.write = vi.fn();
      this.loadAddon = vi.fn();
      this.open = vi.fn();
      this.focus = vi.fn();
      this.dispose = vi.fn();
      this.onData = vi.fn((handler) => {
        this.onDataHandler = handler;
        return { dispose: vi.fn() };
      });
      terminalInstances.push(this);
    }
  }

  class MockFitAddon {
    constructor() {
      this.fit = vi.fn();
      fitAddonInstances.push(this);
    }
  }

  class MockWebLinksAddon {}

  class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      resizeObserverInstances.push(this);
    }
  }

  return {
    terminalInstances,
    fitAddonInstances,
    resizeObserverInstances,
    MockTerminal,
    MockFitAddon,
    MockWebLinksAddon,
    MockResizeObserver,
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: MockWebLinksAddon,
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import TerminalDrawer from './TerminalDrawer.jsx';

function makeAgent(overrides = {}) {
  return {
    id: 'imp-1',
    name: 'Claude Implementor',
    icon: 'I',
    color: '#12AA88',
    status: 'active',
    bridgeActive: false,
    currentTask: 'Fix Claude output',
    tokens: 1500,
    aggregatedTokens: 3200,
    uptime: 3665,
    ...overrides,
  };
}

function renderDrawer(overrides = {}) {
  const subscribeTerminal = vi.fn(() => vi.fn());
  const injectMessage = vi.fn();
  const sendRaw = vi.fn();
  const resizeTerminal = vi.fn();
  const openAgentTerminal = vi.fn();
  const returnAgentTerminal = vi.fn();
  const onClose = vi.fn();

  const result = render(
    <TerminalDrawer
      agent={makeAgent(overrides.agent)}
      subscribeTerminal={subscribeTerminal}
      injectMessage={injectMessage}
      sendRaw={sendRaw}
      resizeTerminal={resizeTerminal}
      openAgentTerminal={openAgentTerminal}
      returnAgentTerminal={returnAgentTerminal}
      onClose={onClose}
    />
  );

  return {
    ...result,
    subscribeTerminal,
    injectMessage,
    sendRaw,
    resizeTerminal,
    openAgentTerminal,
    returnAgentTerminal,
    onClose,
  };
}

beforeEach(() => {
  terminalInstances.length = 0;
  fitAddonInstances.length = 0;
  resizeObserverInstances.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    callback();
    return 1;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TerminalDrawer', () => {
  test('renders nothing when no agent is selected', () => {
    const { container } = render(
      <TerminalDrawer
        agent={null}
        subscribeTerminal={vi.fn()}
        injectMessage={vi.fn()}
        sendRaw={vi.fn()}
        resizeTerminal={vi.fn()}
        openAgentTerminal={vi.fn()}
        returnAgentTerminal={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(terminalInstances).toHaveLength(0);
  });

  test('subscribes to terminal data, writes output, resizes on mount, and cleans up on unmount', () => {
    const unsubscribe = vi.fn();
    const subscribeTerminal = vi.fn((agentId, callback) => {
      subscribeTerminal.callback = callback;
      return unsubscribe;
    });
    const resizeTerminal = vi.fn();

    const { unmount } = render(
      <TerminalDrawer
        agent={makeAgent()}
        subscribeTerminal={subscribeTerminal}
        injectMessage={vi.fn()}
        sendRaw={vi.fn()}
        resizeTerminal={resizeTerminal}
        openAgentTerminal={vi.fn()}
        returnAgentTerminal={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(subscribeTerminal).toHaveBeenCalledWith('imp-1', expect.any(Function));
    expect(fitAddonInstances[0].fit).toHaveBeenCalledTimes(1);
    expect(resizeTerminal).toHaveBeenCalledWith('imp-1', 80, 24);

    subscribeTerminal.callback('Claude says hello');
    expect(terminalInstances[0].write).toHaveBeenCalledWith('Claude says hello');

    unmount();

    expect(resizeObserverInstances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(terminalInstances[0].dispose).toHaveBeenCalledTimes(1);
  });

  test('forwards raw xterm input through sendRaw', () => {
    const { sendRaw } = renderDrawer();

    terminalInstances[0].onDataHandler('\u001b[A');
    terminalInstances[0].onDataHandler('pasted text');

    expect(sendRaw).toHaveBeenNthCalledWith(1, 'imp-1', '\u001b[A');
    expect(sendRaw).toHaveBeenNthCalledWith(2, 'imp-1', 'pasted text');
  });

  test('focuses the terminal on mount when no input already owns focus', () => {
    renderDrawer();

    expect(terminalInstances[0].focus).toHaveBeenCalledTimes(1);
  });

  test('does not steal focus from an existing input', () => {
    render(<input aria-label="existing focus" />);
    screen.getByLabelText('existing focus').focus();

    renderDrawer();

    expect(terminalInstances[0].focus).not.toHaveBeenCalled();
  });

  test('debounces resize events and reports terminal dimensions when available', () => {
    const { resizeTerminal } = renderDrawer();

    resizeTerminal.mockClear();
    fitAddonInstances[0].fit.mockClear();

    terminalInstances[0].cols = 132;
    terminalInstances[0].rows = 40;

    resizeObserverInstances[0].callback();
    resizeObserverInstances[0].callback();
    vi.advanceTimersByTime(49);

    expect(fitAddonInstances[0].fit).not.toHaveBeenCalled();
    expect(resizeTerminal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(fitAddonInstances[0].fit).toHaveBeenCalledTimes(1);
    expect(resizeTerminal).toHaveBeenCalledWith('imp-1', 132, 40);
  });

  test('skips resize reporting when the terminal has no dimensions yet', () => {
    const { resizeTerminal } = renderDrawer();

    resizeTerminal.mockClear();
    terminalInstances[0].cols = 0;
    terminalInstances[0].rows = 0;

    resizeObserverInstances[0].callback();
    vi.advanceTimersByTime(50);

    expect(resizeTerminal).not.toHaveBeenCalled();
  });

  test('skips resize reporting when fit throws and clears a pending timer on unmount', () => {
    const { resizeTerminal, unmount } = renderDrawer();

    resizeTerminal.mockClear();
    fitAddonInstances[0].fit.mockImplementation(() => {
      throw new Error('fit failed');
    });

    resizeObserverInstances[0].callback();
    vi.advanceTimersByTime(50);

    expect(resizeTerminal).not.toHaveBeenCalled();

    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    resizeObserverInstances[0].callback();
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  test('closes from escape key and both close buttons', () => {
    const { onClose } = renderDrawer();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'ESC' }));
    fireEvent.click(screen.getByRole('button', { name: '✕' }));

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('injects trimmed input on enter and clears the field', () => {
    const { injectMessage } = renderDrawer();
    const input = screen.getByPlaceholderText('Send message to agent...');

    fireEvent.change(input, { target: { value: '  investigate output  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(injectMessage).toHaveBeenCalledWith('imp-1', 'investigate output');
    expect(input.value).toBe('');
  });

  test('ignores non-enter and blank enter injections', () => {
    const { injectMessage } = renderDrawer();
    const input = screen.getByPlaceholderText('Send message to agent...');

    fireEvent.change(input, { target: { value: '  keep draft  ' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(injectMessage).not.toHaveBeenCalled();
    expect(input.value).toBe('   ');
  });

  test('disables input and shows bridge controls while bridged', () => {
    const { injectMessage, openAgentTerminal, returnAgentTerminal } = renderDrawer({
      agent: { bridgeActive: true },
    });
    const input = screen.getByPlaceholderText('Input moved to Terminal.app while bridged...');

    expect(input.disabled).toBe(true);
    expect(screen.getByText(/Terminal\.app currently owns input/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return to Ban Kan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in Terminal' })).toBeNull();

    fireEvent.change(input, { target: { value: 'should not send' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Return to Ban Kan' }));

    expect(injectMessage).not.toHaveBeenCalled();
    expect(openAgentTerminal).not.toHaveBeenCalled();
    expect(returnAgentTerminal).toHaveBeenCalledWith('imp-1');
  });

  test('shows inactive-session messaging and disables injection when agent is not active', () => {
    renderDrawer({
      agent: { status: 'blocked' },
    });

    expect(screen.getByText(/Agent input is unavailable because the session is not running/i)).toBeTruthy();
    expect(screen.getByPlaceholderText('Send message to agent...').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Open in Terminal' })).toBeNull();
  });

  test('opens the agent terminal for active non-bridged sessions', () => {
    const { openAgentTerminal } = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Open in Terminal' }));

    expect(openAgentTerminal).toHaveBeenCalledWith('imp-1');
  });

  test('renders formatted stats for task, token counts, and uptime', () => {
    renderDrawer();

    expect(screen.getByText('Claude Implementor')).toBeTruthy();
    expect(screen.getByText('Fix Claude output')).toBeTruthy();
    expect(screen.getByText(/Tokens: 1\.5k \/ 200k/i)).toBeTruthy();
    expect(screen.getByText(/Total: 3\.2k/i)).toBeTruthy();
    expect(screen.getByText(/Uptime: 1h 1m/i)).toBeTruthy();
  });

  test('renders fallback stats for missing task, low token counts, and zero uptime', () => {
    renderDrawer({
      agent: {
        currentTask: '',
        tokens: 42,
        aggregatedTokens: 999,
        uptime: 0,
      },
    });

    expect(screen.getByText(/Tokens:\s*42\s*\/\s*200k/i)).toBeTruthy();
    expect(screen.getByText(/Total: 999/i)).toBeTruthy();
    expect(screen.getByText(/Uptime: 0s/i)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  test('allows resizing the drawer with drag constraints', () => {
    renderDrawer();
    const root = screen.getByRole('button', { name: 'ESC' }).closest('div').parentElement;
    const dragHandle = root.firstChild;

    expect(root.style.height).toBe('420px');

    fireEvent.mouseDown(dragHandle, { clientY: 200 });
    fireEvent.mouseMove(window, { clientY: 100 });
    expect(root.style.height).toBe('520px');

    fireEvent.mouseMove(window, { clientY: -1000 });
    expect(root.style.height).toBe('614.4000000000001px');

    fireEvent.mouseMove(window, { clientY: 400 });
    expect(root.style.height).toBe('220px');

    fireEvent.mouseMove(window, { clientY: 1000 });
    expect(root.style.height).toBe('180px');

    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientY: 0 });
    expect(root.style.height).toBe('180px');
  });
});
