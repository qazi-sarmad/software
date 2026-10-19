/**
 * Setup wizards (F17).
 *
 * Two linear, persisted wizards — the Org Admin wizard and the Super Admin wizard — share this
 * module. A step's state is data (scope, step key, status, saved answers), saved as the user
 * moves. Components never import the database client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type SetupScope = 'org_admin' | 'super_admin';
/** The three statuses the database accepts (setup_save_step). */
export type StepStatus = 'pending' | 'done' | 'skipped';
/** A step with no saved row yet reads as not_started; that value is never written. */
export type StepState = StepStatus | 'not_started';

export interface SetupStep {
  stepKey: string;
  status: StepState;
  answerRef: Record<string, unknown>;
  updatedAt: string;
}

const NOT_CONFIGURED = 'The setup module is not configured.';

export async function listSetupSteps(scope: SetupScope): Promise<SetupStep[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('setup_list', { p_scope: scope });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    stepKey: r.step_key as string,
    status: (r.status as StepStatus) ?? 'not_started',
    answerRef: (r.answer_ref as Record<string, unknown>) ?? {},
    updatedAt: r.updated_at as string,
  }));
}

export function saveSetupStep(
  scope: SetupScope, stepKey: string, status: StepStatus,
  answerRef: Record<string, unknown> = {}
): Promise<DataResult> {
  return callRpc(
    'setup_save_step',
    { p_scope: scope, p_step_key: stepKey, p_status: status, p_answer_ref: answerRef },
    NOT_CONFIGURED
  );
}

/** The fraction of steps done, for the wizard progress bar. */
export function setupProgress(steps: SetupStep[], totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return Math.min(1, done / totalSteps);
}
