import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSampleSheet, findColumn } from '../../src/parsers/samplesheet.js';

const V1 = `[Header]
IEMFileVersion,4
Date,10/8/2024
,
[Reads]
151
10
10
151
,
[Settings]
Adapter,AGATCGGAAGAGC
,
[Data]
Lane,Sample_ID,Sample_Name,index,index2,Sample_Project
1,Sample01,Sample01,AAAAAAAAAA,CCCCCCCCCC,ProjectX
1,Sample02,Sample02,GGGGGGGGGG,TTTTTTTTTT,ProjectX
2,Sample03,Sample03,ACGTACGTAC,TGCATGCATG,ProjectY
`;

const V2 = `[Header]
FileFormatVersion,2
RunName,my-run
,
[Reads]
Read1Cycles,151
Index1Cycles,10
Index2Cycles,10
Read2Cycles,151
,
[BCLConvert_Settings]
OverrideCycles,Y151;I10;I10;Y151
,
[BCLConvert_Data]
Lane,Sample_ID,index,index2,Sample_Project
1,Sample01,AAAAAAAAAA,CCCCCCCCCC,ProjectX
1,Sample02,GGGGGGGGGG,TTTTTTTTTT,ProjectX
`;

test('parses v1 samplesheet', () => {
  const r = parseSampleSheet(V1);
  assert.equal(r.version, 'v1');
  assert.equal(r.dataKey, 'Data');
  assert.equal(r.data.length, 3);
  assert.equal(r.data[0].Sample_ID, 'Sample01');
  assert.equal(r.data[0].index, 'AAAAAAAAAA');
  assert.equal(r.sections.Header.decoded.IEMFileVersion, '4');
});

test('parses v2 samplesheet', () => {
  const r = parseSampleSheet(V2);
  assert.equal(r.version, 'v2');
  assert.equal(r.dataKey, 'BCLConvert_Data');
  assert.equal(r.settingsKey, 'BCLConvert_Settings');
  assert.equal(r.data.length, 2);
  assert.equal(r.sections.BCLConvert_Settings.decoded.OverrideCycles, 'Y151;I10;I10;Y151');
});

test('handles BOM and CRLF', () => {
  const text = '﻿' + V2.replace(/\n/g, '\r\n');
  const r = parseSampleSheet(text);
  assert.equal(r.version, 'v2');
  assert.equal(r.data.length, 2);
});

test('findColumn is case-insensitive', () => {
  const rows = [{ Sample_ID: 'X', index: 'AAA' }];
  assert.equal(findColumn(rows, ['sample_id']), 'Sample_ID');
  assert.equal(findColumn(rows, ['Index1', 'index']), 'index');
  assert.equal(findColumn(rows, ['missing']), null);
});

test('handles missing [Data] section', () => {
  const text = `[Header]\nFileFormatVersion,2\n`;
  const r = parseSampleSheet(text);
  assert.equal(r.data.length, 0);
});
