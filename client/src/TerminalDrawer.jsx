import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatUptime(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function TerminalDrawer({ agent, subscribeTerminal, injectMessage, sendRaw, onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);

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

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    termRef.current = term;

    term.onKey(({ key }) => {
      sendRaw(agent.id, key);
    });

    const unsub = subscribeTerminal(agent.id, (data) => {
      term.write(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(containerRef.current);

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

  if (!agent) return null;

  const agentColor = agent.color || '#F5A623';

  return (
    <div style={{
      height: 280,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg1)',
      borderTop: '1px solid var(--border)',
      transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      {/* Header bar */}
      <div style={{
        height: 36, minHeight: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}>
        {/* Left */}
        <button
          onClick={onClose}
          style={{ color: 'var(--text2)', fontSize: 11, padding: '2px 6px', background: 'var(--bg2)', borderRadius: 3, border: '1px solid var(--border)' }}
        >
          ESC
        </button>
        <span style={{ color: agentColor, fontSize: 14 }}>{agent.icon}</span>
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 13 }}>
          {agent.name}
        </span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: agent.status === 'active' ? 'var(--green)' : agent.status === 'blocked' ? 'var(--red)' : 'var(--text3)',
          animation: agent.status === 'active' ? 'pulse 2s infinite' : 'none',
        }} />

        {/* Center stats */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 24, color: 'var(--text2)' }}>
          <span>Task: <span style={{ color: agentColor }}>{agent.currentTask || '\u2014'}</span></span>
          <span>Tokens: {formatTokens(agent.tokens || 0)} / 200k</span>
          <span>Uptime: {formatUptime(agent.uptime)}</span>
        </div>

        {/* Right */}
        <button
          onClick={onClose}
          style={{ color: 'var(--text3)', fontSize: 14 }}
        >
          {'\u2715'}
        </button>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', padding: 4 }}
      />

      {/* Inject bar */}
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
        <input
          type="text"
          placeholder="Send message to agent..."
          onKeyDown={handleInject}
          style={{
            width: '100%',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '5px 10px',
            fontSize: 12,
            caretColor: agentColor,
          }}
        />
      </div>
    </div>
  );
}
