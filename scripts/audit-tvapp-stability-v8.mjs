import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLiveStability, classifyVodStability, summarizeAttempts } from '../src/admission.mjs';
import { isPublicHttpUrl, physicalCandidateKey } from '../src/discovery.mjs';
import { liveContract, parseM3U } from '../src/live.mjs';
import { candidateToRegistrySource } from '../src/registry.mjs';
import { probeSource } from '../src/worker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = process.env.TVAPP_ADMISSION_INPUT || path.join(ROOT, 'audit', 'tvapp-candidate-admission-latest.json');
const ROUNDS = Number(process.env.TVAPP_STABILITY_ROUNDS || 3);
const MAX_VOD = Number(process.env.TVAPP_STABILITY_MAX_VOD || 12);
const MAX_LIVE = Number(process.env.TVAPP_STABILITY_MAX_LIVE || 10);
const MAX_MEDIA_PER_LIVE = Number(process.env.TVAPP_STABILITY_MEDIA_SAMPLES || 6);
const MAX_LIVE_PLAYLIST_BYTES = Number(process.env.TVAPP_STABILITY_MAX_LIVE_PLAYLIST_BYTES || 3_500_000);
const TIMEOUT_MS = Number(process.env.TVAPP_STABILITY_TIMEOUT_MS || 12000);

async function fetchLimited(url, maxBytes = 1_000_000) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: '*/*', 'user-agent': 'tvbox-source-registry-v8-tvapp-stability/1.0' },
    });
    const reader = response.body?.getReader?.();
    const chunks = [];
    let total = 0;
    let complete = false;
    if (reader) {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) { complete = true; break; }
        const remaining = maxBytes - total;
        if (value.byteLength > remaining) {
          chunks.push(Buffer.from(value.subarray(0, remaining)));
          total += remaining;
          await reader.cancel();
          break;
        }
        chunks.push(Buffer.from(value));
        total += value.byteLength;
      }
    }
    const declaredBytes = Number(response.headers.get('content-length') || 0);
    const truncated = declaredBytes > 0 ? declaredBytes > maxBytes : !complete;
    const body = Buffer.concat(chunks, total).toString('utf8');
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type') || '',
      latencyMs: Date.now() - started,
      bytes: total,
      truncated,
      text: body,
      error: '',
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: '',
      latencyMs: Date.now() - started,
      bytes: 0,
      truncated: false,
      text: '',
      error: String(error?.message || error).slice(0, 240),
    };
  }
}

function parseTxtChannels(input) {
  const channels = [];
  for (const rawLine of String(input || '').replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    const comma = line.indexOf(',http');
    if (comma < 0) continue;
    const name = line.slice(0, comma).trim();
    const url = line.slice(comma + 1).trim();
    if (name && isPublicHttpUrl(url)) channels.push({ name, group: '未分组', url });
  }
  return channels;
}

