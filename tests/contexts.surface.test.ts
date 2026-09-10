import { beforeEach, describe, expect, it } from 'vitest';
import { contextIndex, writeContext } from '@/lib/hartask/repositories/contexts';
import { resetDb } from './helpers';

/**
 * The index is the guard that decides whether shared contexts are useful or
 * dead weight: an agent that has to already know a document exists in order to
 * find it will never read one. So what a briefing carries is pinned here.
 */

beforeEach(() => resetDb());

describe('contextIndex', () => {
  it('carries what a reader needs to decide whether to open a document', () => {
    writeContext({
      slug: 'decisions',
      title: 'Decisiones tomadas y descartadas',
      purpose: 'Que se probo y que se revirtio',
      category: 'docs',
      validAsOf: 'TASK-066',
      body: 'un cuerpo largo'
    });

    expect(contextIndex()).toEqual([
      {
        slug: 'decisions',
        title: 'Decisiones tomadas y descartadas',
        purpose: 'Que se probo y que se revirtio',
        category: 'docs',
        valid_as_of: 'TASK-066',
        updated_at: expect.any(String)
      }
    ]);
  });

  // The index goes into every briefing, so a body in it would make the
  // cold-start payload grow with every document ever written.
  it('never carries a body', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones', body: 'un cuerpo muy largo' });

    expect(JSON.stringify(contextIndex())).not.toContain('un cuerpo muy largo');
  });

  it('carries none of the sync bookkeeping a reader has no use for', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones' });

    const entry = contextIndex()[0] as Record<string, unknown>;
    for (const noise of ['id', 'uuid', 'origin', 'lamport']) {
      expect(noise in entry).toBe(false);
    }
  });

  it('is empty rather than absent when nothing has been written', () => {
    expect(contextIndex()).toEqual([]);
  });
});
