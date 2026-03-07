# UI

The visual design is complete (`ai-factory-v2.jsx`). The agent's job is to wire it to real data — **do not redesign**, only connect.

## Design System

CSS variables defined in `index.css`:

```css
--bg:       #0C0C0E   /* base background */
--bg1:      #111114   /* slightly elevated */
--bg2:      #16161A   /* selected / active */
--bg3:      #1C1C22   /* highest elevation */
--border:   #252530
--border2:  #2E2E3C
--amber:    #F5A623   /* primary signal: attention, active, CTA */
--steel2:   #6AABDB   /* planner/agent color */
--green:    #3DDC84   /* success, approve, active */
--red:      #FF4D4D   /* blocked, critical, danger */
--yellow:   #FFD166   /* reviewer, warning */
--text:     #E8E8F0
--text2:    #9090A8
--text3:    #50505E   /* dim labels */
--font-mono: 'DM Mono', monospace
--font-head: 'Syne', sans-serif
```

Load both fonts from Google Fonts in `index.html`.

## Layout

Fixed-height viewport. No top-level scroll.

```
┌──────────────── TOP BAR (44px, fixed) ─────────────────┐
├──────────────── CONVEYOR BELT (56px) ──────────────────┤
│ LEFT RAIL  │       MAIN AREA        │  RIGHT DRAWER    │
│  220px     │  flex-1, overflow auto │  420px, optional │
│  Agent     │  Factory Floor view OR │  xterm.js        │
│  Stations  │  Task Queue view       │  terminal        │
└────────────┴────────────────────────┴──────────────────┘
```

Right drawer is conditionally rendered. When no agent is selected it's absent and main area fills full width.

## Top Bar

Left to right:
- **Logo:** hexagon SVG + "AI FACTORY" in Syne 800
- **Nav tabs:** "Factory Floor" | "Task Queue" — active tab has `var(--amber)` bottom border
- **Attention badge:** shown when any task is in `awaiting_approval` or `awaiting_human_review`. Amber pulsing dot + "{n} need{s} your attention". Clicking navigates to Task Queue view.
- **Stats (right-aligned):** Active `N/total`, Blocked, In Flight, Total Context tokens — all live from `useFactory()` hook
- **+ ADD TASK:** Amber-filled button, opens modal

## Conveyor Belt

56px strip showing all tasks **not** in `backlog` or `done`.

- Animated diagonal-stripe texture via CSS (`repeating-linear-gradient` + `background-position` animation)
- Top and bottom 1px rail lines
- Task chips: `[priority dot] [task ID] [title truncated] [stage badge]`
- Chip left border: `3px solid {stageColor}` — the only decoration needed
- When no in-flight tasks: show "CONVEYOR CLEAR" in dim text

Stage colors:
```
planning              → var(--steel2)
awaiting_approval     → var(--amber)
implementing          → var(--green)
review                → #A78BFA
awaiting_human_review → #60A5FA
blocked               → var(--red)
```

## Left Rail — Agent Stations

One card per agent, stacked vertically, border-bottom dividers. Click a card to toggle the terminal drawer.

Each card shows:
- **Top border:** 3px `agent.color` when selected, 3px `var(--red)` when blocked, transparent otherwise
- **Status dot:** Pulsing when `active`, static when `idle`/`blocked`
- **Name** (Syne bold) + **role** (DM Mono, dim)
- **Current task:** `[taskId in agent.color] task title` — italic "idle" when no task
- **Context bar:** 2px height. Fills with `agent.color` up to 70%, then `var(--yellow)`, then `var(--red)` after 85%
- **Uptime:** formatted as `Xs`, `Xm Xs`, or `Xh Xm`

Clicking a selected agent deselects it (closes terminal drawer).

## Factory Floor View

Two sections stacked:

### Pipeline Bar

Horizontal table, one column per stage. Columns show:
- Stage label (8px mono, uppercased)
- Count badge (circular, shown only when > 0)
- Task chips for tasks in that stage (task ID + truncated title)

### Task Table

Dense data table with sticky header. Columns:

| Col | Width | Content |
|---|---|---|
| Priority | 28px | 6px square dot, `border-radius: 1px`, color = priority color |
| Task | flex-1 | Task ID (dim) + title + branch (dim, smaller) |
| Age | 70px | Time since creation |
| Progress | 80px | 2px bar + percentage (hidden when 0) |
| Status/Actions | 100px | See below |

**Status column behaviour:**
- Default: status dot + stage label
- `awaiting_approval`: "✓ Approve" + "↩ Revise" buttons
- `awaiting_human_review`: "↗ PR" link button (opens `task.prUrl`)
- `blocked`: red label

**Inline rejection flow:**
When "↩ Revise" is clicked, a micro-drawer slides down beneath the task row. It contains a text input ("Feedback for planner…"). Enter submits. Escape cancels. No modal.

## Task Queue View

Two sections:
1. **Needs Attention** — only tasks in `awaiting_approval` or `awaiting_human_review`, shown with approval/PR buttons
2. **All Tasks** — same table as Factory Floor view, all tasks

## Terminal Drawer (Right Panel)

xterm.js renders real PTY output. This is the most critical component.

**xterm.js setup:**
```
Terminal theme: dark background (#030507), amber cursor, agent.color for selection
FitAddon: attach + call fit() on mount and on ResizeObserver callback
WebLinksAddon: attach for clickable URLs
Import '@xterm/xterm/css/xterm.css' — required for correct rendering
```

**Lifecycle:**
1. Mount → call `subscribeTerminal(agentId, data => term.write(data))`
2. Receive `TERMINAL_DATA` from hook → `term.write(payload.data)` (raw bytes, handles ANSI)
3. Unmount → call unsubscribe function returned by `subscribeTerminal`, then `term.dispose()`

**Layout:**
- Header: `← ESC` button + agent icon/name + status indicator
- Stats bar: 3-column grid — Task | Tokens (`Xk / 200k`) | Uptime
- Terminal: `flex-1`, overflow hidden, xterm fills 100%
- Inject bar: pinned to bottom, DM Mono input, caret color = `agent.color`

**Inject bar:**
User types message → Enter → `injectMessage(agentId, text)` from hook → server writes to PTY stdin.

## Add Task Modal

Centered overlay, backdrop (`rgba(0,0,0,0.7)`), click backdrop to dismiss.

Fields:
- Title input (required, Enter submits)
- Priority: 4 toggle buttons — Critical / High / Medium / Low
- Description textarea (optional)
- Submit button: amber-filled only when title is non-empty

## Notification Toasts

Fixed position, bottom-right, stacked (newest on top). Max 5. Auto-dismiss 5s.

Left border 3px in type color: info=steel, success=green, warning=amber, error=red.

## Wiring App.jsx to useFactory()

The existing `App.jsx` uses `INITIAL_TASKS` and `AGENTS` constants. Replace with:

```js
const {
  connected, agents, tasks, notifications,
  addTask, approvePlan, rejectPlan,
  injectMessage, pauseAgent, resumeAgent,
  subscribeTerminal
} = useFactory();
```

The UI logic stays identical — only the data source changes.

**Derived values computed in App.jsx from live data:**
```js
const needAttention = tasks.filter(t =>
  t.status === 'awaiting_approval' || t.status === 'awaiting_human_review'
);
const totalTokens = agents.reduce((a, b) => a + (b.tokens || 0), 0);
const activeCount = agents.filter(a => a.status === 'active').length;
const blockedCount = agents.filter(a => a.status === 'blocked').length;
const inFlight = tasks.filter(t => !['backlog','done'].includes(t.status)).length;
```
