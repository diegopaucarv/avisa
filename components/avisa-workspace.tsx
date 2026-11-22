"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  Archive,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileStack,
  Filter,
  Info,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  demoCases,
  demoCommitments,
  docKindLabels,
  type DemandaFuente,
  type DemoAlert,
  type DemoCase,
  type DemoCommitment,
  type DemoDemanda,
  type DemoHito,
  type WorkspaceView,
} from "./avisa-demo-data";
import { AvisaDirectory } from "./avisa-directory";
import {
  describeTimeScope,
  isWithinDemoWindow,
  isTerritoryVisible,
  type RegionScope,
  type TimeRange,
  type TimeScope,
} from "./avisa-scope-filter";
import {
  AlertForm,
  CaseEventForm,
  CaseForm,
  CommitmentForm,
  DeleteButton,
  DemandaForm,
  DocumentUploadForm,
} from "./avisa-crud";
import { AvisaDocuments } from "./avisa-documents";
import { CommitmentCalendar } from "./avisa-calendar";
import { demoExportNote, downloadCsv } from "./avisa-export";
import { useAvisa } from "@/lib/avisa-store";
import {
  demoReferenceDate,
  deriveCommitmentDueState,
  deriveCommitmentStatus,
  deriveGeographicScope,
  parseDemoDate,
  parseDemoDateTime,
  toDateInputValue,
} from "./avisa-catalogs";
import { GlossaryTerm, type GlossaryKey } from "./avisa-glossary";
import {
  EmptyState,
  LoadingState,
  ViewErrorBoundary,
} from "./avisa-view-state";

const AvisaMap = dynamic(() => import("./avisa-map"), {
  ssr: false,
  loading: () => (
    <LoadingState
      className="map-loading"
      compact
      label="Cargando mapa demostrativo…"
      detail="El módulo del mapa se carga solo en el navegador."
    />
  ),
});

type WorkspaceProps = {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  selectedCase: DemoCase;
  onSelectCase: (item: DemoCase) => void;
  alerts: DemoAlert[];
  onAlertUpdate: (
    id: string,
    status: DemoAlert["status"],
    note?: string,
  ) => void;
  onAlertEdit: (id: string, quote: string) => void;
  regionScope: RegionScope;
  timeScope: TimeScope;
  timeRange?: TimeRange;
  assignedRegions: RegionScope[];
  unrestricted: boolean;
};

