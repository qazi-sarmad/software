import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check } from './Icons';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectProps {
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  icon?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** Accessible listbox dropdown (keyboard: Up/Down/Home/End/Enter/Esc). Tokens only. */
export const Select: React.FC<SelectProps> = ({ value, options, onChange, ariaLabel, icon, align = 'left', className = '' }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === current?.value)));
    setOpen(true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i + options.length - 1) % options.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChange(options[active].value);
      setOpen(false);
    }
  };

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        className="h-9 pl-2.5 pr-2 rounded-xl border border-hairline bg-surface-elevated hover:bg-surface-hover text-apple-12 font-medium text-primary flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-accent max-w-[260px]"
      >
        {icon}
        <span className="truncate">{current?.label ?? '—'}</span>
        <ChevronDown className="w-3.5 h-3.5 stroke-[1.5] text-secondary shrink-0" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ transformOrigin: align === 'right' ? 'top right' : 'top left' }}
            className={`absolute top-full mt-1.5 ${align === 'right' ? 'right-0' : 'left-0'} min-w-[240px] max-h-72 overflow-y-auto p-1.5 rounded-xl bg-surface border border-hairline shadow-apple z-[60]`}
          >
            {options.map((o, i) => {
              const selected = o.value === current?.value;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`px-2.5 py-2 rounded-lg cursor-pointer flex items-center justify-between gap-3 ${i === active ? 'bg-surface-hover' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block text-apple-13 text-primary truncate">{o.label}</span>
                    {o.hint && <span className="block text-apple-11 text-tertiary truncate">{o.hint}</span>}
                  </span>
                  {selected && <Check className="w-3.5 h-3.5 stroke-[2] text-verdigris shrink-0" />}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
};
