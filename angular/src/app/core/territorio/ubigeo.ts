/**
 * Normalización y resolución de ubigeo.
 *
 * El catálogo distrital (`core.distritos`) tiene 1 891 filas y quince «Santa
 * Rosa»: comparar territorios por el nombre visible es una trampa. Este módulo
 * fija una única forma de normalizar nombres de región, provincia y distrito y
 * de resolver lo que sí se puede resolver sin adivinar:
 *
 *  · El **código INEI de región** (2 dígitos) a partir de su nombre, con los
 *    alias que usa el Estado («PROV. CONST. DEL CALLAO», «LIMA METROPOLITANA»).
 *  · El **ubigeo de distrito** (6 dígitos) cuando ya viene de la API o de la
 *    lista de territorios; nunca se inventa un código que no esté declarado.
 *  · Una **clave estable** (`region|provincia|distrito` normalizados) para
 *    comparar y transportar una selección sin depender de tildes ni mayúsculas.
 *
 * Regla del proyecto: el dato ausente se declara. Si no hay código, `ubigeo`
 * queda en `null` y `nivel` indica hasta dónde se pudo identificar el
 * territorio. No se completa un ubigeo «plausible».
 */

/** Nivel más específico que se pudo identificar. */
export type NivelUbigeo = 'region' | 'provincia' | 'distrito';

/** Nombres normalizados por nivel (mayúsculas, sin tildes, espacios simples). */
export type NombresNormalizados = {
  region: string | null;
  provincia: string | null;
  distrito: string | null;
};

/** Referencia territorial tal como la entrega un formulario o una fila. */
export type ReferenciaUbigeo = {
  region?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  /** Código INEI de seis dígitos que ya se conoce (no se deduce). */
  ubigeo?: string | null;
};

export type UbigeoResuelto = {
  /** Código INEI de región de dos dígitos, si se reconoció. */
  region: string | null;
  /** Ubigeo de distrito de seis dígitos; `null` si no vino declarado. */
  ubigeo: string | null;
  /** Nivel más específico identificado; `null` si no hay datos usables. */
  nivel: NivelUbigeo | null;
  /** Clave estable para comparar `region|provincia|distrito`. */
  clave: string;
  /** Nombres normalizados, listos para comparar por igualdad. */
  nombres: NombresNormalizados;
};

/** Nombre canónico y código INEI de las 25 regiones del Perú. */
export const REGIONES_UBIGEO: readonly { codigo: string; nombre: string }[] = [
  { codigo: '01', nombre: 'Amazonas' },
  { codigo: '02', nombre: 'Áncash' },
  { codigo: '03', nombre: 'Apurímac' },
  { codigo: '04', nombre: 'Arequipa' },
  { codigo: '05', nombre: 'Ayacucho' },
  { codigo: '06', nombre: 'Cajamarca' },
  { codigo: '07', nombre: 'Callao' },
  { codigo: '08', nombre: 'Cusco' },
  { codigo: '09', nombre: 'Huancavelica' },
  { codigo: '10', nombre: 'Huánuco' },
  { codigo: '11', nombre: 'Ica' },
  { codigo: '12', nombre: 'Junín' },
  { codigo: '13', nombre: 'La Libertad' },
  { codigo: '14', nombre: 'Lambayeque' },
  { codigo: '15', nombre: 'Lima' },
  { codigo: '16', nombre: 'Loreto' },
  { codigo: '17', nombre: 'Madre de Dios' },
  { codigo: '18', nombre: 'Moquegua' },
  { codigo: '19', nombre: 'Pasco' },
  { codigo: '20', nombre: 'Piura' },
  { codigo: '21', nombre: 'Puno' },
  { codigo: '22', nombre: 'San Martín' },
  { codigo: '23', nombre: 'Tacna' },
  { codigo: '24', nombre: 'Tumbes' },
  { codigo: '25', nombre: 'Ucayali' },
];

const CODIGOS_REGION = new Set(REGIONES_UBIGEO.map((region) => region.codigo));

const NOMBRE_POR_CODIGO = new Map<string, string>(
  REGIONES_UBIGEO.map((region) => [region.codigo, region.nombre] as const),
);

/**
 * Alias de nombres que no son el nombre canónico de `core.regiones`.
 *
 * Se resuelven **después** de normalizar; por eso van en mayúsculas y sin
 * tildes. «LIMA METROPOLITANA» es una provincia dentro de Lima, no una región
 * propia: se le asigna el código de Lima para no romper la comparación con el
 * resto del sistema, que trabaja con las 25 regiones.
 */
const ALIAS_REGION: Readonly<Record<string, string>> = {
  'PROVINCIA CONSTITUCIONAL DEL CALLAO': '07',
  'PROV CONST DEL CALLAO': '07',
  CALLAO: '07',
  'LIMA METROPOLITANA': '15',
  'LIMA PROVINCIAS': '15',
};

/** Abreviaturas administrativas frecuentes, expandidas antes de comparar. */
const ABREVIATURAS: readonly (readonly [RegExp, string])[] = [
  [/\bPROV\b/g, 'PROVINCIA'],
  [/\bCONST\b/g, 'CONSTITUCIONAL'],
  [/\bDEPTO\b/g, 'DEPARTAMENTO'],
  [/\bDPTO\b/g, 'DEPARTAMENTO'],
];

/**
 * Normaliza un nombre territorial para compararlo.
 *
 * Mayúsculas, sin tildes ni diéresis, sin signos, espacios colapsados y con las
 * abreviaturas administrativas expandidas. `Áncash`, `ANCASH` y `Ancash` dan la
 * misma clave; `PROV. CONST. DEL CALLAO` se expande a
 * `PROVINCIA CONSTITUCIONAL DEL CALLAO`.
 */
