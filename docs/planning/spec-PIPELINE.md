# Pipeline

The orchestrator is an in-process class that drives tasks through stages. It polls the task queue every 4 seconds and reacts to agent output signals.

## Stages

```
backlog → planning → awaiting_approval → implementing → review → done
                          ↑              |                |
                          └─ (reject)┘   |                └─ (PASS)
                                         |
                                         └─ (FAIL) → backlog/workspace_setup → planning → queued → implementing

Any stage → blocked  (when agent signals a blocker or times out)
```

| Status key | Meaning |
|---|---|
| `backlog` | Added, not yet picked up |
| `planning` | Planner agent is drafting a plan |
| `awaiting_approval` | Plan complete, waiting for human |
| `implementing` | Implementor agent is coding |
| `queued` | Both implementors busy, task waiting |
| `review` | Reviewer agent is reviewing the branch |
| `blocked` | Agent hit a blocker or timed out |
| `done` | PR was created successfully and local cleanup completed |

## Orchestrator Responsibilities

- Poll backlog every 4s, assign to Planner when it's idle
- Watch each agent's terminal buffer for completion signals
- On human approval → assign to available Implementor, create git branch
- On human rejection → re-run Planner with feedback appended
- On implementation complete → push branch, assign to Reviewer
- On review PASS → open GitHub PR, clean up workspace, mark `done`
- On review FAIL → re-run Planner on the same branch with reviewer findings, then auto-queue implementation once the revised plan is ready
- Detect stuck agents (no new output for 10 min) → mark blocked
- Broadcast all state changes to WebSocket clients

## Planner Agent

**CLI:** `claude`  
**Trigger:** Task enters `planning` status and planner is idle  
**Timeout:** 5 minutes → mark blocked

The orchestrator writes the prompt to the planner's PTY stdin. See `PROMPTS.md` for the exact prompt.

**Completion signal:** `=== PLAN END ===` appears in terminal buffer

**On completion:**
1. Extract text between `=== PLAN START ===` and `=== PLAN END ===`
2. Parse `BRANCH:` field with `/BRANCH:\s*(.+)/`
3. Save full plan to `.data/plans/{taskId}.md`
4. Update task:
   - Fresh planning: `status → awaiting_approval`, `plan = planText`, `branch = parsedBranch`
   - Review revision planning: `status → queued`, `plan = planText`, `branch = parsedBranch`, preserving `reviewFeedback` and `reviewCycleCount`
5. Kill planner PTY, set agent status to idle
6. Broadcast `PLAN_READY`

**On rejection (human):**  
Append `planFeedback` to task. Set `status → planning`. Re-run planner with revised prompt.

**Rejection loop:** There is no limit on rejection cycles.

## Implementor Agents

**CLIs:** Implementor-1 defaults to `claude`, Implementor-2 defaults to `codex` — configurable via `.env.local`  
**Trigger:** Task is approved (`awaiting_approval → implementing`) or a revised plan is auto-queued after failed review  
**Timeout:** 60 minutes → mark blocked  
**Parallel:** Two implementors. If both busy, task waits in `queued`.

**Before spawning:**
```js
await git.checkoutLocalBranch(task.branch)
// If branch exists: git.checkout(task.branch)
```

**Completion signal:** `=== IMPLEMENTATION COMPLETE ===` on its own line

**On completion:**
1. `await git.push('origin', task.branch)`
2. Update task: `status → review`, `assignedTo → 'reviewer'`
3. Kill implementor PTY, set agent to idle
4. Spawn Reviewer

**Blocker signal:** `=== BLOCKED: {reason} ===`

**On blocker:**
1. Update task: `status → blocked`, `blockedReason = reason`
2. Set agent `status → blocked`
3. Broadcast `TASK_BLOCKED`

**Second pass (after review FAIL):**  
Prompt includes the revised plan plus `PREVIOUS REVIEW ISSUES TO FIX: {task.reviewFeedback}`. Same branch, no new branch creation.

## Reviewer Agent

**CLI:** Always `claude`  
**Trigger:** Task enters `review` status  
**Timeout:** 30 minutes → mark blocked

**Completion signal:** `=== REVIEW END ===` appears in terminal buffer

**On completion:**
1. Extract text between `=== REVIEW START ===` and `=== REVIEW END ===`
2. Parse `VERDICT: PASS` or `VERDICT: FAIL`
3. Save review to `task.review`

**On PASS:**
- Push/rebase the branch as needed
- Create the PR with `gh pr create`
- Clean up the local workspace and set `status → done`

**On FAIL:**
- Extract `CRITICAL_ISSUES:` block
- Increment `reviewCycleCount`
- If the max review cycles is reached, set `status → blocked`
- Otherwise set `task.reviewFeedback = criticalIssues`, mark the next planner run as auto-approved, and return the task to planning on the same branch/workspace
- When the revised plan completes, queue implementation without stopping at human approval

## Signal Detection

The orchestrator watches each agent's `terminalBuffer` (a rolling array of the last 500 data chunks). Check every 2–3 seconds with `setInterval`. Stop checking on signal found or timeout.

```
Planner done:           === PLAN END ===
Implementation done:    === IMPLEMENTATION COMPLETE ===
Implementation blocked: === BLOCKED: {reason} ===
Review done:            === REVIEW END ===
```

Use regex to detect signals in the joined buffer string. Don't rely on exact line boundaries — the PTY may split output arbitrarily.

## GitHub PR Creation

```
POST https://api.github.com/repos/{owner}/{repo}/pulls
Authorization: Bearer {GITHUB_TOKEN}
Body: { title, head: task.branch, base: 'main', body: plan + review summary }
```

If the API call fails, don't crash. Mark the task blocked with the PR finalization failure.

## Restart Recovery

On server startup, tasks in transient states are reset:

| Was in | Reset to |
|---|---|
| `planning` | `backlog` |
| `implementing` | `queued` |
| `review` | `review` |
| `queued` | `queued` |

Tasks in `awaiting_approval`, `blocked`, `done` are left as-is. Revision-planning retries rely on persisted `autoApprovePlan` so blocked or paused planner runs resume to planning instead of human approval.

## Token Counting

Parse token usage from agent stdout to update the dashboard's context bar. Claude Code outputs counts in its status line. Codex has a different format.

```
Claude pattern:  /(\d[\d,]+)\s+(?:input\s+)?tokens/i
Codex pattern:   /context:\s*(\d[\d,]+)/i
```

Take the maximum of current and parsed values (counts only go up). Broadcast `AGENT_UPDATED` when the value changes meaningfully (>100 token delta, to avoid flooding).

## Orchestrator Poll Loop

Every 4 seconds:
1. Find tasks in `backlog` — assign to planner if planner is idle
2. Find tasks in `queued` — assign to implementor if one is available
3. Check all active agents for stuck state (last output > 10 min ago)
4. Broadcast `AGENTS_UPDATED` with current status of all agents
