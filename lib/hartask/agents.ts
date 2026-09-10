import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfig, projectRootPath } from '@/lib/hartask/config';
import { HARTASK_AGENT_CONTRACT } from '@/lib/hartask/contract';
import { listHarnessComponents } from '@/lib/hartask/repositories/harness';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { recordEvent } from '@/lib/hartask/repositories/tasks';
import type { SharedContext } from '@/lib/hartask/types';

/**
 * Composes a role brief with the way to reach *this* Hartask.
 *
 * The reason this belongs to Hartask rather than to a folder of files: a file
 * that says `localhost:43127` is wrong the moment a second project takes a port
 * of its own, and a role that lists skills is wrong the moment the scan finds
 * different ones. Hartask is the only thing that knows what is true right now,
 * so the connection half is generated at read time and only the role half is
 * written by a person.
 *
 * Nothing here touches the disk. The composed text is meant to be handed to an
 * agent at the start of a session; writing it into a host's own format is a
 * separate, explicit step, because Hartask observes the disk and does not own
 * it.
 */

function connectionSection(): string {
  const config = loadConfig();
  const base = `http://localhost:${config.port}`;
  const project = ensureProject();

  // From the last scan rather than from the roadmap: a role that promises a
  // skill nobody installed sends the agent looking for something that is not
  // there.
  const scanned = listHarnessComponents();
  const skills = scanned.filter((component) => component.type === 'skill');
  const agents = scanned.filter((component) => component.type === 'agent');

  const lines = [
    `## Hartask`,
    ``,
    `This project uses Hartask for task, state and continuity. It answers on`,
    `${base}, and speaks MCP at ${base}/mcp — prefer MCP when your host can add`,
    `a server, and use plain HTTP on the same port otherwise.`,
    ``,
    `Start with \`GET ${base}/api/context\` before substantial work: it is the`,
    `cold-start briefing, and it carries the index of the documents this project`,
    `keeps. Write a checkpoint with \`POST ${base}/api/handoff\` before you stop.`,
    ``,
    `Never read or write the SQLite file directly.`
  ];

  if (skills.length) {
    lines.push(
      ``,
      `Skills available in this project: ${skills.map((skill) => skill.name).join(', ')}.`
    );
  }
  if (agents.length) {
    lines.push(
      ``,
      `Roles this project already defines on disk: ${agents.map((one) => one.name).join(', ')}.`
    );
  }
  if (!scanned.length) {
    lines.push(
      ``,
      `Nothing has been scanned into the harness yet, so this brief names no`,
      `skills or hooks. \`POST ${base}/api/harness\` reads the disk again.`
    );
  }

  lines.push(``, `Project: ${project.name}.`);
  return lines.join('\n');
}

/**
 * The text to hand an agent so it works as this role.
 *
 * Order matters: the role comes first because it is what the reader is being
 * asked to be, and the machinery follows.
 */
export function composeAgentBrief(agent: SharedContext): string {
  const parts = [`# ${agent.title}`];

  if (agent.purpose) parts.push(`\n${agent.purpose}`);
  if (agent.body) parts.push(`\n${agent.body}`);

  parts.push(`\n---\n`, connectionSection());
  parts.push(`\n${HARTASK_AGENT_CONTRACT.trim()}`);

  if (agent.valid_as_of) {
    parts.push(`\n_Este rol se escribió pensando en el estado del proyecto en ${agent.valid_as_of}._`);
  }

  return parts.join('\n');
}


/**
 * Writing a role into the shape a host reads on its own.
 *
 * Until this exists a role here is weaker than a native subagent: the native
 * one is invoked on its own description, and this one has to be pointed at.
 * Exporting is what closes that, and it is also the one place Hartask writes
 * into a project it otherwise only observes — so it is never automatic, never a
 * side effect of saving, and always shows the exact path and text first.
 *
 * The hosts here are the ones whose file convention the scanner already
 * recognises, which means an exported role is picked up by the next harness
 * scan. Codex is missing on purpose: the scanner matches a `.codex/` directory
 * and nothing inside it, so there is no slot to write to that anyone verified,
 * and inventing one would be a guess dressed as support.
 */

export type ExportHost = 'claude' | 'cursor';

export const EXPORT_HOSTS: { id: ExportHost; label: string; note: string }[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    note: 'Subagente nativo: el host lo invoca solo, leyendo la descripción del frontmatter.'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    note: 'Regla de proyecto. Queda disponible, no se invoca sola.'
  }
];

const NEWLINE = String.fromCharCode(10);

/** Escapes nothing: a frontmatter value that breaks the block breaks the file. */
function yamlLine(key: string, value: string): string {
  return `${key}: ${JSON.stringify(value)}`;
}

export type AgentExport = { host: ExportHost; path: string; content: string; exists: boolean };

/**
 * What would be written, without writing it.
 *
 * Returned as an absolute path plus the text, so the page can show both before
 * anyone commits to it — the preview is the consent, not the button.
 */
export function planAgentExport(agent: SharedContext, host: ExportHost): AgentExport {
  const root = projectRootPath();
  const brief = composeAgentBrief(agent);
  const description = agent.purpose ?? agent.title;

  const relativePath =
    host === 'claude'
      ? join('.claude', 'agents', `${agent.slug}.md`)
      : join('.cursor', 'rules', `${agent.slug}.mdc`);

  const frontmatter =
    host === 'claude'
      ? ['---', yamlLine('name', agent.slug), yamlLine('description', description), '---', '']
      : [
          '---',
          yamlLine('description', description),
          'globs:',
          'alwaysApply: false',
          '---',
          ''
        ];

  const path = resolve(root, relativePath);
  return {
    host,
    path,
    content: [...frontmatter, brief, ''].join(NEWLINE),
    exists: existsSync(path)
  };
}

/**
 * Writes one export. Refuses anything that would land outside the project.
 *
 * The slug is normalised on the way in, so it cannot hold a separator — this
 * checks the resolved path anyway, because the cost of being wrong is writing
 * into a directory the user never pointed at.
 */
export function writeAgentExport(agent: SharedContext, host: ExportHost): AgentExport {
  const plan = planAgentExport(agent, host);
  const root = projectRootPath();
  const inside = relative(root, plan.path);

  if (inside.startsWith('..') || inside.startsWith(sep) || !inside) {
    throw new Error(`Refusing to write outside the project: ${plan.path}`);
  }

  mkdirSync(dirname(plan.path), { recursive: true });
  writeFileSync(plan.path, plan.content, 'utf8');

  recordEvent({
    eventType: 'AGENT_EXPORTED',
    summary: `${agent.slug} escrito para ${host} en ${inside}`,
    payload: { slug: agent.slug, host, path: inside, overwrote: plan.exists },
    agentId: 'human'
  });

  return { ...plan, exists: true };
}
