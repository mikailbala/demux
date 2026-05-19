import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTopUnknown } from '../../src/parsers/topunknown.js';

const CSV = `Lane,index,index2,# Reads,% of Unknown Barcodes,% of All Reads
1,AAAAAAAA,CCCCCCCC,1234567,12.34,1.23
1,GGGGGGGG,TTTTTTTT,890000,8.90,0.89
2,ACGTACGT,TGCATGCA,500000,5.00,0.50
`;

test('parses bcl-convert TopUnknownBarcodes.csv', () => {
  const rows = parseTopUnknown(CSV);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    lane: 1,
    index: 'AAAAAAAA',
    index2: 'CCCCCCCC',
    reads: 1234567,
    pctUnknown: 12.34,
    pctAll: 1.23,
  });
});

test('handles BOM', () => {
  const rows = parseTopUnknown('﻿' + CSV);
  assert.equal(rows.length, 3);
});

test('filters out rows with no index data', () => {
  const csv = `Lane,index,index2,# Reads\n1,,,100\n1,AAAA,CCCC,200\n`;
  const rows = parseTopUnknown(csv);
  assert.equal(rows.length, 1);
});
