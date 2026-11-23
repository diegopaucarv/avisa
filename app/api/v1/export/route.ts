import type { PoolClient } from "pg";

import { ApiError, jsonError } from "@/lib/db/errors";
import { queryParams, requireSession } from "@/lib/db/http";
import { withSession } from "@/lib/db/tenant";
import { listActors } from "@/lib/db/repos/actors";
import { listAlerts } from "@/lib/db/repos/alerts";
import { listCases } from "@/lib/db/repos/cases";
import { listCommitments } from "@/lib/db/repos/commitments";
import { listDemandas } from "@/lib/db/repos/demandas";
import { listDocuments } from "@/lib/db/repos/documents";
import { listLocales } from "@/lib/db/repos/locales";
import {
  listNotifications,
  type NotificationListQuery,
} from "@/lib/db/repos/notifications";
import { listOrganizaciones } from "@/lib/db/repos/organizaciones";
import { listReportes } from "@/lib/db/repos/reportes";
import {
  dumpBase,
  dumpEntidad,
  esFila,
  normalizar,
  serializarJson,
} from "@/lib/export/json";
import { generarPdf, type TablaPdf } from "@/lib/export/pdf";
import { escribirXlsx } from "@/lib/export/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Formato = "json" | "excel" | "pdf";

type ConsultaLista = {
  page?: number;
  pageSize?: number;
  [filtro: string]: string | number | undefined;
};
type Lector = (
  client: PoolClient,
  query: ConsultaLista,
) => Promise<{ items: unknown[]; total: number }>;

type Definicion = {
  titulo: string;
  listar: Lector;
  /**
   * Parámetros de la query string que el listado de la entidad sabe aplicar.
   * Se reenvían tal cual a su `listar`, igual que hace el endpoint de listado.
   */
  filtros?: readonly string[];
  /** Clave del repositorio cuando difiere del nombre del parámetro en la URL. */
  renombrar?: Readonly<Record<string, string>>;
};

/**
 * Los filtros de cada listado, con los mismos nombres que acepta su endpoint.
 * Se excluyen los booleanos de papelera porque dependen de la RLS y del rol.
 */
const FILTROS_CASOS = [
  "q",
  "estado",
  "riesgo",
  "prioridad",
  "nivel",
  "alcance",
  "tematica",
  "unidad",
  "region",
  "sinregion",
  "abiertos",
  "sort",
] as const;

const FILTROS_ALERTAS = [
  "q",
  "caso",
  "sinCaso",
  "prioridad",
  "nivel",
  "estado",
  "sort",
] as const;

const FILTROS_COMPROMISOS = [
  "q",
  "caso",
  "estado",
  "unidad",
  "tipo",
  "nivelGobierno",
  "atiendeGenero",
  "vencimiento_desde",
  "vencimiento_hasta",
] as const;

const FILTROS_DEMANDAS = ["q", "caso", "sinCaso", "estado", "sort"] as const;

/** Parámetros de control: nunca viajan como filtros del listado. */
const PARAMETROS_CONTROL = new Set([
  "entidad",
  "formato",
  "id",
  "pagina",
  "page",
  "tamano",
  "pageSize",
]);

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type TablaExportada = {
  clave: string;
  titulo: string;
  filas: unknown[];
};

