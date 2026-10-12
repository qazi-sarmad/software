export function resolveDataMode(env: Record<string, unknown>): 'demo' | 'supabase' | 'unconfigured' {
  if (env.VITE_DATA_MODE === 'demo') return 'demo';
  if (env.VITE_DATA_MODE === 'supabase') return 'supabase';
  return env.DEV && !env.VITE_DATA_MODE ? 'demo' : 'unconfigured';
}
export const dataMode = resolveDataMode(import.meta.env);
