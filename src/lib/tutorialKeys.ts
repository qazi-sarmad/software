/**
 * Tutorial key registry (F18, S12).
 *
 * The single source of truth for the Appendix A tutorial keys is the JSON file beside this module,
 * so the TypeScript app, the Vite build and the Node scripts (record-tutorials, check-tutorials) all
 * read the same list without a TypeScript loader. Every setup step and configuration screen has one
 * key. `scripts/record-tutorials.mjs` records a GIF for each (bound only to the testids in
 * docs/ACP-UI-CONTRACT.md), and `scripts/check-tutorials.mjs` fails the build when a key has no GIF.
 */
import raw from './tutorialKeys.json';

export type TutorialAudience = 'super_admin' | 'org_admin' | 'both';

export interface TutorialKeyDef {
  key: string;
  audience: TutorialAudience;
  /** The Appendix A screen id (e.g. `OA-03`). */
  screenId: string;
  title: string;
}

export const TUTORIAL_KEYS: TutorialKeyDef[] = raw as TutorialKeyDef[];

export const TUTORIAL_KEY_NAMES: string[] = TUTORIAL_KEYS.map((k) => k.key);
