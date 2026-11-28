/**
 * Alerta temprana → dominio.
 *
 * Único punto donde se traduce el sobre de `GET /api/v1/alerts` al vocabulario
 * congelado de la Guía (PRODUCE/OAIPCS §8.1.2.2 y Anexo 3). Las claves
 * españolas van primero en cada lectura, de modo que el rename del backend no
 * obliga a tocar los componentes.
 *
 * El eje de riesgo de la alerta es el del caso vinculado: Bajo · Medio ·
 * Alto.
 *
 * `prioridad`, `plazoHoras` y `grave` se conservan sólo para no romper
 * `features/bandeja` y `features/resumen` (fuera del alcance de esta pantalla):
 * `aAlerta` los deja vacíos y ninguna vista de `features/alertas` los usa.
 */

import {
  RIESGOS,
  booleano,
  esRegistro,
  leer,
  lista,
  numero,
  texto,
  type Registro,
} from '../../dominio/mapeo';
import type { Riesgo } from '../../dominio/modelos';
import { formatearFechaCompacta } from '../../shared/formato-fecha';

/* ------------------------------------------------------------------------- *
 * Vocabulario congelado
 * ------------------------------------------------------------------------- */

/** @deprecated Eje retirado de la alerta; el riesgo del caso lo sustituye. */
export const PRIORIDADES_ALERTA = [
  'Crítica inmediata',
  'Urgente',
  'Temprana',
  'Seguimiento',
] as const;

/** @deprecated */
export type PrioridadAlerta = (typeof PRIORIDADES_ALERTA)[number];

/** @deprecated */
export const PLAZO_POR_PRIORIDAD: Record<PrioridadAlerta, string> = {
  'Crítica inmediata': '24 h',
  Urgente: '48 h',
  Temprana: '72 h',
  Seguimiento: 'sin plazo',
};

/** Niveles de alerta: vocabulario heredado del catálogo `cat_niveles_alerta`. */
export const NIVELES_ALERTA = ['Inmediato', 'Táctico', 'Preventivo', 'Monitoreo'] as const;

export type NivelAlerta = (typeof NIVELES_ALERTA)[number];

/**
 * Opciones del filtro `nivel`: la API compara contra `codigo_legado`, no contra
 * el nombre.
 */
export const OPCIONES_NIVEL: readonly { valor: string; etiqueta: NivelAlerta }[] = [
  { valor: 'NA-001', etiqueta: 'Inmediato' },
  { valor: 'NA-002', etiqueta: 'Táctico' },
  { valor: 'NA-003', etiqueta: 'Preventivo' },
  { valor: 'NA-004', etiqueta: 'Monitoreo' },
];

/** Estados derivados que el servidor acepta filtrar. */
export const ESTADOS_ALERTA = [
  'Pendiente de revisión',
  'En revisión',
  'Validada',
  'Aprobada',
  'Atendida',
] as const;

/**
 * Opciones del filtro de estado del listado. La cola se opera de forma binaria
 * —«Atendidas» frente a «Pendientes»— y no por los cinco estados del flujo:
 * lo que decide es `paso_actual >= 5`, no la etapa de aprobación. `Atendida`
 * reutiliza el valor canónico que ya entiende el servidor; `Pendiente` es su
 * complemento derivado en SQL.
 */
export const FILTROS_ESTADO_ALERTA = [
  { valor: 'Atendida', etiqueta: 'Atendidas' },
  { valor: 'Pendiente', etiqueta: 'Pendientes' },
] as const;

export const ORDENES_ALERTA: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'recent', etiqueta: 'Fecha de reporte (más reciente)' },
  { valor: 'riesgo', etiqueta: 'Riesgo (alto primero)' },
];

/**
 * Alcance geográfico declarado de la alerta.
 *
 * No se reutiliza `Alcance` de `dominio/modelos.ts`: aquél es el eje
 * Norte · Centro · Sur · Oriente · Nacional del caso, no la granularidad
 * territorial de la alerta.
 */
export const ALCANCES_ALERTA = ['Distrito', 'Región', 'Nacional'] as const;

export type AlcanceAlerta = (typeof ALCANCES_ALERTA)[number];

/** Regiones del Perú para la selección derivada de un alcance regional. */
export const REGIONES_PERU = [
  'Amazonas',
  'Áncash',
  'Apurímac',
  'Arequipa',
  'Ayacucho',
  'Cajamarca',
  'Callao',
  'Cusco',
  'Huancavelica',
  'Huánuco',
  'Ica',
  'Junín',
  'La Libertad',
  'Lambayeque',
  'Lima',
  'Loreto',
  'Madre de Dios',
  'Moquegua',
  'Pasco',
  'Piura',
  'Puno',
  'San Martín',
  'Tacna',
  'Tumbes',
  'Ucayali',
] as const;

/* ------------------------------------------------------------------------- *
 * Tipos de dominio
 * ------------------------------------------------------------------------- */

/** Una entrada del historial de revisiones de la alerta. */
export type RevisionAlerta = {
  autor: string;
  fecha: string;
  accion: string | null;
};

/** Actor vigente del caso vinculado, tal como lo entrega el detalle de la alerta. */
export type ActorCaso = {
  id: string | null;
  nombre: string;
  cargo: string | null;
  rol: string | null;
};

/** Demanda vigente del caso vinculado, tal como la entrega el detalle de la alerta. */
export type DemandaCaso = {
  id: string | null;
  descripcion: string;
  estado: string | null;
};

/**
 * Estados del triaje de la cola RED-RADAR. `null` en la alerta significa que
 * nunca se trió (equivale a «pendiente»); la UI sólo pinta la sección cuando
 * hay una fila real, sin inventar el estado.
 */
export type EstadoTriaje = 'pendiente' | 'en_triage' | 'confirmada' | 'descartada' | 'duplicada';

