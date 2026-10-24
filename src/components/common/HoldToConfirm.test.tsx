import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoldToConfirm } from './HoldToConfirm';
import { holdToConfirm } from '../../test/holdToConfirm';

afterEach(() => {
  vi.useRealTimers();
});

describe('HoldToConfirm (D16)', () => {
  it('does not fire on a single click', () => {
    const onConfirm = vi.fn();
    render(<HoldToConfirm label="Sign off" testId="hold" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('hold'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires only after the full hold', () => {
    const onConfirm = vi.fn();
    render(<HoldToConfirm label="Sign off" testId="hold" onConfirm={onConfirm} durationMs={1000} />);
    vi.useFakeTimers();
    holdToConfirm(screen.getByTestId('hold'), 1000);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the hold is released early', () => {
    const onConfirm = vi.fn();
    render(<HoldToConfirm label="Sign off" testId="hold" onConfirm={onConfirm} durationMs={1000} />);
    vi.useFakeTimers();
    const el = screen.getByTestId('hold');
    fireEvent.mouseDown(el);
    vi.advanceTimersByTime(300);
    fireEvent.mouseUp(el);
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('is inert while disabled', () => {
    const onConfirm = vi.fn();
    render(<HoldToConfirm label="Sign off" testId="hold" onConfirm={onConfirm} disabled durationMs={500} />);
    vi.useFakeTimers();
    holdToConfirm(screen.getByTestId('hold'), 500);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('exposes a native title and never a dialog role', () => {
    render(<HoldToConfirm label="Sign off" testId="hold" onConfirm={() => {}} title="Why disabled" />);
    const el = screen.getByTestId('hold');
    expect(el.getAttribute('title')).toBe('Why disabled');
    expect(el.getAttribute('aria-modal')).toBeNull();
    expect(el.getAttribute('role')).not.toBe('dialog');
  });
});
