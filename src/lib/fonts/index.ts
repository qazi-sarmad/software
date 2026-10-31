/**
 * The self-hosted font repository (F2; docs/FONT-REPOSITORY.md).
 *
 * `catalogue.ts` is the curated, licensed set that ships in the bundle; `loader.ts` lazy-loads a
 * family only when it is picked. Together they replace the Google Fonts CDN link (F1): no external
 * request at runtime, no client IP leaked, and the product works offline.
 */
export * from './catalogue';
export * from './loader';
export * from './detect';
