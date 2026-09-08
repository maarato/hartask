import { getDb } from '@/lib/db/client';
import { loadConfig, projectRootPath } from '@/lib/hartask/config';
import { newUuid } from '@/lib/hartask/sync/identity';
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
    .prepare(`INSERT INTO projects (uuid, name, root_path) VALUES (?, ?, ?)`)
    .run(newUuid(), projectName, projectRootPath());

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

/**
 * The project row keeps its own name, so renaming from settings has to reach
 * it too — otherwise the change would save and nothing visible would change.
 */
export function renameProject(name: string): Project {
  const project = ensureProject();
  const db = getDb();
  db.prepare(`UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    name,
    project.id
  );
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(project.id) as Project;
}
