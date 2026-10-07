import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { addNote, createTask, setTaskStatus } from '@/lib/hartask/repositories/tasks';
import { asegurarFicha, listarVinculos, obtenerFicha, resumenFichas } from '@/lib/micho/fichas';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('fichas de producto', () => {
  it('no existe hasta que se pide', () => {
    expect(obtenerFicha('laser-huacal')).toBeNull();
  });

  it('crea la ficha una sola vez, debajo de la raíz Productos', () => {
    const raiz = createTask({ title: 'Productos', category: 'Productos' });
    const a = asegurarFicha('laser-huacal', 'Huacal');
    const b = asegurarFicha('laser-huacal', 'Huacal');
    expect(b.id).toBe(a.id);
    expect(a.parent_id).toBe(raiz.id);
    expect(a.title).toBe('Producto: Huacal');
    expect(a.category).toBe('Productos');
    expect(listarVinculos()).toEqual([{ slug: 'laser-huacal', public_id: a.public_id }]);
  });

  it('reúne subtareas, hallazgos y el conteo de pendientes', () => {
    const ficha = asegurarFicha('laser-huacal', 'Huacal');
    const t1 = createTask({ title: 'Fotos', parentId: ficha.id });
    createTask({ title: 'Ficha ML', parentId: ficha.id });
    setTaskStatus(t1.id, 'DONE');
    addNote(ficha.id, 'con 6 pasadas corta bien', 'human');

    const leida = obtenerFicha('laser-huacal')!;
    expect(leida.subtareas.map((t) => t.title).sort()).toEqual(['Ficha ML', 'Fotos']);
    expect(leida.hallazgos.map((n) => n.body)).toEqual(['con 6 pasadas corta bien']);
    expect(resumenFichas().get('laser-huacal')?.pendientes).toBe(1);
  });

  it('reemplaza un vínculo cuya tarea ya no existe', () => {
    const vieja = asegurarFicha('laser-huacal', 'Huacal');
    getDb().prepare(`DELETE FROM task_events WHERE task_id = ?`).run(vieja.id);
    getDb().prepare(`DELETE FROM tasks WHERE id = ?`).run(vieja.id);
    const nueva = asegurarFicha('laser-huacal', 'Huacal');
    expect(nueva.id).not.toBe(vieja.id);
    expect(obtenerFicha('laser-huacal')?.tarea.id).toBe(nueva.id);
  });
});
