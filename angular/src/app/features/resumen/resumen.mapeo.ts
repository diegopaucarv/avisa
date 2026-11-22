/**
 * Resumen operativo: lectura de los agregados reales.
 *
 * No existe un endpoint de tablero. Los indicadores se calculan con el `total`
 * de los listados ya existentes, pedidos con `tamano=1` para no traer filas.
 * Aquí sólo vive lo imprescindible de esa lectura: extraer el total del sobre y
 * elegir los compromisos cuyo vencimiento está próximo o ya pasó.
 */

import { normalizarColeccion } from '../../core/http/coleccion';
import { esRegistro } from '../../dominio/mapeo';
import {
  resolverVencimiento,
  situacionDe,
  type Compromiso,
} from '../compromisos/compromiso.mapeo';

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

/** Situaciones que la pantalla de compromisos ya considera «atrasado» o «por vencer». */
const SITUACIONES_DE_ATENCION = new Set(['due-vencido', 'due-por-vencer']);

/**
 * Compromisos con vencimiento próximo o vencidos.
 *
 * `GET /api/v1/commitments` no ordena por vencimiento ni filtra por situación,
 * así que la selección se hace sobre las filas que sí devolvió el listado. Se
 * descartan los compromisos terminales (Cumplido, Redefinido, Desestimado):
 * su vencimiento ya no exige atención. El orden resultante es por fecha.
 */
export function compromisosPorVencer(
  compromisos: readonly Compromiso[],
  limite = 5,
): Compromiso[] {
  return compromisos
    .filter(
      (compromiso) =>
        !compromiso.terminal &&
        SITUACIONES_DE_ATENCION.has(situacionDe(compromiso).clase),
    )
    .sort((a, b) =>
      (resolverVencimiento(a).fecha ?? '9999-12-31').localeCompare(
        resolverVencimiento(b).fecha ?? '9999-12-31',
      ),
    )
    .slice(0, limite);
}
