'use client'

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
  const regions: RegionScope[] = ['Todo el Perú', 'Piura', 'Áncash', 'Junín']

  return <div className="scope-options" role="group" aria-label="Elegir ámbito territorial">
    {regions.map((option) => <button key={option} type="button" className={`scope-option ${region === option ? 'selected' : ''}`} aria-pressed={region === option} onClick={() => onRegionChange(option)}>{option}</button>)}
  </div>
}
