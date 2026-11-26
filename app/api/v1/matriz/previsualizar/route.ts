import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  cargarCasosPorCodigo,
  cargarCompromisosPorCaso,
  cargarMapa,
  verificarEsquemaMapeo,
  verificarEsquemaPrevisualizacion,
} from "@/lib/db/repos/matriz";
import { withSession } from "@/lib/db/tenant";

import { construirFilas, leerCabecera, parsearCsv } from "../csv";
import {
  codigosSolicitados,
  construirPlan,
  fusionarMapa,
  type Equivalencia,
} from "../plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 5 MB de texto: por encima, el navegador ya está enviando un archivo raro. */
const MAX_BYTES = 5_000_000;

/** Tope de filas de datos por previsualización. */
const MAX_FILAS = 20000;

type CuerpoPrevisualizacion = {
  csv: string;
  mapeos: Equivalencia[];
};

function cuerpoInvalido(mensaje: string): ApiError {
  return new ApiError(400, mensaje, "CUERPO_INVALIDO");
}

/**
 * Lee y valida el cuerpo. `mapeos` es opcional; si llega, cada elemento debe
 * traer ambos códigos: no se aceptan equivalencias a medias.
 */
async function leerCuerpo(request: Request): Promise<CuerpoPrevisualizacion> {
  let bruto: unknown;
  try {
    bruto = await request.json();
  } catch {
    bruto = undefined;
  }

  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    throw cuerpoInvalido(
      "El cuerpo debe ser un objeto JSON con el CSV en texto (`csv`).",
    );
  }

  const registro = bruto as Record<string, unknown>;
  const csv = registro.csv;
  if (typeof csv !== "string" || csv.trim() === "") {
    throw cuerpoInvalido(
      "Falta el CSV en texto (`csv`). Se envía el contenido del archivo, no una ruta.",
    );
  }
  if (csv.length > MAX_BYTES) {
    throw cuerpoInvalido(
      `El CSV ocupa ${csv.length} caracteres y el límite es ${MAX_BYTES}. Divida el archivo o quite columnas que no se usan.`,
    );
  }

  const mapeos: Equivalencia[] = [];
  const crudos = registro.mapeos;
  if (crudos !== undefined && crudos !== null) {
    if (!Array.isArray(crudos)) {
      throw cuerpoInvalido("`mapeos` debe ser una lista de equivalencias.");
    }
    for (const item of crudos) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw cuerpoInvalido("Cada equivalencia debe ser un objeto.");
      }
      const fila = item as Record<string, unknown>;
      const codigoExcel =
        typeof fila.codigoExcel === "string" ? fila.codigoExcel.trim() : "";
      const codigoCaso =
        typeof fila.codigoCaso === "string" ? fila.codigoCaso.trim() : "";
      if (!codigoExcel || !codigoCaso) {
        throw cuerpoInvalido(
          "Cada equivalencia necesita `codigoExcel` y `codigoCaso` no vacíos.",
        );
      }
      mapeos.push({ codigoExcel, codigoCaso });
    }
  }

  return { csv, mapeos };
}

/**
 * Previsualización de la importación de la matriz: parsea el CSV y devuelve un
 * plan con filas reconocidas, rechazadas (con motivo) y a crear/actualizar.
 *
 * **No escribe nada.** La aplicación definitiva la hace
 * `scripts/matriz/importar_matriz.py --apply --confirmar`; este endpoint sólo
 * reutiliza el mapa de equivalencias y el catálogo de casos para anticipar el
 * resultado. Si falta la tabla de equivalencias y el cliente no envía `mapeos`,
 * responde 503 `ESQUEMA_PENDIENTE`.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const cuerpo = await leerCuerpo(request);

    const registros = parsearCsv(cuerpo.csv);
    if (registros.length === 0) {
      throw cuerpoInvalido("El CSV está vacío: no hay cabecera ni filas.");
    }
    if (registros.length - 1 > MAX_FILAS) {
      throw cuerpoInvalido(
        `El CSV trae ${registros.length - 1} filas y el límite es ${MAX_FILAS}.`,
      );
    }

    const [cabecera, ...resto] = registros;
    const leida = leerCabecera(cabecera ?? []);
    if (Object.keys(leida.indices).length === 0) {
      throw new ApiError(
        400,
        "No se reconoció ninguna columna de la cabecera. Use la plantilla del formato del equipo (A..W) o incluya al menos una columna conocida.",
        "CABECERA_NO_RECONOCIDA",
      );
    }

    const filas = construirFilas(resto, leida);

    const plan = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        let mapaBase: Equivalencia[] = [];
        let mapaDisponible = true;
        try {
          await verificarEsquemaMapeo(client);
          mapaBase = await cargarMapa(client);
        } catch (error) {
          if (error instanceof ApiError && error.code === "ESQUEMA_PENDIENTE") {
            mapaDisponible = false;
          } else {
            throw error;
          }
        }

        // Sin tabla de equivalencias sólo se puede planificar si el cliente
        // envía las suyas; en caso contrario se declara el hueco, no se adivina.
        await verificarEsquemaPrevisualizacion(
          client,
          !mapaDisponible && cuerpo.mapeos.length === 0,
        );

        const mapa = fusionarMapa(mapaBase, cuerpo.mapeos);
        const codigos = codigosSolicitados(filas, mapa);
        const casos = await cargarCasosPorCodigo(client, codigos);
        const compromisos = await cargarCompromisosPorCaso(
          client,
          casos.map((caso) => caso.id),
        );

        return construirPlan(filas, {
          mapa,
          casos,
          compromisos,
          columnas: {
            reconocidas: leida.reconocidas,
            ignoradas: leida.ignoradas,
          },
        });
      },
    );

    return jsonOk(plan);
  } catch (error) {
    return jsonError(error);
  }
}
