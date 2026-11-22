export type WorkspaceView =
  | "overview"
  | "inbox"
  | "cases"
  | "case-detail"
  | "alerts"
  | "commitments"
  | "documents"
  | "map"
  | "directory-actors"
  | "directory-organizations"
  | "directory-institutions"
  | "directory-locals"
  | "executive";

export type RiskLevel = "Alto" | "Moderado" | "Bajo";
export type NivelConflicto =
  "Diferencia" | "Controversia" | "Conflicto social" | "Crisis social";
export type CasePriority = "Urgente" | "Moderado" | "Bajo";
export type DemoActor = {
  apellidos: string;
  nombres: string;
  correo?: string;
  telefono?: string;
  tipo: "Social" | "Público" | "Privado";
  funcion: "Principal" | "Secundario" | "Tercero imparcial";
  posicionamiento: "Dialogante" | "Legitimante" | "Conflictivo";
};
export type CaseState = "Activo" | "En seguimiento" | "Resuelto" | "Archivado";
export type DataOrigin = "Manual" | "Ingesta" | "Legado" | "WhatsApp";

export type DemandaFuente = {
  campo: "problema" | "propuesta" | "pedido";
  documentoId?: string;
  documentoCodigo?: string;
  fragmentoId?: string;
  texto?: string;
};

export type DemoDemanda = {
  id?: string;
  problema: string;
  propuesta?: string;
  pedido: string;
  estado: "Pendiente" | "En proceso" | "Atendida" | "Desestimada";
  fuentes?: DemandaFuente[];
};

export type DemoCase = {
  code: string;
  title: string;
  region: string;
  subject: string;
  risk: RiskLevel;
  stage: string;
  updated: string;
  progress: number;
  summary: string;
  actors: DemoActor[];
  events: {
    id?: string;
    date: string;
    title: string;
    description: string;
    actor?: string;
    kind: "validated" | "pending" | "system";
    estado?: "Pendiente" | "Validado";
    evidencia?: string;
  }[];
  alcance?: "Norte" | "Centro" | "Sur" | "Oriente" | "Nacional";
  estado?: CaseState;
  nivelConflicto?: NivelConflicto;
  prioridad?: CasePriority;
  subsector?: "Pesca y Acuicultura" | "MYPE e Industria";
  documentacionNormativa?: (
    string | { titulo: string; fecha?: string; referencia?: string }
  )[];
  unidadResponsable?: string;
  puntoFocal?: string;
  tematica?: string;
  origen?: DataOrigin;
  validado?: boolean;
  demandas?: DemoDemanda[];
};

export type DemoAlert = {
  id: string;
  title: string;
  location: string;
  source: string;
  published: string;
  priority: "Crítica" | "Alta" | "Media";
  risk?: RiskLevel;
  alertType?: "AT" | "RR" | "PAR";
  status: "Pendiente de revisión" | "Aprobada" | "Descartada" | "Atendida";
  quote: string;
  note: string;
  reviewNote?: string;
  historial?: { accion: string; fecha: string; nota?: string }[];
  caseCode?: string;
  slaHours?: number;
  documentoId?: string;
  origen?: DataOrigin;
  validado?: boolean;
  derivacion?: {
    area: string;
    fechaLimite: string;
    estado: "Pendiente" | "En atención" | "Atendida";
  };
  riesgos?: string[];
  acciones?: string[];
};

export type DemoHito = {
  id: string;
  descripcion: string;
  fecha: string;
  estado:
    "Registrado" | "En ejecución" | "Paralizado" | "Cumplido" | "Desestimado";
};

