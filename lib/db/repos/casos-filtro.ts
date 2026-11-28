/**
 * Filtro compartido para dejar fuera los casos espejo de mesas de diálogo.
 *
 * La migración 81 crea un caso por mesa con `codigo_caso = 'MD-AAAA-NNNN'` y lo
 * enlaza en `core.mesas_dialogo.caso_id`. Esos casos no declaran distrito, nivel
 * de conflicto ni prioridad: si aparecen en listados, agregados o exportaciones
 * generan filas vacías y totales inflados. Siguen accesibles por su código con
 * `getCaseByCode`; lo que se excluye es su aparición en los conjuntos oficiales.
 *
 * Los listados oficiales siguen excluyéndolos con `excluirCasosMesa`; el
 * listado de casos puede pedirlos explícitamente con `soloCasosMesa` (el switch
 * «Casos / Mesas de diálogo» de la barra de filtros), de modo que el mismo
 * endpoint sirva ambas vistas sin duplicar repositorios.
 */

/** Prefijo de los códigos de caso que espejan una mesa de diálogo. */
export const PREFIJO_CASO_MESA = "MD-";

/**
 * Predicado SQL estático (sin parámetros, sin `$1`) que descarta los casos de
 * mesa. `alias` es el alias de la tabla o vista que expone `codigo_caso` (por
 * ejemplo `c`, `cs` o `v15`); sin alias se usa la columna sin calificar.
 * Tolera el código nulo: `coalesce` lo vuelve cadena vacía, que no empieza por
 * el prefijo.
 */
export function excluirCasosMesa(alias?: string): string {
  const columna = alias ? `${alias}.codigo_caso` : "codigo_caso";
  return `coalesce(${columna}, '') not like '${PREFIJO_CASO_MESA}%'`;
}

/**
 * Complemento exacto de `excluirCasosMesa`: deja **sólo** los casos espejo de
 * mesa. Lo usa el listado de casos cuando la barra cambia al modo «Mesas de
 * diálogo»; el resto de filtros (búsqueda, riesgo, estado) siguen aplicándose.
 * Tolera el código nulo por la misma razón que su complemento.
 */
export function soloCasosMesa(alias?: string): string {
  const columna = alias ? `${alias}.codigo_caso` : "codigo_caso";
  return `coalesce(${columna}, '') like '${PREFIJO_CASO_MESA}%'`;
}
