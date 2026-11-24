import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { ApiError } from "../errors";

/**
 * Tablero (Kanban) de la bandeja de trabajo.
 *
 * La persistencia vive en `core.tablero_tarjeta` y su historial en
 * `core.tablero_tarjeta_evento` (migración 49). Ninguna de las dos tablas tiene
 * RLS propia, así que la autorización se replica aquí: la tarjeta sólo se
 * escribe si la entidad dueña existe bajo la RLS vigente y `core.puede_editar()`
 * lo permite. El listado descarta las tarjetas cuya entidad no es visible, para
 * que la falta de RLS no filtre metadatos de registros que la sesión no puede
 * ver.
 *
 * Nada se estima: una tarjeta sin responsable se declara «sin responsable»; una
 * tarjeta sin fecha límite no inventa una. `entidad_tipo` admite `caso` por el
 * CHECK de la tabla, pero el catálogo de candidatos sólo propone alerta,
 * compromiso y demanda, que son las fuentes de la bandeja.
 */

export const COLUMNAS_TABLERO = [
  "backlog",
  "en_curso",
  "en_espera",
  "hecho",
] as const;

export type ColumnaTablero = (typeof COLUMNAS_TABLERO)[number];

export const ETIQUETAS_COLUMNA: Record<ColumnaTablero, string> = {
  backlog: "Backlog",
  en_curso: "En curso",
  en_espera: "En espera",
  hecho: "Hecho",
};

export const TIPOS_ENTIDAD_TABLERO = [
  "alerta",
  "compromiso",
  "demanda",
  "caso",
] as const;

export type TipoEntidadTablero = (typeof TIPOS_ENTIDAD_TABLERO)[number];

export type TarjetaTablero = {
  /** Id de la fila en `core.tablero_tarjeta`. */
  id: string;
  entidadTipo: TipoEntidadTablero;
  entidadId: string;
  columna: ColumnaTablero;
  asignacionTexto: string | null;
  responsableUsuarioId: string | null;
  responsableUsuarioNombre: string | null;
  responsableTexto: string | null;
  fechaLimite: string | null;
  pospuestoHasta: string | null;
  motivoPosposicion: string | null;
  orden: number;
  actualizadoEn: string | null;
  /* Datos de la entidad dueña, resueltos en SQL. */
  codigo: string | null;
  titulo: string | null;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  riesgo: string | null;
  estado: string | null;
  fechaReferencia: string | null;
};

export type CandidatoTablero = {
  entidadTipo: "alerta" | "compromiso" | "demanda";
  entidadId: string;
  codigo: string | null;
  titulo: string | null;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  riesgo: string | null;
  estado: string | null;
  fechaReferencia: string | null;
};

export type ColumnaTableroResultado = {
  clave: ColumnaTablero;
  etiqueta: string;
  tarjetas: TarjetaTablero[];
  total: number;
};

export type TableroResultado = {
  columnas: ColumnaTableroResultado[];
  total: number;
  pospuestas: number;
  conFechaLimite: number;
  vencidas: number;
  sinResponsable: number;
  conteosTipo: Record<TipoEntidadTablero, number>;
  candidatos: CandidatoTablero[];
  candidatosTotal: number;
  hoy: string | null;
  generadoEn: string;
};

export type TableroQuery = {
  /** Filtra por `entidad_tipo`; `undefined` devuelve todas. */
  tipo?: TipoEntidadTablero;
};

export type CompletitudColumna = {
  clave: ColumnaTablero;
  etiqueta: string;
  total: number;
  conResponsable: number;
  sinResponsable: number;
  conFechaLimite: number;
  sinFechaLimite: number;
  conAsignacion: number;
  sinAsignacion: number;
  completas: number;
  incompletas: number;
};

export type CompletitudTotales = Omit<CompletitudColumna, "clave" | "etiqueta">;

export type CompletitudResultado = {
  columnas: CompletitudColumna[];
  total: CompletitudTotales;
  generadoEn: string;
};

/**
 * Tarjeta mayor que el CHECK de la tabla (`varchar(160)`). Se corta antes en
 * 400 en vez de dejar que PostgreSQL devuelva un 22001 genérico.
 */
const MAX_TEXTO = 160;
const MAX_MOTIVO = 1000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Estado de la alerta, con el mismo criterio que el listado de alertas
 * (`lib/db/repos/alerts.ts`): el legado sólo guarda `paso_actual`.
 */
const ALERTA_ESTADO = `case
    when a.paso_actual >= 5 then 'Atendida'
    when a.aprobada_por is not null then 'Aprobada'
    when a.validada_por is not null then 'Validada'
    when a.paso_actual >= 3 then 'En revisión'
    else 'Pendiente de revisión'
  end`;

const VENCIMIENTO_COMPROMISO = `coalesce(
    cmp.fecha_vencimiento,
    (
      select min(h.fecha_vencimiento)
        from core.hitos_compromiso h
        left join core.cat_estados_hito eh on eh.id = h.estado_id
       where h.compromiso_id = cmp.id
         and h.fecha_vencimiento is not null
         and coalesce(eh.es_terminal, false) = false
    )
  )`;

