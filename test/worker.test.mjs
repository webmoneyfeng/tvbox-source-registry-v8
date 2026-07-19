import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { allRegistry, buildConfig, effectiveSources, selectionBatch } from '../src/worker.mjs';
import { emptyHealthState } from '../src/health.mjs';
import { sourceHealthKey } from '../src/health.mjs';
import { SOURCE_REGISTRY } from '../src/registry.mjs';

test('config is directly importable and has no empty site list', () => {
  const config = buildConfig('https://example.workers.dev', emptyHealthState());
  assert.equal(config.sites.length, 10);
  assert.equal(config.sites[0].type, 1);
  assert.equal(config.sites[0].searchable, 1);
  assert.equal(config.sites[0].quickSearch, 1);
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
  assert.equal(body.sites.length, 10);
});

test('quick search moves to the first currently visible source', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  state.sources[sourceHealthKey(SOURCE_REGISTRY[0])] = { state: 'WATCH' };
  const config = buildConfig('https://v8.example', state);
  assert.equal(config.sites[0].quickSearch, 1);
  assert.equal(config.sites.filter((site) => site.quickSearch === 1).length, 1);
});

test('last known good source is used when current source set is empty', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  for (const source of SOURCE_REGISTRY) state.sources[sourceHealthKey(source)] = { state: 'WATCH' };
  state.lastKnownGoodVOD = [sourceHealthKey(SOURCE_REGISTRY[1])];
  const config = buildConfig('https://v8.example', state);
  assert.equal(config.sites.length, 1);
  assert.equal(config.sites[0].key, SOURCE_REGISTRY[1].key);
});

test('probe selection includes untested watch sources before recently checked active sources', () => {
  const state = emptyHealthState('2026-07-19T00:00:00.000Z');
  const registry = allRegistry(state);
  for (const source of registry.slice(0, 10)) state.sources[sourceHealthKey(source)] = { state: 'ACTIVE', checkedAt: '2026-07-19T01:00:00.000Z' };
  const batch = selectionBatch(registry, state);
  assert.ok(batch.some((source) => source.seedStatus === 'WATCH'));
});
