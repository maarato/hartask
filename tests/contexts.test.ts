import { beforeEach, describe, expect, it } from 'vitest';
import {
  countContexts,
  getContext,
  listContexts,
  normalizeSlug,
  removeContext,
  writeContext
} from '@/lib/hartask/repositories/contexts';
import { createTask, listEvents } from '@/lib/hartask/repositories/tasks';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('normalizeSlug', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(normalizeSlug('Decisiones Descartadas')).toBe('decisiones-descartadas');
  });

  it('folds accents, so the same name typed twice is one document', () => {
    expect(normalizeSlug('categorías')).toBe(normalizeSlug('categorias'));
  });

  it('collapses punctuation and trims the hyphens it leaves behind', () => {
    expect(normalizeSlug('  ¿qué se probó?  ')).toBe('que-se-probo');
  });

  it('refuses a name that normalises to nothing, rather than storing it blank', () => {
    expect(() => normalizeSlug('!!!')).toThrow(/slug/i);
  });
});

describe('writeContext', () => {
  it('creates a document addressed by its slug', () => {
    const doc = writeContext({
      slug: 'decisions',
      title: 'Decisiones tomadas y descartadas',
      purpose: 'Que se probo y que se revirtio',
      body: '# Decisiones'
    });

    expect(doc.slug).toBe('decisions');
    expect(getContext('decisions')?.title).toBe('Decisiones tomadas y descartadas');
  });

  // A handoff is a point in time; a document claims to be current. Writing the
  // same slug has to correct it, not stack a second version behind it.
  it('corrects a document in place instead of adding a version', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones', body: 'primera version' });
    writeContext({ slug: 'decisions', body: 'segunda version' });

    expect(countContexts()).toBe(1);
    expect(getContext('decisions')?.body).toBe('segunda version');
  });

  it('keeps the fields the writer did not come to change', () => {
    writeContext({
      slug: 'decisions',
      title: 'Decisiones',
      purpose: 'Que se revirtio y por que',
      body: 'primera'
    });

    const updated = writeContext({ slug: 'decisions', body: 'segunda' });

    expect(updated.title).toBe('Decisiones');
    expect(updated.purpose).toBe('Que se revirtio y por que');
  });

  it('reaches the same document however the slug was typed', () => {
    writeContext({ slug: 'Decisiones Descartadas', title: 'Decisiones' });
    writeContext({ slug: 'decisiones-descartadas', body: 'texto' });

    expect(countContexts()).toBe(1);
  });

  it('refuses a new document with no title, because nobody would open it', () => {
    expect(() => writeContext({ slug: 'sin-titulo', body: 'algo' })).toThrow(/title/i);
  });

  it('shares the board vocabulary, reusing a category spelling that exists', () => {
    createTask({ title: 'una task', category: 'Sync' });

    expect(writeContext({ slug: 'merge', title: 'Merge', category: 'sync' }).category).toBe('Sync');
  });

  it('records the write as a project-level event, not against a task', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones' });
    writeContext({ slug: 'decisions', body: 'corregido' });

    const events = listEvents({ limit: 10 }).filter((event) =>
      event.event_type.startsWith('CONTEXT_')
    );
    expect(events.map((event) => event.event_type)).toEqual([
      'CONTEXT_UPDATED',
      'CONTEXT_CREATED'
    ]);
    expect(events.every((event) => event.task_id === null)).toBe(true);
  });

  it('moves the clock on every write, so a merge can order two machines', () => {
    const created = writeContext({ slug: 'decisions', title: 'Decisiones' });
    const updated = writeContext({ slug: 'decisions', body: 'corregido' });

    expect(updated.lamport).toBeGreaterThan(created.lamport);
  });

  it('carries the task it was last true as of', () => {
    const doc = writeContext({ slug: 'verification', title: 'Verificacion', validAsOf: 'TASK-065' });

    expect(doc.valid_as_of).toBe('TASK-065');
  });
});

describe('listContexts', () => {
  // Knowing what exists must never cost the price of reading everything, or
  // the collection becomes write-only.
  it('leaves the body out, so a listing stays cheap', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones', body: 'un cuerpo muy largo' });

    const listed = listContexts()[0] as Record<string, unknown>;

    expect(listed.title).toBe('Decisiones');
    expect('body' in listed).toBe(false);
  });

  it('groups by category and orders by title, with the uncategorised last', () => {
    writeContext({ slug: 'z-sin', title: 'Zeta sin categoria' });
    writeContext({ slug: 'b-ui', title: 'Beta', category: 'ui' });
    writeContext({ slug: 'a-ui', title: 'Alfa', category: 'ui' });

    expect(listContexts().map((doc) => doc.slug)).toEqual(['a-ui', 'b-ui', 'z-sin']);
  });
});

describe('removeContext', () => {
  it('removes the document and says it did', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones' });

    expect(removeContext('decisions')).toBe(true);
    expect(getContext('decisions')).toBeNull();
  });

  it('reports that there was nothing to remove rather than throwing', () => {
    expect(removeContext('no-existe')).toBe(false);
  });

  it('leaves the removal in the event trail', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones' });
    removeContext('decisions');

    expect(listEvents({ limit: 5 })[0].event_type).toBe('CONTEXT_REMOVED');
  });
});
