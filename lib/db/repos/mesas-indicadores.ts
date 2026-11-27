import type { PoolClient } from "pg";
import { hayVinculoMesas } from "./mesas";

/**
 * Indicadores de mesas de diálogo para la franja de resumen.
 *
 * Los compromisos e hitos sólo existen cuando la migración 81 ha vinculado cada
 * mesa con su caso (`mesas_dialogo.caso_id`). Sin ese vínculo los contadores de
 * compromisos/hitos valen 0 y sus arrays vienen vacíos; las cifras propias de la
 * mesa (totales, vigencia, naturaleza, departamentos) se sirven igual.
 */

export type IndicadorConteo = {
  clave: string;
  total: number;
};

export type IndicadorMesa = {
  codigo: string;
  titulo: string;
  total: number;
  cumplidos: number;
};

export type IndicadoresMesas = {
  /** `false` si `mesas_dialogo.caso_id` no existe (migración 81 pendiente). */
  vinculoDisponible: boolean;
  totales: {
    mesas: number;
    miembros: number;
    compromisos: number;
    hitos: number;
  };
  vigencia: IndicadorConteo[];
  naturaleza: IndicadorConteo[];
  departamentos: IndicadorConteo[];
  compromisosEstado: IndicadorConteo[];
  compromisosPorMesa: IndicadorMesa[];
  hitosEstado: IndicadorConteo[];
};

/**
 * Los 25 departamentos del Perú, con sus tildes. `ambito_departamento` es texto
 * libre («Lima, Callao», «Más de Uno», «Nacional», tildes inconsistentes), así
 * que la comparación se hace sin tildes ni mayúsculas.
 */
const DEPARTAMENTOS = [
  "Amazonas",
  "Áncash",
  "Apurímac",
  "Arequipa",
  "Ayacucho",
  "Cajamarca",
  "Callao",
  "Cusco",
  "Huancavelica",
  "Huánuco",
  "Ica",
  "Junín",
  "La Libertad",
  "Lambayeque",
  "Lima",
  "Loreto",
  "Madre de Dios",
  "Moquegua",
  "Pasco",
  "Piura",
  "Puno",
  "San Martín",
  "Tacna",
  "Tumbes",
  "Ucayali",
] as const;

function claveTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const DEPARTAMENTO_POR_CLAVE = new Map(
  DEPARTAMENTOS.map((nombre) => [claveTexto(nombre), nombre]),
);

/** El origen trae el typo real «Tacaycillo» por «Tacna». */
const ALIAS_DEPARTAMENTO: Readonly<Record<string, string>> = {
  tacaycillo: "Tacna",
};

const SIN_CLASIFICAR = "Sin clasificar";
const MAX_DEPARTAMENTOS = 12;

/**
 * Cuenta departamentos a partir de los textos libres de las mesas.
 *
 * Cada registro suma 1 a cada departamento reconocido (un «Lima, Callao» aporta
 * a ambos) y lo no reconocido —incluido el ámbito nulo— cae en
 * «Sin clasificar». Ordena de mayor a menor y recorta a 12.
 */
function contarDepartamentos(
  valores: ReadonlyArray<string | null>,
): IndicadorConteo[] {
  const conteo = new Map<string, number>();

  for (const valor of valores) {
    const vistos = new Set<string>();
    for (const parte of (valor ?? "").split(",")) {
      const clave = claveTexto(parte);
      if (!clave) continue;
      const canonico =
        ALIAS_DEPARTAMENTO[clave] ??
        DEPARTAMENTO_POR_CLAVE.get(clave) ??
        SIN_CLASIFICAR;
      vistos.add(canonico);
    }
    if (vistos.size === 0) vistos.add(SIN_CLASIFICAR);

    for (const canonico of vistos) {
      conteo.set(canonico, (conteo.get(canonico) ?? 0) + 1);
    }
  }

  return [...conteo.entries()]
    .map(([clave, total]) => ({ clave, total }))
    .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave))
    .slice(0, MAX_DEPARTAMENTOS);
}

