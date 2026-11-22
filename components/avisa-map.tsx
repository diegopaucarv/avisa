"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { ArrowRight, Layers, MapPin, ShieldCheck } from "lucide-react";
import { useAvisa } from "@/lib/avisa-store";
import {
  isValidTimeRange,
  isTerritoryVisible,
  isWithinDemoWindow,
  type RegionScope,
  type TimeRange,
  type TimeScope,
} from "./avisa-scope-filter";
import { parseDemoDateTime } from "./avisa-catalogs";
import { EmptyState } from "./avisa-view-state";

type MapMode = "M_MAPA" | "M_ZONA" | "M_ACERVO";
type LayerKey = "casos" | "documentos" | "compromisos";

type MapPoint = {
  id: string;
  layer: LayerKey;
  department: string;
  label: string;
  detail: string;
  code: string;
  territory: string;
  date: string;
  position: [number, number];
  tone: string;
  caseCode?: string;
};

const MODE_ORDER: MapMode[] = ["M_MAPA", "M_ZONA", "M_ACERVO"];

const MODE_INFO: Record<
  MapMode,
  { label: string; description: string; layers: LayerKey[] }
> = {
  M_MAPA: {
    label: "Mapa general de casos",
    description:
      "Casos ubicados por departamento y coloreados según su riesgo derivado. Capa base: casos; puedes sumar documentos y compromisos.",
    layers: ["casos", "documentos", "compromisos"],
  },
  M_ZONA: {
    label: "Resumen por zona",
    description:
      "Lectura territorial por departamento para ver concentraciones. Agrupa casos y compromisos; no incluye documentos.",
    layers: ["casos", "compromisos"],
  },
  M_ACERVO: {
    label: "Geografía del acervo",
    description:
      "Ubicación de documentos y evidencia vinculada a casos. Capa principal: documentos; los casos se muestran como referencia.",
    layers: ["documentos", "casos"],
  },
};

const MODE_DEFAULT_LAYERS: Record<MapMode, Record<LayerKey, boolean>> = {
  M_MAPA: { casos: true, documentos: false, compromisos: false },
  M_ZONA: { casos: true, documentos: false, compromisos: true },
  M_ACERVO: { documentos: true, casos: true, compromisos: false },
};

const LAYER_LABELS: Record<LayerKey, { label: string; hint: string }> = {
  casos: { label: "Casos", hint: "Color por riesgo derivado" },
  documentos: { label: "Documentos", hint: "Acervo vinculado a un caso" },
  compromisos: { label: "Compromisos", hint: "Color por estado de gestión" },
};

const RISK_TONES: Record<string, string> = {
  Alto: "#b76b56",
  Moderado: "#b8944f",
  Bajo: "#5a8b78",
};

const COMMITMENT_TONES: Record<string, string> = {
  Paralizado: "#b76b56",
  "Por vencer": "#b8944f",
  Cumplido: "#5a8b78",
  "En curso": "#5b7f9c",
};

const DOCUMENT_TONE = "#3f6f9a";

const ZONE_COORDS: Record<
  string,
  { position: [number, number]; label: string }
> = {
  piura: { position: [-5.09, -81.11], label: "Piura" },
  ancash: { position: [-10.07, -78.15], label: "Áncash" },
  junin: { position: [-11.05, -75.33], label: "Junín" },
};

const DEFAULT_CENTER: [number, number] = [-9.1, -77.9];
const DEFAULT_ZOOM = 5;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();

function departmentKey(region: string) {
  return normalize(region.split("·")[0] ?? region);
}

function averagePosition(points: MapPoint[]): [number, number] {
  const latitude =
    points.reduce((total, point) => total + point.position[0], 0) /
    points.length;
  const longitude =
    points.reduce((total, point) => total + point.position[1], 0) /
    points.length;
  return [latitude, longitude];
}

function clusterRadius(count: number) {
  return Math.min(22, 12 + count * 2);
}

