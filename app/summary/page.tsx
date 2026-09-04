import Link from 'next/link';
import { getLatestHandoff, listHandoffs } from '@/lib/hartask/repositories/handoff';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { getCurrentTask } from '@/lib/hartask/repositories/tasks';
import type { HandoffView, Task } from '@/lib/hartask/types';
import { saveHandoffAction, saveProjectContextAction } from './actions';

export const dynamic = 'force-dynamic';

/** One label/value row of the cold-start briefing. Renders nothing when empty. */
function Field({
  label,
  value,
  children
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  if (!value && !children) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? value}</dd>
    </>
  );
}

function LastContext({ handoff }: { handoff: HandoffView }) {
  const problems = handoff.known_problems?.split('\n').filter(Boolean) ?? [];

  return (
    <dl className="handoff">
      <Field label="Trabajabas en">
        {handoff.current_task ? (
          <span className="row">
            <Link href="/tasks">
              {handoff.current_task.public_id} · {handoff.current_task.title}
            </Link>
            <span className="badge" data-status={handoff.current_task.status}>
              {handoff.current_task.status}
            </span>
          </span>
        ) : null}
      </Field>

      <Field label="Último cambio" value={handoff.what_was_done} />
      <Field label="Estado actual" value={handoff.current_state} />

      {/* The single most actionable line of the briefing, so it is the one
          thing that does not read like the rest of the paragraphs. */}
      {handoff.next_step ? (
        <>
          <dt>Siguiente paso</dt>
          <dd className="next-step">{handoff.next_step}</dd>
        </>
      ) : null}

      <Field label="Problemas">
        {problems.length ? (
          <ul className="plain">
            {problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </Field>

      <Field label="Archivos">
        {handoff.important_files.length ? (
          <span className="chips">
            {handoff.important_files.map((file) => (
              <code key={file}>{file}</code>
            ))}
          </span>
        ) : null}
      </Field>

      <Field label="Decisiones" value={handoff.important_decisions} />
    </dl>
  );
}

function ProjectContext({ summary }: { summary: string | null }) {
  return (
    <article className="card stack">
      <header className="section-head">
        <h2>Project Context</h2>
        <p className="muted small">
          Si no abres el proyecto en tres meses, esto debería reorientarte en un minuto.
        </p>
      </header>

      {summary ? <div className="prose">{summary}</div> : null}

      {/* Reading is the common case, so editing is behind a disclosure — except
          when there is nothing to read yet. */}
      <details open={!summary}>
        <summary>{summary ? 'Editar' : 'Escribir el Project Context'}</summary>
        <form action={saveProjectContextAction} className="stack form">
          <textarea
            name="summary"
            defaultValue={summary ?? ''}
            placeholder="Propósito, arquitectura, conceptos principales y madurez actual."
            rows={12}
          />
          <button type="submit">Guardar Project Context</button>
        </form>
      </details>
    </article>
  );
}

function HandoffForm({ currentTaskId }: { currentTaskId: string }) {
  return (
    <details>
      <summary>Registrar checkpoint</summary>
      <form action={saveHandoffAction} className="stack form">
        <input
          name="current_task"
          defaultValue={currentTaskId}
          placeholder="Task actual (TASK-001)"
        />
        <textarea name="done" placeholder="Qué se hizo" rows={2} />
        <textarea name="current_state" placeholder="Estado actual" rows={2} />
        <textarea name="next" placeholder="Siguiente paso" rows={2} />
        <textarea name="problems" placeholder="Problemas conocidos (uno por línea)" rows={2} />
        <textarea
          name="important_files"
          placeholder="Archivos importantes (uno por línea)"
          rows={2}
        />
        <textarea name="important_decisions" placeholder="Decisiones importantes" rows={2} />
        <button type="submit">Guardar checkpoint</button>
      </form>
    </details>
  );
}

function EmptyHandoff({ currentTask }: { currentTask: Task | null }) {
  return (
    <div className="stack">
      <p className="muted">
        Todavía no hay checkpoints. Un agente puede crear uno con <code>POST /api/handoff</code>, o
        puedes escribirlo abajo.
      </p>
      {currentTask ? (
        <p>
          <strong>Trabajo en curso según Tasks:</strong>{' '}
          <Link href="/tasks">
            {currentTask.public_id} · {currentTask.title}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default function SummaryPage() {
  const project = ensureProject();
  const handoff = getLatestHandoff();
  const history = listHandoffs(6).slice(1);
  const currentTask = getCurrentTask();

  return (
    <section className="stack sections">
      <h1>Summary</h1>

      <ProjectContext summary={project.summary} />

      <article className="card stack">
        <header className="section-head">
          <h2>Último contexto</h2>
          <p className="muted small">
            {handoff
              ? `Checkpoint del ${handoff.created_at} · ${handoff.source}`
              : 'Dónde te quedaste y qué debería suceder después.'}
          </p>
        </header>

        {handoff ? <LastContext handoff={handoff} /> : <EmptyHandoff currentTask={currentTask} />}

        <HandoffForm
          currentTaskId={handoff?.current_task?.public_id ?? currentTask?.public_id ?? ''}
        />
      </article>

      {history.length ? (
        <article className="card stack">
          <header className="section-head">
            <h2>Checkpoints anteriores</h2>
            <p className="muted small">Cómo se entendió el estado del proyecto antes.</p>
          </header>
          <ul className="events">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="muted small">{entry.created_at}</span>
                {entry.next_step ? <div>Siguiente: {entry.next_step}</div> : null}
                {entry.current_state ? <div className="muted">{entry.current_state}</div> : null}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
