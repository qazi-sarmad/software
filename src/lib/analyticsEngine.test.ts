import { describe, expect, it } from 'vitest';
import {
  checkBenfordFirstDigit,
  checkControlsVsTests,
  checkDuplicates,
  checkGlToTb,
  checkMissingAttributes,
  checkNearDuplicates,
  checkOutliersIqr,
  checkOutliersZScore,
  checkPeriodVariance,
  checkRoundNumbers,
  checkSameUserCreateApprove,
  checkSequenceGaps,
  checkSiraVsPlanning,
  checkWeekendPostings,
  createObservationStub,
  raiseFindingIntent,
  PopulationEntry,
} from './analyticsEngine';

// A fixture builder so each check is exercised on at least ten rows.
function pop(over: Partial<PopulationEntry>[]): PopulationEntry[] {
  return over.map((o, i) => ({ rowRef: o.rowRef ?? i + 1, ...o }));
}

describe('4F analyst engine: duplicates and near-duplicates', () => {
  it('checkDuplicates flags exactly the repeated rows', () => {
    const rows = checkDuplicates(
      pop([
        { amount: 100, date: '2026-01-01', attributes: { ref: 'A' } },
        { amount: 100, date: '2026-01-01', attributes: { ref: 'A' } },
        { amount: 200, date: '2026-01-02', attributes: { ref: 'B' } },
        { amount: 300, date: '2026-01-03', attributes: { ref: 'C' } },
        { amount: 400, date: '2026-01-04', attributes: { ref: 'D' } },
        { amount: 500, date: '2026-01-05', attributes: { ref: 'E' } },
        { amount: 600, date: '2026-01-06', attributes: { ref: 'F' } },
        { amount: 700, date: '2026-01-07', attributes: { ref: 'G' } },
        { amount: 800, date: '2026-01-08', attributes: { ref: 'H' } },
        { amount: 900, date: '2026-01-09', attributes: { ref: 'I' } },
      ])
    );
    expect(rows.rows).toHaveLength(10);
    expect(rows.flaggedCount).toBe(2);
    expect(rows.rows[0].flagged).toBe(true);
    expect(rows.rows[2].flagged).toBe(false);
  });

  it('checkNearDuplicates flags same amount and date by different users', () => {
    const rows = checkNearDuplicates(
      pop([
        { amount: 100, date: '2026-01-01', user: 'a' },
        { amount: 100, date: '2026-01-01', user: 'b' },
        { amount: 100, date: '2026-01-01', user: 'a' }, // same user: not a near dup
        { amount: 200, date: '2026-01-02', user: 'a' },
        { amount: 300, date: '2026-01-03', user: 'b' },
        { amount: 400, date: '2026-01-04', user: 'a' },
        { amount: 500, date: '2026-01-05', user: 'b' },
        { amount: 600, date: '2026-01-06', user: 'a' },
        { amount: 700, date: '2026-01-07', user: 'b' },
        { amount: 800, date: '2026-01-08', user: 'a' },
      ])
    );
    expect(rows.flaggedCount).toBe(3);
  });
});

describe('4F analyst engine: sequence gaps', () => {
  it('flags the row following a gap', () => {
    const entries = pop(
      [1, 2, 3, 5, 6, 7, 9, 10, 11, 12].map((s) => ({
        amount: s,
        attributes: { seq: s },
      }))
    );
    const rows = checkSequenceGaps(entries);
    expect(rows.flaggedCount).toBe(2);
    expect(rows.rows.find((r) => r.rowRef === 4)!.flagged).toBe(true); // 5 follows 3
    expect(rows.rows.find((r) => r.rowRef === 7)!.flagged).toBe(true); // 9 follows 7
  });
});

describe('4F analyst engine: outliers', () => {
  const normal = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  it('z-score flags the extreme value', () => {
    const entries = pop([...normal, 1000].map((a) => ({ amount: a })));
    const rows = checkOutliersZScore(entries, 3);
    expect(rows.rows.filter((r) => r.flagged).length).toBe(1);
    expect(rows.rows[10].flagged).toBe(true);
  });

  it('IQR flags the extreme value', () => {
    const entries = pop([...normal, 1000].map((a) => ({ amount: a })));
    const rows = checkOutliersIqr(entries);
    expect(rows.rows[10].flagged).toBe(true);
    expect(rows.rows[0].flagged).toBe(false);
  });
});

