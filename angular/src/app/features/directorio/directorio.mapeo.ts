/**
 * Directorio: contrato de `GET /api/v1/actors` y vocabulario congelado.
 *
 * La API devuelve los campos ya en camelCase y el tipo/función/perfil resueltos
 * por catálogo (`cat_tipos_actor`, `cat_roles_actor`, `cat_perfiles_actor`). Aquí
 * se normaliza la forma y se alinean las etiquetas con la Guía §7.4; la plantilla
 * no conoce variantes ni guiones bajos.
 *
 * El `email` del listado (`core.actores.email_contacto`) NO se mapea: la ficha
 * sólo expone los datos personales por el endpoint auditado `/pii`, y así se
 * evita que un correo de contacto se confunda con la PII protegida.
 */

import { booleano, esRegistro, leer, numero, texto, type Registro } from '../../dominio/mapeo';

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
  region: string | null;
  distrito: string | null;
  organizacionAncla: string | null;
  validado: boolean;
  activo: boolean;
  clasificacion: number;
  perfil: string | null;
};

/** `GET /api/v1/catalogs` reducido a lo que necesita el filtro de tipo. */
export type OpcionCatalogo = {
  valor: string;
  etiqueta: string;
};

export type CatalogosDirectorio = {
  tiposActor: OpcionCatalogo[];
};

/** Datos personales descifrados. Nunca se guardan más allá de la vista abierta. */
export type DatosPersonales = {
  dni: string | null;
  email: string | null;
  telefono: string | null;
  /** `true` cuando la API responde 200 con los tres campos en `null`. */
  vacio: boolean;
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
    region: texto(registro, ['region']),
    distrito: texto(registro, ['distrito']),
    organizacionAncla: texto(registro, ['organizacionAncla', 'organizacion_ancla']),
    validado: booleano(registro, ['validado']),
    activo: booleano(registro, ['activo']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    perfil: texto(registro, ['perfilDescripcion', 'perfil_descripcion']),
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

  return { tiposActor: aOpciones(leer(catalogo, ['tiposActor'])) };
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

  return { dni, email, telefono, vacio: !dni && !email && !telefono };
}
