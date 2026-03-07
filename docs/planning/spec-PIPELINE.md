# Pipeline

The orchestrator is an in-process class that drives tasks through stages. It polls the task queue every 4 seconds and reacts to agent output signals.

## Stages

```
backlog → planning → awaiting_approval → implementing → review → awaiting_human_review → done
                                                ↑              |
                                                └── (on FAIL) ┘
                          ↑          |
                          └─ (reject)┘

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
| `awaiting_human_review` | PR open, waiting for human merge |
| `blocked` | Agent hit a blocker or timed out |
| `done` | Merged or manually closed |

## Orchestrator Responsibilities

- Poll backlog every 4s, assign to Planner when it's idle
- Watch each agent's terminal buffer for completion signals
- On human approval → assign to available Implementor, create git branch
- On human rejection → re-run Planner with feedback appended
- On implementation complete → push branch, assign to Reviewer
- On review PASS → open GitHub PR (or skip if unconfigured), set `awaiting_human_review`
- On review FAIL → return to implementing with review feedback
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
4. Update task: `status → awaiting_approval`, `plan = planText`, `branch = parsedBranch`
5. Kill planner PTY, set agent status to idle
6. Broadcast `PLAN_READY`

**On rejection (human):**  
Append `planFeedback` to task. Set `status → planning`. Re-run planner with revised prompt.

**Rejection loop:** There is no limit on rejection cycles.

## Implementor Agents

**CLIs:** Implementor-1 defaults to `claude`, Implementor-2 defaults to `codex` — configurable via `.env.local`  
**Trigger:** Task is approved (`awaiting_approval → implementing`) or returned from review  
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
Prompt includes `PREVIOUS REVIEW ISSUES TO FIX: {task.reviewFeedback}`. Same branch, no new branch creation.

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
- If `GITHUB_TOKEN` + `GITHUB_REPO` configured → call GitHub API to open PR → set `prUrl`, `status → awaiting_human_review`
- If not configured → set `status → awaiting_human_review`, notify user GitHub is not set up

**On FAIL:**
- Extract `CRITICAL_ISSUES:` block
- Set `task.reviewFeedback = criticalIssues`
- Set `status → implementing`
- Re-assign to first available implementor (same branch, no new branch)

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

If the API call fails, don't crash — log the error and set `status → awaiting_human_review` anyway.

## Restart Recovery

On server startup, tasks in transient states are reset:

| Was in | Reset to |
|---|---|
| `planning` | `backlog` |
| `implementing` | `awaiting_approval` (plan was already approved) |
| `review` | `awaiting_approval` (re-run from approval, safer than partial review) |
| `queued` | `awaiting_approval` |

Tasks in `awaiting_approval`, `awaiting_human_review`, `blocked`, `done` are left as-is.

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
