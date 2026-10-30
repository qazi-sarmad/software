/**
 * S16: the product name for the Edge Function runtime, which cannot import from `src/`.
 *
 * This mirrors `src/lib/product.ts::PRODUCT_NAME`. `src/guards/productName.test.ts` asserts the two
 * are equal, so the value cannot drift between the app and the functions without a red build.
 */
export const PRODUCT_NAME = 'Provio';
