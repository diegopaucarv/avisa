/**
 * Traductores puros entre el contrato real de la API (`/api/v1/...`) y los
 * tipos `Demo*` que consumen los componentes existentes.
 *
 * Regla: aquí no se inventan datos. Cuando la API no expone un campo se usa
 * `""`, `[]` o `undefined` según el tipo y se deja un comentario con el hueco.
 */
import type {
  CasePriority,
  CaseState,
  DataOrigin,
  DemoActor,
  DemoAlert,
  DemoCase,
  DemoCommitment,
  DemoDemanda,
  DemoDocument,
  DemoHito,
  DemoNotification,
  DemoNotificationCategory,
  DocKind,
  DocState,
  NivelConflicto,
  RiskLevel,
  WorkspaceView,
} from "@/components/avisa-demo-data";
import type { Role, Session } from "@/frontend/types";

/* ------------------------------------------------------------------------- *
 * Contrato de la API (subconjunto que consume la interfaz)
 * ------------------------------------------------------------------------- */

export type ApiSessionUser = {
  dni: string;
  nombre: string;
  rol: string;
  roles: string[];
  id: string;
  area: string;
  email: string;
  cargo: string;
  regiones: string[];
};

export type ApiSessionResponse = {
  user: ApiSessionUser;
  scope: unknown;
  expiresAt: string;
};

export type ApiPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type ApiCollection<T> = {
  items: T[];
  total: number;
  generatedAt: string;
};

export type ApiCaseListItem = {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  progress: number | null;
  updated: string | null;
  updatedAt: string | null;
  region: string | null;
  estado: string | null;
  risk: string | null;
  prioridad: string | null;
  alcance: string | null;
  nivelConflicto: string | null;
  stage: string | null;
  tematica: string | null;
  subsector: string | null;
  unidadResponsable: string | null;
  origen: string | null;
  clasificacion: number;
};

export type ApiCaseActor = {
  id: string;
  nombre: string;
  naturaleza: string;
  tipo: string | null;
  funcion: string | null;
  posicionamiento: string | null;
  correo: string | null;
};

export type ApiCaseEvent = {
  id: string;
  fecha: string;
  tipo: string | null;
  descripcion: string;
  validado: boolean;
  critico: boolean;
  evidencia: string | null;
};

export type ApiCaseDemanda = {
  id: string;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  descripcion: string | null;
  estado: string;
  motivo: string | null;
};

export type ApiCaseDetail = {
  case: ApiCaseListItem;
  actors: ApiCaseActor[];
  events: ApiCaseEvent[];
  demandas: ApiCaseDemanda[];
  // `commitments` y `documents` del detalle no se mapean: `DemoCase` no tiene
  // esos campos y las listas globales ya cubren compromisos y documentos.
};

export type ApiAlertItem = {
  id: string;
  codigo: string;
  titulo: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  prioridad: string | null;
  slaHoras: number | null;
  grave: boolean | null;
  nivel: string | null;
  nivelCodigo: string | null;
  estado: string;
  fechaReporte: string | null;
  descripcionRiesgo: string | null;
  hechosRecientes: string | null;
  situacionActual: string | null;
  accionesOaipcs: string | null;
  riesgos: unknown;
  accionesSugeridas: unknown;
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  distrito: string | null;
  origen: string;
  confianza: number | null;
  validado: boolean;
  atendida: boolean;
};

export type ApiCommitmentHito = {
  id: string;
  descripcion: string | null;
  fecha: string | null;
  estado: string | null;
  terminal?: boolean | null;
};

export type ApiCommitmentItem = {
  id: string;
  codigo: string;
  accion: string;
  casoCode: string | null;
  casoTitulo: string | null;
  tipo: string | null;
  nivelGobierno: string | null;
  estado: string | null;
  estadoCategoria: string | null;
  terminal: boolean | null;
  fechaInicio: string | null;
  fechaVencimiento: string | null;
  fechaVencimientoEfectiva: string | null;
  unidad: string | null;
  atiendeGenero: boolean | null;
  evidenciaUri: string | null;
  documentoOrigenId: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean | null;
  clasificacion: number | null;
  hitos: ApiCommitmentHito[];
  vencido: boolean;
};

