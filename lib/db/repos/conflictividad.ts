import type { PoolClient } from "pg";

import { filtroTexto } from "../busqueda";
import { ApiError } from "../errors";
import { excluirCasosMesa } from "./casos-filtro";

/**
 * Matriz de conflictividad (Anexo 15), una fila por caso abierto.
 *
 * La fuente es `analytics.vw_anexo_15_matriz_conflictividad`. La vista NO es
 * `security_invoker` (se comprobó en vivo: `reloptions` es nulo), es decir, se
 * ejecuta con los privilegios de su propietario y **no aplica la RLS** de
 * `core.casos`. Por eso aquí se hace `JOIN core.casos` (no `LEFT JOIN`): ese
 * join vuelve a aplicar la RLS del rol de sesión y, además, deja fuera el caso
 * anulado (`CS-MI-ITE-2026-02`), que la vista sí devuelve. Con ese join la
 * matriz queda en 34 filas tanto para el propietario como para el rol de la API.
 *
 * La vista no trae `estado`, `fecha_inicio`, `ultimo_hecho`, `compromisos`,
 * `tipo_compromiso` ni `documentos`; se derivan de `core.casos`,
 * `core.caso_cronologia`, `core.compromisos` y `core.documentos`, siempre
 * excluyendo lo anulado y dejando `null` cuando la fuente no trae el dato:
 * nunca se rellena con cero ni con un texto estimado.
 *
 * El contexto de seguridad lo fija `withSession`; este repositorio no abre
 * conexiones propias.
 */

export type FilaConflictividad = {
  codigoCaso: string;
  nombreCaso: string | null;
  region: string | null;
  alcance: string | null;
  subsector: string | null;
  nivelConflictividad: string | null;
  nivelRiesgo: string | null;
  prioridadAtencion: string | null;
  estado: string | null;
  unidadResponsable: string | null;
  /** `YYYY-MM-DD` o `null` si el caso no tiene `fecha_inicio`. */
  fechaInicio: string | null;
  /** `YYYY-MM-DD` del máximo hecho no anulado, o `null`. */
  ultimoHecho: string | null;
  /** Compromisos no anulados del caso. `0` es un conteo real, no un hueco. */
  compromisos: number;
  /** Tipos distintos de compromiso, o `null` cuando no hay compromisos. */
  tipoCompromiso: string | null;
  /** Documentos no anulados vinculados al caso. `0` es un conteo real. */
  documentos: number;
};

/** Fila del Anexo 15 más las cinco columnas que sólo se muestran en la ficha. */
export type DetalleConflictividad = FilaConflictividad & {
  descripcionRiesgo: string | null;
  narracionCronologica: string | null;
  alertasVinculadas: string | null;
  actoresInvolucrados: string | null;
  puntoFocal: string | null;
};

export type ResumenConflictividad = {
  total: number;
  /** Nivel `Conflicto social` o `Crisis social`. */
  manifiestos: number;
  /** Todo lo demás, incluido el caso sin nivel declarado. */
  latentes: number;
  /** Filas sin `nivel_conflicto` (quedan dentro de `latentes`). */
  sinNivel: number;
};

export type ConflictividadListQuery = {
  page?: number;
  pageSize?: number;
  /** Sin paginar: lo usan la vista imprimible y la exportación. */
  todas?: boolean;
  region?: string;
  alcance?: string;
  subsector?: string;
  estado?: string;
  /** `manifiesto`, `latente` o un nivel exacto del catálogo. */
  nivel?: string;
  prioridad?: string;
  /** `YYYY-MM-DD`, inclusive. */
  desde?: string;
  /** `YYYY-MM-DD`, inclusive. */
  hasta?: string;
  q?: string;
  /** `inicio` (defecto), `codigo`, `riesgo` o `prioridad`. */
  orden?: string;
};

export type ConflictividadListResult = {
  items: FilaConflictividad[];
  total: number;
  page: number;
  pageSize: number;
  resumen: ResumenConflictividad;
  generadoEn: string;
};

/** Tope de la vista imprimible / exportación sin paginar. */
export const MAX_FILAS_SIN_PAGINAR = 5000;

/** Expresión de la regla de producto: nivel manifiesto. */
const NIVEL_MANIFIESTO =
  "btrim(coalesce(b.nivel_conflicto, '')) in ('Conflicto social', 'Crisis social')";

