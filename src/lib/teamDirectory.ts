/**
 * The team directory model (spec §4.2, §23, §5 — "Managers also see team workload"; §9 "Resourcing
 * view: people, time and travel by engagement").
 *
 * A deterministic model of the people side of the platform: who is on the team, how loaded each one
 * is, where each one is willing to travel, and what each one is doing on a date. It exists so the
 * directory can answer the two questions a manager actually asks — "who can take this engagement?"
 * and "when is this person free?" — with arithmetic, not a guess, and so the answer can be shown
 * beside a face on a hover card.
 *
 * Pure: no clock, no randomness, no DOM, no network. Every date is an ISO string supplied by the
 * caller and compared as a string, so the same directory always yields the same answer. This is the
 * rule engine's ethic applied to resourcing: the model proposes a name and says why, the manager
 * decides.
 */

/** How much of a person's capacity is committed. The bands are the model's own vocabulary. */
export type WorkloadBand = 'light' | 'balanced' | 'heavy' | 'overloaded';

export const WORKLOAD_BAND_LABELS: Record<WorkloadBand, string> = {
  light: 'Light',
  balanced: 'Balanced',
  heavy: 'Heavy',
  overloaded: 'Overloaded',
};

/** A single commitment: an engagement and the hours it is expected to take from this person. */
export interface TeamAssignment {
  engagementId: string;
  engagementName: string;
  /** The engagement's own dates, ISO. Used to place the commitment on the calendar. */
  from: string;
  to: string;
  /** Expected hours for this person across the engagement. */
  hours: number;
  /** The role this person plays on it. */
  role: string;
}

/** Where a person is based and how far they will go. Private data; shown only to a permitted caller. */
export interface TravelPreferences {
  /** The city or office a person works from, e.g. `Karachi`. */
  homeBase: string;
  /** How willing the person is to travel. */
  willingness: 'none' | 'limited' | 'full';
  /** Regions or cities the person will travel to. Empty means anywhere the willingness allows. */
  preferredRegions: string[];
  /** Dates the person cannot travel (leave, exams), as ISO date strings. */
  blackoutDates: string[];
}

/** One trip on the travel calendar. */
export interface TravelTrip {
  engagementId: string;
  location: string;
  /** ISO date the trip starts (inclusive) and ends (inclusive). */
  from: string;
  to: string;
  /** A note, e.g. the site or the client contact. */
  note?: string;
}

/** A person as the directory holds them. */
export interface TeamProfile {
  userId: string;
  displayName: string;
  roleSlug: string;
  roleName: string;
  /** An uploaded picture URL, or null when the person has none and a generated avatar is used. */
  avatarUrl: string | null;
  /** The person's capacity in hours over the current window; 0 means unbounded (not measured). */
  capacityHours: number;
  assignments: TeamAssignment[];
  travel: TravelPreferences;
  /** The person's travel calendar. */
  trips: TravelTrip[];
  /** Rights the person holds, so a recommendation can check the requirement. */
  rights: string[];
}

