/**
 * Catálogo de importaciones y su «ruteo».
 *
 * Cada tipo declara a qué vista pertenece (`grupo`), con qué columnas se
 * reconoce un archivo y qué hace la aplicación cuando el usuario confirma:
 *
 * - `api`: crea registros con los endpoints de alta que ya existen.
 * - `padron`: no escribe en la base; produce un documento (lista de asistencia).
 * - `delegar`: el trabajo vive en una vista concreta y aquí sólo se enruta.
 *
 * Añadir un tipo de importación es añadir una entrada aquí (y, si es `api`, un
 * caso en `importacion.validar.ts`). Ni el panel ni el servicio conocen tipos
 * concretos.
 */

export type GrupoImportacion = 'Casos' | 'Directorio' | 'Asistencia' | 'Matriz';

export type TipoImportacionId =
  | 'casos'
  | 'casos-demandas'
  | 'actores-personas'
  | 'actores-organizaciones'
  | 'actores-instituciones'
  | 'asistencia'
  | 'matriz';

export type EstrategiaImportacion = 'api' | 'padron' | 'delegar';

export type ColumnaImportacion = {
  /** Clave interna; es también el nombre del campo del payload cuando aplica. */
  readonly clave: string;
  readonly rotulo: string;
  /** Nombres aceptados en la cabecera (sin tildes ni mayúsculas). */
  readonly alias: readonly string[];
  readonly obligatoria?: boolean;
  /** Se muestra en la ayuda del panel y en el mensaje de una columna faltante. */
  readonly ayuda?: string;
};

export type TipoImportacion = {
  readonly id: TipoImportacionId;
  readonly etiqueta: string;
  readonly grupo: GrupoImportacion;
  readonly descripcion: string;
  /** Vista donde vive el dato importado. */
  readonly destino: string;
  readonly estrategia: EstrategiaImportacion;
  readonly columnas: readonly ColumnaImportacion[];
  /** Advertencia fija que el panel muestra siempre. */
  readonly nota?: string;
};

/** Columnas comunes al alta de casos: sólo título y región son obligatorias. */
const COLUMNAS_CASO: readonly ColumnaImportacion[] = [
  {
    clave: 'titulo',
    rotulo: 'Título del caso',
    alias: ['titulo', 'titulo del caso', 'nombre', 'nombre del caso', 'caso'],
    obligatoria: true,
    ayuda: 'Texto que encabeza la ficha.',
  },
  {
    clave: 'region',
    rotulo: 'Región',
    alias: ['region', 'regiones', 'region principal'],
    obligatoria: true,
    ayuda: 'Varias regiones separadas por «;».',
  },
  {
    clave: 'tematica',
    rotulo: 'Temática',
    alias: ['tematica', 'tema'],
  },
  {
    clave: 'subsector',
    rotulo: 'Subsector',
    alias: ['subsector'],
  },
  {
    clave: 'naturaleza',
    rotulo: 'Naturaleza',
    alias: ['naturaleza'],
  },
  {
    clave: 'riesgo',
    rotulo: 'Nivel de riesgo',
    alias: ['riesgo', 'nivel de riesgo', 'nivel riesgo'],
  },
  {
    clave: 'conflictividad',
    rotulo: 'Nivel de conflictividad',
    alias: ['conflictividad', 'nivel de conflictividad', 'nivel conflicto', 'conflicto'],
  },
  {
    clave: 'unidad',
    rotulo: 'Unidad responsable',
    alias: ['unidad responsable', 'unidad', 'unidad organica'],
  },
  {
    clave: 'prioridad',
    rotulo: 'Prioridad',
    alias: ['prioridad', 'prioridad de atencion'],
  },
  {
    clave: 'fechaInicio',
    rotulo: 'Fecha de inicio',
    alias: ['fecha de inicio', 'inicio', 'fecha inicio'],
    ayuda: 'AAAA-MM-DD o DD/MM/AAAA.',
  },
  {
    clave: 'resumen',
    rotulo: 'Resumen',
    alias: ['resumen', 'resumen ejecutivo', 'descripcion', 'detalle'],
  },
];

