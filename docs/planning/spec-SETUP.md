# Setup

## Goal

Two commands to get running:

```bash
npm run setup   # interactive wizard
npm start       # server + client
```

## setup.js Requirements

- ESM module (`import` not `require`)
- Zero external dependencies — only Node.js built-ins (`readline`, `fs`, `child_process`, `path`, `url`)
- Lives at `scripts/setup.js`
- Called via `npm run setup` from root

## Wizard Flow

### Step 1: Header
Clear terminal. Print ASCII art or styled header. Print brief description.

### Step 2: Prerequisite Check
Check each with `which {command}` via `execSync`. Print ✓ / ⚠ / ✗.

| Tool | Required | Install hint if missing |
|---|---|---|
| `node` ≥ 18 | Hard — exit if missing | https://nodejs.org |
| `git` | Soft warning | system package manager |
| `claude` | Soft warning | `npm install -g @anthropic-ai/claude-code` |
| `codex` | Soft warning | `npm install -g @openai/codex` |

If neither `claude` nor `codex` is found, print a clear warning that at least one is required.

Also check for native build tools (required by node-pty):
- macOS: check `xcode-select -p` exits 0
- Linux: check `cc --version` exits 0
- If missing, print the fix before attempting npm install

### Step 3: API Keys
Read existing `.env.local` first (parse key=value lines). For each key:
- If already set: show prompt with dim "(already set, press Enter to keep)"
- If not set: show plain prompt
- Empty input = keep existing value

Keys to collect:
```
ANTHROPIC_API_KEY   for claude CLI
OPENAI_API_KEY      for codex CLI
```

### Step 4: Project Config
```
REPO_PATH       absolute path to the git repo agents will work in
GITHUB_REPO     optional, format: owner/repo
GITHUB_TOKEN    optional, GitHub personal access token
```

Validate `REPO_PATH`: check it exists and is a git repo (`git -C {path} rev-parse HEAD`). Warn but don't fail if it's not a git repo.

### Step 5: Runtime Config
The bootstrap setup should only collect runtime values needed before the app loads.

Agent CLI selection belongs in the app settings UI so setup and the dashboard stay in sync.

### Step 6: Write Files

Write `.env.local`:
```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
REPO_PATH=...
GITHUB_REPO=...
GITHUB_TOKEN=...
PORT=3001
```

Write `.gitignore`:
```
node_modules/
.data/
.env.local
dist/
```

### Step 7: Install Dependencies
Run sequentially with `{ stdio: 'inherit' }` so progress is visible:

```bash
npm install                         # root (concurrently)
npm install --prefix server         # server deps
npm install --prefix client         # client deps
```

If any install fails, print the error and suggest running manually.

### Step 8: Success Message
```
✓ Setup complete!

To start:
  npm start

Then open: http://localhost:5173
```

## .env.local Reference

Full file format:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
REPO_PATH=/absolute/path/to/your/project
GITHUB_REPO=owner/repo
GITHUB_TOKEN=ghp_...
PORT=3001
```

All values except `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` are optional. At least one API key is needed.

## config.js

Loads `.env.local` from the project root. Called by orchestrator and agents. Falls back to `process.env` for any key not in the file.

```js
// .env.local is at: join(process.cwd(), '..', '.env.local')
// (server runs from server/, file is in root)
```

Returns a plain object with all config values. Does not mutate `process.env`.

## npm Scripts

Root `package.json`:
```json
{
  "scripts": {
    "setup":       "node scripts/setup.js",
    "dev":         "concurrently -n server,client -c cyan,magenta \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "start":       "npm run dev",
    "install:all": "npm install && npm install --prefix server && npm install --prefix client"
  }
}
```

Server `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "dev":   "node --watch src/index.js",
    "start": "node src/index.js"
  }
}
```

Client `package.json`:
```json
{
  "scripts": {
    "dev":     "vite",
    "build":   "vite build",
    "preview": "vite preview"
  }
}
```

## Vite Config

```js
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' }
    // Note: WebSocket is NOT proxied — client connects directly to ws://localhost:3001
  }
})
```

## Data Directory

The server creates `.data/` at startup if it doesn't exist:
```
.data/
  tasks.json       persisted task array
  plans/
    T-A1B2C3.md    one file per task with plan text
```

`.data/` is gitignored. Tasks survive server restarts via this file.
