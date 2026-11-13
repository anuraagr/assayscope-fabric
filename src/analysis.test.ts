import { describe, expect, it } from 'vitest';
import { flags, summarizeRows, validateOptions } from '../rayfin/functions/src/analysis';
import type { MeasurementRow } from '../rayfin/functions/src/analysis';
import { readCloudAnalysis } from './fabric';

const options = () => validateOptions(JSON.stringify({
  runId: 'run1', excludeQC: true,
  thresholds: { focusMin: .025, saturationMax: .015, illuminationMax: .55, objectCountMin: 12 },
}));
const row = (id: string, value: number, control = false): MeasurementRow => ({
  id, runId: 'run1', well: id, instrument: 'Simulated imager', compound: control ? 'Vehicle' : 'Aster-17',
  doseUm: control ? 0 : 1, replicate: 1, measured: true, control,
  objectCount: 65, integratedSignalAdu: value, focusScore: .17, saturationFraction: 0, illuminationCv: .01,
});
describe('Fabric analytical reduction', () => {
  it('accepts both SDK-decoded objects and JSON string function outputs without parsing objects again', () => {
    const result = summarizeRows([row('control', 100, true), row('A01', 40)], options());
    expect(readCloudAnalysis(result)).toEqual(result);
    expect(readCloudAnalysis(JSON.stringify(result))).toEqual(result);
    expect(() => readCloudAnalysis({ ...result, controlN: 'not measured' })).toThrow('invalid result');
    expect(() => readCloudAnalysis({ ...result, groups: [{ ...result.groups[0], n: 9 }] })).toThrow('invalid result');
    expect(() => readCloudAnalysis(null)).toThrow('invalid result');
  });
  it('normalizes each technical well, preserves exclusions and uses sample SD', () => {
    const rows = [row('control1', 90, true), row('control2', 110, true),
      row('A01', 30), row('A02', 40), row('A03', 50), { ...row('F11', 10), focusScore: .007 }];
    const result = summarizeRows(rows, options());
    expect(result.controlMedian).toBe(100);
    expect(result.normalized.A02).toBe(40);
    expect(result.excluded).toEqual(['F11']);
    expect(result.groups[0].n).toBe(3);
    expect(result.groups[0].sd).toBe(10);
    expect(result.groups[0].mean).toBe(40);
    expect(result.fit).toContain('Not estimable');
  });
  it('handles missing and zero controls without an infinite response', () => {
    for (const rows of [[row('A01', 30)], [row('control', 0, true), row('A01', 30)]]) {
      const result = summarizeRows(rows, options());
      expect(result.controlMedian).toBeNull();
      expect(result.normalized.A01).toBeNull();
      expect(result.groups[0].n).toBe(0);
    }
  });
  it('uses actual QC numbers, flags unmeasured wells and rejects invalid input', () => {
    expect(flags({ ...row('x', 30), measured: false }, options().thresholds)).toEqual(['Unmeasured']);
    expect(flags({ ...row('x', 30), saturationFraction: .2 }, options().thresholds)).toEqual(['Saturation']);
    expect(() => validateOptions('{"runId":"outside"}')).toThrow();
    expect(() => validateOptions(JSON.stringify({ ...options(), thresholds: { ...options().thresholds, focusMin: -1 } }))).toThrow();
  });
});
