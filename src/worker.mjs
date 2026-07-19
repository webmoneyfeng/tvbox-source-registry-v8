import {
  emptyHealthState,
  normalizeHealthState,
  sourceHealthKey,
  updateHealthState,
  visibleSources,
} from './health.mjs';
import {
  LIVE_SOURCE_REGISTRY,
  REGISTRY_VERSION,
  SOURCE_REGISTRY,
  candidateToRegistrySource,
  mergeRegistries,
  sourceDisplayName,
  tvSite,
} from './registry.mjs';
import { dedupeCandidates, extractCandidates } from './discovery.mjs';
import { channelSample, liveContract, normalizeLiveUrl, parseM3U } from './live.mjs';
import { scoreLiveProbe, scoreVodProbe } from './scoring.mjs';

const VERSION = 'tvbox-source-registry-v8.1.0';
const HEALTH_KEY = 'registry:health:v2';
const PROBE_TIMEOUT_MS = 4500;
const MAX_PROBE_SOURCES = 5;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const PERSIST_HEARTBEAT_MS = 30 * 60 * 1000;
const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SEARCH_TERMS = ['\u5929\u9053', '\u4eae\u5251', '\u7535\u5f71', '\u7535\u89c6\u5267', '\u52a8\u4f5c'];
const DISCOVERY_FEEDS = [
  'https://raw.githubusercontent.com/liu673cn/box/main/m.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json',
  'https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u',
  'https://live.zbds.org/tv/iptv4.m3u',
  'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',
  'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u',
];
const UA = 'tvbox-source-registry-v8.1-health/1.0';

