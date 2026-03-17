# Releasing

Internal guide for maintainers. Published to npm as `@stilero/bankan`.

Releases are automated via GitHub Actions (`.github/workflows/publish.yml`) using OIDC trusted publishing — no npm tokens required.

## Prerequisites (one-time)

1. Configure a trusted publisher on [npmjs.com](https://www.npmjs.com/package/@stilero/bankan/access):
   - **Repository owner:** `stilero`
   - **Repository:** `bankan`
   - **Workflow filename:** `publish.yml`
   - **Environment:** (leave blank)
2. Ensure `gh` CLI is installed and authenticated (`gh auth status`).

## Release steps

### 1. Bump the version on your feature branch

Before or after your code changes:

```bash
npm version patch --no-git-tag-version   # bug fix / small change -> 1.0.x
npm version minor --no-git-tag-version   # new feature -> 1.x.0
npm version major --no-git-tag-version   # breaking change -> x.0.0
git add package.json package-lock.json
git commit -m "Bump version to $(node -p 'require("./package.json").version')"
```

Use `--no-git-tag-version` so the tag is created on main after merge, not on the feature branch.

### 2. Push, create a PR, and merge to main

The version bump goes through the same review process as the code.

### 3. Tag the merge commit and create a GitHub release

```bash
git checkout main && git pull
VERSION=$(node -p 'require("./package.json").version')
git tag "v$VERSION"
git push --tags
gh release create "v$VERSION" --title "v$VERSION" --notes "Short description of changes."
```

### 4. Wait for the publish workflow

The workflow runs automatically when the release is published. Monitor with:

```bash
gh run list --workflow=publish.yml --limit=1
```

### 5. Verify

```bash
npm view @stilero/bankan version
```

## What the publish workflow does

Triggered by a GitHub release (or manual `workflow_dispatch`):

1. Installs all dependencies
2. Runs the full test suite and coverage gate
3. Builds the client bundle (`npm run build`)
4. Publishes to npm with `npm publish --provenance --access public`

Authentication is handled via OIDC trusted publishing — no `NPM_TOKEN` secret needed.
