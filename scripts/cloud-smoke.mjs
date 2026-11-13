import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadEnv } from 'vite';
import { RayfinClient } from '@microsoft/rayfin-client';
import { signInWithEntraToken } from '@microsoft/rayfin-auth-provider-fabric';

const position = process.argv.indexOf('--project');
if (position < 0 || !process.argv[position + 1] || !process.env.RAYFIN_TOKEN) {
  process.stderr.write('Run through fabric:smoke with an authorized, guarded identity and recorded deployment.\n');
  process.exit(1);
}
const folder = path.resolve(process.argv[position + 1]);
const environment = loadEnv('production', folder, 'VITE_');
const baseUrl = environment.VITE_RAYFIN_API_URL;
const publishableKey = environment.VITE_RAYFIN_PUBLISHABLE_KEY;
if (!baseUrl || !publishableKey || !baseUrl.startsWith('https://')) {
  process.stderr.write('Resolved HTTPS runtime coordinates are missing.\n');
  process.exit(1);
}
const report = (check, status, detail) => process.stdout.write(`${check} | ${status} | ${detail}\n`);
const functionJson = value => typeof value === 'string' ? JSON.parse(value) : value;
const client = new RayfinClient({ baseUrl, publishableKey, authStorage: false, persistSession: false });
try {
  const session = await signInWithEntraToken(client.auth, { entraToken: process.env.RAYFIN_TOKEN });
  if (!session.isAuthenticated || !session.user) throw new Error('No authenticated app session.');
  const catalog = functionJson(await client.functions.catalog.invoke(undefined, { timeoutMs: 30000 }));
  if (catalog.experiment?.id !== 'spheroid-screen-001' || catalog.wells?.length !== 192)
    throw new Error('Remote experiment is missing or has unexpected dimensions.');
  report('CLOUD.CATALOG.AUTH', 'Pass', 'Authenticated manifest returned the registered experiment.');
  const well = catalog.wells.find(w => w.id === 'run1-B11');
  const image = well.volume;
  const frame = Buffer.from(await client.functions.imageFrame.invoke({
    assetId: image.id, time: 0, labels: false,
  }, { timeoutMs: 30000 }), 'base64');
  if (createHash('sha256').update(frame).digest('hex') !== image.frameHashes[0])
    throw new Error('Remote frame checksum differs from the authorized manifest.');
  report('CLOUD.IMAGE.AUTH', 'Pass', `OneLake image retrieved and hash verified (${frame.length} bytes).`);
  const analysis = functionJson(await client.functions.analyze.invoke({
    optionsJson: JSON.stringify({
      runId: 'run1', excludeQC: true,
      thresholds: { focusMin: 0.025, saturationMax: 0.015, illuminationMax: 0.55, objectCountMin: 12 },
    }),
  }, { timeoutMs: 45000 }));
  if (analysis.crossRun?.length !== 2 || analysis.included + analysis.excluded.length + analysis.unmeasured !== 96)
    throw new Error('Remote analytical query failed row accounting.');
  report('CLOUD.SQL.QUERY', 'Pass', 'Lakehouse SQL returned two actual acquisition runs and complete per-run accounting.');
  if (process.argv.includes('--write-review')) {
    const previous = await client.data.ReviewDecision.select(['id', 'version']).where({ well_id: { eq: well.id } })
      .orderBy({ updated_at: 'desc' }).first(1).execute();
    const saved = functionJson(await client.functions.saveReview.invoke({
      userId: session.user.id, wellId: well.id, state: 'Investigate',
      rationale: 'Authorized deployment smoke test of synthetic evidence; not a scientific conclusion.',
      annotation: 'Smoke-test revision, append-only. Preserve earlier human reviews.',
      expectedVersion: previous[0]?.version ?? 0,
    }));
    const fetched = await client.data.ReviewDecision.findById(saved.id);
    if (fetched?.rationale !== saved.rationale) throw new Error('Remote review read-back did not match.');
    report('CLOUD.REVIEW.PERSISTENCE', 'Pass', 'Created and independently read back one caller-scoped append-only synthetic review.');
  } else {
    report('CLOUD.REVIEW.PERSISTENCE', 'Not selected', 'Rerun with --write-review under an approved test identity to test a real write.');
  }
  const anonymous = new RayfinClient({ baseUrl, publishableKey, authStorage: false, persistSession: false });
  try {
    let denied = false;
    let accepted = false;
    try { await anonymous.functions.catalog.invoke(undefined, { timeoutMs: 10000 }); accepted = true; }
    catch (error) {
      if ([401, 403].includes(error.status) || ['UNAUTHORIZED', 'FORBIDDEN', 'AUTH_REQUIRED'].includes(error.code))
        denied = true;
      else report('CLOUD.ANONYMOUS', 'Warning', 'Anonymous request failed, but the SDK did not expose a verifiable 401/403; inspect authorization separately.');
    }
    if (accepted) throw new Error('Anonymous manifest access unexpectedly succeeded. Do not share this deployment.');
    if (denied) report('CLOUD.ANONYMOUS', 'Pass', 'Anonymous manifest access was explicitly denied.');
  } finally { anonymous.auth.destroy(); }
  report('CLOUD.SECOND.IDENTITY', 'Not selected', 'A different authenticated unauthorized test identity was not supplied; no authorization-success claim for that gate.');
  report('CLOUD.HOSTING', 'Manual action required', 'Verify protected static hosting in a signed-out browser; configuration sets assetAccess=protected.');
} catch (error) {
  const safe = String(error?.message ?? 'Cloud smoke failed.').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]');
  report('CLOUD.SMOKE', 'Fail', safe);
  process.exitCode = 1;
} finally {
  client.auth.destroy();
}
