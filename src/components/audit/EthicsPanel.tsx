import React from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { CheckCircle2, Clock, Users } from '../common/Icons';

export interface EthicsMember {
  userId: string;
  name: string;
  acknowledged: boolean;
}

/**
 * Ethics acknowledgement panel (spec §7: testing is locked until every team member acknowledges).
 * Self-only acknowledgement: a member acknowledges for themselves; the panel never writes on behalf
 * of another. Renders inside the sliding inspector.
 */
export const EthicsPanel: React.FC<{ members: EthicsMember[]; onAcknowledge?: (userId: string) => void }> = ({
  members,
  onAcknowledge,
}) => {
  const { currentUser } = useApp();
  const complete = members.length > 0 && members.every((m) => m.acknowledged);
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
      {members.length === 0 ? (
        <p data-testid="ethics-empty" className="text-apple-13 text-tertiary">
          No team members to acknowledge yet.
        </p>
      ) : (
        <ul data-testid="ethics-members" className="divide-y divide-hairline rounded-xl border border-hairline overflow-hidden">
          {members.map((m) => (
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
                  onClick={() => onAcknowledge?.(m.userId)}
                  className="px-3 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
                >
                  Acknowledge
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
