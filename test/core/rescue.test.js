import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefixMatch, applySubstitutions } from '../../src/core/rescue.js';

const SAMPLES = [
  { Sample_ID: 'S1', index: 'AAAAAAAA' + 'TT', index2: 'CCCCCCCC' + 'AA' },
  { Sample_ID: 'S2', index: 'GGGGGGGG' + 'NN', index2: 'TTTTTTTT' + 'NN' },
  { Sample_ID: 'S3', index: 'ACGTACGT' + 'CA', index2: 'TGCATGCA' + 'GG' },
];

const TOP_UNKNOWN = [
  { index: 'AAAAAAAAGC', index2: 'CCCCCCCCGT', reads: 1_000_000 },
  { index: 'AAAAAAAATT', index2: 'CCCCCCCCAA', reads: 5_000 }, // exact match for S1
  { index: 'GGGGGGGGTT', index2: 'TTTTTTTTTT', reads: 250_000 }, // prefix for S2
  { index: 'ZZZZZZZZZZ', index2: 'YYYYYYYYYY', reads: 100 }, // unrelated
];

test('prefixMatch finds prefix-aligned candidates ranked by reads', () => {
  const matches = prefixMatch(SAMPLES, TOP_UNKNOWN, { n: 8 });
  // S1 and S2 should both match; S3 has no candidate
  assert.equal(matches.length, 2);
  const m1 = matches.find((m) => m.sampleId === 'S1');
  assert.ok(m1);
  // First candidate should be the higher-read one (1M reads with non-exact)
  assert.equal(m1.candidates[0].reads, 1_000_000);
  assert.equal(m1.candidates[0].exactMatch, false);
  // Second should be the exact match
  assert.equal(m1.candidates[1].reads, 5_000);
  assert.equal(m1.candidates[1].exactMatch, true);
});

test('prefixMatch confidence sums to <=1', () => {
  const matches = prefixMatch(SAMPLES, TOP_UNKNOWN, { n: 8 });
  for (const m of matches) {
    for (const c of m.candidates) {
      assert.ok(c.confidence >= 0 && c.confidence <= 1);
    }
  }
});

test('applySubstitutions swaps indices for picked samples only', () => {
  const subs = new Map([['S1', { newI7: 'AAAAAAAAGC', newI5: 'CCCCCCCCGT' }]]);
  const out = applySubstitutions(SAMPLES, subs);
  assert.equal(out[0].index, 'AAAAAAAAGC');
  assert.equal(out[0].index2, 'CCCCCCCCGT');
  // S2 untouched
  assert.equal(out[1].index, SAMPLES[1].index);
});

test('prefixMatch single-index mode ignores index2', () => {
  const matches = prefixMatch(SAMPLES, TOP_UNKNOWN, { n: 8, dual: false });
  const m2 = matches.find((m) => m.sampleId === 'S2');
  assert.ok(m2);
});
