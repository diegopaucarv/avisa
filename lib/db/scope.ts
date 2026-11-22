import type { SessionPayload } from "./auth";

export type DataScope = {
  /**
   * "all" = sin recorte de datos (decisión vigente para todos los roles).
   * "regions" queda reservado para cuando se definan bloqueos por territorio.
   */
  mode: "all" | "regions";
  regiones: string[];
};

/**
 * Alcance de datos de la sesión.
 *
 * Decisión del producto (D3): Dirección, Alta Dirección y Administración ven
 * todo; los perfiles territoriales también ven todo. La diferencia entre roles
 * es de presentación, no de acceso. Cuando se definan bloqueos reales, este es
 * el único punto que debe cambiar; ninguna consulta filtra por región.
 */
export function resolveDataScope(session: SessionPayload): DataScope {
  return { mode: "all", regiones: session.regs };
}
