/**
 * Mapeo del aviso de duplicados de `GET /api/v1/cases/duplicados`.
 *
 * El endpoint devuelve camelCase; el parseo acepta también snake_case por la
 * misma razón que `nudos-matriz.mapeo.ts`: un despliegue viejo no debe romper el
 * alta. Si el candidato no trae coincidencias, se deja la lista vacía: nunca se
 * supone el motivo.
 */

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function registro(valor: unknown): Record<string, unknown> {
  return esRegistro(valor) ? valor : {};
}

function lista(valor: unknown): readonly unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function leer(fuente: Record<string, unknown>, camel: string, snake: string): unknown {
  return fuente[camel] ?? fuente[snake];
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    return limpio === '' ? null : limpio;
  }
  return null;
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : 0;
  }
  return 0;
}

function booleano(valor: unknown): boolean {
  return valor === true || valor === 'true';
}

/** Motivo por el que el caso se parece al que se está registrando. */
export type CriterioDuplicado = 'titulo' | 'distrito' | 'organizacion' | 'demanda';

export type DuplicadoCandidatoFila = {
  id: string;
  codigo: string;
  titulo: string;
  estado: string | null;
  distrito: string | null;
  coincidencias: readonly CriterioDuplicado[];
  similitudTitulo: number;
  tokensCompartidos: number;
};

export type DuplicadosCriterios = {
  titulo: string;
  distritoId: number | null;
  organizacion: string | null;
  demanda: string | null;
  caso: string | null;
};

export type DuplicadosAviso = {
  criterios: DuplicadosCriterios;
  candidatos: readonly DuplicadoCandidatoFila[];
  descartesConsiderados: number;
  /** `false` cuando falta `core.caso_duplicado_descartado` (migración 49). */
  descartesDisponibles: boolean;
};

const CRITERIOS: readonly CriterioDuplicado[] = [
  'titulo',
  'distrito',
  'organizacion',
  'demanda',
];

function aCriterio(valor: unknown): CriterioDuplicado | null {
  return typeof valor === 'string' && (CRITERIOS as readonly string[]).includes(valor)
    ? (valor as CriterioDuplicado)
    : null;
}

function aCandidato(valor: unknown): DuplicadoCandidatoFila {
  const fuente = registro(valor);
  return {
    id: String(fuente['id'] ?? ''),
    codigo: String(fuente['codigo'] ?? ''),
    titulo: String(fuente['titulo'] ?? ''),
    estado: texto(fuente['estado']),
    distrito: texto(fuente['distrito']),
    coincidencias: lista(leer(fuente, 'coincidencias', 'coincidencias'))
      .map(aCriterio)
      .filter((criterio): criterio is CriterioDuplicado => criterio !== null),
    similitudTitulo: numero(leer(fuente, 'similitudTitulo', 'similitud_titulo')),
    tokensCompartidos: numero(leer(fuente, 'tokensCompartidos', 'tokens_compartidos')),
  };
}

export function aDuplicados(bruto: unknown): DuplicadosAviso {
  const fuente = registro(bruto);
  const criterios = registro(leer(fuente, 'criterios', 'criterios'));
  const distritoId = leer(criterios, 'distritoId', 'distrito_id');
  return {
    criterios: {
      titulo: String(criterios['titulo'] ?? ''),
      distritoId: typeof distritoId === 'number' && Number.isFinite(distritoId) ? distritoId : null,
      organizacion: texto(criterios['organizacion']),
      demanda: texto(criterios['demanda']),
      caso: texto(criterios['caso']),
    },
    candidatos: lista(leer(fuente, 'candidatos', 'candidatos')).map(aCandidato),
    descartesConsiderados: numero(
      leer(fuente, 'descartesConsiderados', 'descartes_considerados'),
    ),
    descartesDisponibles: booleano(leer(fuente, 'descartesDisponibles', 'descartes_disponibles')),
  };
}

/** Etiqueta visible del criterio que coincidió entre dos casos. */
export function etiquetaCriterio(criterio: CriterioDuplicado): string {
  switch (criterio) {
    case 'titulo':
      return 'Título parecido';
    case 'distrito':
      return 'Mismo distrito';
    case 'organizacion':
      return 'Misma organización';
    case 'demanda':
      return 'Misma demanda';
  }
}
