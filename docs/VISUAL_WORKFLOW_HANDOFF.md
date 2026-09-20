# Visual Workflow Orchestration Handoff

## Objective

Finish the migration from the fixed planner → implementer → reviewer dispatcher to durable, versioned visual workflows. Preserve the current implementation and complete the missing production execution behavior described below.

The worktree contains uncommitted implementation changes. Treat those changes as the starting point; inspect and extend them rather than recreating the feature.

## Current state

The first end-to-end foundation is implemented and verified:

- `better-sqlite3` stores workflow drafts, immutable published versions, defaults, task snapshots, node runs, artifacts, supervisor summaries, user exchanges, and audit events.
- `Standard Development`, `Simple Linear`, `Security Focused`, and `Legacy Pipeline` are seeded. Standard Development is the default.
- New tasks snapshot a published workflow version. Loaded tasks without workflow metadata remain marked `executionMode: 'legacy'` and are the only tasks consumed by the legacy dispatcher.
- Publication validation covers node IDs/types, provider/model/effort/access combinations, executable-node timeout/retry policy, condition fallbacks, terminal nodes, start nodes, and bounded cycles.
- The deterministic engine handles phases, conditions, forks, joins, bounded loop exhaustion, terminal outcomes, artifacts, task/node pause and resume, cancellation, retry-attempt guards, and guarded skip.
- REST endpoints cover workflow draft CRUD operations currently needed by the UI, validation, publication, versions, defaults, import/export, run inspection, exchanges, and run controls.
- WebSocket initialization exposes workflows and the default. New task creation uses workflow snapshots, and workflow run updates are broadcast.
- `/workflows` renders a workflow list and XYFlow draft canvas. `/tasks/:id/workflow` renders the durable run graph, artifacts, budgets, active outcomes, and task controls.
- The README and setup output describe workflow storage and migration behavior. The minimum Node version is now 22 because `better-sqlite3@13` requires it.

Primary implementation seams:

- `server/src/workflowDefinitions.js`: schema vocabulary, validation, provider capabilities, built-in templates.
- `server/src/workflowRepository.js`: SQLite schema and persistence API.
- `server/src/workflowEngine.js`: deterministic graph transitions.
- `server/src/workflowRuntime.js`: bridge between tasks, repository, engine, and events.
- `server/src/index.js`: REST and WebSocket transport.
- `server/src/orchestrator.js`: legacy dispatcher; workflow tasks are filtered out.
- `client/src/WorkflowStudio.jsx`: workflow list/editor route.
- `client/src/LiveWorkflowGraph.jsx`: live execution route.
- `client/src/App.jsx` and `client/src/useFactory.js`: routing, task creation, and WebSocket integration.

## Important limitations

The workflow engine currently advances deterministic nodes but does not schedule real workflow Agent nodes. Active Interview, Agent, Approval, and Action nodes wait for a user to choose an outgoing outcome in the live graph. Consequently, new workflow tasks snapshot and enter Standard Development correctly, but they do not yet run the intended autonomous development lifecycle.

The following promised behavior is still missing or incomplete:

- Durable LLM supervisor decisions and adaptive interview behavior.
- Disposable workflow-agent process scheduling and generalized task/run/node/attempt identities.
- Workspace isolation, serialized write nodes, Git checkpoint commits, rollback before retry, and failed dirty-workspace preservation.
- Enforced time, token, cost, retry, and concurrency budgets.
- Timeout/backoff timers and restart recovery for in-flight node attempts.
- Provider capability adapters sourced from actual installed provider capabilities rather than a static map.
- JSON Schema registration and artifact validation.
- Built-in Action implementations for tests, commits, pull requests, and artifact publication.
- Full fork/join cancellation-versus-drain behavior and task-wide branch scheduling.
- Complete migration of legacy settings, plans, reviews, sessions, and completed history into SQLite.
- A fully editable graph: edge creation/removal, inspector-backed configuration editing, version-history UI, default selection UI, and import/export controls.
- Node-level pause, resume, cancel, retry, and skip controls in the live graph.
- Automatic execution of approval/interview exchanges from the dashboard.
- End-to-end Standard Development coverage with real scheduler adapters.

## Recommended implementation order

Follow repository TDD: add one failing behavioral test at a public seam, confirm the expected failure, implement the smallest vertical behavior, and rerun the relevant suite. Run lint and the full suite before each handoff.

### 1. Build the durable scheduler

Create a workflow scheduler separate from the legacy orchestrator. It should inspect persisted runnable nodes, respect application/provider/workflow/node concurrency limits, and dispatch only nodes whose dependencies are satisfied.

Use identities containing task ID, run ID, node ID, and attempt. Extend `AgentManager` with a workflow-agent factory instead of relying on `plan-`, `imp-`, and `rev-` prefixes. Ensure the legacy unexpected-exit listener ignores workflow agents so only the workflow scheduler owns their completion.

On startup, reconstruct scheduling from SQLite. Treat provider-native session IDs as optional acceleration; persisted summaries, artifacts, decisions, and checkpoints are authoritative.

Completion criteria:

- A persisted active Agent node starts a real disposable process with its node configuration.
- Process exit, malformed output, timeout, cancellation, and restart each result in one deterministic persisted transition.
- Restarting the server resumes scheduling without duplicating attempts.
- Read-only concurrency and write exclusivity are proven through behavioral tests.

### 2. Implement the supervisor and Interview node

Build context from `getSupervisorContext()` plus the task snapshot and current node contract. Keep raw transcripts inspectable through `user_exchanges` or filesystem transcript storage, but exclude them from automatic context reconstruction.

Interview must persist every exchange, maintain required-field completion and unresolved assumptions, produce a typed final brief artifact, and require explicit user approval before routing onward. Supervisor decisions must be limited to outcomes declared by outgoing graph edges.

