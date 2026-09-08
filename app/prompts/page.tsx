import Link from 'next/link';
import {
  countPromptsByStatus,
  listPrompts,
  listRuns,
  promptTaskLabel
} from '@/lib/hartask/repositories/prompts';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { listTasks } from '@/lib/hartask/repositories/tasks';
import { PROMPT_STATUSES, type Prompt, type Task } from '@/lib/hartask/types';
import {
  claimNextPromptAction,
  completePromptAction,
  createPromptAction,
  failPromptAction,
  setPromptStatusAction
} from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Prompt Stack · Hartask' };

function PromptCard({ prompt }: { prompt: Prompt }) {
  const runs = listRuns(prompt.id);
  const task = promptTaskLabel(prompt);
  const open = prompt.status === 'CLAIMED';

  return (
    <details className="card task" data-status={prompt.status}>
      <summary>
        <span className="task-head">
          <span className="badge" data-status={prompt.status}>
            {prompt.status}
          </span>
          <span className="task-title">{prompt.title ?? prompt.prompt.slice(0, 60)}</span>
          {runs.length ? (
            <span className="muted small">
              {runs.length} {runs.length === 1 ? 'intento' : 'intentos'}
            </span>
          ) : null}
          {prompt.claimed_by ? (
            <span className="muted small">· {prompt.claimed_by}</span>
          ) : null}
        </span>
        {task ? <span className="task-desc muted">{task}</span> : null}
        <span className="task-desc muted">{prompt.prompt}</span>
      </summary>

      <div className="task-body">
        {open ? (
          <>
            <form action={completePromptAction} className="row">
              <input type="hidden" name="uuid" value={prompt.uuid} />
              <input name="summary" placeholder="Qué se hizo" />
              <button type="submit">Completar</button>
            </form>
            <form action={failPromptAction} className="row">
              <input type="hidden" name="uuid" value={prompt.uuid} />
              <input name="error" placeholder="Qué falló" required />
              <label className="row checkbox">
                <input type="checkbox" name="retry" defaultChecked />
                <span className="small">Devolver a la cola</span>
              </label>
              <button type="submit">Marcar fallido</button>
            </form>
          </>
        ) : (
          <form action={setPromptStatusAction} className="row">
            <input type="hidden" name="uuid" value={prompt.uuid} />
            <select name="status" defaultValue={prompt.status} aria-label="Estado del prompt">
              {PROMPT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button type="submit">Cambiar estado</button>
          </form>
        )}

        {runs.length ? (
          <ol className="timeline">
            {runs.map((run) => (
              <li key={run.id}>
                <div className="row timeline-head">
                  <code>{run.status}</code>
                  <span className="muted small">{run.started_at}</span>
                  {run.agent_id ? <span className="muted small">· {run.agent_id}</span> : null}
                </div>
                {run.summary ? <div className="small">{run.summary}</div> : null}
                {run.error ? <div className="small blocked">{run.error}</div> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">Sin intentos todavía.</p>
        )}
      </div>
    </details>
  );
}

function NewPromptForm({ tasks }: { tasks: Task[] }) {
  return (
    <details className="card">
      <summary>
        <strong>Nuevo prompt</strong>
      </summary>
      <form action={createPromptAction} className="stack form">
        <input name="title" placeholder="Título (opcional)" />
        <textarea name="prompt" placeholder="La instrucción que ejecutará un agente" rows={4} required />
        <div className="row">
          <select name="status" defaultValue="DRAFT" aria-label="Estado inicial">
            <option value="DRAFT">DRAFT — todavía no entra a la cola</option>
            <option value="READY">READY — se puede reclamar</option>
          </select>
          <select name="task_id" defaultValue="" aria-label="Task que sirve">
            <option value="">Sin task</option>
            {tasks.map((task) => (
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

export default function PromptsPage() {
  ensureProject();

  const prompts = listPrompts();
  const counts = countPromptsByStatus();
  const queued = counts.READY ?? 0;
  const tasks = listTasks();

  return (
    <section className="stack sections">
      <div>
        <h1>Prompt Stack</h1>
        <p className="muted">Trabajo encolado que un agente puede reclamar y ejecutar.</p>
      </div>

      <div className="row wrap">
        {PROMPT_STATUSES.filter((status) => counts[status]).map((status) => (
          <span key={status} className="badge" data-status={status}>
            {status} · {counts[status]}
          </span>
        ))}
        {prompts.length === 0 ? <span className="muted">La cola está vacía.</span> : null}
      </div>

      <article className="card notice">
        <span>
          {queued
            ? `${queued} ${queued === 1 ? 'prompt listo' : 'prompts listos'} para reclamar.`
            : 'Nada listo para reclamar.'}{' '}
          Un agente los toma con <code>POST /api/prompts/claim</code>; reclamar es atómico, así que
          dos nunca reciben el mismo.
        </span>
        {queued ? (
          <form action={claimNextPromptAction} className="row">
            <input name="agent_id" placeholder="quién lo toma" defaultValue="human" />
            <button type="submit">Reclamar el siguiente</button>
          </form>
        ) : null}
      </article>

      <NewPromptForm tasks={tasks} />

      {prompts.length ? (
        <div className="stack">
          {prompts.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      ) : (
        <article className="card">
          <p className="muted">
            Sin prompts todavía. Un prompt no es una task: una task suele necesitar varios, y cada
            uno puede intentarse varias veces. Los intentos quedan como historial, que es{' '}
            <Link href="/tasks">lo que la task no guarda</Link>.
          </p>
        </article>
      )}
    </section>
  );
}
