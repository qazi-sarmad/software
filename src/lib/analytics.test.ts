import { describe, expect, it } from 'vitest';
import {
  runAnomalyDetection,
  runDocumentReview,
  runGlToTbReconciliation,
  runTrialBalanceCheck,
  runVarianceAnalysis,
} from './analytics';

describe('Task 2: Audit Analytics & Document Review Engine', () => {
  it('Variance analysis flags rows exceeding percentage and dollar thresholds', () => {
    const input = [
      {
        account: '1010 - Cash & Equivalents',
        category: 'Assets',
        currentPeriod: 1200000,
        priorPeriod: 1000000,
        rowRef: 1,
      }, // +200k, +20% -> Flagged (exceeds 100k & 10%)
      {
        account: '1020 - Petty Cash',
        category: 'Assets',
        currentPeriod: 12000,
        priorPeriod: 10000,
        rowRef: 2,
      }, // +2k, +20% -> Not flagged (dollar < 100k)
      {
        account: '2010 - Accounts Payable',
        category: 'Liabilities',
        currentPeriod: 5020000,
        priorPeriod: 5000000,
        rowRef: 3,
      }, // +20k, +0.4% -> Not flagged
    ];

    const results = runVarianceAnalysis(input, 10, 100000);
    expect(results).toHaveLength(3);
    expect(results[0].flagged).toBe(true);
    expect(results[0].varianceVal).toBe(200000);
    expect(results[0].variancePct).toBe(20);
    expect(results[1].flagged).toBe(false);
    expect(results[2].flagged).toBe(false);
  });

  it('Trial Balance check accurately verifies debits equal credits', () => {
    const balancedInput = [
      { account: 'Cash', debit: 500000, credit: 0, rowRef: 1 },
      { account: 'Revenue', debit: 0, credit: 500000, rowRef: 2 },
    ];
    const balancedCheck = runTrialBalanceCheck(balancedInput);
    expect(balancedCheck.balanced).toBe(true);
    expect(balancedCheck.imbalance).toBe(0);

    const imbalancedInput = [
      { account: 'Cash', debit: 500000, credit: 0, rowRef: 1 },
      { account: 'Revenue', debit: 0, credit: 485000, rowRef: 2 },
    ];
    const imbalancedCheck = runTrialBalanceCheck(imbalancedInput);
    expect(imbalancedCheck.balanced).toBe(false);
    expect(imbalancedCheck.imbalance).toBe(15000);
    expect(imbalancedCheck.rows[0].flagged).toBe(true);
  });

  it('Anomaly detection catches statistical outliers and round figures', () => {
    const normalItems = [
      { account: 'Exp 1', amount: 12450, rowRef: 1 },
      { account: 'Exp 2', amount: 11800, rowRef: 2 },
      { account: 'Exp 3', amount: 12100, rowRef: 3 },
      { account: 'Exp 4', amount: 12900, rowRef: 4 },
      { account: 'Exp 5', amount: 11950, rowRef: 5 },
      { account: 'Exp 6', amount: 12300, rowRef: 6 },
      { account: 'Exp 7', amount: 12150, rowRef: 7 },
      { account: 'Exp Outlier', amount: 485123, rowRef: 8 }, // extreme statistical outlier
      { account: 'Exp Round', amount: 200000, rowRef: 9 }, // suspicious round number
    ];

    const anomalies = runAnomalyDetection(normalItems);
    const outlierRow = anomalies.find((a) => a.account === 'Exp Outlier');
    expect(outlierRow?.flagged).toBe(true);
    expect(outlierRow?.flagReason).toContain('Statistical outlier');

    const roundRow = anomalies.find((a) => a.account === 'Exp Round');
    expect(roundRow?.flagged).toBe(true);
    expect(roundRow?.flagReason).toContain('exact round amount');
  });

  it('GL to TB reconciliation flags subledger variances', () => {
    const gl = [
      { account: 'AR', amount: 40000, rowRef: 101 },
      { account: 'AR', amount: 60000, rowRef: 102 },
      { account: 'AP', amount: 30000, rowRef: 103 },
    ];
    const tb = [
      { account: 'AR', balance: 100000, rowRef: 201 }, // matches 40k + 60k
      { account: 'AP', balance: 35000, rowRef: 202 }, // discrepancy of 5k
    ];

    const recon = runGlToTbReconciliation(gl, tb);
    expect(recon[0].flagged).toBe(false);
    expect(recon[1].flagged).toBe(true);
    expect(recon[1].varianceVal).toBe(-5000);
  });

  it('Document review detects placeholders and unexecuted signatures', () => {
    const badDoc = `
      Audit Scope & Methodology
      [INSERT SCOPE HERE]
      TODO: Verify sample count with CAE
      
      Approval Block:
      Prepared by: Jane Auditor
      Approved by: ____________________
    `;

    const checks = runDocumentReview(badDoc);
    const placeholderCheck = checks.find((c) => c.rule === 'Placeholder and Draft Tokens');
    expect(placeholderCheck?.passed).toBe(false);
    expect(placeholderCheck?.findings.length).toBeGreaterThan(0);

    const sigCheck = checks.find((c) => c.rule === 'Formal Signatures and Attestation');
    expect(sigCheck?.passed).toBe(false);
  });
});
