import type { PoolClient } from "pg";

import { auditChange } from "../audit";
import { ApiError } from "../errors";
import type { DbSession } from "../tenant";
import { normalizarMotivo } from "./anulacion";

/**
 * Hechos recientes de una alerta como filas (`core.alerta_hechos`, migración 73).
 *
 * El texto `core.alertas_tempranas.hechos_recientes` sigue existiendo y es lo que
 * consumen la plantilla de WhatsApp y las exportaciones. Por eso cada escritura
 * de un hecho **recompone** ese texto en la misma transacción: la tabla manda,
 * el texto es su proyección legible.
 *
 * La tabla hija no tiene RLS; el control de acceso lo impone la alerta padre
 * (`core.alertas_tempranas` sí la tiene). Toda operación resuelve primero el id
 * de la alerta con el rol de la sesión: si la alerta no es visible, responde 404
 * y no se toca ninguna fila. Además, la recomposición escribe en el padre y, si
 * la política de UPDATE no lo permite (0 filas), lanza 403 y revierte el lote.
 */

export type HechoScope = DbSession;

export type AlertaHecho = {
  id: string;
  alertaId: string;
  /** `YYYY-MM-DD`, o `null` si el hecho no tiene fecha. */
  fecha: string | null;
  descripcion: string;
  orden: number;
  createdAt: string;
};

export type HechoListado = {
  items: AlertaHecho[];
  /**
   * `true` si la alerta ya tiene alguna fila, aunque todas estén anuladas. La
   * interfaz lo usa para no «resucitar» el texto heredado cuando el usuario ya
   * quitó todos los hechos.
   */
  inicializada: boolean;
};

const MAX_DESCRIPCION = 2000;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mes en tres letras mayúsculas, con `SET` para setiembre.
 *
 * Debe coincidir con `MESES_HECHO` de `alerta.mapeo.ts` (que además admite
 * `SEP`) y con `formatearFecha` de la SPA: el texto que se genera aquí tiene que
 * poder reparsearse allí tal cual.
 */
const MESES_HECHO = [
  "ENE",
  "FEB",
  "MAR",
  "ABR",
  "MAY",
  "JUN",
  "JUL",
  "AGO",
  "SET",
  "OCT",
  "NOV",
  "DIC",
] as const;

type FilaHecho = {
  id: string;
  alerta_id: string;
  fecha: string | null;
  descripcion: string;
  orden: number;
  created_at: Date | string;
};

function aHecho(fila: FilaHecho): AlertaHecho {
  return {
    id: fila.id,
    alertaId: fila.alerta_id,
    fecha: fila.fecha ? String(fila.fecha).slice(0, 10) : null,
    descripcion: fila.descripcion,
    orden: Number(fila.orden),
    createdAt:
      fila.created_at instanceof Date
        ? fila.created_at.toISOString()
        : String(fila.created_at),
  };
}

/**
 * Resuelve `[id]` de la URL, que puede ser el uuid o el código legible
 * (`AT-2026-01`). Se compara como texto para no castear una entrada que no es
 * uuid. Si la RLS no deja ver la alerta, no hay fila y se responde 404: no se
 * filtra si existe pero está fuera de nivel.
 */
