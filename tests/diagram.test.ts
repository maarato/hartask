import { describe, expect, it } from 'vitest';
import { harnessDiagram } from '@/lib/hartask/harness/diagram';
import { splitProse } from '@/lib/hartask/prose';
import type { HarnessComponent } from '@/lib/hartask/repositories/harness';

function component(type: string, name: string): HarnessComponent {
  return {
    id: Math.random(),
    type,
    name,
    path: `${name}`,
    runtime: 'claude',
    scope: 'project',
    metadata_json: '{}',
    content_hash: 'abc',
    last_scan_at: null
  };
}

describe('splitProse', () => {
  it('leaves text without a diagram as one piece', () => {
    const segments = splitProse('Just prose.\n\nMore prose.');

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('prose');
  });

  it('pulls a fenced diagram out of the text around it', () => {
    const segments = splitProse(
      'Architecture:\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nAnd the rest.'
    );

    expect(segments.map((s) => s.type)).toEqual(['prose', 'mermaid', 'prose']);
    expect(segments[1].content).toBe('graph LR\n  A --> B');
    expect(segments[0].content).toBe('Architecture:');
    expect(segments[2].content).toBe('And the rest.');
  });

  it('handles several diagrams in one context', () => {
    const segments = splitProse('```mermaid\ngraph LR\n A-->B\n```\n```mermaid\ngraph TD\n C-->D\n```');

    expect(segments.filter((s) => s.type === 'mermaid')).toHaveLength(2);
  });

  it('does not produce an empty segment when a diagram is the whole text', () => {
    const segments = splitProse('```mermaid\ngraph LR\n  A --> B\n```');

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('mermaid');
  });

  it('leaves a fence that is not mermaid alone', () => {
    const segments = splitProse('```js\nconst a = 1;\n```');

    // Only mermaid is drawn; another language is prose that happens to be code.
    expect(segments.map((s) => s.type)).toEqual(['prose']);
  });
});

describe('harnessDiagram', () => {
  it('draws nothing when there is nothing scanned', () => {
    expect(harnessDiagram([], 'A project')).toBeNull();
  });

  it('hangs each component off the group it belongs to', () => {
    const diagram = harnessDiagram(
      [component('instructions', 'AGENTS.md'), component('mcp', 'postgres')],
      'Hartask'
    )!;

    expect(diagram.startsWith('graph LR')).toBe(true);
    expect(diagram).toContain('project["Hartask"]');
    expect(diagram).toContain('project --> g_instructions["Instrucciones"]');
    expect(diagram).toContain('g_instructions_0("AGENTS.md")');
    expect(diagram).toContain('g_mcp_0("postgres")');
  });

  it('collapses a group that would become a wall of boxes', () => {
    const many = Array.from({ length: 12 }, (_, i) => component('skill', `skill-${i}`));

    const diagram = harnessDiagram(many, 'Hartask')!;

    expect(diagram).toContain('+4 más');
    expect(diagram).not.toContain('skill-8');
  });

  it('does not let a quote in a name break the diagram', () => {
    const diagram = harnessDiagram([component('skill', 'the "special" one')], 'Hartask')!;

    // An unescaped quote closes the label early and mermaid stops parsing.
    expect(diagram).toContain(`("the 'special' one")`);
  });
});
