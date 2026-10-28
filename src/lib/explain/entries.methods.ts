/**
 * Explain catalogue — sampling methods and their behaviour (docs/EXPLAIN-LAYER.md §2).
 *
 * The seven methods the UI offers (src/data/sampling.ts). Each states what it selects, its bias and
 * its IIA hooks. A method offered but not implemented says so plainly, because a method that does
 * nothing is exactly the defect this layer exists to prevent.
 */
import type { ExplainEntry } from './types';

export const METHOD_ENTRIES: ExplainEntry[] = [
  {
    id: 'method.random',
    kind: 'method',
    title: 'Random',
    summary: 'Selects the stated number of rows uniformly at random from the population.',
    effect:
      'Records the sample size and blocks sign-off until every selected row carries a result, so an unworked row cannot pass.',
    howItWorks: [
      'Every row has an equal chance of selection; the draw is seeded and reproducible.',
      'The selected rows become the tested set, each needing a remark and a decision.',
    ],
    whenToUse: ['The population is homogeneous and no row is inherently riskier than another.'],
    whenNotToUse: [
      'A few large items dominate the value — use MUS or High value so the sample is not blind to them.',
    ],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.systematic', 'method.mus', 'term.population', 'term.coverage'],
    source: 'SYSTELIGON.md §2.3; src/data/sampling.ts',
  },
  {
    id: 'method.systematic',
    kind: 'method',
    title: 'Systematic',
    summary: 'Selects every nth row across the population, after a random start.',
    effect:
      'Records the interval and the sample size, and blocks sign-off until every selected row carries a result.',
    howItWorks: [
      'The interval is population size divided by sample size.',
      'A random start within the first interval prevents the pattern from being predictable.',
    ],
    whenToUse: ['The population is in a stable order and a spread across the whole period is wanted.'],
    whenNotToUse: [
      'The population has a repeating cycle that lines up with the interval — the sample would hit the same position every cycle.',
    ],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.random', 'term.population', 'term.precision'],
    source: 'SYSTELIGON.md §2.3; src/data/sampling.ts',
  },
  {
    id: 'method.mus',
    kind: 'method',
    title: 'Monetary unit sampling (MUS/PPS)',
    summary:
      'Weights each item by its monetary value, so larger items are more likely to be selected.',
    effect:
      'Records the sample size and blocks sign-off until every selected row carries a result; the sample is biased toward larger items by design.',
    howItWorks: [
      'Each unit of value has an equal chance of selection, so a large item occupies more units and is likelier to be drawn.',
      'The result supports a value-based conclusion (an upper error limit) rather than a simple rate.',
    ],
    whenToUse: ['The population is monetary and overstatement is the main concern.'],
    whenNotToUse: [
      'Understatement or a completeness assertion is the concern — a value-weighted sample under-covers small missing items.',
    ],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.high_value', 'term.upper_error_limit', 'term.precision', 'term.materiality'],
    source: 'SYSTELIGON.md §2.3; src/data/sampling.ts',
  },
  {
    id: 'method.stratified',
    kind: 'method',
    title: 'Stratified',
    summary: 'Divides the population into strata and samples within each one.',
    effect:
      'Records the strata and the sample size per stratum, and blocks sign-off until every selected row carries a result.',
    howItWorks: [
      'The population is split on a chosen characteristic (value band, entity, period).',
      'Each stratum is sampled so a small but risky stratum is not lost in the whole.',
    ],
    whenToUse: ['The population is heterogeneous and the difference between groups matters.'],
    whenNotToUse: ['The population is genuinely uniform — stratification adds bookkeeping without benefit.'],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.random', 'term.population', 'term.coverage'],
    source: 'SYSTELIGON.md §2.3, §11.1a; src/data/sampling.ts',
  },
  {
    id: 'method.high_value',
    kind: 'method',
    title: 'High value',
    summary: 'Selects the items whose value is at or above a threshold.',
    effect:
      'Records the threshold and the selected rows, and blocks sign-off until every selected row carries a result.',
    howItWorks: [
      'Every item at or above the threshold is selected, not a sample of them.',
      'It is a certainty selection for the items that carry the most risk.',
    ],
    whenToUse: ['The large items warrant testing in full.'],
    whenNotToUse: ['It is used alone — the remaining, smaller population is then untested; pair it with another method.'],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.mus', 'method.low_value', 'term.materiality'],
    source: 'SYSTELIGON.md §2.3; src/data/sampling.ts',
  },
  {
    id: 'method.low_value',
    kind: 'method',
    title: 'Low value',
    summary: 'Selects items whose value is below a threshold.',
    effect:
      'Records the threshold and the selected rows, and blocks sign-off until every selected row carries a result.',
    howItWorks: [
      'The complement of high value: the small items are the tested set.',
      'Often used to cover a remainder left after a certainty selection.',
    ],
    whenToUse: ['Understatement risk in small items, or to complete coverage after a high-value selection.'],
    whenNotToUse: ['Overstatement in large items is the concern — this method excludes exactly those.'],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.high_value', 'term.coverage'],
    source: 'SYSTELIGON.md §2.3; src/data/sampling.ts',
  },
  {
    id: 'method.haphazard',
    kind: 'method',
    title: 'Haphazard',
    summary: 'Selects rows without a defined rule — at the auditor’s discretion.',
    effect:
      'Records the sample size and blocks sign-off until every selected row carries a result, but the selection is not statistically defensible.',
    detail: [
      'Haphazard selection cannot support a statistical conclusion, because the probability of selection is unknown.',
    ],
    whenToUse: ['Exploratory work where no statistical conclusion is drawn.'],
    whenNotToUse: [
      'A conclusion about the population is needed — use random, systematic or MUS instead; haphazard will not withstand challenge.',
    ],
    iiaStandards: ['14.1', '14.2'],
    related: ['method.random', 'term.precision'],
    source: 'SYSTELIGON.md §2.3; src/data/sampling.ts',
  },
];
