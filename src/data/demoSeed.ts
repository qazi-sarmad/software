/**
 * The flagged demo tenant's data (is_demo). This is the only module that assembles tenant seed data.
 * It is reached only through a development-only dynamic import (see App.tsx), so a production build contains none of it.
 */
import { appendLedgerEntry } from '../lib/ledger';
import type { LedgerEntry } from '../types';
import type { TenantSeed } from '../types/seed';
import {
  initialCapItems,
  initialComments,
  initialControls,
  initialEngagements,
  initialEntities,
  initialGlassBoxTokens,
  initialIssues,
  initialObservations,
  initialUniverses,
  initialWorkpapers,
} from './initialData';

/**
 * Builds the demo tenant's starting ledger with real cryptographic hashes. Demo data only.
 */
export async function buildDemoLedger(): Promise<LedgerEntry[]> {
  const chain: LedgerEntry[] = [];

  const e1 = await appendLedgerEntry(chain, {
    actorId: 'usr-prep-1',
    actorName: 'Elena Rostova',
    actorRole: 'preparer',
    eventType: 'test_finalize',
    entityId: 'ent-treasury',
    recordId: 'wp-treas-2',
    recordType: 'workpaper',
    payloadSummary: 'Test steps completed and population verified (120 stress runoff assumptions) [CANARY-TREASURY]',
    payloadHash: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
    timestamp: '2026-09-10T14:30:00Z',
  });
  chain.push(e1);

  const e2 = await appendLedgerEntry(chain, {
    actorId: 'usr-rev',
    actorName: 'Sarah Jenkins',
    actorRole: 'reviewer',
    eventType: 'reviewer_sign_off',
    entityId: 'ent-treasury',
    recordId: 'wp-treas-2',
    recordType: 'workpaper',
    payloadSummary: 'Workpaper wp-treas-2 sealed and approved by Reviewer Sarah Jenkins [CANARY-TREASURY]',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timestamp: '2026-09-14T16:00:00Z',
  });
  chain.push(e2);

  const e3 = await appendLedgerEntry(chain, {
    actorId: 'usr-mgr',
    actorName: 'Marcus Vance',
    actorRole: 'audit_manager',
    eventType: 'audit_sign_off',
    entityId: 'ent-treasury',
    recordId: 'eng-treas-2',
    recordType: 'engagement',
    payloadSummary: 'Engagement eng-treas-2 ALM Liquidity sealed [CANARY-TREASURY]',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timestamp: '2026-09-14T16:15:00Z',
  });
  chain.push(e3);

  return chain;
}

/**
 * Demo rows carry [CANARY-*] markers used only by the development-only access leak scanner.
 * They are removed from everything users see unless the scanner explicitly asks for them (?canary).
 */
const KEEP_CANARIES =
  import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('canary');
function cleanSeed<T>(rows: T): T {
  if (KEEP_CANARIES) return rows;
  return JSON.parse(JSON.stringify(rows).replace(/\s?\[CANARY-[A-Z]+\]/g, ''));
}

export const DEMO_TENANT_ID = 'tenant-demo';

export const demoSeed: TenantSeed = {
  tenantId: DEMO_TENANT_ID,
  isDemo: true,
  universes: cleanSeed(initialUniverses),
  entities: cleanSeed(initialEntities),
  engagements: cleanSeed(initialEngagements),
  controls: cleanSeed(initialControls),
  workpapers: cleanSeed(initialWorkpapers),
  observations: cleanSeed(initialObservations),
  issues: cleanSeed(initialIssues),
  comments: cleanSeed(initialComments),
  capItems: cleanSeed(initialCapItems),
  glassBoxTokens: initialGlassBoxTokens,
  analyticsSample: {
    varianceItems: [
      { account: '4010 - Corporate Treasury Revenue', category: 'Revenue', currentPeriod: 14200000, priorPeriod: 12500000, rowRef: 1 },
      { account: '5020 - FX Hedging Derivative Settlements', category: 'Expense', currentPeriod: 8900000, priorPeriod: 6200000, rowRef: 2 },
      { account: '1010 - Central Bank Cash Reserves', category: 'Asset', currentPeriod: 450000000, priorPeriod: 480000000, rowRef: 3 },
      { account: '2010 - Interbank Overnight Repo Borrowing', category: 'Liability', currentPeriod: 125000000, priorPeriod: 98000000, rowRef: 4 },
      { account: '6010 - Clearing & Custody Fees', category: 'Expense', currentPeriod: 1450000, priorPeriod: 1420000, rowRef: 5 },
    ],
    tbItems: [
      { account: '1000 - Operating Cash', debit: 45200000, credit: 0, rowRef: 10 },
      { account: '1200 - Prime Brokerage Receivables', debit: 18400000, credit: 0, rowRef: 11 },
      { account: '2000 - Repo Repurchase Obligations', debit: 0, credit: 63600000, rowRef: 12 },
    ],
    anomalyItems: [
      { account: '4010 - Wire Postings', amount: 1540000, rowRef: 20 },
      { account: '4010 - Wire Postings', amount: 1500000, rowRef: 21 },
      { account: '4010 - Wire Postings', amount: 12800000, rowRef: 22 }, // Statistical outlier
      { account: '4010 - Wire Postings', amount: 200000, rowRef: 23 }, // Exact round number anomaly
    ],
  },
  documentSample: `Section 1. Executive Policy Framework
Global Liquidity Risk Management Policy mandates that all intraday settlements exceeding $10,000,000 USD be posted to the general ledger within 60 minutes of Fedwire notification.

Section 2. Control Execution
[TODO: Insert final operational walkthrough narrative from APAC regional branch]

Approved by: Marcus Vance, Head of Assurance
Date: September 15, 2026`,
  buildLedger: async () => cleanSeed(await buildDemoLedger()),
};
