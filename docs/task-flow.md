# Task Flow Contract

This document defines the expected end-to-end task lifecycle for AI Factory.

## Core Flow

1. A user creates a task with a repository, short title, and description.
2. During planning, the planner runs in the selected repository checkout. No task worktree is created yet.
3. After plan approval, the app creates or reuses a task-specific Git worktree at `<workspaceRoot>/<taskId>` on the planned branch.
4. The user can inspect the plan, approve it, or send feedback to revise/replan it.
5. The implementor agent works in that task worktree on the planned branch.
6. After implementation, a reviewer agent reviews the same task worktree.
7. If review fails, the task returns to implementation with reviewer feedback.
8. Review/implementation retries are capped at 3 failed review cycles. After that, the task is blocked and awaits human input.
9. If review passes, the app creates a pull request from the task worktree, removes that worktree, and then marks the task as done.

## Control Rules

- Each stage uses its own terminal session.
- When a task moves to the next column, the previous stage's session is terminated.
- A task can be blocked at any stage and should be clearly shown as awaiting human input.
- Blocked tasks appear at the top of their owning column.
- A task can be paused, resumed, retried, or aborted.
- Aborting a task stops automation and removes its task worktree.

## Status Semantics

- `planning`, `awaiting_approval` belong to the planning column.
- `workspace_setup`, `queued`, `implementing` belong to the implementation column.
- `review` belongs to the review column.
- `done` means PR creation and worktree cleanup both succeeded.
- `blocked` and `paused` are overlay states and retain the task's owning column context.
