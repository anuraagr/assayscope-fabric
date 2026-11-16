import type { Catalog, Measurements, Well } from './catalog.generated';
import type { Analysis, AnalysisOptions, Review } from './domain';
import { DEFAULT_QC } from './domain';

export const METRICS = [
  { id: 'normalized', label: 'Reporter / vehicle', unit: '%', digits: 2 },
  { id: 'integratedSignalAdu', label: 'Integrated reporter', unit: 'integrated ADU', digits: 0 },
  { id: 'objectCount', label: 'Nuclear objects', unit: 'objects / field', digits: 0 },
  { id: 'medianAreaUm2', label: 'Median nuclear area', unit: 'µm²', digits: 2 },
  { id: 'foregroundAreaUm2', label: 'Structural foreground', unit: 'µm²', digits: 1 },
  { id: 'spheroidVolumeUm3', label: '3D mask volume, 48 h', unit: 'µm³', digits: 0 },
  { id: 'focusScore', label: 'Focus score', unit: 'dimensionless', digits: 4 },
  { id: 'saturationFraction', label: 'Saturated pixels', unit: 'fraction', digits: 4 },
  { id: 'illuminationCv', label: 'Illumination CV', unit: 'dimensionless', digits: 4 },
] as const;
export type MetricId = typeof METRICS[number]['id'];
export type Inclusion = 'included' | 'excluded' | 'unmeasured';

export function metricValue(well: Well, analysis: Analysis, metric: MetricId): number | null {
  if (!well.measured || !well.measurements) return null;
  const value = metric === 'normalized' ? analysis.normalized[well.id] : well.measurements[metric];
  return value == null || !Number.isFinite(value) ? null : value;
}

export function inclusion(well: Well, analysis: Analysis): Inclusion {
  if (!well.measured || !well.measurements) return 'unmeasured';
  return analysis.excluded.includes(well.id) ? 'excluded' : 'included';
}

export function dispersion(values: number[]) {
  if (values.some(value => !Number.isFinite(value))) throw new Error('Nonfinite measurements cannot enter a summary.');
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
  const median = n ? n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null;
  const sd = n > 1 && mean !== null
    ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, median, sd, cvPercent: mean !== null && mean > 0 && sd !== null ? 100 * sd / mean : null };
}

export function assertRunAnalysis(catalog: Catalog, runId: string, analysis: Analysis): Analysis {
  const wells = catalog.wells.filter(well => well.runId === runId);
  const ids = new Set(wells.map(well => well.id));
  const excluded = new Set(analysis.excluded);
  if (!wells.length || wells.length > 1000 || excluded.size !== analysis.excluded.length ||
      analysis.included + analysis.excluded.length + analysis.unmeasured !== wells.length ||
      Object.keys(analysis.normalized).length !== wells.length ||
      [...excluded].some(id => !ids.has(id)) || wells.some(well =>
        !Object.hasOwn(analysis.normalized, well.id) || !Array.isArray(analysis.flags[well.id]))) {
    throw new Error('Run analysis does not match the registered study. Reload or finish data synchronization.');
  }
  return analysis;
}

export function controlSummary(catalog: Catalog, runId: string, analysis: Analysis) {
  assertRunAnalysis(catalog, runId, analysis);
  const controls = catalog.wells.filter(well => well.runId === runId && well.control);
  const included = controls.filter(well => inclusion(well, analysis) === 'included');
  const values = included.map(well => well.measurements!.integratedSignalAdu);
  const statistics = dispersion(values);
  const denominator = statistics.median !== null && statistics.median > 0 ? statistics.median : null;
  if (analysis.controlN !== included.length || (denominator === null ? analysis.controlMedian !== null :
    analysis.controlMedian === null || Math.abs(analysis.controlMedian - denominator) > Math.max(1, denominator) * 1e-10)) {
    throw new Error('Control values and analytical denominator differ. Reconcile the source catalog and analytical tables.');
  }
  return { ...statistics, total: controls.length, excluded: controls.filter(well =>
    inclusion(well, analysis) === 'excluded').length, unmeasured: controls.filter(well =>
    inclusion(well, analysis) === 'unmeasured').length, wellIds: included.map(well => well.id) };
}

