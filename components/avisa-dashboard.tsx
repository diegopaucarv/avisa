"use client";

import { useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
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
  Search,
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
  normalizeAssignedRegions,
  REGION_SCOPES,
  ScopePopover,
  type RegionScope,
  type TimeScope,
} from "./avisa-scope-filter";
import { useAvisa } from "@/lib/avisa-store";
import { PreferencesDrawer } from "./avisa-preferences";

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
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const scopeButtonRef = useRef<HTMLButtonElement>(null);
  const assignedRegions = useMemo(
    () => normalizeAssignedRegions(session.regiones),
    [session.regiones],
  );
  const assignedLabel = assignedRegions.length
    ? assignedRegions.join(" · ")
    : "Todo el Perú";
  const restrictedScope =
    assignedRegions.length > 0 && assignedRegions.length < REGION_SCOPES.length;
  // Con una sola región asignada, el ámbito inicial es esa región (no hay agregado).
  const [regionScope, setRegionScope] = useState<RegionScope>(
    assignedRegions.length === 1 ? assignedRegions[0] : "Todo el Perú",
  );
  const [timeScope, setTimeScope] = useState<TimeScope>("30 días");
  const [systemNotice, setSystemNotice] = useState("");
  const selectedCase =
    cases.find((item) => item.code === selectedCode) ??
    cases[0] ??
    demoCases[0];
  const selectCase = (item: DemoCase) => setSelectedCode(item.code);
  const pendingAlerts = alerts.filter(
    (item) =>
      item.status === "Pendiente de revisión" &&
      isWithinDemoWindow(item.published, timeScope) &&
      (regionScope === "Todo el Perú" ||
        item.location
          .toLocaleLowerCase("es")
          .includes(regionScope.toLocaleLowerCase("es"))),
  ).length;
  const scopedCaseCount = cases.filter(
    (item) =>
      isWithinDemoWindow(item.updated, timeScope) &&
      (regionScope === "Todo el Perú" ||
        item.region
          .toLocaleLowerCase("es")
          .includes(regionScope.toLocaleLowerCase("es"))),
  ).length;
  const scopedOverdueCommitments = commitments.filter((item) => {
    const relatedCase = cases.find(
      (caseItem) => caseItem.code === item.caseCode,
    );
    return (
      item.status === "Vencido" &&
      (!relatedCase || isWithinDemoWindow(relatedCase.updated, timeScope)) &&
      (regionScope === "Todo el Perú" ||
        relatedCase?.region
          .toLocaleLowerCase("es")
          .includes(regionScope.toLocaleLowerCase("es")))
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
  const quickResults = useMemo(() => {
    const normalized = globalSearch.trim().toLowerCase();
    if (!normalized) return [];
    return cases
      .filter(
        (item) =>
          isWithinDemoWindow(item.updated, timeScope) &&
          (regionScope === "Todo el Perú" ||
            item.region
              .toLocaleLowerCase("es")
              .includes(regionScope.toLocaleLowerCase("es"))) &&
          `${item.code} ${item.title} ${item.region}`
            .toLowerCase()
            .includes(normalized),
      )
      .slice(0, 4);
  }, [cases, globalSearch, regionScope, timeScope]);

  const navigateTo = (next: WorkspaceView) => {
    setView(next);
    setSystemNotice("");
    setSidebarOpen(false);
    setSearchOpen(false);
    setScopeOpen(false);
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
          <button
            className={`header-icon-button ${searchOpen ? "icon-active" : ""}`}
            aria-label="Buscar casos demostrativos"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen);
              setGlobalSearch("");
            }}
          >
            <Search size={17} />
          </button>
          <button
            className="header-icon-button notification-button"
            aria-label={`${pendingAlerts} alertas por revisar`}
            onClick={() => navigateTo("alerts")}
          >
            <Bell size={17} />
            <span className="notification-dot" />
          </button>
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
      {searchOpen && (
        <div className="global-search-panel">
          <label className="search-field">
            <Search size={17} />
            <input
              autoFocus
              aria-label="Buscar en datos de demostración"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Buscar por código, tema o territorio…"
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
              }}
            />
          </label>
          <button
            className="search-close"
            onClick={() => setSearchOpen(false)}
            aria-label="Cerrar búsqueda"
          >
            <X size={16} />
          </button>
          {globalSearch && (
            <div className="global-results">
              {quickResults.length ? (
                quickResults.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => {
                      setSelectedCode(item.code);
                      navigateTo("case-detail");
                    }}
                  >
                    <span className="case-code">{item.code}</span>
                    <strong>{item.title}</strong>
                    <small>{item.region}</small>
                    <ChevronRight size={15} />
                  </button>
                ))
              ) : (
                <p>No hay coincidencias en los datos de demostración.</p>
              )}
            </div>
          )}
        </div>
      )}
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
                Ámbito territorial
              </div>
              <AvisaScopeFilter
                region={regionScope}
                regions={assignedRegions}
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
              onClick={() =>
                setSystemNotice(
                  "La ayuda del prototipo es ilustrativa y no constituye una guía institucional.",
                )
              }
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
              </select>
            </label>
          </div>
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
            />
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
    </div>
  );
}
