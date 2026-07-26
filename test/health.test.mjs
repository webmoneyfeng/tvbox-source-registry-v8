import assert from 'node:assert/strict';
import test from 'node:test';
import { DEEP_AUDIT_FAILURES_TO_HIDE, FAILURES_TO_HIDE, PROBATION_SAMPLE_COUNT, applyProbe, effectiveAdmissionTier, sourceIsVisible, updateHealthState, verificationState } from '../src/health.mjs';

const active = { slug: 'active', seedStatus: 'ACTIVE' };
const watch = { slug: 'watch', seedStatus: 'WATCH' };

test('active source is hidden only after consecutive failure threshold', () => {
  let row = null;
  for (let i = 1; i <= FAILURES_TO_HIDE; i += 1) {
    row = applyProbe(row, active, { ok: false }, `2026-07-19T00:0${i}:00.000Z`);
    assert.equal(sourceIsVisible(active, row), i < FAILURES_TO_HIDE);
  }
});

test('watch source needs a six-hour probation window before promotion', () => {
  let row = null;
  const start = Date.parse('2026-07-19T00:00:00.000Z');
  for (let i = 0; i < PROBATION_SAMPLE_COUNT; i += 1) {
    const at = new Date(start + i * 35 * 60 * 1000).toISOString();
    row = applyProbe(row, watch, { ok: true, detailOk: true, playOk: true }, at);
  }
  assert.equal(sourceIsVisible(watch, row), true);
  assert.equal(row.state, 'ACTIVE');
});

test('health revision changes only when visible set changes', () => {
  const registry = [active, watch];
  const state = updateHealthState(registry, null, [
    { slug: 'active', ok: true },
    { slug: 'watch', ok: true },
  ], '2026-07-19T00:01:00.000Z');
  assert.equal(state.revision, 'vod:active');
});

test('health hides a source when deep playback evidence is explicitly false', () => {
  const row = applyProbe(null, active, {
    ok: true,
    detailOk: false,
    playOk: false,
    directPlaybackEligible: false,
  }, '2026-07-19T01:00:00.000Z');
  assert.equal(sourceIsVisible(active, row), false);
});

test('a deep-audit-verified source recovers from stale quarantine after one clean probe', () => {
  const row = applyProbe({
    state: 'QUARANTINED',
    admissionTier: 'REJECTED',
    hardFailure: true,
    hardFailures: ['AD_OR_PARSE_CONTENT'],
    consecutiveFailures: 3,
    lastDeepAuditAt: '2026-07-19T00:00:00.000Z',
    deepAuditOk: true,
  }, active, {
    ok: true,
    detailOk: true,
    playOk: true,
    directPlaybackEligible: true,
  }, '2026-07-19T01:00:00.000Z');
  assert.equal(row.state, 'WATCH');
  assert.equal(sourceIsVisible(active, row), true);
});

test('a known-good source survives one transient hard probe failure', () => {
  const row = applyProbe({
    state: 'ACTIVE',
    admissionTier: 'ACTIVE',
    ok: true,
    lastSuccessAt: '2026-07-19T00:00:00.000Z',
    consecutiveFailures: 0,
  }, active, {
    ok: false,
    hardFailure: true,
    hardFailures: ['AD_OR_PARSE_CONTENT'],
  }, '2026-07-19T01:00:00.000Z');
  assert.equal(sourceIsVisible(active, row), true);
});

test('a deep-audit source tolerates shallow failures for the extended window', () => {
  const row = {
    state: 'QUARANTINED',
    admissionTier: 'REJECTED',
    ok: false,
    hardFailure: true,
    hardFailures: ['DIRECT_PLAYBACK_UNAVAILABLE'],
    detailOk: false,
    playOk: false,
    directPlaybackEligible: false,
    consecutiveFailures: DEEP_AUDIT_FAILURES_TO_HIDE - 1,
    lastDeepAuditAt: '2026-07-19T00:00:00.000Z',
    lastSuccessAt: '2026-07-18T23:00:00.000Z',
    deepAuditOk: true,
  };
  assert.equal(sourceIsVisible(active, row), true);
  assert.equal(sourceIsVisible(active, { ...row, consecutiveFailures: DEEP_AUDIT_FAILURES_TO_HIDE }), false);
});

test('a transient deep-audit failure keeps its baseline admission tier in summaries', () => {
  assert.equal(effectiveAdmissionTier(active, {
    admissionTier: 'REJECTED',
    deepAuditOk: true,
    deepAuditTier: 'ACTIVE',
    consecutiveFailures: 1,
  }), 'ACTIVE');
});

test('seed admission is explicit when a source has not yet been probed in KV', () => {
  assert.equal(effectiveAdmissionTier(active, null), 'ACTIVE');
  assert.equal(verificationState(active, null), 'PREAUDITED_SEED');
  assert.equal(effectiveAdmissionTier({ ...active, seedStatus: 'WATCH' }, null), 'WATCH');
  assert.equal(verificationState({ ...active, seedStatus: 'WATCH' }, null), 'UNVERIFIED');
});
