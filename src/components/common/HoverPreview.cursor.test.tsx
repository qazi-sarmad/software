import React from 'react';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { HoverPreview } from './HoverPreview';

beforeAll(() => { MotionGlobalConfig.skipAnimations = true; });
afterAll(() => { MotionGlobalConfig.skipAnimations = false; });

describe('HoverPreview anchors to the cursor', () => {
  it('opens next to the pointer (never at 0,0) even for display:contents wrappers, and follows it', async () => {
    render(
      <HoverPreview content={{ title: 'Audit A' }} className="contents">
        <div>bar</div>
      </HoverPreview>
    );
    const trigger = screen.getByTestId('hover-preview-trigger');
    fireEvent.mouseEnter(trigger, { clientX: 300, clientY: 200 });
    const pop = await waitFor(() => screen.getByTestId('hover-preview-popover'));
    expect(parseFloat(pop.style.left)).toBe(316);
    expect(parseFloat(pop.style.top)).toBe(216);
    fireEvent.mouseMove(trigger, { clientX: 400, clientY: 250 });
    await waitFor(() => expect(parseFloat(screen.getByTestId('hover-preview-popover').style.left)).toBe(416));
  });
});
