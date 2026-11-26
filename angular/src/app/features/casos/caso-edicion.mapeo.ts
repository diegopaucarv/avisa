import {
  aDetalleCaso,
  esRegistro,
  fechaIso,
  leer,
  lista,
  texto,
  type DetalleCaso,
} from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';

/**
 * Módulo puro de la edición por campo de la ficha del caso (item 18) y de la
 * transición de estado Archivar/Reabrir (item 37).
 *
 * No conoce Angular ni HTTP: construye el cuerpo que admite
 * `PATCH /api/v1/cases/{codigo}`, valida números y fechas, resuelve valores de
 * catálogo y decide la etiqueta de la acción de estado. La plantilla y la página
 * lo consumen; las pruebas lo ejercitan sin TestBed.
 */

/**
 * Fecha de cierre del caso. `Caso` del dominio no la expone porque el listado no
 * la necesita, pero el detalle sí la devuelve (`fechaCierre`) y la ficha la
 * edita. Se añade aquí en lugar de tocar `dominio/`.
 */
export type CasoConCierre = Caso & { cierre: string | null };

/** Detalle del caso con la fecha de cierre normalizada. */
export type DetalleCasoConCierre = Omit<DetalleCaso, 'caso'> & {
  caso: CasoConCierre;
};

/**
 * Mapea `GET /api/v1/cases/{codigo}` y la respuesta del `PATCH` (mismo
 * contrato). Conserva todo el expediente y añade la fecha de cierre que el
 * mapeo genérico descarta.
 */
export function aDetalleCasoConCierre(bruto: unknown): DetalleCasoConCierre {
  const detalle = aDetalleCaso(bruto);
  const registro = esRegistro(bruto) ? bruto : {};
  const casoBruto = leer(registro, ['caso', 'case']);
  const filaCaso = esRegistro(casoBruto) ? casoBruto : {};
  const cierre = fechaIso(texto(filaCaso, ['fechaCierre', 'fecha_cierre', 'cierre']));

  return { ...detalle, caso: { ...detalle.caso, cierre } };
}

/** Campos que la ficha puede editar con `PATCH /api/v1/cases/{codigo}`. */
export type CampoEditable =
  | 'titulo'
  | 'resumenEjecutivo'
  | 'prioridad'
  | 'riesgo'
  | 'nivelConflicto'
  | 'tematica'
  | 'naturaleza'
  | 'subsector'
  | 'unidadResponsable'
  | 'ciclo'
  | 'pctAvance'
  | 'fechaInicio'
  | 'fechaCierre';

/** Catálogos de `/api/v1/catalogs` que alimentan un desplegable. */
export type CatalogoEditable =
  | 'prioridad'
  | 'riesgo'
  | 'nivelConflicto'
  | 'tematica'
  | 'naturaleza'
  | 'subsector'
  | 'unidadResponsable'
  | 'ciclo'
  | 'estado';

/** Control que abre la edición en línea. */
export type TipoControl = 'texto' | 'textoLargo' | 'select' | 'numero' | 'fecha';

export type DefinicionCampo = {
  campo: CampoEditable;
  etiqueta: string;
  control: TipoControl;
  /** Catálogo que puebla el desplegable; ausente en texto, número y fecha. */
  catalogo?: CatalogoEditable;
  /** Un vacío es inválido: la columna de destino es `NOT NULL`. */
  obligatorio?: boolean;
  longitudMaxima?: number;
  /** Término del glosario congelado, cuando el campo tiene uno. */
  glosario?: string;
  /** Comentario asociado al recuadro, en el sentido del item 18. */
  ayuda?: string;
};

/**
 * Orden de los recuadros. Las claves son exactamente las que entiende
 * `updateCase` de `lib/db/repos/cases.ts`.
 *
 * `estado` no figura: se cambia con la acción explícita de Archivar/Reabrir
 * (item 37). `distrito`, `regiones` y `lugares` tampoco: quedan declarados fuera
 * de alcance en un comentario de la ficha.
 */