export type ApiDocumentItem = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  fecha: string | null;
  tipo: string | null;
  tipoNombre: string | null;
  estadoUi: string;
  resumen: string | null;
  archivo: string | null;
  casoCode: string | null;
  origen: string | null;
  confianza: number | null;
};

export type ApiNotificationItem = {
  id: string;
  tipo: string;
  entidadTipo: string | null;
  entidadId: string | null;
  venceEn: string | null;
  estado: string | null;
  createdAt: string | null;
};

/* ------------------------------------------------------------------------- *
 * Utilidades
 * ------------------------------------------------------------------------- */

/**
 * Fechas puras (`YYYY-MM-DD`) o ISO. Se parte la cadena en lugar de usar
 * `new Date(...)` para no arrastrar desfases de zona horaria.
 */
function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
  const [year, month, day] = text.slice(0, 10).split("-");
  if (!year || !month || !day) return text;
  return `${day}/${month}/${year}`;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return items.length ? items : undefined;
}

/* ------------------------------------------------------------------------- *
 * Sesión
 * ------------------------------------------------------------------------- */

/** Códigos de rol de `core.roles` que la interfaz usa en sus permisos. */
const ROLE_BY_DB_CODE: Record<string, Role> = {
  direccion_oaipcs: "Directora",
  administrador: "Admin",
  alta_direccion: "Autoridad",
  sectorista: "Sectorista",
  consulta_lectura: "PuntoFocal",
};

const UI_ROLES = new Set<string>([
  "Admin",
  "Sectorista",
  "Directora",
  "PuntoFocal",
  "Autoridad",
]);

function toUiRole(value: string): Role {
  if (UI_ROLES.has(value)) return value as Role;
  return ROLE_BY_DB_CODE[value] ?? "PuntoFocal";
}

/**
 * `GET /api/v1/session` devuelve el rol como código de `core.roles`, no como
 * etiqueta de interfaz (el endpoint de login sí traduce). Aquí se replica esa
 * traducción para no romper `Session.rol` ni el alcance territorial.
 */
export function mapSessionUser(user: ApiSessionUser): Session {
  return {
    dni: user.dni,
    nombre: user.nombre,
    rol: toUiRole(user.rol),
    id: user.id,
    area: user.area,
    email: user.email,
    cargo: user.cargo,
    regiones: user.regiones,
    rolCodigo: user.rol,
    roles: user.roles,
  };
}

/* ------------------------------------------------------------------------- *
 * Selectores de catálogo (sin inventar valores fuera de los tipos demo)
 * ------------------------------------------------------------------------- */

// Clave de comparación tolerante: sin tildes, sin mayúsculas y sin espacios
// sobrantes. Permite aceptar etiquetas legadas y normalizadas a la vez.
const key = (value: string | null) =>
  value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase() ?? "";

// Si la base no trae nivel de riesgo se usa el nivel más bajo como valor neutro;
// no se crea un nivel nuevo.
function pickRisk(value: string | null): RiskLevel {
  return value === "Alto" || value === "Moderado" || value === "Bajo"
    ? value
    : "Bajo";
}

function pickOrigin(value: string | null): DataOrigin | undefined {
  switch (value) {
    case "MANUAL":
    case "Manual":
      return "Manual";
    case "KAG":
    case "WORKFLOW":
    case "Ingesta":
      return "Ingesta";
    case "AVISA_HISTORICO":
    case "Legado":
      return "Legado";
    case "WHATSAPP":
    case "WhatsApp":
      return "WhatsApp";
    default:
      return undefined;
  }
}

function pickCaseState(value: string | null): CaseState | undefined {
  switch (value) {
    // El catálogo se unificó en `Abierto` (migración 33). El tipo `CaseState`
    // vive en `components/avisa-demo-data`, que es el espejo Next congelado y
    // conserva el valor antiguo: el puente se hace aquí, sin tocar la referencia.
    case "Abierto":
      return "Activo";
    case "Activo":
      return "Activo";
    case "En seguimiento":
      return "En seguimiento";
    case "Resuelto":
      return "Resuelto";
    case "Archivado":
      return "Archivado";
    default:
      return undefined;
  }
}

function pickCasePriority(value: string | null): CasePriority | undefined {
  switch (value) {
    case "Urgente":
      return "Urgente";
    case "Moderado":
      return "Moderado";
    case "Bajo":
      return "Bajo";
    default:
      return undefined;
  }
}

