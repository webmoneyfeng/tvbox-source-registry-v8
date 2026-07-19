import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeSource } from '../src/worker.mjs';
import { REGISTRY_VERSION, SOURCE_REGISTRY } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function run() {
  const generatedAt = new Date().toISOString();
  const rows = [];
  for (let i = 0; i < SOURCE_REGISTRY.length; i += 3) {
    const batch = SOURCE_REGISTRY.slice(i, i + 3);
    rows.push(...await Promise.all(batch.map((source) => probeSource(source))));
  }
  const report = {
    generatedAt,
    registryVersion: REGISTRY_VERSION,
    candidateCount: rows.length,
    active: rows.filter((row) => row.ok).length,
    failed: rows.filter((row) => !row.ok).length,
    rows,
    admission: 'Only rows with listing, search, detail and direct playable URL checks passing are ACTIVE candidates.',
  };
  await mkdir(path.join(ROOT, 'audit'), { recursive: true });
  await writeFile(path.join(ROOT, 'audit', 'source-health-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ generatedAt, candidateCount: report.candidateCount, active: report.active, failed: report.failed }, null, 2));
  for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.slug} search=${row.searchCount} detail=${row.detailOk} play=${row.playOk} ${row.error || ''}`.trim());
  if (!report.active) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
