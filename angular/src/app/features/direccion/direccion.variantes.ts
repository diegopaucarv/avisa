/**
 * Variantes del Resumen de Dirección (cambio 52).
 *
 * La misma pantalla se lee de tres formas conmutables. Todas usan cifras reales
 * del servidor; ninguna estima:
 *
 * - `nacional`: el conjunto completo (prioridad y riesgo del total de casos).
 * - `region`: el desglose regional ya existente, sin duplicarlo.
 * - `subsector`: casos por subsector y nivel de riesgo, con
 *   `GET /api/v1/search/subsectores`.
 *
 * El ámbito lo fija el rol, no un filtro: esta conmutación sólo cambia la
 * lectura del mismo conjunto.
 */
export type VarianteDireccion = 'nacional' | 'region' | 'subsector';

export type OpcionVariante = {
  valor: VarianteDireccion;
  etiqueta: string;
};

/** Orden fijo del conmutador; coincide con el de `dashboard-analitico.html`. */
export const VARIANTES: readonly OpcionVariante[] = [
  { valor: 'nacional', etiqueta: 'Nacional' },
  { valor: 'region', etiqueta: 'Por región' },
  { valor: 'subsector', etiqueta: 'Por subsector' },
];

const VALORES = new Set<string>(VARIANTES.map((opcion) => opcion.valor));

export function esVariante(valor: string): valor is VarianteDireccion {
  return VALORES.has(valor);
}

export function etiquetaVariante(valor: VarianteDireccion): string {
  return VARIANTES.find((opcion) => opcion.valor === valor)?.etiqueta ?? 'Nacional';
}

function clave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Nombre visible del subsector.
 *
 * `core.cat_subsectores` siembra `Pesca y Acuicultura` y `Mype e Industria`;
 * la interfaz usa «Pesca y acuicultura» y «MYPE e industria». Cualquier otro
 * subsector se muestra tal cual llega: no se inventa ni se colapsa.
 */
export function etiquetaSubsector(nombre: string): string {
  const limpio = clave(nombre);
  if (limpio === 'pesca y acuicultura') return 'Pesca y acuicultura';
  if (limpio === 'mype e industria') return 'MYPE e industria';
  return nombre.trim() || 'Sin subsector';
}
