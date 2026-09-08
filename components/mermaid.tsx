'use client';

import { useEffect, useState } from 'react';

/**
 * Renders a Mermaid diagram.
 *
 * Mermaid draws in the browser, so this is a client component — the second and
 * only other one after the nav. It is imported dynamically, so the library is
 * fetched only on a page that actually has a diagram to draw.
 *
 * The source is what shows until the SVG is ready, and what stays if rendering
 * fails or the library never loads. A diagram that cannot be drawn should
 * degrade to its text, never to an empty box: the text still says what the
 * picture meant.
 */
export function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          // The diagram text can come from the Project Context, which a person
          // writes; strict keeps the rendered SVG from carrying script.
          securityLevel: 'strict',
          themeVariables: {
            background: '#12161b',
            primaryColor: '#1b222b',
            primaryTextColor: '#f5f7fa',
            primaryBorderColor: '#3b4350',
            lineColor: '#5c6675',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
          }
        });

        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(rendered);
      } catch {
        // Leave the source showing; it is more useful than an error.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (svg) return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
  return <pre className="diagram-source">{chart}</pre>;
}
