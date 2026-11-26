/**
 * Descriptor único por entidad del dominio.
 *
 * Cada listado, chip y aviso repite el nombre, el plural, el icono y el color
 * de una entidad. Repetirlo invita a que «actores» se escriba con dos colores
 * distintos o que una sugerencia aparezca como «Sugerencia» en una pantalla y
 * «Sugerencias» en otra. Este mapa es la fuente única de esa presentación.
 *
 * Reglas que respeta:
 *  · Vocabulario del brief: **Auditorios** (no «locales»), **organizaciones**
 *    (las antiguas «instituciones»).
 *  · `colorToken` es el nombre de una variable CSS ya existente en
 *    `styles/global.css`; no se inventan colores por entidad.
 *  · `rutaBase` sólo apunta a rutas reales de `app.routes.ts`. Cuando una
 *    entidad todavía no tiene pantalla, es `null` en vez de una ruta supuesta.
 *  · `describir()` nunca lanza: un tipo desconocido (o vacío) devuelve un
 *    descriptor genérico y `conocido: false` para que quien lo use pueda
 *    declararlo en vez de romper.
 */

export type TipoEntidad =
  | 'caso'
  | 'demanda'
  | 'alerta'
  | 'compromiso'
  | 'documento'
  | 'actor'
  | 'organizacion'
  | 'auditorio'
  | 'reunion'
  | 'reporte'
  | 'sugerencia'
  | 'escenario';

export type DescriptorEntidad = {
  /** Tipo canónico del dominio. */
  tipo: TipoEntidad;
  /** Nombre en singular, en minúscula y con tildes: «reunión». */
  singular: string;
  /** Nombre en plural, en minúscula y con tildes: «reuniones». */
  plural: string;
  /** Artículo definido que le corresponde: «el», «la», «los», «las». */
  articulo: string;
  /** Nombre de un icono de `app-icono` (ver `shared/ui/icono.component.ts`). */
  icono: string;
  /** Ruta base en la SPA, o `null` si la entidad aún no tiene pantalla. */
  rutaBase: string | null;
  /** Token de color CSS, por ejemplo `--blue`. */
  colorToken: string;
};

export type DescriptorDesconocido = Omit<DescriptorEntidad, 'tipo'> & {
  /** Tipo tal como llegó, normalizado a minúsculas. */
  tipo: string;
  conocido: false;
};

/** Descriptor conocido o, si el tipo no está declarado, uno genérico. */
export type DescripcionEntidad = DescriptorEntidad | DescriptorDesconocido;

