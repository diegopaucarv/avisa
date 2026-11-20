"use client";

import { useEffect } from "react";
import { Check, Monitor, Moon, Sun, X } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";

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

export function PreferencesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { preference, resolved, setPreference } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside
        className="drawer drawer-narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h3 id="preferences-title">Preferencias</h3>
            <p>Ajustes de visualización de esta estación de trabajo.</p>
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
          <section className="pref-section">
            <div className="pref-section-head">
              <span className="form-label">Tema de la interfaz</span>
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
              La preferencia se guarda en este navegador.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