export type Alerta = {
  id: string;
  codigo: string;
  titulo: string | null;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  /** Resumen ejecutivo heredado del caso vinculado. */
  casoResumen: string | null;
  /** Actores vigentes del caso vinculado (tope 20, orden estable). */
  casoActores: ActorCaso[];
  /** Demandas vigentes del caso vinculado (tope 20, orden estable). */
  casoDemandas: DemandaCaso[];
  /**
   * Riesgo heredado del caso vinculado (o declarado a mano). Es el eje de la
   * tarjeta de riesgo y del filtro `riesgo`.
   */
  riesgo: Riesgo;
  /** Granularidad geográfica declarada de la alerta. */
  alcance: AlcanceAlerta;
  region: string | null;
  provincia: string | null;
  /** @deprecated El eje de prioridad se retiró de la alerta. */
  prioridad: PrioridadAlerta | null;
  /** @deprecated Ver `prioridad`. */
  plazoHoras: number | null;
  /** @deprecated Ver `prioridad`. */
  grave: boolean;
  /** Etiqueta congelada; `null` si el nivel no se puede resolver. */
  nivel: NivelAlerta | null;
  nivelCodigo: string | null;
  pasoActual: number;
  estadoLegado: string | null;
  visibilidad: string | null;
  fechaReporte: string | null;
  fechaValidacion: string | null;
  fechaAprobacion: string | null;
  aprobadaPor: string | null;
  validadaPor: string | null;
  /** Quién revisó por última vez; alimenta la columna «Último revisor». */
  ultimoRevisor: string | null;
  /** ISO de la última modificación del contenido o los metadatos. */
  ultimaModificacion: string | null;
  /** Quién modificó por última vez. */
  modificadoPor: string | null;
  /** Revisiones registradas, de la más reciente a la más antigua. */
  historial: RevisionAlerta[];
  descripcionRiesgo: string | null;
  hechosRecientes: string | null;
  situacionActual: string | null;
  /** @deprecated Se retiró de la ficha; se conserva por compatibilidad. */
  accionesOaipcs: string | null;
  /** `riesgos_json` aplanado a líneas legibles. */
  riesgos: string[];
  /** `acciones_sugeridas_json` aplanado a líneas legibles. */
  accionesSugeridas: string[];
  /** Actores clave del territorio o del sector. */
  actoresClave: string[];
  /** Demandas inmediatas recogidas en campo. */
  demandasInmediatas: string[];
  /** Plantilla de WhatsApp editada a mano; `null` usa la generada. */
  plantillaWhatsapp: string | null;
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  distritoId: number | null;
  distrito: string | null;
  /** «Distrito · Provincia · Región» para desambiguar nombres repetidos. */
  distritoRuta: string | null;
  casoDistritoId: number | null;
  casoDistrito: string | null;
  casoDistritoRuta: string | null;
  distritoCoincideConCaso: boolean | null;
  subsector: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  estado: string;
  atendida: boolean;
  /** Estado del triaje RED-RADAR; `null` cuando la alerta aún no se trió. */
  triajeEstado: EstadoTriaje | null;
  /** Motivo declarado al descartar o marcar la alerta como duplicada. */
  motivoDescarte: string | null;
  /** Código de la alerta de la que ésta es duplicada, si se declaró. */
  duplicadaDeCodigo: string | null;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
  anuladoPor: string | null;
  anuladoPorNombre: string | null;
  anulacionId: string | null;
  /** Marca de archivo (ISO 8601). Archivada no es anulada. */
  archivadoEn: string | null;
  /** Motivo declarado al archivar. */
  motivoArchivo: string | null;
  /** Usuario que archivó (id). */
  archivadoPor: string | null;
  /** Nombre legible de quien archivó. */
  archivadoPorNombre: string | null;
};

export type DemandaAlerta = {
  id: string;
  descripcion: string | null;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  estado: string | null;
  fechaRegistro: string | null;
};

export type DetalleAlerta = {
  alerta: Alerta;
  demandas: DemandaAlerta[];
};

/**
 * Cuerpo parcial de `PATCH /api/v1/alerts/:id`.
 *
 * Los metadatos (`riesgo`, `alcance`, `region`, `provincia`, `casoCode`,
 * `distritoId`, `plantillaWhatsapp`) los puede editar cualquier perfil con
 * escritura; el contenido narrativo exige además clasificación suficiente.
 */
export type PatchAlerta = {
  titulo?: string | null;
  riesgo?: Riesgo | null;
  alcance?: AlcanceAlerta | null;
  region?: string | null;
  provincia?: string | null;
  situacionActual?: string | null;
  hechosRecientes?: string | null;
  descripcionRiesgo?: string | null;
  actoresClave?: string[] | null;
  demandasInmediatas?: string[] | null;
  accionesSugeridas?: string[] | null;
  plantillaWhatsapp?: string | null;
  casoCode?: string | null;
  distritoId?: number | null;
};

/**
 * Cuerpo de `POST /api/v1/alerts` (alta).
 *
 * `riesgo` y `alcance` son obligatorios: el formulario no deja registrar una
 * alerta sin nivel de riesgo ni sin ámbito geográfico.
 */
export type AltaAlerta = {
  titulo: string;
  riesgo: Riesgo;
  alcance: AlcanceAlerta;
  distritoId?: number;
  casoCode?: string;
  region?: string;
  provincia?: string;
  descripcionRiesgo?: string;
  hechosRecientes?: string;
  situacionActual?: string;
  actoresClave?: string[];
  demandasInmediatas?: string[];
  accionesSugeridas?: string[];
};

/** @deprecated Sólo lo consume el antiguo formulario de prioridad. */
export type OpcionPrioridadAlerta = {
  valor: string;
  etiqueta: string;
  slaHoras: number | null;
  grave: boolean;
};

