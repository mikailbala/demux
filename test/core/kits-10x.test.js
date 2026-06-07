import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadKits,
  detectKit,
  bestKit,
  swapKit,
  lookupWell,
  listKits,
  detectKitFromUnknowns,
} from '../../src/core/kits-10x.js';

await loadKits();

// Snapshot taken from the user's actual broken samplesheet: NN-A workflow A.
const NN_A_WORKFLOW_A_ROWS = [
  { Lane: '1', Sample_ID: '2604107-AG-43-2026-008', index: 'TTACAGAGGG', index2: 'GTTTATGGCA' }, // H1
  { Lane: '6', Sample_ID: '2604108-CG01-001',       index: 'CCGATATATT', index2: 'AACTATCCGA' }, // E5
  { Lane: '6', Sample_ID: '2604108-CG02-002',       index: 'AAATAACGCG', index2: 'ATAGAGGAGC' }, // F5
  { Lane: '6', Sample_ID: '2604108-CG03-003',       index: 'TCCCTCGTCA', index2: 'ATCAGGTGTG' }, // G5
  { Lane: '6', Sample_ID: '2604108-CG04-004',       index: 'GCTAGCGTTC', index2: 'TCGCGTGGTG' }, // H5
  { Lane: '8', Sample_ID: '20260518-scRNA5prime-GE',  index: 'ATTGCAAGAC', index2: 'CGGTGACCAT' }, // C7
  { Lane: '8', Sample_ID: '20260518-scRNA5prime-BCR', index: 'TTTAGGTAGG', index2: 'ACTGAGGGAC' }, // B7
  { Lane: '8', Sample_ID: '20260518-scRNA5prime-TCR', index: 'GCAGTTGTTT', index2: 'ACACTACTTT' }, // A7
];

test('listKits returns the loaded kits', () => {
  const kits = listKits();
  const ids = kits.map((k) => k.id).sort();
  assert.deepEqual(ids, ['NN-A', 'NT-A', 'TT-A']);
  for (const k of kits) assert.equal(k.wellCount, 96);
});

test('detectKit identifies NN-A workflow A from real-world rows', () => {
  const best = bestKit(NN_A_WORKFLOW_A_ROWS);
  assert.ok(best);
  assert.equal(best.id, 'NN-A');
  assert.equal(best.workflow, 'A');
  assert.equal(best.matched, NN_A_WORKFLOW_A_ROWS.length);
  assert.equal(best.total, NN_A_WORKFLOW_A_ROWS.length);
});

test('detectKit returns higher-ranked candidate first', () => {
  const list = detectKit(NN_A_WORKFLOW_A_ROWS);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].matched <= list[i - 1].matched);
  }
});

test('lookupWell finds the right well by (i7, i5)', () => {
  // SI-NN-H1
  const hit = lookupWell('NN-A', 'TTACAGAGGG', 'GTTTATGGCA');
  assert.deepEqual(hit, { workflow: 'A', well: 'H1' });
  // workflow B form (RC of A) of the same well
  const hitB = lookupWell('NN-A', 'TTACAGAGGG', 'TGCCATAAAC');
  assert.deepEqual(hitB, { workflow: 'B', well: 'H1' });
});

test('swapKit NN-A → TT-A preserves wells (verifies the user\'s sample)', () => {
  const result = swapKit(NN_A_WORKFLOW_A_ROWS, {
    fromKit: 'NN-A',
    toKit: 'TT-A',
    workflow: 'A',
  });
  assert.equal(result.swapped.length, NN_A_WORKFLOW_A_ROWS.length);
  assert.equal(result.unmatched.length, 0);

  // SI-NN-H1 → SI-TT-H1: TT-A H1 i7=ACAATGTGAA, i5_a=CGTACCGTTA
  assert.equal(result.rows[0].index, 'ACAATGTGAA');
  assert.equal(result.rows[0].index2, 'CGTACCGTTA');
  // SI-NN-A7 → SI-TT-A7: i7=TCCCAAGGGT, i5_a=TACTACCTTT
  assert.equal(result.rows[7].index, 'TCCCAAGGGT');
  assert.equal(result.rows[7].index2, 'TACTACCTTT');
});

test('swapKit can convert workflow during swap (A → B)', () => {
  const result = swapKit(NN_A_WORKFLOW_A_ROWS, {
    fromKit: 'NN-A',
    toKit: 'TT-A',
    workflow: 'A',
    targetWorkflow: 'B',
  });
  // TT-A H1 workflow B i5 = TAACGGTACG
  assert.equal(result.rows[0].index2, 'TAACGGTACG');
});

test('swapKit reports unmatched rows but does not throw', () => {
  const rows = [
    ...NN_A_WORKFLOW_A_ROWS.slice(0, 2),
    { Lane: '9', Sample_ID: 'bogus', index: 'ZZZZZZZZZZ', index2: 'YYYYYYYYYY' },
  ];
  const result = swapKit(rows, { fromKit: 'NN-A', toKit: 'TT-A', workflow: 'A' });
  assert.equal(result.swapped.length, 2);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].sampleId, 'bogus');
  // unmatched row passed through unchanged
  assert.equal(result.rows[2].index, 'ZZZZZZZZZZ');
});

test('detectKitFromUnknowns fingerprints top-unknown rows', () => {
  // simulate a TopUnknownBarcodes.csv that mostly contains TT-A barcodes
  // (would happen if samplesheet had NN-A but lab actually used TT-A)
  const unknowns = [
    { index: 'ACAATGTGAA', index2: 'CGTACCGTTA', reads: 5_000_000 }, // SI-TT-H1
    { index: 'CGCGGTAGGT', index2: 'CAGGATGTTG', reads: 3_000_000 }, // SI-TT-E5
    { index: 'CGGCTGGATG', index2: 'TGATAAGCAC', reads: 2_500_000 }, // SI-TT-F5
    { index: 'ZZZZZZZZZZ', index2: 'YYYYYYYYYY', reads: 100 },       // noise
  ];
  const top = detectKitFromUnknowns(unknowns)[0];
  assert.ok(top);
  assert.equal(top.id, 'TT-A');
  assert.equal(top.workflow, 'A');
  assert.equal(top.matched, 3);
  assert.equal(top.wellCount, 3);
});
