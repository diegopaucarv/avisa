/**
 * Resumen operativo: lectura de los agregados reales y los rangos de
 * vencimiento que comparten Resumen y Bandeja.
 *
 * No existe un endpoint de tablero. Los indicadores se calculan con el `total`
 * de los listados ya existentes, pedidos con `tamano=1` para no traer filas.
 * Aquí viven dos piezas: extraer el total del sobre paginado y construir los
 * rangos de `vencimiento_desde`/`vencimiento_hasta` (ya vencido y por vencer)
 * que el servidor aplica sobre el vencimiento efectivo.
 */

import { normalizarColeccion } from '../../core/http/coleccion';
import { esRegistro } from '../../dominio/mapeo';

/** `total` del sobre paginado (`{items,total,...}`), sin construir filas. */
export function aTotal(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

/**
 * `sinCasoTotal` del sobre de `GET /api/v1/demandas`.
 *
 * El listado se pide con `sinCaso=true`, así que si el sobre todavía no trae la
 * clave, `total` es el mismo número: no se inventa una cifra distinta.
 */
export function aSinCasoTotal(bruto: unknown): number {
  if (esRegistro(bruto)) {
    const valor = bruto['sinCasoTotal'];
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  }
  return aTotal(bruto);
}

/** Horizonte de «por vencer»: hoy y los próximos 30 días, ambos inclusive. */
export const HORIZONTE_POR_VENCER_DIAS = 30;

/** `YYYY-MM-DD` de una fecha en hora local, sin pasar por `toISOString`. */
function isoLocal(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Suma días de calendario a una fecha `YYYY-MM-DD` (aritmética en UTC). */
function sumarDias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia + dias));
  const resultadoAnio = fecha.getUTCFullYear();
  const resultadoMes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const resultadoDia = String(fecha.getUTCDate()).padStart(2, '0');
  return `${resultadoAnio}-${resultadoMes}-${resultadoDia}`;
}

/**
 * Límite superior de lo ya vencido: ayer. Se envía como `vencimiento_hasta`
 * sin `desde`, de modo que abarca todo lo anterior a hoy.
 *
 * `situacionDe` marca como `due-vencido` exactamente lo que vence antes de hoy,
 * así que el recuento del servidor y la etiqueta de cada fila coinciden.
 */
export function rangoVencidos(hoy: Date = new Date()): { hasta: string } {
  return { hasta: sumarDias(isoLocal(hoy), -1) };
}

/**
 * Rango inclusivo para `GET /api/v1/commitments` que acota «por vencer» a hoy
 * y los próximos `dias` días.
 *
 * El servidor compara el rango contra el vencimiento efectivo (fecha manual y,
 * si falta, la del próximo hito no terminal) y ordena por esa misma fecha de
 * forma ascendente, así que el `total` del sobre es el recuento exacto y la
 * primera página trae los vencimientos más próximos.
 */
export function rangoPorVencer(
  hoy: Date = new Date(),
  dias: number = HORIZONTE_POR_VENCER_DIAS,
): { desde: string; hasta: string } {
  const desde = isoLocal(hoy);
  return { desde, hasta: sumarDias(desde, dias) };
}