/** @deprecated `GET /api/v1/catalogs` → `catalogs.prioridadesAlerta`. */
export function aPrioridadesAlerta(bruto: unknown): OpcionPrioridadAlerta[] {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  const opciones: OpcionPrioridadAlerta[] = [];
  for (const item of lista(catalogo, ['prioridadesAlerta'])) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['codigo']);
    if (!valor) continue;
    opciones.push({
      valor,
      etiqueta: texto(fila, ['etiqueta', 'codigo']) ?? valor,
      slaHoras: numero(fila, ['slaHoras', 'sla_horas']),
      grave: booleano(fila, ['esGrave', 'es_grave']),
    });
  }
  return opciones;
}

/* ------------------------------------------------------------------------- *
 * Lectura del payload
 * ------------------------------------------------------------------------- */

/** Compara etiquetas como lo hace `core.normalizar_ref`: sin tildes ni separadores. */
function plegar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

const NIVEL_POR_CODIGO = new Map<string, NivelAlerta>(
  OPCIONES_NIVEL.map((opcion) => [opcion.valor, opcion.etiqueta]),
);

const NIVEL_POR_ETIQUETA = new Map<string, NivelAlerta>();
for (const nivel of NIVELES_ALERTA) {
  NIVEL_POR_ETIQUETA.set(plegar(nivel), nivel);
}

/** El catálogo heredado guarda `Inmediato (24h)`; el SLA se descarta. */
function aNivel(nombre: string | null, codigo: string | null): NivelAlerta | null {
  if (nombre) {
    const limpio = nombre.replace(/\([^)]*\)/g, '');
    const encontrado = NIVEL_POR_ETIQUETA.get(plegar(limpio));
    if (encontrado) return encontrado;
  }
  if (codigo) {
    const encontrado = NIVEL_POR_CODIGO.get(codigo.trim().toUpperCase());
    if (encontrado) return encontrado;
  }
  return null;
}

const RIESGO_POR_ETIQUETA = new Map<string, Riesgo>();
for (const riesgo of RIESGOS) {
  RIESGO_POR_ETIQUETA.set(plegar(riesgo), riesgo);
}

/** «Alto», «alto», «Medio» (descartado) → `Riesgo | null`. */
function aRiesgo(valor: string | null): Riesgo | null {
  if (!valor) return null;
  return RIESGO_POR_ETIQUETA.get(plegar(valor)) ?? null;
}

const ALCANCE_POR_ETIQUETA = new Map<string, AlcanceAlerta>();
for (const alcance of ALCANCES_ALERTA) {
  ALCANCE_POR_ETIQUETA.set(plegar(alcance), alcance);
}

function aAlcance(valor: string | null): AlcanceAlerta | null {
  if (!valor) return null;
  return ALCANCE_POR_ETIQUETA.get(plegar(valor)) ?? null;
}

/** «Distrito · Provincia · Región» → provincia y región. */
function partirRuta(ruta: string | null): { provincia: string | null; region: string | null } {
  if (!ruta) return { provincia: null, region: null };
  const partes = ruta
    .split('·')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
  return { provincia: partes[1] ?? null, region: partes[2] ?? null };
}

function aRevisiones(bruto: unknown): RevisionAlerta[] {
  return lista(esRegistro(bruto) ? bruto : {}, ['historial', 'revisiones']).map((item) => {
    const fila = esRegistro(item) ? item : {};
    return {
      autor: texto(fila, ['autor', 'usuario', 'actor', 'por']) ?? 'Sin identificar',
      fecha: texto(fila, ['fecha', 'fechaHora', 'fecha_hora', 'creadoEn']) ?? '',
      accion: texto(fila, ['accion', 'detalle', 'motivo']),
    };
  });
}

const CLAVES_TEXTO = [
  'texto',
  'detalle',
  'descripcion',
  'accion',
  'riesgo',
  'titulo',
  'nombre',
] as const;

function lineaDeRegistro(registro: Registro): string | null {
  for (const clave of CLAVES_TEXTO) {
    const valor = registro[clave];
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
  }
  return null;
}

/**
 * `riesgos_json`, `actores_clave` y `demandas_inmediatas` son «narrativa
 * semiestructurada»: se acepta lista de textos, lista de objetos o un texto con
 * viñetas y se aplana a líneas. Lo que no se puede leer, no se inventa.
 */
export function aLineas(valor: unknown): string[] {
  if (typeof valor === 'string') {
    return valor
      .split('\n')
      .map((linea) => linea.replace(/^[\s\-–—•*]+/, '').trim())
      .filter((linea) => linea.length > 0);
  }

  if (Array.isArray(valor)) {
    return valor.flatMap((item) => aLineas(item));
  }

  if (esRegistro(valor)) {
    const linea = lineaDeRegistro(valor);
    return linea ? [linea] : [];
  }

  return [];
}

/** Líneas del formulario → JSON que acepta el repositorio (o `null`). */
export function aJsonLineas(lineas: readonly string[]): string[] | null {
  const limpias = lineas.map((linea) => linea.trim()).filter((linea) => linea.length > 0);
  return limpias.length ? limpias : null;
}

/** Tri-estado: `null` cuando el backend no pudo comparar. */
function booleanoONull(registro: Registro, claves: readonly string[]): boolean | null {
  const valor = leer(registro, claves);
  return typeof valor === 'boolean' ? valor : null;
}

function aActoresCaso(bruto: unknown): ActorCaso[] {
  if (!Array.isArray(bruto)) return [];
  const actores: ActorCaso[] = [];
  for (const item of bruto) {
    if (!esRegistro(item)) continue;
    const nombre = texto(item, ['nombre', 'nombreActual', 'nombre_actual']);
    if (!nombre) continue;
    actores.push({
      id: texto(item, ['id', 'actorId', 'actor_id']),
      nombre,
      cargo: texto(item, ['cargo', 'cargoActual', 'cargo_actual']),
      rol: texto(item, ['rol', 'rolEnCaso', 'rol_en_caso']),
    });
  }
  return actores;
}

