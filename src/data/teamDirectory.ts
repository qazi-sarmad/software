/**
 * Team directory data module (spec §4.2, §5, §9).
 *
 * The pure model lives in `src/lib/teamDirectory.ts`; this module is the only place the directory
 * screen talks to the database. It reads the whole directory in one call and writes a profile, the
 * travel preferences, a trip and an assignment. Private data (a picture, a home base, a blackout
 * date) is read through RLS and the `team_directory_get` function, which withholds travel from a caller
 * who does not hold `manage_team`/`manage_users` — so the data cannot leak through a read.
 *
 * With no Supabase environment every function is inert: reads return empty, a write reports that the
 * module is not configured. A component never imports the client.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import type { TeamProfile } from '../lib/teamDirectory';

/** One row of the directory as the database returns it. */
interface DirectoryRow {
  user_id: string;
  display_name: string | null;
  role_slug: string;
  role_name: string;
  avatar_url: string | null;
  capacity_hours: number | string | null;
  home_base: string | null;
  willingness: string | null;
  preferred_regions: string[] | null;
  blackout_dates: string[] | null;
  assignments: unknown;
  trips: unknown;
}

/** A raw assignment as stored (ISO dates may arrive as `YYYY-MM-DD`). */
function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function day(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

/**
 * Map a directory row to the pure model's `TeamProfile`. Travel fields are null when the caller may
 * not see them; the profile then carries an empty preference rather than a guessed one.
 */
function toProfile(row: DirectoryRow, rights: string[]): TeamProfile {
  const travelVisible = row.willingness !== null;
  return {
    userId: row.user_id,
    displayName: row.display_name ?? '',
    roleSlug: row.role_slug,
    roleName: row.role_name,
    avatarUrl: row.avatar_url,
    capacityHours: Number(row.capacity_hours ?? 0),
    assignments: asArray(row.assignments).map((a) => ({
      engagementId: String(a.engagementId ?? ''),
      engagementName: String(a.engagementName ?? ''),
      from: day(a.from),
      to: day(a.to),
      hours: Number(a.hours ?? 0),
      role: String(a.role ?? ''),
    })),
    travel: {
      homeBase: travelVisible ? (row.home_base ?? '') : '',
      willingness: travelVisible ? ((row.willingness as TeamProfile['travel']['willingness']) ?? 'limited') : 'limited',
      preferredRegions: travelVisible ? (row.preferred_regions ?? []) : [],
      blackoutDates: travelVisible ? (row.blackout_dates ?? []).map(day) : [],
    },
    trips: asArray(row.trips).map((t) => ({
      engagementId: String(t.engagementId ?? ''),
      location: String(t.location ?? ''),
      from: day(t.from),
      to: day(t.to),
      note: t.note ? String(t.note) : undefined,
    })),
    rights,
  };
}

/**
 * Read the whole directory. Every member is returned with their rights resolved by the caller (the
 * directory screen has them from the role list). With no client this returns an empty list.
 */
export async function listTeamDirectory(rightsByUser: Record<string, string[]> = {}): Promise<TeamProfile[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('team_directory_get');
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as DirectoryRow[];
  return rows.map((r) => toProfile(r, rightsByUser[r.user_id] ?? []));
}

/** Save a member's working profile (picture URL, capacity). */
export async function saveTeamProfile(
  userId: string, avatarUrl: string | null, capacityHours: number,
): Promise<DataResult> {
  return callRpc('team_profile_save', { p_user_id: userId, p_avatar_url: avatarUrl, p_capacity_hours: capacityHours });
}

/** Save a member's travel preferences. */
export async function saveTeamTravel(
  userId: string,
  travel: { homeBase: string; willingness: string; preferredRegions: string[]; blackoutDates: string[] },
): Promise<DataResult> {
  return callRpc('team_travel_save', {
    p_user_id: userId,
    p_home_base: travel.homeBase,
    p_willingness: travel.willingness,
    p_preferred_regions: travel.preferredRegions,
    p_blackout_dates: travel.blackoutDates,
  });
}

/** Add a trip to a member's travel calendar. */
export async function addTeamTrip(
  userId: string, trip: { engagementId: string | null; location: string; from: string; to: string; note?: string },
): Promise<DataResult> {
  return callRpc('team_trip_add', {
    p_user_id: userId, p_engagement_id: trip.engagementId, p_location: trip.location,
    p_from: trip.from, p_to: trip.to, p_note: trip.note ?? null,
  });
}

export async function removeTeamTrip(tripId: string): Promise<DataResult> {
  return callRpc('team_trip_remove', { p_trip_id: tripId });
}

/** Add an assignment (a commitment that counts toward a workload). */
export async function addTeamAssignment(
  userId: string,
  assignment: { engagementId: string; engagementName: string; role: string; from: string; to: string; hours: number },
): Promise<DataResult> {
  return callRpc('team_assignment_add', {
    p_user_id: userId, p_engagement_id: assignment.engagementId, p_engagement_name: assignment.engagementName,
    p_role: assignment.role, p_from: assignment.from, p_to: assignment.to, p_hours: assignment.hours,
  });
}

export async function removeTeamAssignment(assignmentId: string): Promise<DataResult> {
  return callRpc('team_assignment_remove', { p_assignment_id: assignmentId });
}

/** An engagement the directory can resource, with its travel tag. */
export interface DirectoryEngagementRow {
  id: string;
  name: string;
  location: string;
  from: string;
  to: string;
  requiresTravel: boolean;
}

/** The engagements available to resource, with the travel tag, read under RLS. */
export async function listDirectoryEngagements(): Promise<DirectoryEngagementRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('engagements')
    .select('id, title, requires_travel, travel_location, travel_from, travel_to')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: Record<string, unknown>) => ({
    id: String(e.id),
    name: String(e.title ?? ''),
    location: String(e.travel_location ?? ''),
    from: e.travel_from ? String(e.travel_from).slice(0, 10) : '',
    to: e.travel_to ? String(e.travel_to).slice(0, 10) : '',
    requiresTravel: Boolean(e.requires_travel),
  }));
}

/** Tag an engagement as requiring travel, or clear the tag. */
export async function tagEngagementTravel(
  engagementId: string, requiresTravel: boolean, location: string, from: string, to: string,
): Promise<DataResult> {
  return callRpc('engagement_travel_tag', {
    p_engagement_id: engagementId, p_requires_travel: requiresTravel,
    p_location: location || null, p_from: from || null, p_to: to || null,
  });
}

export { NOT_CONFIGURED_REASON };
