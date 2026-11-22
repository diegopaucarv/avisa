"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { useAvisa } from "@/lib/avisa-store";
import type { WorkspaceView } from "./avisa-demo-data";
import {
  isWithinDemoWindow,
  isTerritoryVisible,
  type RegionScope,
  type TimeRange,
  type TimeScope,
} from "./avisa-scope-filter";

type SearchGroupKey =
  "Casos" | "Alertas" | "Actores" | "Documentos" | "Compromisos";

type SearchResult = {
  id: string;
  group: SearchGroupKey;
  typeLabel: string;
  code: string;
  title: string;
  territory: string;
  view: WorkspaceView;
  caseCode?: string;
};

const GROUP_ORDER: SearchGroupKey[] = [
  "Casos",
  "Alertas",
  "Actores",
  "Documentos",
  "Compromisos",
];

const MAX_RESULTS = 12;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");

/**
 * Búsqueda global del encabezado. Cruza casos, alertas, actores, documentos y
 * compromisos de la demostración aplicando el mismo ámbito territorial y la
 * misma ventana temporal que el resto de la consola.
 */
export function AvisaSearch({
  onNavigate,
  onOpenCase,
  regionScope,
  timeScope,
  timeRange,
  assignedRegions,
  unrestricted,
}: {
  onNavigate: (view: WorkspaceView) => void;
  onOpenCase: (code: string) => void;
  regionScope: RegionScope;
  timeScope: TimeScope;
  timeRange?: TimeRange;
  assignedRegions: RegionScope[];
  unrestricted: boolean;
}) {
  const { cases, alerts, documents, commitments } = useAvisa();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const normalized = normalize(query.trim());
    if (!normalized) return { groups: [], flat: [], total: 0 };

    const visible = (territory: string) =>
      isTerritoryVisible(territory, regionScope, assignedRegions, unrestricted);
    const inWindow = (value: string) =>
      isWithinDemoWindow(value, timeScope, timeRange);

    const scopedCases = cases.filter(
      (item) => visible(item.region) && inWindow(item.updated),
    );
    const scopedAlerts = alerts.filter(
      (item) => visible(item.location) && inWindow(item.published),
    );
    const scopedCommitments = commitments.filter((item) => {
      const related = cases.find((row) => row.code === item.caseCode);
      return related
        ? visible(related.region) && inWindow(related.updated)
        : unrestricted;
    });
    const scopedDocuments = documents.filter((doc) => {
      const related = doc.casoCode
        ? cases.find((row) => row.code === doc.casoCode)
        : undefined;
      if (related) return visible(related.region) && inWindow(related.updated);
      return (
        unrestricted && regionScope === "Todo el Perú" && inWindow(doc.fecha)
      );
    });

    const matches = (...parts: (string | undefined)[]) =>
      parts.some((part) => part && normalize(part).includes(normalized));

    const groups: { key: SearchGroupKey; items: SearchResult[] }[] = [];

    const caseItems: SearchResult[] = scopedCases
      .filter((item) =>
        matches(
          item.code,
          item.title,
          item.region,
          item.subject,
          item.tematica,
        ),
      )
      .map((item) => ({
        id: `caso-${item.code}`,
        group: "Casos" as const,
        typeLabel: "Caso",
        code: item.code,
        title: item.title,
        territory: item.region,
        view: "case-detail" as const,
        caseCode: item.code,
      }));
    if (caseItems.length) groups.push({ key: "Casos", items: caseItems });

    const alertItems: SearchResult[] = scopedAlerts
      .filter((item) =>
        matches(item.id, item.title, item.location, item.source),
      )
      .map((item) => ({
        id: `alerta-${item.id}`,
        group: "Alertas" as const,
        typeLabel: "Alerta",
        code: item.id,
        title: item.title,
        territory: item.location,
        view: "alerts" as const,
        caseCode: item.caseCode,
      }));
    if (alertItems.length) groups.push({ key: "Alertas", items: alertItems });

    const actorItems: SearchResult[] = scopedCases.flatMap((item) =>
      item.actors
        .filter((actor) =>
          matches(
            actor.apellidos,
            actor.nombres,
            actor.funcion,
            actor.posicionamiento,
            item.region,
          ),
        )
        .map((actor, index) => ({
          id: `actor-${item.code}-${index}`,
          group: "Actores" as const,
          typeLabel: "Actor",
          code: item.code,
          title: `${actor.apellidos} · ${actor.nombres}`,
          territory: item.region,
          view: "directory-actors" as const,
          caseCode: item.code,
        })),
    );
    if (actorItems.length) groups.push({ key: "Actores", items: actorItems });

    const documentItems: SearchResult[] = scopedDocuments
      .filter((doc) =>
        matches(doc.codigo, doc.titulo, doc.resumen, doc.casoCode),
      )
      .map((doc) => {
        const related = doc.casoCode
          ? cases.find((row) => row.code === doc.casoCode)
          : undefined;
        return {
          id: `documento-${doc.codigo}`,
          group: "Documentos" as const,
          typeLabel: "Documento",
          code: doc.codigo,
          title: doc.titulo,
          territory: related?.region ?? "Sin territorio vinculado",
          view: "documents" as const,
          caseCode: doc.casoCode,
        };
      });
    if (documentItems.length)
      groups.push({ key: "Documentos", items: documentItems });

    const commitmentItems: SearchResult[] = scopedCommitments
      .filter((item) => matches(item.id, item.title, item.owner, item.caseCode))
      .map((item) => {
        const related = cases.find((row) => row.code === item.caseCode);
        return {
          id: `compromiso-${item.id}`,
          group: "Compromisos" as const,
          typeLabel: "Compromiso",
          code: item.id,
          title: item.title,
          territory: related?.region ?? "Sin territorio vinculado",
          view: "commitments" as const,
          caseCode: item.caseCode,
        };
      });
    if (commitmentItems.length)
      groups.push({ key: "Compromisos", items: commitmentItems });

    const ordered = GROUP_ORDER.flatMap((key) => {
      const group = groups.find((entry) => entry.key === key);
      return group ? [group] : [];
    });
    const flat = ordered.flatMap((group) => group.items);
    const capped = flat.slice(0, MAX_RESULTS);
    const visibleIds = new Set(capped.map((item) => item.id));
    const cappedGroups = ordered
      .map((group) => ({
        key: group.key,
        items: group.items.filter((item) => visibleIds.has(item.id)),
      }))
      .filter((group) => group.items.length > 0);
    return { groups: cappedGroups, flat: capped, total: flat.length };
  }, [
    query,
    cases,
    alerts,
    documents,
    commitments,
    regionScope,
    timeScope,
    timeRange,
    assignedRegions,
    unrestricted,
  ]);

  const active =
    results.flat.length > 0
      ? Math.min(activeIndex, results.flat.length - 1)
      : -1;
  const activeId =
    active >= 0 ? `search-option-${results.flat[active].id}` : undefined;

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const opener = buttonRef.current;
    inputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      opener?.focus();
    };
  }, [open]);

  const choose = (result: SearchResult) => {
    if (result.view === "case-detail" && result.caseCode) {
      onOpenCase(result.caseCode);
    }
    onNavigate(result.view);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`header-icon-button ${open ? "icon-active" : ""}`}
        aria-label="Búsqueda global de datos demostrativos"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="global-search-panel"
        onClick={() => {
          setOpen((value) => !value);
          setActiveIndex(0);
        }}
      >
        <Search size={17} />
      </button>
      {open && (
        <div
          ref={panelRef}
          id="global-search-panel"
          className="global-search-panel"
          role="dialog"
          aria-label="Búsqueda global demostrativa"
        >
          <label className="search-field">
            <Search size={17} />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={Boolean(query.trim())}
              aria-controls="global-search-results"
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              aria-label="Buscar en casos, alertas, actores, documentos y compromisos demostrativos"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                  return;
                }
                if (!results.flat.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex(
                    (current) => (current + 1) % results.flat.length,
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (current) =>
                      (current - 1 + results.flat.length) % results.flat.length,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const target = results.flat[active];
                  if (target) choose(target);
                }
              }}
              placeholder="Buscar código, tema, actor o región…"
            />
          </label>
          <button
            type="button"
            className="search-close"
            onClick={close}
            aria-label="Cerrar búsqueda"
          >
            <X size={16} />
          </button>
          {query.trim() && (
            <div
              className="global-search-results"
              id="global-search-results"
              role="listbox"
              aria-label="Resultados de búsqueda demostrativos"
            >
              <p className="global-search-summary">
                {results.total
                  ? `Mostrando ${results.flat.length} de ${results.total} coincidencias · datos de demostración`
                  : "Sin coincidencias en los datos de demostración."}
              </p>
              {results.groups.map((group) => (
                <div
                  className="search-result-group"
                  key={group.key}
                  role="presentation"
                >
                  <p className="search-result-group-title">
                    {group.key}
                    <span>{group.items.length}</span>
                  </p>
                  {group.items.map((item) => {
                    const index = results.flat.indexOf(item);
                    const selected = index === active;
                    return (
                      <button
                        key={item.id}
                        id={`search-option-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        tabIndex={-1}
                        className={`search-result ${selected ? "active" : ""}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(item)}
                      >
                        <span className="search-result-type">
                          {item.typeLabel}
                        </span>
                        <span className="search-result-main">
                          <strong>{item.title}</strong>
                          <small>
                            {item.code} · {item.territory}
                          </small>
                        </span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