function aDemandasCaso(bruto: unknown): DemandaCaso[] {
  if (!Array.isArray(bruto)) return [];
  const demandas: DemandaCaso[] = [];
  for (const item of bruto) {
    if (!esRegistro(item)) continue;
    const descripcion = texto(item, ['descripcion', 'descripcionDemanda', 'descripcion_demanda']);
    if (!descripcion) continue;
    demandas.push({
      id: texto(item, ['id']),
      descripcion,
      estado: texto(item, ['estado', 'estadoAtencion', 'estado_atencion']),
    });
  }
  return demandas;
}

/** Alerta de `items[]` o de `alert`. */
export function aAlerta(bruto: unknown): Alerta {
  const registro = esRegistro(bruto) ? bruto : {};
  const nivelCodigo = texto(registro, ['nivelCodigo', 'nivel_codigo']);
  const distritoId = numero(registro, ['distritoId', 'distrito_id']);
  const distritoRuta = texto(registro, ['distritoRuta', 'distrito_ruta']);
  const partes = partirRuta(distritoRuta);
  const region = texto(registro, ['region']) ?? partes.region;
  const provincia = texto(registro, ['provincia']) ?? partes.provincia;
  const historial = aRevisiones(leer(registro, ['historial', 'revisiones']));
  const riesgo =
    aRiesgo(texto(registro, ['riesgo'])) ??
    aRiesgo(texto(registro, ['casoRiesgo', 'caso_riesgo'])) ??
    'Bajo';

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'codigoAlerta', 'codigo_alerta']) ?? '',
    titulo: texto(registro, ['titulo']),
    casoId: texto(registro, ['casoId', 'caso_id']),
    casoCodigo: texto(registro, ['casoCode', 'caso_code']),
    casoTitulo: texto(registro, ['casoTitulo', 'caso_titulo']),
    casoResumen: texto(registro, ['casoResumen', 'caso_resumen']),
    casoActores: aActoresCaso(leer(registro, ['casoActores', 'caso_actores'])),
    casoDemandas: aDemandasCaso(leer(registro, ['casoDemandas', 'caso_demandas'])),
    riesgo,
    alcance:
      aAlcance(texto(registro, ['alcance'])) ??
      (distritoId !== null ? 'Distrito' : region ? 'Región' : 'Nacional'),
    region,
    provincia,
    prioridad: null,
    plazoHoras: null,
    grave: false,
    nivel: aNivel(texto(registro, ['nivel']), nivelCodigo),
    nivelCodigo,
    pasoActual: numero(registro, ['pasoActual', 'paso_actual']) ?? 1,
    estadoLegado: texto(registro, ['estadoLegado', 'estado_legado']),
    visibilidad: texto(registro, ['visibilidad']),
    fechaReporte: texto(registro, ['fechaReporte', 'fecha_reporte']),
    fechaValidacion: texto(registro, ['fechaValidacion', 'fecha_validacion']),
    fechaAprobacion: texto(registro, ['fechaAprobacion', 'fecha_aprobacion']),
    aprobadaPor: texto(registro, ['aprobadaPor', 'aprobada_por']),
    validadaPor: texto(registro, ['validadaPor', 'validada_por']),
    ultimoRevisor:
      texto(registro, ['ultimoRevisor', 'ultimo_revisor']) ??
      historial[0]?.autor ??
      texto(registro, ['validadaPor', 'validada_por']),
    ultimaModificacion:
      texto(registro, ['ultimaModificacion', 'ultima_modificacion']) ?? historial[0]?.fecha ?? null,
    modificadoPor:
      texto(registro, ['modificadoPor', 'modificado_por']) ?? historial[0]?.autor ?? null,
    historial,
    descripcionRiesgo: texto(registro, ['descripcionRiesgo', 'descripcion_riesgo']),
    hechosRecientes: texto(registro, ['hechosRecientes', 'hechos_recientes']),
    situacionActual: texto(registro, ['situacionActual', 'situacion_actual']),
    accionesOaipcs: texto(registro, ['accionesOaipcs', 'acciones_oaipcs']),
    riesgos: aLineas(leer(registro, ['riesgos'])),
    accionesSugeridas: aLineas(leer(registro, ['accionesSugeridas', 'acciones_sugeridas'])),
    actoresClave: aLineas(leer(registro, ['actoresClave', 'actores_clave'])),
    demandasInmediatas: aLineas(leer(registro, ['demandasInmediatas', 'demandas_inmediatas'])),
    plantillaWhatsapp: texto(registro, ['plantillaWhatsapp', 'plantilla_whatsapp']),
    fuenteTipo: texto(registro, ['fuenteTipo', 'fuente_tipo']),
    fuenteDescripcion: texto(registro, ['fuenteDescripcion', 'fuente_descripcion']),
    fuenteUrl: texto(registro, ['fuenteUrl', 'fuente_url']),
    distritoId,
    distrito: texto(registro, ['distrito']),
    distritoRuta,
    casoDistritoId: numero(registro, ['casoDistritoId', 'caso_distrito_id']),
    casoDistrito: texto(registro, ['casoDistrito', 'caso_distrito']),
    casoDistritoRuta: texto(registro, ['casoDistritoRuta', 'caso_distrito_ruta']),
    distritoCoincideConCaso: booleanoONull(registro, [
      'distritoCoincideConCaso',
      'distrito_coincide_con_caso',
    ]),
    subsector: texto(registro, ['subsector']),
    origen: texto(registro, ['origen']),
    confianza: numero(registro, ['confianza']),
    validado: booleano(registro, ['validado']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    estado: texto(registro, ['estado']) ?? '',
    atendida: booleano(registro, ['atendida']),
    triajeEstado: aTriajeEstado(texto(registro, ['triajeEstado', 'triaje_estado'])),
    motivoDescarte: texto(registro, ['motivoDescarte', 'motivo_descarte']),
    duplicadaDeCodigo: texto(registro, ['duplicadaDeCodigo', 'duplicada_de_codigo']),
    anuladoEn: texto(registro, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(registro, ['motivoAnulacion', 'motivo_anulacion']),
    anuladoPor: texto(registro, ['anuladoPor', 'anulado_por']),
    anuladoPorNombre: texto(registro, ['anuladoPorNombre', 'anulado_por_nombre']),
    anulacionId: texto(registro, ['anulacionId', 'anulacion_id']),
    archivadoEn: texto(registro, ['archivadoEn', 'archivado_en']),
    motivoArchivo: texto(registro, ['motivoArchivo', 'motivo_archivo']),
    archivadoPor: texto(registro, ['archivadoPor', 'archivado_por']),
    archivadoPorNombre: texto(registro, ['archivadoPorNombre', 'archivado_por_nombre']),
  };
}