export const CAMPOS_EDITABLES: readonly DefinicionCampo[] = [
  {
    campo: 'titulo',
    etiqueta: 'Título',
    control: 'texto',
    obligatorio: true,
    longitudMaxima: 255,
    ayuda: 'El código del caso no se edita: lo emitió el sistema.',
  },
  {
    campo: 'resumenEjecutivo',
    etiqueta: 'Resumen ejecutivo',
    control: 'textoLargo',
    longitudMaxima: 20000,
  },
  {
    campo: 'prioridad',
    etiqueta: 'Prioridad de atención',
    control: 'select',
    catalogo: 'prioridad',
    obligatorio: true,
    glosario: 'prioridad-atencion',
    ayuda: 'Prioridad de atención; no es el nivel de riesgo.',
  },
  {
    campo: 'riesgo',
    etiqueta: 'Nivel de riesgo',
    control: 'select',
    catalogo: 'riesgo',
    obligatorio: true,
    glosario: 'nivel-riesgo',
    ayuda: 'Proviene de la matriz del caso; la ficha no lo recalcula.',
  },
  {
    campo: 'nivelConflicto',
    etiqueta: 'Nivel de conflictividad',
    control: 'select',
    catalogo: 'nivelConflicto',
    glosario: 'nivel-conflictividad',
    ayuda:
      'Escala distinta del riesgo: Diferencia, Controversia, Conflicto social o Crisis social.',
  },
  {
    campo: 'tematica',
    etiqueta: 'Temática',
    control: 'select',
    catalogo: 'tematica',
    glosario: 'tematica',
  },
  {
    campo: 'naturaleza',
    etiqueta: 'Naturaleza del caso',
    control: 'select',
    catalogo: 'naturaleza',
    glosario: 'naturaleza-caso',
    ayuda: 'Se declara a mano; no se deriva del alcance.',
  },
  {
    campo: 'subsector',
    etiqueta: 'Subsector',
    control: 'select',
    catalogo: 'subsector',
    obligatorio: true,
    glosario: 'subsector',
  },
  {
    campo: 'unidadResponsable',
    etiqueta: 'Unidad responsable',
    control: 'select',
    catalogo: 'unidadResponsable',
    obligatorio: true,
  },
  {
    campo: 'ciclo',
    etiqueta: 'Componente del ciclo',
    control: 'select',
    catalogo: 'ciclo',
    ayuda: 'Los cinco componentes pueden ocurrir simultáneamente: no son etapas rígidas.',
  },
  {
    campo: 'pctAvance',
    etiqueta: 'Avance (%)',
    control: 'numero',
    ayuda: 'Dato interno de seguimiento; no se presenta como cifra de la cabecera.',
  },
  { campo: 'fechaInicio', etiqueta: 'Inicio', control: 'fecha' },
  { campo: 'fechaCierre', etiqueta: 'Cierre', control: 'fecha' },
];

const POR_CAMPO = new Map<CampoEditable, DefinicionCampo>(
  CAMPOS_EDITABLES.map((definicion) => [definicion.campo, definicion]),
);

export function definicionDe(campo: CampoEditable): DefinicionCampo {
  const definicion = POR_CAMPO.get(campo);
  if (!definicion) throw new Error(`Campo no editable: ${campo}`);
  return definicion;
}

/** Valores del recuadro tal como se editan (siempre cadenas). */
export type ValoresEditables = Record<CampoEditable, string>;

export const VALORES_VACIOS: ValoresEditables = {
  titulo: '',
  resumenEjecutivo: '',
  prioridad: '',
  riesgo: '',
  nivelConflicto: '',
  tematica: '',
  naturaleza: '',
  subsector: '',
  unidadResponsable: '',
  ciclo: '',
  pctAvance: '',
  fechaInicio: '',
  fechaCierre: '',
};

/** Subconjunto del caso que basta para poblar los recuadros editables. */
export type FuenteValores = {
  titulo: string;
  resumen: string | null;
  prioridad: string;
  riesgo: string;
  nivelConflicto: string | null;
  tematica: string | null;
  naturaleza: string | null;
  subsector: string | null;
  unidadResponsable: string | null;
  etapa: string;
  avance: number | null;
  inicio: string | null;
  cierre: string | null;
};

