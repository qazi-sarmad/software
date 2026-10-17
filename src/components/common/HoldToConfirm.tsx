import React, { useCallback, useEffect, useRef, useState } from 'react';

interface HoldToConfirmProps {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  testId?: string;
  /** How long the user must hold, in milliseconds. */
  durationMs?: number;
}

/**
 * Hold-to-confirm control for consequential actions (§27.5 names it as the allowed alternative to a
 * blocking modal). It is an in-place button: no scrim, no dialog attribute. The action fires only
 * when the pointer or key is held for the full duration.
 */
export const HoldToConfirm: React.FC<HoldToConfirmProps> = ({
  label,
  onConfirm,
  disabled = false,
  testId = 'hold-to-confirm',
  durationMs = 1200,
}) => {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    setHolding(false);
    setProgress(0);
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    if (disabled || holding) return;
    setHolding(true);
    setProgress(0);
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const pct = Math.min(100, ((Date.now() - started) / durationMs) * 100);
      setProgress(pct);
      if (pct >= 100) {
        stop();
        onConfirm();
      }
    }, 40);
  }, [disabled, durationMs, holding, onConfirm, stop]);

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') start();
      }}
      onKeyUp={stop}
      onBlur={stop}
      className="relative overflow-hidden px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 transition-colors"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-cinnabar-subtle transition-[width]"
        style={{ width: `${progress}%` }}
      />
      <span className="relative">{holding ? 'Keep holding…' : label}</span>
    </button>
  );
};
