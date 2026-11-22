/**
 * Modelo de dominio en español.
 *
 * La API responde hoy con claves en inglés; el mapeo vive en `mapeo.ts` y es el
 * único lugar donde se traduce. A partir de aquí, toda la UI habla español.
 * Los valores de catálogo están CONGELADOS según la Guía (ver docs).
 */

/** Niveles de conflictividad (Guía §7.5.1). */
export type NivelConflicto =
  | "Diferencia"
  | "Controversia"
  | "Conflicto social"
  | "Crisis social";

/** Riesgo del caso: atributo propio, recalculable. «Moderado», nunca «Medio». */
export type Riesgo = "Bajo" | "Moderado" | "Alto";

/** Prioridad de atención (eje distinto del riesgo). */
export type PrioridadAtencion = "Urgente" | "Moderado" | "Bajo";

export type EstadoCaso = "Activo" | "En seguimiento" | "Resuelto" | "Archivado";

export type Alcance = "Norte" | "Centro" | "Sur" | "Oriente" | "Nacional";

export type OrigenDato = "Manual" | "Ingesta" | "Legado" | "WhatsApp";

/** Etapas del ciclo de gestión (Guía §8). */
export type EtapaCiclo =
  | "Prevención estratégica"
  | "Prevención operativa"
  | "Intervención y tratamiento"
  | "Monitoreo de compromisos"
  | "Gestión de la información y del conocimiento";

export type Caso = {
  id: string;
  codigo: string;
  titulo: string;
  resumen: string | null;
  avance: number | null;
  actualizado: string | null;
  region: string | null;
  estado: EstadoCaso;
  /** Riesgo del caso. Se recalcula en el caso, no se hereda de la alerta. */
  riesgo: Riesgo;
  prioridad: PrioridadAtencion;
  alcance: Alcance;
  nivelConflicto: NivelConflicto;
  etapa: EtapaCiclo;
  tematica: string | null;
  subsector: string | null;
  unidadResponsable: string | null;
  origen: OrigenDato;
  clasificacion: number;
  anulado: boolean;
};
