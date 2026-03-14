function parseBulletList(sectionText) {
  return (sectionText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(Boolean);
}

function extractSection(text, label, nextLabels = []) {
  if (typeof text !== 'string' || !text) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextPattern = nextLabels.length > 0
    ? `(?=${nextLabels.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
    : '$';
  const regex = new RegExp(`${escapedLabel}\\s*([\\s\\S]*?)${nextPattern}`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

export function parseReviewResult(reviewText) {
  const verdictMatch = reviewText.match(/VERDICT:\s*(PASS|FAIL)/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FAIL';
  const criticalIssues = parseBulletList(
    extractSection(reviewText, 'CRITICAL_ISSUES:', ['MINOR_ISSUES:', 'SUMMARY:', '=== REVIEW END ==='])
  ).filter(item => item.toLowerCase() !== 'none');
  const minorIssues = parseBulletList(
    extractSection(reviewText, 'MINOR_ISSUES:', ['SUMMARY:', '=== REVIEW END ==='])
  ).filter(item => item.toLowerCase() !== 'none');
  const summary = extractSection(reviewText, 'SUMMARY:', ['=== REVIEW END ===']);

  return {
    verdict,
    criticalIssues,
    minorIssues,
    summary,
    hasCriticalIssues: criticalIssues.length > 0,
  };
}

export function reviewShouldPass(reviewResult) {
  return reviewResult.verdict === 'PASS' || !reviewResult.hasCriticalIssues;
}

export function isReviewResultPlaceholder(reviewText, reviewResult = parseReviewResult(reviewText)) {
  if (typeof reviewText !== 'string' || !reviewText.trim()) return true;

  const normalized = reviewText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.includes("(issue description, or 'none')")) return true;
  if (normalized.includes('(2-3 sentences summarising the review)')) return true;

  const summary = (reviewResult.summary || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!summary) return true;
  if (summary.includes('2-3 sentences summarising the review')) return true;

  return false;
}

export function getLiveTaskAgent(task, agentManager) {
  if (!task?.assignedTo) return null;
  const agent = agentManager.get(task.assignedTo);
  if (!agent?.process) return null;
  if (agent.currentTask !== task.id) return null;
  return agent;
}

export function stageToRetryStatus(task, { planningDisabled = false, liveAgent = null } = {}) {
  if (liveAgent) {
    if (liveAgent.id.startsWith('plan-')) return 'planning';
    if (liveAgent.id.startsWith('imp-')) return 'implementing';
    if (liveAgent.id.startsWith('rev-')) return 'review';
  }

  if ((task.blockedReason || '').includes('maximum review cycles')) {
    return 'queued';
  }
  if (task.lastActiveStage === 'review') {
    return 'review';
  }
  if (task.lastActiveStage === 'implementation') {
    return 'queued';
  }
  if (task.lastActiveStage === 'planning') {
    return task.plan ? 'awaiting_approval' : (planningDisabled ? 'queued' : 'backlog');
  }
  return planningDisabled ? 'queued' : 'backlog';
}
