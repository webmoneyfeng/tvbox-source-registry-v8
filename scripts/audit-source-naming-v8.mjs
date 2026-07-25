import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_SOURCE_REGISTRY, REGISTRY_VERSION, SOURCE_REGISTRY, sourceDisplayName } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = [...SOURCE_REGISTRY, ...LIVE_SOURCE_REGISTRY].map((source, index) => {
  const url = new URL(source.api);
  const name = sourceDisplayName(source, index);
  return {
    kind: source.kind,
    slug: source.slug,
    name,
    provider: source.provider,
    host: url.hostname,
    api: source.api,
    physicalSource: source.physicalKey,
    traceable: Boolean(name && source.provider && url.hostname && source.api),
  };
});

function duplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

const duplicateNames = duplicates(rows.map((row) => row.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')));
const duplicateApis = duplicates(rows.map((row) => row.api));
const missingIdentity = rows.filter((row) => !row.traceable).map((row) => row.slug);
const report = {
  generatedAt: new Date().toISOString(),
  registryVersion: REGISTRY_VERSION,
  policy: 'Names remain the registry or upstream-provided display names. No category, title, sort or filter rewriting is performed.',
  counts: { total: rows.length, vod: SOURCE_REGISTRY.length, live: LIVE_SOURCE_REGISTRY.length },
  checks: {
    uniqueNames: duplicateNames.length === 0,
    uniqueApis: duplicateApis.length === 0,
    traceableIdentity: missingIdentity.length === 0,
  },
  duplicateNames,
  duplicateApis,
  missingIdentity,
  rows,
};
report.pass = Object.values(report.checks).every(Boolean);

await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'source-naming-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ generatedAt: report.generatedAt, counts: report.counts, checks: report.checks, pass: report.pass }, null, 2));
if (!report.pass) process.exitCode = 1;
