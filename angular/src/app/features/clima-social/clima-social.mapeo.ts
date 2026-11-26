/**
 * Lectura y presentación de los reportes de clima social.
 *
 * El reporte mensual NO vive en una tabla propia: es un `core.documentos` de
 * tipo `clima_social_general` (Anexo N° 4) o `clima_social_focalizado`
 * (Anexo N° 5) cuya `fecha` cae en el mes consultado. El contenido estructurado
 * viaja en `contenido_json`, heredado del legado como `c01..cNN` (la columna
 * N-ésima de la hoja original), por lo que se extrae de forma tolerante: nunca
 * se fabrica un texto que el registro no traiga.
 */

import { formatearFechaCompacta, partesFecha } from '../../shared/formato-fecha';

export type DocumentoClima = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  /** `YYYY-MM-DD` tal como lo entrega la API. */
  fecha: string | null;
  /** Código del tipo (`clima_social_general` / `clima_social_focalizado`). */
  tipo: string | null;
  tipoNombre: string | null;
  anexoNumero: number | null;
  estado: string | null;
  estadoUi: string;
  resumen: string | null;
  /** `url_pdf` del documento; puede venir nulo aunque exista un enlace en `contenido`. */
  archivo: string | null;
  validado: boolean | null;
  responsableNombre: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
};

export type DetalleReporte = {
  documento: DocumentoClima;
  contenido: Record<string, unknown>;
};

/** Mes consultado; `mes` va de 1 a 12. */
export type MesConsulta = { anio: number; mes: number };

/* ------------------------------------------------------------------------- *
 * Lectura del payload
 * ------------------------------------------------------------------------- */

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

function leer(objeto: Record<string, unknown>, claves: readonly string[]): unknown {
  for (const clave of claves) {
    if (clave in objeto) return objeto[clave];
  }
  return undefined;
}

function texto(objeto: Record<string, unknown>, claves: readonly string[]): string | null {
  const valor = leer(objeto, claves);
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio ? limpio : null;
}

function numero(objeto: Record<string, unknown>, claves: readonly string[]): number | null {
  const valor = leer(objeto, claves);
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function booleano(objeto: Record<string, unknown>, claves: readonly string[]): boolean | null {
  const valor = leer(objeto, claves);
  return typeof valor === 'boolean' ? valor : null;
}

/** Documento de `items[]` o de `document`. */
export function aDocumentoClima(bruto: unknown): DocumentoClima {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    titulo: texto(registro, ['titulo']),
    fecha: texto(registro, ['fecha']),
    tipo: texto(registro, ['tipo']),
    tipoNombre: texto(registro, ['tipoNombre', 'tipo_nombre']),
    anexoNumero: numero(registro, ['anexoNumero', 'anexo_numero']),
    estado: texto(registro, ['estado']),
    estadoUi: texto(registro, ['estadoUi', 'estado_ui']) ?? 'Cargado',
    resumen: texto(registro, ['resumen']),
    archivo: texto(registro, ['archivo']),
    validado: booleano(registro, ['validado']),
    responsableNombre: texto(registro, ['responsableNombre', 'responsable_nombre']),
    casoCode: texto(registro, ['casoCode', 'caso_code']),
    casoTitulo: texto(registro, ['casoTitulo', 'caso_titulo']),
  };
}

