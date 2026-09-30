import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { useScopedData } from '../../hooks/useScopedData';
import { HeaderCalendarPanel } from '../calendar/HeaderCalendarPanel';
import {
  Calendar as CalendarIcon,
  Search,
  Sun,
  Moon,
  Laptop,
  Settings,
  Users,
  ShieldAlert,
  LogOut,
  ChevronDown,
  Building,
} from './Icons';
import { motion, AnimatePresence } from 'motion/react';

interface HeaderBarProps {
  onOpenCommandPalette: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ onOpenCommandPalette }) => {
  const {
    currentUser,
    setCurrentUser,
    availableUsers,
    activeTab,
    setActiveTab,
    selectedUniverseId,
    setSelectedUniverseId,
    openInspector,
    setSelectedEngagementId,
  } = useApp();
  const { theme, setTheme } = useTheme();
  const { scopedUniverses, hasMultipleUniverses } = useScopedData();

  // Floating header calendar panel state
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);

  // Profile menu state
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown on outside click and Esc
  useEffect(() => {
    if (!isProfileOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsProfileOpen(false);
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setIsProfileOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isProfileOpen]);

  const canAccessAdmin = currentUser.role === 'admin' || currentUser.role === 'cia';

  return (
    <header className="sticky top-0 z-40 w-full h-14 bg-glass border-b border-hairline shadow-apple select-none">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between gap-4">
        {/* Left: Logo & Wordmark in Serif Font */}
        <div className="flex items-center gap-5 shrink-0">
          <button
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2.5 text-left group transition-opacity hover:opacity-85"
          >
            <div className="w-8 h-8 rounded-xl bg-primary text-canvas flex items-center justify-center font-bold text-apple-15 font-serif-title shadow-xs">
              P
            </div>
            <span className="font-serif-title text-apple-20 font-bold tracking-tight text-primary">
              Provio
            </span>
          </button>

          {/* Universe Switcher: ONLY if user has access to multiple universes */}
          {hasMultipleUniverses && (
            <div className="hidden lg:flex items-center gap-1.5 pl-3 border-l border-hairline">
              <Building className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />
              <select
                aria-label="Select audit universe"
                value={selectedUniverseId || ''}
                onChange={(e) => setSelectedUniverseId(e.target.value || null)}
                className="bg-transparent text-apple-12 font-medium text-secondary hover:text-primary cursor-pointer outline-none border-none py-1 pr-2"
              >
                {scopedUniverses.map((u) => (
                  <option key={u.id} value={u.id} className="bg-surface text-primary">
                    {u.name} ({u.code})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Center: Search button (280px width, "Search or jump to...", Ctrl K badge) */}
        <div className="flex-1 max-w-[280px] hidden sm:block">
          <button
            onClick={onOpenCommandPalette}
            className="w-full h-9 px-3 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline transition-colors flex items-center justify-between text-secondary hover:text-primary shadow-xs"
            title="Search or jump to... (Ctrl K)"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Search className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
              <span className="text-apple-12 truncate">Search or jump to…</span>
            </div>
            <kbd className="px-1.5 py-0.5 text-apple-11 text-tertiary bg-surface rounded border border-hairline tabular-nums shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right Zone: Header Calendar Icon Button, Theme Toggle, Profile Menu */}
        <div className="flex items-center gap-2.5 shrink-0 relative">
          {/* Header Calendar Icon Button (§ 3.3) */}
          <div className="relative">
            <button
              ref={calendarButtonRef}
              onClick={() => setIsCalendarOpen(!isCalendarOpen)}
              className={`p-2 rounded-xl transition-colors border ${
                isCalendarOpen
                  ? 'bg-accent-subtle text-accent border-accent'
                  : 'bg-surface-elevated hover:bg-surface-hover text-secondary hover:text-primary border-hairline'
              }`}
              title="Audit Milestones & Calendar Quick-Panel"
              aria-label="Open Audit Calendar Quick-Panel"
            >
              <CalendarIcon className="w-4 h-4 stroke-[1.5]" />
            </button>

            {/* Floating Calendar Panel */}
            <HeaderCalendarPanel
              isOpen={isCalendarOpen}
              onClose={() => setIsCalendarOpen(false)}
              triggerRef={calendarButtonRef}
              onSelectAudit={(auditId) => {
                setSelectedEngagementId(auditId);
                setActiveTab('plan');
                setIsCalendarOpen(false);
              }}
            />
          </div>

          {/* Theme Control: System / Light / Dark */}
          <div className="flex items-center p-0.5 rounded-xl bg-surface-elevated border border-hairline">
            <button
              onClick={() => setTheme('light')}
              className={`p-1.5 rounded-lg transition-colors ${
                theme === 'light' ? 'bg-surface text-primary shadow-xs' : 'text-secondary hover:text-primary'
              }`}
              title="Light mode"
              aria-label="Light mode"
            >
              <Sun className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`p-1.5 rounded-lg transition-colors ${
                theme === 'dark' ? 'bg-surface text-primary shadow-xs' : 'text-secondary hover:text-primary'
              }`}
              title="Dark mode"
              aria-label="Dark mode"
            >
              <Moon className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
            <button
              onClick={() => setTheme('system')}
              className={`p-1.5 rounded-lg transition-colors ${
                theme === 'system' ? 'bg-surface text-primary shadow-xs' : 'text-secondary hover:text-primary'
              }`}
              title="System default"
              aria-label="System default"
            >
              <Laptop className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
          </div>

          {/* Profile Menu Dropdown (§ 3.1) */}
          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-surface-hover transition-colors"
              title="User profile and system administration"
              aria-label="Open user profile menu"
            >
              <div className="w-7 h-7 rounded-full bg-accent-subtle text-accent font-semibold flex items-center justify-center text-apple-12">
                {currentUser.avatar}
              </div>
              <div className="text-left hidden md:block">
                <div className="text-apple-12 font-semibold text-primary leading-tight">
                  {currentUser.name}
                </div>
                <div className="text-apple-11 text-secondary uppercase font-medium">
                  {currentUser.role}
                </div>
              </div>
              <ChevronDown className="w-3 h-3 text-secondary stroke-[1.5] hidden md:block" />
            </button>

            {/* Profile Dropdown Animated with Spring Physics */}
            <AnimatePresence>
              {isProfileOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -6 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="absolute right-0 mt-2 w-64 bg-surface border border-hairline shadow-apple rounded-2xl p-2 z-50 text-apple-12"
                >
                  {/* User summary header */}
                  <div className="px-3 py-2.5 border-b border-hairline">
                    <div className="font-semibold text-primary">{currentUser.name}</div>
                    <div className="text-apple-11 text-secondary truncate">{currentUser.email}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded text-apple-11 font-semibold uppercase text-accent bg-accent-subtle">
                        {currentUser.role}
                      </span>
                      <span className="text-apple-11 text-tertiary">
                        {currentUser.department || 'Audit'}
                      </span>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="py-1">
                    <button
                      onClick={() => {
                        openInspector('account_settings');
                        setIsProfileOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                    >
                      <Settings className="w-4 h-4 text-secondary stroke-[1.5]" />
                      <span>Account settings</span>
                    </button>
                    <button
                      onClick={() => {
                        openInspector('people');
                        setIsProfileOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                    >
                      <Users className="w-4 h-4 text-secondary stroke-[1.5]" />
                      <span>Team & permissions</span>
                    </button>

                    {/* Admin item: LIVES ONLY in profile menu, gated by role per § 3.1 */}
                    {canAccessAdmin && (
                      <button
                        onClick={() => {
                          openInspector('people');
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <ShieldAlert className="w-4 h-4 text-accent stroke-[1.5]" />
                          <span>Admin Console</span>
                        </div>
                        <span className="text-apple-11 font-medium text-accent bg-accent-subtle px-1.5 py-0.5 rounded">
                          Gated
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Switch viewpoint / sign out */}
                  <div className="pt-1 border-t border-hairline">
                    <div className="px-3 py-1 text-apple-11 text-tertiary uppercase font-medium">
                      Simulate Viewpoint
                    </div>
                    {availableUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setCurrentUser(u);
                          setIsProfileOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-apple-11 transition-colors flex items-center justify-between ${
                          u.id === currentUser.id
                            ? 'bg-accent-subtle text-accent font-semibold'
                            : 'text-secondary hover:text-primary hover:bg-surface-hover'
                        }`}
                      >
                        <span>{u.name} ({u.role})</span>
                        {u.id === currentUser.id && <span>✓</span>}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        setCurrentUser(availableUsers[0]);
                      }}
                      className="w-full text-left px-3 py-2 mt-1 rounded-xl text-cinnabar hover:bg-cinnabar-subtle transition-colors flex items-center gap-2.5"
                    >
                      <LogOut className="w-4 h-4 stroke-[1.5]" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
};
