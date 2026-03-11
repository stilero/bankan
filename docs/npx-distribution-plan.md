# NPX Distribution Plan

## Goal

Make the app installable with a single developer-friendly command, without requiring users to manually clone the repo and run an in-repo setup step first.

Recommended target experience:

```bash
npx create-ai-dev-factory@latest my-factory
cd my-factory
npm start
```

Secondary target for advanced users:

```bash
npx create-ai-dev-factory@latest my-factory --yes --repos ~/code/repo1,~/code/repo2
```

## What The Current Repo Already Has

- A working interactive setup wizard in [`scripts/setup.js`](/Users/danieleliasson/Developer/stilero/ai-dev-factory/scripts/setup.js) that checks prerequisites, prompts for config, writes `.env.local`, and installs dependencies.
- A root workspace with separate `client/` and `server/` packages.
- Runtime configuration split between `.env.local` and persisted settings under `.data/config.json`.

This means the fastest path is not "invent a new installer". It is "extract the current setup logic into a distributable bootstrap CLI".

## Reference Patterns

These projects use the same adoption pattern developers already trust:

- `expressjs/generator`: supports both global install and `npx express-generator`, then generates a project folder and prints next steps.
  Reference: https://github.com/expressjs/generator
- `create-next-app`: `npx create-next-app@latest` supports interactive prompts, `--yes`, and example/template sources from GitHub.
  Reference: https://nextjs.org/docs/app/api-reference/cli/create-next-app
- `create-vite`: `npm create vite@latest` keeps the bootstrap package very small and defers the real app dependencies to the generated project.
  Reference: https://vite.dev/guide/
- `shadcn` CLI: `pnpm dlx shadcn@latest init` mixes interactive and scripted modes and is explicit about code distribution as a product surface.
  Reference: https://ui.shadcn.com/docs/cli
- `n8n`: `npx n8n` shows the alternative "run the app directly from npm" model.
  Reference: https://docs.n8n.io/hosting/installation/npm/

## Recommendation

Use the `create-*` scaffolding model, not the direct-run `npx app-name` model.

Why:

- This app depends on local repo paths, local CLI availability, and machine-specific config. That fits a bootstrapper better than an ephemeral one-shot runtime package.
- The app contains both a client and server package. A scaffold CLI can create a normal local project with standard `npm start` and `npm run dev` workflows after setup.
- Developers already understand the pattern from Next.js, Vite, and Express.

Recommended package shape:

- Publish a new public npm package: `create-ai-dev-factory`
- Keep the app source repo as the canonical template/source
- Optionally later publish a second helper package, for example `@stilero/ai-dev-factory-cli`, for commands like `doctor`, `setup`, or `upgrade`

## Product Suggestions

### 1. Ship A Small Bootstrap CLI

The bootstrap CLI should:

- Create a destination directory
- Copy or download the app template
- Rewrite package metadata if needed
- Run prerequisite checks
- Prompt for config, or accept flags in CI/non-interactive mode
- Write `.env.local`
- Install dependencies
- Print exact next steps

Suggested commands:

```bash
npx create-ai-dev-factory@latest my-factory
npx create-ai-dev-factory@latest my-factory --yes
npx create-ai-dev-factory@latest my-factory --repos ~/src/a,~/src/b
npx create-ai-dev-factory@latest my-factory --skip-install
```

Suggested flags:

- `--yes`
- `--repos`
- `--github-repo`
- `--github-token`
- `--implementor-1`
- `--implementor-2`
- `--port`
- `--skip-install`
- `--template <branch|tag|tarball>`

### 2. Extract Setup Logic Out Of The Repo-Specific Script

Refactor the current wizard into reusable modules:

- `packages/create-ai-dev-factory/bin/create-ai-dev-factory.js`
- `packages/create-ai-dev-factory/src/checks.js`
- `packages/create-ai-dev-factory/src/prompts.js`
- `packages/create-ai-dev-factory/src/config.js`
- `packages/create-ai-dev-factory/src/install.js`

This avoids duplicating logic between the current repo and the published CLI.

### 3. Reduce Friction In First Run

Improve the first-run contract:

