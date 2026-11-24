/**
 * Directorio: contrato de `GET /api/v1/actors` y vocabulario congelado.
 *
 * La API devuelve los campos ya en camelCase y el tipo/función/perfil resueltos
 * por catálogo (`cat_tipos_actor`, `cat_roles_actor`, `cat_perfiles_actor`). Aquí
 * se normaliza la forma y se alinean las etiquetas con la Guía §7.4; la plantilla
 * no conoce variantes ni guiones bajos.
 *
 * El `email` del listado (`core.actores.email_contacto`) se mapea como dato de
 * contacto de la tabla. No es la PII auditada: el DNI y el teléfono sólo salen
 * por el endpoint `/pii`, y el correo de contacto se distingue del correo
 * personal de esa ficha. El listado no devuelve teléfono, así que la columna
 * correspondiente queda vacía hasta que la ficha pide la PII con motivo.
 */

import {
  booleano,
  esRegistro,
  fechaIso,
  leer,
  numero,
  texto,
  type Registro,
} from '../../dominio/mapeo';
import { formatearFechaCompacta } from '../../shared/formato-fecha';

/** `core.cat_tipos_actor.nombre`. Los tres valores del catálogo, congelados. */
export const TIPO_ACTOR_PUBLICO = 'Actor público';

export const TIPOS_ACTOR = ['Actor público', 'Actor social', 'Actor privado'] as const;

/** `core.cat_roles_actor.nombre` según la Guía §7.4.2. */
export const FUNCIONES_ACTOR = [
  'Principal',
  'Secundario',
  'Tercero imparcial',
  'No determinado',
] as const;

/** `core.cat_perfiles_actor.nombre` según la Guía §8.2.4. */
export const POSICIONAMIENTOS_ACTOR = ['Dialogante', 'Legitimante', 'Conflictivo'] as const;

/**
 * `core.actores.naturaleza`. No es un catálogo: la base usa estos dos códigos.
 * Las etiquetas son la única traducción de este archivo.
 */
export const NATURALEZAS = [
  { valor: 'persona', etiqueta: 'Persona' },
  { valor: 'organizacion', etiqueta: 'Organización' },
] as const;

export type ActorDirectorio = {
  id: string;
  nombre: string;
  abreviatura: string | null;
  /** Etiqueta legible: `Persona`, `Organización` o el valor crudo si no se reconoce. */
  naturaleza: string;
  /** `Actor público` · `Actor social` · `Actor privado`. */
  tipo: string | null;
  /** `Principal` · `Secundario` · `Tercero imparcial` · `No determinado`. */
  funcion: string | null;
  /** `Dialogante` · `Legitimante` · `Conflictivo`. */
  posicionamiento: string | null;
  cargo: string | null;
  nivelGobierno: string | null;
  categoria: string | null;
  /** Correo de contacto del listado (`email_contacto`); no es la PII auditada. */
  email?: string | null;
  /** Teléfono de contacto si el listado lo trae; suele llegar sólo por `/pii`. */
  telefono?: string | null;
  region: string | null;
  distrito: string | null;
  organizacionAncla: string | null;
  validado: boolean;
  activo: boolean;
  clasificacion: number;
  perfil: string | null;
  /**
   * `core.cat_nivel_identificacion.codigo` (`IDENTIFICADO_DNI`, `SEUDONIMO`…).
   * Opcional para no romper los literales de los specs del directorio.
   */
  nivelIdentificacion?: string | null;
  /** Sólo organizaciones: OSPA capturada, no validada contra padrón. */
  expedienteOspa?: string | null;
  estadoOspa?: string | null;
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  /** RUC de la organización (`core.organizaciones.ruc`), no PII. */
  ruc?: string | null;
};

/** `GET /api/v1/catalogs` reducido a lo que necesita el filtro de tipo. */
export type OpcionCatalogo = {
  valor: string;
  etiqueta: string;
};

export type CatalogosDirectorio = {
  tiposActor: OpcionCatalogo[];
  regiones: OpcionCatalogo[];
  /** `core.cat_roles_actor` (Principal, Secundario…). */
  funcionesActor: OpcionCatalogo[];
  /** `core.cat_perfiles_actor` (Dialogante, Legitimante…). */
  perfilesActor: OpcionCatalogo[];
};

