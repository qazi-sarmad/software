import { createContext, useContext } from 'react';
// Tiny, dependency-free bridge so demo screens can detect live (Supabase) mode without importing the Supabase SDK.
export interface LiveStore {
  userId: string | null;
  snapshot: { cases: unknown[]; entities: { id: string; name: string }[]; issued: { id: string; report: { id: string; title: string }; issues: { id: string; severity: string; condition: string; status: string }[] }[] };
  error: string;
  busy: boolean;
  retryAvailable: boolean;
  retry: () => Promise<void>;
  signOut: () => Promise<void>;
}
export const LiveContext = createContext<LiveStore | null>(null);
export function useOptionalLive(): LiveStore | null { return useContext(LiveContext); }