export type DemoCommitment = {
  id: string;
  title: string;
  caseCode: string;
  owner: string;
  due: string;
  status: "Paralizado" | "Por vencer" | "En curso" | "Cumplido";
  progress: number;
  tipo?: "Actividad" | "PIP";
  nivelGobierno?:
    "Nacional" | "Regional" | "Local" | "Empresa" | "Sociedad Civil";
  unidadResponsable?: string;
  documentoOrigenId?: string;
  evidenciaUri?: string;
  evidencias?: { nombre: string; tipo?: string }[];
  archivado?: { motivo: string; fecha: string };
  clasificacion?: "Formal" | "Verbal";
  atiendeGenero?: boolean;
  fechaInicio?: string;
  origen?: DataOrigin;
  validado?: boolean;
  agreementType?:
    "Progresivo o parcial" | "Entendimiento operativo" | "Condicionado";
  recordatorios?: number[];
  hitos?: DemoHito[];
};

export type DocKind =
  "relatoria" | "entrevista" | "informe" | "acta" | "dato_externo";
export type DocState =
  "Cargado" | "En análisis" | "Extraído" | "Validado" | "Rechazado";
export type FragmentKind = "hecho" | "cita" | "demanda" | "acuerdo" | "riesgo";

export type DemoFragment = {
  id: string;
  texto: string;
  tipo: FragmentKind;
  validado: boolean;
};

export type DemoExtraction = {
  id: string;
  tipo: "alerta" | "compromiso" | "hecho" | "actor" | "demanda";
  titulo: string;
  detalle: string;
  estado: "Propuesta" | "Aceptada" | "Descartada";
  refId?: string;
};

export type DemoDocument = {
  id: string;
  codigo: string;
  kind: DocKind;
  titulo: string;
  fecha: string;
  archivo: string;
  origen: DataOrigin;
  estado: DocState;
  confianza?: number;
  resumen?: string;
  casoCode?: string;
  subidoPor: string;
  texto?: string;
  fragmentos: DemoFragment[];
  extracciones: DemoExtraction[];
  rechazoMotivo?: string;
  versiones?: { n: number; fecha: string; fragmentos: DemoFragment[] }[];
};

export type DemoNotificationCategory =
  "Alerta" | "Compromiso" | "Caso" | "Documento" | "Sistema";

export type DemoNotification = {
  id: string;
  categoria: DemoNotificationCategory;
  titulo: string;
  detalle: string;
  fecha: string;
  leida: boolean;
  view: WorkspaceView;
  refCode?: string;
};

export const docKindLabels: Record<DocKind, string> = {
  relatoria: "Relatoría",
  entrevista: "Entrevista",
  informe: "Informe / reporte",
  acta: "Acta de acuerdo",
  dato_externo: "Dato externo",
};

