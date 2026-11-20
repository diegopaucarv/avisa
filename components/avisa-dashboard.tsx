'use client'

import { useMemo, useState } from 'react'
import { Activity, BarChart3, Bell, BriefcaseBusiness, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, FileText, Grid2X2, LogOut, MapPinned, Menu, Search, Settings2, ShieldAlert, UsersRound, X } from 'lucide-react'
import type { Session } from '@/frontend/types'
import { demoCases, demoAlerts, demoCommitments, type DemoAlert, type DemoCase, type WorkspaceView } from './avisa-demo-data'
import { WorkspaceViewContent } from './avisa-workspace'

type NavItem = { label: string; view: WorkspaceView; icon: typeof Grid2X2; count?: number }
const workNav: NavItem[] = [
  { label: 'Resumen operativo', view: 'overview', icon: Grid2X2 },
  { label: 'Bandeja de trabajo', view: 'inbox', icon: ClipboardCheck, count: demoAlerts.filter((item) => item.status === 'Pendiente de revisión').length + demoCommitments.filter((item) => item.status === 'Vencido').length },
]
const caseNav: NavItem[] = [
  { label: 'Casos', view: 'cases', icon: BriefcaseBusiness, count: demoCases.length },
  { label: 'Alertas tempranas', view: 'alerts', icon: ShieldAlert, count: demoAlerts.filter((item) => item.status === 'Pendiente de revisión').length },
  { label: 'Compromisos', view: 'commitments', icon: FileText },
  { label: 'Mapa territorial', view: 'map', icon: MapPinned },
  { label: 'Directorio', view: 'directory', icon: UsersRound },
]

