# Registers: formality, tone, voice and locale (WRITE-1, W2.2, W2.3)

A register is four axes: formality (1 to 5), tone (1 to 5), grammatical voice (active or passive) and
locale (en-GB or en-US). The full matrix is 5 x 5 x 2 x 2 = 100 cells. Every cell composes from the
same claims. The graph root is identical in all 100 cells; only the render hash changes. A tone may
change emphasis and word choice only. It may never change a fact, a figure, a claim level, a
reference, a severity or a required action, and it may never use a high-consequence word.

The definitions and examples below are the human-authored ones in `src/lib/writing/registers.ts`.
`docs/WRITE-DECISIONS.md` records the fourth axis as `D-W-VOICE`.

## Formality

| Level | Name | Definition | Example (at the default tone) |
|---|---|---|---|
| F1 | Plain and conversational | Short words and active voice. Says "we found". A reader with no audit background understands it on the first read. | We tested 40 payments. Three of them had no approval. |
| F2 | Friendly professional | Everyday professional English. Contractions are avoided, but the sentence stays short and direct. | We tested 40 payments and found that three had no approval. |
| F3 | Standard professional (default) | Complete sentences, standard audit vocabulary, no informal words. | The engagement tested 40 payments, of which three had no evidence of approval. |
| F4 | Formal | Complete sentences, constructions with no named actor, defined terms used consistently. | A sample of 40 payments was examined. In three instances, no evidence of approval was identified. |
| F5 | Board and regulatory formal | Fully formal, precise, qualified statements. Every figure is qualified by its scope and its basis. | The examination of a sample of 40 payments, drawn from the population described in the scope section, identified three instances for which evidence of approval was not available at the time of testing. |

## Tone

| Level | Name | Definition | Example |
|---|---|---|---|
| T1 | Constructive and supportive | Frames the finding as an opportunity and acknowledges the effort already made. Never softens a fact. | The control is close to working: three payments slipped past the approval step. |
| T2 | Neutral and factual (default) | States the position without evaluative words. | Three of the 40 payments tested had no evidence of approval. |
| T3 | Direct | States the gap plainly, without cushioning. | The approval control did not operate for three of the 40 payments tested. |
| T4 | Firm | Stresses the obligation and the deadline. | The approval control must be corrected for the three payments identified, by the date agreed in the action plan. |
| T5 | Urgent | Stresses time-critical exposure and the action required immediately. | Three payments bypassed approval. The gap must be closed immediately, before the next payment run. |

## Voice

| Voice | Definition | Example |
|---|---|---|
| Active | The actor is the subject: "we tested the payments". | We tested 40 payments. |
| Passive | The object is the subject: "the payments were tested". Used where the actor is unknown or immaterial. | A sample of 40 payments was tested. |

## Locale

en-GB is primary and the default. en-US is the second variant. The default is configurable per
organisation and overridable per report.

The locale packs are human-authored data (`src/lib/writing/locale.ts`). The lexicon holds 213 variant
pairs (organisation/organization, programme/program, licence/license (noun), judgement/judgment,
cheque/check, colour/color, centre/center, analyse/analyze, behaviour/behavior, favour/favor,
enrolment/enrollment, fulfil/fulfill, travelling/traveling, and so on). Date forms differ: UK
25 October 2026, US October 25, 2026. Numerals, grouping, currency symbol placement and quotation
conventions are per locale. Terminology differences (annual leave/vacation, VAT/sales tax) are
supplied only where a template needs them.

A lint fails any en-GB output containing a US-only spelling and any en-US output containing a UK-only
spelling, with a documented exception list for proper nouns and quoted client text.
