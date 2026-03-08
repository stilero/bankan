import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPane({ agent, subscribeTerminal, injectMessage, sendRaw, onClose }) {
  const termRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !agent) return;

    const agentColor = agent.color || '#F5A623';

    const term = new Terminal({
      theme: {
        background: '#030507',
        foreground: '#E8E8F0',
        cursor: '#F5A623',
        selectionBackground: agentColor + '40',
      },
      fontFamily: "'DM Mono', monospace",
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // Fit after a short delay to ensure container is sized
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    termRef.current = term;

    term.onKey(({ key }) => {
      sendRaw(agent.id, key);
    });

    // Subscribe to terminal data
    const unsub = subscribeTerminal(agent.id, (data) => {
      term.write(data);
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(containerRef.current);

    // Keyboard shortcut
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver.disconnect();
      unsub();
      term.dispose();
      termRef.current = null;
    };
  }, [agent?.id]);

  const handleInject = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      injectMessage(agent.id, e.target.value.trim());
      e.target.value = '';
    }
  };

  const formatTokens = (tokens) => {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
  };

  const formatUptime = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  if (!agent) return null;

  const agentColor = agent.color || '#F5A623';

  return (
    <div style={{
      width: 420,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg1)',
      borderLeft: '1px solid var(--border)',
      animation: 'slide-in-right 0.2s ease-out',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={onClose}
          style={{ color: 'var(--text2)', fontSize: 11 }}
        >
          ← ESC
        </button>
        <span style={{ color: agentColor, fontSize: 16 }}>{agent.icon}</span>
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14 }}>
          {agent.name}
        </span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: agent.status === 'active' ? 'var(--green)' : agent.status === 'blocked' ? 'var(--red)' : 'var(--text3)',
          animation: agent.status === 'active' ? 'pulse 2s infinite' : 'none',
        }} />
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text2)',
      }}>
        <div>Task: <span style={{ color: agentColor }}>{agent.currentTask || '—'}</span></div>
        <div>Tokens: {formatTokens(agent.tokens)} / 200k</div>
        <div>Uptime: {formatUptime(agent.uptime)}</div>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', padding: 4 }}
      />

      {/* Inject bar */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border)',
      }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Send message to agent..."
          onKeyDown={handleInject}
          style={{
            width: '100%',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            caretColor: agentColor,
          }}
        />
      </div>
    </div>
  );
}
