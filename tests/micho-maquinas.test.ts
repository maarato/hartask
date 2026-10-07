import { beforeEach, describe, expect, it } from 'vitest';
import { agregarLinea, borrarInsumo, crearInsumo } from '@/lib/micho/costos';
import { asegurarFicha, FICHA_MAQUINA, obtenerFicha } from '@/lib/micho/fichas';
import {
  actualizarMaquina,
  cambiarEstado,
  cargarConsumible,
  claveFicha,
  colaDe,
  consumiblesDe,
  crearMaquina,
  detallesDe,
  encolar,
  guardarDetalles,
  moverTrabajo,
  obtenerMaquina,
  reordenar
} from '@/lib/micho/maquinas';
import { fabricar, stockPorProducto } from '@/lib/micho/stock';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('máquinas', () => {
  it('crea con slug único y los detalles base de su tipo, sin valores', () => {
    const a = crearMaquina({ nombre: 'Creality K1C' });
    const b = crearMaquina({ nombre: 'Creality K1C' });
    expect([a.slug, b.slug]).toEqual(['creality-k1c', 'creality-k1c-2']);
    const detalles = detallesDe(a.id);
    expect(detalles.map((d) => d.clave)).toContain('Boquilla');
    expect(detalles.every((d) => d.valor === null)).toBe(true);
    expect(detallesDe(crearMaquina({ nombre: 'Atomstack A10', tipo: 'Láser diodo' }).id)[0].clave).toBe(
      'Potencia del módulo'
    );
  });

  it('guarda detalles en orden y quita los que quedan sin nombre', () => {
    const m = crearMaquina({ nombre: 'Ender 3 V3 SE' });
    guardarDetalles(m.id, [
      { clave: 'Boquilla', valor: '0.4 mm' },
      { clave: '', valor: 'huérfano' },
      { clave: 'Cama', valor: '' }
    ]);
    expect(detallesDe(m.id).map((d) => [d.clave, d.valor])).toEqual([
      ['Boquilla', '0.4 mm'],
      ['Cama', null]
    ]);
  });

  it('muestra todas las ranuras y vacía las que sobran al reducirlas', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g' });
    const m = crearMaquina({ nombre: 'Bambu A1 AMS', ranuras: 4 });
    cargarConsumible(m.id, 1, { insumoId: pla.id, color: 'rojo' });
    cargarConsumible(m.id, 4, { insumoId: pla.id, color: 'negro' });
    expect(consumiblesDe(m).map((c) => c.color)).toEqual(['rojo', null, null, 'negro']);
    expect(borrarInsumo(pla.id)).toBe(false);

    actualizarMaquina(m.id, { nombre: m.nombre, tipo: m.tipo, ranuras: 2 });
    expect(consumiblesDe(obtenerMaquina(m.slug)!).map((c) => c.color)).toEqual(['rojo', null]);

    cargarConsumible(m.id, 1, { insumoId: null });
    expect(consumiblesDe(obtenerMaquina(m.slug)!)[0].insumo).toBeNull();
  });

  it('la cola cambia el estado de la máquina sin pisar una falla', () => {
    const m = crearMaquina({ nombre: 'Kobra X', ranuras: 4 });
    encolar(m.id, { descripcion: 'uno' });
    encolar(m.id, { descripcion: 'dos' });
    const [uno, dos] = colaDe(m.id);
    reordenar(dos.id, -1);
    expect(colaDe(m.id).map((t) => t.descripcion)).toEqual(['dos', 'uno']);

    moverTrabajo(uno.id, 'En curso');
    expect(obtenerMaquina(m.slug)!.estado).toBe('Trabajando');
    expect(colaDe(m.id)[0].descripcion).toBe('uno');
    moverTrabajo(uno.id, 'Hecho');
    expect(obtenerMaquina(m.slug)!.estado).toBe('Activa');

    moverTrabajo(dos.id, 'En curso');
    cambiarEstado(m.id, 'Falla');
    moverTrabajo(dos.id, 'Cancelado');
    expect(obtenerMaquina(m.slug)!.estado).toBe('Falla');
    expect(colaDe(m.id)).toEqual([]);
    expect(colaDe(m.id, true)).toHaveLength(2);
  });

  it('un trabajo de producto terminado puede pasar a stock', () => {
    const mdf = crearInsumo({ nombre: 'MDF 3 mm', unidad: 'hoja' });
    agregarLinea('laser-huacal', { insumoId: mdf.id, cantidad: 0.5 });
    const m = crearMaquina({ nombre: 'TTS-55 Pro', tipo: 'Láser diodo' });
    encolar(m.id, { productoSlug: 'laser-huacal', piezas: 6 });
    const t = moverTrabajo(colaDe(m.id)[0].id, 'Hecho')!;
    fabricar(t.producto_slug!, null, t.piezas, true);
    expect(stockPorProducto().get('laser-huacal')?.total).toBe(6);
  });

  it('su ficha vive bajo una raíz Máquinas que se crea sola', () => {
    const m = crearMaquina({ nombre: 'Atomstack A10', tipo: 'Láser diodo' });
    const ficha = asegurarFicha(claveFicha(m.slug), m.nombre, null, FICHA_MAQUINA);
    expect(ficha.title).toBe('Máquina: Atomstack A10');
    expect(ficha.category).toBe('Máquinas');
    expect(ficha.parent_id).not.toBeNull();
    expect(obtenerFicha(claveFicha(m.slug))?.tarea.id).toBe(ficha.id);
    expect(obtenerFicha(m.slug)).toBeNull();
  });
});
