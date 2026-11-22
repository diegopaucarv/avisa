'use client'

import { useMemo, useState } from 'react'
import { Building2, Landmark, MapPin, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { isTerritoryVisible, type RegionScope } from './avisa-scope-filter'

export type DirectoryKind = 'Actor' | 'Organización' | 'Institución' | 'Local'

const directory: { id: string; name: string; kind: DirectoryKind; place: string; scope: string; contact: string }[] = [
  { id: 'ORG-01', name: 'Asociación artesanal (alias)', kind: 'Organización', place: 'Paita · Piura', scope: 'Pesca artesanal', contact: 'Contacto protegido' },
  { id: 'ACT-02', name: 'Representación local (alias)', kind: 'Actor', place: 'Huarmey · Áncash', scope: 'Acuicultura', contact: 'Contacto protegido' },
  { id: 'LOC-03', name: 'Mesa territorial de ejemplo', kind: 'Local', place: 'Chanchamayo · Junín', scope: 'Espacio de coordinación', contact: 'Dirección no publicada' },
  { id: 'ORG-04', name: 'Comité productivo (alias)', kind: 'Organización', place: 'Paita · Piura', scope: 'Coordinación sectorial', contact: 'Contacto protegido' },
  { id: 'LOC-05', name: 'Sede de coordinación (demo)', kind: 'Local', place: 'Huarmey · Áncash', scope: 'Punto de encuentro', contact: 'Dirección no publicada' },
  { id: 'INS-06', name: 'Oficina territorial de ejemplo', kind: 'Institución', place: 'Chanchamayo · Junín', scope: 'Articulación institucional', contact: 'Canal institucional' },
]

const kindDetails: Record<DirectoryKind, { icon: typeof UsersRound; view: string; singular: string }> = {
  Actor: { icon: UsersRound, view: 'Actores', singular: 'actor' },
  Organización: { icon: Building2, view: 'Organizaciones', singular: 'organización' },
  Institución: { icon: Landmark, view: 'Instituciones', singular: 'institución' },
  Local: { icon: MapPin, view: 'Locales', singular: 'local' },
}

export function AvisaDirectory({ regionScope = 'Todo el Perú', assignedRegions = [], unrestricted = true, kind }: { regionScope?: RegionScope; assignedRegions?: RegionScope[]; unrestricted?: boolean; kind: DirectoryKind }) {
  const [query, setQuery] = useState('')
  const detail = kindDetails[kind]
  const KindIcon = detail.icon
  const records = useMemo(() => directory.filter((item) => item.kind === kind && isTerritoryVisible(item.place, regionScope, assignedRegions, unrestricted) && `${item.name} ${item.place} ${item.scope} ${item.id}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))), [query, kind, regionScope, assignedRegions, unrestricted])

  return <>
    <div className="section-title-row"><div><h2>{detail.view}</h2><p>Vínculos y datos territoriales de referencia.</p></div><span className="result-count">{records.length} registros</span></div>
    <div className="directory-toolbar"><label className="search-field"><Search size={16} /><input aria-label={`Buscar ${detail.view.toLocaleLowerCase('es')}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, región o tema" /></label></div>
    {records.length ? <div className="table-wrap"><table className="data-table directory-table"><thead><tr><th>Nombre / registro</th><th>Tipo</th><th>Ubicación</th><th>Ámbito</th><th>Contacto</th></tr></thead><tbody>{records.map((item) => <tr key={item.id}><td><span className="directory-name"><span className="directory-avatar" aria-hidden="true"><KindIcon size={15} /></span><span><strong>{item.name}</strong><small>{item.id} · Registro simulado</small></span></span></td><td>{item.kind}</td><td><span className="directory-place"><MapPin size={13} />{item.place}</span></td><td>{item.scope}</td><td><span className="directory-contact"><ShieldCheck size={13} />{item.contact}</span></td></tr>)}</tbody></table></div> : <div className="empty-state">No hay registros que coincidan con la búsqueda y la región seleccionada.</div>}
    <p className="directory-footnote"><ShieldCheck size={14} /> La información y los vínculos son ficticios. No constituyen un directorio institucional ni autorizan contacto.</p>
  </>
}
