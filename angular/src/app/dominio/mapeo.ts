import { formatearFechaCompacta, formatearFechaCorta, partesFecha } from '../shared/formato-fecha';
import type {
  Alcance,
  Caso,
  EstadoCaso,
  EtapaCiclo,
  NaturalezaCaso,
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

/**
 * Fecha de caso normalizada a `YYYY-MM-DD`.
 *
 * No construye un `Date`: de una fecha ISO con hora se toma el día literal, sin
 * desplazarlo a la jornada anterior al interpretarlo en una zona al oeste de
 * UTC (`2026-10-31T00:00:00.000Z` sigue siendo 31OCT2026). Acepta `YYYY-MM-DD`,
 * ISO con hora y el formato legado `DD/MM/YYYY`. Un valor no reconocible se
 * declara como hueco (`null`) en vez de propagarse como texto arbitrario.
 */
export function fechaIso(valor: string | null | undefined): string | null {
  const partes = partesFecha(valor);
  if (!partes) return null;

  const [anio, mes, dia] = partes;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Compatibilidad: el formato de caso es el compacto común (`31OCT2026`). */
export function formatearFechaCaso(valor: string | null | undefined): string {
  return formatearFechaCorta(valor);
}

export { formatearFechaCompacta, formatearFechaCorta };

export const NIVELES_CONFLICTO = [
  'Diferencia',
  'Controversia',
  'Conflicto social',
  'Crisis social',
] as const satisfies readonly NivelConflicto[];

export const RIESGOS = ['Bajo', 'Medio', 'Alto'] as const satisfies readonly Riesgo[];

export const PRIORIDADES = [
  'Urgente',
  'Medio',
  'Bajo',
] as const satisfies readonly PrioridadAtencion[];

export const ESTADOS_CASO = [
  'Abierto',
  'Resuelto',
  'Archivado',
] as const satisfies readonly EstadoCaso[];

/**
 * Colapsa las etiquetas del catálogo de estados en los tres valores operativos.
 *
 * `core.cat_estados_caso` llegó a tener cuatro filas y dos de ellas —`Activo` y
 * `En seguimiento`— compartían `es_activo = true`: dos nombres para el mismo
 * hecho. La migración 33 las unificó en `Abierto`, pero una base sin migrar
 * sigue respondiendo con las etiquetas anteriores. La normalización vive aquí,
 * en la frontera de mapeo, para que la interfaz nunca muestre ambos nombres.
 */
export function estadoDeCaso(valor: string | null): EstadoCaso {
  const clave = (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');

  if (clave === 'resuelto') return 'Resuelto';
  if (clave === 'archivado') return 'Archivado';
  return 'Abierto';
}

export const ALCANCES = [
  'Norte',
  'Centro',
  'Sur',
  'Oriente',
  'Nacional',
] as const satisfies readonly Alcance[];

/**
 * Naturalezas declarables. El eje es independiente del alcance geográfico
 * (`ALCANCES`): «Nacional» de alcance significa «toca varias regiones»;
 * «Nacional o sectorial» de naturaleza significa «su causa es una medida de
 * alcance nacional o de todo el sector».
 */
export const NATURALEZAS_CASO = [
  'Territorial',
  'Nacional o sectorial',
] as const satisfies readonly NaturalezaCaso[];

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
  /**
   * `core.actores` sólo guarda `nombre_actual`: hoy llegan siempre nulos y no se
   * parten por espacios. Si el backend llegara a poblarlos, se muestran junto al
   * nombre (ver `CasoDetallePage.nombreActor`).
   */
  apellidos: string | null;
  nombres: string | null;
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
  /** `core.caso_cronologia.actor_uid`; hoy siempre nulo. */
  actorId: string | null;
  /** Nombre del actor del hecho; hoy siempre nulo. */
  actor: string | null;
};

export type DemandaCaso = {
  id: string;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  descripcion: string | null;
  estado: string;
  motivo: string | null;
  /** Documento que originó la demanda; `null` si no quedó vinculada. */
  documentoOrigenId: string | null;
  documentoOrigenCodigo: string | null;
  documentoOrigenTitulo: string | null;
  /** `true` cuando la demanda todavía no está vinculada a un caso. */
  sinCaso: boolean;
};

export type HitoCompromisoCaso = {
  id: string;
  descripcion: string | null;
  fecha: string | null;
  estado: string | null;
};

/** Compromiso del detalle con su vencimiento efectivo ya resuelto. */
export type CompromisoCaso = {
  id: string;
  codigo: string;
  accion: string;
  estado: string | null;
  nivelGobierno: string | null;
  unidad: string | null;
  /** Fecha manual si llega; si no, la del próximo hito no terminal. */
  vencimiento: string | null;
  origenVencimiento: 'manual' | 'hito' | null;
  /** Hitos del compromiso, tal como los devuelve `GET /v1/cases/{codigo}`. */
  hitos: HitoCompromisoCaso[];
};

export type DocumentoCaso = {
  id: string;
  codigo: string | null;
  titulo: string;
  fecha: string | null;
  tipo: string | null;
  tipoNombre: string | null;
};

export type AlertaCaso = {
  id: string;
  codigo: string;
  nivel: string | null;
  prioridad: string | null;
  estado: string;
  fechaReporte: string | null;
  anulada: boolean;
};

/** Tramo de `core.caso_estado_historial`. */
export type TramoEstadoCaso = {
  id: string;
  estado: string | null;
  desde: string | null;
  hasta: string | null;
  motivo: string | null;
  usuario: string | null;
};

/**
 * Conteos y banderas ya persistidos (item 68). No hay puntuación: la UI sólo
 * cuenta criterios cubiertos y lista lo que falta.
 */
export type CompletitudCaso = {
  hechos: { total: number; validados: number };
  actores: { total: number; conTipoYFuncion: number };
  demandas: { total: number; con3PCompletos: number };
  geografia: { tieneGeografia: boolean; regiones: number; distrito: string | null };
  marcoSituacional: {
    consistencia: boolean;
    correspondencia: boolean;
    coherenciaContextual: boolean;
    saturacion: boolean;
    trazabilidad: boolean;
  } | null;
};

export type DetalleCaso = {
  caso: Caso;
  actores: ActorCaso[];
  eventos: EventoCaso[];
  demandas: DemandaCaso[];
  alertas: AlertaCaso[];
  compromisos: CompromisoCaso[];
  documentos: DocumentoCaso[];
  historial: TramoEstadoCaso[];
  completitud: CompletitudCaso | null;
};

function aActorCaso(bruto: unknown): ActorCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    apellidos: texto(registro, ['apellidos']),
    nombres: texto(registro, ['nombres']),
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
    actorId: texto(registro, ['actorId', 'actor_id']),
    actor: texto(registro, ['actor']),
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
    documentoOrigenId: texto(registro, ['documento_origen_id', 'documentoOrigenId']),
    documentoOrigenCodigo: texto(registro, ['documento_origen_codigo', 'documentoOrigenCodigo']),
    documentoOrigenTitulo: texto(registro, ['documento_origen_titulo', 'documentoOrigenTitulo']),
    sinCaso: !texto(registro, ['casoCode', 'codigoCaso', 'caso_codigo']),
  };
}

