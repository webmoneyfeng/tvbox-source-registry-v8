import { isPublicHttpUrl } from './discovery.mjs';

const INFRASTRUCTURE_AD_RE = /(\u5e7f\u544a|\u516c\u4f17\u53f7|\u52a0\u7fa4|\u4e8c\u7ef4\u7801|\u63a8\u5e7f|\u6c38\u4e45\u5730\u5740|\u53d1\u5e03\u9875|\u5b98\u7f51\u5730\u5740|\u514d\u8d39\u8ba2\u9605)/iu;
const GROUP_RE = /group-title\s*=\s*["']([^"']*)["']/iu;

function text(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function attr(line, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'iu');
  return text(line.match(re)?.[1] || '');
}

export function normalizeLiveUrl(value) {
  const raw = text(value);
  if (!/^https?:\/\//iu.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (!isPublicHttpUrl(url.toString())) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeChannelName(value) {
  return text(value)
    .replace(/超高清|高清|标清|超清|FHD|UHD|HD|SD/giu, '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function dedupeChannels(channels) {
  const unique = new Map();
  const names = new Set();
  const urls = new Set();
  for (const channel of channels) {
    const nameKey = normalizeChannelName(channel.name) || normalizeChannelName(channel.url);
    const urlKey = channel.url;
    const key = `${nameKey}|${urlKey}`;
    if (names.has(nameKey) || urls.has(urlKey) || unique.has(key)) continue;
    names.add(nameKey);
    urls.add(urlKey);
    unique.set(key, channel);
  }
  return [...unique.values()];
}

export function parseM3U(input) {
  const lines = String(input ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/gu).map(text);
  const channels = [];
  let pending = null;
  let epgUrl = '';
  const header = lines.find((line) => line.startsWith('#EXTM3U')) || '';
  if (header) epgUrl = attr(header, 'x-tvg-url') || attr(header, 'url-tvg');

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',');
      const fallbackName = comma >= 0 ? text(line.slice(comma + 1)) : '';
      pending = {
        name: attr(line, 'tvg-name') || fallbackName,
        group: line.match(GROUP_RE)?.[1] ? text(line.match(GROUP_RE)[1]) : '\u5176\u4ed6',
        logo: attr(line, 'tvg-logo'),
        tvgId: attr(line, 'tvg-id'),
      };
      continue;
    }
    if (line.startsWith('#')) continue;
    const url = normalizeLiveUrl(line);
    if (!url || !pending) {
      pending = null;
      continue;
    }
    const channel = { ...pending, name: pending.name || url, url };
    if (!INFRASTRUCTURE_AD_RE.test(`${channel.name} ${channel.group} ${channel.url}`)) channels.push(channel);
    pending = null;
  }

  const rawChannelCount = channels.length;
  const uniqueChannels = dedupeChannels(channels);
  return { header, epgUrl, rawChannelCount, channels: uniqueChannels };
}

export function liveContract(input) {
  const parsed = parseM3U(input);
  const groups = new Set(parsed.channels.map((channel) => channel.group).filter(Boolean));
  const duplicateRate = parsed.rawChannelCount ? 1 - (parsed.channels.length / parsed.rawChannelCount) : 1;
  return {
    ok: Boolean(parsed.header && parsed.channels.length >= 5 && groups.size >= 1),
    channelCount: parsed.channels.length,
    groupCount: groups.size,
    duplicateRate: Number(duplicateRate.toFixed(4)),
    epgUrl: parsed.epgUrl,
    sample: parsed.channels.slice(0, 5),
  };
}

export { dedupeChannels };

export function channelSample(channels, limit = 5) {
  if (!Array.isArray(channels) || channels.length <= limit) return channels || [];
  const selected = [];
  const step = Math.max(1, Math.floor(channels.length / limit));
  for (let i = 0; i < channels.length && selected.length < limit; i += step) selected.push(channels[i]);
  return selected;
}
