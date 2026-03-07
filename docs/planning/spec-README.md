# AI Factory — Implementation Spec

Local AI agent orchestration dashboard. A developer adds tasks, AI agents plan and build them on git branches, a reviewer agent checks the work, and a PR is created for human review.

## Read these files in order

| File | What it covers |
|---|---|
| `ARCHITECTURE.md` | System overview, tech stack, file structure |
| `PIPELINE.md` | How tasks flow through agents — the core logic |
| `API.md` | WebSocket message protocol, REST endpoints, data shapes |
| `UI.md` | Dashboard layout, components, UX behaviours |
| `PROMPTS.md` | Exact prompt templates for each agent |
| `SETUP.md` | Setup wizard, .env.local, install flow |

## What already exists

The repo has a working scaffold. Some files are partial, some are stubs, some need to be created. Check `ARCHITECTURE.md#current-state` for the exact status of each file.

## What needs to be built

1. Wire the real WebSocket server to the React client (replace mock data)
2. Fix a circular import bug between `index.js` and `store.js`
3. Implement the orchestrator state machine properly
4. Connect real xterm.js terminals to PTY streams
5. Tighten agent signal detection (plan/implementation/review completion)
6. Add restart recovery so in-progress tasks survive server restarts

## Hard constraints

- **Local only** — binds to localhost, no auth, no multi-user
- **ESM only** — `type: module` in server. No `require()`, no mixing
- **No TypeScript** — plain JS throughout
- **No database** — JSON file persistence only (`.data/tasks.json`)
- **No Docker** — runs with `npm start` on host machine
- **macOS / Linux only** — node-pty requires POSIX PTY
- **Single repo** — `REPO_PATH` points to one git repo, all agents work there

## Two-command install target

```
npm run setup   # interactive wizard
npm start       # launches server + client
```

Open http://localhost:5173.
