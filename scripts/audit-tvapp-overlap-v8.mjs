import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicHttpUrl } from '../src/discovery.mjs';
import { compareLiveProfiles, profileLiveChannels, summarizeLiveProfile } from '../src/live-overlap.mjs';
import { normalizeLiveUrl, parseM3U } from '../src/live.mjs';
import { LIVE_SOURCE_REGISTRY } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMISSION_INPUT = process.env.TVAPP_ADMISSION_INPUT || path.join(ROOT, 'audit', 'tvapp-candidate-admission-latest.json');
const STABILITY_INPUT = process.env.TVAPP_STABILITY_INPUT || path.join(ROOT, 'audit', 'tvapp-stability-latest.json');
const TIMEOUT_MS = Number(process.env.TVAPP_OVERLAP_TIMEOUT_MS || 20000);
const MAX_PLAYLIST_BYTES = Number(process.env.TVAPP_OVERLAP_MAX_PLAYLIST_BYTES || 3_500_000);

async function fetchLimited(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'audio/x-mpegurl,text/plain,*/*', 'user-agent': 'tvbox-source-registry-v8-overlap-audit/1.0' },
    });
    const reader = response.body?.getReader?.();
    const chunks = [];
    let total = 0;
    let complete = false;
    if (reader) {
      while (total < MAX_PLAYLIST_BYTES) {
        const { done, value } = await reader.read();
        if (done) { complete = true; break; }
        const remaining = MAX_PLAYLIST_BYTES - total;
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
    return {
      ok: response.ok,
      status: response.status,
      text: Buffer.concat(chunks, total).toString('utf8'),
      bytes: total,
      truncated: declaredBytes > 0 ? declaredBytes > MAX_PLAYLIST_BYTES : !complete,
      latencyMs: Date.now() - started,
      error: '',
    };
  } catch (error) {
    return { ok: false, status: 0, text: '', bytes: 0, truncated: false, latencyMs: Date.now() - started, error: String(error?.message || error).slice(0, 240) };
  }
}

function parseTxtChannels(input) {
  const channels = [];
  for (const rawLine of String(input || '').replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    const comma = line.indexOf(',http');
    if (comma < 0) continue;
    const name = line.slice(0, comma).trim();
    const url = normalizeLiveUrl(line.slice(comma + 1).trim());
    if (name && url && isPublicHttpUrl(url)) channels.push({ name, url });
  }
  return channels;
}

function parseChannels(text) {
  return /^\s*#EXTM3U/iu.test(text) ? parseM3U(text).channels : parseTxtChannels(text);
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

async function profileSource(source) {
  const fetched = await fetchLimited(source.api);
  const channels = fetched.ok && !fetched.truncated ? parseChannels(fetched.text) : [];
  const profile = profileLiveChannels(channels);
  return {
    ...source,
    ok: fetched.ok,
    status: fetched.status,
    bytes: fetched.bytes,
    truncated: fetched.truncated,
    latencyMs: fetched.latencyMs,
    error: fetched.error,
    profile,
  };
}

const [admission, stability] = await Promise.all([
  readFile(ADMISSION_INPUT, 'utf8').then(JSON.parse),
  readFile(STABILITY_INPUT, 'utf8').then(JSON.parse),
]);
const activeCandidates = stability.liveResults
  .filter((row) => row.finalTier === 'ACTIVE')
  .map((row) => ({ kind: 'candidate', name: row.name, api: row.api, finalTier: row.finalTier }));
const existingSources = LIVE_SOURCE_REGISTRY.map((source) => ({ kind: 'existing', slug: source.slug, name: source.displayName, api: source.api }));
const [candidateProfiles, existingProfiles] = await Promise.all([
  mapWithConcurrency(activeCandidates, 3, profileSource),
  mapWithConcurrency(existingSources, 4, profileSource),
]);

const candidates = candidateProfiles.map((candidate) => {
  const comparisons = existingProfiles.map((existing) => ({
    slug: existing.slug,
    name: existing.name,
    api: existing.api,
    ...compareLiveProfiles(candidate.profile, existing.profile),
  })).filter((comparison) => comparison.sharedNames || comparison.sharedUrls || comparison.sameFingerprint)
    .sort((left, right) => Number(right.sameFingerprint) - Number(left.sameFingerprint) || right.urlJaccard - left.urlJaccard || right.nameJaccard - left.nameJaccard);
  const exact = comparisons.find((comparison) => comparison.sameFingerprint);
  return {
    name: candidate.name,
    api: candidate.api,
    fetch: { ok: candidate.ok, status: candidate.status, bytes: candidate.bytes, truncated: candidate.truncated, latencyMs: candidate.latencyMs, error: candidate.error },
    profile: summarizeLiveProfile(candidate.profile),
    recommendation: !candidate.ok || candidate.truncated ? 'WATCH_INCOMPLETE_AUDIT' : exact ? 'REJECTED_DUPLICATE_EXISTING' : 'CANARY_RECOMMENDED',
    exactDuplicateOf: exact ? { slug: exact.slug, name: exact.name, api: exact.api } : null,
    topOverlaps: comparisons.slice(0, 5),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  source: { admissionGeneratedAt: admission.generatedAt, stabilityGeneratedAt: stability.generatedAt },
  policy: { productionMutation: false, maxPlaylistBytes: MAX_PLAYLIST_BYTES, approvalRequiredBeforeRegistryChange: true, exactDuplicateOnly: true },
  counts: {
    activeCandidates: candidates.length,
    canaryRecommended: candidates.filter((row) => row.recommendation === 'CANARY_RECOMMENDED').length,
    exactDuplicates: candidates.filter((row) => row.recommendation === 'REJECTED_DUPLICATE_EXISTING').length,
    incompleteAudits: candidates.filter((row) => row.recommendation === 'WATCH_INCOMPLETE_AUDIT').length,
  },
  candidates,
};

const auditDir = path.join(ROOT, 'audit');
await mkdir(auditDir, { recursive: true });
await writeFile(path.join(auditDir, 'tvapp-live-overlap-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
const md = [
  '# TVAPP Live Candidate Overlap Audit',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `- ACTIVE candidates: ${report.counts.activeCandidates}`,
  `- Canary recommended: ${report.counts.canaryRecommended}`,
  `- Exact duplicates of existing sources: ${report.counts.exactDuplicates}`,
  `- Incomplete audits: ${report.counts.incompleteAudits}`,
  '',
  '## Candidates',
];
for (const row of candidates) {
  const exact = row.exactDuplicateOf ? ` exact=${row.exactDuplicateOf.name}` : '';
  md.push(`- ${row.recommendation} | ${row.name} | ${row.api}${exact}`);
}
await writeFile(path.join(auditDir, 'tvapp-live-overlap-summary.md'), md.join('\n') + '\n', 'utf8');
console.log(JSON.stringify(report.counts, null, 2));
for (const row of candidates) console.log(`${row.recommendation}\t${row.name}\t${row.api}`);
