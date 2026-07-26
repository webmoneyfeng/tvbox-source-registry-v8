import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePublicationGate, summarizeTarget } from '../src/admission.mjs';

test('target summary separates candidate, usable and strict counts', () => {
  const summary = summarizeTarget({ active: 2, watch: 8, corePlayable: 10 });
  assert.equal(summary.candidateTargetMet, true);
  assert.equal(summary.usableTargetMet, true);
  assert.equal(summary.strictTargetMet, false);
});

test('publication gate remains degraded until published target is verified', () => {
  const gate = evaluatePublicationGate({
    vod: { active: 0, watch: 12, corePlayable: 12 },
    live: { active: 6, watch: 4, corePlayable: 10 },
    publishedTargetVerified: false,
  });
  assert.equal(gate.vod.candidateTargetMet, true);
  assert.equal(gate.live.candidateTargetMet, true);
  assert.equal(gate.vod.usableTargetMet, true);
  assert.equal(gate.live.usableTargetMet, true);
  assert.equal(gate.publicationReady, false);
  assert.equal(gate.degraded, true);
  assert.ok(gate.blockers.includes('PUBLISHED_TARGET_NOT_VERIFIED'));
});

test('publication gate passes only after both kinds and runtime target are verified', () => {
  const gate = evaluatePublicationGate({
    vod: { active: 4, watch: 6, corePlayable: 10 },
    live: { active: 10, watch: 0, corePlayable: 10 },
    publishedTargetVerified: true,
  });
  assert.equal(gate.publicationReady, true);
  assert.equal(gate.degraded, false);
  assert.deepEqual(gate.blockers, []);
});
