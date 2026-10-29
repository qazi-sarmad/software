/**
 * The URL the suite drives. G1 (`E2E_PROD=1`) serves the built bundle from `vite preview` on 4173;
 * the default dev-server path is 3000. Specs that create their own browser context must pass this,
 * or a hardcoded 3000 makes a context navigate to a server that is not running under E2E_PROD.
 */
export const BASE_URL = process.env.E2E_PROD === '1' ? 'http://localhost:4173' : 'http://localhost:3000';
