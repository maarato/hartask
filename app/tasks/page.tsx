import { ensureProject } from '@/lib/hartask/repositories/projects';
import {
  countTasksByStatus,
  listEvents,
  listTasks,
  listTaskTree
} from '@/lib/hartask/repositories/tasks';
import { TASK_STATUSES, type Task, type TaskNode } from '@/lib/hartask/types';
import { createTaskAction, setNextActionAction, setTaskStatusAction } from './actions';

// The page reads SQLite on every request, so it must never be prerendered.
export const dynamic = 'force-dynamic';

function TaskCard({ node, depth }: { node: TaskNode; depth: number }) {
  return (
    <article className="card task" data-status={node.status} style={{ marginLeft: depth * 24 }}>
      <header className="task-head">
        <span className="badge" data-status={node.status}>
          {node.status}
        </span>
        <h2>
          {node.public_id} · {node.title}
        </h2>
      </header>

      {node.description ? <p>{node.description}</p> : null}

      {node.status === 'BLOCKED' && node.blocked_reason ? (
        <p className="blocked">
          <strong>Bloqueo:</strong> {node.blocked_reason}
        </p>
      ) : null}

      <form action={setNextActionAction} className="row">
        <input type="hidden" name="public_id" value={node.public_id} />
        <input
          name="next_action"
          defaultValue={node.next_action ?? ''}
          placeholder="Siguiente acción"
          aria-label={`Siguiente acción de ${node.public_id}`}
        />
        <button type="submit">Guardar</button>
      </form>

      <form action={setTaskStatusAction} className="row">
        <input type="hidden" name="public_id" value={node.public_id} />
        <select name="status" defaultValue={node.status} aria-label={`Estado de ${node.public_id}`}>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <input name="blocked_reason" placeholder="Motivo (si BLOCKED)" />
        <button type="submit">Cambiar estado</button>
      </form>

      <p className="muted small">Actualizada: {node.updated_at}</p>

      {node.children.map((child) => (
        <TaskCard key={child.id} node={child} depth={depth + 1} />
      ))}
    </article>
  );
}

function NewTaskForm({ parents }: { parents: Task[] }) {
  return (
    <details className="card">
      <summary>
        <strong>Nueva task</strong>
      </summary>
      <form action={createTaskAction} className="stack form">
        <input name="title" placeholder="Título" required />
        <input name="next_action" placeholder="Siguiente acción (opcional)" />
        <textarea name="description" placeholder="Descripción (opcional)" rows={3} />
        <div className="row">
          <select name="status" defaultValue="BACKLOG" aria-label="Estado inicial">
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select name="parent_id" defaultValue="" aria-label="Task padre">
            <option value="">Sin padre</option>
            {parents.map((task) => (
              <option key={task.id} value={task.id}>
                {task.public_id} · {task.title}
              </option>
            ))}
          </select>
          <button type="submit">Crear</button>
        </div>
      </form>
    </details>
  );
}

export default function TasksPage() {
  ensureProject();

  const tree = listTaskTree();
  const flat = listTasks();
  const counts = countTasksByStatus();
  const events = listEvents({ limit: 8 });

  return (
    <section className="stack">
      <div>
        <h1>Tasks</h1>
        <p className="muted">Qué estás haciendo, qué sigue y qué está bloqueado.</p>
      </div>

      <div className="row wrap">
        {TASK_STATUSES.filter((status) => counts[status]).map((status) => (
          <span key={status} className="badge" data-status={status}>
            {status} · {counts[status]}
          </span>
        ))}
        {flat.length === 0 ? <span className="muted">Sin tasks todavía.</span> : null}
      </div>

      <NewTaskForm parents={flat} />

      {tree.length === 0 ? (
        <article className="card">
          <p className="muted">
            La base de datos está vacía. Crea una task arriba o ejecuta <code>npm run db:seed</code>{' '}
            para cargar ejemplos.
          </p>
        </article>
      ) : (
        <div className="stack">
          {tree.map((node) => (
            <TaskCard key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}

      {events.length ? (
        <article className="card">
          <h2>Eventos recientes</h2>
          <ul className="events">
            {events.map((event) => (
              <li key={event.id}>
                <code>{event.event_type}</code> <span className="muted">{event.created_at}</span>
                {event.summary ? <div>{event.summary}</div> : null}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
