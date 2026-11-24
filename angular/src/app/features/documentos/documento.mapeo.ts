/**
 * Documentos → dominio.
 *
 * Único punto donde se traduce el sobre de `GET /api/v1/documents` al
 * vocabulario de la Guía (§7.7.1, §8.3.3; Anexos 1–17). Las claves españolas
 * van primero en cada lectura, igual que en el resto de mapeos, de modo que el
 * rename del backend no obligue a tocar las pantallas.
 *
 * Dos precisiones que no se inventan aquí:
 * - `estadoUi` es la derivación que hace el repositorio (`core.documentos.estado`
 *   sólo guarda «Activo» o NULL). El estado crudo se conserva en `estado` y no
 *   se reescribe en el cliente.
 * - `anexoNumero` viene del catálogo `core.cat_tipos_documento`; si es NULL el
 *   tipo no tiene anexo y no se fabrica ninguno.
 */

import { booleano, esRegistro, fechaIso, leer, lista, numero, texto } from '../../dominio/mapeo';

/* ------------------------------------------------------------------------- *
 * Vocabulario
 * ------------------------------------------------------------------------- */

/**
 * Estados de escritura que acepta `updateDocument`
 * (`lib/db/repos/documents.ts` → `ESTADOS_DOCUMENTO`). Son también las
 * etiquetas que muestra `estadoUi` cuando el registro no es el legado «Activo».
 */
export const ESTADOS_DOCUMENTO = [
  'Cargado',
  'En análisis',
  'Extraído',
  'Validado',
  'Rechazado',
] as const;

export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

/** Órdenes que entiende el repositorio (`SORTS`). */
export const ORDENES_DOCUMENTO: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'recent', etiqueta: 'Fecha (más reciente)' },
  { valor: 'code', etiqueta: 'Código (A → Z)' },
];

/**
 * Opciones del filtro `estado`.
 *
 * `listDocuments` compara contra `core.documentos.estado` tal cual:
 * - `activo` cubre los documentos con el estado heredado «Activo», que la UI
 *   rotula «Cargado».
 * - `sin_estado` cubre los que no tienen estado registrado (también «Cargado»
 *   en la UI, pero no se pueden pedir con el mismo valor de filtro).
 * - El resto son valores literales del flujo de escritura.
 */
export const FILTROS_ESTADO: readonly { valor: string; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Todos' },
  { valor: 'activo', etiqueta: 'Cargado' },
  { valor: 'sin_estado', etiqueta: 'Sin estado registrado' },
  { valor: 'En análisis', etiqueta: 'En análisis' },
  { valor: 'Extraído', etiqueta: 'Extraído' },
  { valor: 'Validado', etiqueta: 'Validado' },
  { valor: 'Rechazado', etiqueta: 'Rechazado' },
];

/* ------------------------------------------------------------------------- *
 * Tipos de dominio
 * ------------------------------------------------------------------------- */

export type Documento = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  /** `YYYY-MM-DD`. */
  fecha: string | null;
  /** Código del catálogo (`core.cat_tipos_documento.codigo`). */
  tipo: string | null;
  tipoNombre: string | null;
  /** Número de anexo de la Guía; NULL si el tipo no proviene de un anexo. */
  anexoNumero: number | null;
  casoId: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  /** Estado crudo de la base (puede ser NULL o el legado «Activo»). */
  estado: string | null;
  /** Etiqueta que muestra la UI; el repositorio la deriva del estado crudo. */
  estadoUi: string;
  resumen: string | null;
  archivo: string | null;
  urlLista: string | null;
  urlFoto: string | null;
  origen: string | null;
  /** 0..1 (`core.documentos.confidence`). */
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  responsableUsuarioId: string | null;
  /** Nombre legible del responsable; `null` si no se puede resolver. */
  responsableNombre: string | null;
  reunionId: string | null;
  distritoId: number | null;
  /** Sólo viene en `GET /api/v1/documents/:id`. */
  codigoLegado: string | null;
  /** ISO de la anulación lógica; `null` mientras el registro está activo. */
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

export type FuenteDocumento = {
  id: string;
  titulo: string | null;
  tipo: string | null;
  url: string | null;
  fechaIngesta: string | null;
};

export type DetalleDocumento = {
  documento: Documento;
  fuentes: FuenteDocumento[];
};

export type OpcionCatalogo = {
  valor: string;
  etiqueta: string;
  anexoNumero: number | null;
};

/**
 * Norma del marco legal que el árbol del RAG publica aparte de los documentos.
 * No es un documento del catálogo: no abre la ficha ni se pagina.
 */
export type Normativa = {
  id: string;
  codigo: string | null;
  titulo: string;
  tipoNorma: string;
  ambito: string;
  entidadEmisora: string | null;
  /** `YYYY-MM-DD`; `null` si no viene o no es una fecha válida. */
  fechaPublicacion: string | null;
  url: string | null;
  resumen: string | null;
};

/** Documento indexado en el árbol que no es un documento del RAG ni una norma. */
export type OtroDocumento = {
  id: string;
  codigo: string | null;
  titulo: string;
  tipo: string | null;
  /** `YYYY-MM-DD`; `null` si no viene o no es una fecha válida. */
  fecha: string | null;
  entidad: string | null;
  url: string | null;
  resumen: string | null;
};

