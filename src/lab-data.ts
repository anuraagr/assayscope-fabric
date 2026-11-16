import { useEffect, useState } from 'react';
import type { Catalog } from './catalog.generated';
import type { DataAdapter } from './data';
import type { Analysis, AnalysisOptions } from './domain';
import { assertRunAnalysis, controlSummary, optionsKey } from './lab';

export function useStudyAnalyses(adapter: DataAdapter, catalog: Catalog, options: AnalysisOptions, current: Analysis) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; analyses: Record<string, Analysis> | null; error: string }>({
    key: '', analyses: null, error: '',
  });
  const key = optionsKey(options);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ key, analyses: null, error: '' });
    const load = async () => {
      if (catalog.runs.length > 8) throw new Error('This review supports at most eight declared acquisition runs.');
      const entries: [string, Analysis][] = [];
      for (let offset = 0; offset < catalog.runs.length; offset += 2) {
        const batch = await Promise.all(catalog.runs.slice(offset, offset + 2).map(async run => {
          const analysis = run.id === options.runId ? current :
            await adapter.analyze({ ...options, runId: run.id }, controller.signal);
          controller.signal.throwIfAborted();
          controlSummary(catalog, run.id, analysis);
          return [run.id, assertRunAnalysis(catalog, run.id, analysis)] as [string, Analysis];
        }));
        entries.push(...batch);
      }
      if (!controller.signal.aborted) setResult({ key, analyses: Object.fromEntries(entries), error: '' });
    };
    load().catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, analyses: null,
        error: error instanceof Error ? error.message : 'Run evidence could not be loaded.' });
    });
    return () => controller.abort();
  }, [adapter, catalog, options, current, key, attempt]);
  return { analyses: result.key === key ? result.analyses : null, error: result.key === key ? result.error : '',
    retry: () => setAttempt(value => value + 1) };
}
