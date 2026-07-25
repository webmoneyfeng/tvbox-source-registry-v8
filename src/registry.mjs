export const REGISTRY_VERSION = 'v8.1.3';

const RAW_SOURCES = [
  { slug: 'baidu', displayName: '\u767e\u5ea6\u8d44\u6e90', provider: 'baidu', api: 'https://api.apibdzy.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 110 },
  { slug: 'hongniu', displayName: '\u7ea2\u725b\u76f4\u8fde', provider: 'hongniu', api: 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8/', seedStatus: 'ACTIVE', priority: 109 },
  { slug: 'modu', displayName: '\u9b54\u90fd\u52a8\u6f2b', provider: 'modu', api: 'https://caiji.moduapi.cc/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 108 },
  { slug: 'lzi', displayName: '\u91cf\u5b50\u76f4\u8fde', provider: 'lzi', api: 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8/', seedStatus: 'ACTIVE', priority: 107 },
  { slug: 'bfzy', displayName: '\u66b4\u98ce\u8d44\u6e90', provider: 'bfzy', api: 'https://bfzyapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 106 },
  { slug: 'jszy', displayName: '\u6781\u901f\u76f4\u8fde', provider: 'jszy', api: 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8/', seedStatus: 'ACTIVE', priority: 105 },
  { slug: 'jinying', displayName: '\u91d1\u9e70\u76f4\u8fde', provider: 'jinying', api: 'https://jyzyapi.com/provide/vod/from/jinyingm3u8/', seedStatus: 'ACTIVE', priority: 104 },
  { slug: 'zuida', displayName: '\u6700\u5927\u8d44\u6e90', provider: 'zuida', api: 'https://api.zuidapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 103 },
  { slug: 'lovedan', displayName: '\u7231\u65e6\u8d44\u6e90', provider: 'lovedan', api: 'https://www.lovedan.net/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 102 },
  { slug: '360zy', displayName: '360\u76f4\u8fde', provider: '360zy', api: 'https://360zy.com/api.php/provide/vod/from/360zy/', seedStatus: 'ACTIVE', priority: 101 },
];

const RAW_LIVE_SOURCES = [
  { slug: 'fanmingming-ipv6', displayName: '\u8303\u660e\u660e IPv6', provider: 'fanmingming', api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u', seedStatus: 'ACTIVE', priority: 110 },
  { slug: 'zbds-ipv4', displayName: 'ZBDS IPv4', provider: 'zbds', api: 'https://live.zbds.org/tv/iptv4.m3u', seedStatus: 'ACTIVE', priority: 109 },
  { slug: 'iptv-org-jp', displayName: 'IPTV-org \u65e5\u672c', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u', seedStatus: 'ACTIVE', priority: 108 },
  { slug: 'iptv-org-in', displayName: 'IPTV-org \u5370\u5ea6', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u', seedStatus: 'ACTIVE', priority: 107 },
  { slug: 'iptv-org-it', displayName: 'IPTV-org \u610f\u5927\u5229', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/it.m3u', seedStatus: 'ACTIVE', priority: 106 },
  { slug: 'iptv-org-us', displayName: 'IPTV-org \u7f8e\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u', seedStatus: 'ACTIVE', priority: 105 },
  { slug: 'iptv-org-uk', displayName: 'IPTV-org \u82f1\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/uk.m3u', seedStatus: 'ACTIVE', priority: 104 },
  { slug: 'iptv-org-de', displayName: 'IPTV-org \u5fb7\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/de.m3u', seedStatus: 'ACTIVE', priority: 103 },
  { slug: 'iptv-org-fr', displayName: 'IPTV-org \u6cd5\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u', seedStatus: 'ACTIVE', priority: 102 },
  { slug: 'iptv-org-th', displayName: 'IPTV-org \u6cf0\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/th.m3u', seedStatus: 'ACTIVE', priority: 101 },
  { slug: 'iptv-org-es', displayName: 'IPTV-org \u897f\u73ed\u7259', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/es.m3u', seedStatus: 'ACTIVE', priority: 100 },
  { slug: 'iptv-org-nl', displayName: 'IPTV-org \u8377\u5170', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/nl.m3u', seedStatus: 'ACTIVE', priority: 99 },
];

function canonicalApi(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('unsupported source protocol');
  if (url.username || url.password) throw new TypeError('source URL must not contain credentials');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/gu, '/');
  url.searchParams.sort();
  return url.toString();
}

export function physicalSourceKey(value) {
  const url = new URL(canonicalApi(value));
  return url.hostname.replace(/^www\./u, '') + (url.port ? ':' + url.port : '');
}

export function loadRegistry(rows = RAW_SOURCES, kind = 'vod') {
  if (!Array.isArray(rows)) throw new TypeError('registry must be an array');
  const seenSlug = new Set();
  const seenPhysical = new Set();
  const normalized = rows.map((row) => {
    const slug = String(row.slug || '').trim().toLowerCase();
    const api = canonicalApi(row.api);
    const sourceKind = String(row.kind || kind || 'vod').trim().toLowerCase();
    const seedStatus = String(row.seedStatus || '').trim().toUpperCase();
    const basePhysicalKey = physicalSourceKey(api);
    const physicalKey = sourceKind === 'live' ? basePhysicalKey + new URL(api).pathname : basePhysicalKey;
    if (!slug) throw new TypeError('source slug is required');
    if (!['ACTIVE', 'WATCH'].includes(seedStatus)) throw new TypeError('invalid seed status for ' + slug);
    if (!['vod', 'live'].includes(sourceKind)) throw new TypeError('invalid source kind for ' + slug);
    if (seenSlug.has(slug)) throw new TypeError('duplicate source slug: ' + slug);
    const physicalKeyWithKind = sourceKind + ':' + physicalKey;
    if (seenPhysical.has(physicalKeyWithKind)) throw new TypeError('duplicate physical source: ' + physicalKey);
    seenSlug.add(slug);
    seenPhysical.add(physicalKeyWithKind);
    return Object.freeze({
      slug,
      displayName: String(row.displayName || '').trim(),
      provider: String(row.provider || slug).trim().toLowerCase(),
      qualityTier: String(row.qualityTier || 'operational').trim().toLowerCase(),
      key: 'registry_' + sourceKind + '_' + slug.replace(/[^a-z0-9]+/gu, '_'),
      kind: sourceKind,
      api,
      seedStatus,
      priority: Number(row.priority) || 0,
      physicalKey,
    });
  });
  return Object.freeze(normalized.sort((a, b) => b.priority - a.priority));
}

export const SOURCE_REGISTRY = loadRegistry();
export const LIVE_SOURCE_REGISTRY = loadRegistry(RAW_LIVE_SOURCES, 'live');

export function mergeRegistries(...registries) {
  const rows = registries.flat().map((source) => ({ ...source, kind: source.kind || 'vod' }));
  return loadRegistry(rows, 'vod');
}

export function candidateToRegistrySource(candidate) {
  const kind = candidate.kind === 'live' ? 'live' : 'vod';
  const api = canonicalApi(candidate.api);
  const digest = api.replace(/[^a-z0-9]+/giu, '_').slice(-48);
  const physicalKey = kind === 'live'
    ? physicalSourceKey(api) + new URL(api).pathname
    : physicalSourceKey(api);
  return {
    slug: `discovered_${kind}_${digest}`.toLowerCase(),
    displayName: String(candidate.displayName || candidate.name || '').trim(),
    provider: String(candidate.provider || candidate.name || kind).trim().toLowerCase(),
    qualityTier: 'candidate',
    api,
    kind,
    seedStatus: 'WATCH',
    priority: 10,
    physicalKey,
  };
}

export function sourceDisplayName(source, index = (source.kind === 'live' ? LIVE_SOURCE_REGISTRY : SOURCE_REGISTRY).indexOf(source)) {
  if (source.displayName) return source.displayName;
  try { return new URL(source.api).hostname.replace(/^www\./u, ''); }
  catch { return source.slug || `source-${index + 1}`; }
}

export function tvSite(source, index, { quickSearch = false } = {}) {
  return {
    key: source.key,
    name: sourceDisplayName(source, index),
    type: 1,
    api: source.api,
    searchable: 1,
    quickSearch: quickSearch ? 1 : 0,
    filterable: 0,
    changeable: 0,
  };
}
