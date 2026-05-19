import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSampleSheet } from '../../src/parsers/samplesheet.js';
import {
  serializeSampleSheet,
  findStrippedSettings,
  hasPerLaneOverrideCycles,
  uniquePerLaneOverrides,
} from '../../src/generators/samplesheet.js';

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

test('round-trips the structure with new data', () => {
  const parsed = parseSampleSheet(V2);
  const newData = [
    { Lane: '1', Sample_ID: 'OnlyOne', index: 'AAAAGGGGTT', index2: 'CCCCAAAANN', Sample_Project: 'ProjectX' },
  ];
  const out = serializeSampleSheet(parsed, { data: newData });
  assert.match(out, /\[Header\]/);
  assert.match(out, /\[BCLConvert_Data\]/);
  assert.match(out, /OnlyOne/);
  assert.doesNotMatch(out, /Sample01/);
});

test('replaces OverrideCycles when supplied', () => {
  const parsed = parseSampleSheet(V2);
  const out = serializeSampleSheet(parsed, { overrideCycles: 'Y151;I8N2;I8N2;Y151' });
  assert.match(out, /OverrideCycles,Y151;I8N2;I8N2;Y151/);
  assert.doesNotMatch(out, /OverrideCycles,Y151;I10;I10;Y151/);
});

test('preserves untouched sections verbatim', () => {
  const parsed = parseSampleSheet(V2);
  const out = serializeSampleSheet(parsed, { data: parsed.data });
  assert.match(out, /Read1Cycles,151/);
  assert.match(out, /RunName,my-run/);
});

const V2_WITH_UNSUPPORTED = `[Header]
FileFormatVersion,2
,
[Reads]
Read1Cycles,151
,
[BCLConvert_Settings]
OverrideCycles,Y151;I10;I10;Y151
AutoDetectDemuxMode,None
FastqcDownsampling,false
BarcodeMismatchesIndex1,1
,
[BCLConvert_Data]
Lane,Sample_ID,index,index2
1,S1,AAAA,CCCC
`;

test('strips known-bad BCLConvert_Settings by default', () => {
  const parsed = parseSampleSheet(V2_WITH_UNSUPPORTED);
  const out = serializeSampleSheet(parsed, { data: parsed.data });
  assert.doesNotMatch(out, /AutoDetectDemuxMode/);
  assert.doesNotMatch(out, /FastqcDownsampling/);
  assert.match(out, /BarcodeMismatchesIndex1,1/);
  assert.match(out, /OverrideCycles,Y151;I10;I10;Y151/);
});

test('keepAllSettings disables stripping', () => {
  const parsed = parseSampleSheet(V2_WITH_UNSUPPORTED);
  const out = serializeSampleSheet(parsed, { data: parsed.data, keepAllSettings: true });
  assert.match(out, /AutoDetectDemuxMode/);
  assert.match(out, /FastqcDownsampling/);
});

test('dropSettings strips additional user-named keys', () => {
  const parsed = parseSampleSheet(V2_WITH_UNSUPPORTED);
  const out = serializeSampleSheet(parsed, {
    data: parsed.data,
    dropSettings: ['BarcodeMismatchesIndex1'],
  });
  assert.doesNotMatch(out, /BarcodeMismatchesIndex1/);
});

test('findStrippedSettings reports which keys will be removed', () => {
  const parsed = parseSampleSheet(V2_WITH_UNSUPPORTED);
  const stripped = findStrippedSettings(parsed);
  const keys = stripped.map((s) => s.key).sort();
  assert.deepEqual(keys, ['AutoDetectDemuxMode', 'FastqcDownsampling']);
});

const V2_WITH_TRIMUMI = `[Header]
FileFormatVersion,2
,
[BCLConvert_Settings]
OverrideCycles,Y151;I10;I10;Y151
TrimUMI,1
Read1UMILength,6
BarcodeMismatchesIndex1,1
,
[BCLConvert_Data]
Lane,Sample_ID,index,index2
1,S1,AAAA,CCCC
`;

test('strips TrimUMI and UMI lengths when OverrideCycles has no U segment', () => {
  const parsed = parseSampleSheet(V2_WITH_TRIMUMI);
  const stripped = findStrippedSettings(parsed);
  const keys = stripped.map((s) => s.key).sort();
  assert.ok(keys.includes('TrimUMI'));
  assert.ok(keys.includes('Read1UMILength'));
  assert.ok(!keys.includes('BarcodeMismatchesIndex1'));
});

