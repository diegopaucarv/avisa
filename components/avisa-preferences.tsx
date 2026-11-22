"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  FileStack,
  FileText,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { REGION_SCOPES, type RegionScope } from "./avisa-scope-filter";

/* ── Preferencias locales (solo este navegador) ───────────────────────────
 * El prototipo no tiene perfil de usuario ni servidor de preferencias: todo
 * se guarda en localStorage y se comparte entre componentes con
 * `useSyncExternalStore`. */

export type DensityPreference = "comoda" | "compacta";
export type NotificationCategoryPreference =
  "Alerta" | "Compromiso" | "Documento" | "Caso";
export type NotificationPreferences = Record<
  NotificationCategoryPreference,
  boolean
>;
export type AvisaPreferences = {
  /** `auto` mantiene el ámbito que entrega la sesión. */
  defaultRegion: RegionScope | "auto";
  density: DensityPreference;
  notifications: NotificationPreferences;
};

export const PREFERENCES_STORAGE_KEY = "avisa-preferences-v1";

export const DEFAULT_AVISA_PREFERENCES: AvisaPreferences = {
  defaultRegion: "auto",
  density: "comoda",
  notifications: {
    Alerta: true,
    Compromiso: true,
    Documento: true,
    Caso: true,
  },
};

const listeners = new Set<() => void>();
let cachedPreferences: AvisaPreferences | null = null;

const isRegionPreference = (value: unknown): value is RegionScope | "auto" =>
  value === "auto" ||
  value === "Todo el Perú" ||
  REGION_SCOPES.includes(value as RegionScope);

function sanitizePreferences(value: unknown): AvisaPreferences {
  if (!value || typeof value !== "object") return DEFAULT_AVISA_PREFERENCES;
  const candidate = value as Partial<AvisaPreferences>;
  const notifications = (candidate.notifications ??
    {}) as Partial<NotificationPreferences>;
  return {
    defaultRegion: isRegionPreference(candidate.defaultRegion)
      ? candidate.defaultRegion
      : DEFAULT_AVISA_PREFERENCES.defaultRegion,
    density: candidate.density === "compacta" ? "compacta" : "comoda",
    notifications: {
      Alerta: notifications.Alerta !== false,
      Compromiso: notifications.Compromiso !== false,
      Documento: notifications.Documento !== false,
      Caso: notifications.Caso !== false,
    },
  };
}

function readPreferences(): AvisaPreferences {
  if (typeof window === "undefined") return DEFAULT_AVISA_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_AVISA_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    return sanitizePreferences(parsed);
  } catch {
    return DEFAULT_AVISA_PREFERENCES;
  }
}

function getSnapshot(): AvisaPreferences {
  if (!cachedPreferences) cachedPreferences = readPreferences();
  return cachedPreferences;
}

function getServerSnapshot(): AvisaPreferences {
  return DEFAULT_AVISA_PREFERENCES;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Actualiza las preferencias y notifica a los componentes suscritos. */
export function setAvisaPreferences(
  updater: (current: AvisaPreferences) => AvisaPreferences,
) {
  cachedPreferences = sanitizePreferences(updater(getSnapshot()));
  try {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify(cachedPreferences),
    );
  } catch {
    // Almacenamiento bloqueado (modo privado): la preferencia vive en memoria.
  }
  listeners.forEach((listener) => listener());
}

export function useAvisaPreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    document.documentElement.dataset.density = preferences.density;
  }, [preferences.density]);

  return preferences;
}

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  {
    value: "light",
    label: "Claro",
    hint: "Tema blanco para ambientes con luz.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Oscuro",
    hint: "Reduce el brillo en ambientes con poca luz.",
    icon: Moon,
  },
  {
    value: "system",
    label: "Sistema",
    hint: "Sigue la preferencia del sistema operativo.",
    icon: Monitor,
  },
];

const DENSITY_OPTIONS: {
  value: DensityPreference;
  label: string;
  hint: string;
  icon: typeof List;
}[] = [
  {
    value: "comoda",
    label: "Cómoda",
    hint: "Más aire entre filas y bloques.",
    icon: LayoutGrid,
  },
  {
    value: "compacta",
    label: "Compacta",
    hint: "Reduce el espaciado para ver más datos.",
    icon: List,
  },
];

const NOTIFICATION_OPTIONS: {
  key: NotificationCategoryPreference;
  label: string;
  hint: string;
  icon: typeof Bell;
}[] = [
  {
    key: "Alerta",
    label: "Alertas",
    hint: "Alertas pendientes de revisión humana.",
    icon: AlertTriangle,
  },
  {
    key: "Compromiso",
    label: "Compromisos",
    hint: "Compromisos paralizados o por vencer.",
    icon: FileText,
  },
  {
    key: "Documento",
    label: "Documentos",
    hint: "Extracciones propuestas pendientes de verificación.",
    icon: FileStack,
  },
  {
    key: "Caso",
    label: "Casos de riesgo alto",
    hint: "Casos activos o en seguimiento con riesgo alto.",
    icon: Bell,
  },
];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.getClientRects().length > 0);
}

