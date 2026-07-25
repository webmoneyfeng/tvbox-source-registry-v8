import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_REGISTRY, candidateToRegistrySource, loadRegistry, tvSite } from '../src/registry.mjs';

test('registry has unique physical sources and stable priority', () => {
  assert.ok(SOURCE_REGISTRY.length >= 10);
  assert.equal(new Set(SOURCE_REGISTRY.map((source) => source.physicalKey)).size, SOURCE_REGISTRY.length);
  assert.deepEqual([...SOURCE_REGISTRY].sort((a, b) => b.priority - a.priority), SOURCE_REGISTRY);
});

test('registry rejects duplicate physical hosts', () => {
  assert.throws(() => loadRegistry([
    { slug: 'a', api: 'https://www.example.com/api', seedStatus: 'ACTIVE' },
    { slug: 'b', api: 'https://example.com/other', seedStatus: 'WATCH' },
  ]), /duplicate physical source/);
});

test('discovered sources carry the same physical key as seeded sources', () => {
  const source = candidateToRegistrySource({
    kind: 'live',
    api: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
  });
  assert.equal(source.physicalKey, 'raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u');
});

test('TV sites use source-specific labels and only the first line joins quick search', () => {
  const sites = SOURCE_REGISTRY.slice(0, 2).map((source, index) => tvSite(source, index, { quickSearch: index === 0 }));
  assert.equal(sites[0].name, SOURCE_REGISTRY[0].displayName);
  assert.equal(sites[1].name, SOURCE_REGISTRY[1].displayName);
  assert.notEqual(sites[0].name, sites[1].name);
  assert.equal(sites[0].quickSearch, 1);
  assert.equal(sites[1].quickSearch, 0);
  assert.equal(sites[0].api, SOURCE_REGISTRY[0].api);
  assert.ok(!sites.some((site) => /^\u5f71\u89c6\u7ebf\u8def\s+\d+$/u.test(site.name)));
  assert.ok(!JSON.stringify(sites).includes('\u5907\u7528'));
});
