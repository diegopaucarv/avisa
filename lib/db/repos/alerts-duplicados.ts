import type { PoolClient } from "pg";

import { ApiError } from "../errors";
import { ALERT_STATE } from "./alerts";

/* ------------------------------------------------------------------------- *
 * Contrato
 * ------------------------------------------------------------------------- */

/**
 * Criterio que efectivamente coincidió. La ventana temporal no aparece aquí:
 * no es algo que un candidato «acierte», es el universo donde se busca.
 */
export type CriterioDuplicadoAlerta = "titulo" | "distrito";

export type AlertaDuplicadoCandidato = {
  id: string;
  codigo: string;
  titulo: string | null;
  /** `YYYY-MM-DD` de `fecha_reporte` (la columna es `not null`). */
  fecha: string | null;
  /** Estado derivado del flujo, el mismo que pinta el listado. */
  estado: string;
  distrito: string | null;
  coincidencias: CriterioDuplicadoAlerta[];
};

export type BusquedaDuplicadosAlerta = {
  titulo: string;
  distritoId?: number;
  /** Código legible o uuid de la alerta en edición; se excluye del resultado. */
  alerta?: string;
};

export type DuplicadosAlertasResult = {
  criterios: {
    titulo: string;
    distritoId: number | null;
    alerta: string | null;
    ventanaDias: number;
  };
  candidatos: AlertaDuplicadoCandidato[];
  generadoEn: string;
};

/* ------------------------------------------------------------------------- *
 * Reglas
 * ------------------------------------------------------------------------- */

/**
 * Sólo se compara contra alertas de los últimos tres meses. Una alerta vieja
 * ya pasó por su triaje; volver a proponerla como duplicada de una señal nueva
 * sería ruido. Tres meses cubren el ciclo completo de una campaña.
 */
const VENTANA_DIAS = 90;

/** Mismo tope que la búsqueda de duplicados de casos. */
const LIMITE_CANDIDATOS = 15;

/**
 * Umbral de trigramas por debajo del cual dos títulos no se consideran
 * parecidos. 0,3 tolera una palabra cambiada o el orden invertido sin emparejar
 * títulos que sólo comparten el tema.
 */
const UMBRAL_SIMILITUD = 0.3;

/** Las palabras de menos de cuatro letras no distinguen un título de otro. */
const LARGO_MINIMO_PALABRA = 4;

/* ------------------------------------------------------------------------- *
 * Utilidades
 * ------------------------------------------------------------------------- */

/**
 * Esquema donde vive `pg_trgm`, o `null` si la extensión no está instalada.
 *
 * Se consulta en vez de asumirla porque `similarity()` no está en el esquema
 * `core` y el `search_path` de la conexión podría no incluir el suyo. Sin la
 * extensión, la búsqueda cae en `core.normalizar_ref` + `like`, que no necesita
 * índices ni funciones adicionales.
 */
async function esquemaTrigramas(client: PoolClient): Promise<string | null> {
  const result = await client.query<{ nspname: string }>(
    `select n.nspname
       from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pg_trgm'
      limit 1`,
  );
  return result.rows[0]?.nspname ?? null;
}

/** El esquema viene del catálogo, pero se cita igual: nunca se concatena crudo. */
function citarIdentificador(nombre: string): string {
  return `"${nombre.replace(/"/g, '""')}"`;
}

type FilaCandidato = {
  id: string;
  codigo: string;
  titulo: string | null;
  fecha: string | null;
  estado: string | null;
  distrito: string | null;
  titulo_len: number | null;
  titulo_exacto: boolean | null;
  titulo_contiene: boolean | null;
  titulo_comun: number | null;
  similitud: number | null;
  mismo_distrito: boolean | null;
};

/* ------------------------------------------------------------------------- *
 * Búsqueda
 * ------------------------------------------------------------------------- */

/**
 * Posibles duplicados de una alerta antes de registrarla. Compara título
 * (trigramas si `pg_trgm` está disponible, y en todo caso coincidencia
 * normalizada), distrito y la ventana reciente; excluye la propia alerta y las
 * anuladas. Devuelve los criterios que coincidieron; nunca decide ni fusiona.
 *
 * No persiste nada: para alertas no existe una tabla de descartes equivalente a
 * `core.caso_duplicado_descartado`, y esta pieza no autoriza DDL.
 */
