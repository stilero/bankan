# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ban Kan is a local AI agent orchestration dashboard — a Kanban board where tasks flow through Backlog → Planning → Implementation → Review → Done, with each stage driven by AI coding agents (Claude CLI or Codex CLI). Published as `@stilero/bankan` on npm.

## Commands

```bash
npm run install:all        # Install root + server + client dependencies
npm run setup              # Interactive setup wizard (writes .env.local, installs deps)
npm run dev                # Run server + Vite client concurrently (alias: npm start)
npm run dev --prefix client   # Client only (Vite dev server on :5173)
npm run dev --prefix server   # Server only (node --watch on :3001)
npm run build              # Build client bundle (vite build)
```

Dev mode: client runs at `http://localhost:5173` with API proxy to `:3001`.

## Architecture

**Monorepo with two packages** — no workspace manager, just npm `--prefix`:

- `server/` — Express + WebSocket backend (ES modules, no TypeScript)
- `client/` — React 18 + Vite SPA (JSX, no TypeScript, inline styles)
- `bin/bankan.js` — CLI entry point for `npx @stilero/bankan`
- `scripts/setup.js` — Interactive setup wizard

### Server modules (`server/src/`)

- `index.js` — Express app, REST API, WebSocket handler, static file serving, bridge terminal logic. All HTTP/WS endpoints live here.
- `orchestrator.js` — Core pipeline engine. Poll loop (4s) assigns tasks to agents, signal checker (2.5s) detects completion/timeout/blockers. Builds prompts for each stage, manages git workspaces (clone → branch → push), handles PR creation via `gh` CLI.
- `agents.js` — `Agent` class wraps `node-pty` processes. `AgentManager` singleton manages agent pool with role-based scaling (planners/implementors/reviewers). Agents parse token counts from CLI output.
- `store.js` — `TaskStore` persists tasks to `.data/tasks.json`. Handles restart recovery (resets orphaned in-flight tasks).
- `config.js` — Loads settings from `.data/config.json` with fallback to `.env.local` and process env. Contains default prompts for planning/implementation/review stages.
- `paths.js` — Runtime path resolution. Two modes: development (`.data/` in repo root) vs packaged (`~/Library/Application Support/bankan` on macOS).
- `events.js` — Shared `EventEmitter` bus connecting orchestrator, agents, store, and WebSocket broadcasts.

### Client components (`client/src/`)

- `App.jsx` — Main app with WebSocket connection, settings modal, task creation
- `KanbanBoard.jsx` / `KanbanColumn.jsx` / `KanbanCard.jsx` — Board layout
- `TaskDetailModal.jsx` — Task detail view with plan/review/log
- `TerminalPane.jsx` / `TerminalDrawer.jsx` — xterm.js terminal for agent output
- `DirectoryPicker.jsx` — Filesystem browser for repo selection

### Key data flow

1. WebSocket messages (e.g., `ADD_TASK`, `APPROVE_PLAN`) arrive in `index.js`
2. `index.js` updates `store` and emits on `bus`
3. `orchestrator.js` poll loop picks up tasks, spawns agents via `agentManager`
4. Agent PTY output is parsed for structured markers (`=== PLAN START ===`, `=== IMPLEMENTATION COMPLETE ===`, `=== REVIEW START ===`)
5. Completions trigger stage transitions, eventually creating PRs via `gh pr create`

### Runtime state

- `.data/` (dev) or `~/Library/Application Support/bankan` (packaged) — config.json, tasks.json, plans/, workspaces/
- `.env.local` — REPOS, GITHUB_REPO, GITHUB_TOKEN, IMPLEMENTOR_*_CLI, PORT

## Code Style

- ES modules throughout (`"type": "module"`)
- Single quotes, semicolons
- PascalCase for React component files, camelCase for hooks/helpers
- Backend modules are role-based (small, focused files)
- React components use inline styles (no CSS modules or styled-components)
- No linter or formatter configured — match existing patterns

## Caveats

- No test suite exists. Verify UI changes at `localhost:5173`, backend changes via manual REST/WS testing.
- `node-pty` requires native build tools (Xcode CLI on macOS, build-essential on Linux).
- The orchestrator runs agents with `--dangerously-skip-permissions` for Claude CLI.
- PR creation requires `gh` CLI to be installed and authenticated.
