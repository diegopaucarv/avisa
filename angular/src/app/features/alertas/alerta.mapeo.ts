/**
 * Alerta temprana → dominio.
 *
 * Único punto donde se traduce el sobre de `GET /api/v1/alerts` al vocabulario
 * congelado de la Guía (PRODUCE/OAIPCS §8.1.2.2 y Anexo 3). Las claves
 * españolas van primero en cada lectura, de modo que el rename del backend no
 * obliga a tocar los componentes.
 *
 * Dos reglas que no se negocian aquí:
 * - La prioridad es una etiqueta y el plazo vive en `slaHoras`: nunca se
 *   concatena el SLA dentro de la prioridad.
 * - El nivel de alerta es Inmediato · Táctico · Preventivo · Monitoreo; el
 *   catálogo heredado aún guarda `Inmediato (24h)` y el código `NA-00x`, así
 *   que la etiqueta se normaliza y el código se usa como respaldo.
 */

import {
  booleano,
  esRegistro,
  leer,
  lista,
  numero,
  texto,
  type Registro,
} from '../../dominio/mapeo';

/* ------------------------------------------------------------------------- *
 * Vocabulario congelado
 * ------------------------------------------------------------------------- */

export const PRIORIDADES_ALERTA = [
  'Crítica inmediata',
  'Urgente',
  'Temprana',
  'Seguimiento',
] as const;

export type PrioridadAlerta = (typeof PRIORIDADES_ALERTA)[number];

/**
 * Plazo de atención congelado de cada prioridad. Es el mismo dato que
 * `sla_horas` en `cat_prioridades_alerta`; se declara aquí para que el filtro y
 * la tabla lo muestren sin pedir el catálogo en cada pantalla.
 */
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
 * el nombre. La etiqueta visible es la del vocabulario congelado.
 */
export const OPCIONES_NIVEL: readonly { valor: string; etiqueta: NivelAlerta }[] = [
  { valor: 'NA-001', etiqueta: 'Inmediato' },
  { valor: 'NA-002', etiqueta: 'Táctico' },
  { valor: 'NA-003', etiqueta: 'Preventivo' },
  { valor: 'NA-004', etiqueta: 'Monitoreo' },
];

/**
 * Estados derivados que el servidor acepta filtrar (`ESTADOS` de
 * `lib/db/repos/alerts.ts`). Son los mismos cinco que emite `ALERT_STATE`; si se
 * añade uno aquí sin añadirlo allá, el filtro devolvería vacío en silencio.
 */
export const ESTADOS_ALERTA = [
  'Pendiente de revisión',
  'En revisión',
  'Validada',
  'Aprobada',
  'Atendida',
] as const;

export const ORDENES_ALERTA: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'recent', etiqueta: 'Fecha de reporte (más reciente)' },
  { valor: 'prioridad', etiqueta: 'Prioridad (crítica primero)' },
];

/* ------------------------------------------------------------------------- *
 * Tipos de dominio
 * ------------------------------------------------------------------------- */

