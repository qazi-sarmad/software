import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemePreset = 'ledger' | 'porcelain' | 'bone';

export const THEME_PRESETS: ThemePreset[] = ['ledger', 'porcelain', 'bone'];

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  preset: ThemePreset;
  setTheme: (mode: ThemeMode) => void;
  setPreset: (preset: ThemePreset) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('provio-theme');
    return (saved as ThemeMode) || 'system';
  });

  const [preset, setPresetState] = useState<ThemePreset>(() => {
    const saved = localStorage.getItem('provio-preset');
    // Old saved presets (graphite, ink) no longer exist: fall back to the Ledger default.
    return THEME_PRESETS.includes(saved as ThemePreset) ? (saved as ThemePreset) : 'ledger';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-preset', preset);

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
        setResolvedTheme('dark');
      } else {
        root.classList.remove('dark');
        setResolvedTheme('light');
      }
    };

    if (theme === 'system') {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        applyTheme(media.matches);
        const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
      } else {
        applyTheme(false);
      }
    } else {
      applyTheme(theme === 'dark');
    }
  }, [theme, preset]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem('provio-theme', mode);
  };

  const setPreset = (p: ThemePreset) => {
    setPresetState(p);
    localStorage.setItem('provio-preset', p);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, preset, setTheme, setPreset }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
