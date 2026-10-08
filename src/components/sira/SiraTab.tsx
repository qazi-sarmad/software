import React from 'react';
import { Shield } from '../common/Icons';

/**
 * SIRA (Guide v7 §5.5). Stub: the annual cycle, heatmap and emergent-risk
 * queue are built in a later batch.
 */
export const SiraTab: React.FC = () => (
  <section
    data-testid="tab-sira"
    className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] flex flex-col gap-3"
  >
    <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
      <Shield className="w-4 h-4 stroke-[1.3]" />
      <span>Coming online</span>
    </div>
    <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">SIRA</h1>
    <p className="text-apple-15 text-secondary max-w-2xl">
      The annual Strategic Internal Risk Assessment: weighted risk scores for every auditable
      entity, year-on-year change and the emergent-risk queue.
    </p>
  </section>
);
