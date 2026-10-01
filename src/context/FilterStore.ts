import { create } from 'zustand';

export interface FilterState {
  department: string | null;
  status: string | null;
  severity: string | null;
  dateRange: { start: string; end: string } | null;
  ownerId: string | null;
  searchQuery: string;

  setDepartment: (dept: string | null) => void;
  setStatus: (status: string | null) => void;
  setSeverity: (severity: string | null) => void;
  setDateRange: (range: { start: string; end: string } | null) => void;
  setOwnerId: (ownerId: string | null) => void;
  setSearchQuery: (query: string) => void;
  clearFilters: () => void;
  hasActiveFilters: () => boolean;
}

export const useFilterStore = create<FilterState>((set, get) => ({
  department: null,
  status: null,
  severity: null,
  dateRange: null,
  ownerId: null,
  searchQuery: '',

  setDepartment: (department) => set({ department }),
  setStatus: (status) => set({ status }),
  setSeverity: (severity) => set({ severity }),
  setDateRange: (dateRange) => set({ dateRange }),
  setOwnerId: (ownerId) => set({ ownerId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  clearFilters: () =>
    set({
      department: null,
      status: null,
      severity: null,
      dateRange: null,
      ownerId: null,
      searchQuery: '',
    }),

  hasActiveFilters: () => {
    const s = get();
    return Boolean(
      s.department || s.status || s.severity || s.dateRange || s.ownerId || s.searchQuery.trim()
    );
  },
}));
