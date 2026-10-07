'use client';

import { useState } from 'react';
import { estimarTemp } from '@/lib/micho/temperatura';

const REFERENCIA = [50, 100, 150, 200, 250, 300];

/**
 * Nozzle temperature for any speed from the tested points. Client-side so the
 * answer follows the number as it is typed; the maths is the same function
 * the server uses.
 */
export function EstimadorTemp({ puntos }: { puntos: { velocidad: number; boquilla: number }[] }) {
  const [velocidad, setVelocidad] = useState('');
  if (puntos.length < 2) {
    return (
      <span className="muted small">
        {puntos.length
          ? 'Con un solo punto no hay pendiente: agrega otra velocidad probada para estimar las demás.'
          : 'Agrega las velocidades que ya probaste para estimar las demás.'}
      </span>
    );
  }
  const v = Number(velocidad.replace(',', '.'));
  const r = velocidad && Number.isFinite(v) && v > 0 ? estimarTemp(puntos, v) : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="row campo-num">
        <span className="muted small">A</span>
        <input
          inputMode="decimal"
          value={velocidad}
          onChange={(e) => setVelocidad(e.target.value)}
          placeholder="mm/s"
          aria-label="Velocidad a estimar"
        />
        <span className="muted small">mm/s →</span>
        <strong className="temp-estimada">{r ? `${r.temp} °C` : '—'}</strong>
        {r ? <span className="muted small">({r.como})</span> : null}
      </label>
      <div className="temps-ref">
        {REFERENCIA.map((ref) => {
          const e = estimarTemp(puntos, ref)!;
          return (
            <span key={ref} className={`temp-ref temp-${e.como}`} title={e.como}>
              <span className="muted">{ref}</span> {e.temp}°
            </span>
          );
        })}
      </div>
    </div>
  );
}
