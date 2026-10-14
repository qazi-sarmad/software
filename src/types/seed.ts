import type { VarianceInputItem, TrialBalanceItem } from '../lib/analytics';
import type {
  LedgerEntry,
  AuditCapItem,
  AuditControl,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  AuditUniverse,
  GlassBoxToken,
  ReviewComment,
  WorkingPaper,
} from './index';

/** The data a tenant session starts from. Supplied to AppProvider; the app never imports tenant data itself. */
export interface AnalyticsSample {
  varianceItems: VarianceInputItem[];
  tbItems: TrialBalanceItem[];
  anomalyItems: { account: string; amount: number; rowRef: number }[];
}

export interface TenantSeed {
  tenantId: string;
  /** True only for the flagged demo tenant. */
  isDemo: boolean;
  universes: AuditUniverse[];
  entities: AuditEntity[];
  engagements: AuditEngagement[];
  controls: AuditControl[];
  workpapers: WorkingPaper[];
  observations: AuditObservation[];
  issues: AuditIssue[];
  comments: ReviewComment[];
  capItems: AuditCapItem[];
  glassBoxTokens: GlassBoxToken[];
  analyticsSample: AnalyticsSample;
  /** Starting text for the document review tab. */
  documentSample: string;
  buildLedger: () => Promise<LedgerEntry[]>;
}
