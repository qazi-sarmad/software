# UI/UX standard — the bar every surface is held to

Owner instruction 2026-10-30: *"the UI/UX needs to be upgraded to world class."*

This file is the **trunk's** standard. It is not the design language — that is
`docs/design/CONTRACT.md`, owned and frozen by the design branch, and it stays the single source for
colour, spacing, motion and density tokens. This file says **how a surface behaves**, so a screen is
finished rather than merely rendered. Every build stream reads it; no stream edits it. A stream that
needs a change records a request in its own `docs/build/streams/<stream>.md`.

The standard is not aspirational: each rule below is enforced somewhere, and the enforcing test is
named. A rule with no enforcement is a rule that rots.

---

## 1. The five rules a surface must satisfy

1. **Every surface states its five states.** loading, ready, empty, error, denied. A surface that
   renders "ready" and nothing else is not finished. The empty state is *designed* — it says what will
   appear and why it is empty, never "No data". The denied state names the right that is missing.
   *Enforced by:* the per-surface `*.test.tsx`, which exercises each state (`archived-role-loading`,
   `archived-role-archives-empty`, `archived-role-load-error`, `archived-role-readonly`).
2. **A refusal is never silent.** Every refused write renders an inline error carrying the database's
   own reason. Nothing is swallowed, nothing is a bare `catch {}`. The population gate (L3) and every
   guard refusal surface their named reason (`no_file_owner`, `archived_file_role_required`, …).
   *Enforced by:* the `*-error` testid asserted in the per-surface test;
   `node scripts/check-config-effect.mjs` proves a configuration row is enforced and its reader is a
   real object.
3. **Rights gate the control, and the database re-checks.** A control the caller may not use is
   rendered read-only with a note naming the right, or is absent — never enabled and then refused.
   Role *names* are never tested in a component; only rights (`hasRight`).
   *Enforced by:* `src/guards/noRoleStrings.test.ts`; the `*-readonly` testid.
4. **Keyboard-first, no blocking modal.** Every control is reachable by keyboard, focus is visible, and
   the escape route is a real control. No `window.confirm`, no `alert`, no modal that blocks the page.
   *Enforced by:* `src/guards/noBlockingModal.test.ts` and the native-dialog check in
   `src/guards/sourceGuards.test.ts`; the shared `Select` listbox (Up/Down/Home/End/Enter/Esc).
5. **The token set is the only palette.** No hard-coded colour, spacing, radius or duration. Money is
   brass; pass is verdigris; an exception is cinnabar; nothing else is chromatic.
   *Enforced by:* `node scripts/check-tokens.mjs` and the design contract §4 no-colour law.

## 2. The shape of a good surface

A surface reads **top to bottom as an answer**, not as a form:

- **A title that says what the surface decides**, and one sentence of why it matters. No restating the
  tab label.
- **The state in force, first** — the value the organisation is currently held to, with its version.
  A reader should not have to act to learn the current answer.
- **The action**, gated and explained, with the consequence written next to it ("a change is a new
  version and is written to the ledger").
- **The evidence** — the records that prove the setting is in force. A setting with no visible effect
  is a setting a reader cannot trust.
- **The refusal**, inline, where the action was taken.

## 3. Copy rules

- Sentence case for every label and heading. No Title Case, no ALL CAPS.
- The **verb first** on a button: "Set custodian role", not "Custodian role — set".
- Numbers are right-aligned and tabular (`tabular-nums`) so a column of figures scans.
- A count is written as a number, never "several" or "some".
- An empty state names the noun that will appear and the condition that fills it.
- No emoji, no exclamation mark, no marketing adjective. This is an assurance product.

## 4. The application to the file-owner workstream (owner 2026-10-30)

The two owner instructions — *no audit file can ever be in existence or archival without a file
owner*, and *for archived files add a permanently configurable role* — are surfaced under this
standard:

| Surface | Contract | States proved | Rights | Refusal proved |
|---|---|---|---|---|
| Archived-file custodian role | `OA-41` | loading, ready, empty (`archived-role-archives-empty`), error, read-only | `manage_roles` | unknown role, short reason, missing right, delete/clear refused |
| File-owner accountability | `AP-06` | loading, ready, empty (`deployment-plan-owner-audit-empty`), flag | `manage_engagements` | seal refused without an owner (`no_file_owner`) |

## 5. The design-language rows this standard reaches

The register's design rows (E8, U5, U7, U9–U13, A-U1; `F105`–`F113`) stay **DEFERRED** until the
design branch freezes `docs/design/CONTRACT.md` (its §6). This standard does not pre-empt that freeze:
it constrains *behaviour*, and the frozen contract supplies *appearance*. A build surface written to
this standard consumes the frozen tokens; when the freeze lands, no build surface changes behaviour —
only its preset values do.

**Request recorded against the frozen design contract** (recorded here, not edited there, per
`docs/design/CONTRACT.md` §6.2):

1. §5 should reserve a `data-testid` prefix for a *cross-cutting state* — a `state-` prefix for the
   loading/empty/error/denied trio — so the five-state rule can be asserted once rather than per
   surface. Until then each surface keeps its own `<screen>-loading` / `-empty` / `-error` / `-readonly`
   testids, as `OA-41` and `AP-06` do.
2. §3's token table should name the **tabular figure** token (the one `tabular-nums` reads), because
   rule 5 above cannot cite it today.