/**
 * Cuerpo parcial de `PATCH /api/v1/documents/:id`.
 *
 * Sólo las claves que acepta `updateDocument`: `titulo`, `tipo`, `fecha`,
 * `resumen`, `archivo`, `estado`, `casoCode` y `contenido`. Aquí se omiten
 * `contenido` (JSON libre del tipo documental) y `codigo` (no editable).
 *
 * Reglas del repositorio que la UI respeta:
 * - `titulo`, `tipo` y `fecha` no admiten `null`; un texto vacío es 422.
 * - `resumen` y `archivo` admiten `null` para vaciarlos, pero no `""`.
 */
export type PatchDocumento = {
  titulo?: string;
  tipo?: string;
  fecha?: string;
  resumen?: string | null;
  archivo?: string | null;
  estado?: string | null;
  casoCode?: string | null;
};

/**
 * Cuerpo de `POST /api/v1/documents` (alta de metadatos).
 *
 * Sólo las claves que lee `createDocument` (`lib/db/repos/documents.ts`):
 * `titulo` y `tipo` son obligatorios; el código lo genera el servidor.
 * `estado` se omite porque el repositorio lo deriva a «Cargado», y `codigo` y
 * `contenido` no se piden en el alta. Los opcionales que quedan vacíos no
 * viajan: el repositorio rechaza la cadena vacía (422).
 */
export type AltaDocumento = {
  titulo: string;
  tipo: string;
  casoCode?: string;
  /** `YYYY-MM-DD`; si se omite, el servidor usa la fecha del alta. */
  fecha?: string;
  resumen?: string;
  /** Enlace o ruta del PDF (`url_pdf`). */
  archivo?: string;
  /** Listado o índice enlazado (`url_lista`). */
  urlLista?: string;
  /** Fotografía enlazada (`url_foto`). */
  urlFoto?: string;
};

/* ------------------------------------------------------------------------- *
 * Lectura del payload
 * ------------------------------------------------------------------------- */

/** Documento de `items[]` o de `document`. */
export function aDocumento(bruto: unknown): Documento {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    titulo: texto(registro, ['titulo']),
    fecha: texto(registro, ['fecha']),
    tipo: texto(registro, ['tipo']),
    tipoNombre: texto(registro, ['tipoNombre', 'tipo_nombre']),
    anexoNumero: numero(registro, ['anexoNumero', 'anexo_numero']),
    casoId: texto(registro, ['casoId', 'caso_id']),
    casoCode: texto(registro, ['casoCode', 'caso_code']),
    casoTitulo: texto(registro, ['casoTitulo', 'caso_titulo']),
    estado: texto(registro, ['estado']),
    estadoUi:
      texto(registro, ['estadoUi', 'estado_ui']) ?? texto(registro, ['estado']) ?? 'Cargado',
    resumen: texto(registro, ['resumen']),
    archivo: texto(registro, ['archivo']),
    urlLista: texto(registro, ['urlLista', 'url_lista']),
    urlFoto: texto(registro, ['urlFoto', 'url_foto']),
    origen: texto(registro, ['origen']),
    confianza: numero(registro, ['confianza']),
    validado: booleano(registro, ['validado']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    responsableUsuarioId: texto(registro, ['responsableUsuarioId', 'responsable_usuario_id']),
    responsableNombre: texto(registro, ['responsableNombre', 'responsable_nombre']),
    reunionId: texto(registro, ['reunionId', 'reunion_id']),
    distritoId: numero(registro, ['distritoId', 'distrito_id']),
    codigoLegado: texto(registro, ['codigoLegado', 'codigo_legado']),
    anuladoEn: texto(registro, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(registro, ['motivoAnulacion', 'motivo_anulacion']),
    anuladoPor: texto(registro, ['anuladoPor', 'anulado_por']),
    anuladoPorNombre: texto(registro, ['anuladoPorNombre', 'anulado_por_nombre']),
    anulacionId: texto(registro, ['anulacionId', 'anulacion_id']),
  };
}

function aFuente(bruto: unknown): FuenteDocumento {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    titulo: texto(registro, ['titulo']),
    tipo: texto(registro, ['tipo']),
    url: texto(registro, ['url']),
    fechaIngesta: texto(registro, ['fechaIngesta', 'fecha_ingesta']),
  };
}

/** Detalle de `GET /api/v1/documents/:id` (`{document, fuentes, …}`). */
export function aDetalleDocumento(bruto: unknown): DetalleDocumento {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    documento: aDocumento(leer(registro, ['document', 'documento'])),
    fuentes: lista(registro, ['fuentes']).map(aFuente),
  };
}

