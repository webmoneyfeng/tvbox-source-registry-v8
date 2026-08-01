const PRIVATE_HOST_RE = /^(?:localhost|0\.|10\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.(?:0\.|168\.)|198\.(?:1[89])\.|2(?:2[4-9]|3\d|4\d|5[0-5])\.|\[?(?:::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:))/iu;
const DISALLOWED_CONFIG_KEY_RE = /(?:jar|spider|ext|parse|player|script)/iu;

export function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    if (PRIVATE_HOST_RE.test(url.hostname)) return false;
    if (url.hostname.includes('..') || url.hostname.length > 253) return false;
    if (url.port && !['80', '443'].includes(url.port)) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeCandidateUrl(value) {
  if (!isPublicHttpUrl(value)) return '';
  const url = new URL(String(value));
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

export function physicalCandidateKey(value) {
  const normalized = normalizeCandidateUrl(value);
  if (!normalized) return '';
  const url = new URL(normalized);
  return `${url.hostname.replace(/^www\./u, '')}${url.port ? ':' + url.port : ''}${url.pathname}`;
}

export function extractCandidates(payload, feedUrl = '') {
  const candidates = [];
  if (typeof payload === 'string' && /^\s*#EXTM3U/iu.test(payload)) {
    const playlistUrl = normalizeCandidateUrl(feedUrl);
    if (playlistUrl) candidates.push({ kind: 'live', api: playlistUrl, discoveredFrom: feedUrl });
    return candidates;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return candidates;
  const sites = Array.isArray(payload.sites) ? payload.sites : [];
  for (const site of sites) {
    if (!site || Number(site.type || 1) !== 1) continue;
    if (DISALLOWED_CONFIG_KEY_RE.test(Object.keys(site).filter((key) => site[key]).join(' '))) continue;
    const api = normalizeCandidateUrl(site.api);
    if (!api) continue;
    candidates.push({ kind: 'vod', api, name: String(site.name || '').trim(), discoveredFrom: feedUrl });
  }
  const lives = Array.isArray(payload.lives) ? payload.lives : [];
  for (const live of lives) {
    const api = normalizeCandidateUrl(live?.url);
    if (!api) continue;
    candidates.push({ kind: 'live', api, name: String(live?.name || '').trim(), discoveredFrom: feedUrl });
  }
  return candidates;
}

export function extractConfigReferences(payload, feedUrl = '') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const references = [];
  for (const entry of Array.isArray(payload.urls) ? payload.urls : []) {
    const raw = typeof entry === 'string' ? entry : (entry?.url || entry?.api);
    const api = normalizeCandidateUrl(raw);
    if (!api) continue;
    if (DISALLOWED_CONFIG_KEY_RE.test(JSON.stringify(entry))) continue;
    references.push({
      kind: 'config',
      api,
      name: typeof entry === 'object' ? String(entry.name || '').trim() : '',
      discoveredFrom: feedUrl,
    });
  }
  return references;
}

export function dedupeCandidates(candidates = []) {
  const result = new Map();
  for (const candidate of candidates) {
    const api = normalizeCandidateUrl(candidate?.api);
    if (!api) continue;
    const kind = candidate.kind === 'live' ? 'live' : 'vod';
    const key = `${kind}:${physicalCandidateKey(api)}`;
    if (!result.has(key)) result.set(key, { ...candidate, kind, api, physicalKey: physicalCandidateKey(api), state: 'CANDIDATE' });
  }
  return [...result.values()];
}
