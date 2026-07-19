import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILURES_TO_HIDE, PROBATION_SAMPLE_COUNT, applyProbe, sourceIsVisible, updateHealthState } from '../src/health.mjs';

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
