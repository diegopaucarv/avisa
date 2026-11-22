"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileStack,
  FileText,
  Grid2X2,
  Landmark,
  LogOut,
  MapPin,
  MapPinned,
  Menu,
  Settings2,
  ShieldAlert,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { Session } from "@/frontend/types";
import {
  demoCases,
  type DemoAlert,
  type DemoCase,
  type WorkspaceView,
} from "./avisa-demo-data";
import { WorkspaceViewContent } from "./avisa-workspace";
import {
  AvisaScopeFilter,
  isWithinDemoWindow,
  isValidTimeRange,
  normalizeAssignedRegions,
  isTerritoryVisible,
  REGION_SCOPES,
  ScopePopover,
  type RegionScope,
  type TimeRange,
  type TimeScope,
} from "./avisa-scope-filter";
import { useAvisa } from "@/lib/avisa-store";
import { PreferencesDrawer, useAvisaPreferences } from "./avisa-preferences";
import { HelpDrawer, openHelp } from "./avisa-glossary";
import { AvisaNotifications } from "./avisa-notifications";
import { AvisaSearch } from "./avisa-search";
import { LoadingState } from "./avisa-view-state";

type NavItem = {
  label: string;
  view: WorkspaceView;
  icon: typeof Grid2X2;
  count?: number;
};
const workNav: NavItem[] = [
  { label: "Resumen operativo", view: "overview", icon: Grid2X2 },
  { label: "Bandeja de trabajo", view: "inbox", icon: ClipboardCheck },
];
const followNav: NavItem[] = [
  { label: "Casos", view: "cases", icon: BriefcaseBusiness },
  { label: "Alertas tempranas", view: "alerts", icon: ShieldAlert },
  { label: "Compromisos", view: "commitments", icon: FileText },
  { label: "Documentos", view: "documents", icon: FileStack },
];
const directoryNav: NavItem[] = [
  { label: "Actores", view: "directory-actors", icon: UsersRound },
  { label: "Organizaciones", view: "directory-organizations", icon: Building2 },
  { label: "Instituciones", view: "directory-institutions", icon: Landmark },
  { label: "Locales", view: "directory-locals", icon: MapPin },
];

