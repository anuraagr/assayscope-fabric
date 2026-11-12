export interface Thresholds {
  focusMin: number; saturationMax: number; illuminationMax: number; objectCountMin: number;
}
export interface MeasurementRow {
  id: string; well: string; runId: string; instrument: string; compound: string;
  doseUm: number; replicate: number; control: boolean; measured: boolean;
  objectCount: number; focusScore: number; saturationFraction: number; illuminationCv: number;
  integratedSignalAdu: number;
  codeVersion?: string;
}

export function validateOptions(raw: string) {
  if (raw.length > 2000) throw new Error('Analysis options exceed the input limit.');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('runId' in parsed) ||
      !('thresholds' in parsed) || !('excludeQC' in parsed) ||
      typeof parsed.runId !== 'string' || !/^run[12]$/.test(parsed.runId) ||
      typeof parsed.excludeQC !== 'boolean') throw new Error('Invalid analysis options.');
  const q = parsed.thresholds;
  if (!q || typeof q !== 'object') throw new Error('QC thresholds are required.');
  const record: object = q;
  function number(key: string, maximum: number) {
    if (!Object.hasOwn(record, key)) throw new Error(`Missing QC threshold: ${key}`);
    const value: unknown = Reflect.get(record, key);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
      throw new Error(`Invalid QC threshold: ${key}`);
    return value;
  }
  const thresholds = {
    focusMin: number('focusMin', 1), saturationMax: number('saturationMax', 1),
    illuminationMax: number('illuminationMax', 5), objectCountMin: number('objectCountMin', 10000),
  };
  if (!Number.isInteger(thresholds.objectCountMin)) throw new Error('Object count must be an integer.');
  return { runId: parsed.runId, excludeQC: parsed.excludeQC, thresholds };
}

export function flags(row: MeasurementRow, q: Thresholds): string[] {
  if (!row.measured) return ['Unmeasured'];
  return [
    ...(row.focusScore < q.focusMin ? ['Low focus'] : []),
    ...(row.saturationFraction > q.saturationMax ? ['Saturation'] : []),
    ...(row.illuminationCv > q.illuminationMax ? ['Uneven illumination'] : []),
    ...(row.objectCount < q.objectCountMin ? ['Low object count'] : []),
  ];
}
export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeRows(rows: MeasurementRow[], options: ReturnType<typeof validateOptions>) {
  const wells = rows.filter(r => r.runId === options.runId);
  const qc = Object.fromEntries(rows.map(r => [r.id, flags(r, options.thresholds)]));
  const included = wells.filter(w => w.measured && (!options.excludeQC || !qc[w.id].length));
  const excluded = wells.filter(w => w.measured && !included.includes(w)).map(w => w.id);
  const controls = included.filter(w => w.control).map(w => w.integratedSignalAdu);
  const med = median(controls);
  const controlMedian = med !== null && med > 0 ? med : null;
  const normalized: Record<string, number | null> = Object.fromEntries(wells.map(w => [
    w.id, w.measured && controlMedian !== null ? 100 * w.integratedSignalAdu / controlMedian : null,
  ]));
  const groups = [];
  for (const compound of [...new Set(wells.filter(w => !w.control).map(w => w.compound))].sort()) {
    const doses = [...new Set(wells.filter(w => w.compound === compound).map(w => w.doseUm))].sort((a, b) => a - b);
    for (const doseUm of doses) {
      const members = included.filter(w => w.compound === compound && w.doseUm === doseUm);
      const points = members.map(w => normalized[w.id]).filter((n): n is number => n !== null);
      const mean = points.length ? points.reduce((a, b) => a + b, 0) / points.length : null;
      const sd = points.length > 1 && mean !== null
        ? Math.sqrt(points.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (points.length - 1)) : null;
      groups.push({ compound, doseUm, n: points.length, wellIds: members.map(w => w.id), points, mean, sd });
    }
  }
  return {
    included: included.length, excluded, unmeasured: wells.filter(w => !w.measured).length,
    controlMedian, controlN: controls.length, normalized, groups,
    formula: '100 x background-corrected integrated reporter / median included vehicle reporter',
    nDefinition: 'n = technical replicate wells in this run; not cells or timepoints',
    fit: 'Not estimable: descriptive reporter proxy, no validated pharmacological endpoint or fit.',
    thresholds: options.thresholds, flags: qc,
    crossRun: [...new Set(rows.map(r => r.runId))].map(runId => {
      const run = rows.filter(r => r.runId === runId);
      return {
        runId, instrument: run[0].instrument, total: run.length,
        flagged: run.filter(r => qc[r.id].length).length,
        medianFocus: median(run.filter(r => r.measured).map(r => r.focusScore)),
      };
    }),
  };
}
