import { HARTASK_FIRST_RUN } from '@/lib/hartask/contract';
import { getLatestHandoff } from '@/lib/hartask/repositories/handoff';
import { listTasks } from '@/lib/hartask/repositories/tasks';

/**
 * True while the project has never been used.
 *
 * Archived tasks count: a board that was filled and then cleared is not a
 * fresh install, and telling that agent to migrate a task file would be wrong.
 */
export function isFirstRun(): boolean {
  if (getLatestHandoff() !== null) return false;
  return listTasks({ includeArchived: true }).length === 0;
}

export type Onboarding = { first_run: true; instructions: string };

/** The onboarding block /api/context returns on a first run, or null. */
export function onboarding(): Onboarding | null {
  return isFirstRun() ? { first_run: true, instructions: HARTASK_FIRST_RUN } : null;
}
