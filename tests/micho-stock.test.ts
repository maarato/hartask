import { beforeEach, describe, expect, it } from 'vitest';
import { agregarLinea, borrarInsumo, crearInsumo } from '@/lib/micho/costos';
import {
  fabricar,
  fijarMaterial,
  fijarProducto,
  listarStockMateriales,
  movimientos,
  moverMaterial,
  moverProducto,
  stockPorProducto
} from '@/lib/micho/stock';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('stock', () => {
  it('lleva materiales por color y deja historial', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g' });
    moverMaterial(pla.id, 'negro', 1000, 'entrada');
    moverMaterial(pla.id, 'blanco', 500, 'entrada');
    moverMaterial(pla.id, 'negro', -200, 'salida');
    const filas = listarStockMateriales();
    expect(filas.map((f) => [f.color, f.cantidad])).toEqual([
      ['blanco', 500],
      ['negro', 800]
    ]);
    expect(movimientos().map((m) => m.delta)).toEqual([-200, 500, 1000]);
  });

  it('ajustar fija el conteo, registra la diferencia y avisa del mínimo', () => {
    const mdf = crearInsumo({ nombre: 'MDF 3 mm', unidad: 'hoja' });
    moverMaterial(mdf.id, null, 10, 'entrada');
    fijarMaterial(mdf.id, null, 3, 4);
    const [fila] = listarStockMateriales();
    expect(fila.cantidad).toBe(3);
    expect(fila.bajo).toBe(true);
    expect(movimientos()[0]).toMatchObject({ motivo: 'ajuste', delta: -7 });
  });

  it('fabricar suma piezas y descuenta material y empaque, no máquina', () => {
    const mdf = crearInsumo({ nombre: 'MDF 3 mm', unidad: 'hoja' });
    const caja = crearInsumo({ nombre: 'Caja', tipo: 'Empaque', unidad: 'pieza' });
    const laser = crearInsumo({ nombre: 'Láser', tipo: 'Máquina', unidad: 'hora' });
    agregarLinea('laser-huacal', { insumoId: mdf.id, cantidad: 0.5 });
    agregarLinea('laser-huacal', { insumoId: caja.id, cantidad: 1 });
    agregarLinea('laser-huacal', { insumoId: laser.id, cantidad: 0.75 });
    moverMaterial(mdf.id, null, 10, 'entrada');
    moverMaterial(caja.id, null, 2, 'entrada');

    const negativos = fabricar('laser-huacal', null, 4, true);

    expect(stockPorProducto().get('laser-huacal')?.total).toBe(4);
    const porNombre = Object.fromEntries(listarStockMateriales().map((f) => [f.insumo, f.cantidad]));
    expect(porNombre).toEqual({ 'MDF 3 mm': 8, Caja: -2 });
    expect(negativos.map((n) => n.insumo)).toEqual(['Caja']);
  });

  it('sin descontar solo suma piezas; vender y ajustar productos por variante', () => {
    const mdf = crearInsumo({ nombre: 'MDF 3 mm', unidad: 'hoja' });
    agregarLinea('laser-huacal', { insumoId: mdf.id, cantidad: 0.5 });
    fabricar('laser-huacal', 'natural', 5, false);
    moverProducto('laser-huacal', 'natural', -2, 'venta');
    fijarProducto('laser-huacal', 'nogal', 3);
    const s = stockPorProducto().get('laser-huacal')!;
    expect(s.total).toBe(6);
    expect(s.variantes.map((v) => [v.variante, v.cantidad])).toEqual([
      ['natural', 3],
      ['nogal', 3]
    ]);
    expect(listarStockMateriales()).toEqual([]);
  });

  it('no deja borrar un insumo con stock', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g' });
    moverMaterial(pla.id, 'negro', 10, 'entrada');
    expect(borrarInsumo(pla.id)).toBe(false);
  });
});
