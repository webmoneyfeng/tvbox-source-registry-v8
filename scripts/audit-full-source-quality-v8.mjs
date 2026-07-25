import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicHttpUrl, physicalCandidateKey } from '../src/discovery.mjs';
import { normalizeLiveUrl, parseM3U } from '../src/live.mjs';
import { LIVE_SOURCE_REGISTRY, SOURCE_REGISTRY } from '../src/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 9000);
const SOURCE_CONCURRENCY = Number(process.env.AUDIT_SOURCE_CONCURRENCY || 3);
const REQUEST_CONCURRENCY = Number(process.env.AUDIT_REQUEST_CONCURRENCY || 8);
const LIVE_SAMPLE_MAX = Number(process.env.AUDIT_LIVE_SAMPLE_MAX || 60);
const API_MAX_BYTES = 1024 * 1024;
const PLAYLIST_MAX_BYTES = 3 * 1024 * 1024;
const MEDIA_MAX_BYTES = 128 * 1024;
const SEARCH_TERMS = ['\u5929\u9053', '\u4eae\u5251', '\u7504\u5b1b\u4f20', '\u6d41\u6d6a\u5730\u7403', '\u54ea\u5412'];
const INFRASTRUCTURE_RE = /(?:\u5e7f\u544a\u4f4d|\u516c\u4f17\u53f7|\u52a0\u7fa4|\u4e8c\u7ef4\u7801|\u5546\u52a1\u5408\u4f5c|\u53d1\u5e03\u9875|\u6c38\u4e45\u5730\u5740|player\.html|<iframe\b|(?:parse|jiexi)\s*[:=/])/iu;
const QUALITY_RE = /(?:4k|2160p?|uhd|2k|1440p?|1080p?|fhd|full\s*hd|\u9ad8\u6e05|\u8d85\u6e05|\u84dd\u5149|hd\b)/iu;
const MEDIA_RE = /https?:\/\/[^\s$#|"'<>]+(?:m3u8|mp4|\.ts)(?:\?[^\s$|"'<>]*)?/giu;

const VOD_CANDIDATES = [
  ['baidu', '\u767e\u5ea6\u8d44\u6e90', 'https://api.apibdzy.com/api.php/provide/vod/', 'baidu'],
  ['bfzy', '\u66b4\u98ce\u8d44\u6e90', 'https://bfzyapi.com/api.php/provide/vod/', 'bfzy'],
  ['hhzy', '\u8c6a\u534e\u8d44\u6e90', 'https://hhzyapi.com/api.php/provide/vod/', 'hhzy'],
  ['hongniu', '\u7ea2\u725b\u8d44\u6e90', 'https://www.hongniuzy2.com/api.php/provide/vod/', 'hongniu'],
  ['modu', '\u9b54\u90fd\u52a8\u6f2b', 'https://caiji.moduapi.cc/api.php/provide/vod/', 'modu'],
  ['lzi', '\u91cf\u5b50\u8d44\u6e90', 'https://cj.lziapi.com/api.php/provide/vod/', 'lzi'],
  ['ffzy', '\u975e\u51e1\u8d44\u6e90', 'http://ffzy.tv/api.php/provide/vod/', 'ffzy'],
  ['jszy', '\u6781\u901f\u8d44\u6e90', 'https://jszyapi.com/api.php/provide/vod/', 'jszy'],
  ['rycj', '\u5982\u610f\u8d44\u6e90', 'https://cj.rycjapi.com/api.php/provide/vod/', 'rycj'],
  ['jinying', '\u91d1\u9e70\u8d44\u6e90', 'https://jyzyapi.com/provide/vod/', 'jinying'],
  ['zuida', '\u6700\u5927\u8d44\u6e90', 'https://api.zuidapi.com/api.php/provide/vod/', 'zuida'],
  ['subo', '\u901f\u64ad\u8d44\u6e90', 'http://suboziyuan.net/api.php/provide/vod/', 'subo'],
  ['subo-cj', '\u901f\u64ad\u91c7\u96c6', 'https://subocaiji.com/api.php/provide/vod/', 'subo'],
  ['lovedan', '\u7231\u65e6\u8d44\u6e90', 'https://www.lovedan.net/api.php/provide/vod/', 'lovedan'],
  ['yinghua', '\u6a31\u82b1\u8d44\u6e90', 'https://m3u8.apiyhzy.com/api.php/provide/vod/', 'yinghua'],
  ['wujin', '\u65e0\u5c3d\u8d44\u6e90', 'https://api.wujinapi.net/api.php/provide/vod/', 'wujin'],
  ['uku', 'U\u9177\u8d44\u6e90', 'https://api.ukuapi.com/api.php/provide/vod/', 'uku'],
  ['ikun', 'iKun\u8d44\u6e90', 'https://ikunzyapi.com/api.php/provide/vod', 'ikun'],
  ['dianyinggou', '\u7535\u5f71\u72d7\u8d44\u6e90', 'https://api.dianyinggou.com/api.php/provide/vod/', 'dianyinggou'],
  ['alyzy', '\u963f\u91cc\u8d44\u6e90', 'https://cms.alyzy.xyz/api.php/provide/vod/', 'alyzy'],
  ['360zy', '360\u8d44\u6e90', 'https://360zy.com/api.php/provide/vod/', '360zy'],
  ['heimuer', '\u9ed1\u6728\u8033\u8d44\u6e90', 'https://json02.heimuer.xyz/api.php/provide/vod/', 'heimuer'],
  ['xinlang', '\u65b0\u6d6a\u8d44\u6e90', 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/', 'xinlang'],
  ['taopian', '\u6dd8\u7247\u8d44\u6e90', 'https://taopianapi.com/cjapi/mc/vod/json.html', 'taopian'],
  ['xiaohu', '\u5c0f\u80e1\u8d44\u6e90', 'http://c.xn--yetu07f.icu/api.php/provide/vod/', 'xiaohu'],
  ['suoni', '\u7d22\u5c3c\u8d44\u6e90', 'https://suoniapi.com/api.php/provide/vod/?ac=list', 'suoni'],
  ['ffzy1', '\u975e\u51e1\u91c7\u96c6', 'http://ffzy1.tv/api.php/provide/vod/', 'ffzy'],
  ['lzi1', '\u91cf\u5b50\u91c7\u96c6', 'https://lzizy1.com/api.php/provide/vod/', 'lzi'],
  ['49zy1', '\u56db\u4e5d\u8d44\u6e90', 'https://49zy1.com/api.php/provide/vod/?ac=list', '49zy'],
  ['feisu', '\u98de\u901f\u8d44\u6e90', 'https://www.feisuzyapi.com/api.php/provide/vod/?ac=list', 'feisu'],
  ['qhzy', '\u5947\u864e\u8d44\u6e90', 'https://caiji.qhzyapi.com/api.php/provide/vod/', 'qhzy'],
  ['keke', '\u53ef\u53ef\u8d44\u6e90', 'https://kekezy1.com/api.php/provide/vod/?ac=list', 'keke'],
  ['huya', '\u864e\u7259\u91c7\u96c6', 'https://www.huyaapi.com/api.php/provide/vod/from/hym3u8', 'huya'],
  ['bfzy-app', '\u66b4\u98ce\u91c7\u96c6', 'https://app.bfzyapi.com/api.php/provide/vod/', 'bfzy'],
  ['mv-wogg', 'Wogg MV', 'https://mv.wogg.link/mv/vod', 'wogg-mv'],
  ['dytt', '\u5929\u5802\u8d44\u6e90', 'http://caiji.dyttzyapi.com/api.php/provide/vod/from/dyttm3u8/at/m3u8/', 'dytt'],
  ['sdzy', '\u95ea\u7535\u8d44\u6e90', 'http://sdzyapi.com/api.php/provide/vod/', 'sdzy'],
  ['guangsu', '\u5149\u901f\u8d44\u6e90', 'https://api.guangsuapi.com/api.php/provide/vod/', 'guangsu'],
  ['ikun-m3u8', 'IK\u8d44\u6e90', 'https://ikunzyapi.com/api.php/provide/vod/from/ikm3u8/', 'ikun'],
  ['haiwaikan', '\u6d77\u5916\u770b\u8d44\u6e90', 'https://haiwaikan.com/api.php/provide/vod', 'haiwaikan'],
  ['bfzy-m3u8', '\u66b4\u98ce\u76f4\u8fde', 'https://bfzyapi.com/api.php/provide/vod/from/bfm3u8/', 'bfzy'],
  ['hhzy-m3u8', '\u8c6a\u534e\u76f4\u8fde', 'https://hhzyapi.com/api.php/provide/vod/from/hhm3u8/', 'hhzy'],
  ['hongniu-m3u8', '\u7ea2\u725b\u76f4\u8fde', 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8/', 'hongniu'],
  ['lzi-m3u8', '\u91cf\u5b50\u76f4\u8fde', 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8/', 'lzi'],
  ['ffzy-m3u8', '\u975e\u51e1\u76f4\u8fde', 'http://ffzy.tv/api.php/provide/vod/from/ffm3u8/', 'ffzy'],
  ['jszy-m3u8', '\u6781\u901f\u76f4\u8fde', 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8/', 'jszy'],
  ['xinlang-m3u8', '\u65b0\u6d6a\u76f4\u8fde', 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/from/xlm3u8/', 'xinlang'],
  ['jinying-m3u8', '\u91d1\u9e70\u76f4\u8fde', 'https://jyzyapi.com/provide/vod/from/jinyingm3u8/', 'jinying'],
  ['subo-m3u8', '\u901f\u64ad\u76f4\u8fde', 'http://suboziyuan.net/api.php/provide/vod/from/subm3u8/', 'subo'],
  ['360zy-direct', '360\u76f4\u8fde', 'https://360zy.com/api.php/provide/vod/from/360zy/', '360zy'],
  ['49zyw', '\u56db\u4e5d\u7f51\u7edc', 'https://49zyw.com/api.php/provide/vod/?ac=list', '49zyw'],
  ['kczy', '\u5feb\u8f66\u4e91\u64ad', 'https://caiji.kczyapi.com/api.php/provide/vod/', 'kczy'],
  ['wolong', '\u5367\u9f99\u4e91\u64ad', 'https://collect.wolongzyw.com/api.php/provide/vod/', 'wolong'],
  ['xkan', '\u4eab\u770b\u4e91\u64ad', 'https://xkanzy10.com/api.php/provide/vod', 'xkan'],
  ['tiankong', '\u5929\u7a7a\u8d44\u6e90', 'https://api.tiankongapi.com/api.php/provide/vod/', 'tiankong'],
];

const LIVE_CANDIDATES = [
  ['fanmingming-index', '\u8303\u660e\u660e\u76f4\u64ad', 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u', 'fanmingming'],
  ['fanmingming-ipv6', '\u8303\u660e\u660e IPv6', 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u', 'fanmingming'],
  ['iptv-org-global', 'IPTV-org \u5168\u7403', 'https://iptv-org.github.io/iptv/index.m3u', 'iptv-org'],
  ['iptv-org-cn', 'IPTV-org \u4e2d\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u', 'iptv-org'],
  ['iptv-org-hk', 'IPTV-org \u9999\u6e2f', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u', 'iptv-org'],
  ['iptv-org-tw', 'IPTV-org \u53f0\u6e7e', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u', 'iptv-org'],
  ['iptv-org-jp', 'IPTV-org \u65e5\u672c', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/jp.m3u', 'iptv-org'],
  ['iptv-org-kr', 'IPTV-org \u97e9\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/kr.m3u', 'iptv-org'],
  ['iptv-org-us', 'IPTV-org \u7f8e\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u', 'iptv-org'],
  ['iptv-org-uk', 'IPTV-org \u82f1\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/uk.m3u', 'iptv-org'],
  ['iptv-org-de', 'IPTV-org \u5fb7\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/de.m3u', 'iptv-org'],
  ['iptv-org-fr', 'IPTV-org \u6cd5\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u', 'iptv-org'],
  ['iptv-org-ca', 'IPTV-org \u52a0\u62ff\u5927', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ca.m3u', 'iptv-org'],
  ['iptv-org-in', 'IPTV-org \u5370\u5ea6', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u', 'iptv-org'],
  ['iptv-org-th', 'IPTV-org \u6cf0\u56fd', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/th.m3u', 'iptv-org'],
  ['iptv-org-es', 'IPTV-org \u897f\u73ed\u7259', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/es.m3u', 'iptv-org'],
  ['iptv-org-it', 'IPTV-org \u610f\u5927\u5229', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/it.m3u', 'iptv-org'],
  ['iptv-org-nl', 'IPTV-org \u8377\u5170', 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/nl.m3u', 'iptv-org'],
  ['zbds-ipv4', 'ZBDS IPv4', 'https://live.zbds.org/tv/iptv4.m3u', 'zbds'],
  ['zbds-ipv6', 'ZBDS IPv6', 'https://live.zbds.org/tv/iptv6.m3u', 'zbds'],
  ['yang-gather', 'YanG \u805a\u5408\u76f4\u64ad', 'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u', 'yang-1989'],
  ['kimentanm', 'Kimentanm APTV', 'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u', 'kimentanm'],
  ['suxuang-ipv4', 'Suxuang IPv4', 'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u', 'suxuang'],
  ['suxuang-ipv6', 'Suxuang IPv6', 'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv6.m3u', 'suxuang'],
  ['guovin-result', 'Guovin \u76f4\u64ad', 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u', 'guovin'],
  ['joevess', 'Joevess IPTV', 'https://raw.githubusercontent.com/joevess/IPTV/main/iptv.m3u', 'joevess'],
  ['yuanzl77', 'Yuanzl77 IPTV', 'https://raw.githubusercontent.com/yuanzl77/IPTV/main/iptv.m3u', 'yuanzl77'],
  ['epg7', 'EPG7 \u76f4\u64ad', 'https://raw.githubusercontent.com/epg7/IPTV/main/live.m3u', 'epg7'],
  ['meroser', 'Meroser IPTV', 'https://raw.githubusercontent.com/Meroser/IPTV/main/IPTV.m3u', 'meroser'],
  ['free-tv', 'Free-TV IPTV', 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', 'free-tv'],
  ['memorycollection', 'MemoryCollection IPTV', 'https://raw.githubusercontent.com/MemoryCollection/IPTV/refs/heads/main/itvlist.txt', 'memorycollection'],
  ['wwb521', 'WWB521 \u76f4\u64ad', 'https://raw.githubusercontent.com/wwb521/live/refs/heads/main/tv.m3u', 'wwb521'],
  ['migu', '\u54aa\u5495\u76f4\u64ad', 'https://develop202.github.io/migu_video/interface.txt', 'migu'],
  ['szyyds-auto', 'SZYDS \u81ea\u52a8\u76f4\u64ad', 'https://z.szyyds.cn/iptv', 'szyyds'],
  ['szyyds-live', 'SZYDS \u76f4\u64ad', 'https://szyyds.cn/tv/live/x.txt', 'szyyds'],
  ['ibert-fmml', 'FMML \u76f4\u64ad', 'https://m3u.ibert.me/txt/fmml_ipv6.txt', 'ibert'],
  ['nxog', 'NXOG \u76f4\u64ad', 'https://a.nxog.top/m/tv/?ou=2d5', 'nxog'],
  ['bc188', 'BC188 \u76f4\u64ad', 'https://bc.188766.xyz/?ip=&json=true', 'bc188'],
  ['yydf-live', 'Yydf \u76f4\u64ad', 'https://jihulab.com/yydfys/yydf/-/raw/main/yydf/lib/live.txt', 'yydf'],
  ['yydf-tv', 'Yydf TV', 'https://jihulab.com/yydfys/yydf/-/raw/main/yydf/lib/zhibo.txt', 'yydf'],
  ['yydf-mtv', 'Yydf MTV', 'https://jihulab.com/yydfys/yydf/-/raw/main/yydf/lib/MTV.txt', 'yydf'],
];

function clean(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : Math.round((rows[middle - 1] + rows[middle]) / 2);
}

function percentile(values, ratio) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  return rows[Math.min(rows.length - 1, Math.ceil(rows.length * ratio) - 1)];
}

async function mapLimit(items, limit, callback) {
  const output = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await callback(items[index], index); }
      catch (error) { output[index] = { error: clean(error?.message || error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return output;
}

async function readLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const value = await response.text();
    return { text: value.slice(0, maxBytes), truncated: value.length > maxBytes };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let value = '';
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (bytes + part.value.byteLength > maxBytes) {
        const allowed = Math.max(0, maxBytes - bytes);
        value += decoder.decode(part.value.slice(0, allowed), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      bytes += part.value.byteLength;
      value += decoder.decode(part.value, { stream: true });
    }
    value += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return { text: value, truncated };
}

async function fetchTimed(url, maxBytes = API_MAX_BYTES, headers = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain,application/vnd.apple.mpegurl,video/*,*/*', 'user-agent': 'tvbox-source-registry-full-audit/1.0', ...headers },
    });
    const body = await readLimited(response, maxBytes);
    return {
      url,
      ok: response.ok && !body.truncated,
      status: response.status,
      latencyMs: Date.now() - started,
      text: body.text,
      truncated: body.truncated,
      contentType: response.headers.get('content-type') || '',
      lastModified: response.headers.get('last-modified') || '',
      finalUrl: response.url,
      error: '',
    };
  } catch (error) {
    return { url, ok: false, status: 0, latencyMs: Date.now() - started, text: '', truncated: false, contentType: '', lastModified: '', finalUrl: url, error: clean(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function sourceUrl(api, params = {}) {
  const url = new URL(api);
  if (!Object.prototype.hasOwnProperty.call(params, 'ac') && Object.keys(params).some((key) => ['wd', 't', 'ids', 'pg'].includes(key))) url.searchParams.delete('ac');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(api, params = {}) {
  const result = await fetchTimed(sourceUrl(api, params));
  let data = null;
  try { data = JSON.parse(result.text.replace(/^\uFEFF/u, '').trim()); } catch {}
  return { ...result, data, ok: Boolean(result.ok && data && typeof data === 'object') };
}

function rowsOf(data) {
  const value = data?.list ?? data?.data?.list ?? data?.data ?? [];
  return Array.isArray(value) ? value : [];
}

function classesOf(data) {
  const value = data?.class ?? data?.classes ?? data?.data?.class ?? data?.types ?? [];
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((row) => ({
    id: clean(row?.type_id ?? row?.id ?? row?.typeId),
    name: clean(row?.type_name ?? row?.name ?? row?.typeName),
    parentId: clean(row?.type_pid ?? row?.pid ?? row?.parent_id),
  })).filter((row) => {
    if (!row.id || !row.name || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function rowTitle(row) {
  return clean(row?.vod_name ?? row?.name ?? row?.title ?? row?.vod_title);
}

function rowText(row) {
  return clean([rowTitle(row), row?.vod_sub, row?.vod_remarks, row?.vod_actor, row?.vod_director, row?.type_name, row?.vod_class, row?.vod_content].join(' '));
}

function parseDate(value) {
  const parsed = Date.parse(clean(value).replace(/\//gu, '-'));
  return Number.isFinite(parsed) ? parsed : null;
}

function latestRowsAt(rows) {
  let latest = null;
  for (const row of rows) {
    const value = parseDate(row?.vod_time ?? row?.vod_time_add ?? row?.vod_pubdate ?? row?.update_time);
    if (value !== null) latest = latest === null ? value : Math.max(latest, value);
  }
  return latest;
}

function ageHours(value, now = Date.now()) {
  return Number.isFinite(value) ? Math.max(0, (now - value) / 3600000) : null;
}

function mediaUrls(row) {
  const value = [row?.vod_play_url, row?.vod_down_url, row?.vod_url, row?.url].filter(Boolean).join(' ');
  return [...new Set((value.match(MEDIA_RE) || []).map((item) => item.replace(/[),.;]+$/u, '')))]
    .filter((url) => isPublicHttpUrl(url) && !INFRASTRUCTURE_RE.test(url));
}

function playBranches(row) {
  const from = clean(row?.vod_play_from).split('$$$').map(clean).filter(Boolean);
  const rawGroups = String(row?.vod_play_url || '').split('$$$');
  return rawGroups.map((raw, index) => {
    const entries = raw.split('#').map((item) => {
      const value = clean(item);
      const splitAt = value.indexOf('$');
      const url = splitAt >= 0 ? clean(value.slice(splitAt + 1)) : value;
      return { label: splitAt >= 0 ? clean(value.slice(0, splitAt)) : '', url };
    }).filter((item) => item.url);
    const direct = entries.filter((item) => isPublicHttpUrl(item.url) && /(?:m3u8|mp4|\.ts)(?:\?|$)/iu.test(item.url) && !INFRASTRUCTURE_RE.test(item.url));
    return { name: from[index] || `line-${index + 1}`, entryCount: entries.length, directCount: direct.length, sampleUrl: direct[0]?.url || '' };
  }).filter((branch) => branch.entryCount > 0);
}

async function probeMedia(url, hint = '') {
  const normalized = normalizeLiveUrl(url);
  if (!normalized) return { url, ok: false, status: 0, latencyMs: null, quality: false, reason: 'UNSAFE_URL' };
  const result = await fetchTimed(normalized, MEDIA_MAX_BYTES, { range: 'bytes=0-131071' });
  const preview = result.text.slice(0, MEDIA_MAX_BYTES);
  const combined = `${result.contentType} ${result.finalUrl} ${preview}`;
  const m3u8 = /#EXTM3U|mpegurl|\.m3u8(?:\?|$)/iu.test(combined);
  const mp4 = /video\/|\.mp4(?:\?|$)/iu.test(combined);
  const ok = Boolean(result.status >= 200 && result.status < 400 && ((m3u8 && /#EXTM3U/iu.test(preview)) || (mp4 && (result.status === 206 || /video\//iu.test(result.contentType)))) && !INFRASTRUCTURE_RE.test(preview));
  return {
    url,
    ok,
    status: result.status,
    latencyMs: result.latencyMs,
    quality: QUALITY_RE.test(`${hint} ${url} ${preview}`),
    reason: ok ? 'PASS' : INFRASTRUCTURE_RE.test(preview) ? 'AD_OR_PARSE' : 'MEDIA_FAIL',
  };
}

function spread(items, limit) {
  if (items.length <= limit) return items;
  const output = [];
  const step = (items.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) output.push(items[Math.round(index * step)]);
  return [...new Set(output)];
}

function parseLiveDocument(input) {
  const value = String(input || '');
  if (/^\s*#EXTM3U/iu.test(value)) return parseM3U(value);
  const channels = [];
  let group = '\u5176\u4ed6';
  for (const rawLine of value.split(/\r?\n/gu)) {
    const line = clean(rawLine);
    if (!line || line.startsWith('#')) {
      const marker = line.match(/^([^,]+),#genre#$/iu);
      if (marker) group = clean(marker[1]) || '\u5176\u4ed6';
      continue;
    }
    const urlMatch = line.match(/https?:\/\/\S+/iu);
    if (!urlMatch) continue;
    const url = normalizeLiveUrl(urlMatch[0].replace(/[),.;]+$/u, ''));
    if (!url) continue;
    const prefix = clean(line.slice(0, urlMatch.index));
    const fields = prefix.split(',').map(clean).filter(Boolean);
    const name = fields.length >= 2 ? fields[fields.length - 1] : fields[0] || url;
    const explicitGroup = fields.length >= 3 ? fields[fields.length - 2] : '';
    channels.push({ name, group: explicitGroup || group, logo: '', tvgId: '', url });
  }
  const unique = new Map();
  for (const channel of channels) {
    const key = `${channel.name}|${channel.url}`;
    if (!unique.has(key)) unique.set(key, channel);
  }
  return { header: '', epgUrl: '', rawChannelCount: channels.length, channels: [...unique.values()] };
}

async function loadClassContract(api) {
  const attempts = [];
  for (const params of [{ ac: 'list' }, {}, { ac: 'videolist', pg: 1 }]) {
    const response = await fetchJson(api, params);
    attempts.push(response);
    const classes = classesOf(response.data);
    if (response.ok && classes.length) return { response, classes, attempts };
  }
  return { response: attempts.find((item) => item.ok) || attempts[0], classes: [], attempts };
}

async function auditVod(candidate) {
  const [slug, name, api, provider] = candidate;
  const started = Date.now();
  const contract = await loadClassContract(api);
  const classes = contract.classes;
  const searchRows = await mapLimit(SEARCH_TERMS, Math.min(4, REQUEST_CONCURRENCY), async (term) => {
    const response = await fetchJson(api, { wd: term, pg: 1 });
    const rows = rowsOf(response.data);
    const semantic = rows.filter((row) => rowText(row).includes(term));
    return { term, ok: Boolean(response.ok && semantic.length), count: rows.length, semanticCount: semantic.length, status: response.status, latencyMs: response.latencyMs, error: response.error || '' };
  });
  const categoryRows = await mapLimit(classes, REQUEST_CONCURRENCY, async (category) => {
    let response = await fetchJson(api, { ac: 'videolist', t: category.id, pg: 1 });
    let rows = rowsOf(response.data);
    let mode = 'videolist';
    if (response.ok && !rows.length) {
      const fallback = await fetchJson(api, { ac: 'detail', t: category.id, pg: 1 });
      if (rowsOf(fallback.data).length) { response = fallback; rows = rowsOf(fallback.data); mode = 'detail'; }
    }
    const latest = latestRowsAt(rows);
    return {
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      ok: Boolean(response.ok && rows.length),
      status: response.status,
      count: rows.length,
      mode,
      latencyMs: response.latencyMs,
      latestAt: latest === null ? null : new Date(latest).toISOString(),
      ageHours: ageHours(latest),
      adOrParse: rows.some((row) => INFRASTRUCTURE_RE.test(rowText(row))),
      sample: rows[0] || null,
      error: response.error || '',
    };
  });

  const detailSeeds = spread(categoryRows.filter((row) => row.ok && row.sample), 10);
  const detailRows = await mapLimit(detailSeeds, REQUEST_CONCURRENCY, async (category) => {
    const id = category.sample?.vod_id ?? category.sample?.id ?? category.sample?.vod_id_str;
    if (id === undefined || id === null || id === '') return { category: category.name, ok: false, branchOk: false, branches: [], latencyMs: null, error: 'NO_DETAIL_ID' };
    const response = await fetchJson(api, { ac: 'detail', ids: id });
    const row = rowsOf(response.data)[0] || null;
    const branches = row ? playBranches(row) : [];
    const branchOk = branches.length > 0 && branches.every((branch) => branch.directCount > 0);
    return { category: category.name, ok: Boolean(response.ok && row), branchOk, branches, latencyMs: response.latencyMs, error: response.error || '', title: rowTitle(row), row };
  });

  const branchSamples = detailRows.flatMap((detail) => detail.branches.map((branch) => ({ category: detail.category, branch: branch.name, url: branch.sampleUrl, hint: `${detail.title} ${branch.name}` }))).filter((row) => row.url);
  const media = await mapLimit(branchSamples, REQUEST_CONCURRENCY, async (sample) => ({ ...sample, ...(await probeMedia(sample.url, sample.hint)) }));
  const requestTimes = [...contract.attempts.map((item) => item.latencyMs), ...categoryRows.map((item) => item.latencyMs), ...searchRows.map((item) => item.latencyMs), ...detailRows.map((item) => item.latencyMs)];
  const categoryErrors = categoryRows.filter((row) => !row.ok && (!row.status || row.status >= 400 || row.error));
  const transientCategoryErrors = categoryErrors.filter((row) => [408, 425, 429, 500, 502, 503, 504].includes(row.status) || !row.status);
  const hardCategoryErrors = categoryErrors.filter((row) => !transientCategoryErrors.includes(row));
  const emptyCategories = categoryRows.filter((row) => !row.ok && row.status >= 200 && row.status < 400 && !row.error);
  const staleCategories = categoryRows.filter((row) => row.ok && row.ageHours !== null && row.ageHours > 24 * 90);
  const unknownFreshness = categoryRows.filter((row) => row.ok && row.ageHours === null);
  const adOrParse = categoryRows.some((row) => row.adOrParse) || detailRows.some((row) => INFRASTRUCTURE_RE.test(rowText(row.row)));
  const semanticHits = searchRows.filter((row) => row.ok).length;
  const detailOkRate = detailRows.length ? detailRows.filter((row) => row.ok).length / detailRows.length : 0;
  const branchOkRate = detailRows.length ? detailRows.filter((row) => row.branchOk).length / detailRows.length : 0;
  const mediaSuccessRate = media.length ? media.filter((row) => row.ok).length / media.length : 0;
  const qualityRate = media.filter((row) => row.ok).length ? media.filter((row) => row.ok && row.quality).length / media.filter((row) => row.ok).length : 0;
  const sourceLatest = latestRowsAt(categoryRows.map((row) => row.sample).filter(Boolean));
  const apiMedianMs = median(requestTimes);
  const apiP95Ms = percentile(requestTimes, 0.95);
  const mediaMedianMs = median(media.map((row) => row.latencyMs));
  const hardFailures = [];
  const softWarnings = [];
  if (!contract.response?.ok) hardFailures.push('API_ERROR');
  else if (classes.length < 8) hardFailures.push('CLASS_CONTRACT_GAP');
  if (hardCategoryErrors.length) hardFailures.push('CATEGORY_API_ERROR');
  if (semanticHits < 3) hardFailures.push('SEARCH_FAIL');
  if (detailOkRate < 0.9) hardFailures.push('DETAIL_FAIL');
  if (branchOkRate < 1) hardFailures.push('PLAY_BRANCH_FAIL');
  if (!media.length || mediaSuccessRate < 0.75) hardFailures.push('MEDIA_FAIL');
  if (adOrParse) hardFailures.push('AD_OR_PARSE');
  if (emptyCategories.length) softWarnings.push(`EMPTY_CATEGORY:${emptyCategories.length}`);
  if (transientCategoryErrors.length) softWarnings.push(`TRANSIENT_CATEGORY_API:${transientCategoryErrors.length}`);
  if (staleCategories.length) softWarnings.push(`STALE_CATEGORY:${staleCategories.length}`);
  if (unknownFreshness.length) softWarnings.push(`FRESHNESS_UNKNOWN:${unknownFreshness.length}`);
  if (qualityRate < 0.5) softWarnings.push('HD_EVIDENCE_LOW');
  if ((apiP95Ms ?? Infinity) > 9000 || (mediaMedianMs ?? Infinity) > 6000) softWarnings.push('SLOW');
  const admissionTier = hardFailures.length ? 'REJECTED' : softWarnings.length ? 'WATCH' : 'ACTIVE';
  const reason = hardFailures[0] || softWarnings[0] || 'PASS';
  const pass = hardFailures.length === 0 && softWarnings.length === 0;
  return {
    kind: 'vod', slug, name, api, provider, physicalKey: physicalCandidateKey(api), pass, admissionTier, hardFailures, softWarnings, reason,
    checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    metrics: {
      classCount: classes.length,
      categoriesTested: categoryRows.length,
      categoryErrorCount: categoryErrors.length,
      emptyCategoryCount: emptyCategories.length,
      staleCategoryCount: staleCategories.length,
      unknownFreshnessCount: unknownFreshness.length,
      semanticSearchHits: semanticHits,
      detailOkRate: Number(detailOkRate.toFixed(3)),
      branchOkRate: Number(branchOkRate.toFixed(3)),
      mediaSuccessRate: Number(mediaSuccessRate.toFixed(3)),
      hdRate: Number(qualityRate.toFixed(3)),
      apiMedianMs,
      apiP95Ms,
      mediaMedianMs,
      latestAt: sourceLatest === null ? null : new Date(sourceLatest).toISOString(),
      latestAgeHours: ageHours(sourceLatest),
    },
    categories: categoryRows.map(({ sample, ...row }) => row),
    search: searchRows,
    details: detailRows.map(({ row, ...detail }) => detail),
    media,
  };
}

function liveSamplesByGroup(channels) {
  const groups = new Map();
  for (const channel of channels) {
    const key = clean(channel.group) || '\u5176\u4ed6';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(channel);
  }
  const selected = [];
  for (const [group, rows] of groups) selected.push({ group, channel: rows[0] });
  for (const [group, rows] of groups) {
    if (selected.length >= LIVE_SAMPLE_MAX) break;
    if (rows[1]) selected.push({ group, channel: rows[Math.floor(rows.length / 2)] });
  }
  if (selected.length < Math.min(12, LIVE_SAMPLE_MAX)) {
    for (const channel of spread(channels, Math.min(12, LIVE_SAMPLE_MAX))) {
      if (selected.some((row) => row.channel.url === channel.url)) continue;
      selected.push({ group: channel.group || '\u5176\u4ed6', channel });
    }
  }
  return { groups, selected: selected.slice(0, LIVE_SAMPLE_MAX) };
}

async function auditLive(candidate) {
  const [slug, name, api, provider] = candidate;
  const playlist = await fetchTimed(api, PLAYLIST_MAX_BYTES);
  const parsed = playlist.ok ? parseLiveDocument(playlist.text) : { channels: [], rawChannelCount: 0 };
  const { groups, selected } = liveSamplesByGroup(parsed.channels || []);
  const media = await mapLimit(selected, REQUEST_CONCURRENCY, async ({ group, channel }) => ({
    group,
    name: channel.name,
    ...(await probeMedia(channel.url, `${channel.name} ${group}`)),
  }));
  const sampledGroups = new Set(media.map((row) => row.group));
  const successful = media.filter((row) => row.ok);
  const mediaSuccessRate = media.length ? successful.length / media.length : 0;
  const hdRate = successful.length ? successful.filter((row) => row.quality).length / successful.length : 0;
  const duplicateRate = parsed.rawChannelCount ? 1 - parsed.channels.length / parsed.rawChannelCount : 1;
  const groupCoverageRate = groups.size ? sampledGroups.size / groups.size : 0;
  const mediaMedianMs = median(media.map((row) => row.latencyMs));
  const hardViolation = INFRASTRUCTURE_RE.test(playlist.text.slice(0, 512 * 1024));
  const hardFailures = [];
  const softWarnings = [];
  if (!playlist.ok) hardFailures.push('PLAYLIST_UNAVAILABLE');
  else if (parsed.channels.length < 10 || groups.size < 1) hardFailures.push('EMPTY_GROUP_OR_CHANNEL');
  if (groupCoverageRate < 1) hardFailures.push('GROUP_AUDIT_INCOMPLETE');
  if (media.length < Math.min(8, parsed.channels.length) || successful.length < Math.min(2, media.length)) hardFailures.push('MEDIA_FAIL');
  if (hardViolation) hardFailures.push('AD_OR_PARSE');
  if (mediaSuccessRate < 0.75) softWarnings.push('PARTIAL_MEDIA_FAILURE');
  if (hdRate < 0.5) softWarnings.push('HD_EVIDENCE_LOW');
  if (duplicateRate > 0.35) softWarnings.push('DUPLICATE_HEAVY');
  if (playlist.latencyMs > 7000 || (mediaMedianMs ?? Infinity) > 6000) softWarnings.push('SLOW');
  const admissionTier = hardFailures.length ? 'REJECTED' : softWarnings.length ? 'WATCH' : 'ACTIVE';
  const reason = hardFailures[0] || softWarnings[0] || 'PASS';
  return {
    kind: 'live', slug, name, api, provider, physicalKey: physicalCandidateKey(api), pass: hardFailures.length === 0 && softWarnings.length === 0, admissionTier, hardFailures, softWarnings, reason,
    checkedAt: new Date().toISOString(),
    metrics: {
      channelCount: parsed.channels.length,
      groupCount: groups.size,
      sampledChannelCount: media.length,
      sampledGroupCount: sampledGroups.size,
      groupCoverageRate: Number(groupCoverageRate.toFixed(3)),
      mediaSuccessRate: Number(mediaSuccessRate.toFixed(3)),
      hdRate: Number(hdRate.toFixed(3)),
      duplicateRate: Number(duplicateRate.toFixed(3)),
      playlistLatencyMs: playlist.latencyMs,
      mediaMedianMs,
      lastModified: playlist.lastModified || null,
    },
    groupResults: [...groups.keys()].map((group) => {
      const rows = media.filter((row) => row.group === group);
      return { group, sampled: rows.length, playable: rows.filter((row) => row.ok).length, ok: rows.some((row) => row.ok) };
    }),
    media,
  };
}

function uniqueCandidates(rows, kind) {
  const seen = new Set();
  return rows.filter((row) => {
    const api = row[2];
    if (!isPublicHttpUrl(api)) return false;
    const key = `${kind}:${physicalCandidateKey(api)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function providerPassCount(rows) {
  return new Set(rows.map((row) => row.provider)).size;
}

function operationalVodPass(row) {
  const metrics = row.metrics;
  const branches = row.details.flatMap((detail) => detail.branches || []);
  const directRate = branches.length ? branches.filter((branch) => branch.directCount > 0).length / branches.length : 0;
  return row.hardFailures.length === 0
    && metrics.classCount >= 8
    && metrics.semanticSearchHits >= 3
    && metrics.detailOkRate >= 0.9
    && directRate >= 0.5
    && metrics.mediaSuccessRate >= 0.67;
}

function operationalLivePass(row) {
  const metrics = row.metrics;
  return row.hardFailures.length === 0
    && metrics.channelCount >= 10
    && metrics.groupCoverageRate >= 1
    && metrics.duplicateRate <= 0.5;
}

function markdown(report) {
  const lines = [
    '# TVBox source full-quality audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Strict pass: VOD ${report.passed.vod}/${report.candidates.vod} entries (${report.passedProviders.vod} providers), live ${report.passed.live}/${report.candidates.live} entries (${report.passedProviders.live} providers).`,
    `Admission: VOD ACTIVE/WATCH/REJECTED ${report.admission.vod.active}/${report.admission.vod.watch}/${report.admission.vod.rejected}, live ACTIVE/WATCH/REJECTED ${report.admission.live.active}/${report.admission.live.watch}/${report.admission.live.rejected}.`,
    `Hard-gate operational pass: VOD ${report.operational.vod} entries (${report.operationalProviders.vod} providers), live ${report.operational.live} entries (${report.operationalProviders.live} providers). Target met: ${report.targetMet}.`,
    '',
    '| Kind | Source | Result | Root cause | Categories/Groups | Search | Detail | Playback | HD | Latency |',
    '|---|---|---:|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of report.rows) {
    const m = row.metrics;
    lines.push(`| ${row.kind} | ${row.name} | ${row.admissionTier} | ${row.reason} | ${row.kind === 'vod' ? `${m.categoriesTested - m.emptyCategoryCount}/${m.categoriesTested}` : `${m.sampledGroupCount}/${m.groupCount}`} | ${row.kind === 'vod' ? `${m.semanticSearchHits}/${SEARCH_TERMS.length}` : '-'} | ${row.kind === 'vod' ? m.detailOkRate : '-'} | ${m.mediaSuccessRate} | ${m.hdRate} | ${row.kind === 'vod' ? m.apiP95Ms : m.playlistLatencyMs}ms |`);
  }
  lines.push('', 'Strict pass means no soft warnings. Hard-gate operational pass permits upstream empty categories, transient rate limits, stale metadata, slow responses or low HD evidence when the direct source, search, detail and playback contract remains usable. Mirrors or alternate endpoints sharing one provider do not increase provider diversity.');
  return lines.join('\n') + '\n';
}

const requestedKind = String(process.env.AUDIT_KIND || 'all').toLowerCase();
const useRegistry = String(process.env.AUDIT_REGISTRY || '').toLowerCase() === 'true' || String(process.env.AUDIT_REGISTRY || '') === '1';
const registryVodCandidates = SOURCE_REGISTRY.map((source) => [source.slug, source.displayName, source.api, source.provider]);
const registryLiveCandidates = LIVE_SOURCE_REGISTRY.map((source) => [source.slug, source.displayName, source.api, source.provider]);
const vodCandidates = requestedKind === 'live' ? [] : uniqueCandidates(useRegistry ? registryVodCandidates : VOD_CANDIDATES, 'vod');
const liveCandidates = requestedKind === 'vod' ? [] : uniqueCandidates(useRegistry ? registryLiveCandidates : LIVE_CANDIDATES, 'live');
const vodRows = await mapLimit(vodCandidates, SOURCE_CONCURRENCY, auditVod);
const liveRows = await mapLimit(liveCandidates, SOURCE_CONCURRENCY, auditLive);
const rows = [...vodRows, ...liveRows];
for (const row of rows) row.operationalPass = row.kind === 'vod' ? operationalVodPass(row) : operationalLivePass(row);
const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    vod: 'Hard admission requires native class schema, semantic search, sampled details, direct play branches and direct media bytes. Empty native categories, transient category errors, HD evidence, freshness and latency are reported as soft warnings.',
    live: 'Hard admission requires playlist schema, group coverage and usable sampled playback. Partial channel failures, HD evidence, duplication and latency are reported as soft warnings.',
    identity: 'Provider mirrors are audited but do not count as independent providers.',
  },
  targets: { vod: 10, live: 10 },
  candidates: { vod: vodRows.length, live: liveRows.length },
  passed: { vod: vodRows.filter((row) => row.pass).length, live: liveRows.filter((row) => row.pass).length },
  passedProviders: { vod: providerPassCount(vodRows.filter((row) => row.pass)), live: providerPassCount(liveRows.filter((row) => row.pass)) },
  operational: { vod: vodRows.filter((row) => row.operationalPass).length, live: liveRows.filter((row) => row.operationalPass).length },
  operationalProviders: { vod: providerPassCount(vodRows.filter((row) => row.operationalPass)), live: providerPassCount(liveRows.filter((row) => row.operationalPass)) },
  admission: {
    vod: {
      active: vodRows.filter((row) => row.admissionTier === 'ACTIVE').length,
      watch: vodRows.filter((row) => row.admissionTier === 'WATCH').length,
      rejected: vodRows.filter((row) => row.admissionTier === 'REJECTED').length,
      hardGate: vodRows.filter((row) => row.hardFailures.length === 0).length,
    },
    live: {
      active: liveRows.filter((row) => row.admissionTier === 'ACTIVE').length,
      watch: liveRows.filter((row) => row.admissionTier === 'WATCH').length,
      rejected: liveRows.filter((row) => row.admissionTier === 'REJECTED').length,
      hardGate: liveRows.filter((row) => row.hardFailures.length === 0).length,
    },
  },
  targetMet: vodRows.filter((row) => row.operationalPass).length >= 10 && liveRows.filter((row) => row.operationalPass).length >= 10,
  rows,
};

await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'full-source-quality-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(path.join(ROOT, 'audit', 'full-source-quality-summary.md'), markdown(report), 'utf8');
console.log(JSON.stringify({ generatedAt: report.generatedAt, candidates: report.candidates, passed: report.passed, passedProviders: report.passedProviders, admission: report.admission, operational: report.operational, operationalProviders: report.operationalProviders, targetMet: report.targetMet }, null, 2));
for (const row of rows) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.kind} ${row.slug} ${row.name} reason=${row.reason}`);
if (!report.targetMet) process.exitCode = 1;