function aDemandaAlerta(bruto: unknown): DemandaAlerta {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    descripcion: texto(registro, ['descripcion']),
    problema: texto(registro, ['problema']),
    propuesta: texto(registro, ['propuesta']),
    pedido: texto(registro, ['pedido']),
    estado: texto(registro, ['estado']),
    fechaRegistro: texto(registro, ['fechaRegistro', 'fecha_registro']),
  };
}

/** Detalle de `GET /api/v1/alerts/:id` (`{alert, demandas, generatedAt}`). */
export function aDetalleAlerta(bruto: unknown): DetalleAlerta {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    alerta: aAlerta(leer(registro, ['alert', 'alerta'])),
    demandas: lista(registro, ['demandas']).map(aDemandaAlerta),
  };
}

/* ------------------------------------------------------------------------- *
 * Presentación
 * ------------------------------------------------------------------------- */

/** @deprecated «48 h» o «Sin plazo». */
export function formatearPlazo(horas: number | null): string {
  return horas === null ? 'Sin plazo' : `${horas} h`;
}

/** @deprecated */
export function etiquetaPrioridadConPlazo(prioridad: PrioridadAlerta | null): string {
  if (!prioridad) return 'Sin prioridad';
  return `${prioridad} (${PLAZO_POR_PRIORIDAD[prioridad]})`;
}

/** @deprecated */
export function clavePrioridad(prioridad: PrioridadAlerta | null): string {
  switch (prioridad) {
    case 'Crítica inmediata':
      return 'critica';
    case 'Urgente':
      return 'urgente';
    case 'Temprana':
      return 'temprana';
    case 'Seguimiento':
      return 'seguimiento';
    default:
      return 'sin-prioridad';
  }
}

/** Clases de estado ya definidas en `global.css`. */
export function claseEstado(estado: string): string {
  switch (estado) {
    case 'Aprobada':
      return 'state-approved';
    case 'Atendida':
      return 'state-dismissed';
    default:
      return 'state-pending';
  }
}

/**
 * Rótulos cortos de estado para la tabla y la ficha. «En revisión» y
 * «Validada» se abrevian; el valor canónico sigue siendo el de
 * `ESTADOS_ALERTA`.
 */
export function etiquetaEstado(estado: string | null): string {
  switch (estado) {
    case 'Pendiente de revisión':
      return 'Pendiente';
    case 'En revisión':
      return 'Revisión';
    case 'En modificación':
      return 'Modificación';
    case 'Validada':
      return 'Validado';
    case 'Aprobada':
      return 'Aprobado';
    default:
      return estado?.trim() || 'Sin estado';
  }
}

const ESTADOS_TRIAJE: readonly EstadoTriaje[] = [
  'pendiente',
  'en_triage',
  'confirmada',
  'descartada',
  'duplicada',
];

function aTriajeEstado(valor: string | null): EstadoTriaje | null {
  return valor && (ESTADOS_TRIAJE as readonly string[]).includes(valor)
    ? (valor as EstadoTriaje)
    : null;
}

/** Rótulo legible del estado de triaje para la ficha. */
export function etiquetaTriaje(estado: EstadoTriaje): string {
  switch (estado) {
    case 'en_triage':
      return 'En triaje';
    case 'confirmada':
      return 'Confirmada';
    case 'descartada':
      return 'Descartada';
    case 'duplicada':
      return 'Duplicada';
    default:
      return 'Pendiente';
  }
}

/** Clave de color del riesgo (`risk-alto` / `risk-medio` / `risk-bajo`). */
export function claveRiesgo(riesgo: Riesgo): string {
  switch (riesgo) {
    case 'Alto':
      return 'alto';
    case 'Medio':
      return 'medio';
    default:
      return 'bajo';
  }
}

/** «REPORTE DE ALERTA TEMPRANA | …» y el 🔔 inicial fuera del título. */
const PREFIJO_TITULO = /^(?:\s*🔔)?\s*reporte\s+de\s+alerta\s+temprana\s*\|\s*/i;

export function tituloLimpio(titulo: string | null | undefined): string {
  return (titulo ?? '').replace(PREFIJO_TITULO, '').trim();
}

/** «Región / Provincia», o el distrito cuando no hay región conocida. */
export function geografiaAlerta(alerta: Alerta): string {
  if (alerta.region && alerta.provincia) return `${alerta.region} / ${alerta.provincia}`;
  return alerta.region ?? alerta.provincia ?? alerta.distrito ?? 'Sin geografía';
}

/**
 * «Local · distrito», «Regional · región» o «Nacional · …» según el alcance.
 * Usa un solo nombre de lugar (no «región / provincia») y degrada al nivel
 * territorial cuando la alerta no tiene geografía cargada.
 */
