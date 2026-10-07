/** Pure maths, safe to import from client components. */

export type Estimacion = {
  temp: number;
  /** 'medido' at a tested speed, 'interpolado' between two, 'extrapolado' beyond them. */
  como: 'medido' | 'interpolado' | 'extrapolado';
};

/**
 * Nozzle temperature for a speed, on the straight line through the tested
 * points: between two of them it interpolates, beyond them it extends the
 * line through the two nearest. One point gives no slope, so only that exact
 * speed has an answer — guessing a slope would be inventing data.
 * Rounded to whole degrees.
 */
export function estimarTemp(
  puntos: { velocidad: number; boquilla: number }[],
  velocidad: number
): Estimacion | null {
  const p = [...puntos].sort((a, b) => a.velocidad - b.velocidad);
  const exacto = p.find((x) => x.velocidad === velocidad);
  if (exacto) return { temp: Math.round(exacto.boquilla), como: 'medido' };
  if (p.length < 2) return null;

  let a: (typeof p)[number];
  let b: (typeof p)[number];
  let como: Estimacion['como'];
  if (velocidad < p[0].velocidad) {
    [a, b, como] = [p[0], p[1], 'extrapolado'];
  } else if (velocidad > p[p.length - 1].velocidad) {
    [a, b, como] = [p[p.length - 2], p[p.length - 1], 'extrapolado'];
  } else {
    const i = p.findIndex((x) => x.velocidad > velocidad);
    [a, b, como] = [p[i - 1], p[i], 'interpolado'];
  }
  const pendiente = (b.boquilla - a.boquilla) / (b.velocidad - a.velocidad);
  return { temp: Math.round(a.boquilla + pendiente * (velocidad - a.velocidad)), como };
}
