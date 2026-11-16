import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Catalog, Well } from './catalog.generated';
import { summarizeRows } from '../rayfin/functions/src/analysis';
import type { Analysis, AnalysisOptions } from './domain';
import { DEFAULT_QC } from './domain';
import {
  assertRunAnalysis, compareConditions, controlSummary, dispersion, filterMeasurements,
  inclusion, metricValue, reviewQueue, scenarioChanges, spatialSummary,
} from './lab';
import { createLabPacket, csvCell } from './lab-export';
import { readCloudAnalysis } from './fabric';
import { readReviews, validateLabContext } from './lab-context';
import { parseState, shareUrl } from './state';

const makeWell = (runId: string, coordinate: string, reporter: number, control = false): Well => ({
  id: `${runId}-${coordinate}`, well: coordinate, runId, compound: control ? 'Vehicle' : 'Aster-17',
  doseUm: control ? 0 : 1, replicate: 1, control, measured: true,
  image: { id: `${runId}-${coordinate}`, path: `images/${runId}-${coordinate}.ome.tif`,
    axes: 'TCZYX', shape: [1, 3, 1, 4, 4], spacingUm: [1, 1.5, 1.5], timesHours: [48],
    bytes: 48, sha256: 'a'.repeat(64), frameHashes: ['b'.repeat(64)] },
  volume: null,
  measurements: { objectCount: 65, medianAreaUm2: 90, foregroundAreaUm2: 1000, meanSignalAdu: 30,
    integratedSignalAdu: reporter, spheroidVolumeUm3: null, focusScore: .17,
    saturationFraction: 0, illuminationCv: .1 },
});
const first = makeWell('run1', 'A01', 30);
const fixture: Catalog = {
  schemaVersion: '1.0',
  experiment: { id: 'spheroid-screen-001', title: 'Synthetic study', question: 'Research QC?',
    assay: 'Synthetic assay', sample: 'Simulated spheroids', summary: 'Technical wells', disclosure: 'Simulated screening experiment', seed: 1 },
  runs: [{ id: 'run1', label: 'Acquisition 1', instrument: 'Simulated A', acquiredAt: '2026-10-13T09:00:00Z', synthetic: true },
    { id: 'run2', label: 'Acquisition 2', instrument: 'Simulated B', acquiredAt: '2026-10-14T09:00:00Z', synthetic: true }],
  channels: [{ id: 'nuclei', name: 'Nuclei', color: '#ffffff', meaning: 'Simulated fluorescence' },
    { id: 'structure', name: 'Structure', color: '#00ffff', meaning: 'Simulated fluorescence' },
    { id: 'reporter', name: 'Reporter', color: '#ff00ff', meaning: 'Simulated fluorescence' }],
  wells: [first, makeWell('run1', 'B02', 50), makeWell('run1', 'G01', 90, true), makeWell('run1', 'G02', 110, true),
    makeWell('run2', 'A01', 60), makeWell('run2', 'B02', 100), makeWell('run2', 'G01', 180, true), makeWell('run2', 'G02', 220, true)],
  provenance: { generator: 'spheroid-1', analysis: 'cpu-baseline-1', codeVersion: 'test',
    processedAt: '2026-10-14T10:00:00Z', parameters: {}, citations: ['Original synthetic research data'] },
};
const options: AnalysisOptions = { runId: 'run1', thresholds: DEFAULT_QC, excludeQC: true };
function analyze(catalog = fixture, selected = options): Analysis {
  return summarizeRows(catalog.wells.map(well => ({
    id: well.id, well: well.well, runId: well.runId, instrument: 'Simulated', compound: well.compound,
    doseUm: well.doseUm, replicate: well.replicate, control: well.control,
    measured: well.measured && well.measurements !== null,
    objectCount: well.measurements?.objectCount ?? 0, integratedSignalAdu: well.measurements?.integratedSignalAdu ?? 0,
    focusScore: well.measurements?.focusScore ?? 0, saturationFraction: well.measurements?.saturationFraction ?? 0,
    illuminationCv: well.measurements?.illuminationCv ?? 0,
  })), selected);
}

