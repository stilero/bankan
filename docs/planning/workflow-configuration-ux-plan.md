# Workflow configuration and UX plan

## Goal

Make a published workflow the complete, understandable source of how every new task is executed. A user must be able to configure what each Step does, understand feedback and check loops before publishing, and see those decisions while a workflow runs.

## Accepted product model

- The UI calls graph nodes **Steps** and graph edges **Routes**.
- Agent Instructions are editable per Agent Step; the parser-critical Execution Contract is system-owned.
- Workflow Defaults provide provider, model, effort, timeout, and retry values. Each Agent Step shows its effective values and may override them.
- Access is explicit per Step. Agent Instructions are never inherited implicitly.
- Step Templates create independent configurations and cannot silently change published workflows.
- Review Steps use agent judgement. Check Steps run deterministic test, lint, build, or coverage checks.
- Artifacts, rather than entire transcripts, carry context between Steps.
- A Feedback Loop returns structured feedback to an earlier Step, has a visible maximum iteration count, and normally exhausts into a Human Decision.
- Published Workflow Versions are immutable snapshots. New publication uses workflow schema v2; v1 runs retain compatibility behavior.
- Application Settings retain repositories, workspace location, credentials, and shared capacity. They do not define new-task behavior.

## Current gaps to close

- `WorkflowStudio` edits model, effort, access, timeout, and retry but exposes neither Agent Instructions nor the required agent preset.
- New Agent Steps can therefore look configured while failing at runtime because `WorkflowDispatcher` only supports hard-coded presets.
- Runtime prompt construction is selected by `planner`, `implementer`, `general-review`, and `security-review`, not by workflow-authored behavior.
- Review parsing depends on hidden output markers and verdict text.
- Routes expose raw outcome, fallback, loop count, and exhaustion target without explaining feedback propagation.
- Settings claims workflow ownership while continuing to expose the only editable prompts.
- The live graph does not explain feedback, loop iteration, effective configuration, or why execution returned to an earlier Step.

## Target standard workflow

The built-in Standard Development workflow becomes:

`Gather input -> Plan -> Approve plan -> Implement -> Run checks -> Parallel reviews -> Deliver`

Routes behave as follows:

- Rejected plan returns to Plan with human feedback.
- Failed checks return to Implement with the check artifact.
- Requested review changes return to Implement with structured review feedback.
- Exhausted loops enter a Human Decision where a user may accept, add feedback and extend the loop, or cancel.
- Successful checks and all required reviews proceed to delivery.

## Schema v2 contract

### Workflow Defaults

Add normalized workflow-owned defaults for provider, model, effort, timeout, retry, and budgets. Persist them in drafts and immutable published snapshots. Step inspectors must distinguish inherited and overridden values and show the effective configuration.

### Agent Steps

Agent Step configuration must include:

- display name and purpose;
- editable Agent Instructions;
- explicit access mode;
- selected input Artifact bindings;
- a system-owned Execution Contract describing result type and declared outcomes;
- optional provider, model, effort, timeout, retry, and budget overrides;
- optional template provenance used only for an explicit reset preview.

The v2 dispatcher builds prompts from this snapshot configuration plus selected Artifacts. Hard-coded presets must not determine v2 behavior. The Execution Contract appends the required machine-readable completion format after user instructions so editing instructions cannot break parsing.

### Check Steps

Introduce a first-class Check Step with named adapters for test, lint, build, and coverage. An advanced custom-command adapter may be supported but must expose its command and access requirements during validation and publication. Check results are structured Artifacts with pass/fail outcomes and concise failure details.

### Routes and loops

Retain deterministic outcome routing while enriching bounded-loop configuration with the Artifact passed as feedback and the exhaustion route. Validation must ensure every declared outcome is routable, every feedback binding references a compatible Artifact, and every cycle is bounded.

### Compatibility and migration

- Never mutate published v1 snapshots or active v1 executions.
- Route v1 Agent Steps through a compatibility adapter preserving current preset-driven prompts and parsers.
- Upgrade editable drafts to schema v2 without publishing them automatically.
- Seed v2 built-in templates with complete instructions, contracts, checks, and feedback routes.
- Materialize the user's current planner, implementer, and reviewer settings into a v2 Legacy Pipeline workflow.
- Preserve legacy settings in storage while legacy tasks require them, but remove them from the normal Settings journey.
- Make migration idempotent and cover restart behavior.

## Workflow Studio UX

### Workflow list and header

- Keep drafts and immutable published versions visibly distinct.
- Allow editing workflow name, description, and Workflow Defaults.
- Show the default published version and concise execution summary.
- Preserve incomplete drafts and protect unsaved changes.

### Step palette

Lead with searchable Step Templates: Gather Input, Plan, Implement, Code Review, Security Review, Test, Lint, Build, Coverage, Human Decision, Create PR, and Outcome. Advanced mode may expose lower-level control Steps.

### Step inspector

Present sections in this order:

1. Behavior: name, purpose, and Agent Instructions.
2. Input and result: Artifact bindings, expected result, and outcomes.
3. Agent: provider, model, effort, and explicit access.
4. Execution policy: timeout, retries, budgets, and error behavior.

