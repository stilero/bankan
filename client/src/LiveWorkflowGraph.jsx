import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

export default function LiveWorkflowGraph({ taskId, onBack }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [responses, setResponses] = useState({});

  const load = useCallback(async () => {
    try {
      setRun(await request(`/api/tasks/${taskId}/workflow-run`));
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [taskId]);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 3000);
    return () => window.clearInterval(refresh);
  }, [load]);
  useEffect(() => {
    if (!run?.workflowId || run.workflowName) return;
    request('/api/workflows').then(payload => {
      setWorkflowName(payload.workflows?.find(workflow => workflow.id === run.workflowId)?.name || run.workflowId);
    }).catch(() => setWorkflowName(run.workflowId));
  }, [run?.workflowId, run?.workflowName]);

  const control = async (command, payload = {}) => {
    try {
      const updated = await request(`/api/tasks/${taskId}/workflow-run/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setRun(current => ({ ...current, ...updated }));
      setError('');
    } catch (controlError) { setError(controlError.message); }
  };

  const submitInterview = async node => {
    const content = responses[node.nodeId]?.trim();
    if (!content) return;
    try {
      const updated = await request(`/api/tasks/${taskId}/workflow-run/submitInput`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: node.nodeId, answers: { response: content } }),
      });
      setRun(current => ({ ...current, ...updated })); setError('');
      setResponses(current => ({ ...current, [node.nodeId]: '' }));
    } catch (submitError) { setError(submitError.message); }
  };

  const nodes = useMemo(() => (run?.workflowSnapshot.nodes || []).map((node, index) => ({
    ...node,
    position: node.position || { x: (index % 4) * 220, y: Math.floor(index / 4) * 140 },
    data: {
      label: node.config?.label || (node.type === 'Phase' ? node.config?.phase : node.type),
      status: run.activeNodes.includes(node.id) ? 'running' : run.completedNodes.includes(node.id) ? 'succeeded' : 'queued',
    },
    className: `workflow-node-${run.activeNodes.includes(node.id) ? 'running' : run.completedNodes.includes(node.id) ? 'succeeded' : 'queued'}`,
  })), [run]);

  if (error && !run) return <main className="workflow-page"><button onClick={onBack}>← Dashboard</button><p>{error}</p></main>;
  if (!run) return <main className="workflow-page">Loading workflow…</main>;

  return (
    <main className="workflow-page workflow-live-page">
      <header className="workflow-header">
        <button onClick={onBack}>← Dashboard</button>
        <div><h1>Task workflow</h1><p>{run.taskId} · <strong>{run.phase}</strong> · {run.status}</p>{(run.workflowName || workflowName || run.workflowId) && <small>{run.workflowName || workflowName || run.workflowId} v{run.workflowVersion}</small>}</div>
        <div className="workflow-actions">
          {!['succeeded', 'failed', 'cancelled'].includes(run.status) && <>{run.status === 'paused'
            ? <button onClick={() => control('resume')}>Resume Task</button>
            : <button onClick={() => control('pause')}>Pause Task</button>}
          <button onClick={() => { if (window.confirm('Cancel this workflow run? This cannot be resumed.')) control('cancel'); }}>Cancel Task</button></>}
        </div>
      </header>
      <div className="workflow-live-grid">
        <section className="workflow-canvas">
          <ReactFlow nodes={nodes} edges={run.workflowSnapshot.edges || []} fitView>
            <Background /><MiniMap /><Controls />
          </ReactFlow>
        </section>
        <aside className="workflow-panel">
          <div className="workflow-legend"><span><i className="running" />Running</span><span><i className="done" />Completed</span><span><i />Queued</span></div>
          <h2>Budgets</h2>
          <p>{Number(run.budgets.tokens || 0).toLocaleString()} token budget</p>
          {run.budgets.costUsd != null && <p>${run.budgets.costUsd} cost ceiling</p>}
          <h2>Current steps</h2>
          {(run.actionableNodes || []).map(node => <div key={node.nodeId} className="workflow-action-card"><strong>{node.label}</strong><small>{node.type}</small>
            {node.action === 'decide' && <div>{(node.allowedOutcomes || ['success']).map(outcome => <button aria-label={`${node.label}: ${outcome}`} key={outcome} onClick={() => control('completeNode', { nodeId: node.nodeId, outcome })}>{outcome.replaceAll('_', ' ')}</button>)}</div>}
            {node.action === 'submitInput' && <div className="workflow-interview"><label htmlFor={`interview-${node.nodeId}`}>Your response</label><textarea id={`interview-${node.nodeId}`} value={responses[node.nodeId] || ''} onChange={event => setResponses(current => ({ ...current, [node.nodeId]: event.target.value }))} rows="4" placeholder="Add the context this workflow needs…" /><button disabled={!responses[node.nodeId]?.trim()} onClick={() => submitInterview(node)}>Submit response</button></div>}
            {node.action === 'awaitingExecution' && <span>Waiting for an available agent…</span>}
            {node.action === 'running' && <span>Agent is working…</span>}
          </div>)}
          {(run.actionableNodes || []).length === 0 && <p className="workflow-muted">No action is needed right now.</p>}
          {error && <div className="workflow-error" role="alert">{error}</div>}
          <h2>Artifacts</h2>
          {run.artifacts.map(artifact => <details key={artifact.id}>
            <summary>{artifact.type}</summary>
            <pre>{JSON.stringify(artifact.data, null, 2)}</pre>
          </details>)}
        </aside>
      </div>
    </main>
  );
}
