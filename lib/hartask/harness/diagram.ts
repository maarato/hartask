import type { HarnessComponent } from '@/lib/hartask/repositories/harness';

/**
 * Draws the harness as a diagram: what the project brings, grouped by kind.
 *
 * Generated from the scan rather than written by hand, so it cannot fall out of
 * step with what is actually on disk — a hand-drawn harness diagram is stale
 * the moment someone adds a skill.
 */

const GROUP_LABELS: Record<string, string> = {
  instructions: 'Instrucciones',
  skill: 'Skills',
  agent: 'Agentes',
  command: 'Comandos',
  mcp: 'MCP',
  hook: 'Hooks',
  settings: 'Configuración'
};

/** Order the README reads a harness in. */
const GROUP_ORDER = ['instructions', 'skill', 'agent', 'command', 'mcp', 'hook', 'settings'];

/** Beyond this a group becomes a wall of boxes and stops being a diagram. */
const MAX_PER_GROUP = 8;

/** Mermaid takes the label as a quoted string, so only quotes need escaping. */
function label(value: string): string {
  return value.replace(/"/g, "'");
}

export function harnessDiagram(components: HarnessComponent[], projectName: string): string | null {
  if (!components.length) return null;

  const byGroup = new Map<string, HarnessComponent[]>();
  for (const component of components) {
    byGroup.set(component.type, [...(byGroup.get(component.type) ?? []), component]);
  }

  const lines = ['graph LR', `  project["${label(projectName)}"]`];

  for (const type of GROUP_ORDER) {
    const group = byGroup.get(type);
    if (!group?.length) continue;

    const groupId = `g_${type}`;
    lines.push(`  project --> ${groupId}["${label(GROUP_LABELS[type] ?? type)}"]`);

    group.slice(0, MAX_PER_GROUP).forEach((component, index) => {
      lines.push(`  ${groupId} --> ${groupId}_${index}("${label(component.name)}")`);
    });

    const hidden = group.length - MAX_PER_GROUP;
    if (hidden > 0) lines.push(`  ${groupId} --> ${groupId}_more["+${hidden} más"]`);
  }

  return lines.join('\n');
}