/** Tipos de documento de `GET /api/v1/catalogs` (`catalogs.tiposDocumento`). */
export function aTiposDocumento(bruto: unknown): readonly OpcionCatalogo[] {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return lista(catalogo, ['tiposDocumento'])
    .map((item): OpcionCatalogo | null => {
      const fila = esRegistro(item) ? item : {};
      const valor = texto(fila, ['codigo']);
      if (!valor) return null;

      return {
        valor,
        etiqueta: texto(fila, ['etiqueta', 'nombre']) ?? valor,
        anexoNumero: numero(fila, ['anexoNumero', 'anexo_numero']),
      };
    })
    .filter((opcion): opcion is OpcionCatalogo => opcion !== null);
}

/** Normativa de `normativas[]` en `GET /api/v1/documents/arbol`. */
export function aNormativa(bruto: unknown): Normativa {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    titulo: texto(registro, ['titulo']) ?? '',
    tipoNorma: texto(registro, ['tipoNorma', 'tipo_norma']) ?? '',
    ambito: texto(registro, ['ambito']) ?? '',
    entidadEmisora: texto(registro, ['entidadEmisora', 'entidad_emisora']),
    fechaPublicacion: fechaIso(texto(registro, ['fechaPublicacion', 'fecha_publicacion', 'fecha'])),
    url: texto(registro, ['url']),
    resumen: texto(registro, ['resumen']),
  };
}

/** Otro documento de `otros[]` en `GET /api/v1/documents/arbol`. */
export function aOtroDocumento(bruto: unknown): OtroDocumento {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    titulo: texto(registro, ['titulo']) ?? '',
    tipo: texto(registro, ['tipo']),
    fecha: fechaIso(texto(registro, ['fecha', 'fechaPublicacion', 'fecha_publicacion'])),
    entidad: texto(registro, ['entidad']),
    url: texto(registro, ['url']),
    resumen: texto(registro, ['resumen']),
  };
}

/* ------------------------------------------------------------------------- *
 * Presentación
 * ------------------------------------------------------------------------- */

/** `YYYY-MM-DD` → `DD/MM/YYYY`; cualquier otra forma se muestra tal cual. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';

  const partes = valor.slice(0, 10).split('-');
  if (partes.length !== 3) return valor;

  const anio = partes[0];
  const mes = partes[1];
  const dia = partes[2];
  if (!anio || !mes || !dia) return valor;

  return `${dia}/${mes}/${anio}`;
}

/**
 * `2026-11-22T09:07:00.776Z` → `22/11/2026 04:07` (hora local del navegador).
 * La anulación es un timestamp: no se rotula con ningún estado de catálogo.
 */
export function formatearFechaHora(valor: string | null | undefined): string {
  if (!valor) return '—';

  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor;

  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()} ${hora}:${minuto}`;
}

/** «Anexo N° 16». No se fabrica un anexo para los tipos que no lo tienen. */
export function etiquetaAnexo(anexoNumero: number): string {
  return `Anexo N° ${anexoNumero}`;
}

/** Clases de estado ya definidas en `global.css`. */
export function claseEstado(estado: string | null): string {
  const clave = (estado ?? '').trim().toLowerCase();
  if (clave === 'validado') return 'state-approved';
  if (clave === 'rechazado') return 'state-dismissed';
  return 'state-pending';
}

/** `confidence` está acotada a 0..1 en la base. */
export function formatearConfianza(valor: number | null): string {
  return valor === null ? '—' : `${Math.round(valor * 100)} %`;
}

/**
 * Etapa de flujo del documento, derivada del estado registrado.
 *
 * No se inventa un paso: si la base no trae estado y el documento no está
 * validado, se declara «Sin etapa». El valor crudo «Activo» se rotula «Cargado»
 * igual que en el resto de la pantalla.
 */
export function etapaFlujo(documento: Documento): string {
  const estado = (documento.estado ?? '').trim().toLowerCase();
  if (documento.validado || estado === 'validado') return 'Validado';
  if (estado === 'en análisis' || estado === 'en analisis') return 'En análisis';
  if (estado === 'extraído' || estado === 'extraido') return 'Extraído';
  if (estado === 'rechazado') return 'Rechazado';
  if (estado) return 'Cargado';
  return 'Sin etapa';
}

/** Rama del árbol documental: un tipo del catálogo con sus documentos. */
export type RamaDocumental = {
  clave: string;
  etiqueta: string;
  documentos: Documento[];
};

/**
 * Agrupa los documentos de la página por tipo documental para el árbol del RAG.
 * No añade filas ni tipos que la página no traiga.
 */
export function agruparDocumentosPorTipo(documentos: readonly Documento[]): RamaDocumental[] {
  const mapa = new Map<string, RamaDocumental>();
  for (const documento of documentos) {
    const clave = documento.tipo ?? 'sin-tipo';
    const etiqueta = documento.tipoNombre ?? documento.tipo ?? 'Sin tipo';
    const rama = mapa.get(clave) ?? { clave, etiqueta, documentos: [] };
    rama.documentos.push(documento);
    mapa.set(clave, rama);
  }
  return [...mapa.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

/** Nombre legible de un archivo o enlace: el último segmento de la ruta. */
export function nombreArchivo(valor: string | null): string {
  if (!valor) return '—';

  const sinConsulta = valor.split('?')[0] ?? valor;
  const ultimo = sinConsulta.split('/').pop();
  return ultimo && ultimo.trim() ? ultimo : valor;
}
