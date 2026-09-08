/**
 * Splits authored text into prose and the diagrams embedded in it.
 *
 * Project Context is written by a person, and the README's own example of one
 * leans on small diagrams. A fenced mermaid block should therefore be drawn,
 * while everything around it stays the plain text it was.
 */

export type Segment = { type: 'prose' | 'mermaid'; content: string };

const FENCE = /```mermaid\s*\n([\s\S]*?)```/g;

export function splitProse(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FENCE)) {
    const start = match.index ?? 0;
    const before = text.slice(cursor, start).trim();
    if (before) segments.push({ type: 'prose', content: before });

    const diagram = match[1].trim();
    if (diagram) segments.push({ type: 'mermaid', content: diagram });

    cursor = start + match[0].length;
  }

  const rest = text.slice(cursor).trim();
  if (rest) segments.push({ type: 'prose', content: rest });

  // Text with no diagram in it is still one segment, not zero.
  return segments.length ? segments : [{ type: 'prose', content: text }];
}
