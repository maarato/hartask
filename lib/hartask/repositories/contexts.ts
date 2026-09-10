import { getDb } from '@/lib/db/client';
import { localOrigin, localStamp, nextLamport } from '@/lib/hartask/sync/identity';
import { normalizeCategory, recordEvent } from '@/lib/hartask/repositories/tasks';
import type { SharedContext, SharedContextSummary } from '@/lib/hartask/types';

/**
 * Shared contexts: documents an agent writes for the next agent, and for the
 * one on another machine.
 *
 * They are mutable on purpose. A handoff is a point in time and reads as
 * history; a document claims to be current, so writing the same slug corrects
 * it in place rather than adding a version. What was there before is not kept:
 * the previous text is in the event trail's summary, not in a second row.
 */

const COLUMNS_WITHOUT_BODY = `id, uuid, origin, lamport, slug, title, purpose,
  category, valid_as_of, created_at, updated_at`;

/**
 * A document's name has to survive being typed twice.
 *
 * Accents are folded and everything that is not a letter or digit becomes a
 * hyphen, so "Decisiones descartadas" and "decisiones-descartadas" are one
 * document rather than two. A slug that normalises to nothing is rejected
 * rather than stored as an empty name.
 */
export function normalizeSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    // NFD splits an accent off its letter; \p{M} then drops the loose mark.
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) throw new Error(`Not a usable slug: ${JSON.stringify(value)}`);
  return slug;
}

/** Every document, without its body, in the order a reader would scan them. */
export function listContexts(): SharedContextSummary[] {
  return getDb()
    .prepare(
      `SELECT ${COLUMNS_WITHOUT_BODY} FROM shared_contexts
       ORDER BY category IS NULL, category COLLATE NOCASE ASC, title COLLATE NOCASE ASC`
    )
    .all() as SharedContextSummary[];
}

/**
 * What a briefing carries: enough to decide whether to open a document, and
 * nothing more.
 *
 * The listing is the guard that keeps this collection from becoming
 * write-only, so it has to stay cheap enough to include unconditionally —
 * which means no bodies, and none of the sync bookkeeping a reader has no use
 * for. `valid_as_of` is in, because a document that claims to be current is
 * worth less than one that says when it last was.
 */
export function contextIndex(): {
  slug: string;
  title: string;
  purpose: string | null;
  category: string | null;
  valid_as_of: string | null;
  updated_at: string;
}[] {
  return listContexts().map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    purpose: doc.purpose,
    category: doc.category,
    valid_as_of: doc.valid_as_of,
    updated_at: doc.updated_at
  }));
}

export function getContext(slug: string): SharedContext | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM shared_contexts WHERE slug = ?`)
      .get(normalizeSlug(slug)) as SharedContext | undefined) ?? null
  );
}

export type WriteContextInput = {
  slug: string;
  /** Required the first time; leaving it out later keeps the current one. */
  title?: string;
  purpose?: string | null;
  body?: string | null;
  category?: string | null;
  validAsOf?: string | null;
  agentId?: string | null;
};

const FIELDS: { key: keyof WriteContextInput; column: string }[] = [
  { key: 'title', column: 'title' },
  { key: 'purpose', column: 'purpose' },
  { key: 'body', column: 'body' },
  { key: 'category', column: 'category' },
  { key: 'validAsOf', column: 'valid_as_of' }
];

/**
 * Writes a document, creating it or correcting it in place.
 *
 * A field left out keeps whatever the document already says, so an agent can
 * fix the body without having to restate the title and purpose it did not come
 * to change. On a new document the title is required: a document nobody can
 * name is one nobody will open.
 */
export function writeContext(input: WriteContextInput): SharedContext {
  const db = getDb();
  const slug = normalizeSlug(input.slug);

  const run = db.transaction((): SharedContext => {
    const current = db.prepare(`SELECT * FROM shared_contexts WHERE slug = ?`).get(slug) as
      | SharedContext
      | undefined;

    const value = (key: keyof WriteContextInput): unknown => {
      const given = input[key];
      // The category shares the board's vocabulary, so it goes through the
      // same normalisation and picks up an existing spelling.
      return key === 'category' ? normalizeCategory(given as string | null) : given;
    };

    if (!current) {
      if (!input.title?.trim()) {
        throw new Error(`A new context needs a title: ${slug}`);
      }
      const stamp = localStamp();
      db.prepare(
        `INSERT INTO shared_contexts
           (uuid, origin, lamport, slug, title, purpose, body, category, valid_as_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stamp.uuid,
        stamp.origin,
        stamp.lamport,
        slug,
        input.title.trim(),
        input.purpose ?? null,
        input.body ?? null,
        normalizeCategory(input.category),
        input.validAsOf ?? null
      );
    } else {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const { key, column } of FIELDS) {
        if (input[key] === undefined) continue;
        sets.push(`${column} = ?`);
        params.push(value(key));
      }
      // A write with nothing in it still moves the clock, because an agent
      // saying "this is still true" is a real edit of a document that claims
      // to be current.
      sets.push(`updated_at = CURRENT_TIMESTAMP`, `lamport = ?`, `origin = ?`);
      params.push(nextLamport(), localOrigin().id);
      db.prepare(`UPDATE shared_contexts SET ${sets.join(', ')} WHERE id = ?`).run(
        ...params,
        current.id
      );
    }

    const written = db
      .prepare(`SELECT * FROM shared_contexts WHERE slug = ?`)
      .get(slug) as SharedContext;

    recordEvent({
      eventType: current ? 'CONTEXT_UPDATED' : 'CONTEXT_CREATED',
      summary: `${written.slug}: ${written.title}`,
      agentId: input.agentId ?? null
    });

    return written;
  });

  return run();
}

/** Removes a document. Returns whether there was one to remove. */
export function removeContext(slug: string, agentId?: string | null): boolean {
  const db = getDb();
  const normalized = normalizeSlug(slug);

  const run = db.transaction((): boolean => {
    const current = db
      .prepare(`SELECT slug, title FROM shared_contexts WHERE slug = ?`)
      .get(normalized) as { slug: string; title: string } | undefined;
    if (!current) return false;

    db.prepare(`DELETE FROM shared_contexts WHERE slug = ?`).run(normalized);
    recordEvent({
      eventType: 'CONTEXT_REMOVED',
      summary: `${current.slug}: ${current.title}`,
      agentId: agentId ?? null
    });
    return true;
  });

  return run();
}

export function countContexts(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS total FROM shared_contexts`).get() as {
    total: number;
  };
  return row.total;
}
