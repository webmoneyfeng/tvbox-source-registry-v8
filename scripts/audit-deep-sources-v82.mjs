import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_REGISTRY, LIVE_SOURCE_REGISTRY } from '../src/registry.mjs';
import { auditLiveSource, auditVodSource } from '../src/deep-audit.mjs';
import { evaluatePublicationGate, summarizeTarget } from '../src/admission.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const DEEP_LIMIT = Math.max(1, Number(process.env.DEEP_CONCURRENCY || 2));
const SOURCE_OFFSET = Math.max(0, Number(process.env.DEEP_SOURCE_OFFSET || 0));
const SOURCE_LIMIT = Number(process.env.DEEP_SOURCE_LIMIT || 0);
const CATEGORY_START = Math.max(0, Number(process.env.DEEP_CATEGORY_START || 0));
const CATEGORY_LIMIT = Number(process.env.DEEP_CATEGORY_LIMIT || 0);
const DETAIL_SAMPLE = Number(process.env.DEEP_DETAIL_SAMPLE || 8);
const CHANNEL_SAMPLE = Number(process.env.DEEP_CHANNEL_SAMPLE || 24);
const REQUIRE_COMPLETE_CATEGORIES = process.env.DEEP_REQUIRE_COMPLETE === '1';
const MERGE_EXISTING = process.env.DEEP_MERGE_EXISTING === '1';
const KIND = String(process.env.DEEP_KIND || 'both').toLowerCase();

async function writeJsonAtomic(file, value) {
  const target = path.join(AUDIT_DIR, file);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  const roundTrip = JSON.parse(await readFile(temporary, 'utf8'));
  if (!roundTrip || typeof roundTrip !== 'object') throw new Error(`invalid audit payload: ${file}`);
  await rename(temporary, target);
}

async function mapWithConcurrency(items, limit, callback) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function summary(rows, kind) {
  const result = {
    kind,
    candidateCount: rows.length,
    active: rows.filter((row) => row.admissionTier === 'ACTIVE').length,
    watch: rows.filter((row) => row.admissionTier === 'WATCH').length,
    rejected: rows.filter((row) => row.admissionTier === 'REJECTED').length,
    corePlayable: rows.filter((row) => row.ok && (kind === 'vod' ? row.playableRate > 0 : row.playableCount >= 2)).length,
    categoryAuditComplete: kind === 'vod'
      ? rows.filter((row) => row.categoryCoverage?.complete === true).length
      : null,
    categoryAuditPartial: kind === 'vod'
      ? rows.filter((row) => row.categoryCoverage && row.categoryCoverage.complete !== true).length
      : null,
    generatedAt: new Date().toISOString(),
  };
  return { ...result, ...summarizeTarget(result) };
}

