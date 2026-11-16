import { RayfinClient } from '@microsoft/rayfin-client';
import { ensureSignedInWithFabric, initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';
import type { AppSchema } from '../rayfin/data/schema';
import type { AppFunctionsSchema } from '../rayfin/functions/src/types';
import { validateCatalog, verifyFrame } from './data';
import type { DataAdapter } from './data';
import type { Analysis, Review } from './domain';
import { REVIEW_STATES } from './domain';
import { makeCloudBundle } from './bundle';
import { readReviews } from './lab-context';

export interface FabricSession {
  adapter: DataAdapter;
  initialize(): Promise<void>;
  signIn(): Promise<void>;
  isAuthenticated(): boolean;
}

export function requireFabricConfig(env: Record<string, string | undefined>) {
  const required = ['VITE_RAYFIN_API_URL', 'VITE_RAYFIN_PUBLISHABLE_KEY',
    'VITE_FABRIC_WORKSPACE_ID', 'VITE_FABRIC_ITEM_ID'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Missing tenant configuration: ${missing.join(', ')}. No local fallback.`);
  const url = new URL(env.VITE_RAYFIN_API_URL!);
  const dedicatedHost = url.hostname.endsWith('.pbidedicated.windows.net');
  if (url.protocol !== 'https:' || !(url.hostname.endsWith('.rayfin.windows.net') || url.hostname.endsWith('.fabric.microsoft.com') || dedicatedHost) ||
      url.port || url.username || url.password || url.search || url.hash)
    throw new Error('The configured app endpoint must be a protected HTTPS Rayfin endpoint.');
  const guid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!guid.test(env.VITE_FABRIC_WORKSPACE_ID!) || !guid.test(env.VITE_FABRIC_ITEM_ID!))
    throw new Error('The workspace and app identifiers must be resolved GUIDs.');
  if (dedicatedHost) {
    const coordinates = /^\/webapi\/capacities\/([0-9a-f-]+)\/workloads\/BaaS\/BaaSService\/automatic\/v1\/workspaces\/([0-9a-f-]+)\/appbackends\/([0-9a-f-]+)\/?$/i.exec(url.pathname);
    if (!coordinates || !guid.test(coordinates[1]) ||
        url.hostname !== `${coordinates[1].replaceAll('-', '').toLowerCase()}.pbidedicated.windows.net` ||
        coordinates[2].toLowerCase() !== env.VITE_FABRIC_WORKSPACE_ID!.toLowerCase() ||
        coordinates[3].toLowerCase() !== env.VITE_FABRIC_ITEM_ID!.toLowerCase())
      throw new Error('The dedicated Fabric endpoint does not match the configured capacity, workspace and app.');
  }
  return {
    baseUrl: url.toString(), publishableKey: env.VITE_RAYFIN_PUBLISHABLE_KEY!,
    workspaceId: env.VITE_FABRIC_WORKSPACE_ID!, projectId: env.VITE_FABRIC_ITEM_ID!,
  };
}

function isReview(input: unknown): input is Review {
  if (!input || typeof input !== 'object') return false;
  return 'well_id' in input && typeof input.well_id === 'string' &&
    'state' in input && REVIEW_STATES.some(s => s === input.state) &&
    'rationale' in input && typeof input.rationale === 'string' &&
    'annotation' in input && typeof input.annotation === 'string' &&
    'updated_at' in input && typeof input.updated_at === 'string' &&
    'version' in input && Number.isInteger(input.version);
}
function readReview(raw: unknown) {
  if (!isReview(raw)) throw new Error('Fabric returned an invalid review record.');
  return readReviews([{
    well_id: raw.well_id, state: raw.state, rationale: raw.rationale, annotation: raw.annotation,
    updated_at: raw.updated_at, version: raw.version,
  }])[0];
}
function functionJson(value: unknown): unknown {
  // Rayfin 1.36 may already decode a handler's JSON string before returning it.
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const count = (value: unknown) => finite(value) && Number.isInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
function isAnalysis(value: unknown): value is Analysis {
  if (!record(value) || !record(value.thresholds) || !record(value.normalized) || !record(value.flags)) return false;
  return count(value.included) && count(value.unmeasured) && count(value.controlN) &&
    strings(value.excluded) && nullableNumber(value.controlMedian) &&
    Object.values(value.normalized).every(nullableNumber) && Object.values(value.flags).every(strings) &&
    ['formula', 'nDefinition', 'fit'].every(key => typeof value[key] === 'string') &&
    finite(value.thresholds.focusMin) && finite(value.thresholds.saturationMax) &&
    finite(value.thresholds.illuminationMax) && count(value.thresholds.objectCountMin) &&
    Array.isArray(value.groups) && value.groups.every(group => record(group) &&
      typeof group.compound === 'string' && finite(group.doseUm) && count(group.n) &&
      strings(group.wellIds) && Array.isArray(group.points) && group.points.every(finite) &&
      group.points.length === group.n && group.wellIds.length >= group.n &&
      nullableNumber(group.mean) && nullableNumber(group.sd)) &&
    Array.isArray(value.crossRun) && value.crossRun.length > 0 && value.crossRun.every(run => record(run) &&
      typeof run.runId === 'string' && typeof run.instrument === 'string' &&
      count(run.flagged) && count(run.total) && nullableNumber(run.medianFocus));
}
export function readCloudAnalysis(raw: unknown): Analysis {
  const result = functionJson(raw);
  if (!isAnalysis(result)) throw new Error('Analytical query returned an invalid result.');
  return result;
}
function decodeBase64(text: string) {
  if (text.length > 4 * 1024 * 1024) throw new Error('Image response exceeds the bounded delivery limit.');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}

export function createFabricSession(): FabricSession {
  const config = requireFabricConfig(import.meta.env);
  const client = new RayfinClient<AppSchema, AppFunctionsSchema>({
    baseUrl: config.baseUrl, publishableKey: config.publishableKey,
    persistSession: true,
  });
  const authOptions = {
    workspaceId: config.workspaceId, projectId: config.projectId,
    fabricPortalUrl: 'https://app.fabric.microsoft.com/', returnOrigin: window.location.origin,
  };
  const demandSession = () => {
    const session = client.auth.getSession();
    if (!session.isAuthenticated || !session.user)
      throw new Error('Your Fabric access has expired. Reload and sign in again. No local fallback.');
    return session.user;
  };
  let subject = client.auth.getSession().user?.id;
  client.auth.onSessionChange(session => {
    if (subject && subject !== session?.user?.id)
      window.dispatchEvent(new Event('assayscope-auth-changed'));
    subject = session?.user?.id;
  });
  const adapter: DataAdapter = {
    kind: 'fabric',
    cacheNamespace: crypto.randomUUID(),
    async catalog(signal) {
      demandSession(); signal?.throwIfAborted();
      const text = await client.functions.catalog.invoke(undefined, { timeoutMs: 30000 });
      signal?.throwIfAborted();
      return validateCatalog(functionJson(text));
    },
    async analyze(options, signal) {
      demandSession(); signal?.throwIfAborted();
      const text = await client.functions.analyze.invoke({ optionsJson: JSON.stringify(options) }, { timeoutMs: 45000 });
      signal?.throwIfAborted();
      return readCloudAnalysis(text);
    },
    async frame(asset, time, signal) {
      demandSession(); signal?.throwIfAborted();
      const base64 = await client.functions.imageFrame.invoke({ assetId: asset.id, time, labels: false }, { timeoutMs: 30000 });
      signal?.throwIfAborted();
      return verifyFrame(asset, time, decodeBase64(base64));
    },
    async labels(asset, time, signal) {
      demandSession(); signal?.throwIfAborted();
      const base64 = await client.functions.imageFrame.invoke({ assetId: asset.id, time, labels: true }, { timeoutMs: 30000 });
      signal?.throwIfAborted();
      const bytes = decodeBase64(base64);
      if (bytes.length !== asset.shape.slice(2).reduce((a, b) => a * b, 1)) throw new Error('Label dimensions do not match.');
      return bytes;
    },
    async review(well, signal) {
      demandSession(); signal?.throwIfAborted();
      const rows = await client.data.ReviewDecision
        .select(['id', 'well_id', 'state', 'rationale', 'annotation', 'updated_at', 'version'])
        .where({ well_id: { eq: well } }).orderBy({ updated_at: 'desc' }).first(1).execute();
      signal?.throwIfAborted();
      return rows.length ? readReview(rows[0]) : null;
    },
    async reviews(signal) {
      demandSession(); signal?.throwIfAborted();
      const catalog = await adapter.catalog(signal);
      const allowed = new Set(catalog.wells.map(well => well.id));
      const latest = new Map<string, Review>();
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        demandSession(); signal?.throwIfAborted();
        let query = client.data.ReviewDecision
          .select(['id', 'well_id', 'state', 'rationale', 'annotation', 'updated_at', 'version'])
          .where({ experiment_id: { eq: catalog.experiment.id } })
          .orderBy({ updated_at: 'desc', id: 'desc' }).first(100);
        if (cursor) query = query.after(cursor);
        const result = await query.executePaginated();
        signal?.throwIfAborted();
        for (const row of result.items) {
          const review = readReview(row);
          if (!allowed.has(review.well_id)) throw new Error('Review inventory contains an unregistered well.');
          if (!latest.has(review.well_id)) latest.set(review.well_id, review);
        }
        if (!result.hasNextPage) return readReviews([...latest.values()].sort((a, b) => a.well_id.localeCompare(b.well_id)));
        if (!result.endCursor || result.endCursor === cursor) throw new Error('Review pagination did not advance.');
        cursor = result.endCursor;
      }
      throw new Error('Review history exceeds the 2,000-revision inventory bound. The queue is not shown as complete; contact the app owner.');
    },
    async labContext(signal) {
      demandSession(); signal?.throwIfAborted();
      const result = await client.functions.labContext.invoke(undefined, { timeoutMs: 30000 });
      signal?.throwIfAborted();
      return functionJson(result);
    },
    async saveReview(well, review) {
      const user = demandSession();
      return readReview(functionJson(await client.functions.saveReview.invoke({
        userId: user.id, wellId: well, state: review.state, rationale: review.rationale,
        annotation: review.annotation, expectedVersion: review.version,
      }, { timeoutMs: 30000 })));
    },
    async export(options) {
      const catalog = await adapter.catalog();
      const well = catalog.wells.find(w => w.id === options.wellId);
      if (!well) throw new Error('Unknown well.');
      const asset = [well.image, well.volume].find(a => a?.id === options.view.assetId);
      if (!asset) throw new Error('Image does not belong to this well.');
      const [analysis, review, values] = await Promise.all([
        adapter.analyze(options), adapter.review(well.id), adapter.frame(asset, options.view.time),
      ]);
      return makeCloudBundle(catalog, well, analysis, options, { values, asset, time: options.view.time }, review);
    },
    async reset() { throw new Error('Demo reset is disabled for tenant data. Review revisions are append-only.'); },
    async publicIndex() { return { available: false, studies: [], message: 'Public references are not mixed into tenant screening data.' }; },
  };
  return {
    adapter,
    async initialize() { await initEmbeddedAuth(client.auth, authOptions); },
    async signIn() { await ensureSignedInWithFabric(client.auth, authOptions); },
    isAuthenticated: () => client.auth.getSession().isAuthenticated,
  };
}
