import React, { useCallback, useEffect, useState } from 'react';
import { TutorialDrawer } from './TutorialDrawer';
import { Eye } from './Icons';

/**
 * "Show me how" button + first-visit autoplay (F18, S12).
 *
 * Every configuration screen carries this beside its title. It opens the TUT-01 drawer (a
 * non-blocking side panel, never a modal). On the FIRST visit to a screen, the drawer opens once on
 * its own so a new admin is shown how the screen works; afterwards only the button opens it.
 *
 * The autoplay is suppressed when localStorage holds AUTOPLAY_OFF_KEY = 'off'. The Playwright suite
 * sets that key for every context (playwright.config.ts `use.storageState`) so runs stay
 * deterministic; a dedicated spec clears it to exercise the autoplay itself.
 */
export const AUTOPLAY_OFF_KEY = 'acp.tutorial.autoplay';
const SEEN_PREFIX = 'acp.tutorial.seen.';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface TutorialButtonProps {
  /** The Appendix A tutorial key (e.g. `oa.branding`). */
  tutorialKey: string;
  /** The screen title shown in the drawer header. */
  title: string;
  /** The screen id, so the button's testid is `<screenId>-tutorial` (F19). */
  screenId: string;
  /** Set false to place the button without ever autoplaying (e.g. work screens). */
  autoplay?: boolean;
}

export const TutorialButton: React.FC<TutorialButtonProps> = ({
  tutorialKey, title, screenId, autoplay = true,
}) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!autoplay) return;
    const s = storage();
    if (!s) return;
    if (s.getItem(AUTOPLAY_OFF_KEY) === 'off') return;
    if (s.getItem(SEEN_PREFIX + tutorialKey)) return;
    s.setItem(SEEN_PREFIX + tutorialKey, '1');
    setOpen(true);
  }, [autoplay, tutorialKey]);

  const openDrawer = useCallback(() => setOpen(true), []);

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        data-testid={`${screenId}-tutorial`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-apple-12 text-secondary border border-hairline hover:text-primary transition-colors"
      >
        <Eye className="w-3.5 h-3.5" /> Show me how
      </button>
      {open && (
        <TutorialDrawer tutorialKey={tutorialKey} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
};
