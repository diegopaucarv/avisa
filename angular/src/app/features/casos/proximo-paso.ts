import type { Riesgo } from '../../dominio/modelos';

/**
 * «Próximo paso» (item 19): orientación de respuesta por nivel de riesgo.
 *
 * El texto es la columna «Orientación de Respuesta» de la Tabla 3 de la Guía
 * (`docs/01_requisitos/guia.md`, §7.5.2), transcrito viñeta a viñeta. No se
 * resume, no se añade ninguna recomendación propia y no depende de datos que la
 * ficha no tenga: sólo del riesgo del caso.
 */
export type OrientacionRiesgo = {
  pasos: readonly string[];
  regla: string;
  fuente: string;
};

const REGLA = 'Tabla 3 — Niveles de riesgo, indicadores y orientación de respuesta institucional';

const FUENTE = 'Guía §7.5.2';

const ORIENTACIONES: Record<Riesgo, readonly string[]> = {
  Bajo: [
    'Monitoreo preventivo.',
    'Mantenimiento de canales de comunicación sectoriales y atención regular de los requerimientos para sostener la estabilidad territorial.',
  ],
  Moderado: [
    'Activación de mecanismos de prevención y articulación intergubernamental.',
    'Reforzamiento de la interlocución en el territorio y evaluación de estrategias sectoriales de atención temprana.',
  ],
  Alto: [
    'Intervención prioritaria y articulación multisectorial de alto nivel.',
    'Despliegue inmediato de medidas de contención, gestión de crisis y mitigación de impactos directos sobre el sector productivo.',
  ],
};

export function orientacionPorRiesgo(riesgo: Riesgo): OrientacionRiesgo {
  return { pasos: ORIENTACIONES[riesgo], regla: REGLA, fuente: FUENTE };
}
