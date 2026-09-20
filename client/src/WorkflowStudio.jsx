import { useCallback, useEffect, useMemo, useState } from 'react';
import { addEdge, Background, Controls, MiniMap, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';

const NODE_TYPES = ['Interview', 'Agent', 'Check', 'Approval', 'HumanDecision', 'Phase', 'Action', 'Terminal'];
const PHASES = ['Intake', 'Planning', 'Implementation', 'Review', 'Delivery'];
const STEP_TEMPLATES = [
  { name: 'Gather Input', type: 'Interview', config: { label: 'Gather Input', purpose: 'Collect the information needed to begin.', timeoutMs: 1800000, retry: { maxAttempts: 1, backoffMs: 0 } } },
  { name: 'Plan', type: 'Agent', config: { label: 'Plan', purpose: 'Create an actionable implementation plan.', agentInstructions: 'Plan the requested work and identify risks, dependencies, and verification.', accessMode: 'read', artifactBindings: [], executionContract: { resultType: 'plan', outcomes: ['planned'] } } },
  { name: 'Implement', type: 'Agent', config: { label: 'Implement', purpose: 'Implement the approved plan.', agentInstructions: 'Implement the approved plan, preserve unrelated work, and report the resulting artifact.', accessMode: 'write', artifactBindings: [], executionContract: { resultType: 'implementation', outcomes: ['implemented'] } } },
  { name: 'Code Review', type: 'Agent', config: { label: 'Code Review', purpose: 'Review correctness and maintainability.', agentInstructions: 'Review the implementation for correctness, maintainability, and actionable improvements.', accessMode: 'read', artifactBindings: ['implementation'], executionContract: { resultType: 'review', outcomes: ['approved', 'changes_requested'] } } },
  { name: 'Security Review', type: 'Agent', config: { label: 'Security Review', purpose: 'Review security risks.', agentInstructions: 'Review the implementation for security risks and provide actionable feedback.', accessMode: 'read', artifactBindings: ['implementation'], executionContract: { resultType: 'review', outcomes: ['approved', 'changes_requested'] } } },
  ...['Test', 'Lint', 'Build', 'Coverage'].map(name => ({ name, type: 'Check', config: { label: name, purpose: `Run the ${name.toLowerCase()} check.`, adapter: name.toLowerCase(), executionContract: { resultType: 'check-result', outcomes: ['pass', 'fail'] } } })),
  { name: 'Human Decision', type: 'HumanDecision', config: { label: 'Human Decision', purpose: 'Pause for a named human decision.', outcomes: ['accepted', 'cancelled'] } },
  { name: 'Create PR', type: 'Action', config: { label: 'Create PR', purpose: 'Create the delivery pull request.', outcomes: ['created'] } },
  { name: 'Outcome', type: 'Terminal', config: { label: 'Outcome', outcome: 'Success' } },
];

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok && typeof payload.valid !== 'boolean') throw new Error(payload.error || 'Request failed');
  return payload;
}

function nodeLabel(node) {
  return node.config?.label || (node.type === 'Phase' ? `Phase: ${node.config?.phase || 'Intake'}` : node.type);
}

function flowNode(node) {
  return { ...node, position: node.position || { x: 0, y: 0 }, data: { ...node.data, label: nodeLabel(node), nodeType: node.type } };
}

function summarize(workflow) {
  const phases = workflow.summary?.phases || (workflow.definition?.nodes || []).filter(node => node.type === 'Phase').map(node => node.config?.phase).filter(Boolean);
  return phases.length > 0 ? phases.join(' → ') : 'Open the draft to review its stages';
}