/**
 * Entidad dueña de una tarjeta, resuelta con un LATERAL que une las cuatro
 * tablas admitidas. Cada rama se activa sólo para su `entidad_tipo`, así que la
 * consulta no recorre las tablas grandes cuando no hace falta. La RLS de cada
 * tabla decide si la fila existe; si no es visible, la tarjeta se descarta.
 */
const ENTIDAD_LATERAL = `
  left join lateral (
    select 'alerta'::text as entidad_tipo,
           a.id as entidad_id,
           a.codigo_alerta::text as codigo,
           a.titulo::text as titulo,
           a.caso_id,
           ca.codigo_caso::text as caso_codigo,
           ca.nombre_caso::text as caso_titulo,
           coalesce(nr.codigo, nrc.codigo)::text as riesgo,
           (${ALERTA_ESTADO})::text as estado,
           to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha_referencia
      from core.alertas_tempranas a
      left join core.casos ca on ca.id = a.caso_id
      left join core.cat_niveles_riesgo nr on nr.id = a.nivel_riesgo_id
      left join core.cat_niveles_riesgo nrc on nrc.id = ca.nivel_riesgo_id
     where t.entidad_tipo = 'alerta' and a.id = t.entidad_id
    union all
    select 'compromiso',
           cmp.id,
           cmp.codigo_compromiso::text,
           cmp.accion_compromiso::text,
           cmp.caso_id,
           cc.codigo_caso::text,
           cc.nombre_caso::text,
           null::text,
           replace(ec_cmp.codigo, '_', ' '),
           to_char(${VENCIMIENTO_COMPROMISO}, 'YYYY-MM-DD')
      from core.compromisos cmp
      left join core.casos cc on cc.id = cmp.caso_id
      left join core.cat_estados_compromiso ec_cmp on ec_cmp.id = cmp.estado_id
     where t.entidad_tipo = 'compromiso' and cmp.id = t.entidad_id
    union all
    select 'demanda',
           d.id,
           null::text,
           coalesce(d.descripcion_demanda, d.pedido_3p, d.problema_3p)::text,
           d.caso_id,
           cd.codigo_caso::text,
           cd.nombre_caso::text,
           null::text,
           replace(d.estado_atencion, '_', ' '),
           to_char(d.fecha_vencimiento_respuesta, 'YYYY-MM-DD')
      from core.demandas d
      left join core.casos cd on cd.id = d.caso_id
     where t.entidad_tipo = 'demanda' and d.id = t.entidad_id
    union all
    select 'caso',
           ck.id,
           ck.codigo_caso::text,
           ck.nombre_caso::text,
           ck.id,
           ck.codigo_caso::text,
           ck.nombre_caso::text,
           nrk.codigo::text,
           replace(ec_caso.codigo, '_', ' '),
           null::text
      from core.casos ck
      left join core.cat_niveles_riesgo nrk on nrk.id = ck.nivel_riesgo_id
      left join core.cat_estados_caso ec_caso on ec_caso.id = ck.estado_id
     where t.entidad_tipo = 'caso' and ck.id = t.entidad_id
  ) e on true
`;

/**
 * Tarjetas visibles para la sesión. Se exige que la entidad exista bajo la RLS
 * vigente; sin esto, una tarjeta huérfana o de un registro clasificado
 * aparecería como un hueco con metadatos.
 */
const ENTIDAD_VISIBLE = `e.entidad_id is not null`;

const TARJETAS_SQL = `
  select t.id as tarjeta_id,
         t.entidad_tipo,
         t.entidad_id,
         t.columna,
         t.asignacion_texto,
         t.responsable_usuario_id,
         ur.nombre as responsable_usuario_nombre,
         t.responsable_texto,
         to_char(t.fecha_limite, 'YYYY-MM-DD') as fecha_limite,
         to_char(t.pospuesto_hasta, 'YYYY-MM-DD') as pospuesto_hasta,
         t.motivo_posposicion,
         t.orden::int as orden,
         to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as actualizado_en,
         to_char(current_date, 'YYYY-MM-DD') as hoy,
         e.codigo,
         e.titulo,
         e.caso_id,
         e.caso_codigo,
         e.caso_titulo,
         e.riesgo,
         e.estado,
         e.fecha_referencia
    from core.tablero_tarjeta t
    ${ENTIDAD_LATERAL}
    left join core.usuarios ur on ur.id = t.responsable_usuario_id
   where ${ENTIDAD_VISIBLE}
   order by case t.columna
              when 'backlog' then 1
              when 'en_curso' then 2
              when 'en_espera' then 3
              else 4
            end,
            t.orden,
            t.fecha_limite nulls last,
            t.created_at,
            t.id
`;

/**
 * Registros que todavía no tienen tarjeta. Son las mismas fuentes de la
 * bandeja: alertas pendientes, compromisos no terminales y demandas sin caso.
 * Se excluye lo que ya está en el tablero con `not exists`.
 */