function responseJson(value, status = 200, maxAge = 60, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${maxAge}`,
    'access-control-allow-origin': '*',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(value), { status, headers });
}

function responseText(value, status = 200, maxAge = 60, contentType = 'text/plain; charset=utf-8') {
  return new Response(value, { status, headers: { 'content-type': contentType, 'cache-control': `public, max-age=${maxAge}` } });
}

function kvBinding(env) {
  return env?.SOURCE_HEALTH && typeof env.SOURCE_HEALTH.get === 'function' ? env.SOURCE_HEALTH : null;
}

async function readHealth(env) {
  const kv = kvBinding(env);
  if (!kv) return emptyHealthState();
  try {
    return normalizeHealthState(await kv.get(HEALTH_KEY, 'json'));
  } catch {
    return emptyHealthState();
  }
}

async function writeHealth(env, state) {
  const kv = kvBinding(env);
  if (!kv) return false;
  await kv.put(HEALTH_KEY, JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 14 });
  return true;
}

async function readTextLimited(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const value = await response.text();
    return { text: value.slice(0, maxBytes), truncated: value.length > maxBytes };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  let truncated = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        const allowed = Math.max(0, maxBytes - (total - part.value.byteLength));
        text += decoder.decode(part.value.slice(0, allowed), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return { text, truncated };
}

function sourceUrl(source, params = {}) {
  const url = new URL(source.api);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchDocument(url, maxBytes = MAX_BODY_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { accept: 'application/json,text/plain,*/*', 'user-agent': UA }, redirect: 'follow', signal: controller.signal });
    const body = await readTextLimited(response, maxBytes);
    return { ok: response.ok && !body.truncated, status: response.status, text: body.text, truncated: body.truncated, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(source, params) {
  const result = await fetchDocument(sourceUrl(source, params));
  let data = null;
  try { data = JSON.parse(result.text.replace(/^\uFEFF/u, '').trim()); } catch {}
  return { ...result, data, ok: Boolean(result.ok && data && typeof data === 'object') };
}

function rowsOf(data) {
  const list = data?.list ?? data?.data?.list ?? data?.data ?? [];
  return Array.isArray(list) ? list : [];
}

function classesOf(data) {
  const values = data?.class ?? data?.classes ?? data?.data?.class ?? [];
  return Array.isArray(values) ? values : [];
}

function firstPlayable(row) {
  const value = [row?.vod_play_url, row?.url, row?.vod_url].filter(Boolean).join(' ');
  return /https?:\/\/[^\s$#|]+(?:m3u8|mp4|\.ts)(?:\?[^\s$|]*)?/iu.test(value);
}

function latestSourceTime(rows) {
  let latest = 0;
  for (const row of rows || []) {
    const value = row?.vod_time || row?.vod_time_add || row?.vod_pubdate || '';
    const parsed = Date.parse(String(value).replace(/\//gu, '-'));
    if (Number.isFinite(parsed)) latest = Math.max(latest, parsed);
  }
  return latest ? new Date(latest).toISOString() : null;
}

export async function probeVodSource(source) {
  const started = Date.now();
  try {
    const listing = await fetchJson(source, { ac: 'videolist', pg: 1 });
    const listingRows = rowsOf(listing.data);
    const classes = classesOf(listing.data);
    const evidence = [];
    let sample = listingRows[0] || null;
    for (const term of SEARCH_TERMS.slice(0, 3)) {
      const search = await fetchJson(source, { wd: term, pg: 1 });
      const rows = rowsOf(search.data);
      evidence.push({ term, ok: Boolean(search.ok && rows.length), count: rows.length });
      if (!sample && rows[0]) sample = rows[0];
      if (sample && evidence.filter((item) => item.ok).length >= 2) break;
    }
    const detail = sample?.vod_id ? await fetchJson(source, { ac: 'detail', ids: sample.vod_id }) : null;
    const detailRow = rowsOf(detail?.data)[0] || detail?.data?.data?.[0] || null;
    const detailOk = Boolean(detail?.ok && detailRow);
    const playOk = Boolean(detailOk && firstPlayable(detailRow));
    const searchOk = evidence.some((item) => item.ok);
    const ok = Boolean(listing.ok && (classes.length > 0 || listingRows.length > 0) && searchOk && detailOk && playOk);
    const probe = {
      kind: 'vod', slug: source.slug, ok, httpStatus: listing.status || detail?.status || 0,
      classCount: classes.length, listCount: listingRows.length, searchEvidence: evidence,
      searchCount: evidence.reduce((sum, item) => sum + item.count, 0), detailOk, playOk,
      latestAt: latestSourceTime(listingRows), latencyMs: Date.now() - started, error: ok ? '' : 'vod contract failed',
    };
    return { ...probe, score: scoreVodProbe(probe) };
  } catch (error) {
    return { kind: 'vod', slug: source.slug, ok: false, httpStatus: 0, classCount: 0, listCount: 0, searchEvidence: [], searchCount: 0, detailOk: false, playOk: false, latencyMs: Date.now() - started, error: String(error?.message || error).slice(0, 240) };
  }
}

async function probeMediaUrl(url) {
  const normalized = normalizeLiveUrl(url);
  if (!normalized) return { ok: false, status: 0 };
  try {
    const result = await fetchDocument(normalized, 96 * 1024);
    const contentType = result.text.slice(0, 256).includes('#EXTM3U') || /mpegurl|video\//iu.test(result.text.slice(0, 256));
    return { ok: Boolean(result.status >= 200 && result.status < 400 && contentType), status: result.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function probeLiveSource(source) {
  const started = Date.now();
  try {
    const document = await fetchDocument(source.api, MAX_PLAYLIST_BYTES);
    const contract = liveContract(document.text);
    const parsed = parseM3U(document.text);
    const samples = channelSample(parsed.channels, 4);
    const mediaResults = [];
    for (const channel of samples) mediaResults.push(await probeMediaUrl(channel.url));
    const playable = mediaResults.filter((item) => item.ok).length;
    const ok = Boolean(document.ok && contract.ok && playable >= Math.min(2, samples.length));
    const probe = {
      kind: 'live', slug: source.slug, ok, httpStatus: document.status, channelCount: contract.channelCount,
      groupCount: contract.groupCount, duplicateRate: contract.duplicateRate, playableCount: playable,
      sampleCount: samples.length, channels: ok ? parsed.channels.slice(0, 800) : [],
      latencyMs: Date.now() - started, error: ok ? '' : 'live playlist or channel contract failed',
    };
    return { ...probe, score: scoreLiveProbe(probe) };
  } catch (error) {
    return { kind: 'live', slug: source.slug, ok: false, httpStatus: 0, channelCount: 0, groupCount: 0, duplicateRate: 1, playableCount: 0, sampleCount: 0, channels: [], latencyMs: Date.now() - started, error: String(error?.message || error).slice(0, 240) };
  }
}

export async function probeSource(source) {
  return source.kind === 'live' ? probeLiveSource(source) : probeVodSource(source);
}

async function mapWithConcurrency(items, limit, callback) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await callback(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function discoveredRegistry(state) {
  const candidates = dedupeCandidates(state.discoveredSources || []);
  return candidates.map((candidate, index) => candidateToRegistrySource(candidate, index));
}

function allRegistry(state) {
  const base = [...SOURCE_REGISTRY, ...LIVE_SOURCE_REGISTRY];
  const baseKeys = new Set(base.map((source) => `${source.kind}:${source.physicalKey}`));
  const dynamic = discoveredRegistry(state).filter((source) => !baseKeys.has(`${source.kind}:${source.physicalKey}`));
  return mergeRegistries(base, dynamic);
}

function kindRegistry(registry, kind) {
  return registry.filter((source) => source.kind === kind);
}

function publishedFor(registry, state, kind) {
  const sources = kindRegistry(registry, kind);
  const visible = visibleSources(sources, state);
  if (visible.length) return visible;
  const lastKeys = kind === 'live' ? state.lastKnownGoodLIVE : state.lastKnownGoodVOD;
  if (lastKeys.length) return sources.filter((source) => lastKeys.includes(sourceHealthKey(source)));
  if (!Object.keys(state.sources || {}).length) return sources.filter((source) => source.seedStatus === 'ACTIVE');
  return [];
}

function sourceNameMap(registry) {
  const map = new Map();
  for (const kind of ['vod', 'live']) {
    kindRegistry(registry, kind).forEach((source, index) => map.set(sourceHealthKey(source), sourceDisplayName(source, index)));
  }
  return map;
}

function buildLiveText(channels = []) {
  const lines = ['#EXTM3U'];
  for (const channel of channels) {
    const name = String(channel.name || '').replace(/[\r\n,]/gu, ' ').trim();
    const group = String(channel.group || '\u5176\u4ed6').replace(/[\r\n,]/gu, ' ').trim();
    const url = normalizeLiveUrl(channel.url);
    if (!name || !url) continue;
    lines.push(`#EXTINF:-1 group-title="${group}",${name}`);
    lines.push(url);
  }
  return lines.join('\n') + '\n';
}

