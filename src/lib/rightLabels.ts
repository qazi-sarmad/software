/**
 * Human-readable reasons for disabled controls (D14).
 *
 * A disabled button must say *why* in plain language, never leak the internal right slug
 * (`perform_work`, `review_and_approve`, …). Screens render `rightReason(right)` in the `title`
 * attribute and in inline banners. The keys are the closed right vocabulary (src/lib/rights.ts).
 */
import type { Right } from './rights';

const REASONS: Record<Right, string> = {
  perform_work: "You don't have permission to perform work on this engagement",
  review_and_approve: "You don't have permission to review and approve work",
  manage_engagements: "You don't have permission to create or manage engagements",
  approve_plan: "You don't have permission to approve plans",
  manage_users: "You don't have permission to manage users",
  can_reopen: "You don't have permission to reopen sealed work",
  view_all_scopes: "You don't have organisation-wide visibility",
  manage_roles: "You don't have permission to manage roles",
  edit_config: "You don't have permission to edit configuration",
  read_only: 'You have read-only access',
  manage_team: "You don't have permission to manage the audit team",
  view_board_pack: "You don't have permission to view the Board Pack",
  generate_board_pack: "You don't have permission to generate a Board Pack",
  use_ai_assist: "You don't have permission to use AI assist",
  view_insights: "You don't have permission to view insights",
};

/** The plain-language reason a control is disabled because the session lacks `right`. */
export function rightReason(right: Right): string {
  return REASONS[right];
}

/**
 * The same reason, guarding a value that arrives as a plain string (e.g. a `requiredRight` field
 * from an RPC result). Unknown values fall back to a generic sentence so a slug is never shown.
 */
export function rightReasonFor(right: string | null | undefined): string {
  if (right && right in REASONS) return REASONS[right as Right];
  return "You don't have permission for this action";
}