export const demoCases: DemoCase[] = [
  {
    code: "DEMO-2026-041",
    title: "Acceso a zona de desembarque",
    region: "Piura · Paita",
    subject: "Pesca artesanal",
    risk: "Alto",
    stage: "En atención",
    updated: "Hace 18 min",
    progress: 68,
    summary:
      "Representantes de organizaciones locales solicitaron una mesa de trabajo sobre el acceso a infraestructura de desembarque. La ficha y sus datos son ilustrativos; no representan un caso real.",
    actors: [
      {
        apellidos: "Asociación costera",
        nombres: "representante (alias)",
        tipo: "Social",
        funcion: "Principal",
        posicionamiento: "Dialogante",
      },
      {
        apellidos: "GORE Piura",
        nombres: "enlace institucional",
        tipo: "Público",
        funcion: "Secundario",
        posicionamiento: "Dialogante",
      },
      {
        apellidos: "Sector competente",
        nombres: "equipo técnico",
        tipo: "Público",
        funcion: "Tercero imparcial",
        posicionamiento: "Legitimante",
      },
    ],
    alcance: "Norte",
    estado: "Activo",
    nivelConflicto: "Conflicto social",
    prioridad: "Urgente",
    tematica: "Infraestructura",
    subsector: "Pesca y Acuicultura",
    documentacionNormativa: [
      {
        titulo: "Marco sectorial de pesca artesanal",
        referencia: "Referencia demostrativa · sin norma oficial",
        fecha: "12 mar 2025",
      },
      "Acta de mesa de diálogo · referencia heredada de demostración",
    ],
    unidadResponsable: "OAIPCS",
    puntoFocal: "Analista de enlace (alias)",
    origen: "Manual",
    validado: true,
    demandas: [
      {
        problema:
          "El acceso al área de desembarque está restringido para embarcaciones artesanales.",
        propuesta: "Mesa de trabajo con la administración del terminal.",
        pedido: "Habilitar un horario de desembarque para la flota artesanal.",
        estado: "En proceso",
      },
    ],
    events: [
      {
        date: "19 nov · 10:42",
        title: "Nueva alerta en revisión",
        actor: "Sistema de demostración",
        description:
          "Se detectó una publicación en fuente autorizada. Aún no es visible fuera de la bandeja.",
        kind: "pending",
      },
      {
        date: "19 nov · 09:10",
        title: "Reunión de coordinación",
        actor: "Enlace sectorial (alias)",
        description:
          "Se registró un acta de coordinación como evidencia pendiente de validación.",
        kind: "validated",
      },
      {
        date: "18 nov · 16:30",
        title: "Compromiso actualizado",
        actor: "Equipo sectorial (alias)",
        description:
          "La entidad responsable informó avance en la propuesta de agenda.",
        kind: "system",
      },
    ],
  },
  {
    code: "DEMO-2026-038",
    title: "Continuidad de actividad acuícola",
    region: "Áncash · Huarmey",
    subject: "Acuicultura",
    risk: "Moderado",
    stage: "Seguimiento",
    updated: "Hace 2 h",
    progress: 42,
    summary:
      "Solicitud ilustrativa de coordinación sobre continuidad de una actividad acuícola y monitoreo de calidad de agua. La evidencia de este prototipo es ficticia.",
    actors: [
      {
        apellidos: "Asociación productiva",
        nombres: "representante (alias)",
        tipo: "Social",
        funcion: "Principal",
        posicionamiento: "Dialogante",
      },
      {
        apellidos: "Gobierno local",
        nombres: "enlace institucional",
        tipo: "Público",
        funcion: "Secundario",
        posicionamiento: "Legitimante",
      },
      {
        apellidos: "Equipo técnico",
        nombres: "sectorial",
        tipo: "Público",
        funcion: "Tercero imparcial",
        posicionamiento: "Dialogante",
      },
    ],
    alcance: "Norte",
    estado: "En seguimiento",
    nivelConflicto: "Controversia",
    prioridad: "Moderado",
    tematica: "Impactos de terceros",
    subsector: "Pesca y Acuicultura",
    unidadResponsable: "OAIPCS",
    puntoFocal: "Analista de enlace (alias)",
    origen: "Ingesta",
    validado: false,
    events: [
      {
        date: "19 nov · 08:35",
        title: "Muestra registrada",
        actor: "Equipo técnico (alias)",
        description:
          "Resultado ingresado a revisión técnica; no constituye una conclusión validada.",
        kind: "pending",
      },
    ],
  },
  {
    code: "DEMO-2026-032",
    title: "Coordinación por mantenimiento vial",
    region: "Junín · Chanchamayo",
    subject: "Infraestructura",
    risk: "Bajo",
    stage: "Acuerdos en seguimiento",
    updated: "Ayer",
    progress: 84,
    summary:
      "Caso demostrativo de coordinación entre actores locales para el seguimiento de acuerdos de mantenimiento.",
    actors: [
      {
        apellidos: "Comité local",
        nombres: "representante (alias)",
        tipo: "Social",
        funcion: "Principal",
        posicionamiento: "Dialogante",
      },
      {
        apellidos: "Gobierno local",
        nombres: "enlace institucional",
        tipo: "Público",
        funcion: "Secundario",
        posicionamiento: "Dialogante",
      },
      {
        apellidos: "Sector competente",
        nombres: "equipo técnico",
        tipo: "Público",
        funcion: "Tercero imparcial",
        posicionamiento: "Legitimante",
      },
    ],
    alcance: "Centro",
    estado: "Activo",
    nivelConflicto: "Diferencia",
    prioridad: "Bajo",
    tematica: "Infraestructura",
    subsector: "MYPE e Industria",
    unidadResponsable: "OAIPCS",
    origen: "Manual",
    validado: true,
    events: [
      {
        date: "18 nov · 15:20",
        title: "Hito reportado",
        description:
          "Se añadió evidencia de avance; pendiente de confirmación por el responsable.",
        kind: "pending",
      },
    ],
  },
];

