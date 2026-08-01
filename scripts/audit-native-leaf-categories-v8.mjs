import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.TVBOX_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/u, '');
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 15000);
const SAMPLE_LIMIT = Math.max(1, Number(process.env.AUDIT_CATEGORY_SAMPLE || 6));

async function getJson(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'native-leaf-category-audit/1.0' },
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { url, status: response.status, ok: response.ok && Boolean(json), json, text: text.slice(0, 240) };
  } catch (error) {
    return { url, status: 0, ok: false, json: null, text: String(error?.message || error).slice(0, 240) };
  }
}

function classesOf(value) {
  return Array.isArray(value?.class) ? value.class : [];
}

function listOf(value) {
  return Array.isArray(value?.list) ? value.list : [];
}

const config = await getJson(`${BASE}/config.json?audit=native-leaf`);
const sourceStatus = await getJson(`${BASE}/sources.json?audit=native-leaf`);
const sites = config.json?.sites || [];
const healthByKey = new Map((sourceStatus.json?.sources || []).map((row) => [row.key, row]));
const rows = [];
for (const site of sites) {
  const listing = await getJson(`${site.api}?ac=list`);
  const classes = classesOf(listing.json);
  const categorySamples = [];
  for (const cls of classes.slice(0, SAMPLE_LIMIT)) {
    const id = String(cls.type_id ?? cls.id ?? '').trim();
    const item = await getJson(`${site.api}?ac=videolist&t=${encodeURIComponent(id)}&pg=1`);
    const list = listOf(item.json);
    categorySamples.push({
      id,
      name: String(cls.type_name ?? cls.name ?? ''),
      status: item.status,
      count: list.length,
    });
  }
  rows.push({
    site: site.name,
    key: site.key,
    api: site.api,
    listingStatus: listing.status,
    classCount: classes.length,
    manifestVisibleCount: Number(healthByKey.get(site.key)?.health?.nativeCategoryManifest?.visibleCount || 0),
    hiddenCategories: (healthByKey.get(site.key)?.health?.nativeCategoryManifest?.rows || [])
      .filter((row) => !row.visible)
      .map((row) => ({ id: row.id, name: row.name, reason: row.hiddenReason })),
    emptyVisibleSamples: categorySamples.filter((row) => row.count === 0),
    categorySamples,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  configStatus: config.status,
  siteCount: sites.length,
  rows,
  pass: config.ok && sites.length > 0 && rows.every((row) => row.classCount > 0 && row.emptyVisibleSamples.length === 0),
};

const auditDir = path.join(ROOT, 'audit');
await mkdir(auditDir, { recursive: true });
await writeFile(path.join(auditDir, 'native-leaf-category-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(path.join(auditDir, 'native-leaf-category-summary.md'), [
  '# Native Leaf Category Audit',
  '',
  `Generated: ${report.generatedAt}`,
  `Base: ${BASE}`,
  `Sites: ${report.siteCount}`,
  `Pass: ${report.pass}`,
  '',
  ...rows.map((row) => `- ${row.site}: class=${row.classCount}, emptySamples=${row.emptyVisibleSamples.length}`),
].join('\n') + '\n', 'utf8');

console.log(JSON.stringify({ pass: report.pass, siteCount: report.siteCount }, null, 2));
