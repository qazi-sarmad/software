import { fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Drive a HoldToConfirm control (D16) in jsdom. A single click is deliberately insufficient, so
 * tests must press, advance the fake timers past the hold duration, then release. Callers must have
 * `vi.useFakeTimers()` active and restore real timers afterwards.
 */
export function holdToConfirm(el: HTMLElement, durationMs = 2000): void {
  fireEvent.mouseDown(el);
  act(() => {
    vi.advanceTimersByTime(durationMs + 200);
  });
  fireEvent.mouseUp(el);
}