function markdown(vod, live, combined) {
  const lines = [
    '# v8.2 \u6df1\u5ea6\u6e90\u51c6\u5165\u5ba1\u8ba1',
    '',
    `\u751f\u6210\u65f6\u95f4\uff1a${combined.generatedAt}`,
    '',
    '## \u6c47\u603b',
    '',
    `- \u70b9\u64ad\uff1a${vod.active} ACTIVE / ${vod.watch} WATCH / ${vod.rejected} REJECTED`,
    `- \u76f4\u64ad\uff1a${live.active} ACTIVE / ${live.watch} WATCH / ${live.rejected} REJECTED`,
    `- \u5019\u9009\u76ee\u6807\uff1aVOD ${vod.candidateTargetMet ? '\u8fbe\u5230' : '\u672a\u8fbe\u5230'} / LIVE ${live.candidateTargetMet ? '\u8fbe\u5230' : '\u672a\u8fbe\u5230'}`,
    `- \u53ef\u7528\u76ee\u6807\uff1aVOD ${vod.usableTargetMet ? '\u8fbe\u5230' : '\u672a\u8fbe\u5230'} / LIVE ${live.usableTargetMet ? '\u8fbe\u5230' : '\u672a\u8fbe\u5230'}`,
    '- \u6b63\u5f0f\u53d1\u5e03\u95f8\u95e8\uff1a\u672c\u62a5\u544a\u4e0d\u4ee3\u66ff Canary \u7ebf\u4e0a\u9a8c\u8bc1\uff0c\u56e0\u6b64\u9ed8\u8ba4\u4e3a\u672a\u901a\u8fc7',
    `- \u603b\u5019\u9009\uff1a${combined.candidateCount}`,
    `- \u70b9\u64ad\u5b8c\u6574\u5206\u7c7b\u5ba1\u8ba1\uff1a${vod.categoryAuditComplete}/${vod.candidateCount}`,
    '',
    '## \u70b9\u64ad\u6839\u56e0',
    '',
    '| \u6e90 | \u51c6\u5165 | \u5206\u7c7b | \u641c\u7d22 | \u8be6\u60c5\u7387 | \u64ad\u653e\u7387 | \u6839\u56e0 |',
    '|---|---|---:|---:|---:|---:|---|',
  ];
  for (const row of combined.rows.filter((item) => item.kind === 'vod')) {
    lines.push(`| ${row.name || row.slug} | ${row.admissionTier} | ${row.categoryOkCount || 0}/${row.categoryCount || 0} | ${(row.searchChecks || []).filter((item) => item.ok).length}/${(row.searchChecks || []).length} | ${Number(row.detailOkRate || 0).toFixed(2)} | ${Number(row.playableRate || 0).toFixed(2)} | ${(row.rootCauses || []).join(', ') || 'OK'} |`);
  }
  lines.push('', '## \u76f4\u64ad\u6839\u56e0', '', '| \u6e90 | \u51c6\u5165 | \u9891\u9053 | \u5206\u7ec4 | \u64ad\u653e\u7387 | \u6839\u56e0 |', '|---|---|---:|---:|---:|---|');
  for (const row of combined.rows.filter((item) => item.kind === 'live')) {
    lines.push(`| ${row.name || row.slug} | ${row.admissionTier} | ${row.channelCount || 0} | ${row.groupCount || 0} | ${Number(row.playableRate || 0).toFixed(2)} | ${(row.rootCauses || []).join(', ') || 'OK'} |`);
  }
  lines.push(
    '',
    '## \u8bf4\u660e',
    '',
    '- ACTIVE/WATCH/REJECTED \u4ec5\u8868\u793a\u672c\u8f6e\u6df1\u5ea6\u5ba1\u8ba1\u7ed3\u679c\u3002',
    '- \u6e90\u539f\u751f\u5206\u7c7b\u3001\u7b5b\u9009\u3001\u6392\u5e8f\u548c\u8282\u76ee\u5185\u5bb9\u672a\u88ab\u6539\u5199\u3002',
    '- \u5019\u9009\u6df1\u5ba1\u3001\u53ef\u89c1\u5065\u5eb7\u72b6\u6001\u3001\u6b63\u5f0f\u53d1\u5e03\u5206\u5f00\u8bb0\u5f55\uff1b\u4e0d\u7528\u5019\u9009\u62a5\u544a\u5192\u5145\u7ebf\u4e0a\u53ef\u89c1\u6570\u91cf\u3002',
    '- \u5c11\u4e8e\u76ee\u6807\u6216\u7ebf\u4e0a\u76ee\u6807\u672a\u6838\u9a8c\u65f6\u4fdd\u6301 degraded\uff0c\u4e0d\u4f7f\u7528\u672a\u7ecf\u9a8c\u8bc1\u7684\u6e90\u8865\u4f4d\u3002',
    '',
  );
  return lines.join('\n');
}

function selectSources(rows) {
  const start = Math.min(SOURCE_OFFSET, rows.length);
  return SOURCE_LIMIT > 0 ? rows.slice(start, start + SOURCE_LIMIT) : rows.slice(start);
}

function rowKey(row) {
  return `${row.kind || 'unknown'}:${row.slug || row.api || row.name || ''}`;
}

async function readPreviousRows() {
  if (!MERGE_EXISTING) return [];
  try {
    const value = JSON.parse(await readFile(path.join(AUDIT_DIR, 'source-admission-v82.json'), 'utf8'));
    return Array.isArray(value.rows) ? value.rows : [];
  } catch {
    return [];
  }
}