function pointRadius(point: MapPoint) {
  if (point.layer === "documentos") return 7;
  if (point.layer === "compromisos") return 8;
  return 9;
}

function offsetPosition(
  position: [number, number],
  index: number,
  total: number,
): [number, number] {
  if (total <= 1) return position;
  const angle = (2 * Math.PI * index) / total;
  const radius = 0.02 + Math.floor(index / 8) * 0.012;
  return [
    position[0] + Math.sin(angle) * radius,
    position[1] + Math.cos(angle) * radius * 1.2,
  ];
}

/**
 * Ajusta el mapa a los puntos visibles al montar y cada vez que cambia el
 * ámbito, la ventana temporal o el modo; «Ver todos» queda como acción manual.
 */
function AutoFit({
  positions,
  fitKey,
}: {
  positions: [number, number][];
  fitKey: string;
}) {
  const map = useMap();
  useEffect(() => {
    if (!positions.length) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    if (positions.length === 1) {
      map.setView(positions[0], 8);
      return;
    }
    map.fitBounds(positions, { padding: [40, 40] });
  }, [fitKey, positions, map]);
  return null;
}

function FitAllButton({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  return (
    <button
      type="button"
      className="map-reset"
      aria-label="Ajustar el mapa a todos los puntos visibles"
      onClick={() => {
        if (positions.length > 1) {
          map.fitBounds(positions, { padding: [40, 40] });
        } else if (positions.length === 1) {
          map.setView(positions[0], 8);
        } else {
          map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        }
      }}
    >
      Ver todos
    </button>
  );
}

function FocusOnPoint({ point }: { point?: MapPoint }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.flyTo(point.position, Math.max(map.getZoom(), 9), { duration: 0.5 });
  }, [map, point]);
  return null;
}

