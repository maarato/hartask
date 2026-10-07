import { beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarInsumo,
  agregarLinea,
  borrarInsumo,
  costeoDe,
  crearInsumo,
  crearInsumosBasicos,
  listarInsumos,
  resumenMateriales,
  todosLosCosteos
} from '@/lib/micho/costos';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('costeo de productos', () => {
  it('sin líneas no hay costeo, que no es lo mismo que costar $0', () => {
    expect(costeoDe('laser-huacal')).toBeNull();
  });

  it('suma material, máquina y empaque por pieza', () => {
    const mdf = crearInsumo({ nombre: 'MDF 3 mm', unidad: 'hoja', precio: 40 });
    const laser = crearInsumo({ nombre: 'Láser diodo', tipo: 'Máquina', unidad: 'hora', precio: 20 });
    const caja = crearInsumo({ nombre: 'Caja', tipo: 'Empaque', unidad: 'pieza', precio: 5 });
    agregarLinea('laser-huacal', { insumoId: mdf.id, cantidad: 0.5 });
    agregarLinea('laser-huacal', { insumoId: laser.id, cantidad: 0.75 });
    agregarLinea('laser-huacal', { insumoId: caja.id, cantidad: 1 });

    const c = costeoDe('laser-huacal')!;
    expect(c.total).toBeCloseTo(20 + 15 + 5);
    expect(c.completo).toBe(true);
    expect(todosLosCosteos().get('laser-huacal')?.total).toBeCloseTo(40);
  });

  it('un insumo sin precio deja el costeo incompleto', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g' });
    agregarLinea('3d-gato', { insumoId: pla.id, cantidad: 40, color: 'negro' });
    const c = costeoDe('3d-gato')!;
    expect(c.completo).toBe(false);
    expect(c.total).toBe(0);
    expect(resumenMateriales(c)).toBe('PLA 40 g negro');

    actualizarInsumo(pla.id, { nombre: 'PLA', unidad: 'g', precio: 0.35 });
    expect(costeoDe('3d-gato')!.total).toBeCloseTo(14);
  });

  it('no borra un insumo que algún producto usa', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g' });
    const petg = crearInsumo({ nombre: 'PETG', unidad: 'g' });
    agregarLinea('3d-gato', { insumoId: pla.id, cantidad: 40 });
    expect(borrarInsumo(pla.id)).toBe(false);
    expect(borrarInsumo(petg.id)).toBe(true);
    expect(listarInsumos().map((i) => i.nombre)).toEqual(['PLA']);
  });

  it('crear los básicos no duplica ni pone precios', () => {
    crearInsumo({ nombre: 'pla', unidad: 'g', precio: 0.3 });
    crearInsumosBasicos();
    crearInsumosBasicos();
    const insumos = listarInsumos();
    expect(insumos.filter((i) => i.nombre.toLowerCase() === 'pla')).toHaveLength(1);
    expect(insumos.find((i) => i.nombre === 'MDF 3 mm')?.precio).toBeNull();
  });
});