export function compareConditions(catalog: Catalog, leftRun: string, rightRun: string,
  left: Analysis, right: Analysis) {
  assertRunAnalysis(catalog, leftRun, left);
  assertRunAnalysis(catalog, rightRun, right);
  const keys = new Map<string, { compound: string; doseUm: number }>();
  for (const group of [...left.groups, ...right.groups]) {
    keys.set(JSON.stringify([group.compound, group.doseUm]), group);
  }
  return [...keys.values()].sort((a, b) => a.compound.localeCompare(b.compound) || a.doseUm - b.doseUm)
    .map(({ compound, doseUm }) => {
      const a = left.groups.find(group => group.compound === compound && group.doseUm === doseUm);
      const b = right.groups.find(group => group.compound === compound && group.doseUm === doseUm);
      const expected = (runId: string) => catalog.wells.filter(well =>
        well.runId === runId && !well.control && well.compound === compound && well.doseUm === doseUm);
      const aw = expected(leftRun), bw = expected(rightRun);
      return {
        compound, doseUm, left: a ?? null, right: b ?? null,
        leftExpected: aw.length, rightExpected: bw.length,
        leftMeasured: aw.filter(well => well.measured && well.measurements).length,
        rightMeasured: bw.filter(well => well.measured && well.measurements).length,
        difference: a?.mean != null && b?.mean != null ? b.mean - a.mean : null,
        leftWellIds: aw.map(well => well.id), rightWellIds: bw.map(well => well.id),
      };
    });
}

export function scenarioChanges(catalog: Catalog, runId: string, before: Analysis, after: Analysis) {
  assertRunAnalysis(catalog, runId, before);
  assertRunAnalysis(catalog, runId, after);
  return catalog.wells.filter(well => well.runId === runId)
    .filter(well => inclusion(well, before) !== inclusion(well, after))
    .map(well => ({ well, before: inclusion(well, before), after: inclusion(well, after),
      beforeValue: before.normalized[well.id], afterValue: after.normalized[well.id] }));
}

export interface MeasurementFilter {
  compound: string; inclusion: 'all' | Inclusion; search: string;
  minimum: number | null; maximum: number | null;
}
export function filterMeasurements(wells: Well[], analysis: Analysis, metric: MetricId, filter: MeasurementFilter) {
  const search = filter.search.trim().toLowerCase();
  return wells.filter(well => (filter.compound === 'all' ||
    (filter.compound === 'controls' ? well.control : well.compound === filter.compound)) &&
    (filter.inclusion === 'all' || inclusion(well, analysis) === filter.inclusion) &&
    (!search || `${well.id} ${well.compound} ${well.image.id}`.toLowerCase().includes(search)))
    .filter(well => {
      const value = metricValue(well, analysis, metric);
      if (filter.minimum === null && filter.maximum === null) return true;
      return value !== null && (filter.minimum === null || value >= filter.minimum) &&
        (filter.maximum === null || value <= filter.maximum);
    });
}

export function spatialSummary(wells: Well[], analysis: Analysis, metric: MetricId, controlsOnly: boolean) {
  const source = wells.filter(well => !controlsOnly || well.control);
  const summarize = (members: Well[]) => {
    const values = members.filter(well => inclusion(well, analysis) === 'included')
      .map(well => metricValue(well, analysis, metric)).filter((value): value is number => value !== null);
    return { ...dispersion(values), total: members.length, flagged: members.filter(well =>
      (analysis.flags[well.id]?.length ?? 0) > 0).length };
  };
  const edge = (well: Well) => /^[AH]/.test(well.well) || /(?:01|12)$/.test(well.well);
  return {
    rows: [...'ABCDEFGH'].map(row => ({ label: row, ...summarize(source.filter(well => well.well[0] === row)) })),
    edge: summarize(source.filter(edge)), interior: summarize(source.filter(well => !edge(well))),
  };
}

export function reviewQueue(catalog: Catalog, analysis: Analysis, reviews: Review[]) {
  const saved = new Map(reviews.map(review => [review.well_id, review]));
  return catalog.wells.map(well => ({
    well, review: saved.get(well.id) ?? null, flags: analysis.flags[well.id] ?? [],
  }));
}

export const QC_FIELDS = [
  { key: 'focusMin', label: 'Minimum focus', step: .001, max: 1 },
  { key: 'saturationMax', label: 'Maximum saturated fraction', step: .001, max: 1 },
  { key: 'illuminationMax', label: 'Maximum illumination CV', step: .01, max: 5 },
  { key: 'objectCountMin', label: 'Minimum nuclear count', step: 1, max: 10000 },
] as const;
export function optionsKey(options: AnalysisOptions) {
  return JSON.stringify([options.runId, options.excludeQC, ...QC_FIELDS.map(field => options.thresholds[field.key])]);
}
export function isDefaultQC(options: AnalysisOptions) {
  return QC_FIELDS.every(field => options.thresholds[field.key] === DEFAULT_QC[field.key]);
}
export type MeasurementName = keyof Measurements;
