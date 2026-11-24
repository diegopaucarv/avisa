/**
 * Contenido de «Ayuda y criterios».
 *
 * Todo el texto se redacta a partir de `docs/01_requisitos/guia.md` y del
 * glosario de alineación (`docs/01_requisitos/GLOSARIO_ALINEACION_GUIA.md`).
 * No hay llamadas a la API: esta pantalla es consulta normativa.
 */

export type EntradaAyuda = {
  id: string;
  termino: string;
  definicion: string;
  detalles?: readonly string[];
  fuente?: string;
};

export type SeccionAyuda = {
  id: string;
  titulo: string;
  introduccion?: string;
  fuente?: string;
  entradas: readonly EntradaAyuda[];
};

export const SECCIONES_AYUDA: readonly SeccionAyuda[] = [
  {
    id: 'enfoques',
    titulo: 'Enfoques de la gestión',
    fuente: 'Guía §V · Tabla 1',
    introduccion:
      'Diez enfoques complementarios orientan la identificación, el análisis, la prevención, el tratamiento y la transformación de controversias y conflictos sociales en el Sector Producción.',
    entradas: [
      {
        id: 'enfoque-derechos-humanos',
        termino: 'Enfoque de derechos humanos',
        definicion:
          'Reconoce a los ciudadanos y actores productivos como titulares de derechos fundamentales cuya protección es una obligación primordial del Estado, conforme a los tratados internacionales y al marco normativo nacional. Prioriza el respeto a la vida, la integridad, la libertad de asociación, la participación y el acceso a un entorno ambiental saludable.',
        detalles: ['Pregunta guía: ¿quién está en el centro de las intervenciones?'],
      },
      {
        id: 'enfoque-transformativo',
        termino: 'Enfoque transformativo',
        definicion:
          'Concibe el conflicto social como una oportunidad para el aprendizaje, la transformación y la mejora de la gestión pública, desde una orientación al desarrollo sostenible y al fortalecimiento de la gobernanza democrática. Busca cambios constructivos en las relaciones entre actores y sobre las condiciones estructurales que generan exclusión y desigualdad.',
        detalles: ['Pregunta guía: ¿el conflicto es solo un problema o puede ser una oportunidad?'],
      },
      {
        id: 'enfoque-intercultural',
        termino: 'Enfoque intercultural',
        definicion:
          'Reconoce y valora la diversidad cultural de los pueblos indígenas u originarios, comunidades costeras, ribereñas y afroperuanas como pilar de una sociedad democrática. Incorpora con pertinencia cultural las formas de organización, comunicación, relación con el territorio y comprensión del desarrollo de esos pueblos y comunidades.',
        detalles: ['Pregunta guía: ¿cómo construimos diálogo en contextos de diversidad cultural?'],
      },
      {
        id: 'enfoque-genero',
        termino: 'Enfoque de género',
        definicion:
          'Promueve la participación efectiva de mujeres y hombres en igualdad de oportunidades durante la prevención y gestión de conflictos, reconociendo que la conflictividad puede generar impactos diferenciados según el género. Procura que los aportes de las mujeres se consideren en la comprensión del conflicto, la construcción de acuerdos y el seguimiento de compromisos.',
        detalles: ['Pregunta guía: ¿quién participa, quién decide y quién falta en la mesa?'],
      },
      {
        id: 'enfoque-prevencion',
        termino: 'Enfoque de prevención de conflictos',
        definicion:
          'Prioriza acciones tempranas y anticipatorias para abordar los factores de riesgo de controversias y conflictos sociales. Busca evitar el escalamiento de diferencias o controversias hacia escenarios de crisis, promoviendo espacios de diálogo y la sostenibilidad de las actividades productivas.',
        detalles: ['Pregunta guía: ¿esperamos o actuamos antes?'],
      },
      {
        id: 'enfoque-dialogico',
        termino: 'Enfoque dialógico',
        definicion:
          'Constituye un código de conducta y una metodología para la interacción entre actores en los espacios de diálogo. Se sustenta en la voluntad de escucharse, la empatía, el respeto por puntos de vista distintos, la transparencia, la autenticidad y la búsqueda de entendimiento mutuo.',
        detalles: [
          'Pregunta guía: ¿cómo dialogar?',
          'Principios: inclusividad, espacio compartido, actitud de aprendizaje, humanidad, confidencialidad y buena fe.',
        ],
      },
      {
        id: 'enfoque-articulacion',
        termino: 'Enfoque de articulación multinivel',
        definicion:
          'Busca articular esfuerzos y generar sinergias para una respuesta multiactor integral, oportuna y eficaz. Promueve la colaboración entre las unidades de PRODUCE, sus organismos adscritos y los tres niveles de gobierno, integrando a actores del sector privado, la sociedad civil y las poblaciones locales.',
        detalles: ['Pregunta guía: ¿esto se resuelve en solitario o en equipo?'],
      },
      {
        id: 'enfoque-territorial',
        termino: 'Enfoque territorial',
        definicion:
          'Reconoce las características, particularidades y dinámicas de cada territorio donde PRODUCE ejerce competencias. Orienta la gestión social y el diálogo desde una mirada multidimensional del desarrollo —humano, social, ambiental, económico e institucional— y promueve la gobernanza territorial participativa.',
        detalles: ['Pregunta guía: ¿cómo influyen las particularidades de cada territorio?'],
      },
      {
        id: 'enfoque-sostenibilidad',
        termino: 'Enfoque de sostenibilidad ambiental',
        definicion:
          'Integra la variable ambiental en la gestión social y el diálogo, reconociendo que las actividades productivas dependen de ecosistemas saludables. Busca prevenir y gestionar conflictos por el acceso, uso y conservación de los recursos naturales, promoviendo prácticas responsables y el cumplimiento de la normativa ambiental.',
        detalles: [
          'Pregunta guía: ¿cómo cuidamos los recursos de los que dependen las actividades productivas?',
        ],
      },
      {
        id: 'enfoque-accion-sin-dano',
        termino: 'Enfoque de Acción sin Daño (Do No Harm)',
        definicion:
          'Principio ético que reconoce que toda intervención puede generar impactos negativos, incluso sin intención. Busca que las instituciones tomen decisiones informadas y aprendan de experiencias previas para maximizar los efectos positivos y evitar, en la mayor medida posible, daños derivados de la intervención.',
        detalles: [
          'Pregunta guía: ¿y si nuestra intervención bien intencionada termina causando daño?',
        ],
      },
    ],
  },
  {
    id: 'definiciones',
    titulo: 'Definiciones',
    fuente: 'Guía §VI · Tabla 2',
    introduccion:
      'Lenguaje común con el que el sector se entiende a sí mismo y se comunica con otras instituciones cuando aborda situaciones de conflictividad social.',
    entradas: [
      {
        id: 'def-discrepancia',
        termino: 'Discrepancia',
        definicion:
          'Divergencia persistente entre dos o más actores del sector productivo, caracterizada por la coexistencia de posiciones, intereses, valores, necesidades o derechos que resultan incompatibles, de manera real o percibida.',
      },
      {
        id: 'def-conflicto-social',
        termino: 'Conflicto social en el Sector Producción',
        definicion:
          'Proceso dinámico y complejo mediante el cual la discrepancia entre actores vinculados a actividades productivas, el Estado y las empresas se expresa públicamente con distintos grados de intensidad, según la evolución de las interacciones, las decisiones institucionales y el manejo de las partes.',
      },
      {
        id: 'def-infraestructura-paz',
        termino: 'Infraestructura para la paz',
        definicion:
          'Conjunto de capacidades institucionales, recursos humanos, mecanismos, procedimientos, normas y actores que un país, región o sector desarrolla de manera sostenida para prevenir, gestionar y transformar conflictos de manera pacífica y constructiva.',
      },
      {
        id: 'def-gestion-social',
        termino: 'Gestión social',
        definicion:
          'Conjunto de procesos estratégicos orientados a promover el desarrollo adecuado y la sostenibilidad de las actividades, proyectos, normas e intervenciones del sector producción. Tiene enfoque preventivo y busca la participación informada de los actores; sus instrumentos principales son el diálogo social, la participación ciudadana y la concertación social.',
      },
      {
        id: 'def-actor',
        termino: 'Actor',
        definicion:
          'Persona, grupo, organización, comunidad o institución que expresa públicamente intereses, demandas, posiciones o percepciones vinculadas a una situación de controversia o conflicto social del Sector Producción, y que tiene capacidad de incidencia, representación o influencia sobre su desarrollo.',
        detalles: [
          'Su actuación es dinámica: puede asumir distintos roles y formas de participación según el contexto, la etapa del proceso o el espacio de interacción.',
        ],
      },
      {
        id: 'def-hecho',
        termino: 'Hecho de conflictividad',
        definicion:
          'Evento o acción pública observable que expresa descontento, tensión o percepción de afectación negativa por parte de uno o más actores vinculados al sector productivo. Es la unidad mínima de registro y seguimiento de la conflictividad.',
        detalles: [
          'Ejemplos: protestas, bloqueos de vías, paralizaciones, pronunciamientos públicos o denuncias vinculadas a demandas o percepciones de afectación.',
        ],
      },
      {
        id: 'def-riesgo',
        termino: 'Riesgo de conflictividad',
        definicion:
          'Probabilidad de que una situación, suceso o acontecimiento social afecte el cumplimiento de los objetivos institucionales del sector producción, la gobernabilidad sectorial, el respeto de los derechos humanos de los actores productivos y/o el orden público.',
      },
      {
        id: 'def-caso',
        termino: 'Caso de conflicto',
        definicion:
          'Unidad de análisis e intervención conformada por un conjunto articulado de hechos de conflictividad que configuran un proceso sostenido con potencial de afectar la paz social, la gobernabilidad sectorial o la sostenibilidad de las actividades productivas. No es un evento aislado: es una dinámica subyacente y persistente en el tiempo.',
        detalles: [
          'Se configura cuando concurren, de manera progresiva: escalamiento de la demanda, actores organizados con capacidad de movilización, dinámica recurrente o tensión persistente y prolongación en el tiempo.',
        ],
      },
      {
        id: 'def-analisis',
        termino: 'Análisis de conflicto',
        definicion:
          'Proceso sistemático y riguroso de diagnóstico de un caso que comprende la identificación de actores (posiciones, intereses, necesidades, poder), las causas (estructurales, coyunturales, desencadenantes), la dinámica (escalamiento, fases), el contexto y las posibles opciones de intervención.',
      },
      {
        id: 'def-marco-situacional',
        termino: 'Marco situacional',
        definicion:
          'Representación analítica y contextualizada de una realidad, elaborada mediante la triangulación crítica de fuentes, actores y mecanismos de observación diversos. Organiza hechos verificables, narrativas y perspectivas para orientar la comprensión de escenarios de conflictividad y sustentar decisiones institucionales.',
      },
      {
        id: 'def-intervenciones',
        termino: 'Intervenciones',
        definicion:
          'Conjunto de acciones, actividades, regulaciones, políticas y decisiones administrativas que las entidades públicas, sus programas, organismos adscritos y entidades competentes producen, realizan o adoptan en el marco de sus funciones para cumplir sus objetivos institucionales.',
      },
      {
        id: 'def-prevencion',
        termino: 'Prevención del conflicto',
        definicion:
          'Conjunto de acciones anticipadas e intervenciones tempranas desplegadas en la fase latente del conflicto, orientadas a evitar el surgimiento de un conflicto social manifiesto o a impedir su escalamiento hacia la crisis. Incluye identificación de riesgos, fortalecimiento de capacidades, generación de condiciones para el diálogo y atención oportuna de pedidos.',
      },
      {
        id: 'def-gestion-conflictos',
        termino: 'Gestión de conflictos y controversias',
        definicion:
          'Proceso mediante el cual PRODUCE y las entidades del sector adoptan acciones, instauran mecanismos de coordinación participativos y toman decisiones ante una controversia, conflicto manifiesto o crisis, articulando acciones y generando espacios de diálogo para lograr soluciones integrales.',
      },
      {
        id: 'def-relacionamiento',
        termino: 'Relacionamiento social',
        definicion:
          'Proceso de comunicación efectiva e interacción continua de las unidades de PRODUCE, organismos adscritos y entidades competentes con los actores involucrados, para sostener una relación de confianza, respeto mutuo y colaboración que contribuya a la sostenibilidad de las actividades productivas y a la prevención de conflictos.',
      },
      {
        id: 'def-dialogo',
        termino: 'Diálogo social y mecanismos de gestión social',
        definicion:
          'El diálogo social es el mecanismo principal de la gestión social para la prevención y gestión pacífica de diferencias, controversias y conflictos. Consiste en un proceso de interacción, comunicación y construcción de consensos entre actores públicos, privados y de la sociedad civil.',
        detalles: [
          'Los espacios de diálogo son instancias formales o informales (mesas de diálogo, mesas técnicas, grupos de trabajo, comités de seguimiento u otros) orientadas a identificar, discutir o construir soluciones pacíficas e institucionales.',
        ],
      },
      {
        id: 'def-alerta',
        termino: 'Alerta temprana',
        definicion:
          'Instrumento para la prevención de controversias y conflictos sociales que gestiona información sobre situaciones de riesgo social y formula recomendaciones de acción, alertando oportunamente a la Alta Dirección y a las direcciones de línea sobre posibles conflictos sociales para la toma de decisiones preventivas.',
      },
      {
        id: 'def-pedido',
        termino: 'Pedido',
        definicion:
          'Solicitud o requerimiento realizado por alguno de los actores involucrados en un espacio de diálogo o en el marco de una controversia, cuya responsabilidad de ejecución y/o cumplimiento no ha sido confirmada formalmente por el sector o entidad correspondiente. Su atención contribuye a la prevención.',
      },
      {
        id: 'def-acuerdo',
        termino: 'Acuerdo',
        definicion:
          'Decisión adoptada por consenso entre dos o más actores involucrados, como resultado de un proceso de diálogo y deliberación sobre un asunto concreto. Puede ser formalizado en un acta o documento similar.',
      },
      {
        id: 'def-compromiso',
        termino: 'Compromiso',
        definicion:
          'Responsabilidad asumida en el marco de un proceso de diálogo, formalizada mediante acta. Requiere ejecutar un conjunto de acciones dentro de un plazo determinado y gestionar recursos humanos, logísticos y/o financieros, sujetos a disponibilidad presupuestal.',
      },
      {
        id: 'def-punto-focal',
        termino: 'Punto focal',
        definicion:
          'Servidor público o representante institucional designado por una entidad para actuar como enlace operativo con otras organizaciones, facilitando la coordinación e intercambio de información en el marco de la prevención y gestión de conflictos.',
      },
      {
        id: 'def-seguimiento',
        termino: 'Seguimiento',
        definicion:
          'Proceso continuo para observar y verificar la evolución y el desarrollo de un caso, así como el cumplimiento de los acuerdos y compromisos asumidos en espacios de diálogo, con la finalidad de detectar oportunamente problemas y actuar de manera anticipada frente al posible resurgimiento del conflicto.',
      },
      {
        id: 'def-sistematizacion',
        termino: 'Sistematización',
        definicion:
          'Proceso por el cual se estudia, analiza e incrementa el conocimiento sobre la problemática, las alternativas de solución, las buenas prácticas y las lecciones aprendidas alrededor de la gestión social de un caso o experiencia de diálogo. Transforma la experiencia en conocimiento útil para futuras intervenciones.',
      },
    ],
  },
  {
    id: 'niveles',
    titulo: 'Niveles de conflictividad',
    fuente: 'Guía §7.5.1',
    introduccion:
      'Describen la intensidad con que el conflicto se expresa públicamente. Se agrupan en situación latente (Diferencia y Controversia) y situación manifiesta (Conflicto social y Crisis social).',
    entradas: [
      {
        id: 'nivel-diferencia',
        termino: 'Diferencia',
        definicion:
          'Nivel inicial de discrepancia entre actores respecto a hechos, decisiones, información, percepciones o expectativas vinculadas a las actividades productivas. Se desarrolla principalmente en el plano perceptivo o interpretativo, sin demandas estructuradas ni conflictividad manifiesta.',
        detalles: [
          'Indicadores: desacuerdos o percepciones diferenciadas; mecanismos ordinarios de comunicación funcionando; ausencia de demandas formalizadas o medidas de presión; baja exteriorización pública; ausencia de afectación a la gobernabilidad o a las actividades productivas.',
        ],
      },
      {
        id: 'nivel-controversia',
        termino: 'Controversia',
        definicion:
          'Nivel en el que la discrepancia adquiere una manifestación más estructurada y pública mediante demandas, reclamos o cuestionamientos dirigidos a otros actores o entidades competentes. Existe mayor tensión y potencial de escalamiento, aunque sin configurarse aún un conflicto social abierto.',
        detalles: [
          'Indicadores: demandas o cuestionamientos públicos; mayor visibilidad de la discrepancia; deterioro parcial de los mecanismos de relacionamiento; participación de actores organizados; incremento del riesgo de movilización o escalamiento.',
        ],
      },
      {
        id: 'nivel-conflicto-social',
        termino: 'Conflicto social',
        definicion:
          'Nivel en el que la controversia escala hacia acciones públicas de presión o movilización sostenida, con deterioro significativo de los mecanismos ordinarios de interacción entre actores.',
        detalles: [
          'Indicadores: medidas de presión, movilización o interrupción parcial de actividades; demandas colectivas estructuradas y sostenidas; actores organizados con capacidad de movilización; dificultades para el diálogo; afectación parcial de la gobernabilidad, las actividades productivas o el entorno social.',
        ],
      },
      {
        id: 'nivel-crisis-social',
        termino: 'Crisis social',
        definicion:
          'Máximo nivel de escalamiento: desborde de los mecanismos ordinarios de contención institucional y presencia efectiva o inminente de violencia o grave afectación al orden público.',
        detalles: [
          'Indicadores: alto nivel de polarización y confrontación; violencia efectiva o riesgo inminente; desborde o debilitamiento de los mecanismos institucionales de diálogo; grave afectación a actividades productivas, servicios, activos críticos, gobernabilidad u orden público; alta complejidad para restablecer condiciones mínimas de diálogo.',
        ],
      },
    ],
  },
  {
    id: 'riesgos',
    titulo: 'Riesgos de conflictividad',
    fuente: 'Guía §7.5.2 · Tabla 3',
    introduccion:
      'Evalúan la probabilidad de escalamiento, agravamiento o reactivación de una situación. Un mismo nivel de conflictividad puede presentar distintos niveles de riesgo.',
    entradas: [
      {
        id: 'riesgo-bajo',
        termino: 'Bajo',
        definicion:
          'Existen condiciones institucionales, territoriales y comunicacionales que reducen la probabilidad de escalamiento o agravamiento, tanto en situaciones latentes como en conflictos manifiestos de limitada intensidad.',
        detalles: [
          'Indicadores: canales funcionales de comunicación, diálogo o negociación; adecuada presencia institucional y capacidad de respuesta; limitada incidencia de factores territoriales o coyunturales; disposición de los actores a mantener interlocución.',
          'Orientación de respuesta: monitoreo preventivo y mantenimiento de canales de comunicación sectoriales.',
        ],
      },
      {
        id: 'riesgo-moderado',
        termino: 'Moderado',
        definicion:
          'Empiezan a presentarse factores que podrían favorecer el tránsito progresivo hacia situaciones de mayor conflictividad o dificultar su conducción institucional.',
        detalles: [
          'Indicadores: debilitamiento parcial de mecanismos de comunicación, articulación o diálogo; percepción de insuficiente atención institucional; antecedentes de conflictividad parcialmente no resueltos; incremento de tensiones, polarización o presión social; factores territoriales, políticos o coyunturales favorables al escalamiento.',
          'Orientación de respuesta: activación de mecanismos de prevención y articulación intergubernamental; reforzamiento de la interlocución en el territorio y evaluación de estrategias de atención temprana.',
        ],
      },
      {
        id: 'riesgo-alto',
        termino: 'Alto',
        definicion:
          'Concurren múltiples factores que incrementan significativamente la probabilidad de escalamiento hacia situaciones de crisis social o grave afectación institucional, territorial o productiva.',
        detalles: [
          'Indicadores: ruptura o inexistencia de mecanismos efectivos de diálogo y contención; limitada capacidad institucional de respuesta o articulación multisectorial; alta polarización o deterioro del relacionamiento; acumulación de demandas no resueltas o antecedentes críticos; violencia efectiva o riesgo inminente.',
          'Orientación de respuesta: intervención prioritaria y articulación multisectorial de alto nivel; despliegue inmediato de medidas de contención, gestión de crisis y mitigación de impactos directos.',
        ],
      },
    ],
  },
  {
    id: 'prioridades-atencion',
    titulo: 'Prioridad de atención del caso',
    fuente: 'Guía §8.3.1 · Glosario §1.3',
    introduccion:
      'Prontitud del seguimiento derivada de la matriz de conflictividad. Es un eje distinto del nivel de riesgo. La Guía lista la columna, pero no define una regla de cálculo: no se deriva automáticamente del riesgo.',
    entradas: [
      {
        id: 'atencion-urgente',
        termino: 'Urgente',
        definicion:
          'Valor de prioridad de atención del caso. Se registra en la matriz de conflictividad (Anexo 15) y ordena el seguimiento operativo.',
      },
      {
        id: 'atencion-moderado',
        termino: 'Moderado',
        definicion:
          'Valor de prioridad de atención del caso. Se registra en la matriz de conflictividad (Anexo 15) y ordena el seguimiento operativo.',
      },
      {
        id: 'atencion-bajo',
        termino: 'Bajo',
        definicion:
          'Valor de prioridad de atención del caso. Se registra en la matriz de conflictividad (Anexo 15) y ordena el seguimiento operativo.',
      },
    ],
  },
  {
    id: 'alertas',
    titulo: 'Alertas tempranas (RED-RADAR)',
    fuente: 'Guía §8.1.2.2 · Glosario §1.7',
    introduccion:
      'Nivel y prioridad son columnas distintas. El plazo vive en `sla_horas` y no forma parte de la etiqueta: se escribe «Crítica inmediata», no «Crítica inmediata (24h)».',
    entradas: [
      {
        id: 'nivel-alerta-inmediato',
        termino: 'Nivel: Inmediato',
        definicion:
          'Nivel de alerta del catálogo RED-RADAR. Describe la urgencia de la respuesta institucional.',
      },
      {
        id: 'nivel-alerta-tactico',
        termino: 'Nivel: Táctico',
        definicion:
          'Nivel de alerta del catálogo RED-RADAR. Describe la urgencia de la respuesta institucional.',
      },
      {
        id: 'nivel-alerta-preventivo',
        termino: 'Nivel: Preventivo',
        definicion:
          'Nivel de alerta del catálogo RED-RADAR. Describe la urgencia de la respuesta institucional.',
      },
      {
        id: 'nivel-alerta-monitoreo',
        termino: 'Nivel: Monitoreo',
        definicion:
          'Nivel de alerta del catálogo RED-RADAR. Describe la urgencia de la respuesta institucional.',
      },
      {
        id: 'prioridad-alerta-critica',
        termino: 'Prioridad: Crítica inmediata',
        definicion:
          'Prioridad de alerta con plazo de atención de 24 horas. Es la prioridad asociada a la crisis.',
        detalles: ['Plazo (`sla_horas`): 24 h.'],
      },
      {
        id: 'prioridad-alerta-urgente',
        termino: 'Prioridad: Urgente',
        definicion: 'Prioridad de alerta con plazo de atención de 48 horas.',
        detalles: ['Plazo (`sla_horas`): 48 h.'],
      },
      {
        id: 'prioridad-alerta-temprana',
        termino: 'Prioridad: Temprana',
        definicion: 'Prioridad de alerta con plazo de atención de 72 horas.',
        detalles: ['Plazo (`sla_horas`): 72 h.'],
      },
      {
        id: 'prioridad-alerta-seguimiento',
        termino: 'Prioridad: Seguimiento',
        definicion:
          'Prioridad de alerta sin plazo de atención; se atiende por seguimiento ordinario.',
        detalles: ['Plazo (`sla_horas`): sin plazo.'],
      },
    ],
  },
  {
    id: 'subsectores',
    titulo: 'Subsectores del Sector Producción',
    fuente: 'Guía §7.2 · Anexo 15',
    introduccion: 'El subsector fija el bloque del código del caso y no es un tipo de actor.',
    entradas: [
      {
        id: 'subsector-pesca',
        termino: 'Pesca y Acuicultura (PA)',
        definicion:
          'Actividades de extracción, procesamiento y comercialización pesquera y acuícola, incluidas las de la pesca artesanal. «Pesca artesanal» es una subopción del subsector, no un subsector paralelo.',
      },
      {
        id: 'subsector-mype',
        termino: 'MYPE e Industria (MI)',
        definicion:
          'Actividades de la micro, pequeña y mediana empresa y de la industria manufacturera bajo competencia del sector.',
      },
    ],
  },
  {
    id: 'demandas',
    titulo: 'Demandas: problema, propuesta y pedido (3P)',
    fuente: 'Guía §7.7',
    introduccion:
      'El 3P permite ordenar la participación, reducir ambigüedades y facilitar la sistematización de la información. Los tres campos son distintos y no se sustituyen entre sí.',
    entradas: [
      {
        id: 'demanda-problema',
        termino: 'Problema',
        definicion: 'Identificación clara de la situación o afectación percibida por el actor.',
      },
      {
        id: 'demanda-propuesta',
        termino: 'Propuesta',
        definicion: 'Planteamiento de alternativas de solución o mejora.',
      },
      {
        id: 'demanda-pedido',
        termino: 'Pedido',
        definicion:
          'Formulación de requerimientos concretos hacia las entidades competentes. Un pedido no es un compromiso: su responsabilidad de ejecución aún no está confirmada.',
      },
    ],
  },
  {
    id: 'actores',
    titulo: 'Actores y roles',
    fuente: 'Guía §7.4 · Glosario §1.6',
    introduccion:
      'La clasificación responde a la naturaleza, la función o el rol predominante. Las categorías no son excluyentes ni estáticas: un mismo actor puede desempeñar distintos roles según el contexto, la etapa o el espacio de interacción.',
    entradas: [
      {
        id: 'actor-social',
        termino: 'Rol estructural: Actor social',
        definicion:
          'Aquellos cuyos intereses, condiciones de vida o actividades son afectados directa o indirectamente, incluyendo organizaciones sociales, gremios, comunidades y colectivos.',
      },
      {
        id: 'actor-publico',
        termino: 'Rol estructural: Actor público',
        definicion:
          'Entidades del Estado en sus distintos niveles de gobierno con competencias para regular, intervenir, fiscalizar o articular respuestas frente a la conflictividad.',
      },
      {
        id: 'actor-privado',
        termino: 'Rol estructural: Actor privado',
        definicion:
          'Agentes económicos, empresas o asociaciones que participan en la actividad productiva y pueden verse involucrados en controversias o conflictos.',
      },
      {
        id: 'funcion-principal',
        termino: 'Función: Principal',
        definicion:
          'Actores directamente involucrados en la controversia o conflicto, por afectación directa o por su capacidad de decisión. Incluye comunidades, organizaciones sociales, empresas y entidades estatales competentes.',
      },
      {
        id: 'funcion-secundario',
        termino: 'Función: Secundario',
        definicion:
          'Actores que brindan soporte técnico, político o social a los actores principales: asesores, especialistas, intérpretes, aliados estratégicos u otros que influyen en la posición de las partes.',
      },
      {
        id: 'funcion-tercero',
        termino: 'Función: Tercero imparcial',
        definicion:
          'Actores ajenos a las partes que intervienen de manera neutral como facilitadores del diálogo, la negociación o la resolución de conflictos, mediante facilitación, mediación, arbitraje u otras formas de acompañamiento institucional.',
      },
      {
        id: 'funcion-no-determinado',
        termino: 'Función: No determinado',
        definicion:
          'Valor de catálogo para un actor cuya función en la intervención aún no se ha establecido.',
      },
      {
        id: 'posicionamiento-dialogante',
        termino: 'Posicionamiento: Dialogante',
        definicion:
          'Valor de catálogo que describe la disposición del actor a sostener el diálogo y la búsqueda de acuerdos.',
      },
      {
        id: 'posicionamiento-legitimante',
        termino: 'Posicionamiento: Legitimante',
        definicion:
          'Valor de catálogo que describe la posición del actor respecto de la legitimidad de las partes, las reglas o las decisiones del escenario.',
      },
      {
        id: 'posicionamiento-conflictivo',
        termino: 'Posicionamiento: Conflictivo',
        definicion:
          'Valor de catálogo que describe una posición de confrontación o presión dentro del escenario de conflictividad.',
      },
    ],
  },
  {
    id: 'niveles-gobierno',
    titulo: 'Niveles de gobierno',
    fuente: 'Guía §7.4 · Glosario §1.8',
    introduccion:
      'Identifican a la entidad responsable de un compromiso o a la que pertenece un actor público. En la interfaz, el nivel regional se rotula «GORE».',
    entradas: [
      {
        id: 'nivel-gobierno-nacional',
        termino: 'Nacional',
        definicion:
          'Entidades del gobierno nacional involucradas en la gestión de la conflictividad o en el compromiso.',
      },
      {
        id: 'nivel-gobierno-regional',
        termino: 'Regional (GORE) — Gobierno Regional',
        definicion: 'Gobiernos regionales; en la interfaz, este nivel se rotula «GORE».',
      },
      {
        id: 'nivel-gobierno-local',
        termino: 'Local — gobiernos provinciales y distritales',
        definicion: 'Gobiernos provinciales y distritales.',
      },
      {
        id: 'nivel-gobierno-empresa',
        termino: 'Empresa',
        definicion: 'Actor privado con actividad productiva en el sector.',
      },
      {
        id: 'nivel-gobierno-sociedad',
        termino: 'Sociedad Civil',
        definicion: 'Organizaciones y colectivos de la sociedad civil.',
      },
    ],
  },
  {
    id: 'estados',
    titulo: 'Estados de caso, compromiso e hito',
    fuente: 'Guía §8.3.2 · Glosario §1.8',
    introduccion:
      '«Vencido» existe, pero es el cálculo de plazo por fecha: no es un estado de gestión.',
    entradas: [
      {
        id: 'estado-caso',
        termino: 'Estado de caso',
        definicion:
          'Situación operativa del expediente. Son tres valores: Abierto, mientras el caso exige seguimiento y admite hechos, demandas y compromisos; Resuelto, cuando la intervención concluyó; y Archivado, cuando se conserva como antecedente sin seguimiento activo. Archivar no borra: mantiene vínculos e historial.',
        detalles: [
          'Abierto · Resuelto · Archivado. Los indicadores y la bandeja cuentan como abiertos los expedientes en estado Abierto.',
          'Anular no es archivar: anular retira el registro de la operación diaria y sólo lo restaura un rol con ese privilegio.',
        ],
      },
      {
        id: 'estado-compromiso',
        termino: 'Estado de compromiso',
        definicion: 'Valores admitidos del catálogo de estados del compromiso.',
        detalles: ['Por iniciar', 'En proceso', 'Cumplido', 'Redefinido', 'Desestimado'],
      },
      {
        id: 'estado-hito',
        termino: 'Estado de hito',
        definicion:
          'Estado vigente de cumplimiento del hito, actualizado periódicamente según el avance verificado.',
        detalles: ['Registrado', 'En ejecución', 'Paralizado', 'Cumplido', 'Desestimado'],
      },
    ],
  },
  {
    id: 'alcance',
    titulo: 'Alcance territorial y naturaleza del caso',
    fuente: 'Glosario §1.9',
    entradas: [
      {
        id: 'alcance-valores',
        termino: 'Alcance geográfico',
        definicion:
          'Se deriva de la región; no se elige a mano. En las etiquetas de interfaz, «Territorio» se muestra como «Región».',
        detalles: ['Norte', 'Centro', 'Sur', 'Oriente', 'Nacional'],
      },
      {
        id: 'naturaleza-caso',
        termino: 'Naturaleza del caso',
        definicion:
          'Eje declarado, distinto del alcance. «Territorial»: la causa nace en un territorio concreto. «Nacional o sectorial»: la causa es una medida de alcance nacional o de todo el sector (norma, cuota, temporada, ordenamiento).',
        detalles: [
          'No se deriva de las regiones: un caso con alcance «Nacional» puede ser territorial multirregional.',
          '«Sin declarar» significa que aún no se definió; la interfaz no inventa un valor.',
        ],
      },
    ],
  },
  {
    id: 'ciclo',
    titulo: 'Ciclo de intervención sectorial',
    fuente: 'Guía §8 (guia.md:650) · Glosario §1.10',
    introduccion:
      'Los componentes son una representación metodológica para orientar la intervención: no son etapas sucesivas ni rígidas. Pueden desarrollarse de manera simultánea, complementaria o iterativa según cada caso.',
    entradas: [
      {
        id: 'ciclo-prevencion-estrategica',
        termino: 'Prevención estratégica',
        definicion:
          'Actúa sobre condiciones estructurales, institucionales y relacionales de largo plazo mediante la articulación, el relacionamiento territorial y la construcción de infraestructura para la paz.',
      },
      {
        id: 'ciclo-prevencion-operativa',
        termino: 'Prevención operativa',
        definicion:
          'Centrada en el monitoreo y el análisis coyuntural para una intervención temprana que evite el escalamiento de tensiones. Gestiona diferencias y controversias y atiende oportunamente las demandas.',
      },
      {
        id: 'ciclo-intervencion',
        termino: 'Intervención y tratamiento',
        definicion:
          'Acciones, mecanismos de coordinación y procesos de diálogo frente a escenarios de controversia, conflicto manifiesto o crisis social. Integra la articulación institucional multinivel, la conducción técnica del diálogo, la gestión situada de demandas y el análisis territorial.',
      },
      {
        id: 'ciclo-monitoreo',
        termino: 'Monitoreo de compromisos',
        definicion:
          'Registro, actualización y verificación continua de casos, acuerdos, compromisos y acciones desplegadas. Permite construir trazabilidad, identificar riesgos de reescalamiento y generar información operativa para decidir.',
      },
      {
        id: 'ciclo-conocimiento',
        termino: 'Gestión de la información y del conocimiento',
        definicion:
          'Proceso transversal que organiza y analiza la información generada durante la intervención —matrices, alertas, reportes de clima social y análisis de caso— para fortalecer la toma de decisiones y mejorar las estrategias de prevención.',
      },
    ],
  },
  {
    id: 'tipos-compromiso',
    titulo: 'Tipos de compromiso',
    fuente: 'Guía §8.3.2 · Anexo 14',
    introduccion:
      'El tipo describe la naturaleza de la obligación asumida en el espacio de diálogo.',
    entradas: [
      {
        id: 'tipo-compromiso-actividad',
        termino: 'Actividad',
        definicion: 'El compromiso se ejecuta mediante acciones de gestión.',
      },
      {
        id: 'tipo-compromiso-pip',
        termino: 'PIP',
        definicion: 'El compromiso se ejecuta como proyecto de inversión pública.',
      },
    ],
  },
  {
    id: 'codigos',
    titulo: 'Códigos y formatos',
    fuente: 'Anexo 15 · Glosario §0.6',
    entradas: [
      {
        id: 'codigo-caso',
        termino: 'Código de caso',
        definicion:
          'Formato oficial del Anexo 15: CS-<PA|MI>-<INF|OAT|NOR|DBE|GOB|ITE|GEN>-<AAAA>-<NN>.',
        detalles: [
          'PA · MI: bloque del subsector.',
          'INF = Infraestructura · OAT = Ordenamiento y acceso territorial · NOR = Normatividad · DBE = Distribución de beneficios · GOB = Gobernanza · ITE = Impactos de terceros.',
          'GEN cubre los casos sin subsector o sin temática.',
          'AAAA: año · NN: correlativo. Ejemplo: CS-PA-INF-2026-01.',
        ],
      },
      {
        id: 'codigo-compromiso',
        termino: 'Código de compromiso',
        definicion:
          'Se deriva del caso: <código de caso>_COMP001, con correlativo propio dentro del caso.',
      },
      {
        id: 'codigo-hito',
        termino: 'Código de hito',
        definicion:
          'Se deriva del compromiso: <código de compromiso>_H001, con correlativo dentro del compromiso.',
      },
    ],
  },
  {
    id: 'atajos',
    titulo: 'Atajos de teclado',
    fuente: 'Interfaz AVISA',
    introduccion:
      'Atajos disponibles en toda la aplicación. El atajo «/» no se activa mientras se escribe en un campo de texto, y ninguno lo hace mientras hay un panel lateral abierto.',
    entradas: [
      {
        id: 'atajo-busqueda-global',
        termino: 'Ctrl + K / ⌘ + K',
        definicion:
          'Abre la búsqueda transversal desde cualquier vista y deja el cursor en el buscador.',
      },
      {
        id: 'atajo-buscador-lista',
        termino: '/',
        definicion:
          'Enfoca el buscador de la lista que está viendo. Si la vista no tiene buscador, no hace nada.',
      },
      {
        id: 'atajo-cerrar-panel',
        termino: 'Esc',
        definicion: 'Cierra el panel lateral abierto y devuelve el foco al elemento que lo abrió.',
      },
    ],
  },
];
