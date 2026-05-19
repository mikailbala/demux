import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestOverride, validateOverride } from '../../src/core/cycles.js';

test('suggestOverride builds the standard string', () => {
  const runInfo = {
    reads: [
      { number: 1, cycles: 151, isIndex: false },
      { number: 2, cycles: 10, isIndex: true },
      { number: 3, cycles: 10, isIndex: true },
      { number: 4, cycles: 151, isIndex: false },
    ],
  };
  assert.equal(suggestOverride(runInfo), 'Y151;I10;I10;Y151');
});

test('validateOverride accepts well-formed strings', () => {
  for (const s of [
    'Y151;I10;I10;Y151',
    'Y151;I8N2;I8N2;Y151',
    'Y150N1;I8;I8;Y150N1',
    'I8',
  ]) {
    assert.equal(validateOverride(s).ok, true, `expected ok for ${s}`);
  }
});

test('validateOverride rejects malformed strings', () => {
  for (const s of ['Y;I10', 'Z151', 'Y151;X10', '123', 'Y151,I10,I10,Y151']) {
    assert.equal(validateOverride(s).ok, false, `expected fail for ${s}`);
  }
});

test('validateOverride accepts empty (no override)', () => {
  assert.equal(validateOverride('').ok, true);
  assert.equal(validateOverride(undefined).ok, true);
});
