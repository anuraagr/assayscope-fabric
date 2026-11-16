import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../contracts/lab-context.schema.json';
import reviewSchema from '../contracts/reviews.schema.json';
import type { Catalog } from './catalog.generated';
import type { LabContextSnapshot } from './lab-context.generated';
import type { Review } from './domain';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const contextValid = ajv.compile<LabContextSnapshot>(schema);
const reviewsValid = ajv.compile<Review[]>(reviewSchema);

export function readReviews(raw: unknown): Review[] {
  if (!reviewsValid(raw) || raw.some(review => !review.rationale.trim())) {
    throw new Error('Review records do not match the shared contract. No empty queue was substituted.');
  }
  if (new Set(raw.map(review => review.well_id)).size !== raw.length) throw new Error('The review list contains duplicate wells.');
  return raw;
}

export function validateLabContext(raw: unknown, catalog: Catalog): LabContextSnapshot {
  if (!contextValid(raw)) throw new Error('Lab context does not match the shared metadata contract.');
  if (raw.origin !== 'simulated' || raw.connectionState !== 'example-only') {
    throw new Error('Real lab records cannot be attached to this simulated screening experiment.');
  }
  const seen = new Set<string>();
  const records = new Set<string>();
  for (const record of raw.records) {
    const well = catalog.wells.find(well => well.id === record.wellId);
    if (!well || record.experimentId !== catalog.experiment.id || record.runId !== well.runId ||
        record.sourceImageId !== well.image.id || seen.has(record.wellId)) {
      throw new Error('Lab context has an ambiguous or mismatched experiment/run/well/image mapping.');
    }
    const id = JSON.stringify([record.externalRecordId, record.recordVersion]);
    if (records.has(id)) throw new Error('Lab context contains an ambiguous source-record version.');
    const url = new URL(record.recordUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.example.invalid') ||
        url.username || url.password || url.search || url.hash || url.port ||
        Date.parse(record.updatedAt) > Date.parse(raw.exportedAt)) {
      throw new Error('Example context has an unsafe link or inconsistent export timestamp.');
    }
    seen.add(record.wellId); records.add(id);
  }
  return raw;
}
