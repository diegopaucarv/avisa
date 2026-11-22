"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CircleHelp, X } from "lucide-react";

export type GlossaryKey =
  | "conflictLevel"
  | "risk"
  | "theme"
  | "subsector"
  | "priority"
  | "actorType"
  | "actorRole"
  | "actorPosition"
  | "threeP"
  | "agreementType";

type GlossaryEntry = {
  label: string;
  definition: string;
  source: string;
  verified: boolean;
};

/** Fuente única: la reutilizan los botones ⓘ y la ayuda navegable. */
export const glossary: Record<GlossaryKey, GlossaryEntry> = {
  conflictLevel: {
    label: "Nivel de conflictividad",
    definition:
      "Grado de exteriorización pública de la discrepancia. Se mide en cuatro niveles: Diferencia, Controversia, Conflicto social y Crisis social.",
    source: "Guía PRODUCE §7.5.1",
    verified: true,
  },
  risk: {
    label: "Nivel de riesgo",
    definition:
      "Nivel de la última alerta temprana aprobada. No es un atributo permanente del caso y no se publica sin revisión humana; sin alerta aprobada se muestra inactivo.",
    source: "Modelo AVISA v10 · cat_niveles_riesgo",
    verified: true,
  },
  theme: {
    label: "Temática",
    definition:
      "Clasificación temática principal del caso: Infraestructura; Ordenamiento y acceso territorial; Normatividad; Distribución de beneficios; Gobernanza; Impactos de terceros.",
    source: "Modelo AVISA v10 · cat_tematicas",
    verified: true,
  },
  subsector: {
    label: "Subsector",
    definition:
      "Subsector productivo asociado al caso: Pesca y Acuicultura, o MYPE e Industria.",
    source: "Modelo AVISA v10 · cat_subsectores",
    verified: true,
  },
  priority: {
    label: "Prioridad de atención",
    definition:
      "Prontitud del seguimiento derivada de la matriz de conflictividad: Urgente, Moderado o Bajo. Es un eje distinto del nivel de riesgo.",
    source: "Modelo AVISA v10 · cat_prioridades_atencion",
    verified: true,
  },
  actorType: {
    label: "Tipo de actor",
    definition: "Naturaleza del actor: social, público o privado.",
    source: "Definición del prototipo · por validar con OAIPCS",
    verified: false,
  },
  actorRole: {
    label: "Función de actor",
    definition: "Papel en el proceso: principal, secundario o tercero imparcial.",
    source: "Definición del prototipo · por validar con OAIPCS",
    verified: false,
  },
  actorPosition: {
    label: "Posicionamiento",
    definition:
      "Postura declarada en el diálogo: dialogante, legitimante o conflictivo.",
    source: "Definición del prototipo · por validar con OAIPCS",
    verified: false,
  },
  threeP: {
    label: "Estructura 3P",
    definition:
      "Estructura obligatoria de toda demanda: Problema, Propuesta y Pedido.",
    source: "Guía PRODUCE · Anexo 1",
    verified: true,
  },
  agreementType: {
    label: "Tipo de acuerdo",
    definition:
      "Clasificación del compromiso: progresivo o parcial, entendimiento operativo, o condicionado.",
    source: "Definición del prototipo · por validar con OAIPCS",
    verified: false,
  },
};

const HELP_EVENT = "avisa:open-help";

/** Abre la ayuda y la posiciona en una sección concreta. */
export function openHelp(anchor = "ayuda-inicio") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HELP_EVENT, { detail: anchor }));
}

export function GlossaryTerm({
  term,
  align = "start",
}: {
  term: GlossaryKey;
  align?: "start" | "end";
}) {
  const entry = glossary[term];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = `glossary-${term}`;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="glossary-term" ref={rootRef}>
      <button
        type="button"
        className="catalog-info"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${entry.label}: ${entry.definition}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label={entry.label}
          className={`glossary-popover ${align === "end" ? "glossary-popover-end" : ""}`}
        >
          <strong>{entry.label}</strong>
          <span className="glossary-definition">{entry.definition}</span>
          <span className="glossary-source">{entry.source}</span>
          {!entry.verified && (
            <span className="glossary-flag">Definición por validar</span>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOpen(false);
              openHelp(`ayuda-glosario-${term}`);
            }}
          >
            <BookOpen size={12} aria-hidden="true" /> Ver en la ayuda
          </button>
        </span>
      )}
    </span>
  );
}