async function resolverAlertaId(
  client: PoolClient,
  idOCodigo: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id
       from core.alertas_tempranas
      where id::text = $1 or codigo_alerta = $1
      order by (id::text = $1) desc
      limit 1`,
    [idOCodigo],
  );
  const id = rows[0]?.id;
  if (!id) throw new ApiError(404, "La alerta no existe.", "NOT_FOUND");
  return id;
}

/** Descripción obligatoria, sin espacios sobrantes y acotada en longitud. */
function leerDescripcion(valor: unknown, obligatoria: boolean): string | null {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto) {
    if (!obligatoria) return null;
    throw new ApiError(
      422,
      "La descripción del hecho es obligatoria.",
      "DESCRIPCION_REQUERIDA",
    );
  }
  if (texto.length > MAX_DESCRIPCION) {
    throw new ApiError(
      422,
      `La descripción del hecho no puede superar ${MAX_DESCRIPCION} caracteres.`,
      "DESCRIPCION_LARGA",
    );
  }
  return texto;
}

/**
 * Fecha opcional en `YYYY-MM-DD`. Se valida aquí y no en SQL porque un
 * `::date` inválido cae en un error que `jsonError` no sabe traducir (500 en vez
 * de 422). `null`, `""` o la clave ausente significan «sin fecha».
 */
function leerFecha(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (typeof valor !== "string") {
    throw new ApiError(
      422,
      "La fecha del hecho no es válida.",
      "FECHA_INVALIDA",
    );
  }

  const texto = valor.trim();
  if (!texto) return null;
  if (!FECHA_RE.test(texto)) {
    throw new ApiError(
      422,
      "La fecha del hecho no es válida (se espera AAAA-MM-DD).",
      "FECHA_INVALIDA",
    );
  }

  const [anio, mes, dia] = texto.split("-").map(Number);
  const prueba = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    prueba.getUTCFullYear() !== anio ||
    prueba.getUTCMonth() !== mes - 1 ||
    prueba.getUTCDate() !== dia
  ) {
    throw new ApiError(
      422,
      "La fecha del hecho no existe en el calendario.",
      "FECHA_INVALIDA",
    );
  }
  return texto;
}

function tieneClave(body: Record<string, unknown>, clave: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, clave);
}

/** `2026-11-05` → `05NOV2026`, el mismo formato que pinta la SPA. */
function etiquetaFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  const nombre = MESES_HECHO[Number(mes) - 1];
  if (!nombre) return iso;
  return `${dia}${nombre}${anio}`;
}

/** Una línea del texto derivado, en la forma que entiende `partirHecho`. */
function lineaHecho(fila: { fecha: string | null; descripcion: string }): string {
  return fila.fecha
    ? `- ${etiquetaFecha(fila.fecha)} — ${fila.descripcion}`
    : `- ${fila.descripcion}`;
}

/**
 * Recompone `core.alertas_tempranas.hechos_recientes` desde las filas vigentes.
 *
 * Se ejecuta dentro de la transacción de la petición, de modo que un fallo deja
 * tabla y texto coherentes (o ninguno de los dos cambia). Si la política de
 * UPDATE del padre no alcanza la alerta, `rowCount` es 0: se lanza 403 para que
 * `withSession` revierta la escritura del hijo.
 */
async function recomponerHechos(
  client: PoolClient,
  alertaId: string,
): Promise<void> {
  const { rows } = await client.query<{ fecha: string | null; descripcion: string }>(
    `select to_char(fecha, 'YYYY-MM-DD') as fecha, descripcion
       from core.alerta_hechos
      where alerta_id = $1::uuid and anulado_en is null
      order by orden asc, fecha asc nulls last, created_at asc`,
    [alertaId],
  );

  const texto = rows.length ? rows.map(lineaHecho).join("\n") : null;
  const { rowCount } = await client.query(
    `update core.alertas_tempranas
        set hechos_recientes = $2
      where id = $1::uuid`,
    [alertaId, texto],
  );

  if ((rowCount ?? 0) === 0) {
    throw new ApiError(
      403,
      "Sin permiso para modificar esta alerta.",
      "SIN_PERMISO",
    );
  }
}

export async function listHechos(
  client: PoolClient,
  idOCodigo: string,
): Promise<HechoListado> {
  const alertaId = await resolverAlertaId(client, idOCodigo);

  const { rows } = await client.query<FilaHecho>(
    `select id, alerta_id, to_char(fecha, 'YYYY-MM-DD') as fecha,
            descripcion, orden, created_at
       from core.alerta_hechos
      where alerta_id = $1::uuid and anulado_en is null
      order by orden asc, fecha asc nulls last, created_at asc`,
    [alertaId],
  );

  // Se mira también lo anulado: si la alerta ya tuvo hechos y se quitaron todos,
  // el texto heredado no debe volver a mostrarse como si nunca se hubiera tocado.
  const inicializada = await client.query(
    `select 1 from core.alerta_hechos where alerta_id = $1::uuid limit 1`,
    [alertaId],
  );

  return {
    items: rows.map(aHecho),
    inicializada: (inicializada.rowCount ?? 0) > 0,
  };
}

export async function createHecho(
  client: PoolClient,
  scope: HechoScope,
  idOCodigo: string,
  body: Record<string, unknown>,
): Promise<AlertaHecho> {
  const alertaId = await resolverAlertaId(client, idOCodigo);
  const descripcion = leerDescripcion(body.descripcion, true) as string;
  const fecha = leerFecha(body.fecha);

  // `orden` incluye lo anulado para no reutilizar posiciones; el desempate real
  // de la lectura es la fecha y, después, `created_at`.
  const ordenResult = await client.query<{ orden: number }>(
    `select coalesce(max(orden), 0) + 1 as orden
       from core.alerta_hechos
      where alerta_id = $1::uuid`,
    [alertaId],
  );
  const orden = Number(ordenResult.rows[0]?.orden ?? 1);

  const { rows } = await client.query<FilaHecho>(
    `insert into core.alerta_hechos
        (alerta_id, fecha, descripcion, orden, created_by)
     values ($1::uuid, $2::date, $3, $4, $5::uuid)
     returning id, alerta_id, to_char(fecha, 'YYYY-MM-DD') as fecha,
               descripcion, orden, created_at`,
    [alertaId, fecha, descripcion, orden, scope.usuarioId],
  );

  const hecho = aHecho(rows[0]);
  await recomponerHechos(client, alertaId);

  await auditChange(client, {
    tabla: "core.alerta_hechos",
    registroId: hecho.id,
    accion: "INSERT",
    usuarioId: scope.usuarioId,
    rolCodigo: scope.rolCodigo,
    antes: null,
    despues: {
      alertaId,
      fecha: hecho.fecha,
      descripcion: hecho.descripcion,
      orden: hecho.orden,
    },
  });

  return hecho;
}

export async function updateHecho(
  client: PoolClient,
  scope: HechoScope,
  idOCodigo: string,
  hechoId: string,
  body: Record<string, unknown>,
): Promise<AlertaHecho> {
  const alertaId = await resolverAlertaId(client, idOCodigo);
  if (!UUID_RE.test(hechoId)) {
    throw new ApiError(404, "El hecho no existe.", "NOT_FOUND");
  }

  const cambiaFecha = tieneClave(body, "fecha");
  const cambiaDescripcion = tieneClave(body, "descripcion");
  if (!cambiaFecha && !cambiaDescripcion) {
    throw new ApiError(
      422,
      "No hay cambios que guardar en el hecho.",
      "SIN_CAMBIOS",
    );
  }

  // Se lee antes de escribir para auditar el valor anterior y para responder 404
  // de forma consistente si el hecho no pertenece a esta alerta o está anulado.
  const previo = await client.query<FilaHecho>(
    `select id, alerta_id, to_char(fecha, 'YYYY-MM-DD') as fecha,
            descripcion, orden, created_at
       from core.alerta_hechos
      where id = $1::uuid and alerta_id = $2::uuid and anulado_en is null`,
    [hechoId, alertaId],
  );
  const antes = previo.rows[0];
  if (!antes) throw new ApiError(404, "El hecho no existe.", "NOT_FOUND");

  const sets: string[] = [];
  const params: unknown[] = [];
  if (cambiaDescripcion) {
    const descripcion = leerDescripcion(body.descripcion, true) as string;
    params.push(descripcion);
    sets.push(`descripcion = $${params.length}`);
  }
  if (cambiaFecha) {
    const fecha = leerFecha(body.fecha);
    params.push(fecha);
    sets.push(`fecha = $${params.length}::date`);
  }

  params.push(hechoId);
  const hechoParam = params.length;
  params.push(alertaId);
  const alertaParam = params.length;

  const { rows } = await client.query<FilaHecho>(
    `update core.alerta_hechos
        set ${sets.join(", ")}
      where id = $${hechoParam}::uuid
        and alerta_id = $${alertaParam}::uuid
        and anulado_en is null
      returning id, alerta_id, to_char(fecha, 'YYYY-MM-DD') as fecha,
                descripcion, orden, created_at`,
    params,
  );
  const fila = rows[0];
  if (!fila) throw new ApiError(404, "El hecho no existe.", "NOT_FOUND");

  const hecho = aHecho(fila);
  await recomponerHechos(client, alertaId);

  await auditChange(client, {
    tabla: "core.alerta_hechos",
    registroId: hecho.id,
    accion: "UPDATE",
    usuarioId: scope.usuarioId,
    rolCodigo: scope.rolCodigo,
    antes: {
      fecha: antes.fecha,
      descripcion: antes.descripcion,
      orden: Number(antes.orden),
    },
    despues: {
      fecha: hecho.fecha,
      descripcion: hecho.descripcion,
      orden: hecho.orden,
    },
  });

  return hecho;
}

/**
 * Baja lógica del hecho. `core.anular_registro` no cubre esta tabla, así que se
 * marca `anulado_en = now()` directamente. El motivo se valida igual que en el
 * resto de anulaciones (la API lo exige; aquí se corta antes con 400).
 */
export async function deleteHecho(
  client: PoolClient,
  scope: HechoScope,
  idOCodigo: string,
  hechoId: string,
  motivo: string | undefined,
): Promise<void> {
  const razon = normalizarMotivo(motivo);
  const alertaId = await resolverAlertaId(client, idOCodigo);
  if (!UUID_RE.test(hechoId)) {
    throw new ApiError(404, "El hecho no existe.", "NOT_FOUND");
  }

  const { rows } = await client.query<{
    id: string;
    fecha: string | null;
    descripcion: string;
    orden: number;
    anulado_en: unknown;
  }>(
    `update core.alerta_hechos
        set anulado_en = now()
      where id = $1::uuid and alerta_id = $2::uuid and anulado_en is null
      returning id, to_char(fecha, 'YYYY-MM-DD') as fecha, descripcion, orden,
                anulado_en`,
    [hechoId, alertaId],
  );
  const fila = rows[0];
  if (!fila) throw new ApiError(404, "El hecho no existe.", "NOT_FOUND");

  await recomponerHechos(client, alertaId);

  const anuladoEn =
    fila.anulado_en instanceof Date
      ? fila.anulado_en.toISOString()
      : fila.anulado_en;

  await auditChange(client, {
    tabla: "core.alerta_hechos",
    registroId: hechoId,
    accion: "DELETE",
    usuarioId: scope.usuarioId,
    rolCodigo: scope.rolCodigo,
    antes: {
      fecha: fila.fecha,
      descripcion: fila.descripcion,
      orden: Number(fila.orden),
    },
    despues: { anuladoEn, motivo: razon },
  });
}
