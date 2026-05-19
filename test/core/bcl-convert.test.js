import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBclVersion, semverCompare, getDeclaredSoftwareVersion } from '../../src/core/bcl-convert.js';

test('parseBclVersion extracts semver from bcl-convert --version output', () => {
  assert.equal(parseBclVersion('bcl-convert Version 00.000.000.4.5.4\nCopyright (c) 2014'), '4.5.4');
  assert.equal(parseBclVersion('bcl-convert Version 00.000.000.4.0.3'), '4.0.3');
  assert.equal(parseBclVersion('bcl-convert Version 4.5.4'), '4.5.4');
});

test('parseBclVersion falls back to trailing semver', () => {
  assert.equal(parseBclVersion('something 1.2.3\n'), '1.2.3');
});

test('parseBclVersion returns null on empty / non-matching', () => {
  assert.equal(parseBclVersion(''), null);
  assert.equal(parseBclVersion(null), null);
  assert.equal(parseBclVersion('no version here'), null);
});

test('semverCompare orders correctly', () => {
  assert.ok(semverCompare('4.5.4', '4.0.3') > 0);
  assert.ok(semverCompare('4.0.3', '4.5.4') < 0);
  assert.equal(semverCompare('4.5.4', '4.5.4'), 0);
  assert.ok(semverCompare('5.0.0', '4.99.99') > 0);
});

test('getDeclaredSoftwareVersion reads from Header.SoftwareVersion', () => {
  const ss = {
    sections: {
      Header: { decoded: { FileFormatVersion: '2', SoftwareVersion: '4.0.3' } },
      BCLConvert_Settings: { decoded: { OverrideCycles: 'Y151;I10;I10;Y151' } },
    },
    settingsKey: 'BCLConvert_Settings',
  };
  assert.equal(getDeclaredSoftwareVersion(ss), '4.0.3');
});

test('getDeclaredSoftwareVersion reads from BCLConvert_Settings.BCLConvertVersion', () => {
  const ss = {
    sections: {
      Header: { decoded: { FileFormatVersion: '2' } },
      BCLConvert_Settings: { decoded: { BCLConvertVersion: 'bcl-convert 00.000.000.4.5.4' } },
    },
    settingsKey: 'BCLConvert_Settings',
  };
  assert.equal(getDeclaredSoftwareVersion(ss), '4.5.4');
});

test('getDeclaredSoftwareVersion returns null when no version declared', () => {
  const ss = {
    sections: { Header: { decoded: { FileFormatVersion: '2' } } },
    settingsKey: 'BCLConvert_Settings',
  };
  assert.equal(getDeclaredSoftwareVersion(ss), null);
});
