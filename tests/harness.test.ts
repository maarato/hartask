import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import {
  lastHarnessScan,
  listHarnessComponents,
  runHarnessScan
} from '@/lib/hartask/repositories/harness';
import { resetDb } from './helpers';

/**
 * A throwaway project on disk, so the scanner is exercised against real files
 * rather than a mock of a filesystem.
 */
let project: string;

function write(relativePath: string, content: string) {
  const absolute = join(project, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function configure(paths?: string[]) {
  process.env.HARTASK_CONFIG = join(project, 'hartask.config.json');
  writeFileSync(
    process.env.HARTASK_CONFIG,
    JSON.stringify({
      projectRoot: project,
      harnessScan: {
        enabled: true,
        paths: paths ?? ['AGENTS.md', 'CLAUDE.md', '.claude', '.cursor', '.mcp.json']
      }
    }),
    'utf8'
  );
  resetConfigCache();
}

beforeEach(() => {
  resetDb();
  project = mkdtempSync(join(tmpdir(), 'hartask-harness-'));
  configure();
});

afterEach(() => {
  delete process.env.HARTASK_CONFIG;
  resetConfigCache();
});

describe('scanning', () => {
  it('finds instruction files and says which host each belongs to', () => {
    write('AGENTS.md', '# instructions');
    write('CLAUDE.md', '# claude instructions');

    const { components } = runHarnessScan();
    const instructions = components.filter((c) => c.type === 'instructions');

    expect(instructions.map((c) => c.name).sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(instructions.find((c) => c.name === 'CLAUDE.md')?.runtime).toBe('claude');
    expect(instructions.find((c) => c.name === 'AGENTS.md')?.runtime).toBe('generic');
  });

  it('names a skill after its directory, not after SKILL.md', () => {
    write('.claude/skills/code-review/SKILL.md', '# review');

    const skill = runHarnessScan().components.find((c) => c.type === 'skill');
    expect(skill?.name).toBe('code-review');
  });

  it('separates agents from commands', () => {
    write('.claude/agents/reviewer.md', 'x');
    write('.claude/commands/deploy.md', 'x');

    const { components } = runHarnessScan();
    expect(components.find((c) => c.type === 'agent')?.name).toBe('reviewer.md');
    expect(components.find((c) => c.type === 'command')?.name).toBe('deploy.md');
  });

  it('pulls the servers and hooks out of the file that declares them', () => {
    write(
      '.claude/settings.json',
      JSON.stringify({
        mcpServers: { postgres: {}, github: {} },
        hooks: { PostToolUse: [] },
        permissions: { allow: [] }
      })
    );

    const { components } = runHarnessScan();

    // A declared MCP server is a harness component of its own; listing only the
    // settings file would hide what the agent can actually reach.
    expect(components.filter((c) => c.type === 'mcp').map((c) => c.name).sort()).toEqual([
      'github',
      'postgres'
    ]);
    expect(components.find((c) => c.type === 'hook')?.name).toBe('PostToolUse');

    const settings = components.find((c) => c.type === 'settings')!;
    expect(JSON.parse(settings.metadata_json!)).toMatchObject({
      mcp_servers: 2,
      hook_events: 1,
      has_permissions: true
    });
  });

  it('survives a settings file that is not valid JSON', () => {
    write('.claude/settings.json', '{ not json');

    const settings = runHarnessScan().components.find((c) => c.type === 'settings')!;
    expect(JSON.parse(settings.metadata_json!).unreadable).toBe(true);
  });

  it('records a hash and never the content', () => {
    write('AGENTS.md', '# instructions');

    const component = runHarnessScan().components[0];

    // Hartask observes the harness; AGENTS.md stays the only copy of itself.
    expect(component.content_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(component)).not.toContain('# instructions');
  });

  it('ignores files that are not harness', () => {
    write('README.md', 'x');
    write('src/index.ts', 'x');

    expect(runHarnessScan().components).toHaveLength(0);
  });

  it('does not walk into node_modules even when scanning the whole project', () => {
    write('AGENTS.md', 'the real one');
    write('node_modules/some-package/AGENTS.md', 'not ours');
    // Scanning the root is what makes this reachable at all; with a narrower
    // path the skip list is never exercised and the test proves nothing.
    configure(['.']);

    const { components } = runHarnessScan();
    expect(components).toHaveLength(1);
    expect(components[0].path).toBe('AGENTS.md');
  });
});

describe('rescanning', () => {
  it('drops a component that is gone from disk', () => {
    write('AGENTS.md', 'x');
    write('CLAUDE.md', 'x');
    expect(runHarnessScan().components).toHaveLength(2);

    // The second scan looks at a project that only declares one of them.
    configure(['AGENTS.md']);
    const { components } = runHarnessScan();

    // Merging instead of replacing would leave the removed one there forever.
    expect(components.map((c) => c.name)).toEqual(['AGENTS.md']);
  });

  it('counts what changed since the previous scan', () => {
    write('AGENTS.md', 'first version');
    runHarnessScan();

    write('AGENTS.md', 'edited since');
    const { summary } = runHarnessScan();

    expect(summary.changed).toBe(1);
  });

  it('counts nothing as changed when nothing did', () => {
    write('AGENTS.md', 'stable');
    runHarnessScan();

    expect(runHarnessScan().summary.changed).toBe(0);
  });

  it('records the scan itself, so an empty result is distinguishable', () => {
    expect(lastHarnessScan()).toBeNull();

    runHarnessScan();

    // Nothing found is a different answer from nobody having looked.
    expect(lastHarnessScan()).not.toBeNull();
    expect(listHarnessComponents()).toHaveLength(0);
  });
});
