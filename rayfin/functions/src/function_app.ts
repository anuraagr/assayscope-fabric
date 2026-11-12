import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import sql from 'mssql';
import { createHash, randomUUID } from 'node:crypto';
import type { AppSchema } from '../../data/schema.js';
import { target } from './target.js';
import { summarizeRows, validateOptions, type MeasurementRow } from './analysis.js';

const udf = new UserDataFunctions();
type Context = RayfinContext<AppSchema, AudienceType.Storage | AudienceType.Sql>;
const LIMIT = 3 * 1024 * 1024;
const STATES = ['Investigate', 'Repeat acquisition', 'Prioritize for confirmatory research'];

export function validateTarget() {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(target.workspaceId) || !guid.test(target.lakehouseId) ||
      !target.sqlEndpoint.endsWith('.datawarehouse.fabric.microsoft.com') ||
      !guid.test(target.sqlDatabase)) throw new Error('Tenant target is not configured. Deployment is fail-closed.');
  const root = new URL(target.oneLakeFilesPath);
  if (root.protocol !== 'https:' || !root.hostname.endsWith('.dfs.fabric.microsoft.com') ||
      root.username || root.password || root.search || root.hash ||
      !root.pathname.startsWith(`/${target.workspaceId}/${target.lakehouseId}/Files`))
    throw new Error('OneLake coordinates were not resolved for the configured workspace/item.');
}

async function authorize(ctx: Context) {
  validateTarget();
  if (!ctx.accessToken) throw new Error('Authentication is required.');
  // The runtime verifies app Run/Interact access. This caller-scoped protected query
  // also verifies the entity permission before the app identity reads any OneLake data.
  await ctx.getDataClient().ReviewDecision.select(['id']).first(1).execute();
}