const COLUMNAS_ACTOR: readonly ColumnaImportacion[] = [
  {
    clave: 'nombre',
    rotulo: 'Nombre',
    alias: ['nombre', 'nombre completo', 'razon social', 'actor', 'organizacion'],
    obligatoria: true,
  },
  { clave: 'cargo', rotulo: 'Cargo', alias: ['cargo', 'cargo o funcion'] },
  { clave: 'tipo', rotulo: 'Tipo', alias: ['tipo', 'tipo de actor'] },
  {
    clave: 'funcion',
    rotulo: 'Función',
    alias: ['funcion', 'rol'],
    ayuda: 'Principal, Secundario, Tercero imparcial.',
  },
  {
    clave: 'posicionamiento',
    rotulo: 'Posicionamiento',
    alias: ['posicionamiento', 'perfil'],
    ayuda: 'Dialogante, Legitimante o Conflictivo.',
  },
  { clave: 'region', rotulo: 'Región', alias: ['region'] },
  { clave: 'dni', rotulo: 'DNI', alias: ['dni', 'documento'] },
  { clave: 'telefono', rotulo: 'Teléfono', alias: ['telefono', 'celular', 'movil'] },
  { clave: 'correo', rotulo: 'Correo', alias: ['correo', 'email', 'correo electronico'] },
];

const COLUMNAS_ORGANIZACION: readonly ColumnaImportacion[] = [
  {
    clave: 'nombre',
    rotulo: 'Nombre',
    alias: ['nombre', 'razon social', 'organizacion', 'institucion', 'entidad'],
    obligatoria: true,
  },
  { clave: 'abreviatura', rotulo: 'Siglas', alias: ['siglas', 'abreviatura'] },
  { clave: 'tipo', rotulo: 'Tipo', alias: ['tipo', 'tipo de actor'] },
  {
    clave: 'nivelGobierno',
    rotulo: 'Nivel de gobierno',
    alias: ['nivel de gobierno', 'nivel gobierno'],
    ayuda: 'Nacional, Regional, Local, Empresa o Sociedad Civil.',
  },
  { clave: 'region', rotulo: 'Región', alias: ['region'] },
  { clave: 'ruc', rotulo: 'RUC', alias: ['ruc'] },
  {
    clave: 'expedienteOspa',
    rotulo: 'Expediente OSPA',
    alias: ['expediente ospa', 'expediente'],
  },
  { clave: 'estadoOspa', rotulo: 'Estado OSPA', alias: ['estado ospa'] },
  {
    clave: 'vigenciaDesde',
    rotulo: 'Vigencia desde',
    alias: ['vigencia desde', 'vigente desde', 'desde'],
    ayuda: 'AAAA-MM-DD o DD/MM/AAAA.',
  },
  {
    clave: 'vigenciaHasta',
    rotulo: 'Vigencia hasta',
    alias: ['vigencia hasta', 'vigente hasta', 'hasta'],
    ayuda: 'AAAA-MM-DD o DD/MM/AAAA.',
  },
];

