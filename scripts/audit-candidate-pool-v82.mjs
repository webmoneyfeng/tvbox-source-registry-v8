import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_SOURCE_REGISTRY, REGISTRY_VERSION, SOURCE_REGISTRY, candidateToRegistrySource } from '../src/registry.mjs';
import { dedupeCandidates, isPublicHttpUrl } from '../src/discovery.mjs';
import { auditLiveSource, auditVodSource } from '../src/deep-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const INPUT = process.env.CANDIDATE_INPUT || 'candidate-discovery-v82.json';
const CONCURRENCY = Math.max(1, Number(process.env.CANDIDATE_CONCURRENCY || 2));
const MAX_VOD = Math.max(0, Number(process.env.CANDIDATE_MAX_VOD || 20));
const MAX_LIVE = Math.max(0, Number(process.env.CANDIDATE_MAX_LIVE || 20));
const VOD_OFFSET = Math.max(0, Number(process.env.CANDIDATE_OFFSET_VOD || process.env.CANDIDATE_OFFSET || 0));
const LIVE_OFFSET = Math.max(0, Number(process.env.CANDIDATE_OFFSET_LIVE || process.env.CANDIDATE_OFFSET || 0));
const AUDIT_LABEL = String(process.env.CANDIDATE_AUDIT_LABEL || '').replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '');
const CATEGORY_LIMIT = Number(process.env.CANDIDATE_CATEGORY_LIMIT || 8);
const DETAIL_SAMPLE = Number(process.env.CANDIDATE_DETAIL_SAMPLE || 4);
const CHANNEL_SAMPLE = Number(process.env.CANDIDATE_CHANNEL_SAMPLE || 12);

async function writeJsonAtomic(file, value) {
  const target = path.join(AUDIT_DIR, file);
  const temporary = `${target}.tmp-${process.pid}`;
  const serialized = JSON.stringify(value, null, 2) + '\n';
  await writeFile(temporary, serialized, 'utf8');
  const roundTrip = JSON.parse(await readFile(temporary, 'utf8'));
  if (!roundTrip || typeof roundTrip !== 'object') throw new Error(`invalid JSON report: ${file}`);
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
      try {
        output[index] = await callback(items[index], index);
      } catch (error) {
        output[index] = {
          kind: items[index]?.kind || 'unknown',
          api: items[index]?.api || '',
          admissionTier: 'REJECTED',
          hardFailures: ['CANDIDATE_AUDIT_EXCEPTION'],
          softWarnings: [],
          rootCauses: ['CANDIDATE_AUDIT_EXCEPTION'],
          error: String(error?.message || error).slice(0, 240),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function physicalKeys(registry, kind) {
  return new Set(registry.filter((source) => source.kind === kind).map((source) => `${kind}:${source.physicalKey}`));
}

function candidateSource(candidate) {
  const source = candidateToRegistrySource(candidate);
  return { ...source, displayName: candidate.name || candidate.displayName || source.displayName };
}

function admissionSummary(rows, kind) {
  const filtered = rows.filter((row) => row.kind === kind);
  return {
    candidateCount: filtered.length,
    active: filtered.filter((row) => row.admissionTier === 'ACTIVE').length,
    watch: filtered.filter((row) => row.admissionTier === 'WATCH').length,
    rejected: filtered.filter((row) => row.admissionTier === 'REJECTED').length,
    directPlayable: filtered.filter((row) => row.directPlayable === true).length,
  };
}

const input = JSON.parse(await readFile(path.join(AUDIT_DIR, INPUT), 'utf8'));
const discovered = dedupeCandidates(Array.isArray(input.candidates) ? input.candidates : []);
const vodKeys = physicalKeys(SOURCE_REGISTRY, 'vod');
const liveKeys = physicalKeys(LIVE_SOURCE_REGISTRY, 'live');
const uniqueAgainstRegistry = new Map();
for (const candidate of discovered) {
  const source = candidateSource(candidate);
  const key = `${candidate.kind}:${source.physicalKey}`;
  if (!uniqueAgainstRegistry.has(key)) uniqueAgainstRegistry.set(key, { ...candidate, registryPhysicalKey: source.physicalKey });
}
const selected = [...uniqueAgainstRegistry.values()]
  .filter((candidate) => isPublicHttpUrl(candidate.api))
  .filter((candidate) => candidate.kind === 'live'
    ? !liveKeys.has(`live:${candidate.registryPhysicalKey}`)
    : !vodKeys.has(`vod:${candidate.registryPhysicalKey}`))
  .sort((a, b) => `${a.kind}:${a.api}`.localeCompare(`${b.kind}:${b.api}`));
const eligibleVod = selected.filter((candidate) => candidate.kind === 'vod');
const eligibleLive = selected.filter((candidate) => candidate.kind === 'live');
const selectedVod = eligibleVod.slice(VOD_OFFSET, MAX_VOD > 0 ? VOD_OFFSET + MAX_VOD : VOD_OFFSET);
const selectedLive = eligibleLive.slice(LIVE_OFFSET, MAX_LIVE > 0 ? LIVE_OFFSET + MAX_LIVE : LIVE_OFFSET);

async function auditCandidate(candidate) {
  const source = candidateSource(candidate);
  const result = candidate.kind === 'live'
    ? await auditLiveSource(source, { channelSample: CHANNEL_SAMPLE })
    : await auditVodSource(source, { categoryLimit: CATEGORY_LIMIT, detailSample: DETAIL_SAMPLE });
  return {
    candidate: {
      kind: candidate.kind,
      api: candidate.api,
      physicalKey: candidate.physicalKey,
      registryPhysicalKey: candidate.registryPhysicalKey,
      nativeName: candidate.name || '',
      discoveredFrom: candidate.discoveredFrom || '',
    },
    source: {
      slug: source.slug,
      provider: source.provider,
      api: source.api,
    },
    state: 'PROBATION',
    ...result,
    directPlayable: candidate.kind === 'live'
      ? Number(result.playableCount || 0) >= 2
      : Number(result.mediaPlayableCount || 0) > 0 || Number(result.playableRate || 0) > 0,
  };
}

const audited = await mapWithConcurrency([...selectedVod, ...selectedLive], CONCURRENCY, auditCandidate);
const report = {
  generatedAt: new Date().toISOString(),
  registryVersion: REGISTRY_VERSION,
  policy: 'Candidate sources stay in PROBATION until repeated native contract, detail and direct-media checks pass. This report does not modify the production registry.',
  input: {
    file: INPUT,
    discoveredCount: discovered.length,
    eligibleVod: eligibleVod.length,
    eligibleLive: eligibleLive.length,
    vodOffset: VOD_OFFSET,
    liveOffset: LIVE_OFFSET,
    selectedVod: selectedVod.length,
    selectedLive: selectedLive.length,
    categoryLimit: CATEGORY_LIMIT || null,
    detailSample: DETAIL_SAMPLE,
    channelSample: CHANNEL_SAMPLE,
  },
  summaries: {
    vod: admissionSummary(audited, 'vod'),
    live: admissionSummary(audited, 'live'),
  },
  rows: audited,
};
await mkdir(AUDIT_DIR, { recursive: true });
const reportFile = AUDIT_LABEL ? `candidate-pool-v82-${AUDIT_LABEL}.json` : 'candidate-pool-v82.json';
await writeJsonAtomic(reportFile, report);
await writeJsonAtomic('candidate-pool-latest.json', report);
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  input: report.input,
  summaries: report.summaries,
}, null, 2));
