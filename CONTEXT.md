# Workflow Orchestration

Ban Kan defines and runs durable development workflows in which automated agents, human decisions, and system actions cooperate to move a task toward an outcome.

## Language

**Workflow**:
A versioned definition of the steps, routes, and policies used to perform a task. A published workflow is the sole source of agent behavior for new tasks.

**Workflow Version**:
An immutable published snapshot used by new tasks and retained by every task that has already selected it. Editing a draft or publishing a later version cannot change an existing run.
_Avoid_: Live workflow, current workflow

**Step**:
A unit of work or control in a workflow, such as gathering input, planning, implementation, review, approval, or delivery.
_Avoid_: Node, stage

**Agent Step**:
A step performed by an AI agent according to workflow-defined instructions, inputs, expected results, and execution policy.
_Avoid_: Planner node, reviewer node, agent role

**Agent Instructions**:
The workflow-authored description of what an Agent Step should accomplish and how the agent should work. These instructions may be edited independently for every Agent Step.
_Avoid_: Prompt body, global prompt

**Execution Contract**:
The system-owned definition of the outcomes and result structure that a step must produce so the workflow can route and validate its completion. It is normally presented in human-readable form rather than edited as raw protocol text.
_Avoid_: Prompt markers, parser format

**Route**:
A connection that selects the next step for a declared outcome. A Route may return execution to an earlier step under a bounded loop policy.
_Avoid_: Edge, connection

**Feedback Loop**:
A bounded route that returns execution to an earlier Step and supplies the result that caused the return as feedback. Exhaustion normally requires a Human Decision rather than silently failing or continuing.
_Avoid_: Retry loop, review cycle

**Review Step**:
An Agent Step that evaluates work and produces a structured assessment with a declared outcome and actionable feedback.
_Avoid_: Validation step, reviewer node

**Check Step**:
A deterministic Step that runs a verifiable check such as tests, lint, or a build and reports its result without subjective agent judgement.
_Avoid_: Validation agent, review step

**Artifact**:
A structured result produced by a Step and made available as input to later Steps. Raw transcripts and terminal output are not automatically treated as workflow context.
_Avoid_: Full history, context dump

**Human Decision**:
A Step where workflow execution pauses until a person selects one of the declared outcomes, optionally with feedback.
_Avoid_: Manual blocker, approval node

**Workflow Settings**:
Behavior and execution policy stored on a workflow or one of its steps, including agent instructions, model, effort, access, timeout, and retry policy.
_Avoid_: Agent settings, stage settings

**Workflow Defaults**:
Shared provider, model, effort, timeout, and retry values owned by a Workflow. A Step may visibly override them, while access and Agent Instructions remain explicit per Step.
_Avoid_: Global defaults, inherited prompt

**Step Template**:
A reusable starting configuration for a common Step such as planning, implementation, or review. Adding a Step Template creates an independent copy so later template changes cannot alter the Workflow silently.
_Avoid_: Agent preset, linked template

**Application Settings**:
Installation-wide configuration such as repositories, workspace location, credentials, and shared capacity limits. Application Settings do not define the behavior of new workflow tasks.
_Avoid_: Global agent settings

**Legacy Task**:
A task created under the fixed pipeline before workflows became the source of execution behavior. Legacy configuration exists only to support these tasks during migration.