export const TIPOS_IMPORTACION: readonly TipoImportacion[] = [
  {
    id: 'casos',
    etiqueta: 'Casos: sólo información del caso',
    grupo: 'Casos',
    destino: '/casos',
    estrategia: 'api',
    descripcion:
      'Crea un caso por fila. No crea demandas: úsalo cuando la hoja sólo trae la ficha ' +
      'del caso (título, región, temática, nivel de conflictividad…).',
    columnas: COLUMNAS_CASO,
    nota:
      'El código del caso lo emite la base al crearlo. El distrito no se importa: la API ' +
      'lo pide por identificador del catálogo INEI y se asigna en la ficha.',
  },
  {
    id: 'casos-demandas',
    etiqueta: 'Casos con demandas',
    grupo: 'Casos',
    destino: '/casos',
    estrategia: 'api',
    descripcion:
      'Crea el caso y, además, sus demandas. La celda «Demandas» admite varias, ' +
      'separadas por «|» o por salto de línea.',
    columnas: [
      ...COLUMNAS_CASO,
      {
        clave: 'demandas',
        rotulo: 'Demandas',
        alias: ['demandas', 'demandas inmediatas', 'pedidos'],
        obligatoria: true,
        ayuda: 'Una demanda por línea o separadas por «|».',
      },
    ],
    nota:
      'Cada demanda hereda la temática del caso. Si el caso no la declara, la demanda ' +
      'se rechaza porque la API la exige.',
  },
  {
    id: 'actores-personas',
    etiqueta: 'Actores: personas',
    grupo: 'Directorio',
    destino: '/directorio/personas',
    estrategia: 'api',
    descripcion: 'Crea fichas de persona en el directorio de actores.',
    columnas: COLUMNAS_ACTOR,
    nota:
      'La membresía con una organización se vincula después desde la ficha: la API la ' +
      'exige por identificador, no por nombre.',
  },
  {
    id: 'actores-organizaciones',
    etiqueta: 'Actores: organizaciones',
    grupo: 'Directorio',
    destino: '/directorio/organizaciones',
    estrategia: 'api',
    descripcion: 'Crea organizaciones (sociales, privadas o públicas) en el directorio.',
    columnas: COLUMNAS_ORGANIZACION,
  },
  {
    id: 'actores-instituciones',
    etiqueta: 'Actores: instituciones',
    grupo: 'Directorio',
    destino: '/directorio/organizaciones',
    estrategia: 'api',
    descripcion:
      'Crea organizaciones de naturaleza pública. Es la misma ficha que una ' +
      'organización, con tipo «Actor público» y nivel de gobierno obligatorio.',
    columnas: [
      ...COLUMNAS_ORGANIZACION.filter((columna) => columna.clave !== 'nivelGobierno'),
      {
        clave: 'nivelGobierno',
        rotulo: 'Nivel de gobierno',
        alias: ['nivel de gobierno', 'nivel gobierno'],
        obligatoria: true,
        ayuda: 'Nacional, Regional o Local.',
      },
    ],
  },
  {
    id: 'asistencia',
    etiqueta: 'Lista de asistencia',
    grupo: 'Asistencia',
    destino: '/directorio/personas',
    estrategia: 'padron',
    descripcion:
      'Lee la lista de participantes de una sesión y devuelve el padrón en CSV, con ' +
      'las columnas de firma listas para imprimir.',
    columnas: [
      {
        clave: 'nombre',
        rotulo: 'Nombre',
        alias: ['nombre', 'nombre completo', 'asistente', 'participante'],
        obligatoria: true,
      },
      { clave: 'cargo', rotulo: 'Cargo / función', alias: ['cargo', 'cargo o funcion'] },
      { clave: 'organizacion', rotulo: 'Organización', alias: ['organizacion', 'entidad'] },
      { clave: 'region', rotulo: 'Región', alias: ['region'] },
    ],
    nota:
      'No crea actores: la lista se descarga como documento. Para dar de alta a los ' +
      'participantes, importe además «Actores: personas».',
  },
  {
    id: 'matriz',
    etiqueta: 'Matriz de casos (Anexo 15)',
    grupo: 'Matriz',
    destino: '/compromisos',
    estrategia: 'delegar',
    descripcion:
      'La matriz del equipo tiene su propio importador, con previsualización del plan ' +
      'y rechazos por fila. Aquí sólo se enruta a esa vista.',
    columnas: [],
    nota:
      'La matriz no se aplica desde la interfaz: el plan se revisa y la aplicación la ' +
      'ejecuta el importador de escritorio con confirmación.',
  },
];

/** El tipo pedido o, si no existe, el primero del catálogo. */
export function tipoImportacion(id: string | null | undefined): TipoImportacion {
  return TIPOS_IMPORTACION.find((tipo) => tipo.id === id) ?? TIPOS_IMPORTACION[0];
}

/** Tipos agrupados por vista, en el orden del catálogo. */
export function tiposPorGrupo(): Array<{ grupo: GrupoImportacion; tipos: TipoImportacion[] }> {
  const grupos: Array<{ grupo: GrupoImportacion; tipos: TipoImportacion[] }> = [];
  for (const tipo of TIPOS_IMPORTACION) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.grupo === tipo.grupo) {
      ultimo.tipos.push(tipo);
    } else {
      grupos.push({ grupo: tipo.grupo, tipos: [tipo] });
    }
  }
  return grupos;
}
