import Link from 'next/link';
import { archiveReminderThreshold } from '@/lib/hartask/config';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import {
  countArchivableRoots,
  countTasksByStatus,
  listEvents,
  listTasks,
  listTaskTree
} from '@/lib/hartask/repositories/tasks';
import {
  isArchivable,
  STATUS_ORDER,
  TASK_STATUSES,
  type Task,
  type TaskNode
} from '@/lib/hartask/types';
import {
  archiveAllArchivableAction,
  archiveTaskAction,
  createTaskAction,
  setNextActionAction,
  setTaskStatusAction,
  unarchiveTaskAction
} from './actions';

// The page reads SQLite on every request, so it must never be prerendered.
export const dynamic = 'force-dynamic';

function ArchiveIcon({ restore = false }: { restore?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      {restore ? <path d="M12 17v-5M9.5 14.5 12 12l2.5 2.5" /> : <path d="M10 12h4" />}
    </svg>
  );
}

/** Subtasks that still need work, so a collapsed parent says what it is hiding. */
function openChildCount(node: TaskNode): number {
  return node.children.filter((child) => child.status !== 'DONE' && child.status !== 'CANCELLED')
    .length;
}

/**
 * Cards are collapsed by default and use native details/summary, which keeps
 * the page free of client JS. What stays visible when collapsed is what the
 * view exists to answer: status, what the task is, and why it is blocked.
 */
function TaskCard({ node, depth }: { node: TaskNode; depth: number }) {
  const open = openChildCount(node);
  // Archiving takes the whole branch, so it is offered on root tasks only.
  const canArchive = node.parent_id === null && isArchivable(node.status);

  return (
    <details className="card task" data-status={node.status} style={{ marginLeft: depth * 20 }}>
      <summary>
        <span className="task-head">
          <span className="badge" data-status={node.status}>
            {node.status}
          </span>
          <span className="task-title">
            <Link href={`/tasks/${node.public_id}`} className="task-link">
              {node.public_id}
            </Link>{' '}
            · {node.title}
          </span>
          {node.children.length ? (
            <span className="muted small">
              {open
                ? `${open}/${node.children.length} subtasks abiertas`
                : `${node.children.length} subtasks`}
            </span>
          ) : null}

          {canArchive ? (
            <form action={archiveTaskAction} className="task-actions">
              <input type="hidden" name="public_id" value={node.public_id} />
              <button
                type="submit"
                className="icon-button"
                title={`Archivar ${node.public_id}${node.children.length ? ' y sus subtasks' : ''}`}
                aria-label={`Archivar ${node.public_id}`}
              >
                <ArchiveIcon />
              </button>
            </form>
          ) : null}
        </span>

        {node.description ? <span className="task-desc muted">{node.description}</span> : null}

        {node.status === 'BLOCKED' && node.blocked_reason ? (
          <span className="task-desc blocked">Bloqueo: {node.blocked_reason}</span>
        ) : null}
      </summary>

      <div className="task-body">
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
          <select
            name="status"
            defaultValue={node.status}
            aria-label={`Estado de ${node.public_id}`}
          >
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
      </div>
    </details>
  );
}

/**
 * Shown once archivable work passes the configured threshold. The board is
 * only useful while it can be read at a glance, so it says when it is drifting
 * out of that range instead of waiting to be noticed.
 */
function ArchiveReminder({ count, threshold }: { count: number; threshold: number }) {
  return (
    <form action={archiveAllArchivableAction} className="card notice">
      <span>
        <strong>{count} tasks archivables</strong> en el board (DONE o BACKLOG, más de{' '}
        {threshold}). Archivarlas las saca de la vista sin borrarlas; siguen en{' '}
        <em>Archivadas</em>.
      </span>
      <button type="submit">Archivar todo</button>
    </form>
  );
}

function ArchivedTasks({ tasks }: { tasks: TaskNode[] }) {
  return (
    <details className="card">
      <summary>
        <strong>Archivadas</strong> <span className="muted">· {tasks.length}</span>
      </summary>
      <div className="stack form">
        {tasks.map((task) => (
          <div key={task.id} className="row archived-row">
            <span className="badge" data-status={task.status}>
              {task.status}
            </span>
            <span className="task-title">
              <Link href={`/tasks/${task.public_id}`} className="task-link">
                {task.public_id}
              </Link>{' '}
              · {task.title}
            </span>
            {task.children.length ? (
              <span className="muted small">{task.children.length} subtasks</span>
            ) : null}
            <span className="muted small">{task.archived_at}</span>
            <form action={unarchiveTaskAction} className="task-actions">
              <input type="hidden" name="public_id" value={task.public_id} />
              <button
                type="submit"
                className="icon-button"
                title={`Restaurar ${task.public_id} al board`}
                aria-label={`Restaurar ${task.public_id}`}
              >
                <ArchiveIcon restore />
              </button>
            </form>
          </div>
        ))}
      </div>
    </details>
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
  const archived = listTaskTree({ onlyArchived: true });
  const counts = countTasksByStatus();
  const events = listEvents({ limit: 8 });
  const archivable = countArchivableRoots();
  const threshold = archiveReminderThreshold();

  return (
    <section className="stack">
      <div>
        <h1>Tasks</h1>
        <p className="muted">Qué estás haciendo, qué sigue y qué está bloqueado.</p>
      </div>

      <div className="row wrap">
        {STATUS_ORDER.filter((status) => counts[status]).map((status) => (
          <span key={status} className="badge" data-status={status}>
            {status} · {counts[status]}
          </span>
        ))}
        {flat.length === 0 ? <span className="muted">Sin tasks activas.</span> : null}
      </div>

      {archivable > threshold ? (
        <ArchiveReminder count={archivable} threshold={threshold} />
      ) : null}

      <NewTaskForm parents={flat} />

      {tree.length === 0 ? (
        <article className="card">
          <p className="muted">
            No hay tasks en el board. Crea una arriba
            {archived.length ? ', restaura una archivada abajo' : ''} o ejecuta{' '}
            <code>npm run db:seed</code> para cargar ejemplos.
          </p>
        </article>
      ) : (
        <div className="stack">
          {tree.map((node) => (
            <TaskCard key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}

      {archived.length ? <ArchivedTasks tasks={archived} /> : null}

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
