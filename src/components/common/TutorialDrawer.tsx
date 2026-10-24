import React, { useCallback, useEffect, useState } from 'react';
import { listTutorials, recordTutorialView, type TutorialRow } from '../../data/tutorials';
import { InlineError } from '../common/InlineError';
import { Check, X, Eye } from '../common/Icons';

/**
 * TUT-01 tutorial drawer (F18).
 *
 * A non-blocking side panel — never a modal, no scrim, no full-viewport backdrop — opened by
 * "Show me how" on any wizard step or configuration screen. It shows the GIF for the key, the
 * numbered steps, a Copy steps button and a "Did this help?" answer recorded in tutorial_views.
 */
interface TutorialDrawerProps {
  tutorialKey: string;
  title: string;
  onClose: () => void;
}

export const TutorialDrawer: React.FC<TutorialDrawerProps> = ({ tutorialKey, title, onClose }) => {
  const [row, setRow] = useState<TutorialRow | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [helped, setHelped] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    listTutorials()
      .then((rows) => {
        if (live) setRow(rows.find((r) => r.key === tutorialKey) ?? null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load the tutorial.');
      });
    return () => {
      live = false;
    };
  }, [tutorialKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copySteps = useCallback(async () => {
    const steps = row?.steps ?? [];
    try {
      await navigator.clipboard.writeText(steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [row]);

  const answer = useCallback(
    async (value: boolean) => {
      setHelped(value);
      await recordTutorialView(tutorialKey, value);
    },
    [tutorialKey]
  );

  return (
    <aside
      className="fixed top-0 right-0 h-full w-96 bg-surface border-l border-hairline shadow-apple z-40 flex flex-col"
      role="complementary"
      aria-label={`Tutorial: ${title}`}
      data-testid="tutorial-drawer"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-accent" />
          <h2 className="text-apple-14 font-semibold text-primary">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tutorial"
          data-testid="tutorial-drawer-close"
          className="p-1 rounded-lg hover:bg-surface-hover"
        >
          <X className="w-4 h-4 text-secondary" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <InlineError message={error || null} testId="tutorial-drawer-error" />

        {row?.mediaPath ? (
          <img
            src={`/${row.mediaPath}`}
            alt={`Recording for ${title}`}
            data-testid="tutorial-drawer-media"
            className="w-full rounded-xl border border-hairline"
          />
        ) : (
          <div
            className="rounded-xl border border-dashed border-hairline px-4 py-8 text-center text-apple-12 text-secondary"
            data-testid="tutorial-drawer-missing"
          >
            This recording is not available yet.
          </div>
        )}

        <ol className="space-y-2" data-testid="tutorial-drawer-steps">
          {(row?.steps ?? []).map((step, i) => (
            <li key={i} className="flex gap-2 text-apple-12 text-primary">
              <span className="text-tertiary tabular-nums">{i + 1}.</span>
              <span data-testid={`tutorial-drawer-step-${i + 1}`}>{step.text}</span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => void copySteps()}
          data-testid="tutorial-drawer-copy"
          className="text-apple-12 text-accent hover:underline"
        >
          {copied ? 'Steps copied' : 'Copy steps'}
        </button>
      </div>

      <footer className="px-4 py-3 border-t border-hairline" data-testid="tutorial-drawer-feedback">
        <div className="text-apple-12 text-secondary mb-2">Did this help?</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void answer(true)}
            data-testid="tutorial-drawer-yes"
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-apple-12 border border-hairline ${helped === true ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'}`}
          >
            <Check className="w-3 h-3" /> Yes
          </button>
          <button
            type="button"
            onClick={() => void answer(false)}
            data-testid="tutorial-drawer-no"
            className={`px-3 py-1.5 rounded-lg text-apple-12 border border-hairline ${helped === false ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'}`}
          >
            No
          </button>
        </div>
      </footer>
    </aside>
  );
};