Completion criteria:

- Required fields survive restart and cannot be bypassed by approval.
- The final brief and approval are durable artifacts/events.
- Reconstructed context contains summaries and typed artifacts without raw transcript flooding.
- A supervisor cannot choose an undeclared route.

### 3. Add workspace and checkpoint semantics

Create a task workspace before the first write-capable node. Permit parallel read-only nodes against the same recorded input commit. Serialize write-capable nodes per task.

After a successful write node, create an engine-owned Git checkpoint commit and persist its hash on the node run and execution. Before retry, restore the node's recorded input checkpoint. Preserve dirty workspaces after failures and cancellation until explicit cleanup.

Completion criteria:

- Successful write attempts record a real checkpoint commit.
- Retry starts from the input checkpoint and excludes failed-attempt mutations.
- Failed dirty state remains inspectable.
- task cancellation preserves state; delete performs the separate explicit cleanup.

### 4. Enforce runtime policy

Normalize workflow defaults and per-node overrides into one effective node policy. Enforce timeout, exponential/fixed backoff, maximum attempts, cancellation edges, task and node token/cost/time budgets, and all concurrency ceilings.

Finish join semantics: `all`, `any`, and numeric threshold; cancel or drain remaining branches, defaulting to cancellation. When a branch is cancelled, persist both its node-run state and audit event.

Completion criteria:

- Every executable node has observable timeout, retry, error, and cancellation behavior.
- Budget exhaustion follows a declared route or fails deterministically.
- Join completion cannot leave orphaned running processes.
- Tests use deterministic clocks/adapters rather than real sleeps.

### 5. Complete schemas, capabilities, and actions

Add persistence and REST APIs for custom JSON Schemas. Validate typed artifacts before accepting node completion. Replace the static provider map with adapters that report installed CLI/provider model, effort, permission, and session-resume capabilities; publication must reject unsupported combinations.

Implement Action adapters for tests, commits, pull-request creation, and artifact publication. Each adapter should return a typed result and route through the same timeout/retry/budget machinery as Agent nodes.

Completion criteria:

- Malformed artifacts are rejected without advancing the graph.
- Provider validation reflects the configured/installed adapter.
- Actions are idempotent or expose an explicit safe retry strategy.
- Secrets and execution history never appear in workflow export.

### 6. Finish migration

On first upgraded startup, transactionally import legacy task metadata, plans, reviews, settings, session summaries, and completed history. Build the published Legacy Pipeline from current provider/model/prompt settings rather than the current static template.

Keep nonterminal imported tasks on the legacy executor. When none remain, stop starting the legacy dispatcher while retaining imported history as readable data.

Completion criteria:

- Migration is idempotent and records its schema/data version.
- Existing active tasks continue from their prior legacy stage.
- Completed history remains visible.
- New tasks always route through a published workflow snapshot.

### 7. Finish the editor and live graph

Add XYFlow edge creation/removal, node deletion, inspector forms for every node type, effective-default previews, validation-to-node navigation, version history, default selection, and JSON import/export. Preserve incomplete drafts.

For live runs, add interview exchange UI, approval feedback, node controls, branch/join state, attempts, logs, checkpoints, artifacts, budgets, and failure details. Subscribe to run events so the graph updates without reload. Replace the generic completion button with node-type-specific interactions.

Completion criteria:

- A user can build, validate, publish, export, import, select, and run a workflow without editing JSON directly.
- Every allowed control is visible only when valid for the published node/run state.
- Kanban movement occurs only after a persisted Phase node event.
- Automated UI tests cover selection, validation, controls, artifacts, and phase transitions.

### 8. Prove the standard workflow end to end

Add one integration harness with fake provider, Git, clock, and action adapters. Exercise:

`interview → plan → approval → implementation → parallel reviews → bounded fix loop → delivery → success`

Include restart points during interview, write execution, join waiting, and retry backoff. Assert artifacts, summaries, checkpoints, budgets, audit events, branch state, task phase, and final outcome.

Completion criteria:

- The test passes without manual state mutation or timing sleeps.
- Every persisted entity needed for restart is asserted.
- Legacy-task draining and new-task workflow routing pass in the same migration suite.

## Known implementation notes

- The current default templates validate, but revisit their routes when real scheduler semantics land. In particular, parallel-review failure routing can reactivate the implementer while another review branch is still active; cancellation/drain policy must resolve that explicitly.
- `WorkflowEngine.completeNode()` accepts caller-provided artifacts without schema validation.
- `WorkflowEngine.retryNode()` records the checkpoint in input metadata but does not perform Git rollback.
- `WorkflowEngine.pauseNode()` marks the latest node run paused but process termination belongs to the future scheduler.
- Budgets currently appear in the snapshot and UI but are not decremented or enforced.
- `WorkflowStudio` stores node position changes but does not yet connect edges or edit configuration.
- `LiveWorkflowGraph` fetches once and applies local control responses; it does not yet consume `WORKFLOW_RUN_UPDATED` directly.
- The root and server packages both declare `better-sqlite3`; keep both until packaging is reviewed because the published root package ships `server/src` but not `server/package.json`.
- `@xyflow/react` increases the main client bundle beyond Vite's 500 kB warning threshold. Route-level lazy loading is a reasonable follow-up after behavior is complete.

## Verification baseline

The current worktree passed:

```bash
npm run lint
npm test
npm run build
npm run coverage
```

Baseline results:

- 115 server tests passed.
- 69 client tests passed.
- Combined coverage: 93.87% lines, 80.98% branches, 80.21% functions.
- Production build succeeded with only the XYFlow bundle-size warning noted above.

Before the next handoff, rerun all four commands. Keep the combined coverage gate at or above 80% for lines, branches, and functions.
