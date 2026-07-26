import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { allRegistry, buildConfig, effectiveSources, nativeFilterInfo, pruneDiscoveredCandidates, selectionBatch } from '../src/worker.mjs';
import { emptyHealthState } from '../src/health.mjs';
import { sourceHealthKey } from '../src/health.mjs';
import { LIVE_SOURCE_REGISTRY, SOURCE_REGISTRY, tvSite } from '../src/registry.mjs';

test('config is directly importable and has no empty site list', () => {
  const config = buildConfig('https://example.workers.dev', emptyHealthState());
  assert.ok(config.sites.length >= 10);
  assert.ok(config.lives.length >= 10);
  assert.equal(config.sites[0].type, 1);
  assert.equal(config.sites[0].searchable, 0);
  assert.equal(config.sites[0].quickSearch, 0);
  assert.match(config.sites[0].api, /^https?:\/\//u);
  assert.ok(!JSON.stringify(config).includes('\u5907\u7528'));
});

test('all-failed health state does not re-admit unverified seed links', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.sources = Object.fromEntries(SOURCE_REGISTRY.map((source) => [source.slug, { consecutiveFailures: 3 }]));
  const effective = effectiveSources(SOURCE_REGISTRY, state);
  assert.equal(effective.degraded, true);
  assert.equal(effective.sources.length, 0);
});

test('worker exposes config route with TVBox JSON', async () => {
  const response = await worker.fetch(new Request('https://v8.example/config.json'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.sites.length >= 10);
  assert.ok(body.lives.length >= 10);
});

test('worker exposes live compatibility text from the validated catalog', async () => {
  const state = {
    ...emptyHealthState('2026-07-19T00:00:00.000Z'),
    liveCatalog: [{ name: '频道', group: '新闻', url: 'https://media.example.test/live.m3u8' }],
  };
  const env = {
    SOURCE_HEALTH: {
      async get() { return state; },
      async put() {},
    },
  };
  const response = await worker.fetch(new Request('https://v8.example/live.txt'), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /^#EXTM3U/mu);
});

test('quick search moves to the first currently visible source', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.sources[sourceHealthKey(SOURCE_REGISTRY[0])] = { state: 'WATCH' };
  state.sources[sourceHealthKey(SOURCE_REGISTRY[1])] = {
    state: 'ACTIVE',
    ok: true,
    searchCapability: true,
    lastSuccessAt: '2026-07-19T00:00:00.000Z',
  };
  const config = buildConfig('https://v8.example', state);
  assert.equal(config.sites[0].key, SOURCE_REGISTRY[1].key);
  assert.equal(config.sites[0].quickSearch, 1);
  assert.equal(config.sites.filter((site) => site.quickSearch === 1).length, 1);
});

test('initialized health publishes preaudited active seeds but hides watch candidates', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.discoveredSources = [{ kind: 'vod', api: 'https://candidate.example.com/api.php/provide/vod/' }];
  state.sources[sourceHealthKey(SOURCE_REGISTRY[0])] = { state: 'ACTIVE', ok: true, lastSuccessAt: '2026-07-19T00:00:00.000Z' };
  const config = buildConfig('https://v8.example', state);
  const activeSeedCount = SOURCE_REGISTRY.filter((source) => source.seedStatus === 'ACTIVE').length;
  assert.equal(config.sites.length, activeSeedCount);
  assert.ok(!config.sites.some((site) => site.api.includes('candidate.example.com')));
});

test('last known good source is used when current source set is empty', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  for (const source of SOURCE_REGISTRY) state.sources[sourceHealthKey(source)] = { state: 'QUARANTINED', admissionTier: 'WATCH', lastSuccessAt: '2026-07-18T00:00:00.000Z' };
  state.lastKnownGoodVOD = [sourceHealthKey(SOURCE_REGISTRY[1])];
  const config = buildConfig('https://v8.example', state);
  assert.equal(config.sites.length, 1);
  assert.equal(config.sites[0].key, SOURCE_REGISTRY[1].key);
});

test('probe selection includes an untested discovered source', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.discoveredSources = [{ kind: 'vod', api: 'https://candidate.example.com/api.php/provide/vod/' }];
  const registry = allRegistry(state);
  for (const source of registry) {
    if (!source.api.includes('candidate.example.com')) state.sources[sourceHealthKey(source)] = { state: 'ACTIVE', checkedAt: '2026-07-19T01:00:00.000Z' };
  }
  const batch = selectionBatch(registry, state);
  assert.ok(batch.some((source) => source.api.includes('candidate.example.com')));
});

test('probe selection mixes VOD and live sources for fresh canary health', () => {
  const batch = selectionBatch(allRegistry(emptyHealthState('2026-07-19T00:00:00.000Z')), emptyHealthState('2026-07-19T00:00:00.000Z'));
  assert.equal(batch.length, 3);
  assert.ok(batch.some((source) => source.kind === 'vod'));
  assert.ok(batch.some((source) => source.kind === 'live'));
});

test('discovered source matching a seeded physical path is ignored', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.discoveredSources = [{
    kind: 'live',
    api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
  }];
  const registry = allRegistry(state);
  const matches = registry.filter((source) => source.physicalKey === 'raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u');
  assert.equal(matches.length, 1);
});