export function AvisaDashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [view, setView] = useState<WorkspaceView>('overview')
  const [selectedCase, setSelectedCase] = useState<DemoCase>(demoCases[0])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [systemNotice, setSystemNotice] = useState('')
  const [alerts, setAlerts] = useState<DemoAlert[]>(demoAlerts)
  const pendingAlerts = alerts.filter((item) => item.status === 'Pendiente de revisión').length

  const personName = session.nombre.trim().split(/\s+/).slice(0, 2).join(' ')
  const initials = session.nombre.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es')
  const quickResults = useMemo(() => {
    const normalized = globalSearch.trim().toLowerCase()
    if (!normalized) return []
    return demoCases.filter((item) => `${item.code} ${item.title} ${item.region}`.toLowerCase().includes(normalized)).slice(0, 4)
  }, [globalSearch])

  const navigateTo = (next: WorkspaceView) => {
    setView(next)
    setSystemNotice('')
    setSidebarOpen(false)
    setSearchOpen(false)
  }
  const handleAlertUpdate = (id: string, status: DemoAlert['status'], note?: string) => {
    setAlerts((items) => items.map((item) => item.id === id ? { ...item, status, ...(note ? { reviewNote: note } : {}) } : item))
  }
  const handleAlertEdit = (id: string, quote: string) => {
    setAlerts((items) => items.map((item) => item.id === id ? { ...item, quote } : item))
  }
  const renderNav = (items: NavItem[]) => items.map((item) => {
    const Icon = item.icon
    const selected = view === item.view || (item.view === 'cases' && view === 'case-detail')
    const count = item.view === 'alerts' ? pendingAlerts : item.view === 'inbox' ? pendingAlerts + demoCommitments.filter((commitment) => commitment.status === 'Vencido').length : item.count
    return <button key={item.view} className={`side-nav ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => navigateTo(item.view)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{count !== undefined && <span className={`nav-count ${selected ? 'count-active' : ''}`}>{count.toString().padStart(2, '0')}</span>}{selected && <span className="nav-indicator" />}</button>
  })

  return <div className="avisa-shell">
    <header className="avisa-header"><div className="header-brand"><button className="icon-button mobile-only" aria-label={sidebarOpen ? 'Cerrar navegación' : 'Abrir navegación'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <X size={19} /> : <Menu size={19} />}</button><span className="brand-symbol" aria-hidden="true"><Activity size={17} /></span><span className="brand-name">AVISA</span><span className="brand-divider" /><small>Producción · OAIPCS</small></div><div className="header-right"><div className="system-status"><span className="freshness-dot" /> Sistema operativo <span className="status-separator">·</span> Demo</div><button className={`header-icon-button ${searchOpen ? 'icon-active' : ''}`} aria-label="Buscar casos demostrativos" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setGlobalSearch('') }}><Search size={17} /></button><button className="header-icon-button notification-button" aria-label={`${pendingAlerts} alertas por revisar`} onClick={() => navigateTo('alerts')}><Bell size={17} /><span className="notification-dot" /></button><div className="header-separator" /><button className="profile-button" aria-expanded={profileOpen} onClick={() => setProfileOpen(!profileOpen)}><span className="avatar">{initials}</span><span className="profile-copy"><strong>{personName}</strong><small>{session.rol}</small></span><ChevronDown size={14} /></button>{profileOpen && <div className="profile-menu"><span className="profile-menu-name">{session.nombre}</span><span className="profile-menu-detail">{session.cargo || session.rol}</span><span className="profile-menu-detail">{session.area}</span><button onClick={() => { setProfileOpen(false); onLogout() }}><LogOut size={15} />Cerrar sesión</button></div>}</div></header>
    {searchOpen && <div className="global-search-panel"><label className="search-field"><Search size={17} /><input autoFocus aria-label="Buscar en datos de demostración" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Buscar por código, tema o territorio…" onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} /></label><button className="search-close" onClick={() => setSearchOpen(false)} aria-label="Cerrar búsqueda"><X size={16} /></button>{globalSearch && <div className="global-results">{quickResults.length ? quickResults.map((item) => <button key={item.code} onClick={() => { setSelectedCase(item); navigateTo('case-detail') }}><span className="case-code">{item.code}</span><strong>{item.title}</strong><small>{item.region}</small><ChevronRight size={15} /></button>) : <p>No hay coincidencias en los datos de demostración.</p>}</div>}</div>}
    <div className="app-layout"><aside className={`avisa-sidebar ${sidebarOpen ? 'open' : ''}`}><div className="sidebar-context"><span className="context-mark"><Activity size={15} /></span><span><strong>Gestión territorial</strong><small>Unidad de prevención</small></span><ChevronDown size={14} /></div><div className="sidebar-label">MI ESPACIO</div><nav aria-label="Navegación principal">{renderNav(workNav)}</nav><div className="sidebar-label section-nav-label">SEGUIMIENTO Y REFERENCIAS</div><nav aria-label="Seguimiento y referencias">{renderNav(caseNav)}</nav><div className="sidebar-label section-nav-label">REFERENCIAS</div><nav aria-label="Análisis"><button className={`side-nav ${view === 'executive' ? 'selected' : ''}`} aria-current={view === 'executive' ? 'page' : undefined} onClick={() => navigateTo('executive')}><BarChart3 size={17} strokeWidth={1.8} /><span>Resumen de Dirección</span>{view === 'executive' && <span className="nav-indicator" />}</button></nav><div className="sidebar-bottom"><div className="sidebar-rule" /><button className="side-nav" onClick={() => setSystemNotice('La ayuda del prototipo es ilustrativa y no constituye una guía institucional.') }><CircleHelp size={17} /><span>Ayuda y criterios</span></button><button className="side-nav" onClick={() => setSystemNotice('La configuración de usuario no está habilitada en este prototipo.') }><Settings2 size={17} /><span>Preferencias</span></button><div className="environment-card"><span className="environment-mark"><Activity size={15} /></span><div><strong>Entorno de prueba</strong><small>Datos demostrativos</small></div><span className="environment-dot" /></div><div className="sidebar-version">AVISA <span>·</span> Prototipo UI 0.1</div></div></aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} />}
      <main className="avisa-main"><div className="main-topline"><div className="breadcrumb-current"><span>AVISA</span><ChevronRight size={13} /><strong>{view === 'executive' ? 'Análisis' : view === 'overview' || view === 'inbox' ? 'Mi espacio' : view === 'directory' ? 'Referencias' : 'Seguimiento'}</strong><ChevronRight size={13} /><span>{view === 'case-detail' ? selectedCase.code : viewTitle(view)}</span></div><div className="topline-date">Jue, 19 nov 2026 <span>·</span> 09:41</div></div>{systemNotice && <div className="inline-notice" role="status"><CircleHelp size={15} />{systemNotice}<button onClick={() => setSystemNotice('')} aria-label="Cerrar aviso"><X size={14} /></button></div>}<div className="workspace-content"><div className="workspace-greeting"><div><p className="workspace-kicker">OAIPCS <span>·</span> SISTEMA DE VIGILANCIA</p><h1>{viewTitle(view)}</h1></div><div className="workspace-right"><span>Buenos días, <strong>{personName}</strong></span><span className="greeting-avatar">{initials}</span></div></div><WorkspaceViewContent key={view} view={view} onNavigate={navigateTo} selectedCase={selectedCase} onSelectCase={setSelectedCase} alerts={alerts} onAlertUpdate={handleAlertUpdate} onAlertEdit={handleAlertEdit} /></div><footer className="app-footer"><span>Prototipo de interfaz · Información simulada, no usar para decisiones institucionales.</span><span>OAIPCS <span>·</span> AVISA</span></footer></main></div>
  </div>
}

function viewTitle(view: WorkspaceView) {
  const titles: Record<WorkspaceView, string> = { overview: 'Resumen operativo', inbox: 'Bandeja de trabajo', cases: 'Casos', 'case-detail': 'Ficha del caso', alerts: 'Alertas tempranas', commitments: 'Compromisos', map: 'Mapa territorial', directory: 'Directorio', executive: 'Resumen de Dirección' }
  return titles[view]
}
