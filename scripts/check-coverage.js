import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COVERAGE_TARGET = 80;

function readSummary(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf-8'));
}

function getTotals(summary) {
  return summary.total || {};
}

function weightedMetric(entries, key) {
  let covered = 0;
  let total = 0;

  for (const entry of entries) {
    covered += entry[key]?.covered || 0;
    total += entry[key]?.total || 0;
  }

  return total === 0 ? 100 : (covered / total) * 100;
}

function reportMetric(label, pct) {
  console.log(`${label}: ${pct.toFixed(2)}%`);
}

const summaries = [
  getTotals(readSummary('./server/coverage/coverage-summary.json')),
  getTotals(readSummary('./client/coverage/coverage-summary.json')),
];

const metrics = {
  lines: weightedMetric(summaries, 'lines'),
  branches: weightedMetric(summaries, 'branches'),
  functions: weightedMetric(summaries, 'functions'),
};

reportMetric('Combined line coverage', metrics.lines);
reportMetric('Combined branch coverage', metrics.branches);
reportMetric('Combined function coverage', metrics.functions);

const failed = Object.entries(metrics)
  .filter(([, pct]) => pct < COVERAGE_TARGET);

if (failed.length > 0) {
  const labels = failed.map(([key, pct]) => `${key}=${pct.toFixed(2)}%`).join(', ');
  console.error(`Coverage check failed. Required >= ${COVERAGE_TARGET}% for all metrics. Received: ${labels}`);
  process.exit(1);
}

console.log(`Coverage check passed. Required >= ${COVERAGE_TARGET}% for lines, branches, and functions.`);
