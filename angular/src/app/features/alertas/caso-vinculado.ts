import { aDetalleCaso } from '../../dominio/mapeo';
import type { DemandaCaso } from '../../dominio/mapeo';

/**
 * Resumen de sólo lectura del caso vinculado a una alerta.
 *
 * La ficha de la alerta y la ventana de WhatsApp necesitan el mismo recorte de
 * `GET /api/v1/cases/{codigo}`: nombre, resumen, actores y demandas. Se guarda
 * ya mapeado para no repetir el dominio en cada pantalla.
 */
export type CasoVinculado = {
  codigo: string;
  titulo: string;
  resumen: string | null;
  actores: string[];
  demandas: string[];
};

/**
 * Tope de la caché. El caso puede cambiar en otra pantalla, así que la caché
 * sólo evita repetir la lectura al reabrir la misma alerta; el tope impide que
 * crezca sin límite durante una sesión larga.
 */
const MAX_CASOS = 20;
const cache = new Map<string, CasoVinculado>();

/** Caso ya leído en esta sesión, o `null` si todavía hay que pedirlo. */
export function leerCasoVinculado(codigo: string): CasoVinculado | null {
  return cache.get(codigo) ?? null;
}

/** Recuerda el caso leído; descarta las entradas más antiguas al pasar el tope. */
export function recordarCasoVinculado(caso: CasoVinculado): void {
  if (!caso.codigo) return;
  cache.delete(caso.codigo);
  cache.set(caso.codigo, caso);

  while (cache.size > MAX_CASOS) {
    const primero = cache.keys().next().value;
    if (primero === undefined) break;
    cache.delete(primero);
  }
}

/** «Descripción» de la demanda o, si falta, la primera de sus tres P. */
function textoDemanda(demanda: DemandaCaso): string | null {
  return demanda.descripcion ?? demanda.problema ?? demanda.pedido ?? demanda.propuesta;
}

/**
 * Respuesta cruda de `GET /api/v1/cases/{codigo}` → resumen del caso.
 *
 * Los actores se deduplican por nombre: el expediente puede repetir a una
 * persona en varios vínculos y la ficha no debe listarla dos veces.
 */
export function casoVinculadoDesde(bruto: unknown): CasoVinculado {
  const detalle = aDetalleCaso(bruto);
  const actores = detalle.actores
    .map((actor) => actor.nombre)
    .filter((nombre) => nombre.trim().length > 0 && nombre !== 'Sin nombre');
  const demandas = detalle.demandas
    .map(textoDemanda)
    .filter((demanda): demanda is string => !!demanda);

  return {
    codigo: detalle.caso.codigo,
    titulo: detalle.caso.titulo,
    resumen: detalle.caso.resumen,
    actores: [...new Set(actores)],
    demandas,
  };
}