function WorkflowDefaults({ defaults = {}, onChange }) {
  const retry = defaults.retry || {};
  const budgets = defaults.budgets || {};
  return <details open className="workflow-form">
    <summary><strong>Workflow Defaults</strong></summary>
    <p className="workflow-muted">Agent Steps inherit these values unless they show an override.</p>
    <label>Default provider<select value={defaults.provider || 'codex'} onChange={event => onChange({ ...defaults, provider: event.target.value })}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
    <label>Default model<input value={defaults.model || ''} placeholder="Provider default" onChange={event => onChange({ ...defaults, model: event.target.value })} /></label>
    <label>Default effort<select value={defaults.effort || 'medium'} onChange={event => onChange({ ...defaults, effort: event.target.value })}>{['low', 'medium', 'high', 'xhigh'].map(effort => <option key={effort}>{effort}</option>)}</select></label>
    <label>Default timeout (minutes)<input type="number" min="1" value={Math.round((defaults.timeoutMs || 1800000) / 60000)} onChange={event => onChange({ ...defaults, timeoutMs: Number(event.target.value) * 60000 })} /></label>
    <label>Default retry attempts<input type="number" min="1" value={retry.maxAttempts || 1} onChange={event => onChange({ ...defaults, retry: { ...retry, maxAttempts: Number(event.target.value) } })} /></label>
    <label>Default token budget<input type="number" min="1" value={budgets.tokens || 500000} onChange={event => onChange({ ...defaults, budgets: { ...budgets, tokens: Number(event.target.value) } })} /></label>
    <label>Default cost budget (USD)<input type="number" min="0" step="0.01" value={budgets.costUsd ?? 100} onChange={event => onChange({ ...defaults, budgets: { ...budgets, costUsd: Number(event.target.value) } })} /></label>
  </details>;
}

function parseCommandText(value) {
  const argv = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match = pattern.exec(value);
  while (match) {
    argv.push(match[1] ?? match[2] ?? match[3]);
    match = pattern.exec(value);
  }
  return argv;
}

function CustomCommandEditor({ command, onChange }) {
  const [text, setText] = useState(Array.isArray(command) ? command.join(' ') : '');
  return <label>Custom command<input value={text} onChange={event => { setText(event.target.value); onChange(parseCommandText(event.target.value)); }} /></label>;
}