const DESCRIPTORES: readonly DescriptorEntidad[] = [
  {
    tipo: 'caso',
    singular: 'caso',
    plural: 'casos',
    articulo: 'el',
    icono: 'casos',
    rutaBase: '/casos',
    colorToken: '--blue',
  },
  {
    tipo: 'demanda',
    singular: 'demanda',
    plural: 'demandas',
    articulo: 'la',
    icono: 'bandeja',
    rutaBase: '/casos/sin-caso',
    colorToken: '--amber',
  },
  {
    tipo: 'alerta',
    singular: 'alerta',
    plural: 'alertas',
    articulo: 'la',
    icono: 'alertas',
    rutaBase: '/alertas',
    colorToken: '--red',
  },
  {
    tipo: 'compromiso',
    singular: 'compromiso',
    plural: 'compromisos',
    articulo: 'el',
    icono: 'compromisos',
    rutaBase: '/compromisos',
    colorToken: '--green',
  },
  {
    tipo: 'documento',
    singular: 'documento',
    plural: 'documentos',
    articulo: 'el',
    icono: 'documentos',
    rutaBase: '/documentos',
    colorToken: '--teal',
  },
  {
    tipo: 'actor',
    singular: 'actor',
    plural: 'actores',
    articulo: 'el',
    icono: 'actores',
    rutaBase: '/directorio/actores',
    colorToken: '--blue',
  },
  {
    tipo: 'organizacion',
    singular: 'organización',
    plural: 'organizaciones',
    articulo: 'la',
    icono: 'organizaciones',
    rutaBase: '/directorio/organizaciones',
    colorToken: '--teal',
  },
  {
    tipo: 'auditorio',
    singular: 'auditorio',
    plural: 'auditorios',
    articulo: 'el',
    icono: 'pin',
    rutaBase: '/directorio/locales',
    colorToken: '--amber',
  },
  {
    tipo: 'reunion',
    singular: 'reunión',
    plural: 'reuniones',
    articulo: 'la',
    icono: 'reloj',
    rutaBase: '/reuniones',
    colorToken: '--blue-dark',
  },
  {
    tipo: 'reporte',
    singular: 'reporte',
    plural: 'reportes',
    articulo: 'el',
    icono: 'analisis',
    rutaBase: '/reportes',
    colorToken: '--teal',
  },
  {
    tipo: 'sugerencia',
    singular: 'sugerencia',
    plural: 'sugerencias',
    articulo: 'la',
    icono: 'info',
    // La pantalla existe (`features/gobierno-sugerencias`) pero todavía no está
    // en `app.routes.ts`: se declara el hueco en vez de suponer una URL.
    rutaBase: null,
    colorToken: '--amber',
  },
  {
    tipo: 'escenario',
    singular: 'escenario',
    plural: 'escenarios',
    articulo: 'el',
    icono: 'ajustes',
    // Sin pantalla propia todavía.
    rutaBase: null,
    colorToken: '--muted',
  },
];

/** Alias aceptados además del singular y el plural canónicos. */
const ALIAS: Readonly<Record<string, TipoEntidad>> = {
  locales: 'auditorio',
  local: 'auditorio',
  instituciones: 'organizacion',
  institucion: 'organizacion',
  personas: 'actor',
  persona: 'actor',
  demandas_sin_caso: 'demanda',
  'demandas sin caso': 'demanda',
  organizaciones: 'organizacion',
  reuniones: 'reunion',
};

/** Clave de comparación: minúsculas, sin tildes y con espacios simples. */
function clave(tipo: string | null | undefined): string {
  return (tipo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDICE = new Map<string, DescriptorEntidad>();
for (const descriptor of DESCRIPTORES) {
  INDICE.set(clave(descriptor.tipo), descriptor);
  INDICE.set(clave(descriptor.singular), descriptor);
  INDICE.set(clave(descriptor.plural), descriptor);
}
for (const [alias, tipo] of Object.entries(ALIAS)) {
  const destino = DESCRIPTORES.find((descriptor) => descriptor.tipo === tipo);
  if (destino) INDICE.set(clave(alias), destino);
}

const GENERICO = (tipo: string): DescriptorDesconocido => ({
  tipo,
  singular: tipo || 'elemento',
  plural: tipo ? `${tipo}s` : 'elementos',
  articulo: 'el',
  icono: 'punto',
  rutaBase: null,
  colorToken: '--muted',
  conocido: false,
});

/**
 * Descriptor de una entidad, tolerante a tipos desconocidos.
 *
 * Acepta singular o plural, mayúsculas, tildes y separadores (`organización`,
 * `ORGANIZACIONES`, `demandas-sin-caso`). Un valor vacío o desconocido no
 * rompe la pantalla: devuelve un descriptor genérico con `conocido: false`.
 */
export function describir(tipo: string | null | undefined): DescripcionEntidad {
  const normalizado = clave(tipo);
  const encontrado = INDICE.get(normalizado);
  if (encontrado) return encontrado;

  return GENERICO(normalizado.replace(/\s+/g, '_'));
}

/** `true` si el tipo tiene descriptor declarado (alias incluidos). */
export function esTipoEntidad(tipo: string | null | undefined): boolean {
  return INDICE.has(clave(tipo));
}

/** Tipos con descriptor declarado, en el orden del mapa. */
export function tiposEntidad(): readonly TipoEntidad[] {
  return DESCRIPTORES.map((descriptor) => descriptor.tipo);
}
