"""Fase 9 — demandas, sus evidencias y sus actores.

Fuentes (posiciones verificadas, nunca por cabecera):

* `DIM_Demandas` (325)             -> `core.demandas`
* `BRIDGE_Alerta_Demandas` (231)   -> refuerza el vínculo alerta↔demanda
* `DIM_Demandas.Tipo_Evidencia_*`  -> `core.demandas_evidencias` (77)
* `DIM_Demandas.ID_ORGANIZACION`   -> `core.demandas_actores` (98)

Decisiones que esta fase aplica:

* **D44.** `ID_ALERTA` no contiene sólo alertas: 236 `AT-` (→ `alerta_id`),
  5 `RR-2026-01` (→ `documento_origen_id`), 6 `CS-2026-xx` y 1 `TEMA-03`
  (→ `codigo_padre_legado`). No se fuerza ningún match entre series (D19).
* **D31.** La columna denormalizada y `BRIDGE_Alerta_Demandas` no coinciden: se
  unen con `union_alerta_demanda`; el bridge gana en los conflictos. Resultado
  verificado: **222** demandas con alerta existente.
* **Formato de alerta.** `DIM_Alertas` usa 2 dígitos (`AT-2026-01`), pero los
  bridges mezclan 2 y 3; se canoniza con `canon_alerta`.
* **D1.** `ID_Caso` se resuelve cuando el código existe (99 de 325); el resto
  queda NULL.
* **3P.** `problema_3p`, `propuesta_3p` y `pedido_3p` quedan NULL: el legado no
  trae la estructura y no se fabrica (parche 1 los relajó).
* `ID_TEMATICA` incluye un timestamp (`2026-09-18 14:05:58`): sólo se resuelve
  si coincide con un código `TEMA-xx`; el resto queda NULL.
"""

from __future__ import annotations

import re
from datetime import date

from ...decisions import (
    canon_alerta,
    clasificar_padre_demanda,
    norm_key,
    parse_fecha,
    union_alerta_demanda,
)
from .. import legacy
from ..context import LoadContext

NUMBER = 9
NAME = "Demandas + evidencias"

_ORIGEN = "AVISA_HISTORICO"

# -- DIM_Demandas -------------------------------------------------------------
_D_CODIGO = 1
_D_DESCRIPCION = 2
_D_ORGANIZACION = 3
_D_CASO = 4
_D_ALERTA = 5
_D_TEMATICA = 6
_D_FECHA = 7
_D_TIPO_EVIDENCIA = 8
_D_LINK_EVIDENCIA = 9

# -- BRIDGE_Alerta_Demandas ---------------------------------------------------
_BD_ALERTA = 3
_BD_DEMANDA = 5

_FUENTE_EVIDENCIA = {
    norm_key("Hecho Ocurrido"): "Institucional",
    norm_key("Publicaciones o Redes Sociales"): "Medios",
}

_RE_SUFIJO = re.compile(r"^(.*)-(\d+)$")


def _fecha(valor: str | None) -> date | None:
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


def _recorta(valor: str | None, limite: int) -> str | None:
    return valor[:limite] if valor else None


async def _actores_por_codigo(ctx: LoadContext) -> dict[str, str]:
    """`ORG-xxx`/`ACT-xxx` -> actor_uid (tolera los sufijos de D41)."""
    filas = await ctx.conn.fetch(
        "SELECT actor_uid, codigo_legado FROM core.actores "
        "WHERE codigo_legado IS NOT NULL"
    )
    mapa: dict[str, str] = {}
    for fila in filas:
        mapa.setdefault(fila["codigo_legado"], fila["actor_uid"])
    for fila in filas:
        m = _RE_SUFIJO.match(fila["codigo_legado"])
        if m:
            mapa.setdefault(m.group(1), fila["actor_uid"])
    return mapa


async def _alertas_por_codigo(ctx: LoadContext) -> dict[str, str]:
    """Código canónico (y `-bis`) -> id. El primer duplicado gana."""
    filas = await ctx.conn.fetch("SELECT id, codigo_alerta FROM core.alertas_tempranas")
    mapa: dict[str, str] = {}
    for fila in filas:
        if not fila["codigo_alerta"].endswith("-bis"):
            mapa[fila["codigo_alerta"]] = fila["id"]
    for fila in filas:
        mapa.setdefault(fila["codigo_alerta"], fila["id"])
    return mapa


async def _indices(ctx: LoadContext) -> dict:
    return {
        "casos": {
            fila["codigo_caso"]: fila["id"]
            for fila in await ctx.conn.fetch("SELECT id, codigo_caso FROM core.casos")
        },
        "tematicas": {
            fila["codigo_legado"]: fila["id"]
            for fila in await ctx.conn.fetch(
                "SELECT id, codigo_legado FROM core.cat_tematicas"
            )
            if fila["codigo_legado"]
        },
        "alertas": await _alertas_por_codigo(ctx),
        "documentos": {
            fila["codigo"]: fila["id"]
            for fila in await ctx.conn.fetch(
                "SELECT id, codigo FROM core.documentos WHERE codigo IS NOT NULL"
            )
        },
        "actores": await _actores_por_codigo(ctx),
    }


