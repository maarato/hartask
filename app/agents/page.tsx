import Link from 'next/link';
import { composeAgentBrief, EXPORT_HOSTS, planAgentExport } from '@/lib/hartask/agents';
import { getContext, listContexts } from '@/lib/hartask/repositories/contexts';
import { listCategories } from '@/lib/hartask/repositories/tasks';
import type { SharedContextSummary } from '@/lib/hartask/types';
import { exportAgentAction, removeAgentAction, saveAgentAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Agentes · Hartask' };

/** The fields a role has, shared by the new-role form and the editor. */
function Fields({ role }: { role?: { title: string; purpose: string | null; body: string | null; category: string | null; valid_as_of: string | null } }) {
  return (
    <>
      <input
        name="title"
        defaultValue={role?.title ?? ''}
        placeholder="Cómo se llama el rol: Arquitecto"
        aria-label="Título"
        required
      />
      <input
        name="purpose"
        defaultValue={role?.purpose ?? ''}
        placeholder="Cuándo usarlo: una línea. Es lo que un host lee para decidir si delegarle algo."
        aria-label="Cuándo usarlo"
      />
      <textarea
        name="body"
        defaultValue={role?.body ?? ''}
        placeholder="El brief: qué le importa a este rol, qué mira primero, qué no le toca. No repitas cómo se conecta a Hartask; eso se agrega solo."
        rows={14}
      />
      <div className="row">
        <input
          name="category"
          defaultValue={role?.category ?? ''}
          list="hartask-categories"
          placeholder="Área (opcional)"
          aria-label="Área"
        />
        <input
          name="valid_as_of"
          defaultValue={role?.valid_as_of ?? ''}
          placeholder="Escrito pensando en (TASK-073)"
          aria-label="Vigente hasta"
        />
      </div>
    </>
  );
}

/**
 * One role, with the text to hand an agent.
 *
 * What is shown is the composed brief, not what was typed: the connection half
 * is generated from the running instance, so it names the port this Hartask is
 * actually on and the skills the last scan actually found. A file written once
 * would have been wrong the first time either changed.
 */
function AgentCard({ summary }: { summary: SharedContextSummary }) {
  const role = getContext(summary.slug, 'agent')!;
  const brief = composeAgentBrief(role);

  return (
    <details className="card task">
      <summary>
        <span className="task-head">
          <span className="task-title">{role.title}</span>
          {role.category ? <span className="category">{role.category}</span> : null}
          <span className="muted small">actualizado {role.updated_at}</span>
        </span>
        {role.purpose ? <span className="task-desc muted">{role.purpose}</span> : null}
      </summary>

      <div className="task-body">
        <p className="muted small">
          Esto es lo que se le pasa al agente. La mitad de abajo la genera Hartask con el puerto y
          el harness de ahora, así que no envejece con el proyecto.
        </p>
        <pre className="diagram-source brief">{brief}</pre>

        {/* The preview is the consent, not the button: the exact path and the
            exact text, before anything is written into the project. */}
        <details>
          <summary>Escribir en el proyecto</summary>
          <div className="stack">
            <p className="muted small">
              Hartask observa el disco de este proyecto y no lo posee, así que esto es lo único que
              escribe en él — y solo cuando lo pides aquí. Un rol exportado lo detecta el siguiente
              escaneo del harness.
            </p>
            {EXPORT_HOSTS.map((host) => {
              const plan = planAgentExport(role, host.id);
              return (
                <details key={host.id} className="card">
                  <summary>
                    {host.label}
                    {plan.exists ? <span className="muted small"> · ya existe, se sobrescribe</span> : null}
                  </summary>
                  <div className="stack">
                    <p className="muted small">{host.note}</p>
                    <p className="muted small">
                      Se escribe en <code>{plan.path}</code>
                    </p>
                    <pre className="diagram-source brief">{plan.content}</pre>
                    <form action={exportAgentAction}>
                      <input type="hidden" name="slug" value={role.slug} />
                      <input type="hidden" name="host" value={host.id} />
                      <button type="submit">
                        {plan.exists ? 'Sobrescribir' : 'Escribir'} para {host.label}
                      </button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        </details>

        <details>
          <summary>Editar</summary>
          <form action={saveAgentAction} className="stack form">
            <input type="hidden" name="slug" value={role.slug} />
            <Fields role={role} />
            <button type="submit">Guardar</button>
          </form>
        </details>

        <details>
          <summary>Eliminar</summary>
          <form action={removeAgentAction} className="stack form">
            <input type="hidden" name="slug" value={role.slug} />
            <p className="muted small">
              Se borra de este board. Si ya se sincronizó, sigue en el almacén remoto y en las otras
              máquinas hasta que allá se borre también.
            </p>
            <button type="submit">Eliminar {role.slug}</button>
          </form>
        </details>
      </div>
    </details>
  );
}

function NewAgentForm() {
  return (
    <details className="card">
      <summary>
        <strong>Nuevo rol</strong>
      </summary>
      <form action={saveAgentAction} className="stack form">
        <input
          name="slug"
          placeholder="Nombre corto: arquitecto"
          aria-label="Nombre corto"
          required
        />
        <Fields />
        <button type="submit">Crear</button>
      </form>
    </details>
  );
}

export default function AgentsPage() {
  const roles = listContexts('agent');
  const categories = listCategories();

  return (
    <section className="stack">
      <div>
        <h1>Agentes</h1>
        <p className="muted">
          Roles de este proyecto — arquitecto, backend, lo que necesites — escritos una vez y
          servidos con la forma de llegar a este Hartask ya puesta.
        </p>
      </div>

      <datalist id="hartask-categories">
        {categories.map((category) => (
          <option key={category.name} value={category.name} />
        ))}
      </datalist>

      <NewAgentForm />

      {roles.length ? (
        <div className="stack">
          {roles.map((role) => (
            <AgentCard key={role.slug} summary={role} />
          ))}
        </div>
      ) : (
        <article className="card stack">
          <p className="muted">
            Todavía no hay roles. Un rol es el brief que le pasas a un agente al empezar una
            conversación: qué le importa, qué mira primero, qué no le toca.
          </p>
          <p className="muted small">
            No escribas ahí cómo conectarse a Hartask. Eso lo agrega esta página sola, con el puerto
            y el harness de este momento, que es la razón de que un rol viva aquí y no en un archivo
            suelto que se queda viejo.
          </p>
        </article>
      )}

      <article className="card stack">
        <header className="section-head">
          <h2>Lo que esto todavía no hace</h2>
        </header>
        <p className="muted">
          Codex no está entre los destinos. El escaneo reconoce un directorio{' '}
          <code>.codex/</code> y nada dentro de él, así que no hay una ruta que alguien haya
          verificado — inventar una sería una suposición disfrazada de soporte.
        </p>
        <p className="muted">
          Tampoco se inyecta la sección de Hartask en el <code>AGENTS.md</code> del proyecto ni se
          instalan hooks de fin de sesión. Editar un archivo que el usuario escribió, o su{' '}
          <code>settings.json</code>, es otra decisión que la de crear un archivo en una ruta
          convencional.
        </p>
        <p className="muted small">
          <Link href="/harness">Harness</Link> muestra los subagentes que ya existen en el disco de
          este proyecto; esta página muestra los que el proyecto define.
        </p>
      </article>
    </section>
  );
}
