import type { DemoCommitment } from "./avisa-demo-data";

export const conflictLevels = [
  "Diferencia",
  "Controversia",
  "Conflicto social",
  "Crisis social",
] as const;

export const conflictLevelDefinitions: Record<
  (typeof conflictLevels)[number],
  string
> = {
  Diferencia:
    "Desacuerdo que aún no se expresa como controversia pública. Guía 7.5.",
  Controversia: "Desacuerdo con expresión pública entre actores. Guía 7.5.",
  "Conflicto social":
    "Grado de exteriorización pública de la discrepancia. Guía 7.5.1.",
  "Crisis social":
    "Escalamiento crítico que requiere respuesta coordinada. Guía 7.5.",
};

export const themes = [
  "Infraestructura",
  "Ordenamiento y acceso territorial",
  "Normatividad",
  "Distribución de beneficios",
  "Gobernanza",
  "Impactos de terceros",
] as const;

export const subsectors = ["Pesca y Acuicultura", "MYPE e Industria"] as const;
export const priorities = ["Urgente", "Moderado", "Bajo"] as const;
export const geographicScopes = [
  "Norte",
  "Centro",
  "Sur",
  "Oriente",
  "Nacional",
] as const;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");

const macroRegions: Record<string, (typeof geographicScopes)[number]> = {
  amazonas: "Norte",
  ancash: "Centro",
  apurimac: "Sur",
  arequipa: "Sur",
  ayacucho: "Sur",
  cajamarca: "Norte",
  callao: "Centro",
  cusco: "Sur",
  huancavelica: "Centro",
  huanuco: "Centro",
  ica: "Sur",
  junin: "Centro",
  "la libertad": "Norte",
  lambayeque: "Norte",
  lima: "Centro",
  loreto: "Oriente",
  "madre de dios": "Oriente",
  moquegua: "Sur",
  pasco: "Centro",
  piura: "Norte",
  puno: "Sur",
  "san martin": "Oriente",
  tacna: "Sur",
  tumbes: "Norte",
  ucayali: "Oriente",
};

export function deriveGeographicScope(region: string) {
  const departments = region.split(/[·,/-]/).map(normalize);
  return (
    departments.map((department) => macroRegions[department]).find(Boolean) ??
    "Nacional"
  );
}

export function territoryMatchesScope(territory: string, scope: string) {
  const department = normalize(territory.split(/[·,/-]/)[0] ?? "");
  return department === normalize(scope);
}

/* ── Fechas de demostración ────────────────────────────────────────
 * Los datos sintéticos usan varios formatos. Estas utilidades no pretenden
 * reemplazar una librería de fechas: solo permiten comparar y ordenar sin
 * asumir que un texto libre es una fecha válida. */

const months: Record<string, number> = {
  ene: 0,
  enero: 0,
  feb: 1,
  febrero: 1,
  mar: 2,
  marzo: 2,
  abr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  jun: 5,
  junio: 5,
  jul: 6,
  julio: 6,
  ago: 7,
  agosto: 7,
  sep: 8,
  septiembre: 8,
  set: 8,
  oct: 9,
  octubre: 9,
  nov: 10,
  noviembre: 10,
  dic: 11,
  diciembre: 11,
};

const MS_DAY = 24 * 60 * 60 * 1000;

/** Fecha de referencia fija de la demostración (21 nov 2026, mediodía local). */
export const demoReferenceDate = new Date(2026, 10, 21, 12, 0, 0);

const buildDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month, day, 12, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
};

const monthIndex = (name: string) => {
  const key = normalize(name).replace(/\.$/, "");
  return key in months ? months[key] : null;
};

/**
 * Parser tolerante para fechas de demostración.
 * Acepta `dd/mm/yyyy`, `yyyy-mm-dd` y `dd mes yyyy` (p. ej. «19 nov 2026»).
 * Devuelve null para textos como «Por definir».
 */
export function parseDemoDate(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match)
    return buildDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match)
    return buildDate(Number(match[3]), Number(match[2]) - 1, Number(match[1]));

  match = text.match(/^(\d{1,2})\s+([a-záéíóúñ.]+)\s+(\d{4})$/i);
  if (match) {
    const month = monthIndex(match[2]);
    return month === null
      ? null
      : buildDate(Number(match[3]), month, Number(match[1]));
  }

  return null;
}

/**
 * Variante para etiquetas de cronología y alertas: acepta «19 nov · 10:42»
 * y «Hoy · ahora». Devuelve null cuando no se puede interpretar.
 */
export function parseDemoDateTime(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  if (/^hoy\b/i.test(text) || /ahora/i.test(text))
    return new Date(demoReferenceDate);

  const [datePart, timePart] = text.split("·");
  let date = parseDemoDate(datePart.trim());

  if (!date) {
    const short = datePart.trim().match(/^(\d{1,2})\s+([a-záéíóúñ.]+)$/i);
    if (short) {
      const month = monthIndex(short[2]);
      if (month !== null) date = buildDate(2026, month, Number(short[1]));
    }
  }

  if (!date) return null;

  const clock = timePart?.match(/(\d{1,2}):(\d{2})/);
  if (clock) date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
  return date;
}

/** Convierte una fecha de demostración al valor que espera `<input type="date">`. */
export function toDateInputValue(value?: string) {
  const date = value ? parseDemoDate(value) : null;
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Estado operativo derivado de avance y fechas; «Paralizado» es la única anulación manual. */
export function deriveCommitmentStatus({
  progress,
  due,
  fechaInicio,
  paralizado,
}: {
  progress: number;
  due: string;
  fechaInicio?: string;
  paralizado?: boolean;
}): DemoCommitment["status"] {
  if (paralizado) return "Paralizado";
  if (progress >= 100) return "Cumplido";
  const dueDate = parseDemoDate(due);
  if (!dueDate) return "En curso";
  const start = fechaInicio ? parseDemoDate(fechaInicio) : null;
  if (start && start.getTime() > demoReferenceDate.getTime()) return "En curso";
  const days = Math.round(
    (dueDate.getTime() - demoReferenceDate.getTime()) / MS_DAY,
  );
  return days >= 0 && days <= 7 ? "Por vencer" : "En curso";
}

export type CommitmentDueState = {
  key: "vencido" | "por-vencer" | "en-plazo" | "sin-fecha";
  label: "Vencido" | "Por vencer" | "En plazo" | "Sin fecha";
  detail: string;
};

/**
 * Vencimiento calculado por fecha, separado del estado de gestión.
 * «Paralizado» no se interpreta como sinónimo de vencido.
 */
export function deriveCommitmentDueState(
  due: string,
  fechaInicio?: string,
): CommitmentDueState {
  const dueDate = parseDemoDate(due);
  if (!dueDate) {
    return {
      key: "sin-fecha",
      label: "Sin fecha",
      detail:
        "La fecha de vencimiento no se pudo interpretar; se muestra como «sin fecha» sin bloquear el registro.",
    };
  }

  const start = fechaInicio ? parseDemoDate(fechaInicio) : null;
  const detail = start
    ? `Plazo calculado con vencimiento ${due} e inicio ${fechaInicio}.`
    : `Plazo calculado solo con el vencimiento ${due}; no hay fecha de inicio registrada.`;
  const days = Math.round(
    (dueDate.getTime() - demoReferenceDate.getTime()) / MS_DAY,
  );

  if (days < 0) return { key: "vencido", label: "Vencido", detail };
  if (days <= 7) return { key: "por-vencer", label: "Por vencer", detail };
  return { key: "en-plazo", label: "En plazo", detail };
}
