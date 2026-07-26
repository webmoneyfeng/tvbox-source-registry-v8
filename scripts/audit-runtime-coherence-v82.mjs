import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASES = String(process.env.TVBOX_BASES || 'https://tv.webhome.eu.org,https://tv.webclound.eu.org,https://tvbox-source-registry-v8.feng-yang.workers.dev')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const AUDIT_LABEL = String(
  process.env.AUDIT_LABEL
  || (BASES.length === 1 && /canary/iu.test(BASES[0]) ? 'canary' : 'latest'),
).replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'latest';
const FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUDIT_FETCH_TIMEOUT_MS || 20000));
const FETCH_RETRIES = Math.max(0, Number(process.env.AUDIT_FETCH_RETRIES || 2));

function text(value) {
  return String(value ?? '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nameQuality(value) {
  const names = Array.isArray(value?.sites)
    ? value.sites.map((site) => text(site?.name)).filter(Boolean)
    : [];
  const liveNames = Array.isArray(value?.lives)
    ? value.lives.map((site) => text(site?.name)).filter(Boolean)
    : [];
  const all = [...names, ...liveNames];
  const replacementCount = (all.join('\n').match(/\uFFFD/gu) || []).length;
  const mojibakeCount = (all.join('\n').match(/(?:鐢|鍔|璧|鐩|閫|鏂|鐖|鏆|榄|绾|璞)/gu) || []).length;
  return {
    siteCount: names.length,
    liveCount: liveNames.length,
    uniqueNames: new Set(all).size === all.length,
    replacementCount,
    mojibakeCount,
    clean: replacementCount === 0 && mojibakeCount === 0,
  };
}

async function fetchJson(base, endpoint) {
  let last = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${base.replace(/\/+$/u, '')}/${endpoint}`, {
        headers: { accept: 'application/json', 'user-agent': 'tvbox-source-registry-v8.2-audit/1.0' },
        signal: controller.signal,
      });
      const body = await response.text();
      let data = null;
      try { data = JSON.parse(body); } catch {}
      last = {
        status: response.status,
        ok: response.ok && Boolean(data),
        etag: response.headers.get('etag') || '',
        cacheControl: response.headers.get('cache-control') || '',
        contentType: response.headers.get('content-type') || '',
        attempts: attempt + 1,
        data,
      };
      if (response.status < 500 || attempt >= FETCH_RETRIES) return last;
    } catch (error) {
      last = {
        status: 0,
        ok: false,
        etag: '',
        cacheControl: '',
        contentType: '',
        attempts: attempt + 1,
        error: String(error?.message || error).slice(0, 240),
        data: null,
      };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < FETCH_RETRIES) await sleep(300 * (attempt + 1));
  }
  return last;
}

const rows = [];
for (const base of BASES) {
  const config = await fetchJson(base, 'config.json');
  const status = await fetchJson(base, 'status.json');
  const sources = await fetchJson(base, 'sources.json');
  const revision = config.data?.registry?.revision || status.data?.revision || '';
  rows.push({
    base,
    config: { ...config, data: undefined, names: nameQuality(config.data) },
    status: { ...status, data: undefined, revision: status.data?.revision || '' },
    sources: { ...sources, data: undefined },
    revision,
    version: config.data?.registry?.version || status.data?.version || '',
  });
}

const revisions = rows.map((row) => row.revision).filter(Boolean);
const versions = rows.map((row) => row.version).filter(Boolean);
const report = {
  generatedAt: new Date().toISOString(),
  bases: BASES,
  rows,
  checks: {
    allReachable: rows.every((row) => row.config.ok && row.status.ok && row.sources.ok),
    sameRevision: revisions.length > 0 && new Set(revisions).size === 1,
    sameVersion: versions.length > 0 && new Set(versions).size === 1,
    noStoreOrNoCache: rows.every((row) => /(?:no-store|no-cache)/iu.test(row.config.cacheControl) && /(?:no-store|no-cache)/iu.test(row.status.cacheControl)),
    namesClean: rows.every((row) => row.config.names.clean && row.config.names.uniqueNames),
  },
};
report.pass = Object.values(report.checks).every(Boolean);

const auditDir = path.join(ROOT, 'audit');
await mkdir(auditDir, { recursive: true });
const suffix = AUDIT_LABEL === 'latest' ? '-v82' : `-${AUDIT_LABEL}-v82`;
const target = path.join(auditDir, `encoding-coherence${suffix}.json`);
const temporary = `${target}.tmp-${process.pid}`;
await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', 'utf8');
JSON.parse(await (await import('node:fs/promises')).readFile(temporary, 'utf8'));
await rename(temporary, target);
await writeFile(path.join(auditDir, `deployment-truth${suffix}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(path.join(auditDir, `cache-coherence${suffix}.json`), JSON.stringify({
  generatedAt: report.generatedAt,
  bases: BASES,
  checks: report.checks,
  rows: rows.map((row) => ({
    base: row.base,
    revision: row.revision,
    version: row.version,
    config: row.config,
    status: row.status,
  })),
  pass: report.pass,
}, null, 2) + '\n', 'utf8');

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
