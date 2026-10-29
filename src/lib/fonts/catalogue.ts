/**
 * The self-hosted font repository (F2, F3; docs/FONT-REPOSITORY.md).
 *
 * Every family here ships in the bundle as an `@fontsource` package. Nothing in this catalogue is
 * fetched from a third party at runtime: the app makes no request to any external font host, so no
 * client's IP leaks and the product works offline and inside the tenant boundary (F1).
 *
 * The catalogue is deliberately CURATED, not exhaustive (F3). Google Fonts alone is ~1,900 families;
 * bundling them is impossible and useless. This is a small set across serif, sans, mono and an
 * accessibility face, each with the exact weights the product uses for the latin subset only.
 *
 * Licensing is a first-class field, not an afterthought (docs/FONT-REPOSITORY.md §4). Every entry
 * carries its licence id, the licence text's home, the required attribution, and a `redistributable`
 * flag. The gate G10 (F7) fails the build if a bundled font is missing this metadata or is marked
 * non-redistributable. This module is pure: a static table and pure lookups, no clock, no client.
 */

/** The licence terms a bundled font carries. Only redistributable licences may be bundled. */
export interface FontLicence {
  /** The SPDX-style id: `OFL-1.1`, `Apache-2.0`, … */
  id: string;
  /** The licence's plain name. */
  name: string;
  /** Where the licence text lives. */
  url: string;
  /** The attribution the licence requires to travel with the font. */
  attribution: string;
  /** Whether this product may bundle and redistribute the font. A non-redistributable font may not
   *  be shipped; the gate fails on one, and the upload path says so in the UI. */
  redistributable: boolean;
}

/** One family in the bundled repository. */
export interface FontFamilyEntry {
  /** The CSS family name and the value stored in a format's layout. */
  family: string;
  /** The `@fontsource` package slug; the file names derive from it. */
  slug: string;
  category: 'sans' | 'serif' | 'mono';
  licence: FontLicence;
  /** The subsets shipped for this family. This product ships the latin subset only. */
  subsets: string[];
  /** The weights bundled for the latin subset — exactly what the product loads. */
  weights: number[];
  /** The upstream project the package mirrors. */
  source: string;
  /** Whether the family is loaded by the app shell on every page (the chrome fonts). */
  alwaysOn: boolean;
  /** Whether the family may be embedded in a rendered PDF. */
  reportEmbeddable: boolean;
}

/** The licences the bundled families carry. Both permit bundling and redistribution. */
const OFL: Omit<FontLicence, 'attribution'> = {
  id: 'OFL-1.1',
  name: 'SIL Open Font License 1.1',
  url: 'https://openfontlicense.org',
  redistributable: true,
};
const APACHE: Omit<FontLicence, 'attribution'> = {
  id: 'Apache-2.0',
  name: 'Apache License 2.0',
  url: 'https://www.apache.org/licenses/LICENSE-2.0',
  redistributable: true,
};

