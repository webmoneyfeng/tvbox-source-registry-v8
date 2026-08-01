import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLiveProfiles, isHighOverlap, profileLiveChannels } from '../src/live-overlap.mjs';

test('live playlist fingerprints ignore channel order but preserve name and URL identity', () => {
  const left = profileLiveChannels([
    { name: 'Alpha HD', url: 'https://example.com/a.m3u8' },
    { name: 'Beta', url: 'https://example.com/b.m3u8' },
  ]);
  const right = profileLiveChannels([
    { name: 'Beta', url: 'https://example.com/b.m3u8' },
    { name: 'Alpha', url: 'https://example.com/a.m3u8' },
  ]);
  assert.equal(compareLiveProfiles(left, right).sameFingerprint, true);
});

test('live playlist overlap exposes partial coverage instead of treating it as an exact duplicate', () => {
  const left = profileLiveChannels([
    { name: 'Alpha', url: 'https://example.com/a.m3u8' },
    { name: 'Beta', url: 'https://example.com/b.m3u8' },
  ]);
  const right = profileLiveChannels([
    { name: 'Alpha', url: 'https://example.com/a.m3u8' },
    { name: 'Gamma', url: 'https://example.com/c.m3u8' },
  ]);
  const comparison = compareLiveProfiles(left, right);
  assert.equal(comparison.sameFingerprint, false);
  assert.equal(comparison.sharedUrls, 1);
  assert.equal(comparison.leftUrlCoverage, 0.5);
  assert.equal(isHighOverlap(comparison), false);
});

test('live overlap flags a candidate that mostly repeats an existing playlist', () => {
  const candidate = profileLiveChannels([
    { name: 'Alpha', url: 'https://example.com/a.m3u8' },
    { name: 'Beta', url: 'https://example.com/b.m3u8' },
  ]);
  const existing = profileLiveChannels([
    { name: 'Alpha', url: 'https://example.com/a.m3u8' },
    { name: 'Beta', url: 'https://example.com/b.m3u8' },
    { name: 'Gamma', url: 'https://example.com/c.m3u8' },
  ]);
  assert.equal(isHighOverlap(compareLiveProfiles(candidate, existing)), true);
});
