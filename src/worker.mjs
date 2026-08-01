import {
  emptyHealthState,
  effectiveAdmissionTier,
  normalizeHealthState,
  sourceHealthKey,
  updateHealthState,
  verificationState,
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
import { dedupeCandidates, extractCandidates, isPublicHttpUrl, parseJsonLike } from './discovery.mjs';
import { channelSample, dedupeChannels, liveContract, normalizeLiveUrl, parseM3U } from './live.mjs';
import { scoreLiveProbe, scoreVodProbe } from './scoring.mjs';
import { decodeSourceBytes, encodingEvidence } from './encoding.mjs';
import { buildCategoryManifest, chooseCategoryManifest, visibleClassesFromManifest } from './native-category.mjs';

const VERSION = 'tvbox-source-registry-v8.2.4';
const REGISTRY_MODE = 'validated-direct-source-registry-v8.2';
const HEALTH_KEY = 'registry:health:v3';
const PROBE_TIMEOUT_MS = 8000;
const MAX_PROBE_SOURCES = 3;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 1;
const TARGET_VOD_SOURCES = 10;
const MIN_LIVE_SOURCES = 10;
const PERSIST_HEARTBEAT_MS = 30 * 60 * 1000;
const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DISCOVERY_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const MAX_DISCOVERY_FEEDS_PER_RUN = 3;
const MAX_CATEGORY_PROBES_PER_VOD_SOURCE = 12;
const SEARCH_TERMS = ['\u5929\u9053', '\u4eae\u5251', '\u7504\u5b1b\u4f20', '\u6d41\u6d6a\u5730\u7403', '\u54ea\u5412'];
const DISCOVERY_FEEDS = [
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/XYQ.json',
  'https://raw.githubusercontent.com/liu673cn/box/main/m.json',
  'https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json',
  'https://szyyds.cn/tv/x.json',
  'https://16409.kstore.vip/tv/ngzmods.json',
  'https://dxawi.github.io/0/0.json',
  'https://raw.liucn.cc/box/m.json',
  'https://raw.githubusercontent.com/yydfys/yydf/main/yydf/yydfjk.json',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/au.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/sg.m3u',
  'https://live.zbds.org/tv/iptv4.m3u',
  'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',
  'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u',
];
const UA = 'tvbox-source-registry-v8.2.3-health/1.0';

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
  return new Response(value, { status, headers: { 'content-type': contentType, 'cache-control': `public, max-age=${maxAge}`, 'access-control-allow-origin': '*' } });
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

async function readBytesLimited(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const value = new Uint8Array(await response.arrayBuffer());
    return { bytes: value.slice(0, maxBytes), truncated: value.byteLength > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        const allowed = Math.max(0, maxBytes - (total - part.value.byteLength));
        if (allowed) chunks.push(part.value.slice(0, allowed));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(part.value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function sourceUrl(source, params = {}) {
  const url = new URL(source.api);
  if (!Object.prototype.hasOwnProperty.call(params, 'ac') && Object.keys(params).some((key) => ['wd', 't', 'ids', 'pg'].includes(key))) url.searchParams.delete('ac');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchDocument(url, maxBytes = MAX_BODY_BYTES) {
  let currentUrl = String(url);
  const started = Date.now();
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isPublicHttpUrl(currentUrl)) return { ok: false, status: 0, text: '', truncated: false, latencyMs: Date.now() - started, hardViolation: true, error: 'unsafe public redirect target' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(currentUrl, { headers: { accept: 'application/json,text/plain,*/*', 'user-agent': UA }, redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) return { ok: false, status: response.status, text: '', truncated: false, latencyMs: Date.now() - started, hardViolation: true, error: 'redirect chain exceeded safety limit' };
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      const body = await readBytesLimited(response, maxBytes);
      const decoded = decodeSourceBytes(body.bytes, contentType);
      return {
        ok: response.ok && !body.truncated,
        status: response.status,
        text: decoded.text,
        bytes: body.bytes,
        truncated: body.truncated,
        latencyMs: Date.now() - started,
        contentType,
        finalUrl: currentUrl,
        encoding: encodingEvidence(decoded),
        hardViolation: false,
        error: '',
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, text: '', truncated: false, latencyMs: Date.now() - started, hardViolation: true, error: 'redirect chain exceeded safety limit' };
}

async function fetchJson(source, params) {
  return fetchJsonUrl(sourceUrl(source, params));
}

async function fetchJsonUrl(url) {
  const result = await fetchDocument(url);
  let data = null;
  try { data = JSON.parse(result.text.replace(/^\uFEFF/u, '').trim()); } catch {}
  return { ...result, data, ok: Boolean(result.ok && data && typeof data === 'object') };
}

function sourceRequestUrl(source, requestUrl) {
  const upstream = new URL(source.api);
  const incoming = new URL(requestUrl);
  for (const key of new Set(incoming.searchParams.keys())) upstream.searchParams.delete(key);
  for (const [key, value] of incoming.searchParams) upstream.searchParams.append(key, value);
  return upstream.toString();
}

function hardDocumentViolation(document) {
  if (document?.hardViolation) return true;
  const preview = String(document?.text || '').slice(0, 4096);
  const infrastructurePollution = /(?:\u5e7f\u544a|\u516c\u4f17\u53f7|\u52a0\u7fa4|\u53d1\u5e03\u9875|\u89e3\u6790)/iu.test(preview);
  return /<iframe\b/iu.test(preview)
    || (infrastructurePollution && !document?.data);
}

function rowsOf(data) {
  const list = data?.list ?? data?.data?.list ?? data?.data ?? [];
  return Array.isArray(list) ? list : [];
}

function classesOf(data) {
  const values = data?.class ?? data?.classes ?? data?.data?.class ?? [];
  return Array.isArray(values) ? values : [];
}

function classId(value) {
  return String(value?.type_id ?? value?.id ?? value?.typeId ?? '').trim();
}

function className(value) {
  return String(value?.type_name ?? value?.name ?? value?.typeName ?? '').trim();
}

function nativeFilterInfo(data) {
  const raw = data?.filters ?? data?.data?.filters ?? {};
  const entries = Array.isArray(raw) ? raw.map((item, index) => [String(index), item]) : Object.entries(raw || {});
  const filters = entries.map(([categoryId, value]) => {
    const rows = Array.isArray(value) ? value : Array.isArray(value?.value) ? value.value : [];
    const keys = rows.map((item) => String(item?.key ?? item?.value ?? item?.name ?? item ?? '').trim()).filter(Boolean);
    const names = rows.map((item) => String(item?.name ?? item?.value ?? item ?? '').trim()).filter(Boolean);
    return { categoryId, optionCount: new Set(keys).size, keys, names };
  }).filter((item) => item.optionCount > 0);
  const nativeFilterKeys = [...new Set(filters.flatMap((item) => item.keys))];
  const labels = filters.flatMap((item) => item.names).join(' ');
  const sortRaw = data?.sort ?? data?.sorts ?? data?.order ?? data?.data?.sort ?? data?.data?.sorts ?? {};
  const sortEntries = Array.isArray(sortRaw) ? sortRaw : Object.entries(sortRaw || {}).map(([key, value]) => ({ key, value }));
  const nativeSortKeys = sortEntries
    .flatMap((item) => [item?.key, item?.value, item?.name, item?.field, item?.type])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const sortable = nativeSortKeys.length > 0;
  return {
    filters,
    nativeFilterable: filters.some((item) => item.optionCount >= 2),
    nativeSortable: sortable,
    nativeFilterKeys,
    nativeSortKeys: [...new Set(nativeSortKeys)],
  };
}

function directMediaUrls(row) {
  const value = [row?.vod_play_url, row?.url, row?.vod_url, row?.vod_down_url].filter(Boolean).join(' ');
  const matches = value.match(/https?:\/\/[^\s$#|"'<>]+(?:m3u8|mp4|\.ts)(?:\?[^\s$|"'<>]*)?/giu) || [];
  return [...new Set(matches.map((item) => item.replace(/[),.;]+$/u, '')))].filter((item) => !/(?:player\.html|iframe|parse|jiexi)/iu.test(item));
}

function firstPlayableUrl(row) {
  return directMediaUrls(row)[0] || '';
}

function firstPlayable(row) {
  return Boolean(firstPlayableUrl(row));
}

function playBranchContract(row) {
  const groups = String(row?.vod_play_url || '').split('$$$').filter((value) => String(value).trim());
  const branches = groups.map((group) => {
    const entries = group.split('#').map((value) => String(value).split('$').pop().trim()).filter(Boolean);
    const direct = entries.filter((value) => /https?:\/\/[^\s]+(?:m3u8|mp4|\.ts)(?:\?|$)/iu.test(value) && !/(?:player\.html|iframe|parse|jiexi)/iu.test(value));
    return { entryCount: entries.length, directCount: direct.length };
  });
  return {
    branchCount: branches.length,
    directBranchCount: branches.filter((branch) => branch.directCount > 0).length,
    invalidBranchCount: branches.filter((branch) => branch.directCount === 0).length,
  };
}

function likelyLeafCategory(value) {
  return !/(?:^\u7535\u5f71$|^\u7535\u5f71\u7247$|^\u8fde\u7eed\u5267$|^\u7535\u89c6\u5267$|^\u7efc\u827a$|^\u7efc\u827a\u7247$|^\u52a8\u6f2b$|^\u52a8\u6f2b\u7247$|^\u8d44\u8baf$|^\u4f53\u80b2(?:\u8d5b\u4e8b)?$|^\u7eaa\u5f55\u7247?$)/iu.test(String(value || '').trim());
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

export async function probeNativeCategories(source, classes, previousManifest = null, existingChecks = [], upstreamListing = null) {
  const probes = new Map();
  for (const item of previousManifest?.rows || []) {
    const probe = {
      ok: item.probe?.ok,
      count: item.probe?.count,
      total: item.probe?.total,
      status: item.probe?.status,
      error: item.probe?.error,
    };
    if (probe.ok || Number(probe.status) > 0 || probe.error) probes.set(item.id, probe);
  }
  for (const [id, probe] of existingChecks.map((item) => [item.id, {
    ok: item.ok,
    count: item.count,
    total: item.total,
    status: item.status,
    error: item.error,
  }])) probes.set(id, probe);
  const total = (classes || []).length;
  const start = total ? Number(previousManifest?.probeCursor || 0) % total : 0;
  const targets = total
    ? Array.from({ length: Math.min(MAX_CATEGORY_PROBES_PER_VOD_SOURCE, total) }, (_, offset) => classes[(start + offset) % total])
    : [];
  const missing = targets.filter((category) => !probes.has(classId(category)));
  const results = await mapWithConcurrency(missing, 4, async (category) => {
    const id = classId(category);
    const result = await fetchJson(source, { ac: 'videolist', t: id, pg: 1 });
    const rows = rowsOf(result.data);
    return [id, {
      ok: Boolean(result.ok && rows.length),
      count: rows.length,
      total: Number(result.data?.total || rows.length),
      status: result.status,
      error: result.error || '',
    }];
  });
  for (const [id, probe] of results) probes.set(id, probe);
  const current = buildCategoryManifest(classes, probes, new Date().toISOString(), upstreamListing);
  const nextProbeIndex = total ? (start + targets.length) % total : 0;
  const enriched = {
    ...current,
    probeCursor: nextProbeIndex,
    probedCount: current.rows.filter((row) => row.probe.ok || row.probe.status > 0).length,
  };
  return chooseCategoryManifest(enriched, previousManifest);
}

export async function probeVodSource(source, previousHealth = null) {
  const started = Date.now();
  try {
    const classListing = await fetchJson(source, { ac: 'list' });
    const listing = await fetchJson(source, { ac: 'videolist', pg: 1 });
    const listingRows = rowsOf(listing.data);
    const classes = classesOf(classListing.data);
    const native = nativeFilterInfo(classListing.data || listing.data || {});
    const sampledClasses = classes.length <= 5
      ? classes
      : [...new Map([classes[0], classes[Math.floor(classes.length / 2)], classes[classes.length - 1]].map((item) => [classId(item), item])).values()];
    const categoryChecks = await mapWithConcurrency(sampledClasses, 3, async (category) => {
      const id = classId(category);
      const result = await fetchJson(source, { ac: 'videolist', t: id, pg: 1 });
      const rows = rowsOf(result.data);
      const transient = [408, 425, 429, 500, 502, 503, 504].includes(result.status) || !result.status;
      return {
        id,
        name: className(category),
        ok: Boolean(result.ok && rows.length),
        count: rows.length,
        status: result.status,
        transient,
        latestAt: latestSourceTime(rows),
        error: result.error || '',
      };
    });
    const nativeCategoryManifest = await probeNativeCategories(
      source,
      classes,
      previousHealth?.nativeCategoryManifest || null,
      categoryChecks,
      classListing.data,
    );
    const evidence = [];
    const searchResults = [];
    let sample = listingRows[0] || null;
    for (const term of SEARCH_TERMS.slice(0, 3)) {
      const search = await fetchJson(source, { wd: term, pg: 1 });
      searchResults.push(search);
      const rows = rowsOf(search.data);
      evidence.push({ term, ok: Boolean(search.ok && rows.length), count: rows.length });
      if (!sample && rows[0]) sample = rows[0];
    }
    const sampleId = sample?.vod_id ?? sample?.id ?? sample?.vod_id_str;
    const detail = sampleId ? await fetchJson(source, { ac: 'detail', ids: sampleId }) : null;
    const detailRow = rowsOf(detail?.data)[0] || detail?.data?.data?.[0] || null;
    const detailOk = Boolean(detail?.ok && detailRow);
    const playableUrl = detailOk ? firstPlayableUrl(detailRow) : '';
    const mediaCheck = playableUrl ? await probeMediaUrl(playableUrl) : { ok: false, status: 0, latencyMs: null, hardViolation: false, text: '' };
    const playOk = Boolean(detailOk && mediaCheck.ok);
    const playContract = playBranchContract(detailRow);
    const transientCategoryErrors = categoryChecks.filter((item) => !item.ok && item.transient);
    const hardFailures = [];
    const softWarnings = [];
    if (!classListing.ok || !classes.length) hardFailures.push('CATEGORY_SCHEMA_UNAVAILABLE');
    if (!listing.ok || !listingRows.length) hardFailures.push('LISTING_UNAVAILABLE');
    if (!evidence.some((item) => item.ok)) hardFailures.push('SEARCH_UNAVAILABLE');
    if (!detailOk) hardFailures.push('DETAIL_UNAVAILABLE');
    if (!playOk || !playContract.branchCount || playContract.invalidBranchCount > 0) hardFailures.push('DIRECT_PLAYBACK_UNAVAILABLE');
    const hardViolation = [classListing, listing, ...searchResults, detail, mediaCheck].some(hardDocumentViolation);
    if (hardViolation) hardFailures.push('AD_OR_PARSE_CONTENT');
    const emptyCategoryCount = categoryChecks.filter((item) => !item.ok && !item.transient).length;
    if (emptyCategoryCount) softWarnings.push(`EMPTY_NATIVE_CATEGORY:${emptyCategoryCount}`);
    if (transientCategoryErrors.length) softWarnings.push(`TRANSIENT_CATEGORY_ERROR:${transientCategoryErrors.length}`);
    const latestAt = latestSourceTime(listingRows);
    const latestAgeHours = latestAt ? Math.max(0, (Date.now() - Date.parse(latestAt)) / 3600000) : null;
    if (latestAgeHours === null) softWarnings.push('FRESHNESS_UNKNOWN');
    else if (latestAgeHours > 72) softWarnings.push('STALE_CONTENT');
    if (Date.now() - started > 9000) softWarnings.push('SLOW_SOURCE');
    const ok = hardFailures.length === 0;
    const admissionTier = ok && softWarnings.length ? 'WATCH' : ok ? 'ACTIVE' : 'REJECTED';
    const probe = {
      kind: 'vod', slug: source.slug, ok, admissionTier, hardFailure: hardFailures.length > 0, hardFailures, softWarnings, hardViolation,
      httpStatus: listing.status || detail?.status || 0,
      classCount: classes.length, categoryCount: classes.length, categoryOkCount: categoryChecks.filter((item) => item.ok).length, categoryChecks,
      nativeCategoryManifest,
      listCount: listingRows.length, searchEvidence: evidence,
      searchCount: evidence.reduce((sum, item) => sum + item.count, 0), detailOk, playOk,
      playBranchCount: playContract.branchCount, directBranchCount: playContract.directBranchCount, invalidBranchCount: playContract.invalidBranchCount,
      mediaLatencyMs: mediaCheck.latencyMs, mediaStatus: mediaCheck.status,
      latestAt, latestAgeHours, latencyMs: Date.now() - started,
      nativeFilterable: native.nativeFilterable,
      nativeSortable: native.nativeSortable,
      nativeFilterKeys: native.nativeFilterKeys,
      nativeSortKeys: native.nativeSortKeys,
      emptyCategoryCount,
      searchCapability: evidence.some((item) => item.ok),
      detailCapability: detailOk,
      directPlaybackEligible: playOk && playContract.invalidBranchCount === 0,
      playableRate: playOk ? 1 : 0,
      encoding: classListing.encoding || listing.encoding || detail?.encoding || null,
      rootCauses: [...hardFailures, ...softWarnings],
      evidence: {
        classListing: { status: classListing.status, encoding: classListing.encoding || null },
        listing: { status: listing.status, encoding: listing.encoding || null },
        search: evidence,
        detail: { status: detail?.status || 0, encoding: detail?.encoding || null },
        media: { status: mediaCheck.status, latencyMs: mediaCheck.latencyMs },
      },
      error: hardFailures.join('; '),
    };
    return { ...probe, score: scoreVodProbe(probe) };
  } catch (error) {
    return {
      kind: 'vod', slug: source.slug, ok: false, admissionTier: 'REJECTED', hardFailure: true,
      hardFailures: ['PROBE_EXCEPTION'], softWarnings: [], hardViolation: false, httpStatus: 0,
      classCount: 0, categoryCount: 0, categoryOkCount: 0, categoryChecks: [], listCount: 0,
      searchEvidence: [], searchCount: 0, detailOk: false, playOk: false, directPlaybackEligible: false,
      nativeFilterable: false, nativeSortable: false, nativeFilterKeys: [], nativeSortKeys: [],
      emptyCategoryCount: 0, searchCapability: false, detailCapability: false, playableRate: 0,
      nativeCategoryManifest: previousHealth?.nativeCategoryManifest || null,
      encoding: null, rootCauses: ['PROBE_EXCEPTION'], evidence: {}, latencyMs: Date.now() - started,
      error: String(error?.message || error).slice(0, 240),
    };
  }
}

async function probeMediaUrl(url) {
  const normalized = normalizeLiveUrl(url);
  if (!normalized) return { ok: false, status: 0, latencyMs: null, hardViolation: false, text: '', contentType: '' };
  try {
    const result = await fetchDocument(normalized, 96 * 1024);
    const preview = result.text.slice(0, 512);
    const mediaContentType = /(?:mpegurl|vnd\.apple\.mpegurl|video\/|audio\/)/iu.test(result.contentType || '');
    const manifestBody = /^\s*#EXTM3U\b/iu.test(preview);
    const rejectedBody = /(?:<html\b|<iframe\b|player\.html|解析|广告|发布页|公众号|加群)/iu.test(preview);
    const directMedia = mediaContentType || manifestBody;
    return {
      ok: Boolean(result.status >= 200 && result.status < 400 && directMedia && !rejectedBody),
      status: result.status,
      latencyMs: result.latencyMs,
      hardViolation: Boolean(result.hardViolation || rejectedBody),
      text: result.text,
      contentType: result.contentType || '',
    };
  } catch {
    return { ok: false, status: 0, latencyMs: null, hardViolation: false, text: '', contentType: '' };
  }
}

function liveGroupSamples(channels, limit = 8) {
  const groups = new Map();
  for (const channel of channels) {
    const group = String(channel.group || '\u5176\u4ed6').trim() || '\u5176\u4ed6';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(channel);
  }
  const selected = [...groups.values()].map((rows) => rows[0]);
  if (selected.length >= limit) return selected.slice(0, limit);
  for (const channel of channelSample(channels, limit)) {
    if (!selected.some((item) => item.url === channel.url)) selected.push(channel);
    if (selected.length >= limit) break;
  }
  return selected;
}

function playlistHardViolation(document, parsed) {
  const preview = String(document?.text || '').slice(0, 4096);
  const pageLike = /(?:<html\b|<iframe\b|player\.html|解析页|发布页)/iu.test(preview);
  if (pageLike) return true;
  // A valid M3U may contain an infrastructure/ad line which parseM3U removes.
  // Do not reject the whole source when enough real channels remain.
  if (document?.hardViolation && Number(parsed?.channels?.length || 0) < 5) return true;
  return false;
}

export async function probeLiveSource(source) {
  const started = Date.now();
  try {
    const document = await fetchDocument(source.api, MAX_PLAYLIST_BYTES);
    const contract = liveContract(document.text);
    const parsed = parseM3U(document.text);
    const qualityFirst = parsed.channels.filter((channel) => /(?:4k|2160p?|uhd|1080p?|fhd|高清|超清|hd\b)/iu.test(`${channel.name} ${channel.group} ${channel.url}`));
    const samplePool = [...qualityFirst, ...parsed.channels.filter((channel) => !qualityFirst.includes(channel))];
    const samples = liveGroupSamples(samplePool, 8);
    const mediaResults = [];
    for (const channel of samples) mediaResults.push(await probeMediaUrl(channel.url));
    const playable = mediaResults.filter((item) => item.ok).length;
    const playlistViolation = playlistHardViolation(document, parsed);
    const invalidMediaCount = mediaResults.filter((item) => item.hardViolation).length;
    const hardViolation = Boolean(playlistViolation);
    const hardFailures = [];
    const softWarnings = [];
    if (!document.ok || !contract.ok || contract.channelCount < 5 || contract.groupCount < 1) hardFailures.push('LIVE_PLAYLIST_SCHEMA_UNAVAILABLE');
    if (playable < Math.min(2, samples.length)) hardFailures.push('LIVE_PLAYBACK_UNAVAILABLE');
    if (hardViolation) hardFailures.push('AD_OR_PARSE_CONTENT');
    if (invalidMediaCount) softWarnings.push(`AD_OR_PARSE_CHANNEL:${invalidMediaCount}`);
    const playableRate = samples.length ? playable / samples.length : 0;
    const qualityRate = playable ? mediaResults.filter((item) => item.ok && /(?:4k|2160p?|uhd|1080p?|fhd|hd\b)/iu.test(`${item.text || ''}`)).length / playable : 0;
    if (playableRate < 0.75) softWarnings.push('PARTIAL_CHANNEL_FAILURE');
    if (qualityRate < 0.5) softWarnings.push('HD_EVIDENCE_LOW');
    if (contract.duplicateRate > 0.35) softWarnings.push('DUPLICATE_RATE_HIGH');
    if (Date.now() - started > 9000) softWarnings.push('SLOW_SOURCE');
    const ok = hardFailures.length === 0;
    const admissionTier = ok && softWarnings.length ? 'WATCH' : ok ? 'ACTIVE' : 'REJECTED';
    const probe = {
      kind: 'live', slug: source.slug, ok, admissionTier, hardFailure: hardFailures.length > 0, hardFailures, softWarnings,
      httpStatus: document.status, channelCount: contract.channelCount,
      groupCount: contract.groupCount, duplicateRate: contract.duplicateRate, playableCount: playable,
      sampleCount: samples.length, channels: ok ? parsed.channels.slice(0, 800) : [],
      latencyMs: Date.now() - started, hardViolation, directPlaybackEligible: playable >= 2,
      playableRate, encoding: document.encoding || null, rootCauses: [...hardFailures, ...softWarnings],
      evidence: {
        playlist: { status: document.status, encoding: document.encoding || null, bytes: document.bytes?.byteLength || null },
        samples: mediaResults.map((item, index) => ({ index, status: item.status, ok: item.ok, latencyMs: item.latencyMs })),
      },
      error: hardFailures.join('; '),
    };
    return { ...probe, score: scoreLiveProbe(probe) };
  } catch (error) {
    return {
      kind: 'live', slug: source.slug, ok: false, admissionTier: 'REJECTED', hardFailure: true,
      hardFailures: ['PROBE_EXCEPTION'], softWarnings: [], hardViolation: false, httpStatus: 0,
      channelCount: 0, groupCount: 0, duplicateRate: 1, playableCount: 0, sampleCount: 0, channels: [],
      directPlaybackEligible: false, playableRate: 0, encoding: null, rootCauses: ['PROBE_EXCEPTION'], evidence: {},
      latencyMs: Date.now() - started, error: String(error?.message || error).slice(0, 240),
    };
  }
}

export async function probeSource(source, previousHealth = null) {
  return source.kind === 'live' ? probeLiveSource(source) : probeVodSource(source, previousHealth);
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
  return candidates.map((candidate) => candidateToRegistrySource(candidate));
}

function baseRegistryCandidateKeys() {
  return new Set([...SOURCE_REGISTRY, ...LIVE_SOURCE_REGISTRY].map((source) => `${source.kind}:${source.physicalKey}`));
}

function pruneDiscoveredCandidates(candidates = []) {
  const baseKeys = baseRegistryCandidateKeys();
  return dedupeCandidates(candidates).filter((candidate) => !baseKeys.has(`${candidate.kind}:${candidate.physicalKey}`));
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
  const knownGood = sources.filter((source) => {
    const key = sourceHealthKey(source);
    if (!lastKeys.includes(key) && !lastKeys.includes(source.slug)) return false;
    const row = state.sources[key] || state.sources[source.slug];
    return row?.admissionTier !== 'REJECTED'
      && !row?.hardFailure
      && Boolean(row?.lastSuccessAt || (row?.state === 'ACTIVE' && row?.ok === true));
  });
  if (knownGood.length) return knownGood;
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
  for (const channel of dedupeChannels(channels)) {
    const name = String(channel.name || '').replace(/[\r\n,]/gu, ' ').trim();
    const group = String(channel.group || '\u5176\u4ed6').replace(/[\r\n,]/gu, ' ').trim();
    const url = normalizeLiveUrl(channel.url);
    if (!name || !url) continue;
    lines.push(`#EXTINF:-1 group-title="${group}",${name}`);
    lines.push(url);
  }
  return lines.join('\n') + '\n';
}

async function liveText(request, env) {
  const state = await readHealth(env);
  const registry = allRegistry(state);
  const live = publishedFor(registry, state, 'live');
  const cache = globalThis.caches?.default;
  const cacheUrl = new URL('/live.txt', request.url);
  cacheUrl.searchParams.set('rev', state.revision || state.liveRevision || 'seed');
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {}
  }
  const response = responseText(
    buildLiveText(live.length ? state.liveCatalog : []),
    200,
    300,
    'audio/x-mpegurl; charset=utf-8',
  );
  if (cache) {
    try { await cache.put(cacheKey, response.clone()); } catch {}
  }
  return response;
}

function effectiveSources(registry, state) {
  const kind = registry[0]?.kind || 'vod';
  const sources = publishedFor(registry, normalizeHealthState(state), kind);
  return { sources, degraded: sources.length === 0 };
}

function sourceBySiteKey(registry, key) {
  return registry.find((source) => source.key === key || source.slug === key) || null;
}

function listWithVisibleClasses(upstreamData, manifest) {
  const visibleClasses = visibleClassesFromManifest(manifest);
  if (!visibleClasses.length) return upstreamData;
  return { ...upstreamData, class: visibleClasses };
}

async function sourceAdapter(request, env, sourceKey) {
  const state = await readHealth(env);
  const source = sourceBySiteKey(allRegistry(state), sourceKey);
  if (!source || source.kind !== 'vod') return responseJson({ ok: false, error: 'source not found' }, 404, 0);

  const input = new URL(request.url);
  const isClassListing = (input.searchParams.get('ac') || '').toLowerCase() === 'list';
  const row = state.sources[sourceHealthKey(source)] || state.sources[source.slug] || {};
  const manifest = row.nativeCategoryManifest;
  if (isClassListing && manifest?.visibleCount > 0) {
    return responseJson({
      ...(manifest.nativeListing || {}),
      class: visibleClassesFromManifest(manifest),
    }, 200, 60);
  }

  const upstream = await fetchJsonUrl(sourceRequestUrl(source, input.toString()));
  if (isClassListing && upstream.ok) {
    return responseJson(listWithVisibleClasses(upstream.data, manifest), upstream.status || 200, 60);
  }
  if (isClassListing && manifest?.visibleCount > 0) {
    return responseJson({ class: visibleClassesFromManifest(manifest) }, 200, 60);
  }
  if (upstream.ok) return responseJson(upstream.data, upstream.status || 200, 60);
  return responseJson({ code: upstream.status || 502, msg: upstream.error || 'upstream request failed', list: [] }, upstream.status || 502, 0);
}

export function buildConfig(origin, state = emptyHealthState()) {
  const registry = allRegistry(state);
  const vod = publishedFor(registry, state, 'vod');
  const live = publishedFor(registry, state, 'live');
  const sites = vod.map((source, index) => {
    const row = state.sources[sourceHealthKey(source)] || state.sources[source.slug] || null;
    return tvSite(source, kindRegistry(registry, 'vod').indexOf(source), {
      quickSearch: index === 0,
      health: row,
      api: `${origin}/source/${encodeURIComponent(source.key)}`,
    });
  });
  return {
    spider: '',
    wallPaper: '',
    sites,
    lives: live.map((source) => ({ name: sourceDisplayName(source, kindRegistry(registry, 'live').indexOf(source)), type: 0, url: source.api })),
    registry: {
      version: REGISTRY_VERSION,
      mode: REGISTRY_MODE,
      revision: state.revision,
      updatedAt: state.generatedAt,
      vodCount: vod.length,
      liveCount: live.length,
      liveChannelCount: state.liveCatalog.length,
      strictVodCount: vod.filter((source) => effectiveAdmissionTier(source, state.sources[sourceHealthKey(source)] || state.sources[source.slug]) === 'ACTIVE').length,
      watchVodCount: vod.filter((source) => effectiveAdmissionTier(source, state.sources[sourceHealthKey(source)] || state.sources[source.slug]) === 'WATCH').length,
      strictLiveCount: live.filter((source) => effectiveAdmissionTier(source, state.sources[sourceHealthKey(source)] || state.sources[source.slug]) === 'ACTIVE').length,
      watchLiveCount: live.filter((source) => effectiveAdmissionTier(source, state.sources[sourceHealthKey(source)] || state.sources[source.slug]) === 'WATCH').length,
      unprobedVodCount: vod.filter((source) => !state.sources[sourceHealthKey(source)] && !state.sources[source.slug]).length,
      unprobedLiveCount: live.filter((source) => !state.sources[sourceHealthKey(source)] && !state.sources[source.slug]).length,
      degraded: Object.keys(state.sources || {}).length === 0 || vod.length < TARGET_VOD_SOURCES || live.length < MIN_LIVE_SOURCES,
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
      provider: source.provider,
      qualityTier: source.qualityTier,
      seedStatus: source.seedStatus,
      admissionTier: effectiveAdmissionTier(source, row),
      verification: verificationState(source, row),
      visible: visibleSources([source], state).length > 0,
      physicalSource: source.physicalKey,
      api: source.api,
      native: {
        filterable: Boolean(row?.nativeFilterable || source.nativeFilterable),
        sortable: Boolean(row?.nativeSortable || source.nativeSortable),
        filterKeys: row?.nativeFilterKeys || source.nativeFilterKeys || [],
        sortKeys: row?.nativeSortKeys || source.nativeSortKeys || [],
      },
      rootCauses: row?.rootCauses || [],
      encoding: row?.encoding || null,
      health: row,
    };
  });
}

function selectionBatch(registry, state) {
  if (!registry.length) return [];
  const sorted = [...registry].sort((a, b) => {
    const aChecked = Date.parse((state.sources[sourceHealthKey(a)] || {}).checkedAt || '') || 0;
    const bChecked = Date.parse((state.sources[sourceHealthKey(b)] || {}).checkedAt || '') || 0;
    if (aChecked !== bChecked) return aChecked - bChecked;
    return b.priority - a.priority;
  });
  const output = [];
  for (const kind of ['vod', 'live']) {
    const source = sorted.find((item) => item.kind === kind && !output.includes(item));
    if (source) output.push(source);
  }
  for (const source of sorted) {
    if (output.length >= MAX_PROBE_SOURCES) break;
    if (!output.includes(source)) output.push(source);
  }
  return output;
}

async function discoverOne(state) {
  const last = Date.parse(state.lastDiscoveryAt || '');
  const now = Date.now();
  const interval = state.lastDiscoveryError ? DISCOVERY_RETRY_INTERVAL_MS : DISCOVERY_INTERVAL_MS;
  if (Number.isFinite(last) && now - last < interval) return { state, discovered: 0, attempts: 0 };

  const timestamp = new Date(now).toISOString();
  const existing = pruneDiscoveredCandidates(state.discoveredSources || []);
  let merged = existing;
  let cursor = Number(state.discoveryCursor || 0) % DISCOVERY_FEEDS.length;
  let supportedFeed = '';
  const errors = [];
  let attempts = 0;

  while (attempts < Math.min(MAX_DISCOVERY_FEEDS_PER_RUN, DISCOVERY_FEEDS.length)) {
    const index = cursor;
    const feed = DISCOVERY_FEEDS[index];
    cursor = (index + 1) % DISCOVERY_FEEDS.length;
    attempts += 1;

    let document;
    try {
      document = await fetchDocument(feed, MAX_PLAYLIST_BYTES);
    } catch (error) {
      errors.push(`${feed}: ${String(error?.message || error).slice(0, 120)}`);
      continue;
    }
    if (!document.ok) {
      errors.push(`${feed}: ${document.error || `feed status ${document.status}`}`);
      continue;
    }

    const payload = parseJsonLike(document.text);
    if (payload === null) {
      errors.push(`${feed}: feed is not a supported TVBox JSON or M3U document`);
      continue;
    }

    supportedFeed = feed;
    const candidates = pruneDiscoveredCandidates(extractCandidates(payload, feed));
    merged = dedupeCandidates([...merged, ...candidates]).slice(0, 100);
    if (candidates.length > 0) break;
  }

  const discovered = Math.max(0, merged.length - existing.length);
  if (supportedFeed) {
    return {
      state: {
        ...state,
        discoveredSources: merged,
        discoveryCursor: cursor,
        lastDiscoveryAt: timestamp,
        lastDiscoverySuccessAt: timestamp,
        lastDiscoveryFeed: supportedFeed,
        lastDiscoveryError: null,
      },
      discovered,
      attempts,
    };
  }

  return {
    state: {
      ...state,
      discoveryCursor: cursor,
      lastDiscoveryAt: timestamp,
      lastDiscoveryFeed: attempts ? DISCOVERY_FEEDS[(cursor + DISCOVERY_FEEDS.length - 1) % DISCOVERY_FEEDS.length] : null,
      lastDiscoveryError: errors.join(' | ').slice(0, 240) || 'no discovery feed attempted',
    },
    discovered: 0,
    attempts,
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shortHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function liveCatalogRevision(channels) {
  if (!channels.length) return 'none';
  return shortHash(channels.map((channel) => `${channel.name}|${channel.url}`).join('\n'));
}

async function scheduled(env) {
  const previous = await readHealth(env);
  let discovery = { state: previous, discovered: 0 };
  try { discovery = await discoverOne(previous); } catch {}
  const stateForProbe = discovery.state;
  const registry = allRegistry(stateForProbe);
  const batch = selectionBatch(registry, stateForProbe);
  const checkedAt = new Date().toISOString();
  const rows = await mapWithConcurrency(batch, MAX_PROBE_SOURCES, (source) => {
    const previousHealth = stateForProbe.sources[sourceHealthKey(source)] || stateForProbe.sources[source.slug] || null;
    return probeSource(source, previousHealth);
  });
  const next = updateHealthState(registry, stateForProbe, rows, checkedAt);
  next.lastKnownGoodVOD = stateForProbe.lastKnownGoodVOD || [];
  next.lastKnownGoodLIVE = stateForProbe.lastKnownGoodLIVE || [];
  next.liveCatalog = stateForProbe.liveCatalog || [];
  next.liveCatalogBySource = { ...(stateForProbe.liveCatalogBySource || {}) };
  next.cursor = (Number(stateForProbe.cursor || 0) + Math.max(1, batch.length)) % Math.max(1, registry.length);
  next.discoveryCursor = stateForProbe.discoveryCursor || 0;
  next.lastDiscoveryAt = stateForProbe.lastDiscoveryAt || null;
  next.lastDiscoverySuccessAt = stateForProbe.lastDiscoverySuccessAt || null;
  next.lastDiscoveryFeed = stateForProbe.lastDiscoveryFeed || null;
  next.lastDiscoveryError = stateForProbe.lastDiscoveryError || null;
  next.discoveredSources = pruneDiscoveredCandidates(stateForProbe.discoveredSources || []);

  const vod = publishedFor(registry, next, 'vod');
  const live = publishedFor(registry, next, 'live');
  if (vod.length) next.lastKnownGoodVOD = vod.map(sourceHealthKey);
  if (live.length) next.lastKnownGoodLIVE = live.map(sourceHealthKey);
  const liveRows = rows.filter((row) => row.kind === 'live' && row.ok && row.channels?.length);
  if (liveRows.length) {
    for (const row of liveRows) next.liveCatalogBySource[`${row.kind}:${row.slug}`] = row.channels.slice(0, 400);
  }
  const previousState = normalizeHealthState(previous);
  const liveKeys = publishedFor(registry, next, 'live').map(sourceHealthKey);
  const catalogRows = liveKeys.flatMap((key) => next.liveCatalogBySource[key] || []);
  next.liveCatalog = dedupeChannels(catalogRows).slice(0, 2000);
  const sourceRevision = next.revision;
  const liveChanged = !sameJson(previousState.liveCatalog, next.liveCatalog);
  next.liveRevision = liveChanged || !previousState.liveRevision ? liveCatalogRevision(next.liveCatalog) : previousState.liveRevision;
  next.revision = `${sourceRevision}|live:${next.liveRevision}`;
  const contentChanged = previousState.revision !== next.revision || liveChanged;
  next.checkedAt = checkedAt;
  next.generatedAt = contentChanged || !previousState.generatedAt ? checkedAt : previousState.generatedAt;
  next.discoveryCount = discovery.discovered;
  const statusChanged = !sameJson(previousState.sources, next.sources)
    || previousState.revision !== next.revision
    || !sameJson(previousState.lastKnownGoodLIVE, next.lastKnownGoodLIVE)
    || !sameJson(previousState.lastKnownGoodVOD, next.lastKnownGoodVOD)
    || !sameJson(previousState.liveCatalog, next.liveCatalog)
    || !sameJson(previousState.liveCatalogBySource, next.liveCatalogBySource)
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
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store, no-cache, must-revalidate' } });
  return responseJson(payload, 200, 0, { etag, 'cache-control': 'no-store, no-cache, must-revalidate' });
}

async function status(request, env) {
  const state = await readHealth(env);
  const registry = allRegistry(state);
  const vod = publishedFor(registry, state, 'vod');
  const live = publishedFor(registry, state, 'live');
  const vodRows = kindRegistry(registry, 'vod').map((source) => state.sources[sourceHealthKey(source)] || {}).filter(Boolean);
  const liveRows = kindRegistry(registry, 'live').map((source) => state.sources[sourceHealthKey(source)] || {}).filter(Boolean);
  const countTier = (sources, tier) => sources.filter((source) => {
    const row = state.sources[sourceHealthKey(source)] || state.sources[source.slug] || null;
    return effectiveAdmissionTier(source, row) === tier;
  }).length;
  const countUnprobed = (sources) => sources.filter((source) => !state.sources[sourceHealthKey(source)] && !state.sources[source.slug]).length;
  return responseJson({
    ok: true, version: VERSION, registryVersion: REGISTRY_VERSION, checkedAt: state.checkedAt || state.generatedAt, updatedAt: state.generatedAt,
    persistedAt: state.persistedAt, revision: state.revision, degraded: Object.keys(state.sources || {}).length === 0 || vod.length < TARGET_VOD_SOURCES || live.length < MIN_LIVE_SOURCES,
    configUrl: new URL('/config.json', request.url).toString(),
    vod: { registered: kindRegistry(registry, 'vod').length, visible: vod.length, active: countTier(vod, 'ACTIVE'), watch: countTier(vod, 'WATCH'), unprobed: countUnprobed(vod), providers: new Set(vod.map((source) => source.provider)).size, target: '10+' },
    live: { registered: kindRegistry(registry, 'live').length, visible: live.length, active: countTier(live, 'ACTIVE'), watch: countTier(live, 'WATCH'), unprobed: countUnprobed(live), providers: new Set(live.map((source) => source.provider)).size, channels: state.liveCatalog.length, target: '10+' },
    discovery: {
      lastAt: state.lastDiscoveryAt,
      lastSuccessAt: state.lastDiscoverySuccessAt,
      feed: state.lastDiscoveryFeed,
      error: state.lastDiscoveryError,
      candidates: state.discoveredSources.length,
    },
    policy: 'Direct source registry only; upstream categories, filters and ordering are passed through unchanged. No category whitelist, video proxy, full catalogue snapshot, or adult filtering.',
    sources: publicSourceRows(registry, state),
  }, 200, 0, { 'cache-control': 'no-store, no-cache, must-revalidate' });
}

async function sourceStatus(request, env) {
  const state = await readHealth(env);
  const registry = allRegistry(state);
  return responseJson({ ok: true, version: VERSION, registryVersion: REGISTRY_VERSION, ...state, sources: publicSourceRows(registry, state) }, 200, 0, { 'cache-control': 'no-store, no-cache, must-revalidate' });
}

function root(request) {
  const origin = new URL(request.url).origin;
  return responseText(['TVBox Source Registry v8.2', 'Config: ' + origin + '/config.json', 'Live: ' + origin + '/live.txt', 'Status: ' + origin + '/status.json', 'Sources: ' + origin + '/sources.json'].join('\n') + '\n', 200, 300);
}

export default {
  async scheduled(_event, env) {
    const startedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'source-registry-cron-start', startedAt }));
    try {
      const result = await scheduled(env);
      console.log(JSON.stringify({ event: 'source-registry-cron-complete', ...result }));
    } catch (error) {
      console.log(JSON.stringify({
        event: 'source-registry-cron-error',
        startedAt,
        error: String(error?.message || error).slice(0, 240),
      }));
      throw error;
    }
  },
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return responseText('', 204, 86400);
      const sourceMatch = url.pathname.match(/^\/source\/([^/]+)$/u);
      if (sourceMatch) return sourceAdapter(request, env, decodeURIComponent(sourceMatch[1]));
      if (url.pathname === '/config.json' || url.pathname === '/config') return config(request, env);
      if (url.pathname === '/live.txt' || url.pathname === '/live') {
        return liveText(request, env);
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
  liveText,
  classesOf,
  classId,
  className,
  directMediaUrls,
  effectiveSources,
  fetchDocument,
  fetchJson,
  nativeFilterInfo,
  playBranchContract,
  playlistHardViolation,
  publishedFor,
  pruneDiscoveredCandidates,
  rowsOf,
  selectionBatch,
  sourceUrl,
  discoverOne,
};