function aHitoCompromisoCaso(bruto: unknown): HitoCompromisoCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    descripcion: texto(registro, ['descripcion', 'descripción']),
    fecha: texto(registro, ['fecha']),
    estado: texto(registro, ['estado']),
  };
}

/**
 * Estados terminales de `core.cat_estados_hito` (`es_terminal = true`). La
 * ficha no recibe la bandera, sólo el código; se compara sin acentos.
 */
function esEstadoHitoTerminal(estado: string | null): boolean {
  if (!estado) return false;
  const clave = estado
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return clave === 'cumplido' || clave === 'desestimado';
}

function aCompromisoCaso(bruto: unknown): CompromisoCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  const manual = texto(registro, ['fechaVencimiento', 'fecha_vencimiento']);
  const hitos = lista(registro, ['hitos']).map(aHitoCompromisoCaso);

  // Misma regla que `lib/db/repos/commitments.ts`: la fecha manual prevalece y,
  // si falta, se usa la del próximo hito no terminal. Hoy el detalle no envía la
  // fecha manual, así que el vencimiento suele salir del hito.
  const delHito =
    hitos
      .filter((hito) => hito.fecha && !esEstadoHitoTerminal(hito.estado))
      .map((hito) => hito.fecha as string)
      .sort()[0] ?? null;

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'code']) ?? 'Sin código',
    accion: texto(registro, ['accion', 'acción']) ?? 'Sin acción registrada',
    estado: texto(registro, ['estado']),
    nivelGobierno: texto(registro, ['nivelGobierno', 'nivel_gobierno']),
    unidad: texto(registro, ['unidad']),
    vencimiento: manual ?? delHito,
    origenVencimiento: manual ? 'manual' : delHito ? 'hito' : null,
    hitos,
  };
}