const MENSAJE_ESQUEMA =
  "La matriz de conflictividad todavía no está disponible: falta una pieza del esquema en la base de datos.";

const COLUMNAS_REQUERIDAS: readonly (readonly [string, string])[] = [
  ["analytics.vw_anexo_15_matriz_conflictividad", "codigo_caso"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "nombre_caso"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "region"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "alcance"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "subsector"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "responsable"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "nivel_conflicto"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "nivel_riesgo"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "prioridad_atencion"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "descripcion_riesgo"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "narracion_cronologica"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "alertas_vinculadas"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "actores_involucrados"],
  ["analytics.vw_anexo_15_matriz_conflictividad", "punto_focal"],
  ["core.casos", "codigo_caso"],
  ["core.casos", "fecha_inicio"],
  ["core.casos", "estado_id"],
  ["core.casos", "anulado_en"],
  ["core.cat_estados_caso", "id"],
  ["core.cat_estados_caso", "codigo"],
  ["core.caso_cronologia", "caso_id"],
  ["core.caso_cronologia", "fecha_evento"],
  ["core.caso_cronologia", "anulado_en"],
  ["core.compromisos", "caso_id"],
  ["core.compromisos", "anulado_en"],
  ["core.compromisos", "tipo_compromiso"],
  ["core.documentos", "caso_id"],
  ["core.documentos", "anulado_en"],
];

/**
 * Corta con 503 `ESQUEMA_PENDIENTE` si falta la vista o alguna columna de la que
 * dependen las diecisiete columnas de la pantalla. Se comprueba antes de
 * consultar para no devolver una tabla a medias.
 */
export async function verificarEsquemaConflictividad(
  client: PoolClient,
): Promise<void> {
  const result = await client.query<{ tabla: string; columna: string }>(`
    select table_schema || '.' || table_name as tabla,
           column_name as columna
      from information_schema.columns
     where (table_schema = 'analytics'
            and table_name = 'vw_anexo_15_matriz_conflictividad')
        or (table_schema = 'core'
            and table_name in ('casos', 'cat_estados_caso', 'caso_cronologia',
                               'compromisos', 'documentos'))
  `);

  const presentes = new Set(
    result.rows.map((fila) => `${fila.tabla}.${fila.columna}`),
  );
  const faltantes = COLUMNAS_REQUERIDAS.filter(
    ([tabla, columna]) => !presentes.has(`${tabla}.${columna}`),
  ).map(([tabla, columna]) => `${tabla}.${columna}`);

  if (faltantes.length > 0) {
    throw new ApiError(
      503,
      `${MENSAJE_ESQUEMA} Falta: ${faltantes.join(", ")}.`,
      "ESQUEMA_PENDIENTE",
    );
  }
}

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

function numero(valor: unknown): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const leido = Number(valor);
    if (Number.isFinite(leido)) return leido;
  }
  return 0;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function validarFecha(valor: string, parametro: string): string {
  if (!FECHA_ISO.test(valor)) {
    throw new ApiError(
      422,
      `El parámetro ${parametro} debe tener el formato aaaa-mm-dd.`,
      "FECHA_INVALIDA",
    );
  }
  return valor;
}

/**
 * Bloques comunes. `base` expone la vista y reaplica la RLS mediante el join a
 * `core.casos`; además descarta el caso anulado.
 */
const SQL_BASE = `
with base as (
  select v.codigo_caso,
         v.nombre_caso,
         v.region,
         v.alcance,
         v.subsector,
         v.nivel_conflicto,
         v.nivel_riesgo,
         v.prioridad_atencion,
         v.responsable,
         v.punto_focal,
         v.descripcion_riesgo,
         v.narracion_cronologica,
         v.alertas_vinculadas,
         v.actores_involucrados,
         c.id            as caso_id,
         c.fecha_inicio,
         c.anulado_en,
         replace(ec.codigo, '_', ' ') as estado
    from analytics.vw_anexo_15_matriz_conflictividad v
    join core.casos c
      on c.codigo_caso = v.codigo_caso
    left join core.cat_estados_caso ec
      on ec.id = c.estado_id
)`;

