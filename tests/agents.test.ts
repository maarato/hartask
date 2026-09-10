import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import {
  composeAgentBrief,
  planAgentExport,
  writeAgentExport
} from '@/lib/hartask/agents';
import {
  contextIndex,
  countContexts,
  getContext,
  listContexts,
  writeContext
} from '@/lib/hartask/repositories/contexts';
import { listEvents } from '@/lib/hartask/repositories/tasks';
import { runHarnessScan } from '@/lib/hartask/repositories/harness';
import { resetDb } from './helpers';

/**
 * Roles share a table with documents, which is only defensible while telling
 * them apart costs one column. These pin that: the two never leak into each
 * other's listings, and the half of a brief that would go stale is generated
 * rather than typed.
 */

/** A throwaway project on disk, so a scan finds what this test put there. */
let project: string;

function writeInProject(relativePath: string, content: string): void {
  const absolute = join(project, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

beforeEach(() => {
  resetDb();
  project = mkdtempSync(join(tmpdir(), 'hartask-agents-'));
  process.env.HARTASK_CONFIG = join(project, 'hartask.config.json');
  writeFileSync(
    process.env.HARTASK_CONFIG,
    JSON.stringify({ projectRoot: project, harnessScan: { enabled: true, paths: ['.claude'] } }),
    'utf8'
  );
  delete process.env.HARTASK_PORT;
  resetConfigCache();
});

afterEach(() => {
  delete process.env.HARTASK_CONFIG;
  delete process.env.HARTASK_PORT;
  resetConfigCache();
});

describe('roles and documents share a table without mixing', () => {
  it('keeps each kind out of the other listing', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones' });
    writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    expect(listContexts('doc').map((row) => row.slug)).toEqual(['decisions']);
    expect(listContexts('agent').map((row) => row.slug)).toEqual(['arquitecto']);
  });

  // The index rides in every briefing. A role appearing there as a document
  // would send an agent to read a brief meant for someone else.
  it('leaves roles out of the briefing index', () => {
    writeContext({ slug: 'decisions', title: 'Decisiones' });
    writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    expect(contextIndex().map((row) => row.slug)).toEqual(['decisions']);
    expect(countContexts()).toBe(1);
    expect(countContexts('agent')).toBe(1);
  });

  it('answers nothing when a slug is asked for as the wrong kind', () => {
    writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    expect(getContext('arquitecto', 'agent')).not.toBeNull();
    expect(getContext('arquitecto', 'doc')).toBeNull();
  });

  it('defaults to a document, so nothing becomes a role by omission', () => {
    expect(writeContext({ slug: 'decisions', title: 'Decisiones' }).kind).toBe('doc');
  });

  // A row does not change what it is: correcting a role must not be able to
  // turn it into a document, or a briefing index would gain one silently.
  it('does not let a later write change what a row is', () => {
    writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });
    writeContext({ slug: 'arquitecto', kind: 'doc', body: 'corregido' });

    expect(getContext('arquitecto')!.kind).toBe('agent');
  });
});

describe('composeAgentBrief', () => {
  it('puts the role first and the machinery after it', () => {
    const role = writeContext({
      slug: 'arquitecto',
      kind: 'agent',
      title: 'Arquitecto',
      purpose: 'Cuando hay que decidir una forma',
      body: 'Mira primero los limites entre modulos.'
    });

    const brief = composeAgentBrief(role);

    expect(brief.indexOf('Mira primero')).toBeLessThan(brief.indexOf('## Hartask'));
    expect(brief).toContain('Arquitecto');
  });

  /**
   * The whole argument for a role living in Hartask rather than in a file: a
   * file that says 43127 is wrong the moment a second project takes a port of
   * its own.
   */
  it('names the port this instance is actually on', () => {
    process.env.HARTASK_PORT = '43222';
    resetConfigCache();

    const role = writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    const brief = composeAgentBrief(role);
    expect(brief).toContain('http://localhost:43222');
    expect(brief).not.toContain('43127');
  });

  it('names the skills the scan actually found, not the ones a roadmap promises', () => {
    writeInProject('.claude/skills/hartask-task-workflow/SKILL.md', '# workflow');
    runHarnessScan();
    const role = writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    expect(composeAgentBrief(role)).toContain('hartask-task-workflow');
  });

  it('says the harness is unscanned rather than implying there is nothing', () => {
    const role = writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    expect(composeAgentBrief(role)).toMatch(/scanned into the harness yet/i);
  });

  it('carries the contract every agent is held to', () => {
    const role = writeContext({ slug: 'arquitecto', kind: 'agent', title: 'Arquitecto' });

    expect(composeAgentBrief(role)).toMatch(/Never access hartask\.sqlite directly/i);
  });
});


/**
 * Exporting is the only thing Hartask writes into a project it otherwise only
 * observes, so what it writes and where has to be pinned rather than trusted.
 */
describe('exporting a role into a host', () => {
  function role() {
    return writeContext({
      slug: 'arquitecto',
      kind: 'agent',
      title: 'Arquitecto',
      purpose: 'Cuando hay que decidir una forma',
      body: 'Mira primero los limites.'
    });
  }

  it('lands where the scanner already looks, so the next scan finds it', () => {
    const claude = planAgentExport(role(), 'claude');
    const cursor = planAgentExport(role(), 'cursor');

    expect(claude.path.endsWith(join('.claude', 'agents', 'arquitecto.md'))).toBe(true);
    expect(cursor.path.endsWith(join('.cursor', 'rules', 'arquitecto.mdc'))).toBe(true);
  });

  // The host reads the description to decide whether to invoke the role. A
  // frontmatter that does not parse makes the file inert rather than loud.
  it('gives the host a frontmatter it can read', () => {
    const plan = planAgentExport(role(), 'claude');

    expect(plan.content.split(String.fromCharCode(10))[0]).toBe('---');
    expect(plan.content).toContain('name: "arquitecto"');
    expect(plan.content).toContain('description: "Cuando hay que decidir una forma"');
    expect(plan.content).toContain('Mira primero los limites.');
  });

  it('plans without writing, because the preview is what the user agreed to', () => {
    const plan = planAgentExport(role(), 'claude');

    expect(existsSync(plan.path)).toBe(false);
    expect(plan.exists).toBe(false);
  });

  it('writes the file and says the export happened', () => {
    const written = writeAgentExport(role(), 'claude');

    expect(readFileSync(written.path, 'utf8')).toBe(written.content);
    expect(listEvents({ limit: 5 })[0].event_type).toBe('AGENT_EXPORTED');
  });

  it('says a file is already there rather than overwriting it quietly', () => {
    writeAgentExport(role(), 'claude');

    expect(planAgentExport(role(), 'claude').exists).toBe(true);
  });

  it('carries the composed connection section, not just what was typed', () => {
    process.env.HARTASK_PORT = '43222';
    resetConfigCache();

    expect(writeAgentExport(role(), 'cursor').content).toContain('http://localhost:43222');
  });

  it('stays inside the project it was pointed at', () => {
    const plan = planAgentExport(role(), 'claude');

    expect(plan.path.startsWith(project)).toBe(true);
  });
});
