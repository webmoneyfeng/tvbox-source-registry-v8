import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASES = String(process.env.TVBOX_BASES || 'https://tv.webhome.eu.org,https://tv.webclound.eu.org,https://tvbox-source-registry-v8.feng-yang.workers.dev')
  .split(',').map((value) => value.trim().replace(/\/+$/u, '')).filter(Boolean);
const REQUEST_ATTEMPTS = Number(process.env.DEPLOYMENT_AUDIT_ATTEMPTS || 3);

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

async function get(base, pathname) {
  const started = Date.now();
  let last = null;
  for (let attempt = 0; attempt < Math.max(1, REQUEST_ATTEMPTS); attempt += 1) {
    try {
      const response = await fetch(`${base}${pathname}?audit=${Date.now()}-${attempt}`, { redirect: 'follow', cache: 'no-store', headers: { 'cache-control': 'no-cache', pragma: 'no-cache', 'user-agent': 'tvbox-source-registry-deployment-audit/8.1.4' } });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      const result = {
        url: `${base}${pathname}`,
        status: response.status,
        ok: response.ok,
        latencyMs: Date.now() - started,
        attempts: attempt + 1,
        hash: hash(text),
        body,
        headers: {
          etag: response.headers.get('etag') || '',
          cacheControl: response.headers.get('cache-control') || '',
          cfCacheStatus: response.headers.get('cf-cache-status') || '',
          age: response.headers.get('age') || '',
          contentType: response.headers.get('content-type') || '',
        },
        error: '',
      };
      if (result.ok || attempt === REQUEST_ATTEMPTS - 1) return result;
      last = result;
    } catch (error) {
      last = { url: `${base}${pathname}`, status: 0, ok: false, latencyMs: Date.now() - started, attempts: attempt + 1, hash: '', body: null, headers: {}, error: String(error?.message || error).slice(0, 240) };
      if (attempt < REQUEST_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return last || { url: `${base}${pathname}`, status: 0, ok: false, latencyMs: Date.now() - started, attempts: 0, hash: '', body: null, headers: {}, error: 'request failed' };
}

const rows = await Promise.all(BASES.map(async (base) => {
  const [config, status, sources] = await Promise.all([get(base, '/config.json'), get(base, '/status.json'), get(base, '/sources.json')]);
  return {
    base,
    checkedAt: new Date().toISOString(),
     config: { status: config.status, ok: config.ok, hash: config.hash, headers: config.headers, sites: config.body?.sites?.map((site) => ({ name: site.name, api: site.api, filterable: site.filterable, changeable: site.changeable, hasCategories: Object.prototype.hasOwnProperty.call(site, 'categories') })) || [], lives: config.body?.lives || [], registry: config.body?.registry || null },
    status: { status: status.status, ok: status.ok, hash: status.hash, headers: status.headers, version: status.body?.version, registryVersion: status.body?.registryVersion, revision: status.body?.revision, vod: status.body?.vod, live: status.body?.live, degraded: status.body?.degraded },
    sources: { status: sources.status, ok: sources.ok, hash: sources.hash, headers: sources.headers },
  };
}));

const validRows = rows.filter((row) => row.config.ok && row.status.ok);
const revisions = [...new Set(validRows.map((row) => row.status.revision).filter(Boolean))];
const versions = [...new Set(validRows.map((row) => row.status.version).filter(Boolean))];
const checks = {
  endpointsReachable: validRows.length === rows.length,
  sameRevision: revisions.length <= 1,
  sameVersion: versions.length <= 1,
  configNoStore: validRows.every((row) => /no-store/iu.test(row.config.headers.cacheControl || '')),
  statusNoStore: validRows.every((row) => /no-store/iu.test(row.status.headers.cacheControl || '')),
  sourceNamesDistinct: validRows.every((row) => new Set(row.config.sites.map((site) => site.name)).size === row.config.sites.length),
  liveNamesDistinct: validRows.every((row) => new Set(row.config.lives.map((site) => site.name)).size === row.config.lives.length),
  noCategoriesRewrite: validRows.every((row) => row.config.sites.every((site) => !site.hasCategories)),
  clientFieldContract: validRows.every((row) => row.config.sites.every((site) => [0, 1].includes(site.filterable) && [0, 1].includes(site.changeable))),
  noHealthLabels: validRows.every((row) => row.config.sites.every((site) => !/(?:WATCH|ACTIVE|REJECTED|\u89c2\u5bdf|\u5907\u7528)/iu.test(site.name))),
};
const report = { generatedAt: new Date().toISOString(), bases: BASES, checks, rows, pass: Object.values(checks).every(Boolean) };
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'deployment-truth-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(path.join(ROOT, 'audit', 'cache-coherence-latest.json'), JSON.stringify({ generatedAt: report.generatedAt, checks: { ...checks, sameConfigHash: new Set(validRows.map((row) => row.config.hash)).size <= 1, sameStatusHash: new Set(validRows.map((row) => row.status.hash)).size <= 1 }, rows: rows.map((row) => ({ base: row.base, config: row.config.headers, status: row.status.headers, revision: row.status.revision, version: row.status.version })) }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ generatedAt: report.generatedAt, pass: report.pass, checks: report.checks }, null, 2));
if (!report.pass) process.exitCode = 1;
