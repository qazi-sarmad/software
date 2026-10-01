import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemePreset = 'ledger' | 'graphite' | 'ink';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  preset: ThemePreset;
  setPreset: (preset: ThemePreset) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [preset, setPreset] = useState<ThemePreset>('ledger');
  const [isDark, setIsDark] = useState(false);

  // Detect system preference on mount and listen for changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateDarkMode = () => {
      if (mode === 'system') {
        setIsDark(mediaQuery.matches);
      } else {
        setIsDark(mode === 'dark');
      }
    };

    updateDarkMode();
    mediaQuery.addEventListener('change', updateDarkMode);
    return () => mediaQuery.removeEventListener('change', updateDarkMode);
  }, [mode]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    
    // Set preset
    root.setAttribute('data-preset', preset);
    
    // Set dark mode class
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [preset, isDark]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('theme-mode', mode);
    localStorage.setItem('theme-preset', preset);
  }, [mode, preset]);

  // Restore from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('theme-mode') as ThemeMode | null;
    const savedPreset = localStorage.getItem('theme-preset') as ThemePreset | null;
    
    if (savedMode && ['system', 'light', 'dark'].includes(savedMode)) {
      setMode(savedMode);
    }
    if (savedPreset && ['ledger', 'graphite', 'ink'].includes(savedPreset)) {
      setPreset(savedPreset);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, setMode, preset, setPreset, isDark }}>
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