const CANDIDATOS_SQL = `
  select q.entidad_tipo,
         q.entidad_id,
         q.codigo,
         q.titulo,
         q.caso_id,
         q.caso_codigo,
         q.caso_titulo,
         q.riesgo,
         q.estado,
         q.fecha_referencia,
         count(*) over ()::int as total_global
    from (
      select 'alerta'::text as entidad_tipo,
             a.id as entidad_id,
             a.codigo_alerta::text as codigo,
             a.titulo::text as titulo,
             a.caso_id,
             ca.codigo_caso::text as caso_codigo,
             ca.nombre_caso::text as caso_titulo,
             coalesce(nr.codigo, nrc.codigo)::text as riesgo,
             (${ALERTA_ESTADO})::text as estado,
             to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha_referencia
        from core.alertas_tempranas a
        left join core.casos ca on ca.id = a.caso_id
        left join core.cat_niveles_riesgo nr on nr.id = a.nivel_riesgo_id
        left join core.cat_niveles_riesgo nrc on nrc.id = ca.nivel_riesgo_id
       where a.paso_actual < 3
         and a.validada_por is null
         and a.aprobada_por is null
         and not exists (
           select 1 from core.tablero_tarjeta t
            where t.entidad_tipo = 'alerta' and t.entidad_id = a.id
         )
      union all
      select 'compromiso',
             cmp.id,
             cmp.codigo_compromiso::text,
             cmp.accion_compromiso::text,
             cmp.caso_id,
             cc.codigo_caso::text,
             cc.nombre_caso::text,
             null::text,
             replace(ec_cmp.codigo, '_', ' '),
             to_char(${VENCIMIENTO_COMPROMISO}, 'YYYY-MM-DD')
        from core.compromisos cmp
        left join core.casos cc on cc.id = cmp.caso_id
        left join core.cat_estados_compromiso ec_cmp on ec_cmp.id = cmp.estado_id
       where coalesce(ec_cmp.es_terminal, false) = false
         and not exists (
           select 1 from core.tablero_tarjeta t
            where t.entidad_tipo = 'compromiso' and t.entidad_id = cmp.id
         )
      union all
      select 'demanda',
             d.id,
             null::text,
             coalesce(d.descripcion_demanda, d.pedido_3p, d.problema_3p)::text,
             d.caso_id,
             cd.codigo_caso::text,
             cd.nombre_caso::text,
             null::text,
             replace(d.estado_atencion, '_', ' '),
             to_char(d.fecha_vencimiento_respuesta, 'YYYY-MM-DD')
        from core.demandas d
        left join core.casos cd on cd.id = d.caso_id
       where d.caso_id is null
         and not exists (
           select 1 from core.tablero_tarjeta t
            where t.entidad_tipo = 'demanda' and t.entidad_id = d.id
         )
    ) q
   order by q.entidad_tipo,
            q.fecha_referencia nulls last,
            q.codigo nulls last,
            q.entidad_id
   limit 200
`;

/** Predicado de visibilidad para la completitud (no hay tarjetas huérfanas). */
const VISIBLE_TARJETA = `(
    (t.entidad_tipo = 'alerta' and exists (
       select 1 from core.alertas_tempranas w where w.id = t.entidad_id))
    or (t.entidad_tipo = 'compromiso' and exists (
       select 1 from core.compromisos w where w.id = t.entidad_id))
    or (t.entidad_tipo = 'demanda' and exists (
       select 1 from core.demandas w where w.id = t.entidad_id))
    or (t.entidad_tipo = 'caso' and exists (
       select 1 from core.casos w where w.id = t.entidad_id))
  )`;

const COMPLETITUD_SQL = `
  with visibles as (
    select t.columna,
           (t.responsable_usuario_id is not null
            or nullif(btrim(coalesce(t.responsable_texto, '')), '') is not null)
             as con_responsable,
           (t.fecha_limite is not null) as con_fecha,
           (nullif(btrim(coalesce(t.asignacion_texto, '')), '') is not null)
             as con_asignacion
      from core.tablero_tarjeta t
     where ($1::text is null or t.entidad_tipo = $1::text)
       and ${VISIBLE_TARJETA}
  )
  select columna,
         count(*)::int as total,
         count(*) filter (where con_responsable)::int as con_responsable,
         count(*) filter (where not con_responsable)::int as sin_responsable,
         count(*) filter (where con_fecha)::int as con_fecha,
         count(*) filter (where not con_fecha)::int as sin_fecha,
         count(*) filter (where con_asignacion)::int as con_asignacion,
         count(*) filter (where not con_asignacion)::int as sin_asignacion,
         count(*) filter (where con_responsable and con_fecha and con_asignacion)::int as completas,
         count(*) filter (where not (con_responsable and con_fecha and con_asignacion))::int as incompletas
    from visibles
   group by rollup (columna)
`;

type FilaTarjeta = {
  tarjeta_id: string;
  entidad_tipo: TipoEntidadTablero;
  entidad_id: string;
  columna: ColumnaTablero;
  asignacion_texto: string | null;
  responsable_usuario_id: string | null;
  responsable_usuario_nombre: string | null;
  responsable_texto: string | null;
  fecha_limite: string | null;
  pospuesto_hasta: string | null;
  motivo_posposicion: string | null;
  orden: number;
  actualizado_en: string | null;
  hoy: string;
  codigo: string | null;
  titulo: string | null;
  caso_id: string | null;
  caso_codigo: string | null;
  caso_titulo: string | null;
  riesgo: string | null;
  estado: string | null;
  fecha_referencia: string | null;
};