export async function indicadoresDeMesas(
  client: PoolClient,
): Promise<IndicadoresMesas> {
  const vinculo = await hayVinculoMesas(client);

  const [base, vigencia, naturaleza, ambitos] = await Promise.all([
    client.query<{ mesas: number; miembros: number }>(
      `select (count(*))::int as mesas,
              (select count(*)::int from core.mesa_miembros) as miembros
         from core.mesas_dialogo`,
    ),
    client.query<IndicadorConteo>(
      `select coalesce(m.estado_vigencia, 'Sin fecha') as clave,
              count(*)::int as total
         from core.mesas_dialogo m
        group by 1
        order by total desc, clave`,
    ),
    client.query<IndicadorConteo>(
      `select coalesce(m.naturaleza, 'No definida') as clave,
              count(*)::int as total
         from core.mesas_dialogo m
        group by 1
        order by total desc, clave`,
    ),
    client.query<{ ambito: string | null }>(
      `select m.ambito_departamento as ambito from core.mesas_dialogo m`,
    ),
  ]);

  let compromisos = 0;
  let hitos = 0;
  let compromisosEstado: IndicadorConteo[] = [];
  let compromisosPorMesa: IndicadorMesa[] = [];
  let hitosEstado: IndicadorConteo[] = [];

  if (vinculo) {
    const [totales, porEstado, porMesa, porHito] = await Promise.all([
      client.query<{ compromisos: number; hitos: number }>(
        `select (select count(*)::int
                   from core.compromisos c
                   join core.mesas_dialogo m on m.caso_id = c.caso_id
                  where c.anulado_en is null) as compromisos,
                (select count(*)::int
                   from core.hitos_compromiso h
                   join core.compromisos c on c.id = h.compromiso_id
                   join core.mesas_dialogo m on m.caso_id = c.caso_id
                  where h.anulado_en is null and c.anulado_en is null) as hitos`,
      ),
      client.query<IndicadorConteo>(
        `select replace(ec.codigo, '_', ' ') as clave,
                count(*)::int as total
           from core.compromisos c
           join core.mesas_dialogo m on m.caso_id = c.caso_id
           left join core.cat_estados_compromiso ec on ec.id = c.estado_id
          where c.anulado_en is null
          group by 1
          order by total desc, clave`,
      ),
      client.query<IndicadorMesa>(
        `select m.codigo,
                m.titulo,
                count(c.id)::int as total,
                (count(*) filter (where ec.codigo = 'Cumplido'))::int as cumplidos
           from core.mesas_dialogo m
           join core.compromisos c
             on c.caso_id = m.caso_id and c.anulado_en is null
           left join core.cat_estados_compromiso ec on ec.id = c.estado_id
          group by m.codigo, m.titulo
          order by total desc, m.codigo
          limit 8`,
      ),
      client.query<IndicadorConteo>(
        `select replace(eh.codigo, '_', ' ') as clave,
                count(*)::int as total
           from core.hitos_compromiso h
           join core.compromisos c on c.id = h.compromiso_id
           join core.mesas_dialogo m on m.caso_id = c.caso_id
           left join core.cat_estados_hito eh on eh.id = h.estado_id
          where h.anulado_en is null and c.anulado_en is null
          group by 1
          order by total desc, clave`,
      ),
    ]);

    compromisos = Number(totales.rows[0]?.compromisos ?? 0);
    hitos = Number(totales.rows[0]?.hitos ?? 0);
    compromisosEstado = porEstado.rows;
    compromisosPorMesa = porMesa.rows.map((fila) => ({
      codigo: fila.codigo,
      titulo: fila.titulo,
      total: Number(fila.total ?? 0),
      cumplidos: Number(fila.cumplidos ?? 0),
    }));
    hitosEstado = porHito.rows;
  }

  return {
    vinculoDisponible: vinculo,
    totales: {
      mesas: Number(base.rows[0]?.mesas ?? 0),
      miembros: Number(base.rows[0]?.miembros ?? 0),
      compromisos,
      hitos,
    },
    vigencia: vigencia.rows.map((fila) => ({
      clave: fila.clave,
      total: Number(fila.total ?? 0),
    })),
    naturaleza: naturaleza.rows.map((fila) => ({
      clave: fila.clave,
      total: Number(fila.total ?? 0),
    })),
    departamentos: contarDepartamentos(ambitos.rows.map((fila) => fila.ambito)),
    compromisosEstado,
    compromisosPorMesa,
    hitosEstado,
  };
}
