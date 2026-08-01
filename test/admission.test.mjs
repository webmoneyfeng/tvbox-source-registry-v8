import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLiveStability, classifyVodStability, summarizeAttempts } from '../src/admission.mjs';

test('VOD stability promotes only fully stable detail and playback attempts', () => {
  const summary = summarizeAttempts([
    { ok: true, detailOk: true, playOk: true, latencyMs: 1000 },
    { ok: true, detailOk: true, playOk: true, latencyMs: 1200 },
    { ok: true, detailOk: true, playOk: true, latencyMs: 900 },
  ]);
  assert.equal(summary.successRate, 1);
  assert.equal(classifyVodStability(summary).tier, 'ACTIVE');
});

test('VOD stability rejects sources with detail or playback gaps', () => {
  const summary = summarizeAttempts([
    { ok: true, detailOk: true, playOk: false, rootCauses: ['SOURCE_PLAYBACK_GAP'] },
    { ok: true, detailOk: true, playOk: false, rootCauses: ['SOURCE_PLAYBACK_GAP'] },
  ]);
  assert.equal(classifyVodStability(summary).tier, 'REJECTED');
});

test('VOD stability keeps very slow sources in watch even when playback passes', () => {
  const summary = summarizeAttempts([
    { ok: true, detailOk: true, playOk: true, latencyMs: 16000 },
    { ok: true, detailOk: true, playOk: true, latencyMs: 15000 },
    { ok: true, detailOk: true, playOk: true, latencyMs: 17000 },
  ]);
  const result = classifyVodStability(summary);
  assert.equal(result.tier, 'WATCH');
  assert.equal(result.reason, 'SLOW_SOURCE');
});


test('LIVE stability separates full pass, partial pass and failure', () => {
  assert.equal(classifyLiveStability(summarizeAttempts([
    { ok: true, playableCount: 2 },
    { ok: true, playableCount: 3 },
    { ok: true, playableCount: 2 },
  ])).tier, 'ACTIVE');
  assert.equal(classifyLiveStability(summarizeAttempts([
    { ok: true, playableCount: 2 },
    { ok: true, playableCount: 0, rootCauses: ['MEDIA_SEGMENT_UNAVAILABLE'] },
    { ok: true, playableCount: 2 },
  ])).tier, 'WATCH');
  assert.equal(classifyLiveStability(summarizeAttempts([
    { ok: false, playableCount: 0, rootCauses: ['PLAYLIST_UNAVAILABLE'] },
    { ok: true, playableCount: 0, rootCauses: ['MEDIA_SEGMENT_UNAVAILABLE'] },
  ])).tier, 'REJECTED');
});

test('LIVE stability keeps a truncated playlist in watch even when sampled media passes', () => {
  const result = classifyLiveStability(summarizeAttempts([
    { ok: false, playableCount: 2, rootCauses: ['PLAYLIST_TRUNCATED'] },
    { ok: false, playableCount: 2, rootCauses: ['PLAYLIST_TRUNCATED'] },
    { ok: false, playableCount: 2, rootCauses: ['PLAYLIST_TRUNCATED'] },
  ]));
  assert.equal(result.tier, 'WATCH');
  assert.equal(result.reason, 'PARTIAL_CHANNEL_FAILURE');
});