- Default to sensible values when possible
- Accept fully non-interactive installs
- Detect `claude` and `codex` automatically and preselect available tools
- Fail with actionable remediation text for `node-pty` build prerequisites
- Print a short "doctor summary" before install begins

### 4. Decide How The Template Is Distributed

Best initial option:

- Publish from this repo and let the CLI fetch a tagged GitHub tarball or copy from a packaged template directory

Good long-term option:

- Move the app template into a dedicated `template/` directory or package and version it with releases

Avoid as the first approach:

- Running the whole app straight from `npx` every time
- Forcing users to clone GitHub manually before the CLI can help them

## Implementation Plan

### Phase 1. Prepare For Distribution

- Remove `private: true` from the distributable package only, not necessarily from the app root if the root remains a workspace shell.
- Choose final naming:
  - `create-ai-dev-factory`
  - optional scoped runtime/helper package later
- Define supported Node versions and supported operating systems in one place.
- Decide whether the installer copies from npm package contents or downloads a GitHub release artifact.

### Phase 2. Build The CLI

- Add a package with a `bin` entry for `create-ai-dev-factory`.
- Move prerequisite detection and env writing out of [`scripts/setup.js`](/Users/danieleliasson/Developer/stilero/ai-dev-factory/scripts/setup.js) into shared functions.
- Support both:
  - interactive mode
  - non-interactive mode via flags
- Add clean success and failure messages modeled after `create-next-app` and `express-generator`.

### Phase 3. Make The Generated Project Feel Native

- Ensure the generated project works with:
  - `npm install`
  - `npm start`
  - `npm run dev`
- Keep generated files minimal and human-readable.
- Write `.env.local` only when values are available; otherwise generate a documented placeholder file.
- Make the first-run README specific to the generated app, not to repository contributors.

### Phase 4. Documentation And Release

- Update the top-level README quick start to lead with the `npx` install flow.
- Keep a contributor/developer section for working on the source repo itself.
- Add release automation for npm publish and GitHub releases.
- Add a changelog or release notes process so install instructions stay versioned.

### Phase 5. Verification

- Test on macOS and Linux at minimum.
- Verify clean-machine installs with:
  - both `claude` and `codex` available
  - only one available
  - neither available
- Verify `--yes` mode, `--skip-install`, and invalid repo path handling.
- Verify the generated app can start successfully with `npm start`.

## Documentation Plan

The docs need to be treated as part of the feature, not follow-up cleanup.

### README Changes

Restructure [`README.md`](/Users/danieleliasson/Developer/stilero/ai-dev-factory/README.md) into two entry paths:

1. Install and run the product
2. Contribute to the source repo

Proposed top section:

```bash
npx create-ai-dev-factory@latest my-factory
cd my-factory
npm start
```

Then document:

- prerequisites
- what the installer asks for
- how to run non-interactively
- where config is stored
- how to upgrade

### New Docs To Add

- `docs/installation.md`
  - interactive install
  - non-interactive install
  - OS prerequisites
  - sample terminal sessions
- `docs/configuration.md`
  - `.env.local`
  - `.data/config.json`
  - CLI selection rules
  - repo path expectations
- `docs/troubleshooting.md`
  - `node-pty` build failures
  - missing `claude`/`codex`
  - bad repo paths
  - permission issues
- `docs/releasing.md`
  - versioning
  - npm publish
  - GitHub release/tag flow
  - how the template source is cut into a release

### In-CLI Documentation

The CLI itself should provide documentation-grade output:

- `--help`
- a concise prerequisites summary
- clear remediation steps
- next-step commands after success

## Recommended Sequence

1. Build `create-ai-dev-factory` as the only new public entry point.
2. Refactor the current setup wizard into reusable modules instead of maintaining two installers.
3. Update README and add install/config/troubleshooting/releasing docs in the same change set.
4. Add release automation only after local install flows are stable.

## Success Criteria

- A developer can install with one command and no manual clone step.
- A developer can run fully non-interactively for repeatable setup.
- The README starts with the install command, not contributor setup.
- Broken prerequisites fail early with concrete fixes.
- Installation instructions are versioned and match the released CLI behavior.
