# Repository Guidelines

## Project Structure & Module Organization
This repository is split into two Node packages. `client/` contains the Vite + React dashboard UI, with app code in `client/src/` and production output in `client/dist/`. `server/` contains the Express + WebSocket backend in `server/src/`. Root-level `scripts/` holds setup utilities, `docs/` is for supporting documentation, and `.data/` stores local runtime state such as settings and workspaces. Keep UI components in PascalCase files such as `KanbanBoard.jsx`; keep backend modules small and role-based, such as `agents.js` or `orchestrator.js`.

## Build, Test, and Development Commands
Run `npm run setup` for the interactive bootstrap flow; it writes `.env.local` and installs dependencies. Use `npm start` or `npm run dev` from the repo root to run server and client together. Use `npm run dev --prefix client` to work on the UI only, `npm run build --prefix client` to create a production bundle, and `npm run dev --prefix server` to run the backend with file watching. `npm run install:all` reinstalls root, server, and client dependencies.

## Coding Style & Naming Conventions
Match the existing code style: ES modules, semicolons, single quotes, and concise functional React components. Use `PascalCase` for React component files, `camelCase` for hooks and helpers such as `useFactory.js`, and lowercase role-based names for backend modules. Follow the existing indentation and inline-style patterns already used in `client/src/App.jsx` and `server/src/index.js`. No formatter or linter is configured yet, so keep changes consistent and small.

## Testing Guidelines
There is no automated test suite configured today. For UI changes, verify behavior locally through the dashboard at `http://localhost:5173`. For backend changes, exercise the REST and WebSocket flows manually while `server/src/index.js` runs in watch mode. If you add tests, place them next to the affected package and use clear names like `feature-name.test.js`.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects such as `Fix terminal keyboard forwarding and trust prompt detection` and `Add retry action for blocked tasks`. Keep commits focused and descriptive. Pull requests should explain the user-visible change, note any setup or config impact, link the relevant issue or task, and include screenshots for dashboard or modal updates.

## Security & Configuration Tips
Keep secrets in `.env.local` only; do not commit tokens or local repository paths. Treat `.data/` as local machine state, not source-controlled configuration. When changing setup behavior, update both `scripts/setup.js` and `README.md` so onboarding stays accurate.
