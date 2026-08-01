import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeCandidates, extractCandidates, extractConfigReferences, isPublicHttpUrl, normalizeCandidateUrl, physicalCandidateKey } from '../src/discovery.mjs';
import { liveContract, parseM3U } from '../src/live.mjs';
import { candidateRegistryKey, candidateToRegistrySource, LIVE_SOURCE_REGISTRY, SOURCE_REGISTRY } from '../src/registry.mjs';
import { parseTvappPayload, parseTvappReadmeSources, tvappKnownNameForUrl } from '../src/tvapp.mjs';
import { probeSource } from '../src/worker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_URL = process.env.TVAPP_README_URL || 'https://raw.githubusercontent.com/youhunwl/TVAPP/main/README.md';
const TIMEOUT_MS = Number(process.env.TVAPP_TIMEOUT_MS || 12000);
const MAX_VOD_PROBES = Number(process.env.TVAPP_MAX_VOD_PROBES || 40);
const MAX_LIVE_SHAPE = Number(process.env.TVAPP_MAX_LIVE_SHAPE || 40);
const MAX_LIVE_MEDIA = Number(process.env.TVAPP_MAX_LIVE_MEDIA || 14);
const MAX_MEDIA_PER_PLAYLIST = Number(process.env.TVAPP_MAX_MEDIA_PER_PLAYLIST || 8);
const MAX_CONFIG_DEPTH = Math.max(0, Math.min(2, Number(process.env.TVAPP_MAX_CONFIG_DEPTH || 2)));
const MAX_CONFIG_DOCUMENTS = Math.max(1, Number(process.env.TVAPP_MAX_CONFIG_DOCUMENTS || 100));
const DISALLOWED_DIRECT_SITE_RE = /(?:jar|spider|ext|parse|player|script)/iu;
const CMS_API_RE = /(?:api\.php\/provide\/vod|\/provide\/vod|\/vod\/?)(?:$|\?)/iu;