function aDocumentoCaso(bruto: unknown): DocumentoCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'code']),
    titulo: texto(registro, ['titulo', 'title']) ?? 'Sin título',
    fecha: texto(registro, ['fecha']),
    tipo: texto(registro, ['tipo']),
    tipoNombre: texto(registro, ['tipoNombre', 'tipo_nombre']),
  };
}

function aAlertaCaso(bruto: unknown): AlertaCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'code']) ?? 'Sin código',
    nivel: texto(registro, ['nivel']),
    prioridad: texto(registro, ['prioridad']),
    estado: texto(registro, ['estado']) ?? 'Sin estado',
    fechaReporte: texto(registro, ['fechaReporte', 'fecha_reporte']),
    anulada: booleano(registro, ['anulada']),
  };
}

function aTramoEstadoCaso(bruto: unknown): TramoEstadoCaso {
  const registro = esRegistro(bruto) ? bruto : {};
  const estado = texto(registro, ['estado']);
  return {
    id: texto(registro, ['id']) ?? '',
    estado: estado ? estadoDeCaso(estado) : null,
    desde: texto(registro, ['desde']),
    hasta: texto(registro, ['hasta']),
    motivo: texto(registro, ['motivo']),
    usuario: texto(registro, ['usuario']),
  };
}

function subregistro(registro: Registro, claves: readonly string[]): Registro {
  const valor = leer(registro, claves);
  return esRegistro(valor) ? valor : {};
}

function aCompletitud(bruto: unknown): CompletitudCaso | null {
  if (!esRegistro(bruto)) return null;

  const hechos = subregistro(bruto, ['hechos']);
  const actores = subregistro(bruto, ['actores']);
  const demandas = subregistro(bruto, ['demandas']);
  const geografia = subregistro(bruto, ['geografia', 'geografía']);
  const marco = leer(bruto, ['marcoSituacional', 'marco_situacional']);

  return {
    hechos: {
      total: numero(hechos, ['total']) ?? 0,
      validados: numero(hechos, ['validados']) ?? 0,
    },
    actores: {
      total: numero(actores, ['total']) ?? 0,
      conTipoYFuncion: numero(actores, ['conTipoYFuncion', 'con_tipo_y_funcion']) ?? 0,
    },
    demandas: {
      total: numero(demandas, ['total']) ?? 0,
      con3PCompletos: numero(demandas, ['con3PCompletos', 'con_3p_completos']) ?? 0,
    },
    geografia: {
      tieneGeografia: booleano(geografia, ['tieneGeografia', 'tiene_geografia']),
      regiones: numero(geografia, ['regiones']) ?? 0,
      distrito: texto(geografia, ['distrito']),
    },
    marcoSituacional: esRegistro(marco)
      ? {
          consistencia: booleano(marco, ['consistencia']),
          correspondencia: booleano(marco, ['correspondencia']),
          coherenciaContextual: booleano(marco, ['coherenciaContextual', 'coherencia_contextual']),
          saturacion: booleano(marco, ['saturacion', 'saturación']),
          trazabilidad: booleano(marco, ['trazabilidad']),
        }
      : null,
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
    alertas: lista(registro, ['alertas', 'alerts']).map(aAlertaCaso),
    compromisos: lista(registro, ['compromisos', 'commitments']).map(aCompromisoCaso),
    documentos: lista(registro, ['documentos', 'documents']).map(aDocumentoCaso),
    historial: lista(registro, ['historial', 'stateHistory', 'state_history']).map(
      aTramoEstadoCaso,
    ),
    completitud: aCompletitud(leer(registro, ['completitud', 'completeness'])),
  };
}