const FORMATOS: readonly Formato[] = ["json", "excel", "pdf"];
const EXTENSIONES: Record<Formato, string> = {
  json: "json",
  excel: "xlsx",
  pdf: "pdf",
};
const TIPOS: Record<Formato, string> = {
  json: "application/json; charset=utf-8",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const ALIAS: Record<string, string> = {
  caso: "casos",
  alerta: "alertas",
  compromiso: "compromisos",
  documento: "documentos",
  demanda: "demandas",
  actor: "actores",
  organizacion: "organizaciones",
  local: "locales",
  notificacion: "notificaciones",
  reporte: "reportes",
};

const TAMANO_LECTURA = 100;
const MAX_PAGINAS = 10_000;
const MAX_COLUMNAS_PDF = 7;

/**
 * Adapta el `listar` de un repositorio —que tipa su propia consulta— al lector
 * genérico de la exportación. Los filtros ya pasan por la lista blanca de la
 * entidad, así que aquí sólo se reenvía la consulta sin reinterpretarla.
 */
function lector<T>(
  listar: (
    client: PoolClient,
    query: T,
  ) => Promise<{ items: unknown[]; total: number }>,
): Lector {
  return (client, query) => listar(client, query as unknown as T);
}

/**
 * Los repos trabajan con nombres en inglés pero todo el contrato de la API y la
 * UI usan español. Este registro es el único punto donde se emparejan.
 */
function registro(sesion: {
  uid: string;
  rol: string;
}): Record<string, Definicion> {
  return {
    casos: {
      titulo: "Casos",
      listar: lector(listCases),
      filtros: FILTROS_CASOS,
    },
    alertas: {
      titulo: "Alertas",
      listar: lector(listAlerts),
      filtros: FILTROS_ALERTAS,
    },
    compromisos: {
      titulo: "Compromisos",
      listar: lector(listCommitments),
      filtros: FILTROS_COMPROMISOS,
      renombrar: {
        vencimiento_desde: "vencimientoDesde",
        vencimiento_hasta: "vencimientoHasta",
      },
    },
    documentos: { titulo: "Documentos", listar: lector(listDocuments) },
    demandas: {
      titulo: "Demandas",
      listar: lector(listDemandas),
      filtros: FILTROS_DEMANDAS,
    },
    actores: { titulo: "Actores", listar: lector(listActors) },
    organizaciones: {
      titulo: "Organizaciones",
      listar: lector(listOrganizaciones),
    },
    locales: { titulo: "Locales", listar: lector(listLocales) },
    notificaciones: {
      titulo: "Notificaciones",
      listar: lector<NotificationListQuery>((client, query) =>
        listNotifications(
          client,
          { usuarioId: sesion.uid, rolCodigo: sesion.rol },
          query,
        ),
      ),
    },
    reportes: {
      titulo: "Registro de reportes (Anexo 17)",
      listar: lector(listReportes),
    },
  };
}

function claveDeEntidad(valor: string): string {
  const normalizada = valor.trim().toLowerCase();
  return ALIAS[normalizada] ?? normalizada;
}

/**
 * Recoge de la URL sólo los filtros que la entidad declara. Los parámetros de
 * control (`entidad`, `formato`, `id`, paginación) y los valores vacíos quedan
 * fuera: `entidad=base` exporta la base completa sin filtrar.
 */
function recogerFiltros(
  params: URLSearchParams,
  definicion: Definicion | undefined,
): Record<string, string> {
  const filtros: Record<string, string> = {};
  if (!definicion?.filtros) return filtros;

  for (const clave of definicion.filtros) {
    if (PARAMETROS_CONTROL.has(clave)) continue;
    const valor = params.get(clave)?.trim();
    if (!valor) continue;
    filtros[definicion.renombrar?.[clave] ?? clave] = valor;
  }

  return filtros;
}

/**
 * El rango de vencimiento de compromisos llega con el contrato del listado
 * (`YYYY-MM-DD`). Se valida aquí para que un valor mal escrito no llegue al SQL
 * y para no exportar un rango silenciosamente distinto al de la pantalla.
 */
function validarRangoVencimiento(filtros: Record<string, string>): void {
  const desde = filtros["vencimientoDesde"];
  const hasta = filtros["vencimientoHasta"];

  for (const [clave, valor] of [
    ["vencimiento_desde", desde],
    ["vencimiento_hasta", hasta],
  ] as const) {
    if (!valor) continue;
    const fecha = new Date(`${valor}T00:00:00Z`);
    if (
      !FECHA_ISO.test(valor) ||
      Number.isNaN(fecha.getTime()) ||
      fecha.toISOString().slice(0, 10) !== valor
    ) {
      throw new ApiError(
        400,
        `El parámetro ${clave} debe ser una fecha válida en formato YYYY-MM-DD.`,
        "INVALID_DATE",
      );
    }
  }

  if (desde && hasta && desde > hasta) {
    throw new ApiError(
      400,
      "El rango de vencimiento está invertido: `vencimiento_desde` no puede ser posterior a `vencimiento_hasta`.",
      "INVALID_DATE_RANGE",
    );
  }
}

function leerFormato(valor: string | null): Formato {
  if (valor && (FORMATOS as readonly string[]).includes(valor)) {
    return valor as Formato;
  }
  throw new ApiError(
    400,
    "Formato no válido. Use json, excel o pdf.",
    "FORMATO_INVALIDO",
  );
}

/**
 * Recorre las páginas del repositorio hasta agotar `total`, reenviando en cada
 * página los filtros vigentes de la vista. El tope de 100 por página lo imponen
 * las propias listas; el límite de páginas evita un bucle infinito si el total
 * cambiara durante la lectura.
 */
async function leerTodas(
  client: PoolClient,
  listar: Lector,
  filtros: Readonly<Record<string, string>> = {},
): Promise<unknown[]> {
  const filas: unknown[] = [];
  let pagina = 1;
  let total = Number.POSITIVE_INFINITY;

  while (pagina <= MAX_PAGINAS && filas.length < total) {
    const resultado = await listar(client, {
      ...filtros,
      page: pagina,
      pageSize: TAMANO_LECTURA,
    });
    if (resultado.items.length === 0) break;

    filas.push(...resultado.items);
    total = resultado.total;

    if (resultado.items.length < TAMANO_LECTURA) break;
    pagina += 1;
  }

  return filas;
}

function filtrarPorId(filas: readonly unknown[], id: string | null): unknown[] {
  if (!id) return [...filas];
  return filas.filter(
    (fila) => esFila(fila) && String(fila["id"] ?? "") === id,
  );
}

function filasObjeto(filas: readonly unknown[]): Record<string, unknown>[] {
  return filas.filter(esFila);
}

function columnasPdf(filas: readonly Record<string, unknown>[]): string[] {
  const vistas = new Set<string>();
  const claves: string[] = [];

  for (const fila of filas) {
    for (const clave of Object.keys(fila)) {
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      claves.push(clave);
    }
  }

  // El uuid ocupa mucho ancho y no aporta en una tabla impresa; se omite cuando
  // quedan otras columnas.
  const sinId = claves.filter((clave) => clave !== "id");
  const orden = sinId.length >= 2 ? sinId : claves;
  return orden.slice(0, MAX_COLUMNAS_PDF);
}

function celdaPdf(valor: unknown): string {
  const normalizado = normalizar(valor);
  if (normalizado === null) return "";
  if (typeof normalizado === "string") return normalizado;
  if (typeof normalizado === "number" || typeof normalizado === "boolean") {
    return String(normalizado);
  }
  return JSON.stringify(normalizado);
}

function tablaParaPdf(tabla: TablaExportada): TablaPdf {
  const filas = filasObjeto(tabla.filas);
  const columnas = columnasPdf(filas);

  if (columnas.length === 0) {
    return { titulo: tabla.titulo, columnas: [], filas: [] };
  }

  return {
    titulo: tabla.titulo,
    columnas: columnas.map((columna) => ({ titulo: columna })),
    filas: filas.map((fila) =>
      columnas.map((columna) => celdaPdf(fila[columna])),
    ),
  };
}

function fechaArchivo(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function respuesta(bytes: Uint8Array, tipo: string, nombre: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(request: Request) {
  try {
    const sesion = requireSession(request);
    const params = queryParams(request);
    const formato = leerFormato(params.get("formato"));

    const entidadBruta = (params.get("entidad") ?? "").trim();
    if (!entidadBruta) {
      throw new ApiError(
        400,
        "Indique la entidad a exportar (o «base»).",
        "ENTIDAD_INVALIDA",
      );
    }

    const esBase = entidadBruta.toLowerCase() === "base";
    const claveEntidad = esBase ? "base" : claveDeEntidad(entidadBruta);
    const id = params.get("id")?.trim() || null;

    const { tablas, titulo } = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      async (client) => {
        const entidades = registro(sesion);

        if (esBase) {
          const todas: TablaExportada[] = [];
          for (const [clave, definicion] of Object.entries(entidades)) {
            const filas = filtrarPorId(
              await leerTodas(client, definicion.listar),
              id,
            );
            todas.push({ clave, titulo: definicion.titulo, filas });
          }
          return { tablas: todas, titulo: "Respaldo de la base" };
        }

        const definicion = entidades[claveEntidad];
        if (!definicion) {
          throw new ApiError(
            400,
            `Entidad desconocida: ${entidadBruta}.`,
            "ENTIDAD_INVALIDA",
          );
        }

        const filtros = recogerFiltros(params, definicion);
        validarRangoVencimiento(filtros);

        const filas = filtrarPorId(
          await leerTodas(client, definicion.listar, filtros),
          id,
        );
        return {
          tablas: [
            { clave: claveEntidad, titulo: definicion.titulo, filas },
          ] satisfies TablaExportada[],
          titulo: definicion.titulo,
        };
      },
    );

    const generadoEn = new Date();
    const nombre = `avisa_${claveEntidad}_${fechaArchivo(generadoEn)}.${
      EXTENSIONES[formato]
    }`;

    let cuerpo: Uint8Array;

    if (formato === "json") {
      if (esBase) {
        const mapa: Record<string, readonly unknown[]> = {};
        for (const tabla of tablas) mapa[tabla.clave] = tabla.filas;
        cuerpo = serializarJson(dumpBase(mapa, generadoEn));
      } else {
        cuerpo = serializarJson(
          dumpEntidad(claveEntidad, tablas[0]?.filas ?? [], generadoEn),
        );
      }
    } else if (formato === "excel") {
      cuerpo = escribirXlsx(
        tablas.map((tabla) => ({
          nombre: tabla.titulo,
          filas: filasObjeto(tabla.filas),
        })),
      );
    } else {
      const total = tablas.reduce(
        (suma, tabla) => suma + tabla.filas.length,
        0,
      );
      cuerpo = generarPdf({
        titulo: esBase ? "AVISA - Respaldo de la base" : `AVISA - ${titulo}`,
        subtitulo: `${total} registros en ${tablas.length} entidad${
          tablas.length === 1 ? "" : "es"
        }`,
        generadoEn,
        tablas: tablas.map(tablaParaPdf),
      });
    }

    return respuesta(cuerpo, TIPOS[formato], nombre);
  } catch (error) {
    return jsonError(error);
  }
}
