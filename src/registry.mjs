export const REGISTRY_VERSION = 'v8.1.0';

const RAW_SOURCES = [
  { slug: 'baidu', api: 'https://api.apibdzy.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 110 },
  { slug: 'bfzy', api: 'https://bfzyapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 109 },
  { slug: 'taopian', api: 'https://taopianapi.com/cjapi/mc/vod/json.html', seedStatus: 'ACTIVE', priority: 108 },
  { slug: 'huya', api: 'https://www.huyaapi.com/api.php/provide/vod/from/hym3u8/', seedStatus: 'ACTIVE', priority: 107 },
  { slug: 'hhzy', api: 'https://hhzyapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 106 },
  { slug: 'hongniu', api: 'https://www.hongniuzy2.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 105 },
  { slug: 'guangsu', api: 'https://api.guangsuapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 104 },
  { slug: 'modu', api: 'https://caiji.moduapi.cc/api.php/provide/vod/', seedStatus: 'WATCH', priority: 103 },
  { slug: 'xinlang', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/', seedStatus: 'WATCH', priority: 102 },
  { slug: 'lzi-direct', api: 'https://cj.lziapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 101 },
  { slug: 'ffzy-direct', api: 'http://ffzy.tv/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 100 },
  { slug: 'sdzy', api: 'http://sdzyapi.com/api.php/provide/vod/', seedStatus: 'WATCH', priority: 90 },
  { slug: 'ffzy', api: 'https://api.ffzyapi.com/api.php/provide/vod/', seedStatus: 'WATCH', priority: 89 },
  { slug: 'wujin', api: 'https://api.wujinapi.me/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 88 },
];

const RAW_LIVE_SOURCES = [
  { slug: 'fanmingming-index', api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u', seedStatus: 'WATCH', priority: 100 },
  { slug: 'fanmingming-itv', api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/itv.m3u', seedStatus: 'WATCH', priority: 99 },
  { slug: 'fanmingming-ipv6', api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u', seedStatus: 'WATCH', priority: 98 },
  { slug: 'iptv-org-cn', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u', seedStatus: 'WATCH', priority: 90 },
  { slug: 'zbds-ipv4', api: 'https://live.zbds.org/tv/iptv4.m3u', seedStatus: 'WATCH', priority: 89 },
  { slug: 'yang-gather', api: 'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u', seedStatus: 'WATCH', priority: 88 },
  { slug: 'kimentanm', api: 'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u', seedStatus: 'WATCH', priority: 87 },
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

export function candidateToRegistrySource(candidate, index = 0) {
  const kind = candidate.kind === 'live' ? 'live' : 'vod';
  const digest = String(candidate.api).replace(/[^a-z0-9]+/giu, '_').slice(-48);
  return {
    slug: `discovered_${kind}_${index}_${digest}`.toLowerCase(),
    api: candidate.api,
    kind,
    seedStatus: 'WATCH',
    priority: 10,
  };
}

export function sourceDisplayName(source, index = (source.kind === 'live' ? LIVE_SOURCE_REGISTRY : SOURCE_REGISTRY).indexOf(source)) {
  const prefix = source.kind === 'live' ? '\u76f4\u64ad\u7ebf\u8def' : '\u5f71\u89c6\u7ebf\u8def';
  return `${prefix} ${String(index + 1).padStart(2, '0')}`;
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
