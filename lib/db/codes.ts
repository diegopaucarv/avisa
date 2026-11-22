import type { PoolClient } from "pg";

const TABLE = /^[a-z_]+\.[a-z_]+$/;
const COLUMN = /^[a-z_]+$/;

/**
 * Códigos legibles y correlativos (CS-PRODUCE-2026-015, AT-2026-046…).
 *
 * La base no tiene secuencias para estos códigos, así que se toma el mayor
 * sufijo numérico existente. En concurrencia dos altas podrían chocar; el
 * llamador debe reintentar una vez ante un 23505 (unique violation).
 *
 * `table` y `column` NO son entrada del usuario: son literales del código.
 */
export async function nextSequentialCode(
  client: PoolClient,
  table: string,
  column: string,
  prefix: string,
  digits = 3,
): Promise<string> {
  if (!TABLE.test(table) || !COLUMN.test(column)) {
    throw new Error("nextSequentialCode: identificador inválido");
  }

  const result = await client.query<{ next: number }>(
    `select coalesce(max((regexp_match(${column}, '(\\d+)\\s*$'))[1]::int), 0) + 1 as next
       from ${table}
      where ${column} like $1`,
    [`${prefix}%`],
  );

  const next = result.rows[0]?.next ?? 1;
  return `${prefix}${String(next).padStart(digits, "0")}`;
}
