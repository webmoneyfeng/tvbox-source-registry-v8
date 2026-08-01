import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_REGISTRY, candidateToRegistrySource, loadRegistry, sourceDisplayName, tvSite } from '../src/registry.mjs';

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

test('unnamed sources use the playlist path so same-host feeds remain distinguishable', () => {
  const first = candidateToRegistrySource({
    kind: 'live',
    api: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u',
  });
  const second = candidateToRegistrySource({
    kind: 'live',
    api: 'https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u',
  });
  assert.notEqual(sourceDisplayName(first), sourceDisplayName(second));
  assert.match(sourceDisplayName(first), /streams\/tw\.m3u/u);
  assert.match(sourceDisplayName(second), /m3u\/iptv\.m3u/u);
});

test('TV sites use source-specific labels and only the first line joins quick search', () => {
  const sites = SOURCE_REGISTRY.slice(0, 2).map((source, index) => tvSite(source, index, {
    quickSearch: index === 0,
    health: { searchCapability: true },
  }));
  assert.equal(sites[0].name, SOURCE_REGISTRY[0].displayName);
  assert.equal(sites[1].name, SOURCE_REGISTRY[1].displayName);
  assert.notEqual(sites[0].name, sites[1].name);
  assert.equal(sites[0].quickSearch, 1);
  assert.equal(sites[1].quickSearch, 0);
  assert.equal(sites[0].api, SOURCE_REGISTRY[0].api);
  assert.ok(!sites.some((site) => /^\u5f71\u89c6\u7ebf\u8def\s+\d+$/u.test(site.name)));
  assert.ok(!JSON.stringify(sites).includes('\u5907\u7528'));
});

test('TV sites expose native search capability without fabricating it', () => {
  const source = SOURCE_REGISTRY[0];
  assert.equal(tvSite(source, 0, { health: { searchCapability: true } }).searchable, 1);
  assert.equal(tvSite(source, 0, { health: { searchCapability: false } }).searchable, 0);
  assert.equal(tvSite(source, 0).searchable, 0);
  assert.equal(tvSite(source, 0, { quickSearch: true }).quickSearch, 0);
});

test('TV sites do not advertise switching or filtering before live evidence exists', () => {
  const source = SOURCE_REGISTRY[0];
  const unprobed = tvSite(source, 0, { quickSearch: true });
  assert.equal(unprobed.filterable, 0);
  assert.equal(unprobed.changeable, 0);
  const probed = tvSite(source, 0, {
    quickSearch: true,
    health: {
      searchCapability: true,
      nativeFilterable: true,
      directPlaybackEligible: true,
    },
  });
  assert.equal(probed.searchable, 1);
  assert.equal(probed.quickSearch, 1);
  assert.equal(probed.filterable, 1);
  assert.equal(probed.changeable, 1);
});


test('v8.2 audit scripts inherit the canonical registry version', async () => {
  const { readFile } = await import('node:fs/promises');
  const files = [
    'scripts/audit-candidate-pool-v82.mjs',
    'scripts/audit-deep-sources-v82.mjs',
    'scripts/seed-health-from-deep-audit-v82.mjs',
  ];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.match(text, /REGISTRY_VERSION/u, `${file} should import the registry version constant`);
    assert.doesNotMatch(text, /registryVersion:\s*['"]v8\.2\.0['"]/u, `${file} must not hard-code a stale v8.2.0 report version`);
  }
});