const helpScreens = [
  {
    id: "ayuda-pantalla-resumen",
    title: "Resumen operativo",
    detail:
      "Muestra el ámbito regional y el periodo elegidos en la barra superior. Las tarjetas de cifras marcadas como demo no provienen de una consulta institucional. «Señales de hoy» cuenta solo registros de demostración y su definición está pendiente de validación con OAIPCS.",
  },
  {
    id: "ayuda-pantalla-bandeja",
    title: "Bandeja de trabajo",
    detail:
      "Reúne alertas pendientes, compromisos paralizados o por vencer y casos de riesgo alto, ordenados por urgencia. Las acciones de la bandeja aún no persisten fuera de esta sesión.",
  },
  {
    id: "ayuda-pantalla-casos",
    title: "Casos y ficha",
    detail:
      "La cuadrícula lista casos; la ficha reúne catálogos, actores, demandas, cronología, documentos, alertas y compromisos. El nivel de riesgo se toma de la última alerta aprobada: si no existe ninguna, se muestra inactivo.",
  },
  {
    id: "ayuda-pantalla-alertas",
    title: "Alertas tempranas",
    detail:
      "Toda alerta exige revisión humana de la cita contra la fuente antes de aprobarse o descartarse. El descarte requiere un motivo escrito.",
  },
  {
    id: "ayuda-pantalla-compromisos",
    title: "Compromisos",
    detail:
      "El plazo y el avance se registran por separado. «Paralizado» describe la gestión del acuerdo y no reemplaza el aviso de vencimiento por fecha.",
  },
  {
    id: "ayuda-pantalla-documentos",
    title: "Documentos",
    detail:
      "Cada documento conserva fragmentos y propuestas de extracción. Validar o rechazar un fragmento es un acto humano explícito, no automático.",
  },
  {
    id: "ayuda-pantalla-directorio",
    title: "Directorio",
    detail:
      "Actores, organizaciones, instituciones y locales de demostración. Los contactos están protegidos y no se muestran.",
  },
  {
    id: "ayuda-pantalla-mapa",
    title: "Mapa territorial",
    detail:
      "Puntos ilustrativos por región; no hay coordenadas operativas ni datos en tiempo real.",
  },
  {
    id: "ayuda-pantalla-direccion",
    title: "Resumen de Dirección",
    detail:
      "Vista ejecutiva de demostración: sus cifras son ilustrativas y no describen la situación institucional.",
  },
] as const;

const helpStates = [
  {
    title: "Caso",
    detail:
      "Activo · En seguimiento · Resuelto · Archivado. Archivar conserva los vínculos y el historial; no borra el registro.",
  },
  {
    title: "Alerta temprana",
    detail:
      "Pendiente de revisión → Aprobada o Descartada. Solo el paso humano cambia la visibilidad de la alerta.",
  },
  {
    title: "Compromiso",
    detail: "En curso · Por vencer · Paralizado · Cumplido.",
  },
  {
    title: "Documento",
    detail: "Cargado · En análisis · Extraído · Validado · Rechazado.",
  },
  {
    title: "Demanda",
    detail: "Pendiente · En proceso · Atendida · Desestimada.",
  },
] as const;

const helpRoute = [
  {
    title: "Intervención preventiva",
    detail: "Anticipa el escalamiento antes de que el conflicto se exteriorice.",
  },
  {
    title: "Intervención y tratamiento",
    detail:
      "Atiende el conflicto activo mediante diálogo y medidas sectoriales.",
  },
  {
    title: "Monitoreo de compromisos",
    detail: "Verifica plazos, avance y evidencia de lo acordado.",
  },
  {
    title: "Gestión del conocimiento (transversal)",
    detail: "Documenta aprendizajes y alimenta guías, catálogos y criterios.",
  },
] as const;

const helpNav = [
  { id: "ayuda-inicio", label: "Cómo usar la ayuda" },
  { id: "ayuda-pantallas", label: "Pantallas" },
  { id: "ayuda-ruta", label: "Ruta de atención" },
  { id: "ayuda-estados", label: "Estados" },
  { id: "ayuda-glosario", label: "Glosario" },
  { id: "ayuda-cifras", label: "Cifras de demostración" },
] as const;

