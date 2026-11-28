import type { SessionPayload } from "./auth";
import { getPool } from "./pool";

/**
 * Auditoría de descargas de datos.
 *
 * Hasta ahora sólo se auditaban las escrituras. Una exportación también saca
 * datos y debe dejar rastro: quién la pidió, de qué entidad y formato, con qué
 * filtros y cuántas filas se llevó. La fila se escribe en `audit.descargas`
 * (migración 88).
 */

/** Entrada que cada ruta arma para registrar su descarga. */
export type DatosDescarga = {
  entidad: string;
  formato?: string | null;
  filtros?: Record<string, unknown> | null;
  filas?: number | null;
};

/**
 * Claves que nunca deben llegar a la bitácora. Las rutas ya eligen sólo los
 * filtros relevantes, pero este filtro evita que un descuido persista un token
 * o una cookie.
 */
const CLAVE_SENSIBLE = /token|cookie|authorization|password|clave|secret|session|jwt/i;

/**
 * Reduce los filtros a un objeto plano de valores escalares. JSONB no admite
 * funciones ni nada exótico, y aquí además se descarta cualquier clave que
 * parezca un secreto.
 */
function sanitizarFiltros(
  filtros: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean> {
  const limpio: Record<string, string | number | boolean> = {};
  if (!filtros) return limpio;

  for (const [clave, valor] of Object.entries(filtros)) {
    if (!clave || CLAVE_SENSIBLE.test(clave)) continue;
    if (
      typeof valor === "string" ||
      typeof valor === "number" ||
      typeof valor === "boolean"
    ) {
      limpio[clave] = valor;
    }
  }
  return limpio;
}

/** Primera IP de `x-forwarded-for`, o `x-real-ip`; `null` si no hay ninguna. */
function ipDe(request: Request): string | null {
  const reenviada = request.headers.get("x-forwarded-for");
  if (reenviada) {
    const primera = reenviada.split(",")[0]?.trim();
    if (primera) return primera;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real || null;
}

/** El id de sesión es un uuid; si no lo fuera, se guarda nulo en vez de fallar. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idUsuario(session: SessionPayload): string | null {
  return UUID.test(session.uid) ? session.uid : null;
}

/**
 * Registra una descarga. Nunca propaga el error: si la tabla no existe todavía
 * o el insert falla, deja un aviso accionable y la descarga continúa. La
 * auditoría no puede tumbar la exportación que el usuario pidió.
 *
 * Usa el pool fuera de la transacción de la consulta: la lectura ya terminó y,
 * así, un fallo de auditoría no arrastra el rollback de los datos.
 */
export async function registrarDescarga(
  request: Request,
  session: SessionPayload,
  datos: DatosDescarga,
): Promise<void> {
  const filas =
    typeof datos.filas === "number" && Number.isFinite(datos.filas)
      ? Math.trunc(datos.filas)
      : null;

  try {
    await getPool().query(
      `insert into audit.descargas
         (usuario_id, usuario_nombre, usuario_rol, entidad, formato, filtros, filas, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        idUsuario(session),
        session.nom ?? null,
        session.rol ?? null,
        datos.entidad,
        datos.formato ?? null,
        JSON.stringify(sanitizarFiltros(datos.filtros)),
        filas,
        ipDe(request),
        request.headers.get("user-agent"),
      ],
    );
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === "42P01") {
      console.warn(
        "[auditoria-descargas] la tabla audit.descargas no existe todavía: aplicá la migración 88_auditoria_descargas_2026_11_28.sql. La descarga se entregó igual.",
        { entidad: datos.entidad },
      );
      return;
    }
    console.warn(
      "[auditoria-descargas] no se pudo registrar la descarga; la respuesta se entrega igual.",
      { entidad: datos.entidad, formato: datos.formato, error },
    );
  }
}
