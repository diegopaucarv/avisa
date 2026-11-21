'use client'

import { useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import { ArrowRight, MapPin, ShieldCheck } from 'lucide-react'
import { demoCases } from './avisa-demo-data'
import { isWithinDemoWindow, isTerritoryVisible, type RegionScope, type TimeScope } from './avisa-scope-filter'

const places = [
  { id: 'DEMO-2026-041', label: 'Paita · Piura', detail: '1 caso demostrativo · riesgo alto', position: [-5.09, -81.11] as [number, number], tone: '#b76b56' },
  { id: 'DEMO-2026-038', label: 'Huarmey · Áncash', detail: '1 caso demostrativo · seguimiento', position: [-10.07, -78.15] as [number, number], tone: '#b8944f' },
  { id: 'DEMO-2026-032', label: 'Chanchamayo · Junín', detail: '1 caso demostrativo · acuerdos', position: [-11.05, -75.33] as [number, number], tone: '#5a8b78' },
]

function FitPlaces({ locations }: { locations: [number, number][] }) {
  const map = useMap()
  return <button className="map-reset" onClick={() => map.fitBounds(locations, { padding: [40, 40] })}>Ver todos</button>
}

export default function AvisaMap({ onSelectCase, regionScope, timeScope, assignedRegions, unrestricted }: { onSelectCase: (code: string) => void; regionScope: RegionScope; timeScope: TimeScope; assignedRegions: RegionScope[]; unrestricted: boolean }) {
  const [selected, setSelected] = useState('')
  const scopedPlaces = places.filter((place) => {
    const latestEvent = demoCases.find((item) => item.code === place.id)?.events[0]?.date ?? ''
    return isTerritoryVisible(place.label, regionScope, assignedRegions, unrestricted) && isWithinDemoWindow(latestEvent, timeScope)
  })
  const selectedPlace = scopedPlaces.find((place) => place.id === selected)
  const selectedCase = demoCases.find((item) => item.code === selected)

  return <>
    <div className="demo-notice" role="status"><ShieldCheck size={15} /><span><strong>Mapa demostrativo</strong> — ubicaciones aproximadas; no representan reportes ni actividad real.</span></div>
    <div className="section-title-row"><div><p className="section-eyebrow">VISTA TERRITORIAL · DATOS SIMULADOS</p><h2>Mapa de seguimiento</h2><p>Explora los casos de ejemplo por territorio y abre su ficha.</p></div><span className="result-count">{scopedPlaces.length} ubicaciones ilustrativas</span></div>
    <div className="map-layout"><section className="surface map-surface" aria-label="Mapa demostrativo de casos"><MapContainer center={[-9.1, -77.9]} zoom={5.4} scrollWheelZoom={false} className="territory-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{scopedPlaces.map((place) => <CircleMarker key={place.id} center={place.position} radius={selected === place.id ? 10 : 8} pathOptions={{ color: '#fff', weight: 3, fillColor: place.tone, fillOpacity: 1 }} eventHandlers={{ click: () => setSelected(place.id) }}><Popup><strong>{place.label}</strong><br />{place.detail}<br /><span>{place.id}</span></Popup></CircleMarker>)}<FitPlaces locations={scopedPlaces.map((place) => place.position)} /></MapContainer></section><aside className="surface map-legend"><p className="section-eyebrow">CASOS EN EL MAPA</p>{scopedPlaces.map((place) => <button key={place.id} className={`map-place ${selected === place.id ? 'selected' : ''}`} onClick={() => setSelected(place.id)}><span className="map-place-dot" style={{ backgroundColor: place.tone }} /><span><strong>{place.label}</strong><small>{place.detail}</small></span><ArrowRight size={15} /></button>)}<div className="map-selection">{selectedPlace && selectedCase ? <><span className="micro-label">SELECCIÓN</span><strong>{selectedPlace.label}</strong><p>{selectedCase.title}</p><button className="button-secondary" onClick={() => onSelectCase(selectedCase.code)}>Abrir ficha <ArrowRight size={14} /></button></> : <p><MapPin size={15} /> Selecciona un punto para ver el caso asociado.</p>}</div><div className="map-limit"><ShieldCheck size={14} /> Sin coordenadas operativas ni datos en tiempo real.</div></aside></div>
    <section className="surface spatial-timeline" aria-label="Cronología de actividad territorial"><div className="surface-heading"><div><p className="section-eyebrow">BÚSQUEDA ESPACIO-TEMPORAL</p><h3>Actividad en los últimos {timeScope.toLocaleLowerCase('es')}</h3><p>Selecciona un hito para centrar el territorio; los registros son simulados.</p></div><span className="timeline-count">{scopedPlaces.length} hitos</span></div><ol className="spatial-events">{scopedPlaces.flatMap((place) => { const item = demoCases.find((record) => record.code === place.id); return item?.events.slice(0, 1).map((event) => <li key={`${place.id}-${event.date}`}><button onClick={() => setSelected(place.id)} className={selected === place.id ? 'selected' : ''}><time>{event.date}</time><span className={`spatial-event-dot dot-${event.kind}`} /><span className="spatial-event-copy"><strong>{event.title}</strong><small>{place.label} · {item.code}</small></span><ArrowRight size={14} /></button></li>) })}{scopedPlaces.length === 0 && <li className="spatial-empty">No hay ubicaciones dentro de esta región.</li>}</ol><p className="timeline-range-note">Todos los hitos de demostración disponibles ocurrieron durante los últimos 7 días; por eso las ventanas de 7, 30 y 90 días muestran el mismo conjunto.</p></section>
  </>
}