/** The curated repository. Twelve families; the three chrome families are always loaded. */
export const FONT_CATALOGUE: FontFamilyEntry[] = [
  {
    family: 'Inter', slug: 'inter', category: 'sans',
    licence: { ...OFL, attribution: 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)' },
    subsets: ['latin'], weights: [400, 500, 600, 700], source: 'https://github.com/rsms/inter',
    alwaysOn: true, reportEmbeddable: true,
  },
  {
    family: 'Source Serif 4', slug: 'source-serif-4', category: 'serif',
    licence: { ...OFL, attribution: 'Google Inc. (Source Serif 4)' },
    subsets: ['latin'], weights: [400, 600], source: 'https://github.com/adobe-fonts/source-serif',
    alwaysOn: true, reportEmbeddable: true,
  },
  {
    family: 'JetBrains Mono', slug: 'jetbrains-mono', category: 'mono',
    licence: { ...OFL, attribution: 'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)' },
    subsets: ['latin'], weights: [400, 500, 600], source: 'https://github.com/JetBrains/JetBrainsMono',
    alwaysOn: true, reportEmbeddable: true,
  },
  {
    family: 'IBM Plex Sans', slug: 'ibm-plex-sans', category: 'sans',
    licence: { ...OFL, attribution: 'Copyright 2019 IBM Corp. All rights reserved.' },
    subsets: ['latin'], weights: [400, 600], source: 'https://github.com/IBM/plex',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'IBM Plex Mono', slug: 'ibm-plex-mono', category: 'mono',
    licence: { ...OFL, attribution: 'Copyright 2017 IBM Corp. All rights reserved.' },
    subsets: ['latin'], weights: [400, 600], source: 'https://github.com/IBM/plex',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Open Sans', slug: 'open-sans', category: 'sans',
    licence: { ...OFL, attribution: 'Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)' },
    subsets: ['latin'], weights: [400, 600], source: 'https://github.com/googlefonts/opensans',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Atkinson Hyperlegible', slug: 'atkinson-hyperlegible', category: 'sans',
    licence: { ...OFL, attribution: 'Copyright 2020 Braille Institute of America, Inc.' },
    subsets: ['latin'], weights: [400, 700], source: 'https://github.com/googlefonts/atkinson-hyperlegible',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Lora', slug: 'lora', category: 'serif',
    licence: { ...OFL, attribution: 'Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic)' },
    subsets: ['latin'], weights: [400, 600], source: 'https://github.com/cyrealtype/Lora-Cyrillic',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Merriweather', slug: 'merriweather', category: 'serif',
    licence: { ...OFL, attribution: 'Copyright 2024 The Merriweather Project Authors (https://github.com/EbenSorkin/Merriweather4)' },
    subsets: ['latin'], weights: [400, 700], source: 'https://github.com/EbenSorkin/Merriweather4',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Libre Baskerville', slug: 'libre-baskerville', category: 'serif',
    licence: { ...OFL, attribution: 'Copyright 2012 The Libre Baskerville Project Authors (https://github.com/impallari/Libre-Baskerville)' },
    subsets: ['latin'], weights: [400], source: 'https://github.com/impallari/Libre-Baskerville',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Playfair Display', slug: 'playfair-display', category: 'serif',
    licence: { ...OFL, attribution: 'Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display)' },
    subsets: ['latin'], weights: [400, 700], source: 'https://github.com/clauseggers/Playfair-Display',
    alwaysOn: false, reportEmbeddable: true,
  },
  {
    family: 'Roboto Slab', slug: 'roboto-slab', category: 'serif',
    licence: { ...APACHE, attribution: 'Copyright 2018 The Roboto Slab Project Authors (https://github.com/googlefonts/robotoslab)' },
    subsets: ['latin'], weights: [400, 700], source: 'https://github.com/googlefonts/robotoslab',
    alwaysOn: false, reportEmbeddable: true,
  },
];

const BY_SLUG = new Map(FONT_CATALOGUE.map((f) => [f.slug, f]));
const BY_FAMILY = new Map(FONT_CATALOGUE.map((f) => [f.family, f]));

export function fontBySlug(slug: string): FontFamilyEntry | undefined {
  return BY_SLUG.get(slug);
}

export function fontByFamily(family: string): FontFamilyEntry | undefined {
  return BY_FAMILY.get(family);
}

/** Every family name, in catalogue order, for a picker. */
export function fontFamilyNames(): string[] {
  return FONT_CATALOGUE.map((f) => f.family);
}

/** The families loaded by the app shell on every page (the three chrome faces). */
export function alwaysOnFonts(): FontFamilyEntry[] {
  return FONT_CATALOGUE.filter((f) => f.alwaysOn);
}

/** The families lazy-loaded only when a user picks them. */
export function lazyFonts(): FontFamilyEntry[] {
  return FONT_CATALOGUE.filter((f) => !f.alwaysOn);
}

/** Whether a family may be embedded in a rendered PDF. */
export function isReportFont(family: string): boolean {
  return fontByFamily(family)?.reportEmbeddable === true;
}

/**
 * The plain-language licence obligations for a family, in our own words — shown in the UI when a
 * font is chosen or uploaded. Never the licence's own wording, and never an implied permission.
 */
export function licenceSummary(entry: FontFamilyEntry): string {
  const l = entry.licence;
  return l.redistributable
    ? `${l.name}. This font may be bundled and redistributed; the licence text travels with it and the reserved name is not reused.`
    : `${l.name}. This font may NOT be redistributed; do not bundle it.`;
}