export function ambitoAlerta(alerta: Alerta): string {
  const lugar =
    alerta.alcance === 'Distrito'
      ? (alerta.distrito ?? alerta.provincia ?? alerta.region ?? '')
      : (alerta.region ?? alerta.provincia ?? alerta.distrito ?? '');

  switch (alerta.alcance) {
    case 'Distrito':
      return lugar ? `Local · ${lugar}` : 'Local';
    case 'Región':
      return lugar ? `Regional · ${lugar}` : 'Regional';
    default:
      return lugar ? `Nacional · ${lugar}` : 'Nacional';
  }
}

function bloque(titulo: string, lineas: readonly string[]): string {
  const contenido = lineas
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0)
    .join('\n');
  return contenido ? `*${titulo}*\n${contenido}` : `*${titulo}*`;
}

/**
 * Quita el sufijo «· Tel. …» de una línea de actor. El teléfono se guarda en la
 * alerta para el panel y las exportaciones, pero no debe viajar por WhatsApp.
 */
export function actorSinTelefono(linea: string): string {
  return linea.replace(/\s*·\s*Tel\.?\s*[0-9][0-9\s()+.-]*$/i, '').trim();
}

/** Un hecho del relato, ya separado en fecha y texto. */
export type HechoLinea = {
  /** `YYYY-MM-DD`, o `null` si el relato no trae una fecha completa. */
  fecha: string | null;
  texto: string;
};

/** Abreviaturas que usa la data; `SET` es la local y `SEP` la del estándar. */
const MESES_HECHO: Readonly<Record<string, number>> = {
  ENE: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SET: 9,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DIC: 12,
};

/** `YYYY-MM-DD` si la terna es un día real del calendario; `null` si no. */
function isoSiValida(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const prueba = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    prueba.getUTCFullYear() !== anio ||
    prueba.getUTCMonth() !== mes - 1 ||
    prueba.getUTCDate() !== dia
  ) {
    return null;
  }
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Separa la fecha del texto de un hecho.
 *
 * Replica en lectura lo que hicieron las migraciones 79 y 80 sobre
 * `core.alerta_hechos`: reconoce `dd.mm.aaaa`, `dd/mm/aaaa`, `dd.MMM.aaaa` y el
 * formato compacto que recompone la API (`05NOV2026`) como prefijo; con
 * `fechaReporte` reconoce además `dd.mm` sin año, tomando el año del reporte (y
 * el anterior si el hecho cayera después). Cualquier otra forma —rangos, sólo
 * mes, fechas a mitad del relato— se deja intacta, porque inventar el año
 * falsearía el dato.
 *
 * No se usa para guardar: `hechos_recientes` sigue siendo el texto
 * autoritativo hasta que exista la tabla en la interfaz. Es sólo presentación.
 */
export function partirHecho(linea: string, fechaReporte?: string | null): HechoLinea {
  const limpio = linea.trim();
  if (!limpio) return { fecha: null, texto: '' };

  // dd.mm.aaaa · dd/mm/aaaa
  const numerica = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/.exec(limpio);
  if (numerica) {
    const fecha = isoSiValida(Number(numerica[3]), Number(numerica[2]), Number(numerica[1]));
    if (fecha) {
      const resto = limpio.slice(numerica[0].length).replace(/^\s*[–—-]?\s*:?\s*/, '');
      // Un rango (`28.04.2026–30.04.2026`) conserva el texto: la segunda fecha
      // aporta contexto y la primera ya está en `fecha`.
      if (!/^\d{1,2}[./]\d{1,2}[./]\d{4}/.test(resto)) {
        return { fecha, texto: resto.trim() || limpio };
      }
      return { fecha, texto: limpio };
    }
  }

  // dd.MMM.aaaa
  const letras = /^(\d{1,2})\.([A-Za-z]{3})\.(\d{4})(?!\d)/.exec(limpio);
  if (letras) {
    const mes = MESES_HECHO[letras[2].toUpperCase()];
    if (mes) {
      const fecha = isoSiValida(Number(letras[3]), mes, Number(letras[1]));
      if (fecha) {
        const resto = limpio.slice(letras[0].length).replace(/^\s*[–—-]?\s*:?\s*/, '');
        return { fecha, texto: resto.trim() || limpio };
      }
    }
  }

  // ddMMMaaaa: el formato compacto que escribe la API (`05NOV2026`). Es el
  // que recompone `hechos_recientes` desde la tabla, así que tiene que poder
  // volver a leerse al editar.
  const compacta = /^(\d{1,2})([A-Za-z]{3})(\d{4})(?!\d)/.exec(limpio);
  if (compacta) {
    const mes = MESES_HECHO[compacta[2].toUpperCase()];
    if (mes) {
      const fecha = isoSiValida(Number(compacta[3]), mes, Number(compacta[1]));
      if (fecha) {
        const resto = limpio.slice(compacta[0].length).replace(/^\s*[–—-]?\s*:?\s*/, '');
        return { fecha, texto: resto.trim() || limpio };
      }
    }
  }

  // dd.mm sin año: sólo con la fecha de reporte como referencia.
  const sinAnio = /^(\d{1,2})[./](\d{1,2})\s*[–—-]/.exec(limpio);
  if (sinAnio && fechaReporte) {
    const referencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaReporte.trim());
    if (referencia) {
      const dia = Number(sinAnio[1]);
      const mes = Number(sinAnio[2]);
      const anio = Number(referencia[1]);
      let candidata = isoSiValida(anio, mes, dia);
      if (candidata && candidata > fechaReporte.trim().slice(0, 10)) {
        candidata = isoSiValida(anio - 1, mes, dia);
      }
      if (candidata) {
        const resto = limpio.slice(sinAnio[0].length - 1).replace(/^\s*[–—-]?\s*:?\s*/, '');
        return { fecha: candidata, texto: resto.trim() || limpio };
      }
    }
  }

  return { fecha: null, texto: limpio };
}

