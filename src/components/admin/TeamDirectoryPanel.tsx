import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  generatedAvatar, profileWorkload, recommendAssignee, summariseTeam,
  WORKLOAD_BAND_LABELS,
  type TeamProfile, type ResourcingRequirement, type WorkloadBand,
} from '../../lib/teamDirectory';
import { listRoles, type RoleRow } from '../../data/admin';
import {
  addTeamAssignment, addTeamTrip, listDirectoryEngagements, listTeamDirectory, removeTeamAssignment,
  removeTeamTrip, saveTeamProfile, saveTeamTravel, tagEngagementTravel,
} from '../../data/teamDirectory';
import { Select } from '../common/Select';
import { Calendar, Clock, Plus, Upload, User, Users, X } from '../common/Icons';

/**
 * The team directory (spec §4.2, §5, §9). A glass grid of every team member; hovering a face shows
 * their workload, their home base and where they are on a date. Selecting a face opens the working
 * profile, the travel preferences, the travel calendar and the assignments — all writes go through the
 * data module and the RPCs, all reads are access-filtered. A resourcing panel ranks who should take an
 * engagement and says why, deterministically.
 */

export interface DirectoryEngagement {
  id: string;
  name: string;
  /** The location, when the engagement requires travel; empty when it does not. */
  location: string;
  from: string;
  to: string;
  /** The rights a person needs to take it. */
  rights: string[];
}

export interface TeamDirectoryPanelProps {
  prefix?: string;
  /** The engagements a manager may resource; read from the database when omitted. */
  engagements?: DirectoryEngagement[];
  /** The caller, when not taken from context. */
  currentUserId?: string;
}

const BAND_COLOUR: Record<WorkloadBand, string> = {
  light: 'text-verdigris',
  balanced: 'text-verdigris',
  heavy: 'text-brass',
  overloaded: 'text-cinnabar',
};

