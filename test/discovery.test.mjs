import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeCandidates, extractCandidates, isPublicHttpUrl } from '../src/discovery.mjs';
import { candidateToRegistrySource } from '../src/registry.mjs';

test('discovery accepts only public HTTP URLs', () => {
  assert.equal(isPublicHttpUrl('https://example.com/config.json'), true);
  assert.equal(isPublicHttpUrl('http://127.0.0.1/config.json'), false);
  assert.equal(isPublicHttpUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isPublicHttpUrl('http://100.64.0.1/config.json'), false);
  assert.equal(isPublicHttpUrl('https://user:pass@example.com/config.json'), false);
});

test('discovery extracts type 1 CMS and live candidates but ignores scripts', () => {
  const candidates = extractCandidates({
    sites: [
      { type: 1, name: 'cms', api: 'https://example.com/api.php/provide/vod/' },
      { type: 3, name: 'script', api: 'https://example.com/jar' },
    ],
    lives: [{ name: 'live', url: 'https://example.com/live.m3u' }],
  }, 'https://feed.example.com/config.json');
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'vod');
});

test('discovery deduplicates same physical path', () => {
  const result = dedupeCandidates([
    { kind: 'vod', api: 'https://www.example.com/api' },
    { kind: 'vod', api: 'https://example.com/api' },
    { kind: 'vod', api: 'https://example.com/other-api' },
    { kind: 'live', api: 'https://example.com/live.m3u' },
  ]);
  assert.equal(result.length, 2);
});

test('discovered source key does not depend on candidate order', () => {
  const a = candidateToRegistrySource({ kind: 'vod', api: 'https://example.com/api/a' }, 0);
  const b = candidateToRegistrySource({ kind: 'vod', api: 'https://example.com/api/a' }, 99);
  assert.equal(a.slug, b.slug);
});
