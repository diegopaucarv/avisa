/**
 * Glosario compartido de los botones ⓘ.
 *
 * Fuente única de las definiciones cortas que se muestran junto a un campo o
 * una etiqueta. Cada entrada enlaza a la sección de «Ayuda y criterios» que
 * amplía el término (`ayudaId`), de modo que el ⓘ y la ayuda nunca se
 * contradicen. No reproduce la Guía: es un resumen de una a tres frases.
 */
export type EntradaGlosario = {
  id: string;
  termino: string;
  definicion: string;
  fuente: string;
  /** Ancla de `/ayuda#<id>`: la sección de la ayuda que amplía el término. */
  ayudaId: string;
};

export const GLOSARIO: Record<string, EntradaGlosario> = {
  'nivel-conflictividad': {
    id: 'nivel-conflictividad',
    termino: 'Nivel de conflictividad',
    definicion:
      'Grado de exteriorización pública de la discrepancia entre actores, de la diferencia latente a la crisis social. Es un eje distinto del nivel de riesgo.',
    fuente: 'Guía §7.5.1',
    ayudaId: 'niveles',
  },
  'nivel-riesgo': {
    id: 'nivel-riesgo',
    termino: 'Nivel de riesgo',
    definicion:
      'Probabilidad de escalamiento, agravamiento o reactivación de la situación. Se evalúa de forma independiente del nivel de conflictividad.',
    fuente: 'Guía §7.5.2 · Tabla 3',
    ayudaId: 'riesgos',
  },
  tematica: {
    id: 'tematica',
    termino: 'Temática',
    definicion:
      'Naturaleza de la disputa y rol del sector. Una sola temática por caso, entre las seis de la Guía; no admite texto libre.',
    fuente: 'Guía §7.6',
    ayudaId: 'tematicas',
  },
  subsector: {
    id: 'subsector',
    termino: 'Subsector',
    definicion:
      'Bloque de actividad al que pertenece el caso. Fija el prefijo de su código: PA o MI.',
    fuente: 'Guía §7.2 · Anexo 15',
    ayudaId: 'subsectores',
  },
  'prioridad-atencion': {
    id: 'prioridad-atencion',
    termino: 'Prioridad de atención',
    definicion:
      'Prontitud del seguimiento. Es un eje propio, separado del riesgo. La Guía lista la columna pero no publica su regla de cálculo, así que no se deriva automáticamente del riesgo.',
    fuente: 'Guía §8.3.1',
    ayudaId: 'prioridades-atencion',
  },
  'tipo-actor': {
    id: 'tipo-actor',
    termino: 'Tipo de actor',
    definicion: 'Categoría del actor según su naturaleza: social, público o privado.',
    fuente: 'Guía §7.4',
    ayudaId: 'actores',
  },
  'funcion-actor': {
    id: 'funcion-actor',
    termino: 'Función del actor',
    definicion:
      'Rol que cumple en la intervención: principal, secundario o tercero imparcial. No es estático: puede cambiar según la etapa y el espacio de interacción.',
    fuente: 'Guía §7.4',
    ayudaId: 'actores',
  },
  '3p': {
    id: '3p',
    termino: 'Problema, propuesta y pedido (3P)',
    definicion:
      'Ordena el análisis de una demanda: el problema es la situación o afectación percibida; la propuesta, la alternativa de solución o mejora; y el pedido, el requerimiento concreto hacia la entidad competente. Un pedido no es un compromiso.',
    fuente: 'Guía §7.7',
    ayudaId: 'demandas',
  },
  'tipo-compromiso': {
    id: 'tipo-compromiso',
    termino: 'Tipo de compromiso',
    definicion:
      'Naturaleza de la obligación asumida: una actividad de gestión o un proyecto de inversión pública (PIP).',
    fuente: 'Guía §8.3.2 · Anexo 14',
    ayudaId: 'tipos-compromiso',
  },
  'nivel-gobierno': {
    id: 'nivel-gobierno',
    termino: 'Nivel de gobierno',
    definicion:
      'Nivel de la entidad responsable: Nacional, Regional (GORE), Local, Empresa o Sociedad Civil.',
    fuente: 'Guía §7.4',
    ayudaId: 'niveles-gobierno',
  },
};