test('discovery state prunes candidates matching seeded physical sources', () => {
  const candidates = pruneDiscoveredCandidates([
    {
      kind: 'live',
      api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
    },
    {
      kind: 'vod',
      api: 'https://candidate.example.com/api.php/provide/vod/',
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].api, 'https://candidate.example.com/api.php/provide/vod/');
});

test('live entries publish validated source links even when the target count is not met', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.liveCatalog = [{ name: 'Channel', group: 'News', url: 'https://example.test/live.m3u8' }];
  for (const source of LIVE_SOURCE_REGISTRY) state.sources[sourceHealthKey(source)] = { state: 'WATCH' };
  for (const source of LIVE_SOURCE_REGISTRY.slice(0, 9)) {
    state.sources[sourceHealthKey(source)] = { state: 'ACTIVE', ok: true, lastSuccessAt: '2026-07-19T00:00:00.000Z' };
  }
  assert.equal(buildConfig('https://v8.example', state).lives.length, 9);
  const tenth = LIVE_SOURCE_REGISTRY[9];
  state.sources[sourceHealthKey(tenth)] = { state: 'ACTIVE', ok: true, lastSuccessAt: '2026-07-19T00:00:00.000Z' };
  assert.equal(buildConfig('https://v8.example', state).lives.length, 10);
});

test('live compatibility text keeps validated channels while degraded', async () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.liveCatalog = [{ name: 'Channel', group: 'News', url: 'https://example.test/live.m3u8' }];
  for (const source of LIVE_SOURCE_REGISTRY) state.sources[sourceHealthKey(source)] = { state: 'WATCH' };
  for (const source of LIVE_SOURCE_REGISTRY.slice(0, 9)) {
    state.sources[sourceHealthKey(source)] = { state: 'ACTIVE', ok: true, lastSuccessAt: '2026-07-19T00:00:00.000Z' };
  }
  assert.equal(buildConfig('https://v8.example', state).registry.degraded, true);
  const response = await worker.fetch(new Request('https://v8.example/live.txt'), {
    SOURCE_HEALTH: {
      async get() { return state; },
      async put() {},
    },
  });
  const body = await response.text();
  assert.match(body, /^#EXTM3U/mu);
  assert.match(body, /https:\/\/example\.test\/live\.m3u8/u);
});

test('watch source remains visible while rejected source is hidden', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  const watch = SOURCE_REGISTRY[0];
  const rejected = SOURCE_REGISTRY[1];
  state.sources[sourceHealthKey(watch)] = { state: 'WATCH', admissionTier: 'WATCH', ok: true, lastSuccessAt: '2026-07-19T00:00:00.000Z' };
  state.sources[sourceHealthKey(rejected)] = { state: 'QUARANTINED', admissionTier: 'REJECTED', hardFailure: true, hardFailures: ['DETAIL_UNAVAILABLE'] };
  const config = buildConfig('https://v8.example', state);
  assert.ok(config.sites.some((site) => site.key === watch.key));
  assert.ok(!config.sites.some((site) => site.key === rejected.key));
});

test('native capability and changeable values are not fabricated', () => {
  const source = SOURCE_REGISTRY[0];
  const native = tvSite(source, 0, { health: { nativeFilterable: true, directPlaybackEligible: true } });
  const plain = tvSite(source, 0, { health: { nativeFilterable: false, directPlaybackEligible: false } });
  assert.equal(native.filterable, 1);
  assert.equal(native.changeable, 1);
  assert.equal(plain.filterable, 0);
  assert.equal(plain.changeable, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(native, 'categories'), false);
});

test('native sorting requires an explicit upstream sort structure', () => {
  const filterOnly = nativeFilterInfo({
    filters: {
      '1': [{ key: 'latest', name: '\u6700\u65b0' }, { key: 'old', name: '\u6700\u65e9' }],
    },
  });
  assert.equal(filterOnly.nativeFilterable, true);
  assert.equal(filterOnly.nativeSortable, false);
  const withSort = nativeFilterInfo({
    filters: {
      '1': [{ key: 'latest', name: '\u6700\u65b0' }, { key: 'old', name: '\u6700\u65e9' }],
    },
    sort: [{ key: 'time', name: '\u66f4\u65b0\u65f6\u95f4' }],
  });
  assert.equal(withSort.nativeSortable, true);
});

test('config counts preaudited seed sources and exposes unprobed counts', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  const config = buildConfig('https://v8.example', state);
  const activeVodSeedCount = SOURCE_REGISTRY.filter((source) => source.seedStatus === 'ACTIVE').length;
  const activeLiveSeedCount = LIVE_SOURCE_REGISTRY.filter((source) => source.seedStatus === 'ACTIVE').length;
  assert.equal(config.registry.strictVodCount, activeVodSeedCount);
  assert.equal(config.registry.strictLiveCount, LIVE_SOURCE_REGISTRY.length);
  assert.equal(config.registry.unprobedVodCount, activeVodSeedCount);
  assert.equal(config.registry.unprobedLiveCount, activeLiveSeedCount);
});

test('visible source names are unique and do not expose health tiers', () => {
  const config = buildConfig('https://v8.example', emptyHealthState());
  const names = config.sites.map((site) => site.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(!names.some((name) => /(?:WATCH|ACTIVE|REJECTED|\u89c2\u5bdf|\u5907\u7528)/iu.test(name)));
});