export function PreferencesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { preference, resolved, setPreference } = useTheme();
  const preferences = useAvisaPreferences();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Trampa de foco: primer control al abrir, ciclo Tab/Shift+Tab, Escape
  // cierra y el foco vuelve al elemento que abrió el panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const initial = getFocusable(panel);
    (initial[0] ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusable(panelRef.current);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel?.contains(active ?? null) ?? false;
      if (event.shiftKey) {
        if (active === first || !inside) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  const scopeOptions: (RegionScope | "auto")[] = [
    "auto",
    "Todo el Perú",
    ...REGION_SCOPES,
  ];

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className="drawer drawer-narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        aria-describedby="preferences-description"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h3 id="preferences-title">Preferencias</h3>
            <p id="preferences-description">
              Ajustes de visualización de esta estación de trabajo. Se guardan
              solo en este navegador.
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar preferencias"
          >
            <X size={17} />
          </button>
        </div>
        <div className="drawer-body">
          <section className="pref-section" aria-labelledby="pref-theme-title">
            <div className="pref-section-head">
              <span className="form-label" id="pref-theme-title">
                Tema de la interfaz
              </span>
              <span className="form-hint">
                Actual: {resolved === "dark" ? "oscuro" : "claro"}
                {preference === "system" ? " (sistema)" : ""}
              </span>
            </div>
            <div className="theme-options" role="radiogroup" aria-label="Tema">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = preference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`theme-option ${selected ? "selected" : ""}`}
                    onClick={() => setPreference(option.value)}
                  >
                    <span className="theme-option-icon">
                      <Icon size={16} />
                    </span>
                    <span className="theme-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                    {selected && (
                      <span className="theme-option-check">
                        <Check size={15} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="form-hint">
              La preferencia de tema se guarda en este navegador.
            </p>
          </section>

          <section className="pref-section" aria-labelledby="pref-scope-title">
            <span className="form-label" id="pref-scope-title">
              Ámbito predeterminado
            </span>
            <p className="form-hint" id="pref-scope-hint">
              Se aplica al iniciar una nueva sesión en este navegador. «Sin
              preferencia» mantiene el ámbito que entrega la sesión.
            </p>
            <div
              className="pref-options"
              role="radiogroup"
              aria-labelledby="pref-scope-title"
              aria-describedby="pref-scope-hint"
            >
              {scopeOptions.map((option) => {
                const selected = preferences.defaultRegion === option;
                const label =
                  option === "auto" ? "Sin preferencia (sesión)" : option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`pref-option ${selected ? "selected" : ""}`}
                    onClick={() =>
                      setAvisaPreferences((current) => ({
                        ...current,
                        defaultRegion: option,
                      }))
                    }
                  >
                    <span className="pref-option-copy">
                      <strong>{label}</strong>
                      <small>
                        {option === "auto"
                          ? "Usa las regiones habilitadas de la sesión."
                          : `Abrir con el ámbito ${option}.`}
                      </small>
                    </span>
                    {selected && (
                      <span className="pref-option-check">
                        <Check size={15} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="pref-section"
            aria-labelledby="pref-density-title"
          >
            <span className="form-label" id="pref-density-title">
              Densidad de la interfaz
            </span>
            <p className="form-hint" id="pref-density-hint">
              Solo cambia el espaciado; no altera colores ni prioridades.
            </p>
            <div
              className="pref-options"
              role="radiogroup"
              aria-labelledby="pref-density-title"
              aria-describedby="pref-density-hint"
            >
              {DENSITY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = preferences.density === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`pref-option ${selected ? "selected" : ""}`}
                    onClick={() =>
                      setAvisaPreferences((current) => ({
                        ...current,
                        density: option.value,
                      }))
                    }
                  >
                    <span className="pref-option-icon">
                      <Icon size={16} />
                    </span>
                    <span className="pref-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                    {selected && (
                      <span className="pref-option-check">
                        <Check size={15} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="pref-section"
            aria-labelledby="pref-notifications-title"
          >
            <span className="form-label" id="pref-notifications-title">
              Avisos del centro de notificaciones
            </span>
            <p className="form-hint" id="pref-notifications-hint">
              Desactiva categorías para ocultarlas del panel y del contador. Los
              registros siguen disponibles en sus módulos.
            </p>
            <div
              className="pref-options"
              role="group"
              aria-labelledby="pref-notifications-title"
              aria-describedby="pref-notifications-hint"
            >
              {NOTIFICATION_OPTIONS.map((option) => {
                const Icon = option.icon;
                const checked = preferences.notifications[option.key];
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    className={`pref-option pref-switch ${checked ? "selected" : ""}`}
                    onClick={() =>
                      setAvisaPreferences((current) => ({
                        ...current,
                        notifications: {
                          ...current.notifications,
                          [option.key]: !current.notifications[option.key],
                        },
                      }))
                    }
                  >
                    <span className="pref-option-icon">
                      <Icon size={16} />
                    </span>
                    <span className="pref-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                    <span className="pref-switch-track" aria-hidden="true">
                      <span className="pref-switch-thumb" />
                    </span>
                    <span className="sr-only">
                      {checked ? "Activado" : "Desactivado"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <p className="pref-note" role="note">
            Las preferencias se guardan solo en este navegador. Este prototipo
            todavía no tiene perfil de usuario ni sincronización con un
            servidor, por lo que no se simula persistencia institucional.
          </p>
        </div>
      </div>
    </div>
  );
}
