import React, { useMemo, useState } from 'react';
import {
  IIA_STANDARDS,
  implementedStandards,
  unimplementedStandards,
  type IiaStandard,
} from '../../lib/explain/iia';
import { entriesForStandard } from '../../lib/explain/catalogue';
import { useApp } from '../../context/AppContext';

/**
 * Standards view (E7; docs/EXPLAIN-LAYER.md §5.4 item 4).
 *
 * The full catalogue: every verified IIA 2024 standard, what the product does about it, the screens
 * and RPCs where it is implemented, and the artifact that proves it. It drills, per standard, from
 * the catalogue entry to its implementation and its evidence.
 *
 * The honesty rule (G9) is visible here: a standard the product does not address is shown as
 * "Not yet implemented" with no invented surface. The view never claims coverage it does not have.
 *
 * It is a `role="complementary"` panel, non-blocking, never a modal, reachable from the screen
 * affordance and from the explain layer.
 */
export interface StandardsViewProps {
  /** When set, the view opens on this standard or this screen's standards. */
  focus?: { kind: 'screen' | 'step' | 'section'; target: string };
  screenId?: string;
  className?: string;
}

function StandardRow({ s, open, onToggle }: { s: IiaStandard; open: boolean; onToggle: () => void }) {
  const entries = entriesForStandard(s.id);
  const implemented = s.implementation !== null && s.implementedBy.length > 0;
  return (
    <li
      data-testid={`standards-row-${s.id}`}
      data-standard-implemented={implemented ? 'true' : 'false'}
      className="border-b border-hairline last:border-b-0"
    >
      <button
        type="button"
        data-testid={`standards-row-${s.id}-toggle`}
        aria-expanded={open}
        onClick={onToggle}
        className="w-full text-left py-2.5 px-2 flex items-start justify-between gap-3 hover:bg-surface-hover rounded-lg transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-apple-12 font-semibold text-primary">
            <span className="tabular-nums text-secondary mr-2">{s.id}</span>
            {s.title}
          </span>
          <span className="block text-apple-11 text-secondary mt-0.5">{s.paraphrase}</span>
        </span>
        <span
          className={`shrink-0 px-2 py-0.5 rounded text-apple-11 font-semibold border ${
            implemented
              ? 'bg-verdigris-subtle text-verdigris border-verdigris'
              : 'bg-surface-sunken text-secondary border-hairline'
          }`}
        >
          {implemented ? 'Implemented' : 'Not yet implemented'}
        </span>
      </button>

      {open && (
        <div data-testid={`standards-row-${s.id}-detail`} className="px-3 pb-3 space-y-2 text-apple-12">
          <div>
            <h4 className="text-apple-11 uppercase tracking-wider text-secondary">Implementation</h4>
            <p data-testid={`standards-row-${s.id}-implementation`} className="text-primary">
              {s.implementation ?? 'Not yet implemented: the product records this standard but does not yet address it.'}
            </p>
          </div>
          {s.implementedBy.length > 0 && (
            <div>
              <h4 className="text-apple-11 uppercase tracking-wider text-secondary">Screens</h4>
              <ul data-testid={`standards-row-${s.id}-screens`} className="flex flex-wrap gap-1.5">
                {s.implementedBy.map((id) => (
                  <li key={id} className="px-1.5 py-0.5 rounded bg-surface-sunken border border-hairline text-apple-11 tabular-nums">
                    {id}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.rpcs.length > 0 && (
            <div>
              <h4 className="text-apple-11 uppercase tracking-wider text-secondary">RPCs and tables</h4>
              <ul data-testid={`standards-row-${s.id}-rpcs`} className="flex flex-wrap gap-1.5">
                {s.rpcs.map((r) => (
                  <li key={r} className="px-1.5 py-0.5 rounded bg-surface-sunken border border-hairline text-apple-11 font-mono">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="text-apple-11 uppercase tracking-wider text-secondary">Evidence</h4>
            {s.evidence.length > 0 ? (
              <ul data-testid={`standards-row-${s.id}-evidence`} className="list-disc list-inside text-secondary space-y-0.5">
                {s.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : (
              <p data-testid={`standards-row-${s.id}-evidence-none`} className="text-secondary">
                No evidence artifact yet: the product does not address this standard.
              </p>
            )}
          </div>
          {entries.length > 0 && (
            <div>
              <h4 className="text-apple-11 uppercase tracking-wider text-secondary">
                Explain entries carrying this standard
              </h4>
              <ul data-testid={`standards-row-${s.id}-entries`} className="flex flex-wrap gap-1.5">
                {entries.map((e) => (
                  <li key={e.id} className="px-1.5 py-0.5 rounded bg-surface-sunken border border-hairline text-apple-11 font-mono">
                    {e.id}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export const StandardsView: React.FC<StandardsViewProps> = ({ screenId = 'OA-19', className = '' }) => {
  const { currentUser } = useApp();
  const [onlyImplemented, setOnlyImplemented] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Rights only decide whether the view is reachable (the standard catalogue is public product
  // documentation). The list itself is static data, safe for any signed-in user (Law L2).
  const standards = useMemo(
    () => (onlyImplemented ? implementedStandards() : IIA_STANDARDS),
    [onlyImplemented]
  );
  const implementedCount = implementedStandards().length;
  const notImplementedCount = unimplementedStandards().length;

  return (
    <section
      data-testid={`${screenId}-standards-view`}
      role="complementary"
      aria-label="IIA Global Internal Audit Standards (2024)"
      className={`space-y-3 rounded-2xl border border-hairline bg-surface p-4 ${className}`}
    >
      <header className="space-y-1">
        <h3 className="text-apple-15 font-semibold text-primary">
          IIA Global Internal Audit Standards (2024)
        </h3>
        <p data-testid={`${screenId}-standards-summary`} className="text-apple-11 text-secondary">
          {implementedCount} implemented · {notImplementedCount} not yet implemented ·{' '}
          {IIA_STANDARDS.length} recorded. Paraphrased in our own words; the IIA holds copyright.
        </p>
      </header>

      <label className="flex items-center gap-2 text-apple-12 text-secondary">
        <input
          type="checkbox"
          data-testid={`${screenId}-standards-only-implemented`}
          checked={onlyImplemented}
          onChange={(e) => setOnlyImplemented(e.target.checked)}
        />
        Show only implemented standards
      </label>

      <ul data-testid={`${screenId}-standards-list`} className="divide-y divide-hairline">
        {standards.map((s) => (
          <StandardRow
            key={s.id}
            s={s}
            open={openId === s.id}
            onToggle={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
          />
        ))}
      </ul>

      <p className="text-apple-11 text-tertiary" data-testid={`${screenId}-standards-session`}>
        Shown to {currentUser.name}.
      </p>
    </section>
  );
};
