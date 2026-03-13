# Ban Kan

Local AI agent orchestration dashboard packaged as a global npm app.

## Install

```bash
npm install -g bankan
```

Or run it without installing globally:

```bash
npx bankan
```

Then start the app with:

```bash
bankan
```

By default, Ban Kan starts a local server, opens your browser automatically, and serves the UI from the same process.

## First Run

On first launch, `bankan` runs an interactive setup wizard if no local configuration exists yet.

It will prompt for:

- `REPOS`: comma-separated absolute paths to local git repositories
- `GITHUB_REPO`: GitHub `owner/repo` for PR creation (optional)
- `GITHUB_TOKEN`: GitHub personal access token (optional)
- `IMPLEMENTOR_1_CLI`: `claude` or `codex`
- `IMPLEMENTOR_2_CLI`: `claude` or `codex`

## Requirements

- Node.js `>= 18`
- `git`
- At least one AI CLI: [`claude`](https://docs.anthropic.com/en/docs/claude-code) or [`codex`](https://github.com/openai/codex)
- Native build tools for `node-pty`
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential`

## Runtime Storage

Ban Kan does not write state into the npm global install directory.

- Durable state is stored in a per-user app-data location
  - macOS: `~/Library/Application Support/bankan`
  - Linux: `~/.local/share/bankan` or `$XDG_DATA_HOME/bankan`
  - Windows: `%AppData%\bankan`
- Temporary terminal bridge files are stored under the OS temp directory

## CLI Options

```bash
bankan --port 3005
bankan --no-open
```

- `--port`: bind to a specific port
- `--no-open`: start without opening a browser

## Development

From source:

```bash
npm run setup
npm run dev
```

Useful scripts:

- `npm run build` builds the client bundle used for publishing
- `npm run dev` runs the server and Vite client together
- `npm run setup` runs the interactive setup wizard
- `npm run install:all` installs root, server, and client dependencies

## Publish To npm

Before publishing:

1. Confirm the package name is available:
   ```bash
   npm view bankan
   ```
   If the package already exists, rename the package or switch to a scoped name before publishing.
2. Install dependencies:
   ```bash
   npm run install:all
   ```
3. Build the client bundle:
   ```bash
   npm run build
   ```
4. Inspect the package contents:
   ```bash
   npm pack
   ```
5. Authenticate:
   ```bash
   npm login
   ```
6. Publish:
   ```bash
   npm publish
   ```

After publishing, verify:

```bash
npm view bankan
npm install -g bankan
bankan --no-open
npx bankan --no-open
```

## Architecture

Ban Kan ships as:

- a Node/Express backend with WebSocket orchestration
- a React dashboard built with Vite and served from Express in the packaged runtime
- a global `bankan` CLI that launches the local app
