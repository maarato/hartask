import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getTaskByRef,
  listEvents,
  listNotes,
  listTasks
} from '@/lib/hartask/repositories/tasks';
import { TASK_STATUSES, type Task, type TaskEvent } from '@/lib/hartask/types';
import {
  addNoteAction,
  saveTaskDetailsAction,
  setTaskStatusAction
} from '../actions';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const task = getTaskByRef(id);
  return { title: task ? `${task.public_id} · ${task.title}` : 'Task no encontrada' };
}

/** Turns a status-change payload into the transition it recorded. */
function transitionOf(event: TaskEvent): string | null {
  if (!event.payload_json) return null;
  try {
    const payload = JSON.parse(event.payload_json) as { from?: string; to?: string };
    return payload.from && payload.to ? `${payload.from} → ${payload.to}` : null;
  } catch {
    return null;
  }
}

function Timeline({ events }: { events: TaskEvent[] }) {
  if (!events.length) return <p className="muted">Sin eventos registrados.</p>;

  return (
    <ol className="timeline">
      {events.map((event) => {
        const transition = transitionOf(event);
        return (
          <li key={event.id}>
            <div className="row timeline-head">
              <code>{event.event_type}</code>
              {transition ? <span className="badge">{transition}</span> : null}
              <span className="muted small">{event.created_at}</span>
              {event.agent_id ? <span className="muted small">· {event.agent_id}</span> : null}
            </div>
            {event.summary ? <div className="small">{event.summary}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default async function TaskDetailPage({ params }: PageProps) {
  const { id } = await params;
  const task = getTaskByRef(id);
  if (!task) notFound();

  const notes = listNotes(task.id);
  // The board only shows the last events across the project; here the task
  // gets its whole history, which is the point of the detail view.
  const events = listEvents({ taskId: task.id, limit: 200 });
  const subtasks = listTasks({ parentId: task.id, includeArchived: true });
  const parent: Task | null = task.parent_id === null ? null : getTaskByRef(String(task.parent_id));

  return (
    <section className="stack sections">
      <div className="stack">
        <p className="muted small">
          <Link href="/tasks">← Tasks</Link>
          {parent ? (
            <>
              {' / '}
              <Link href={`/tasks/${parent.public_id}`}>{parent.public_id}</Link>
            </>
          ) : null}
        </p>
        <div className="row">
          <span className="badge" data-status={task.status}>
            {task.status}
          </span>
          <h1 className="detail-title">
            {task.public_id} · {task.title}
          </h1>
          {task.archived_at ? <span className="badge">ARCHIVADA</span> : null}
        </div>
      </div>

      <article className="card stack">
        <header className="section-head">
          <h2>Estado</h2>
          <p className="muted small">
            Creada {task.created_at} · actualizada {task.updated_at}
          </p>
        </header>

        <dl className="handoff">
          {task.next_action ? (
            <>
              <dt>Siguiente acción</dt>
              <dd className="next-step">{task.next_action}</dd>
            </>
          ) : null}
          {task.description ? (
            <>
              <dt>Descripción</dt>
              <dd className="prose">{task.description}</dd>
            </>
          ) : null}
          {task.status === 'BLOCKED' && task.blocked_reason ? (
            <>
              <dt>Bloqueo</dt>
              <dd className="blocked">{task.blocked_reason}</dd>
            </>
          ) : null}
          <dt>Prioridad</dt>
          <dd>{task.priority}</dd>
        </dl>

        <form action={setTaskStatusAction} className="row">
          <input type="hidden" name="public_id" value={task.public_id} />
          <select name="status" defaultValue={task.status} aria-label="Estado">
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input name="blocked_reason" placeholder="Motivo (si BLOCKED)" />
          <button type="submit">Cambiar estado</button>
        </form>

        <details>
          <summary>Editar</summary>
          <form action={saveTaskDetailsAction} className="stack form">
            <input type="hidden" name="public_id" value={task.public_id} />
            <input name="title" defaultValue={task.title} placeholder="Título" required />
            <input
              name="next_action"
              defaultValue={task.next_action ?? ''}
              placeholder="Siguiente acción"
            />
            <textarea
              name="description"
              defaultValue={task.description ?? ''}
              placeholder="Descripción"
              rows={5}
            />
            <div className="row">
              <input
                name="priority"
                type="number"
                defaultValue={task.priority}
                aria-label="Prioridad"
              />
              <button type="submit">Guardar</button>
            </div>
          </form>
        </details>
      </article>

      {subtasks.length ? (
        <article className="card stack">
          <header className="section-head">
            <h2>Subtasks</h2>
            <p className="muted small">{subtasks.length} en total</p>
          </header>
          <ul className="linked-list">
            {subtasks.map((subtask) => (
              <li key={subtask.id} className="row">
                <span className="badge" data-status={subtask.status}>
                  {subtask.status}
                </span>
                <Link href={`/tasks/${subtask.public_id}`}>
                  {subtask.public_id} · {subtask.title}
                </Link>
                {subtask.archived_at ? <span className="muted small">archivada</span> : null}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="card stack">
        <header className="section-head">
          <h2>Notas</h2>
          <p className="muted small">
            Lo que hay que saber sobre esta task, escrito por un humano o un agente.
          </p>
        </header>

        {notes.length ? (
          <ul className="notes">
            {notes.map((note) => (
              <li key={note.id}>
                <div className="muted small">
                  {note.author_type} · {note.created_at}
                </div>
                <div className="prose">{note.body}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Sin notas.</p>
        )}

        <form action={addNoteAction} className="stack form">
          <input type="hidden" name="public_id" value={task.public_id} />
          <textarea name="body" placeholder="Agregar una nota" rows={3} required />
          <button type="submit">Agregar nota</button>
        </form>
      </article>

      <article className="card stack">
        <header className="section-head">
          <h2>Historial</h2>
          <p className="muted small">Qué pasó objetivamente, del más reciente al más antiguo.</p>
        </header>
        <Timeline events={events} />
      </article>
    </section>
  );
}
