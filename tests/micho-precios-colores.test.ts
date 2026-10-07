import { beforeEach, describe, expect, it } from 'vitest';
import { actualizarInsumo, agregarLinea, costeoDe, crearInsumo, crearInsumosBasicos, listarInsumos } from '@/lib/micho/costos';
import { colorCss } from '@/lib/micho/colores';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('precio por presentación', () => {
  it('saca el precio por gramo de lo que cuesta el carrete', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g', precioCompra: 350, presentacion: 1000 });
    expect(pla.precio).toBeCloseTo(0.35);
    expect(pla.precio_compra).toBe(350);
    expect(pla.presentacion).toBe(1000);
    agregarLinea('3d-gato', { insumoId: pla.id, cantidad: 40, color: 'negro' });
    expect(costeoDe('3d-gato')!.total).toBeCloseTo(14);
  });

  it('sin precio de compra no hay precio, aunque haya presentación', () => {
    const pla = crearInsumo({ nombre: 'PLA', unidad: 'g', presentacion: 1000 });
    expect(pla.precio).toBeNull();
    actualizarInsumo(pla.id, { nombre: 'PLA', unidad: 'g', precioCompra: 420, presentacion: 1000 });
    expect(listarInsumos()[0].precio).toBeCloseTo(0.42);
  });

  it('los básicos son solo materiales y el filamento viene por kilo', () => {
    crearInsumosBasicos();
    const insumos = listarInsumos();
    expect(insumos.every((i) => i.tipo === 'Material')).toBe(true);
    expect(insumos.find((i) => i.nombre === 'PLA')?.presentacion).toBe(1000);
  });
});

describe('colorCss', () => {
  it('reconoce nombres con o sin acento y prefiere el más específico', () => {
    expect(colorCss('Negro')).toBe('#151515');
    expect(colorCss('PLA verde limón')).toBe('#a4cf3a');
    expect(colorCss('Azul marino')).toBe('#1d2a57');
    expect(colorCss('café')).toBe('#6d4c41');
  });

  it('un hex en el texto gana y un nombre desconocido no inventa color', () => {
    expect(colorCss('Naranja Esun #ff6a13')).toBe('#ff6a13');
    expect(colorCss('Galaxy sparkle')).toBeNull();
    expect(colorCss('')).toBeNull();
  });
});