export const demoAlerts: DemoAlert[] = [
  {
    id: "ALT-DEMO-018",
    title: "Solicitud de reunión difundida en canal local",
    location: "Paita · Piura",
    source: "Medio regional de ejemplo",
    published: "19 nov · 10:24",
    priority: "Crítica",
    risk: "Alto",
    alertType: "AT",
    status: "Pendiente de revisión",
    quote:
      "“Solicitamos una reunión para revisar el acceso a la zona de desembarque.”",
    note: "Cita y fuente ficticias para demostrar el control de coincidencia textual. Verificar antes de cualquier uso institucional.",
    caseCode: "DEMO-2026-041",
    slaHours: 24,
    origen: "Ingesta",
    validado: false,
  },
  {
    id: "ALT-DEMO-017",
    title: "Convocatoria a mesa técnica",
    location: "Huarmey · Áncash",
    source: "Boletín de ejemplo",
    published: "19 nov · 08:40",
    priority: "Alta",
    risk: "Moderado",
    alertType: "RR",
    status: "Pendiente de revisión",
    quote:
      "“Proponemos instalar una mesa técnica con participación de las autoridades.”",
    note: "Registro ilustrativo sin vínculo a una persona identificada.",
    caseCode: "DEMO-2026-038",
    slaHours: 48,
    origen: "Ingesta",
    validado: false,
  },
  {
    id: "ALT-DEMO-014",
    title: "Actualización de compromiso local",
    location: "Chanchamayo · Junín",
    source: "Acta simulada",
    published: "18 nov · 15:12",
    priority: "Media",
    risk: "Bajo",
    alertType: "PAR",
    status: "Aprobada",
    quote: "“Se coordinará una nueva fecha para la inspección conjunta.”",
    note: "Aprobación demostrativa: no corresponde a un acto administrativo real.",
    caseCode: "DEMO-2026-032",
    slaHours: 72,
    origen: "Manual",
    validado: true,
  },
];

export const demoCommitments: DemoCommitment[] = [
  {
    id: "COM-DEMO-009",
    title: "Presentar propuesta de agenda para la mesa",
    caseCode: "DEMO-2026-041",
    owner: "Equipo sectorial",
    due: "19 nov 2026",
    status: "Paralizado",
    progress: 70,
    agreementType: "Entendimiento operativo",
    tipo: "Actividad",
    nivelGobierno: "Nacional",
    unidadResponsable: "OAIPCS",
    atiendeGenero: false,
    origen: "Manual",
    validado: true,
    hitos: [
      {
        id: "H-01",
        descripcion: "Borrador de agenda",
        fecha: "15 nov 2026",
        estado: "Cumplido",
      },
      {
        id: "H-02",
        descripcion: "Validación con la mesa",
        fecha: "19 nov 2026",
        estado: "Paralizado",
      },
    ],
  },
  {
    id: "COM-DEMO-008",
    title: "Confirmar fecha de reunión técnica",
    caseCode: "DEMO-2026-038",
    owner: "Coordinación territorial",
    due: "20 nov 2026",
    status: "Por vencer",
    progress: 45,
    agreementType: "Condicionado",
    tipo: "Actividad",
    nivelGobierno: "Regional",
    origen: "Ingesta",
    validado: false,
  },
  {
    id: "COM-DEMO-006",
    title: "Compartir acta de coordinación",
    caseCode: "DEMO-2026-032",
    owner: "Gobierno local (demo)",
    due: "24 nov 2026",
    status: "En curso",
    progress: 60,
    tipo: "Actividad",
    nivelGobierno: "Local",
    origen: "Manual",
    validado: true,
  },
  {
    id: "COM-DEMO-003",
    title: "Remitir nota de seguimiento",
    caseCode: "DEMO-2026-032",
    owner: "Equipo técnico",
    due: "17 nov 2026",
    status: "Cumplido",
    progress: 100,
    tipo: "Actividad",
    nivelGobierno: "Local",
    evidenciaUri: "Documento simulado · DOC-2026-014",
    origen: "Manual",
    validado: true,
  },
];

