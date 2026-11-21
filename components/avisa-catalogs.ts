export const conflictLevels = [
  "Diferencia",
  "Controversia",
  "Conflicto social",
  "Crisis social",
] as const;

export const conflictLevelDefinitions: Record<(typeof conflictLevels)[number], string> = {
  Diferencia: "Desacuerdo que aún no se expresa como controversia pública. Guía 7.5.",
  Controversia: "Desacuerdo con expresión pública entre actores. Guía 7.5.",
  "Conflicto social": "Grado de exteriorización pública de la discrepancia. Guía 7.5.1.",
  "Crisis social": "Escalamiento crítico que requiere respuesta coordinada. Guía 7.5.",
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
export const geographicScopes = ["Norte", "Centro", "Sur", "Oriente", "Nacional"] as const;

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");

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
  return departments.map((department) => macroRegions[department]).find(Boolean) ?? "Nacional";
}

export function territoryMatchesScope(territory: string, scope: string) {
  const department = normalize(territory.split(/[·,/-]/)[0] ?? "");
  return department === normalize(scope);
}

export const guideDefinitions = {
  conflictLevel: "Grado de exteriorización pública de la discrepancia (guía 7.5.1).",
  risk: "Estimación vinculada a la última alerta aprobada; no es un atributo permanente del caso.",
  theme: "Clasificación temática principal del caso.",
  subsector: "Subsector productivo asociado al caso.",
  priority: "Prontitud del seguimiento derivada de la matriz de conflictividad.",
  actorType: "Clasificación del actor: social, público o privado.",
  actorRole: "Función en el proceso: principal, secundario o tercero imparcial.",
  actorPosition: "Posicionamiento declarado en el proceso de diálogo.",
  threeP: "Estructura de demanda: Problema, Propuesta y Pedido.",
  agreementType: "Clasificación del acuerdo según la guía de gestión.",
} as const;