export function normalizarNombreTerritorio(valor: string | null | undefined): string {
  const limpio = (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[.,;()/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let resultado = limpio;
  for (const [patron, reemplazo] of ABREVIATURAS) {
    resultado = resultado.replace(patron, reemplazo);
  }
  return resultado.replace(/\s+/g, ' ').trim();
}

/** Código INEI de región a partir de su nombre (o de un alias). */
export function codigoRegion(nombre: string | null | undefined): string | null {
  const clave = normalizarNombreTerritorio(nombre);
  if (!clave) return null;

  const alias = ALIAS_REGION[clave];
  if (alias) return alias;

  for (const region of REGIONES_UBIGEO) {
    if (normalizarNombreTerritorio(region.nombre) === clave) return region.codigo;
  }
  return null;
}

/** Nombre canónico de una región por su código INEI de dos dígitos. */
export function nombreRegion(codigo: string | null | undefined): string | null {
  const limpio = (codigo ?? '').trim();
  return NOMBRE_POR_CODIGO.get(limpio) ?? null;
}

/**
 * Ubigeo de distrito normalizado: exactamente seis dígitos.
 *
 * No rellena ni recorta: un valor de cinco o siete cifras no es un ubigeo y se
 * declara como ausente. Para comparar sin ambigüedad se prefiere esta forma
 * sobre el texto que teclea la persona.
 */
export function normalizarUbigeo(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').replace(/\s+/g, '');
  return /^\d{6}$/.test(limpio) ? limpio : null;
}

/** Código de región (2 dígitos) que contiene un ubigeo de distrito. */
export function codigoRegionDeUbigeo(ubigeo: string | null | undefined): string | null {
  const normalizado = normalizarUbigeo(ubigeo);
  if (!normalizado) return null;
  const prefijo = normalizado.slice(0, 2);
  return CODIGOS_REGION.has(prefijo) ? prefijo : null;
}

/** Clave estable de comparación para un territorio ya normalizado. */
export function claveTerritorio(
  region: string | null | undefined,
  provincia?: string | null,
  distrito?: string | null,
): string {
  return [
    codigoRegion(region) ?? normalizarNombreTerritorio(region),
    normalizarNombreTerritorio(provincia),
    normalizarNombreTerritorio(distrito),
  ].join('|');
}

function claveDe(resuelto: Omit<UbigeoResuelto, 'clave'>): string {
  const { nombres } = resuelto;
  return [resuelto.region ?? nombres.region ?? '', nombres.provincia, nombres.distrito].join('|');
}

/**
 * Resuelve lo identificable de un territorio.
 *
 * Acepta tres formas, que es lo que piden los formularios reales:
 *
 *  · Un **nombre suelto** (`resolverUbigeo('LIMA')`): si coincide con una región
 *    se trata como región; si no, como nombre de distrito.
 *  · Una **referencia** `{ region, provincia, distrito, ubigeo }`, por ejemplo
 *    la fila del buscador territorial.
 *  · El **trío posicional** `resolverUbigeo('Lima', 'Lima', 'Miraflores')`.
 *
 * Nunca deduce un ubigeo de seis dígitos por nombre: sin el código declarado,
 * `ubigeo` es `null`. La identificación por nombre viaja en `clave`.
 */
export function resolverUbigeo(
  valor: ReferenciaUbigeo | string | null | undefined,
  provincia?: string | null,
  distrito?: string | null,
): UbigeoResuelto {
  const referencia: ReferenciaUbigeo =
    typeof valor === 'string'
      ? { region: valor, provincia: provincia ?? null, distrito: distrito ?? null }
      : {
          ...(valor ?? {}),
          provincia: valor?.provincia ?? provincia,
          distrito: valor?.distrito ?? distrito,
        };

  const ubigeo = normalizarUbigeo(referencia.ubigeo);

  const regionDeclarada = referencia.region?.trim() ?? '';
  const provinciaDeclarada = referencia.provincia?.trim() ?? '';
  const distritoDeclarado = referencia.distrito?.trim() ?? '';

  const nombres: NombresNormalizados = {
    region: normalizarNombreTerritorio(regionDeclarada) || null,
    provincia: normalizarNombreTerritorio(provinciaDeclarada) || null,
    distrito: normalizarNombreTerritorio(distritoDeclarado) || null,
  };

  const region = codigoRegion(regionDeclarada) ?? codigoRegionDeUbigeo(ubigeo);

  // Un nombre suelto que no coincide con una región se interpreta como
  // distrito: es el caso de `resolverUbigeo('Santa Rosa')`. Se mueve al nivel
  // correcto para que la clave no mezcle un «distrito» con la columna región.
  const sueltoComoDistrito =
    !provinciaDeclarada && !distritoDeclarado && !!regionDeclarada && region === null;
  if (sueltoComoDistrito) {
    nombres.region = null;
    nombres.distrito = normalizarNombreTerritorio(regionDeclarada) || null;
  }

  let nivel: NivelUbigeo | null = null;
  if (ubigeo || distritoDeclarado || sueltoComoDistrito) nivel = 'distrito';
  else if (provinciaDeclarada) nivel = 'provincia';
  else if (regionDeclarada) nivel = 'region';

  const base: Omit<UbigeoResuelto, 'clave'> = { region, ubigeo, nivel, nombres };
  return { ...base, clave: claveDe(base) };
}

/** Número de niveles resueltos: sirve para «quedarse con el más específico». */
export function especificidad(resuelto: UbigeoResuelto): number {
  return resuelto.nivel === 'distrito'
    ? 3
    : resuelto.nivel === 'provincia'
      ? 2
      : resuelto.nivel === 'region'
        ? 1
        : 0;
}
