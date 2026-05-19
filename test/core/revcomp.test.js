import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revcomp, applyRC, previewIndices } from '../../src/core/revcomp.js';

test('revcomp on canonical bases', () => {
  assert.equal(revcomp('ACGT'), 'ACGT'); // palindrome
  assert.equal(revcomp('AAAA'), 'TTTT');
  assert.equal(revcomp('CCCC'), 'GGGG');
  assert.equal(revcomp('AACCGGTTNN'), 'NNAACCGGTT');
});

test('revcomp lowercase input', () => {
  assert.equal(revcomp('acgt'), 'ACGT');
});

test('revcomp empty string', () => {
  assert.equal(revcomp(''), '');
});

test('revcomp throws on invalid base', () => {
  assert.throws(() => revcomp('ACGTQ'), /invalid base 'Q'/);
});

test('applyRC only rc-enabled indices', () => {
  const rows = [{ Sample_ID: 'S1', index: 'AAAA', index2: 'CCCC' }];
  const r1 = applyRC(rows, { i7: true });
  assert.equal(r1[0].index, 'TTTT');
  assert.equal(r1[0].index2, 'CCCC');
  const r2 = applyRC(rows, { i7: true, i5: true });
  assert.equal(r2[0].index, 'TTTT');
  assert.equal(r2[0].index2, 'GGGG');
  const r3 = applyRC(rows, {});
  assert.equal(r3[0].index, 'AAAA'); // unchanged
});

test('applyRC does not mutate input', () => {
  const rows = [{ Sample_ID: 'S1', index: 'AAAA' }];
  applyRC(rows, { i7: true });
  assert.equal(rows[0].index, 'AAAA');
});

test('previewIndices returns first N rows with i7/i5', () => {
  const rows = [
    { Sample_ID: 'A', index: 'AAAA', index2: 'CCCC' },
    { Sample_ID: 'B', index: 'TTTT', index2: 'GGGG' },
    { Sample_ID: 'C', index: 'ACGT', index2: 'TGCA' },
    { Sample_ID: 'D', index: 'CCAA', index2: 'GGTT' },
  ];
  const p = previewIndices(rows, 2);
  assert.equal(p.length, 2);
  assert.equal(p[0].sampleId, 'A');
});
