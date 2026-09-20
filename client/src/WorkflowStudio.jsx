import { useCallback, useEffect, useMemo, useState } from 'react';
import { addEdge, Background, Controls, MiniMap, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';

const NODE_TYPES = ['Interview', 'Agent', 'Approval', 'Phase', 'Action', 'Terminal'];
const PHASES = ['Intake', 'Planning', 'Implementation', 'Review', 'Delivery'];

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
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

function NodeInspector({ node, onChange }) {
  if (!node) return <p className="workflow-muted">Select a node to edit its draft settings.</p>;
  const config = node.config || {};
  const update = patch => onChange({ ...node, config: { ...config, ...patch } });
  return <div className="workflow-form">
    <div className="workflow-node-heading"><span>{node.type}</span><code>{node.id}</code></div>
    <label>Label<input value={config.label || ''} placeholder={node.type} onChange={event => update({ label: event.target.value })} /></label>
    {node.type === 'Phase' && <label>Phase<select value={config.phase || 'Intake'} onChange={event => update({ phase: event.target.value })}>{PHASES.map(phase => <option key={phase}>{phase}</option>)}</select></label>}
    {node.type === 'Terminal' && <label>Outcome<select value={config.outcome || 'Success'} onChange={event => update({ outcome: event.target.value })}>{['Success', 'Failure', 'Cancelled'].map(outcome => <option key={outcome}>{outcome}</option>)}</select></label>}
    {node.type === 'Agent' && <>
      <label>Provider<select value={config.provider || 'codex'} onChange={event => update({ provider: event.target.value, model: '' })}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
      <label>Model<input value={config.model || ''} placeholder="Provider default" onChange={event => update({ model: event.target.value })} /></label>
      <label>Effort<select aria-label="Effort" value={config.effort || 'medium'} onChange={event => update({ effort: event.target.value })}>{['low', 'medium', 'high', 'xhigh'].map(effort => <option key={effort}>{effort}</option>)}</select></label>
      <label>Access<select value={config.accessMode || 'read'} onChange={event => update({ accessMode: event.target.value })}><option value="read">Read</option><option value="write">Write</option></select></label>
    </>}
    {['Agent', 'Interview', 'Approval', 'Action'].includes(node.type) && <>
      <label>Timeout (minutes)<input type="number" min="1" value={Math.round((config.timeoutMs || 1800000) / 60000)} onChange={event => update({ timeoutMs: Number(event.target.value) * 60000 })} /></label>
      <label>Retry attempts<input type="number" min="1" value={config.retry?.maxAttempts || 1} onChange={event => update({ retry: { ...(config.retry || {}), maxAttempts: Number(event.target.value), backoffMs: config.retry?.backoffMs || 0 } })} /></label>
    </>}
  </div>;
}

function EdgeInspector({ edge, nodeIds, onChange }) {
  if (!edge) return null;
  const update = patch => onChange({ ...edge, ...patch });
  return <div className="workflow-form workflow-edge-form">
    <div className="workflow-node-heading"><span>Connection</span><code>{edge.source} → {edge.target}</code></div>
    <label>Outcome<input value={edge.outcome || 'success'} onChange={event => update({ outcome: event.target.value })} /></label>
    <label className="workflow-check"><input type="checkbox" checked={edge.fallback === true} onChange={event => update({ fallback: event.target.checked })} />Fallback path</label>
    <label className="workflow-check"><input type="checkbox" checked={Boolean(edge.loop)} onChange={event => update({ loop: event.target.checked ? { maxIterations: 1, exhaustionTarget: nodeIds[0] || edge.target } : undefined })} />Bounded loop</label>
    {edge.loop && <><label>Maximum iterations<input type="number" min="1" value={edge.loop.maxIterations} onChange={event => update({ loop: { ...edge.loop, maxIterations: Number(event.target.value) } })} /></label><label>Exhaustion target<select value={edge.loop.exhaustionTarget} onChange={event => update({ loop: { ...edge.loop, exhaustionTarget: event.target.value } })}>{nodeIds.map(id => <option key={id}>{id}</option>)}</select></label></>}
  </div>;
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
  const saveDraft = async () => {
    setPending(true); setError('');
    try {
      await request(`/api/workflows/${selected.id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: serializedDefinition }) });
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
      const base = source ? await request(`/api/workflows/${source.id}`) : { definition: { schemaVersion: 1, defaults: { budgets: {} }, nodes: [], edges: [] } };
      const created = await request('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: source ? `${source.name} copy` : 'Untitled workflow', description: source?.description || '', definition: base.definition }) });
      await loadList(); await openWorkflow(created);
    } catch (createError) { setError(createError.message); } finally { setPending(false); }
  };
  const addNode = type => {
    const id = `${type.toLowerCase()}-${Date.now()}`;
    const config = type === 'Phase' ? { phase: 'Intake' } : type === 'Terminal' ? { outcome: 'Success' } : ['Agent', 'Interview', 'Approval', 'Action'].includes(type) ? { ...(type === 'Agent' ? { provider: 'codex', model: '', effort: 'medium', accessMode: 'read' } : {}), timeoutMs: 1800000, retry: { maxAttempts: 1, backoffMs: 0 } } : {};
    setNodes(current => [...current, flowNode({ id, type, position: { x: 100 + current.length * 40, y: 100 + (current.length % 5) * 80 }, config })]); setSelectedNodeId(id); markChanged();
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
    <header className="workflow-header"><button onClick={leaveEditor}>← Workflows</button><div><h1>{selected.name}</h1><p>Draft editor · published v{selected.latestVersion || '—'}</p></div>{dirty && <span className="workflow-dirty">Unsaved changes</span>}<div className="workflow-actions"><button onClick={saveDraft} disabled={pending || !dirty}>Save draft</button><button onClick={validate} disabled={pending}>Validate draft</button><button className="primary" onClick={publish} disabled={pending || dirty || !validation?.valid}>Publish</button></div></header>
    <div className="workflow-editor-grid"><aside className="workflow-panel"><h2>Add step</h2><p className="workflow-muted">Add steps, then drag between handles to connect them.</p>{NODE_TYPES.map(type => <button key={type} onClick={() => addNode(type)}>+ {type}</button>)}</aside>
      <section className="workflow-canvas"><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodeChanges} onEdgesChange={handleEdgeChanges} onConnect={connect} onNodeClick={(_event, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }} onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }} fitView><Background /><MiniMap /><Controls /></ReactFlow></section>
      <aside className="workflow-panel"><h2>{selectedEdge ? 'Connection settings' : 'Step settings'}</h2>{selectedEdge ? <EdgeInspector edge={selectedEdge} nodeIds={nodes.map(node => node.id)} onChange={updateSelectedEdge} /> : <NodeInspector node={selectedNode} onChange={updateSelectedNode} />}<h2>Validation</h2>{validation?.valid && <div className="workflow-valid">Ready to publish</div>}{validation?.errors?.map(item => <div className="workflow-error" key={item}>{item}</div>)}{error && <div className="workflow-error" role="alert">{error}</div>}{message && <div className="workflow-message">{message}</div>}</aside>
    </div>
  </main>;
}
