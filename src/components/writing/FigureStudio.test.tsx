import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FigureStudio } from './FigureStudio';

afterEach(() => cleanup());

/**
 * WP-G: the figure studio is the whole surface for drawing a report figure. These tests pin that it
 * previews a real figure, refuses a broken one with a visible message (non-blocking), and hands the
 * chosen figure back unchanged so the report can carry it.
 */
describe('FigureStudio', () => {
  it('previews a figure for the default expression', () => {
    render(<FigureStudio />);
    expect(screen.getByTestId('wk-report-builder-figure-preview-svg')).toBeTruthy();
    expect(screen.queryByTestId('wk-report-builder-figure-error')).toBeNull();
  });

  it('shows a non-blocking error and no preview for a broken expression', () => {
    render(<FigureStudio />);
    fireEvent.change(screen.getByTestId('wk-report-builder-figure-expression'), { target: { value: 'sin(' } });
    expect(screen.getByTestId('wk-report-builder-figure-error')).toBeTruthy();
    expect(screen.queryByTestId('wk-report-builder-figure-preview-svg')).toBeNull();
  });

  it('disables Add while the expression is broken, and enables it once fixed', () => {
    render(<FigureStudio />);
    const input = screen.getByTestId('wk-report-builder-figure-expression');
    fireEvent.change(input, { target: { value: 'x ^' } });
    expect((screen.getByTestId('wk-report-builder-figure-add') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'x ^ 2' } });
    expect((screen.getByTestId('wk-report-builder-figure-add') as HTMLButtonElement).disabled).toBe(false);
  });

  it('hands the chosen figure back through onPick', () => {
    const picked: string[] = [];
    render(<FigureStudio onPick={(f) => picked.push(f.expression)} />);
    fireEvent.change(screen.getByTestId('wk-report-builder-figure-expression'), { target: { value: '2 ^ x' } });
    fireEvent.click(screen.getByTestId('wk-report-builder-figure-add'));
    expect(picked).toEqual(['2 ^ x']);
  });

  it('a preset fills the controls', () => {
    render(<FigureStudio />);
    fireEvent.click(screen.getByTestId('wk-report-builder-figure-preset-growth-trend'));
    expect((screen.getByTestId('wk-report-builder-figure-expression') as HTMLInputElement).value).toBe('2 ^ x');
  });

  it('every interactive control carries a testid on the wk-report-builder prefix', () => {
    render(<FigureStudio />);
    for (const id of ['figure-expression', 'figure-min-x', 'figure-max-x', 'figure-title', 'figure-label', 'figure-add']) {
      expect(screen.getByTestId(`wk-report-builder-${id}`)).toBeTruthy();
    }
  });
});
