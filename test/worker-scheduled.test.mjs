import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { discoverOne, playlistHardViolation, probeLiveSource, probeNativeCategories, probeVodSource } from '../src/worker.mjs';
import { mediaLooksPlayable } from '../src/deep-audit.mjs';
import { parseM3U } from '../src/live.mjs';

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

function m3uResponse() {
  const rows = Array.from({ length: 5 }, (_, index) => `#EXTINF:-1 group-title="News",Channel ${index}\nhttps://media.example.test/${index}.m3u8`).join('\n');
  return new Response(`#EXTM3U\n${rows}\n`, { status: 200, headers: { 'content-type': 'audio/x-mpegurl' } });
}

test('scheduled harness probes VOD and LIVE in bounded batches and persists health', async () => {
  const originalFetch = globalThis.fetch;
  const store = new Map();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('.m3u') || url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/live/')) return m3uResponse();
    if (url.hostname === 'media.example.test') return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (url.searchParams.get('ac') === 'detail') return jsonResponse({ list: [{ vod_id: '1', vod_play_url: '高清$https://media.example.test/movie.m3u8' }] });
    if (url.searchParams.has('wd')) return jsonResponse({ list: [{ vod_id: '1', vod_name: '测试节目' }] });
    return jsonResponse({ class: [{ type_id: 1, type_name: '电影' }], list: [{ vod_id: '1', vod_name: '测试节目', vod_time: '2026-07-19 12:00:00' }] });
  };
  const env = {
    SOURCE_HEALTH: {
      async get(key) { return store.has(key) ? JSON.parse(store.get(key)) : null; },
      async put(key, value) { store.set(key, value); },
    },
  };
  try {
    await worker.scheduled({ cron: '*/5 * * * *' }, env);
    const state = JSON.parse(store.get('registry:health:v3'));
    assert.ok(state.generatedAt);
    assert.ok(Object.keys(state.sources).length > 0);
    assert.ok(state.revision);
    assert.match(state.revision, /\|live:/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery skips an unsupported feed and accepts the next supported feed in the same run', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname.endsWith('/gao/master/js.json')) {
      return new Response('not a TVBox document', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (url.pathname.endsWith('/gao/master/XYQ.json')) {
      return new Response([
        '// public TVBox config',
        JSON.stringify({
          sites: [{ type: 1, name: 'fallback source', api: 'https://candidate.example.test/api' }],
        }),
      ].join('\n'), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return new Response('', { status: 404 });
  };
  try {
    const result = await discoverOne({
      discoveredSources: [],
      discoveryCursor: 0,
      lastDiscoveryAt: null,
      lastDiscoveryError: null,
    });
    assert.equal(result.discovered, 1);
    assert.equal(result.state.lastDiscoveryError, null);
    assert.equal(result.state.lastDiscoveryFeed, 'https://raw.githubusercontent.com/gaotianliuyun/gao/master/XYQ.json');
    assert.equal(result.state.discoveryCursor, 2);
    assert.equal(result.state.discoveredSources[0].api, 'https://candidate.example.test/api');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probe rejects a redirect to a private address as a hard violation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  try {
    const probe = await probeVodSource({ slug: 'unsafe', kind: 'vod', api: 'https://public.example.test/api' });
    assert.equal(probe.ok, false);
    assert.equal(probe.hardViolation, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled VOD probe persists a native category manifest with visible classes', async () => {
  const originalFetch = globalThis.fetch;
  const store = new Map();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'media.example.test') return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (url.searchParams.get('ac') === 'detail') return jsonResponse({ list: [{ vod_id: '1', vod_play_url: '高清$https://media.example.test/movie.m3u8' }] });
    if (url.searchParams.has('wd')) return jsonResponse({ list: [{ vod_id: '1', vod_name: 'Test Program' }] });
    if (url.searchParams.get('ac') === 'list') return jsonResponse({ class: [
      { type_id: '1', type_name: 'Empty Parent' },
      { type_id: '2', type_name: 'Playable Leaf' },
    ] });
    if (url.searchParams.get('t') === '1') return jsonResponse({ list: [], total: 0 });
    if (url.searchParams.get('t') === '2') return jsonResponse({ list: [{ vod_id: '1', vod_name: 'Film' }], total: 1 });
    return jsonResponse({ class: [{ type_id: '2', type_name: 'Playable Leaf' }], list: [{ vod_id: '1', vod_name: 'Film', vod_time: '2026-07-19 12:00:00' }] });
  };
  const env = {
    SOURCE_HEALTH: {
      async get(key) { return store.has(key) ? JSON.parse(store.get(key)) : null; },
      async put(key, value) { store.set(key, value); },
    },
  };
  try {
    await worker.scheduled({ cron: '*/5 * * * *' }, env);
    const state = JSON.parse(store.get('registry:health:v3'));
    const row = state.sources['vod:hhzy-m3u8'];
    assert.ok(row.nativeCategoryManifest);
    assert.equal(row.nativeCategoryManifest.visibleCount, 1);
    assert.deepEqual(row.nativeCategoryManifest.rows.filter((item) => item.visible).map((item) => item.id), ['2']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('native category probe rotates bounded windows and accumulates all upstream categories', async () => {
  const originalFetch = globalThis.fetch;
  const classes = Array.from({ length: 14 }, (_, index) => ({ type_id: String(index + 1), type_name: `Leaf ${index + 1}` }));
  globalThis.fetch = async () => jsonResponse({ list: [{ vod_id: 'sample' }], total: 1 });
  try {
    const source = { slug: 'rotating', kind: 'vod', api: 'https://source.example.com/api' };
    const first = await probeNativeCategories(source, classes);
    assert.equal(first.visibleCount, 12);
    assert.equal(first.probedCount, 12);
    assert.equal(first.probeCursor, 12);

    const second = await probeNativeCategories(source, classes, first);
    assert.equal(second.visibleCount, 14);
    assert.equal(second.probedCount, 14);
    assert.equal(second.probeCursor, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probe accepts a direct media response identified by video content type', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'media.example.test') {
      return new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }
    if (url.searchParams.get('ac') === 'detail') {
      return jsonResponse({ list: [{ vod_id: '1', vod_play_url: '高清$https://media.example.test/movie.mp4' }] });
    }
    if (url.searchParams.has('wd')) return jsonResponse({ list: [{ vod_id: '1', vod_name: '测试节目' }] });
    return jsonResponse({
      class: [{ type_id: 1, type_name: '电影' }],
      list: [{ vod_id: '1', vod_name: '测试节目', vod_time: '2026-07-19 12:00:00' }],
    });
  };
  try {
    const probe = await probeVodSource({ slug: 'mp4', kind: 'vod', api: 'https://public.example.test/api' });
    assert.equal(probe.playOk, true);
    assert.equal(probe.directPlaybackEligible, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('deep audit does not treat an HTML response at a media-looking URL as playable', () => {
  assert.equal(mediaLooksPlayable({
    status: 200,
    text: '<html><body>not a media file</body></html>',
    contentType: 'text/html',
  }), false);
  assert.equal(mediaLooksPlayable({
    status: 200,
    text: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n',
    contentType: 'application/octet-stream',
  }), true);
});

test('live probe keeps a valid playlist that only contains removable infrastructure lines', () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="News",News 1',
    'https://media.example.test/1.m3u8',
    '#EXTINF:-1 group-title="News",\u516c\u4f17\u53f7\u52a0\u7fa4',
    'https://example.test/ad.m3u8',
    '#EXTINF:-1 group-title="News",News 2',
    'https://media.example.test/2.m3u8',
    '#EXTINF:-1 group-title="News",News 3',
    'https://media.example.test/3.m3u8',
    '#EXTINF:-1 group-title="News",News 4',
    'https://media.example.test/4.m3u8',
    '#EXTINF:-1 group-title="News",News 5',
    'https://media.example.test/5.m3u8',
  ].join('\n');
  const parsed = parseM3U(text);
  assert.equal(parsed.channels.length, 5);
  assert.equal(playlistHardViolation({
    text,
    hardViolation: true,
  }, parsed), false);
  assert.equal(playlistHardViolation({
    text: '<html><body>\u5e7f\u544a\u9875</body></html>',
    hardViolation: true,
  }, { channels: [] }), true);
});

test('live probe downgrades isolated bad channel media to a soft warning', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'playlist.example.test') {
      const lines = Array.from({ length: 5 }, (_, index) => [
        `#EXTINF:-1 group-title="G${index}",Channel ${index}`,
        `https://media.example.test/${index === 0 ? 'ad' : index}.m3u8`,
      ]).flat();
      return new Response(`#EXTM3U\n${lines.join('\n')}\n`, {
        status: 200,
        headers: { 'content-type': 'audio/x-mpegurl' },
      });
    }
    if (url.hostname === 'media.example.test' && url.pathname.includes('/ad.')) {
      return new Response('<html><body>\u5e7f\u544a\u9875</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.hostname === 'media.example.test') {
      return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n', {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      });
    }
    return new Response('', { status: 404 });
  };
  try {
    const probe = await probeLiveSource({
      slug: 'partial-live',
      kind: 'live',
      api: 'https://playlist.example.test/live.m3u',
    });
    assert.equal(probe.ok, true);
    assert.equal(probe.hardViolation, false);
    assert.ok(probe.softWarnings.some((value) => value.startsWith('AD_OR_PARSE_CHANNEL:')));
    assert.equal(probe.playableCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