type FilaCandidato = {
  entidad_tipo: "alerta" | "compromiso" | "demanda";
  entidad_id: string;
  codigo: string | null;
  titulo: string | null;
  caso_id: string | null;
  caso_codigo: string | null;
  caso_titulo: string | null;
  riesgo: string | null;
  estado: string | null;
  fecha_referencia: string | null;
  total_global: number;
};

function mapTarjeta(row: FilaTarjeta): TarjetaTablero {
  return {
    id: row.tarjeta_id,
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    columna: row.columna,
    asignacionTexto: row.asignacion_texto,
    responsableUsuarioId: row.responsable_usuario_id,
    responsableUsuarioNombre: row.responsable_usuario_nombre,
    responsableTexto: row.responsable_texto,
    fechaLimite: row.fecha_limite,
    pospuestoHasta: row.pospuesto_hasta,
    motivoPosposicion: row.motivo_posposicion,
    orden: row.orden,
    actualizadoEn: row.actualizado_en,
    codigo: row.codigo,
    titulo: row.titulo,
    casoId: row.caso_id,
    casoCodigo: row.caso_codigo,
    casoTitulo: row.caso_titulo,
    riesgo: row.riesgo,
    estado: row.estado,
    fechaReferencia: row.fecha_referencia,
  };
}

function mapCandidato(row: FilaCandidato): CandidatoTablero {
  return {
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    codigo: row.codigo,
    titulo: row.titulo,
    casoId: row.caso_id,
    casoCodigo: row.caso_codigo,
    casoTitulo: row.caso_titulo,
    riesgo: row.riesgo,
    estado: row.estado,
    fechaReferencia: row.fecha_referencia,
  };
}

/** Una tarjeta tiene responsable si declara usuario o el texto libre. */
function tieneResponsable(tarjeta: TarjetaTablero): boolean {
  return (
    tarjeta.responsableUsuarioId !== null ||
    (tarjeta.responsableTexto ?? "").trim().length > 0
  );
}

function conteosVacios(): Record<TipoEntidadTablero, number> {
  return { alerta: 0, compromiso: 0, demanda: 0, caso: 0 };
}

export async function getTablero(
  client: PoolClient,
  query: TableroQuery = {},
): Promise<TableroResultado> {
  const tarjetasQ = await client.query<FilaTarjeta>(TARJETAS_SQL);
  const candidatosQ = await client.query<FilaCandidato>(CANDIDATOS_SQL);

  const todas = tarjetasQ.rows.map(mapTarjeta);
  const todosCandidatos = candidatosQ.rows.map(mapCandidato);
  const candidatosTotal = candidatosQ.rows[0]?.total_global ?? 0;

  // Los conteos de los chips se calculan sobre el total, antes de aplicar el
  // filtro por tipo, para que no cambien al elegir una pestaña.
  const conteosTipo = conteosVacios();
  for (const tarjeta of todas) conteosTipo[tarjeta.entidadTipo] += 1;
  for (const candidato of todosCandidatos)
    conteosTipo[candidato.entidadTipo] += 1;

  const tarjetas =
    query.tipo === undefined
      ? todas
      : todas.filter((tarjeta) => tarjeta.entidadTipo === query.tipo);
  const candidatos =
    query.tipo === undefined
      ? todosCandidatos
      : todosCandidatos.filter(
          (candidato) => candidato.entidadTipo === query.tipo,
        );

  const hoy = tarjetasQ.rows[0]?.hoy ?? null;
  const vencidas = tarjetas.filter(
    (tarjeta) =>
      tarjeta.fechaLimite !== null &&
      hoy !== null &&
      tarjeta.fechaLimite < hoy &&
      tarjeta.columna !== "hecho",
  ).length;

  const columnas: ColumnaTableroResultado[] = COLUMNAS_TABLERO.map((clave) => {
    const deColumna = tarjetas.filter((tarjeta) => tarjeta.columna === clave);
    return {
      clave,
      etiqueta: ETIQUETAS_COLUMNA[clave],
      tarjetas: deColumna,
      total: deColumna.length,
    };
  });

  return {
    columnas,
    total: tarjetas.length,
    pospuestas: tarjetas.filter((tarjeta) => tarjeta.pospuestoHasta !== null)
      .length,
    conFechaLimite: tarjetas.filter((tarjeta) => tarjeta.fechaLimite !== null)
      .length,
    vencidas,
    sinResponsable: tarjetas.filter((tarjeta) => !tieneResponsable(tarjeta))
      .length,
    conteosTipo,
    candidatos,
    candidatosTotal,
    hoy,
    generadoEn: new Date().toISOString(),
  };
}

