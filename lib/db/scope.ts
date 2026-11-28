import type { SessionPayload } from "./auth";

export type DataScope = {
  /**
   * "all" = sin recorte de datos.
   * "regions" = el usuario sólo consulta los territorios asignados en
   * `core.usuario_territorio` (los que `core.autenticar_usuario` entrega en
   * `regiones` y la sesión guarda en `regs`).
   */
  mode: "all" | "regions";
  regiones: string[];
};

/**
 * Alcance de datos de la sesión.
 *
 * Decisión del producto: el sectorista ve por defecto su territorio, mientras
 * que Dirección, Alta Dirección y Administración siguen viendo todo. El recorte
 * se expresa aquí, en un único punto, para que las rutas lo traduzcan a filtros
 * de consulta; no se delega al cliente.
 *
 * `regs` llega vacío cuando la cuenta no tiene filas en
 * `core.usuario_territorio`. En ese caso se devuelve "all": una asignación
 * ausente no debe dejar al usuario sin datos. Dirección, Alta Dirección y
 * Administración tienen prioridad de rol sobre `sectorista` en
 * `core.autenticar_usuario`, así que `session.rol` ya los descarta.
 */
export function resolveDataScope(session: SessionPayload): DataScope {
  const regiones = session.regs ?? [];
  if (session.rol === "sectorista" && regiones.length > 0) {
    return { mode: "regions", regiones };
  }
  return { mode: "all", regiones };
}
