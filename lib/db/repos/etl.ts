import type { PoolClient } from "pg";

/**
 * Estado real de la ingesta para la consola ETL.
 *
 * No existe motor de extracción: no hay tabla de corridas, cola de trabajos,
 * programación ni reintentos. Lo que sí hay en la base es (a) las migraciones
 * aplicadas en `core.migracion_log`, (b) las cardinalidades de las tablas de
 * `core`, `legacy` y `staging`, (c) los enlaces de integración declarados en
 * `core.integraciones` y (d) los catálogos de formatos, tipos de documento y
 * puntos de ingesta. La API expone sólo eso; lo demás se declara no disponible
 * en la interfaz en vez de simularlo.
 *
 * Los conteos de `legacy` y `staging` los resuelve `core.etl_conteos()`
 * (SECURITY DEFINER, migración 58) porque `avisa_api` no tiene USAGE en esos
 * esquemas. La función devuelve únicamente cardinalidades.
 */

export type ConteoTabla = {
  tabla: string;
  filas: number;
};

export type ConteoEsquema = {
  esquema: string;
  totalTablas: number;
  totalFilas: number;
  /** Tablas con más filas primero. */
  tablas: ConteoTabla[];
};

export type EstadoMigraciones = {
  aplicadas: number;
  primera: string | null;
  ultima: string | null;
  ultimaClave: string | null;
};

export type TipoDocumento = {
  codigo: string;
  nombre: string;
  anexoNumero: number | null;
};

export type FormatoAdmitido = {
  extension: string;
  mime: string;
  nota: string | null;
};

export type PuntoIngesta = {
  codigo: string;
  descripcion: string;
  /** `core`, `qda`, `lex`, `kag` o `ind`. */
  destino: string;
};

export type FuenteIntegracion = {
  sistema: string;
  enlaces: number;
  tipos: string[];
  protocolos: string[];
  estados: string[];
  ultimaSincronizacion: string | null;
};

export type ResumenEtl = {
  generadoEn: string;
  esquemas: ConteoEsquema[];
  /** Tablas de respaldo `*_backup_*` que se omiten de la interfaz. */
  tablasOmitidas: number;
  migraciones: EstadoMigraciones;
  catalogos: {
    tiposDocumento: TipoDocumento[];
    formatos: FormatoAdmitido[];
    puntosIngesta: PuntoIngesta[];
  };
  fuentesIntegracion: FuenteIntegracion[];
};

export type MigracionAplicada = {
  clave: string;
  aplicadaEn: string | null;
};

export type EjecucionesResultado = {
  items: MigracionAplicada[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type EjecucionesQuery = {
  page?: number;
  pageSize?: number;
};

/** Orden fijo de los esquemas del pipeline; cualquier otro va al final. */
const ORDEN_ESQUEMAS = ["core", "legacy", "staging"];

/** Las tablas `*_backup_*` son respaldos de migración: no son datos vivos. */
const RESPALDO = "_backup_";

function aIso(valor: unknown): string | null {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "string" && valor) return valor;
  return null;
}

function listaTexto(valor: unknown): string[] {
  if (typeof valor !== "string" || !valor.trim()) return [];
  return valor
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean);
}

/**
 * Conteos por tabla de `core`, `legacy` y `staging`.
 *
 * `pg` devuelve `bigint` como cadena: se convierte a número. Se omiten las
 * tablas de respaldo y se informa cuántas quedaron fuera. Dentro de cada
 * esquema, las tablas se ordenan por filas descendentes para que lo que tiene
 * datos aparezca primero.
 */
export async function listarConteos(client: PoolClient): Promise<{
  esquemas: ConteoEsquema[];
  tablasOmitidas: number;
}> {
  const result = await client.query<{
    esquema: string;
    tabla: string;
    filas: string | number;
  }>("select esquema, tabla, filas from core.etl_conteos()");

  const agrupado = new Map<string, ConteoTabla[]>();
  let tablasOmitidas = 0;

  for (const fila of result.rows) {
    if (fila.tabla.includes(RESPALDO)) {
      tablasOmitidas += 1;
      continue;
    }

    const lista = agrupado.get(fila.esquema) ?? [];
    lista.push({ tabla: fila.tabla, filas: Number(fila.filas) });
    agrupado.set(fila.esquema, lista);
  }

  const nombres = [
    ...ORDEN_ESQUEMAS.filter((esquema) => agrupado.has(esquema)),
    ...[...agrupado.keys()]
      .filter((esquema) => !ORDEN_ESQUEMAS.includes(esquema))
      .sort((a, b) => a.localeCompare(b, "es")),
  ];

  const esquemas = nombres.map((esquema) => {
    const tablas = (agrupado.get(esquema) ?? []).sort(
      (a, b) => b.filas - a.filas || a.tabla.localeCompare(b.tabla, "es"),
    );
    return {
      esquema,
      totalTablas: tablas.length,
      totalFilas: tablas.reduce((suma, tabla) => suma + tabla.filas, 0),
      tablas,
    };
  });

  return { esquemas, tablasOmitidas };
}

