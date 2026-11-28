/**
 * Mapeo del aviso de duplicados de `GET /api/v1/alerts/duplicados`.
 *
 * El endpoint devuelve camelCase; se acepta snake_case por la misma razón que
 * `casos/duplicados.mapeo.ts`: un despliegue viejo no debe romper el alta. Si un
 * candidato no trae coincidencias se deja la lista vacía: nunca se supone el
 * motivo de la similitud.
 */

import { esRegistro, leer, lista, texto } from '../../dominio/mapeo';

/** Criterio que efectivamente coincidió entre dos alertas. */
export type CriterioDuplicadoAlerta = 'titulo' | 'distrito';

export type CandidatoDuplicadoAlerta = {
  id: string;
  codigo: string;
  titulo: string | null;
  /** `YYYY-MM-DD` de la fecha de reporte, si el servidor la trae. */
  fecha: string | null;
  estado: string;
  distrito: string | null;
  coincidencias: CriterioDuplicadoAlerta[];
};

export type DuplicadosAlertaAviso = {
  candidatos: CandidatoDuplicadoAlerta[];
  generadoEn: string | null;
};

const CRITERIOS: readonly CriterioDuplicadoAlerta[] = ['titulo', 'distrito'];

function aCriterio(valor: unknown): CriterioDuplicadoAlerta | null {
  return typeof valor === 'string' && (CRITERIOS as readonly string[]).includes(valor)
    ? (valor as CriterioDuplicadoAlerta)
    : null;
}

function aCandidato(bruto: unknown): CandidatoDuplicadoAlerta | null {
  if (!esRegistro(bruto)) return null;
  const codigo = texto(bruto, ['codigo']);
  // Sin código no hay forma de referenciar el candidato al marcar duplicada:
  // se descarta en silencio para no pintar filas que no se pueden usar.
  if (!codigo) return null;

  return {
    id: texto(bruto, ['id']) ?? '',
    codigo,
    titulo: texto(bruto, ['titulo']),
    fecha: texto(bruto, ['fecha']),
    estado: texto(bruto, ['estado']) ?? '',
    distrito: texto(bruto, ['distrito']),
    coincidencias: lista(bruto, ['coincidencias'])
      .map(aCriterio)
      .filter((criterio): criterio is CriterioDuplicadoAlerta => criterio !== null),
  };
}

/** Normaliza la respuesta de duplicados a la forma que consumen los paneles. */
export function aDuplicadosAlerta(bruto: unknown): DuplicadosAlertaAviso {
  const fuente = esRegistro(bruto) ? bruto : {};
  const generadoEn = leer(fuente, ['generadoEn', 'generated_at']);
  return {
    candidatos: lista(fuente, ['candidatos'])
      .map(aCandidato)
      .filter((candidato): candidato is CandidatoDuplicadoAlerta => candidato !== null),
    generadoEn: typeof generadoEn === 'string' ? generadoEn : null,
  };
}

/** Etiqueta visible del criterio que coincidió entre dos alertas. */
export function etiquetaCriterioAlerta(criterio: CriterioDuplicadoAlerta): string {
  switch (criterio) {
    case 'titulo':
      return 'Título parecido';
    case 'distrito':
      return 'Mismo distrito';
  }
}
