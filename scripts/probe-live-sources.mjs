import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeLiveSource } from '../src/worker.mjs';
import { LIVE_SOURCE_REGISTRY, REGISTRY_VERSION } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_COUNT = 10;
const generatedAt = new Date().toISOString();
const rows = [];
for (const source of LIVE_SOURCE_REGISTRY) rows.push(await probeLiveSource(source));
const report = {
  generatedAt,
  registryVersion: REGISTRY_VERSION,
  candidateCount: rows.length,
  passed: rows.filter((row) => row.ok).length,
  failed: rows.filter((row) => !row.ok).length,
  target: TARGET_COUNT,
  targetMet: rows.filter((row) => row.ok).length >= TARGET_COUNT,
  rows: rows.map(({ channels, ...row }) => ({ ...row, channelSample: channels?.slice(0, 5) || [] })),
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'live-health-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ generatedAt, candidateCount: report.candidateCount, passed: report.passed, failed: report.failed, target: report.target, targetMet: report.targetMet }, null, 2));
for (const row of report.rows) console.log(`${row.ok ? 'PASS' : 'WATCH'} ${row.slug} channels=${row.channelCount} groups=${row.groupCount} playable=${row.playableCount}/${row.sampleCount}`);
if (!report.targetMet) process.exitCode = 1;
