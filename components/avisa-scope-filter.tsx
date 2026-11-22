"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import {
  demoReferenceDate,
  parseDemoDate,
  parseDemoDateTime,
} from "./avisa-catalogs";

export type RegionScope = "Todo el Perú" | "Piura" | "Áncash" | "Junín";
export type TimeScope = "7 días" | "30 días" | "90 días" | "Personalizado";

/** Rango personalizado en fechas ISO (`yyyy-mm-dd`) del filtro de la línea superior. */
export type TimeRange = { from: string; to: string };

const ALL_REGION_LABEL: RegionScope = "Todo el Perú";

/** Regiones operativas del prototipo. El agregado vive aparte. */
export const REGION_SCOPES: RegionScope[] = ["Piura", "Áncash", "Junín"];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
}

/** Valida que el rango exista y que la fecha inicial no supere a la final. */
export function isValidTimeRange(range?: TimeRange | null): range is TimeRange {
  if (!range?.from || !range?.to) return false;
  const from = parseIsoDay(range.from);
  const to = parseIsoDay(range.to);
  return Boolean(from && to && from.getTime() <= to.getTime());
}

/**
 * Etiqueta legible del periodo activo. Los textos personalizados se muestran
 * como rango de demostración y nunca como un periodo institucional real.
 */
export function describeTimeScope(
  timeScope: TimeScope,
  range?: TimeRange,
): string {
  if (timeScope === "Personalizado")
    return isValidTimeRange(range)
      ? `rango demostrativo ${range.from} a ${range.to}`
      : "últimos 30 días (respaldo)";
  return `últimos ${timeScope.toLocaleLowerCase("es")}`;
}

/**
 * Traduce las etiquetas de fecha del demo a una fecha comparable. Las marcas
 * relativas se anclan a la fecha fija de la demostración.
 */
function demoWindowDate(value: string): Date | null {
  if (/ayer/i.test(value))
    return new Date(demoReferenceDate.getTime() - DAY_MS);
  if (
    /hace\s+\d+\s+(min|h)/i.test(value) ||
    /hoy/i.test(value) ||
    /ahora/i.test(value)
  )
    return new Date(demoReferenceDate);
  return parseDemoDateTime(value) ?? parseDemoDate(value);
}

export function isWithinDemoWindow(
  value: string,
  timeScope: TimeScope,
  range?: TimeRange,
) {
  if (timeScope === "Personalizado") {
    if (!isValidTimeRange(range)) {
      // Respaldo explícito: un rango incompleto o invertido no oculta datos.
      return isWithinDemoWindow(value, "30 días");
    }
    const from = parseIsoDay(range.from);
    const to = parseIsoDay(range.to);
    const date = demoWindowDate(value);
    if (!from || !to || !date) return false;
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
  }

  const days = Number.parseInt(timeScope, 10);
  if (/hace\s+\d+\s+(min|h)/i.test(value)) return true;
  if (/ayer/i.test(value)) return days >= 1;
  const day = Number(value.match(/\b(\d{1,2})\s+nov\b/i)?.[1]);
  return !day || 19 - day < days;
}

const stripAccents = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Convierte la lista de regiones que entrega el backend en valores canónicos
 * del demo, descartando cualquier región desconocida.
 */
export function normalizeAssignedRegions(
  values: readonly string[] | undefined,
): RegionScope[] {
  if (!values?.length) return [];
  const assigned = new Set(values.map((value) => stripAccents(value.trim())));
  return REGION_SCOPES.filter((region) => assigned.has(stripAccents(region)));
}

export function isTerritoryVisible(
  territory: string,
  selected: RegionScope,
  assigned: readonly RegionScope[],
  unrestricted: boolean,
) {
  const departments = territory
    .split(/[·,/-]/)
    .map((part) => stripAccents(part))
    .filter(Boolean);
  const matches = (region: string) =>
    departments.includes(stripAccents(region));
  if (unrestricted) {
    return selected === ALL_REGION_LABEL || matches(selected);
  }
  if (!assigned.some(matches)) return false;
  return selected === ALL_REGION_LABEL || matches(selected);
}

export function AvisaScopeFilter({
  region,
  onRegionChange,
  regions,
  allLabel = ALL_REGION_LABEL,
}: {
  region: RegionScope;
  onRegionChange: (value: RegionScope) => void;
  /** Regiones preferentes del usuario (core.usuario_territorio). */
  regions?: RegionScope[];
  allLabel?: string;
}) {
  const allowed = regions ?? REGION_SCOPES;
  const restricted = allLabel !== ALL_REGION_LABEL;
  const options: RegionScope[] =
    allowed.length === 0
      ? []
      : restricted
        ? allowed.length === 1
          ? [allowed[0]]
          : [...allowed, ALL_REGION_LABEL]
        : [ALL_REGION_LABEL, ...REGION_SCOPES];

  return (
    <div
      className="scope-options"
      role="radiogroup"
      aria-label="Elegir ámbito regional"
    >
      {options.length === 0 ? (
        <p className="scope-empty" role="status">
          Sin regiones habilitadas. El acceso queda restringido hasta corregir
          la asignación.
        </p>
      ) : (
        options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={region === option}
            aria-pressed={region === option}
            className={`scope-option ${region === option ? "selected" : ""}`}
            onClick={() => onRegionChange(option)}
          >
            <span className="scope-option-label">
              {option === ALL_REGION_LABEL ? allLabel : option}
            </span>
            {region === option && (
              <Check size={13} className="scope-check" aria-hidden="true" />
            )}
          </button>
        ))
      )}
    </div>
  );
}

const useIsoLayoutEffect: typeof useLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

function sameBox(a: CSSProperties | null, b: CSSProperties): boolean {
  if (!a) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}

function getPopoverStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const width = Math.max(
    180,
    Math.min(
      Math.max(rect.width, 216),
      300,
      viewportWidth - VIEWPORT_MARGIN * 2,
    ),
  );
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.left, viewportWidth - width - VIEWPORT_MARGIN),
  );

  const spaceBelow =
    viewportHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const openUpwards = spaceBelow < 190 && spaceAbove > spaceBelow;
  const available = openUpwards ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(96, Math.min(320, available));

  if (openUpwards) {
    return {
      left,
      width,
      maxHeight,
      bottom: viewportHeight - rect.top + ANCHOR_GAP,
    };
  }
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      rect.bottom + ANCHOR_GAP,
      viewportHeight - maxHeight - VIEWPORT_MARGIN,
    ),
  );
  return { left, width, maxHeight, top };
}

/**
 * Capa flotante para el ámbito territorial. Se monta en `document.body` para
 * escapar del `overflow`/`transform` del sidebar y se reposiciona ante
 * cambios de viewport o desplazamientos.
 */
export function ScopePopover({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const position = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // El sidebar pudo quedar fuera de pantalla (p. ej. al cerrarse en móvil).
    if (
      rect.right <= 0 ||
      rect.left >= window.innerWidth ||
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight
    ) {
      onCloseRef.current();
      return;
    }
    const next = getPopoverStyle(anchor);
    setStyle((previous) => (sameBox(previous, next) ? previous : next));
  }, [anchorRef]);

  useIsoLayoutEffect(() => {
    position();
  }, [position]);

  useEffect(() => {
    const handleScroll = () => position();
    const handleResize = () => position();
    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", handleResize);
    };
  }, [position]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      // El botón gestiona su propio toggle; cerrar aquí lo reabriría.
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="scope-popover"
      role="dialog"
      aria-label="Ámbito regional"
      style={style ?? { visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
