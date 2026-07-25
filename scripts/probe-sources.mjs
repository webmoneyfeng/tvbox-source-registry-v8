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
    active: rows.filter((row) => row.admissionTier === 'ACTIVE').length,
    watch: rows.filter((row) => row.admissionTier === 'WATCH').length,
    rejected: rows.filter((row) => row.admissionTier === 'REJECTED').length,
    usable: rows.filter((row) => row.admissionTier === 'ACTIVE' || row.admissionTier === 'WATCH').length,
    hardFailures: rows.filter((row) => Array.isArray(row.hardFailures) && row.hardFailures.length).length,
    softWarnings: rows.filter((row) => Array.isArray(row.softWarnings) && row.softWarnings.length).length,
    target: TARGET_COUNT,
    targetMet: rows.filter((row) => row.admissionTier === 'ACTIVE' || row.admissionTier === 'WATCH').length >= TARGET_COUNT,
    strictTargetMet: rows.filter((row) => row.admissionTier === 'ACTIVE').length >= TARGET_COUNT,
    rows,
    admission: 'ACTIVE has no hard failure and no soft warning. WATCH has passed the hard contract but carries a soft warning. REJECTED has at least one hard failure.',
  };
  await mkdir(path.join(ROOT, 'audit'), { recursive: true });
  await writeFile(path.join(ROOT, 'audit', 'source-health-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ generatedAt, candidateCount: report.candidateCount, active: report.active, watch: report.watch, rejected: report.rejected, usable: report.usable, target: report.target, targetMet: report.targetMet, strictTargetMet: report.strictTargetMet }, null, 2));
  for (const row of rows) console.log(`${row.admissionTier} ${row.slug} search=${row.searchCount} detail=${row.detailOk} play=${row.playOk} hard=${(row.hardFailures || []).join('|') || '-'} soft=${(row.softWarnings || []).join('|') || '-'}`);
  if (!report.targetMet) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
