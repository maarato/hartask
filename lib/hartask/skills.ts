import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { projectRootPath } from '@/lib/hartask/config';
import { recordEvent } from '@/lib/hartask/repositories/tasks';

/**
 * The skills Hartask ships, and putting them where a host will read them.
 *
 * They are files in this repository rather than rows, by the rule in
 * docs/WHERE-IT-GOES.md: a skill has to travel with a clone, and rows do not.
 * But a host does not read `hartask/skills/` — it reads `.claude/skills/` at
 * the root of the project. So the source being versioned is only half of it,
 * and installing is the other half.
 *
 * Installing writes into a project Hartask otherwise only observes, so it works
 * the same way exporting a role does: never automatic, never a side effect, and
 * the page shows the exact path and the exact text first.
 */

/** Where the bundled skills live, relative to the working directory. */
const SOURCE = 'skills';

export type BundledSkill = {
  name: string;
  /** The line a host reads to decide whether the skill applies. */
  description: string;
  content: string;
};

function frontmatterValue(content: string, key: string): string {
  // Deliberately shallow: the frontmatter here is written by this repository,
  // so a parser would be answering a question nobody is asking.
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

/**
 * Every skill this copy of Hartask carries.
 *
 * Read from disk rather than embedded, so a skill stays a markdown document
 * someone can read and edit in a review. Returns nothing rather than throwing
 * when the directory is absent — a Hartask running from somewhere without them
 * is missing a feature, not broken.
 */
export function bundledSkills(): BundledSkill[] {
  const root = resolve(process.cwd(), SOURCE);
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(root, entry.name, 'SKILL.md');
      if (!existsSync(file)) return null;
      const content = readFileSync(file, 'utf8');
      return {
        name: frontmatterValue(content, 'name') || entry.name,
        description: frontmatterValue(content, 'description'),
        content
      };
    })
    .filter((skill): skill is BundledSkill => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SkillInstall = { name: string; path: string; content: string; exists: boolean };

/** Where a skill would land in this project, and whether something is there. */
export function planSkillInstall(skill: BundledSkill): SkillInstall {
  const path = resolve(projectRootPath(), '.claude', 'skills', skill.name, 'SKILL.md');
  return { name: skill.name, path, content: skill.content, exists: existsSync(path) };
}

/**
 * Installs one skill. Refuses anything that would land outside the project.
 *
 * The name comes from frontmatter this repository wrote, so it cannot hold a
 * separator — the resolved path is checked anyway, because the cost of being
 * wrong is writing into a directory the user never pointed at.
 */
export function installSkill(skill: BundledSkill): SkillInstall {
  const plan = planSkillInstall(skill);
  const root = projectRootPath();
  const inside = relative(root, plan.path);

  if (inside.startsWith('..') || inside.startsWith(sep) || !inside) {
    throw new Error(`Refusing to write outside the project: ${plan.path}`);
  }

  mkdirSync(dirname(plan.path), { recursive: true });
  writeFileSync(plan.path, plan.content, 'utf8');

  recordEvent({
    eventType: 'SKILL_INSTALLED',
    summary: `${skill.name} instalada en ${inside}`,
    payload: { name: skill.name, path: inside, overwrote: plan.exists },
    agentId: 'human'
  });

  return { ...plan, exists: true };
}
