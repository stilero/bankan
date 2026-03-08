# AI Dev Factory

Local AI agent orchestration dashboard that uses Claude and Codex CLIs to plan, implement, review, and open pull requests for code changes — automatically.

## Prerequisites

- **Node.js** >= 18
- **git**
- At least one AI CLI: [`claude`](https://docs.anthropic.com/en/docs/claude-code) or [`codex`](https://github.com/openai/codex)
- **Native build tools** (required by `node-pty`):
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential` (`apt install build-essential`)

## Quick Start

```bash
npm run setup   # interactive wizard — configures .env.local and installs deps
npm start       # starts server + client
```

Then open [http://localhost:5173](http://localhost:5173).

## Setup Wizard

`npm run setup` walks you through configuration:

1. Checks prerequisites (Node.js version, git, CLI tools, native build tools)
2. Prompts for project settings:
   - `REPOS` — comma-separated paths to local git repositories
   - `GITHUB_REPO` — GitHub `owner/repo` for PR creation (optional)
   - `GITHUB_TOKEN` — GitHub personal access token (optional)
   - `IMPLEMENTOR_1_CLI` / `IMPLEMENTOR_2_CLI` — which CLI each implementor agent uses
3. Writes `.env.local`
4. Installs dependencies for root, server, and client

## Manual Configuration

Create a `.env.local` file in the project root:

| Variable | Description | Default |
|---|---|---|
| `REPOS` | Comma-separated absolute paths to git repos | _(required)_ |
| `GITHUB_REPO` | GitHub `owner/repo` for auto PR creation | _(optional)_ |
| `GITHUB_TOKEN` | GitHub PAT with repo scope | _(optional)_ |
| `IMPLEMENTOR_1_CLI` | CLI for Implementor 1 (`claude` or `codex`) | `claude` |
| `IMPLEMENTOR_2_CLI` | CLI for Implementor 2 (`claude` or `codex`) | `codex` |
| `PORT` | Server port | `3001` |

## Usage

1. Open [http://localhost:5173](http://localhost:5173)
2. Add a task — select a target repo, set a title, priority, and description
3. The pipeline processes tasks automatically:
   - **Backlog** → Planner generates an implementation plan
   - **Awaiting Approval** → you review and approve/reject the plan
   - **Implementing** → an Implementor agent writes the code and commits
   - **Review** → the Reviewer agent checks the diff
   - **PR / Awaiting Human Review** → a pull request is created on GitHub (if configured)

Each agent has a live terminal view in the dashboard showing real-time output.

## Architecture

Five agents managed by a central orchestrator:

| Agent | Role |
|---|---|
| **Orchestrator** | Pipeline control — assigns tasks, monitors progress, detects completion signals |
| **Planner** | Generates step-by-step implementation plans from task descriptions |
| **Implementor 1** | Writes code following the plan (configurable CLI) |
| **Implementor 2** | Second implementor for parallel work (configurable CLI) |
| **Reviewer** | Reviews diffs for correctness, security, and code quality |

The server (Express + WebSocket) spawns agent CLI processes via `node-pty` and streams terminal output to the React + xterm.js client over WebSocket.

## Available Scripts

| Script | Description |
|---|---|
| `npm run setup` | Interactive setup wizard |
| `npm start` | Start server and client in development mode |
| `npm run install:all` | Install all dependencies (root, server, client) |