const COLUMNAS_FILA = `
       b.codigo_caso,
       b.nombre_caso,
       b.region,
       b.alcance,
       b.subsector,
       b.nivel_conflicto,
       b.nivel_riesgo,
       b.prioridad_atencion,
       b.estado,
       b.responsable,
       to_char(b.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
       (select to_char(max(k.fecha_evento), 'YYYY-MM-DD')
          from core.caso_cronologia k
         where k.caso_id = b.caso_id
           and k.anulado_en is null) as ultimo_hecho,
       (select count(*)::int
          from core.compromisos co
         where co.caso_id = b.caso_id
           and co.anulado_en is null) as compromisos,
       (select string_agg(t.tipo, ', ')
          from (select distinct co.tipo_compromiso as tipo
                  from core.compromisos co
                 where co.caso_id = b.caso_id
                   and co.anulado_en is null
                   and co.tipo_compromiso is not null
                 order by 1) t) as tipo_compromiso,
       (select count(*)::int
          from core.documentos d
         where d.caso_id = b.caso_id
           and d.anulado_en is null) as documentos`;

function mapFila(row: Record<string, unknown>): FilaConflictividad {
  return {
    codigoCaso: texto(row["codigo_caso"]) ?? "",
    nombreCaso: texto(row["nombre_caso"]),
    region: texto(row["region"]),
    alcance: texto(row["alcance"]),
    subsector: texto(row["subsector"]),
    nivelConflictividad: texto(row["nivel_conflicto"]),
    nivelRiesgo: texto(row["nivel_riesgo"]),
    prioridadAtencion: texto(row["prioridad_atencion"]),
    estado: texto(row["estado"]),
    unidadResponsable: texto(row["responsable"]),
    fechaInicio: texto(row["fecha_inicio"]),
    ultimoHecho: texto(row["ultimo_hecho"]),
    compromisos: numero(row["compromisos"]),
    tipoCompromiso: texto(row["tipo_compromiso"]),
    documentos: numero(row["documentos"]),
  };
}

function mapDetalle(row: Record<string, unknown>): DetalleConflictividad {
  return {
    ...mapFila(row),
    descripcionRiesgo: texto(row["descripcion_riesgo"]),
    narracionCronologica: texto(row["narracion_cronologica"]),
    alertasVinculadas: texto(row["alertas_vinculadas"]),
    actoresInvolucrados: texto(row["actores_involucrados"]),
    puntoFocal: texto(row["punto_focal"]),
  };
}

/**
 * Filtros compartidos por el listado, la vista imprimible y la exportación.
 * Se usa `core.normalizar_ref` para que una tilde o una mayúscula no cambien el
 * resultado. Los valores vacíos no se aplican.
 */
function construirWhere(
  query: ConflictividadListQuery,
  bind: (valor: unknown) => string,
): string[] {
  const where: string[] = [
    "b.anulado_en is null",
    // Casos espejo de mesas: sin distrito, nivel ni prioridad, no son filas del
    // Anexo 15. Se excluyen del listado, del resumen y de la exportación (que
    // reutiliza este mismo constructor).
    excluirCasosMesa("b"),
  ];

  const region = query.region?.trim();
  if (region) {
    where.push(
      `core.normalizar_ref(b.region) = core.normalizar_ref(${bind(region)})`,
    );
  }

  const alcance = query.alcance?.trim();
  if (alcance) {
    where.push(
      `core.normalizar_ref(b.alcance) = core.normalizar_ref(${bind(alcance)})`,
    );
  }

  const subsector = query.subsector?.trim();
  if (subsector) {
    where.push(
      `core.normalizar_ref(b.subsector) = core.normalizar_ref(${bind(subsector)})`,
    );
  }

  const estado = query.estado?.trim();
  if (estado) {
    where.push(
      `core.normalizar_ref(b.estado) = core.normalizar_ref(${bind(estado)})`,
    );
  }

  const prioridad = query.prioridad?.trim();
  if (prioridad) {
    where.push(
      `core.normalizar_ref(b.prioridad_atencion) = core.normalizar_ref(${bind(
        prioridad,
      )})`,
    );
  }

  const nivel = query.nivel?.trim();
  if (nivel) {
    const clave = nivel.toLowerCase();
    if (clave === "manifiesto") {
      where.push(NIVEL_MANIFIESTO);
    } else if (clave === "latente") {
      where.push(`not (${NIVEL_MANIFIESTO})`);
    } else {
      where.push(
        `core.normalizar_ref(b.nivel_conflicto) = core.normalizar_ref(${bind(nivel)})`,
      );
    }
  }

  const desde = query.desde?.trim();
  if (desde) {
    where.push(`b.fecha_inicio >= ${bind(validarFecha(desde, "desde"))}::date`);
  }

  const hasta = query.hasta?.trim();
  if (hasta) {
    where.push(`b.fecha_inicio <= ${bind(validarFecha(hasta, "hasta"))}::date`);
  }

  const porTexto = filtroTexto(
    ["b.codigo_caso", "b.nombre_caso", "b.region"],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);

  return where;
}

