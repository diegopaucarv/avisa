import type {
  Alcance,
  Caso,
  EstadoCaso,
  EtapaCiclo,
  NivelConflicto,
  OrigenDato,
  PrioridadAtencion,
  Riesgo,
} from './modelos';

/** Registro crudo de la API (aún puede venir con claves en inglés). */
export type Registro = Record<string, unknown>;

export function esRegistro(valor: unknown): valor is Registro {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Lee la primera clave presente. Las claves españolas van primero: cuando el
 * backend complete el rename, esta función no cambia de comportamiento.
 */
export function leer(objeto: Registro, claves: readonly string[]): unknown {
  for (const clave of claves) {
    if (clave in objeto) return objeto[clave];
  }
  return undefined;
}

export function texto(objeto: Registro, claves: readonly string[]): string | null {
  const valor = leer(objeto, claves);
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

export function numero(objeto: Registro, claves: readonly string[]): number | null {
  const valor = leer(objeto, claves);
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() && !Number.isNaN(Number(valor))) {
    return Number(valor);
  }
  return null;
}

export function booleano(objeto: Registro, claves: readonly string[]): boolean {
  const valor = leer(objeto, claves);
  return valor === true;
}

export function lista(objeto: Registro, claves: readonly string[]): unknown[] {
  const valor = leer(objeto, claves);
  return Array.isArray(valor) ? valor : [];
}

function unoDe<T extends string>(valor: string | null, permitidos: readonly T[], respaldo: T): T {
  if (!valor) return respaldo;
  const limpio = valor.trim().toLowerCase();
  return permitidos.find((opcion) => opcion.toLowerCase() === limpio) ?? respaldo;
}

export const NIVELES_CONFLICTO = [
  'Diferencia',
  'Controversia',
  'Conflicto social',
  'Crisis social',
] as const satisfies readonly NivelConflicto[];

export const RIESGOS = ['Bajo', 'Moderado', 'Alto'] as const satisfies readonly Riesgo[];

export const PRIORIDADES = [
  'Urgente',
  'Moderado',
  'Bajo',
] as const satisfies readonly PrioridadAtencion[];

export const ESTADOS_CASO = [
  'Activo',
  'En seguimiento',
  'Resuelto',
  'Archivado',
] as const satisfies readonly EstadoCaso[];

export const ALCANCES = [
  'Norte',
  'Centro',
  'Sur',
  'Oriente',
  'Nacional',
] as const satisfies readonly Alcance[];

export const ETAPAS = [
  'Prevención estratégica',
  'Prevención operativa',
  'Intervención y tratamiento',
  'Monitoreo de compromisos',
  'Gestión de la información y del conocimiento',
] as const satisfies readonly EtapaCiclo[];

/**
 * Tras la migración 22 (`migration/22_ciclos_intervencion_guia.sql`) el
 * catálogo `core.cat_ciclos_intervencion` y `core.casos.ciclo_intervencion_id`
 * usan las mismas cinco etiquetas que `EtapaCiclo`. Por eso el mapeo es
 * identidad: ya no queda ningún valor legado que traducir.
 *
 * No se conserva la tabla de equivalencias anterior («Prevención»,
 * «Seguimiento», «Gestión del Conocimiento»): mantener alias que la base ya no
 * emite volvería a aceptar en silencio un valor desalineado y ocultaría una
 * regresión del catálogo en lugar de exponerla. Si apareciera un valor fuera de
 * la lista, se usa «Prevención operativa» como respaldo histórico.
 */
function etapaDe(valor: string | null): EtapaCiclo {
  return unoDe(valor, ETAPAS, 'Prevención operativa');
}

/**
 * `origen_dato` en la base usa códigos técnicos de procedencia; la UI muestra
 * una etiqueta por código. `KAG` y `WORKFLOW` tienen etiqueta propia: antes
 * caían en «Manual» por el valor de respaldo, lo que confundía una ingesta
 * automática con un alta manual (gap D10). `AVISA_HISTORICO` conserva «Legado»
 * y `WHATSAPP` conserva «WhatsApp».
 */
function origenDe(valor: string | null): OrigenDato {
  if (!valor) return 'Manual';
  const clave = valor.trim().toLowerCase();
  if (clave.includes('kag')) return 'KAG';
  if (clave.includes('workflow')) return 'Workflow';
  if (clave.includes('historico') || clave.includes('legado')) return 'Legado';
  if (clave.includes('whatsapp')) return 'WhatsApp';
  if (clave.includes('ingesta') || clave.includes('importa')) return 'Ingesta';
  return unoDe(valor, ORIGENES, 'Manual');
}

export const ORIGENES = [
  'Manual',
  'Ingesta',
  'KAG',
  'Workflow',
  'Legado',
  'WhatsApp',
] as const satisfies readonly OrigenDato[];

export type ActorCaso = {
  id: string;
  nombre: string;
  naturaleza: string;
  tipo: string | null;
  funcion: string | null;
  posicionamiento: string | null;
  correo: string | null;
};

export type EventoCaso = {
  id: string;
  fecha: string;
  tipo: string | null;
  descripcion: string;
  validado: boolean;
  critico: boolean;
  evidencia: string | null;
};

export type DemandaCaso = {
  id: string;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  descripcion: string | null;
  estado: string;
  motivo: string | null;
  /** `true` cuando la demanda todavía no está vinculada a un caso. */
  sinCaso: boolean;
};

export type DetalleCaso = {
  caso: Caso;
  actores: ActorCaso[];
  eventos: EventoCaso[];
  demandas: DemandaCaso[];
};

function aActorCaso(bruto: unknown): ActorCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    naturaleza: texto(registro, ['naturaleza']) ?? 'No determinada',
    tipo: texto(registro, ['tipo']),
    funcion: texto(registro, ['funcion', 'función']),
    posicionamiento: texto(registro, ['posicionamiento']),
    correo: texto(registro, ['correo', 'email']),
  };
}

