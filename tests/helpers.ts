import { getDb } from '@/lib/db/client';

/**
 * Empties every table between tests so each one starts from a known board.
 * AUTOINCREMENT counters are reset too, which is what makes assertions on
 * generated public ids (TASK-001) meaningful.
 */
export function resetDb(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM task_events;
    DELETE FROM task_notes;
    DELETE FROM prompt_runs;
    DELETE FROM prompts;
    DELETE FROM project_handoff;
    DELETE FROM tasks;
    DELETE FROM projects;
    DELETE FROM sqlite_sequence;
  `);
}
