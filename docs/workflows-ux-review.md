# Workflows UX review

## Initial findings

Workflows were exposed as a separate destination from Settings, while task creation only offered a minimally labelled workflow selector. The relationship between global legacy pipeline settings, workflow-level configuration, the published default, and the version pinned to a task was not clear. Important loading, empty, error, validation, pending, and success states were also incomplete or too technical for a user trying to understand what happens next.

The initial quality baseline was clean:

- `npm run lint` passed.
- `npm test` passed with 120 server tests and 69 client tests.
- The repository had no browser-driven end-to-end test suite; UI polish depended on manual dashboard verification in addition to Vitest and Testing Library coverage.

## Agreed scope and UX principles

- Connect Settings, workflow selection, task creation, and task execution as one understandable journey.
- Describe legacy pipeline settings and workflow node configuration truthfully; workflow nodes do not implicitly inherit settings unless the execution contract explicitly says so.
- Present one recommended default while preserving an intentional per-task choice.
- Pin a task to an exact published workflow version so later edits cannot silently change its behavior.
- Explain phases, agent work, human decisions, and the next required action in user language while retaining technical details as secondary information.
- Keep drafts distinct from immutable published versions and prevent invalid definitions from being published.
- Preserve user input on failures and show pending, success, and actionable error feedback close to the action.
- Preserve legacy non-workflow task behavior.

## Acceptance checklist

- [x] First-run guidance connects repository setup, workflow choice, and task creation.
- [x] Settings clearly identifies legacy pipeline defaults versus workflow-specific configuration.
- [x] A user can view and change the default published workflow, with acknowledged success and inline failure handling.
- [x] The chosen default persists across reload or reconnect.
- [x] Task creation shows the recommended workflow, exact version, and a concise execution summary.
- [x] Switching workflow updates the summary; unavailable or unpublished choices are explained and blocked.
- [x] A created task stores the selected workflow ID and exact published version.
- [x] Draft and published workflow states are visually distinct.
- [x] Validation errors identify the affected node or configuration and invalid workflows cannot be published.
- [x] Live execution distinguishes automated work from required human input and exposes the next action.
- [x] Pause, resume, cancel, approval, and outcome actions show pending, success, and error states.
- [x] Empty, loading, disconnected, stale-default, API-error, and execution-failure states provide a recovery path.
- [ ] Primary journeys work with keyboard navigation and status is not conveyed by color alone.
- [ ] Primary actions remain usable at normal desktop and narrow viewport widths.
- [x] Legacy tasks and settings normalization remain compatible.
- [x] Lint, full automated tests, and isolated browser journeys pass after implementation.

## Verification evidence

An isolated packaged-runtime instance was started against temporary data, separate from the user's normal runtime state. The dashboard loaded successfully in a dedicated browser tab and showed the expected empty task state with task creation disabled until repository setup. No real task or external agent was started.

The first backend metadata slice was independently checked with the focused workflow repository and runtime suites: 2 test files and 7 tests passed. The checks confirmed that a task created without an explicit workflow selection uses and snapshots the exact configured default version even when a newer version has subsequently been published. Human decision outcomes are now derived from the workflow edges that actually drive routing.

The first Workflow Studio slice exposed dirty-state, internal-navigation, and stale-default issues. Follow-up browser checks confirmed their correction: opening a workflow is clean, internal navigation protects unsaved edits, and changing the exact default version produces one current default. The Studio now limits its palette to supported editable node types and exposes named outcomes, fallback routes, and bounded-loop settings for connections.

The first automated-dispatch slice exposed execution risks around process exit validation, preservation of uncommitted implementation output, repeat execution of nodes in bounded loops, late action completion after pause or cancellation, and recovery after a server restart. Each finding gained a behavioral regression test before final verification.

Subsequent dispatcher changes addressed those five findings with exit metadata and structured completion contracts, dirty-worktree preservation, attempt-specific claims, post-action cancellation checks, timeouts, and running-only startup recovery. Recovery no longer replays an uncertain active create-PR action; it moves the task to explicit human reconciliation while retaining the active action. Manual completion is restricted to an active `create-pr` node and a verified task transition to done.

The final isolated browser journey completed a synthetic human-only workflow without launching an external agent: Settings saved a temporary repository with server acknowledgement, Add Task selected and explained an exact published version, the created run displayed the friendly workflow name and pinned version, an Interview response was persisted and rendered as an `interview-answers` artifact, Approval reached a successful terminal state, and terminal controls disappeared. Restarting the isolated server mid-Interview also preserved the active human step. Screenshots were captured from synthetic temporary data for workflow selection, Studio, and the completed run.

Coverage was compared with a clean `HEAD` materialization in temporary storage. The baseline passed at 93.87% lines, 80.98% branches, and 80.21% functions. An intermediate regression was identified and corrected with behavioral tests. The final change passes at 95.72% lines, 80.13% branches, and 84.07% functions.

Final independent gates all passed: lint, production client build, 148 server tests, 79 client tests, and the combined coverage threshold.

## Remaining limitations

- There is currently no checked-in Playwright, Cypress, or equivalent end-to-end suite.
- Screenshots must use isolated synthetic data only and must not contain user paths, tasks, credentials, or other private data.
- The available browser-control surface did not expose viewport emulation, so narrow-layout behavior has only been inspected through the responsive CSS and still requires a real narrow-viewport check.
- External agent execution and pull-request creation were intentionally not exercised during browser QA; those paths are covered with mocked automated tests only.
- Once an external push or `gh` process has begun, pause or cancellation cannot undo that external side effect; recovery prevents automatic replay and requires human reconciliation instead.