describe('4F analyst engine: Benford first digit', () => {
  it('reports chi-square and MAD and conforms for a Benford-shaped set', () => {
    // A distribution close to Benford: one hundred rows with the expected digit mix.
    const amounts: number[] = [];
    for (let d = 1; d <= 9; d += 1) {
      const count = Math.round([301, 176, 125, 97, 79, 67, 58, 51, 46][d - 1]);
      for (let i = 0; i < count; i += 1) amounts.push(d * 1000 + i);
    }
    const rows = checkBenfordFirstDigit(pop(amounts.map((a) => ({ amount: a }))));
    expect(rows.rows).toHaveLength(9);
    expect((rows.params as { conforms: boolean }).conforms).toBe(true);
    expect((rows.params as { n: number }).n).toBe(1000);
  });

  it('flags a distribution that is all nines', () => {
    const rows = checkBenfordFirstDigit(pop(Array.from({ length: 100 }, (_, i) => ({ amount: 9000 + i }))));
    expect((rows.params as { conforms: boolean }).conforms).toBe(false);
    expect(rows.rows.find((r) => r.details && (r.details as { digit: number }).digit === 9)!.flagged).toBe(true);
  });
});

describe('4F analyst engine: round numbers', () => {
  it('flags exact multiples of 1,000 and above', () => {
    const entries = pop([
      { amount: 100000 }, { amount: 10000 }, { amount: 1000 }, { amount: 1234 },
      { amount: 200000 }, { amount: 20000 }, { amount: 2000 }, { amount: 5678 },
      { amount: 300000 }, { amount: 30000 },
    ]);
    const rows = checkRoundNumbers(entries);
    expect(rows.flaggedCount).toBe(8);
    expect(rows.rows[3].flagged).toBe(false);
    expect(rows.rows[7].flagged).toBe(false);
  });
});

describe('4F analyst engine: weekend and holiday postings', () => {
  it('flags weekends and listed holidays', () => {
    const entries = pop([
      { date: '2026-01-03' }, // Saturday
      { date: '2026-01-04' }, // Sunday
      { date: '2026-01-05' }, // Monday
      { date: '2026-01-06' },
      { date: '2026-01-07' },
      { date: '2026-01-01' }, // holiday only if listed
      { date: '2026-01-08' },
      { date: '2026-01-09' },
      { date: '2026-01-10' }, // Saturday
      { date: '2026-01-12' },
    ]);
    const rows = checkWeekendPostings(entries, ['2026-01-01']);
    expect(rows.flaggedCount).toBe(4); // two weekend + one weekend + the holiday
    expect(rows.rows[5].flagged).toBe(true);
  });
});

describe('4F analyst engine: same user create and approve', () => {
  it('flags rows where the creator is the approver', () => {
    const entries = pop([
      { user: 'a', approver: 'b' }, { user: 'a', approver: 'a' }, { user: 'c', approver: 'd' },
      { user: 'e', approver: 'e' }, { user: 'f', approver: 'g' }, { user: 'h', approver: 'i' },
      { user: 'j', approver: 'j' }, { user: 'k', approver: 'l' }, { user: 'm', approver: 'n' },
      { user: 'o', approver: 'p' },
    ]);
    const rows = checkSameUserCreateApprove(entries);
    expect(rows.flaggedCount).toBe(3);
  });
});

describe('4F analyst engine: missing mandatory attributes', () => {
  it('flags rows missing a required attribute', () => {
    const entries = pop([
      { attributes: { invoice: '1', vendor: 'X' } },
      { attributes: { invoice: '', vendor: 'X' } },
      { attributes: { invoice: '3', vendor: '' } },
      { attributes: { invoice: '4', vendor: 'X' } },
      { attributes: { vendor: 'X' } },
      { attributes: { invoice: '6', vendor: 'X' } },
      { attributes: { invoice: '7', vendor: 'X' } },
      { attributes: { invoice: '8', vendor: 'X' } },
      { attributes: { invoice: '9', vendor: 'X' } },
      { attributes: { invoice: '10', vendor: 'X' } },
    ]);
    const rows = checkMissingAttributes(entries, ['invoice', 'vendor']);
    expect(rows.flaggedCount).toBe(3);
  });
});

