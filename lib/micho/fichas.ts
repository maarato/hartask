import { getDb } from '@/lib/db/client';
import { createTask, listNotes, listTasks } from '@/lib/hartask/repositories/tasks';
import type { Task, TaskNote } from '@/lib/hartask/types';

/**
 * A product's ficha is an ordinary Hartask task, so everything Hartask already
 * does for tasks — status, next action, notes, events, the API agents use —
 * works for products without a second model:
 *
 *   description  → the product's information, in Markdown
 *   next_action  → what comes next
 *   notes        → findings, dated, newest first
 *   children     → the product's tasks
 *
 * The only thing added is which folder each ficha belongs to.
 */

export const CATEGORIA = 'Productos';

export type Ficha = {
  tarea: Task;
  subtareas: Task[];
  hallazgos: TaskNote[];
};

function porUuid(uuid: string): Task | null {
  return (getDb().prepare(`SELECT * FROM tasks WHERE uuid = ?`).get(uuid) as Task | undefined) ?? null;
}

function tareaDeFicha(slug: string): Task | null {
  const fila = getDb()
    .prepare(`SELECT task_uuid FROM micho_product_tasks WHERE slug = ?`)
    .get(slug) as { task_uuid: string } | undefined;
  return fila ? porUuid(fila.task_uuid) : null;
}

/**
 * The board's root task for an area ("Productos", "Máquinas"), so fichas sit
 * under it instead of loose at the top. Created when `crear` and missing.
 */
function raiz(titulo: string, crear: boolean): number | null {
  const fila = getDb()
    .prepare(
      `SELECT id FROM tasks WHERE parent_id IS NULL AND title = ? COLLATE NOCASE AND archived_at IS NULL
       ORDER BY id LIMIT 1`
    )
    .get(titulo) as { id: number } | undefined;
  if (fila) return fila.id;
  return crear ? createTask({ title: titulo, category: titulo, priority: 2 }).id : null;
}

/** What kind of thing a ficha belongs to: decides its title prefix and where it sits on the board. */
export type TipoFicha = { prefijo: string; raiz: string; crearRaiz: boolean };

export const FICHA_PRODUCTO: TipoFicha = { prefijo: 'Producto', raiz: CATEGORIA, crearRaiz: false };
export const FICHA_MAQUINA: TipoFicha = { prefijo: 'Máquina', raiz: 'Máquinas', crearRaiz: true };

export function obtenerFicha(slug: string): Ficha | null {
  const tarea = tareaDeFicha(slug);
  if (!tarea) return null;
  return {
    tarea,
    subtareas: listTasks({ parentId: tarea.id, includeArchived: false }),
    hallazgos: listNotes(tarea.id)
  };
}

/**
 * Returns the ficha task, creating it on first use. A link whose task no
 * longer exists is replaced rather than left pointing nowhere. Machine fichas
 * use the key `maquina:<slug>`, so they never collide with a product.
 */
export function asegurarFicha(
  slug: string,
  nombre: string,
  agentId?: string | null,
  tipo: TipoFicha = FICHA_PRODUCTO
): Task {
  const db = getDb();
  const run = db.transaction((): Task => {
    const existente = tareaDeFicha(slug);
    if (existente) return existente;
    const tarea = createTask({
      title: `${tipo.prefijo}: ${nombre}`,
      parentId: raiz(tipo.raiz, tipo.crearRaiz),
      category: tipo.raiz,
      priority: 2,
      agentId: agentId ?? null
    });
    db.prepare(
      `INSERT INTO micho_product_tasks (slug, task_uuid) VALUES (?, ?)
       ON CONFLICT(slug) DO UPDATE SET task_uuid = excluded.task_uuid`
    ).run(slug, tarea.uuid);
    return tarea;
  });
  return run();
}

export type ResumenFicha = {
  public_id: string;
  status: Task['status'];
  next_action: string | null;
  pendientes: number;
};

/** One query's worth of summary per product, for the catalogue cards. */
export function resumenFichas(): Map<string, ResumenFicha> {
  const filas = getDb()
    .prepare(
      `SELECT m.slug, t.public_id, t.status, t.next_action,
              (SELECT COUNT(*) FROM tasks c
                WHERE c.parent_id = t.id AND c.archived_at IS NULL
                  AND c.status NOT IN ('DONE','CANCELLED')) AS pendientes
         FROM micho_product_tasks m JOIN tasks t ON t.uuid = m.task_uuid`
    )
    .all() as (ResumenFicha & { slug: string })[];
  return new Map(filas.map(({ slug, ...r }) => [slug, r]));
}

/** Slug → ficha public id, for agents that need to find a product's task. */
export function listarVinculos(): { slug: string; public_id: string }[] {
  return getDb()
    .prepare(
      `SELECT m.slug, t.public_id FROM micho_product_tasks m JOIN tasks t ON t.uuid = m.task_uuid ORDER BY m.slug`
    )
    .all() as { slug: string; public_id: string }[];
}

/** Every linked product's full ficha, for the list view. Few products, so one read each is fine. */
export function todasLasFichas(): Map<string, Ficha> {
  const out = new Map<string, Ficha>();
  for (const { slug } of listarVinculos()) {
    const ficha = obtenerFicha(slug);
    if (ficha) out.set(slug, ficha);
  }
  return out;
}