function NodeInspector({ node, defaults = {}, onChange }) {
  if (!node) return <p className="workflow-muted">Select a node to edit its draft settings.</p>;
  const config = node.config || {};
  const update = patch => onChange({ ...node, config: { ...config, ...patch } });
  const remove = key => {
    const next = { ...config };
    delete next[key];
    onChange({ ...node, config: next });
  };
  const contract = config.executionContract;
  const provider = config.provider ?? defaults.provider ?? 'codex';
  const model = config.model ?? defaults.model ?? '';
  const effort = config.effort ?? defaults.effort ?? 'medium';
  const budgets = config.budgets ?? defaults.budgets ?? { tokens: 500000, costUsd: 100 };
  return <div className="workflow-form">
    <div className="workflow-node-heading"><span>{node.type}</span><code>{node.id}</code></div>
    <h3>Behavior</h3>
    <label>Label<input value={config.label || ''} placeholder={node.type} onChange={event => update({ label: event.target.value })} /></label>
    <label>Purpose<textarea value={config.purpose || ''} onChange={event => update({ purpose: event.target.value })} /></label>
    {config.templateProvenance?.name && <p className="workflow-muted">Copied from {config.templateProvenance.name} template</p>}
    {node.type === 'Agent' && <label>Agent Instructions<textarea aria-label="Agent Instructions" value={config.agentInstructions || ''} onChange={event => update({ agentInstructions: event.target.value })} /></label>}
    {node.type === 'Phase' && <label>Phase<select value={config.phase || 'Intake'} onChange={event => update({ phase: event.target.value })}>{PHASES.map(phase => <option key={phase}>{phase}</option>)}</select></label>}
    {node.type === 'Terminal' && <label>Outcome<select value={config.outcome || 'Success'} onChange={event => update({ outcome: event.target.value })}>{['Success', 'Failure', 'Cancelled'].map(outcome => <option key={outcome}>{outcome}</option>)}</select></label>}
    {node.type === 'Agent' && <>
      <h3>Input and result</h3>
      <label>Input Artifact bindings<input value={(config.artifactBindings || []).join(', ')} placeholder="task-input, plan" onChange={event => update({ artifactBindings: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label>
      <p className="workflow-muted">{contract ? `System-owned contract: ${contract.resultType} → ${contract.outcomes.join(', ')}` : 'Execution Contract is missing and must be repaired before publication.'}</p>
      <details><summary><strong>Agent</strong></summary>
        <p className="workflow-muted">{`${provider === 'codex' ? 'Codex' : 'Claude'} · ${model || 'provider default'} · ${effort}${config.provider == null && config.model == null && config.effort == null ? ' (inherited)' : ''}`}</p>
        <label className="workflow-check"><input type="checkbox" checked={config.provider != null} onChange={event => event.target.checked ? update({ provider }) : remove('provider')} />Override provider</label>
        {config.provider != null && <label>Provider override<select value={config.provider} onChange={event => update({ provider: event.target.value })}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>}
        <label className="workflow-check"><input type="checkbox" checked={config.model != null} onChange={event => event.target.checked ? update({ model }) : remove('model')} />Override model</label>
        {config.model != null && <><label>Model override<input value={config.model} onChange={event => update({ model: event.target.value })} /></label><p className="workflow-muted">Effective model: {config.model || 'provider default'} (override)</p></>}
        <label className="workflow-check"><input type="checkbox" checked={config.effort != null} onChange={event => event.target.checked ? update({ effort }) : remove('effort')} />Override effort</label>
        {config.effort != null && <label>Effort<select aria-label="Effort" value={config.effort} onChange={event => update({ effort: event.target.value })}>{['low', 'medium', 'high', 'xhigh'].map(value => <option key={value}>{value}</option>)}</select></label>}
        <label>Access<select value={config.accessMode || 'read'} onChange={event => update({ accessMode: event.target.value })}><option value="read">Read</option><option value="write">Write</option></select></label>
      </details>
    </>}
    {node.type === 'Check' && <>
      <h3>Input and result</h3>
      <strong>Deterministic Check Step</strong>
      <label>Check adapter<select value={config.adapter || 'test'} onChange={event => update({ adapter: event.target.value })}>{['test', 'lint', 'build', 'coverage', 'custom'].map(adapter => <option key={adapter}>{adapter}</option>)}</select></label>
      {config.adapter === 'custom' && <><CustomCommandEditor key={node.id} command={config.command} onChange={command => update({ command })} /><label>Access<select value={config.accessMode || 'read'} onChange={event => update({ accessMode: event.target.value })}><option value="read">Read</option><option value="write">Write</option></select></label><p className="workflow-muted">Custom commands require explicit write access when they modify the workspace.</p></>}
      <p className="workflow-muted">Produces {contract?.resultType || 'check-result'} with outcomes {(contract?.outcomes || ['pass', 'fail']).join(', ')}</p>
    </>}
    {['Agent', 'Interview', 'Approval', 'HumanDecision', 'Check', 'Action'].includes(node.type) && <>
      <details><summary><strong>Execution policy</strong></summary>
        <label>Timeout (minutes)<input type="number" min="1" value={Math.round((config.timeoutMs ?? defaults.timeoutMs ?? 1800000) / 60000)} onChange={event => update({ timeoutMs: Number(event.target.value) * 60000 })} /></label>
        <label>Retry attempts<input type="number" min="1" value={(config.retry ?? defaults.retry)?.maxAttempts || 1} onChange={event => update({ retry: { ...(config.retry || defaults.retry || {}), maxAttempts: Number(event.target.value), backoffMs: config.retry?.backoffMs || defaults.retry?.backoffMs || 0 } })} /></label>
        {node.type === 'Agent' && <><p className="workflow-muted">Effective budget: {budgets.tokens} tokens · ${budgets.costUsd} ({config.budgets == null ? 'inherited' : 'override'})</p><label className="workflow-check"><input type="checkbox" checked={config.budgets != null} onChange={event => event.target.checked ? update({ budgets: { ...budgets } }) : remove('budgets')} />Override budgets</label>{config.budgets != null && <><label>Token budget override<input type="number" min="1" value={config.budgets.tokens} onChange={event => update({ budgets: { ...config.budgets, tokens: Number(event.target.value) } })} /></label><label>Cost budget override (USD)<input type="number" min="0" step="0.01" value={config.budgets.costUsd} onChange={event => update({ budgets: { ...config.budgets, costUsd: Number(event.target.value) } })} /></label></>}</>}
      </details>
    </>}
  </div>;
}

function EdgeInspector({ edge, nodes, onChange }) {
  if (!edge) return null;
  const update = patch => onChange({ ...edge, ...patch });
  const nodeIds = nodes.map(node => node.id);
  const labelFor = id => nodeLabel(nodes.find(node => node.id === id) || { type: id, config: {} });
  const source = nodes.find(node => node.id === edge.source);
  const feedbackOptions = source?.config?.executionContract?.resultType ? [source.config.executionContract.resultType] : [];
  const outcome = (edge.outcome || 'success').replaceAll('_', ' ');
  const sentence = edge.loop
    ? `When ${labelFor(edge.source)} returns ${outcome}, go to ${labelFor(edge.target)}, include ${edge.loop.feedbackArtifact || 'selected feedback'}, at most ${edge.loop.maxIterations} times, then require ${labelFor(edge.loop.exhaustionTarget)}.`
    : `When ${labelFor(edge.source)} returns ${outcome}, go to ${labelFor(edge.target)}.`;
  return <div className="workflow-form workflow-edge-form">
    <p><strong>{sentence}</strong></p>
    <label>Outcome<input value={edge.outcome || 'success'} onChange={event => update({ outcome: event.target.value })} /></label>
    <label className="workflow-check"><input type="checkbox" checked={edge.fallback === true} onChange={event => update({ fallback: event.target.checked })} />Fallback path</label>
    <label className="workflow-check"><input type="checkbox" checked={Boolean(edge.loop)} onChange={event => update({ loop: event.target.checked ? { feedbackArtifact: feedbackOptions[0] || '', maxIterations: 1, exhaustionTarget: nodeIds[0] || edge.target } : undefined })} />Bounded loop</label>
    {edge.loop && <><label>Feedback Artifact<select value={edge.loop.feedbackArtifact || ''} onChange={event => update({ loop: { ...edge.loop, feedbackArtifact: event.target.value } })}><option value="">Select Artifact</option>{feedbackOptions.map(value => <option key={value}>{value}</option>)}</select></label><label>Maximum iterations<input type="number" min="1" value={edge.loop.maxIterations} onChange={event => update({ loop: { ...edge.loop, maxIterations: Number(event.target.value) } })} /></label><label>Exhaustion target<select value={edge.loop.exhaustionTarget} onChange={event => update({ loop: { ...edge.loop, exhaustionTarget: event.target.value } })}>{nodeIds.map(id => <option key={id} value={id}>{labelFor(id)}</option>)}</select></label></>}
    <details><summary>Advanced Route details</summary><code>{edge.source} → {edge.target} · {edge.id}</code></details>
  </div>;
}

function PathPreview({ nodes, edges }) {
  const labelFor = id => nodeLabel(nodes.find(node => node.id === id) || { type: id, config: {} });
  const primaryEdges = edges.filter(edge => !edge.loop && !edge.fallback);
  const primaryTargets = new Set(primaryEdges.map(edge => edge.target));
  const start = nodes.find(node => !primaryTargets.has(node.id));
  const primary = [];
  const visited = new Set();
  let current = start;
  while (current && !visited.has(current.id)) {
    visited.add(current.id); primary.push(nodeLabel(current));
    const next = primaryEdges.find(edge => edge.source === current.id);
    current = next ? nodes.find(node => node.id === next.target) : null;
  }
  const alternatives = edges.filter(edge => edge.fallback);
  const loops = edges.filter(edge => edge.loop);
  const decisions = nodes.filter(node => node.type === 'HumanDecision');
  return <section>
    <h2>Path preview</h2>
    <p>Primary: {primary.length > 0 ? primary.join(' → ') : 'Add Routes to preview the primary path'}</p>
    {alternatives.map(edge => <p key={edge.id}>Alternative: {labelFor(edge.source)} returns {(edge.outcome || 'fallback').replaceAll('_', ' ')} → {labelFor(edge.target)}</p>)}
    {loops.map(edge => <p key={edge.id}>Loop: {labelFor(edge.source)} → {labelFor(edge.target)} · maximum {edge.loop.maxIterations} · then {labelFor(edge.loop.exhaustionTarget)}</p>)}
    {decisions.map(node => <p key={node.id}>Human Decision: {nodeLabel(node)}</p>)}
  </section>;
}

export default function WorkflowStudio({ onBack }) {
  const [workflows, setWorkflows] = useState([]);
  const [defaultWorkflow, setDefaultWorkflow] = useState(null);
  const [selected, setSelected] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  const loadList = useCallback(async () => {
    const payload = await request('/api/workflows');
    setWorkflows(payload.workflows || []); setDefaultWorkflow(payload.defaultWorkflow || null);
  }, []);
  useEffect(() => { loadList().catch(loadError => setError(loadError.message)); }, [loadList]);
  useEffect(() => {
    const guard = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const openWorkflow = async workflow => {
    setPending(true); setError('');
    try {
      const payload = await request(`/api/workflows/${workflow.id}`);
      setSelected(payload); setDefinition(payload.definition); setNodes((payload.definition.nodes || []).map(flowNode)); setEdges(payload.definition.edges || []);
      setSelectedNodeId(null); setSelectedEdgeId(null); setValidation(null); setDirty(false); setMessage('');
    } catch (openError) { setError(openError.message); } finally { setPending(false); }
  };
  const serializedDefinition = useMemo(() => definition ? ({ ...definition, nodes: nodes.map(({ data: _data, ...node }) => node), edges }) : null, [definition, edges, nodes]);
  const selectedNode = nodes.find(node => node.id === selectedNodeId) || null;
  const selectedEdge = edges.find(edge => edge.id === selectedEdgeId) || null;
  const markChanged = () => { setDirty(true); setValidation(null); setMessage(''); };
  const updateDefaults = defaults => { setDefinition(current => ({ ...current, defaults })); markChanged(); };
  const saveDraft = async () => {
    setPending(true); setError('');
    try {
      await request(`/api/workflows/${selected.id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: selected.name, description: selected.description || '', definition: serializedDefinition }) });
      setDirty(false); setMessage('Draft saved'); return true;
    } catch (saveError) { setError(saveError.message); return false; } finally { setPending(false); }
  };
  const validate = async () => {
    if (!(await saveDraft())) return false;
    setPending(true);
    try { const payload = await request(`/api/workflows/${selected.id}/validate`, { method: 'POST' }); setValidation(payload); return payload.valid; }
    catch (validationError) { setValidation({ valid: false, errors: [validationError.message] }); return false; }
    finally { setPending(false); }
  };
  const publish = async () => {
    setPending(true); setError('');
    try {
      const payload = await request(`/api/workflows/${selected.id}/publish`, { method: 'POST' });
      setSelected(current => ({ ...current, latestVersion: payload.version }));
      setMessage(`Published version ${payload.version}`); setValidation(null); await loadList();
    }
    catch (publishError) { setError(publishError.message); } finally { setPending(false); }
  };
  const setDefault = async workflow => {
    setPending(true); setError('');
    try {
      const value = await request('/api/workflows/default', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId: workflow.id, version: workflow.latestVersion }) });
      setDefaultWorkflow(value); setMessage(`${workflow.name} v${workflow.latestVersion} is now the default`);
    } catch (defaultError) { setError(defaultError.message); } finally { setPending(false); }
  };
  const createWorkflow = async source => {
    setPending(true); setError('');
    try {
      const base = source ? await request(`/api/workflows/${source.id}`) : { definition: { schemaVersion: 2, defaults: { provider: 'codex', model: '', effort: 'medium', timeoutMs: 1800000, retry: { maxAttempts: 2, backoffMs: 1000 }, budgets: { tokens: 500000, costUsd: 100 } }, nodes: [], edges: [] } };
      const created = await request('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: source ? `${source.name} copy` : 'Untitled workflow', description: source?.description || '', definition: base.definition }) });
      await loadList(); await openWorkflow(created);
    } catch (createError) { setError(createError.message); } finally { setPending(false); }
  };
  const addNode = type => {
    const id = `${type.toLowerCase()}-${Date.now()}`;
    const config = type === 'Phase' ? { phase: 'Intake' } : type === 'Terminal' ? { outcome: 'Success' } : type === 'Agent' ? { agentInstructions: 'Describe what this Agent Step should accomplish.', artifactBindings: [], executionContract: { resultType: 'agent-result', outcomes: ['success', 'failure'] }, accessMode: 'read' } : type === 'Check' ? { adapter: 'test', executionContract: { resultType: 'check-result', outcomes: ['pass', 'fail'] } } : {};
    setNodes(current => [...current, flowNode({ id, type, position: { x: 100 + current.length * 40, y: 100 + (current.length % 5) * 80 }, config })]); setSelectedNodeId(id); markChanged();
  };
  const addTemplate = template => {
    const id = `${template.type.toLowerCase()}-${Date.now()}`;
    const config = { ...template.config, templateProvenance: { name: template.name } };
    setNodes(current => [...current, flowNode({ id, type: template.type, position: { x: 100 + current.length * 40, y: 100 + (current.length % 5) * 80 }, config })]);
    setSelectedNodeId(id); setSelectedEdgeId(null); markChanged();
  };
  const updateSelectedNode = updated => { setNodes(current => current.map(node => node.id === updated.id ? flowNode(updated) : node)); markChanged(); };
  const updateSelectedEdge = updated => { setEdges(current => current.map(edge => edge.id === updated.id ? updated : edge)); markChanged(); };
  const connect = connection => { setEdges(current => addEdge({ ...connection, id: `edge-${Date.now()}`, outcome: 'success' }, current)); markChanged(); };
  const leaveEditor = () => {
    if (!dirty || window.confirm('Discard unsaved workflow changes?')) setSelected(null);
  };
  const handleNodeChanges = changes => {
    onNodesChange(changes);
    if (changes.some(change => change.type === 'remove' || change.type === 'add' || (change.type === 'position' && change.dragging === false))) markChanged();
  };
  const handleEdgeChanges = changes => {
    onEdgesChange(changes);
    if (changes.some(change => change.type === 'remove' || change.type === 'add')) markChanged();
  };
  const focusFinding = finding => {
    const text = typeof finding === 'string' ? finding : finding.message;
    const nodeId = finding.nodeId || nodes.find(node => text.includes(node.id))?.id;
    const edgeId = finding.edgeId || edges.find(edge => text.includes(edge.id))?.id;
    if (nodeId) { setSelectedNodeId(nodeId); setSelectedEdgeId(null); }
    if (edgeId) { setSelectedEdgeId(edgeId); setSelectedNodeId(null); }
  };
  const findingButton = (finding, tone) => {
    const text = typeof finding === 'string' ? finding : finding.message;
    return <button className={tone} key={`${tone}-${text}`} onClick={() => focusFinding(finding)}>{text}</button>;
  };

  if (!selected) return <main className="workflow-page">
    <header className="workflow-header"><button onClick={onBack}>← Dashboard</button><div><h1>Workflows</h1><p>Choose how new tasks move from intake to delivery.</p></div><div className="workflow-actions"><button className="primary" onClick={() => createWorkflow(null)}>+ New workflow</button></div></header>
    <div className="workflow-callout"><strong>Published versions are snapshots.</strong><span>New tasks use the exact version you choose. Existing runs keep their original version.</span></div>
    {error && <div className="workflow-error" role="alert">{error}</div>}{message && <div className="workflow-message">{message}</div>}
    <section className="workflow-list">{workflows.map(workflow => {
      const defaultVersion = defaultWorkflow?.workflowId === workflow.id ? defaultWorkflow.version : null;
      const isLatestDefault = defaultVersion === workflow.latestVersion;
      return <article className="workflow-list-card" key={workflow.id}>
        <button className="workflow-card-main" onClick={() => openWorkflow(workflow)} disabled={pending}><span className="workflow-card-title"><strong>{workflow.name}</strong>{defaultVersion && <em>Default v{defaultVersion}</em>}</span><span>{workflow.description || 'No description yet.'}</span><small>{summarize(workflow)}</small><span>Latest published v{workflow.latestVersion}</span></button>
        <div className="workflow-card-actions"><button onClick={() => openWorkflow(workflow)}>Edit draft</button><button onClick={() => createWorkflow(workflow)}>Duplicate</button>{!isLatestDefault && <button aria-label={`Set v${workflow.latestVersion} as default`} onClick={() => setDefault(workflow)}>Set v{workflow.latestVersion} default</button>}</div>
      </article>;
    })}</section>
  </main>;

  return <main className="workflow-page workflow-editor-page">
    <header className="workflow-header"><button onClick={leaveEditor}>← Workflows</button><div><h1>{selected.name}</h1><p>Draft editor · published v{selected.latestVersion || '—'}</p><small>Published v{selected.latestVersion || '—'} · immutable snapshot</small></div>{dirty && <span className="workflow-dirty">Unsaved changes</span>}<div className="workflow-actions"><button onClick={saveDraft} disabled={pending || !dirty}>Save draft</button><button onClick={validate} disabled={pending}>Validate draft</button><button className="primary" onClick={publish} disabled={pending || dirty || !validation?.valid}>Publish</button></div></header>
    <div className="workflow-editor-grid"><aside className="workflow-panel"><details open className="workflow-form"><summary><strong>Workflow draft</strong></summary><label>Workflow name<input value={selected.name || ''} onChange={event => { setSelected(current => ({ ...current, name: event.target.value })); markChanged(); }} /></label><label>Workflow description<textarea value={selected.description || ''} onChange={event => { setSelected(current => ({ ...current, description: event.target.value })); markChanged(); }} /></label></details><WorkflowDefaults defaults={definition?.defaults} onChange={updateDefaults} /><h2>Step Templates</h2><label>Search Step Templates<input value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} /></label><div>{STEP_TEMPLATES.filter(template => template.name.toLowerCase().includes(templateSearch.toLowerCase())).map(template => <button key={template.name} onClick={() => addTemplate(template)}>+ {template.name}</button>)}</div><details><summary>Advanced step types</summary><p className="workflow-muted">Add lower-level Steps, then connect them on the canvas.</p>{NODE_TYPES.map(type => <button key={type} onClick={() => addNode(type)}>+ {type}</button>)}</details></aside>
      <section className="workflow-canvas"><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodeChanges} onEdgesChange={handleEdgeChanges} onConnect={connect} onNodeClick={(_event, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }} onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }} fitView><Background /><MiniMap /><Controls /></ReactFlow></section>
      <aside className="workflow-panel"><h2>{selectedEdge ? 'Route settings' : 'Step settings'}</h2>{selectedEdge ? <EdgeInspector edge={selectedEdge} nodes={nodes} onChange={updateSelectedEdge} /> : <NodeInspector node={selectedNode} defaults={definition?.defaults} onChange={updateSelectedNode} />}<PathPreview nodes={nodes} edges={edges} /><h2>Validation</h2>{validation?.valid && <div className="workflow-valid">Ready to publish</div>}{validation?.errors?.map(item => findingButton(item, 'workflow-error'))}{validation?.warnings?.map(item => findingButton(item, 'workflow-message'))}{error && <div className="workflow-error" role="alert">{error}</div>}{message && <div className="workflow-message">{message}</div>}</aside>
    </div>
  </main>;
}
