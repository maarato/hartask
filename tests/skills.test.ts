import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import { listHarnessComponents, runHarnessScan } from '@/lib/hartask/repositories/harness';
import { listEvents } from '@/lib/hartask/repositories/tasks';
import { bundledSkills, installSkill, planSkillInstall } from '@/lib/hartask/skills';
import { resetDb } from './helpers';

/**
 * The skills are files in this repository, and a host reads `.claude/skills/`
 * at the project root — so shipping them and installing them are two different
 * things, and only the second one makes them real.
 */

let project: string;

beforeEach(() => {
  resetDb();
  project = mkdtempSync(join(tmpdir(), 'hartask-skills-'));
  process.env.HARTASK_CONFIG = join(project, 'hartask.config.json');
  writeFileSync(
    process.env.HARTASK_CONFIG,
    JSON.stringify({ projectRoot: project, harnessScan: { enabled: true, paths: ['.claude'] } }),
    'utf8'
  );
  resetConfigCache();
});

afterEach(() => {
  delete process.env.HARTASK_CONFIG;
  resetConfigCache();
});

describe('the skills Hartask ships', () => {
  it('carries the set the project has been proposing', () => {
    const names = bundledSkills().map((skill) => skill.name);

    expect(names).toEqual([
      'hartask-board-view',
      'hartask-harness-inspector',
      'hartask-project-context',
      'hartask-prompt-runner',
      'hartask-session-handoff',
      'hartask-shared-context',
      'hartask-task-workflow'
    ]);
  });

  // The description is the only thing a host reads to decide whether a skill
  // applies. One without it is installed and never triggers.
  it('gives every skill a description a host can trigger on', () => {
    for (const skill of bundledSkills()) {
      expect(skill.description.length).toBeGreaterThan(20);
      expect(skill.content.split('\n')[0]).toBe('---');
    }
  });

  // Against the directory listing, not against itself: planSkillInstall builds
  // the path out of the same name it was handed, so asserting the path here
  // would agree with whatever the frontmatter said.
  it('names each skill the same in its frontmatter and its directory', () => {
    const directories = readdirSync('skills', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    expect(bundledSkills().map((skill) => skill.name)).toEqual(directories);
  });
});

describe('installing one into a project', () => {
  it('plans without writing, because the preview is what the user agreed to', () => {
    const plan = planSkillInstall(bundledSkills()[0]);

    expect(existsSync(plan.path)).toBe(false);
    expect(plan.exists).toBe(false);
  });

  it('writes the file and records that it happened', () => {
    const installed = installSkill(bundledSkills()[0]);

    expect(readFileSync(installed.path, 'utf8')).toBe(installed.content);
    expect(listEvents({ limit: 5 })[0].event_type).toBe('SKILL_INSTALLED');
  });

  it('says one is already there rather than overwriting it quietly', () => {
    const skill = bundledSkills()[0];
    installSkill(skill);

    expect(planSkillInstall(skill).exists).toBe(true);
  });

  /**
   * The loop that decides whether any of this is real: a skill Hartask
   * installed has to be a skill Hartask's own scanner then finds, or it landed
   * somewhere no host reads.
   */
  it('lands where the scanner finds it', () => {
    const skill = bundledSkills()[0];
    installSkill(skill);

    runHarnessScan();

    const found = listHarnessComponents().filter((component) => component.type === 'skill');
    expect(found.map((component) => component.name)).toContain(skill.name);
  });

  it('stays inside the project it was pointed at', () => {
    expect(planSkillInstall(bundledSkills()[0]).path.startsWith(project)).toBe(true);
  });
});
