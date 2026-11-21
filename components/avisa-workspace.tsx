"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileStack,
  Filter,
  Info,
  MapPin,
  Pencil,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  demoCases,
  demoCommitments,
  docKindLabels,
  type DemoAlert,
  type DemoCase,
  type WorkspaceView,
} from "./avisa-demo-data";
import { AvisaDirectory } from "./avisa-directory";
import {
  isWithinDemoWindow,
  isTerritoryVisible,
  type RegionScope,
  type TimeScope,
} from "./avisa-scope-filter";
import {
  AlertForm,
  CaseForm,
  CommitmentForm,
  DeleteButton,
  DocumentUploadForm,
} from "./avisa-crud";
import { AvisaDocuments } from "./avisa-documents";
import { useAvisa } from "@/lib/avisa-store";
import { deriveGeographicScope, guideDefinitions } from "./avisa-catalogs";

const AvisaMap = dynamic(() => import("./avisa-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading" role="status">
      Cargando mapa demostrativo…
    </div>
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
      <span>
        <strong>Prototipo · Datos simulados</strong> — no usar para decisiones
        institucionales ni asociar a personas reales.
      </span>
    </div>
  );
}
function CatalogInfo({ label, definition }: { label: string; definition: string }) {
  return (
    <button
      type="button"
      className="catalog-info"
      title={`${label}: ${definition}`}
      aria-label={`${label}: ${definition}`}
    >
      <CircleHelp size={13} aria-hidden="true" />
    </button>
  );
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

export function WorkspaceViewContent({
  view,
  onNavigate,
  selectedCase,
  onSelectCase,
  alerts,
  onAlertUpdate,
  onAlertEdit,
  regionScope,
  timeScope,
  assignedRegions,
  unrestricted,
}: WorkspaceProps) {
  const {
    cases: allCases,
    commitments: allCommitments,
    deleteCommitment,
  } = useAvisa();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [notice, setNotice] = useState("");
  const inScope = (territory: string) =>
    isTerritoryVisible(territory, regionScope, assignedRegions, unrestricted);
  const inWindow = (date: string) => isWithinDemoWindow(date, timeScope);
  const scopedCases = useMemo(
    () =>
      allCases.filter((item) => inScope(item.region) && inWindow(item.updated)),
    [allCases, regionScope, timeScope],
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
  const filteredCases = useMemo(
    () =>
      scopedCases.filter(
        (item) =>
          `${item.title} ${item.code} ${item.region} ${item.subject}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (filter === "Todos" || item.risk === filter),
      ),
    [scopedCases, search, filter],
  );
  const filteredAlerts = scopedAlerts.filter(
    (item) =>
      `${item.title} ${item.location} ${item.id}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "Todos" || item.status === filter),
  );
  const filteredCommitments = scopedCommitments.filter(
    (item) =>
      `${item.title} ${item.id} ${item.owner} ${item.caseCode}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "Todos" || item.status === filter),
  );
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
        : "Alerta descartada en la demostración. El motivo queda representado solo en esta sesión.",
    );
  };
  const handleAlertEdit = (id: string, quote: string) => {
    onAlertEdit(id, quote);
    setNotice(
      "Cita corregida en la demostración; la alerta sigue pendiente de revisión humana.",
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
      />
    );
  if (view === "inbox")
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
        <div className="filter-bar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar en bandeja"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar caso, alerta o responsable"
            />
          </label>
          <span className="filter-caption">
            <Filter size={14} /> Prioridad del sistema: plazo + riesgo +
            revisión pendiente
          </span>
        </div>
        <div className="work-list">
          {[
            ...activeAlerts.map((item) => ({
              type: "Alerta pendiente",
              title: item.title,
              sub: `${item.id} · ${item.location}`,
              priority: item.priority,
              action: () => onNavigate("alerts"),
            })),
            ...scopedCommitments
              .filter(
                (item) =>
                  item.status === "Paralizado" || item.status === "Por vencer",
              )
              .map((item) => ({
                type: `Compromiso ${item.status.toLowerCase()}`,
                title: item.title,
                sub: `${item.id} · ${item.owner} · vence ${item.due}`,
                priority: item.status === "Paralizado" ? "Crítica" : "Alta",
                action: () => onNavigate("commitments"),
              })),
            ...scopedCases
              .filter((item) => item.risk === "Alto")
              .map((item) => ({
                type: "Caso de riesgo alto",
                title: item.title,
                sub: `${item.code} · ${item.region} · ${item.updated}`,
                priority: "Alta",
                action: () => {
                  onSelectCase(item);
                  onNavigate("case-detail");
                },
              })),
          ].map((item, index) => (
            <button
              className="work-row"
              key={`${item.type}-${index}`}
              onClick={item.action}
            >
              <span className={`work-type type-${item.priority.toLowerCase()}`}>
                <span className="status-dot" />
                {item.type}
              </span>
              <strong>{item.title}</strong>
              <small>{item.sub}</small>
              <PriorityLabel priority={item.priority} />
              <ChevronRight size={16} className="row-chevron" />
            </button>
          ))}
        </div>
      </>
    );
  if (view === "cases")
    return (
      <>
        <SectionTitle
          eyebrow="SEGUIMIENTO TERRITORIAL"
          title="Casos"
          description="Consulta estado, nivel de riesgo y evidencia validada."
          action={<CaseForm />}
        />
        <div className="filter-bar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar casos"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por código, tema o territorio"
            />
          </label>
          <label className="select-filter">
            Riesgo{" "}
            <select
              aria-label="Filtrar casos por riesgo"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option>Todos</option>
              <option>Alto</option>
              <option>Moderado</option>
              <option>Bajo</option>
            </select>
          </label>
          <span className="result-count">
            {filteredCases.length} casos demostrativos
          </span>
        </div>
        <div className="case-grid">
          {filteredCases.map((item) => (
            <button
              key={item.code}
              className="case-card"
              onClick={() => {
                onSelectCase(item);
                onNavigate("case-detail");
              }}
            >
              <div className="case-card-top">
                <span className="case-code">{item.code}</span>
                <RiskBadge level={scopedAlerts.find((alert) => alert.caseCode === item.code && alert.status === "Aprobada")?.risk} />
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
      </>
    );
  if (view === "case-detail")
    return (
      <CaseDetail
        key={selectedCase.code}
        item={selectedCase}
        onNavigate={onNavigate}
      />
    );
  if (view === "directory-actors")
    return <AvisaDirectory regionScope={regionScope} assignedRegions={assignedRegions} unrestricted={unrestricted} kind="Actor" />;
  if (view === "directory-organizations")
    return <AvisaDirectory regionScope={regionScope} assignedRegions={assignedRegions} unrestricted={unrestricted} kind="Organización" />;
  if (view === "directory-institutions")
    return <AvisaDirectory regionScope={regionScope} assignedRegions={assignedRegions} unrestricted={unrestricted} kind="Institución" />;
  if (view === "directory-locals")
    return <AvisaDirectory regionScope={regionScope} assignedRegions={assignedRegions} unrestricted={unrestricted} kind="Local" />;
  if (view === "map")
    return (
      <AvisaMap
        regionScope={regionScope}
        timeScope={timeScope}
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
    );
  if (view === "alerts")
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
              placeholder="Buscar alerta, código o territorio"
            />
          </label>
          <label className="select-filter">
            Estado{" "}
            <select
              aria-label="Filtrar alertas por estado"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option>Todos</option>
              <option>Pendiente de revisión</option>
              <option>Aprobada</option>
              <option>Descartada</option>
            </select>
          </label>
        </div>
        <div className="alert-review-list">
          {filteredAlerts.map((item) => (
            <AlertReviewCard
              key={item.id}
              item={item}
              onUpdate={handleAlertDecision}
              onEdit={handleAlertEdit}
            />
          ))}
          {filteredAlerts.length === 0 && (
            <div className="empty-state">No hay alertas para este filtro.</div>
          )}
        </div>
      </>
    );
  if (view === "commitments")
    return (
      <>
        <SectionTitle
          eyebrow="SEGUIMIENTO DE ACUERDOS"
          title="Compromisos"
          description="Plazo, responsable y avance para anticipar vencimientos."
          action={<CommitmentForm />}
        />
        {notice && (
          <div className="inline-notice" role="status">
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
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option>Todos</option>
              <option>Paralizado</option>
              <option>Por vencer</option>
              <option>En curso</option>
              <option>Cumplido</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Compromiso</th>
                <th>Caso</th>
                <th>Responsable</th>
                <th>Vencimiento</th>
                <th>Avance</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredCommitments.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <small>{item.id}</small>
                  </td>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => {
                        const found = allCases.find(
                          (row) => row.code === item.caseCode,
                        );
                        if (found) {
                          onSelectCase(found);
                          onNavigate("case-detail");
                        }
                      }}
                    >
                      {item.caseCode}
                    </button>
                  </td>
                  <td>{item.owner}</td>
                  <td>
                    <span
                      className={
                        item.status === "Paralizado" ? "date-overdue" : ""
                      }
                    >
                      {item.due}
                    </span>
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
                    <DeleteButton
                      label="Eliminar"
                      onConfirm={() => deleteCommitment(item.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCommitments.length === 0 && (
            <div className="empty-state">
              No hay compromisos para este filtro.
            </div>
          )}
        </div>
      </>
    );
  if (view === "documents") return <AvisaDocuments regionScope={regionScope} assignedRegions={assignedRegions} unrestricted={unrestricted} />;
  return (
    <ExecutiveView
      onNavigate={onNavigate}
      pendingAlerts={activeAlerts.length}
    />
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
}: Pick<WorkspaceProps, "onNavigate" | "onSelectCase" | "alerts"> & {
  pendingAlerts: number;
  cases: DemoCase[];
  commitments: typeof demoCommitments;
  regionScope: RegionScope;
  timeScope: TimeScope;
}) {
  const topCase = cases[0] ?? demoCases[0];
  const topAlert =
    alerts.find((item) => item.status === "Pendiente de revisión") ?? alerts[0];
  return (
    <>
      <DemoNotice />
      <div className="overview-heading">
        <div>
          <p className="section-eyebrow">
            {regionScope.toLocaleUpperCase("es")} · ÚLTIMOS{" "}
            {timeScope.toLocaleUpperCase("es")}
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
          detail="Últimos 30 días · demo"
          icon={Check}
          tone="green"
        />
        <StatCard
          label="Intervenciones"
          value="18"
          detail="Acciones registradas · demo"
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
              <p>Solo datos ilustrativos del prototipo.</p>
            </div>
            <span className="signal-total">03</span>
          </div>
          <div className="signal-list">
            <div>
              <span className="signal-marker signal-high" />
              <span>
                <strong>Riesgo alto</strong>
                <small>1 caso demostrativo</small>
              </span>
              <b>1</b>
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
              <b>2</b>
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
            <span>Territorio</span>
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
              <RiskBadge level={alerts.find((alert) => alert.caseCode === item.code && alert.status === "Aprobada")?.risk} />
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
  return status === "Aprobada"
    ? "state-approved"
    : status === "Descartada"
      ? "state-dismissed"
      : "state-pending";
}

function CaseDetail({
  item,
  onNavigate,
}: {
  item: DemoCase;
  onNavigate: WorkspaceProps["onNavigate"];
}) {
  const { alerts, commitments, documents, updateCase } = useAvisa();
  const [tab, setTab] = useState<CaseTab>("Resumen");
  const caseAlerts = alerts.filter((row) => row.caseCode === item.code);
  const caseCommitments = commitments.filter(
    (row) => row.caseCode === item.code,
  );
  const caseDocuments = documents.filter((row) => row.casoCode === item.code);
  const latestApprovedAlert = caseAlerts.find((row) => row.status === "Aprobada");
  const activeCase = item.estado === "Activo" || item.estado === "En seguimiento";
  const displayedRisk = activeCase ? latestApprovedAlert?.risk : undefined;
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
              <><RiskBadge level={displayedRisk} />{displayedRisk && <CatalogInfo label="Nivel de riesgo" definition={guideDefinitions.risk} />}</>
            ) : (
              <span className="risk-inactive">Riesgo inactivo</span>
            )}
            <span className="validation-chip">Datos ilustrativos · prototipo</span>
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
            <span>·</span>Unidad responsable {item.unidadResponsable ?? "OAIPCS"}
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
              updateCase(item.code, { estado: "Archivado", stage: "Archivado" });
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
                {[
                  { label: "Nivel de conflictividad", value: item.nivelConflicto ?? "Diferencia", definition: guideDefinitions.conflictLevel },
                  { label: "Temática", value: item.tematica ?? "Infraestructura", definition: guideDefinitions.theme },
                  { label: "Subsector", value: item.subsector ?? item.subject, definition: guideDefinitions.subsector },
                  { label: "Prioridad de atención", value: item.prioridad ?? "Moderado", definition: guideDefinitions.priority },
                  { label: "Alcance geográfico", value: deriveGeographicScope(item.region), definition: "Alcance territorial autocompletado a partir de la región." },
                  { label: "Región", value: item.region },
                  { label: "Unidad responsable", value: item.unidadResponsable ?? "OAIPCS" },
                  { label: "Estado", value: item.estado ?? "En seguimiento" },
                ].map(({ label, value, definition }) => (
                  <div key={label}>
                    <span className="case-fact-label">
                      {label}
                      {definition && <CatalogInfo label={label} definition={definition} />}
                    </span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="quote-note">
                El nivel de riesgo se toma de la última alerta aprobada y no se interpreta como atributo permanente del caso.
              </p>
              <section className="normative-documentation">
                <h3>Documentación normativa relacionada</h3>
                {(item.documentacionNormativa ?? []).length ? (
                  <ul>{item.documentacionNormativa?.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                ) : (
                  <p>No hay documentación normativa vinculada en esta demostración.</p>
                )}
              </section>
            </section>
            <section className="surface detail-section intervention-cycle">
              <div className="detail-section-title">
                <h3>Ruta de atención · Ciclo de Intervención Sectorial</h3>
                <CatalogInfo label="Ruta de atención" definition="Las intervenciones pueden ser simultáneas; no constituyen etapas rígidas." />
              </div>
              <ol>
                <li>Intervención preventiva</li>
                <li>Intervención y tratamiento</li>
                <li>Monitoreo de compromisos</li>
              </ol>
              <p>Gestión del conocimiento es transversal a todo el ciclo. La ruta orienta el trabajo; no es una secuencia obligatoria.</p>
            </section>
          </div>
          <aside className="case-detail-aside">
            <section className="surface detail-section">
              <h3>Actores vinculados</h3>
              <p className="privacy-caption">
                <ShieldCheck size={13} /> Alias sintéticos · correo opcional
              </p>
              <div className="actor-definitions" aria-label="Definiciones de actor">
                <span>Tipo <CatalogInfo label="Tipo de actor" definition={guideDefinitions.actorType} /></span>
                <span>Función <CatalogInfo label="Función de actor" definition={guideDefinitions.actorRole} /></span>
                <span>Posicionamiento <CatalogInfo label="Posicionamiento" definition={guideDefinitions.actorPosition} /></span>
              </div>
              <div className="actor-table-wrap">
                <table className="actor-table">
                  <thead><tr><th>Apellidos</th><th>Nombres</th><th>Correo</th></tr></thead>
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
            </section>
            <section className="surface detail-section">
              <div className="detail-section-title">
                <h3>Próximo paso sugerido</h3>
                <span className={displayedRisk ? `risk-label risk-${displayedRisk.toLowerCase()}` : "risk-inactive"}>
                  {displayedRisk ?? "Inactivo"}
                </span>
              </div>
              <p>
                {pending
                  ? "Primero revisa las alertas pendientes; el riesgo no se publica hasta una aprobación humana."
                  : displayedRisk === "Moderado"
                    ? "Activar prevención y articulación intergubernamental."
                    : displayedRisk === "Alto"
                      ? "Activar intervención y tratamiento con coordinación intergubernamental."
                      : displayedRisk === "Bajo"
                        ? "Mantener monitoreo preventivo y actualizar la evidencia."
                        : "No existe una alerta aprobada para sugerir una acción por riesgo."}
              </p>
              <button
                className="button-primary full-button"
                onClick={() => onNavigate(pending ? "alerts" : "commitments")}
              >
                {pending ? "Revisar alertas" : "Ir a compromisos"} <ArrowRight size={14} />
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
                Problema, propuesta y pedido tal como se registraron en la fuente.
                <CatalogInfo label="Estructura 3P" definition={guideDefinitions.threeP} />
              </p>
            </div>
            <span className="result-count">{demandas.length} demandas</span>
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
                  key={`${item.code}-d${index}`}
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
                    </div>
                    <div>
                      <span className="micro-label">PROPUESTA</span>
                      <p>{demanda.propuesta ?? "No registrada"}</p>
                    </div>
                    <div>
                      <span className="micro-label">PEDIDO</span>
                      <p>{demanda.pedido}</p>
                    </div>
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
              <p>Orden inverso · fecha, actor y acción; evidencia ilustrativa sujeta a revisión humana.</p>
            </div>
            <span className="result-count">{item.events.length} hitos</span>
          </div>
          <div className="timeline">
            {item.events.map((event, index) => (
              <div className="timeline-event" key={`${event.date}-${index}`}>
                <span className={`timeline-dot dot-${event.kind}`} />
                <div>
                  <div className="timeline-meta">
                    <strong>{event.title}</strong>
                    <time>{event.date}</time>
                  </div>
                  <small className="timeline-actor">Actor: {event.actor ?? "No especificado"}</small>
                  <p>{event.description}</p>
                  <span className={`evidence-state evidence-${event.kind}`}>
                    {event.kind === "validated"
                      ? "Validado por persona · demo"
                      : event.kind === "pending"
                        ? "Pendiente de validación"
                        : "Registro del sistema"}
                  </span>
                </div>
              </div>
            ))}
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
                  onClick={() => onNavigate("alerts")}
                >
                  <span className="linked-main">
                    <span className="case-code">{row.id}</span>
                    <strong>{row.title}</strong>
                    <small>
                      {row.alertType ?? "AT"} · {row.location} · {row.published} · SLA{" "}
                      {row.slaHours ?? "—"} h
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
                Actividades y PIP con responsable, plazo y avance registrado.
              </p>
            </div>
            <CommitmentForm caseCode={item.code} />
          </div>
          {caseCommitments.length === 0 ? (
            <div className="empty-state">
              Sin compromisos vinculados a este caso.
            </div>
          ) : (
            <div className="linked-list">
              {caseCommitments.map((row) => (
                <button
                  className="linked-row"
                  key={row.id}
                  onClick={() => onNavigate("commitments")}
                >
                  <span className="linked-main">
                    <span className="case-code">{row.id}</span>
                    <strong>{row.title}</strong>
                    <small>
                      {row.agreementType ?? "Tipo de acuerdo no registrado"} <CatalogInfo label="Tipo de acuerdo" definition={guideDefinitions.agreementType} /> · {row.tipo ?? "Actividad"} ·{" "}
                      {row.nivelGobierno ?? "Nacional"} · {row.owner} · vence {row.due}
                    </small>
                  </span>
                  <span className="linked-progress">
                    <i style={{ width: `${row.progress}%` }} />
                  </span>
                  <span className="linked-value">{row.progress}%</span>
                  <span
                    className={`commit-status commit-${row.status.toLowerCase().replace(" ", "-")}`}
                  >
                    {row.status}
                  </span>
                </button>
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
}: {
  item: DemoAlert;
  onUpdate: (id: string, status: DemoAlert["status"], note?: string) => void;
  onEdit: (id: string, quote: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [draftQuote, setDraftQuote] = useState(item.quote);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const isPending = item.status === "Pendiente de revisión";
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
        </div>
        <span
          className={`alert-state ${isPending ? "state-pending" : item.status === "Aprobada" ? "state-approved" : "state-dismissed"}`}
        >
          <span className="status-dot" />
          {item.status}
        </span>
      </div>
      {item.status === "Descartada" && item.reviewNote && (
        <div className="review-note">
          <strong>Motivo registrado en esta sesión:</strong> {item.reviewNote}
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
            className="source-link"
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? "Cerrar referencia" : "Ver referencia simulada"}{" "}
            <ExternalLink size={13} />
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
      {isPending && (
        <div className="review-actions">
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
                className="button-secondary"
                onClick={() => setShowDiscard(false)}
              >
                Cancelar
              </button>
              <button
                className="button-danger"
                disabled={!reason.trim()}
                onClick={() => onUpdate(item.id, "Descartada", reason)}
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
                  className="button-secondary"
                  onClick={() => setShowEdit(false)}
                >
                  Cancelar
                </button>
                <button
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
          ) : (
            <>
              <span>
                <ShieldCheck size={14} />
                Tu aprobación quedará registrada en la sesión de demostración.
              </span>
              <div>
                <AlertForm item={item} />
                <button
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
                  className="button-secondary"
                  onClick={() => setShowDiscard(true)}
                >
                  <X size={14} />
                  Descartar
                </button>
                <button
                  className="button-primary"
                  onClick={() => onUpdate(item.id, "Aprobada")}
                >
                  <Check size={14} />
                  Aprobar alerta
                </button>
              </div>
            </>
          )}
        </div>
      )}
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
