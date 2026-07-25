import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateToRegistrySource } from '../src/registry.mjs';
import { dedupeCandidates, extractCandidates, isPublicHttpUrl } from '../src/discovery.mjs';
import { probeSource } from '../src/worker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 15000;
const MAX_VOD_CANDIDATES = 30;
const MAX_LIVE_CANDIDATES = 20;
const FEEDS = [
  'https://raw.githubusercontent.com/liu673cn/box/main/m.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/itv.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv4.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/kr.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/uk.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/de.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ca.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/au.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br.m3u',
  'https://live.zbds.org/tv/iptv4.m3u',
  'https://live.zbds.org/tv/iptv6.m3u',
  'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',
  'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u',
  'https://szyyds.cn/tv/x.json',
  'https://16409.kstore.vip/tv/ngzmods.json',
  'https://raw.githubusercontent.com/keluo8824-cell/tvbox/main/XYQTVBox.json',
  'https://raw.githubusercontent.com/keluo8824-cell/tvbox/main/4k.json',
  'https://raw.githubusercontent.com/liu673cn/box/main/a.json',
  'https://raw.githubusercontent.com/liu673cn/box/main/b.json',
  'https://raw.githubusercontent.com/gaotianliuyun/gao/master/m.json',
];

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'tvbox-source-registry-v8-candidate-audit/1.0' } });
    return { url, ok: response.ok, status: response.status, text: await response.text(), error: '' };
  } catch (error) {
    return { url, ok: false, status: 0, text: '', error: String(error?.message || error).slice(0, 240) };
  } finally {
    clearTimeout(timer);
  }
}

function parsePayload(text) {
  const value = String(text || '').replace(/^\uFEFF/u, '').trim();
  if (/^#EXTM3U/iu.test(value)) return value;
  const jsonText = value.replace(/^(?:\s*\/\/[^\r\n]*(?:\r?\n|$))+/u, '');
  try { return JSON.parse(jsonText); } catch { return null; }
}

function extractDirectCandidates(payload, feedUrl) {
  const candidates = extractCandidates(payload, feedUrl);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.sites)) return candidates;
  for (const site of payload.sites) {
    if (!site || Number(site.type || 1) !== 1 || !isPublicHttpUrl(site.api)) continue;
    const keys = Object.keys(site).filter((key) => site[key]).join(' ');
    if (/(?:jar|spider|ext|parse|player|script)/iu.test(keys)) continue;
    candidates.push({ kind: 'vod', api: site.api, name: String(site.name || '').trim(), discoveredFrom: feedUrl });
  }
  return candidates;
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

function sourceRow(candidate, probe) {
  const source = candidateToRegistrySource(candidate);
  return {
    kind: candidate.kind,
    api: source.api,
    physicalKey: source.physicalKey,
    sourceName: candidate.name || source.slug,
    discoveredFrom: candidate.discoveredFrom || '',
    ok: Boolean(probe.ok),
    score: probe.score || null,
    httpStatus: probe.httpStatus || 0,
    latencyMs: probe.latencyMs || null,
    listCount: probe.listCount || 0,
    searchCount: probe.searchCount || 0,
    detailOk: Boolean(probe.detailOk),
    playOk: Boolean(probe.playOk),
    channelCount: probe.channelCount || 0,
    groupCount: probe.groupCount || 0,
    playableCount: probe.playableCount || 0,
    sampleCount: probe.sampleCount || 0,
    duplicateRate: probe.duplicateRate || 0,
    error: probe.error || '',
  };
}

const feedResults = await Promise.all(FEEDS.map(fetchText));
const extracted = [];
for (const feed of feedResults) {
  if (!feed.ok) continue;
  const payload = parsePayload(feed.text);
  if (payload === null) continue;
  extracted.push(...extractDirectCandidates(payload, feed.url));
}
const candidates = dedupeCandidates(extracted).filter((candidate) => isPublicHttpUrl(candidate.api));
const vodCandidates = candidates.filter((candidate) => candidate.kind === 'vod').slice(0, MAX_VOD_CANDIDATES);
const liveCandidates = candidates.filter((candidate) => candidate.kind === 'live').slice(0, MAX_LIVE_CANDIDATES);
const selected = [...vodCandidates, ...liveCandidates];
const probes = await mapWithConcurrency(selected, 4, async (candidate) => {
  try { return sourceRow(candidate, await probeSource(candidateToRegistrySource(candidate))); }
  catch (error) { return sourceRow(candidate, { ok: false, error: String(error?.message || error).slice(0, 240) }); }
});
const report = {
  generatedAt: new Date().toISOString(),
  feeds: feedResults.map(({ url, ok, status, error }) => ({ url, ok, status, error })),
  extractedCount: extracted.length,
  candidateCount: candidates.length,
  selected: { vod: vodCandidates.length, live: liveCandidates.length },
  passed: {
    vod: probes.filter((row) => row.kind === 'vod' && row.ok).length,
    live: probes.filter((row) => row.kind === 'live' && row.ok).length,
  },
  rows: probes,
  policy: 'Candidate discovery only. A source enters production only after contract, direct media and repeated health checks pass.',
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'candidate-pool-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  extractedCount: report.extractedCount,
  candidateCount: report.candidateCount,
  selected: report.selected,
  passed: report.passed,
}, null, 2));
for (const row of probes) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.kind} ${row.api} latency=${row.latencyMs ?? '-'} playable=${row.playableCount}/${row.sampleCount} ${row.error}`.trim());