function SectionTitle({
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title-row">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function RiskBadge({ level }: { level?: string }) {
  if (!level) return <span className="risk-inactive">Inactivo</span>;
  return (
    <span className={`status-badge risk-${level.toLowerCase()}`}>
      <span className="status-dot" />
      {level}
    </span>
  );
}
function DemoNotice() {
  return (
    <div className="demo-notice" role="status">
      <Info size={15} />

    </div>
  );
}
function governmentLevelLabel(level?: string) {
  if (!level) return "Nacional";
  return level === "Regional" ? "GORE" : level;
}
function Freshness() {
  return (
    <span className="freshness">
      <span className="freshness-dot" />
      Actualizado hace menos de 1 min
    </span>
  );
}
function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "blue",
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Clock3;
  tone?: string;
  trend?: "up" | "down";
}) {
  const TrendIcon = trend === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={17} />
      </div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>
          {trend && <TrendIcon size={12} />} {detail}
        </small>
      </div>
    </article>
  );
}
function PriorityLabel({ priority }: { priority: string }) {
  return (
    <span className={`priority-label priority-${priority.toLowerCase()}`}>
      {priority}
    </span>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CASE_PAGE_SIZE = 6;

/** Identidad de demostración para la vista «Asignados a mí» de la bandeja. */
const demoViewer = {
  nombre: "Analista de enlace (demo)",
  owner: "Equipo sectorial",
  unidad: "OAIPCS",
};

/** Lista corta de responsables simulados para reasignar desde la bandeja. */
const demoOwners = [
  "Equipo sectorial",
  "Coordinación territorial",
  "Gobierno local (demo)",
  "Equipo técnico",
];

const caseRiskRank: Record<string, number> = { Alto: 0, Moderado: 1, Bajo: 2 };
const casePriorityRank: Record<string, number> = {
  Urgente: 0,
  Moderado: 1,
  Bajo: 2,
};

/** Riesgo derivado de la última alerta aprobada de un caso (regla de la demo). */
function latestApprovedRisk(items: DemoAlert[], caseCode: string) {
  return latestAlertByDate(
    items.filter(
      (alert) => alert.caseCode === caseCode && alert.status === "Aprobada",
    ),
  )?.risk;
}

function formatHourDistance(hours: number) {
  const absolute = Math.abs(hours);
  if (absolute < 1) return `${Math.max(1, Math.round(absolute * 60))} min`;
  if (absolute < 48) return `${Math.round(absolute)} h`;
  return `${Math.round(absolute / 24)} días`;
}

/** SLA calculado desde la publicación y las horas de revisión configuradas. */
function alertSlaState(item: DemoAlert) {
  const published = parseDemoDateTime(item.published);
  if (!published || item.slaHours === undefined)
    return {
      label: "SLA sin fecha",
      overdue: false,
      remainingHours: null as number | null,
    };
  const remainingHours =
    (published.getTime() +
      item.slaHours * HOUR_MS -
      demoReferenceDate.getTime()) /
    HOUR_MS;
  if (remainingHours <= 0)
    return {
      label: `SLA vencido hace ${formatHourDistance(-remainingHours)}`,
      overdue: true,
      remainingHours,
    };
  return {
    label: `SLA vence en ${formatHourDistance(remainingHours)}`,
    overdue: false,
    remainingHours,
  };
}

/** Cuenta regresiva del vencimiento de un compromiso. */
function commitmentCountdownState(item: DemoCommitment) {
  const due = parseDemoDate(item.due);
  if (!due)
    return { label: "sin fecha", overdue: false, days: null as number | null };
  const days = Math.round(
    (due.getTime() - demoReferenceDate.getTime()) / DAY_MS,
  );
  if (days < 0)
    return {
      label: `vencido hace ${Math.abs(days)} ${Math.abs(days) === 1 ? "día" : "días"}`,
      overdue: true,
      days,
    };
  if (days === 0) return { label: "vence hoy", overdue: false, days };
  return {
    label: `vence en ${days} ${days === 1 ? "día" : "días"}`,
    overdue: false,
    days,
  };
}

type InboxEntry = {
  key: string;
  refId: string;
  category: "Alerta" | "Compromiso" | "Caso";
  type: string;
  title: string;
  sub: string;
  priority: "Crítica" | "Alta" | "Media";
  rank: number;
  criterion: string;
  countdown: string;
  urgent: boolean;
  secondary: number;
  owner?: string;
  unit?: string;
  due?: string;
  slaHours?: number;
  progress?: number;
  fechaInicio?: string;
  status?: DemoCommitment["status"];
  open: () => void;
};

export function WorkspaceViewContent(props: WorkspaceProps) {
  return (
    <ViewErrorBoundary
      title="No se pudo mostrar esta vista"
      description="Un módulo de la vista falló al renderizar. Puedes reintentar o seguir usando el resto de la consola."
    >
      <WorkspaceViewBody {...props} />
    </ViewErrorBoundary>
  );
}

function WorkspaceViewBody({
  view,
  onNavigate,
  selectedCase,
  onSelectCase,
  alerts,
  onAlertUpdate,
  onAlertEdit,
  regionScope,
  timeScope,
  timeRange,
  assignedRegions,
  unrestricted,
}: WorkspaceProps) {
  const {
    cases: allCases,
    commitments: allCommitments,
    updateAlert,
    updateCommitment,
    archiveCommitment,
    restoreCommitment,
  } = useAvisa();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [inboxType, setInboxType] = useState("Todos");
  const [notice, setNotice] = useState("");
  const [caseViewMode, setCaseViewMode] = useState<"grid" | "table">("grid");
  const [caseSort, setCaseSort] = useState("recent");
  const [casePage, setCasePage] = useState(1);
  const [caseEstado, setCaseEstado] = useState("Todos");
  const [casePrioridad, setCasePrioridad] = useState("Todos");
  const [caseAlcance, setCaseAlcance] = useState("Todos");
  const [caseTematica, setCaseTematica] = useState("Todos");
  const [caseUnidad, setCaseUnidad] = useState("Todos");
  const [inboxViewer, setInboxViewer] = useState<"equipo" | "mio">("equipo");
  const [inboxAssignments, setInboxAssignments] = useState<
    Record<string, string>
  >({});
  const [alertStatus, setAlertStatus] = useState("Todos");
  const [commitmentStatus, setCommitmentStatus] = useState("Todos");
  const [commitmentView, setCommitmentView] = useState<
    "tabla" | "calendario" | "resumen"
  >("tabla");
  const [showArchived, setShowArchived] = useState(false);
  const inScope = (territory: string) =>
    isTerritoryVisible(territory, regionScope, assignedRegions, unrestricted);
  const inWindow = (date: string) =>
    isWithinDemoWindow(date, timeScope, timeRange);
  const scopedCases = useMemo(
    () =>
      allCases.filter((item) => inScope(item.region) && inWindow(item.updated)),
    [allCases, regionScope, timeScope, timeRange],
  );
  const scopedAlerts = alerts.filter(
    (item) => inScope(item.location) && inWindow(item.published),
  );
  const scopedCommitments = allCommitments.filter((item) => {
    const relatedCase = allCases.find((row) => row.code === item.caseCode);
    return relatedCase
      ? inScope(relatedCase.region) && inWindow(relatedCase.updated)
      : unrestricted;
  });
  const activeAlerts = scopedAlerts.filter(
    (item) => item.status === "Pendiente de revisión",
  );
  const handleAlertDecision = (
    id: string,
    status: DemoAlert["status"],
    note?: string,
  ) => {
    onAlertUpdate(id, status, note);
    setNotice(
      status === "Aprobada"
        ? "Alerta aprobada en la demostración. No se publicó ni se envió a sistemas externos."
        : status === "Descartada"
          ? "Alerta descartada en la demostración. El motivo queda representado solo en esta sesión."
          : status === "Atendida"
            ? "Alerta marcada como atendida en la demostración; queda registrada en el historial de esta sesión."
            : "Alerta reabierta para una nueva revisión humana en la demostración.",
    );
  };
  const handleAlertEdit = (id: string, quote: string) => {
    onAlertEdit(id, quote);
    setNotice(
      "Cita corregida en la demostración; la alerta sigue pendiente de revisión humana.",
    );
  };
  const handleAlertPatch = (
    id: string,
    patch: Partial<DemoAlert>,
    message: string,
  ) => {
    updateAlert(id, patch);
    setNotice(message);
  };
  const handleInboxAssign = (entry: InboxEntry, owner: string) => {
    setInboxAssignments((current) => ({ ...current, [entry.key]: owner }));
    if (entry.category === "Compromiso")
      updateCommitment(entry.refId, { owner });
    setNotice(
      `Asignación de demostración registrada: «${entry.title}» → ${owner}. Solo afecta a esta sesión.`,
    );
  };

  if (view === "overview")
    return (
      <Overview
        onNavigate={onNavigate}
        onSelectCase={onSelectCase}
        alerts={scopedAlerts}
        pendingAlerts={activeAlerts.length}
        cases={scopedCases}
        commitments={scopedCommitments}
        regionScope={regionScope}
        timeScope={timeScope}
        timeRange={timeRange}
      />
    );
  if (view === "inbox") {
    const entries: InboxEntry[] = [];
    scopedCommitments.forEach((item) => {
      if (item.archivado || item.status === "Cumplido" || item.progress >= 100)
        return;
      const countdown = commitmentCountdownState(item);
      const overdue = countdown.days !== null && countdown.days < 0;
      const withinWeek =
        countdown.days !== null && countdown.days >= 0 && countdown.days <= 7;
      if (
        !overdue &&
        !withinWeek &&
        item.status !== "Paralizado" &&
        item.status !== "Por vencer"
      )
        return;
      entries.push({
        key: `Compromiso-${item.id}`,
        refId: item.id,
        category: "Compromiso",
        type: overdue
          ? "Compromiso vencido"
          : item.status === "Paralizado"
            ? "Compromiso paralizado"
            : "Compromiso por vencer",
        title: item.title,
        sub: `${item.id} · ${item.owner} · vence ${item.due}`,
        priority: overdue || item.status === "Paralizado" ? "Crítica" : "Alta",
        rank: overdue ? 1 : 3,
        criterion: overdue ? "Plazo vencido" : "Vence en ≤ 7 días",
        countdown: countdown.label,
        urgent: overdue,
        secondary: countdown.days ?? Number.POSITIVE_INFINITY,
        owner: item.owner,
        unit: item.unidadResponsable,
        due: item.due,
        progress: item.progress,
        fechaInicio: item.fechaInicio,
        status: item.status,
        open: () => onNavigate("commitments"),
      });
    });
    activeAlerts.forEach((item) => {
      const sla = alertSlaState(item);
      const relatedCase = allCases.find((row) => row.code === item.caseCode);
      entries.push({
        key: `Alerta-${item.id}`,
        refId: item.id,
        category: "Alerta",
        type: "Alerta pendiente de revisión",
        title: item.title,
        sub: `${item.id} · ${item.location} · ${item.published}`,
        priority: item.priority,
        rank: 2,
        criterion: "SLA de revisión",
        countdown: sla.label,
        urgent: sla.overdue,
        secondary: sla.remainingHours ?? Number.POSITIVE_INFINITY,
        unit: relatedCase?.unidadResponsable,
        slaHours: item.slaHours,
        open: () => onNavigate("alerts"),
      });
    });
    scopedCases
      .filter((item) => item.risk === "Alto")
      .forEach((item) => {
        entries.push({
          key: `Caso-${item.code}`,
          refId: item.code,
          category: "Caso",
          type: "Caso de riesgo alto",
          title: item.title,
          sub: `${item.code} · ${item.region} · ${item.updated}`,
          priority: "Alta",
          rank: 4,
          criterion: "Caso de riesgo alto",
          countdown: item.updated ? `actualizado ${item.updated}` : "sin fecha",
          urgent: false,
          secondary: -dateTimeValue(item.updated),
          unit: item.unidadResponsable,
          open: () => {
            onSelectCase(item);
            onNavigate("case-detail");
          },
        });
      });
    entries.sort(
      (left, right) =>
        left.rank - right.rank ||
        left.secondary - right.secondary ||
        left.title.localeCompare(right.title, "es"),
    );
    const normalizedSearch = search.trim().toLocaleLowerCase("es");
    const visible = entries.filter((entry) => {
      const typeMatches = inboxType === "Todos" || entry.category === inboxType;
      const viewerMatches =
        inboxViewer === "equipo" ||
        (entry.category === "Compromiso"
          ? entry.owner === demoViewer.owner ||
            entry.unit === demoViewer.unidad ||
            inboxAssignments[entry.key] === demoViewer.owner
          : entry.unit === demoViewer.unidad ||
            inboxAssignments[entry.key] === demoViewer.owner);
      const searchMatches = `${entry.title} ${entry.sub} ${entry.type}`
        .toLocaleLowerCase("es")
        .includes(normalizedSearch);
      return typeMatches && viewerMatches && searchMatches;
    });
    return (
      <>
        <SectionTitle
          eyebrow="TRABAJO DEL DÍA"
          title="Bandeja de trabajo"
          description="Revisa primero lo urgente y lo que tiene un plazo próximo."
          action={<Freshness />}
        />
        <div className="inbox-focus">
          <div className="focus-icon">
            <Clock3 size={18} />
          </div>
          <div>
            <strong>{activeAlerts.length} alertas esperan revisión</strong>
            <span>
              La revisión humana es necesaria antes de cambiar su visibilidad.
            </span>
          </div>
          <button
            className="button-primary"
            onClick={() => onNavigate("alerts")}
          >
            Revisar alertas <ArrowRight size={15} />
          </button>
        </div>
        {notice && (
          <div className="inline-notice" role="status">
            <Check size={16} />
            {notice}
            <button onClick={() => setNotice("")} aria-label="Cerrar aviso">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="filter-bar filter-bar-wrap">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar en bandeja"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar caso, alerta o responsable"
            />
          </label>
          <label className="select-filter">
            Tipo{" "}
            <select
              aria-label="Filtrar bandeja por tipo"
              value={inboxType}
              onChange={(event) => setInboxType(event.target.value)}
            >
              <option>Todos</option>
              <option>Alerta</option>
              <option>Compromiso</option>
              <option>Caso</option>
            </select>
          </label>
          <div
            className="segmented"
            role="group"
            aria-label="Vista de la bandeja"
          >
            <button
              type="button"
              aria-pressed={inboxViewer === "equipo"}
              onClick={() => setInboxViewer("equipo")}
            >
              Todo el equipo
            </button>
            <button
              type="button"
              aria-pressed={inboxViewer === "mio"}
              onClick={() => setInboxViewer("mio")}
            >
              Asignados a mí
            </button>
          </div>
          <span className="result-count">
            {visible.length} tareas ordenadas
          </span>
        </div>
        <p className="inbox-order-note">
          <Filter size={13} /> Orden por urgencia: 1. plazo vencido · 2. SLA de
          alerta · 3. vence en ≤ 7 días · 4. caso de riesgo alto.
          {inboxViewer === "mio" && (
            <span>
              {" "}
              Vista asignada de demostración: {demoViewer.nombre} · owner{" "}
              {demoViewer.owner} · unidad {demoViewer.unidad} (solo esta
              sesión).
            </span>
          )}
        </p>
        <div className="work-list">
          {visible.map((entry) => (
            <InboxCard
              key={entry.key}
              entry={entry}
              assignment={inboxAssignments[entry.key]}
              onAssign={handleInboxAssign}
              onAlertUpdate={onAlertUpdate}
              onNotice={setNotice}
            />
          ))}
          {visible.length === 0 && (
            <EmptyState
              title="Sin tareas"
              description="No hay tareas para este tipo, vista y ámbito."
            />
          )}
        </div>
      </>
    );
  }
  if (view === "cases") {
    const riskOf = (code: string) => latestApprovedRisk(scopedAlerts, code);
    const tematicas = Array.from(
      new Set(
        scopedCases
          .map((item) => item.tematica)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((left, right) => left.localeCompare(right, "es"));
    const unidades = Array.from(
      new Set(
        scopedCases
          .map((item) => item.unidadResponsable)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((left, right) => left.localeCompare(right, "es"));
    const normalizedSearch = search.trim().toLocaleLowerCase("es");
    const filtered = scopedCases.filter((item) => {
      const matchesSearch =
        `${item.title} ${item.code} ${item.region} ${item.subject} ${item.tematica ?? ""} ${item.unidadResponsable ?? ""}`
          .toLocaleLowerCase("es")
          .includes(normalizedSearch);
      const matchesRisk =
        filter === "Todos" || (riskOf(item.code) ?? item.risk) === filter;
      const matchesEstado =
        caseEstado === "Todos" || item.estado === caseEstado;
      const matchesPrioridad =
        casePrioridad === "Todos" || item.prioridad === casePrioridad;
      const matchesAlcance =
        caseAlcance === "Todos" || item.alcance === caseAlcance;
      const matchesTematica =
        caseTematica === "Todos" || item.tematica === caseTematica;
      const matchesUnidad =
        caseUnidad === "Todos" || item.unidadResponsable === caseUnidad;
      return (
        matchesSearch &&
        matchesRisk &&
        matchesEstado &&
        matchesPrioridad &&
        matchesAlcance &&
        matchesTematica &&
        matchesUnidad
      );
    });
    const sorted = [...filtered].sort((left, right) => {
      if (caseSort === "risk") {
        const difference =
          (caseRiskRank[riskOf(left.code) ?? left.risk] ?? 3) -
          (caseRiskRank[riskOf(right.code) ?? right.risk] ?? 3);
        if (difference !== 0) return difference;
      } else if (caseSort === "priority") {
        const difference =
          (casePriorityRank[left.prioridad ?? ""] ?? 3) -
          (casePriorityRank[right.prioridad ?? ""] ?? 3);
        if (difference !== 0) return difference;
      }
      return (
        dateTimeValue(right.updated) - dateTimeValue(left.updated) ||
        left.code.localeCompare(right.code)
      );
    });
    const totalPages = Math.max(1, Math.ceil(sorted.length / CASE_PAGE_SIZE));
    const currentPage = Math.min(casePage, totalPages);
    const paged = sorted.slice(
      (currentPage - 1) * CASE_PAGE_SIZE,
      currentPage * CASE_PAGE_SIZE,
    );
    const activeFilterCount =
      (search.trim() ? 1 : 0) +
      [
        filter,
        caseEstado,
        casePrioridad,
        caseAlcance,
        caseTematica,
        caseUnidad,
      ].filter((value) => value !== "Todos").length;
    const resetFilters = () => {
      setSearch("");
      setFilter("Todos");
      setCaseEstado("Todos");
      setCasePrioridad("Todos");
      setCaseAlcance("Todos");
      setCaseTematica("Todos");
      setCaseUnidad("Todos");
      setCasePage(1);
    };
    const openCase = (item: DemoCase) => {
      onSelectCase(item);
      onNavigate("case-detail");
    };
    const exportCases = () => {
      const rows: (string | number)[][] = [
        [
          "Código",
          "Caso",
          "Región",
          "Temática",
          "Alcance",
          "Estado",
          "Prioridad",
          "Riesgo derivado",
          "Unidad responsable",
          "Etapa",
          "Actualizado",
        ],
        ...sorted.map((item) => [
          item.code,
          item.title,
          item.region,
          item.tematica ?? "Sin registro",
          item.alcance ?? "Sin registro",
          item.estado ?? "Sin registro",
          item.prioridad ?? "Sin registro",
          riskOf(item.code) ?? "Sin alerta aprobada",
          item.unidadResponsable ?? "Sin unidad",
          item.stage,
          item.updated,
        ]),
      ];
      downloadCsv(
        "casos-demo.csv",
        rows,
        demoExportNote(`Casos · ${sorted.length} registros filtrados`),
      );
    };
    return (
      <>
        <SectionTitle
          eyebrow="SEGUIMIENTO TERRITORIAL"
          title="Casos"
          description="Consulta estado, nivel de riesgo y evidencia validada."
          action={<CaseForm />}
        />
        <div className="filter-bar filter-bar-wrap">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar casos"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCasePage(1);
              }}
              placeholder="Buscar por código, tema o región"
            />
          </label>
          <label className="select-filter">
            Riesgo{" "}
            <select
              aria-label="Filtrar casos por riesgo derivado"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setCasePage(1);
              }}
            >
              <option>Todos</option>
              <option>Alto</option>
              <option>Moderado</option>
              <option>Bajo</option>
            </select>
          </label>
          <label className="select-filter">
            Estado{" "}
            <select
              aria-label="Filtrar casos por estado"
              value={caseEstado}
              onChange={(event) => {
                setCaseEstado(event.target.value);
                setCasePage(1);
              }}
            >
              <option>Todos</option>
              <option>Activo</option>
              <option>En seguimiento</option>
              <option>Resuelto</option>
              <option>Archivado</option>
            </select>
          </label>
          <label className="select-filter">
            Prioridad{" "}
            <select
              aria-label="Filtrar casos por prioridad"
              value={casePrioridad}
              onChange={(event) => {
                setCasePrioridad(event.target.value);
                setCasePage(1);
              }}
            >
              <option>Todos</option>
              <option>Urgente</option>
              <option>Moderado</option>
              <option>Bajo</option>
            </select>
          </label>
          <label className="select-filter">
            Alcance{" "}
            <select
              aria-label="Filtrar casos por alcance"
              value={caseAlcance}
              onChange={(event) => {
                setCaseAlcance(event.target.value);
                setCasePage(1);
              }}
            >
              <option>Todos</option>
              <option>Norte</option>
              <option>Centro</option>
              <option>Sur</option>
              <option>Oriente</option>
              <option>Nacional</option>
            </select>
          </label>
          <label className="select-filter">
            Temática{" "}
            <select
              aria-label="Filtrar casos por temática"
              value={caseTematica}
              onChange={(event) => {
                setCaseTematica(event.target.value);
                setCasePage(1);
              }}
            >
              <option>Todos</option>
              {tematicas.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="select-filter">
            Unidad{" "}
            <select
              aria-label="Filtrar casos por unidad responsable"
              value={caseUnidad}
              onChange={(event) => {
                setCaseUnidad(event.target.value);
                setCasePage(1);
              }}
            >
              <option>Todos</option>
              {unidades.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <span className="result-count">
            {sorted.length} casos demostrativos · {activeFilterCount} filtros
            activos
          </span>
          <button
            type="button"
            className="link-button"
            onClick={resetFilters}
            disabled={activeFilterCount === 0}
          >
            Limpiar filtros
          </button>
        </div>
        <div className="view-toolbar">
          <div className="segmented" role="group" aria-label="Vista de casos">
            <button
              type="button"
              aria-pressed={caseViewMode === "grid"}
              onClick={() => setCaseViewMode("grid")}
            >
              <LayoutGrid size={13} /> Tarjetas
            </button>
            <button
              type="button"
              aria-pressed={caseViewMode === "table"}
              onClick={() => setCaseViewMode("table")}
            >
              <List size={13} /> Tabla
            </button>
          </div>
          <label className="select-filter">
            Orden{" "}
            <select
              aria-label="Ordenar casos"
              value={caseSort}
              onChange={(event) => {
                setCaseSort(event.target.value);
                setCasePage(1);
              }}
            >
              <option value="recent">Fecha (más reciente)</option>
              <option value="risk">Riesgo (Alto → Bajo)</option>
              <option value="priority">Prioridad (Urgente → Bajo)</option>
            </select>
          </label>
          <button
            type="button"
            className="button-secondary"
            onClick={exportCases}
          >
            <Download size={14} /> Exportar CSV
          </button>
          <span className="export-hint">
            Exportación demostrativa con fecha y nota de encabezado.
          </span>
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            title="Sin casos"
            description="No hay casos para los filtros seleccionados."
          />
        ) : caseViewMode === "grid" ? (
          <div className="case-grid">
            {paged.map((item) => (
              <button
                key={item.code}
                className="case-card"
                onClick={() => openCase(item)}
                aria-label={`Abrir el caso ${item.code}: ${item.title}`}
              >
                <div className="case-card-top">
                  <span className="case-code">{item.code}</span>
                  <RiskBadge level={riskOf(item.code)} />
                </div>
                <h3>{item.title}</h3>
                <div className="case-location">
                  <MapPin size={14} />
                  {item.region} <span>·</span> {item.subject}
                </div>
                <p>{item.summary}</p>
                <div className="case-card-bottom">
                  <span>{item.stage}</span>
                  <span>
                    {item.updated} <ChevronRight size={14} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="table-caption">
                Casos de demostración · {sorted.length} resultados · el riesgo
                se deriva de la última alerta aprobada de cada caso.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Caso</th>
                  <th scope="col">Región</th>
                  <th scope="col">Temática</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Prioridad</th>
                  <th scope="col">Riesgo derivado</th>
                  <th scope="col">Unidad</th>
                  <th scope="col">Actualizado</th>
                  <th scope="col">Etapa</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((item) => (
                  <tr
                    key={item.code}
                    className="case-row-clickable"
                    onClick={() => openCase(item)}
                  >
                    <td>
                      <button
                        type="button"
                        className="table-link"
                        aria-label={`Abrir el caso ${item.code}: ${item.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openCase(item);
                        }}
                      >
                        {item.title}
                      </button>
                      <small>{item.code}</small>
                    </td>
                    <td>{item.region}</td>
                    <td>{item.tematica ?? "Sin registro"}</td>
                    <td>{item.estado ?? "Sin registro"}</td>
                    <td>{item.prioridad ?? "Sin registro"}</td>
                    <td>
                      {riskOf(item.code) ? (
                        <RiskBadge level={riskOf(item.code)} />
                      ) : (
                        <span className="risk-inactive">
                          Sin alerta aprobada
                        </span>
                      )}
                    </td>
                    <td>{item.unidadResponsable ?? "Sin unidad"}</td>
                    <td>{item.updated}</td>
                    <td>{item.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sorted.length > 0 && (
          <nav className="pagination" aria-label="Paginación de casos">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setCasePage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              Anterior
            </button>
            <span aria-live="polite">
              Página {currentPage} de {totalPages}
            </span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setCasePage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              Siguiente
            </button>
          </nav>
        )}
      </>
    );
  }
  if (view === "case-detail")
    return (
      <CaseDetail
        key={selectedCase.code}
        item={selectedCase}
        onNavigate={onNavigate}
      />
    );
  if (view === "directory-actors")
    return (
      <AvisaDirectory
        regionScope={regionScope}
        assignedRegions={assignedRegions}
        unrestricted={unrestricted}
        kind="Actor"
      />
    );
  if (view === "directory-organizations")
    return (
      <AvisaDirectory
        regionScope={regionScope}
        assignedRegions={assignedRegions}
        unrestricted={unrestricted}
        kind="Organización"
      />
    );
  if (view === "directory-institutions")
    return (
      <AvisaDirectory
        regionScope={regionScope}
        assignedRegions={assignedRegions}
        unrestricted={unrestricted}
        kind="Institución"
      />
    );
  if (view === "directory-locals")
    return (
      <AvisaDirectory
        regionScope={regionScope}
        assignedRegions={assignedRegions}
        unrestricted={unrestricted}
        kind="Local"
      />
    );
  if (view === "map")
    return (
      <ViewErrorBoundary
        title="No se pudo mostrar el mapa"
        description="El módulo del mapa no cargó en esta sesión de demostración. Puedes reintentar o seguir usando el resto de la consola."
      >
        <AvisaMap
          regionScope={regionScope}
          timeScope={timeScope}
          timeRange={timeRange}
          assignedRegions={assignedRegions}
          unrestricted={unrestricted}
          onSelectCase={(code) => {
            const item = allCases.find((row) => row.code === code);
            if (item) {
              onSelectCase(item);
              onNavigate("case-detail");
            }
          }}
        />
      </ViewErrorBoundary>
    );
  if (view === "alerts") {
    const filteredAlerts = scopedAlerts.filter(
      (item) =>
        `${item.title} ${item.location} ${item.id}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (alertStatus === "Todos" || item.status === alertStatus),
    );
    return (
      <>
        <SectionTitle
          eyebrow="CONTROL HUMANO · G20 / G21"
          title="Revisión de alertas"
          description="Comprueba la fuente y la cita antes de aprobar la visibilidad."
          action={
            <div className="view-actions">
              <span className="review-count">
                {activeAlerts.length} pendientes
              </span>
              <AlertForm />
            </div>
          }
        />
        {notice && (
          <div className="inline-notice" role="status">
            <Check size={16} />
            {notice}
            <button onClick={() => setNotice("")} aria-label="Cerrar aviso">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="filter-bar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar alertas"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar alerta, código o región"
            />
          </label>
          <label className="select-filter">
            Estado{" "}
            <select
              aria-label="Filtrar alertas por estado"
              value={alertStatus}
              onChange={(event) => setAlertStatus(event.target.value)}
            >
              <option>Todos</option>
              <option>Pendiente de revisión</option>
              <option>Aprobada</option>
              <option>Descartada</option>
              <option>Atendida</option>
            </select>
          </label>
          <span className="result-count">
            {filteredAlerts.length} alertas demostrativas
          </span>
        </div>
        <div className="alert-review-list">
          {filteredAlerts.map((item) => (
            <AlertReviewCard
              key={item.id}
              item={item}
              onUpdate={handleAlertDecision}
              onEdit={handleAlertEdit}
              onPatch={(patch, message) =>
                handleAlertPatch(item.id, patch, message)
              }
              onNavigate={onNavigate}
            />
          ))}
          {filteredAlerts.length === 0 && (
            <EmptyState
              title="Sin alertas"
              description="No hay alertas para este filtro."
            />
          )}
        </div>
      </>
    );
  }
  if (view === "commitments") {
    const filteredCommitments = scopedCommitments.filter((item) => {
      const matchesSearch =
        `${item.title} ${item.id} ${item.owner} ${item.caseCode}`
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchesStatus =
        commitmentStatus === "Todos" || item.status === commitmentStatus;
      const matchesArchive = showArchived
        ? Boolean(item.archivado)
        : !item.archivado;
      return matchesSearch && matchesStatus && matchesArchive;
    });
    const openCaseByCode = (caseCode: string) => {
      const found = allCases.find((row) => row.code === caseCode);
      if (found) {
        onSelectCase(found);
        onNavigate("case-detail");
      }
    };
    const exportAnexo = () => {
      const rows: (string | number)[][] = [
        [
          "Código",
          "Compromiso",
          "Caso",
          "Responsable",
          "Unidad",
          "Nivel de gobierno",
          "Tipo",
          "Clasificación",
          "Fecha de inicio",
          "Vencimiento",
          "Avance",
          "Estado",
          "Tipo de acuerdo",
          "Hitos cumplidos/total",
        ],
        ...filteredCommitments.map((item) => {
          const due = deriveCommitmentDueState(item.due, item.fechaInicio);
          const hitosTotal = item.hitos?.length ?? 0;
          const hitosCumplidos =
            item.hitos?.filter((hito) => hito.estado === "Cumplido").length ??
            0;
          return [
            item.id,
            item.title,
            item.caseCode,
            item.owner,
            item.unidadResponsable ?? "Sin unidad",
            governmentLevelLabel(item.nivelGobierno),
            item.tipo ?? "Sin tipo",
            item.clasificacion ?? "Sin clasificar",
            item.fechaInicio ?? "No registrado",
            `${item.due} (${due.label})`,
            `${item.progress}%`,
            item.status,
            item.agreementType ?? "Sin tipo de acuerdo",
            `${hitosCumplidos}/${hitosTotal}`,
          ];
        }),
      ];
      downloadCsv(
        "anexo-14-compromisos-demo.csv",
        rows,
        demoExportNote(
          `Anexo 14 · ${filteredCommitments.length} compromisos filtrados · ${showArchived ? "incluye archivados" : "sin archivados"}`,
        ),
      );
    };
    return (
      <>
        <SectionTitle
          eyebrow="SEGUIMIENTO DE ACUERDOS"
          title="Compromisos"
          description="Plazo, responsable y avance para anticipar vencimientos."
          action={
            <div className="view-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={exportAnexo}
              >
                <Download size={14} /> Anexo 14 (CSV)
              </button>
              <CommitmentForm />
            </div>
          }
        />
        {notice && (
          <div className="inline-notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Cerrar aviso">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="filter-bar filter-bar-wrap">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar compromisos"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar compromiso, responsable o caso"
            />
          </label>
          <label className="select-filter">
            Estado{" "}
            <select
              aria-label="Filtrar compromisos por estado"
              value={commitmentStatus}
              onChange={(event) => setCommitmentStatus(event.target.value)}
            >
              <option>Todos</option>
              <option>Paralizado</option>
              <option>Por vencer</option>
              <option>En curso</option>
              <option>Cumplido</option>
            </select>
          </label>
          <div
            className="segmented"
            role="group"
            aria-label="Vista de compromisos"
          >
            <button
              type="button"
              aria-pressed={commitmentView === "tabla"}
              onClick={() => setCommitmentView("tabla")}
            >
              Tabla
            </button>
            <button
              type="button"
              aria-pressed={commitmentView === "calendario"}
              onClick={() => setCommitmentView("calendario")}
            >
              Calendario
            </button>
            <button
              type="button"
              aria-pressed={commitmentView === "resumen"}
              onClick={() => setCommitmentView("resumen")}
            >
              Resumen
            </button>
          </div>
          <button
            type="button"
            className="button-secondary"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "Ocultar archivados" : "Ver archivados"}
          </button>
          <span className="result-count">
            {filteredCommitments.length} compromisos · vista{" "}
            {showArchived ? " de archivados" : " activa"}
          </span>
        </div>
        <p className="inbox-order-note">
          <Archive size={13} /> Los compromisos no se eliminan: se archivan con
          motivo y fecha, y pueden restaurarse. Vista de demostración.
        </p>
        {commitmentView === "tabla" && (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="table-caption">
                Compromisos de demostración · {filteredCommitments.length}{" "}
                resultados · el plazo se deriva de la fecha de vencimiento y el
                inicio registrado.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Compromiso</th>
                  <th scope="col">Caso</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Vencimiento</th>
                  <th scope="col">Avance</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredCommitments.map((item) => {
                  const due = deriveCommitmentDueState(
                    item.due,
                    item.fechaInicio,
                  );
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <small>{item.id}</small>
                        {item.archivado && (
                          <small className="archived-note">
                            Archivado: {item.archivado.motivo} ·{" "}
                            {item.archivado.fecha}
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="table-link"
                          onClick={() => openCaseByCode(item.caseCode)}
                          aria-label={`Abrir el caso ${item.caseCode}`}
                        >
                          {item.caseCode}
                        </button>
                      </td>
                      <td>{item.owner}</td>
                      <td>
                        <span
                          className={
                            due.key === "vencido" ? "date-overdue" : ""
                          }
                        >
                          {item.due}
                        </span>
                        <small className={`due-state due-${due.key}`}>
                          Plazo: {due.label}
                        </small>
                      </td>
                      <td>
                        <div className="progress-cell">
                          <div className="progress-track">
                            <i style={{ width: `${item.progress}%` }} />
                          </div>
                          <span>{item.progress}%</span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`commit-status commit-${item.status.toLowerCase().replace(" ", "-")}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="row-actions">
                        <CommitmentForm item={item} />
                        <CommitmentArchiveControl item={item} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredCommitments.length === 0 && (
              <EmptyState
                title="Sin compromisos"
                description="No hay compromisos para este filtro."
              />
            )}
          </div>
        )}
        {commitmentView === "calendario" && (
          <CommitmentCalendar
            commitments={filteredCommitments}
            onOpenCase={openCaseByCode}
          />
        )}
        {commitmentView === "resumen" && (
          <>
            <div className="breakdown-grid">
              <CommitmentBreakdown
                title="Por responsable"
                commitments={filteredCommitments}
                dimension="owner"
              />
              <CommitmentBreakdown
                title="Por nivel de gobierno"
                commitments={filteredCommitments}
                dimension="nivel"
              />
            </div>
            <p className="quote-note">
              Conteo y barras derivados de los compromisos filtrados en esta
              sesión de demostración; «GORE» corresponde al nivel regional.
            </p>
          </>
        )}
      </>
    );
  }
  if (view === "documents")
    return (
      <AvisaDocuments
        regionScope={regionScope}
        assignedRegions={assignedRegions}
        unrestricted={unrestricted}
      />
    );
  return (
    <ExecutiveView
      onNavigate={onNavigate}
      pendingAlerts={activeAlerts.length}
    />
  );
}

function InboxCard({
  entry,
  assignment,
  onAssign,
  onAlertUpdate,
  onNotice,
}: {
  entry: InboxEntry;
  assignment?: string;
  onAssign: (entry: InboxEntry, owner: string) => void;
  onAlertUpdate: (
    id: string,
    status: DemoAlert["status"],
    note?: string,
  ) => void;
  onNotice: (message: string) => void;
}) {
  const { updateCommitment, updateAlert } = useAvisa();
  const [panel, setPanel] = useState<"" | "asignar" | "posponer" | "completar">(
    "",
  );
  const [ownerDraft, setOwnerDraft] = useState(
    assignment ?? entry.owner ?? demoOwners[0],
  );
  const [dueDraft, setDueDraft] = useState(toDateInputValue(entry.due));
  const [slaDraft, setSlaDraft] = useState(String(entry.slaHours ?? 24));
  const [error, setError] = useState("");
  const ownerOptions = Array.from(
    new Set(
      [entry.owner, assignment, ...demoOwners].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );

  const togglePanel = (next: "asignar" | "posponer" | "completar") => {
    setError("");
    if (panel === next) {
      setPanel("");
      return;
    }
    setPanel(next);
    if (next === "asignar")
      setOwnerDraft(assignment ?? entry.owner ?? demoOwners[0]);
    if (next === "posponer") {
      setDueDraft(toDateInputValue(entry.due));
      setSlaDraft(String(entry.slaHours ?? 24));
    }
  };

  const confirmAssign = () => {
    if (!ownerDraft) {
      setError("Selecciona un responsable de la lista de demostración.");
      return;
    }
    onAssign(entry, ownerDraft);
    setPanel("");
  };

  const confirmPostpone = () => {
    if (entry.category === "Compromiso") {
      if (!dueDraft) {
        setError("Indica la nueva fecha de vencimiento.");
        return;
      }
      const nextStatus = deriveCommitmentStatus({
        progress: entry.progress ?? 0,
        due: dueDraft,
        fechaInicio: entry.fechaInicio,
        paralizado: entry.status === "Paralizado",
      });
      updateCommitment(entry.refId, { due: dueDraft, status: nextStatus });
      onNotice(
        `Compromiso ${entry.refId} pospuesto al ${dueDraft}. Cambio solo en esta sesión.`,
      );
    } else {
      const hours = Number(slaDraft);
      if (!Number.isFinite(hours) || hours <= 0) {
        setError("El SLA debe ser mayor que 0 horas.");
        return;
      }
      updateAlert(entry.refId, { slaHours: Math.round(hours) });
      onNotice(
        `SLA de la alerta ${entry.refId} actualizado a ${Math.round(hours)} h. Cambio solo en esta sesión.`,
      );
    }
    setPanel("");
  };

  const confirmComplete = () => {
    if (entry.category === "Alerta") {
      onAlertUpdate(
        entry.refId,
        "Atendida",
        "Completada desde la bandeja de trabajo (demo).",
      );
      onNotice(
        `Alerta ${entry.refId} marcada como atendida. Queda en el historial de esta sesión.`,
      );
    } else if (entry.category === "Compromiso") {
      updateCommitment(entry.refId, { progress: 100, status: "Cumplido" });
      onNotice(
        `Compromiso ${entry.refId} cerrado con avance 100% y estado Cumplido. Solo en esta sesión.`,
      );
    }
    setPanel("");
  };

  return (
    <article className="work-card">
      <button
        type="button"
        className="work-card-main"
        onClick={entry.open}
        aria-label={`Abrir ${entry.type}: ${entry.title}`}
      >
        <span className={`work-type type-${entry.priority.toLowerCase()}`}>
          <span className="status-dot" />
          {entry.type}
        </span>
        <span className="work-card-copy">
          <strong>{entry.title}</strong>
          <small>{entry.sub}</small>
        </span>
        <span
          className={`work-countdown${entry.urgent ? " work-countdown-overdue" : ""}`}
        >
          {entry.countdown}
        </span>
        <span className="work-rationale">
          <span className="work-rationale-rank" aria-hidden="true">
            {entry.rank}
          </span>
          Criterio: {entry.criterion}
        </span>
        <PriorityLabel priority={entry.priority} />
      </button>
      <div className="work-card-actions">
        <button
          type="button"
          className="link-button"
          onClick={() => togglePanel("asignar")}
          aria-expanded={panel === "asignar"}
        >
          Asignar
        </button>
        {entry.category !== "Caso" && (
          <button
            type="button"
            className="link-button"
            onClick={() => togglePanel("posponer")}
            aria-expanded={panel === "posponer"}
          >
            Posponer
          </button>
        )}
        {entry.category !== "Caso" && (
          <button
            type="button"
            className="link-button"
            onClick={() => togglePanel("completar")}
            aria-expanded={panel === "completar"}
          >
            Completar
          </button>
        )}
        <span className="work-owner">
          {assignment
            ? `Asignación demo: ${assignment}`
            : entry.owner
              ? `Responsable: ${entry.owner}`
              : entry.unit
                ? `Unidad: ${entry.unit}`
                : "Sin asignar"}
        </span>
      </div>
      {panel === "asignar" && (
        <div className="work-action-form">
          <span>Asignación de demostración; solo afecta a esta sesión.</span>
          <select
            className="form-select"
            aria-label={`Responsable para ${entry.title}`}
            value={ownerDraft}
            onChange={(event) => setOwnerDraft(event.target.value)}
          >
            {ownerOptions.map((owner) => (
              <option key={owner}>{owner}</option>
            ))}
          </select>
          <button
            type="button"
            className="button-primary"
            onClick={confirmAssign}
          >
            Confirmar asignación
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setPanel("")}
          >
            Cancelar
          </button>
        </div>
      )}
      {panel === "posponer" && entry.category === "Compromiso" && (
        <div className="work-action-form">
          <span>Nuevo vencimiento del compromiso (demostración).</span>
          <input
            type="date"
            className="form-input"
            aria-label="Nueva fecha de vencimiento"
            value={dueDraft}
            onChange={(event) => setDueDraft(event.target.value)}
          />
          <button
            type="button"
            className="button-primary"
            onClick={confirmPostpone}
          >
            Confirmar fecha
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setPanel("")}
          >
            Cancelar
          </button>
        </div>
      )}
      {panel === "posponer" && entry.category === "Alerta" && (
        <div className="work-action-form">
          <span>Nuevo SLA de revisión de la alerta (demostración).</span>
          <input
            type="number"
            min={1}
            className="form-input"
            aria-label="Nuevo SLA en horas"
            value={slaDraft}
            onChange={(event) => setSlaDraft(event.target.value)}
          />
          <button
            type="button"
            className="button-primary"
            onClick={confirmPostpone}
          >
            Confirmar SLA
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setPanel("")}
          >
            Cancelar
          </button>
        </div>
      )}
      {panel === "completar" && (
        <div className="work-action-form">
          <span>
            {entry.category === "Alerta"
              ? "¿Marcar la alerta como atendida? Quedará registrado en el historial de esta sesión."
              : "¿Cerrar el compromiso con avance 100% y estado Cumplido? Solo en esta sesión."}
          </span>
          <button
            type="button"
            className="button-primary"
            onClick={confirmComplete}
          >
            Sí, completar
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setPanel("")}
          >
            Cancelar
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function CommitmentArchiveControl({ item }: { item: DemoCommitment }) {
  const { archiveCommitment, restoreCommitment } = useAvisa();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  if (item.archivado)
    return (
      <button
        type="button"
        className="link-button"
        onClick={() => restoreCommitment(item.id)}
        aria-label={`Restaurar el compromiso ${item.id}`}
      >
        <RotateCcw size={12} /> Restaurar
      </button>
    );

  if (!open)
    return (
      <button
        type="button"
        className="link-button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={`Archivar el compromiso ${item.id}`}
      >
        <Archive size={12} /> Archivar
      </button>
    );

  return (
    <span className="archive-form">
      <label htmlFor={`archive-${item.id}`}>
        Motivo de archivo (obligatorio)
      </label>
      <input
        id={`archive-${item.id}`}
        className="form-input"
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        placeholder="Ej.: duplicado o acuerdo sustituido"
      />
      <button
        type="button"
        className="button-danger"
        disabled={!motivo.trim()}
        onClick={() => {
          archiveCommitment(item.id, motivo);
          setOpen(false);
          setMotivo("");
        }}
      >
        Confirmar archivo
      </button>
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          setOpen(false);
          setMotivo("");
        }}
      >
        Cancelar
      </button>
    </span>
  );
}

function CommitmentBreakdown({
  title,
  commitments,
  dimension,
}: {
  title: string;
  commitments: DemoCommitment[];
  dimension: "owner" | "nivel";
}) {
  const counts = new Map<string, number>();
  commitments.forEach((item) => {
    const label =
      dimension === "owner"
        ? item.owner
        : governmentLevelLabel(item.nivelGobierno);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  const rows = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label, "es"),
    );
  const total = commitments.length;
  return (
    <section className="surface breakdown-card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="form-hint">Sin compromisos en la vista actual.</p>
      ) : (
        <ul className="breakdown-list">
          {rows.map((row) => {
            const percentage = total
              ? Math.round((row.count / total) * 100)
              : 0;
            return (
              <li key={row.label}>
                <span>{row.label}</span>
                <span className="breakdown-bar" aria-hidden="true">
                  <i style={{ width: `${percentage}%` }} />
                </span>
                <span className="breakdown-count">
                  {row.count} <small>{percentage}%</small>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Overview({
  onNavigate,
  onSelectCase,
  alerts,
  pendingAlerts,
  cases,
  commitments,
  regionScope,
  timeScope,
  timeRange,
}: Pick<WorkspaceProps, "onNavigate" | "onSelectCase" | "alerts"> & {
  pendingAlerts: number;
  cases: DemoCase[];
  commitments: typeof demoCommitments;
  regionScope: RegionScope;
  timeScope: TimeScope;
  timeRange?: TimeRange;
}) {
  const topCase = cases[0] ?? demoCases[0];
  const topAlert =
    alerts.find((item) => item.status === "Pendiente de revisión") ?? alerts[0];
  const highRiskCases = cases.filter((item) =>
    alerts.some(
      (alert) =>
        alert.caseCode === item.code &&
        alert.status === "Aprobada" &&
        alert.risk === "Alto",
    ),
  ).length;
  const dueCommitments = commitments.filter(
    (item) => item.status === "Paralizado" || item.status === "Por vencer",
  ).length;
  const signalTotal = [highRiskCases, pendingAlerts, dueCommitments].filter(
    (value) => value > 0,
  ).length;
  return (
    <>
      <DemoNotice />
      <div className="overview-heading">
        <div>
          <p className="section-eyebrow">
            {regionScope.toLocaleUpperCase("es")} ·{" "}
            {describeTimeScope(timeScope, timeRange).toLocaleUpperCase("es")}
          </p>
          <h2>Buenos días. Esto requiere atención.</h2>
          <p>Prioridades para orientar el trabajo de hoy.</p>
        </div>
        <Freshness />
      </div>
      <div className="stats-grid">
        <StatCard
          label="Casos activos"
          value={String(cases.length)}
          detail={`${cases.filter((item) => item.risk === "Alto").length} con riesgo alto`}
          icon={FileCheck2}
          tone="blue"
        />
        <StatCard
          label="Alertas por revisar"
          value={`${pendingAlerts}`}
          detail="Revisión humana pendiente"
          icon={ShieldCheck}
          tone="amber"
        />
        <StatCard
          label="Compromisos paralizados"
          value={String(
            commitments.filter((item) => item.status === "Paralizado").length,
          )}
          detail="Requiere seguimiento"
          icon={Clock3}
          tone="red"
          trend="up"
        />
        <StatCard
          label="Acuerdos a tiempo"
          value="78%"
          detail="Cifra demo · sin regla definida"
          icon={Check}
          tone="green"
        />
        <StatCard
          label="Intervenciones"
          value="18"
          detail="Cifra demo · sin regla definida"
          icon={Activity}
          tone="blue"
        />
      </div>
      <div className="overview-grid">
        <section className="surface priority-surface">
          <div className="surface-heading">
            <div>
              <p className="section-eyebrow">ENFOQUE RECOMENDADO</p>
              <h3>Tu bandeja de trabajo</h3>
              <p>Priorizada por vencimiento, riesgo y revisión humana.</p>
            </div>
            <button className="link-button" onClick={() => onNavigate("inbox")}>
              Abrir bandeja <ArrowRight size={14} />
            </button>
          </div>
          <button
            className="priority-task"
            onClick={() => onNavigate("alerts")}
          >
            <span className="task-icon alert-task">
              <ShieldCheck size={17} />
            </span>
            <span className="task-copy">
              <strong>
                {pendingAlerts === 0
                  ? "Sin alertas pendientes"
                  : "Revisar alerta pendiente"}
              </strong>
              <small>
                {topAlert
                  ? `${topAlert.location} · ${topAlert.published}`
                  : "Sin alertas pendientes"}
              </small>
            </span>
            <PriorityLabel priority="Crítica" />
            <ChevronRight size={16} />
          </button>
          <button
            className="priority-task"
            onClick={() => onNavigate("commitments")}
          >
            <span className="task-icon overdue-task">
              <Clock3 size={17} />
            </span>
            <span className="task-copy">
              <strong>Dar seguimiento a compromiso paralizado</strong>
              <small>{commitments[0]?.caseCode ?? "—"} · venció hoy</small>
            </span>
            <PriorityLabel priority="Alta" />
            <ChevronRight size={16} />
          </button>
          <button
            className="priority-task"
            onClick={() => {
              onSelectCase(topCase);
              onNavigate("case-detail");
            }}
          >
            <span className="task-icon case-task">
              <FileCheck2 size={17} />
            </span>
            <span className="task-copy">
              <strong>Consultar caso de riesgo alto</strong>
              <small>
                {topCase.code} · {topCase.region}
              </small>
            </span>
            <PriorityLabel priority="Alta" />
            <ChevronRight size={16} />
          </button>
        </section>
        <section className="surface signal-surface">
          <div className="surface-heading">
            <div>
              <p className="section-eyebrow">VISTA DE SEGUIMIENTO</p>
              <h3>Señales de hoy</h3>
              <p>
                Conteo sobre datos de demostración; definición pendiente de
                validación con OAIPCS.
              </p>
            </div>
            <span className="signal-total">
              {String(signalTotal).padStart(2, "0")}
            </span>
          </div>
          <div className="signal-list">
            <div>
              <span className="signal-marker signal-high" />
              <span>
                <strong>Riesgo alto</strong>
                <small>Casos con alerta aprobada</small>
              </span>
              <b>{highRiskCases}</b>
            </div>
            <div>
              <span className="signal-marker signal-pending" />
              <span>
                <strong>Por revisar</strong>
                <small>Alertas pendientes</small>
              </span>
              <b>{pendingAlerts}</b>
            </div>
            <div>
              <span className="signal-marker signal-due" />
              <span>
                <strong>Vencimientos</strong>
                <small>Compromisos paralizados / próximos</small>
              </span>
              <b>{dueCommitments}</b>
            </div>
          </div>
          <button
            className="signal-foot"
            onClick={() => onNavigate("executive")}
          >
            Ver resumen de Dirección <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="surface recent-surface">
        <div className="surface-heading">
          <div>
            <p className="section-eyebrow">ÚLTIMA ACTIVIDAD</p>
            <h3>Casos prioritarios</h3>
            <p>Avance reportado; no equivale a validación de evidencia.</p>
          </div>
          <button className="link-button" onClick={() => onNavigate("cases")}>
            Ver todos <ArrowRight size={14} />
          </button>
        </div>
        <div className="case-table">
          <div className="case-table-head">
            <span>Caso</span>
            <span>Región</span>
            <span>Estado</span>
            <span>Riesgo</span>
            <span>Avance</span>
          </div>
          {cases.map((item) => (
            <button
              className="case-table-row"
              key={item.code}
              onClick={() => {
                onSelectCase(item);
                onNavigate("case-detail");
              }}
            >
              <span>
                <strong>{item.title}</strong>
                <small>{item.code}</small>
              </span>
              <span>{item.region}</span>
              <span>{item.stage}</span>
              <RiskBadge
                level={
                  alerts.find(
                    (alert) =>
                      alert.caseCode === item.code &&
                      alert.status === "Aprobada",
                  )?.risk
                }
              />
              <span className="mini-progress">
                <span>{item.progress}%</span>
                <i>
                  <b style={{ width: `${item.progress}%` }} />
                </i>
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

const caseTabs = [
  "Resumen",
  "Demandas",
  "Cronología",
  "Documentos",
  "Alertas",
  "Compromisos",
] as const;
type CaseTab = (typeof caseTabs)[number];

function alertStateClass(status: string) {
  return status === "Aprobada" || status === "Atendida"
    ? "state-approved"
    : status === "Descartada"
      ? "state-dismissed"
      : "state-pending";
}

const alertTypeLabels: Record<NonNullable<DemoAlert["alertType"]>, string> = {
  AT: "AT · Alerta temprana",
  RR: "RR · Reporte rápido",
  PAR: "PAR · Plan de acción rápida",
};

const riskNextStep: Record<NonNullable<DemoAlert["risk"]>, string> = {
  Alto: "Activar intervención y tratamiento con coordinación intergubernamental.",
  Moderado: "Activar prevención y articulación intergubernamental.",
  Bajo: "Mantener monitoreo preventivo y actualizar la evidencia.",
};

const dateTimeValue = (value: string) =>
  parseDemoDateTime(value)?.getTime() ?? 0;

function alertTypeLabel(type?: DemoAlert["alertType"]) {
  return type ? alertTypeLabels[type] : alertTypeLabels.AT;
}

function latestAlertByDate(items: DemoAlert[]) {
  return [...items].sort(
    (left, right) =>
      dateTimeValue(right.published) - dateTimeValue(left.published),
  )[0];
}

function DemandaFuenteChip({
  demanda,
  campo,
  onNavigate,
}: {
  demanda: DemoDemanda;
  campo: DemandaFuente["campo"];
  onNavigate: (view: WorkspaceView) => void;
}) {
  const fuente = demanda.fuentes?.find((row) => row.campo === campo);
  if (!fuente)
    return <span className="fuente-empty">Sin fuente registrada</span>;
  const documento = fuente.documentoCodigo ?? fuente.documentoId ?? "Documento";
  const label = `Fuente: ${documento}${
    fuente.fragmentoId ? ` · fragmento ${fuente.fragmentoId}` : ""
  }`;
  return (
    <button
      type="button"
      className="fuente-chip fuente-link"
      aria-label={`Ver documentos · ${label}`}
      onClick={() => onNavigate("documents")}
    >
      {label} <ArrowRight size={11} />
    </button>
  );
}

function CommitmentHitoEditor({ commitment }: { commitment: DemoCommitment }) {
  const { addCommitmentHito, setCommitmentHitoEstado } = useAvisa();
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState("");
  const [error, setError] = useState("");
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!descripcion.trim())
      return setError("Describe el hito antes de agregarlo.");
    addCommitmentHito(commitment.id, {
      descripcion: descripcion.trim(),
      fecha: fecha || "Por definir",
    });
    setDescripcion("");
    setFecha("");
    setError("");
  };
  return (
    <div className="commitment-hitos">
      <div className="commitment-subhead">
        <span className="micro-label">Hitos</span>
        <span className="micro-label">
          {commitment.hitos?.length ?? 0} registrados
        </span>
      </div>
      {commitment.hitos?.length ? (
        <ul className="hito-list">
          {commitment.hitos.map((hito) => (
            <li key={hito.id} className="hito-row">
              <span className="hito-copy">
                <strong>{hito.descripcion}</strong>
                <small>{hito.fecha}</small>
              </span>
              <select
                className="form-select hito-select"
                aria-label={`Estado del hito ${hito.descripcion}`}
                value={hito.estado}
                onChange={(event) =>
                  setCommitmentHitoEstado(
                    commitment.id,
                    hito.id,
                    event.target.value as DemoHito["estado"],
                  )
                }
              >
                <option>Registrado</option>
                <option>En ejecución</option>
                <option>Paralizado</option>
                <option>Cumplido</option>
                <option>Desestimado</option>
              </select>
            </li>
          ))}
        </ul>
      ) : (
        <p className="form-hint">Sin hitos registrados.</p>
      )}
      <form className="inline-form" onSubmit={submit}>
        <input
          className="form-input"
          aria-label="Descripción del hito"
          value={descripcion}
          onChange={(event) => setDescripcion(event.target.value)}
          placeholder="Descripción del hito"
        />
        <input
          className="form-input"
          type="date"
          aria-label="Fecha del hito"
          value={fecha}
          onChange={(event) => setFecha(event.target.value)}
        />
        <button className="button-secondary" type="submit">
          Agregar hito
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function CommitmentEvidenceForm({
  commitment,
}: {
  commitment: DemoCommitment;
}) {
  const { addCommitmentEvidence } = useAvisa();
  const [nombre, setNombre] = useState("");
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nombre.trim()) return;
    addCommitmentEvidence(commitment.id, nombre.trim());
    setNombre("");
  };
  return (
    <div className="commitment-evidence">
      <span className="micro-label">Evidencias adjuntas</span>
      {commitment.evidencias?.length ? (
        <div className="evidence-chips">
          {commitment.evidencias.map((evidencia, index) => (
            <span
              key={`${evidencia.nombre}-${index}`}
              className="evidence-chip"
            >
              {evidencia.nombre}
            </span>
          ))}
        </div>
      ) : (
        <small className="form-hint">Sin adjuntos registrados.</small>
      )}
      {commitment.evidenciaUri && (
        <small className="legacy-evidence">
          Evidencia heredada (URI): {commitment.evidenciaUri}
        </small>
      )}
      <form className="inline-form" onSubmit={submit}>
        <input
          className="form-input"
          aria-label="Nombre de la evidencia"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          placeholder="Nombre del archivo simulado"
        />
        <button
          className="button-secondary"
          type="submit"
          disabled={!nombre.trim()}
        >
          Adjuntar
        </button>
      </form>
    </div>
  );
}

function CommitmentCard({
  commitment,
  onNavigate,
}: {
  commitment: DemoCommitment;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const { documents } = useAvisa();
  const due = deriveCommitmentDueState(commitment.due, commitment.fechaInicio);
  const sourceDoc = documents.find(
    (doc) => doc.id === commitment.documentoOrigenId,
  );
  const classificationClass =
    commitment.clasificacion === "Formal"
      ? "badge-formal"
      : commitment.clasificacion === "Verbal"
        ? "badge-verbal"
        : "badge-unclassified";
  return (
    <article
      className={`commitment-card${commitment.archivado ? " commitment-card-archived" : ""}`}
    >
      <button className="linked-row" onClick={() => onNavigate("commitments")}>
        <span className="linked-main">
          <span className="case-code">{commitment.id}</span>
          <strong>{commitment.title}</strong>
          <small>
            {governmentLevelLabel(commitment.nivelGobierno)} ·{" "}
            {commitment.owner} · vence {commitment.due}
          </small>
        </span>
        <span className="linked-progress">
          <i style={{ width: `${commitment.progress}%` }} />
        </span>
        <span className="linked-value">{commitment.progress}%</span>
        <span
          className={`commit-status commit-${commitment.status.toLowerCase().replace(" ", "-")}`}
        >
          {commitment.status}
        </span>
      </button>
      <div className="commitment-extras">
        <div className="badge-row">
          <span className="badge badge-agreement">
            {commitment.agreementType ?? "Sin tipo de acuerdo"}
          </span>
          <span className={`badge ${classificationClass}`}>
            {commitment.clasificacion ?? "Sin clasificar"}
          </span>
          <span className={`due-state due-${due.key}`}>Plazo: {due.label}</span>
          {commitment.tipo && <span className="badge">{commitment.tipo}</span>}
          {commitment.archivado && (
            <span className="badge badge-archived">Archivado</span>
          )}
        </div>
        <p className="quote-note">
          {due.detail} «Paralizado» es un estado de gestión y no significa que
          el plazo esté vencido.
        </p>
        <div className="commitment-meta">
          <span>Responsable: {commitment.owner}</span>
          <span>Inicio: {commitment.fechaInicio ?? "No registrado"}</span>
          <span>
            Documento origen:{" "}
            {sourceDoc
              ? `${sourceDoc.codigo} · ${sourceDoc.titulo}`
              : (commitment.documentoOrigenId ?? "No vinculado")}
          </span>
          <span>
            Recordatorio:{" "}
            {commitment.recordatorios?.length
              ? commitment.recordatorios
                  .map((dias) => `${dias} días antes`)
                  .join(", ")
              : "Sin recordatorio"}
          </span>
        </div>
        <CommitmentHitoEditor commitment={commitment} />
        <CommitmentEvidenceForm commitment={commitment} />
        <div className="row-actions commitment-actions">
          <CommitmentForm item={commitment} />
        </div>
      </div>
    </article>
  );
}

function CaseDetail({
  item,
  onNavigate,
}: {
  item: DemoCase;
  onNavigate: WorkspaceProps["onNavigate"];
}) {
  const {
    alerts,
    commitments,
    documents,
    updateCase,
    validateCaseEvent,
    deleteDemanda,
  } = useAvisa();
  const [tab, setTab] = useState<CaseTab>("Resumen");
  const caseAlerts = alerts.filter((row) => row.caseCode === item.code);
  const caseCommitments = commitments.filter(
    (row) => row.caseCode === item.code,
  );
  const caseDocuments = documents.filter((row) => row.casoCode === item.code);
  const latestApprovedAlert = latestAlertByDate(
    caseAlerts.filter((row) => row.status === "Aprobada"),
  );
  const activeCase =
    item.estado === "Activo" || item.estado === "En seguimiento";
  const displayedRisk = activeCase ? latestApprovedAlert?.risk : undefined;
  const riskRule = displayedRisk ? riskNextStep[displayedRisk] : null;
  const orderedEvents = item.events
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        dateTimeValue(right.event.date) - dateTimeValue(left.event.date),
    );
  const demandas = item.demandas ?? [];
  const pending = caseAlerts.filter(
    (row) => row.status === "Pendiente de revisión",
  ).length;
  const paralyzed = caseCommitments.filter(
    (row) => row.status === "Paralizado",
  ).length;
  const tabCount = (value: CaseTab) =>
    value === "Demandas"
      ? demandas.length
      : value === "Cronología"
        ? item.events.length
        : value === "Documentos"
          ? caseDocuments.length
          : value === "Alertas"
            ? caseAlerts.length
            : value === "Compromisos"
              ? caseCommitments.length
              : 0;
  return (
    <>
      <div className="breadcrumbs">
        <button onClick={() => onNavigate("cases")}>Casos</button>
        <ChevronRight size={13} />
        <span>{item.code}</span>
      </div>
      <DemoNotice />
      <div className="case-detail-header">
        <div>
          <div className="case-title-line">
            <span className="case-code">{item.code}</span>
            {displayedRisk ? (
              <>
                <RiskBadge level={displayedRisk} />
                <GlossaryTerm term="risk" />
              </>
            ) : (
              <span className="risk-inactive">
                {activeCase
                  ? "Sin alerta aprobada · riesgo no vigente"
                  : "Riesgo inactivo"}
              </span>
            )}
            <span className="validation-chip">
              Datos ilustrativos · prototipo
            </span>
          </div>
          <h2>{item.title}</h2>
          <p>
            <MapPin size={14} />
            Región: {item.region}
            <span>·</span>
            {item.subsector ?? item.subject}
            <span>·</span>Actualizado {item.updated}
          </p>
          <p className="case-origin">
            Estado del caso: {item.estado ?? "En seguimiento"}
            <span>·</span>Unidad responsable{" "}
            {item.unidadResponsable ?? "OAIPCS"}
          </p>
        </div>
        <div className="detail-actions">
          <CaseForm item={item} />
          <button
            className="button-secondary"
            onClick={() => onNavigate("documents")}
          >
            Documentos <ArrowRight size={14} />
          </button>
          <DeleteButton
            label="Archivar caso"
            confirmText="El caso y sus vínculos se conservan; solo cambia su estado a Archivado."
            onConfirm={() => {
              updateCase(item.code, {
                estado: "Archivado",
                stage: "Archivado",
              });
              onNavigate("cases");
            }}
          />
        </div>
      </div>
      <div className="case-signals">
        <span>
          <ShieldCheck size={14} />
          {caseAlerts.length} alertas · {pending} por revisar
        </span>
        <span>
          <Clock3 size={14} />
          {caseCommitments.length} compromisos · {paralyzed} paralizados
        </span>
        <span>
          <FileStack size={14} />
          {caseDocuments.length} documentos de respaldo
        </span>
      </div>
      <div className="tab-bar" role="tablist" aria-label="Secciones del caso">
        {caseTabs.map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={`tab-button ${tab === value ? "active" : ""}`}
            onClick={() => setTab(value)}
          >
            {value}
            {tabCount(value) > 0 && (
              <span className="tab-count">
                {String(tabCount(value)).padStart(2, "0")}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === "Resumen" && (
        <div className="case-detail-grid">
          <div className="detail-main">
            <section className="surface detail-section">
              <div className="detail-section-title">
                <h3>Resumen del caso</h3>
                <span className="validation-chip">Datos de demostración</span>
              </div>
              <p>{item.summary}</p>
              <div className="case-facts">
                {(
                  [
                    {
                      label: "Nivel de conflictividad",
                      value: item.nivelConflicto ?? "Diferencia",
                      term: "conflictLevel",
                    },
                    {
                      label: "Temática",
                      value: item.tematica ?? "Infraestructura",
                      term: "theme",
                    },
                    {
                      label: "Subsector",
                      value: item.subsector ?? item.subject,
                      term: "subsector",
                    },
                    {
                      label: "Prioridad de atención",
                      value: item.prioridad ?? "Moderado",
                      term: "priority",
                    },
                    {
                      label: "Alcance geográfico",
                      value: deriveGeographicScope(item.region),
                    },
                    { label: "Región", value: item.region },
                    {
                      label: "Unidad responsable",
                      value: item.unidadResponsable ?? "OAIPCS",
                    },
                    { label: "Estado", value: item.estado ?? "En seguimiento" },
                  ] as { label: string; value: string; term?: GlossaryKey }[]
                ).map(({ label, value, term }) => (
                  <div key={label}>
                    <span className="case-fact-label">
                      {label}
                      {term && <GlossaryTerm term={term} align="end" />}
                    </span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="quote-note">
                El nivel de riesgo se toma de la última alerta aprobada y no se
                interpreta como atributo permanente del caso.
              </p>
              <section className="normative-documentation">
                <div className="detail-section-title">
                  <h3>Documentación normativa relacionada</h3>
                  <span className="validation-chip">Referencias · demo</span>
                </div>
                {(item.documentacionNormativa ?? []).length ? (
                  <ul className="normative-list">
                    {(item.documentacionNormativa ?? []).map((entry, index) =>
                      typeof entry === "string" ? (
                        <li
                          key={`${entry}-${index}`}
                          className="normative-item"
                        >
                          <span className="normative-title">{entry}</span>
                          <span className="micro-label">
                            Referencia heredada · sin fecha
                          </span>
                        </li>
                      ) : (
                        <li
                          key={`${entry.titulo}-${index}`}
                          className="normative-item"
                        >
                          <span className="normative-title">
                            {entry.titulo}
                          </span>
                          <span className="normative-meta">
                            {entry.referencia ?? "Sin referencia"} ·{" "}
                            {entry.fecha ?? "Sin fecha"}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p>
                    No hay documentación normativa vinculada en esta
                    demostración.
                  </p>
                )}
                <button
                  className="link-button detail-link"
                  onClick={() => onNavigate("documents")}
                >
                  Ver documentos normativos <ArrowRight size={14} />
                </button>
              </section>
            </section>
            <section className="surface detail-section intervention-cycle">
              <div className="detail-section-title">
                <h3>Ruta de atención · Ciclo de Intervención Sectorial</h3>
              </div>
              <ol>
                <li>Intervención preventiva</li>
                <li>Intervención y tratamiento</li>
                <li>Monitoreo de compromisos</li>
                <li className="route-transversal">
                  Gestión del conocimiento (transversal)
                </li>
              </ol>
              <p>
                Las cuatro áreas pueden ocurrir al mismo tiempo: no son etapas
                rígidas ni una secuencia obligatoria.
              </p>
            </section>
          </div>
          <aside className="case-detail-aside">
            <section className="surface detail-section risk-panel">
              <div className="detail-section-title">
                <h3>Nivel de riesgo</h3>
                {displayedRisk ? (
                  <RiskBadge level={displayedRisk} />
                ) : (
                  <span className="risk-inactive">Inactivo</span>
                )}
              </div>
              <p className="risk-source">
                {displayedRisk && latestApprovedAlert ? (
                  <>
                    Valor mostrado · última alerta aprobada{" "}
                    <strong>{latestApprovedAlert.id}</strong>
                    {latestApprovedAlert.alertType
                      ? ` (${latestApprovedAlert.alertType})`
                      : ""}{" "}
                    con fecha {latestApprovedAlert.published}. Derivado de datos
                    simulados.
                  </>
                ) : !activeCase ? (
                  <>
                    El caso está en estado «{item.estado ?? "En seguimiento"}»;
                    el nivel de riesgo se muestra inactivo en gris y no aplica
                    mientras el caso no esté activo o en seguimiento.
                  </>
                ) : (
                  <>
                    Sin alerta aprobada: no hay un valor de riesgo vigente que
                    mostrar. Las alertas pendientes no fijan nivel hasta su
                    aprobación humana.
                  </>
                )}
              </p>
              <div className="case-facts risk-compare">
                <div>
                  <span className="case-fact-label">
                    Matriz de conflictividad del caso
                  </span>
                  <strong>{item.nivelConflicto ?? "Diferencia"}</strong>
                </div>
                <div>
                  <span className="case-fact-label">Fuente del riesgo</span>
                  <strong>
                    {displayedRisk && latestApprovedAlert
                      ? `Alerta ${latestApprovedAlert.id}`
                      : "Sin alerta aprobada"}
                  </strong>
                </div>
              </div>
              <p className="quote-note">
                El riesgo se deriva de la última alerta aprobada (guía 7.5.1) y
                no es un atributo permanente del caso; la conflictividad se
                mantiene solo como comparación.
              </p>
            </section>
            <section className="surface detail-section">
              <h3>Actores vinculados</h3>
              <p className="privacy-caption">
                <ShieldCheck size={13} /> Alias sintéticos · correo y teléfono
                opcionales
              </p>
              <div
                className="actor-definitions"
                aria-label="Definiciones de actor"
              >
                <span>
                  Tipo <GlossaryTerm term="actorType" />
                </span>
                <span>
                  Función <GlossaryTerm term="actorRole" />
                </span>
                <span>Posicionamiento</span>
              </div>
              <div className="actor-table-wrap">
                <table className="actor-table">
                  <thead>
                    <tr>
                      <th>Apellidos</th>
                      <th>Nombres</th>
                      <th>Correo</th>
                      <th>Teléfono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.actors.map((actor, index) => (
                      <tr key={`${actor.apellidos}-${index}`}>
                        <td>{actor.apellidos}</td>
                        <td>
                          {actor.nombres}
                          <span className="actor-tags">
                            <span>{actor.tipo}</span>
                            <span>{actor.funcion}</span>
                            <span>{actor.posicionamiento}</span>
                          </span>
                        </td>
                        <td>{actor.correo ?? "No registrado"}</td>
                        <td>{actor.telefono ?? "No registrado"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {item.actors.length === 0 && (
                <p className="quote-note">
                  Sin actores vinculados. Se incorporan al validar entrevistas o
                  relatorías.
                </p>
              )}
              <button
                className="link-button detail-link"
                onClick={() => onNavigate("directory-actors")}
              >
                Ver en el directorio <ArrowRight size={14} />
              </button>
            </section>
            <section className="surface detail-section">
              <div className="detail-section-title">
                <h3>Próximo paso sugerido</h3>
                <span
                  className={
                    displayedRisk
                      ? `risk-label risk-${displayedRisk.toLowerCase()}`
                      : "risk-inactive"
                  }
                >
                  {displayedRisk ?? "Inactivo"}
                </span>
              </div>
              {!activeCase ? (
                <p className="quote-note">
                  Caso inactivo: no se aplica la regla de próximo paso por
                  riesgo. Reactiva el caso para retomar la recomendación.
                </p>
              ) : displayedRisk && latestApprovedAlert && riskRule ? (
                <>
                  <p>{riskRule}</p>
                  <p className="risk-source">
                    Alerta <strong>{latestApprovedAlert.id}</strong> ·{" "}
                    {latestApprovedAlert.status} · riesgo{" "}
                    {displayedRisk.toLowerCase()}.
                    <br />
                    <span className="micro-label">
                      Regla: Tabla 3 · riesgo {displayedRisk.toLowerCase()}
                    </span>
                  </p>
                </>
              ) : (
                <p className="quote-note">
                  No existe una alerta aprobada para aplicar la regla de la
                  Tabla 3.{" "}
                  {pending
                    ? "Revisa las alertas pendientes de aprobación."
                    : "Registra o aprueba una alerta para obtener una recomendación."}
                </p>
              )}
              <button
                className="button-primary full-button"
                onClick={() =>
                  onNavigate(
                    pending || !latestApprovedAlert ? "alerts" : "commitments",
                  )
                }
              >
                {pending || !latestApprovedAlert
                  ? "Revisar alertas"
                  : "Ir a compromisos"}{" "}
                <ArrowRight size={14} />
              </button>
            </section>
          </aside>
        </div>
      )}
      {tab === "Demandas" && (
        <section className="surface detail-section">
          <div className="detail-section-title">
            <div>
              <h3>Demandas</h3>
              <p>
                Problema, propuesta y pedido tal como se registraron en la
                fuente.
                <GlossaryTerm term="threeP" />
              </p>
            </div>
            <div className="detail-actions">
              <span className="result-count">{demandas.length} demandas</span>
              <DemandaForm caseCode={item.code} />
            </div>
          </div>
          <div className="demanda-source-note">
            <p className="form-hint">
              Las demandas de demostración no tienen fuente trazada: no se
              inventa trazabilidad. Si una demanda tiene fuentes, cada campo
              muestra su documento y fragmento de origen.
            </p>
            <button
              className="link-button"
              onClick={() => onNavigate("documents")}
            >
              Ver documentos <ArrowRight size={13} />
            </button>
          </div>
          {demandas.length === 0 ? (
            <div className="empty-state">
              Sin demandas registradas. Se derivan de relatorías y entrevistas
              al aceptar una extracción.
            </div>
          ) : (
            <div className="demanda-list">
              {demandas.map((demanda, index) => (
                <article
                  className="demanda-card"
                  key={demanda.id ?? `${item.code}-d${index}`}
                >
                  <header>
                    <span className="micro-label">
                      DEMANDA {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`demanda-estado estado-${demanda.estado.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {demanda.estado}
                    </span>
                  </header>
                  <div className="demanda-grid">
                    <div>
                      <span className="micro-label">PROBLEMA</span>
                      <p>{demanda.problema}</p>
                      <DemandaFuenteChip
                        demanda={demanda}
                        campo="problema"
                        onNavigate={onNavigate}
                      />
                    </div>
                    <div>
                      <span className="micro-label">PROPUESTA</span>
                      <p>{demanda.propuesta ?? "No registrada"}</p>
                      <DemandaFuenteChip
                        demanda={demanda}
                        campo="propuesta"
                        onNavigate={onNavigate}
                      />
                    </div>
                    <div>
                      <span className="micro-label">PEDIDO</span>
                      <p>{demanda.pedido}</p>
                      <DemandaFuenteChip
                        demanda={demanda}
                        campo="pedido"
                        onNavigate={onNavigate}
                      />
                    </div>
                  </div>
                  <div className="row-actions demanda-actions">
                    <DemandaForm
                      caseCode={item.code}
                      item={demanda}
                      index={index}
                    />
                    <DeleteButton
                      label="Eliminar demanda"
                      confirmText="La demanda se quitará de este caso en la demostración."
                      onConfirm={() => deleteDemanda(item.code, index)}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "Cronología" && (
        <section className="surface detail-section">
          <div className="detail-section-title">
            <div>
              <h3>Cronología</h3>
              <p>
                Orden explícito de más reciente a más antiguo · fecha, actor y
                acción; la evidencia queda sujeta a revisión humana.
              </p>
            </div>
            <div className="detail-actions">
              <span className="result-count">{item.events.length} hechos</span>
              <CaseEventForm caseCode={item.code} />
            </div>
          </div>
          <p className="form-hint">
            Registrar un hecho no lo valida: la validación humana es una acción
            explícita (botón «Validar hecho») y queda marcada como demo.
          </p>
          <div className="timeline">
            {orderedEvents.map(({ event, index }) => {
              const isPending =
                event.kind === "pending" || event.estado === "Pendiente";
              return (
                <div
                  className="timeline-event"
                  key={event.id ?? `${event.date}-${index}`}
                >
                  <span className={`timeline-dot dot-${event.kind}`} />
                  <div>
                    <div className="timeline-meta">
                      <strong>{event.title}</strong>
                      <time>{event.date}</time>
                    </div>
                    <small className="timeline-actor">
                      Actor: {event.actor ?? "No especificado"}
                    </small>
                    <p>{event.description}</p>
                    {event.evidencia && (
                      <p className="timeline-evidence">
                        Evidencia: {event.evidencia}
                      </p>
                    )}
                    <span className={`evidence-state evidence-${event.kind}`}>
                      {event.kind === "validated"
                        ? "Validado por persona · demo"
                        : event.kind === "pending"
                          ? "Pendiente de validación"
                          : "Registro del sistema"}
                    </span>
                    {isPending && (
                      <div className="timeline-actions">
                        <button
                          className="button-secondary"
                          onClick={() => validateCaseEvent(item.code, index)}
                        >
                          <Check size={13} /> Validar hecho
                        </button>
                        <small className="form-hint">
                          Validación humana explícita · demo.
                        </small>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {tab === "Documentos" && (
        <section className="surface detail-section">
          <div className="detail-section-title">
            <div>
              <h3>Documentos de la fuente</h3>
              <p>
                Relatorías, entrevistas, informes, actas y datos externos
                vinculados al caso.
              </p>
            </div>
            <DocumentUploadForm caseCode={item.code} />
          </div>
          {caseDocuments.length === 0 ? (
            <div className="empty-state">
              Sin documentos vinculados. Carga una relatoría o entrevista para
              iniciar la extracción asistida.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Tipo</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Propuestas</th>
                  </tr>
                </thead>
                <tbody>
                  {caseDocuments.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <strong>{doc.titulo}</strong>
                        <small>
                          {doc.codigo} · {doc.archivo}
                        </small>
                      </td>
                      <td>{docKindLabels[doc.kind]}</td>
                      <td>{doc.fecha}</td>
                      <td>
                        <span
                          className={`commit-status commit-${doc.estado.toLowerCase().replace(" ", "-")}`}
                        >
                          {doc.estado}
                        </span>
                      </td>
                      <td>
                        {
                          doc.extracciones.filter(
                            (row) => row.estado === "Propuesta",
                          ).length
                        }{" "}
                        por revisar
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            className="link-button detail-link"
            onClick={() => onNavigate("documents")}
          >
            Abrir el módulo de documentos <ArrowRight size={14} />
          </button>
        </section>
      )}
      {tab === "Alertas" && (
        <section className="surface detail-section">
          <div className="detail-section-title">
            <div>
              <h3>Alertas tempranas</h3>
              <p>
                El plazo máximo se deriva de la prioridad y toda cita debe
                coincidir con la fuente.
              </p>
            </div>
            <AlertForm caseCode={item.code} />
          </div>
          <details className="alert-legend">
            <summary>Códigos de alerta · AT, RR y PAR</summary>
            <ul>
              <li>
                <strong>{alertTypeLabels.AT}</strong>: señal inicial que
                requiere revisión humana antes de fijar nivel de riesgo.
              </li>
              <li>
                <strong>{alertTypeLabels.RR}</strong>: reporte breve de un hecho
                o riesgo en curso.
              </li>
              <li>
                <strong>{alertTypeLabels.PAR}</strong>: respuesta operativa ante
                una alerta activada.
              </li>
            </ul>
            <p className="quote-note">
              Definiciones ilustrativas para el prototipo; no reemplazan la
              clasificación institucional.
            </p>
          </details>
          {caseAlerts.length === 0 ? (
            <div className="empty-state">
              Sin alertas vinculadas a este caso.
            </div>
          ) : (
            <div className="linked-list">
              {caseAlerts.map((row) => (
                <button
                  className="linked-row"
                  key={row.id}
                  aria-label={`Abrir revisión de la alerta ${row.id}`}
                  onClick={() => onNavigate("alerts")}
                >
                  <span className="linked-main">
                    <span className="case-code">{row.id}</span>
                    <strong>{row.title}</strong>
                    <small>
                      {alertTypeLabel(row.alertType)} · {row.location} ·{" "}
                      {row.published} · SLA {row.slaHours ?? "—"} h
                    </small>
                  </span>
                  <PriorityLabel priority={row.priority} />
                  <span
                    className={`alert-state ${alertStateClass(row.status)}`}
                  >
                    <span className="status-dot" />
                    {row.status}
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "Compromisos" && (
        <section className="surface detail-section">
          <div className="detail-section-title">
            <div>
              <h3>Compromisos</h3>
              <p>
                Actividades y PIP con responsable, plazo calculado y estado de
                gestión.
              </p>
            </div>
            <CommitmentForm caseCode={item.code} />
          </div>
          <div
            className="actor-definitions"
            aria-label="Definiciones de compromiso"
          >
            <span>
              Tipo de acuerdo <GlossaryTerm term="agreementType" />
            </span>
          </div>
          <p className="form-hint">
            «Paralizado» es un estado de gestión y no un sinónimo de vencido: el
            plazo se calcula por separado con el vencimiento y la fecha de
            inicio, y se muestra como badge propio.
          </p>
          {caseCommitments.length === 0 ? (
            <div className="empty-state">
              Sin compromisos vinculados a este caso.
            </div>
          ) : (
            <div className="commitment-list">
              {caseCommitments.map((row) => (
                <CommitmentCard
                  key={row.id}
                  commitment={row}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function AlertReviewCard({
  item,
  onUpdate,
  onEdit,
  onPatch,
  onNavigate,
}: {
  item: DemoAlert;
  onUpdate: (id: string, status: DemoAlert["status"], note?: string) => void;
  onEdit: (id: string, quote: string) => void;
  onPatch: (patch: Partial<DemoAlert>, message: string) => void;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const [reason, setReason] = useState("");
  const [draftQuote, setDraftQuote] = useState(item.quote);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [confirm, setConfirm] = useState<"" | "aprobar" | "atender">("");
  const [showDerivar, setShowDerivar] = useState(false);
  const [derivarArea, setDerivarArea] = useState("OAIPCS");
  const [derivarFecha, setDerivarFecha] = useState(() => {
    const deadline = new Date(demoReferenceDate.getTime() + 2 * DAY_MS);
    return `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, "0")}-${String(deadline.getDate()).padStart(2, "0")}`;
  });
  const [derivarError, setDerivarError] = useState("");

  const isPending = item.status === "Pendiente de revisión";
  const isApproved = item.status === "Aprobada";
  const isDiscarded = item.status === "Descartada";
  const isAttended = item.status === "Atendida";
  const sla = alertSlaState(item);
  const derivacion = item.derivacion;
  const history = item.historial ?? [];
  const lastEntry = history[history.length - 1];
  const statusValues: DemoAlert["status"][] = [
    "Pendiente de revisión",
    "Aprobada",
    "Descartada",
    "Atendida",
  ];
  const statusFromAction = (accion: string) => {
    const value = accion.replace(/^Estado:\s*/, "").trim();
    return statusValues.includes(value as DemoAlert["status"])
      ? (value as DemoAlert["status"])
      : null;
  };
  const previousStatus: DemoAlert["status"] | null =
    history.length === 0
      ? null
      : history.length === 1
        ? "Pendiente de revisión"
        : (statusFromAction(history[history.length - 2].accion) ??
          "Pendiente de revisión");

  return (
    <article className="surface alert-review-card">
      <div className="alert-card-head">
        <div>
          <span className="case-code">{item.id}</span>
          <PriorityLabel priority={item.priority} />
          <h3>{item.title}</h3>
          <p>
            <MapPin size={13} />
            {item.location}
            <span>·</span>
            {item.published}
          </p>
          <div className="alert-meta-row">
            <span className={`sla-flag${sla.overdue ? " sla-overdue" : ""}`}>
              {sla.label}
            </span>
            {item.slaHours !== undefined && (
              <span className="quote-note">
                SLA configurado: {item.slaHours} h
              </span>
            )}
          </div>
        </div>
        <span className={`alert-state ${alertStateClass(item.status)}`}>
          <span className="status-dot" />
          {item.status}
        </span>
      </div>
      {item.reviewNote && (
        <div className="review-note">
          <strong>
            {isDiscarded
              ? "Motivo de descarte registrado en esta sesión:"
              : "Nota registrada en esta sesión:"}
          </strong>{" "}
          {item.reviewNote}
        </div>
      )}
      <div className="evidence-grid">
        <section>
          <span className="micro-label">
            FRAGMENTO CITADO · COINCIDENCIA TEXTUAL
          </span>
          <blockquote>{item.quote}</blockquote>
          <p className="quote-note">{item.note}</p>
        </section>
        <section className="source-card">
          <span className="micro-label">FUENTE AUTORIZADA · DEMO</span>
          <strong>{item.source}</strong>
          <span>{item.published}</span>
          <button
            type="button"
            className="source-link"
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? "Cerrar referencia" : "Ver referencia simulada"}{" "}
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            className="source-link"
            onClick={() => onNavigate("documents")}
          >
            {item.documentoId
              ? `Ver ${item.documentoId} en documentos`
              : "Ver documentos de evidencia (demo)"}{" "}
            <ArrowRight size={13} />
          </button>
          {showSource && (
            <div className="source-expanded">
              Referencia simulada para validar el flujo. En producción, el texto
              original y su clasificación se mostrarían según los permisos del
              perfil.
            </div>
          )}
        </section>
      </div>
      {lastEntry && (
        <div className="alert-history">
          <span className="micro-label">
            ÚLTIMA ACCIÓN · HISTORIAL DE LA SESIÓN
          </span>
          <p>
            {lastEntry.accion} · {lastEntry.fecha}
            {lastEntry.nota ? ` · ${lastEntry.nota}` : ""}
          </p>
          {previousStatus && (
            <button
              type="button"
              className="link-button"
              onClick={() =>
                onUpdate(
                  item.id,
                  previousStatus,
                  `Reversión de «${lastEntry.accion}» desde la sesión de demostración.`,
                )
              }
            >
              Deshacer última acción (volver a «{previousStatus}»)
            </button>
          )}
        </div>
      )}
      {isPending && (
        <>
          {showDiscard ? (
            <div className="discard-form">
              <label htmlFor={`reason-${item.id}`}>
                Motivo de descarte (obligatorio)
              </label>
              <input
                id={`reason-${item.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej.: cita no coincide con la fuente"
              />
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowDiscard(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={!reason.trim()}
                onClick={() => {
                  onUpdate(item.id, "Descartada", reason);
                  setShowDiscard(false);
                }}
              >
                Confirmar descarte
              </button>
            </div>
          ) : showEdit ? (
            <div className="edit-form">
              <label htmlFor={`quote-${item.id}`}>
                Editar cita literal de la fuente
              </label>
              <textarea
                id={`quote-${item.id}`}
                value={draftQuote}
                onChange={(event) => setDraftQuote(event.target.value)}
              />
              <div>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setShowEdit(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button-primary"
                  disabled={!draftQuote.trim()}
                  onClick={() => {
                    onEdit(item.id, draftQuote.trim());
                    setShowEdit(false);
                  }}
                >
                  Guardar cita
                </button>
              </div>
            </div>
          ) : confirm === "aprobar" ? (
            <div className="confirm-block">
              <span>
                ¿Aprobar la alerta? Quedará visible en la demostración y la
                acción se registrará en el historial de esta sesión.
              </span>
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  setConfirm("");
                  onUpdate(item.id, "Aprobada");
                }}
              >
                Sí, aprobar
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setConfirm("")}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="review-actions">
              <span>
                <ShieldCheck size={14} />
                Tu aprobación quedará registrada en la sesión de demostración.
              </span>
              <div>
                <AlertForm item={item} />
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setDraftQuote(item.quote);
                    setShowEdit(true);
                  }}
                >
                  <Pencil size={14} />
                  Editar cita
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setShowDiscard(true)}
                >
                  <X size={14} />
                  Descartar
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => setConfirm("aprobar")}
                >
                  <Check size={14} />
                  Aprobar alerta
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {isApproved &&
        (confirm === "atender" ? (
          <div className="confirm-block">
            <span>
              ¿Marcar la alerta como atendida? Se conservará el historial y la
              alerta dejará de estar pendiente.
            </span>
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                setConfirm("");
                onUpdate(
                  item.id,
                  "Atendida",
                  "Atendida desde la revisión de alertas (demo).",
                );
              }}
            >
              Sí, marcar como atendida
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setConfirm("")}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="review-actions">
            <span>
              <ShieldCheck size={14} /> Aprobada en esta sesión de demostración.
            </span>
            <div>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setConfirm("atender")}
              >
                <Check size={14} />
                Marcar como atendida
              </button>
            </div>
          </div>
        ))}
      {(isDiscarded || isAttended) && (
        <div className="review-actions">
          <span>
            {isDiscarded
              ? "Alerta descartada: puede reabrirse con una nota de revisión."
              : "Alerta atendida: puede reabrirse si se requiere nueva revisión."}
          </span>
          <div>
            <button
              type="button"
              className="button-secondary"
              onClick={() =>
                onUpdate(
                  item.id,
                  "Pendiente de revisión",
                  isDiscarded
                    ? "Alerta descartada reabierta para una nueva revisión humana (demo)."
                    : "Alerta atendida reabierta para una nueva revisión humana (demo).",
                )
              }
            >
              <RotateCcw size={14} />
              Reabrir alerta
            </button>
          </div>
        </div>
      )}
      <div className="derivacion-card">
        <div className="derivacion-head">
          <span className="micro-label">DERIVACIÓN DEL CASO</span>
          {derivacion && <span className="badge">{derivacion.estado}</span>}
        </div>
        {derivacion ? (
          <>
            <p>
              <strong>Área:</strong> {derivacion.area}
            </p>
            <p>
              <strong>Fecha límite:</strong> {derivacion.fechaLimite} ·{" "}
              <strong>Estado:</strong> {derivacion.estado}
            </p>
            {derivacion.estado !== "Atendida" && (
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  onPatch(
                    {
                      derivacion: {
                        ...derivacion,
                        estado: "Atendida",
                      },
                    },
                    "Derivación marcada como atendida en la demostración; queda registrada en esta sesión.",
                  )
                }
              >
                <Check size={14} /> Marcar derivación como atendida
              </button>
            )}
          </>
        ) : showDerivar ? (
          <div className="derivacion-form">
            <label htmlFor={`derivar-area-${item.id}`}>
              Área que recibe la derivación (demostración)
            </label>
            <select
              id={`derivar-area-${item.id}`}
              className="form-select"
              value={derivarArea}
              onChange={(event) => setDerivarArea(event.target.value)}
            >
              <option>OAIPCS</option>
              <option>Coordinación territorial</option>
              <option>Gobierno local (demo)</option>
            </select>
            <input
              type="date"
              className="form-input"
              aria-label="Fecha límite de la derivación"
              value={derivarFecha}
              onChange={(event) => setDerivarFecha(event.target.value)}
            />
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                if (!derivarFecha) {
                  setDerivarError(
                    "Indica una fecha límite para la derivación.",
                  );
                  return;
                }
                onPatch(
                  {
                    derivacion: {
                      area: derivarArea,
                      fechaLimite: derivarFecha,
                      estado: "Pendiente",
                    },
                  },
                  "Derivación registrada en la demostración; solo en esta sesión.",
                );
                setShowDerivar(false);
                setDerivarError("");
              }}
            >
              Confirmar derivación
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setShowDerivar(false)}
            >
              Cancelar
            </button>
            {derivarError && (
              <p className="form-error" role="alert">
                {derivarError}
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="quote-note">
              Sin derivación registrada en la demostración.
            </p>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setShowDerivar(true)}
            >
              Registrar derivación (demo)
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ExecutiveView({
  onNavigate,
  pendingAlerts,
}: {
  onNavigate: WorkspaceProps["onNavigate"];
  pendingAlerts: number;
}) {
  return (
    <>
      <div className="executive-banner">
        <div>
          <span className="executive-label">
            <Sparkles size={14} /> VISTA EJECUTIVA · PROTOTIPO
          </span>
          <h2>Resumen para la toma de decisiones</h2>
          <p>
            19 de noviembre de 2026 · Datos de demostración, no validados para
            uso institucional.
          </p>
        </div>
        <button className="button-light" onClick={() => window.print()}>
          Imprimir resumen <ArrowRight size={14} />
        </button>
      </div>
      <div className="executive-kpis">
        <StatCard
          label="Casos activos"
          value="12"
          detail="corte demostrativo"
          icon={FileCheck2}
        />
        <StatCard
          label="Alertas activas"
          value={`${pendingAlerts}`}
          detail="pendientes de revisión"
          icon={ShieldCheck}
          tone="amber"
        />
        <StatCard
          label="Compromisos paralizados"
          value="1"
          detail="requiere seguimiento"
          icon={Clock3}
          tone="red"
        />
      </div>
      <section className="surface executive-summary">
        <div className="detail-section-title">
          <h3>Situación</h3>
          <span className="validation-chip">
            <ShieldCheck size={13} />
            Indicadores simulados
          </span>
        </div>
        <p className="executive-lead">
          Los registros de esta vista representan un escenario de demostración;
          no describen la situación actual de conflictos ni compromisos
          institucionales.
        </p>
        <div className="executive-columns">
          <div>
            <span className="micro-label">QUÉ CAMBIÓ</span>
            <p>
              Se muestra una alerta pendiente de revisión y un compromiso
              paralizado en los datos de ejemplo.
            </p>
          </div>
          <div>
            <span className="micro-label">RIESGO Y EVIDENCIA</span>
            <p>
              Una ficha ilustrativa está etiquetada como riesgo alto. La
              evidencia aún requiere verificación humana.
            </p>
          </div>
          <div>
            <span className="micro-label">DECISIÓN / PLAZO</span>
            <p>
              Revisar la fuente y confirmar el estado del compromiso antes de
              cualquier comunicación.
            </p>
          </div>
        </div>
        <div className="executive-citation">
          <span className="micro-label">REFERENCIA DEMOSTRATIVA</span>
          <p>
            “Solicitamos una reunión para revisar el acceso a la zona de
            desembarque.”
          </p>
          <small>
            Fuente ficticia · ALT-DEMO-018 · cita pendiente de validación
          </small>
        </div>
        <div className="executive-footer">
          <span>
            Generado para demostración · 19 nov 2026 · Contenido ilustrativo
          </span>
          <button className="link-button" onClick={() => onNavigate("alerts")}>
            Ver evidencia <ArrowRight size={14} />
          </button>
        </div>
      </section>
      <div className="executive-disclaimer">
        <Info size={15} />
        La vista institucional en producción debe incluir únicamente indicadores
        vigentes y validados por una persona; esta simulación no constituye una
        recomendación ni una alerta real.
      </div>
    </>
  );
}
