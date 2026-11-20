'use client'

import { useMemo, useState } from 'react'
import { Building2, MapPin, Search, ShieldCheck, UsersRound } from 'lucide-react'
import type { RegionScope } from './avisa-scope-filter'

const directory = [
  { id: 'ORG-01', name: 'Asociación artesanal (alias)', kind: 'Organización', place: 'Paita · Piura', scope: 'Pesca artesanal', contact: 'Contacto protegido', initials: 'AA' },
  { id: 'ACT-02', name: 'Representación local (alias)', kind: 'Actor', place: 'Huarmey · Áncash', scope: 'Acuicultura', contact: 'Contacto protegido', initials: 'RL' },
  { id: 'LOC-03', name: 'Mesa territorial de ejemplo', kind: 'Local', place: 'Chanchamayo · Junín', scope: 'Espacio de coordinación', contact: 'Dirección no publicada', initials: 'MT' },
  { id: 'ORG-04', name: 'Comité productivo (alias)', kind: 'Organización', place: 'Paita · Piura', scope: 'Coordinación sectorial', contact: 'Contacto protegido', initials: 'CP' },
  { id: 'LOC-05', name: 'Sede de coordinación (demo)', kind: 'Local', place: 'Huarmey · Áncash', scope: 'Punto de encuentro', contact: 'Dirección no publicada', initials: 'SC' },
]

const categories = ['Todos', 'Actor', 'Organización', 'Local']

export function AvisaDirectory({ regionScope = 'Todo el Perú' }: { regionScope?: RegionScope }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Todos')
  const records = useMemo(() => directory.filter((item) => (regionScope === 'Todo el Perú' || item.place.toLocaleLowerCase('es').includes(regionScope.toLocaleLowerCase('es'))) && `${item.name} ${item.place} ${item.scope} ${item.id}`.toLowerCase().includes(query.toLowerCase()) && (category === 'Todos' || item.kind === category)), [query, category, regionScope])

  return <>
    <div className="demo-notice" role="status"><ShieldCheck size={15} /><span><strong>Directorio demostrativo</strong> — nombres sintéticos; no se muestran teléfonos ni direcciones personales.</span></div>
    <div className="section-title-row"><div><p className="section-eyebrow">REFERENCIAS TERRITORIALES · DEMO</p><h2>Actores, organizaciones y locales</h2><p>Consulta vínculos de ejemplo sin exponer información de contacto.</p></div><span className="result-count">{records.length} registros ilustrativos</span></div>
    <div className="directory-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Buscar en el directorio" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, territorio o tema" /></label><div className="directory-filters" aria-label="Filtrar por tipo">{categories.map((item) => <button key={item} className={category === item ? 'directory-filter active' : 'directory-filter'} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
    {records.length ? <div className="directory-grid">{records.map((item) => <article className="surface directory-card" key={item.id}><div className="directory-card-top"><span className="directory-avatar" aria-hidden="true">{item.initials}</span><span className="directory-kind">{item.kind === 'Actor' ? <UsersRound size={13} /> : item.kind === 'Organización' ? <Building2 size={13} /> : <MapPin size={13} />}{item.kind}</span></div><h3>{item.name}</h3><p className="directory-place"><MapPin size={14} />{item.place}</p><div className="directory-meta"><span>Ámbito</span><strong>{item.scope}</strong></div><div className="directory-meta"><span>Contacto</span><strong>{item.contact}</strong></div><span className="directory-id">{item.id} · Registro simulado</span></article>)}</div> : <div className="empty-state">No hay registros que coincidan con la búsqueda.</div>}
    <p className="directory-footnote"><ShieldCheck size={14} /> La información y los vínculos son ficticios. No constituyen un directorio institucional ni autorizan contacto.</p>
  </>
}