async function readFile(ctx: Context, relative: string, maxBytes = LIMIT): Promise<Buffer> {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').includes('..') || relative.startsWith('/'))
    throw new Error('Unregistered storage path.');
  const url = `${target.oneLakeFilesPath.replace(/\/$/, '')}/assayscope/${target.experimentId}/${relative}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: ['Bearer', ctx.Tokens.Storage].join(' ') },
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
      continue;
    }
    if (response.status === 401) throw new Error('OneLake authorization expired; sign in again.');
    if (response.status === 403) throw new Error('OneLake denied the app identity. Ask the owner for scoped read access.');
    if (!response.ok) throw new Error(`OneLake image unavailable (HTTP ${response.status}). No local fallback.`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > maxBytes) throw new Error('Image exceeds the bounded authenticated-delivery limit.');
    if (!response.body) throw new Error('OneLake returned an empty stream.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maxBytes) { await reader.cancel(); throw new Error('Image read exceeded its bound.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  throw new Error('OneLake is unavailable after bounded retries.');
}

interface RegisteredAsset {
  id: string; shape: number[]; frameHashes: string[];
}
interface StoredCatalog {
  experiment: { id: string };
  codeVersion: string;
  wells: { id: string; image: RegisteredAsset; volume: RegisteredAsset | null }[];
}
function parseCatalog(text: string): StoredCatalog {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !('wells' in raw) || !Array.isArray(raw.wells) ||
      raw.wells.length > 1000 || !('experiment' in raw) || !raw.experiment ||
      typeof raw.experiment !== 'object' || !('id' in raw.experiment) ||
      raw.experiment.id !== target.experimentId) throw new Error('Invalid experiment catalog.');
  if (!('provenance' in raw) || !raw.provenance || typeof raw.provenance !== 'object' ||
      !('codeVersion' in raw.provenance) || typeof raw.provenance.codeVersion !== 'string')
    throw new Error('Processing provenance is missing.');
  const wells = raw.wells.map((w: unknown) => {
    if (!w || typeof w !== 'object' || !('id' in w) || typeof w.id !== 'string' ||
        !('image' in w) || !('volume' in w)) throw new Error('Invalid well record.');
    function asset(a: unknown): RegisteredAsset {
      if (!a || typeof a !== 'object' || !('id' in a) || typeof a.id !== 'string' ||
          !/^[a-zA-Z0-9_-]+$/.test(a.id) || !('shape' in a) || !Array.isArray(a.shape) ||
          a.shape.length !== 5 || !a.shape.every((n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0) ||
          !('frameHashes' in a) || !Array.isArray(a.frameHashes) ||
          !a.frameHashes.every((s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)))
        throw new Error('Invalid image manifest.');
      return { id: a.id, shape: a.shape, frameHashes: a.frameHashes };
    }
    return { id: w.id, image: asset(w.image), volume: w.volume === null ? null : asset(w.volume) };
  });
  return { experiment: { id: target.experimentId }, codeVersion: raw.provenance.codeVersion, wells };
}

udf.func('catalog', async (ctx: RayfinContext<AppSchema, AudienceType.Storage | AudienceType.Sql>): Promise<string> => {
  await authorize(ctx);
  const text = (await readFile(ctx, 'catalog.json')).toString('utf8');
  parseCatalog(text);
  return text;
}, []);

udf.func('imageFrame', async (
  assetId: string, time: number, labels: boolean,
  ctx: RayfinContext<AppSchema, AudienceType.Storage | AudienceType.Sql>,
): Promise<string> => {
  await authorize(ctx);
  const catalog = parseCatalog((await readFile(ctx, 'catalog.json')).toString('utf8'));
  const asset = catalog.wells.flatMap(w => [w.image, w.volume]).find(a => a?.id === assetId);
  if (!asset || !Number.isInteger(time) || time < 0 || time >= asset.shape[0])
    throw new Error('Image/time is not registered in this authorized experiment.');
  const bytes = await readFile(ctx, `${labels ? 'labels' : 'frames'}/${asset.id}-${time}.bin`);
  const expected = asset.shape.slice(labels ? 2 : 1).reduce((a, b) => a * b, 1);
  if (bytes.length !== expected || (!labels && createHash('sha256').update(bytes).digest('hex') !== asset.frameHashes[time]))
    throw new Error('Image data failed integrity validation.');
  return bytes.toString('base64');
}, []);

udf.func('analyze', async (
  optionsJson: string, ctx: RayfinContext<AppSchema, AudienceType.Storage | AudienceType.Sql>,
): Promise<string> => {
  const options = validateOptions(optionsJson);
  await authorize(ctx);
  const catalog = parseCatalog((await readFile(ctx, 'catalog.json')).toString('utf8'));
  const pool = new sql.ConnectionPool({
    server: target.sqlEndpoint, database: target.sqlDatabase,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token: ctx.Tokens.Sql } },
    connectionTimeout: 15000, requestTimeout: 20000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
  });
  try {
    await pool.connect();
    const results = await pool.request().input('experiment', sql.NVarChar(100), target.experimentId).query<MeasurementRow>(`
      SELECT TOP (1000) m.well_id AS id, m.well_name AS well, m.run_id AS runId,
        a.instrument, m.compound, m.dose_um AS doseUm, m.replicate,
        m.is_control AS control, m.measured, m.object_count AS objectCount,
        m.focus_score AS focusScore, m.saturation_fraction AS saturationFraction,
        m.illumination_cv AS illuminationCv, m.integrated_signal_adu AS integratedSignalAdu,
        m.code_version AS codeVersion
      FROM dbo.assayscope_measurements m
      JOIN dbo.assayscope_acquisitions a ON m.run_id=a.id AND m.experiment_id=a.experiment_id
      WHERE m.experiment_id=@experiment
      ORDER BY m.run_id, m.well_name
    `);
    if (!results.recordset.length) throw new Error('Analytical tables are empty. Ingest the image-derived results first.');
    if (results.recordset.some(r => r.codeVersion !== catalog.codeVersion))
      throw new Error('Analytical tables and image provenance differ. Wait for ingestion/SQL synchronization and retry.');
    return JSON.stringify(summarizeRows(results.recordset, options));
  } finally { await pool.close(); }
}, []);

udf.func('saveReview', async (
  userId: string, wellId: string, state: string, rationale: string, annotation: string, expectedVersion: number,
  ctx: RayfinContext<AppSchema, AudienceType.Storage | AudienceType.Sql>,
): Promise<string> => {
  await authorize(ctx);
  if (!STATES.includes(state) || !rationale.trim() || rationale.length > 4000 || annotation.length > 4000 ||
      !Number.isInteger(expectedVersion) || expectedVersion < 0 || userId.length > 128)
    throw new Error('A valid research review and bounded rationale are required.');
  const catalog = parseCatalog((await readFile(ctx, 'catalog.json')).toString('utf8'));
  if (!catalog.wells.some(w => w.id === wellId)) throw new Error('Review target is outside this experiment.');
  const data = ctx.getDataClient();
  const previous = await data.ReviewDecision.select(['id', 'version']).where({ well_id: { eq: wellId } })
    .orderBy({ updated_at: 'desc' }).first(1).execute();
  if ((previous[0]?.version ?? 0) !== expectedVersion) throw new Error('Review changed. Refresh before adding a new revision.');
  const row = {
    id: randomUUID(), user_id: userId, experiment_id: target.experimentId, well_id: wellId,
    state, rationale: rationale.trim(), annotation: annotation.trim(),
    updated_at: new Date().toISOString(), version: expectedVersion + 1,
  };
  // DAB's create policy validates user_id against the signed-in caller's subject.
  await data.ReviewDecision.create(row);
  return JSON.stringify(row);
}, []);
