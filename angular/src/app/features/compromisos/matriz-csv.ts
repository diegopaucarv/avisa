/**
 * Utilidades puras de la matriz del equipo (formato A..X) para la SPA.
 *
 * Repiten el criterio del endpoint (`app/api/v1/matriz/csv.ts`) sin depender de
 * Angular ni de la red: parsing y generación RFC 4180, normalización de
 * cabeceras y una resolución de filas para el chequeo previo del panel de
 * importación. No sustituyen la validación del servidor: la previsualización
 * definitiva la devuelve `POST /api/v1/matriz/previsualizar`.
 */

/** Una fila del formato del equipo, tal como la entrega `GET /api/v1/matriz`. */
export type MatrizFila = {
  numero: string | null;
  departamento: string | null;
  sectorista: string | null;
  prioridad: string | null;
  nombreCaso: string | null;
  narracion: string | null;
  analisis: string | null;
  actualizacion: string | null;
  riesgoActual: string | null;
  actoresEstado: string | null;
  actoresSociedadCivil: string | null;
  demandas: string | null;
  tematica: string | null;
  accion: string | null;
  mediosVerificacion: string | null;
  areaResponsable: string | null;
  puntoFocal: string | null;
  documentos: string | null;
  hito: string | null;
  descripcionHito: string | null;
  responsableHito: string | null;
  fechaPlanificada: string | null;
  fechaReal: string | null;
  estado: string | null;
  codigoCaso: string | null;
  codigoCompromiso: string | null;
  codigoExcel: string | null;
  bloqueFila: number | null;
};

/** Las 24 columnas del formato del equipo, en su orden. */
export const COLUMNAS_MATRIZ: readonly {
  letra: string;
  clave: keyof MatrizFila;
  etiqueta: string;
}[] = [
  { letra: 'A', clave: 'numero', etiqueta: 'N°' },
  { letra: 'B', clave: 'departamento', etiqueta: 'Departamento' },
  { letra: 'C', clave: 'sectorista', etiqueta: 'Sectorista' },
  { letra: 'D', clave: 'prioridad', etiqueta: 'Prioridad de Atención' },
  { letra: 'E', clave: 'nombreCaso', etiqueta: 'Nombre de Caso' },
  { letra: 'F', clave: 'narracion', etiqueta: 'Narración Cronológica técnica social' },
  { letra: 'G', clave: 'analisis', etiqueta: 'Análisis de Caso' },
  { letra: 'H', clave: 'actualizacion', etiqueta: 'Timestamp de ultima actualización' },
  { letra: 'I', clave: 'riesgoActual', etiqueta: 'Descripción del Riesgo Actual' },
  { letra: 'J', clave: 'actoresEstado', etiqueta: 'Actores del Estado' },
  { letra: 'K', clave: 'actoresSociedadCivil', etiqueta: 'Actores Sociedad Civil' },
  { letra: 'L', clave: 'demandas', etiqueta: 'Demandas' },
  { letra: 'M', clave: 'tematica', etiqueta: 'Temática' },
  { letra: 'N', clave: 'accion', etiqueta: 'Acciones/Compromisos/Acuerdos' },
  { letra: 'O', clave: 'mediosVerificacion', etiqueta: 'Medios de Verificaciones' },
  {
    letra: 'P',
    clave: 'areaResponsable',
    etiqueta: 'Área Responsable de Monitoreo de Acción',
  },
  { letra: 'Q', clave: 'puntoFocal', etiqueta: 'Punto Focal Monitoreo' },
  { letra: 'R', clave: 'documentos', etiqueta: 'Documentos / Archivos / Otros' },
  { letra: 'S', clave: 'hito', etiqueta: 'Hito' },
  { letra: 'T', clave: 'descripcionHito', etiqueta: 'Descripción del Hito' },
  { letra: 'U', clave: 'responsableHito', etiqueta: 'Responsable del Hito' },
  { letra: 'V', clave: 'fechaPlanificada', etiqueta: 'Fecha Planificada' },
  { letra: 'W', clave: 'fechaReal', etiqueta: 'Fecha Real' },
  { letra: 'X', clave: 'estado', etiqueta: 'Estado Actual' },
];

