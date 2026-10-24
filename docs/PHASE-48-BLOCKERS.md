# Phases 4–8 — blockers

Items that may not be decided inside this build, or that are blocked by something outside this
environment. Each has the exact error or reason and the owner action. Nothing here weakens a test.

## B-5B-signoff-role-config (owner decision)

Which team role may sign off each stage (Planning, Testing, Conclusion) is configurable per
organisation and per engagement (owner clarification, 2026-10-16). The DB today gates every stage
sign-off on the `review_and_approve` right only (four-eyes enforced by CHECK). Building the
per-engagement role configuration is a product decision (which roles, default, UI) that touches
money-adjacent policy, so it is recorded and deferred rather than guessed. Recommendation: add a
`stage_sign_off_roles` jsonb on `engagements` (stage → role slug), defaulting to "any role holding
`review_and_approve`", enforced in `sign_planning` / `sign_off_workpaper` / `sign_conclusion`.
Reverse: the config only narrows signers, so leaving it absent preserves today's behaviour.

## B-6E-provider (owner decision)

Which email provider each tenant uses is pending the owner (decision D-6E). `email_settings.provider`
supports `stub`, `resend` and `graph`; the default is `stub` and no message is dispatched. Both providers
can send from a client's own domain: Graph uses a per-tenant OAuth consent flow (self-service), Resend
requires QSCorp to verify each client's domain by hand. Recommendation: offer Graph first (self-service
onboarding, no per-client manual step) and keep Resend for clients who prefer it. Reverse: nothing to
reverse; the default stays `stub` until the owner decides.

