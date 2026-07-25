import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { probeVodSource } from '../src/worker.mjs';

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