export async function getCompletitud(
  client: PoolClient,
  query: TableroQuery = {},
): Promise<CompletitudResultado> {
  const resultado = await client.query<{
    columna: ColumnaTablero | null;
    total: number;
    con_responsable: number;
    sin_responsable: number;
    con_fecha: number;
    sin_fecha: number;
    con_asignacion: number;
    sin_asignacion: number;
    completas: number;
    incompletas: number;
  }>(COMPLETITUD_SQL, [query.tipo ?? null]);

  const porColumna = new Map<ColumnaTablero, CompletitudColumna>();
  let total: CompletitudTotales = {
    total: 0,
    conResponsable: 0,
    sinResponsable: 0,
    conFechaLimite: 0,
    sinFechaLimite: 0,
    conAsignacion: 0,
    sinAsignacion: 0,
    completas: 0,
    incompletas: 0,
  };

  for (const fila of resultado.rows) {
    const mapeada = {
      total: fila.total,
      conResponsable: fila.con_responsable,
      sinResponsable: fila.sin_responsable,
      conFechaLimite: fila.con_fecha,
      sinFechaLimite: fila.sin_fecha,
      conAsignacion: fila.con_asignacion,
      sinAsignacion: fila.sin_asignacion,
      completas: fila.completas,
      incompletas: fila.incompletas,
    };

    if (fila.columna === null) {
      total = mapeada;
      continue;
    }
    porColumna.set(fila.columna, {
      clave: fila.columna,
      etiqueta: ETIQUETAS_COLUMNA[fila.columna],
      ...mapeada,
    });
  }

  const columnas: CompletitudColumna[] = COLUMNAS_TABLERO.map((clave) => {
    const existente = porColumna.get(clave);
    return (
      existente ?? {
        clave,
        etiqueta: ETIQUETAS_COLUMNA[clave],
        total: 0,
        conResponsable: 0,
        sinResponsable: 0,
        conFechaLimite: 0,
        sinFechaLimite: 0,
        conAsignacion: 0,
        sinAsignacion: 0,
        completas: 0,
        incompletas: 0,
      }
    );
  });

  return { columnas, total, generadoEn: new Date().toISOString() };
}

/* ------------------------------------------------------------------ *
 * Escritura
 * ------------------------------------------------------------------ */

export type TarjetaGuardada = {
  id: string;
  entidadTipo: TipoEntidadTablero;
  entidadId: string;
  columna: ColumnaTablero;
  asignacionTexto: string | null;
  responsableUsuarioId: string | null;
  responsableTexto: string | null;
  fechaLimite: string | null;
  pospuestoHasta: string | null;
  motivoPosposicion: string | null;
  orden: number;
};

export type ActualizacionTarjeta = {
  creada: boolean;
  tarjeta: TarjetaGuardada;
  eventos: string[];
};

type Cambios = {
  columna?: ColumnaTablero;
  asignacionTexto?: string | null;
  responsableUsuarioId?: string | null;
  responsableTexto?: string | null;
  fechaLimite?: string | null;
  pospuestoHasta?: string | null;
  motivoPosposicion?: string | null;
  orden?: number;
};

type FilaActual = {
  id: string;
  columna: ColumnaTablero;
  asignacion_texto: string | null;
  responsable_usuario_id: string | null;
  responsable_texto: string | null;
  fecha_limite: string | null;
  pospuesto_hasta: string | null;
  motivo_posposicion: string | null;
  orden: number;
};

function invalid(mensaje: string, codigo: string): never {
  throw new ApiError(400, mensaje, codigo);
}

function asObject(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  return valor as Record<string, unknown>;
}

/** Acepta la grafía SQL (`fecha_limite`) y la camelCase del cliente. */
function leer(
  input: Record<string, unknown>,
  snake: string,
  camel: string,
): unknown {
  if (snake in input) return input[snake];
  if (camel in input) return input[camel];
  return undefined;
}

function textoOpcional(
  valor: unknown,
  etiqueta: string,
  maximo = MAX_TEXTO,
): string | null {
  if (valor === undefined)
    invalid(`Falta el valor de ${etiqueta}.`, "CAMPO_INVALIDO");
  if (valor === null) return null;
  if (typeof valor !== "string") {
    invalid(`${etiqueta} debe ser texto.`, "CAMPO_INVALIDO");
  }
  const limpio = valor.trim();
  if (limpio.length > maximo) {
    invalid(
      `${etiqueta} supera ${maximo} caracteres.`,
      "CAMPO_DEMASIADO_LARGO",
    );
  }
  return limpio || null;
}

function fechaOpcional(valor: unknown, etiqueta: string): string | null {
  if (valor === undefined)
    invalid(`Falta el valor de ${etiqueta}.`, "CAMPO_INVALIDO");
  if (valor === null) return null;
  if (typeof valor !== "string" || !ISO_DATE.test(valor.trim())) {
    invalid(`${etiqueta} debe tener formato aaaa-mm-dd.`, "FECHA_INVALIDA");
  }
  const limpio = valor.trim();
  const [anio, mes, dia] = limpio.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    invalid(`${etiqueta} no es una fecha válida.`, "FECHA_INVALIDA");
  }
  return limpio;
}

function uuidOpcional(valor: unknown, etiqueta: string): string | null {
  if (valor === undefined)
    invalid(`Falta el valor de ${etiqueta}.`, "CAMPO_INVALIDO");
  if (valor === null || valor === "") return null;
  if (typeof valor !== "string" || !UUID.test(valor.trim())) {
    invalid(`${etiqueta} debe ser un identificador válido.`, "UUID_INVALIDO");
  }
  return valor.trim();
}