function construirOrden(orden: string | undefined): string {
  switch ((orden ?? "").trim().toLowerCase()) {
    case "codigo":
      return "b.codigo_caso asc";
    case "riesgo":
      return `case b.nivel_riesgo
                when 'Alto' then 0 when 'Moderado' then 1 when 'Bajo' then 2
                else 3 end,
              b.codigo_caso asc`;
    case "prioridad":
      return `case b.prioridad_atencion
                when 'Urgente' then 0 when 'Moderado' then 1 when 'Bajo' then 2
                else 3 end,
              b.codigo_caso asc`;
    case "inicio":
    default:
      return "b.fecha_inicio desc nulls last, b.codigo_caso asc";
  }
}

/**
 * Listado del Anexo 15. Una fila por caso abierto, en el orden de columnas del
 * mockup. Los agregados de la cabecera (total, manifiestos, latentes, sin nivel)
 * se calculan con window functions sobre el conjunto ya filtrado, de modo que
 * el resumen siempre coincide con lo que la tabla muestra.
 */
export async function listarConflictividad(
  client: PoolClient,
  query: ConflictividadListQuery,
): Promise<ConflictividadListResult> {
  const params: unknown[] = [];
  const bind = (valor: unknown): string => {
    params.push(valor);
    return `$${params.length}`;
  };

  const where = construirWhere(query, bind);
  const orden = construirOrden(query.orden);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  let paginacion: string;
  if (query.todas) {
    paginacion = `limit ${bind(MAX_FILAS_SIN_PAGINAR + 1)}`;
  } else {
    paginacion = `limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}`;
  }

  const sql = `
    ${SQL_BASE}
    select ${COLUMNAS_FILA},
           count(*) over()::int as total,
           count(*) filter (where ${NIVEL_MANIFIESTO}) over()::int as manifiestos,
           count(*) filter (where not (${NIVEL_MANIFIESTO})) over()::int as latentes,
           count(*) filter (where btrim(coalesce(b.nivel_conflicto, '')) = '') over()::int as sin_nivel
      from base b
     where ${where.join(" and ")}
     order by ${orden}
     ${paginacion}
  `;

  const result = await client.query(sql, params);

  if (query.todas && result.rows.length > MAX_FILAS_SIN_PAGINAR) {
    throw new ApiError(
      413,
      `La consulta suma más de ${MAX_FILAS_SIN_PAGINAR} filas. Acote los filtros antes de imprimir o descargar.`,
      "EXPORTACION_DEMASIADO_GRANDE",
    );
  }

  const primera = result.rows[0] as Record<string, unknown> | undefined;
  const resumen: ResumenConflictividad = {
    total: numero(primera?.["total"]),
    manifiestos: numero(primera?.["manifiestos"]),
    latentes: numero(primera?.["latentes"]),
    sinNivel: numero(primera?.["sin_nivel"]),
  };

  return {
    items: result.rows.map((row) => mapFila(row as Record<string, unknown>)),
    total: resumen.total,
    page,
    pageSize: query.todas ? resumen.total || pageSize : pageSize,
    resumen,
    generadoEn: new Date().toISOString(),
  };
}

/**
 * Ficha de una fila: las diecisiete columnas del listado más las cinco que la
 * vista reserva (`descripcion_riesgo`, `narracion_cronologica`,
 * `alertas_vinculadas`, `actores_involucrados`, `punto_focal`).
 */
export async function obtenerConflictividadPorCodigo(
  client: PoolClient,
  codigo: string,
): Promise<DetalleConflictividad | null> {
  const result = await client.query(
    `
    ${SQL_BASE}
    select ${COLUMNAS_FILA},
           b.descripcion_riesgo,
           b.narracion_cronologica,
           b.alertas_vinculadas,
           b.actores_involucrados,
           b.punto_focal
      from base b
     where b.anulado_en is null
       and core.normalizar_ref(b.codigo_caso) = core.normalizar_ref($1)
     limit 1
    `,
    [codigo.trim()],
  );

  const fila = result.rows[0];
  return fila ? mapDetalle(fila as Record<string, unknown>) : null;
}
