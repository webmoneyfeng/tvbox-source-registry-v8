import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeCandidates, isPublicHttpUrl, normalizeCandidateUrl, physicalCandidateKey } from '../src/discovery.mjs';
import { decodeSourceBytes, encodingEvidence } from '../src/encoding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = Number(process.env.DISCOVERY_TIMEOUT_MS || 15000);
const FEEDS = [
  'https://raw.githubusercontent.com/liu673cn/box/main/m.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json',
  'https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json',
  'https://raw.githubusercontent.com/liu673cn/box/main/a.json',
  'https://raw.githubusercontent.com/liu673cn/box/main/b.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/drpy.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/m.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/XYQ.json',
  'https://raw.githubusercontent.com/keluo8824-cell/tvbox/main/XYQTVBox.json',
  'https://raw.githubusercontent.com/keluo8824-cell/tvbox/main/4k.json',
  'https://raw.githubusercontent.com/keluo8824-cell/tvbox/main/duanju.json',
  'https://raw.githubusercontent.com/keluo8824-cell/tvbox/main/dongman.json',
  'https://raw.githubusercontent.com/szyyds/TVBox/main/x.json',
  'https://raw.liucn.cc/box/m.json',
  'https://szyyds.cn/tv/x.json',
  'https://16409.kstore.vip/tv/ngzmods.json',
  'https://dxawi.github.io/0/0.json',
  'https://play.iptv365.org/api.json',
  'https://jihulab.com/duomv/apps/-/raw/main/a.txt',
  'https://jihulab.com/duomv/apps/-/raw/main/b.txt',
  'https://jihulab.com/duomv/apps/-/raw/main/c.txt',
  'https://jihulab.com/duomv/apps/-/raw/main/d.txt',
  'https://16409.kstore.vip/tv/ngzmods.json',
  'https://d.kstore.dev/download/7213/',
  'https://jihulab.com/duomv/apps/-/raw/main/fast.json',
  'http://yydsys.top/duo/v.json',
  'http://yydsys.top/duo',
  'https://raw.githubusercontent.com/yydfys/yydf/main/yydf/yydfjk.json',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/itv.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv4.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/au.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/sg.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/my.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/mo.m3u',
  'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',
  'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u',
  'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv6.m3u',
  'https://live.zbds.org/tv/iptv6.m3u',
  'https://m3u.ibert.me/txt/fmml_ipv6.txt',
];
const DISALLOWED_KEY_RE = /(?:jar|spider|ext|parse|player|script)/iu;

function stripJsonComments(value) {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const next = value[index + 1];
    if (lineComment) {
      if (current === '\n') { lineComment = false; output += current; }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; index += 1; }
      else if (current === '\n') output += current;
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; output += current; continue; }
    if (current === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (current === '/' && next === '*') { blockComment = true; index += 1; continue; }
    output += current;
  }
  return output;
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json,text/plain,*/*', 'user-agent': 'tvbox-source-registry-candidate-discovery/1.0' } });
    const contentType = response.headers.get('content-type') || '';
    const decoded = decodeSourceBytes(new Uint8Array(await response.arrayBuffer()), contentType);
    const text = decoded.text;
    return {
      url,
      finalUrl: response.url || url,
      contentType,
      encoding: encodingEvidence(decoded),
      ok: response.ok,
      status: response.status,
      text,
      error: '',
    };
  } catch (error) {
    return { url, finalUrl: '', contentType: '', encoding: null, ok: false, status: 0, text: '', error: String(error?.message || error).slice(0, 240) };
  } finally {
    clearTimeout(timer);
  }
}

function parsePayload(text) {
  const value = String(text || '').replace(/^\uFEFF/u, '').trim();
  if (/^#EXTM3U/iu.test(value)) return value;
  try { return JSON.parse(stripJsonComments(value)); } catch { return null; }
}

function directCandidates(payload, feedUrl) {
  if (typeof payload === 'string' && /^\s*#EXTM3U/iu.test(payload)) {
    return [{ kind: 'live', api: normalizeCandidateUrl(feedUrl), name: '', discoveredFrom: feedUrl }].filter((row) => row.api);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const output = [];
  for (const site of Array.isArray(payload.sites) ? payload.sites : []) {
    if (!site || Number(site.type || 1) !== 1 || !isPublicHttpUrl(site.api)) continue;
    const populatedKeys = Object.keys(site).filter((key) => site[key]).join(' ');
    if (DISALLOWED_KEY_RE.test(populatedKeys)) continue;
    output.push({ kind: 'vod', api: normalizeCandidateUrl(site.api), name: String(site.name || '').trim(), discoveredFrom: feedUrl });
  }
  for (const live of Array.isArray(payload.lives) ? payload.lives : []) {
    if (!isPublicHttpUrl(live?.url)) continue;
    output.push({ kind: 'live', api: normalizeCandidateUrl(live.url), name: String(live.name || '').trim(), discoveredFrom: feedUrl });
  }
  return output;
}

const visited = new Set();
const feeds = [];
async function walk(url, depth = 0) {
  const normalized = normalizeCandidateUrl(url);
  if (!normalized || visited.has(normalized) || visited.size >= 240) return;
  visited.add(normalized);
  const feed = await fetchFeed(normalized);
  feeds.push(feed);
  if (!feed.ok || depth >= 3) return;
  const payload = parsePayload(feed.text);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const references = [];
  for (const row of Array.isArray(payload.urls) ? payload.urls : []) references.push(row?.url);
  for (const row of Array.isArray(payload.storeHouse) ? payload.storeHouse : []) references.push(row?.sourceUrl || row?.url);
  await Promise.all(references.filter((row) => isPublicHttpUrl(row)).slice(0, 120).map((row) => walk(row, depth + 1)));
}
await Promise.all(FEEDS.map((feed) => walk(feed)));
const extracted = feeds.flatMap((feed) => feed.ok ? directCandidates(parsePayload(feed.text), feed.url) : []);
const candidates = dedupeCandidates(extracted);
const report = {
  generatedAt: new Date().toISOString(),
  feeds: feeds.map(({ url, finalUrl, contentType, encoding, ok, status, error, text }) => ({
    url,
    finalUrl,
    contentType,
    encoding,
    parseType: /^\s*#EXTM3U/iu.test(text) ? 'm3u' : parsePayload(text) ? 'json' : 'unknown',
    ok,
    status,
    bytes: text.length,
    error,
  })),
  extractedCount: extracted.length,
  candidateCount: candidates.length,
  candidates: candidates.map((candidate) => ({
    ...candidate,
    physicalKey: physicalCandidateKey(candidate.api, candidate.kind),
  })),
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
const serialized = JSON.stringify(report, null, 2) + '\n';
for (const name of ['candidate-discovery-latest.json', 'candidate-discovery-v82.json']) {
  const target = path.join(ROOT, 'audit', name);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, serialized, 'utf8');
  JSON.parse(await (await import('node:fs/promises')).readFile(temporary, 'utf8'));
  await rename(temporary, target);
}
console.log(JSON.stringify({ generatedAt: report.generatedAt, extractedCount: report.extractedCount, candidateCount: report.candidateCount, byKind: { vod: candidates.filter((row) => row.kind === 'vod').length, live: candidates.filter((row) => row.kind === 'live').length } }, null, 2));
for (const candidate of candidates) console.log(`${candidate.kind}\t${candidate.name || '-'}\t${candidate.api}\t${candidate.discoveredFrom}`);
