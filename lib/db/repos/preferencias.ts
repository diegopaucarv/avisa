import type { PoolClient } from "pg";

import { ApiError } from "../errors";

/**
 * Preferencias por usuario (`core.usuario_preferencia`, migración 49).
 *
 * La tabla es clave-valor con `valor jsonb`: una fila por preferencia y
 * usuario. La RLS (migración 62) exige que `usuario_id` coincida con
 * `current_setting('app.usuario_id')`, así que la sesión nunca puede leer ni
 * escribir las preferencias de otra persona.
 *
 * Contrato de claves:
 *  · `tamanoPagina` — entero 1–100 (el mismo tope que `leerPagina`).
 *  · `tema`         — `claro` | `oscuro` | `auto`.
 *  · `densidad`     — `comoda` | `compacta`.
 *  · `zonaHoraria`  — zona IANA; AVISA usa `America/Lima`.
 *  · `columnas<Entidad>` — JSON con las columnas visibles de una lista
 *    (`columnasCasos`, `columnasActores`, …). Arreglo de claves u objeto de
 *    banderas; se guarda tal cual.
 *
 * Un `PATCH` con valor `null` borra la fila: la preferencia vuelve al defecto
 * del cliente. No se siembran filas vacías.
 */

export const CLAVES_FIJAS = [
  "tamanoPagina",
  "tema",
  "densidad",
  "zonaHoraria",
] as const;

export type ClaveFija = (typeof CLAVES_FIJAS)[number];

export const TEMAS = ["claro", "oscuro", "auto"] as const;
export const DENSIDADES = ["comoda", "compacta"] as const;
export const TAMANO_PAGINA_MIN = 1;
export const TAMANO_PAGINA_MAX = 100;

/** Un `PATCH` no puede traer la tabla entera: 40 claves es de sobra. */
const MAX_CLAVES_POR_PATCH = 40;
/** Tope del JSON de `columnas<Entidad>`; una lista no tiene más columnas. */
const MAX_BYTES_COLUMNAS = 8 * 1024;
const MAX_COLUMNAS = 200;

