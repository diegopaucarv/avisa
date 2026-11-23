/**
 * Vocabulario de rol que publica `/api/auth/login`.
 *
 * Los códigos de rol de la base (`administrador`, `sectorista`, …) no son
 * etiquetas de interfaz. La base decide el rol vigente —ya ordenado por
 * precedencia— y aquí sólo se traduce al vocabulario que consume el cliente.
 */
export type Role =
  | "Admin"
  | "Sectorista"
  | "Directora"
  | "PuntoFocal"
  | "Autoridad";

export const UI_ROLE: Record<string, Role> = {
  direccion_oaipcs: "Directora",
  administrador: "Admin",
  alta_direccion: "Autoridad",
  sectorista: "Sectorista",
  consulta_lectura: "PuntoFocal",
};