function pickNivelConflicto(value: string | null): NivelConflicto | undefined {
  switch (key(value).replace(/_/g, " ")) {
    case "diferencia":
      return "Diferencia";
    case "controversia":
      return "Controversia";
    case "conflicto social":
      return "Conflicto social";
    case "crisis social":
      return "Crisis social";
    default:
      return undefined;
  }
}

function pickAlcance(value: string | null): DemoCase["alcance"] {
  switch (value) {
    case "Norte":
    case "Centro":
    case "Sur":
    case "Oriente":
    case "Nacional":
      return value;
    default:
      return undefined;
  }
}

function pickSubsector(value: string | null): DemoCase["subsector"] {
  switch (key(value)) {
    case "pesca y acuicultura":
      return "Pesca y Acuicultura";
    case "mype e industria":
      return "MYPE e Industria";
    default:
      return undefined;
  }
}

function pickActorType(tipo: string | null): DemoActor["tipo"] {
  switch (key(tipo)) {
    case "social":
    case "actor social":
      return "Social";
    case "publico":
    case "actor publico":
    case "actor del estado":
      return "Público";
    case "privado":
    case "actor privado":
      return "Privado";
    default:
      // Tipos institucionales (NEC, SANIPES, CITE...) no tienen equivalente
      // demo; se agrupan como públicos para no crear una categoría nueva.
      return "Público";
  }
}

function pickActorFunction(value: string | null): DemoActor["funcion"] {
  switch (key(value).replace(/_/g, " ")) {
    case "principal":
      return "Principal";
    case "tercero":
    case "tercero imparcial":
      return "Tercero imparcial";
    case "secundario":
    case "no determinado":
    default:
      return "Secundario";
  }
}

function pickActorPosition(value: string | null): DemoActor["posicionamiento"] {
  switch (key(value)) {
    case "legitimante":
      return "Legitimante";
    case "disruptivo":
    case "conflictivo":
      return "Conflictivo";
    case "dialogante":
    default:
      return "Dialogante";
  }
}

function pickDemandaEstado(value: string): DemoDemanda["estado"] {
  switch (value) {
    case "En proceso":
      return "En proceso";
    case "Atendida":
      return "Atendida";
    case "Desestimada":
      return "Desestimada";
    case "Pendiente":
    default:
      return "Pendiente";
  }
}

function pickAlertPriority(
  value: string | null,
  grave: boolean | null,
): DemoAlert["priority"] {
  // El nombre del nivel puede traer el SLA entre paréntesis; se ignora para que
  // un cambio futuro del texto no degrade la prioridad derivada.
  const level = key(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/[_-]+/g, " ")
    .trim();
  switch (level) {
    case "critica inmediata":
    case "inmediato":
      return "Crítica";
    case "urgente":
    case "tactico":
      return "Alta";
    case "temprana":
    case "seguimiento":
    case "preventivo":
    case "monitoreo":
      return "Media";
    default:
      return grave ? "Alta" : "Media";
  }
}

function pickAlertStatus(value: string): DemoAlert["status"] {
  switch (value) {
    case "Atendida":
      return "Atendida";
    case "Aprobada":
      return "Aprobada";
    case "Validada":
    case "En revisión":
    case "Pendiente de revisión":
    default:
      return "Pendiente de revisión";
  }
}

function pickCommitmentStatus(
  item: ApiCommitmentItem,
): DemoCommitment["status"] {
  if (item.estado === "Cumplido") return "Cumplido";
  // Vencido y no terminal: se muestra como paralizado, que es el estado demo
  // que la bandeja usa para contar compromisos fuera de plazo.
  if (item.vencido && !item.terminal) return "Paralizado";
  return "En curso";
}

function pickCommitmentType(value: string | null): DemoCommitment["tipo"] {
  return value === "Actividad" || value === "PIP" ? value : undefined;
}

function pickGovernmentLevel(
  value: string | null,
): DemoCommitment["nivelGobierno"] {
  switch (value) {
    case "Nacional":
      return "Nacional";
    case "Regional":
      return "Regional";
    case "Local":
      return "Local";
    case "Empresa":
      return "Empresa";
    case "Sociedad Civil":
    case "Sociedad_Civil":
      return "Sociedad Civil";
    default:
      return undefined;
  }
}