export const demoDocuments: DemoDocument[] = [
  {
    id: "DOC-2026-021",
    codigo: "DOC-2026-021",
    kind: "relatoria",
    titulo: "Relatoría de la mesa de coordinación sobre desembarque",
    fecha: "2026-11-19",
    archivo: "relatoria_mesa_19nov.pdf",
    origen: "Ingesta",
    estado: "Extraído",
    confianza: 0.62,
    casoCode: "DEMO-2026-041",
    subidoPor: "Sesión actual",
    resumen:
      "Documento de demostración: tres intervenciones que refieren acceso al desembarque y un acuerdo de agenda.",
    texto:
      "Se solicita habilitar un horario de desembarque para la flota artesanal.\nLa administración propone una mesa técnica en un plazo de 48 horas.\nSe acuerda presentar la propuesta de agenda antes del viernes.",
    fragmentos: [
      {
        id: "DOC-2026-021-F1",
        texto:
          "Se solicita habilitar un horario de desembarque para la flota artesanal.",
        tipo: "demanda",
        validado: false,
      },
      {
        id: "DOC-2026-021-F2",
        texto:
          "La administración propone una mesa técnica en un plazo de 48 horas.",
        tipo: "hecho",
        validado: false,
      },
      {
        id: "DOC-2026-021-F3",
        texto: "Se acuerda presentar la propuesta de agenda antes del viernes.",
        tipo: "acuerdo",
        validado: false,
      },
    ],
    extracciones: [
      {
        id: "DOC-2026-021-X1",
        tipo: "alerta",
        titulo: "Solicitud de horario de desembarque",
        detalle:
          "Demanda recogida en relatoría; requiere verificación con la fuente.",
        estado: "Propuesta",
      },
      {
        id: "DOC-2026-021-X2",
        tipo: "compromiso",
        titulo: "Presentar propuesta de agenda antes del viernes",
        detalle: "Acuerdo identificado en el párrafo 3.",
        estado: "Propuesta",
      },
      {
        id: "DOC-2026-021-X3",
        tipo: "hecho",
        titulo: "Mesa técnica propuesta a 48 horas",
        detalle: "Hecho verificable registrado por la administración.",
        estado: "Propuesta",
      },
    ],
  },
  {
    id: "DOC-2026-019",
    codigo: "DOC-2026-019",
    kind: "dato_externo",
    titulo: "Padrón de asociaciones productivas (extracto)",
    fecha: "2026-11-18",
    archivo: "padron_asociaciones.csv",
    origen: "Ingesta",
    estado: "Validado",
    confianza: 0.91,
    subidoPor: "Sesión actual",
    resumen: "Carga externa de demostración validada por una persona.",
    texto: "Padrón externo de demostración.",
    fragmentos: [],
    extracciones: [],
  },
  {
    id: "DOC-2026-014",
    codigo: "DOC-2026-014",
    kind: "entrevista",
    titulo: "Entrevista a representante de asociación acuícola",
    fecha: "2026-11-17",
    archivo: "entrevista_acuicola.txt",
    origen: "Manual",
    estado: "En análisis",
    confianza: 0.48,
    casoCode: "DEMO-2026-038",
    subidoPor: "Sesión actual",
    resumen: "Transcripción de demostración pendiente de extracción.",
    texto:
      "Nos preocupa la continuidad de la actividad acuícola.\nPedimos monitoreo de la calidad del agua.",
    fragmentos: [],
    extracciones: [],
  },
];

export const isDemoData = true;
