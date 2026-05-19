import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDuplicateIds } from '../../src/ui/errors.js';

const ROWS = [
  { Lane: '1', Sample_ID: 'sampleA' },
  { Lane: '2', Sample_ID: 'sampleA' }, // same ID, different lane → OK
  { Lane: '3', Sample_ID: 'sampleA' },
  { Lane: '1', Sample_ID: 'sampleB' },
  { Lane: '1', Sample_ID: 'sampleB' }, // same ID AND same lane → real dup
];

test('detectDuplicateIds keys by (Lane, Sample_ID) when laneCol is given', () => {
  const dupes = detectDuplicateIds(ROWS, 'Sample_ID', 'Lane');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].id, 'sampleB');
  assert.equal(dupes[0].lane, '1');
  assert.deepEqual(dupes[0].rows, [4, 5]);
});

test('detectDuplicateIds falls back to Sample_ID alone when laneCol is null', () => {
  const dupes = detectDuplicateIds(ROWS, 'Sample_ID', null);
  // sampleA appears 3x, sampleB appears 2x — both flagged
  assert.equal(dupes.length, 2);
});

test('detectDuplicateIds returns empty array when all unique', () => {
  const rows = [
    { Lane: '1', Sample_ID: 'a' },
    { Lane: '1', Sample_ID: 'b' },
    { Lane: '2', Sample_ID: 'a' },
  ];
  assert.deepEqual(detectDuplicateIds(rows, 'Sample_ID', 'Lane'), []);
});