/** Estado agregado de `core.migracion_log`. */
export async function getEstadoMigraciones(
  client: PoolClient,
): Promise<EstadoMigraciones> {
  const resumen = await client.query<{
    aplicadas: number;
    primera: Date | null;
    ultima: Date | null;
  }>(
    `select count(*)::int as aplicadas,
            min(aplicada_en) as primera,
            max(aplicada_en) as ultima
       from core.migracion_log`,
  );

  const fila = resumen.rows[0];
  if (!fila || fila.aplicadas === 0) {
    return { aplicadas: 0, primera: null, ultima: null, ultimaClave: null };
  }

  const ultima = await client.query<{ clave: string }>(
    `select clave
       from core.migracion_log
      order by aplicada_en desc nulls last, clave desc
      limit 1`,
  );

  return {
    aplicadas: fila.aplicadas,
    primera: aIso(fila.primera),
    ultima: aIso(fila.ultima),
    ultimaClave: ultima.rows[0]?.clave ?? null,
  };
}

/**
 * Historial de migraciones aplicadas, paginado.
 *
 * `core.migracion_log` sólo guarda la clave y el instante: no hay autor,
 * duración ni resultado. El cuerpo de cada migración vive en `migration/`.
 */
export async function listarMigraciones(
  client: PoolClient,
  query: EjecucionesQuery = {},
): Promise<EjecucionesResultado> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  const result = await client.query<{
    clave: string;
    aplicada_en: Date | null;
    total: number;
  }>(
    `select clave,
            aplicada_en,
            count(*) over()::int as total
       from core.migracion_log
      order by aplicada_en desc nulls last, clave
      limit $1 offset $2`,
    [pageSize, (page - 1) * pageSize],
  );

  const total = result.rows[0]?.total ?? 0;

  return {
    items: result.rows.map((fila) => ({
      clave: fila.clave,
      aplicadaEn: aIso(fila.aplicada_en),
    })),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export async function getTiposDocumento(
  client: PoolClient,
): Promise<TipoDocumento[]> {
  const result = await client.query<{
    codigo: string;
    nombre: string;
    anexo_numero: number | null;
  }>(
    `select codigo, nombre, anexo_numero
       from core.cat_tipos_documento
      order by codigo`,
  );

  return result.rows.map((fila) => ({
    codigo: fila.codigo,
    nombre: fila.nombre,
    anexoNumero: fila.anexo_numero,
  }));
}

export async function getFormatos(
  client: PoolClient,
): Promise<FormatoAdmitido[]> {
  const result = await client.query<{
    extension: string;
    mime: string;
    nota: string | null;
  }>(
    `select extension, mime, nota
       from core.documento_lista_blanca
      where activo
      order by extension`,
  );

  return result.rows.map((fila) => ({
    extension: fila.extension,
    mime: fila.mime,
    nota: fila.nota,
  }));
}

export async function getPuntosIngesta(
  client: PoolClient,
): Promise<PuntoIngesta[]> {
  const result = await client.query<PuntoIngesta>(
    `select codigo, descripcion, destino
       from analisis.punto_ingesta
      order by codigo`,
  );

  return result.rows;
}

/**
 * Enlaces de integración agrupados por sistema de origen.
 *
 * `core.integraciones` registra el enlace declarado, no una ejecución: por eso
 * `ultima_sincronizacion` está en NULL en todas las filas. Se devuelve tal cual
 * para que la interfaz lo muestre como «—» y no invente una fecha.
 */
export async function getFuentesIntegracion(
  client: PoolClient,
): Promise<FuenteIntegracion[]> {
  const result = await client.query<{
    sistema_origen: string;
    enlaces: number;
    tipos: string | null;
    protocolos: string | null;
    estados: string | null;
    ultima: Date | null;
  }>(
    `select sistema_origen,
            count(*)::int as enlaces,
            string_agg(distinct tipo_sync, ', ' order by tipo_sync) as tipos,
            string_agg(distinct protocolo_sincronizacion, ', ' order by protocolo_sincronizacion) as protocolos,
            string_agg(distinct estado, ', ' order by estado) as estados,
            max(ultima_sincronizacion) as ultima
       from core.integraciones
      group by sistema_origen
      order by sistema_origen`,
  );

  return result.rows.map((fila) => ({
    sistema: fila.sistema_origen,
    enlaces: fila.enlaces,
    tipos: listaTexto(fila.tipos),
    protocolos: listaTexto(fila.protocolos),
    estados: listaTexto(fila.estados),
    ultimaSincronizacion: aIso(fila.ultima),
  }));
}

/** Todo lo que la consola ETL puede mostrar con datos reales, en una lectura. */
export async function getResumenEtl(client: PoolClient): Promise<ResumenEtl> {
  const [conteos, migraciones, tiposDocumento, formatos, puntosIngesta, fuentes] =
    await Promise.all([
      listarConteos(client),
      getEstadoMigraciones(client),
      getTiposDocumento(client),
      getFormatos(client),
      getPuntosIngesta(client),
      getFuentesIntegracion(client),
    ]);

  return {
    generadoEn: new Date().toISOString(),
    esquemas: conteos.esquemas,
    tablasOmitidas: conteos.tablasOmitidas,
    migraciones,
    catalogos: { tiposDocumento, formatos, puntosIngesta },
    fuentesIntegracion: fuentes,
  };
}