describe('laboratory comparison and controls', () => {
  it('uses within-run denominators and never pools technical n across runs', () => {
    const left = analyze(), right = analyze(fixture, { ...options, runId: 'run2' });
    const comparison = compareConditions(fixture, 'run1', 'run2', left, right)[0];
    expect([left.controlMedian, right.controlMedian]).toEqual([100, 200]);
    expect([comparison.left?.n, comparison.right?.n]).toEqual([2, 2]);
    expect(comparison.difference).toBe(0);
    expect(comparison.left?.sd).toBeCloseTo(Math.sqrt(200));
    const controls = controlSummary(fixture, 'run1', left);
    expect(controls.n).toBe(2);
    expect(controls.cvPercent).toBeCloseTo(100 * Math.sqrt(200) / 100);
    expect(controls.wellIds).toEqual(['run1-G01', 'run1-G02']);
    expect(() => controlSummary(fixture, 'run1', { ...left, controlMedian: 101 })).toThrow('denominator differ');
  });
  it('keeps missing controls, zero denominators and one-well variability not estimable through cloud decoding', () => {
    for (const empty of [false, true]) {
      const catalog = structuredClone(fixture);
      for (const well of catalog.wells.filter(well => well.control)) {
        if (empty) { well.measured = false; well.measurements = null; }
        else well.measurements!.integratedSignalAdu = 0;
      }
      const result = analyze(catalog);
      expect(readCloudAnalysis(result)).toEqual(result);
      expect(result.groups[0].n).toBe(0);
      expect(result.groups[0].wellIds).toHaveLength(2);
      expect(result.groups[0].mean).toBeNull();
      expect(controlSummary(catalog, 'run1', result).cvPercent).toBeNull();
    }
    expect(dispersion([4]).sd).toBeNull();
    expect(dispersion([]).median).toBeNull();
    expect(() => dispersion([Infinity])).toThrow('Nonfinite');
  });
  it('shows denominator changes even for a field whose inclusion did not change', () => {
    const catalog = structuredClone(fixture);
    catalog.wells.find(well => well.id === 'run1-G01')!.measurements!.focusScore = .001;
    const before = analyze(catalog, { ...options, excludeQC: false });
    const after = analyze(catalog);
    expect(scenarioChanges(catalog, 'run1', before, after).map(row => row.well.id)).toEqual(['run1-G01']);
    expect(before.normalized['run1-A01']).toBe(30);
    expect(after.normalized['run1-A01']).toBeCloseTo(100 * 30 / 110);
    expect(catalog.wells[0].measurements!.integratedSignalAdu).toBe(30);
    expect(() => assertRunAnalysis(catalog, 'run1', { ...after, included: 99 })).toThrow('does not match');
  });
});

describe('image-derived exploration', () => {
  it('filters actual values, preserves missing volume values and excludes no data implicitly', () => {
    const analysis = analyze();
    expect(metricValue(first, analysis, 'normalized')).toBe(30);
    expect(metricValue(first, analysis, 'spheroidVolumeUm3')).toBeNull();
    const run = fixture.wells.filter(well => well.runId === 'run1');
    const filter = { compound: 'all', inclusion: 'all' as const, search: '', minimum: 35, maximum: 55 };
    expect(filterMeasurements(run, analysis, 'normalized', filter).map(well => well.well)).toEqual(['B02']);
    expect(filterMeasurements(run, analysis, 'spheroidVolumeUm3', { ...filter, minimum: null, maximum: null })).toHaveLength(4);
    expect(filterMeasurements(run, analysis, 'spheroidVolumeUm3', filter)).toHaveLength(0);
    expect(filterMeasurements(run, analysis, 'normalized', { ...filter, compound: 'controls' })).toHaveLength(0);
    const missing = { ...first, measured: false, measurements: null };
    expect(inclusion(missing, analysis)).toBe('unmeasured');
    expect(metricValue(missing, analysis, 'objectCount')).toBeNull();
  });
  it('reports spatial counts/medians rather than inventing a causal edge effect', () => {
    const summary = spatialSummary(fixture.wells.filter(well => well.runId === 'run1'), analyze(), 'normalized', true);
    expect(summary.edge.n).toBe(1);
    expect(summary.interior.n).toBe(1);
    expect(summary.rows.find(row => row.label === 'A')?.median).toBeNull();
    expect(summary.rows.find(row => row.label === 'G')?.n).toBe(2);
  });
});

