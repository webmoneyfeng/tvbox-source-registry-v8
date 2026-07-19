import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreLiveProbe, scoreVodProbe } from '../src/scoring.mjs';

test('VOD score rewards complete, recent and searchable sources', () => {
  const score = scoreVodProbe({
    listCount: 20,
    classCount: 10,
    searchEvidence: [{ ok: true }, { ok: true }, { ok: false }],
    detailOk: true,
    playOk: true,
    latestAt: '2026-07-19T00:00:00.000Z',
    latencyMs: 1200,
  }, Date.parse('2026-07-19T12:00:00.000Z'));
  assert.ok(score.total >= 85);
});

test('live score cannot pass without playable channels', () => {
  const score = scoreLiveProbe({ channelCount: 100, groupCount: 5, playableCount: 0, sampleCount: 4, duplicateRate: 0, httpStatus: 200, latencyMs: 1000 });
  assert.ok(score.total < 80);
});
