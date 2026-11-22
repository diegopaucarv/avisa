import type { PoolClient } from "pg";
import { ApiError } from "../errors";

/**
 * Tablas que acepta `core.anular_registro`. Los casos van aparte porque
 * arrastran toda su jerarquía mediante `core.anular_caso`.
 */
export type TablaAnulable =
  | "alertas_tempranas"
  | "compromisos"
  | "hitos_compromiso"
  | "documentos"
  | "demandas"
  | "caso_cronologia";

export const MOTIVO_ANULACION_REQUERIDO =
  "El motivo de la anulación es obligatorio.";

/**
 * La anulación lógica exige un motivo no vacío. Se valida también aquí para
 * que ningún llamador pueda saltarse la regla de negocio.
 */
export function normalizarMotivo(motivo: string | undefined): string {
  const value = (motivo ?? "").trim();
  if (!value) {
    throw new ApiError(400, MOTIVO_ANULACION_REQUERIDO, "MOTIVO_REQUERIDO");
  }
  return value;
}

/**
 * Anula un registro y devuelve el lote junto con la marca de tiempo que fijó
 * la base. El nombre de tabla está acotado por `TablaAnulable` y la función
 * SQL lo vuelve a validar antes de tocar datos.
 */
export async function anularRegistro(
  client: PoolClient,
  tabla: TablaAnulable,
  id: string,
  motivo?: string,
): Promise<{ anulacionId: string; anuladoEn: unknown; motivo: string }> {
  const razon = normalizarMotivo(motivo);

  const result = await client.query<{ anulacion_id: string }>(
    `select core.anular_registro($1, $2::uuid, $3) as anulacion_id`,
    [tabla, id, razon],
  );

  // `anulado_en` lo fija now() dentro de la función; se relee para auditarlo.
  const after = await client.query<{ anulado_en: unknown }>(
    `select anulado_en from core.${tabla} where id = $1::uuid`,
    [id],
  );

  return {
    anulacionId: String(result.rows[0]?.anulacion_id ?? ""),
    anuladoEn: after.rows[0]?.anulado_en ?? null,
    motivo: razon,
  };
}

/** Restaura el lote de anulación al que pertenece el registro. */
export async function restaurarRegistro(
  client: PoolClient,
  tabla: TablaAnulable,
  id: string,
): Promise<number> {
  const result = await client.query<{ restaurados: number }>(
    `select core.restaurar_registro($1, $2::uuid) as restaurados`,
    [tabla, id],
  );
  return Number(result.rows[0]?.restaurados ?? 0);
}
