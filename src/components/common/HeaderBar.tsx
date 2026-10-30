import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useScopedData } from '../../hooks/useScopedData';
import { hasRight } from '../../lib/rights';
import { PRODUCT_NAME } from '../../lib/product';
import { Select } from './Select';
import { HeaderCalendarPanel } from '../calendar/HeaderCalendarPanel';
import { NotificationBell } from './NotificationBell';
import {
  Calendar as CalendarIcon,
  Search,
  Sun,
  Moon,
  Laptop,
  Settings,
  Sliders,
  LogOut,
  ChevronDown,
  Building,
  Users,
  Upload,
  Activity,
  Zap,
  Eye,
} from './Icons';
import { motion, AnimatePresence } from 'motion/react';

interface HeaderBarProps {
  onOpenCommandPalette: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ onOpenCommandPalette }) => {
  const {
    currentUser,
    activeTab,
    setActiveTab,
    selectedUniverseId,
    setSelectedUniverseId,
    openInspector,
    setSelectedEngagementId,
  } = useApp();
  const { theme, setTheme } = useTheme();
  const { signOut } = useAuth();
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


  return (
    <header className="sticky top-0 z-40 w-full h-14 bg-glass border-b border-hairline shadow-apple select-none">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between gap-4">
        {/* Left: Logo & Wordmark in Serif Font */}
        <div className="flex items-center gap-5 shrink-0">
          <button
            onClick={() => setActiveTab('executive')}
            className="flex items-center gap-2.5 text-left group transition-opacity hover:opacity-85"
          >
            <div className="w-8 h-8 rounded-xl bg-primary text-canvas flex items-center justify-center font-bold text-apple-15 font-serif-title shadow-xs">
              P
            </div>
            <span className="font-serif-title text-apple-20 font-bold tracking-tight text-primary">
              {PRODUCT_NAME}
            </span>
          </button>

          {/* Universe Switcher: ONLY if user has access to multiple universes (inline on md+) */}
          {hasMultipleUniverses && (
            <div className="hidden md:flex items-center gap-1.5 pl-3 border-l border-hairline">
              <Select
                ariaLabel="Select audit universe"
                value={selectedUniverseId}
                onChange={(v) => setSelectedUniverseId(v || null)}
                icon={<Building className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />}
                options={scopedUniverses.map((u) => ({ value: u.id, label: `${u.name} (${u.code})`, hint: `${u.totalEntities} entities` }))}
              />
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

        {/* Center: search icon button on narrow screens (D15) — the full search field reflows away
            below the `sm` breakpoint, so an icon keeps the entry point reachable at 375px. */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          data-testid="header-search-compact"
          className="sm:hidden p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline text-secondary hover:text-primary transition-colors shadow-xs shrink-0"
          title="Search or jump to..."
          aria-label="Search or jump to"
        >
          <Search className="w-4 h-4 stroke-[1.5]" />
        </button>

        {/* Right Zone: Header Calendar Icon Button, Theme Toggle, Profile Menu */}
        <div className="flex items-center gap-2.5 shrink-0 relative">
          {/* §22 in-app notifications: a live bell, non-blocking popover. */}
          <NotificationBell />
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
                    {/* Universe switcher on narrow screens (D15): the inline switcher is hidden
                        below `md`, so the same choice is offered here instead of disappearing. */}
                    {hasMultipleUniverses && (
                      <div className="md:hidden px-3 py-2 border-b border-hairline mb-1" data-testid="mobile-universe-switcher">
                        <div className="text-apple-11 text-secondary uppercase font-medium mb-1">
                          Audit universe
                        </div>
                        <Select
                          ariaLabel="Select audit universe"
                          value={selectedUniverseId}
                          onChange={(v) => {
                            setSelectedUniverseId(v || null);
                            setIsProfileOpen(false);
                          }}
                          icon={<Building className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />}
                          options={scopedUniverses.map((u) => ({
                            value: u.id,
                            label: `${u.name} (${u.code})`,
                            hint: `${u.totalEntities} entities`,
                          }))}
                        />
                      </div>
                    )}
                    {(hasRight(currentUser, 'manage_users') || hasRight(currentUser, 'manage_roles')) && (
                      <button
                        onClick={() => {
                          openInspector('people_admin');
                          setIsProfileOpen(false);
                        }}
                        data-testid="menu-people-admin"
                        className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                      >
                        <Users className="w-4 h-4 text-secondary stroke-[1.5]" />
                        <span>People &amp; Roles</span>
                      </button>
                    )}
                    {/* Every signed-in member can see what a Head shared with them (WP2/WP6). */}
                    <button
                      onClick={() => {
                        openInspector('shared_with_me');
                        setIsProfileOpen(false);
                      }}
                      data-testid="menu-shared-with-me"
                      className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                    >
                      <Eye className="w-4 h-4 text-secondary stroke-[1.5]" />
                      <span>Shared with you</span>
                    </button>
                    {hasRight(currentUser, 'edit_config') && (
                      <button
                        onClick={() => {
                          openInspector('org_settings');
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                      >
                        <Sliders className="w-4 h-4 text-secondary stroke-[1.5]" />
                        <span>Organisation settings</span>
                      </button>
                    )}
                    {hasRight(currentUser, 'edit_config') && (
                      <button
                        onClick={() => {
                          openInspector('org_control');
                          setIsProfileOpen(false);
                        }}
                        data-testid="menu-org-control"
                        className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                      >
                        <Zap className="w-4 h-4 text-secondary stroke-[1.5]" />
                        <span>Assurance control plane</span>
                      </button>
                    )}
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
                    {hasRight(currentUser, 'manage_engagements') && (
                      <button
                        onClick={() => {
                          openInspector('import_wizard');
                          setIsProfileOpen(false);
                        }}
                        data-testid="menu-import"
                        className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                      >
                        <Upload className="w-4 h-4 text-secondary stroke-[1.5]" />
                        <span>Import</span>
                      </button>
                    )}
                    {hasRight(currentUser, 'manage_engagements') && (
                      <button
                        onClick={() => {
                          openInspector('activity_log');
                          setIsProfileOpen(false);
                        }}
                        data-testid="menu-activity-log"
                        className="w-full text-left px-3 py-2 rounded-xl text-primary hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                      >
                        <Activity className="w-4 h-4 text-secondary stroke-[1.5]" />
                        <span>Activity log</span>
                      </button>
                    )}
                  </div>

                  {/* Sign out ends the session. There is no account or role switching. */}
                  <div className="pt-1 border-t border-hairline">
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        signOut();
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
