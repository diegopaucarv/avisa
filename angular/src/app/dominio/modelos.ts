/**
 * Modelo de dominio en español.
 *
 * La API responde hoy con claves en inglés; el mapeo vive en `mapeo.ts` y es el
 * único lugar donde se traduce. A partir de aquí, toda la UI habla español.
 * Los valores de catálogo están CONGELADOS según la Guía (ver docs).
 */

/** Niveles de conflictividad (Guía §7.5.1). */
export type NivelConflicto = 'Diferencia' | 'Controversia' | 'Conflicto social' | 'Crisis social';

/** Riesgo del caso: atributo propio, recalculable. «Moderado», nunca «Medio». */
export type Riesgo = 'Bajo' | 'Moderado' | 'Alto';

/** Prioridad de atención (eje distinto del riesgo). */
export type PrioridadAtencion = 'Urgente' | 'Moderado' | 'Bajo';

export type EstadoCaso = 'Activo' | 'En seguimiento' | 'Resuelto' | 'Archivado';

export type Alcance = 'Norte' | 'Centro' | 'Sur' | 'Oriente' | 'Nacional';

/**
 * Procedencia técnica de `core.casos.origen_dato`. `KAG` y `Workflow` son
 * códigos de ingesta automática y tienen etiqueta propia (gap D10); no deben
 * confundirse con un alta manual.
 */
export type OrigenDato = 'Manual' | 'Ingesta' | 'KAG' | 'Workflow' | 'Legado' | 'WhatsApp';

/** Etapas del ciclo de gestión (Guía §8). */
export type EtapaCiclo =
  | 'Prevención estratégica'
  | 'Prevención operativa'
  | 'Intervención y tratamiento'
  | 'Monitoreo de compromisos'
  | 'Gestión de la información y del conocimiento';

export type Caso = {
  id: string;
  codigo: string;
  titulo: string;
  resumen: string | null;
  avance: number | null;
  /**
   * Instante de la última actualización (`fecha_ultima_actualizacion`). Es la
   * hora de carga del legado para casi todas las filas, así que **no** debe
   * rotularse como «Actualizado» en la UI. Queda reservado al historial de
   * estados (item 41); hoy ninguna plantilla lo consume.
   */
  actualizado: string | null;
  /** Fecha real del caso (`fecha_inicio`), no la de carga del legado. */
  inicio: string | null;
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
  /** ISO de la anulación lógica; `null` mientras el registro está activo. */
  anuladoEn: string | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
};
