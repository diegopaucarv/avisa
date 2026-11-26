import type { PoolClient } from "pg";

import { ApiError } from "../errors";
import type { DbSession } from "../tenant";

/**
 * Resultados de reunión: padrón de asistencia.
 *
 * Este repositorio cubre dos cosas que la pantalla `/resultados` necesita y que
 * ninguna otra ruta sirve:
 *
 *  1. Listar reuniones de diálogo para elegir a cuál se le carga la lista de
 *     asistencia (el alta de reunión y su ficha todavía no existen: no hay
 *     `/api/v1/reuniones`, item 72).
 *  2. Vincular, en una sola transacción, la lista confirmada de asistentes a
 *     `core.reunion_participantes`. Cada fila se aísla con un SAVEPOINT para
 *     poder devolver el detalle por asistente sin abortar el resto.
 *
 * No hay OCR: el texto de la foto de la lista no se reconoce aquí. La lista la
 * escribe y corrige la persona. Lo único que esta capa guarda es el vínculo.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Roles con `core.roles.puede_editar = true`. Es el mismo conjunto que usan los
 * adjuntos (`lib/db/repos/adjuntos.ts`). La tabla `reunion_participantes` no
 * tiene RLS propia (no guarda `nivel_clasificacion`), así que el permiso de
 * escritura se corta aquí antes de tocar la base.
 */
const ROLES_ESCRITURA = new Set([
  "administrador",
  "sectorista",
  "direccion_oaipcs",
  "servicio_agente",
  "auditor",
  "analista_cualitativo",
  "curador_politica",
]);

function puedeEditar(rolCodigo: string): boolean {
  return ROLES_ESCRITURA.has(rolCodigo);
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_ASISTENTES = 300;

export type ReunionResumen = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  /** `YYYY-MM-DD` en horario de Lima. */
  fecha: string;
  lugar: string | null;
  casoCodigo: string | null;
  casoNombre: string | null;
  asistentes: number;
};

