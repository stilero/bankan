# Contributing

## Development Workflow

Ban Kan uses test-driven development for meaningful behavior changes and regressions.

Expected workflow:

1. Write or update a failing automated test for the behavior you are changing.
2. Implement the minimum production change needed to make the test pass.
3. Refactor while keeping the suite green.
4. Run the relevant package tests locally.
5. Run the full suite and coverage gate before opening a pull request.

Prioritize behavior-level tests around:

- task lifecycle and workflow state transitions
- settings validation and normalization
- WebSocket-driven client state updates
- key UI interactions that affect user-visible behavior

Avoid low-value tests that only mirror implementation details or styling structure.

## Commands

```bash
npm run lint
npm test
npm run test:server
npm run test:client
npm run coverage
npm run build
```

Run `npm run lint` after code changes and before the test suite. `npm run coverage` enforces the same combined 80% coverage gate used in CI and publish workflows.

## Pull Requests

- Add or update automated tests for the changed behavior.
- Document any intentional coverage gaps and why they remain.
- Include manual verification notes when UI or workflow behavior benefits from hands-on validation.
- Keep commits focused and descriptive.
