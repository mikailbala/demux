import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilter, laneOptions, resolveColumns } from '../../src/core/filter.js';

const ROWS = [
  { Lane: '1', Sample_ID: 'TumorA_01', Sample_Name: 'TumorA_01', index: 'AAAA', index2: 'CCCC' },
  { Lane: '1', Sample_ID: 'TumorA_02', Sample_Name: 'TumorA_02', index: 'TTTT', index2: 'GGGG' },
  { Lane: '2', Sample_ID: 'NormalB_01', Sample_Name: 'NormalB_01', index: 'ACGT', index2: 'TGCA' },
  { Lane: '2', Sample_ID: 'NormalB_02', Sample_Name: 'NormalB_02', index: 'CCAA', index2: 'GGTT' },
];

test('filter by lane', () => {
  const out = applyFilter(ROWS, { lanes: ['1'] });
  assert.equal(out.length, 2);
  assert(out.every((r) => r.Lane === '1'));
});

test('filter by regex on Sample_ID', () => {
  const out = applyFilter(ROWS, { regex: '^TumorA_' });
  assert.equal(out.length, 2);
});

test('filter by id list', () => {
  const out = applyFilter(ROWS, { idList: ['TumorA_01', 'NormalB_02'] });
  assert.equal(out.length, 2);
});

test('AND across criteria types', () => {
  // lanes=[2] AND regex matching Tumor → empty
  const empty = applyFilter(ROWS, { lanes: ['2'], regex: '^TumorA_' });
  assert.equal(empty.length, 0);
  // lanes=[1,2] AND regex matching Tumor → 2
  const some = applyFilter(ROWS, { lanes: ['1', '2'], regex: '^TumorA_' });
  assert.equal(some.length, 2);
});

test('OR within a lane list', () => {
  const both = applyFilter(ROWS, { lanes: ['1', '2'] });
  assert.equal(both.length, 4);
});

test('rejects bad regex with a helpful error', () => {
  assert.throws(() => applyFilter(ROWS, { regex: '[bad(' }), /Invalid regex/);
});

test('laneOptions returns sorted unique lanes', () => {
  assert.deepEqual(laneOptions(ROWS), ['1', '2']);
});

test('resolveColumns finds expected columns', () => {
  const cols = resolveColumns(ROWS);
  assert.equal(cols.sampleId, 'Sample_ID');
  assert.equal(cols.lane, 'Lane');
  assert.equal(cols.index, 'index');
  assert.equal(cols.index2, 'index2');
});
