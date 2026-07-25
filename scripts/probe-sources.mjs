import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeSource } from '../src/worker.mjs';
import { REGISTRY_VERSION, SOURCE_REGISTRY } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_COUNT = 10;

async function probeWithRetry(source) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await probeSource(source);
    if (last.ok || attempt === 2) return last;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

async function run() {
  const generatedAt = new Date().toISOString();
  const rows = [];
  for (let i = 0; i < SOURCE_REGISTRY.length; i += 3) {
    const batch = SOURCE_REGISTRY.slice(i, i + 3);
    rows.push(...await Promise.all(batch.map((source) => probeWithRetry(source))));
  }
  const report = {
    generatedAt,
    registryVersion: REGISTRY_VERSION,
    candidateCount: rows.length,
    active: rows.filter((row) => row.ok).length,
    failed: rows.filter((row) => !row.ok).length,
    target: TARGET_COUNT,
    targetMet: rows.filter((row) => row.ok).length >= TARGET_COUNT,
    rows,
    admission: 'Only rows with listing, search, detail and direct playable URL checks passing are ACTIVE candidates.',
  };
  await mkdir(path.join(ROOT, 'audit'), { recursive: true });
  await writeFile(path.join(ROOT, 'audit', 'source-health-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ generatedAt, candidateCount: report.candidateCount, active: report.active, failed: report.failed, target: report.target, targetMet: report.targetMet }, null, 2));
  for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.slug} search=${row.searchCount} detail=${row.detailOk} play=${row.playOk} ${row.error || ''}`.trim());
  if (!report.targetMet) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