export const CABECERA_MATRIZ: readonly string[] = COLUMNAS_MATRIZ.map(
  (columna) => columna.etiqueta,
);

/** BOM UTF-8: sin él Excel abre el archivo con tildes rotas. */
export const BOM = '\uFEFF';

/** Campos que el chequeo local necesita de cada fila. */
export type CampoCrudo =
  | 'codigoCaso'
  | 'codigoExcel'
  | 'nombreCaso'
  | 'accion'
  | 'hito'
  | 'descripcionHito'
  | 'estado';

/** Una fila ya reducida a los campos que usa la previsualización local. */
export type FilaMatrizCruda = {
  fila: number;
  codigoCaso: string | null;
  codigoExcel: string | null;
  nombreCaso: string | null;
  accion: string | null;
  hito: string | null;
  descripcionHito: string | null;
  estado: string | null;
};

/** Columnas que el Excel fusiona a lo largo del bloque y se arrastran. */
const ARRASTRA: readonly CampoCrudo[] = ['codigoCaso', 'codigoExcel', 'nombreCaso', 'accion'];

/**
 * Cabeceras aceptadas por campo. Se derivan de las etiquetas oficiales y se
 * completan con los nombres cortos que usa la exportación propia.
 */
const ALIAS = new Map<string, keyof MatrizFila>();
for (const columna of COLUMNAS_MATRIZ) {
  ALIAS.set(normalizarCabecera(columna.etiqueta), columna.clave);
}

const ALIAS_EXTRA: readonly [string, keyof MatrizFila][] = [
  ['codigo_caso', 'codigoCaso'],
  ['codigo_avisa', 'codigoCaso'],
  ['codigo_caso_avisa', 'codigoCaso'],
  // «Código de caso» es, en el glosario, el código oficial del Anexo 15. Si
  // el archivo del equipo lo usa para su propio identificador, el resolvedor
  // cae a la equivalencia en lugar de rechazar la fila.
  ['codigo_de_caso', 'codigoCaso'],
  ['codigo_excel', 'codigoExcel'],
  ['codigo_de_caso_excel', 'codigoExcel'],
  ['nro', 'numero'],
  ['num', 'numero'],
  ['prioridad', 'prioridad'],
  ['nombre_caso', 'nombreCaso'],
  ['caso', 'nombreCaso'],
  ['narracion', 'narracion'],
  ['analisis', 'analisis'],
  ['actualizacion', 'actualizacion'],
  ['riesgo_actual', 'riesgoActual'],
  ['accion', 'accion'],
  ['accion_compromiso', 'accion'],
  ['acciones', 'accion'],
  ['compromisos', 'accion'],
  ['descripcion_hito', 'descripcionHito'],
  ['responsable_hito', 'responsableHito'],
  ['estado', 'estado'],
  ['area_responsable', 'areaResponsable'],
  ['punto_focal', 'puntoFocal'],
  ['medios_verificaciones', 'mediosVerificacion'],
  ['documentos_archivos', 'documentos'],
  ['documentos', 'documentos'],
];
for (const [alias, clave] of ALIAS_EXTRA) {
  if (!ALIAS.has(alias)) ALIAS.set(alias, clave);
}

/**
 * Normaliza una cabecera: sin BOM, sin tildes, minúsculas y separadores
 * colapsados a `_`. `N°` se convierte en `n`.
 */
