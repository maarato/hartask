import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  agregarLinea,
  borrarInsumo,
  costeoDe,
  crearInsumo,
  guardarPuntoTemp,
  guardarUso,
  listarInsumos,
  nombreInsumo,
  puntosTemp,
  resumenUso
} from '@/lib/micho/costos';
import { migrarMicho } from '@/lib/micho/migraciones';
import { estimarTemp } from '@/lib/micho/temperatura';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('estimarTemp', () => {
  const puntos = [
    { velocidad: 150, boquilla: 250 },
    { velocidad: 250, boquilla: 260 }
  ];

  it('con un solo punto solo responde esa velocidad: no inventa pendiente', () => {
    expect(estimarTemp([{ velocidad: 150, boquilla: 250 }], 150)).toEqual({ temp: 250, como: 'medido' });
    expect(estimarTemp([{ velocidad: 150, boquilla: 250 }], 200)).toBeNull();
    expect(estimarTemp([], 150)).toBeNull();
  });

  it('interpola entre puntos y extrapola con los dos más cercanos', () => {
    expect(estimarTemp(puntos, 200)).toEqual({ temp: 255, como: 'interpolado' });
    expect(estimarTemp(puntos, 300)).toEqual({ temp: 265, como: 'extrapolado' });
    expect(estimarTemp(puntos, 50)).toEqual({ temp: 240, como: 'extrapolado' });
    expect(
      estimarTemp([{ velocidad: 300, boquilla: 270 }, ...puntos], 400)
    ).toEqual({ temp: 290, como: 'extrapolado' });
  });
});

describe('marca y uso de materiales', () => {
  it('el mismo material de dos marcas son dos insumos, con su nombre completo', () => {
    const jayo = crearInsumo({ nombre: 'PETG', marca: 'Jayo', unidad: 'g' });
    crearInsumo({ nombre: 'PETG', marca: 'Esun', unidad: 'g' });
    expect(() => crearInsumo({ nombre: 'petg', marca: 'jayo', unidad: 'g' })).toThrow();
    expect(nombreInsumo(jayo)).toBe('PETG Jayo');
    agregarLinea('3d-gato', { insumoId: jayo.id, cantidad: 30, color: 'negro' });
    expect(costeoDe('3d-gato')!.lineas[0].insumo).toBe('PETG Jayo');
  });

  it('guarda cama, notas y puntos; la misma velocidad reemplaza; se van con el insumo', () => {
    const petg = crearInsumo({ nombre: 'PETG', marca: 'Jayo', unidad: 'g' });
    guardarUso(petg.id, { tempCama: 80, uso: 'Secar 4 h a 65 °C' });
    guardarPuntoTemp(petg.id, 150, 250);
    guardarPuntoTemp(petg.id, 150, 252);
    expect(puntosTemp(petg.id).map((p) => [p.velocidad, p.boquilla])).toEqual([[150, 252]]);
    const leido = listarInsumos()[0];
    expect(resumenUso(leido, puntosTemp(petg.id))).toBe('252 °C @ 150 mm/s · cama 80 °C');
    expect(borrarInsumo(petg.id)).toBe(true);
    expect(puntosTemp(petg.id)).toEqual([]);
  });
});

describe('migración de micho_insumos', () => {
  it('pasa de UNIQUE(nombre) a UNIQUE(nombre, marca) conservando ids y referencias', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE micho_insumos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
        tipo TEXT NOT NULL DEFAULT 'Material',
        unidad TEXT NOT NULL,
        precio REAL,
        notas TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        precio_compra REAL,
        presentacion REAL NOT NULL DEFAULT 1,
        marca TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
        temp_cama REAL,
        uso TEXT
      );
      CREATE TABLE micho_stock_materiales (
        id INTEGER PRIMARY KEY, insumo_id INTEGER NOT NULL REFERENCES micho_insumos(id), cantidad REAL
      );
      INSERT INTO micho_insumos (id, nombre, unidad, precio) VALUES (7, 'PETG', 'g', 0.4), (9, 'MDF 3 mm', 'hoja', 45);
      INSERT INTO micho_stock_materiales (insumo_id, cantidad) VALUES (7, 500);
    `);

    migrarMicho(db);
    migrarMicho(db);

    const filas = db.prepare(`SELECT id, nombre, precio FROM micho_insumos ORDER BY id`).all();
    expect(filas).toEqual([
      { id: 7, nombre: 'PETG', precio: 0.4 },
      { id: 9, nombre: 'MDF 3 mm', precio: 45 }
    ]);
    db.prepare(`INSERT INTO micho_insumos (nombre, marca, unidad) VALUES ('PETG', 'Esun', 'g')`).run();
    expect(() => db.prepare(`INSERT INTO micho_insumos (nombre, marca, unidad) VALUES ('PETG', 'esun', 'g')`).run()).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});