export function AvisaDashboard({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const {
    cases,
    alerts,
    commitments,
    documents,
    loading,
    updateAlert,
    notice: storeNotice,
    setNotice: setStoreNotice,
  } = useAvisa();
  const [view, setView] = useState<WorkspaceView>("overview");
  const [selectedCode, setSelectedCode] = useState(cases[0]?.code ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const preferences = useAvisaPreferences();
  const scopeButtonRef = useRef<HTMLButtonElement>(null);
  const assignedRegions = useMemo(
    () => normalizeAssignedRegions(session.regiones),
    [session.regiones],
  );
  const explicitRegionAssignment = Boolean(session.regiones?.length);
  const unrestricted =
    !explicitRegionAssignment &&
    ["Admin", "Directora", "Autoridad"].includes(session.rol);
  const assignedLabel = unrestricted
    ? "Todo el Perú"
    : assignedRegions.length
      ? assignedRegions.join(" · ")
      : "Sin regiones habilitadas";
  const restrictedScope = !unrestricted;
  const [regionScope, setRegionScope] = useState<RegionScope>(
    assignedRegions[0] ?? "Todo el Perú",
  );
  // Solo aplicamos la preferencia cuando el usuario la cambia (o al montar),
  // para no sobrescribir una selección manual hecha en el filtro de alcance.
  const appliedDefaultRegionRef = useRef<string | null>(null);
  useEffect(() => {
    const preferred = preferences.defaultRegion;
    if (appliedDefaultRegionRef.current === preferred) return;
    appliedDefaultRegionRef.current = preferred;
    if (preferred === "auto") return;
    const next: RegionScope =
      preferred === "Todo el Perú"
        ? unrestricted
          ? "Todo el Perú"
          : (assignedRegions[0] ?? "Todo el Perú")
        : unrestricted || assignedRegions.includes(preferred)
          ? preferred
          : (assignedRegions[0] ?? "Todo el Perú");
    setRegionScope(next);
  }, [preferences.defaultRegion, unrestricted, assignedRegions]);
  const territoryVisible = (territory: string) =>
    isTerritoryVisible(territory, regionScope, assignedRegions, unrestricted);
  const [timeScope, setTimeScope] = useState<TimeScope>("30 días");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Identidad estable: evita que el mapa y las vistas se reajusten en cada
  // render cuando el rango personalizado no cambió.
  const validCustomRange = useMemo<TimeRange | undefined>(() => {
    const candidate: TimeRange = { from: customFrom, to: customTo };
    return isValidTimeRange(candidate) ? candidate : undefined;
  }, [customFrom, customTo]);
  const rangeComplete = Boolean(customFrom && customTo);
  const rangeMessage =
    timeScope === "Personalizado"
      ? !rangeComplete
        ? "Elige la fecha inicial y final del rango demostrativo. Mientras tanto se aplican 30 días de respaldo."
        : !validCustomRange
          ? "La fecha inicial debe ser anterior o igual a la final. Se aplican 30 días de respaldo."
          : `Rango demostrativo activo: ${customFrom} a ${customTo} (solo datos simulados).`
      : "";
  const [systemNotice, setSystemNotice] = useState("");
  const selectedCase =
    cases.find((item) => item.code === selectedCode) ??
    cases[0] ??
    demoCases[0];
  const selectCase = (item: DemoCase) => setSelectedCode(item.code);
  const pendingAlerts = alerts.filter(
    (item) =>
      item.status === "Pendiente de revisión" &&
      isWithinDemoWindow(item.published, timeScope, validCustomRange) &&
      territoryVisible(item.location),
  ).length;
  const scopedCaseCount = cases.filter(
    (item) =>
      isWithinDemoWindow(item.updated, timeScope, validCustomRange) &&
      territoryVisible(item.region),
  ).length;
  const scopedOverdueCommitments = commitments.filter((item) => {
    const relatedCase = cases.find(
      (caseItem) => caseItem.code === item.caseCode,
    );
    return (
      item.status === "Paralizado" &&
      (!relatedCase ||
        isWithinDemoWindow(relatedCase.updated, timeScope, validCustomRange)) &&
      (relatedCase ? territoryVisible(relatedCase.region) : unrestricted)
    );
  }).length;

  const personName = session.nombre.trim().split(/\s+/).slice(0, 2).join(" ");
  const initials = session.nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("es");
  const navigateTo = (next: WorkspaceView) => {
    setView(next);
    setSystemNotice("");
    setSidebarOpen(false);
    setScopeOpen(false);
  };
  const openCaseByCode = (code: string) => {
    const item = cases.find((row) => row.code === code);
    if (item) setSelectedCode(item.code);
  };
  const openNotificationTarget = (target: WorkspaceView, refCode?: string) => {
    if (target === "case-detail" && refCode) openCaseByCode(refCode);
    navigateTo(target);
  };
  const handleAlertUpdate = (
    id: string,
    status: DemoAlert["status"],
    note?: string,
  ) => {
    updateAlert(id, { status, ...(note ? { reviewNote: note } : {}) });
  };
  const handleAlertEdit = (id: string, quote: string) => {
    updateAlert(id, { quote });
  };
  const renderNav = (items: NavItem[]) =>
    items.map((item) => {
      const Icon = item.icon;
      const selected =
        view === item.view || (item.view === "cases" && view === "case-detail");
      const count =
        item.view === "alerts"
          ? pendingAlerts
          : item.view === "cases"
            ? scopedCaseCount
            : item.view === "inbox"
              ? pendingAlerts + scopedOverdueCommitments
              : item.view === "documents"
                ? documents.length
                : item.count;
      return (
        <button
          key={item.view}
          className={`side-nav ${selected ? "selected" : ""}`}
          aria-current={selected ? "page" : undefined}
          onClick={() => navigateTo(item.view)}
        >
          <Icon size={17} strokeWidth={1.8} />
          <span>{item.label}</span>
          {count !== undefined && (
            <span className={`nav-count ${selected ? "count-active" : ""}`}>
              {count.toString().padStart(2, "0")}
            </span>
          )}
          {selected && <span className="nav-indicator" />}
        </button>
      );
    });

  return (
    <div className="avisa-shell">
      <header className="avisa-header">
        <div className="header-brand">
          <button
            className="icon-button mobile-only"
            aria-label={sidebarOpen ? "Cerrar navegación" : "Abrir navegación"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <span className="brand-symbol" aria-hidden="true">
            <Activity size={17} />
          </span>
          <span className="brand-name">AVISA</span>
          <span className="brand-divider" />
          <small>Producción · OAIPCS</small>
        </div>
        <div className="header-right">
          <div className="system-status">
            <span className="freshness-dot" /> Sistema operativo{" "}
            <span className="status-separator">·</span> Demo
          </div>
          <AvisaSearch
            onNavigate={navigateTo}
            onOpenCase={openCaseByCode}
            regionScope={regionScope}
            timeScope={timeScope}
            timeRange={validCustomRange}
            assignedRegions={assignedRegions}
            unrestricted={unrestricted}
          />
          <AvisaNotifications onGoTo={openNotificationTarget} />
          <div className="header-separator" />
          <button
            className="profile-button"
            aria-label={`Buenos días, ${personName}. Abrir menú de usuario`}
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen(!profileOpen)}
          >
            <span className="avatar">{initials}</span>
            <span className="profile-copy">
              <strong>Buenos días, {personName}</strong>
            </span>
            <UserRound size={16} />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <span className="profile-menu-name">{session.nombre}</span>
              <span className="profile-menu-detail">
                {session.cargo || session.rol}
              </span>
              <span className="profile-menu-detail">{session.area}</span>
              <button
                onClick={() => {
                  setProfileOpen(false);
                  onLogout();
                }}
              >
                <LogOut size={15} />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="app-layout">
        <aside className={`avisa-sidebar ${sidebarOpen ? "open" : ""}`}>
          <button
            ref={scopeButtonRef}
            className={`sidebar-context ${scopeOpen ? "scope-open" : ""}`}
            aria-expanded={scopeOpen}
            aria-controls="territorial-scope-controls"
            title={
              restrictedScope
                ? `Regiones asignadas: ${assignedLabel}`
                : "Sin restricción territorial"
            }
            onClick={() => setScopeOpen(!scopeOpen)}
          >
            <span className="context-mark">
              <MapPinned size={15} />
            </span>
            <span>
              <strong>Gestión territorial</strong>
            </span>
            <ChevronDown size={14} />
          </button>
          {scopeOpen && (
            <ScopePopover
              anchorRef={scopeButtonRef}
              onClose={() => setScopeOpen(false)}
            >
              <div
                className="scope-popover-heading"
                id="territorial-scope-controls"
              >
                Ámbito regional
              </div>
              <AvisaScopeFilter
                region={regionScope}
                regions={unrestricted ? REGION_SCOPES : assignedRegions}
                allLabel={restrictedScope ? "Mis regiones" : "Todo el Perú"}
                onRegionChange={(region) => {
                  setRegionScope(region);
                  setScopeOpen(false);
                }}
              />
            </ScopePopover>
          )}
          <div className="sidebar-scroll">
            <nav className="territorial-map-nav" aria-label="Mapa territorial">
              {renderNav([
                { label: "Mapa territorial", view: "map", icon: MapPinned },
              ])}
            </nav>
            <div className="sidebar-label">MI ESPACIO</div>
            <nav aria-label="Navegación principal">{renderNav(workNav)}</nav>
            <div className="sidebar-label section-nav-label">SEGUIMIENTO</div>
            <nav aria-label="Seguimiento">{renderNav(followNav)}</nav>
            <div className="sidebar-label section-nav-label">DIRECTORIO</div>
            <nav aria-label="Directorio">{renderNav(directoryNav)}</nav>
            <div className="sidebar-label section-nav-label">ANÁLISIS</div>
            <nav aria-label="Análisis">
              <button
                className={`side-nav ${view === "executive" ? "selected" : ""}`}
                aria-current={view === "executive" ? "page" : undefined}
                onClick={() => navigateTo("executive")}
              >
                <BarChart3 size={17} strokeWidth={1.8} />
                <span>Resumen de Dirección</span>
                {view === "executive" && <span className="nav-indicator" />}
              </button>
            </nav>
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-rule" />
            <button
              className="side-nav"
              onClick={() => openHelp("ayuda-inicio")}
            >
              <CircleHelp size={17} />
              <span>Ayuda y criterios</span>
            </button>
            <button className="side-nav" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={17} />
              <span>Preferencias</span>
            </button>
            <div className="environment-card">
              <span className="environment-mark">
                <Activity size={15} />
              </span>
              <div>
                <strong>Entorno de prueba</strong>
                <small>Datos demostrativos</small>
              </div>
              <span className="environment-dot" />
            </div>
            <div className="sidebar-version">
              AVISA <span>·</span> Prototipo UI 0.1
            </div>
          </div>
        </aside>
        {sidebarOpen && (
          <button
            className="sidebar-scrim"
            aria-label="Cerrar navegación"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main className="avisa-main">
          <div className="main-topline">
            <div className="breadcrumb-current">
              <span>AVISA</span>
              <ChevronRight size={13} />
              <strong>
                {view === "executive"
                  ? "Análisis"
                  : view === "overview" || view === "inbox"
                    ? "Mi espacio"
                    : view.startsWith("directory-")
                      ? "Directorio"
                      : "Seguimiento"}
              </strong>
            </div>
            <div className="topline-scope-group">
              <label className="topline-time-scope">
                <CalendarDays size={14} />
                <span className="sr-only">Filtrar periodo temporal</span>
                <select
                  value={timeScope}
                  onChange={(event) =>
                    setTimeScope(event.target.value as TimeScope)
                  }
                  aria-label="Filtrar periodo temporal"
                >
                  <option>7 días</option>
                  <option>30 días</option>
                  <option>90 días</option>
                  <option>Personalizado</option>
                </select>
              </label>
              {timeScope === "Personalizado" && (
                <div className="time-range-fields">
                  <label className="time-range-field">
                    <span>Desde</span>
                    <input
                      type="date"
                      value={customFrom}
                      max={customTo || undefined}
                      aria-label="Fecha inicial del rango demostrativo"
                      aria-invalid={rangeComplete && !validCustomRange}
                      onChange={(event) => setCustomFrom(event.target.value)}
                    />
                  </label>
                  <label className="time-range-field">
                    <span>Hasta</span>
                    <input
                      type="date"
                      value={customTo}
                      min={customFrom || undefined}
                      aria-label="Fecha final del rango demostrativo"
                      aria-invalid={rangeComplete && !validCustomRange}
                      onChange={(event) => setCustomTo(event.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          {rangeMessage && (
            <p
              className={`time-range-error ${validCustomRange ? "is-valid" : "is-warning"}`}
              role={validCustomRange ? "status" : "alert"}
            >
              <CalendarDays size={14} />
              <span>{rangeMessage}</span>
            </p>
          )}
          {systemNotice && (
            <div className="inline-notice" role="status">
              <CircleHelp size={15} />
              {systemNotice}
              <button
                onClick={() => setSystemNotice("")}
                aria-label="Cerrar aviso"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {storeNotice && (
            <div className="inline-notice" role="status">
              <Check size={15} />
              {storeNotice}
              <button
                onClick={() => setStoreNotice("")}
                aria-label="Cerrar aviso"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="workspace-content">
            {loading ? (
              <LoadingState
                label="Cargando datos desde la base…"
                detail="Consultando casos, alertas, compromisos y documentos."
              />
            ) : (
              <WorkspaceViewContent
                key={view}
                view={view}
                onNavigate={navigateTo}
                selectedCase={selectedCase}
                onSelectCase={selectCase}
                alerts={alerts}
                onAlertUpdate={handleAlertUpdate}
                onAlertEdit={handleAlertEdit}
                regionScope={regionScope}
                timeScope={timeScope}
                timeRange={validCustomRange}
                assignedRegions={assignedRegions}
                unrestricted={unrestricted}
              />
            )}
          </div>
          <footer className="app-footer">
            <span>
              Prototipo de interfaz · Información simulada, no usar para
              decisiones institucionales.
            </span>
            <span>
              OAIPCS <span>·</span> AVISA
            </span>
          </footer>
        </main>
      </div>
      <PreferencesDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <HelpDrawer />
    </div>
  );
}