export function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState("ayuda-inicio");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<string | undefined>).detail;
      lastFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setAnchor(detail ?? "ayuda-inicio");
      setOpen(true);
    };
    window.addEventListener(HELP_EVENT, onOpen);
    return () => window.removeEventListener(HELP_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) {
      lastFocus.current?.focus();
      lastFocus.current = null;
      return;
    }
    const target = document.getElementById(anchor);
    if (target) {
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    } else {
      closeRef.current?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, anchor]);

  if (!open) return null;

  const goTo = (id: string) => {
    setAnchor(id);
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  };

  return (
    <div className="drawer-scrim" onClick={() => setOpen(false)}>
      <aside
        className="drawer drawer-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h3 id="help-title">Ayuda y criterios</h3>
            <p>
              Cómo leer las categorías, los estados y cada pantalla del
              prototipo.
            </p>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar ayuda"
          >
            <X size={17} />
          </button>
        </div>
        <div className="drawer-body help-body">
          <nav className="help-nav" aria-label="Secciones de la ayuda">
            <span className="help-nav-label">Contenido</span>
            {helpNav.map((item) => (
              <button key={item.id} type="button" onClick={() => goTo(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="help-content">
            <section id="ayuda-inicio" tabIndex={-1} className="help-section">
              <h4>Cómo usar esta ayuda</h4>
              <p>
                Cada definición del sistema está reunida aquí una sola vez. Los
                botones ⓘ de la ficha abren la misma definición y llevan a su
                entrada del glosario; este panel explica además cómo se comporta
                cada pantalla y qué significa cada estado.
              </p>
              <p>
                El prototipo trabaja con datos simulados: ninguna cifra debe
                citarse como institucional.
              </p>
            </section>

            <section id="ayuda-pantallas" tabIndex={-1} className="help-section">
              <h4>Pantallas</h4>
              <ul>
                {helpScreens.map((screen) => (
                  <li key={screen.id}>
                    <strong>{screen.title}.</strong> {screen.detail}
                  </li>
                ))}
              </ul>
            </section>

            <section id="ayuda-ruta" tabIndex={-1} className="help-section">
              <h4>Ruta de atención</h4>
              <p>
                Las cuatro áreas pueden ocurrir simultáneamente; no son etapas
                rígidas ni una secuencia obligatoria.
              </p>
              <ul>
                {helpRoute.map((area) => (
                  <li key={area.title}>
                    <strong>{area.title}.</strong> {area.detail}
                  </li>
                ))}
              </ul>
            </section>

            <section id="ayuda-estados" tabIndex={-1} className="help-section">
              <h4>Estados</h4>
              <ul>
                {helpStates.map((state) => (
                  <li key={state.title}>
                    <strong>{state.title}:</strong> {state.detail}
                  </li>
                ))}
              </ul>
            </section>

            <section id="ayuda-glosario" tabIndex={-1} className="help-section">
              <h4>Glosario</h4>
              <ul className="help-terms">
                {(Object.keys(glossary) as GlossaryKey[]).map((key) => {
                  const entry = glossary[key];
                  return (
                    <li
                      key={key}
                      id={`ayuda-glosario-${key}`}
                      tabIndex={-1}
                      className="help-term"
                    >
                      <strong>{entry.label}</strong>
                      <p>{entry.definition}</p>
                      <small>
                        {entry.source}
                        {!entry.verified && " · definición por validar"}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section id="ayuda-cifras" tabIndex={-1} className="help-section">
              <h4>Cifras de demostración</h4>
              <ul>
                <li>
                  <strong>Acuerdos a tiempo (78 %)</strong> e{" "}
                  <strong>Intervenciones (18)</strong> son valores fijos de
                  demostración: no tienen regla de cálculo aprobada ni fuente
                  consultable.
                </li>
                <li>
                  <strong>Señales de hoy</strong> se calcula sobre los registros
                  de demostración del ámbito y periodo activos; su definición
                  está pendiente de validación con OAIPCS.
                </li>
              </ul>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