const CLAVE_COLUMNAS = /^columnas[A-Z][A-Za-z0-9]{0,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreferenciasUsuario = {
  preferencias: Record<string, unknown>;
  /** Instante de la última escritura o `null` si el usuario no tiene ninguna. */
  actualizadoEn: string | null;
};

type FilaPreferencia = {
  clave: string;
  valor: unknown;
  actualizado_en: Date | string | null;
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** `true` si la clave es una de las fijas o sigue el patrón `columnas<Entidad>`. */
export function esClavePreferencia(clave: string): boolean {
  return (
    (CLAVES_FIJAS as readonly string[]).includes(clave) ||
    CLAVE_COLUMNAS.test(clave)
  );
}

function zonaHorariaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat("es-PE", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

function tamanoValido(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= TAMANO_PAGINA_MIN &&
    valor <= TAMANO_PAGINA_MAX
  );
}

function validarColumnas(clave: string, valor: unknown): void {
  if (Array.isArray(valor)) {
    if (valor.length > MAX_COLUMNAS) {
      throw new ApiError(
        422,
        `«${clave}» admite como máximo ${MAX_COLUMNAS} columnas.`,
        "VALOR_INVALIDO",
      );
    }
    if (!valor.every((item) => typeof item === "string")) {
      throw new ApiError(
        422,
        `«${clave}» debe ser una lista de claves de columna.`,
        "VALOR_INVALIDO",
      );
    }
  } else if (esRegistro(valor)) {
    const entradas = Object.entries(valor);
    if (entradas.length > MAX_COLUMNAS) {
      throw new ApiError(
        422,
        `«${clave}» admite como máximo ${MAX_COLUMNAS} columnas.`,
        "VALOR_INVALIDO",
      );
    }
    for (const [, bandera] of entradas) {
      const tipo = typeof bandera;
      if (tipo !== "boolean" && tipo !== "string" && tipo !== "number") {
        throw new ApiError(
          422,
          `«${clave}» debe guardar banderas o nombres de columna.`,
          "VALOR_INVALIDO",
        );
      }
    }
  } else {
    throw new ApiError(
      422,
      `«${clave}» debe ser una lista u objeto JSON de columnas.`,
      "VALOR_INVALIDO",
    );
  }

  const serializado = JSON.stringify(valor);
  if (serializado.length > MAX_BYTES_COLUMNAS) {
    throw new ApiError(
      422,
      `«${clave}» supera el tamaño permitido para una preferencia.`,
      "VALOR_INVALIDO",
    );
  }
}

function validarValor(clave: string, valor: unknown): void {
  if (!esClavePreferencia(clave)) {
    throw new ApiError(
      422,
      `La preferencia «${clave}» no existe. Claves admitidas: ${CLAVES_FIJAS.join(
        ", ",
      )} y columnas<Entidad>.`,
      "CLAVE_INVALIDA",
    );
  }

  switch (clave as ClaveFija) {
    case "tamanoPagina":
      if (!tamanoValido(valor)) {
        throw new ApiError(
          422,
          `«tamanoPagina» debe ser un entero entre ${TAMANO_PAGINA_MIN} y ${TAMANO_PAGINA_MAX}.`,
          "VALOR_INVALIDO",
        );
      }
      return;
    case "tema":
      if (!(TEMAS as readonly unknown[]).includes(valor)) {
        throw new ApiError(
          422,
          "«tema» admite claro, oscuro o auto.",
          "VALOR_INVALIDO",
        );
      }
      return;
    case "densidad":
      if (!(DENSIDADES as readonly unknown[]).includes(valor)) {
        throw new ApiError(
          422,
          "«densidad» admite comoda o compacta.",
          "VALOR_INVALIDO",
        );
      }
      return;
    case "zonaHoraria":
      if (typeof valor !== "string" || !zonaHorariaValida(valor.trim())) {
        throw new ApiError(
          422,
          "«zonaHoraria» debe ser una zona horaria IANA (por ejemplo, America/Lima).",
          "VALOR_INVALIDO",
        );
      }
      return;
    default:
      validarColumnas(clave, valor);
  }
}

function aIso(fila: FilaPreferencia): string | null {
  if (fila.actualizado_en === null) return null;
  return fila.actualizado_en instanceof Date
    ? fila.actualizado_en.toISOString()
    : String(fila.actualizado_en);
}

function aResultado(filas: readonly FilaPreferencia[]): PreferenciasUsuario {
  const preferencias: Record<string, unknown> = {};
  let actualizadoEn: string | null = null;

  for (const fila of filas) {
    preferencias[fila.clave] = fila.valor;
    const instante = aIso(fila);
    if (instante && (!actualizadoEn || instante > actualizadoEn)) {
      actualizadoEn = instante;
    }
  }

  return { preferencias, actualizadoEn };
}

function asegurarUsuario(usuarioId: string): void {
  if (!UUID.test(usuarioId)) {
    throw new ApiError(401, "Sesión no válida.", "NO_SESSION");
  }
}

/** Preferencias del usuario de la sesión. */
export async function listarPreferencias(
  client: PoolClient,
  usuarioId: string,
): Promise<PreferenciasUsuario> {
  asegurarUsuario(usuarioId);

  const { rows } = await client.query<FilaPreferencia>(
    `select clave, valor, updated_at as actualizado_en
       from core.usuario_preferencia
      where usuario_id = $1::uuid
      order by clave`,
    [usuarioId],
  );

  return aResultado(rows);
}

/**
 * Guarda un lote de preferencias y devuelve el estado completo del usuario.
 *
 * Se valida antes de escribir: si una clave es inválida, no se aplica ninguna.
 * `null` borra la fila (vuelve al defecto).
 */
export async function guardarPreferencias(
  client: PoolClient,
  usuarioId: string,
  cambios: Record<string, unknown>,
): Promise<PreferenciasUsuario> {
  asegurarUsuario(usuarioId);

  const entradas = Object.entries(cambios);
  if (entradas.length === 0) {
    throw new ApiError(
      400,
      "No hay preferencias que guardar.",
      "SIN_CAMBIOS",
    );
  }
  if (entradas.length > MAX_CLAVES_POR_PATCH) {
    throw new ApiError(
      422,
      `Un guardado admite como máximo ${MAX_CLAVES_POR_PATCH} preferencias.`,
      "DEMASIADAS_CLAVES",
    );
  }

  for (const [clave, valor] of entradas) {
    if (valor === null) {
      if (!esClavePreferencia(clave)) {
        throw new ApiError(
          422,
          `La preferencia «${clave}» no existe.`,
          "CLAVE_INVALIDA",
        );
      }
      continue;
    }
    validarValor(clave, valor);
  }

  for (const [clave, valor] of entradas) {
    if (valor === null) {
      await client.query(
        `delete from core.usuario_preferencia
          where usuario_id = $1::uuid and clave = $2`,
        [usuarioId, clave],
      );
      continue;
    }

    await client.query(
      `insert into core.usuario_preferencia (usuario_id, clave, valor, updated_at)
       values ($1::uuid, $2, $3::jsonb, now())
       on conflict (usuario_id, clave) do update
         set valor = excluded.valor,
             updated_at = now()`,
      [usuarioId, clave, JSON.stringify(valor)],
    );
  }

  return listarPreferencias(client, usuarioId);
}
