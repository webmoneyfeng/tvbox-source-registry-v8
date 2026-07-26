import { readFile, writeFile } from 'node:fs/promises';
import { LIVE_SOURCE_REGISTRY, REGISTRY_VERSION, SOURCE_REGISTRY } from '../src/registry.mjs';
import {
  HEALTH_SCHEMA_VERSION,
  emptyHealthState,
  healthRevision,
  sourceHealthKey,
} from '../src/health.mjs';
import { dedupeChannels, parseM3U } from '../src/live.mjs';

const AUDIT_FILE = process.env.DEEP_AUDIT_FILE || 'audit/source-admission-v82.json';
const EXISTING_FILE = process.env.EXISTING_HEALTH_FILE || '';
const OUTPUT_FILE = process.env.HEALTH_SEED_FILE || 'audit/health-seed-from-deep-audit-v82.json';
const generatedAt = new Date().toISOString();

const admission = JSON.parse(await readFile(AUDIT_FILE, 'utf8'));
const auditRows = new Map((admission.rows || []).map((row) => [`${row.kind}:${row.slug}`, row]));
let existing = null;
if (EXISTING_FILE) {
  try {
    const text = (await readFile(EXISTING_FILE, 'utf8')).replace(/^\uFEFF/u, '');
    existing = JSON.parse(text);
  } catch {}
}

function sampleHistory(ok, at) {
  return Array.from({ length: 12 }, () => ({ at, ok, score: ok ? 1 : 0 }));
}

