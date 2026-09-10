import { loadConfig } from '@/lib/hartask/config';
import { HARTASK_AGENT_CONTRACT } from '@/lib/hartask/contract';
import { listHarnessComponents } from '@/lib/hartask/repositories/harness';
import { ensureProject } from '@/lib/hartask/repositories/projects';
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