function Avatar({ profile, size = 40 }: { profile: TeamProfile; size?: number }) {
  if (profile.avatarUrl) {
    return <img src={profile.avatarUrl} alt={profile.displayName} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const a = generatedAvatar(profile.displayName);
  return (
    <span
      aria-hidden
      className="rounded-full flex items-center justify-center text-white font-medium"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${a.from}, ${a.to})`, fontSize: size * 0.36 }}
      data-testid={`team-avatar-generated-${profile.userId}`}
    >
      {a.initials}
    </span>
  );
}

export const TeamDirectoryPanel: React.FC<TeamDirectoryPanelProps> = ({
  prefix = 'team', engagements: engagementsProp, currentUserId,
}) => {
  const { currentUser } = useApp();
  const me = currentUserId ?? currentUser?.id ?? '';
  const mayManage = hasRight(currentUser, 'manage_team') || hasRight(currentUser, 'manage_users');

  const [profiles, setProfiles] = useState<TeamProfile[]>([]);
  const [dbEngagements, setDbEngagements] = useState<DirectoryEngagement[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // The resourcing form.
  const [reqEngagement, setReqEngagement] = useState('');
  const [reqTravel, setReqTravel] = useState(false);

  const engagements = engagementsProp ?? dbEngagements;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await listRoles();
      setRoles(r);
      const rightsByUser: Record<string, string[]> = {};
      // Rights come from the role: a member's role slug maps to the role's rights.
      const bySlug = new Map(r.map((role) => [role.slug, Object.keys(role.rights ?? {}).filter((k) => role.rights[k as keyof typeof role.rights])]));
      // The directory read needs rights per user, which we resolve after the first read returns the
      // members. Read once with empty rights, then re-read with the resolved map.
      const first = await listTeamDirectory({});
      for (const p of first) rightsByUser[p.userId] = bySlug.get(p.roleSlug) ?? [];
      const full = await listTeamDirectory(rightsByUser);
      setProfiles(full);
      if (!engagementsProp) {
        const rows = await listDirectoryEngagements();
        setDbEngagements(rows.map((e) => ({ id: e.id, name: e.name, location: e.location, from: e.from, to: e.to, rights: ['perform_work'] })));
      }
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the team directory.');
      setState('error');
    }
  }, [engagementsProp]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summariseTeam(profiles), [profiles]);
  const selectedProfile = profiles.find((p) => p.userId === selected) ?? null;

  const canEdit = (userId: string) => mayManage || userId === me;

  const apply = async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    setNotice('');
    const r = await fn();
    if (!r.ok) { setNotice(r.reason ?? 'The change was refused.'); return; }
    await load();
  };

  const requirement: ResourcingRequirement | null = useMemo(() => {
    if (!reqEngagement) return null;
    const e = engagements.find((x) => x.id === reqEngagement);
    if (!e) return null;
    return { engagementId: e.id, rights: e.rights, travelLocation: reqTravel && e.location ? e.location : null, from: e.from, to: e.to };
  }, [reqEngagement, reqTravel, engagements]);

  const recommendations = useMemo(
    () => (requirement ? recommendAssignee(profiles, requirement) : []),
    [profiles, requirement],
  );

  if (state === 'loading') {
    return <div className="p-6 text-apple-13 text-secondary" data-testid={`${prefix}-loading`}>Loading the team…</div>;
  }
  if (state === 'error') {
    return <div className="p-6 text-apple-13 text-cinnabar" data-testid={`${prefix}-error`}>{error}</div>;
  }

  return (
    <div className="p-6 space-y-6" data-testid={`${prefix}-directory`}>
      <header className="flex flex-wrap items-center gap-3">
        <Users className="w-5 h-5 text-secondary stroke-[1.5]" />
        <h2 className="text-apple-16 text-primary">Team</h2>
        <span className="text-apple-12 text-secondary" data-testid={`${prefix}-summary`}>
          {profiles.length} member(s) · {summary.light + summary.balanced} with room · {summary.heavy} heavy · {summary.overloaded} overloaded
        </span>
      </header>

      {/* The glass grid of faces */}
      <section className="flex flex-wrap gap-4" data-testid={`${prefix}-grid`}>
        {profiles.map((p) => {
          const w = profileWorkload(p);
          return (
            <div key={p.userId} className="relative" onMouseEnter={() => setHovered(p.userId)} onMouseLeave={() => setHovered(null)}>
              <button
                type="button"
                data-testid={`${prefix}-avatar-${p.userId}`}
                aria-label={`${p.displayName}, ${WORKLOAD_BAND_LABELS[w.band]} load`}
                onClick={() => setSelected(p.userId)}
                onFocus={() => setHovered(p.userId)}
                onBlur={() => setHovered(null)}
                className="flex flex-col items-center gap-1 w-24 p-2 rounded-2xl hover:bg-surface-hover"
              >
                <Avatar profile={p} size={44} />
                <span className="text-apple-11 text-primary truncate w-full text-center">{p.displayName}</span>
                <span className={`text-apple-11 ${BAND_COLOUR[w.band]}`}>{WORKLOAD_BAND_LABELS[w.band]}</span>
              </button>

              {/* The glass hover card: workload, home base, where they are today. */}
              {hovered === p.userId && (
                <div
                  role="tooltip"
                  data-testid={`${prefix}-hover-${p.userId}`}
                  className="absolute z-30 top-full left-0 mt-2 w-64 p-3 rounded-2xl space-y-2 text-apple-11 shadow-soft"
                  style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(14px)', border: '1px solid var(--glass-border)' }}
                >
                  <div className="flex items-center gap-2">
                    <Avatar profile={p} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="text-primary truncate">{p.displayName}</div>
                      <div className="text-secondary truncate">{p.roleName}</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-secondary">Load</span>
                      <span className={BAND_COLOUR[w.band]}>{Math.round(w.loadPct * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-active overflow-hidden">
                      <div className="h-full rounded-full bg-verdigris" style={{ width: `${Math.min(100, Math.round(w.loadPct * 100))}%` }} />
                    </div>
                    <div className="text-secondary">{w.committedHours}h of {w.capacityHours || '—'}h</div>
                  </div>
                  {p.travel.homeBase && (
                    <div className="text-secondary" data-testid={`${prefix}-hover-base-${p.userId}`}>
                      Based in {p.travel.homeBase} · {p.travel.willingness === 'full' ? 'will travel anywhere' : p.travel.willingness === 'limited' ? 'travel limited' : 'no travel'}
                    </div>
                  )}
                  {p.trips.length > 0 && (
                    <div className="text-secondary" data-testid={`${prefix}-hover-trips-${p.userId}`}>
                      {p.trips.length} trip(s): {p.trips[0].location} from {p.trips[0].from}
                    </div>
                  )}
                  <div className="text-secondary">{p.assignments.length} assignment(s)</div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* The resourcing adviser */}
      <section className="p-4 rounded-2xl bg-surface border border-hairline space-y-3" data-testid={`${prefix}-resourcing`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-apple-13 text-primary">Who should take an engagement?</span>
          <Select
            ariaLabel="Engagement" testId={`${prefix}-req-engagement`} value={reqEngagement}
            onChange={setReqEngagement}
            options={[{ value: '', label: 'Choose an engagement' }, ...engagements.map((e) => ({ value: e.id, label: e.name }))]}
          />
          <label className="flex items-center gap-1 text-apple-12">
            <input type="checkbox" data-testid={`${prefix}-req-travel`} checked={reqTravel} onChange={(e) => setReqTravel(e.target.checked)} />
            Requires travel
          </label>
        </div>
        {requirement && (
          <ul className="space-y-1" data-testid={`${prefix}-recommendations`}>
            {recommendations.map((r) => (
              <li key={r.userId} className="flex items-center gap-2 text-apple-12" data-testid={`${prefix}-rec-${r.userId}`}>
                <span className={r.verdict === 'excluded' ? 'text-cinnabar' : r.verdict === 'recommended' ? 'text-verdigris' : 'text-secondary'}>{r.verdict}</span>
                <span className="text-primary">{r.displayName}</span>
                <span className="text-secondary">— {r.reason}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Tag an engagement as requiring travel. */}
        {mayManage && engagements.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-hairline" data-testid={`${prefix}-travel-tag`}>
            <span className="text-apple-12 text-secondary">Tag travel for</span>
            <Select
              ariaLabel="Tag engagement" testId={`${prefix}-tag-engagement`} value={reqEngagement}
              onChange={setReqEngagement}
              options={[{ value: '', label: 'Choose an engagement' }, ...engagements.map((e) => ({ value: e.id, label: `${e.name}${e.location ? ` · ${e.location}` : ''}` }))]}
            />
            <input className="px-2 py-1 rounded-lg bg-surface-hover text-apple-12 text-primary" aria-label="Travel location"
              data-testid={`${prefix}-tag-location`} placeholder="Location" defaultValue={engagements.find((e) => e.id === reqEngagement)?.location ?? ''} />
            <button
              type="button"
              className="text-apple-11 text-primary"
              data-testid={`${prefix}-tag-save`}
              disabled={!reqEngagement}
              onClick={() => {
                const e = engagements.find((x) => x.id === reqEngagement);
                if (!e) return;
                const loc = (document.querySelector(`[data-testid="${prefix}-tag-location"]`) as HTMLInputElement | null)?.value ?? e.location;
                void apply(() => tagEngagementTravel(e.id, true, loc, e.from, e.to));
              }}
            >
              Tag as requiring travel
            </button>
          </div>
        )}
      </section>

      {/* The selected member's detail */}
      {selectedProfile && (
        <section className="p-4 rounded-2xl bg-surface border border-hairline space-y-4" data-testid={`${prefix}-detail`}>
          <div className="flex items-center gap-3">
            <Avatar profile={selectedProfile} size={48} />
            <div className="flex-1">
              <div className="text-apple-14 text-primary" data-testid={`${prefix}-detail-name`}>{selectedProfile.displayName}</div>
              <div className="text-apple-11 text-secondary">{selectedProfile.roleName}</div>
            </div>
            <button type="button" className="text-apple-11 text-secondary" data-testid={`${prefix}-detail-close`} onClick={() => setSelected(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {notice && <div className="text-apple-11 text-cinnabar" data-testid={`${prefix}-notice`}>{notice}</div>}

          {/* Working profile */}
          {canEdit(selectedProfile.userId) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`${prefix}-profile-edit`}>
              <label className="text-apple-11 text-secondary">
                Picture URL
                <div className="flex items-center gap-2">
                  <input
                    className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
                    aria-label="Picture URL" data-testid={`${prefix}-avatar-url`}
                    defaultValue={selectedProfile.avatarUrl ?? ''}
                    onBlur={(e) => void apply(() => saveTeamProfile(selectedProfile.userId, e.target.value.trim() || null, selectedProfile.capacityHours))}
                  />
                  <Upload className="w-4 h-4 text-secondary" />
                </div>
              </label>
              <label className="text-apple-11 text-secondary">
                Capacity (hours)
                <input
                  type="number" min={0}
                  className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
                  aria-label="Capacity" data-testid={`${prefix}-capacity`}
                  defaultValue={selectedProfile.capacityHours}
                  onBlur={(e) => void apply(() => saveTeamProfile(selectedProfile.userId, selectedProfile.avatarUrl, Number(e.target.value)))}
                />
              </label>
            </div>
          )}

          {/* Travel preferences — shown only when the caller may see them */}
          {canEdit(selectedProfile.userId) && (
            <div className="space-y-2" data-testid={`${prefix}-travel-edit`}>
              <div className="text-apple-12 text-primary">Travel</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="px-2 py-1 rounded-lg bg-surface-hover text-apple-12 text-primary" aria-label="Home base"
                  data-testid={`${prefix}-home-base`} placeholder="Home base" defaultValue={selectedProfile.travel.homeBase}
                  onBlur={(e) => void apply(() => saveTeamTravel(selectedProfile.userId, { ...selectedProfile.travel, homeBase: e.target.value }))} />
                <Select ariaLabel="Willingness" testId={`${prefix}-willingness`} value={selectedProfile.travel.willingness}
                  onChange={(v) => void apply(() => saveTeamTravel(selectedProfile.userId, { ...selectedProfile.travel, willingness: v }))}
                  options={[{ value: 'none', label: 'No travel' }, { value: 'limited', label: 'Limited' }, { value: 'full', label: 'Anywhere' }]} />
                <input className="px-2 py-1 rounded-lg bg-surface-hover text-apple-12 text-primary" aria-label="Preferred regions"
                  data-testid={`${prefix}-regions`} placeholder="Regions, comma separated" defaultValue={selectedProfile.travel.preferredRegions.join(', ')}
                  onBlur={(e) => void apply(() => saveTeamTravel(selectedProfile.userId, { ...selectedProfile.travel, preferredRegions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
              </div>
            </div>
          )}

          {/* Travel calendar */}
          <div className="space-y-1" data-testid={`${prefix}-trips`}>
            <div className="text-apple-12 text-primary">Travel calendar</div>
            {selectedProfile.trips.length === 0 && <div className="text-apple-11 text-secondary">No trips recorded.</div>}
            {selectedProfile.trips.map((t, i) => (
              <div key={`${t.engagementId}-${t.from}-${i}`} className="flex items-center gap-2 text-apple-11" data-testid={`${prefix}-trip-${i}`}>
                <Calendar className="w-3.5 h-3.5 text-secondary" />
                <span className="text-secondary">{t.location}: {t.from} → {t.to}</span>
                {canEdit(selectedProfile.userId) && (
                  <button type="button" className="text-apple-11 text-primary" data-testid={`${prefix}-trip-${i}-remove`}
                    onClick={() => void apply(() => removeTeamTrip(t.engagementId || `${selectedProfile.userId}:${i}`))}>Remove</button>
                )}
              </div>
            ))}
            {canEdit(selectedProfile.userId) && engagements.length > 0 && (
              <button type="button" className="text-apple-11 text-primary flex items-center gap-1" data-testid={`${prefix}-trip-add`}
                onClick={() => {
                  const e = engagements[0];
                  void apply(() => addTeamTrip(selectedProfile.userId, { engagementId: e.id, location: e.location || '—', from: e.from, to: e.to }));
                }}>
                <Plus className="w-3.5 h-3.5" /> Add a trip
              </button>
            )}
          </div>

          {/* Assignments and workload */}
          <div className="space-y-1" data-testid={`${prefix}-assignments`}>
            <div className="text-apple-12 text-primary flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-secondary" /> Assignments
              <span className="text-apple-11 text-secondary" data-testid={`${prefix}-detail-load`}>
                {Math.round(profileWorkload(selectedProfile).loadPct * 100)}% load
              </span>
            </div>
            {selectedProfile.assignments.length === 0 && <div className="text-apple-11 text-secondary">No assignments.</div>}
            {selectedProfile.assignments.map((a, i) => (
              <div key={`${a.engagementId}-${i}`} className="flex items-center gap-2 text-apple-11" data-testid={`${prefix}-assignment-${i}`}>
                <span className="text-secondary">{a.engagementName}: {a.from} → {a.to} · {a.hours}h · {a.role}</span>
                {mayManage && (
                  <button type="button" className="text-apple-11 text-primary" data-testid={`${prefix}-assignment-${i}-remove`}
                    onClick={() => void apply(() => removeTeamAssignment(a.engagementId || `${selectedProfile.userId}:${i}`))}>Remove</button>
                )}
              </div>
            ))}
            {mayManage && engagements.length > 0 && (
              <button type="button" className="text-apple-11 text-primary flex items-center gap-1" data-testid={`${prefix}-assignment-add`}
                onClick={() => {
                  const e = engagements[0];
                  void apply(() => addTeamAssignment(selectedProfile.userId, { engagementId: e.id, engagementName: e.name, role: 'team', from: e.from, to: e.to, hours: 20 }));
                }}>
                <Plus className="w-3.5 h-3.5" /> Assign an engagement
              </button>
            )}
          </div>
        </section>
      )}

      {profiles.length === 0 && (
        <div className="text-apple-13 text-secondary" data-testid={`${prefix}-empty`}>
          No team members yet. Members are added in People and Roles.
        </div>
      )}
      {!mayManage && (
        <div className="text-apple-11 text-secondary flex items-center gap-1" data-testid={`${prefix}-readonly`}>
          <User className="w-3.5 h-3.5" /> You may edit only your own profile and travel.
        </div>
      )}
    </div>
  );
};