test('keeps TrimUMI when OverrideCycles has a U segment', () => {
  const parsed = parseSampleSheet(V2_WITH_TRIMUMI);
  const stripped = findStrippedSettings(parsed, { overrideCycles: 'Y150U6N5;I8;I8;Y150U6N5' });
  const keys = stripped.map((s) => s.key);
  assert.ok(!keys.includes('TrimUMI'));
  assert.ok(!keys.includes('Read1UMILength'));
});

test('respects user-provided overrideCycles when deciding UMI strips', () => {
  const parsed = parseSampleSheet(V2_WITH_TRIMUMI);
  // Original samplesheet has no U, but user supplies U via override → keep
  const strippedWithU = findStrippedSettings(parsed, { overrideCycles: 'Y150U6;I8;I8;Y150U6' });
  assert.ok(!strippedWithU.map((s) => s.key).includes('TrimUMI'));
  // User provides override without U → strip
  const strippedNoU = findStrippedSettings(parsed, { overrideCycles: 'Y151;I10;I10;Y151' });
  assert.ok(strippedNoU.map((s) => s.key).includes('TrimUMI'));
});

const V2_PER_LANE = `[Header]
FileFormatVersion,2
,
[BCLConvert_Settings]
OverrideCycles,Y151;I10;I10;Y151
BarcodeMismatchesIndex1,1
,
[BCLConvert_Data]
Lane,Sample_ID,index,index2,OverrideCycles
1,S1,AAAA,CCCC,U28;I10;I10;Y90
1,S2,TTTT,GGGG,U28;I10;I10;Y90
8,S3,ACGT,TGCA,Y28;I8N2;N2I8;Y50N40
8,S4,CCAA,GGTT,Y28;I8N2;N2I8;Y50N40
`;

test('hasPerLaneOverrideCycles detects per-row OverrideCycles', () => {
  const parsed = parseSampleSheet(V2_PER_LANE);
  assert.equal(hasPerLaneOverrideCycles(parsed.data), true);
  assert.equal(hasPerLaneOverrideCycles([]), false);
  assert.equal(hasPerLaneOverrideCycles([{ Sample_ID: 'x' }]), false);
});

test('uniquePerLaneOverrides reports each unique cycle string with count', () => {
  const parsed = parseSampleSheet(V2_PER_LANE);
  const variants = uniquePerLaneOverrides(parsed.data);
  assert.equal(variants.length, 2);
  assert.ok(variants.some((v) => v.cycles === 'U28;I10;I10;Y90' && v.count === 2));
  assert.ok(variants.some((v) => v.cycles === 'Y28;I8N2;N2I8;Y50N40' && v.count === 2));
});

test('findStrippedSettings strips global OverrideCycles when per-lane is present', () => {
  const parsed = parseSampleSheet(V2_PER_LANE);
  const stripped = findStrippedSettings(parsed, { data: parsed.data });
  const keys = stripped.map((s) => s.key);
  assert.ok(keys.includes('OverrideCycles'));
  const reason = stripped.find((s) => s.key === 'OverrideCycles').reason;
  assert.match(reason, /per-lane/);
});

test('serializer with per-lane data and OverrideCycles in dropSettings emits no global OverrideCycles', () => {
  const parsed = parseSampleSheet(V2_PER_LANE);
  const out = serializeSampleSheet(parsed, {
    data: parsed.data,
    dropSettings: ['OverrideCycles'],
  });
  // [BCLConvert_Settings] section should NOT contain OverrideCycles line
  const settingsMatch = out.match(/\[BCLConvert_Settings\]([\s\S]*?)(?=\n\[|\n$)/);
  assert.ok(settingsMatch);
  assert.doesNotMatch(settingsMatch[1], /^OverrideCycles,/m);
  // BarcodeMismatchesIndex1 should still be there
  assert.match(settingsMatch[1], /BarcodeMismatchesIndex1,1/);
  // Per-lane values in [Data] section preserved
  assert.match(out, /U28;I10;I10;Y90/);
  assert.match(out, /Y28;I8N2;N2I8;Y50N40/);
});

test('UMI detection considers per-lane cycles', () => {
  // V2_PER_LANE has U28 in some lanes — TrimUMI would be valid for those
  const withTrimUmi = V2_PER_LANE.replace(
    '[BCLConvert_Settings]\nOverrideCycles,Y151;I10;I10;Y151',
    '[BCLConvert_Settings]\nOverrideCycles,Y151;I10;I10;Y151\nTrimUMI,1',
  );
  const parsed = parseSampleSheet(withTrimUmi);
  const stripped = findStrippedSettings(parsed, { data: parsed.data });
  const keys = stripped.map((s) => s.key);
  // Some per-lane cycles have U, so TrimUMI should NOT be stripped
  assert.ok(!keys.includes('TrimUMI'));
});