def _pares_alerta(
    ctx: LoadContext, idx: dict
) -> tuple[dict[str, str], dict[str, tuple[str, str]], set[tuple[str, str]]]:
    """Une la columna denormalizada con el bridge (D31/D44).

    Devuelve `(alerta_por_demanda, padre_por_demanda, descartados)`.
    """
    demandas = legacy.sheet_of(ctx.sheets, "DIM_Demandas")
    pares_columna: set[tuple[str, str]] = set()
    padre: dict[str, tuple[str, str]] = {}

    for indice in range(demandas.filas):
        codigo = demandas.cell(indice, _D_CODIGO)
        crudo = demandas.cell(indice, _D_ALERTA)
        tipo = clasificar_padre_demanda(crudo)
        if tipo == "alerta":
            pares_columna.add((codigo, canon_alerta(crudo)))
        elif tipo in ("caso", "reporte", "basura"):
            padre[codigo] = (tipo, crudo)

    bridge = legacy.sheet_of(ctx.sheets, "BRIDGE_Alerta_Demandas")
    pares_bridge: set[tuple[str, str]] = set()
    for indice in range(bridge.filas):
        demanda = bridge.cell(indice, _BD_DEMANDA)
        alerta = canon_alerta(bridge.cell(indice, _BD_ALERTA))
        if demanda and alerta:
            pares_bridge.add((demanda, alerta))

    asignados, descartados, _stats = union_alerta_demanda(
        pares_columna, pares_bridge, set(idx["alertas"])
    )
    alerta_por_demanda = {demanda: alerta for demanda, alerta in asignados}
    return alerta_por_demanda, padre, descartados


async def _demandas(ctx: LoadContext, idx: dict) -> dict[str, str]:
    """Inserta las 325 demandas. Devuelve {código legado -> id}."""
    demandas = legacy.sheet_of(ctx.sheets, "DIM_Demandas")
    alerta_por_demanda, padre, descartados = _pares_alerta(ctx, idx)

    for demanda, alerta in sorted(descartados):
        await ctx.conflicto(
            "ALERTA_INEXISTENTE",
            hoja="BRIDGE_Alerta_Demandas",
            codigo=demanda,
            detalle={"alerta": alerta},
        )

    ids: dict[str, str] = {}
    for indice in range(demandas.filas):
        codigo = demandas.cell(indice, _D_CODIGO)
        if not codigo:
            raise ValueError(f"DIM_Demandas fila {indice + 1}: falta ID_DEMANDA")

        caso_codigo = demandas.cell(indice, _D_CASO)
        codigo_alerta = alerta_por_demanda.get(codigo)
        padre_tipo, padre_valor = padre.get(codigo, (None, None))

        documento_id = None
        codigo_padre = None
        if padre_tipo == "reporte":
            documento_id = idx["documentos"].get(padre_valor)
            if documento_id is None:
                codigo_padre = padre_valor
        elif padre_tipo in ("caso", "basura"):
            codigo_padre = padre_valor

        demanda_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.demandas
                (codigo_legado, descripcion_demanda, caso_id, alerta_id,
                 tematica_id, fecha_registro, tipo_evidencia_legado,
                 referencia_evidencia_legado, codigo_padre_legado,
                 documento_origen_id, origen_dato, confidence,
                 es_validado_humano, nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1.00, TRUE, 2)
            RETURNING id
            """,
            codigo,
            demandas.cell(indice, _D_DESCRIPCION),
            idx["casos"].get(caso_codigo) if caso_codigo else None,
            idx["alertas"].get(codigo_alerta) if codigo_alerta else None,
            idx["tematicas"].get(demandas.cell(indice, _D_TEMATICA)),
            _fecha(demandas.cell(indice, _D_FECHA)),
            _recorta(demandas.cell(indice, _D_TIPO_EVIDENCIA), 80),
            _recorta(demandas.cell(indice, _D_LINK_EVIDENCIA), 255),
            codigo_padre,
            documento_id,
            _ORIGEN,
        )
        ctx.add("core.demandas")
        ids[codigo] = demanda_id
    return ids


async def _evidencias(ctx: LoadContext, ids: dict[str, str]) -> None:
    """`core.demandas_evidencias`: sólo las 77 demandas con tipo de evidencia."""
    demandas = legacy.sheet_of(ctx.sheets, "DIM_Demandas")
    for indice in range(demandas.filas):
        tipo = demandas.cell(indice, _D_TIPO_EVIDENCIA)
        if not tipo:
            continue
        demanda_id = ids.get(demandas.cell(indice, _D_CODIGO))
        if demanda_id is None:
            continue
        fuente = _FUENTE_EVIDENCIA.get(norm_key(tipo), "Institucional")
        await ctx.conn.execute(
            """
            INSERT INTO core.demandas_evidencias
                (demanda_id, fuente_tipo, url_referencia, fecha_incorporacion)
            VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE))
            """,
            demanda_id,
            fuente,
            _recorta(demandas.cell(indice, _D_LINK_EVIDENCIA), 500),
            _fecha(demandas.cell(indice, _D_FECHA)),
        )
        ctx.add("core.demandas_evidencias")


async def _actores_demanda(ctx: LoadContext, idx: dict, ids: dict[str, str]) -> None:
    """`core.demandas_actores`: 98 demandas con organización formuladora."""
    demandas = legacy.sheet_of(ctx.sheets, "DIM_Demandas")
    for indice in range(demandas.filas):
        organizacion = demandas.cell(indice, _D_ORGANIZACION)
        if not organizacion:
            continue
        demanda_id = ids.get(demandas.cell(indice, _D_CODIGO))
        actor_uid = idx["actores"].get(organizacion)
        if demanda_id is None or actor_uid is None:
            continue
        await ctx.conn.execute(
            """
            INSERT INTO core.demandas_actores (demanda_id, actor_id, rol_en_demanda)
            VALUES ($1, $2, 'Formulador')
            ON CONFLICT DO NOTHING
            """,
            demanda_id,
            actor_uid,
        )
        ctx.add("core.demandas_actores")


async def run(ctx: LoadContext) -> None:
    idx = await _indices(ctx)
    ids = await _demandas(ctx, idx)
    await _evidencias(ctx, ids)
    await _actores_demanda(ctx, idx, ids)
