"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "avisa-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
  /** Lo que eligió la persona: claro, oscuro o seguir al sistema. */
  preference: ThemePreference;
  /** Tema realmente aplicado tras resolver "sistema". */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(
  resolved: ResolvedTheme,
  preference: ThemePreference,
) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  // La barra del navegador en móvil también debe acompañar al tema.
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = resolved === "dark" ? "#0c1117" : "#f5f7f8";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // El script inline de app/layout.tsx ya fijó data-theme antes del primer
  // pintado; aquí solo se sincroniza el estado de React con ese valor.
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    if (preference === "system") return systemTheme();
    return preference;
  });

  useEffect(() => {
    if (preference !== "system") {
      setResolved(preference);
      applyTheme(preference, preference);
      return;
    }
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => {
      const next = media.matches ? "dark" : "light";
      setResolved(next);
      applyTheme(next, "system");
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Almacenamiento bloqueado (modo privado): el tema sigue en memoria.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme debe usarse dentro de <ThemeProvider>.");
  }
  return context;
}
