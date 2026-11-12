import { RayfinClient } from '@microsoft/rayfin-client';
import { ensureSignedInWithFabric, initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';
import type { AppSchema } from '../rayfin/data/schema';
import type { AppFunctionsSchema } from '../rayfin/functions/src/types';
import { validateCatalog, verifyFrame } from './data';
import type { DataAdapter } from './data';
import type { Analysis, Review } from './domain';
import { REVIEW_STATES } from './domain';
import { makeCloudBundle } from './bundle';

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
  if (url.protocol !== 'https:' || !(url.hostname.endsWith('.rayfin.windows.net') || url.hostname.endsWith('.fabric.microsoft.com')) ||
      url.username || url.password || url.search || url.hash)
    throw new Error('The configured app endpoint must be a protected HTTPS Rayfin endpoint.');
  const guid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!guid.test(env.VITE_FABRIC_WORKSPACE_ID!) || !guid.test(env.VITE_FABRIC_ITEM_ID!))
    throw new Error('The workspace and app identifiers must be resolved GUIDs.');
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
  return raw;
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
      return validateCatalog(JSON.parse(text));
    },
    async analyze(options, signal) {
      demandSession(); signal?.throwIfAborted();
      const text = await client.functions.analyze.invoke({ optionsJson: JSON.stringify(options) }, { timeoutMs: 45000 });
      signal?.throwIfAborted();
      const result: Analysis = JSON.parse(text);
      if (!Number.isInteger(result.included) || !Array.isArray(result.groups) || !result.flags ||
          !result.crossRun || result.crossRun.length === 0)
        throw new Error('Analytical query returned an invalid result.');
      return result;
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
    async saveReview(well, review) {
      const user = demandSession();
      return readReview(JSON.parse(await client.functions.saveReview.invoke({
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
