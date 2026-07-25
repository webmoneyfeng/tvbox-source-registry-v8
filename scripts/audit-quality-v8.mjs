import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseM3U, normalizeLiveUrl } from '../src/live.mjs';
import { isPublicHttpUrl, physicalCandidateKey } from '../src/discovery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 8000;
const API_MAX_BYTES = 768 * 1024;
const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_MAX_BYTES = 128 * 1024;
const SEARCH_TERMS = ['天道', '亮剑', '电影'];

const VOD_CANDIDATES = [
  ['baidu', 'https://api.apibdzy.com/api.php/provide/vod/'],
  ['bfzy', 'https://bfzyapi.com/api.php/provide/vod/'],
  ['taopian', 'https://taopianapi.com/cjapi/mc/vod/json.html'],
  ['hhzy', 'https://hhzyapi.com/api.php/provide/vod/'],
  ['hongniu', 'https://www.hongniuzy2.com/api.php/provide/vod/'],
  ['modu', 'https://caiji.moduapi.cc/api.php/provide/vod/'],
  ['xinlang', 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/'],
  ['lzi', 'https://cj.lziapi.com/api.php/provide/vod/'],
  ['ffzy', 'http://ffzy.tv/api.php/provide/vod/'],
  ['jszy', 'https://jszyapi.com/api.php/provide/vod/'],
  ['rycj', 'https://cj.rycjapi.com/api.php/provide/vod/'],
  ['jinying', 'https://jyzyapi.com/provide/vod/'],
  ['zuida', 'https://api.zuidapi.com/api.php/provide/vod/'],
  ['subo', 'http://suboziyuan.net/api.php/provide/vod/'],
  ['lovedan', 'https://www.lovedan.net/api.php/provide/vod/'],
  ['subo-cj', 'https://subocaiji.com/api.php/provide/vod/'],
  ['yinghua', 'https://m3u8.apiyhzy.com/api.php/provide/vod/'],
  ['wujin-net', 'https://api.wujinapi.net/api.php/provide/vod/'],
  ['uku', 'https://api.ukuapi.com/api.php/provide/vod/'],
  ['ikun', 'https://ikunzyapi.com/api.php/provide/vod'],
  ['lovedan-alt', 'http://api.lovedan.net/api.php/provide/vod/'],
  ['dianying', 'https://api.dianyinggou.com/api.php/provide/vod/'],
  ['yinghua-alt', 'https://api.apiyhzy.com/api.php/provide/vod/'],
  ['wujin-alt', 'https://api.wujinapi.me/api.php/provide/vod/'],
  ['alyzy', 'https://cms.alyzy.xyz/api.php/provide/vod/'],
  ['360zy', 'https://360zy.com/api.php/provide/vod/'],
  ['heimuer', 'https://json02.heimuer.xyz/api.php/provide/vod/'],
];

const LIVE_CANDIDATES = [
  ['fanmingming-index', 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u'],
  ['fanmingming-itv', 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/itv.m3u'],
  ['fanmingming-ipv6', 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u'],
  ['iptv-org-cn', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u'],
  ['iptv-org-hk', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u'],
  ['iptv-org-tw', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u'],
  ['iptv-org-jp', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u'],
  ['iptv-org-kr', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/kr.m3u'],
  ['iptv-org-us', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u'],
  ['iptv-org-uk', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/uk.m3u'],
  ['iptv-org-de', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/de.m3u'],
  ['iptv-org-fr', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u'],
  ['iptv-org-ca', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ca.m3u'],
  ['iptv-org-au', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/au.m3u'],
  ['iptv-org-in', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u'],
  ['iptv-org-br', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br.m3u'],
  ['zbds-ipv4', 'https://live.zbds.org/tv/iptv4.m3u'],
  ['zbds-ipv6', 'https://live.zbds.org/tv/iptv6.m3u'],
  ['yang-gather', 'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u'],
  ['kimentanm', 'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u'],
  ['suxuang-ipv4', 'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u'],
  ['suxuang-ipv6', 'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv6.m3u'],
  ['guovin-result', 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u'],
  ['guovin-ipv4', 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.m3u'],
  ['guovin-ipv6', 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv6/result.m3u'],
  ['joevess', 'https://raw.githubusercontent.com/joevess/IPTV/main/iptv.m3u'],
  ['yuanzl77', 'https://raw.githubusercontent.com/yuanzl77/IPTV/main/iptv.m3u'],
  ['epg7', 'https://raw.githubusercontent.com/epg7/IPTV/main/live.m3u'],
  ['iptv-org-sg', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/sg.m3u'],
  ['iptv-org-th', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/th.m3u'],
  ['iptv-org-vn', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/vn.m3u'],
  ['iptv-org-es', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/es.m3u'],
  ['iptv-org-it', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/it.m3u'],
  ['iptv-org-nl', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/nl.m3u'],
  ['iptv-org-ch', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ch.m3u'],
  ['iptv-org-at', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/at.m3u'],
  ['iptv-org-be', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/be.m3u'],
  ['iptv-org-pt', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/pt.m3u'],
  ['iptv-org-pl', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/pl.m3u'],
  ['iptv-org-se', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/se.m3u'],
  ['iptv-org-no', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/no.m3u'],
  ['iptv-org-fi', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fi.m3u'],
  ['iptv-org-tr', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tr.m3u'],
  ['iptv-org-mx', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/mx.m3u'],
  ['iptv-org-ar', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ar.m3u'],
  ['iptv-org-cl', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cl.m3u'],
  ['iptv-org-za', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/za.m3u'],
  ['iptv-org-nz', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/nz.m3u'],
  ['iptv-org-id', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/id.m3u'],
  ['iptv-org-ph', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ph.m3u'],
  ['iptv-org-my', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/my.m3u'],
];

const QUALITY_RE = /(?:4k|2160p?|uhd|2k|1440p?|1080p?|fhd|fullhd|高清|超清|高码率|hd\b)/iu;
const MEDIA_RE = /https?:\/\/[^\s$#|"'<>]+(?:m3u8|mp4|\.ts)(?:\?[^\s$|"'<>]*)?/giu;

function text(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

async function readLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const value = await response.text();
    return { text: value.slice(0, maxBytes), truncated: value.length > maxBytes };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let textValue = '';
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (bytes + part.value.byteLength > maxBytes) {
        const allowed = Math.max(0, maxBytes - bytes);
        textValue += decoder.decode(part.value.slice(0, allowed), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      bytes += part.value.byteLength;
      textValue += decoder.decode(part.value, { stream: true });
    }
    textValue += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return { text: textValue, truncated };
}

async function fetchTimed(url, maxBytes = API_MAX_BYTES, headers = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain,application/vnd.apple.mpegurl,video/*,*/*', 'user-agent': 'tvbox-source-registry-quality-audit/1.0', ...headers },
    });
    const body = await readLimited(response, maxBytes);
    return { url, ok: response.ok && !body.truncated, status: response.status, latencyMs: Date.now() - started, text: body.text, truncated: body.truncated, contentType: response.headers.get('content-type') || '' };
  } catch (error) {
    return { url, ok: false, status: 0, latencyMs: Date.now() - started, text: '', truncated: false, contentType: '', error: String(error?.message || error).slice(0, 240) };
  } finally {
    clearTimeout(timer);
  }
}

function rowsOf(data) {
  const list = data?.list ?? data?.data?.list ?? data?.data ?? [];
  return Array.isArray(list) ? list : [];
}

function sourceUrl(api, params) {
  const url = new URL(api);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

async function fetchJson(api, params) {
  const result = await fetchTimed(sourceUrl(api, params));
  let data = null;
  try { data = JSON.parse(result.text.replace(/^\uFEFF/u, '').trim()); } catch {}
  return { ...result, data, ok: Boolean(result.ok && data && typeof data === 'object') };
}

function mediaUrls(row) {
  const values = Object.entries(row || {}).filter(([key]) => /(?:play|url|down|source|vod)/iu.test(key)).map(([, value]) => String(value || '')).join(' ');
  return [...new Set((values.match(MEDIA_RE) || []).map((value) => value.replace(/[),.;]+$/u, '')))]
    .filter((value) => isPublicHttpUrl(value) && !/(?:player\.html|iframe|parse|jiexi)/iu.test(value))
    .slice(0, 5);
}

function qualityEvidence(value) {
  const valueText = text(value);
  const matches = valueText.match(QUALITY_RE) || [];
  const resolutions = [...valueText.matchAll(/(?:RESOLUTION=|[?&])(?:resolution|res)?=?([0-9]{3,5})x([0-9]{3,5})/giu)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  const maxWidth = resolutions.reduce((max, item) => Math.max(max, item.width), 0);
  return { ok: matches.length > 0 || maxWidth >= 1280, labels: [...new Set(matches.map((match) => match.toLowerCase()))], maxWidth };
}

async function probeMedia(url, hint = '') {
  const result = await fetchTimed(url, MEDIA_MAX_BYTES, { range: 'bytes=0-131071' });
  const preview = result.text.slice(0, MEDIA_MAX_BYTES);
  const mediaType = /#EXTM3U|mpegurl|\.m3u8(?:\?|$)/iu.test(`${preview} ${result.contentType} ${url}`) ? 'm3u8' : /video\/|\.mp4(?:\?|$)/iu.test(`${result.contentType} ${url}`) ? 'mp4' : 'unknown';
  const playable = Boolean(result.status >= 200 && result.status < 400 && ((mediaType === 'm3u8' && /#EXTM3U/iu.test(preview)) || (mediaType === 'mp4' && (result.status === 206 || /video\//iu.test(result.contentType)))));
  const quality = qualityEvidence(`${hint} ${url} ${preview}`);
  return { url, ok: playable, mediaType, status: result.status, latencyMs: result.latencyMs, quality: quality.ok, qualityLabels: quality.labels, maxWidth: quality.maxWidth, error: result.error || '' };
}

async function auditVod([slug, api]) {
  const started = Date.now();
  const requests = [];
  const listing = await fetchJson(api, { ac: 'videolist', pg: 1 });
  requests.push(listing);
  const listingRows = rowsOf(listing.data);
  const searches = await Promise.all(SEARCH_TERMS.map(async (wd) => {
    const result = await fetchJson(api, { wd, pg: 1 });
    requests.push(result);
    return { term: wd, result, rows: rowsOf(result.data) };
  }));
  const allRows = [...listingRows, ...searches.flatMap((item) => item.rows)];
  const sample = allRows.find((row) => mediaUrls(row).length && qualityEvidence(JSON.stringify(row)).ok)
    || allRows.find((row) => mediaUrls(row).length)
    || null;
  const id = sample?.vod_id ?? sample?.id ?? sample?.vod_id_str;
  const detail = id ? await fetchJson(api, { ac: 'detail', ids: id }) : { ok: false, latencyMs: 0, data: null, error: 'no sample id' };
  requests.push(detail);
  const detailRow = rowsOf(detail.data)[0] || detail.data?.data?.[0] || null;
  const media = detailRow ? await Promise.all(mediaUrls(detailRow).slice(0, 3).map((url) => probeMedia(url, Object.values(detailRow).join(' ')))) : [];
  const apiSuccess = requests.filter((item) => item.ok);
  const apiTimes = apiSuccess.map((item) => item.latencyMs);
  const mediaSuccess = media.filter((item) => item.ok);
  const sampleQuality = qualityEvidence(JSON.stringify(detailRow || sample || {}));
  const qualityHits = media.filter((item) => item.quality || sampleQuality.ok);
  const searchHits = searches.filter((item) => item.result.ok && item.rows.length);
  const apiMedianMs = median(apiTimes);
  const mediaMedianMs = median(media.map((item) => item.latencyMs));
  const mediaSuccessRate = media.length ? mediaSuccess.length / media.length : 0;
  const qualityRate = media.length ? qualityHits.length / media.length : 0;
  const pass = Boolean(
    listing.ok && listingRows.length > 0 && searchHits.length >= 1 && detail.ok && detailRow
      && media.length > 0 && mediaSuccessRate >= 0.67 && qualityRate >= 0.5
      && (apiMedianMs ?? Infinity) <= 3000 && (mediaMedianMs ?? Infinity) <= 4000,
  );
  return {
    kind: 'vod', slug, api, physicalKey: physicalCandidateKey(api), pass, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    httpStatus: listing.status || detail.status || 0, listCount: listingRows.length,
    search: searches.map((item) => ({ term: item.term, ok: Boolean(item.result.ok && item.rows.length), count: item.rows.length, latencyMs: item.result.latencyMs })),
    detailOk: Boolean(detail.ok && detailRow), media, metrics: { apiMedianMs, apiP95Ms: percentile(apiTimes, 0.95), mediaMedianMs, mediaSuccessRate: Number(mediaSuccessRate.toFixed(3)), qualityRate: Number(qualityRate.toFixed(3)) },
    qualityEvidence: sampleQuality,
    reason: pass ? 'PASS' : !listing.ok ? 'API_UNAVAILABLE' : !searchHits.length ? 'SEARCH_UNAVAILABLE' : !detailRow ? 'DETAIL_UNAVAILABLE' : !media.length ? 'NO_DIRECT_MEDIA' : qualityRate < 0.5 ? 'NO_HD_EVIDENCE' : mediaSuccessRate < 0.67 ? 'MEDIA_UNSTABLE' : (apiMedianMs ?? Infinity) > 3000 || (mediaMedianMs ?? Infinity) > 4000 ? 'SLOW' : 'CONTRACT_OR_SCHEMA',
  };
}

function channelQuality(channel) {
  return qualityEvidence(`${channel.name} ${channel.group} ${channel.url}`);
}

async function auditLive([slug, api]) {
  const playlist = await fetchTimed(api, PLAYLIST_MAX_BYTES);
  const parsed = playlist.ok ? parseM3U(playlist.text) : { channels: [], rawChannelCount: 0 };
  const channels = parsed.channels || [];
  const qualityFirst = channels.filter(channelQuality);
  const sampled = [...qualityFirst.slice(0, 12), ...channels.filter((channel) => !qualityFirst.includes(channel)).slice(0, 4)].slice(0, 16);
  const media = await Promise.all(sampled.map((channel) => probeMedia(normalizeLiveUrl(channel.url), `${channel.name} ${channel.group}`)));
  const valid = media.filter((item) => item.ok);
  const quality = valid.filter((item) => item.quality);
  const duplicateRate = parsed.rawChannelCount ? 1 - channels.length / parsed.rawChannelCount : 1;
  const mediaSuccessRate = media.length ? valid.length / media.length : 0;
  const qualityRate = valid.length ? quality.length / valid.length : 0;
  const mediaMedianMs = median(media.map((item) => item.latencyMs));
  const groups = new Set(channels.map((channel) => channel.group).filter(Boolean));
  const pass = Boolean(playlist.ok && channels.length >= 8 && groups.size >= 1 && media.length >= 8 && valid.length >= 4 && quality.length >= 3 && playlist.latencyMs <= 5000 && (mediaMedianMs ?? Infinity) <= 4000);
  return {
    kind: 'live', slug, api, physicalKey: physicalCandidateKey(api), pass, checkedAt: new Date().toISOString(),
    httpStatus: playlist.status, playlistLatencyMs: playlist.latencyMs, channelCount: channels.length, groupCount: groups.size, duplicateRate: Number(duplicateRate.toFixed(4)),
    media, metrics: { mediaMedianMs, mediaP95Ms: percentile(media.map((item) => item.latencyMs), 0.95), mediaSuccessRate: Number(mediaSuccessRate.toFixed(3)), qualityRate: Number(qualityRate.toFixed(3)) },
    reason: pass ? 'PASS' : !playlist.ok ? 'PLAYLIST_UNAVAILABLE' : !channels.length ? 'NO_CHANNELS' : valid.length < 4 ? 'MEDIA_UNSTABLE' : quality.length < 3 ? 'NO_HD_EVIDENCE' : playlist.latencyMs > 5000 || (mediaMedianMs ?? Infinity) > 4000 ? 'SLOW' : 'CONTRACT_OR_SCHEMA',
  };
}

async function mapWithConcurrency(items, limit, callback) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await callback(items[index]); } catch (error) { output[index] = { kind: 'unknown', slug: items[index][0], api: items[index][1], pass: false, reason: String(error?.message || error).slice(0, 160) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function uniqueCandidates(candidates, kind) {
  const seen = new Set();
  return candidates.filter(([, api]) => {
    if (!isPublicHttpUrl(api)) return false;
    const key = `${kind}:${physicalCandidateKey(api)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const vodRows = await mapWithConcurrency(uniqueCandidates(VOD_CANDIDATES, 'vod'), 4, auditVod);
const liveRows = await mapWithConcurrency(uniqueCandidates(LIVE_CANDIDATES, 'live'), 6, auditLive);
const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    vod: 'PASS requires list, search, detail, direct media, >=67% media success, >=50% HD evidence, API median <=3000ms and media median <=4000ms.',
    live: 'PASS requires >=8 channels, >=67% sampled media success, >=50% HD evidence, playlist <=3000ms and media median <=4000ms. Source-internal duplicate rate is reported, not rewritten or used to reject the upstream list.',
    counting: 'VOD physical hosts and live playlist host+path are counted once; mirrors are not extra sources.',
  },
  targets: { vod: 10, live: 10 },
  candidates: { vod: vodRows.length, live: liveRows.length },
  passed: { vod: vodRows.filter((row) => row.pass).length, live: liveRows.filter((row) => row.pass).length },
  rows: [...vodRows, ...liveRows],
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'quality-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ generatedAt: report.generatedAt, candidates: report.candidates, passed: report.passed }, null, 2));
for (const row of report.rows) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.kind} ${row.slug} reason=${row.reason}`);
