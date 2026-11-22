/**
 * Componentes del ciclo de intervención sectorial (Guía §8).
 *
 * Mismo texto que `features/ayuda/ayuda.contenido.ts` (sección `ciclo`), para
 * que la ficha y la ayuda no se contradigan. El orden es el de la Guía y no
 * implica sucesión: los componentes pueden coexistir.
 */
export type ComponenteCiclo = {
  nombre: string;
  definicion: string;
};

export const COMPONENTES_CICLO: readonly ComponenteCiclo[] = [
  {
    nombre: 'Prevención estratégica',
    definicion:
      'Actúa sobre condiciones estructurales, institucionales y relacionales de largo plazo mediante la articulación, el relacionamiento territorial y la construcción de infraestructura para la paz.',
  },
  {
    nombre: 'Prevención operativa',
    definicion:
      'Centrada en el monitoreo y el análisis coyuntural para una intervención temprana que evite el escalamiento de tensiones. Gestiona diferencias y controversias y atiende oportunamente las demandas.',
  },
  {
    nombre: 'Intervención y tratamiento',
    definicion:
      'Acciones, mecanismos de coordinación y procesos de diálogo frente a escenarios de controversia, conflicto manifiesto o crisis social. Integra la articulación institucional multinivel, la conducción técnica del diálogo, la gestión situada de demandas y el análisis territorial.',
  },
  {
    nombre: 'Monitoreo de compromisos',
    definicion:
      'Registro, actualización y verificación continua de casos, acuerdos, compromisos y acciones desplegadas. Permite construir trazabilidad, identificar riesgos de reescalamiento y generar información operativa para decidir.',
  },
  {
    nombre: 'Gestión de la información y del conocimiento',
    definicion:
      'Proceso transversal que organiza y analiza la información generada durante la intervención —matrices, alertas, reportes de clima social y análisis de caso— para fortalecer la toma de decisiones y mejorar las estrategias de prevención.',
  },
];