function aContenido(valor: unknown): Record<string, unknown> {
  if (esRegistro(valor)) return valor;
  if (typeof valor === 'string') {
    try {
      const analizado: unknown = JSON.parse(valor);
      return esRegistro(analizado) ? analizado : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Detalle de `GET /api/v1/documents/:id` (`{ document, fuentes, … }`). */
export function aDetalleReporte(bruto: unknown): DetalleReporte {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    documento: aDocumentoClima(leer(registro, ['document', 'documento'])),
    contenido: aContenido(leer(registro, ['contenido'])),
  };
}

/* ------------------------------------------------------------------------- *
 * Meses
 * ------------------------------------------------------------------------- */

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export function mesDeHoy(ahora: Date = new Date()): MesConsulta {
  return { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 };
}

export function mesPrevio(mes: MesConsulta): MesConsulta {
  return mes.mes <= 1 ? { anio: mes.anio - 1, mes: 12 } : { anio: mes.anio, mes: mes.mes - 1 };
}

export function mesProximo(mes: MesConsulta): MesConsulta {
  return mes.mes >= 12 ? { anio: mes.anio + 1, mes: 1 } : { anio: mes.anio, mes: mes.mes + 1 };
}

/** `2026-11` → `noviembre 2026` (mes en minúscula, como el resto de la casa). */
export function etiquetaDeMes(mes: MesConsulta): string {
  return `${MESES[mes.mes - 1] ?? '—'} ${mes.anio}`;
}

/** `YYYY-MM-DD` → `{anio, mes}`; cualquier otra forma devuelve `null`. */
export function mesDeFecha(fecha: string | null | undefined): MesConsulta | null {
  if (!fecha) return null;
  const coincidencia = /^(\d{4})-(\d{2})/.exec(fecha);
  if (!coincidencia) return null;
  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  if (!Number.isFinite(anio) || mes < 1 || mes > 12) return null;
  return { anio, mes };
}

/* ------------------------------------------------------------------------- *
 * Selección del reporte
 * ------------------------------------------------------------------------- */

/** Más reciente primero; a igual fecha, el general (consolidado mensual) antes. */
function compararReportes(a: DocumentoClima, b: DocumentoClima): number {
  const fechaA = a.fecha ?? '';
  const fechaB = b.fecha ?? '';
  if (fechaA !== fechaB) return fechaB.localeCompare(fechaA);

  const generalA = a.tipo === 'clima_social_general' ? 0 : 1;
  const generalB = b.tipo === 'clima_social_general' ? 0 : 1;
  if (generalA !== generalB) return generalA - generalB;

  return (a.codigo ?? '').localeCompare(b.codigo ?? '', 'es');
}

export function documentosOrdenados(documentos: readonly DocumentoClima[]): DocumentoClima[] {
  return [...documentos].sort(compararReportes);
}

/**
 * Reporte mensual vigente: el documento de clima social con `fecha` en el mes
 * consultado, el más reciente. Si el mes no tiene ninguno, devuelve `null`
 * —la pantalla declara el vacío en vez de inventar cifras—.
 */
export function seleccionarReporteDelMes(
  documentos: readonly DocumentoClima[],
  mes: MesConsulta,
): DocumentoClima | null {
  const delMes = documentos.filter((documento) => {
    const fecha = mesDeFecha(documento.fecha);
    return fecha !== null && fecha.anio === mes.anio && fecha.mes === mes.mes;
  });

  if (delMes.length === 0) return null;
  return [...delMes].sort(compararReportes)[0] ?? null;
}

/* ------------------------------------------------------------------------- *
 * Presentación
 * ------------------------------------------------------------------------- */

/** `YYYY-MM-DD` → `02NOV2025`; cualquier otra forma se muestra tal cual. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  return partesFecha(valor) ? formatearFechaCompacta(valor) : valor;
}

/** Tipo documental con su anexo, sin fabricar un anexo que no exista. */
export function etiquetaTipo(documento: DocumentoClima): string {
  const base = documento.tipoNombre ?? 'Clima social';
  return documento.anexoNumero === null ? base : `${base} · Anexo N° ${documento.anexoNumero}`;
}

/** Estado de validación: lo que dice `es_validado_humano`, no un catálogo inventado. */
export function etiquetaValidacion(documento: DocumentoClima): string {
  if (documento.validado === true) return 'Validado';
  if (documento.validado === false) return 'Pendiente de validación';
  return 'Sin estado de validación';
}

export function claseValidacion(documento: DocumentoClima): string {
  if (documento.validado === true) return 'state-approved';
  if (documento.validado === false) return 'state-pending';
  return 'state-dismissed';
}

/**
 * Enlace al PDF del reporte.
 *
 * El `url_pdf` del documento puede venir nulo (la migración lo alimentó de una
 * columna vacía); el enlace real vive en `contenido.c20`/`c21`
 * (`Link_PDF_Drive`). Se prefiere el campo y se cae al contenido; si no hay
 * ninguna URL http(s), se declara la ausencia.
 */
export function urlDeContenido(contenido: Record<string, unknown>): string | null {
  for (const clave of ['c20', 'c21', 'c19', 'c22']) {
    const valor = contenido[clave];
    if (typeof valor === 'string' && /^https?:\/\//i.test(valor.trim())) return valor.trim();
  }

  for (const valor of Object.values(contenido)) {
    if (typeof valor === 'string' && /^https?:\/\//i.test(valor.trim())) return valor.trim();
  }

  return null;
}

/* ------------------------------------------------------------------------- *
 * Contenido estructurado (Anexos 04 y 05)
 * ------------------------------------------------------------------------- */

export type ClaveSeccion = 'resumen' | 'actores' | 'clima' | 'demandas' | 'foco';

export type BloqueSeccion = {
  tipo: 'parrafo' | 'lista';
  texto: string;
  items: string[];
};

export type SeccionReporte = {
  clave: ClaveSeccion;
  titulo: string;
  bloques: BloqueSeccion[];
};

const SECCIONES: readonly { clave: ClaveSeccion; titulo: string }[] = [
  { clave: 'resumen', titulo: 'Resumen ejecutivo' },
  { clave: 'actores', titulo: 'Actores' },
  { clave: 'clima', titulo: 'Clima social y hechos recientes' },
  { clave: 'demandas', titulo: 'Demandas locales' },
  { clave: 'foco', titulo: 'Foco PRODUCE' },
];

/**
 * Columnas del legado que pueden traer prosa y su sección por defecto.
 *
 * DIM_ClimaSocial (28 columnas): c13 Situación actual, c14 Focos de tensión,
 * c15 Oportunidades de intervención, c17 Descripción del riesgo, c18
 * Recomendaciones, c27 Demandas, c28 Riesgos inmediatos.
 * DIM_ClimaSocial_Focalizado (26 columnas): c13 Situación actual, c15 Focos de
 * tensión, c16 recomendación, c18 Descripción del riesgo. Se optimiza para el
 * reporte general (Anexo 04); las cabeceras reales del texto mandan.
 */
const CAMPOS_CONTENIDO: readonly { clave: string; defecto: ClaveSeccion }[] = [
  { clave: 'c13', defecto: 'resumen' },
  { clave: 'c14', defecto: 'clima' },
  { clave: 'c15', defecto: 'foco' },
  { clave: 'c16', defecto: 'foco' },
  { clave: 'c17', defecto: 'clima' },
  { clave: 'c18', defecto: 'foco' },
  { clave: 'c27', defecto: 'demandas' },
  { clave: 'c28', defecto: 'clima' },
];

const PATRON_SECCION: readonly {
  clave: ClaveSeccion | 'riesgo';
  patron: RegExp;
}[] = [
  { clave: 'resumen', patron: /^(resumen|contexto\s+r[aá]pido|alerta\s+clave)\b/i },
  { clave: 'actores', patron: /^actores\b/i },
  { clave: 'clima', patron: /^(clima|hechos|hitos|focos?\s+de\s+tensi[oó]n)/i },
  { clave: 'demandas', patron: /^demandas?\b/i },
  {
    clave: 'foco',
    patron: /^(oportunidades|foco\s+produce|acciones\s+previstas|en\s+lo\s+que\s+respecta)/i,
  },
  { clave: 'riesgo', patron: /^(evaluaci[oó]n\s+de\s+riesgo|riesgos?\s+inmediatos)/i },
];

type ClaveDetectada = ClaveSeccion | 'riesgo';

type Deteccion = { clave: ClaveDetectada; resto: string };

function normalizarTitulo(linea: string): string {
  return linea
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, ' ')
    .replace(/[*_#>`•·\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Una línea es cabecera si parece un título corto y arranca con una sección
 * conocida. Si la cabecera trae contenido tras los dos puntos («Evaluación de
 * riesgo: Bajo», «Actores: …»), ese texto se conserva como cuerpo; el rótulo en
 * sí no se repite, para no duplicar el título de la sección.
 */
function claveDeLinea(linea: string): Deteccion | null {
  // Una viñeta nunca es cabecera (`*` queda fuera: puede ser negrita del título).
  if (/^\s*[-•–—→]\s+/.test(linea)) return null;

  const limpio = normalizarTitulo(linea);
  if (!limpio) return null;

  const sinNumero = limpio.replace(/^\d{1,2}\s*[.)]?\s+/, '').trim();
  if (!sinNumero || sinNumero.length > 90) return null;

  const conNumero = /^\d{1,2}\s*[.)]?\s+/.test(limpio);
  const mayusculas =
    sinNumero === sinNumero.toLocaleUpperCase('es') && /[A-ZÁÉÍÓÚÑ]/.test(sinNumero);
  if (!conNumero && !mayusculas) return null;

  for (const { clave, patron } of PATRON_SECCION) {
    if (!patron.test(sinNumero)) continue;
    const dosPuntos = sinNumero.indexOf(':');
    const resto = dosPuntos >= 0 ? sinNumero.slice(dosPuntos + 1).trim() : '';
    if (resto.length > 90) return null;
    return { clave, resto };
  }
  return null;
}

type Segmento = { clave: ClaveDetectada | null; lineas: string[] };

function segmentar(texto: string, defecto: ClaveSeccion | null): Segmento[] {
  const segmentos: Segmento[] = [];
  let actual: Segmento = { clave: defecto, lineas: [] };

  for (const linea of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const deteccion = claveDeLinea(linea);
    if (deteccion) {
      if (actual.lineas.some((l) => l.trim())) segmentos.push(actual);
      actual = {
        clave: deteccion.clave,
        lineas: deteccion.resto ? [deteccion.resto] : [],
      };
      continue;
    }
    actual.lineas.push(linea);
  }

  if (actual.lineas.some((l) => l.trim())) segmentos.push(actual);
  return segmentos;
}

function aBloques(lineas: readonly string[]): BloqueSeccion[] {
  const bloques: BloqueSeccion[] = [];
  let parrafo: string[] = [];
  let items: string[] = [];

  const cerrarParrafo = (): void => {
    if (parrafo.length === 0) return;
    bloques.push({ tipo: 'parrafo', texto: parrafo.join(' ').trim(), items: [] });
    parrafo = [];
  };
  const cerrarLista = (): void => {
    if (items.length === 0) return;
    bloques.push({ tipo: 'lista', texto: '', items });
    items = [];
  };
  const cerrarTodo = (): void => {
    cerrarParrafo();
    cerrarLista();
  };

  for (const linea of lineas) {
    const limpia = linea.trim();
    if (!limpia) {
      cerrarTodo();
      continue;
    }

    const item = limpia.replace(/^(?:[-•*–—→]|\d{1,2}[.)]|➜)\s*/, '');
    if (item !== limpia && item.trim()) {
      cerrarParrafo();
      items.push(item.trim());
      continue;
    }

    // Línea indentada que continúa la viñeta anterior.
    if (items.length > 0 && /^\s{2,}/.test(linea)) {
      items[items.length - 1] = `${items[items.length - 1]} ${limpia}`.trim();
      continue;
    }

    cerrarLista();
    parrafo.push(limpia);
  }

  cerrarTodo();
  return bloques;
}

function textoDe(contenido: Record<string, unknown>, clave: string): string | null {
  const valor = contenido[clave];
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    return limpio ? limpio : null;
  }
  if (typeof valor === 'number') return String(valor);
  if (Array.isArray(valor)) {
    const partes = valor
      .filter((parte): parte is string => typeof parte === 'string' && parte.trim() !== '')
      .map((parte) => parte.trim());
    return partes.length > 0 ? partes.join('\n') : null;
  }
  return null;
}

/**
 * Construye las cinco secciones del reporte a partir de `contenido_json`.
 *
 * Las cabeceras que el propio texto trae («1. Resumen ejecutivo», «3. Hechos
 * recientes», …) mandan sobre la columna de origen, porque en el legado los
 * bloques quedaron repartidos de forma irregular. Lo que no llega queda como
 * sección vacía y la pantalla declara «Sin dato».
 */
export function construirSecciones(detalle: DetalleReporte | null): SeccionReporte[] {
  const acumulado = new Map<ClaveSeccion, BloqueSeccion[]>();
  for (const seccion of SECCIONES) acumulado.set(seccion.clave, []);

  const vacias = (): SeccionReporte[] => SECCIONES.map((seccion) => ({ ...seccion, bloques: [] }));

  if (!detalle) return vacias();

  const entradas: { texto: string; defecto: ClaveSeccion | null }[] = [];
  for (const campo of CAMPOS_CONTENIDO) {
    const contenido = textoDe(detalle.contenido, campo.clave);
    if (contenido) entradas.push({ texto: contenido, defecto: campo.defecto });
  }

  // Sin contenido estructurado: se ofrece el resumen del documento, no un invento.
  if (entradas.length === 0 && detalle.documento.resumen) {
    entradas.push({ texto: detalle.documento.resumen, defecto: 'resumen' });
  }

  for (const entrada of entradas) {
    for (const segmento of segmentar(entrada.texto, entrada.defecto)) {
      if (!segmento.clave || segmento.clave === 'riesgo') continue;
      const destino = acumulado.get(segmento.clave);
      if (!destino) continue;
      destino.push(...aBloques(segmento.lineas));
    }
  }

  return SECCIONES.map((seccion) => ({
    ...seccion,
    bloques: acumulado.get(seccion.clave) ?? [],
  }));
}
