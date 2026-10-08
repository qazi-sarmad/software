import React from 'react';
import { useTheme, ThemePreset } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, Palette, Sun, Moon, Laptop, Shield } from './Icons';

interface AccountSettingsProps {
  onClose?: () => void;
}

export const AccountSettingsModal: React.FC<AccountSettingsProps> = ({ onClose }) => {
  const { theme, setTheme, preset, setPreset } = useTheme();
  const { currentUser } = useApp();

  const presets: { id: ThemePreset; name: string; description: string; colors: string[] }[] = [
    {
      id: 'ledger',
      name: 'Ledger (Default)',
      description: 'Warm paper light / neutral charcoal dark with Verdigris and Cinnabar.',
      colors: ['var(--canvas)', 'var(--surface)', 'var(--accent-verdigris)', 'var(--accent-cinnabar)'],
    },
    {
      id: 'porcelain',
      name: 'Porcelain',
      description: 'Cool, clean light / soft cool dark with precise hairline borders.',
      colors: ['var(--canvas)', 'var(--surface)', 'var(--accent-verdigris)', 'var(--accent-cinnabar)'],
    },
    {
      id: 'bone',
      name: 'Bone',
      description: 'The only warm preset: bone paper light / deep warm-neutral dark.',
      colors: ['var(--canvas)', 'var(--surface)', 'var(--accent-verdigris)', 'var(--accent-cinnabar)'],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-hairline pb-4">
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
          Visual Identity &amp; System Configuration
        </span>
        <h3 className="text-apple-20 font-bold text-primary mt-1">
          Account &amp; Appearance Settings
        </h3>
        <p className="text-apple-12 text-secondary mt-1">
          Select your desired theme preset and appearance preferences.
        </p>
      </div>

      {/* Account Profile Card */}
      <div className="p-4 rounded-xl bg-surface-elevated border border-hairline flex items-center justify-between">
        <div>
          <div className="text-apple-13 font-semibold text-primary">{currentUser.name}</div>
          <div className="text-apple-12 text-secondary">{currentUser.email}</div>
          <div className="text-apple-11 text-tertiary mt-1">
            Role: <span className="uppercase font-semibold text-primary">{currentUser.role}</span> • Department: {currentUser.department}
          </div>
        </div>
        <div className="w-10 h-10 rounded-full bg-accent-subtle text-accent font-bold flex items-center justify-center text-apple-13">
          {currentUser.avatar}
        </div>
      </div>

      {/* Theme Presets Selection (Section 4 Requirement) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-accent stroke-[1.5]" />
          <h4 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Curated Theme Presets
          </h4>
        </div>

        <div className="space-y-3">
          {presets.map((p) => {
            const isSelected = preset === p.id;
            return (
              <div
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-4 ${
                  isSelected
                    ? 'bg-accent-subtle border-accent shadow-xs'
                    : 'bg-surface hover:bg-surface-hover border-hairline'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-apple-13 font-semibold text-primary">{p.name}</span>
                    {p.id === 'ledger' && (
                      <span className="px-2 py-0.5 rounded text-apple-11 font-medium text-verdigris bg-verdigris-subtle border border-verdigris">
                        Source of Truth
                      </span>
                    )}
                  </div>
                  <p className="text-apple-12 text-secondary leading-relaxed">{p.description}</p>
                  {/* Swatches */}
                  <div className="flex items-center gap-2 pt-1">
                    {p.colors.map((c, i) => (
                      <span
                        key={i}
                        className="w-4 h-4 rounded-full border border-hairline shadow-xs"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                {isSelected && (
                  <CheckCircle2 className="w-5 h-5 text-accent stroke-[1.5] shrink-0 mt-0.5" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="space-y-2 pt-4 border-t border-hairline">
        <label className="text-apple-12 font-semibold text-secondary uppercase tracking-wider">
          Appearance Mode
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'light', label: 'Light', icon: Sun },
            { id: 'dark', label: 'Dark', icon: Moon },
            { id: 'system', label: 'System Default', icon: Laptop },
          ].map((m) => {
            const Icon = m.icon;
            const isSelected = theme === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setTheme(m.id as any)}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-apple-12 font-medium transition-colors ${
                  isSelected
                    ? 'bg-surface text-primary border-accent shadow-xs'
                    : 'bg-surface-elevated text-secondary hover:text-primary border-hairline'
                }`}
              >
                <Icon className="w-4 h-4 stroke-[1.5]" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