function effectiveSources(registry, state) {
  const kind = registry[0]?.kind || 'vod';
  const sources = publishedFor(registry, normalizeHealthState(state), kind);
  return { sources, degraded: sources.length === 0 };
}

export function buildConfig(origin, state = emptyHealthState()) {
  const registry = allRegistry(state);
  const vod = publishedFor(registry, state, 'vod');
  const live = publishedFor(registry, state, 'live');
  const sites = vod.map((source, index) => tvSite(source, kindRegistry(registry, 'vod').indexOf(source), { quickSearch: index === 0 }));
  return {
    spider: '',
    wallPaper: '',
    sites,
    lives: state.liveCatalog.length && live.length ? [{ name: '\u76f4\u64ad\u9891\u9053', type: 0, url: origin + '/live.txt' }] : [],
    registry: {
      version: REGISTRY_VERSION,
      mode: 'validated-direct-source-registry',
      revision: state.revision,
      updatedAt: state.generatedAt,
      vodCount: vod.length,
      liveCount: live.length,
      liveChannelCount: state.liveCatalog.length,
      degraded: !vod.length || (LIVE_SOURCE_REGISTRY.length > 0 && !live.length),
      health: origin + '/status.json',
      policy: 'Full source set. Adult content is not filtered; scripts, parsers, ad pages and invalid media endpoints are excluded.',
    },
  };
}

