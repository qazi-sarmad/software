/**
 * S16: the product and engine names, held in ONE module so a rename is one commit.
 *
 * Every user-facing string that names the product (screens, export metadata, notification subjects,
 * the HTML shell and the web manifest) reads `PRODUCT_NAME` from here, and every string that names
 * the forensics engine reads `ENGINE_NAME`. `scripts/sync-product-name.mjs` rewrites the two static
 * files (`index.html`, `metadata.json`) that a browser build cannot import, and
 * `src/guards/productName.test.ts` fails the build when a raw literal reappears anywhere else, or
 * when the static files drift from this module.
 *
 * The Edge Function runtime cannot import from `src/`, so `supabase/functions/_shared/productName.ts`
 * mirrors these values; the guard keeps the two equal, the same parity pattern
 * `supabase/functions/_shared/requiredHostingSpec.ts` uses.
 */

/** The product name. One rename edits this line and runs `npm run gen:name`. */
export const PRODUCT_NAME = 'Provio';

/** The product tagline, used in the HTML title, the OpenGraph title and the web manifest. */
export const PRODUCT_TAGLINE = 'Enterprise Internal Audit Platform';

/** The document title: `Provio - Enterprise Internal Audit Platform`. */
export const PRODUCT_TITLE = `${PRODUCT_NAME} - ${PRODUCT_TAGLINE}`;

/** The deterministic forensic rule engine's name. */
export const ENGINE_NAME = 'Systeligon';