/** «Moderado» es legado y no debe reaparecer en la UI. */
function riesgoDe(valor: string | null): Riesgo {
  if (valor && valor.trim().toLowerCase() === 'moderado') return 'Medio';
  return unoDe(valor, RIESGOS, 'Bajo');
}

/**
 * Nivel de conflictividad declarado. Como la naturaleza, no tiene respaldo: un
 * valor ausente o desconocido es «sin declarar» (`null`) y no `Diferencia`.
 * La etiqueta latente/manifiesto se deriva de este valor, así que inventarlo
 * cambiaría la situación del caso.
 */
function nivelDe(valor: string | null): NivelConflicto | null {
  if (!valor) return null;
  const limpio = valor.trim().toLowerCase();
  return NIVELES_CONFLICTO.find((opcion) => opcion.toLowerCase() === limpio) ?? null;
}

/**
 * Naturaleza declarada → dominio. A diferencia del resto de catálogos, aquí no
 * hay respaldo: un valor ausente o desconocido es «sin declarar» (`null`) y no
 * un valor verosímil. Se acepta la forma con guion bajo porque el catálogo
 * podría escribirse así sin que cambie el significado.
 */
function naturalezaDe(valor: string | null): NaturalezaCaso | null {
  if (!valor) return null;
  const limpio = valor.trim().replace(/_/g, ' ').toLowerCase();
  return NATURALEZAS_CASO.find((opcion) => opcion.toLowerCase() === limpio) ?? null;
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
  // El bloque `geografia` trae el distrito principal: nombre para mostrar y
  // ubigeo como llave. La API lo incluye en el listado y en la ficha.
  const geografia = esRegistro(registro['geografia']) ? registro['geografia'] : {};

  return {
    id: texto(registro, ['id', 'uid']) ?? '',
    codigo: texto(registro, ['codigo', 'code', 'codigoCaso']) ?? '',
    titulo: texto(registro, ['titulo', 'title']) ?? 'Sin título',
    resumen: texto(registro, ['resumen', 'summary']),
    avance: numero(registro, ['avance', 'progress']),
    // `fecha_ultima_actualizacion`: instante de carga del legado, no la fecha del
    // caso. La tarjeta del listado y la vista previa son los únicos lugares que
    // lo muestran, rotulado «Actualizado» por pedido del item 94 y con la
    // advertencia de `Caso.actualizado` a la vista (hallazgo #10).
    actualizado:
      texto(registro, ['actualizado', 'updated']) ??
      texto(registro, ['actualizadoEn', 'updatedAt']),
    inicio: fechaIso(texto(registro, ['fechaInicio', 'fecha_inicio', 'inicio'])),
    region: texto(registro, ['region']),
    enlaceAnalisis: texto(registro, ['enlaceAnalisis', 'enlace_analisis']),
    distrito: texto(geografia, ['distrito']),
    distritoUbigeo: texto(geografia, ['distritoUbigeo', 'distrito_ubigeo']),
    estado: estadoDeCaso(texto(registro, ['estado'])),
    riesgo: riesgoDe(texto(registro, ['riesgo', 'risk'])),
    prioridad: unoDe(texto(registro, ['prioridad']), PRIORIDADES, 'Medio'),
    alcance: unoDe(texto(registro, ['alcance']), ALCANCES, 'Centro'),
    nivelConflicto: nivelDe(texto(registro, ['nivelConflicto', 'nivel_conflicto'])),
    naturaleza: naturalezaDe(texto(registro, ['naturaleza'])),
    etapa: etapaDe(texto(registro, ['etapa', 'stage'])),
    tematica: texto(registro, ['tematica']),
    subsector: texto(registro, ['subsector']),
    unidadResponsable: texto(registro, ['unidadResponsable', 'unidad_responsable']),
    origen: origenDe(texto(registro, ['origen'])),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    anulado:
      booleano(registro, ['anulado']) || Boolean(leer(registro, ['anuladoEn', 'anulado_en'])),
    anuladoEn: texto(registro, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(registro, ['motivoAnulacion', 'motivo_anulacion']),
    anuladoPor: texto(registro, ['anuladoPor', 'anulado_por']),
    anuladoPorNombre: texto(registro, ['anuladoPorNombre', 'anulado_por_nombre']),
    anulacionId: texto(registro, ['anulacionId', 'anulacion_id']),
  };
}
