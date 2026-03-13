<p align="center">
  <img src="https://raw.githubusercontent.com/stilero/bankan/main/client/src/assets/ban_kan_logo.svg" alt="Ban Kan logo" width="360" />
</p>

# stilero/bankan

Local AI agent orchestration dashboard packaged as a global npm app.

[CI](https://github.com/stilero/bankan/actions/workflows/ci.yml) · [GitHub repository](https://github.com/stilero/bankan) · [Issue tracker](https://github.com/stilero/bankan/issues)

## Installation

### Requirements

- Node.js `>= 18`
- `git`
- At least one AI CLI: [`claude`](https://docs.anthropic.com/en/docs/claude-code) or [`codex`](https://github.com/openai/codex)
- Native build tools for `node-pty`
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential`

### Install from npm

```bash
npm install -g bankan
bankan
```

### Run without installing

```bash
npx bankan
```

### Install from source

```bash
git clone https://github.com/stilero/bankan.git
cd bankan
npm run install:all
npm run setup
npm run dev
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

## CLI Options

```bash
bankan --port 3005
bankan --no-open
```

- `--port`: bind to a specific port
- `--no-open`: start without opening a browser

## Runtime Storage

Ban Kan does not write state into the npm global install directory.

- Durable state is stored in a per-user app-data location
  - macOS: `~/Library/Application Support/bankan`
  - Linux: `~/.local/share/bankan` or `$XDG_DATA_HOME/bankan`
  - Windows: `%AppData%\bankan`
- Temporary terminal bridge files are stored under the OS temp directory

## Development

Useful scripts:

- `npm run build` builds the client bundle used for publishing
- `npm run dev` runs the server and Vite client together
- `npm run setup` runs the interactive setup wizard
- `npm run install:all` installs root, server, and client dependencies

## Release

This repository includes:

- `CI`: installs all packages, builds the client, and validates the publishable package shape
- `Publish to npm`: publishes `bankan` when a GitHub Release is published

To enable npm publishing in GitHub Actions, add an `NPM_TOKEN` repository secret with publish access to the package.

## License

MIT

## Architecture

Ban Kan ships as:

- a Node/Express backend with WebSocket orchestration
- a React dashboard built with Vite and served from Express in the packaged runtime
- a global `bankan` CLI that launches the local app
