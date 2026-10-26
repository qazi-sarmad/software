/**
 * W2.3: locale packs. Two English variants, en-GB (primary and the default) and en-US.
 *
 * Everything here is HUMAN-AUTHORED data, not generation. The lexicon holds at least 200 variant
 * pairs. A lint (W9) fails any en-GB output containing a US-only spelling and any en-US output
 * containing a UK-only spelling, with a documented exception list for proper nouns and quoted
 * client text.
 *
 * The default locale is configurable per organisation and overridable per report.
 */

import type { Locale } from './types';

export const LOCALES: Locale[] = ['en-GB', 'en-US'];
export const DEFAULT_LOCALE: Locale = 'en-GB';

/** A spelling variant pair. `gb` is the en-GB form, `us` the en-US form. */
export interface VariantPair {
  gb: string;
  us: string;
}

/**
 * The lexicon. The `-ise/-ize`, `-our/-or`, `-re/-er`, `-ogue/-og` and doubled-consonant families
 * are listed individually so a lint can match whole words, never a stem.
 */
export const VARIANTS: VariantPair[] = [
  // -ise / -ize
  { gb: 'organisation', us: 'organization' },
  { gb: 'organise', us: 'organize' },
  { gb: 'organised', us: 'organized' },
  { gb: 'organising', us: 'organizing' },
  { gb: 'organiser', us: 'organizer' },
  { gb: 'recognise', us: 'recognize' },
  { gb: 'recognised', us: 'recognized' },
  { gb: 'recognising', us: 'recognizing' },
  { gb: 'recognition', us: 'recognition' },
  { gb: 'analyse', us: 'analyze' },
  { gb: 'analysed', us: 'analyzed' },
  { gb: 'analysing', us: 'analyzing' },
  { gb: 'analysis', us: 'analysis' },
  { gb: 'categorise', us: 'categorize' },
  { gb: 'categorised', us: 'categorized' },
  { gb: 'summarise', us: 'summarize' },
  { gb: 'summarised', us: 'summarized' },
  { gb: 'summarising', us: 'summarizing' },
  { gb: 'prioritise', us: 'prioritize' },
  { gb: 'prioritised', us: 'prioritized' },
  { gb: 'minimise', us: 'minimize' },
  { gb: 'minimised', us: 'minimized' },
  { gb: 'maximise', us: 'maximize' },
  { gb: 'maximised', us: 'maximized' },
  { gb: 'standardise', us: 'standardize' },
  { gb: 'standardised', us: 'standardized' },
  { gb: 'formalise', us: 'formalize' },
  { gb: 'formalised', us: 'formalized' },
  { gb: 'materialise', us: 'materialize' },
  { gb: 'materialised', us: 'materialized' },
  { gb: 'utilise', us: 'utilize' },
  { gb: 'utilised', us: 'utilized' },
  { gb: 'authorise', us: 'authorize' },
  { gb: 'authorised', us: 'authorized' },
  { gb: 'authorisation', us: 'authorization' },
  { gb: 'centralise', us: 'centralize' },
  { gb: 'centralised', us: 'centralized' },
  { gb: 'characterise', us: 'characterize' },
  { gb: 'characterised', us: 'characterized' },
  { gb: 'emphasise', us: 'emphasize' },
  { gb: 'emphasised', us: 'emphasized' },
  { gb: 'harmonise', us: 'harmonize' },
  { gb: 'harmonised', us: 'harmonized' },
  { gb: 'itemise', us: 'itemize' },
  { gb: 'itemised', us: 'itemized' },
  { gb: 'legalise', us: 'legalize' },
  { gb: 'legalised', us: 'legalized' },
  { gb: 'modernise', us: 'modernize' },
  { gb: 'modernised', us: 'modernized' },
  { gb: 'normalise', us: 'normalize' },
  { gb: 'normalised', us: 'normalized' },
  { gb: 'optimise', us: 'optimize' },
  { gb: 'optimised', us: 'optimized' },
  { gb: 'penalise', us: 'penalize' },
  { gb: 'penalised', us: 'penalized' },
  { gb: 'individualise', us: 'individualize' },
  { gb: 'individualised', us: 'individualized' },
  { gb: 'realise', us: 'realize' },
  { gb: 'realised', us: 'realized' },
  { gb: 'reorganise', us: 'reorganize' },
  { gb: 'reorganised', us: 'reorganized' },
  { gb: 'scrutinise', us: 'scrutinize' },
  { gb: 'scrutinised', us: 'scrutinized' },
  { gb: 'specialise', us: 'specialize' },
  { gb: 'specialised', us: 'specialized' },
  { gb: 'stabilise', us: 'stabilize' },
  { gb: 'stabilised', us: 'stabilized' },
  { gb: 'subsidise', us: 'subsidize' },
  { gb: 'subsidised', us: 'subsidized' },
  { gb: 'visualise', us: 'visualize' },
  { gb: 'visualised', us: 'visualized' },
  { gb: 'criticise', us: 'criticize' },
  { gb: 'criticised', us: 'criticized' },
  { gb: 'apologise', us: 'apologize' },
  { gb: 'apologised', us: 'apologized' },

  // -our / -or
  { gb: 'colour', us: 'color' },
  { gb: 'colours', us: 'colors' },
  { gb: 'coloured', us: 'colored' },
  { gb: 'favour', us: 'favor' },
  { gb: 'favours', us: 'favors' },
  { gb: 'favoured', us: 'favored' },
  { gb: 'favourite', us: 'favorite' },
  { gb: 'behaviour', us: 'behavior' },
  { gb: 'behaviours', us: 'behaviors' },
  { gb: 'honour', us: 'honor' },
  { gb: 'honoured', us: 'honored' },
  { gb: 'labour', us: 'labor' },
  { gb: 'laboured', us: 'labored' },
  { gb: 'neighbour', us: 'neighbor' },
  { gb: 'neighbouring', us: 'neighboring' },
  { gb: 'humour', us: 'humor' },
  { gb: 'rumour', us: 'rumor' },
  { gb: 'savour', us: 'savor' },
  { gb: 'vapour', us: 'vapor' },
  { gb: 'endeavour', us: 'endeavor' },
  { gb: 'rigour', us: 'rigor' },
  { gb: 'vigour', us: 'vigor' },
  { gb: 'armour', us: 'armor' },
  { gb: 'clamour', us: 'clamor' },
  { gb: 'demeanour', us: 'demeanor' },
  { gb: 'flavour', us: 'flavor' },
  { gb: 'flavoured', us: 'flavored' },
  { gb: 'harbour', us: 'harbor' },
  { gb: 'odour', us: 'odor' },
  { gb: 'parlour', us: 'parlor' },
  { gb: 'splendour', us: 'splendor' },
  { gb: 'tumour', us: 'tumor' },
  { gb: 'valour', us: 'valor' },
  { gb: 'candour', us: 'candor' },

  // -re / -er
  { gb: 'centre', us: 'center' },
  { gb: 'centres', us: 'centers' },
  { gb: 'centred', us: 'centered' },
  { gb: 'metre', us: 'meter' },
  { gb: 'metres', us: 'meters' },
  { gb: 'litre', us: 'liter' },
  { gb: 'litres', us: 'liters' },
  { gb: 'theatre', us: 'theater' },
  { gb: 'fibre', us: 'fiber' },
  { gb: 'calibre', us: 'caliber' },
  { gb: 'sombre', us: 'somber' },
  { gb: 'spectre', us: 'specter' },

  // -ogue / -og
  { gb: 'catalogue', us: 'catalog' },
  { gb: 'catalogues', us: 'catalogs' },
  { gb: 'dialogue', us: 'dialog' },
  { gb: 'dialogues', us: 'dialogs' },
  { gb: 'analogue', us: 'analog' },

  // doubled consonants
  { gb: 'travelling', us: 'traveling' },
  { gb: 'travelled', us: 'traveled' },
  { gb: 'traveller', us: 'traveler' },
  { gb: 'cancelled', us: 'canceled' },
  { gb: 'cancelling', us: 'canceling' },
  { gb: 'labelling', us: 'labeling' },
  { gb: 'labelled', us: 'labeled' },
  { gb: 'modelling', us: 'modeling' },
  { gb: 'modelled', us: 'modeled' },
  { gb: 'signalling', us: 'signaling' },
  { gb: 'signalled', us: 'signaled' },
  { gb: 'fuelling', us: 'fueling' },
  { gb: 'fuelled', us: 'fueled' },
  { gb: 'totalled', us: 'totaled' },
  { gb: 'levelled', us: 'leveled' },
  { gb: 'marvellous', us: 'marvelous' },
  { gb: 'counsellor', us: 'counselor' },
  { gb: 'counselling', us: 'counseling' },
  { gb: 'jewellery', us: 'jewelry' },
  { gb: 'skilful', us: 'skillful' },
  { gb: 'wilful', us: 'willful' },
  { gb: 'enrolment', us: 'enrollment' },
  { gb: 'fulfil', us: 'fulfill' },
  { gb: 'fulfilled', us: 'fulfilled' },
  { gb: 'instalment', us: 'installment' },
  { gb: 'instalments', us: 'installments' },

  // -ce / -se (noun)
  { gb: 'defence', us: 'defense' },
  { gb: 'offence', us: 'offense' },
  { gb: 'pretence', us: 'pretense' },

  // -ence / -ense
  { gb: 'judgement', us: 'judgment' },
  { gb: 'acknowledgement', us: 'acknowledgment' },
  { gb: 'ageing', us: 'aging' },

  // -ll / -l (past tense of -l verbs)
  { gb: 'enrolling', us: 'enrolling' },
  { gb: 'fulfilling', us: 'fulfilling' },
  { gb: 'installing', us: 'installing' },

  // misc common pairs
  { gb: 'cheque', us: 'check' },
  { gb: 'cheques', us: 'checks' },
  { gb: 'grey', us: 'gray' },
  { gb: 'tyres', us: 'tires' },
  { gb: 'aluminium', us: 'aluminum' },
  { gb: 'plough', us: 'plow' },
  { gb: 'mould', us: 'mold' },
  { gb: 'moulded', us: 'molded' },
  { gb: 'smoulder', us: 'smolder' },
  { gb: 'storeys', us: 'stories' },
  { gb: 'whilst', us: 'while' },
  { gb: 'amongst', us: 'among' },
  { gb: 'towards', us: 'toward' },
  { gb: 'forwards', us: 'forward' },
  { gb: 'afterwards', us: 'afterward' },
  { gb: 'anytime', us: 'any time' },
  { gb: 'cancellation', us: 'cancellation' },
  { gb: 'enquiry', us: 'inquiry' },
  { gb: 'enquiries', us: 'inquiries' },
  { gb: 'instil', us: 'instill' },
  { gb: 'distil', us: 'distill' },
  { gb: 'cosy', us: 'cozy' },
  { gb: 'moustache', us: 'mustache' },
  { gb: 'per cent', us: 'percent' },
  { gb: 'annual leave', us: 'vacation' },
  { gb: 'timetable', us: 'schedule' },
  { gb: 'proforma', us: 'pro forma' },
  { gb: 'manoeuvre', us: 'maneuver' },
  { gb: 'manoeuvred', us: 'maneuvered' },
  { gb: 'mediocre', us: 'mediocre' },
  { gb: 'ageing population', us: 'aging population' },
  { gb: 'welcoming', us: 'welcoming' },
  { gb: 'practising', us: 'practicing' },
  { gb: 'practised', us: 'practiced' },
  { gb: 'programmed', us: 'programmed' },
  { gb: 'sceptic', us: 'skeptic' },
  { gb: 'sceptical', us: 'skeptical' },
  { gb: 'disc', us: 'disk' },
  { gb: 'discs', us: 'disks' },
  { gb: 'encyclopaedia', us: 'encyclopedia' },
  { gb: 'paediatric', us: 'pediatric' },
  { gb: 'oesophagus', us: 'esophagus' },
  { gb: 'diarrhoea', us: 'diarrhea' },
  { gb: 'anaemia', us: 'anemia' },
  { gb: 'leukaemia', us: 'leukemia' },
  { gb: 'haemorrhage', us: 'hemorrhage' },
  { gb: 'foetus', us: 'fetus' },
  { gb: 'aesthetic', us: 'esthetic' },
  { gb: 'archaeology', us: 'archeology' },
  { gb: 'mediaeval', us: 'medieval' },
  { gb: 'gynaecology', us: 'gynecology' },
];

