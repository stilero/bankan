# Architecture

## System Diagram

```
Browser (React + xterm.js)  :5173
  └── WebSocket ws://localhost:3001
  └── REST /api/* (proxied by Vite)

Node.js Server  :3001
  ├── Express (REST + static)
  ├── WebSocketServer (ws)
  ├── Orchestrator (in-process state machine)
  ├── AgentManager (node-pty pool)
  └── TaskStore (JSON file)

PTY Processes (spawned by AgentManager)
  ├── planner     → claude CLI
  ├── implementor-1 → claude CLI  (configurable)
  ├── implementor-2 → codex CLI   (configurable)
  └── reviewer    → claude CLI
```

The orchestrator is **not** a CLI process — it runs inside the Node server. It drives state transitions by writing prompts to PTY stdin and watching stdout for signal strings.

## Tech Stack

### Server
| Package | Purpose |
|---|---|
| `express` ^4.18 | HTTP server + REST API |
| `ws` ^8.16 | WebSocket server |
| `node-pty` ^1.0 | Spawn + control CLI agents as PTY processes |
| `simple-git` ^3.22 | Branch creation, push |
| `uuid` ^9.0 | Task ID generation |
| `cors` ^2.8 | Allow Vite dev server origin |
| `dotenv` ^16.4 | Load `.env.local` |

### Client
| Package | Purpose |
|---|---|
| `react` ^18.2 | UI |
| `vite` ^5.1 | Dev server + build |
| `@xterm/xterm` ^5.3 | Terminal emulator — renders raw PTY output with ANSI codes |
| `@xterm/addon-fit` ^0.8 | Auto-resize terminal to container |
| `@xterm/addon-web-links` ^0.9 | Clickable URLs in terminal output |

### Root
| Package | Purpose |
|---|---|
| `concurrently` ^8.2 | Run server + client in parallel with `npm start` |

## File Structure

```
ai-factory/
├── package.json              # scripts: setup, dev/start, install:all
├── .env.local                # gitignored — created by setup wizard
├── .gitignore
├── README.md
├── scripts/
│   └── setup.js              # interactive setup wizard (ESM, zero deps)
├── server/
│   ├── package.json          # type:module
│   └── src/
│       ├── index.js          # Express + WS server, exports broadcast()
│       ├── orchestrator.js   # Pipeline state machine
│       ├── agents.js         # AgentManager + Agent class
│       ├── store.js          # TaskStore — JSON persistence
│       ├── events.js         # EventEmitter singleton (fixes circular import)
│       └── config.js         # .env.local loader
└── client/
    ├── package.json
    ├── vite.config.js        # proxy /api → :3001
    ├── index.html            # imports Syne + DM Mono from Google Fonts
    └── src/
        ├── main.jsx
        ├── App.jsx           # Main dashboard — must use useFactory() hook
        ├── useFactory.js     # WebSocket hook — connects to real server
        ├── TerminalPane.jsx  # xterm.js component
        └── index.css         # CSS variables, global reset, keyframe animations
```

## Current State of Each File

| File | Status | What's needed |
|---|---|---|
| `server/src/index.js` | Partial | Fix circular import with store.js — see Critical Bugs |
| `server/src/store.js` | Partial | Remove direct import of broadcast(); use events.js instead |
| `server/src/config.js` | Partial | Ensure `IMPLEMENTOR_1_CLI` and `IMPLEMENTOR_2_CLI` are read |
| `server/src/agents.js` | Partial | Verify node-pty spawn, token parsing, terminal streaming to WS |
| `server/src/orchestrator.js` | Partial | Fix circular import; implement all stage transitions; add restart recovery |
| `server/src/events.js` | Missing | Create — EventEmitter singleton used by store + server |
| `scripts/setup.js` | Partial | Fix ESM vs CJS issue; readline prompts need async/await |
| `client/src/App.jsx` | Has design | Replace `INITIAL_TASKS` / `AGENTS` constants with `useFactory()` hook |
| `client/src/useFactory.js` | Partial | Replace mock data; implement all WS message handlers |
| `client/src/TerminalPane.jsx` | Partial | Verify lifecycle: mount→subscribe, unmount→unsubscribe+dispose |
| `client/src/index.css` | Partial | Ensure all CSS variables and keyframe animations are present |
| `.gitignore` | Missing | Create: `node_modules/`, `.data/`, `.env.local`, `dist/` |

## Critical Bugs to Fix

### 1. Circular Import (server)
`index.js` exports `broadcast()` → `store.js` imports it → `index.js` imports `store.js` → circular.

**Fix:** Create `server/src/events.js` as a plain EventEmitter singleton. `store.js` emits events on it. `index.js` listens and broadcasts over WS. Neither imports the other directly.

```
events.js  ←  imported by both index.js and store.js
```

### 2. node-pty Native Build
node-pty requires native compilation. If `npm install` fails in CI or on a fresh machine:
- macOS: `xcode-select --install`
- Linux: `apt install build-essential python3`

The setup wizard should detect a missing build toolchain and print the fix.

### 3. PTY Terminal Size
Set `cols: 220, rows: 50` when spawning PTY processes. Claude Code formats output for terminal width — too narrow causes broken line wrapping in the xterm display.

### 4. Vite Proxy vs WebSocket
The Vite config proxies `/api` HTTP requests to `:3001`. WebSocket is **not** proxied through Vite. The `useFactory.js` hook must connect directly to `ws://localhost:3001`, not through Vite's dev server.

## Server Startup Sequence

1. Load config from `.env.local`
2. Load tasks from `.data/tasks.json`
3. Reset any tasks stuck in transient states (see `PIPELINE.md#restart-recovery`)
4. Start Express + WebSocket server on `PORT` (default 3001)
5. Call `orchestrator.start()` — begins polling loop

## Port Assignments

| Port | Service |
|---|---|
| 3001 | Node.js server (HTTP + WebSocket) |
| 5173 | Vite dev server (React client) |
