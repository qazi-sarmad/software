-- 0046: enable row level security on team_role_rights (D2).
--
-- The table holds the global team-role -> rights mapping (lead/preparer/reviewer/observer). It has
-- no org_id: it is reference data shared by every tenant, so an org-scoped policy cannot express
-- the rule. It is read only from SECURITY DEFINER functions (assign_team_role in 0016, and the
-- rights helpers), which run as the owner and are not subject to RLS.
--
-- Until now the table relied on the hosted project's "auto-enable RLS for new tables" event
-- trigger. A bare Postgres has no such trigger, so the table was readable by every authenticated
-- role there. This migration makes the rule explicit and environment-independent.
--
-- Idempotent: safe to apply on top of its own prior result (M6).
alter table public.team_role_rights enable row level security;

-- No policies. No INSERT/UPDATE/DELETE policy either: the four seed rows are written by this
-- migration as the owner, and nothing in the application writes this table. Direct reads by
-- authenticated/anon return zero rows. Verified by supabase/tests/59_team_role_rights_blind.sql.
