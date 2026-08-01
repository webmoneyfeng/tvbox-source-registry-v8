import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCategoryManifest,
  categoryId,
  categoryName,
  chooseCategoryManifest,
  parentIdOf,
  visibleClassesFromManifest,
} from '../src/native-category.mjs';

test('native category compiler preserves upstream id and name while hiding structural parents', () => {
  const classes = [
    { type_id: '1', type_name: 'Parent', type_pid: '0' },
    { type_id: '2', type_name: 'Child A', type_pid: '1' },
    { type_id: '3', type_name: 'Child B', type_pid: '1' },
  ];
  const manifest = buildCategoryManifest(classes, new Map([
    ['1', { ok: true, count: 99, total: 99 }],
    ['2', { ok: true, count: 20, total: 100 }],
    ['3', { ok: true, count: 5, total: 5 }],
  ]), '2026-08-01T00:00:00.000Z');

  assert.deepEqual(visibleClassesFromManifest(manifest), [
    { type_id: '2', type_name: 'Child A', type_pid: '1' },
    { type_id: '3', type_name: 'Child B', type_pid: '1' },
  ]);
  assert.equal(manifest.rows.find((row) => row.id === '1').visible, false);
  assert.equal(manifest.rows.find((row) => row.id === '1').hiddenReason, 'STRUCTURAL_PARENT');
});

test('native category compiler uses real list-count evidence when no parent fields exist', () => {
  const classes = [
    { type_id: '1', type_name: 'Empty Group' },
    { type_id: '2', type_name: 'Playable Leaf' },
  ];
  const manifest = buildCategoryManifest(classes, new Map([
    ['1', { ok: true, count: 0, total: 0, status: 200 }],
    ['2', { ok: true, count: 20, total: 300, status: 200 }],
  ]), '2026-08-01T00:00:00.000Z');

  assert.deepEqual(visibleClassesFromManifest(manifest), [
    { type_id: '2', type_name: 'Playable Leaf' },
  ]);
  assert.equal(manifest.rows.find((row) => row.id === '1').hiddenReason, 'EMPTY_OR_UNVERIFIED_CATEGORY');
});

test('native category compiler keeps last known good manifest when current probe has zero visible categories', () => {
  const previous = buildCategoryManifest([
    { type_id: '9', type_name: 'Existing Leaf' },
  ], new Map([['9', { ok: true, count: 10, total: 10, status: 200 }]]), '2026-08-01T00:00:00.000Z');
  const current = buildCategoryManifest([
    { type_id: '9', type_name: 'Existing Leaf' },
  ], new Map([['9', { ok: false, count: 0, total: 0, status: 0, error: 'timeout' }]]), '2026-08-01T00:05:00.000Z');

  const selected = chooseCategoryManifest(current, previous);
  assert.equal(selected.checkedAt, previous.checkedAt);
  assert.equal(selected.fallbackReason, 'CURRENT_MANIFEST_EMPTY');
});

test('native category helpers read the supported upstream field variants', () => {
  const row = { id: 7, name: 'Leaf', parentId: 3 };
  assert.equal(categoryId(row), '7');
  assert.equal(categoryName(row), 'Leaf');
  assert.equal(parentIdOf(row), '3');
});

test('native category compiler contains no source-specific branching', () => {
  const source = readFileSync(new URL('../src/native-category.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['hhzy', 'hongniu', 'baidu', 'ikun', 'huya', 'lovedan', '豪华', '红牛', '百度', '虎牙', '爱旦']) {
    assert.equal(source.includes(forbidden), false, `native-category.mjs must not contain source-specific rule: ${forbidden}`);
  }
});
