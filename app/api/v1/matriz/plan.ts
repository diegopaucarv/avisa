import type { CasoMatriz, CompromisoMatriz } from "@/lib/db/repos/matriz";

import type { FilaFuente } from "./csv";

/**
 * Plan de previsualización de la matriz del equipo.
 *
 * Este módulo es puro: no consulta la base ni escribe nada. Recibe las filas ya
 * parseadas del CSV y el contexto que resolvió la ruta (equivalencias, casos y
 * compromisos existentes) y devuelve qué se crearía, qué se actualizaría y qué
 * se rechaza, con el motivo de cada rechazo.
 *
 * La aplicación definitiva no es este endpoint: la ejecuta
 * `scripts/matriz/importar_matriz.py --apply --confirmar`. Previsualizar nunca
 * sustituye ese paso.
 */

export type CodigoRechazo =
  | "SIN_CODIGO"
  | "SIN_EQUIVALENCIA"
  | "CASO_INEXISTENTE"
  | "CAMPO_OBLIGATORIO"
  | "DUPLICADO";

export type RechazoPlan = {
  fila: number;
  motivo: string;
  codigo: CodigoRechazo;
  codigoExcel: string | null;
  codigoCaso: string | null;
  detalle: string | null;
};

export type FilaPlan = {
  fila: number;
  codigoCaso: string;
  nombreCaso: string | null;
  codigoExcel: string | null;
  accion: string;
  hito: string | null;
  descripcionHito: string | null;
  estado: string | null;
  /** `crear` si la acción no existe en el caso; `actualizar` si ya existe. */
  accionPlan: "crear" | "actualizar";
  /** `true` si el hito no existe todavía en el compromiso. */
  hitoNuevo: boolean;
};

export type PlanPrevisualizacion = {
  escritura: false;
  mensaje: string;
  resumen: {
    filasFuente: number;
    reconocidas: number;
    rechazadas: number;
    aCrear: number;
    aActualizar: number;
  };
  crear: FilaPlan[];
  actualizar: FilaPlan[];
  rechazadas: RechazoPlan[];
  columnasReconocidas: Record<string, string>;
  columnasIgnoradas: string[];
};

/** Equivalencias Excel → código AVISA, con la clave ya normalizada. */
export type MapaMatriz = ReadonlyMap<string, string>;

export type Equivalencia = {
  codigoExcel: string;
  codigoCaso: string;
};

export type ContextoPlan = {
  mapa: MapaMatriz;
  casos: readonly CasoMatriz[];
  compromisos: readonly CompromisoMatriz[];
  columnas: {
    reconocidas: Record<string, string>;
    ignoradas: string[];
  };
};

export const MENSAJE_APLICACION =
  "Previsualización sin escritura: no se ha modificado la base. La aplicación definitiva de la matriz se hace con «python scripts/matriz/importar_matriz.py --apply --confirmar»; sin --apply el importador sólo hace un ensayo.";

/**
 * Normaliza códigos y textos para comparar sin tildes, mayúsculas ni espacios
 * repetidos. Mismo criterio que `core.normalizar_ref` en la base.
 */
export function normalizarCodigo(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Fusiona las equivalencias de la base con las que envíe el cliente. Las
 * manuales ganan porque permiten corregir el mapa sin migrarlo.
 */
export function fusionarMapa(
  base: readonly Equivalencia[],
  manuales: readonly Equivalencia[] = [],
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const equivalencia of [...base, ...manuales]) {
    const clave = normalizarCodigo(equivalencia.codigoExcel);
    const destino = equivalencia.codigoCaso.trim();
    if (clave === "" || destino === "") continue;
    mapa.set(clave, destino);
  }
  return mapa;
}

export type ResolucionCodigo =
  | { ok: true; codigoCaso: string; codigoExcel: string | null }
  | {
      ok: false;
      codigo: "SIN_CODIGO" | "SIN_EQUIVALENCIA";
      motivo: string;
      codigoExcel: string | null;
      codigoCaso: string | null;
    };

/**
 * Resuelve el caso de una fila: primero el código AVISA explícito, y si falta,
 * el código Excel a través del mapa. Nunca compara el código Excel con
 * `core.casos.codigo_caso` por su cuenta: hay colisiones documentadas.
 */
export function resolverCodigo(
  fila: FilaFuente,
  mapa: MapaMatriz,
): ResolucionCodigo {
  const codigoExcel = fila.codigoExcel?.trim() || null;
  const codigoCaso = fila.codigoCaso?.trim() || null;

  if (codigoCaso) {
    return { ok: true, codigoCaso, codigoExcel };
  }

  if (!codigoExcel) {
    return {
      ok: false,
      codigo: "SIN_CODIGO",
      motivo:
        "La fila no trae código AVISA ni código Excel: no hay forma de saber a qué caso pertenece.",
      codigoExcel: null,
      codigoCaso: null,
    };
  }

  const mapeado = mapa.get(normalizarCodigo(codigoExcel));
  if (!mapeado) {
    return {
      ok: false,
      codigo: "SIN_EQUIVALENCIA",
      motivo:
        "El código Excel no tiene equivalencia en core.mapa_matriz_excel ni entre las «mapeos» enviadas.",
      codigoExcel,
      codigoCaso: null,
    };
  }

  return { ok: true, codigoCaso: mapeado, codigoExcel };
}

/** Códigos de caso que hay que consultar en `core.casos` para armar el plan. */
export function codigosSolicitados(
  filas: readonly FilaFuente[],
  mapa: MapaMatriz,
): string[] {
  const codigos = new Set<string>();
  for (const fila of filas) {
    const resolucion = resolverCodigo(fila, mapa);
    if (resolucion.ok) codigos.add(resolucion.codigoCaso);
  }
  return Array.from(codigos);
}

