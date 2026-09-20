import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';

const NODE_TYPES = ['Interview', 'Agent', 'Approval', 'Condition', 'Fork', 'Join', 'Phase', 'Action', 'Terminal'];

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function flowNode(node) {
  const detail = node.type === 'Phase' ? `: ${node.config?.phase}` : '';
  return {
    ...node,
    position: node.position || { x: 0, y: 0 },
    data: { ...node.data, label: `${node.type}${detail}` },
  };
}

export default function WorkflowStudio({ onBack }) {
  const [workflows, setWorkflows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState('');

  const loadList = async () => {
    const payload = await request('/api/workflows');
    setWorkflows(payload.workflows || []);
  };

  useEffect(() => { loadList().catch(error => setMessage(error.message)); }, []);

  const openWorkflow = async (workflow) => {
    const payload = await request(`/api/workflows/${workflow.id}`);
    setSelected(payload);
    setDefinition(payload.definition);
    setNodes((payload.definition.nodes || []).map(flowNode));
    setEdges(payload.definition.edges || []);
    setValidation(null);
  };

  const serializedDefinition = useMemo(() => definition ? ({
    ...definition,
    nodes: nodes.map(({ data: _data, ...node }) => node),
    edges,
  }) : null, [definition, edges, nodes]);

  const saveDraft = async () => {
    await request(`/api/workflows/${selected.id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: serializedDefinition }),
    });
    setMessage('Draft saved');
  };

  const validate = async () => {
    await saveDraft();
    const payload = await request(`/api/workflows/${selected.id}/validate`, { method: 'POST' }).catch(error => ({ valid: false, errors: [error.message] }));
    setValidation(payload);
  };

  const publish = async () => {
    await validate();
    const payload = await request(`/api/workflows/${selected.id}/publish`, { method: 'POST' });
    setMessage(`Published version ${payload.version}`);
    await loadList();
  };

  const addNode = type => {
    const id = `${type.toLowerCase()}-${Date.now()}`;
    const config = type === 'Phase' ? { phase: 'Intake' }
      : type === 'Terminal' ? { outcome: 'Success' }
        : ['Agent', 'Interview', 'Approval', 'Action'].includes(type) ? { timeoutMs: 1800000, retry: { maxAttempts: 1, backoffMs: 0 } }
          : {};
    setNodes(current => [...current, flowNode({ id, type, position: { x: 100 + current.length * 30, y: 100 + current.length * 20 }, config })]);
  };

  if (!selected) {
    return (
      <main className="workflow-page">
        <header className="workflow-header">
          <button onClick={onBack}>← Dashboard</button>
          <div><h1>Workflows</h1><p>Published versions are immutable. Editing always changes the draft.</p></div>
        </header>
        {message && <div className="workflow-message">{message}</div>}
        <section className="workflow-list">
          {workflows.map(workflow => (
            <button className="workflow-list-card" key={workflow.id} onClick={() => openWorkflow(workflow)}>
              <strong>{workflow.name}</strong>
              <span>Version {workflow.latestVersion}{workflow.isDefault ? ' · Default' : ''}</span>
            </button>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="workflow-page workflow-editor-page">
      <header className="workflow-header">
        <button onClick={() => setSelected(null)}>← Workflows</button>
        <div><h1>{selected.name}</h1><p>Draft editor</p></div>
        <div className="workflow-actions">
          <button onClick={saveDraft}>Save Draft</button>
          <button onClick={validate}>Validate</button>
          <button className="primary" onClick={publish}>Publish</button>
        </div>
      </header>
      <div className="workflow-editor-grid">
        <aside className="workflow-panel">
          <h2>Palette</h2>
          {NODE_TYPES.map(type => <button key={type} onClick={() => addNode(type)}>+ {type}</button>)}
        </aside>
        <section className="workflow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_event, node) => setSelectedNode(node)}
            fitView
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </section>
        <aside className="workflow-panel">
          <h2>Inspector</h2>
          {selectedNode ? <>
            <strong>{selectedNode.data.label}</strong>
            <code>{selectedNode.id}</code>
            <pre>{JSON.stringify(selectedNode.config || {}, null, 2)}</pre>
          </> : <p>Select a node to inspect its published configuration.</p>}
          <h2>Validation</h2>
          {validation?.valid && <div className="workflow-valid">Ready to publish</div>}
          {validation?.errors?.map(error => <div className="workflow-error" key={error}>{error}</div>)}
          {message && <div className="workflow-message">{message}</div>}
        </aside>
      </div>
    </main>
  );
}
