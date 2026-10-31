/**
 * Data-layer barrel — the mount point that gathers every stream's data module in one place without
 * any stream editing a shared file (docs/build/OWNERSHIP.md §4.2).
 *
 * Each stream's data module is re-exported under its own namespace, added here once. A namespace
 * re-export keeps two modules with a colliding export name from breaking the build, and it adds no
 * new value export of its own (so the `check-wiring` gate is unaffected). A stream fills its own
 * module; it does not edit this barrel.
 *
 * Every read still goes through `src/data/client.ts`, the single client (rule M8): a stream's data
 * module imports the client or an existing data module, never the vendor SDK directly.
 */

// --- S1: the deterministic forensic engine's data (scope, rule packs, population) -----------------
export * as rulePacks from './rulePacks';
export * as population from './population';

// --- S2: assurance capabilities D5 / D7 / D8 / D9 -------------------------------------------------
export * as assurance from './assurance';

// --- S3: risk, classification and planning D10 / D14 / D15 -----------------------------------------
export * as risk from './risk';

// --- S4: platform control D11 / D12 / D13 ----------------------------------------------------------
export * as platform from './platform';
export * as entitlements from './entitlements';
export * as deployment from './deployment';

// --- S5: connector runtime C1 / C3 -----------------------------------------------------------------
export * as connectors from './connectors';

// --- S6: lifecycle configuration (R3) --------------------------------------------------------------
export * as lifecycle from './lifecycle';

// --- S7: extraction and document/minutes/policy surfaces --------------------------------------------
export * as documentReview from './documentReview';

// --- TRUNK: plan deployment and prior-year roll-forward (owner 2026-10-30) --------------------------
export * as planDeployment from './planDeployment';
export * as priorYearRollforward from './priorYearRollforward';
export * as fileOwnership from './fileOwnership';
