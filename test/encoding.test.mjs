import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSourceBytes, encodingEvidence } from '../src/encoding.mjs';

test('encoding prefers valid UTF-8 and reports clean evidence', () => {
  const bytes = new TextEncoder().encode('天道 电视剧');
  const result = decodeSourceBytes(bytes, 'application/json; charset=utf-8');
  assert.equal(result.text, '天道 电视剧');
  assert.equal(result.encoding, 'utf-8');
  assert.equal(encodingEvidence(result).clean, true);
});

test('encoding falls back to GB18030 when UTF-8 is invalid', () => {
  const bytes = new Uint8Array([0xCC, 0xEC, 0xB5, 0xC0]);
  const result = decodeSourceBytes(bytes, 'application/json');
  assert.equal(result.text, '天道');
  assert.equal(result.encoding, 'gb18030');
  assert.equal(result.replacementCount, 0);
});

test('encoding evidence detects replacement characters', () => {
  const result = decodeSourceBytes(new TextEncoder().encode('\uFFFD'), 'text/plain');
  assert.equal(encodingEvidence(result).clean, false);
});