function leerCambios(body: unknown): Cambios {
  const input = asObject(body);
  const cambios: Cambios = {};

  const columna = leer(input, "columna", "columna");
  if (columna !== undefined) {
    if (
      typeof columna !== "string" ||
      !(COLUMNAS_TABLERO as readonly string[]).includes(columna)
    ) {
      invalid(
        `La columna debe ser una de: ${COLUMNAS_TABLERO.join(", ")}.`,
        "COLUMNA_INVALIDA",
      );
    }
    cambios.columna = columna as ColumnaTablero;
  }

  const asignacion = leer(input, "asignacion_texto", "asignacionTexto");
  if (asignacion !== undefined) {
    cambios.asignacionTexto = textoOpcional(asignacion, "asignacion_texto");
  }

  const responsableUsuario = leer(
    input,
    "responsable_usuario_id",
    "responsableUsuarioId",
  );
  if (responsableUsuario !== undefined) {
    cambios.responsableUsuarioId = uuidOpcional(
      responsableUsuario,
      "responsable_usuario_id",
    );
  }

  const responsableTexto = leer(input, "responsable_texto", "responsableTexto");
  if (responsableTexto !== undefined) {
    cambios.responsableTexto = textoOpcional(
      responsableTexto,
      "responsable_texto",
    );
  }

  const fechaLimite = leer(input, "fecha_limite", "fechaLimite");
  if (fechaLimite !== undefined) {
    cambios.fechaLimite = fechaOpcional(fechaLimite, "fecha_limite");
  }

  const pospuestoHasta = leer(input, "pospuesto_hasta", "pospuestoHasta");
  if (pospuestoHasta !== undefined) {
    cambios.pospuestoHasta = fechaOpcional(pospuestoHasta, "pospuesto_hasta");
  }

  const motivo = leer(input, "motivo_posposicion", "motivoPosposicion");
  if (motivo !== undefined) {
    cambios.motivoPosposicion = textoOpcional(
      motivo,
      "motivo_posposicion",
      MAX_MOTIVO,
    );
  }

  const orden = leer(input, "orden", "orden");
  if (orden !== undefined) {
    if (
      typeof orden !== "number" ||
      !Number.isInteger(orden) ||
      orden < 0 ||
      orden > 1_000_000
    ) {
      invalid("orden debe ser un entero no negativo.", "ORDEN_INVALIDO");
    }
    cambios.orden = orden;
  }

  if (Object.keys(cambios).length === 0) {
    invalid(
      "Indique al menos un campo a actualizar: columna, asignación, responsable, fecha límite, posposición u orden.",
      "SIN_CAMBIOS",
    );
  }

  return cambios;
}

/** Tabla dueña de cada `entidad_tipo`. Valores fijos: nunca se concatena input. */
const TABLA_ENTIDAD: Record<TipoEntidadTablero, string> = {
  alerta: "core.alertas_tempranas",
  compromiso: "core.compromisos",
  demanda: "core.demandas",
  caso: "core.casos",
};

/**
 * Autoriza la escritura: el rol debe poder editar y la entidad dueña debe
 * existir bajo la RLS vigente. La tabla del tablero no tiene RLS, así que este
 * paso es la única barrera.
 */
async function autorizarEntidad(
  client: PoolClient,
  entidadTipo: TipoEntidadTablero,
  entidadId: string,
): Promise<void> {
  const tabla = TABLA_ENTIDAD[entidadTipo];
  const respuesta = await client.query<{
    puede: boolean;
    existe: boolean;
  }>(
    `select core.puede_editar() as puede,
            exists(select 1 from ${tabla} where id = $1::uuid) as existe`,
    [entidadId],
  );
  const fila = respuesta.rows[0];
  if (!fila?.puede) {
    throw new ApiError(
      403,
      "Su rol no puede editar la bandeja.",
      "SIN_PERMISO",
    );
  }
  if (!fila.existe) {
    throw new ApiError(
      404,
      "La entidad de la tarjeta no existe o excede el nivel de acceso.",
      "NOT_FOUND",
    );
  }
}

async function existeUsuario(
  client: PoolClient,
  usuarioId: string,
): Promise<boolean> {
  const respuesta = await client.query(
    "select 1 from core.usuarios where id = $1::uuid",
    [usuarioId],
  );
  return (respuesta.rowCount ?? 0) > 0;
}

/**
 * Mueve, asigna, fecha, pospone o reordena una tarjeta. Hace upsert: la primera
 * escritura crea la fila y, si ya existe, sólo actualiza lo enviado.
 *
 * Cada campo modificado deja un evento en `core.tablero_tarjeta_evento` con el
 * autor; la creación deja un único evento `creacion` con la instantánea. La
 * bitácora genérica (`audit.cambios`) se escribe en la misma transacción.
 */