function pickHitoState(value: string | null): DemoHito["estado"] {
  switch (value) {
    case "Registrado":
      return "Registrado";
    case "En ejecucion":
    case "En ejecución":
      return "En ejecución";
    case "Paralizado":
      return "Paralizado";
    case "Cumplido":
      return "Cumplido";
    case "Desestimado":
      return "Desestimado";
    default:
      return "Registrado";
  }
}

function pickDocKind(value: string | null): DocKind {
  switch (value) {
    case "relatoria":
      return "relatoria";
    case "acta":
      return "acta";
    case "entrevista":
      return "entrevista";
    case "dato_externo":
      return "dato_externo";
    default:
      // El catálogo real no tiene "entrevista" ni "dato_externo"; el resto de
      // tipos documentales se muestran como informe.
      return "informe";
  }
}

function pickDocState(value: string): DocState {
  switch (value) {
    case "En análisis":
      return "En análisis";
    case "Extraído":
      return "Extraído";
    case "Validado":
      return "Validado";
    case "Rechazado":
      return "Rechazado";
    case "Cargado":
    default:
      return "Cargado";
  }
}

function pickNotificationCategory(hint: string): DemoNotificationCategory {
  if (hint.includes("alerta")) return "Alerta";
  if (hint.includes("compromiso")) return "Compromiso";
  if (hint.includes("documento")) return "Documento";
  if (hint.includes("caso")) return "Caso";
  return "Sistema";
}

function pickNotificationView(hint: string): WorkspaceView {
  if (hint.includes("alerta")) return "alerts";
  if (hint.includes("compromiso")) return "commitments";
  if (hint.includes("documento")) return "documents";
  if (hint.includes("caso")) return "case-detail";
  return "inbox";
}

/* ------------------------------------------------------------------------- *
 * Mapeadores
 * ------------------------------------------------------------------------- */

function mapActor(actor: ApiCaseActor): DemoActor {
  return {
    // La API entrega un nombre completo; el tipo demo lo separa en dos campos.
    apellidos: "",
    nombres: actor.nombre,
    correo: actor.correo ?? undefined,
    tipo: pickActorType(actor.tipo),
    funcion: pickActorFunction(actor.funcion),
    posicionamiento: pickActorPosition(actor.posicionamiento),
  };
}

function mapEvent(event: ApiCaseEvent): DemoCase["events"][number] {
  // El detalle del caso no expone `origen`; se usa `tipo` para detectar
  // eventos de sistema y, si no, la validación humana.
  const isSystem = /sistema|system/i.test(event.tipo ?? "");
  const kind = isSystem ? "system" : event.validado ? "validated" : "pending";
  return {
    id: event.id,
    date: formatDate(event.fecha),
    // La API no tiene título de evento: se usa el tipo como título.
    title: event.tipo ?? "Evento registrado",
    description: event.descripcion,
    kind,
    estado: event.validado ? "Validado" : "Pendiente",
    evidencia: event.evidencia ?? undefined,
  };
}

function mapDemanda(demanda: ApiCaseDemanda): DemoDemanda {
  return {
    id: demanda.id,
    problema: demanda.problema ?? demanda.descripcion ?? "",
    propuesta: demanda.propuesta ?? undefined,
    pedido: demanda.pedido ?? demanda.descripcion ?? "",
    estado: pickDemandaEstado(demanda.estado),
    // fuentes: la API no expone trazabilidad a documento/fragmento en el detalle.
  };
}

export function mapCase(
  item: ApiCaseListItem,
  detail?: ApiCaseDetail,
): DemoCase {
  return {
    code: item.code,
    title: item.title,
    region: item.region ?? "",
    // TODO(labels-v10): subject retirado
    subject: "",
    risk: pickRisk(item.risk),
    stage: item.stage ?? "",
    updated: formatDate(item.updated),
    progress: item.progress ?? 0,
    summary: item.summary ?? "",
    actors: detail ? detail.actors.map(mapActor) : [],
    events: detail ? detail.events.map(mapEvent) : [],
    alcance: pickAlcance(item.alcance),
    estado: pickCaseState(item.estado),
    nivelConflicto: pickNivelConflicto(item.nivelConflicto),
    prioridad: pickCasePriority(item.prioridad),
    subsector: pickSubsector(item.subsector),
    // documentacionNormativa: la API no expone documentos normativos del caso.
    unidadResponsable: item.unidadResponsable ?? undefined,
    // puntoFocal: la API no expone un punto focal nominal.
    tematica: item.tematica ?? undefined,
    origen: pickOrigin(item.origen),
    // validado: el caso no expone indicador de validación; queda sin dato.
    demandas: detail ? detail.demandas.map(mapDemanda) : [],
  };
}