await mkdir(AUDIT_DIR, { recursive: true });
const generatedAt = new Date().toISOString();
const selectedVod = KIND === 'live' ? [] : selectSources(SOURCE_REGISTRY);
const selectedLive = KIND === 'vod' ? [] : selectSources(LIVE_SOURCE_REGISTRY);
const vodRows = await mapWithConcurrency(selectedVod, DEEP_LIMIT, (source) => auditVodSource(source, {
  categoryStart: CATEGORY_START,
  categoryLimit: CATEGORY_LIMIT,
  requireCompleteCategories: REQUIRE_COMPLETE_CATEGORIES,
  detailSample: DETAIL_SAMPLE,
}));
const liveRows = await mapWithConcurrency(selectedLive, DEEP_LIMIT, (source) => auditLiveSource(source, { channelSample: CHANNEL_SAMPLE }));
const combinedRows = [...vodRows, ...liveRows];
const previousRows = await readPreviousRows();
const auditedKeys = new Set(combinedRows.map(rowKey));
const mergedRows = [
  ...previousRows.filter((row) => !auditedKeys.has(rowKey(row))),
  ...combinedRows,
];
const finalVodRows = mergedRows.filter((row) => row.kind === 'vod');
const finalLiveRows = mergedRows.filter((row) => row.kind === 'live');
const vodSummary = summary(finalVodRows, 'vod');
const liveSummary = summary(finalLiveRows, 'live');
const targetGate = evaluatePublicationGate({
  vod: vodSummary,
  live: liveSummary,
  publishedTargetVerified: false,
});
const auditedKeySet = new Set(combinedRows.map(rowKey));
const combined = {
  generatedAt,
  registryVersion: 'v8.2.0',
  target: { vod: 10, live: 10 },
  summaries: { vod: vodSummary, live: liveSummary },
  targetGate,
  candidateCount: mergedRows.length,
  scope: {
    sourceOffset: SOURCE_OFFSET,
    sourceLimit: SOURCE_LIMIT || null,
    categoryStart: CATEGORY_START,
    categoryLimit: CATEGORY_LIMIT || null,
    requireCompleteCategories: REQUIRE_COMPLETE_CATEGORIES,
    mergeExisting: MERGE_EXISTING,
    kind: KIND,
    selectedVod: selectedVod.length,
    selectedLive: selectedLive.length,
    auditedBatch: combinedRows.length,
    mergedRows: mergedRows.length,
  },
  rows: mergedRows,
  degraded: targetGate.degraded,
  publicationReady: targetGate.publicationReady,
};

await writeJsonAtomic('vod-deep-audit-v82.json', { generatedAt, ...vodSummary, scope: combined.scope, rows: finalVodRows });
await writeJsonAtomic('live-deep-audit-v82.json', { generatedAt, ...liveSummary, scope: combined.scope, rows: finalLiveRows });
await writeJsonAtomic('source-admission-v82.json', combined);
await writeJsonAtomic('source-health-v82.json', {
  generatedAt,
  registryVersion: 'v8.2.0',
  admission: combined.summaries,
  degraded: combined.degraded,
  targetGate: combined.targetGate,
  scope: combined.scope,
  rootCauses: mergedRows.reduce((map, row) => {
    for (const cause of row.rootCauses || []) map[cause] = (map[cause] || 0) + 1;
    return map;
  }, {}),
  rows: mergedRows.map((row) => ({
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    api: row.api,
    admissionTier: row.admissionTier,
    ok: row.ok,
    rootCauses: row.rootCauses || [],
    encoding: row.encoding || null,
    playableRate: row.playableRate || 0,
    categoryCoverage: row.categoryCoverage || null,
    auditedThisRun: auditedKeySet.has(rowKey(row)),
    lastDeepAuditAt: auditedKeySet.has(rowKey(row))
      ? generatedAt
      : row.lastDeepAuditAt || null,
  })),
});
await writeFile(path.join(AUDIT_DIR, 'source-audit-summary-v82.md'), markdown(vodSummary, liveSummary, combined), 'utf8');

console.log(JSON.stringify({
  generatedAt,
  scope: combined.scope,
  vod: vodSummary,
  live: liveSummary,
  targetGate,
  degraded: combined.degraded,
}, null, 2));