describe('4F analyst engine: financial checks', () => {
  it('period variance honours both thresholds', () => {
    const rows = checkPeriodVariance(
      [
        { rowRef: 1, account: 'A', currentPeriod: 200000, priorPeriod: 100000 },
        { rowRef: 2, account: 'B', currentPeriod: 105000, priorPeriod: 100000 },
        { rowRef: 3, account: 'C', currentPeriod: 200000, priorPeriod: 100000 },
        { rowRef: 4, account: 'D', currentPeriod: 100000, priorPeriod: 100000 },
        { rowRef: 5, account: 'E', currentPeriod: 300000, priorPeriod: 100000 },
        { rowRef: 6, account: 'F', currentPeriod: 100000, priorPeriod: 100000 },
        { rowRef: 7, account: 'G', currentPeriod: 500000, priorPeriod: 100000 },
        { rowRef: 8, account: 'H', currentPeriod: 100000, priorPeriod: 100000 },
        { rowRef: 9, account: 'I', currentPeriod: 100000, priorPeriod: 100000 },
        { rowRef: 10, account: 'J', currentPeriod: 100000, priorPeriod: 100000 },
      ],
      10,
      100000
    );
    expect(rows.flaggedCount).toBe(4); // rows 1, 3, 5(200k/200%), 7
  });

  it('GL-to-TB flags a mismatch and a missing account', () => {
    const rows = checkGlToTb(
      [
        { rowRef: 1, account: 'Cash', balance: 100 },
        { rowRef: 2, account: 'AP', balance: 200 },
        { rowRef: 3, account: 'Missing', balance: 300 },
        { rowRef: 4, account: 'Cash2', balance: 400 },
        { rowRef: 5, account: 'Cash3', balance: 500 },
        { rowRef: 6, account: 'Cash4', balance: 600 },
        { rowRef: 7, account: 'Cash5', balance: 700 },
        { rowRef: 8, account: 'Cash6', balance: 800 },
        { rowRef: 9, account: 'Cash7', balance: 900 },
        { rowRef: 10, account: 'Cash8', balance: 1000 },
      ],
      [
        { account: 'Cash', balance: 100 },
        { account: 'AP', balance: 250 },
        { account: 'Cash2', balance: 400 },
        { account: 'Cash3', balance: 500 },
        { account: 'Cash4', balance: 600 },
        { account: 'Cash5', balance: 700 },
        { account: 'Cash6', balance: 800 },
        { account: 'Cash7', balance: 900 },
        { account: 'Cash8', balance: 1000 },
      ]
    );
    expect(rows.flaggedCount).toBe(2); // AP mismatch + Missing
  });
});

describe('4F analyst engine: reconciliations', () => {
  it('SIRA vs planning flags planning risks absent from SIRA', () => {
    const rows = checkSiraVsPlanning(
      [
        { rowRef: 1, riskId: 'R1' }, { rowRef: 2, riskId: 'R2' }, { rowRef: 3, riskId: 'R3' },
        { rowRef: 4, riskId: 'R4' }, { rowRef: 5, riskId: 'R5' }, { rowRef: 6, riskId: 'R6' },
        { rowRef: 7, riskId: 'R7' }, { rowRef: 8, riskId: 'R8' }, { rowRef: 9, riskId: 'R9' },
        { rowRef: 10, riskId: 'R10' },
      ],
      ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']
    );
    expect(rows.flaggedCount).toBe(2);
  });

  it('controls vs test records flags untested controls', () => {
    const rows = checkControlsVsTests(
      Array.from({ length: 10 }, (_, i) => ({ rowRef: i + 1, controlId: `C${i + 1}` })),
      ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']
    );
    expect(rows.flaggedCount).toBe(3);
  });
});

describe('4F analyst engine: raise finding', () => {
  it('attaches the rule id, params and row references', () => {
    const check = checkRoundNumbers(pop([{ amount: 1000 }, { amount: 1234 }]));
    const intent = raiseFindingIntent(check, [1]);
    expect(intent.ruleId).toBe('round_numbers');
    expect(intent.rowRefs).toEqual([1]);
    expect(intent.params).toHaveProperty('multiples');
  });

  it('the stub records the intent so 4F is independently green (D-5A-STUB)', () => {
    const seen: unknown[] = [];
    const check = checkDuplicates(pop([{ amount: 1 }, { amount: 1 }]));
    createObservationStub({ record: (i) => seen.push(i) }, check, [1, 2]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ruleId: 'duplicates', rowRefs: [1, 2] });
  });
});
