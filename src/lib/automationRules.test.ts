import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES, CONDITION_OPERATORS, LOOP_GUARD_PER_HOUR, conditionMatches, conditionsMatch,
  describeCondition, describeRule, eventDef, wouldPause, type AutomationRule,
} from './automationRules';

const payload = { severity: 'high', amount: 5000, entity: 'A-E1', note: 'Cash count variance' };

describe('automation rule conditions (F7, L1)', () => {
  it('eq matches only the exact value', () => {
    expect(conditionMatches(payload, { field: 'severity', operator: 'eq', value: 'high' })).toBe(true);
    expect(conditionMatches(payload, { field: 'severity', operator: 'eq', value: 'low' })).toBe(false);
  });

  it('ne is the inverse of eq', () => {
    expect(conditionMatches(payload, { field: 'severity', operator: 'ne', value: 'low' })).toBe(true);
    expect(conditionMatches(payload, { field: 'severity', operator: 'ne', value: 'high' })).toBe(false);
  });

  it('gte and lte compare numbers', () => {
    expect(conditionMatches(payload, { field: 'amount', operator: 'gte', value: '1000' })).toBe(true);
    expect(conditionMatches(payload, { field: 'amount', operator: 'gte', value: '9000' })).toBe(false);
    expect(conditionMatches(payload, { field: 'amount', operator: 'lte', value: '9000' })).toBe(true);
    expect(conditionMatches(payload, { field: 'amount', operator: 'lte', value: '100' })).toBe(false);
  });

  it('gte on a non-numeric value is false, never an error', () => {
    expect(conditionMatches(payload, { field: 'severity', operator: 'gte', value: '1' })).toBe(false);
  });

  it('contains is case-insensitive', () => {
    expect(conditionMatches(payload, { field: 'note', operator: 'contains', value: 'CASH' })).toBe(true);
    expect(conditionMatches(payload, { field: 'note', operator: 'contains', value: 'absent' })).toBe(false);
  });

  it('in matches any of a comma list', () => {
    expect(conditionMatches(payload, { field: 'severity', operator: 'in', value: 'low,high' })).toBe(true);
    expect(conditionMatches(payload, { field: 'severity', operator: 'in', value: 'low,medium' })).toBe(false);
  });

  it('a missing field never matches', () => {
    expect(conditionMatches(payload, { field: 'absent', operator: 'eq', value: 'x' })).toBe(false);
    expect(conditionMatches(payload, { field: 'absent', operator: 'ne', value: 'x' })).toBe(false);
  });

  it('an empty condition list passes', () => {
    expect(conditionsMatch(payload, [])).toBe(true);
  });

  it('every condition must pass', () => {
    expect(conditionsMatch(payload, [
      { field: 'severity', operator: 'eq', value: 'high' },
      { field: 'amount', operator: 'gte', value: '1000' },
    ])).toBe(true);
    expect(conditionsMatch(payload, [
      { field: 'severity', operator: 'eq', value: 'high' },
      { field: 'amount', operator: 'gte', value: '9000' },
    ])).toBe(false);
  });

  it('describes a condition in plain words', () => {
    expect(describeCondition({ field: 'amount', operator: 'gte', value: '1000' }))
      .toBe('amount is at least 1000');
  });

  it('describes a rule in plain words', () => {
    const rule: AutomationRule = {
      id: 'r1', ruleKey: 'k', name: 'n', eventKey: 'anomaly.raised',
      conditions: [{ field: 'severity', operator: 'eq', value: 'high' }],
      actions: [{ type: 'notify', message: 'Tell the CIA' }],
      enabled: true, isPlatformTemplate: false, pausedAt: null, pauseReason: null,
    };
    expect(describeRule(rule)).toContain('An anomaly was raised');
    expect(describeRule(rule)).toContain('Tell the CIA');
  });

  it('a rule with no actions says so', () => {
    const rule: AutomationRule = {
      id: 'r1', ruleKey: 'k', name: 'n', eventKey: 'cap.overdue',
      conditions: [], actions: [], enabled: true, isPlatformTemplate: false,
      pausedAt: null, pauseReason: null,
    };
    expect(describeRule(rule)).toContain('nothing');
  });

  it('the loop guard pauses past the ceiling and not at it', () => {
    expect(wouldPause(LOOP_GUARD_PER_HOUR)).toBe(false);
    expect(wouldPause(LOOP_GUARD_PER_HOUR + 1)).toBe(true);
  });

  it('the event catalogue carries the fields the editor offers', () => {
    expect(eventDef('anomaly.raised')?.fields.map((f) => f.field)).toContain('amount');
    expect(eventDef('nope')).toBeUndefined();
  });

  it('every operator has a plain-language label', () => {
    for (const op of CONDITION_OPERATORS) expect(op.label.length).toBeGreaterThan(0);
  });

  it('every action type has a plain-language label', () => {
    for (const a of ACTION_TYPES) expect(a.label.length).toBeGreaterThan(0);
  });
});
