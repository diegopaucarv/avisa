'use client'

import { MapPinned } from 'lucide-react'

export type RegionScope = 'Todo el Perú' | 'Piura' | 'Áncash' | 'Junín'
export type TimeScope = '7 días' | '30 días' | '90 días'

export function isWithinDemoWindow(value: string, timeScope: TimeScope) {
  const days = Number.parseInt(timeScope, 10)
  if (/hace\s+\d+\s+(min|h)/i.test(value)) return true
  if (/ayer/i.test(value)) return days >= 1
  const day = Number(value.match(/\b(\d{1,2})\s+nov\b/i)?.[1])
  return !day || 19 - day < days
}

export function AvisaScopeFilter({ region, onRegionChange }: { region: RegionScope; onRegionChange: (value: RegionScope) => void }) {
  return <label className="scope-control"><MapPinned size={15} /><span className="sr-only">Región geográfica</span><select value={region} onChange={(event) => onRegionChange(event.target.value as RegionScope)} aria-label="Región geográfica"><option>Todo el Perú</option><option>Piura</option><option>Áncash</option><option>Junín</option></select></label>
}