export async function actualizarTarjeta(
  client: PoolClient,
  ctx: { usuarioId: string; rolCodigo: string },
  entidadTipoBruto: string,
  entidadIdBruto: string,
  body: unknown,
): Promise<ActualizacionTarjeta> {
  const entidadTipo = entidadTipoBruto.trim().toLowerCase();
  if (!(TIPOS_ENTIDAD_TABLERO as readonly string[]).includes(entidadTipo)) {
    throw new ApiError(
      400,
      `El tipo de entidad debe ser uno de: ${TIPOS_ENTIDAD_TABLERO.join(", ")}.`,
      "ENTIDAD_INVALIDA",
    );
  }
  const tipo = entidadTipo as TipoEntidadTablero;

  const entidadId = decodeURIComponent(entidadIdBruto).trim();
  if (!UUID.test(entidadId)) {
    throw new ApiError(
      400,
      "El identificador de la entidad no es válido.",
      "UUID_INVALIDO",
    );
  }

  const cambios = leerCambios(body);

  await autorizarEntidad(client, tipo, entidadId);

  const existente = await client.query<FilaActual>(
    `select id,
            columna,
            asignacion_texto,
            responsable_usuario_id,
            responsable_texto,
            to_char(fecha_limite, 'YYYY-MM-DD') as fecha_limite,
            to_char(pospuesto_hasta, 'YYYY-MM-DD') as pospuesto_hasta,
            motivo_posposicion,
            orden::int as orden
       from core.tablero_tarjeta
      where entidad_tipo = $1 and entidad_id = $2::uuid
      for update`,
    [tipo, entidadId],
  );
  const actual = existente.rows[0] ?? null;

  const columna = cambios.columna ?? actual?.columna ?? "backlog";
  const asignacionTexto =
    cambios.asignacionTexto !== undefined
      ? cambios.asignacionTexto
      : (actual?.asignacion_texto ?? null);
  const responsableUsuarioId =
    cambios.responsableUsuarioId !== undefined
      ? cambios.responsableUsuarioId
      : (actual?.responsable_usuario_id ?? null);
  const responsableTexto =
    cambios.responsableTexto !== undefined
      ? cambios.responsableTexto
      : (actual?.responsable_texto ?? null);
  const fechaLimite =
    cambios.fechaLimite !== undefined
      ? cambios.fechaLimite
      : (actual?.fecha_limite ?? null);
  const pospuestoHasta =
    cambios.pospuestoHasta !== undefined
      ? cambios.pospuestoHasta
      : (actual?.pospuesto_hasta ?? null);
  let motivoPosposicion =
    cambios.motivoPosposicion !== undefined
      ? cambios.motivoPosposicion
      : (actual?.motivo_posposicion ?? null);

  // Posponer exige motivo; al levantar la posposición el motivo se limpia.
  if (pospuestoHasta !== null && !(motivoPosposicion ?? "").trim()) {
    throw new ApiError(
      422,
      "Indique el motivo de la posposición.",
      "MOTIVO_REQUERIDO",
    );
  }
  if (pospuestoHasta === null) motivoPosposicion = null;

  if (responsableUsuarioId !== null) {
    if (!(await existeUsuario(client, responsableUsuarioId))) {
      throw new ApiError(
        422,
        "El responsable indicado no existe.",
        "RESPONSABLE_INVALIDO",
      );
    }
  }

  let orden = cambios.orden;
  if (orden === undefined) {
    if (actual) {
      // Si sólo cambia de columna, va al final de la columna destino; si no,
      // conserva su orden.
      orden = cambios.columna
        ? await siguienteOrden(client, columna)
        : actual.orden;
    } else {
      orden = await siguienteOrden(client, columna);
    }
  }

  const guardada = await client.query<{
    id: string;
    entidad_tipo: TipoEntidadTablero;
    entidad_id: string;
    columna: ColumnaTablero;
    asignacion_texto: string | null;
    responsable_usuario_id: string | null;
    responsable_texto: string | null;
    fecha_limite: string | null;
    pospuesto_hasta: string | null;
    motivo_posposicion: string | null;
    orden: number;
  }>(
    `insert into core.tablero_tarjeta
       (entidad_tipo, entidad_id, columna, asignacion_texto,
        responsable_usuario_id, responsable_texto, fecha_limite,
        pospuesto_hasta, motivo_posposicion, orden, created_by, updated_by)
     values ($1, $2::uuid, $3, $4, $5::uuid, $6, $7::date,
             $8::date, $9, $10, $11::uuid, $11::uuid)
     on conflict (entidad_tipo, entidad_id) do update
       set columna = excluded.columna,
           asignacion_texto = excluded.asignacion_texto,
           responsable_usuario_id = excluded.responsable_usuario_id,
           responsable_texto = excluded.responsable_texto,
           fecha_limite = excluded.fecha_limite,
           pospuesto_hasta = excluded.pospuesto_hasta,
           motivo_posposicion = excluded.motivo_posposicion,
           orden = excluded.orden,
           updated_at = now(),
           updated_by = excluded.updated_by
     returning id, entidad_tipo, entidad_id, columna, asignacion_texto,
               responsable_usuario_id, responsable_texto,
               to_char(fecha_limite, 'YYYY-MM-DD') as fecha_limite,
               to_char(pospuesto_hasta, 'YYYY-MM-DD') as pospuesto_hasta,
               motivo_posposicion, orden::int as orden`,
    [
      tipo,
      entidadId,
      columna,
      asignacionTexto,
      responsableUsuarioId,
      responsableTexto,
      fechaLimite,
      pospuestoHasta,
      motivoPosposicion,
      orden,
      ctx.usuarioId,
    ],
  );

  const fila = guardada.rows[0];
  const creada = actual === null;

  if (creada) {
    await registrarEvento(
      client,
      fila.id,
      "creacion",
      null,
      fila,
      ctx.usuarioId,
    );
  } else {
    await registrarCambios(client, fila.id, actual, fila, ctx.usuarioId);
  }

  await auditChange(client, {
    tabla: "core.tablero_tarjeta",
    registroId: fila.id,
    accion: creada ? "INSERT" : "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: actual,
    despues: fila,
  });

  const eventos = creada ? ["creacion"] : camposCambiados(actual, fila);

  return {
    creada,
    tarjeta: {
      id: fila.id,
      entidadTipo: fila.entidad_tipo,
      entidadId: fila.entidad_id,
      columna: fila.columna,
      asignacionTexto: fila.asignacion_texto,
      responsableUsuarioId: fila.responsable_usuario_id,
      responsableTexto: fila.responsable_texto,
      fechaLimite: fila.fecha_limite,
      pospuestoHasta: fila.pospuesto_hasta,
      motivoPosposicion: fila.motivo_posposicion,
      orden: fila.orden,
    },
    eventos,
  };
}