function publicSourceRows(registry, state) {
  const nameMap = sourceNameMap(registry);
  return registry.map((source) => {
    const key = sourceHealthKey(source);
    const row = state.sources[key] || state.sources[source.slug] || null;
    return {
      kind: source.kind,
      slug: source.slug,
      key: source.key,
      name: nameMap.get(key) || source.slug,
      seedStatus: source.seedStatus,
      visible: visibleSources([source], state).length > 0,
      physicalSource: source.physicalKey,
      api: source.api,
      health: row,
    };
  });
}

function selectionBatch(registry, state) {
  if (!registry.length) return [];
  return [...registry].sort((a, b) => {
    const aChecked = Date.parse((state.sources[sourceHealthKey(a)] || {}).checkedAt || '') || 0;
    const bChecked = Date.parse((state.sources[sourceHealthKey(b)] || {}).checkedAt || '') || 0;
    if (aChecked !== bChecked) return aChecked - bChecked;
    return b.priority - a.priority;
  }).slice(0, MAX_PROBE_SOURCES);
}

async function discoverOne(state) {
  const last = Date.parse(state.lastDiscoveryAt || '');
  const now = Date.now();
  if (Number.isFinite(last) && now - last < DISCOVERY_INTERVAL_MS) return { state, discovered: 0 };
  const index = Number(state.discoveryCursor || 0) % DISCOVERY_FEEDS.length;
  const feed = DISCOVERY_FEEDS[index];
  const document = await fetchDocument(feed, MAX_PLAYLIST_BYTES);
  let payload = document.text;
  if (!/^\s*#EXTM3U/iu.test(payload)) {
    try { payload = JSON.parse(payload.replace(/^\uFEFF/u, '').trim()); } catch { payload = null; }
  }
  const candidates = dedupeCandidates(extractCandidates(payload, feed));
  const existing = dedupeCandidates(state.discoveredSources || []);
  const merged = dedupeCandidates([...existing, ...candidates]).slice(0, 100);
  return {
    state: { ...state, discoveredSources: merged, discoveryCursor: (index + 1) % DISCOVERY_FEEDS.length, lastDiscoveryAt: new Date(now).toISOString() },
    discovered: Math.max(0, merged.length - existing.length),
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function scheduled(env) {
  const previous = await readHealth(env);
  let discovery = { state: previous, discovered: 0 };
  try { discovery = await discoverOne(previous); } catch {}
  const stateForProbe = discovery.state;
  const registry = allRegistry(stateForProbe);
  const batch = selectionBatch(registry, stateForProbe);
  const checkedAt = new Date().toISOString();
  const rows = await mapWithConcurrency(batch, 4, probeSource);
  const next = updateHealthState(registry, stateForProbe, rows, checkedAt);
  next.lastKnownGoodVOD = stateForProbe.lastKnownGoodVOD || [];
  next.lastKnownGoodLIVE = stateForProbe.lastKnownGoodLIVE || [];
  next.liveCatalog = stateForProbe.liveCatalog || [];
  next.cursor = (Number(stateForProbe.cursor || 0) + Math.max(1, batch.length)) % Math.max(1, registry.length);
  next.discoveryCursor = stateForProbe.discoveryCursor || 0;
  next.lastDiscoveryAt = stateForProbe.lastDiscoveryAt || null;
  next.discoveredSources = stateForProbe.discoveredSources || [];

  const vod = publishedFor(registry, next, 'vod');
  const live = publishedFor(registry, next, 'live');
  if (vod.length) next.lastKnownGoodVOD = vod.map(sourceHealthKey);
  if (live.length) next.lastKnownGoodLIVE = live.map(sourceHealthKey);
  const liveRows = rows.filter((row) => row.kind === 'live' && row.ok && row.channels?.length);
  if (liveRows.length) {
    const merged = new Map();
    for (const row of liveRows) for (const channel of row.channels) merged.set(`${channel.name.toLowerCase()}|${channel.url}`, channel);
    next.liveCatalog = [...merged.values()].slice(0, 2000);
  }
  next.generatedAt = checkedAt;
  next.discoveryCount = discovery.discovered;
  const previousState = normalizeHealthState(previous);
  const statusChanged = !sameJson(previousState.sources, next.sources)
    || previousState.revision !== next.revision
    || !sameJson(previousState.lastKnownGoodLIVE, next.lastKnownGoodLIVE)
    || !sameJson(previousState.lastKnownGoodVOD, next.lastKnownGoodVOD)
    || !sameJson(previousState.liveCatalog, next.liveCatalog)
    || !sameJson(previousState.discoveredSources, next.discoveredSources);
  const lastPersisted = Date.parse(previousState.persistedAt || '');
  const heartbeatDue = !Number.isFinite(lastPersisted) || nowMs() - lastPersisted >= PERSIST_HEARTBEAT_MS;
  if (statusChanged || heartbeatDue || discovery.discovered > 0) {
    next.persistedAt = checkedAt;
    await writeHealth(env, next);
  }
  return { ok: true, checkedAt, batch: batch.map((source) => sourceHealthKey(source)), discovery: discovery.discovered, revision: next.revision };
}

function nowMs() { return Date.now(); }

async function config(request, env) {
  const state = await readHealth(env);
  const origin = new URL(request.url).origin;
  const payload = buildConfig(origin, state);
  const etag = `"${state.revision}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'public, max-age=60' } });
  return responseJson(payload, 200, 60, { etag });
}

async function status(request, env) {
  const state = await readHealth(env);
  const registry = allRegistry(state);
  const vod = publishedFor(registry, state, 'vod');
  const live = publishedFor(registry, state, 'live');
  return responseJson({
    ok: true, version: VERSION, registryVersion: REGISTRY_VERSION, checkedAt: state.generatedAt,
    persistedAt: state.persistedAt, revision: state.revision, degraded: !vod.length || !live.length,
    configUrl: new URL('/config.json', request.url).toString(),
    vod: { registered: kindRegistry(registry, 'vod').length, visible: vod.length, target: '8-12' },
    live: { registered: kindRegistry(registry, 'live').length, visible: live.length, channels: state.liveCatalog.length, target: '3+' },
    discovery: { lastAt: state.lastDiscoveryAt, candidates: state.discoveredSources.length },
    policy: 'Direct source registry only; no video proxy, no full catalogue snapshot, no adult filtering.',
    sources: publicSourceRows(registry, state),
  }, 200, 30);
}

async function sourceStatus(request, env) {
  const state = await readHealth(env);
  const registry = allRegistry(state);
  return responseJson({ ok: true, version: VERSION, registryVersion: REGISTRY_VERSION, ...state, sources: publicSourceRows(registry, state) }, 200, 30);
}

function root(request) {
  const origin = new URL(request.url).origin;
  return responseText(['TVBox Source Registry v8.1', 'Config: ' + origin + '/config.json', 'Live: ' + origin + '/live.txt', 'Status: ' + origin + '/status.json', 'Sources: ' + origin + '/sources.json'].join('\n') + '\n', 200, 300);
}

export default {
  async scheduled(_event, env) {
    await scheduled(env);
  },
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return responseText('', 204, 86400);
      if (url.pathname === '/config.json' || url.pathname === '/config') return config(request, env);
      if (url.pathname === '/live.txt' || url.pathname === '/live') {
        const state = await readHealth(env);
        return responseText(buildLiveText(state.liveCatalog), 200, 300, 'audio/x-mpegurl; charset=utf-8');
      }
      if (url.pathname === '/status.json' || url.pathname === '/status') return status(request, env);
      if (url.pathname === '/sources.json' || url.pathname === '/sources' || url.pathname === '/health') return sourceStatus(request, env);
      return root(request);
    } catch (error) {
      return responseJson({ ok: false, version: VERSION, error: String(error?.message || error) }, 500, 0);
    }
  },
};

export {
  allRegistry,
  buildLiveText,
  effectiveSources,
  publishedFor,
  selectionBatch,
};
