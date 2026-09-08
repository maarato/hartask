import { getDb } from '@/lib/db/client';
import { scanHarness, type DetectedComponent } from '@/lib/hartask/harness/scanner';

/**
 * Harness metadata, persisted so the view has something to show without
 * touching the disk on every render — and so a change between scans is
 * visible as a changed hash rather than being invisible.
 *
 * These rows describe one machine's filesystem, which is why they are the
 * tables that stay out of sync.
 */

export type HarnessComponent = {
  id: number;
  type: string;
  name: string;
  path: string | null;
  runtime: string | null;
  scope: string | null;
  metadata_json: string | null;
  content_hash: string | null;
  last_scan_at: string | null;
};

export type HarnessScan = {
  id: number;
  started_at: string;
  finished_at: string | null;
  summary_json: string | null;
};

export function listHarnessComponents(): HarnessComponent[] {
  return getDb()
    .prepare(`SELECT * FROM harness_components ORDER BY type ASC, name ASC`)
    .all() as HarnessComponent[];
}

export function lastHarnessScan(): HarnessScan | null {
  const row = getDb().prepare(`SELECT * FROM harness_scans ORDER BY id DESC LIMIT 1`).get();
  return (row as HarnessScan | undefined) ?? null;
}

export type ScanResult = {
  scan: HarnessScan;
  components: HarnessComponent[];
  summary: { found: number; by_type: Record<string, number>; changed: number };
};

/**
 * Rescans and replaces what was stored.
 *
 * The previous rows are replaced rather than merged: a component that was
 * deleted from disk has to disappear from the view, and a merge would leave it
 * there forever. The count of changed hashes is kept in the scan summary, so
 * what moved between scans is still answerable.
 */
export function runHarnessScan(): ScanResult {
  const db = getDb();

  const run = db.transaction((): ScanResult => {
    const info = db.prepare(`INSERT INTO harness_scans (summary_json) VALUES (NULL)`).run();
    const detected: DetectedComponent[] = scanHarness();

    const previous = new Map(
      listHarnessComponents().map((row) => [`${row.type}:${row.name}:${row.path}`, row.content_hash])
    );
    let changed = 0;

    db.prepare(`DELETE FROM harness_components`).run();

    const insert = db.prepare(
      `INSERT INTO harness_components (type, name, path, runtime, scope, metadata_json, content_hash, last_scan_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );

    const byType: Record<string, number> = {};
    for (const component of detected) {
      const key = `${component.type}:${component.name}:${component.path}`;
      const before = previous.get(key);
      if (before !== undefined && before !== component.contentHash) changed++;

      insert.run(
        component.type,
        component.name,
        component.path,
        component.runtime,
        component.scope,
        JSON.stringify(component.metadata),
        component.contentHash
      );
      byType[component.type] = (byType[component.type] ?? 0) + 1;
    }

    const summary = { found: detected.length, by_type: byType, changed };
    db.prepare(
      `UPDATE harness_scans SET finished_at = CURRENT_TIMESTAMP, summary_json = ? WHERE id = ?`
    ).run(JSON.stringify(summary), info.lastInsertRowid);

    return {
      scan: db
        .prepare(`SELECT * FROM harness_scans WHERE id = ?`)
        .get(info.lastInsertRowid) as HarnessScan,
      components: listHarnessComponents(),
      summary
    };
  });

  return run();
}