export function normalizarCabecera(valor: string): string {
  return valor
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Escapa una celda según RFC 4180. Nulo o indefinido salen vacíos. */
export function escaparCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'string' ? valor : String(valor);
  if (/[",\r\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Genera un CSV con CRLF y salto final. El BOM lo añade quien responde. */
export function generarCsv(
  cabecera: readonly string[],
  filas: readonly (readonly unknown[])[],
): string {
  const lineas = [cabecera, ...filas].map((fila) => fila.map(escaparCelda).join(','));
  return `${lineas.join('\r\n')}\r\n`;
}

/**
 * Parser CSV sin dependencias. Acepta CRLF, LF y CR; comillas escapadas como
 * `""`; y comas o saltos dentro de un campo entrecomillado. Descarta filas en
 * las que todas las celdas están vacías.
 */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.startsWith(BOM) ? texto.slice(BOM.length) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  let i = 0;

  while (i < limpio.length) {
    const caracter = limpio[i];

    if (entreComillas) {
      if (caracter === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        entreComillas = false;
        i += 1;
        continue;
      }
      campo += caracter;
      i += 1;
      continue;
    }

    if (caracter === '"') {
      entreComillas = true;
      i += 1;
      continue;
    }

    if (caracter === ',') {
      fila.push(campo);
      campo = '';
      i += 1;
      continue;
    }

    if (caracter === '\r' || caracter === '\n') {
      fila.push(campo);
      campo = '';
      filas.push(fila);
      fila = [];
      i += caracter === '\r' && limpio[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    campo += caracter;
    i += 1;
  }

  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas.filter((registro) => registro.some((celda) => celda.trim() !== ''));
}

export type CabeceraLocal = {
  indices: Partial<Record<keyof MatrizFila, number>>;
  reconocidas: number;
  ignoradas: string[];
};

/** Empareja la cabecera con los campos conocidos; la primera aparición gana. */
export function leerCabecera(cabecera: readonly string[]): CabeceraLocal {
  const indices: Partial<Record<keyof MatrizFila, number>> = {};
  const ignoradas: string[] = [];
  let reconocidas = 0;

  cabecera.forEach((rotulo, indice) => {
    const campo = ALIAS.get(normalizarCabecera(rotulo));
    if (!campo) {
      if (rotulo.trim() !== '') ignoradas.push(rotulo.trim());
      return;
    }
    if (indices[campo] === undefined) {
      indices[campo] = indice;
      reconocidas += 1;
    } else {
      ignoradas.push(rotulo.trim());
    }
  });

  return { indices, reconocidas, ignoradas };
}

function celda(celdas: readonly string[], indice: number | undefined): string {
  if (indice === undefined) return '';
  return (celdas[indice] ?? '').trim();
}

/**
 * Reduce los registros a los campos del chequeo local, aplicando el arrastre de
 * las columnas que el Excel fusiona (`codigoCaso`, `codigoExcel`, nombre y
 * acción). `fila` es la posición en el archivo, con la cabecera como 1.
 */
export function construirFilas(
  registros: readonly (readonly string[])[],
  cabecera: CabeceraLocal,
): FilaMatrizCruda[] {
  const acumulado = new Map<CampoCrudo, string>();
  const filas: FilaMatrizCruda[] = [];

  for (let indice = 0; indice < registros.length; indice += 1) {
    const celdas = registros[indice] ?? [];
    const valores: Record<CampoCrudo, string | null> = {
      codigoCaso: null,
      codigoExcel: null,
      nombreCaso: null,
      accion: null,
      hito: celda(celdas, cabecera.indices.hito) || null,
      descripcionHito: celda(celdas, cabecera.indices.descripcionHito) || null,
      estado: celda(celdas, cabecera.indices.estado) || null,
    };

    for (const campo of ARRASTRA) {
      const valor = celda(celdas, cabecera.indices[campo]);
      if (valor !== '') acumulado.set(campo, valor);
      valores[campo] = acumulado.get(campo) ?? null;
    }

    filas.push({ fila: indice + 2, ...valores });
  }

  return filas;
}

/** Normaliza códigos y textos: sin tildes, mayúsculas ni espacios repetidos. */
export function normalizarCodigo(valor: string | null | undefined): string {
  if (!valor) return '';
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type CodigoRechazoLocal =
  | 'SIN_CODIGO'
  | 'SIN_EQUIVALENCIA'
  | 'CASO_INEXISTENTE'
  | 'CAMPO_OBLIGATORIO'
  | 'DUPLICADO';

export type RechazoLocal = {
  fila: number;
  codigo: CodigoRechazoLocal;
  motivo: string;
  codigoExcel: string | null;
  codigoCaso: string | null;
};

export type ResolucionLocal = {
  filasFuente: number;
  reconocidas: number;
  rechazadas: RechazoLocal[];
};

export type OpcionesResolucion = {
  /** Equivalencias Excel → código AVISA, con la clave ya normalizada. */
  mapa?: ReadonlyMap<string, string>;
  /** Códigos de caso que existen en AVISA, normalizados. Si falta, no se comprueba. */
  casos?: ReadonlySet<string>;
};

/**
 * Chequeo local, sin red, de qué filas se pueden resolver.
 *
 * Replica el orden del servidor para dar respuesta inmediata en el panel; el
 * plan definitivo (crear/actualizar y rechazos con detalle) lo emite
 * `POST /api/v1/matriz/previsualizar`.
 */
export function resolverFilas(
  filas: readonly FilaMatrizCruda[],
  opciones: OpcionesResolucion = {},
): ResolucionLocal {
  const mapa = opciones.mapa;
  const casos = opciones.casos;
  const rechazadas: RechazoLocal[] = [];
  const vistos = new Map<string, number>();
  let reconocidas = 0;

  for (const fila of filas) {
    const codigoExcel = fila.codigoExcel?.trim() || null;
    const explicito = fila.codigoCaso?.trim() || null;

    let codigoCaso = explicito;
    if (codigoCaso && casos && !casos.has(normalizarCodigo(codigoCaso))) {
      // El rótulo pudo traer el identificador propio del equipo: se intenta la
      // equivalencia antes de rechazar por caso inexistente.
      const mapeado = codigoExcel ? mapa?.get(normalizarCodigo(codigoExcel)) : undefined;
      if (mapeado) codigoCaso = mapeado;
    }
    if (!codigoCaso) {
      if (!codigoExcel) {
        rechazadas.push({
          fila: fila.fila,
          codigo: 'SIN_CODIGO',
          motivo: 'La fila no trae código AVISA ni código Excel.',
          codigoExcel: null,
          codigoCaso: null,
        });
        continue;
      }
      const mapeado = mapa?.get(normalizarCodigo(codigoExcel));
      if (!mapeado) {
        rechazadas.push({
          fila: fila.fila,
          codigo: 'SIN_EQUIVALENCIA',
          motivo:
            'El código Excel no tiene equivalencia en el mapa; añada la equivalencia antes de importar.',
          codigoExcel,
          codigoCaso: null,
        });
        continue;
      }
      codigoCaso = mapeado;
    }

    if (casos && !casos.has(normalizarCodigo(codigoCaso))) {
      rechazadas.push({
        fila: fila.fila,
        codigo: 'CASO_INEXISTENTE',
        motivo: `El caso «${codigoCaso}» no existe en AVISA.`,
        codigoExcel,
        codigoCaso,
      });
      continue;
    }

    const accion = fila.accion?.trim() || '';
    if (!accion) {
      rechazadas.push({
        fila: fila.fila,
        codigo: 'CAMPO_OBLIGATORIO',
        motivo: 'Falta la acción/compromiso (columna N).',
        codigoExcel,
        codigoCaso,
      });
      continue;
    }

    const descripcionHito = fila.descripcionHito?.trim() || null;
    const hito = fila.hito?.trim() || null;
    if (descripcionHito && !hito) {
      rechazadas.push({
        fila: fila.fila,
        codigo: 'CAMPO_OBLIGATORIO',
        motivo: 'La descripción del hito (columna T) no trae la etiqueta del hito (columna S).',
        codigoExcel,
        codigoCaso,
      });
      continue;
    }

    const clave = [
      normalizarCodigo(codigoCaso),
      normalizarCodigo(accion),
      normalizarCodigo(hito),
      normalizarCodigo(descripcionHito),
    ].join('|');
    const repetida = vistos.get(clave);
    if (repetida !== undefined) {
      rechazadas.push({
        fila: fila.fila,
        codigo: 'DUPLICADO',
        motivo: `Fila duplicada: repite el bloque de la fila ${repetida}.`,
        codigoExcel,
        codigoCaso,
      });
      continue;
    }
    vistos.set(clave, fila.fila);
    reconocidas += 1;
  }

  return { filasFuente: filas.length, reconocidas, rechazadas };
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function textoDe(registro: Record<string, unknown>, clave: string): string | null {
  const valor = registro[clave];
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** Fila del JSON de `/api/v1/matriz` → tipo de la tabla. */
export function aMatrizFila(bruto: unknown): MatrizFila {
  const fila = esRegistro(bruto) ? bruto : {};
  return {
    numero: textoDe(fila, 'numero'),
    departamento: textoDe(fila, 'departamento'),
    sectorista: textoDe(fila, 'sectorista'),
    prioridad: textoDe(fila, 'prioridad'),
    nombreCaso: textoDe(fila, 'nombreCaso'),
    narracion: textoDe(fila, 'narracion'),
    analisis: textoDe(fila, 'analisis'),
    actualizacion: textoDe(fila, 'actualizacion'),
    riesgoActual: textoDe(fila, 'riesgoActual'),
    actoresEstado: textoDe(fila, 'actoresEstado'),
    actoresSociedadCivil: textoDe(fila, 'actoresSociedadCivil'),
    demandas: textoDe(fila, 'demandas'),
    tematica: textoDe(fila, 'tematica'),
    accion: textoDe(fila, 'accion'),
    mediosVerificacion: textoDe(fila, 'mediosVerificacion'),
    areaResponsable: textoDe(fila, 'areaResponsable'),
    puntoFocal: textoDe(fila, 'puntoFocal'),
    documentos: textoDe(fila, 'documentos'),
    hito: textoDe(fila, 'hito'),
    descripcionHito: textoDe(fila, 'descripcionHito'),
    responsableHito: textoDe(fila, 'responsableHito'),
    fechaPlanificada: textoDe(fila, 'fechaPlanificada'),
    fechaReal: textoDe(fila, 'fechaReal'),
    estado: textoDe(fila, 'estado'),
    codigoCaso: textoDe(fila, 'codigoCaso'),
    codigoCompromiso: textoDe(fila, 'codigoCompromiso'),
    codigoExcel: textoDe(fila, 'codigoExcel'),
    bloqueFila:
      typeof fila['bloqueFila'] === 'number' && Number.isFinite(fila['bloqueFila'])
        ? fila['bloqueFila']
        : null,
  };
}

/** Una fila del plan de `POST /api/v1/matriz/previsualizar`. */
export type FilaPlan = {
  fila: number;
  codigoCaso: string;
  nombreCaso: string | null;
  codigoExcel: string | null;
  accion: string;
  hito: string | null;
  descripcionHito: string | null;
  estado: string | null;
  accionPlan: 'crear' | 'actualizar';
  hitoNuevo: boolean;
};

/** Un rechazo del plan, con el mismo código que usa el servidor. */
export type RechazoPlan = {
  fila: number;
  motivo: string;
  codigo: CodigoRechazoLocal;
  codigoExcel: string | null;
  codigoCaso: string | null;
  detalle: string | null;
};

export type PlanPrevisualizacion = {
  escritura: false;
  mensaje: string;
  resumen: {
    filasFuente: number;
    reconocidas: number;
    rechazadas: number;
    aCrear: number;
    aActualizar: number;
  };
  crear: FilaPlan[];
  actualizar: FilaPlan[];
  rechazadas: RechazoPlan[];
  columnasReconocidas: Record<string, string>;
  columnasIgnoradas: string[];
};
