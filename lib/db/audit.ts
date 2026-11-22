import type { PoolClient } from "pg";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

export type AuditEntry = {
  tabla: string;
  registroId: string;
  accion: AuditAction;
  usuarioId: string;
  rolCodigo: string;
  antes?: Record<string, unknown> | null;
  despues?: Record<string, unknown> | null;
};

/**
 * Bitácora genérica de escrituras.
 *
 * Se escribe en la MISMA transacción que el cambio: si la escritura falla, la
 * auditoría revierte con ella. Nunca se guardan valores descifrados de PII:
 * los repos de escritura no descifran.
 */
export async function auditChange(
  client: PoolClient,
  entry: AuditEntry,
): Promise<void> {
  await client.query(
    `insert into audit.cambios
       (tabla, registro_id, accion, usuario_id, rol_codigo, datos_antes, datos_despues)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      entry.tabla,
      entry.registroId,
      entry.accion,
      entry.usuarioId,
      entry.rolCodigo,
      entry.antes ? JSON.stringify(entry.antes) : null,
      entry.despues ? JSON.stringify(entry.despues) : null,
    ],
  );
}
