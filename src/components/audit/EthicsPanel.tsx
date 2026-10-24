import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { acknowledgeEthics, ethicsStatus } from '../../data/deployment';
import { InlineError } from '../common/InlineError';
import { CheckCircle2, Clock, Users } from '../common/Icons';

export interface EthicsMember {
  userId: string;
  name: string;
  acknowledged: boolean;
}

export interface EthicsPanelProps {
  members?: EthicsMember[];
  /** When given, the panel loads its own status and writes the acknowledgement for the current user. */
  engagementId?: string;
  /** Override for the acknowledgement write (used by tests and hosts that own the state). */
  onAcknowledge?: (userId: string) => void;
}

/**
 * Ethics acknowledgement panel (spec §7: testing is locked until every team member acknowledges).
 * Self-only acknowledgement: a member acknowledges for themselves; the panel never writes on behalf
 * of another. The write goes through the data module (acknowledge_ethics) and the panel re-reads the
 * status so a success visibly clears the row and a failure shows inline (D6).
 */
export const EthicsPanel: React.FC<EthicsPanelProps> = ({ members, engagementId, onAcknowledge }) => {
  const { currentUser } = useApp();
  const [rows, setRows] = useState<EthicsMember[]>(members ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(members ?? []);
  }, [members]);

  const load = useCallback(async () => {
    if (!engagementId) return;
    try {
      const status = await ethicsStatus(engagementId);
      if (status) {
        setRows(status.members.map((m) => ({ userId: m.userId, name: m.userId, acknowledged: m.acknowledged })));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The acknowledgement status could not be loaded.');
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledge = async (userId: string) => {
    onAcknowledge?.(userId);
    if (!engagementId) return;
    setBusy(true);
    setError(null);
    const result = await acknowledgeEthics(engagementId);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    await load();
  };

  const complete = rows.length > 0 && rows.every((m) => m.acknowledged);
  const canAcknowledge = hasRight(currentUser, 'perform_work');

  return (
    <div data-testid="ethics-panel" className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        {complete ? (
          <CheckCircle2 className="w-5 h-5 text-verdigris stroke-[1.5]" />
        ) : (
          <Clock className="w-5 h-5 text-cinnabar stroke-[1.5]" />
        )}
        <span className="text-apple-15 font-semibold text-primary">
          {complete ? 'All members acknowledged' : 'Ethics acknowledgement pending'}
        </span>
      </div>
      <p className="text-apple-12 text-secondary">
        Testing is locked until every team member acknowledges the ethics statement.
      </p>
      <InlineError message={error} testId="ethics-error" />
      {rows.length === 0 ? (
        <p data-testid="ethics-empty" className="text-apple-13 text-tertiary">
          No team members to acknowledge yet.
        </p>
      ) : (
        <ul data-testid="ethics-members" className="divide-y divide-hairline rounded-xl border border-hairline overflow-hidden">
          {rows.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex items-center gap-2 text-apple-13 text-primary">
                <Users className="w-4 h-4 text-secondary stroke-[1.5]" />
                {m.name || m.userId}
              </span>
              {m.acknowledged ? (
                <span data-testid={`ethics-ack-${m.userId}`} className="text-apple-11 font-semibold text-verdigris">
                  Acknowledged
                </span>
              ) : m.userId === currentUser.id && canAcknowledge ? (
                <button
                  type="button"
                  data-testid={`ethics-ack-button-${m.userId}`}
                  disabled={busy}
                  onClick={() => void acknowledge(m.userId)}
                  className="px-3 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50"
                >
                  {busy ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              ) : (
                <span data-testid={`ethics-pending-${m.userId}`} className="text-apple-11 text-secondary">
                  Pending
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
