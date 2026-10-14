import type { TenantSeed } from '../types/seed';

/** A tenant with no data. Used where no tenant session exists (for example the public /e/:token route). */
export const EMPTY_SEED: TenantSeed = {
  tenantId: 'no-tenant',
  isDemo: false,
  universes: [],
  entities: [],
  engagements: [],
  controls: [],
  workpapers: [],
  observations: [],
  issues: [],
  comments: [],
  capItems: [],
  glassBoxTokens: [],
  analyticsSample: { varianceItems: [], tbItems: [], anomalyItems: [] },
  documentSample: '',
  buildLedger: async () => [],
};
