/**
 * Colour names as people write them for filament and material, mapped to a
 * swatch. A hex code anywhere in the text (e.g. "Naranja Esun #ff6a13") wins,
 * so an exact shade can always be given; an unknown name gets no swatch
 * rather than a wrong one.
 */
export const COLORES: Record<string, string> = {
  negro: '#151515',
  blanco: '#f4f4f2',
  gris: '#8a8f98',
  'gris oscuro': '#4a4f57',
  plata: '#c4c7cc',
  plateado: '#c4c7cc',
  rojo: '#d1312f',
  vino: '#7a1f2b',
  azul: '#1f5fd1',
  'azul marino': '#1d2a57',
  'azul cielo': '#6ec1f2',
  celeste: '#6ec1f2',
  turquesa: '#1fb5b0',
  verde: '#2e9d4f',
  'verde limon': '#a4cf3a',
  'verde militar': '#5b6b3a',
  amarillo: '#f5c518',
  naranja: '#f57c1f',
  rosa: '#f28db2',
  'rosa pastel': '#f7c5d6',
  fucsia: '#d6338a',
  morado: '#7b3fbf',
  lila: '#b49ae0',
  cafe: '#6d4c41',
  marron: '#6d4c41',
  beige: '#d9c7a5',
  piel: '#e9c4a0',
  dorado: '#c9a227',
  oro: '#c9a227',
  cobre: '#b87333',
  bronce: '#a97142',
  natural: '#d8c49a',
  madera: '#b08155',
  nogal: '#5d4030',
  transparente: 'transparent'
};

/** Names offered in the colour inputs, so the common ones are spelled the same way every time. */
export const NOMBRES_COLOR = [
  'Negro', 'Blanco', 'Gris', 'Gris oscuro', 'Plata', 'Rojo', 'Vino', 'Azul', 'Azul marino', 'Azul cielo',
  'Turquesa', 'Verde', 'Verde limón', 'Verde militar', 'Amarillo', 'Naranja', 'Rosa', 'Rosa pastel',
  'Fucsia', 'Morado', 'Lila', 'Café', 'Beige', 'Piel', 'Dorado', 'Cobre', 'Bronce', 'Natural', 'Madera',
  'Nogal', 'Transparente'
];

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** CSS colour for a name, or null when it is not one this knows. Longest match wins: "azul marino" over "azul". */
export function colorCss(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const hex = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(nombre);
  if (hex) return hex[0];
  const n = normalizar(nombre);
  const clave = Object.keys(COLORES)
    .filter((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(n))
    .sort((a, b) => b.length - a.length)[0];
  return clave ? COLORES[clave] : null;
}
