import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function readable(value) {
  return String(value || '').replaceAll('_', ' ');
}

function artifactType(binding) {
  return typeof binding === 'string' ? binding : binding?.artifactType || binding?.type;
}

function feedbackSummary(feedback) {
  if (!feedback) return '';
  const data = feedback.data || feedback;
  return data.summary || data.reason || data.feedback || data.text || (typeof data === 'string' ? data : 'Structured feedback supplied');
}

function executorSummary(node, defaults = {}) {
  if (node.type === 'Agent') {
    const config = node.config || {};
    return ['Agent', config.provider ?? defaults.provider, config.model ?? defaults.model, config.effort ?? defaults.effort, config.accessMode]
      .filter(Boolean).join(' · ');
  }
  if (['HumanDecision', 'Approval', 'Interview'].includes(node.type)) return 'Human';
  if (node.type === 'Check') return `Check · ${node.config?.adapter || 'deterministic'}`;
  return `System · ${readable(node.type)}`;
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
      await request(`/api/tasks/${taskId}/workflow-run/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await load();
      setError('');
    } catch (controlError) { setError(controlError.message); }
  };

  const submitInterview = async node => {
    const content = responses[node.nodeId]?.trim();
    if (!content) return;
    try {
      await request(`/api/tasks/${taskId}/workflow-run/submitInput`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: node.nodeId, answers: { response: content } }),
      });
      await load(); setError('');
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

  const stepSummaries = useMemo(() => {
    if (!run) return [];
    const visibleIds = new Set([...(run.activeNodes || []), ...(run.completedNodes || [])]);
    return (run.workflowSnapshot.nodes || []).filter(node => visibleIds.has(node.id)).map(node => {
      const runs = (run.nodeRuns || []).filter(nodeRun => nodeRun.nodeId === node.id);
      const nodeRun = runs.at(-1);
      const produced = (run.artifacts || []).filter(artifact => artifact.nodeId === node.id);
      const inputs = [
        ...(node.config?.artifactBindings || node.config?.inputs || []).map(artifactType),
        ...(nodeRun?.input?.artifacts || []).map(artifactType),
      ].filter(Boolean);
      const loop = (run.workflowSnapshot.edges || []).find(edge => edge.target === node.id && edge.loop);
      const exhaustionNode = loop && run.workflowSnapshot.nodes.find(candidate => candidate.id === loop.loop.exhaustionTarget);
      const feedback = nodeRun?.input?.feedback || nodeRun?.input?.feedbackArtifact;
      const exhaustion = nodeRun?.input?.exhaustion;
      return {
        node,
        nodeRun,
        produced,
        inputs: [...new Set(inputs)],
        loop,
        loopIteration: loop ? (nodeRun?.input?.loop?.iteration ?? Math.min(run.loopCounters?.[loop.id] || 0, loop.loop.maxIterations)) : null,
        exhaustionNode,
        feedback,
        exhaustion,
        status: run.activeNodes.includes(node.id) ? (nodeRun?.status || 'running') : (nodeRun?.status || 'succeeded'),
      };
    });
  }, [run]);

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
            {(node.action === 'decide' || ['Approval', 'HumanDecision'].includes(node.type)) && (() => {
              const definition = run.workflowSnapshot.nodes.find(candidate => candidate.id === node.nodeId);
              const configuredChoices = definition?.config?.choices || definition?.config?.outcomes || [];
              const choices = (node.allowedOutcomes || ['success']).map(outcome => {
                const configured = configuredChoices.find(choice => (typeof choice === 'string' ? choice : choice.outcome || choice.value) === outcome);
                return typeof configured === 'object' ? configured : { outcome, label: readable(outcome) };
              });
              return <div>
                {choices.some(choice => choice.requiresFeedback) && <textarea aria-label={`${node.label} feedback`} value={responses[node.nodeId] || ''} onChange={event => setResponses(current => ({ ...current, [node.nodeId]: event.target.value }))} placeholder="Optional feedback…" />}
                {choices.map(choice => {
                  const outcome = choice.outcome || choice.value;
                  const label = choice.label || readable(outcome);
                  return <button aria-label={`${node.label}: ${label}`} key={outcome} onClick={() => control('decide', { nodeId: node.nodeId, outcome, ...(responses[node.nodeId]?.trim() ? { feedback: responses[node.nodeId].trim() } : {}) })}>{label}</button>;
                })}
              </div>;
            })()}
            {node.action === 'submitInput' && <div className="workflow-interview"><label htmlFor={`interview-${node.nodeId}`}>Your response</label><textarea id={`interview-${node.nodeId}`} value={responses[node.nodeId] || ''} onChange={event => setResponses(current => ({ ...current, [node.nodeId]: event.target.value }))} rows="4" placeholder="Add the context this workflow needs…" /><button disabled={!responses[node.nodeId]?.trim()} onClick={() => submitInterview(node)}>Submit response</button></div>}
            {node.action === 'awaitingExecution' && <span>Waiting for an available agent…</span>}
            {node.action === 'running' && <span>Agent is working…</span>}
          </div>)}
          {(run.actionableNodes || []).length === 0 && <p className="workflow-muted">No action is needed right now.</p>}
          {error && <div className="workflow-error" role="alert">{error}</div>}
          <h2>Step details</h2>
          {stepSummaries.map(({ node, nodeRun, produced, inputs, loop, loopIteration, exhaustionNode, feedback, exhaustion, status }) => (
            <section key={node.id} className="workflow-action-card">
              <strong>{node.config?.label || node.type}</strong>
              {node.config?.purpose && <p>{node.config.purpose}</p>}
              <small>{executorSummary(node, run.workflowSnapshot.defaults)}</small>
              <p>Attempt {nodeRun?.attempt || 1} · {status}</p>
              {inputs.length > 0 && <p>Inputs: {inputs.join(', ')}</p>}
              {produced.length > 0 && <p>Artifacts: {produced.map(artifact => artifact.type).join(', ')}</p>}
              {nodeRun?.output?.outcome && <p>Outcome: {readable(nodeRun.output.outcome)}</p>}
              {loop && <p>Loop {loopIteration} of {loop.loop.maxIterations}</p>}
              {feedback && <p>Returned with {feedback.type || loop?.loop?.feedbackArtifact || loop?.feedbackArtifact || 'feedback'}: {feedbackSummary(feedback)}</p>}
              {loop && exhaustionNode && <p>When exhausted: {exhaustionNode.config?.label || exhaustionNode.type} requires a human decision</p>}
              {exhaustion && <p>Loop exhausted after {exhaustion.limit} of {exhaustion.limit} iterations; human decision required.</p>}
            </section>
          ))}
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