function claveDuplicado(
  codigoCaso: string,
  accion: string,
  hito: string | null,
  descripcionHito: string | null,
): string {
  return [
    normalizarCodigo(codigoCaso),
    normalizarCodigo(accion),
    normalizarCodigo(hito),
    normalizarCodigo(descripcionHito),
  ].join("|");
}

/**
 * Construye el plan. El orden de comprobación es el del contrato: código,
 * caso, campos obligatorios y duplicado; sólo después se clasifica.
 */
export function construirPlan(
  filas: readonly FilaFuente[],
  contexto: ContextoPlan,
): PlanPrevisualizacion {
  const casosPorCodigo = new Map<string, CasoMatriz>();
  for (const caso of contexto.casos) {
    casosPorCodigo.set(normalizarCodigo(caso.codigo), caso);
  }

  const compromisosPorCaso = new Map<string, CompromisoMatriz[]>();
  for (const compromiso of contexto.compromisos) {
    const lista = compromisosPorCaso.get(compromiso.casoId);
    if (lista) lista.push(compromiso);
    else compromisosPorCaso.set(compromiso.casoId, [compromiso]);
  }

  const vistos = new Map<string, number>();
  const crear: FilaPlan[] = [];
  const actualizar: FilaPlan[] = [];
  const rechazadas: RechazoPlan[] = [];

  for (const fila of filas) {
    const codigoExcel = fila.codigoExcel?.trim() || null;
    const resolucion = resolverCodigo(fila, contexto.mapa);

    if (!resolucion.ok) {
      rechazadas.push({
        fila: fila.fila,
        motivo: resolucion.motivo,
        codigo: resolucion.codigo,
        codigoExcel: resolucion.codigoExcel,
        codigoCaso: resolucion.codigoCaso,
        detalle: null,
      });
      continue;
    }

    const caso = casosPorCodigo.get(normalizarCodigo(resolucion.codigoCaso));
    if (!caso) {
      rechazadas.push({
        fila: fila.fila,
        motivo: `El caso «${resolucion.codigoCaso}» no existe en core.casos.`,
        codigo: "CASO_INEXISTENTE",
        codigoExcel,
        codigoCaso: resolucion.codigoCaso,
        detalle: null,
      });
      continue;
    }

    const accion = fila.accion?.trim() || "";
    if (!accion) {
      rechazadas.push({
        fila: fila.fila,
        motivo:
          "Falta la acción/compromiso (columna N), que es obligatoria para registrar el compromiso.",
        codigo: "CAMPO_OBLIGATORIO",
        codigoExcel,
        codigoCaso: caso.codigo,
        detalle: "Columna N vacía.",
      });
      continue;
    }

    const hito = fila.hito?.trim() || null;
    const descripcionHito = fila.descripcionHito?.trim() || null;
    if (descripcionHito && !hito) {
      rechazadas.push({
        fila: fila.fila,
        motivo:
          "La descripción del hito (columna T) no trae la etiqueta del hito (columna S); no se puede crear un hito sin identificador.",
        codigo: "CAMPO_OBLIGATORIO",
        codigoExcel,
        codigoCaso: caso.codigo,
        detalle: "Columna T con texto y columna S vacía.",
      });
      continue;
    }

    const clave = claveDuplicado(caso.codigo, accion, hito, descripcionHito);
    const repetida = vistos.get(clave);
    if (repetida !== undefined) {
      rechazadas.push({
        fila: fila.fila,
        motivo: `Fila duplicada: repite el bloque de la fila ${repetida}.`,
        codigo: "DUPLICADO",
        codigoExcel,
        codigoCaso: caso.codigo,
        detalle: `Misma combinación de caso, acción, hito y descripción que la fila ${repetida}.`,
      });
      continue;
    }
    vistos.set(clave, fila.fila);

    const compromisos = compromisosPorCaso.get(caso.id) ?? [];
    const existente = compromisos.find(
      (compromiso) =>
        normalizarCodigo(compromiso.accion) === normalizarCodigo(accion),
    );

    let hitoNuevo = false;
    if (existente && (hito || descripcionHito)) {
      hitoNuevo = !existente.hitos.some((registrado) => {
        if (descripcionHito) {
          return (
            normalizarCodigo(registrado.descripcion) ===
            normalizarCodigo(descripcionHito)
          );
        }
        return normalizarCodigo(registrado.codigo) === normalizarCodigo(hito);
      });
    } else if (!existente && (hito || descripcionHito)) {
      hitoNuevo = true;
    }

    const plan: FilaPlan = {
      fila: fila.fila,
      codigoCaso: caso.codigo,
      nombreCaso: caso.nombre ?? fila.nombreCaso ?? null,
      codigoExcel,
      accion,
      hito,
      descripcionHito,
      estado: fila.estado?.trim() || null,
      accionPlan: existente ? "actualizar" : "crear",
      hitoNuevo,
    };

    if (existente) actualizar.push(plan);
    else crear.push(plan);
  }

  const reconocidas = crear.length + actualizar.length;

  return {
    escritura: false,
    mensaje: MENSAJE_APLICACION,
    resumen: {
      filasFuente: filas.length,
      reconocidas,
      rechazadas: rechazadas.length,
      aCrear: crear.length,
      aActualizar: actualizar.length,
    },
    crear,
    actualizar,
    rechazadas,
    columnasReconocidas: contexto.columnas.reconocidas,
    columnasIgnoradas: contexto.columnas.ignoradas,
  };
}