Behavior and Input/result are open by default. Agent and execution policy may be collapsed as advanced configuration. Canvas cards summarize Step type, effective model source, access, and outcomes.

### Route and loop editor

Replace raw fields with a sentence-like rule builder:

> When Code Review returns Changes requested, go to Implement, include Review feedback, at most 3 times, then require Human Decision.

The canvas labels the backward Route with its outcome and limit. Internal IDs remain available only in advanced details.

### Validation and publication

- Validate relevant fields inline.
- Return clickable workflow errors and warnings that focus the affected Step or Route.
- Show a path preview covering the primary path, alternative outcomes, loops, and human decisions.
- Block publication on broken contracts, invalid Artifact bindings, unrouted outcomes, unsafe checks, or unbounded cycles.
- Do not block publication on recommendations that are explicitly warnings.

## Application Settings UX

- Keep General settings for repositories and workspace location.
- Keep shared capacity limits as installation-level resource policy, using neutral provider/capacity language rather than planner/implementer/reviewer behavior.
- Remove Planning, Implementation, and Review prompt/model tabs from the normal settings flow.
- Expose legacy configuration only when legacy tasks still require it, clearly labelled as compatibility configuration.
- Link directly to the default workflow for behavioral configuration.

## Live workflow UX

For every active or completed Step, show:

- purpose and executor type;
- current status and attempt number;
- selected inputs and produced Artifacts;
- chosen outcome;
- loop iteration and limit;
- feedback that caused a return;
- exhaustion behavior and next required human action.

Human Decisions use named choices and optional feedback rather than raw outcome strings. Technical transcripts remain inspectable but are secondary to structured results.

## TDD implementation slices

### Slice 1: schema, migration, and validation

Add failing server tests for schema v2 defaults, Agent Instructions, contracts, Check Steps, Artifact bindings, bounded feedback routes, draft migration, immutable v1 versions, and idempotent restart. Implement normalization and validation in `server/src/workflowDefinitions.js`, persistence/migration in `server/src/workflowRepository.js`, and relevant API behavior in `server/src/index.js`.

### Slice 2: runtime behavior

Add failing dispatcher and engine tests proving that v2 prompts come from snapshot instructions, contracts remain system-owned, selected Artifacts become context, checks return structured results, feedback is delivered on loop re-entry, and exhaustion reaches a Human Decision. Preserve v1 behavior behind an explicit compatibility adapter.

Likely seams: `server/src/workflowDispatcher.js`, `server/src/workflowEngine.js`, `server/src/workflowRuntime.js`, and narrowly extracted prompt/check adapters where they deepen the module rather than duplicate orchestration.

### Slice 3: Workflow Studio

Add failing Testing Library tests for Workflow Defaults, Step Templates, Agent Instructions, effective override display, structured input/result configuration, Check Steps, route rules, validation navigation, and path preview. Implement the guided inspector and progressive disclosure in `client/src/WorkflowStudio.jsx` and its styles.

### Slice 4: Settings and migration UX

Add failing tests showing that normal Settings contains only application configuration and capacity, behavioral settings link to the selected workflow, and legacy controls appear only when relevant. Implement migration status and compatibility copy without deleting stored legacy settings prematurely.

### Slice 5: live execution UX

Add failing tests for effective step summaries, attempt/loop information, Artifact display, feedback reasons, and named Human Decision choices. Implement in `client/src/LiveWorkflowGraph.jsx` and the task detail integration.

### Slice 6: end-to-end proof

Exercise a fake-provider Standard Development run through input, planning, approval, implementation, failed check, fix, parallel reviews, review feedback, delivery, and success. Include restart points and assert snapshots, Artifacts, loop counters, audit events, and human actions.

## Orchestration after plan approval

The main session owns this plan, domain consistency, cross-cutting decisions, integration, and final verification. It delegates bounded work after explicit approval:

1. A backend agent handles schema v2, migration, validation, runtime, and server tests.
2. A Workflow Studio agent handles the editor and its client tests.
3. A live UX agent handles Settings, live graph behavior, and client tests.

Agents must follow test-first order and avoid editing another agent's assigned files. The main session reviews every result, resolves shared style/API changes, and fills integration gaps.

## Verification gates

- Confirm each new or changed behavioral test fails for the intended reason before implementation.
- Run focused server and client suites after each slice.
- Run `npm run lint` after code changes.
- Run `npm test` before handoff.
- Run `npm run coverage` because the change affects covered workflow logic.
- Run `npm run build --prefix client`.
- Manually verify Settings, Workflow Studio, publication preview, a feedback loop, loop exhaustion, and the live run at `http://localhost:5173` with isolated synthetic data.

## Definition of done

- A user can configure what every Agent Step does without visiting Application Settings.
- Runtime behavior is derived from the exact published Workflow Version selected by the task.
- Check and feedback loops explain their trigger, supplied feedback, limit, and exhaustion behavior before and during execution.
- No new workflow depends on global planning, implementation, or review prompts.
- Existing v1 and legacy tasks remain executable without mutating their snapshots.
- Lint, full tests, coverage, client build, and manual workflow verification pass.
