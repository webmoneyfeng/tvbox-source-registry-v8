export const REGISTRY_VERSION = 'v8.2.4';

const RAW_SOURCES = [
  { slug: 'hhzy-m3u8', displayName: '\u8c6a\u534e\u76f4\u8fde', provider: 'hhzy', api: 'https://hhzyapi.com/api.php/provide/vod/from/hhm3u8/', seedStatus: 'ACTIVE', priority: 120 },
  { slug: 'hongniu-m3u8', displayName: '\u7ea2\u725b\u76f4\u8fde', provider: 'hongniu', api: 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8/', seedStatus: 'ACTIVE', priority: 119 },
  { slug: 'modu', displayName: '\u9b54\u90fd\u52a8\u6f2b', provider: 'modu', api: 'https://caiji.moduapi.cc/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 118 },
  { slug: 'lzi-m3u8', displayName: '\u91cf\u5b50\u76f4\u8fde', provider: 'lzi', api: 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8/', seedStatus: 'ACTIVE', priority: 117 },
  { slug: 'ffzy-m3u8', displayName: '\u975e\u51e1\u76f4\u8fde', provider: 'ffzy', api: 'https://ffzy.tv/api.php/provide/vod/from/ffm3u8/', seedStatus: 'ACTIVE', priority: 116 },
  { slug: 'jinying', displayName: '\u91d1\u9e70\u8d44\u6e90', provider: 'jinying', api: 'https://jyzyapi.com/provide/vod/from/jinyingm3u8/', seedStatus: 'ACTIVE', priority: 115 },
  { slug: 'zuida', displayName: '\u6700\u5927\u8d44\u6e90', provider: 'zuida', api: 'https://api.zuidapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 114 },
  { slug: 'subo-m3u8', displayName: '\u901f\u64ad\u76f4\u8fde', provider: 'subo', api: 'https://suboziyuan.net/api.php/provide/vod/from/subm3u8/', seedStatus: 'ACTIVE', priority: 113 },
  { slug: '360zy-direct', displayName: '360\u76f4\u8fde', provider: '360zy', api: 'https://360zy.com/api.php/provide/vod/from/360zy/', seedStatus: 'ACTIVE', priority: 112 },
  { slug: 'xinlang-m3u8', displayName: '\u65b0\u6d6a\u76f4\u8fde', provider: 'xinlang', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/from/xlm3u8/', seedStatus: 'ACTIVE', priority: 111 },
  { slug: 'baidu', displayName: '\u767e\u5ea6\u8d44\u6e90', provider: 'baidu', api: 'https://api.apibdzy.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 110 },
  { slug: 'bfzy', displayName: '\u66b4\u98ce\u8d44\u6e90', provider: 'bfzy', api: 'https://bfzyapi.com/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 109 },
  { slug: 'jszy-m3u8', displayName: '\u6781\u901f\u76f4\u8fde', provider: 'jszy', api: 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8/', seedStatus: 'ACTIVE', priority: 108 },
  { slug: 'lovedan', displayName: '\u7231\u65e6\u8d44\u6e90', provider: 'lovedan', api: 'https://www.lovedan.net/api.php/provide/vod/', seedStatus: 'ACTIVE', priority: 107 },
  { slug: 'sdzy-vod', displayName: '\u95ea\u7535\u8d44\u6e90(\u5207)', provider: 'sdzy', api: 'http://sdzyapi.com/api.php/provide/vod/', seedStatus: 'WATCH', qualityTier: 'candidate', priority: 90 },
  { slug: 'guangsu-vod', displayName: '\u5149\u901f\u8d44\u6e90(\u5207)', provider: 'guangsu', api: 'https://api.guangsuapi.com/api.php/provide/vod/', seedStatus: 'WATCH', qualityTier: 'candidate', priority: 89 },
];

const RAW_LIVE_SOURCES = [
  { slug: 'fanmingming-ipv6', displayName: '\u8303\u660e\u660e IPv6', provider: 'fanmingming', api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u', seedStatus: 'ACTIVE', priority: 110 },
  { slug: 'iptv-org-cn', displayName: 'IPTV-org \u4e2d\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u', seedStatus: 'ACTIVE', priority: 109 },
  { slug: 'iptv-org-hk', displayName: 'IPTV-org \u9999\u6e2f', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u', seedStatus: 'ACTIVE', priority: 108 },
  { slug: 'iptv-org-kr', displayName: 'IPTV-org \u97e9\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/kr.m3u', seedStatus: 'ACTIVE', priority: 107 },
  { slug: 'iptv-org-us', displayName: 'IPTV-org \u7f8e\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u', seedStatus: 'ACTIVE', priority: 106 },
  { slug: 'iptv-org-uk', displayName: 'IPTV-org \u82f1\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/uk.m3u', seedStatus: 'ACTIVE', priority: 105 },
  { slug: 'iptv-org-de', displayName: 'IPTV-org \u5fb7\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/de.m3u', seedStatus: 'ACTIVE', priority: 104 },
  { slug: 'iptv-org-ca', displayName: 'IPTV-org \u52a0\u62ff\u5927', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ca.m3u', seedStatus: 'ACTIVE', priority: 103 },
  { slug: 'suxuang-ipv4', displayName: 'Suxuang IPv4', provider: 'suxuang', api: 'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u', seedStatus: 'ACTIVE', priority: 102 },
  { slug: 'guovin-result', displayName: 'Guovin \u6c47\u603b', provider: 'guovin', api: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u', seedStatus: 'ACTIVE', priority: 101 },
  { slug: 'guovin-ipv4', displayName: 'Guovin IPv4', provider: 'guovin', api: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.m3u', seedStatus: 'ACTIVE', priority: 100 },
  { slug: 'iptv-org-th', displayName: 'IPTV-org \u6cf0\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/th.m3u', seedStatus: 'ACTIVE', priority: 99 },
  { slug: 'iptv-org-vn', displayName: 'IPTV-org \u8d8a\u5357', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/vn.m3u', seedStatus: 'ACTIVE', priority: 98 },
  { slug: 'iptv-org-it', displayName: 'IPTV-org \u610f\u5927\u5229', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/it.m3u', seedStatus: 'ACTIVE', priority: 97 },
  { slug: 'iptv-org-in', displayName: 'IPTV-org \u5370\u5ea6', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u', seedStatus: 'ACTIVE', priority: 96 },
  { slug: 'iptv-org-br', displayName: 'IPTV-org \u5df4\u897f', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br.m3u', seedStatus: 'ACTIVE', priority: 95 },
  { slug: 'zbds-ipv4', displayName: 'ZBDS IPv4', provider: 'zbds', api: 'https://live.zbds.org/tv/iptv4.m3u', seedStatus: 'ACTIVE', priority: 94 },
  { slug: 'fanmingming-index', displayName: '\u8303\u660e\u660e\u5168\u91cf', provider: 'fanmingming', api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u', seedStatus: 'ACTIVE', priority: 93 },
  { slug: 'migu-live', displayName: '\u54aa\u5495\u76f4\u64ad', provider: 'migu', api: 'https://develop202.github.io/migu_video/interface.txt', seedStatus: 'ACTIVE', priority: 92 },
  { slug: 'iptv-org-jp', displayName: 'IPTV-org \u65e5\u672c', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u', seedStatus: 'ACTIVE', priority: 91 },
  { slug: 'iptv-org-au', displayName: 'IPTV-org \u6fb3\u5927\u5229\u4e9a', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/au.m3u', seedStatus: 'ACTIVE', priority: 90 },
  { slug: 'iptv-org-fr', displayName: 'IPTV-org \u6cd5\u56fd', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u', seedStatus: 'ACTIVE', priority: 89 },
  { slug: 'iptv-org-sg', displayName: 'IPTV-org \u65b0\u52a0\u5761', provider: 'iptv-org', api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/sg.m3u', seedStatus: 'ACTIVE', priority: 88 },
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
  try {
    const url = new URL(source.api);
    const host = url.hostname.replace(/^www\./u, '');
    const path = url.pathname.replace(/\/+$/u, '').split('/').filter(Boolean).slice(-2).join('/');
    return path ? `${host} / ${path}` : host;
  }
  catch { return source.slug || `source-${index + 1}`; }
}

export function tvSite(source, index, { quickSearch = false, health = null, api = source.api } = {}) {
  const nativeFilterable = health?.nativeFilterable === true || source.nativeFilterable === true;
  const changeable = health?.directPlaybackEligible === true || source.directPlaybackEligible === true;
  const searchable = health?.searchCapability === true || source.searchable === true;
  return {
    key: source.key,
    name: sourceDisplayName(source, index),
    type: 1,
    api,
    searchable: searchable ? 1 : 0,
    quickSearch: quickSearch && searchable ? 1 : 0,
    filterable: nativeFilterable ? 1 : 0,
    changeable: changeable ? 1 : 0,
  };
}
