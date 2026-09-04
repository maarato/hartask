import Link from 'next/link';
import { getLatestHandoff, listHandoffs } from '@/lib/hartask/repositories/handoff';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { getCurrentTask } from '@/lib/hartask/repositories/tasks';
import type { HandoffView } from '@/lib/hartask/types';
import { saveHandoffAction, saveProjectContextAction } from './actions';

export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p>
      <strong>{label}:</strong> {value}
    </p>
  );
}

function LastContext({ handoff }: { handoff: HandoffView }) {
  return (
    <div className="stack">
      {handoff.current_task ? (
        <p>
          <strong>Trabajabas en:</strong> {handoff.current_task.public_id} ·{' '}
          {handoff.current_task.title}{' '}
          <span className="badge" data-status={handoff.current_task.status}>
            {handoff.current_task.status}
          </span>
        </p>
      ) : null}

      <Field label="Último cambio" value={handoff.what_was_done} />
      <Field label="Estado actual" value={handoff.current_state} />
      <Field label="Siguiente paso" value={handoff.next_step} />
      <Field label="Decisiones" value={handoff.important_decisions} />

      {handoff.known_problems ? (
        <div>
          <strong>Problemas conocidos:</strong>
          <ul>
            {handoff.known_problems.split('\n').map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {handoff.important_files.length ? (
        <div>
          <strong>Archivos importantes:</strong>
          <ul>
            {handoff.important_files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="muted small">
        {handoff.created_at} · origen: {handoff.source}
      </p>
    </div>
  );
}

function HandoffForm({ currentTaskId }: { currentTaskId: string }) {
  return (
    <details className="card">
      <summary>
        <strong>Registrar checkpoint</strong>
      </summary>
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

export default function SummaryPage() {
  const project = ensureProject();
  const handoff = getLatestHandoff();
  const history = listHandoffs(6).slice(1);
  const currentTask = getCurrentTask();

  return (
    <section className="stack">
      <h1>Summary</h1>

      <div className="grid grid-2">
        <article className="card">
          <h2>Project Context</h2>
          <p className="muted">
            README reducido: si no abres el proyecto en tres meses, esto debería reorientarte en un
            minuto.
          </p>
          <form action={saveProjectContextAction} className="stack form">
            <textarea
              name="summary"
              defaultValue={project.summary ?? ''}
              placeholder="Propósito, arquitectura, conceptos y madurez actual del proyecto."
              rows={10}
            />
            <button type="submit">Guardar Project Context</button>
          </form>
        </article>

        <article className="card">
          <h2>Último contexto</h2>
          <p className="muted">Dónde te quedaste y qué debería suceder después.</p>

          {handoff ? (
            <LastContext handoff={handoff} />
          ) : (
            <div className="stack">
              <p className="muted">
                Todavía no hay checkpoints. Un agente puede crear uno con{' '}
                <code>POST /api/handoff</code>, o puedes escribirlo abajo.
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
          )}

          <HandoffForm currentTaskId={handoff?.current_task?.public_id ?? currentTask?.public_id ?? ''} />
        </article>
      </div>

      {history.length ? (
        <article className="card">
          <h2>Checkpoints anteriores</h2>
          <ul className="events">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="muted">{entry.created_at}</span>
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