function aEventoCaso(bruto: unknown): EventoCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    fecha: texto(registro, ['fecha']) ?? '',
    tipo: texto(registro, ['tipo']),
    descripcion: texto(registro, ['descripcion', 'descripción']) ?? '',
    validado: booleano(registro, ['validado']),
    critico: booleano(registro, ['critico', 'crítico']),
    evidencia: texto(registro, ['evidencia']),
  };
}

function aDemandaCaso(bruto: unknown): DemandaCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    problema: texto(registro, ['problema']),
    propuesta: texto(registro, ['propuesta']),
    pedido: texto(registro, ['pedido']),
    descripcion: texto(registro, ['descripcion', 'descripción']),
    estado: texto(registro, ['estado']) ?? 'Registrada',
    motivo: texto(registro, ['motivo']),
    sinCaso: !texto(registro, ['casoCode', 'codigoCaso', 'caso_codigo']),
  };
}

/** Detalle de `GET /api/v1/cases/:codigo`. */
export function aDetalleCaso(bruto: unknown): DetalleCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    caso: aCaso(leer(registro, ['caso', 'case'])),
    actores: lista(registro, ['actores', 'actors']).map(aActorCaso),
    eventos: lista(registro, ['eventos', 'events']).map(aEventoCaso),
    demandas: lista(registro, ['demandas']).map(aDemandaCaso),
  };
}

/** «Medio» es legado y no debe reaparecer en la UI. */
function riesgoDe(valor: string | null): Riesgo {
  if (valor && valor.trim().toLowerCase() === 'medio') return 'Moderado';
  return unoDe(valor, RIESGOS, 'Bajo');
}

/**
 * Caso de la API → dominio.
 *
 * `riesgo` es atributo del caso (recalculable). Si el payload aún no lo trae,
 * se usa el valor por defecto Bajo en vez de derivarlo de la última alerta:
 * esa derivación era el comportamiento anterior y ya no es válido.
 */
export function aCaso(bruto: unknown): Caso {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id', 'uid']) ?? '',
    codigo: texto(registro, ['codigo', 'code', 'codigoCaso']) ?? '',
    titulo: texto(registro, ['titulo', 'title']) ?? 'Sin título',
    resumen: texto(registro, ['resumen', 'summary']),
    avance: numero(registro, ['avance', 'progress']),
    actualizado:
      texto(registro, ['actualizado', 'updated']) ??
      texto(registro, ['actualizadoEn', 'updatedAt']),
    region: texto(registro, ['region']),
    estado: unoDe(texto(registro, ['estado']), ESTADOS_CASO, 'En seguimiento'),
    riesgo: riesgoDe(texto(registro, ['riesgo', 'risk'])),
    prioridad: unoDe(texto(registro, ['prioridad']), PRIORIDADES, 'Moderado'),
    alcance: unoDe(texto(registro, ['alcance']), ALCANCES, 'Centro'),
    nivelConflicto: unoDe(
      texto(registro, ['nivelConflicto', 'nivel_conflicto']),
      NIVELES_CONFLICTO,
      'Diferencia',
    ),
    etapa: etapaDe(texto(registro, ['etapa', 'stage'])),
    tematica: texto(registro, ['tematica']),
    subsector: texto(registro, ['subsector']),
    unidadResponsable: texto(registro, ['unidadResponsable', 'unidad_responsable']),
    origen: origenDe(texto(registro, ['origen'])),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    anulado:
      booleano(registro, ['anulado']) || Boolean(leer(registro, ['anuladoEn', 'anulado_en'])),
  };
}
