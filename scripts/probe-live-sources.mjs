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
  active: rows.filter((row) => row.admissionTier === 'ACTIVE').length,
  watch: rows.filter((row) => row.admissionTier === 'WATCH').length,
  rejected: rows.filter((row) => row.admissionTier === 'REJECTED').length,
  usable: rows.filter((row) => row.admissionTier === 'ACTIVE' || row.admissionTier === 'WATCH').length,
  hardFailures: rows.filter((row) => Array.isArray(row.hardFailures) && row.hardFailures.length).length,
  softWarnings: rows.filter((row) => Array.isArray(row.softWarnings) && row.softWarnings.length).length,
  target: TARGET_COUNT,
  targetMet: rows.filter((row) => row.admissionTier === 'ACTIVE' || row.admissionTier === 'WATCH').length >= TARGET_COUNT,
  strictTargetMet: rows.filter((row) => row.admissionTier === 'ACTIVE').length >= TARGET_COUNT,
  rows: rows.map(({ channels, ...row }) => ({ ...row, channelSample: channels?.slice(0, 5) || [] })),
  admission: 'ACTIVE has no hard failure and no soft warning. WATCH has passed the hard contract but carries a soft warning. REJECTED has at least one hard failure.',
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'live-health-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ generatedAt, candidateCount: report.candidateCount, active: report.active, watch: report.watch, rejected: report.rejected, usable: report.usable, target: report.target, targetMet: report.targetMet, strictTargetMet: report.strictTargetMet }, null, 2));
for (const row of report.rows) console.log(`${row.admissionTier} ${row.slug} channels=${row.channelCount} groups=${row.groupCount} playable=${row.playableCount}/${row.sampleCount} hard=${(row.hardFailures || []).join('|') || '-'} soft=${(row.softWarnings || []).join('|') || '-'}`);
if (!report.targetMet) process.exitCode = 1;
