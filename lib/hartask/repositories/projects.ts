import { getDb } from '@/lib/db/client';
import { loadConfig, projectRootPath } from '@/lib/hartask/config';
import type { Project } from '@/lib/hartask/types';

/**
 * Hartask is deliberately single-project (one instance lives inside one repo),
 * so "the project" is always the first row.
 */
export function getProject(): Project | null {
  const row = getDb().prepare(`SELECT * FROM projects ORDER BY id LIMIT 1`).get();
  return (row as Project | undefined) ?? null;
}

/** Returns the project row, creating it from hartask.config.json on first run. */
export function ensureProject(): Project {
  const existing = getProject();
  if (existing) return existing;

  const db = getDb();
  const { projectName } = loadConfig();
  const info = db
    .prepare(`INSERT INTO projects (name, root_path) VALUES (?, ?)`)
    .run(projectName, projectRootPath());

  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(info.lastInsertRowid) as Project;
}

export function updateProjectSummary(summary: string): Project {
  const project = ensureProject();
  const db = getDb();
  db.prepare(
    `UPDATE projects SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(summary, project.id);
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(project.id) as Project;
}
