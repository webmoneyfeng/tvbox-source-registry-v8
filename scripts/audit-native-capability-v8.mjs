import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_REGISTRY, tvSite } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = Number(process.env.NATIVE_AUDIT_TIMEOUT_MS || 8000);
const MAX_BYTES = 512 * 1024;
const TERMS = ['\u5929\u9053', '\u4eae\u5251', '\u738b\u5fd7\u6587'];

function rowsOf(data) {
  const value = data?.list ?? data?.data?.list ?? data?.data ?? [];
  return Array.isArray(value) ? value : [];
}

function classesOf(data) {
  const value = data?.class ?? data?.classes ?? data?.data?.class ?? [];
  return Array.isArray(value) ? value.map((item) => ({
    id: String(item?.type_id ?? item?.id ?? item?.typeId ?? '').trim(),
    name: String(item?.type_name ?? item?.name ?? item?.typeName ?? '').trim(),
    parentId: String(item?.type_pid ?? item?.pid ?? item?.parent_id ?? '').trim(),
  })).filter((item) => item.id && item.name) : [];
}

function sourceUrl(api, params = {}) {
  const url = new URL(api);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchDocument(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain,*/*', 'cache-control': 'no-cache', 'user-agent': 'tvbox-source-registry-native-audit/8.1.4' },
    });
    const text = (await response.text()).slice(0, MAX_BYTES);
    let data = null;
    try { data = JSON.parse(text.replace(/^\uFEFF/u, '').trim()); } catch {}
    return { url, status: response.status, ok: Boolean(response.ok), latencyMs: Date.now() - started, text, data, error: '' };
  } catch (error) {
    return { url, status: 0, ok: false, latencyMs: Date.now() - started, text: '', data: null, error: String(error?.message || error).slice(0, 240) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(api, params = {}) {
  const result = await fetchDocument(sourceUrl(api, params));
  return { ...result, schemaOk: Boolean(result.ok && result.data && typeof result.data === 'object') };
}

function filterInfo(data) {
  const raw = data?.filters ?? data?.data?.filters ?? {};
  const entries = Array.isArray(raw) ? raw.map((item, index) => [String(index), item]) : Object.entries(raw || {});
  const filters = entries.map(([categoryId, value]) => {
    const rows = Array.isArray(value) ? value : Array.isArray(value?.value) ? value.value : [];
    const options = rows.map((item) => ({
      key: String(item?.key ?? item?.value ?? item?.name ?? item ?? '').trim(),
      name: String(item?.name ?? item?.value ?? item ?? '').trim(),
    })).filter((item) => item.key || item.name);
    return { categoryId, options };
  }).filter((item) => item.options.length);
  const keys = [...new Set(filters.flatMap((item) => item.options.map((option) => option.key).filter(Boolean)))];
  const labels = filters.flatMap((item) => item.options.map((option) => option.name)).join(' ');
  return {
    filters,
    filterable: filters.some((item) => item.options.length >= 2),
    sortable: /(?:sort|order|time|latest|\u6700\u65b0|\u6392\u5e8f|\u66f4\u65b0)/iu.test(`${keys.join(' ')} ${labels}`),
    keys,
  };
}

function sampleFilterValue(info) {
  for (const filter of info.filters) {
    const option = filter.options.find((item) => item.key || item.name);
    if (option) return { [option.key || filter.categoryId]: option.key || option.name };
  }
  return null;
}

function directPlaybackInfo(data) {
  const row = rowsOf(data)[0] || null;
  const value = [row?.vod_play_url, row?.url, row?.vod_url, row?.vod_down_url].filter(Boolean).join(' ');
  const urls = [...new Set((value.match(/https?:\/\/[^\s$#|"'<>]+(?:m3u8|mp4|\.ts)(?:\?[^\s$|"'<>]*)?/giu) || []).map((item) => item.replace(/[),.;]+$/u, '')))]
    .filter((item) => !/(?:player\.html|iframe|parse|jiexi)/iu.test(item));
  return { directUrlCount: urls.length, directPlaybackEligible: urls.length > 0, sampleUrl: urls[0] || '' };
}

async function auditSource(source) {
  const home = await fetchJson(source.api);
  const listing = await fetchJson(source.api, { ac: 'list' });
  const data = listing.data || home.data || {};
  const classes = classesOf(data);
  const native = filterInfo(data);
  const classSample = classes[0] || null;
  const category = classSample ? await fetchJson(source.api, { ac: 'videolist', t: classSample.id, pg: 1 }) : null;
  const categoryRows = rowsOf(category?.data);
  const search = await Promise.all(TERMS.map(async (wd) => {
    const result = await fetchJson(source.api, { wd, pg: 1 });
    return { term: wd, status: result.status, ok: result.schemaOk && rowsOf(result.data).length > 0, count: rowsOf(result.data).length, latencyMs: result.latencyMs };
  }));
  const sample = rowsOf(listing.data || home.data)[0] || categoryRows[0] || null;
  const id = sample?.vod_id ?? sample?.id ?? sample?.vod_id_str ?? '';
  const detail = id ? await fetchJson(source.api, { ac: 'detail', ids: id }) : null;
  const playback = directPlaybackInfo(detail?.data);
  const filterValue = sampleFilterValue(native);
  const filtered = filterValue && classSample ? await fetchJson(source.api, { ac: 'videolist', t: classSample.id, pg: 1, f: JSON.stringify(filterValue) }) : null;
  const site = tvSite(source, 0, { health: { nativeFilterable: native.filterable, directPlaybackEligible: playback.directPlaybackEligible } });
  const result = {
    slug: source.slug,
    name: source.displayName,
    provider: source.provider,
    api: source.api,
    checkedAt: new Date().toISOString(),
    native: { classCount: classes.length, classes, ...native, filterProbe: filterValue ? { value: filterValue, status: filtered?.status || 0, schemaOk: Boolean(filtered?.schemaOk), count: rowsOf(filtered?.data).length } : null },
    requests: {
      home: { status: home.status, schemaOk: home.schemaOk, latencyMs: home.latencyMs },
      list: { status: listing.status, schemaOk: listing.schemaOk, latencyMs: listing.latencyMs },
      category: { id: classSample?.id || '', name: classSample?.name || '', status: category?.status || 0, schemaOk: Boolean(category?.schemaOk), count: categoryRows.length },
      search,
       detail: { id, status: detail?.status || 0, schemaOk: Boolean(detail?.schemaOk), count: rowsOf(detail?.data).length, ...playback },
    },
    client: {
      configFields: site,
      categoriesRewritten: Object.prototype.hasOwnProperty.call(site, 'categories'),
      filterableMatchesNative: site.filterable === (native.filterable ? 1 : 0),
      changeableMeansFallback: site.changeable === 1,
      changeableMatchesPlayback: site.changeable === (playback.directPlaybackEligible ? 1 : 0),
    },
  };
  result.pass = result.native.classCount > 0
    && result.requests.home.schemaOk
    && result.requests.list.schemaOk
    && result.requests.detail.schemaOk
    && !result.client.categoriesRewritten
    && result.client.filterableMatchesNative
    && result.client.changeableMatchesPlayback;
  return result;
}

const rows = [];
for (const source of SOURCE_REGISTRY) rows.push(await auditSource(source));
const report = {
  generatedAt: new Date().toISOString(),
  policy: 'Native categories, filters and request semantics are observed and passed through; no categories whitelist or synthetic sorting is generated.',
  sources: rows.length,
  passed: rows.filter((row) => row.pass).length,
  rows,
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'native-capability-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(path.join(ROOT, 'audit', 'client-request-contract-latest.json'), JSON.stringify({ generatedAt: report.generatedAt, rows: rows.map((row) => ({ slug: row.slug, client: row.client, requests: row.requests })) }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ generatedAt: report.generatedAt, sources: report.sources, passed: report.passed }, null, 2));
for (const row of rows) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.slug} nativeFilterable=${row.native.filterable} nativeSortable=${row.native.sortable}`);
