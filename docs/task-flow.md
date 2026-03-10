# Task Flow Contract

This document defines the expected end-to-end task lifecycle for AI Factory.

## Core Flow

1. A user creates a task with a repository, short title, and description.
2. Before planning begins, the app creates a task-specific workspace folder at `<workspaceRoot>/<taskId>` and checks out the selected repository there.
3. A planner agent runs inside that task workspace and produces a plan.
4. The user can inspect the plan, approve it, or send feedback to revise/replan it.
5. After approval, an implementor agent works in the same task workspace and on the planned branch.
6. After implementation, a reviewer agent reviews the same workspace.
7. If review fails, the task returns to implementation with reviewer feedback.
8. Review/implementation retries are capped at 3 failed review cycles. After that, the task is blocked and awaits human input.
9. If review passes, the app creates a pull request from the task workspace, deletes the local task workspace, and then marks the task as done.

## Control Rules

- Each stage uses its own terminal session.
- When a task moves to the next column, the previous stage's session is terminated.
- A task can be blocked at any stage and should be clearly shown as awaiting human input.
- Blocked tasks appear at the top of their owning column.
- A task can be paused, resumed, retried, or aborted.
- Aborting a task stops automation and deletes its task workspace.

## Status Semantics

- `workspace_setup`, `planning`, `awaiting_approval` belong to the planning column.
- `queued`, `implementing` belong to the implementation column.
- `review` belongs to the review column.
- `done` means PR creation and workspace cleanup both succeeded.
- `blocked` and `paused` are overlay states and retain the task's owning column context.
