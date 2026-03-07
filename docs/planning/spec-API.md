# API

## WebSocket

Connect to `ws://localhost:3001`. All messages are JSON:

```
{ type: string, payload: object, ts: number }
```

### Server → Client

| Type | Payload | When |
|---|---|---|
| `INIT` | `{ tasks: Task[], agents: AgentStatus[] }` | Immediately on connect |
| `TASKS_UPDATED` | `{ tasks: Task[] }` | After any task mutation |
| `TASK_ADDED` | `{ task: Task }` | New task added |
| `AGENTS_UPDATED` | `{ agents: AgentStatus[] }` | Every poll tick (4s) |
| `AGENT_UPDATED` | `{ agent: AgentStatus }` | Single agent status change |
| `PLAN_READY` | `{ taskId, plan: string }` | Planner finished, needs human approval |
| `REVIEW_PASSED` | `{ taskId }` | Reviewer passed, PR being created |
| `REVIEW_FAILED` | `{ taskId, issues: string }` | Reviewer found critical issues |
| `PR_CREATED` | `{ taskId, prUrl: string }` | GitHub PR opened |
| `TASK_BLOCKED` | `{ taskId, reason: string }` | Agent signalled a blocker |
| `TERMINAL_DATA` | `{ agentId: string, data: string }` | Raw PTY bytes — write directly to xterm |

### Client → Server

| Type | Payload | Effect |
|---|---|---|
| `ADD_TASK` | `{ title, priority, description }` | Creates task in backlog |
| `APPROVE_PLAN` | `{ taskId }` | Moves to implementing, spawns implementor |
| `REJECT_PLAN` | `{ taskId, feedback: string }` | Returns to planning with feedback |
| `INJECT_MESSAGE` | `{ agentId, message }` | Writes text to agent PTY stdin |
| `PAUSE_AGENT` | `{ agentId }` | Sets paused flag, queues writes |
| `RESUME_AGENT` | `{ agentId }` | Clears paused flag, flushes queue |
| `SUBSCRIBE_TERMINAL` | `{ agentId }` | Server starts streaming `TERMINAL_DATA` for this agent to this client |
| `UNSUBSCRIBE_TERMINAL` | `{ agentId }` | Stop streaming |

### Terminal Subscription

Each agent has a `Set` of WebSocket clients subscribed to its output. On `SUBSCRIBE_TERMINAL`:
1. Add client to agent's subscriber set
2. Immediately replay the terminal buffer (last 500 chunks) to the new subscriber
3. Forward all subsequent PTY output as `TERMINAL_DATA`

On `UNSUBSCRIBE_TERMINAL` or WS disconnect: remove from subscriber set.

## REST API

Minimal — the WS protocol handles everything. REST exists for healthchecks and CLI scripting.

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/status` | `{ agents, tasks, uptime }` |
| `POST` | `/api/tasks` | Body: `{ title, priority?, description? }` → returns created Task |
| `PATCH` | `/api/tasks/:id/approve` | Approves plan → returns `{ ok: true }` |
| `PATCH` | `/api/tasks/:id/reject` | Body: `{ feedback }` → returns `{ ok: true }` |

## Data Shapes

### Task

```ts
{
  id: string              // 'T-A1B2C3' (6-char UUID prefix)
  title: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  status: string          // see pipeline stage keys
  branch: string | null
  plan: string | null     // full plan text from planner
  review: string | null   // full review text from reviewer
  prUrl: string | null
  prNumber: number | null
  assignedTo: string | null  // agent id
  reviewFeedback: string | null  // critical issues from failed review
  planFeedback: string | null    // human rejection feedback
  blockedReason: string | null
  progress: number        // 0–100. Parse from agent output if possible, else 0
  createdAt: string       // ISO
  updatedAt: string       // ISO
  log: Array<{ ts: string, message: string }>
}
```

### AgentStatus

```ts
{
  id: string        // 'orch' | 'plan' | 'imp1' | 'imp2' | 'rev'
  name: string      // display name e.g. 'Planner'
  role: string      // subtitle e.g. 'Plan Generation'
  icon: string      // single unicode char for the UI
  color: string     // CSS color string
  status: 'active' | 'idle' | 'blocked' | 'paused'
  task: string      // human-readable description of current work, or ''
  currentTask: string | null  // task ID e.g. 'T-A1B2C3'
  tokens: number    // tokens used in current context window
  maxTokens: number // always 200000
  uptime: number    // seconds since agent process started (or server started for orch)
}
```

### Notification (client-side only)

```ts
{
  id: number        // Date.now()
  msg: string
  type: 'info' | 'success' | 'warning' | 'error'
}
```

Auto-dismiss after 5 seconds. Max 5 visible. Newest on top.

Trigger notifications on these WS events:
- `PLAN_READY` → warning: "Plan ready for {taskId} — approval needed"
- `PR_CREATED` → success: "PR created for {taskId}"
- `TASK_BLOCKED` → error: "{taskId} blocked: {reason}"
- `REVIEW_FAILED` → warning: "Review failed for {taskId} — returning to implementor"
- `REVIEW_PASSED` → success: "Review passed for {taskId}"

## Agent IDs and Config

```
orch    Orchestrator   in-process, no CLI
plan    Planner        claude
imp1    Implementor 1  IMPLEMENTOR_1_CLI (default: claude)
imp2    Implementor 2  IMPLEMENTOR_2_CLI (default: codex)
rev     Reviewer       claude
```

Colors (must match UI design system):
```
orch  → var(--amber)   #F5A623
plan  → var(--steel2)  #6AABDB
imp1  → #A78BFA
imp2  → #34D399
rev   → var(--yellow)  #FFD166
```