/** An engagement that requires travel, tagged as such (the owner's "audits that require travel"). */
export interface TravelEngagement {
  engagementId: string;
  name: string;
  location: string;
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------------------------

/** The initials for a name: first letters of the first and last words, upper case. */
export function avatarInitials(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** A generated avatar: deterministic colour and pattern, so a person with no picture still has a face. */
export interface GeneratedAvatar {
  initials: string;
  /** A hue 0..359 derived from the name, so the colour is stable and distinct per person. */
  hue: number;
  /** A pattern seed 0..3, so two people with the same hue still differ. */
  pattern: 0 | 1 | 2 | 3;
  /** The two colours the avatar is painted with, as `hsl(...)` strings. */
  from: string;
  to: string;
}

/**
 * Build a generated avatar from a name. A stable FNV-1a hash of the name picks the hue, saturation and
 * pattern, so the same name always gives the same face and two names rarely collide. No randomness.
 */
export function generatedAvatar(name: string): GeneratedAvatar {
  const key = (name || '?').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = h % 360;
  const pattern = (Math.floor(h / 360) % 4) as 0 | 1 | 2 | 3;
  const from = `hsl(${hue}, 52%, 46%)`;
  const to = `hsl(${(hue + 28) % 360}, 58%, 34%)`;
  return { initials: avatarInitials(name), hue, pattern, from, to };
}

// ---------------------------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------------------------

/**
 * The workload band for a committed fraction of capacity. `loadPct` is 0..∞; the bands are fixed so
 * two managers reading the same directory see the same colour.
 */
export function workloadBand(loadPct: number): WorkloadBand {
  if (loadPct < 0.5) return 'light';
  if (loadPct < 0.85) return 'balanced';
  if (loadPct <= 1) return 'heavy';
  return 'overloaded';
}

/** A person's committed hours and load. `capacityHours` 0 means unbounded, so load is 0 (not measured). */
export interface Workload {
  committedHours: number;
  capacityHours: number;
  loadPct: number;
  band: WorkloadBand;
}

/** Sum a person's assignment hours and divide by capacity. Deterministic and total. */
export function profileWorkload(profile: Pick<TeamProfile, 'assignments' | 'capacityHours'>): Workload {
  const committedHours = profile.assignments.reduce((sum, a) => sum + Math.max(0, a.hours), 0);
  const capacityHours = Math.max(0, profile.capacityHours);
  const loadPct = capacityHours === 0 ? 0 : committedHours / capacityHours;
  return { committedHours, capacityHours, loadPct, band: workloadBand(loadPct) };
}

// ---------------------------------------------------------------------------------------------
// Availability and the travel calendar
// ---------------------------------------------------------------------------------------------

export type Availability = 'available' | 'travelling' | 'on_site' | 'blackout';

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: 'Available',
  travelling: 'Travelling',
  on_site: 'On site',
  blackout: 'Unavailable',
};

/** True when `date` falls inside the inclusive ISO range [from, to]. String compare, ISO-safe. */
export function withinRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/**
 * Where a person is on a date. A blackout date outranks a trip (a person may be booked but have said
 * they cannot travel), and a trip is `on_site` when it names the location the caller asked about.
 */
export function availabilityOn(profile: Pick<TeamProfile, 'trips' | 'travel'>, date: string, location?: string): Availability {
  if (profile.travel.blackoutDates.includes(date)) return 'blackout';
  const trip = profile.trips.find((t) => withinRange(date, t.from, t.to));
  if (trip) return location && trip.location === location ? 'on_site' : 'travelling';
  return 'available';
}

/** The people free on a date, with the reason for anyone who is not. */
export function teamAvailability(
  profiles: TeamProfile[],
  date: string,
  location?: string,
): { userId: string; displayName: string; availability: Availability }[] {
  return profiles.map((p) => ({ userId: p.userId, displayName: p.displayName, availability: availabilityOn(p, date, location) }));
}

/** The engagements that require travel, as tagged. */
export function travelEngagements(engagements: TravelEngagement[]): TravelEngagement[] {
  return engagements.filter((e) => e.location.trim().length > 0);
}

/** True when a person's preferences allow them to travel to a location. */
export function willTravelTo(profile: Pick<TeamProfile, 'travel'>, location: string): boolean {
  if (profile.travel.willingness === 'none') return false;
  const regions = profile.travel.preferredRegions;
  if (regions.length === 0) return true; // any location the willingness allows
  return regions.some((r) => r.trim().toLowerCase() === location.trim().toLowerCase());
}

// ---------------------------------------------------------------------------------------------
// Assignment recommendation
// ---------------------------------------------------------------------------------------------

/** What an engagement needs of the person who takes it. */
export interface ResourcingRequirement {
  engagementId: string;
  /** The rights the person must hold. */
  rights: string[];
  /** The location, when the engagement requires travel; null when it does not. */
  travelLocation: string | null;
  /** The engagement's dates, ISO. */
  from: string;
  to: string;
}

export type RecommendationVerdict = 'recommended' | 'possible' | 'excluded';

export interface AssignmentRecommendation {
  userId: string;
  displayName: string;
  verdict: RecommendationVerdict;
  /** Why, in one line: the reason it is recommended, or the reason it is excluded. */
  reason: string;
  workload: Workload;
  /** True when the person holds every right the requirement lists. */
  rightsMet: boolean;
  /** True when the engagement needs travel and the person will travel to that location. */
  travelOk: boolean;
  /** Days in the engagement window the person is unavailable (blackout or a clashing trip). */
  conflicts: number;
}

/**
 * Recommend who should take an engagement. Deterministic and explained: every person on the team gets
 * a verdict and a reason, ranked recommended → possible → excluded, and within a verdict by ascending
 * load. The manager reads the list and decides; the model never assigns anyone itself.
 *
 * A person is `excluded` when they lack a required right, or when the engagement needs travel they
 * will not do. They are `recommended` when they also have light or balanced load and no clash;
 * otherwise `possible`.
 */
export function recommendAssignee(
  profiles: TeamProfile[],
  requirement: ResourcingRequirement,
): AssignmentRecommendation[] {
  const out: AssignmentRecommendation[] = profiles.map((p) => {
    const workload = profileWorkload(p);
    const rightsMet = requirement.rights.every((r) => p.rights.includes(r));
    const travelOk = requirement.travelLocation === null ? true : willTravelTo(p, requirement.travelLocation);
    // Count the days the person cannot work in the window: a blackout, or a trip that clashes.
    const conflicts = countConflicts(p, requirement.from, requirement.to, requirement.travelLocation);

    let verdict: RecommendationVerdict;
    let reason: string;
    if (!rightsMet) {
      const missing = requirement.rights.filter((r) => !p.rights.includes(r));
      verdict = 'excluded';
      reason = `missing right: ${missing.join(', ')}`;
    } else if (!travelOk) {
      verdict = 'excluded';
      reason = `will not travel to ${requirement.travelLocation}`;
    } else if (conflicts > 0) {
      verdict = 'possible';
      reason = `${conflicts} conflicting day(s) in the window`;
    } else if (workload.band === 'light' || workload.band === 'balanced') {
      verdict = 'recommended';
      reason = `${WORKLOAD_BAND_LABELS[workload.band].toLowerCase()} load and free in the window`;
    } else {
      verdict = 'possible';
      reason = `${WORKLOAD_BAND_LABELS[workload.band].toLowerCase()} load`;
    }
    return { userId: p.userId, displayName: p.displayName, verdict, reason, workload, rightsMet, travelOk, conflicts };
  });

  const rank: Record<RecommendationVerdict, number> = { recommended: 0, possible: 1, excluded: 2 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.workload.loadPct - b.workload.loadPct || a.displayName.localeCompare(b.displayName));
}

/** Days in [from, to] the person is unavailable: a blackout, or a trip for another engagement. */
function countConflicts(profile: TeamProfile, from: string, to: string, travelLocation: string | null): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  const dayMs = 86_400_000;
  let conflicts = 0;
  for (let t = start; t <= end; t += dayMs) {
    const day = new Date(t).toISOString().slice(0, 10);
    // A trip is a commitment to another engagement, whether or not it is to the same location, and a
    // blackout is a stated refusal; either makes the day unavailable for this one.
    if (profile.travel.blackoutDates.includes(day) || profile.trips.some((trip) => withinRange(day, trip.from, trip.to))) {
      conflicts += 1;
    }
  }
  return conflicts;
}

/** The team-wide counts, for the directory header. */
export function summariseTeam(profiles: TeamProfile[]): Record<WorkloadBand, number> {
  const counts: Record<WorkloadBand, number> = { light: 0, balanced: 0, heavy: 0, overloaded: 0 };
  for (const p of profiles) counts[profileWorkload(p).band] += 1;
  return counts;
}

/**
 * The fields of a profile the caller may see. Access-based: a person always sees their own travel and
 * contact detail; a caller with `manage_team` sees everyone's; anyone else sees the working profile
 * without the private travel preferences. The model never returns a field it has not been cleared for.
 */
export function visibleProfileFields(
  profile: TeamProfile,
  viewerId: string,
  viewerRights: string[],
): { travelVisible: boolean; avatarVisible: boolean } {
  const isSelf = profile.userId === viewerId;
  const mayManage = viewerRights.includes('manage_team') || viewerRights.includes('manage_users');
  return { travelVisible: isSelf || mayManage, avatarVisible: true };
}