async function fetchLimited(url, maxBytes = 1_200_000) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json,text/plain,*/*', 'user-agent': 'tvbox-source-registry-v8-tvapp-audit/1.0' },
    });
    const reader = response.body?.getReader?.();
    const chunks = [];
    let total = 0;
    if (reader) {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        total += value.byteLength;
      }
    }
    const body = Buffer.concat(chunks, Math.min(total, maxBytes)).toString('utf8');
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type') || '',
      bytes: Buffer.byteLength(body),
      latencyMs: Date.now() - started,
      text: body,
      error: '',
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: '',
      bytes: 0,
      latencyMs: Date.now() - started,
      text: '',
      error: String(error?.message || error).slice(0, 240),
    };
  }
}

function parsePayload(text) {
  return parseTvappPayload(text);
}

function documentType(payload, text) {
  if (typeof payload === 'string' && /^\s*#EXTM3U/iu.test(payload)) return 'm3u';
  if (payload && typeof payload === 'object' && Array.isArray(payload.sites)) return 'tvbox_config';
  if (payload && typeof payload === 'object' && Array.isArray(payload.urls)) return 'storehouse';
  if (payload && typeof payload === 'object') return 'json_other';
  if (/<html|<!doctype html/iu.test(text)) return 'html';
  return 'text';
}

function extractDirectSites(payload, feedUrl) {
  const base = extractCandidates(payload, feedUrl);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.sites)) return base;
  const direct = [];
  for (const site of payload.sites) {
    if (!site || Number(site.type || 1) !== 1 || !isPublicHttpUrl(site.api)) continue;
    const keys = Object.keys(site).filter((key) => site[key]).join(' ');
    if (DISALLOWED_DIRECT_SITE_RE.test(keys)) continue;
    direct.push({ kind: 'vod', api: normalizeCandidateUrl(site.api), name: String(site.name || '').trim(), discoveredFrom: feedUrl });
  }
  return [...base, ...direct];
}

function isLikelyCmsApi(value) {
  return CMS_API_RE.test(String(value || ''));
}

async function inspectVodDocument(entry) {
  const fetched = await fetchLimited(entry.url, 900_000);
  const payload = parsePayload(fetched.text);
  const directCandidates = extractDirectSites(payload, entry.url)
    .filter((candidate) => candidate.kind === 'vod' && isPublicHttpUrl(candidate.api));
  const configReferences = extractConfigReferences(payload, entry.url);
  for (const reference of configReferences) {
    if (isLikelyCmsApi(reference.api)) {
      directCandidates.push({
        kind: 'vod',
        api: reference.api,
        name: reference.name,
        discoveredFrom: entry.url,
      });
    }
  }
  return {
    ...entry,
    ok: fetched.ok,
    status: fetched.status,
    finalUrl: fetched.finalUrl,
    bytes: fetched.bytes,
    latencyMs: fetched.latencyMs,
    documentType: documentType(payload, fetched.text),
    extractedVodCount: directCandidates.length,
    configReferenceCount: configReferences.length,
    candidates: directCandidates,
    configReferences,
    error: fetched.error,
  };
}

function existingKeys() {
  const vod = new Set(SOURCE_REGISTRY.map((source) => `${source.kind}:${source.physicalKey}`));
  const live = new Set(LIVE_SOURCE_REGISTRY.map((source) => `${source.kind}:${source.physicalKey}`));
  return new Set([...vod, ...live]);
}

function isAlreadyRegistered(candidate) {
  try { return existing.has(candidateRegistryKey(candidate)); }
  catch { return false; }
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

async function mapWithConcurrency(items, limit, callback) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function parseTxtChannels(input) {
  const rows = [];
  for (const rawLine of String(input || '').replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const comma = line.indexOf(',http');
    if (comma < 0) continue;
    const name = line.slice(0, comma).trim();
    const url = line.slice(comma + 1).trim();
    if (isPublicHttpUrl(url)) rows.push({ name, group: '未分组', url });
  }
  return rows;
}

function playlistChannels(text) {
  if (/^\s*#EXTM3U/iu.test(text)) return parseM3U(text).channels;
  return parseTxtChannels(text);
}

async function probeMedia(url) {
  const media = await fetchLimited(url, 120_000);
  const direct = media.ok && (media.text.includes('#EXTM3U') || /(?:mpegurl|video|mp2t|octet-stream)/iu.test(media.contentType));
  const invalidEndpoint = /(?:iframe|player\.html|解析|广告|公众号|加群|<!doctype html|<html)/iu.test(media.text);
  return {
    url,
    ok: direct && !invalidEndpoint,
    status: media.status,
    contentType: media.contentType,
    latencyMs: media.latencyMs,
    bytes: media.bytes,
    rootCause: direct && !invalidEndpoint ? 'OK' : invalidEndpoint ? 'AD_OR_PARSE_ENDPOINT' : 'MEDIA_FIRST_PACKET_FAIL',
  };
}

function tierFromVodProbe(row) {
  if (!row.ok && row.hardFailure) return 'REJECTED';
  if (!row.detailOk) return 'REJECTED';
  if (!row.playOk) return 'REJECTED';
  if (!row.searchCount) return 'WATCH';
  return 'PROBATION';
}

function rootCausesFromProbe(row) {
  const causes = [];
  if (!row.ok) causes.push(row.error || 'API_OR_CONTRACT_FAIL');
  if (!row.listCount && !row.categoryCount) causes.push('NO_LIST_OR_CATEGORY');
  if (!row.searchCount) causes.push('SOURCE_SEARCH_GAP');
  if (!row.detailOk) causes.push('SOURCE_DETAIL_GAP');
  if (!row.playOk) causes.push('SOURCE_PLAYBACK_GAP');
  if (row.invalidBranchCount) causes.push('AD_OR_PARSE_ENDPOINT');
  return [...new Set(causes.filter(Boolean))];
}

const generatedAt = new Date().toISOString();
const readme = await fetchLimited(README_URL, 800_000);
const entries = readme.ok ? parseTvappReadmeSources(readme.text) : [];
const vodIndexes = entries.filter((entry) => entry.kind === 'vod_index');
const liveIndexes = entries.filter((entry) => entry.kind === 'live');
const existing = existingKeys();

const seenConfigUrls = new Set();
const discoveredConfigReferences = [];
const vodDocuments = [];
let configQueue = dedupeBy(vodIndexes.map((entry) => ({ ...entry, depth: 0 })), (entry) => normalizeCandidateUrl(entry.url));
let configTraversalTruncated = false;
for (let depth = 0; configQueue.length && depth <= MAX_CONFIG_DEPTH; depth += 1) {
  const remaining = MAX_CONFIG_DOCUMENTS - vodDocuments.length;
  if (remaining <= 0) {
    configTraversalTruncated = true;
    break;
  }
  const batch = configQueue.slice(0, remaining);
  if (configQueue.length > batch.length) configTraversalTruncated = true;
  for (const entry of batch) seenConfigUrls.add(normalizeCandidateUrl(entry.url));
  const inspected = await mapWithConcurrency(batch, 5, inspectVodDocument);
  vodDocuments.push(...inspected);
  const references = inspected.flatMap((document) => document.configReferences || []);
  discoveredConfigReferences.push(...references);
  if (depth === MAX_CONFIG_DEPTH) {
    if (references.some((reference) => !isLikelyCmsApi(reference.api))) configTraversalTruncated = true;
    break;
  }
  configQueue = dedupeBy(references
    .filter((reference) => !isLikelyCmsApi(reference.api))
    .filter((reference) => !seenConfigUrls.has(normalizeCandidateUrl(reference.api)))
    .map((reference) => ({ ...reference, url: reference.api, depth: depth + 1 })), (entry) => normalizeCandidateUrl(entry.url));
}

const vodCandidates = dedupeBy(
  dedupeCandidates(vodDocuments.flatMap((document) => document.candidates || [])),
  (candidate) => {
    try { return `vod:${candidateToRegistrySource(candidate).physicalKey}`; } catch { return ''; }
  },
);
const vodProbeTargets = vodCandidates
  .filter((candidate) => !isAlreadyRegistered(candidate))
  .filter((candidate) => isLikelyCmsApi(candidate.api))
  .slice(0, MAX_VOD_PROBES);

const vodProbes = await mapWithConcurrency(vodProbeTargets, 4, async (candidate) => {
  const source = candidateToRegistrySource(candidate);
  try {
    const probe = await probeSource(source);
    const row = {
      kind: 'vod',
      name: candidate.name || source.displayName || source.slug,
      api: source.api,
      physicalKey: source.physicalKey,
      discoveredFrom: candidate.discoveredFrom,
      alreadyInRegistry: isAlreadyRegistered(candidate),
      ok: Boolean(probe.ok),
      score: probe.score?.total || 0,
      httpStatus: probe.httpStatus || 0,
      latencyMs: probe.latencyMs || null,
      categoryCount: probe.categoryCount || probe.classCount || 0,
      listCount: probe.listCount || 0,
      searchCount: probe.searchCount || 0,
      detailOk: Boolean(probe.detailOk),
      playOk: Boolean(probe.playOk),
      invalidBranchCount: probe.invalidBranchCount || 0,
      recommendedTier: '',
      rootCauses: [],
      error: probe.error || '',
    };
    row.recommendedTier = tierFromVodProbe(row);
    row.rootCauses = rootCausesFromProbe(row);
    return row;
  } catch (error) {
    return {
      kind: 'vod',
      name: candidate.name || source.slug,
      api: source.api,
      physicalKey: source.physicalKey,
      discoveredFrom: candidate.discoveredFrom,
      alreadyInRegistry: isAlreadyRegistered(candidate),
      ok: false,
      score: 0,
      httpStatus: 0,
      latencyMs: null,
      categoryCount: 0,
      listCount: 0,
      searchCount: 0,
      detailOk: false,
      playOk: false,
      invalidBranchCount: 0,
      recommendedTier: 'REJECTED',
      rootCauses: ['API_OR_CONTRACT_FAIL'],
      error: String(error?.message || error).slice(0, 240),
    };
  }
});

const uniqueLiveIndexes = dedupeBy(liveIndexes, (entry) => `live:${physicalCandidateKey(entry.url)}`);
const liveDocuments = await mapWithConcurrency(uniqueLiveIndexes.slice(0, MAX_LIVE_SHAPE), 5, async (entry) => {
  const fetched = await fetchLimited(entry.url, 1_200_000);
  const contract = fetched.ok ? liveContract(fetched.text) : { ok: false, channelCount: 0, groupCount: 0, duplicateRate: 0, sample: [] };
  const channels = fetched.ok ? playlistChannels(fetched.text) : [];
  return {
    ...entry,
    name: tvappKnownNameForUrl(entry.url) || entry.label || new URL(entry.url).hostname.replace(/^www\./u, ''),
    ok: fetched.ok,
    status: fetched.status,
    finalUrl: fetched.finalUrl,
    bytes: fetched.bytes,
    latencyMs: fetched.latencyMs,
    format: /^\s*#EXTM3U/iu.test(fetched.text) ? 'm3u' : (channels.length ? 'txt' : 'unknown'),
    channelCount: contract.channelCount || channels.length,
    groupCount: contract.groupCount || new Set(channels.map((channel) => channel.group || '未分组')).size,
    duplicateRate: contract.duplicateRate || 0,
    sampleChannels: channels.slice(0, MAX_MEDIA_PER_PLAYLIST),
    alreadyInRegistry: isAlreadyRegistered({ kind: 'live', api: entry.url }),
    error: fetched.error,
  };
});

const liveMediaTargets = dedupeBy(liveDocuments
  .filter((row) => row.ok && row.channelCount >= 5 && !row.alreadyInRegistry)
  .slice(0, MAX_LIVE_MEDIA), (row) => `live:${physicalCandidateKey(row.url)}`);

const liveMedia = await mapWithConcurrency(liveMediaTargets, 3, async (row) => {
  const probes = [];
  for (const channel of row.sampleChannels.slice(0, MAX_MEDIA_PER_PLAYLIST)) {
    const probe = await probeMedia(channel.url);
    probes.push({ name: channel.name, group: channel.group, ...probe });
    if (probes.filter((item) => item.ok).length >= 2) break;
  }
  const playableCount = probes.filter((item) => item.ok).length;
  let recommendedTier = 'REJECTED';
  const rootCauses = [];
  if (!row.ok) rootCauses.push('PLAYLIST_UNAVAILABLE');
  if (row.ok && row.channelCount < 5) rootCauses.push('PLAYLIST_SCHEMA_ERROR');
  if (row.ok && row.channelCount >= 5 && playableCount >= 2) recommendedTier = 'PROBATION';
  else if (row.ok && row.channelCount >= 5 && playableCount >= 1) {
    recommendedTier = 'WATCH';
    rootCauses.push('PARTIAL_CHANNEL_FAILURE');
  } else if (row.ok) rootCauses.push('MEDIA_SEGMENT_UNAVAILABLE');
  return {
    kind: 'live',
    name: row.name,
    api: row.url,
    physicalKey: physicalCandidateKey(row.url),
    discoveredFrom: README_URL,
    alreadyInRegistry: row.alreadyInRegistry,
    status: row.status,
    latencyMs: row.latencyMs,
    channelCount: row.channelCount,
    groupCount: row.groupCount,
    duplicateRate: row.duplicateRate,
    playableCount,
    sampleCount: probes.length,
    recommendedTier,
    rootCauses,
    mediaProbes: probes,
  };
});

const report = {
  generatedAt,
  source: {
    repository: 'https://github.com/youhunwl/TVAPP',
    readme: README_URL,
    readmeOk: readme.ok,
    readmeStatus: readme.status,
    readmeBytes: readme.bytes,
  },
  policy: {
    productionMutation: false,
    directSourceOnly: true,
    noCategoryRewrite: true,
    noFilterRewrite: true,
    configTraversal: {
      maxDepth: MAX_CONFIG_DEPTH,
      maxDocuments: MAX_CONFIG_DOCUMENTS,
    },
    approvalRequiredBeforeRegistryChange: true,
  },
  counts: {
    readmeSourceUrls: entries.length,
    vodIndexUrls: vodIndexes.length,
    liveUrls: liveIndexes.length,
    vodDocuments: vodDocuments.length,
    nestedVodDocuments: vodDocuments.filter((document) => Number(document.depth || 0) > 0).length,
    configReferenceUrls: dedupeBy(discoveredConfigReferences, (reference) => normalizeCandidateUrl(reference.api)).length,
    configTraversalTruncated,
    extractedVodCandidates: vodCandidates.length,
    newVodProbeTargets: vodProbeTargets.length,
    vodProbation: vodProbes.filter((row) => row.recommendedTier === 'PROBATION').length,
    vodWatch: vodProbes.filter((row) => row.recommendedTier === 'WATCH').length,
    vodRejected: vodProbes.filter((row) => row.recommendedTier === 'REJECTED').length,
    liveDocuments: liveDocuments.length,
    liveShapeOk: liveDocuments.filter((row) => row.ok && row.channelCount >= 5).length,
    liveMediaTargets: liveMediaTargets.length,
    liveProbation: liveMedia.filter((row) => row.recommendedTier === 'PROBATION').length,
    liveWatch: liveMedia.filter((row) => row.recommendedTier === 'WATCH').length,
    liveRejected: liveMedia.filter((row) => row.recommendedTier === 'REJECTED').length,
  },
  entries,
  vodDocuments,
  vodCandidates: vodCandidates.map((candidate) => ({ ...candidate, alreadyInRegistry: isAlreadyRegistered(candidate) })),
  vodProbes,
  liveDocuments,
  liveMedia,
};

const auditDir = path.join(ROOT, 'audit');
await mkdir(auditDir, { recursive: true });
await writeFile(path.join(auditDir, 'tvapp-candidate-admission-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

const md = [];
md.push('# TVAPP 候选源准入审计');
md.push('');
md.push(`生成时间：${generatedAt}`);
md.push('');
md.push('## 摘要');
md.push(`- README 源区 URL：${report.counts.readmeSourceUrls} 个；点播入口 ${report.counts.vodIndexUrls} 个；直播入口 ${report.counts.liveUrls} 个。`);
md.push(`- 点播抽取候选：${report.counts.extractedVodCandidates} 个；新增 CMS 探测：${report.counts.newVodProbeTargets} 个；PROBATION ${report.counts.vodProbation}、WATCH ${report.counts.vodWatch}、REJECTED ${report.counts.vodRejected}。`);
md.push(`- 直播清单可解析：${report.counts.liveShapeOk} 个；首包抽样：${report.counts.liveMediaTargets} 个；PROBATION ${report.counts.liveProbation}、WATCH ${report.counts.liveWatch}、REJECTED ${report.counts.liveRejected}。`);
md.push('');
md.push('## 点播可继续观察');
for (const row of vodProbes.filter((item) => item.recommendedTier !== 'REJECTED')) md.push(`- ${row.recommendedTier} | ${row.name} | ${row.api} | class=${row.categoryCount} list=${row.listCount} search=${row.searchCount} detail=${row.detailOk} play=${row.playOk}`);
md.push('');
md.push('## 直播可继续观察');
for (const row of liveMedia.filter((item) => item.recommendedTier !== 'REJECTED')) md.push(`- ${row.recommendedTier} | ${row.name} | ${row.api} | channels=${row.channelCount} groups=${row.groupCount} playable=${row.playableCount}/${row.sampleCount}`);
md.push('');
md.push('## 边界');
md.push('- 本审计只输出候选分级，不修改正式源注册表。');
md.push('- 多仓、多线路、JS/PY/Spider/APP 内置源仅作为发现入口，不直接发布。');
md.push('- 直播清单通过不等于频道全部可播，仍需多轮稳定性验证。');
await writeFile(path.join(auditDir, 'tvapp-candidate-admission-summary.md'), md.join('\n') + '\n', 'utf8');

console.log(JSON.stringify(report.counts, null, 2));
for (const row of [...vodProbes, ...liveMedia]) {
  console.log(`${row.recommendedTier}\t${row.kind}\t${row.name}\t${row.api}`);
}