/**
 * Parte el texto de «hechos recientes» en líneas. Acepta el formato heredado
 * (una línea por hecho, con «- », «* » o «• » delante y la fecha embebida) y
 * devuelve cada hecho ya separado en fecha y descripción. `fechaReporte` es el
 * contexto que permite resolver los `dd.mm` sin año.
 */
export function hechosComoLineas(
  texto: string | null | undefined,
  fechaReporte?: string | null,
): HechoLinea[] {
  return (texto ?? '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0)
    .map((linea) => partirHecho(linea.replace(/^[-*•·]\s*/, ''), fechaReporte))
    .filter((hecho) => hecho.texto.length > 0);
}

/**
 * Datos del caso vinculado que la plantilla puede anexar.
 *
 * Todos los campos son opcionales: quien llama decide qué conoce y, si no pasa
 * nada, la plantilla conserva exactamente el mensaje de siempre.
 */
export type CasoVinculadoWhatsapp = {
  codigo?: string | null;
  titulo?: string | null;
  resumen?: string | null;
  actores?: readonly string[];
  demandas?: readonly string[];
};

/**
 * Sección «📎 Caso vinculado»: nombre, resumen, actores y demandas del
 * expediente. Devuelve `null` si no hay ni un dato útil, para no añadir un
 * encabezado vacío a la plantilla.
 */
function seccionCasoVinculado(caso: CasoVinculadoWhatsapp | null | undefined): string | null {
  if (!caso) return null;

  const identificacion = [caso.codigo?.trim(), caso.titulo?.trim()]
    .filter((parte): parte is string => !!parte)
    .join(' · ');
  const resumen = (caso.resumen ?? '').trim();
  const actores = (caso.actores ?? []).map((actor) => actor.trim()).filter(Boolean);
  const demandas = (caso.demandas ?? []).map((demanda) => demanda.trim()).filter(Boolean);

  if (!identificacion && !resumen && actores.length === 0 && demandas.length === 0) {
    return null;
  }

  return bloque('📎 Caso vinculado', [
    identificacion,
    resumen,
    ...(actores.length ? ['Actores principales:', ...actores.map((actor) => `- ${actor}`)] : []),
    ...(demandas.length ? ['Demandas:', ...demandas.map((demanda) => `- ${demanda}`)] : []),
  ]);
}

/**
 * Mensaje de WhatsApp con la estructura del «Reporte de alerta temprana».
 * `*` es negrita en WhatsApp y los encabezados llevan emoji para que el mensaje
 * se lea desde el móvil sin formato. Las fechas van en forma compacta
 * (`05NOV2026`).
 *
 * Las secciones aparecen siempre: `bloque` conserva el encabezado aunque no
 * haya contenido, para que el reporte no pierda su esqueleto. Los encabezados
 * son los del reporte de alerta temprana, en ese orden y con esos emojis.
 *
 * No incorpora `plantillaWhatsapp`: si la alerta tiene una plantilla guardada,
 * es ella la que manda (la decide quien llama).
 *
 * `caso` es opcional. Sólo cuando el llamador pasa los datos del caso vinculado
 * se anexa la sección «📎 Caso vinculado»; sin ellos el mensaje no cambia.
 */
export function plantillaWhatsapp(alerta: Alerta, caso?: CasoVinculadoWhatsapp | null): string {
  const titulo = tituloLimpio(alerta.titulo) || alerta.codigo;
  const fecha = alerta.fechaReporte ? formatearFechaCompacta(alerta.fechaReporte) : 'Sin fecha';
  const descripcion = (alerta.descripcionRiesgo ?? '').trim();
  const riesgos = alerta.riesgos.filter((riesgo) => riesgo.trim() !== descripcion);

  const acciones = [
    'De considerarlo pertinente, se sugiere:',
    ...alerta.accionesSugeridas
      .map((accion) => accion.trim())
      .map((accion) => accion.replace(/^de\s+considerarlo\s+pertinente,?\s*se\s+sugiere:?\s*/i, ''))
      .filter((accion) => accion.length > 0)
      .map((accion) => `- ${accion}`),
  ];

  const partes = [
    [
      `*🔔 REPORTE DE ALERTA TEMPRANA | ${titulo}*`,
      `📅 _*Fecha de emisión*: ${fecha}_`,
      `🌍 _*Ámbito*: ${ambitoAlerta(alerta)}_`,
    ].join('\n'),
    bloque('🔍 1. SITUACIÓN ACTUAL', [alerta.situacionActual ?? '']),
    bloque('🏗️ 2. HECHOS RECIENTES Y ACCIONES EN CURSO', [alerta.hechosRecientes ?? '']),
    bloque(
      '👥 3. ACTORES CLAVE',
      alerta.actoresClave.map((actor) => `- ${actorSinTelefono(actor)}`),
    ),
    bloque(
      '📌 4. DEMANDAS INMEDIATAS',
      alerta.demandasInmediatas.map((demanda) => `- ${demanda}`),
    ),
    bloque('⚠️ RIESGOS', [descripcion, ...riesgos.map((riesgo) => `- ${riesgo}`)]),
    bloque('🧭 ACCIONES SUGERIDAS', acciones),
  ];

  const seccionCaso = seccionCasoVinculado(caso);
  if (seccionCaso) partes.push(seccionCaso);

  return partes.filter((parte) => parte.trim()).join('\n\n');
}

export type EtapaFlujo = {
  paso: number;
  nombre: string;
  estado: string;
  responsable: string;
};

/** Los cinco pasos de `core.flujo_definicion` (`tipo_flujo = 'alerta'`). */
const ETAPAS_FLUJO: readonly EtapaFlujo[] = [
  { paso: 1, nombre: 'Elaboración', estado: 'Registrado', responsable: 'Sectorista' },
  { paso: 2, nombre: 'Validación previa', estado: 'Validado', responsable: 'Sectorista' },
  {
    paso: 3,
    nombre: 'Aprobación definitiva',
    estado: 'Aprobado',
    responsable: 'Dirección OAIPCS',
  },
  { paso: 4, nombre: 'Remisión', estado: 'Remitido', responsable: 'Servicio de agente' },
  { paso: 5, nombre: 'Archivo', estado: 'Archivado', responsable: 'Sectorista' },
];

export function etapaDeFlujo(paso: number): EtapaFlujo | null {
  return ETAPAS_FLUJO.find((etapa) => etapa.paso === paso) ?? null;
}

export type AccionFlujo = {
  paso: number;
  etiqueta: string;
  detalle: string;
  responsable: string;
};

/** Paso 3: la aprobación definitiva de la Dirección OAIPCS. */
export const PASO_APROBACION_DEFINITIVA = 3;

/** Paso 1: elaboración del candidato por el sectorista. */
export const PASO_ELABORACION = 1;

/** Paso 2: revisión / validación previa a la que se devuelve una alerta. */
export const PASO_REVISION = 2;

/** Paso 4: remisión a los destinatarios, a cargo del servicio de agente. */
export const PASO_REMISION = 4;

/** Paso 5: archivo del expediente, a cargo del sectorista (arista 4→5). */
export const PASO_ARCHIVO = 5;

/**
 * Transiciones legales desde cada paso, según `docs/03_ejecucion/mvp.md` §3.4:
 *
 * 1 Elaboración → 2 Validación previa.
 * 2 → 3 Aprobación definitiva, o devolución a 1.
 * 3 → 4 Remisión, o devolución a 2 o a 1.
 * 4 → 5 Archivo.
 * 5 → ninguna: reabrir exige una alerta nueva.
 */
const ACCIONES_POR_PASO: Readonly<Record<number, readonly AccionFlujo[]>> = {
  1: [
    {
      paso: 2,
      etiqueta: 'Enviar a validación previa',
      detalle: 'Registra la decisión humana sobre el candidato.',
      responsable: 'Sectorista',
    },
  ],
  2: [
    {
      paso: 3,
      etiqueta: 'Enviar a aprobación definitiva',
      detalle: 'Solicita el acto de la Dirección de la OAIPCS.',
      responsable: 'Dirección OAIPCS',
    },
    {
      paso: 1,
      etiqueta: 'Devolver a elaboración',
      detalle: 'El candidato no sustenta una alerta; se conserva la historia.',
      responsable: 'Sectorista',
    },
  ],
  3: [
    {
      paso: 4,
      etiqueta: 'Ordenar remisión',
      detalle: 'El servicio registra el envío a los destinatarios.',
      responsable: 'Servicio de agente',
    },
    {
      paso: 2,
      etiqueta: 'Devolver a validación previa',
      detalle: 'La Dirección pide corrección antes de aprobar.',
      responsable: 'Dirección OAIPCS',
    },
    {
      paso: 1,
      etiqueta: 'Devolver a elaboración',
      detalle: 'Lo que falta es la alerta misma.',
      responsable: 'Dirección OAIPCS',
    },
  ],
  4: [
    {
      paso: 5,
      etiqueta: 'Archivar',
      detalle: 'Cierra el expediente; la alerta deja de estar viva.',
      responsable: 'Sectorista',
    },
  ],
  5: [],
};

export function accionesDeFlujo(paso: number): readonly AccionFlujo[] {
  return ACCIONES_POR_PASO[paso] ?? [];
}

/** Rol que recorre una arista del circuito, en la nomenclatura de la Guía. */
type RolArista = 'sectorista' | 'direccion' | 'servicio_agente';

/**
 * Quién recorre cada arista (§3.4 de la Guía), copia de `TRANSICIONES_LEGALES`
 * en `lib/db/repos/alerts.ts`.
 *
 * El backend manda. Esta copia existe sólo para no pintar un botón que la API
 * respondería con 409: la vista de alertas ofrece «Aprobar» a la Dirección y
 * «Enviar a revisión» al sectorista, y sin este filtro ambos aparecían en pasos
 * donde la arista no existe (por ejemplo, aprobar desde elaboración).
 */
const ARISTAS_DE_ROL: Readonly<Record<string, readonly RolArista[]>> = {
  '1>2': ['sectorista'],
  '2>3': ['direccion'],
  '2>1': ['sectorista'],
  '3>4': ['servicio_agente'],
  '3>2': ['direccion'],
  '3>1': ['direccion'],
  '4>5': ['sectorista'],
};

const ROLES_DIRECCION_FLUJO: ReadonlySet<string> = new Set(['direccion_oaipcs', 'alta_direccion']);

/**
 * `true` si `roles` puede llevar la alerta del paso `desde` al paso `hasta`.
 *
 * · `administrador` siempre puede (la base lo exceptúa del guardia).
 * · Un paso que no cambia no es una transición: devuelve `false` para que la
 *   UI no ofrezca un botón que no haría nada.
 * · No modela la excepción de retroceso «por autor del último cambio»: esa
 *   acción tiene su propia píldora («Deshacer») en la fila.
 */
export function aristaPermitida(roles: readonly string[], desde: number, hasta: number): boolean {
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return true;
  if (desde === hasta) return false;
  if (roles.includes('administrador')) return true;

  const exigidos = ARISTAS_DE_ROL[`${desde}>${hasta}`];
  if (!exigidos) return false;

  return exigidos.some((exigido) =>
    exigido === 'direccion'
      ? roles.some((rol) => ROLES_DIRECCION_FLUJO.has(rol))
      : roles.includes(exigido),
  );
}
