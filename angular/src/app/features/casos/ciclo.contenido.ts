/**
 * Componentes del ciclo de intervención sectorial (Guía §8).
 *
 * Fuente única de los cinco componentes: los consume «Ayuda y criterios»
 * (`features/ayuda/ayuda.contenido.ts`), no la ficha (decisión X1). El orden es
 * el de la Guía y no implica sucesión: los componentes pueden coexistir.
 */
export type ComponenteCiclo = {
  /** Ancla estable de la entrada en `/ayuda#<id>`. */
  id: string;
  nombre: string;
  definicion: string;
};

/** Aclaración que acompaña a los componentes donde se muestran (item 96). */
export const ACLARACION_CICLO =
  'Los componentes son una representación metodológica para orientar la intervención: no son etapas sucesivas ni rígidas. Pueden ocurrir simultáneamente y no son etapas rígidas: se desarrollan de manera simultánea, complementaria o iterativa según cada caso.';

export const COMPONENTES_CICLO: readonly ComponenteCiclo[] = [
  {
    id: 'ciclo-prevencion-estrategica',
    nombre: 'Prevención estratégica',
    definicion:
      'Actúa sobre condiciones estructurales, institucionales y relacionales de largo plazo mediante la articulación, el relacionamiento territorial y la construcción de infraestructura para la paz.',
  },
  {
    id: 'ciclo-prevencion-operativa',
    nombre: 'Prevención operativa',
    definicion:
      'Centrada en el monitoreo y el análisis coyuntural para una intervención temprana que evite el escalamiento de tensiones. Gestiona diferencias y controversias y atiende oportunamente las demandas.',
  },
  {
    id: 'ciclo-intervencion',
    nombre: 'Intervención y tratamiento',
    definicion:
      'Acciones, mecanismos de coordinación y procesos de diálogo frente a escenarios de controversia, conflicto manifiesto o crisis social. Integra la articulación institucional multinivel, la conducción técnica del diálogo, la gestión situada de demandas y el análisis territorial.',
  },
  {
    id: 'ciclo-monitoreo',
    nombre: 'Monitoreo de compromisos',
    definicion:
      'Registro, actualización y verificación continua de casos, acuerdos, compromisos y acciones desplegadas. Permite construir trazabilidad, identificar riesgos de reescalamiento y generar información operativa para decidir.',
  },
  {
    id: 'ciclo-conocimiento',
    nombre: 'Gestión de la información y del conocimiento',
    definicion:
      'Proceso transversal que organiza y analiza la información generada durante la intervención —matrices, alertas, reportes de clima social y análisis de caso— para fortalecer la toma de decisiones y mejorar las estrategias de prevención.',
  },
];