/** Datos personales descifrados. Nunca se guardan más allá de la vista abierta. */
export type DatosPersonales = {
  dni: string | null;
  email: string | null;
  telefono: string | null;
  /** `true` cuando la API responde 200 con los tres campos en `null`. */
  vacio: boolean;
  /**
   * `true` cuando el actor tiene fila en `core.actor_datos_personales`. Es lo
   * que separa «sin dato» (la fila existe pero el campo está vacío) de «no hay
   * ficha de datos personales» (el actor nunca registró PII).
   */
  tieneFicha: boolean;
};

/** Sin acentos, sin mayúsculas y con espacios colapsados, para comparar etiquetas. */
function claveDe(valor: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * Resuelve una etiqueta congelada por coincidencia tolerante. Si el valor no está
 * en el vocabulario se devuelve tal cual llega: inventar una etiqueta sería
 * afirmar algo que la base no dice.
 */
function etiquetaDe(valor: string | null, permitidos: readonly string[]): string | null {
  if (!valor) return null;
  const clave = claveDe(valor);
  const encontrado = permitidos.find((opcion) => claveDe(opcion) === clave);
  return encontrado ?? valor.trim();
}

export function naturalezaDe(valor: string | null): string {
  const clave = claveDe(valor);
  const opcion = NATURALEZAS.find((naturaleza) => naturaleza.valor === clave);
  if (opcion) return opcion.etiqueta;
  return valor?.trim() || 'Sin determinar';
}

/** `replace(nivel_gobierno, '_', ' ')` ya viene aplicado; se normaliza por si acaso. */
export function nivelGobiernoDe(valor: string | null): string | null {
  const limpio = (valor ?? '').replace(/_/g, ' ').trim();
  return limpio || null;
}

/** Registro de `GET /api/v1/actors` → dominio del directorio. */
export function aActorDirectorio(bruto: unknown): ActorDirectorio {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id', 'uid']) ?? '',
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    abreviatura: texto(registro, ['abreviatura']),
    naturaleza: naturalezaDe(texto(registro, ['naturaleza'])),
    tipo: etiquetaDe(texto(registro, ['tipo']), TIPOS_ACTOR),
    funcion: etiquetaDe(texto(registro, ['funcion']), FUNCIONES_ACTOR),
    posicionamiento: etiquetaDe(texto(registro, ['posicionamiento']), POSICIONAMIENTOS_ACTOR),
    cargo: texto(registro, ['cargo']),
    nivelGobierno: nivelGobiernoDe(texto(registro, ['nivelGobierno', 'nivel_gobierno'])),
    categoria: texto(registro, ['categoria']),
    email: texto(registro, ['email', 'emailContacto', 'email_contacto']),
    telefono: texto(registro, ['telefono', 'telefonoContacto', 'telefono_contacto']),
    region: texto(registro, ['region']),
    distrito: texto(registro, ['distrito']),
    organizacionAncla: texto(registro, ['organizacionAncla', 'organizacion_ancla']),
    validado: booleano(registro, ['validado']),
    activo: booleano(registro, ['activo']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    perfil: texto(registro, ['perfilDescripcion', 'perfil_descripcion']),
    nivelIdentificacion: texto(registro, ['nivelIdentificacion', 'nivel_identificacion']),
    expedienteOspa: texto(registro, ['expedienteOspa', 'expediente_ospa']),
    estadoOspa: texto(registro, ['estadoOspa', 'estado_ospa']),
    vigenciaDesde: fechaIso(texto(registro, ['vigenciaDesde', 'vigencia_desde'])),
    vigenciaHasta: fechaIso(texto(registro, ['vigenciaHasta', 'vigencia_hasta'])),
    ruc: texto(registro, ['ruc']),
  };
}

function aOpciones(bruto: unknown): OpcionCatalogo[] {
  if (!Array.isArray(bruto)) return [];

  const opciones: OpcionCatalogo[] = [];
  for (const item of bruto) {
    const registro: Registro = esRegistro(item) ? item : {};
    const valor = texto(registro, ['codigo', 'valor', 'nombre']);
    const etiqueta = texto(registro, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }
  return opciones;
}

/**
 * `GET /api/v1/catalogs` → sólo los tipos de actor.
 *
 * El filtro de la API compara `cat_tipos_actor.nombre`, y el catálogo devuelve
 * `codigo === etiqueta === nombre`, así que se puede usar cualquiera de los dos.
 */
export function aCatalogosDirectorio(bruto: unknown): CatalogosDirectorio {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    tiposActor: aOpciones(leer(catalogo, ['tiposActor'])),
    regiones: aOpciones(leer(catalogo, ['regiones'])),
    funcionesActor: aOpciones(leer(catalogo, ['rolesActor', 'funcionesActor'])),
    perfilesActor: aOpciones(leer(catalogo, ['perfilesActor', 'posicionamientosActor'])),
  };
}

/** Un DNI o teléfono puede llegar como texto; se acepta número por si acaso. */
function datoPii(registro: Registro, claves: readonly string[]): string | null {
  const valor = leer(registro, claves);
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

/**
 * `GET /api/v1/actors/:uid/pii` → `{pii: {dni, email, telefono}, generatedAt}`.
 *
 * Un 200 con los tres campos en `null` significa que el actor no tiene ficha de
 * datos personales; no es un error.
 */
export function aDatosPersonales(bruto: unknown): DatosPersonales {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['pii']);
  const pii = esRegistro(crudo) ? crudo : {};

  const dni = datoPii(pii, ['dni']);
  const email = datoPii(pii, ['email']);
  const telefono = datoPii(pii, ['telefono']);
  const vacio = !dni && !email && !telefono;

  const fichaCruda = leer(registro, ['tieneFicha', 'tiene_ficha']);
  const tieneFicha = typeof fichaCruda === 'boolean' ? fichaCruda : !vacio;

  return { dni, email, telefono, vacio, tieneFicha };
}

/* ------------------------------------------------------------------ */
/* Identificación, formato del dato ausente y validación de formulario */
/* ------------------------------------------------------------------ */

/** Texto que se muestra cuando el actor no declara un dato. Nunca es un error. */
export const SIN_DATO = 'sin dato';

/** Máscara de un DNI que no se puede revelar sin autorización PII. */
export const MASCARA_DNI = '•••• ••••';

/** Máscara de un correo que no se descifra (por ejemplo, al comparar una fusión). */
export const MASCARA_CORREO = '•••••••@••••••';

/** `core.cat_nivel_identificacion`: de DNI a colectivo anónimo. */
export const NIVELES_IDENTIFICACION = [
  { valor: 'IDENTIFICADO_DNI', etiqueta: 'Identificado con DNI' },
  { valor: 'IDENTIFICADO_OTRO_DOC', etiqueta: 'Identificado con otro documento' },
  { valor: 'IDENTIFICADO_SIN_DOC', etiqueta: 'Identificado sin documento' },
  { valor: 'SEUDONIMO', etiqueta: 'Seudónimo' },
  { valor: 'COLECTIVO_ANONIMO', etiqueta: 'Colectivo anónimo' },
] as const;

/** Código de identificación → etiqueta legible; el desconocido se muestra crudo. */
export function nivelIdentificacionDe(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim();
  if (!limpio) return null;
  const clave = claveDe(limpio).replace(/\s+/g, '_');
  const encontrado = NIVELES_IDENTIFICACION.find((nivel) => claveDe(nivel.valor) === clave);
  return encontrado?.etiqueta ?? limpio;
}

/** ISO o `dd/mm/aaaa` → `05NOV2026`; un valor no reconocible se declara hueco. */
export function formatearFechaActor(valor: string | null | undefined): string | null {
  const iso = fechaIso(valor);
  if (!iso) return null;
  return formatearFechaCompacta(iso);
}

/** Error del DNI, o `null` si es válido. Exige exactamente 8 dígitos. */
export function errorDeDni(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return 'Ingrese el DNI de 8 dígitos.';
  return /^\d{8}$/.test(limpio) ? null : 'El DNI debe tener exactamente 8 dígitos.';
}

/** Error del RUC, o `null` si es válido. Exige exactamente 11 dígitos. */
export function errorDeRuc(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return 'Ingrese el RUC de 11 dígitos.';
  return /^\d{11}$/.test(limpio) ? null : 'El RUC debe tener exactamente 11 dígitos.';
}

/** El correo es opcional: vacío es válido. */
export function errorDeCorreo(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio) ? null : 'El correo no tiene un formato válido.';
}

/** El teléfono es opcional: vacío es válido. */
export function errorDeTelefono(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  return /^[0-9+()\s.-]{6,50}$/.test(limpio)
    ? null
    : 'El teléfono sólo admite números y los signos + ( ) . -.';
}

/**
 * El expediente OSPA es texto libre en `core.organizaciones.expediente_ospa`
 * (sin `check` de formato). Se acota a 50 caracteres y a un alfabeto seguro.
 */
export function errorDeExpedienteOspa(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  return /^[A-Za-z0-9._/-]{2,50}$/.test(limpio)
    ? null
    : 'El expediente OSPA admite letras, números y . _ / - (2 a 50 caracteres).';
}