function liveChannels(text) {
  if (/^\s*#EXTM3U/iu.test(text)) return parseM3U(text).channels;
  return parseTxtChannels(text);
}

function channelSamples(channels, limit) {
  if (channels.length <= limit) return channels;
  const selected = [];
  const step = Math.max(1, Math.floor(channels.length / limit));
  for (let index = 0; index < channels.length && selected.length < limit; index += step) selected.push(channels[index]);
  return selected;
}

async function probeMedia(url) {
  const response = await fetchLimited(url, 120_000);
  const text = response.text || '';
  const direct = response.ok && (text.includes('#EXTM3U') || /(?:mpegurl|video|mp2t|octet-stream)/iu.test(response.contentType));
  const invalid = /(?:iframe|player\.html|解析|广告|公众号|加群|<!doctype html|<html)/iu.test(text);
  return {
    ok: direct && !invalid,
    status: response.status,
    latencyMs: response.latencyMs,
    contentType: response.contentType,
    rootCause: direct && !invalid ? 'OK' : invalid ? 'AD_OR_PARSE_ENDPOINT' : 'MEDIA_SEGMENT_UNAVAILABLE',
  };
}

async function probeVod(candidate, round) {
  const source = candidateToRegistrySource({ kind: 'vod', api: candidate.api, name: candidate.name });
  try {
    const probe = await probeSource(source);
    const rootCauses = [];
    if (!probe.ok) rootCauses.push(probe.error || 'API_OR_CONTRACT_FAIL');
    if (!probe.detailOk) rootCauses.push('SOURCE_DETAIL_GAP');
    if (!probe.playOk) rootCauses.push('SOURCE_PLAYBACK_GAP');
    if (!probe.searchCount) rootCauses.push('SOURCE_SEARCH_GAP');
    if (probe.invalidBranchCount) rootCauses.push('AD_OR_PARSE_ENDPOINT');
    return {
      round,
      ok: Boolean(probe.ok && probe.detailOk && probe.playOk),
      httpStatus: probe.httpStatus || 0,
      latencyMs: probe.latencyMs || null,
      categoryCount: probe.categoryCount || probe.classCount || 0,
      listCount: probe.listCount || 0,
      searchCount: probe.searchCount || 0,
      detailOk: Boolean(probe.detailOk),
      playOk: Boolean(probe.playOk),
      rootCauses: [...new Set(rootCauses.filter(Boolean))],
      error: probe.error || '',
    };
  } catch (error) {
    return {
      round,
      ok: false,
      httpStatus: 0,
      latencyMs: null,
      categoryCount: 0,
      listCount: 0,
      searchCount: 0,
      detailOk: false,
      playOk: false,
      rootCauses: ['API_OR_CONTRACT_FAIL'],
      error: String(error?.message || error).slice(0, 240),
    };
  }
}

async function probeLive(candidate, round) {
  const playlist = await fetchLimited(candidate.api, MAX_LIVE_PLAYLIST_BYTES);
  if (!playlist.ok) {
    return {
      round,
      ok: false,
      status: playlist.status,
      latencyMs: playlist.latencyMs,
      channelCount: 0,
      groupCount: 0,
      playableCount: 0,
      sampleCount: 0,
      rootCauses: ['PLAYLIST_UNAVAILABLE'],
      error: playlist.error || `status ${playlist.status}`,
    };
  }
  const channels = liveChannels(playlist.text);
  const contract = liveContract(playlist.text);
  const samples = channelSamples(channels, MAX_MEDIA_PER_LIVE);
  const media = [];
  for (const channel of samples) {
    const row = await probeMedia(channel.url);
    media.push({ name: channel.name, group: channel.group, url: channel.url, ...row });
  }
  const playableCount = media.filter((row) => row.ok).length;
  const rootCauses = [];
  const groupCount = contract.groupCount || new Set(channels.map((channel) => channel.group || '未分组')).size;
  const shapeOk = channels.length >= 5 && groupCount >= 1;
  if (!shapeOk) rootCauses.push('PLAYLIST_SCHEMA_ERROR');
  if (playlist.truncated) rootCauses.push('PLAYLIST_TRUNCATED');
  if (playableCount < 2) rootCauses.push('MEDIA_SEGMENT_UNAVAILABLE');
  if (media.some((row) => row.rootCause === 'AD_OR_PARSE_ENDPOINT')) rootCauses.push('AD_OR_PARSE_ENDPOINT');
  return {
    round,
    ok: shapeOk && playableCount >= 2 && !playlist.truncated,
    status: playlist.status,
    latencyMs: playlist.latencyMs,
    channelCount: contract.channelCount || channels.length,
    groupCount,
    duplicateRate: contract.duplicateRate || 0,
    truncated: playlist.truncated,
    playableCount,
    sampleCount: media.length,
    media,
    rootCauses: [...new Set(rootCauses)],
    error: '',
  };
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

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

const input = JSON.parse(await readFile(INPUT, 'utf8'));
const vodTargets = dedupeBy((input.vodProbes || [])
  .filter((row) => ['PROBATION', 'WATCH'].includes(row.recommendedTier))
  .filter((row) => row.api && !row.alreadyInRegistry)
  .slice(0, MAX_VOD)
  .map((row) => ({ kind: 'vod', name: row.name, api: row.api, firstTier: row.recommendedTier, physicalKey: row.physicalKey || physicalCandidateKey(row.api) })), (row) => `vod:${row.physicalKey}`);
const liveTargets = dedupeBy((input.liveMedia || [])
  .filter((row) => ['PROBATION', 'WATCH'].includes(row.recommendedTier))
  .filter((row) => row.api && !row.alreadyInRegistry)
  .slice(0, MAX_LIVE)
  .map((row) => ({ kind: 'live', name: row.name, api: row.api, firstTier: row.recommendedTier, physicalKey: row.physicalKey || physicalCandidateKey(row.api) })), (row) => `live:${row.physicalKey}`);

const generatedAt = new Date().toISOString();
const vodResults = await mapWithConcurrency(vodTargets, 3, async (target) => {
  const attempts = [];
  for (let round = 1; round <= ROUNDS; round += 1) attempts.push(await probeVod(target, round));
  const summary = summarizeAttempts(attempts);
  const classification = classifyVodStability(summary);
  return { ...target, attempts, summary, finalTier: classification.tier, finalReason: classification.reason };
});
const liveResults = await mapWithConcurrency(liveTargets, 3, async (target) => {
  const attempts = [];
  for (let round = 1; round <= ROUNDS; round += 1) attempts.push(await probeLive(target, round));
  const summary = summarizeAttempts(attempts);
  const classification = classifyLiveStability(summary);
  return { ...target, attempts, summary, finalTier: classification.tier, finalReason: classification.reason };
});

const report = {
  generatedAt,
  input,
  policy: {
    productionMutation: false,
    rounds: ROUNDS,
    maxLivePlaylistBytes: MAX_LIVE_PLAYLIST_BYTES,
    approvalRequiredBeforeRegistryChange: true,
    noCategoryRewrite: true,
    noFilterRewrite: true,
  },
  counts: {
    vodTargets: vodTargets.length,
    liveTargets: liveTargets.length,
    vodActive: vodResults.filter((row) => row.finalTier === 'ACTIVE').length,
    vodWatch: vodResults.filter((row) => row.finalTier === 'WATCH').length,
    vodRejected: vodResults.filter((row) => row.finalTier === 'REJECTED').length,
    liveActive: liveResults.filter((row) => row.finalTier === 'ACTIVE').length,
    liveWatch: liveResults.filter((row) => row.finalTier === 'WATCH').length,
    liveRejected: liveResults.filter((row) => row.finalTier === 'REJECTED').length,
  },
  vodResults,
  liveResults,
};

const auditDir = path.join(ROOT, 'audit');
await mkdir(auditDir, { recursive: true });
await writeFile(path.join(auditDir, 'tvapp-stability-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

const md = [];
md.push('# TVAPP 候选源多轮稳定性复测');
md.push('');
md.push(`生成时间：${generatedAt}`);
md.push(`复测轮数：${ROUNDS}`);
md.push('');
md.push('## 摘要');
md.push(`- 点播复测 ${report.counts.vodTargets} 个：ACTIVE ${report.counts.vodActive}、WATCH ${report.counts.vodWatch}、REJECTED ${report.counts.vodRejected}。`);
md.push(`- 直播复测 ${report.counts.liveTargets} 个：ACTIVE ${report.counts.liveActive}、WATCH ${report.counts.liveWatch}、REJECTED ${report.counts.liveRejected}。`);
md.push('');
md.push('## 建议可提交给用户批准的候选');
for (const row of [...vodResults, ...liveResults].filter((item) => item.finalTier === 'ACTIVE')) {
  md.push(`- ACTIVE | ${row.kind} | ${row.name} | ${row.api} | success=${row.summary.successRate} media=${row.summary.mediaOkRate} play=${row.summary.playOkRate} p95=${row.summary.p95LatencyMs ?? '-'}`);
}
md.push('');
md.push('## 仍建议观察');
for (const row of [...vodResults, ...liveResults].filter((item) => item.finalTier === 'WATCH')) {
  md.push(`- WATCH | ${row.kind} | ${row.name} | ${row.api} | reason=${row.finalReason} | causes=${row.summary.rootCauses.join(',') || '-'}`);
}
md.push('');
md.push('## 拒绝或暂不纳入');
for (const row of [...vodResults, ...liveResults].filter((item) => item.finalTier === 'REJECTED')) {
  md.push(`- REJECTED | ${row.kind} | ${row.name} | ${row.api} | reason=${row.finalReason} | causes=${row.summary.rootCauses.join(',') || '-'}`);
}
md.push('');
md.push('## 边界');
md.push('- 本复测仍不修改正式注册表。');
md.push('- ACTIVE 代表本轮多次复测稳定通过，但仍需用户批准后才能进入 canary 或正式源表。');
md.push('- WATCH 代表核心链路可用但存在软问题；REJECTED 不建议展示。');
await writeFile(path.join(auditDir, 'tvapp-stability-summary.md'), md.join('\n') + '\n', 'utf8');

console.log(JSON.stringify(report.counts, null, 2));
for (const row of [...vodResults, ...liveResults]) {
  console.log(`${row.finalTier}\t${row.kind}\t${row.name}\t${row.api}\t${row.finalReason}`);
}