export function valoresDeCaso(fuente: FuenteValores): ValoresEditables {
  return {
    titulo: fuente.titulo ?? '',
    resumenEjecutivo: fuente.resumen ?? '',
    prioridad: fuente.prioridad ?? '',
    riesgo: fuente.riesgo ?? '',
    nivelConflicto: fuente.nivelConflicto ?? '',
    tematica: fuente.tematica ?? '',
    naturaleza: fuente.naturaleza ?? '',
    subsector: fuente.subsector ?? '',
    unidadResponsable: fuente.unidadResponsable ?? '',
    ciclo: fuente.etapa ?? '',
    pctAvance: fuente.avance === null || fuente.avance === undefined ? '' : String(fuente.avance),
    fechaInicio: fuente.inicio ?? '',
    fechaCierre: fuente.cierre ?? '',
  };
}

/** Cuerpo del `PATCH`; sólo viajan las claves que cambiaron. */
export type CuerpoPatchCaso = {
  titulo?: string;
  resumenEjecutivo?: string | null;
  prioridad?: string;
  riesgo?: string;
  nivelConflicto?: string | null;
  tematica?: string | null;
  naturaleza?: string | null;
  subsector?: string;
  unidadResponsable?: string;
  ciclo?: string | null;
  pctAvance?: number | null;
  fechaInicio?: string | null;
  fechaCierre?: string | null;
};

/** Resultado de validar el valor de un recuadro. */
export type ResultadoValidacion =
  | { valido: true; valor: string | number | null }
  | { valido: false; mensaje: string };