export function mapAlert(item: ApiAlertItem): DemoAlert {
  return {
    id: item.codigo || item.id,
    title: item.titulo ?? item.codigo,
    location: item.distrito ?? "",
    source: item.fuenteDescripcion ?? item.fuenteTipo ?? "",
    published: formatDate(item.fechaReporte),
    priority: pickAlertPriority(item.prioridad, item.grave),
    // risk: la lista de alertas no expone un nivel de riesgo del caso.
    // alertType: el catálogo legado no tiene equivalente directo AT/RR/PAR.
    status: pickAlertStatus(item.estado),
    quote: item.descripcionRiesgo ?? "",
    note: item.situacionActual ?? item.hechosRecientes ?? "",
    caseCode: item.casoCode ?? undefined,
    slaHours: item.slaHoras ?? undefined,
    origen: pickOrigin(item.origen),
    validado: item.validado,
    riesgos: toStringArray(item.riesgos),
    acciones: toStringArray(item.accionesSugeridas),
  };
}

function mapHito(hito: ApiCommitmentHito): DemoHito {
  return {
    id: hito.id,
    descripcion: hito.descripcion ?? "",
    fecha: formatDate(hito.fecha),
    estado: pickHitoState(hito.estado),
  };
}

export function mapCommitment(item: ApiCommitmentItem): DemoCommitment {
  return {
    id: item.codigo || item.id,
    title: item.accion,
    caseCode: item.casoCode ?? "",
    // owner: la API sólo expone la unidad responsable, no una persona nominal.
    owner: item.unidad ?? "",
    due: formatDate(item.fechaVencimientoEfectiva ?? item.fechaVencimiento),
    status: pickCommitmentStatus(item),
    // progress: la API no expone avance porcentual; se deja en 0.
    progress: 0,
    tipo: pickCommitmentType(item.tipo),
    nivelGobierno: pickGovernmentLevel(item.nivelGobierno),
    unidadResponsable: item.unidad ?? undefined,
    documentoOrigenId: item.documentoOrigenId ?? undefined,
    evidenciaUri: item.evidenciaUri ?? undefined,
    // clasificacion: la base guarda un nivel numérico, sin equivalente
    // Formal/Verbal en el tipo demo.
    atiendeGenero: item.atiendeGenero ?? undefined,
    fechaInicio: item.fechaInicio ? formatDate(item.fechaInicio) : undefined,
    origen: pickOrigin(item.origen),
    validado: item.validado ?? undefined,
    hitos: (item.hitos ?? []).map(mapHito),
  };
}

export function mapDocument(item: ApiDocumentItem): DemoDocument {
  return {
    id: item.id,
    codigo: item.codigo ?? "",
    kind: pickDocKind(item.tipo),
    titulo: item.titulo ?? "",
    fecha: formatDate(item.fecha),
    archivo: item.archivo ?? "",
    origen: pickOrigin(item.origen) ?? "Manual",
    estado: pickDocState(item.estadoUi),
    confianza: item.confianza ?? undefined,
    resumen: item.resumen ?? undefined,
    casoCode: item.casoCode ?? undefined,
    // subidoPor: la API sólo expone responsableUsuarioId (uuid), no el nombre.
    subidoPor: "",
    // texto/fragmentos/extracciones: el listado no los expone.
    fragmentos: [],
    extracciones: [],
  };
}

export function mapNotification(item: ApiNotificationItem): DemoNotification {
  const hint = `${item.entidadTipo ?? ""} ${item.tipo}`.toLowerCase();
  return {
    id: item.id,
    categoria: pickNotificationCategory(hint),
    titulo: item.tipo || "Notificación",
    detalle: item.entidadId ?? "",
    fecha: formatDate(item.venceEn ?? item.createdAt),
    leida: false,
    view: pickNotificationView(hint),
    refCode: item.entidadId ?? undefined,
  };
}