export type Alerta = {
  id: string;
  codigo: string;
  titulo: string | null;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  /** Etiqueta congelada; `null` si el catálogo no la reconoce. */
  prioridad: PrioridadAlerta | null;
  plazoHoras: number | null;
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
  descripcionRiesgo: string | null;
  hechosRecientes: string | null;
  situacionActual: string | null;
  accionesOaipcs: string | null;
  /** `riesgos_json` aplanado a líneas legibles. */
  riesgos: string[];
  /** `acciones_sugeridas_json` aplanado a líneas legibles. */
  accionesSugeridas: string[];
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  /** `core.distritos.id`; `null` si la alerta no declara distrito. */
  distritoId: number | null;
  distrito: string | null;
  /** «Distrito · Provincia · Región» para desambiguar nombres repetidos. */
  distritoRuta: string | null;
  /** Distrito principal del caso vinculado, si lo tiene. */
  casoDistritoId: number | null;
  casoDistrito: string | null;
  casoDistritoRuta: string | null;
  /**
   * `null` si falta uno de los dos distritos. `false` no es un error: una
   * alerta puede ocurrir en otro punto del territorio que el expediente.
   */
  distritoCoincideConCaso: boolean | null;
  subsector: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  estado: string;
  atendida: boolean;
  /** ISO de la anulación lógica; `null` mientras la alerta está vigente. */
  anuladoEn: string | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
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
 * Sólo las claves que el repositorio acepta
 * (`lib/db/repos/alerts.ts` → `updateAlert`). `pasoActual` se envía aparte,
 * desde las acciones de flujo, para no mezclar contenido con recorrido.
 */
export type PatchAlerta = {
  titulo?: string;
  /** Etiqueta de `cat_prioridades_alerta.codigo`; `null` desvincula. */
  prioridad?: string | null;
  /** `codigo_legado` del nivel (`NA-00x`); `null` desvincula. */
  nivel?: string | null;
  situacionActual?: string | null;
  hechosRecientes?: string | null;
  descripcionRiesgo?: string | null;
  accionesOaipcs?: string | null;
  accionesSugeridas?: string[] | null;
  casoCode?: string | null;
  /**
   * `core.distritos.id`; `null` deja la alerta sin distrito. Ausente = sin
   * cambio: el repositorio sólo hereda el del caso si la alerta no tenía uno.
   */
  distritoId?: number | null;
};

/**
 * Cuerpo de `POST /api/v1/alerts` (alta).
 *
 * `createAlert` (`lib/db/repos/alerts.ts`) exige `titulo` y `prioridad`; el
 * resto son opcionales. No se incluye `nivel`: `/api/v1/catalogs` no expone
 * `cat_niveles_alerta`, así que el cliente no puede ofrecer sus opciones sin
 * inventarlas.
 */
export type AltaAlerta = {
  titulo: string;
  /** `cat_prioridades_alerta.codigo` tal como lo devuelve `/v1/catalogs`. */
  prioridad: string;
  /**
   * `core.distritos.id` del catálogo INEI. `core.alertas_tempranas` sólo tiene
   * `distrito_id` (sin lugares operativos), por eso el buscador de la alerta se
   * restringe a distritos.
   */
  distritoId?: number;
  casoCode?: string;
  descripcionRiesgo?: string;
  hechosRecientes?: string;
  situacionActual?: string;
  accionesOaipcs?: string;
};

/**
 * Opción de `catalogs.prioridadesAlerta` (`GET /api/v1/catalogs`).
 *
 * El catálogo usa `codigo` con espacios (`Critica inmediata`), pero
 * `createAlert` lo resuelve con `core.normalizar_ref`, así que se reenvía tal
 * cual. `slaHoras` y `grave` sólo alimentan el formulario: el plazo no se edita
 * ni se concatena a la etiqueta.
 */
export type OpcionPrioridadAlerta = {
  valor: string;
  etiqueta: string;
  slaHoras: number | null;
  grave: boolean;
};

/** `GET /api/v1/catalogs` → `catalogs.prioridadesAlerta`. */
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

const PRIORIDAD_POR_ETIQUETA = new Map<string, PrioridadAlerta>();
for (const prioridad of PRIORIDADES_ALERTA) {
  PRIORIDAD_POR_ETIQUETA.set(plegar(prioridad), prioridad);
}

function aPrioridad(valor: string | null): PrioridadAlerta | null {
  if (!valor) return null;
  return PRIORIDAD_POR_ETIQUETA.get(plegar(valor)) ?? null;
}

const NIVEL_POR_CODIGO = new Map<string, NivelAlerta>(
  OPCIONES_NIVEL.map((opcion) => [opcion.valor, opcion.etiqueta]),
);

const NIVEL_POR_ETIQUETA = new Map<string, NivelAlerta>();
for (const nivel of NIVELES_ALERTA) {
  NIVEL_POR_ETIQUETA.set(plegar(nivel), nivel);
}

/**
 * El catálogo heredado guarda `Inmediato (24h)`; el SLA ya vive en
 * `sla_horas`, así que el paréntesis se descarta.
 */
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
 * `riesgos_json` y `acciones_sugeridas_json` son «narrativa semiestructurada»:
 * no hay forma garantizada. Se acepta lista de textos, lista de objetos o un
 * texto con viñetas y se aplana a líneas. Lo que no se puede leer, no se
 * inventa: se descarta.
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

/**
 * Tri-estado: `null` cuando el backend no pudo comparar (falta uno de los dos
 * distritos). `booleano` no sirve aquí porque colapsa «no sé» con «no».
 */
function booleanoONull(registro: Registro, claves: readonly string[]): boolean | null {
  const valor = leer(registro, claves);
  return typeof valor === 'boolean' ? valor : null;
}

/** Alerta de `items[]` o de `alert`. */
export function aAlerta(bruto: unknown): Alerta {
  const registro = esRegistro(bruto) ? bruto : {};
  const nivelCodigo = texto(registro, ['nivelCodigo', 'nivel_codigo']);

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'codigoAlerta', 'codigo_alerta']) ?? '',
    titulo: texto(registro, ['titulo']),
    casoId: texto(registro, ['casoId', 'caso_id']),
    casoCodigo: texto(registro, ['casoCode', 'caso_code']),
    casoTitulo: texto(registro, ['casoTitulo', 'caso_titulo']),
    prioridad: aPrioridad(texto(registro, ['prioridad'])),
    plazoHoras: numero(registro, ['slaHoras', 'sla_horas']),
    grave: booleano(registro, ['grave']),
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
    descripcionRiesgo: texto(registro, ['descripcionRiesgo', 'descripcion_riesgo']),
    hechosRecientes: texto(registro, ['hechosRecientes', 'hechos_recientes']),
    situacionActual: texto(registro, ['situacionActual', 'situacion_actual']),
    accionesOaipcs: texto(registro, ['accionesOaipcs', 'acciones_oaipcs']),
    riesgos: aLineas(leer(registro, ['riesgos'])),
    accionesSugeridas: aLineas(leer(registro, ['accionesSugeridas', 'acciones_sugeridas'])),
    fuenteTipo: texto(registro, ['fuenteTipo', 'fuente_tipo']),
    fuenteDescripcion: texto(registro, ['fuenteDescripcion', 'fuente_descripcion']),
    fuenteUrl: texto(registro, ['fuenteUrl', 'fuente_url']),
    distritoId: numero(registro, ['distritoId', 'distrito_id']),
    distrito: texto(registro, ['distrito']),
    distritoRuta: texto(registro, ['distritoRuta', 'distrito_ruta']),
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
    anuladoEn: texto(registro, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(registro, ['motivoAnulacion', 'motivo_anulacion']),
    anuladoPor: texto(registro, ['anuladoPor', 'anulado_por']),
    anuladoPorNombre: texto(registro, ['anuladoPorNombre', 'anulado_por_nombre']),
    anulacionId: texto(registro, ['anulacionId', 'anulacion_id']),
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

/** «48 h» o «Sin plazo». El SLA nunca se mete dentro de la prioridad. */
export function formatearPlazo(horas: number | null): string {
  return horas === null ? 'Sin plazo' : `${horas} h`;
}

/**
 * Prioridad con su plazo entre paréntesis: «Crítica inmediata (24 h)»,
 * «Seguimiento (sin plazo)». Es la forma que pide la tabla del item 106 y la
 * misma que ofrece el filtro de prioridad del item 104.
 */
export function etiquetaPrioridadConPlazo(prioridad: PrioridadAlerta | null): string {
  if (!prioridad) return 'Sin prioridad';
  return `${prioridad} (${PLAZO_POR_PRIORIDAD[prioridad]})`;
}

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

export type EtapaFlujo = {
  paso: number;
  nombre: string;
  estado: string;
  responsable: string;
};

/** Los cinco pasos de `core.flujo_definicion` (`tipo_flujo = 'alerta'`). */
const ETAPAS_FLUJO: readonly EtapaFlujo[] = [
  { paso: 1, nombre: 'Elaboración', estado: 'Registrado', responsable: 'Sectorista' },
  {
    paso: 2,
    nombre: 'Validación previa',
    estado: 'Validado',
    responsable: 'Sectorista',
  },
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
  /** Paso de destino. */
  paso: number;
  etiqueta: string;
  detalle: string;
  responsable: string;
};

/**
 * Paso 3: la aprobación definitiva de la Dirección OAIPCS no se envía al
 * pulsar la acción; el panel pide una confirmación explícita (item 23).
 */
export const PASO_APROBACION_DEFINITIVA = 3;

/**
 * Transiciones legales desde cada paso, según `docs/03_ejecucion/mvp.md` §3.4:
 *
 * 1 Elaboración → 2 Validación previa.
 * 2 → 3 Aprobación definitiva, o devolución a 1.
 * 3 → 4 Remisión, o devolución a 2 o a 1.
 * 4 → 5 Archivo.
 * 5 → ninguna: reabrir exige una alerta nueva.
 *
 * `updateAlert` acepta cualquier `pasoActual` entre 1 y 99, así que la
 * restricción la pone el cliente; el backend no la valida.
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
