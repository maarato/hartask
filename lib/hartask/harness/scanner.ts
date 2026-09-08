import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { loadConfig, projectRootPath } from '@/lib/hartask/config';

/**
 * Reads the project's AI harness off disk.
 *
 * Hartask observes the harness; it does not own it. So this records what a
 * component is, where it lives, which host it belongs to and a hash of its
 * content — never the content itself. AGENTS.md stays the only copy of
 * AGENTS.md, and a scan cannot drift from it.
 *
 * Everything here describes one machine's disk, which is why the harness
 * tables are the ones that do not sync.
 */

export type HarnessComponentType =
  | 'instructions'
  | 'skill'
  | 'agent'
  | 'command'
  | 'hook'
  | 'mcp'
  | 'settings';

export type DetectedComponent = {
  type: HarnessComponentType;
  name: string;
  path: string;
  /** The host it belongs to: claude, cursor, codex, or generic. */
  runtime: string;
  scope: 'project' | 'user';
  metadata: Record<string, unknown>;
  contentHash: string | null;
};

/** Directories that are never harness, and are expensive to walk. */
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'data']);

const MAX_DEPTH = 4;
const MAX_FILES = 500;

/**
 * Path patterns, most specific first. Order matters: `.claude/skills/x/SKILL.md`
 * is a skill, not the generic instructions file it would otherwise match.
 */
const RULES: {
  match: RegExp;
  type: HarnessComponentType;
  runtime: string;
  name?: (path: string) => string;
}[] = [
  { match: /(^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/i, type: 'skill', runtime: 'claude', name: (p) => p.split('/').at(-2)! },
  { match: /(^|\/)\.claude\/agents\/([^/]+)\.md$/i, type: 'agent', runtime: 'claude' },
  { match: /(^|\/)\.claude\/commands\/([^/]+)\.md$/i, type: 'command', runtime: 'claude' },
  { match: /(^|\/)\.claude\/hooks\//i, type: 'hook', runtime: 'claude' },
  { match: /(^|\/)\.claude\/settings(\.local)?\.json$/i, type: 'settings', runtime: 'claude' },
  { match: /(^|\/)\.mcp\.json$/i, type: 'mcp', runtime: 'generic' },
  { match: /(^|\/)\.cursor\/rules\/.+\.mdc?$/i, type: 'instructions', runtime: 'cursor' },
  { match: /(^|\/)\.cursorrules$/i, type: 'instructions', runtime: 'cursor' },
  { match: /(^|\/)\.codex\//i, type: 'instructions', runtime: 'codex' },
  { match: /(^|\/)AGENTS\.md$/i, type: 'instructions', runtime: 'generic' },
  { match: /(^|\/)CLAUDE\.md$/i, type: 'instructions', runtime: 'claude' },
  { match: /(^|\/)\.github\/copilot-instructions\.md$/i, type: 'instructions', runtime: 'copilot' }
];

function classify(relativePath: string) {
  const normalized = relativePath.split(sep).join('/');
  for (const rule of RULES) {
    if (rule.match.test(normalized)) {
      return {
        type: rule.type,
        runtime: rule.runtime,
        name: rule.name?.(normalized) ?? normalized.split('/').at(-1)!
      };
    }
  }
  return null;
}

function hashOf(absolute: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absolute)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/** Files that declare servers or hooks describe more than themselves. */
function expand(component: DetectedComponent, absolute: string): DetectedComponent[] {
  if (component.type !== 'settings' && component.type !== 'mcp') return [component];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
  } catch {
    return [{ ...component, metadata: { ...component.metadata, unreadable: true } }];
  }

  const extra: DetectedComponent[] = [];

  const servers = parsed.mcpServers as Record<string, unknown> | undefined;
  for (const name of Object.keys(servers ?? {})) {
    // An MCP server is a harness component in its own right, even though it is
    // declared inside a settings file rather than being one.
    extra.push({
      ...component,
      type: 'mcp',
      name,
      metadata: { declared_in: component.path }
    });
  }

  const hooks = parsed.hooks as Record<string, unknown> | undefined;
  for (const event of Object.keys(hooks ?? {})) {
    extra.push({
      ...component,
      type: 'hook',
      name: event,
      metadata: { declared_in: component.path, event }
    });
  }

  const permissions = parsed.permissions as Record<string, unknown> | undefined;
  const withCounts: DetectedComponent = {
    ...component,
    metadata: {
      ...component.metadata,
      mcp_servers: Object.keys(servers ?? {}).length,
      hook_events: Object.keys(hooks ?? {}).length,
      has_permissions: Boolean(permissions)
    }
  };

  return [withCounts, ...extra];
}

function walk(absolute: string, root: string, depth: number, found: DetectedComponent[], scope: 'project' | 'user'): void {
  if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;

  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return;
  }

  if (stats.isFile()) {
    const detected = classify(relative(root, absolute));
    if (!detected) return;
    const component: DetectedComponent = {
      ...detected,
      path: relative(root, absolute).split(sep).join('/'),
      scope,
      metadata: { size: stats.size },
      contentHash: hashOf(absolute)
    };
    found.push(...expand(component, absolute));
    return;
  }

  if (!stats.isDirectory()) return;

  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    walk(join(absolute, entry), root, depth + 1, found, scope);
  }
}

/**
 * Walks the configured paths and reports what it finds.
 *
 * Paths are relative to `projectRoot`, so that setting is the single knob for
 * where the project is — a scan path of `../AGENTS.md` would otherwise depend
 * on both, and land somewhere neither of them meant.
 */
export function scanHarness(): DetectedComponent[] {
  const config = loadConfig();
  if (!config.harnessScan.enabled) return [];

  const root = projectRootPath();
  const found: DetectedComponent[] = [];

  for (const path of config.harnessScan.paths) {
    walk(resolve(root, path), root, 0, found, 'project');
  }

  // A component can be reached through more than one configured path.
  const seen = new Set<string>();
  return found.filter((component) => {
    const key = `${component.type}:${component.name}:${component.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