export async function buscarDuplicadosAlertas(
  client: PoolClient,
  busqueda: BusquedaDuplicadosAlerta,
): Promise<DuplicadosAlertasResult> {
  const titulo = busqueda.titulo.trim();
  if (!titulo) {
    throw new ApiError(
      422,
      "El título es obligatorio para buscar duplicados.",
      "INVALID_INPUT",
    );
  }

  const distritoId =
    typeof busqueda.distritoId === "number" &&
    Number.isInteger(busqueda.distritoId) &&
    busqueda.distritoId > 0
      ? busqueda.distritoId
      : null;
  const alerta = busqueda.alerta?.trim() || null;

  const esquema = await esquemaTrigramas(client);
  const similitudExpr = esquema
    ? `${citarIdentificador(esquema)}.similarity(
         core.normalizar_ref(coalesce(a.titulo, '')),
         (select titulo from p)
       )`
    : "0::real";
  const similitudCondicion = esquema ? ` or similitud >= ${UMBRAL_SIMILITUD}` : "";

  const result = await client.query<FilaCandidato>(
    `with p as (
       select $1::text as titulo_raw,
              core.normalizar_ref($1::text) as titulo,
              $2::int as distrito_id
     ),
     t as (
       select coalesce(
                array(
                  select distinct core.normalizar_ref(w.tok)
                    from unnest(regexp_split_to_array(
                           (select titulo_raw from p), '[[:space:]]+'
                         )) as w(tok)
                   where char_length(core.normalizar_ref(w.tok)) >= ${LARGO_MINIMO_PALABRA}
                ),
                '{}'::text[]
              ) as arr
     ),
     cand as (
       select a.id,
              a.codigo_alerta as codigo,
              a.titulo,
              to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha,
              ${ALERT_STATE} as estado,
              d.nombre as distrito,
              length((select titulo from p)) as titulo_len,
              (core.normalizar_ref(coalesce(a.titulo, '')) = (select titulo from p)) as titulo_exacto,
              (core.normalizar_ref(coalesce(a.titulo, '')) like '%' || (select titulo from p) || '%') as titulo_contiene,
              (select count(*)::int
                 from (select distinct core.normalizar_ref(w.tok) as tok
                         from unnest(regexp_split_to_array(
                                coalesce(a.titulo, ''), '[[:space:]]+'
                              )) as w(tok)
                        where char_length(core.normalizar_ref(w.tok)) >= ${LARGO_MINIMO_PALABRA}
                       intersect
                       select unnest((select arr from t))) x) as titulo_comun,
              ${similitudExpr} as similitud,
              (a.distrito_id is not null
               and a.distrito_id = (select distrito_id from p)) as mismo_distrito
         from core.alertas_tempranas a
         left join core.distritos d on d.id = a.distrito_id
        where a.anulado_en is null
          and a.fecha_reporte >= current_date - ${VENTANA_DIAS}
          and ($3::text is null
               or (a.id::text <> $3::text and a.codigo_alerta <> $3::text))
     )
     select *
       from cand
      where (titulo_len > 0
             and (titulo_exacto or titulo_contiene or titulo_comun >= 2${similitudCondicion}))
         or mismo_distrito
      order by titulo_exacto desc, titulo_contiene desc, titulo_comun desc,
               similitud desc, mismo_distrito desc, fecha desc nulls last, codigo
      limit ${LIMITE_CANDIDATOS}`,
    [titulo, distritoId, alerta],
  );

  const candidatos: AlertaDuplicadoCandidato[] = result.rows.map((row) => {
    // `titulo_len` viene de la consulta normalizada: con un término sin letras
    // (sólo guiones, por ejemplo) `normalizar_ref` lo deja vacío y el `like
    // '%%'` emparejaría todas las alertas sin título. El largo lo impide.
    const tieneTitulo = Number(row.titulo_len) > 0;
    const exacto = row.titulo_exacto === true;
    const contiene = row.titulo_contiene === true;
    const comunes = Number(row.titulo_comun) || 0;
    const similitud = Number(row.similitud) || 0;

    const coincidencias: CriterioDuplicadoAlerta[] = [];
    if (
      tieneTitulo &&
      (exacto || contiene || comunes >= 2 || similitud >= UMBRAL_SIMILITUD)
    ) {
      coincidencias.push("titulo");
    }
    if (row.mismo_distrito === true) coincidencias.push("distrito");

    return {
      id: String(row.id),
      codigo: String(row.codigo),
      titulo: row.titulo,
      fecha: row.fecha,
      estado: String(row.estado ?? ""),
      distrito: row.distrito,
      coincidencias,
    };
  });

  return {
    criterios: {
      titulo,
      distritoId,
      alerta,
      ventanaDias: VENTANA_DIAS,
    },
    candidatos,
    generadoEn: new Date().toISOString(),
  };
}
