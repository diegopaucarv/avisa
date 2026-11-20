'use client'

import { CalendarDays, MapPinned, RotateCcw } from 'lucide-react'

export type RegionScope = 'Todo el Perú' | 'Piura' | 'Áncash' | 'Junín'
export type TimeScope = '7 días' | '30 días' | '90 días'

export function isWithinDemoWindow(value: string, timeScope: TimeScope) {
  const days = Number.parseInt(timeScope, 10)
  if (/hace\s+\d+\s+(min|h)/i.test(value)) return true
  if (/ayer/i.test(value)) return days >= 1
  const day = Number(value.match(/\b(\d{1,2})\s+nov\b/i)?.[1])
  return !day || 19 - day < days
}

export function AvisaScopeFilter({ region, timeScope, onRegionChange, onTimeScopeChange }: { region: RegionScope; timeScope: TimeScope; onRegionChange: (value: RegionScope) => void; onTimeScopeChange: (value: TimeScope) => void }) {
  const isFiltered = region !== 'Todo el Perú' || timeScope !== '30 días'

  return <section className="scope-toolbar" aria-label="Filtros territoriales y temporales">
    <div className="scope-heading"><span className="scope-live-dot" /><div><strong>Ámbito de análisis</strong><small>Filtros sincronizados en toda la vista</small></div></div>
    <label className="scope-control"><MapPinned size={15} /><span className="sr-only">Filtrar por región</span><select value={region} onChange={(event) => onRegionChange(event.target.value as RegionScope)} aria-label="Filtrar por región"><option>Todo el Perú</option><option>Piura</option><option>Áncash</option><option>Junín</option></select></label>
    <label className="scope-control"><CalendarDays size={15} /><span className="sr-only">Ventana temporal</span><select value={timeScope} onChange={(event) => onTimeScopeChange(event.target.value as TimeScope)} aria-label="Ventana temporal"><option>7 días</option><option>30 días</option><option>90 días</option></select></label>
    <span className="scope-context">Corte demostrativo · 19 nov 2026</span>
    {isFiltered && <button className="scope-reset" onClick={() => { onRegionChange('Todo el Perú'); onTimeScopeChange('30 días') }}><RotateCcw size={13} /> Restablecer</button>}
  </section>
}