export default function AvisaMap({
  onSelectCase,
  regionScope,
  timeScope,
  timeRange,
  assignedRegions,
  unrestricted,
}: {
  onSelectCase: (code: string) => void;
  regionScope: RegionScope;
  timeScope: TimeScope;
  timeRange?: TimeRange;
  assignedRegions: RegionScope[];
  unrestricted: boolean;
}) {
  const { cases, documents, commitments } = useAvisa();
  const [mode, setMode] = useState<MapMode>("M_MAPA");
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    MODE_DEFAULT_LAYERS.M_MAPA,
  );
  const [selectedId, setSelectedId] = useState("");
  const [expandedGroup, setExpandedGroup] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const visible = (territory: string) =>
    isTerritoryVisible(territory, regionScope, assignedRegions, unrestricted);
  const inWindow = (value: string) =>
    isWithinDemoWindow(value, timeScope, timeRange);

  const scopedCases = useMemo(
    () =>
      cases.filter((item) => visible(item.region) && inWindow(item.updated)),
    [cases, regionScope, timeScope, timeRange, assignedRegions, unrestricted],
  );

  const casePoints = useMemo<MapPoint[]>(
    () =>
      scopedCases.flatMap((item) => {
        const key = departmentKey(item.region);
        const zone = ZONE_COORDS[key];
        if (!zone) return [];
        return [
          {
            id: `caso-${item.code}`,
            layer: "casos" as const,
            department: key,
            label: item.region,
            detail: `${item.code} · riesgo ${item.risk} · ${item.stage}`,
            code: item.code,
            territory: item.region,
            date: item.updated,
            position: zone.position,
            tone: RISK_TONES[item.risk],
            caseCode: item.code,
          },
        ];
      }),
    [scopedCases],
  );

  const documentPoints = useMemo<MapPoint[]>(
    () =>
      documents.flatMap((doc) => {
        const related = doc.casoCode
          ? cases.find((item) => item.code === doc.casoCode)
          : undefined;
        const allowed = related
          ? visible(related.region) && inWindow(related.updated)
          : unrestricted &&
            regionScope === "Todo el Perú" &&
            inWindow(doc.fecha);
        if (!allowed) return [];
        const key = related ? departmentKey(related.region) : "";
        const zone = key ? ZONE_COORDS[key] : undefined;
        if (!zone) return [];
        return [
          {
            id: `documento-${doc.codigo}`,
            layer: "documentos" as const,
            department: key,
            label: related?.region ?? "Sin territorio vinculado",
            detail: `${doc.codigo} · ${doc.titulo}`,
            code: doc.codigo,
            territory: related?.region ?? "Sin territorio vinculado",
            date: doc.fecha,
            position: zone.position,
            tone: DOCUMENT_TONE,
            caseCode: doc.casoCode,
          },
        ];
      }),
    [
      documents,
      cases,
      regionScope,
      timeScope,
      timeRange,
      assignedRegions,
      unrestricted,
    ],
  );

  const commitmentPoints = useMemo<MapPoint[]>(
    () =>
      commitments.flatMap((item) => {
        const related = cases.find((row) => row.code === item.caseCode);
        const allowed = related
          ? visible(related.region) && inWindow(related.updated)
          : unrestricted;
        if (!allowed || !related) return [];
        const key = departmentKey(related.region);
        const zone = ZONE_COORDS[key];
        if (!zone) return [];
        return [
          {
            id: `compromiso-${item.id}`,
            layer: "compromisos" as const,
            department: key,
            label: related.region,
            detail: `${item.id} · ${item.owner} · vence ${item.due}`,
            code: item.id,
            territory: related.region,
            date: item.due,
            position: zone.position,
            tone: COMMITMENT_TONES[item.status] ?? "#5b7f9c",
            caseCode: item.caseCode,
          },
        ];
      }),
    [
      commitments,
      cases,
      regionScope,
      timeScope,
      timeRange,
      assignedRegions,
      unrestricted,
    ],
  );

  const activePoints = useMemo(() => {
    const points: MapPoint[] = [];
    if (layers.casos) points.push(...casePoints);
    if (layers.documentos) points.push(...documentPoints);
    if (layers.compromisos) points.push(...commitmentPoints);
    return points;
  }, [layers, casePoints, documentPoints, commitmentPoints]);

  const grouped = useMemo(() => {
    const byDepartment = new Map<string, MapPoint[]>();
    activePoints.forEach((point) => {
      const list = byDepartment.get(point.department) ?? [];
      list.push(point);
      byDepartment.set(point.department, list);
    });
    return Array.from(byDepartment.entries()).map(([department, points]) => ({
      department,
      points,
      position: averagePosition(points),
    }));
  }, [activePoints]);

  const selectedPoint =
    activePoints.find((point) => point.id === selectedId) ??
    casePoints.find((point) => point.id === selectedId);

  const windowLabel = useMemo(() => {
    if (timeScope === "Personalizado") {
      return isValidTimeRange(timeRange)
        ? `${timeRange.from} a ${timeRange.to}`
        : "los últimos 30 días (respaldo de demostración)";
    }
    return `los últimos ${timeScope.toLocaleLowerCase("es")}`;
  }, [timeScope, timeRange]);

  const timelineEvents = useMemo(
    () =>
      scopedCases
        .flatMap((item) =>
          item.events.map((event, index) => ({
            id: `${item.code}-${event.date}-${index}`,
            caseCode: item.code,
            region: item.region,
            date: event.date,
            title: event.title,
            kind: event.kind,
            stamp:
              parseDemoDateTime(event.date)?.getTime() ??
              Number.NEGATIVE_INFINITY,
          })),
        )
        .sort((left, right) => right.stamp - left.stamp),
    [scopedCases],
  );

  const fitKey = [
    mode,
    regionScope,
    timeScope,
    timeRange?.from ?? "",
    timeRange?.to ?? "",
    layers.casos ? "c" : "",
    layers.documentos ? "d" : "",
    layers.compromisos ? "k" : "",
  ].join("|");

  const changeMode = (next: MapMode) => {
    setMode(next);
    setLayers({ ...MODE_DEFAULT_LAYERS[next] });
    setSelectedId("");
    setExpandedGroup("");
  };

  const toggleLayer = (key: LayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
    setSelectedId("");
    setExpandedGroup("");
  };

  const selectPoint = (point: MapPoint) => {
    setSelectedId(point.id);
    setExpandedGroup(point.department);
  };

  // Mantiene visible en el listado el registro que se acaba de centrar en el
  // mapa (o de elegir en la cronología).
  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-point-id="${selectedId}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const positionSummary = useMemo(
    () => grouped.map((group) => group.position),
    [grouped],
  );

  return (
    <>
      <div className="section-title-row">
        <div>
          <p className="section-eyebrow">VISTA TERRITORIAL · DATOS SIMULADOS</p>
          <h2>{MODE_INFO[mode].label}</h2>
          <p>{MODE_INFO[mode].description}</p>
        </div>
        <span className="result-count">
          {activePoints.length} registros · {grouped.length} zonas
        </span>
      </div>

      <div
        className="map-mode-bar"
        role="group"
        aria-label="Modo del mapa territorial"
      >
        {MODE_ORDER.map((entry) => (
          <button
            key={entry}
            type="button"
            className={`map-mode ${mode === entry ? "selected" : ""}`}
            aria-pressed={mode === entry}
            onClick={() => changeMode(entry)}
          >
            <span className="map-mode-code">{entry}</span>
            <span>{MODE_INFO[entry].label}</span>
          </button>
        ))}
      </div>

      <div className="map-mode-note" role="status">
        <Layers size={14} />
        <span>
          Capa activa:{" "}
          {MODE_INFO[mode].layers
            .filter((key) => layers[key])
            .map((key) => LAYER_LABELS[key].label.toLocaleLowerCase("es"))
            .join(", ") || "ninguna capa"}
          . Ámbito {regionScope.toLocaleLowerCase("es")} · {windowLabel}. Los
          tres modos comparten los mismos registros demostrativos; solo cambian
          las capas y el enfoque. Todos los registros y coordenadas son de
          demostración.
        </span>
      </div>

      <div
        className="map-controls"
        role="group"
        aria-label="Capas disponibles del mapa"
      >
        <span className="map-controls-label">
          <Layers size={14} /> Capas
        </span>
        {MODE_INFO[mode].layers.map((key) => (
          <button
            key={key}
            type="button"
            className="map-layer-toggle"
            aria-pressed={layers[key]}
            onClick={() => toggleLayer(key)}
          >
            <span className={`legend-swatch layer-${key}`} aria-hidden="true" />
            {LAYER_LABELS[key].label}
            <small>{LAYER_LABELS[key].hint}</small>
          </button>
        ))}
      </div>

      <div className="map-layout">
        <section
          className="surface map-surface"
          aria-label={`Mapa demostrativo · ${MODE_INFO[mode].label}`}
        >
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            scrollWheelZoom={false}
            className="territory-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {grouped.map((group) => {
              const clustered =
                group.points.length > 1 && expandedGroup !== group.department;
              if (clustered) {
                return (
                  <CircleMarker
                    key={`cluster-${group.department}`}
                    center={group.position}
                    radius={clusterRadius(group.points.length)}
                    pathOptions={{
                      color: "#fff",
                      weight: 3,
                      fillColor: "#3f5a72",
                      fillOpacity: 1,
                    }}
                    eventHandlers={{
                      click: () => {
                        setExpandedGroup(group.department);
                        setSelectedId("");
                      },
                    }}
                  >
                    <Tooltip
                      permanent
                      direction="center"
                      className="map-cluster-tooltip"
                    >
                      {group.points.length}
                    </Tooltip>
                    <Popup>
                      <strong>
                        {ZONE_COORDS[group.department]?.label ??
                          group.department}
                      </strong>
                      <br />
                      {group.points.length} registros agrupados. Pulsa el grupo
                      para expandir los puntos.
                    </Popup>
                  </CircleMarker>
                );
              }
              return group.points.map((point, index) => (
                <CircleMarker
                  key={point.id}
                  center={offsetPosition(
                    point.position,
                    index,
                    group.points.length,
                  )}
                  radius={selectedId === point.id ? 11 : pointRadius(point)}
                  pathOptions={{
                    color: "#fff",
                    weight: 3,
                    fillColor: point.tone,
                    fillOpacity: 1,
                    dashArray: point.layer === "documentos" ? "3 2" : undefined,
                  }}
                  eventHandlers={{ click: () => selectPoint(point) }}
                >
                  <Popup>
                    <strong>{point.territory}</strong>
                    <br />
                    {point.detail}
                    <br />
                    <span>{point.code}</span>
                  </Popup>
                </CircleMarker>
              ));
            })}
            <AutoFit positions={positionSummary} fitKey={fitKey} />
            <FocusOnPoint point={selectedPoint} />
            <FitAllButton positions={positionSummary} />
          </MapContainer>
          {activePoints.length === 0 && (
            <div className="map-empty-overlay">
              <EmptyState
                compact
                icon={MapPin}
                title="Sin puntos en este ámbito"
                description="Ajusta el ámbito regional o la ventana temporal. El mapa no inventa ubicaciones fuera de los datos demostrativos."
              />
            </div>
          )}
        </section>

        <aside className="surface map-legend" aria-label="Leyenda y registros">
          <p className="section-eyebrow">LEYENDA DEL MAPA</p>
          <ul className="map-legend-list">
            <li>
              <span className="legend-swatch risk-alto" aria-hidden="true" />
              Caso con riesgo alto
            </li>
            <li>
              <span
                className="legend-swatch risk-moderado"
                aria-hidden="true"
              />
              Caso con riesgo moderado
            </li>
            <li>
              <span className="legend-swatch risk-bajo" aria-hidden="true" />
              Caso con riesgo bajo
            </li>
            <li>
              <span
                className="legend-swatch layer-documentos"
                aria-hidden="true"
              />
              Documento de acervo
            </li>
            <li>
              <span
                className="legend-swatch layer-compromisos"
                aria-hidden="true"
              />
              Compromiso (color por estado)
            </li>
            <li>
              <span className="legend-cluster" aria-hidden="true">
                N
              </span>
              Agrupación por zona · pulsa para expandir
            </li>
          </ul>
          <p className="map-legend-note">
            Tamaño: el punto seleccionado se dibuja más grande y las
            agrupaciones crecen con el número de registros. Todo es
            demostrativo.
          </p>

          <div className="map-list-head">
            <strong>Registros</strong>
            <span className="result-count">{activePoints.length}</span>
          </div>
          {activePoints.length === 0 ? (
            <EmptyState
              compact
              icon={MapPin}
              title="Sin registros visibles"
              description="No hay casos, documentos ni compromisos para las capas y filtros activos."
            />
          ) : (
            <div className="map-list" ref={listRef}>
              {grouped.map((group) => (
                <div className="map-list-group" key={group.department}>
                  {group.points.length > 1 && (
                    <div className="map-list-group-head">
                      <span>
                        {ZONE_COORDS[group.department]?.label ??
                          group.department}
                      </span>
                      <span>{group.points.length} registros</span>
                      <button
                        type="button"
                        className="map-group-expand"
                        onClick={() =>
                          setExpandedGroup(
                            expandedGroup === group.department
                              ? ""
                              : group.department,
                          )
                        }
                        aria-expanded={expandedGroup === group.department}
                      >
                        {expandedGroup === group.department
                          ? "Contraer en el mapa"
                          : "Expandir en el mapa"}
                      </button>
                    </div>
                  )}
                  {group.points.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      data-point-id={point.id}
                      className={`map-place ${selectedId === point.id ? "selected" : ""}`}
                      aria-pressed={selectedId === point.id}
                      aria-label={`Centrar y ampliar ${point.label}: ${point.detail}`}
                      onClick={() => selectPoint(point)}
                    >
                      <span
                        className="map-place-dot"
                        style={{ backgroundColor: point.tone }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{point.label}</strong>
                        <small>{point.detail}</small>
                        <small className="map-place-meta">
                          {LAYER_LABELS[point.layer].label} · {point.code}
                          {point.date ? ` · ${point.date}` : ""}
                        </small>
                      </span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="map-selection">
            {selectedPoint ? (
              <>
                <span className="micro-label">
                  SELECCIÓN ·{" "}
                  {LAYER_LABELS[selectedPoint.layer].label.toLocaleUpperCase(
                    "es",
                  )}
                </span>
                <strong>{selectedPoint.label}</strong>
                <p>{selectedPoint.detail}</p>
                <p className="map-selection-meta">
                  {selectedPoint.code}
                  {selectedPoint.date ? ` · ${selectedPoint.date}` : ""} ·{" "}
                  {selectedPoint.territory}
                </p>
                {selectedPoint.caseCode ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => onSelectCase(selectedPoint.caseCode ?? "")}
                  >
                    Abrir ficha <ArrowRight size={14} />
                  </button>
                ) : (
                  <p>
                    <MapPin size={15} /> Sin caso vinculado en la demostración.
                  </p>
                )}
              </>
            ) : (
              <p>
                <MapPin size={15} /> Selecciona un punto de la lista o del mapa
                para centrarlo y ampliarlo.
              </p>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {selectedPoint
              ? `Mapa centrado en ${selectedPoint.label}.`
              : "Sin punto seleccionado."}
          </p>
          <div className="map-limit">
            <ShieldCheck size={14} /> Sin coordenadas operativas ni datos en
            tiempo real. La agrupación es por departamento.
          </div>
        </aside>
      </div>

      <section
        className="surface spatial-timeline"
        aria-label="Cronología de actividad territorial"
      >
        <div className="surface-heading">
          <div>
            <p className="section-eyebrow">BÚSQUEDA ESPACIO-TEMPORAL</p>
            <h3>Actividad de los casos · {windowLabel}</h3>
            <p>
              Se muestran todos los hitos de cada caso visible; selecciona uno
              para centrar el territorio. Los registros son simulados.
            </p>
          </div>
          <span className="timeline-count">{timelineEvents.length} hitos</span>
        </div>
        <ol className="spatial-events">
          {timelineEvents.map((event) => {
            const target = casePoints.find(
              (point) => point.caseCode === event.caseCode,
            );
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className={
                    target && selectedId === target.id ? "selected" : ""
                  }
                  aria-pressed={Boolean(target && selectedId === target.id)}
                  aria-label={`Centrar el caso ${event.caseCode} en ${event.region}: ${event.title}`}
                  onClick={() => {
                    if (target) selectPoint(target);
                  }}
                >
                  <time>{event.date}</time>
                  <span
                    className={`spatial-event-dot dot-${event.kind}`}
                    aria-hidden="true"
                  />
                  <span className="spatial-event-copy">
                    <strong>{event.title}</strong>
                    <small>
                      {event.region} · {event.caseCode}
                    </small>
                  </span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {timelineEvents.length === 0 && (
            <li className="spatial-empty">
              No hay hitos de casos dentro de esta región y ventana temporal.
            </li>
          )}
        </ol>
        <p className="timeline-range-note">
          Todos los hitos de demostración disponibles ocurrieron durante los
          últimos 7 días; por eso las ventanas de 7, 30 y 90 días muestran el
          mismo conjunto. Un rango personalizado puede ocultarlos si no cubre
          esas fechas.
        </p>
      </section>
    </>
  );
}