async function siguienteOrden(
  client: PoolClient,
  columna: ColumnaTablero,
): Promise<number> {
  const respuesta = await client.query<{ siguiente: number }>(
    `select coalesce(max(orden), 0)::int + 1 as siguiente
       from core.tablero_tarjeta
      where columna = $1`,
    [columna],
  );
  return respuesta.rows[0]?.siguiente ?? 1;
}

type FilaGuardada = {
  id: string;
  entidad_tipo: TipoEntidadTablero;
  entidad_id: string;
  columna: ColumnaTablero;
  asignacion_texto: string | null;
  responsable_usuario_id: string | null;
  responsable_texto: string | null;
  fecha_limite: string | null;
  pospuesto_hasta: string | null;
  motivo_posposicion: string | null;
  orden: number;
};

/** Nombres de evento por campo; se usan como `tipo` del historial. */
const EVENTO_POR_CAMPO: Record<string, string> = {
  columna: "columna",
  asignacion_texto: "asignacion_texto",
  responsable_usuario_id: "responsable_usuario_id",
  responsable_texto: "responsable_texto",
  fecha_limite: "fecha_limite",
  pospuesto_hasta: "posposicion",
  motivo_posposicion: "motivo_posposicion",
  orden: "orden",
};

function camposCambiados(antes: FilaActual, despues: FilaGuardada): string[] {
  const eventos: string[] = [];
  const pares: [keyof FilaActual, keyof FilaGuardada, string][] = [
    ["columna", "columna", "columna"],
    ["asignacion_texto", "asignacion_texto", "asignacion_texto"],
    [
      "responsable_usuario_id",
      "responsable_usuario_id",
      "responsable_usuario_id",
    ],
    ["responsable_texto", "responsable_texto", "responsable_texto"],
    ["fecha_limite", "fecha_limite", "fecha_limite"],
    ["pospuesto_hasta", "pospuesto_hasta", "posposicion"],
    ["motivo_posposicion", "motivo_posposicion", "motivo_posposicion"],
    ["orden", "orden", "orden"],
  ];

  for (const [campoAntes, campoDespues, evento] of pares) {
    if (antes[campoAntes] !== despues[campoDespues]) eventos.push(evento);
  }
  return eventos;
}

async function registrarCambios(
  client: PoolClient,
  tarjetaId: string,
  antes: FilaActual,
  despues: FilaGuardada,
  usuarioId: string,
): Promise<void> {
  const pares: [string, unknown, unknown][] = [
    ["columna", antes.columna, despues.columna],
    ["asignacion_texto", antes.asignacion_texto, despues.asignacion_texto],
    [
      "responsable_usuario_id",
      antes.responsable_usuario_id,
      despues.responsable_usuario_id,
    ],
    ["responsable_texto", antes.responsable_texto, despues.responsable_texto],
    ["fecha_limite", antes.fecha_limite, despues.fecha_limite],
    ["pospuesto_hasta", antes.pospuesto_hasta, despues.pospuesto_hasta],
    [
      "motivo_posposicion",
      antes.motivo_posposicion,
      despues.motivo_posposicion,
    ],
    ["orden", antes.orden, despues.orden],
  ];

  for (const [campo, anterior, nuevo] of pares) {
    if (anterior === nuevo) continue;
    const tipo = EVENTO_POR_CAMPO[campo] ?? campo;
    await registrarEvento(client, tarjetaId, tipo, anterior, nuevo, usuarioId);
  }
}

async function registrarEvento(
  client: PoolClient,
  tarjetaId: string,
  tipo: string,
  anterior: unknown,
  nuevo: unknown,
  usuarioId: string,
): Promise<void> {
  await client.query(
    `insert into core.tablero_tarjeta_evento
       (tarjeta_id, tipo, valor_anterior, valor_nuevo, usuario_id)
     values ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::uuid)`,
    [
      tarjetaId,
      tipo,
      anterior === undefined ? null : JSON.stringify(anterior),
      nuevo === undefined ? null : JSON.stringify(nuevo),
      usuarioId,
    ],
  );
}

/**
 * Expuesto para pruebas de contrato: la misma regla que usa la UI para decidir
 * si una tarjeta está «sin responsable».
 */
export function tarjetaTieneResponsable(tarjeta: TarjetaTablero): boolean {
  return tieneResponsable(tarjeta);
}
