import { Mermaid } from '@/components/mermaid';
import { loadConfig, projectRootPath } from '@/lib/hartask/config';
import { harnessDiagram } from '@/lib/hartask/harness/diagram';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import {
  lastHarnessScan,
  listHarnessComponents,
  type HarnessComponent
} from '@/lib/hartask/repositories/harness';
import { scanHarnessAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Harness · Hartask' };

/** The README's grouping, in the order someone reads a harness. */
const GROUPS: { type: string; title: string; blurb: string }[] = [
  { type: 'instructions', title: 'Instrucciones', blurb: 'Lo que el agente lee al empezar' },
  { type: 'skill', title: 'Skills', blurb: 'Flujos empaquetados que el host puede invocar' },
  { type: 'agent', title: 'Agentes', blurb: 'Subagentes definidos en el proyecto' },
  { type: 'command', title: 'Comandos', blurb: 'Atajos que el usuario escribe' },
  { type: 'mcp', title: 'MCP', blurb: 'Servidores que amplían lo que el agente puede hacer' },
  { type: 'hook', title: 'Hooks', blurb: 'Lo que el host ejecuta en momentos del ciclo' },
  { type: 'settings', title: 'Configuración', blurb: 'Permisos y ajustes del host' }
];

function Component({ component }: { component: HarnessComponent }) {
  const metadata = JSON.parse(component.metadata_json ?? '{}') as Record<string, unknown>;
  const declaredIn = metadata.declared_in as string | undefined;

  return (
    <li className="row archived-row">
      <span className="badge">{component.runtime}</span>
      <span className="task-title">{component.name}</span>
      <span className="muted small">
        <code>{declaredIn ?? component.path}</code>
      </span>
      {component.content_hash ? (
        <span className="muted small">· {component.content_hash.slice(0, 8)}</span>
      ) : null}
    </li>
  );
}

export default function HarnessPage() {
  const components = listHarnessComponents();
  const scan = lastHarnessScan();
  const summary = JSON.parse(scan?.summary_json ?? 'null') as {
    found: number;
    changed: number;
  } | null;
  const config = loadConfig();

  const present = GROUPS.filter((group) =>
    components.some((component) => component.type === group.type)
  );
  // Generated from the scan, so it cannot fall out of step with the disk.
  const diagram = harnessDiagram(components, ensureProject().name);

  return (
    <section className="stack sections">
      <div>
        <h1>Harness</h1>
        <p className="muted">Cómo está configurado el entorno de IA de este proyecto.</p>
      </div>

      <form action={scanHarnessAction} className="card notice">
        <span>
          {scan ? (
            <>
              Último escaneo: {scan.finished_at ?? scan.started_at} · {summary?.found ?? 0}{' '}
              componentes
              {summary?.changed ? `, ${summary.changed} con contenido distinto` : ''}.
            </>
          ) : (
            <>Todavía no se ha escaneado el proyecto.</>
          )}
        </span>
        <button type="submit">{scan ? 'Volver a escanear' : 'Escanear'}</button>
      </form>

      {diagram ? (
        <article className="card stack">
          <header className="section-head">
            <h2>Diagrama</h2>
            <p className="muted small">Lo que este proyecto le aporta al agente.</p>
          </header>
          <Mermaid chart={diagram} />
        </article>
      ) : null}

      {present.length ? (
        present.map((group) => (
          <article key={group.type} className="card stack">
            <header className="section-head">
              <h2>{group.title}</h2>
              <p className="muted small">{group.blurb}</p>
            </header>
            <ul className="linked-list">
              {components
                .filter((component) => component.type === group.type)
                .map((component) => (
                  <Component key={component.id} component={component} />
                ))}
            </ul>
          </article>
        ))
      ) : (
        <article className="card">
          <p className="muted">
            {scan
              ? 'No se encontró ningún componente en las rutas configuradas.'
              : 'Escanea para ver qué instrucciones, skills, hooks y servidores MCP aplican a este proyecto.'}
          </p>
        </article>
      )}

      <article className="card stack">
        <header className="section-head">
          <h2>Qué se mira</h2>
          <p className="muted small">Relativo a la raíz del proyecto.</p>
        </header>
        <p className="muted small">
          Raíz: <code>{projectRootPath()}</code>
        </p>
        <span className="chips">
          {config.harnessScan.paths.map((path) => (
            <code key={path}>{path}</code>
          ))}
        </span>
        <p className="muted small">
          Hartask observa estos archivos, no los reemplaza: guarda ruta, alcance y un hash del
          contenido, nunca el contenido. Y no se sincronizan, porque describen el disco de esta
          máquina.
        </p>
      </article>
    </section>
  );
}
