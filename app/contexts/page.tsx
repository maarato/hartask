import { Mermaid } from '@/components/mermaid';
import { splitProse } from '@/lib/hartask/prose';
import { getContext, listContexts } from '@/lib/hartask/repositories/contexts';
import { listCategories } from '@/lib/hartask/repositories/tasks';
import type { SharedContextSummary } from '@/lib/hartask/types';
import { removeContextAction, saveContextAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Contextos · Hartask' };

/**
 * The fields a document has, in both the new-document form and the editor, so
 * the two cannot drift into offering different things.
 */
function Fields({ doc }: { doc?: SharedContextSummary & { body: string | null } }) {
  return (
    <>
      <input
        name="title"
        defaultValue={doc?.title ?? ''}
        placeholder="Título"
        aria-label="Título"
        required
      />
      <input
        name="purpose"
        defaultValue={doc?.purpose ?? ''}
        placeholder="Propósito: una línea, la que se ve en el listado y en cada briefing"
        aria-label="Propósito"
      />
      <textarea
        name="body"
        defaultValue={doc?.body ?? ''}
        placeholder="Se guarda como Markdown y aquí se muestra tal cual, respetando los saltos de línea. Un bloque ```mermaid sí se dibuja."
        rows={14}
      />
      <div className="row">
        <input
          name="category"
          defaultValue={doc?.category ?? ''}
          list="hartask-categories"
          placeholder="Categoría (opcional)"
          aria-label="Categoría"
        />
        <input
          name="valid_as_of"
          defaultValue={doc?.valid_as_of ?? ''}
          placeholder="Vigente hasta (TASK-069)"
          aria-label="Vigente hasta"
        />
      </div>
    </>
  );
}

/**
 * One document. Collapsed by default like the task cards, so a page of them
 * stays scannable — what shows closed is what decides whether to open it.
 *
 * The update date sits next to the title rather than inside: a document that
 * claims to be current and was last true three months ago is worse than one
 * that admits its age.
 */
function ContextCard({ summary }: { summary: SharedContextSummary }) {
  const doc = getContext(summary.slug)!;
  const segments = doc.body ? splitProse(doc.body) : [];

  return (
    <details className="card task">
      <summary>
        <span className="task-head">
          <span className="task-title">{doc.title}</span>
          {doc.category ? <span className="category">{doc.category}</span> : null}
          <span className="muted small">
            {doc.valid_as_of ? `vigente hasta ${doc.valid_as_of} · ` : ''}
            actualizado {doc.updated_at}
          </span>
        </span>
        {doc.purpose ? <span className="task-desc muted">{doc.purpose}</span> : null}
      </summary>

      <div className="task-body">
        {segments.length ? (
          segments.map((segment, index) =>
            segment.type === 'mermaid' ? (
              <Mermaid key={index} chart={segment.content} />
            ) : (
              <div key={index} className="prose">
                {segment.content}
              </div>
            )
          )
        ) : (
          <p className="muted">Sin contenido todavía.</p>
        )}

        <p className="muted small">
          Se lee con <code>GET /api/contexts/{doc.slug}</code> o{' '}
          <code>hartask://contexts/{doc.slug}</code>.
        </p>

        <details>
          <summary>Editar</summary>
          <form action={saveContextAction} className="stack form">
            <input type="hidden" name="slug" value={doc.slug} />
            <Fields doc={doc} />
            <button type="submit">Guardar</button>
          </form>
        </details>

        <details>
          <summary>Eliminar</summary>
          <form action={removeContextAction} className="stack form">
            <input type="hidden" name="slug" value={doc.slug} />
            <p className="muted small">
              Se borra de este board. Si ya se sincronizó, sigue en el almacén remoto y en las otras
              máquinas hasta que allá se borre también: la eliminación no viaja.
            </p>
            <button type="submit">Eliminar {doc.slug}</button>
          </form>
        </details>
      </div>
    </details>
  );
}

function NewContextForm() {
  return (
    <details className="card">
      <summary>
        <strong>Nuevo documento</strong>
      </summary>
      <form action={saveContextAction} className="stack form">
        <input
          name="slug"
          placeholder="Nombre corto: sync-merge"
          aria-label="Nombre corto"
          required
        />
        <span className="muted small">
          El nombre es la identidad del documento: escribir uno que ya existe lo corrige en su
          lugar, en vez de crear otro.
        </span>
        <Fields />
        <button type="submit">Crear</button>
      </form>
    </details>
  );
}

export default function ContextsPage() {
  const documents = listContexts();
  // The same vocabulary the board uses, offered rather than reinvented.
  const categories = listCategories();

  return (
    <section className="stack">
      <div>
        <h1>Contextos</h1>
        <p className="muted">
          Lo durable que es más angosto que el proyecto entero: cómo funciona una parte y por qué,
          para no volver a derivarlo cada sesión.
        </p>
      </div>

      <datalist id="hartask-categories">
        {categories.map((category) => (
          <option key={category.name} value={category.name} />
        ))}
      </datalist>

      <NewContextForm />

      {documents.length ? (
        <div className="stack">
          {documents.map((doc) => (
            <ContextCard key={doc.slug} summary={doc} />
          ))}
        </div>
      ) : (
        <article className="card stack">
          <p className="muted">
            Todavía no hay documentos. Van aquí las cosas que un agente vuelve a deducir cada vez:
            cómo funciona una parte del sistema y por qué, qué se decidió y se descartó, de qué
            fiarse.
          </p>
          <p className="muted small">
            Lo que <em>es</em> el proyecto va en Project Context, dónde te quedaste va en un
            checkpoint, y lo que encontraste haciendo una task va en una nota de esa task.
          </p>
        </article>
      )}
    </section>
  );
}
