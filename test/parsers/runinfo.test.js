import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRunInfo, cyclesString, isDualIndexed } from '../../src/parsers/runinfo.js';

const NOVASEQ = `<?xml version="1.0"?>
<RunInfo Version="6">
  <Run Id="241008_A00123_0042_AHFJK7DSXY" Number="42">
    <Flowcell>HFJK7DSXY</Flowcell>
    <Instrument>A00123</Instrument>
    <Date>2024-10-08</Date>
    <Reads>
      <Read Number="1" NumCycles="151" IsIndexedRead="N" />
      <Read Number="2" NumCycles="10" IsIndexedRead="Y" />
      <Read Number="3" NumCycles="10" IsIndexedRead="Y" />
      <Read Number="4" NumCycles="151" IsIndexedRead="N" />
    </Reads>
    <FlowcellLayout LaneCount="4" SurfaceCount="2" SwathCount="2" TileCount="78" />
  </Run>
</RunInfo>`;

const MISEQ_SINGLE_INDEX = `<?xml version="1.0"?>
<RunInfo Version="2">
  <Run Id="241001_M00666_0001_000000000-DUMMY" Number="1">
    <Flowcell>000000000-DUMMY</Flowcell>
    <Instrument>M00666</Instrument>
    <Date>2024-10-01</Date>
    <Reads>
      <Read Number="1" NumCycles="75" IsIndexedRead="N" />
      <Read Number="2" NumCycles="6" IsIndexedRead="Y" />
    </Reads>
    <FlowcellLayout LaneCount="1" SurfaceCount="2" SwathCount="1" TileCount="14" />
  </Run>
</RunInfo>`;

test('parses a NovaSeq RunInfo.xml', () => {
  const r = parseRunInfo(NOVASEQ);
  assert.equal(r.runId, '241008_A00123_0042_AHFJK7DSXY');
  assert.equal(r.flowcell, 'HFJK7DSXY');
  assert.equal(r.instrument, 'A00123');
  assert.equal(r.lanes, 4);
  assert.equal(r.reads.length, 4);
  assert.deepEqual(r.reads[0], { number: 1, cycles: 151, isIndex: false });
  assert.deepEqual(r.reads[1], { number: 2, cycles: 10, isIndex: true });
});

test('cyclesString formats reads as semicolon-joined segments', () => {
  const r = parseRunInfo(NOVASEQ);
  assert.equal(cyclesString(r), 'Y151;I10;I10;Y151');
});

test('isDualIndexed detects dual vs single', () => {
  assert.equal(isDualIndexed(parseRunInfo(NOVASEQ)), true);
  assert.equal(isDualIndexed(parseRunInfo(MISEQ_SINGLE_INDEX)), false);
});

test('throws on RunInfo with no <Run>', () => {
  assert.throws(() => parseRunInfo('<?xml version="1.0"?><RunInfo />'), /no <Run> element/);
});