export type ReunionesResultado = {
  items: ReunionResumen[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type ReunionesQuery = {
  q?: string;
  page?: number;
  pageSize?: number;
};

type FilaReunion = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  fecha: string;
  lugar: string | null;
  caso_codigo: string | null;
  caso_nombre: string | null;
  asistentes: string | number;
};

/**
 * Lista reuniones ordenadas por fecha descendente. Sin filtro devuelve las más
 * recientes: la pantalla de asistencia suele cargar la reunión de hoy.
 */
export async function listarReuniones(
  client: PoolClient,
  query: ReunionesQuery,
): Promise<ReunionesResultado> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  const termino = (query.q ?? "").trim();
  const params: unknown[] = [];
  const where: string[] = [];

  if (termino) {
    params.push(`%${termino}%`);
    where.push(`(
      core.normalizar_ref(coalesce(r.codigo_reunion, '')) like core.normalizar_ref($${params.length})
      or core.normalizar_ref(coalesce(r.titulo, '')) like core.normalizar_ref($${params.length})
      or core.normalizar_ref(coalesce(r.lugar, '')) like core.normalizar_ref($${params.length})
      or core.normalizar_ref(coalesce(c.codigo_caso, '')) like core.normalizar_ref($${params.length})
      or core.normalizar_ref(coalesce(c.nombre_caso, '')) like core.normalizar_ref($${params.length})
    )`);
  }

  const filtro = where.length ? `where ${where.join(" and ")}` : "";

  const totalRes = await client.query<{ total: number }>(
    `select count(*)::int as total
       from core.reuniones_dialogo r
       left join core.casos c on c.id = r.caso_id
       ${filtro}`,
    params,
  );
  const total = totalRes.rows[0]?.total ?? 0;

  const offset = (page - 1) * pageSize;
  const { rows } = await client.query<FilaReunion>(
    `select
        r.id::text as id,
        r.codigo_reunion as codigo,
        r.titulo,
        to_char((r.fecha at time zone 'America/Lima')::date, 'YYYY-MM-DD') as fecha,
        r.lugar,
        c.codigo_caso as caso_codigo,
        c.nombre_caso as caso_nombre,
        (select count(*)::int
           from core.reunion_participantes p
          where p.reunion_id = r.id and p.asistio) as asistentes
       from core.reuniones_dialogo r
       left join core.casos c on c.id = r.caso_id
       ${filtro}
      order by r.fecha desc, r.id
      limit ${pageSize} offset ${offset}`,
    params,
  );

  return {
    items: rows.map((fila) => ({
      id: fila.id,
      codigo: fila.codigo,
      titulo: fila.titulo,
      fecha: fila.fecha,
      lugar: fila.lugar,
      casoCodigo: fila.caso_codigo,
      casoNombre: fila.caso_nombre,
      asistentes: Number(fila.asistentes ?? 0),
    })),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export type AsistenteEntrada = {
  nombre?: string | null;
  cargo?: string | null;
  actorId?: string | null;
  omitido?: boolean;
};

export type EstadoAsistente = "vinculado" | "omitido" | "error";

export type ResultadoAsistente = {
  nombre: string;
  actorId: string | null;
  estado: EstadoAsistente;
  motivo: string | null;
};

export type VinculacionResultado = {
  reunionId: string;
  items: ResultadoAsistente[];
  resumen: {
    total: number;
    vinculados: number;
    omitidos: number;
    errores: number;
  };
  generatedAt: string;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Vincula los asistentes confirmados a la reunión.
 *
 * Reglas por fila:
 *  - `omitido` (o sin `actorId`) → se declara «omitido», no toca la base.
 *  - `actorId` válido → UPSERT en `core.reunion_participantes`; si el actor no
 *    existe (FK 23503) la fila se marca «error» y las demás continúan.
 *
 * Todo ocurre dentro de la transacción que abre `withSession`; los SAVEPOINT
 * aíslan el fallo de una fila para poder devolver el detalle por asistente.
 * Al final se marca `asistencia_registrada = true` (si la columna existe).
 */
export async function vincularAsistentes(
  client: PoolClient,
  scope: DbSession,
  reunionId: string,
  asistentes: readonly AsistenteEntrada[],
): Promise<VinculacionResultado> {
  if (!puedeEditar(scope.rolCodigo)) {
    throw new ApiError(
      403,
      "Sin permiso para registrar la asistencia de la reunión.",
      "SIN_PERMISO",
    );
  }
  if (!UUID_RE.test(reunionId)) {
    throw new ApiError(
      400,
      "El identificador de la reunión no es válido.",
      "REUNION_INVALIDA",
    );
  }
  if (!Array.isArray(asistentes) || asistentes.length === 0) {
    throw new ApiError(
      422,
      "La lista de asistentes está vacía.",
      "ASISTENTES_VACIO",
    );
  }
  if (asistentes.length > MAX_ASISTENTES) {
    throw new ApiError(
      422,
      `La lista supera el máximo de ${MAX_ASISTENTES} asistentes por envío.`,
      "ASISTENTES_DEMASIADOS",
    );
  }

  const reunion = await client.query(
    `select 1 from core.reuniones_dialogo where id = $1::uuid`,
    [reunionId],
  );
  if (reunion.rowCount === 0) {
    throw new ApiError(
      404,
      "La reunión no existe o no es accesible con la sesión actual.",
      "REUNION_NO_ENCONTRADA",
    );
  }

  const items: ResultadoAsistente[] = [];
  let vinculados = 0;

  for (let i = 0; i < asistentes.length; i += 1) {
    const entrada = asistentes[i] ?? {};
    const nombre = texto(entrada.nombre).slice(0, 255);
    const cargo = texto(entrada.cargo).slice(0, 100) || null;
    const actorId = texto(entrada.actorId) || null;
    const etiqueta = nombre || "(sin nombre)";

    if (entrada.omitido || !actorId) {
      items.push({
        nombre: etiqueta,
        actorId,
        estado: "omitido",
        motivo: entrada.omitido
          ? "Omitido por quien revisó la lista."
          : "Sin actor del directorio vinculado.",
      });
      continue;
    }

    if (!UUID_RE.test(actorId)) {
      items.push({
        nombre: etiqueta,
        actorId,
        estado: "error",
        motivo: "El identificador de actor no es válido.",
      });
      continue;
    }

    const savepoint = `sp_asistente_${i}`;
    await client.query(`savepoint ${savepoint}`);
    try {
      await client.query(
        `insert into core.reunion_participantes
            (reunion_id, actor_uid, cargo, asistio)
         values ($1::uuid, $2::uuid, $3, true)
         on conflict (reunion_id, actor_uid) do update
            set asistio = true,
                cargo = coalesce(excluded.cargo, cargo)`,
        [reunionId, actorId, cargo],
      );
      await client.query(`release savepoint ${savepoint}`);
      items.push({
        nombre: etiqueta,
        actorId,
        estado: "vinculado",
        motivo: null,
      });
      vinculados += 1;
    } catch (error) {
      await client.query(`rollback to savepoint ${savepoint}`);
      const codigo = (error as { code?: string }).code;
      items.push({
        nombre: etiqueta,
        actorId,
        estado: "error",
        motivo:
          codigo === "23503"
            ? "El actor no existe en el directorio."
            : "No se pudo vincular al actor.",
      });
    }
  }

  // La marca de la matriz (`asistencia_registrada`, migración 42) es un extra:
  // si la columna no existe todavía, la transacción sigue sin fallar.
  if (vinculados > 0) {
    await client.query(`savepoint sp_marca_asistencia`);
    try {
      await client.query(
        `update core.reuniones_dialogo
            set asistencia_registrada = true
          where id = $1::uuid`,
        [reunionId],
      );
      await client.query(`release savepoint sp_marca_asistencia`);
    } catch {
      await client.query(`rollback to savepoint sp_marca_asistencia`);
    }
  }

  const omitidos = items.filter((item) => item.estado === "omitido").length;
  const errores = items.filter((item) => item.estado === "error").length;

  return {
    reunionId,
    items,
    resumen: {
      total: items.length,
      vinculados,
      omitidos,
      errores,
    },
    generatedAt: new Date().toISOString(),
  };
}

export type ImagenAdjuntoReunion = {
  id: string;
  nombre: string;
  mime: string | null;
  contenido: Buffer;
};

/**
 * Devuelve el binario de un adjunto sólo si pertenece a la reunión indicada.
 * Lo usa el adaptador de extracción: nunca se procesa una imagen de otra
 * entidad ni de otra sesión.
 */
export async function obtenerImagenDeReunion(
  client: PoolClient,
  reunionId: string,
  adjuntoId: string,
): Promise<ImagenAdjuntoReunion | null> {
  if (!UUID_RE.test(reunionId) || !UUID_RE.test(adjuntoId)) return null;

  const { rows } = await client.query<{
    id: string;
    nombre: string;
    mime: string | null;
    contenido: Buffer | null;
  }>(
    `select id::text as id, nombre, mime, contenido
       from core.adjunto
      where id = $1::uuid
        and entidad_tipo = 'reunion'
        and entidad_id = $2::uuid
        and anulado_en is null`,
    [adjuntoId, reunionId],
  );

  const fila = rows[0];
  if (!fila || !fila.contenido) return null;

  return {
    id: fila.id,
    nombre: fila.nombre,
    mime: fila.mime,
    contenido: fila.contenido,
  };
}