async function fetchLiveChannels(source, fallback = []) {
  try {
    const response = await fetch(source.api, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return fallback;
    const parsed = parseM3U(await response.text());
    return parsed.channels.slice(0, 400);
  } catch {
    return fallback;
  }
}

function seedRow(source) {
  const key = sourceHealthKey(source);
  const row = auditRows.get(key);
  const vodOk = source.kind === 'vod'
    && row?.ok === true
    && Number(row.detailOkRate || 0) > 0
    && Number(row.playableRate || 0) > 0;
  const liveOk = source.kind === 'live'
    && row?.ok === true
    && Number(row.playableCount || 0) >= 2;
  const ok = vodOk || liveOk;
  const tier = ok && row.admissionTier === 'ACTIVE' ? 'ACTIVE' : ok ? 'WATCH' : 'REJECTED';
  const lastDeepAuditAt = row ? (row.lastDeepAuditAt || admission.generatedAt || generatedAt) : null;
  const prior = existing?.sources?.[key] || existing?.sources?.[source.slug] || {};
  const softWarnings = Array.isArray(row?.softWarnings) ? row.softWarnings : [];
  const hardFailures = ok
    ? []
    : (Array.isArray(row?.hardFailures) && row.hardFailures.length ? row.hardFailures : ['DEEP_AUDIT_UNAVAILABLE']);
  return {
    ...prior,
    slug: source.slug,
    kind: source.kind,
    ok,
    admissionTier: tier,
    hardFailure: !ok,
    hardFailures,
    softWarnings,
    lastVerifiedAt: lastDeepAuditAt || generatedAt,
    checkedAt: generatedAt,
    classCount: Number(row?.classCount || 0),
    categoryCount: Number(row?.categoryCount || 0),
    categoryOkCount: Number(row?.categoryOkCount || 0),
    emptyCategoryCount: Number(row?.emptyCategoryCount || 0),
    listCount: Number(row?.listCount || 0),
    searchCount: Array.isArray(row?.searchChecks) ? row.searchChecks.filter((item) => item.ok).length : 0,
    searchEvidence: Array.isArray(row?.searchChecks) ? row.searchChecks : [],
    searchCapability: Boolean(row?.searchCapability),
    detailCapability: source.kind === 'vod' ? Boolean(row?.detailOkRate > 0) : undefined,
    nativeFilterable: Boolean(row?.native?.nativeFilterable),
    nativeSortable: Boolean(row?.native?.nativeSortable),
    nativeFilterKeys: Array.isArray(row?.native?.nativeFilterKeys) ? row.native.nativeFilterKeys : [],
    nativeSortKeys: Array.isArray(row?.native?.nativeSortKeys) ? row.native.nativeSortKeys : [],
    directPlaybackEligible: ok,
    detailOk: source.kind === 'vod' ? Boolean(row?.detailOkRate > 0) : undefined,
    playOk: source.kind === 'vod' ? Boolean(row?.playableRate > 0) : undefined,
    latestAt: row?.latestAt || null,
    channelCount: Number(row?.channelCount || 0),
    groupCount: Number(row?.groupCount || 0),
    playableCount: Number(row?.playableCount || 0),
    sampleCount: Number(row?.sampleCount || 0),
    playableRate: Number(row?.playableRate || 0),
    encoding: row?.encoding || null,
    rootCauses: [...hardFailures, ...softWarnings],
    evidence: row?.evidence || {},
    lastDeepAuditAt,
    deepOk: ok,
    deepAuditOk: ok,
    deepAuditTier: ok ? tier : null,
    state: ok ? tier : 'QUARANTINED',
    consecutiveSuccesses: ok ? 12 : 0,
    consecutiveFailures: ok ? 0 : Math.max(3, Number(prior.consecutiveFailures || 0)),
    lastSuccessAt: ok ? (prior.lastSuccessAt || lastDeepAuditAt || generatedAt) : null,
    lastFailureAt: ok ? (prior.lastFailureAt || null) : generatedAt,
    rollingSuccessRate: ok ? 1 : 0,
    samples: sampleHistory(ok, lastDeepAuditAt || generatedAt),
    score: Number(row?.score?.total || prior.score || 0),
    scoreBreakdown: row?.score || prior.scoreBreakdown || null,
    verification: 'DEEP_AUDIT_SEED',
  };
}

const state = {
  ...emptyHealthState(generatedAt),
  ...(existing || {}),
  schemaVersion: HEALTH_SCHEMA_VERSION,
  generatedAt,
  checkedAt: generatedAt,
  persistedAt: null,
  sources: Object.fromEntries(
    [...SOURCE_REGISTRY, ...LIVE_SOURCE_REGISTRY].map((source) => [sourceHealthKey(source), seedRow(source)]),
  ),
};

const visibleVod = SOURCE_REGISTRY.filter((source) => state.sources[sourceHealthKey(source)]?.ok);
const visibleLive = LIVE_SOURCE_REGISTRY.filter((source) => state.sources[sourceHealthKey(source)]?.ok);
state.lastKnownGoodVOD = visibleVod.map(sourceHealthKey);
state.lastKnownGoodLIVE = visibleLive.map(sourceHealthKey);
const previousLiveBySource = existing?.liveCatalogBySource && typeof existing.liveCatalogBySource === 'object'
  ? existing.liveCatalogBySource
  : {};
const fetchedLiveBySource = await Promise.all(visibleLive.map(async (source) => {
  const key = sourceHealthKey(source);
  const fallback = Array.isArray(previousLiveBySource[key]) ? previousLiveBySource[key] : [];
  return [key, await fetchLiveChannels(source, fallback)];
}));
state.liveCatalogBySource = {
  ...previousLiveBySource,
  ...Object.fromEntries(fetchedLiveBySource),
};
const liveRows = visibleLive.flatMap((source) => state.liveCatalogBySource[sourceHealthKey(source)] || []);
state.liveCatalog = dedupeChannels(liveRows).slice(0, 2000);
state.liveRevision = state.liveCatalog.length
  ? state.liveCatalog.map((channel) => `${channel.name}|${channel.url}`).join('\n').length.toString(16)
  : existing?.liveRevision || 'none';
state.revision = healthRevision([...SOURCE_REGISTRY, ...LIVE_SOURCE_REGISTRY], state);
state.revision = `${state.revision}|live:${state.liveRevision}`;

const payload = {
  generatedAt,
  registryVersion: REGISTRY_VERSION,
  source: AUDIT_FILE,
  vodVisible: visibleVod.length,
  liveVisible: visibleLive.length,
  state,
};
await writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  output: OUTPUT_FILE,
  vodVisible: visibleVod.length,
  liveVisible: visibleLive.length,
  rejected: Object.values(state.sources).filter((row) => row.state === 'QUARANTINED').length,
  revision: state.revision,
}, null, 2));
