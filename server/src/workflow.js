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

export function isMaxReviewCyclesBlocker(blockedReason) {
  if (typeof blockedReason !== 'string') return false;
  return /^Reached maximum review cycles(?: \(\d+\))?/i.test(blockedReason.trim());
}

export function resolveTaskMaxReviewCycles(task, fallback = 3) {
  const configuredValue = task?.maxReviewCycles;
  if (typeof configuredValue === 'number' && configuredValue >= 1) {
    return configuredValue;
  }
  return fallback;
}

export function buildMaxReviewBlockerApprovalUpdate(task, now = new Date().toISOString()) {
  if (task?.status !== 'blocked' || !isMaxReviewCyclesBlocker(task?.blockedReason)) return null;
  return {
    status: 'done',
    blockedReason: null,
    assignedTo: null,
    completedAt: task.completedAt || now,
  };
}

export function buildMaxReviewBlockerExtensionUpdate(task) {
  if (task?.status !== 'blocked' || !isMaxReviewCyclesBlocker(task?.blockedReason)) return null;
  return {
    status: 'queued',
    blockedReason: null,
    assignedTo: null,
    maxReviewCycles: resolveTaskMaxReviewCycles(task) + 1,
  };
}

export function isReviewResultPlaceholder(reviewText, reviewResult = parseReviewResult(reviewText)) {
  if (typeof reviewText !== 'string' || !reviewText.trim()) return true;

  const normalized = reviewText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.includes("(issue description, or 'none')")) return true;
  if (normalized.includes('(2-3 sentences summarising the review)')) return true;
  if (normalized.includes('concrete issue, or none')) return true;

  const summary = (reviewResult.summary || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!summary) return true;
  if (summary.includes('sentences summarising the review')) return true;

  return false;
}

export function isImplementationPlaceholder(resultText) {
  if (typeof resultText !== 'string' || !resultText.trim()) return true;
  const normalized = resultText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.includes('{describe the blocker here}')) return true;
  if (normalized.includes('{task_id}')) return true;
  // The prompt template contains placeholder instruction text — if the
  // captured block matches the template exactly it's an echo, not real output.
  if (normalized.includes('output the completion block below with the placeholder replaced')) return true;
  // Check for actual completion or blocked markers with real content.
  // The prompt template contains `{task.id}` and `{describe the blocker here}` —
  // real output has a concrete task ID (e.g. T-ABC123) or real blocker text.
  const hasRealCompletion = /=== implementation complete t-/i.test(normalized);
  const hasRealBlocked = /=== blocked:/.test(normalized) && !normalized.includes('{describe the blocker here}');
  if (!hasRealCompletion && !hasRealBlocked) return true;
  return false;
}

export function isPlanPlaceholder(planText) {
  if (typeof planText !== 'string' || !planText.trim()) return true;
  const normalized = planText.replace(/\s+/g, ' ').trim().toLowerCase();
  const hasPlaceholder =
    normalized.includes('(one sentence describing what will be built)') ||
    normalized.includes('(detailed, actionable step)') ||
    normalized.includes('path/to/file.ts (reason for modification)') ||
    normalized.includes("(test description, or 'none')") ||
    normalized.includes("(potential issue or edge case, or 'none')");

  if (!hasPlaceholder) return false;

  // Placeholder patterns found — but the plan may contain real content
  // alongside echoed prompt template text (terminal echo contamination).
  // Check if any SUMMARY line has substantive content.
  const summaryMatches = [...planText.matchAll(/SUMMARY:\s*(.+)/gi)];
  const hasRealSummary = summaryMatches.some(m => {
    const val = m[1].trim();
    return val.length > 20 && !val.startsWith('(');
  });

  if (hasRealSummary) return false;

  return true;
}

export function getLiveTaskAgent(task, agentManager) {
  if (!task?.assignedTo) return null;
  const agent = agentManager.get(task.assignedTo);
  if (!agent?.process) return null;
  if (agent.currentTask !== task.id) return null;
  return agent;
}

export function getAgentStage(agentId) {
  if (agentId?.startsWith('plan-')) return 'planning';
  if (agentId?.startsWith('imp-')) return 'implementation';
  if (agentId?.startsWith('rev-')) return 'review';
  return null;
}

export function stageToRetryStatus(task, { planningDisabled = false, liveAgent = null } = {}) {
  if (liveAgent) {
    const stage = getAgentStage(liveAgent.id);
    if (stage === 'planning') return 'planning';
    if (stage === 'implementation') return 'implementing';
    if (stage === 'review') return 'review';
  }

  if (isMaxReviewCyclesBlocker(task.blockedReason || '')) {
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
