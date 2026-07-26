import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const BASE = String(process.env.CANARY_BASE || 'https://tvbox-source-registry-v8-canary.feng-yang.workers.dev').replace(/\/+$/u, '');
const ROUNDS = Math.max(1, Number(process.env.CANARY_ROUNDS || 3));
const DELAY_MS = Math.max(0, Number(process.env.CANARY_ROUND_DELAY_MS || 1500));
const VERSION_ID = String(process.env.CANARY_VERSION_ID || '').trim() || null;
const FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.CANARY_FETCH_TIMEOUT_MS || 20000));
const FETCH_RETRIES = Math.max(0, Number(process.env.CANARY_FETCH_RETRIES || 2));

const ENDPOINTS = ['/config.json', '/status.json', '/sources.json', '/live.txt'];
const FORBIDDEN_UI_RE = /(?:\u5907\u7528|\u89c2\u5bdf|WATCH|ACTIVE|REJECTED)/iu;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEndpoint(pathname) {
  let last = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE}${pathname}`, {
        redirect: 'follow',
        headers: { accept: '*/*', 'user-agent': 'tvbox-source-registry-v8.2-canary-audit/1.0' },
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      last = {
        pathname,
        status: response.status,
        ok: response.ok,
        bytes: text.length,
        contentType: response.headers.get('content-type') || '',
        cacheControl: response.headers.get('cache-control') || '',
        etag: response.headers.get('etag') || '',
        body,
        liveFormat: pathname === '/live.txt' ? /^\s*#EXTM3U\b/iu.test(text) : null,
        liveHasUrl: pathname === '/live.txt' ? /https?:\/\//iu.test(text) : null,
        latencyMs: Date.now() - started,
        attempts: attempt + 1,
      };
      if (response.status < 500 || attempt >= FETCH_RETRIES) return last;
    } catch (error) {
      last = {
        pathname,
        status: 0,
        ok: false,
        bytes: 0,
        contentType: '',
        cacheControl: '',
        etag: '',
        body: null,
        liveFormat: pathname === '/live.txt' ? false : null,
        liveHasUrl: pathname === '/live.txt' ? false : null,
        latencyMs: Date.now() - started,
        attempts: attempt + 1,
        error: String(error?.message || error).slice(0, 240),
      };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < FETCH_RETRIES) await sleep(300 * (attempt + 1));
  }
  return last;
}

async function fetchRound(round) {
  const rows = [];
  for (const pathname of ENDPOINTS) rows.push(await fetchEndpoint(pathname));
  const byPath = Object.fromEntries(rows.map((row) => [row.pathname, row]));
  const config = byPath['/config.json']?.body;
  const status = byPath['/status.json']?.body;
  const sources = byPath['/sources.json']?.body;
  const sites = Array.isArray(config?.sites) ? config.sites : [];
  const lives = Array.isArray(config?.lives) ? config.lives : [];
  const allNames = [...sites.map((site) => String(site.name || '')), ...lives.map((live) => String(live.name || ''))].filter(Boolean);
  const revision = config?.registry?.revision || status?.revision || '';
  const hasLiveCatalog = Number(status?.live?.channels || config?.registry?.liveChannelCount || 0) > 0;
  return {
    round,
    capturedAt: new Date().toISOString(),
    endpoints: rows.map(({ body, ...row }) => row),
    counts: {
      sites: sites.length,
      lives: lives.length,
      sourceRows: Array.isArray(sources?.sources) ? sources.sources.length : 0,
    },
    statusSummary: {
      degraded: status?.degraded ?? null,
      vod: status?.vod || null,
      live: status?.live || null,
    },
    revision,
    version: config?.registry?.version || status?.version || '',
    checks: {
      allReachable: rows.every((row) => row.ok),
      configSitesNonEmpty: sites.length > 0,
      directVodApis: sites.every((site) => /^https?:\/\//iu.test(String(site.api || ''))),
      noExecutableSites: sites.every((site) => !site.jar && !site.spider && !site.ext),
      namesUnique: new Set(allNames).size === allNames.length,
      noForbiddenUiText: !FORBIDDEN_UI_RE.test(JSON.stringify({ sites, lives })),
      registryCountsMatch: config?.registry?.vodCount === sites.length && config?.registry?.liveCount === lives.length,
      statusCountsMatch: status?.vod?.visible === sites.length
        && status?.live?.visible === lives.length
        && status?.vod?.active + status?.vod?.watch === sites.length
        && status?.live?.active + status?.live?.watch === lives.length,
      revisionConsistent: Boolean(config?.registry?.revision && config.registry.revision === status?.revision),
      liveFormat: byPath['/live.txt']?.liveFormat === true,
      liveContainsValidatedUrl: !hasLiveCatalog || byPath['/live.txt']?.liveHasUrl === true,
      noStoreControl: ['/config.json', '/status.json', '/sources.json']
        .every((pathname) => /(?:no-store|no-cache)/iu.test(byPath[pathname]?.cacheControl || '')),
      degradedMatchesTarget: status?.degraded === (sites.length < 10 || lives.length < 10),
    },
  };
}

async function writeJsonAtomic(filename, value) {
  await mkdir(AUDIT_DIR, { recursive: true });
  const target = path.join(AUDIT_DIR, filename);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(await readFile(temporary, 'utf8'));
  await rename(temporary, target);
}

const rounds = [];
for (let round = 1; round <= ROUNDS; round += 1) {
  rounds.push(await fetchRound(round));
  if (round < ROUNDS && DELAY_MS > 0) await sleep(DELAY_MS);
}

const latest = rounds[rounds.length - 1];
const revisions = rounds.map((round) => round.revision).filter(Boolean);
const checks = {
  ...latest.checks,
  allRoundsReachable: rounds.every((round) => round.checks.allReachable),
  revisionStableAcrossRounds: revisions.length === rounds.length && new Set(revisions).size === 1,
};
const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  deploymentVersionId: VERSION_ID,
  rounds,
  checks,
  pass: Object.values(checks).every(Boolean),
  interpretation: {
    note: 'This audit verifies the canary contract and consistency. It does not promote the canary to the formal domains.',
  },
};

await writeJsonAtomic('canary-observation-v82.json', report);
await writeJsonAtomic('canary-deployment-v82.json', {
  generatedAt: report.generatedAt,
  base: BASE,
  deploymentVersionId: VERSION_ID,
  version: latest.version,
  revision: latest.revision,
  counts: latest.counts,
  checks,
  pass: report.pass,
});

const summary = [
  '# v8.2 Canary Audit',
  '',
  `- Base: ${BASE}`,
  `- Version: ${latest.version || 'unknown'}`,
  `- Deployment version ID: ${VERSION_ID || 'not supplied'}`,
  `- VOD visible: ${latest.counts.sites}`,
  `- Live visible: ${latest.counts.lives}`,
  `- Revision stable across ${ROUNDS} rounds: ${checks.revisionStableAcrossRounds}`,
  `- Result: ${report.pass ? 'PASS' : 'FAIL'}`,
  '',
  '## Failed checks',
  '',
  ...Object.entries(checks).filter(([, value]) => !value).map(([name]) => `- ${name}`),
  '',
  'Formal domains are intentionally not changed by this audit.',
  '',
].join('\n');
await writeFile(path.join(AUDIT_DIR, 'canary-audit-summary-v82.md'), summary, 'utf8');

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
