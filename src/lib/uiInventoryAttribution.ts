/**
 * UI-inventory attribution (E10; docs/EXPLAIN-LAYER.md §6).
 *
 * The inventory tells a designer which explain ids a screen carries. The first cut inferred that by
 * substring-matching a screen's contract testids across all of `src/`, which is wrong in both
 * directions: OA-10's testid list contains bare field names (`organisation`, `engagement_id`) that
 * appear in dozens of files, so OA-10 was credited with the whole catalogue, while DB-01 — which
 * mounts `StandardsAffordance` — was credited with nothing.
 *
 * The correct source is the AUTHORED attribution: every explain surface already names the screen it
 * belongs to (`screenId="DB-01"`). This module reads those mounts and attributes each explain id to
 * the screen that declares it. It is pure: given the source texts, it returns the same map every
 * time, so the generator and the guard read one implementation and cannot disagree.
 */
import { EXPLAIN_ENTRIES } from './explain/catalogue';
import {
  standardsForReportSection,
  standardsForScreen,
  standardsForStep,
  LIFECYCLE_STEP_STANDARDS,
  REPORT_SECTION_STANDARDS,
} from './explain/standardsSurfaces';

const EXPLAIN_IDS = new Set(EXPLAIN_ENTRIES.map((e) => e.id));

/** The sentinel recorded when an explain mount is a bare expression we cannot resolve to literals. */
export const DYNAMIC_EXPLAIN = '*';

/** Return the index just past the `>` that closes the tag starting at `start` (`<`). */
function findTagEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    } else if (ch === '>' && depth === 0) {
      return i + 1;
    }
  }
  return text.length;
}

/** Every opening tag of `name` in the file, as its raw attribute text. */
function tagsOf(text: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = findTagEnd(text, start);
    out.push(text.slice(start, end));
    re.lastIndex = end;
  }
  return out;
}

/** The raw value of an attribute in a tag: `"x"`, `{expr}` or `\`tmpl\``, or null when absent. */
function attrRaw(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}=`);
  const m = re.exec(tag);
  if (!m) return null;
  let i = m.index + m[0].length;
  const first = tag[i];
  if (first === '"' || first === "'") {
    const close = tag.indexOf(first, i + 1);
    return tag.slice(i + 1, close === -1 ? tag.length : close);
  }
  if (first === '`') {
    const close = tag.indexOf('`', i + 1);
    return tag.slice(i, close === -1 ? tag.length : close + 1);
  }
  if (first === '{') {
    let depth = 0;
    let quote: string | null = null;
    for (let j = i; j < tag.length; j++) {
      const ch = tag[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return tag.slice(i + 1, j);
      }
    }
  }
  return null;
}

/** Resolve an `explainId` attribute value to the catalogue ids it can name. */
function explainIdsFromValue(raw: string | null): string[] {
  if (raw === null) return [];
  const found = new Set<string>();
  // A plain string attribute (`explainId="term.invite"`) is the value itself.
  if (EXPLAIN_IDS.has(raw.trim())) found.add(raw.trim());
  // A template-literal family: the id-ish run ending in `.` immediately before a `${` is a prefix.
  for (const m of raw.matchAll(/([a-z][a-z0-9_.]*)\.\$\{/g)) {
    const prefix = m[1] + '.';
    for (const id of EXPLAIN_IDS) if (id.startsWith(prefix)) found.add(id);
  }
  // A JSX expression holding string literals (a plain value or a ternary arm).
  for (const m of raw.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const lit = m[1] ?? m[2];
    if (EXPLAIN_IDS.has(lit)) found.add(lit);
  }
  // A static template literal that names the id verbatim (`` `term.invite` ``).
  for (const m of raw.matchAll(/`([^`$]*)`/g)) {
    if (EXPLAIN_IDS.has(m[1])) found.add(m[1]);
  }
  if (found.size === 0) {
    // A bare expression we cannot resolve (e.g. `explainId={explainId}`): the mount can reach any
    // entry. Record the sentinel rather than guessing a list.
    return [DYNAMIC_EXPLAIN];
  }
  return [...found];
}

/** The standards a `StandardsAffordance` resolves to, honouring a dynamic target honestly. */
function standardsForAffordance(kind: string | null, target: string | null): string[] {
  if (kind === 'step') {
    const steps = target ? [target] : LIFECYCLE_STEP_STANDARDS.map((s) => s.step);
    return steps.flatMap((s) => standardsForStep(s).map((x) => x.id));
  }
  if (kind === 'section') {
    const sections = target ? [target] : REPORT_SECTION_STANDARDS.map((s) => s.section);
    return sections.flatMap((s) => standardsForReportSection(s).map((x) => x.id));
  }
  // `screen` (the default) or an unknown kind: resolve against the target screen id.
  return target ? standardsForScreen(target).map((s) => s.id) : [];
}

/**
 * Attribute explain ids to screens from the authored mounts. `files` is a map of path → text; the
 * path is only used to skip test files, so the caller may pass any stable key.
 */
export function explainMounts(files: Record<string, string>): Map<string, Set<string>> {
  const byScreen = new Map<string, Set<string>>();
  const add = (screenId: string, ids: string[]) => {
    if (!screenId) return;
    const set = byScreen.get(screenId) ?? new Set<string>();
    for (const id of ids) set.add(id);
    byScreen.set(screenId, set);
  };

  for (const [path, text] of Object.entries(files)) {
    if (/\.test\./.test(path)) continue;
    for (const tag of tagsOf(text, 'ExplainPopout')) {
      add(attrRaw(tag, 'screenId') ?? '', explainIdsFromValue(attrRaw(tag, 'explainId')));
    }
    for (const tag of tagsOf(text, 'ExplainDetail')) {
      add(attrRaw(tag, 'screenId') ?? '', explainIdsFromValue(attrRaw(tag, 'explainId')));
    }
    for (const tag of tagsOf(text, 'StandardsAffordance')) {
      const screenId = attrRaw(tag, 'screenId') ?? '';
      const standards = standardsForAffordance(attrRaw(tag, 'kind'), attrRaw(tag, 'target'));
      add(screenId, standards.map((n) => `standard.${n}`));
    }
  }
  return byScreen;
}

/** The sorted explain ids attributed to a screen (empty when it mounts no explain surface). */
export function explainIdsForScreen(mounts: Map<string, Set<string>>, screenId: string): string[] {
  return [...(mounts.get(screenId) ?? [])].sort();
}