describe('saved review queue, context and exports', () => {
  const saved = { well_id: 'run1-A01', state: 'Repeat acquisition' as const,
    rationale: '=HYPERLINK("https://example.invalid")', annotation: '<img src=x onerror=alert(1)>',
    updated_at: '2026-11-16T12:00:00Z', version: 1 };
  it('keeps unsaved wells distinct from persisted decisions and validates review records', () => {
    expect(readReviews([saved])).toEqual([saved]);
    const queue = reviewQueue(fixture, analyze(), [saved]);
    expect(queue.find(row => row.well.id === 'run1-A01')?.review).toEqual(saved);
    expect(queue.find(row => row.well.id === 'run1-B02')?.review).toBeNull();
    expect(() => readReviews([{ ...saved, version: 0 }])).toThrow('shared contract');
    expect(() => readReviews([{ ...saved, rationale: ' ' }])).toThrow();
    expect(() => readReviews([saved, saved])).toThrow('duplicate');
  });
  it('rejects fabricated context joins, token-bearing links and real records in the simulation', () => {
    const snapshot = {
      schemaVersion: '1.0', origin: 'simulated', connectionState: 'example-only',
      sourceSystem: 'Example LIMS export', exportedAt: '2026-10-14T12:00:00Z', sourceRights: 'Fictional example',
      records: [{ externalRecordId: 'EXAMPLE-001', recordVersion: '1', sampleId: 'SIM-A', batchId: 'SIM-B',
        protocolId: 'SIM-P', protocolVersion: '1', experimentId: 'spheroid-screen-001', runId: 'run1',
        wellId: 'run1-A01', sourceImageId: 'run1-A01', replicateType: 'technical',
        updatedAt: '2026-10-13T12:00:00Z', recordUrl: 'https://lims.example.invalid/records/1' }],
    };
    expect(validateLabContext(snapshot, fixture)).toEqual(snapshot);
    expect(() => validateLabContext({ ...snapshot, origin: 'tenant-owned-unconnected' }, fixture)).toThrow('Real lab records');
    expect(() => validateLabContext({ ...snapshot, records: [{ ...snapshot.records[0], sourceImageId: 'run1-B02' }] }, fixture)).toThrow('mismatched');
    expect(() => validateLabContext({ ...snapshot, records: [{ ...snapshot.records[0], recordUrl: 'https://lims.example.invalid/1?sig=secret' }] }, fixture)).toThrow('unsafe');
  });
  it('exports exact values and scope while escaping HTML and spreadsheet formulas', async () => {
    const packet = createLabPacket(fixture, true, 'Selected reviews', [{
      wellId: saved.well_id, rationale: saved.rationale, annotation: saved.annotation, value: 30.123, missing: null,
    }], options, { action: 'No external write' });
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Invalid blob'));
      reader.onerror = reject; reader.readAsArrayBuffer(packet);
    });
    const files = unzipSync(new Uint8Array(bytes));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.mode).toBe('Connected tenant data');
    expect(manifest.dataOrigin).toBe('Simulated screening experiment');
    expect(manifest.records[0].value).toBe(30.123);
    expect(manifest.options).toEqual(options);
    expect(strFromU8(files['report.html'])).toContain('&lt;img');
    expect(strFromU8(files['report.html'])).not.toContain('<img src=x');
    expect(strFromU8(files['records.csv'])).toContain(`"'=HYPERLINK`);
    expect(csvCell(-12)).toBe('"-12"');
    expect(() => createLabPacket(fixture, false, 'Empty', [], options)).toThrow('Select');
  });
  it('shares active surface and bounded QC without sharing filters, reviews or credentials', () => {
    const state = { ...parseState(''), surface: 'runs' as const, excludeQC: false,
      thresholds: { ...DEFAULT_QC, focusMin: .04 } };
    const url = shareUrl('https://app.example', '/?token=remove', state);
    expect(parseState(new URL(url).search)).toEqual(state);
    expect(url).not.toContain('token=');
    expect(parseState('?surface=outside&qc=0_0_0_2.5').surface).toBe('workbench');
    expect(parseState('?qc=NaN_1_1_1').thresholds).toEqual(DEFAULT_QC);
  });
});
