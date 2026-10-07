import { beforeEach, describe, expect, it } from 'vitest';
import {
  borrarCanal,
  canalCompleto,
  crearCanal,
  crearCanalesBasicos,
  cuenta,
  fijarMargenObjetivo,
  fijarPrecio,
  listarCanales,
  margenObjetivo,
  MARGEN_POR_DEFECTO,
  precioSugerido,
  preciosDe
} from '@/lib/micho/precios';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('precio de venta', () => {
  it('lo que deja un precio: comisión %, cargo fijo, envío y costo', () => {
    const ml = crearCanal({ nombre: 'ML', comision_pct: 15, cargo_fijo: 25, envio: 0 });
    const r = cuenta(200, 50, ml);
    expect(r.canal).toBeCloseTo(30 + 25);
    expect(r.ganancia).toBeCloseTo(200 - 30 - 25 - 50);
    expect(r.margen).toBeCloseTo(47.5);
  });

  it('el sugerido deja justo el margen objetivo (redondeado hacia arriba)', () => {
    const ml = crearCanal({ nombre: 'ML', comision_pct: 15, cargo_fijo: 25, envio: 10 });
    const sugerido = precioSugerido(50, ml, 30)!;
    expect(sugerido).toBe(Math.ceil(85 / 0.55));
    expect(cuenta(sugerido, 50, ml).margen).toBeGreaterThanOrEqual(30);
  });

  it('no hay precio posible si comisión + margen llegan a 100%', () => {
    const caro = crearCanal({ nombre: 'Caro', comision_pct: 80 });
    expect(precioSugerido(10, caro, 20)).toBeNull();
  });

  it('las tarifas desconocidas cuentan como 0 y el canal sale incompleto', () => {
    crearCanalesBasicos();
    crearCanalesBasicos();
    const canales = listarCanales();
    expect(canales.map((c) => c.nombre)).toEqual(['Mercado Libre', 'Instagram', 'Tiendanube']);
    expect(canales.every((c) => c.comision_pct === null && !canalCompleto(c))).toBe(true);
    expect(precioSugerido(70, canales[1], 30)).toBe(100);
  });

  it('guarda, quita y borra precios con su canal; el margen tiene un valor por defecto', () => {
    const ig = crearCanal({ nombre: 'IG' });
    fijarPrecio('laser-huacal', ig.id, 250);
    expect(preciosDe('laser-huacal').get(ig.id)).toBe(250);
    fijarPrecio('laser-huacal', ig.id, null);
    expect(preciosDe('laser-huacal').size).toBe(0);
    fijarPrecio('laser-huacal', ig.id, 260);
    expect(borrarCanal(ig.id)).toBe(1);

    expect(margenObjetivo()).toBe(MARGEN_POR_DEFECTO);
    fijarMargenObjetivo(40);
    expect(margenObjetivo()).toBe(40);
  });
});