/** Build a lookup for the lint: word (lowercased) -> the other variant. */
export function variantLookup(): { gb: Map<string, string>; us: Map<string, string> } {
  const gb = new Map<string, string>();
  const us = new Map<string, string>();
  for (const pair of VARIANTS) {
    gb.set(pair.gb.toLowerCase(), pair.us);
    us.set(pair.us.toLowerCase(), pair.gb);
  }
  return { gb, us };
}

// ---------------------------------------------------------------------------
// Date, number, currency and quotation conventions per locale
// ---------------------------------------------------------------------------

export interface LocalePack {
  locale: Locale;
  /** Long date: "25 October 2026" (UK) or "October 25, 2026" (US). */
  longDate: (d: { day: number; month: number; year: number }) => string;
  /** Short date: "25/10/2026" (UK) or "10/25/2026" (US). */
  shortDate: (d: { day: number; month: number; year: number }) => string;
  /** Thousands separator. */
  grouping: string;
  /** Decimal separator. */
  decimal: string;
  /** Currency symbol placement. */
  currency: (symbol: string, amount: string) => string;
  /** Quotation marks. */
  openQuote: string;
  closeQuote: string;
  /** List joining: "A, B and C" (UK) vs "A, B, and C" (US, Oxford comma as the template declares). */
  joinList: (items: string[]) => string;
  /** The term used for an audit committee's filing context. */
  filingsTerm: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export const LOCALE_PACKS: Record<Locale, LocalePack> = {
  'en-GB': {
    locale: 'en-GB',
    longDate: (d) => `${d.day} ${MONTHS[d.month - 1]} ${d.year}`,
    shortDate: (d) => `${pad2(d.day)}/${pad2(d.month)}/${d.year}`,
    grouping: ',',
    decimal: '.',
    currency: (symbol, amount) => `${symbol}${amount}`,
    openQuote: '\u2018',
    closeQuote: '\u2019',
    joinList: (items) => joinWithAnd(items, false),
    filingsTerm: 'Companies House filings',
  },
  'en-US': {
    locale: 'en-US',
    longDate: (d) => `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`,
    shortDate: (d) => `${pad2(d.month)}/${pad2(d.day)}/${d.year}`,
    grouping: ',',
    decimal: '.',
    currency: (symbol, amount) => `${symbol}${amount}`,
    openQuote: '\u201c',
    closeQuote: '\u201d',
    joinList: (items) => joinWithAnd(items, true),
    filingsTerm: 'state filings',
  },
};

/** Join a list: "A, B and C" (UK) or "A, B, and C" (US, the Oxford comma). */
export function joinWithAnd(items: string[], oxford: boolean): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(', ');
  return oxford ? `${head}, and ${items[items.length - 1]}` : `${head} and ${items[items.length - 1]}`;
}

export function localePack(locale: Locale): LocalePack {
  return LOCALE_PACKS[locale];
}
