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

  const load = useCallback(async () => {
    try {
      setRun(await request(`/api/tasks/${taskId}/workflow-run`));
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const control = async (command, payload = {}) => {
    const updated = await request(`/api/tasks/${taskId}/workflow-run/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setRun(current => ({ ...current, ...updated }));
  };

  const nodes = useMemo(() => (run?.workflowSnapshot.nodes || []).map((node, index) => ({
    ...node,
    position: node.position || { x: (index % 4) * 220, y: Math.floor(index / 4) * 140 },
    data: {
      label: node.type,
      status: run.activeNodes.includes(node.id) ? 'running' : run.completedNodes.includes(node.id) ? 'succeeded' : 'queued',
    },
    className: `workflow-node-${run.activeNodes.includes(node.id) ? 'running' : run.completedNodes.includes(node.id) ? 'succeeded' : 'queued'}`,
  })), [run]);

  if (error) return <main className="workflow-page"><button onClick={onBack}>← Dashboard</button><p>{error}</p></main>;
  if (!run) return <main className="workflow-page">Loading workflow…</main>;

  return (
    <main className="workflow-page workflow-live-page">
      <header className="workflow-header">
        <button onClick={onBack}>← Dashboard</button>
        <div><h1>Task workflow</h1><p>{run.taskId} · <strong>{run.phase}</strong> · {run.status}</p></div>
        <div className="workflow-actions">
          {run.status === 'paused'
            ? <button onClick={() => control('resume')}>Resume Task</button>
            : <button onClick={() => control('pause')}>Pause Task</button>}
          <button onClick={() => control('cancel')}>Cancel Task</button>
        </div>
      </header>
      <div className="workflow-live-grid">
        <section className="workflow-canvas">
          <ReactFlow nodes={nodes} edges={run.workflowSnapshot.edges || []} fitView>
            <Background /><MiniMap /><Controls />
          </ReactFlow>
        </section>
        <aside className="workflow-panel">
          <h2>Budgets</h2>
          <p>{Number(run.budgets.tokens || 0).toLocaleString()} tokens</p>
          {run.budgets.costUsd != null && <p>${run.budgets.costUsd} cost ceiling</p>}
          <h2>Active nodes</h2>
          {run.activeNodes.map(nodeId => {
            const outcomes = [...new Set(run.workflowSnapshot.edges
              .filter(edge => edge.source === nodeId && !edge.fallback)
              .map(edge => edge.outcome))];
            return <div key={nodeId} className="workflow-active-node">
              <code>{nodeId}</code>
              <span>
                {(outcomes.length > 0 ? outcomes : ['success']).map(outcome => (
                  <button key={outcome} onClick={() => control('completeNode', { nodeId, outcome })}>{outcome}</button>
                ))}
              </span>
            </div>;
          })}
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
