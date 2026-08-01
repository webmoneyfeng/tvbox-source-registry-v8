const SOURCE_SECTION_RE = /^##\s*(接口源|直播源)/u;
const NEXT_SECTION_RE = /^##\s+/u;
const URL_RE = /https?:\/\/[^\s\t)\]<>`]+/giu;

function cleanUrl(value) {
  return String(value || '')
    .trim()
    .replace(/[，。；;、]+$/u, '')
    .replace(/[)\]]+$/u, '')
    .replace(/^</u, '')
    .replace(/>$/u, '');
}

function cleanLabel(value) {
  return String(value || '')
    .replace(/^[\s>*`|\-]+/gu, '')
    .replace(/[`|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function commentLabel(line, url) {
  const hash = line.indexOf('#');
  if (hash >= 0) return cleanLabel(line.slice(hash + 1));
  return cleanLabel(line.replace(url, '')).slice(0, 80);
}

export function parseTvappReadmeSources(markdown) {
  const lines = String(markdown || '').replace(/^\uFEFF/u, '').split(/\r?\n/u);
  let section = '';
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(SOURCE_SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section && NEXT_SECTION_RE.test(line)) {
      section = '';
      continue;
    }
    if (!section) continue;
    let match;
    while ((match = URL_RE.exec(line))) {
      const url = cleanUrl(match[0]);
      if (!url) continue;
      entries.push({
        line: index + 1,
        section,
        kind: section === '直播源' ? 'live' : 'vod_index',
        label: commentLabel(line, url),
        url,
      });
    }
  }
  return entries;
}

export function tvappKnownNameForUrl(value) {
  const raw = String(value || '');
  let url;
  try { url = new URL(raw); } catch { return ''; }
  const normalized = `${url.hostname.toLowerCase()}${url.pathname}`.toLowerCase();
  const exact = new Map([
    ['raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u', 'IPTV-org 台湾'],
    ['raw.githubusercontent.com/kimentanm/aptv/master/m3u/iptv.m3u', 'Kimentanm IPTV'],
    ['raw.githubusercontent.com/pizazzgy/tv/master/output/user_result.txt', '潇洒 AI 直播 TXT'],
    ['raw.githubusercontent.com/pizazzgy/tv/master/output/user_result.m3u', '潇洒 AI 直播 M3U'],
    ['raw.githubusercontent.com/free-tv/iptv/master/playlist.m3u8', 'Free-TV 世界频道'],
    ['raw.githubusercontent.com/bigbiggrandg/iptv-url/release/gather.m3u', 'BigBigGrandG IPTV'],
    ['raw.githubusercontent.com/vamoschuck/tv/main/m3u', '茶客 IPTV'],
    ['raw.githubusercontent.com/suxuang/myiptv/refs/heads/main/ipv4.m3u', 'Suxuang IPv4'],
    ['raw.githubusercontent.com/suxuang/myiptv/refs/heads/main/ipv6.m3u', 'Suxuang IPv6'],
    ['live.zbds.top/tv/iptv4.txt', 'ZBDS IPv4 TXT'],
    ['live.zbds.top/tv/iptv4.m3u', 'ZBDS IPv4 M3U'],
    ['live.zbds.top/tv/iptv6.txt', 'ZBDS IPv6 TXT'],
    ['live.zbds.top/tv/iptv6.m3u', 'ZBDS IPv6 M3U'],
    ['develop202.github.io/migu_video/interface.txt', '咪咕 IPTV'],
    ['www.iyouhun.com/tv/zb', '游魂直播源'],
    ['iptv-org.github.io/iptv/index.m3u', 'IPTV-org 全量'],
    ['epg.pw/test_channels.m3u', 'EPG.pw 中国大陆'],
    ['epg.pw/test_channels_taiwan.m3u', 'EPG.pw 台湾'],
    ['gongdian.top/tv/mursor/yylunbo.m3u', 'YY 轮播'],
    ['gongdian.top/tv/mursor/bililive.m3u', '哔哩哔哩直播源'],
  ]);
  return exact.get(normalized) || '';
}
