import { authenticated, entity, int, text, uuid } from '@microsoft/rayfin-core';

@entity()
@authenticated(['create', 'read'], { policy: (claims, item) => claims.sub.eq(item.user_id) })
export class ReviewDecision {
  @uuid() id!: string;
  @text({ max: 128 }) user_id!: string;
  @text({ max: 100 }) experiment_id!: string;
  @text({ max: 40 }) well_id!: string;
  @text({ max: 64 }) state!: string;
  @text({ max: 4000 }) rationale!: string;
  @text({ max: 4000 }) annotation!: string;
  @text({ max: 40 }) updated_at!: string;
  @int() version!: number;
}