const NUMERO_RE = /^\d+(?:[.,]\d+)?$/;
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` que además exista en el calendario (rechaza 2026-02-30). */
export function esFechaValida(valor: string): boolean {
  const coincidencia = FECHA_RE.exec(valor.trim());
  if (!coincidencia) return false;
  const [, anio, mes, dia] = coincidencia;
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
  return fecha.toISOString().slice(0, 10) === `${anio}-${mes}-${dia}`;
}

/**
 * Valida el valor antes de construir el cuerpo. El avance es un número entre 0 y
 * 100; las fechas son `AAAA-MM-DD` reales; un desplegable obligatorio no admite
 * vacío.
 */
export function validarValorCampo(campo: CampoEditable, valor: string): ResultadoValidacion {
  const definicion = definicionDe(campo);
  const limpio = valor.trim();

  if (definicion.control === 'numero') {
    if (!limpio) return { valido: true, valor: null };
    if (!NUMERO_RE.test(limpio)) {
      return { valido: false, mensaje: `${definicion.etiqueta}: use un número entre 0 y 100.` };
    }
    const numero = Number(limpio.replace(',', '.'));
    if (!Number.isFinite(numero) || numero < 0 || numero > 100) {
      return {
        valido: false,
        mensaje: `${definicion.etiqueta}: el valor debe estar entre 0 y 100.`,
      };
    }
    return { valido: true, valor: numero };
  }

  if (definicion.control === 'fecha') {
    if (!limpio) return { valido: true, valor: null };
    if (!esFechaValida(limpio)) {
      return {
        valido: false,
        mensaje: `${definicion.etiqueta}: use una fecha real en formato AAAA-MM-DD.`,
      };
    }
    return { valido: true, valor: limpio };
  }

  if (!limpio) {
    if (definicion.obligatorio) {
      return { valido: false, mensaje: `${definicion.etiqueta} es obligatorio.` };
    }
    return { valido: true, valor: null };
  }

  if (definicion.longitudMaxima !== undefined && limpio.length > definicion.longitudMaxima) {
    return {
      valido: false,
      mensaje: `${definicion.etiqueta}: no puede superar ${definicion.longitudMaxima} caracteres.`,
    };
  }

  return { valido: true, valor: limpio };
}

function asignar(
  cuerpo: CuerpoPatchCaso,
  campo: CampoEditable,
  valor: string | number | null,
): void {
  switch (campo) {
    case 'titulo':
    case 'prioridad':
    case 'riesgo':
    case 'subsector':
    case 'unidadResponsable':
      cuerpo[campo] = typeof valor === 'string' ? valor : '';
      break;
    case 'pctAvance':
      cuerpo.pctAvance = typeof valor === 'number' ? valor : null;
      break;
    case 'resumenEjecutivo':
    case 'nivelConflicto':
    case 'tematica':
    case 'naturaleza':
    case 'ciclo':
    case 'fechaInicio':
    case 'fechaCierre':
      cuerpo[campo] = typeof valor === 'string' ? valor : null;
      break;
  }
}

function comparable(campo: CampoEditable, valor: string): string | number | null {
  const definicion = definicionDe(campo);
  const limpio = valor.trim();
  if (!limpio) return null;
  if (definicion.control === 'numero') {
    const numero = Number(limpio.replace(',', '.'));
    return Number.isFinite(numero) ? numero : limpio;
  }
  return limpio;
}

/**
 * Construye el cuerpo del `PATCH` con los campos que de verdad cambiaron. Un
 * objeto vacío significa «sin cambios» y no debe enviarse.
 */
export function construirCuerpoPatch(
  anteriores: ValoresEditables,
  valores: ValoresEditables,
): CuerpoPatchCaso {
  const cuerpo: CuerpoPatchCaso = {};

  for (const definicion of CAMPOS_EDITABLES) {
    const campo = definicion.campo;
    if (comparable(campo, anteriores[campo]) === comparable(campo, valores[campo])) continue;

    const validado = validarValorCampo(campo, valores[campo]);
    if (!validado.valido) continue;
    asignar(cuerpo, campo, validado.valor);
  }

  return cuerpo;
}

/** Cuerpo para un solo recuadro; vacío si el valor no cambió o no es válido. */
export function cuerpoPatchDeCampo(
  campo: CampoEditable,
  anterior: string,
  nuevo: string,
): CuerpoPatchCaso {
  const validado = validarValorCampo(campo, nuevo);
  if (!validado.valido) return {};
  if (comparable(campo, anterior) === comparable(campo, nuevo)) return {};

  const cuerpo: CuerpoPatchCaso = {};
  asignar(cuerpo, campo, validado.valor);
  return cuerpo;
}

export function sinCambios(cuerpo: CuerpoPatchCaso): boolean {
  return Object.keys(cuerpo).length === 0;
}

export type OpcionCatalogo = { valor: string; etiqueta: string };

export type CatalogosEdicion = Record<CatalogoEditable, readonly OpcionCatalogo[]>;

const CATALOGOS_VACIOS: CatalogosEdicion = {
  prioridad: [],
  riesgo: [],
  nivelConflicto: [],
  tematica: [],
  naturaleza: [],
  subsector: [],
  unidadResponsable: [],
  ciclo: [],
  estado: [],
};

export function catalogoVacio(): CatalogosEdicion {
  return CATALOGOS_VACIOS;
}

function opcionesDeCatalogo(catalogo: Record<string, unknown>, clave: string): OpcionCatalogo[] {
  const opciones: OpcionCatalogo[] = [];
  for (const item of lista(catalogo, [clave])) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['codigo', 'valor', 'nombre']);
    const etiqueta = texto(fila, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }
  return opciones;
}

/**
 * Recorta `GET /api/v1/catalogs` a los desplegables de la ficha. Las claves
 * siguen el contrato de `getCatalogs`.
 */
export function aCatalogosEdicion(bruto: unknown): CatalogosEdicion {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    prioridad: opcionesDeCatalogo(catalogo, 'prioridadesAtencion'),
    riesgo: opcionesDeCatalogo(catalogo, 'nivelesRiesgo'),
    nivelConflicto: opcionesDeCatalogo(catalogo, 'nivelesConflicto'),
    tematica: opcionesDeCatalogo(catalogo, 'tematicas'),
    naturaleza: opcionesDeCatalogo(catalogo, 'naturalezasCaso'),
    subsector: opcionesDeCatalogo(catalogo, 'subsectores'),
    unidadResponsable: opcionesDeCatalogo(catalogo, 'unidades'),
    ciclo: opcionesDeCatalogo(catalogo, 'ciclos'),
    estado: opcionesDeCatalogo(catalogo, 'estadosCaso'),
  };
}

export function opcionesDeCampo(
  catalogos: CatalogosEdicion | null | undefined,
  campo: CampoEditable,
): readonly OpcionCatalogo[] {
  if (!catalogos) return [];
  const definicion = definicionDe(campo);
  return definicion.catalogo ? catalogos[definicion.catalogo] : [];
}

/**
 * Normaliza para comparar: sin tildes, sin mayúsculas y con los guiones bajos
 * del catálogo tratados como espacios. Es la misma idea que
 * `core.normalizar_ref` en la API.
 */
export function normalizarRef(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
}

/**
 * Resuelve un valor de catálogo por código o por etiqueta visible, ignorando
 * acentos y mayúsculas. Devuelve el `valor` canónico (el que valida la API) o
 * `null` si no hay coincidencia.
 */
export function resolverValorCatalogo(
  opciones: readonly OpcionCatalogo[],
  valor: string | null | undefined,
): string | null {
  const buscado = normalizarRef(valor ?? '');
  if (!buscado) return null;
  const encontrado = opciones.find(
    (opcion) =>
      normalizarRef(opcion.valor) === buscado || normalizarRef(opcion.etiqueta) === buscado,
  );
  return encontrado?.valor ?? null;
}

/** Etiqueta visible de un valor; `null` si no está en el catálogo. */
export function etiquetaDeCatalogo(
  opciones: readonly OpcionCatalogo[],
  valor: string | null | undefined,
): string | null {
  const buscado = normalizarRef(valor ?? '');
  if (!buscado) return null;
  const encontrado = opciones.find(
    (opcion) =>
      normalizarRef(opcion.valor) === buscado || normalizarRef(opcion.etiqueta) === buscado,
  );
  return encontrado?.etiqueta ?? null;
}

/**
 * Estados de `core.cat_estados_caso` tras la migración 33. El catálogo tiene
 * exactamente `Abierto`, `Resuelto` y `Archivado`; el código es el valor que
 * acepta el `PATCH`.
 */
export const ESTADO_ABIERTO = 'Abierto';
export const ESTADO_RESUELTO = 'Resuelto';
export const ESTADO_ARCHIVADO = 'Archivado';

/** Etiqueta canónica del estado, tolerante a tildes, mayúsculas y guiones. */
export function etiquetaEstado(estado: string | null | undefined): string {
  const clave = normalizarRef(estado ?? '');
  if (clave === normalizarRef(ESTADO_ARCHIVADO)) return ESTADO_ARCHIVADO;
  if (clave === normalizarRef(ESTADO_RESUELTO)) return ESTADO_RESUELTO;
  return ESTADO_ABIERTO;
}

export function estaArchivado(estado: string | null | undefined): boolean {
  return etiquetaEstado(estado) === ESTADO_ARCHIVADO;
}

export type AccionEstado = {
  modo: 'archivar' | 'reabrir';
  etiqueta: string;
  /** Valor que viaja en `{ estado }`. */
  destino: string;
  ayuda: string;
};

/**
 * Archivar es un estado, no una baja: un caso archivado sigue existiendo y puede
 * reabrirse. Anular es otra operación (papelera) y exige motivo; por eso no se
 * mezclan en esta acción.
 */
export function accionDeEstado(estado: string | null | undefined): AccionEstado {
  if (estaArchivado(estado)) {
    return {
      modo: 'reabrir',
      etiqueta: 'Reabrir caso',
      destino: ESTADO_ABIERTO,
      ayuda:
        'Reabrir devuelve el caso a Abierto. No es una restauración: los casos anulados se recuperan desde el archivo.',
    };
  }

  return {
    modo: 'archivar',
    etiqueta: 'Archivar caso',
    destino: ESTADO_ARCHIVADO,
    ayuda:
      'Archivar es un estado del caso: el expediente sigue disponible y puede reabrirse. Anular lo envía al archivo y exige un motivo.',
  };
}
