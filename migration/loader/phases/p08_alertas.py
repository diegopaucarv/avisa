"""Fase 8 — alertas tempranas, sus actores, sus especies y sus vínculos.

Fuentes (posiciones verificadas, nunca por cabecera):

* `DIM_Alertas` (83)              -> `core.alertas_tempranas`
* `BRIDGE_Alerta_Actor` (162)     -> `core.alertas_actores`
* `BRIDGE_Alerta_ActorEstado` (5) -> `core.alertas_actores`
* `BRIDGE_Alerta_Recurso` (32)    -> `core.alerta_especies`
* `FACT_Hechos_Casos.ID_Alerta`   -> `core.cronologia_vinculos` (3 códigos)

Detalles del origen que esta fase resuelve:

* **Códigos de alerta con dos rellenos.** `DIM_Alertas` los escribe a dos
  dígitos (`AT-2026-01`) y `BRIDGE_Alerta_Actor` mezcla 143 de 2 dígitos con 16
  de 3 (`AT-2026-001`). Se canoniza a dos dígitos antes de resolver.
* **Tres filas de `BRIDGE_Alerta_Actor` con las columnas invertidas**
  (`c02 = ACT-007`, `c03 = AT-2026-26`). Se detecta y se intercambian.
* **Alertas fantasma.** Los bridges citan `AT-2026-19`, `AT-2026-24`,
  `AT-2026-27`, `AT-2026-34` y `AT-2026-39`, que **no existen** en
  `DIM_Alertas`. No se inventan: el vínculo se descarta y se encola como
  `ALERTA_INEXISTENTE`.
* **Duplicados `AT-2026-48` y `AT-2026-49`** (D32): la segunda aparición se
  sufija `-bis` en `codigo_alerta`/`codigo_legado`.
* **D47.** Dos alertas (`AT-2026-59`, `AT-2026-80`) no traen `ID_NIVEL_ALERTA`:
  `prioridad_id` y `nivel_alerta_id` quedan NULL.
* `ID_Ubigeo` es un departamento (`DEP-xx`): el distrito sale de `ID_Distrito`
  (`DIS-xxxx`); si falta, queda NULL. `ID_NIVEL_ALERTA` alimenta tanto
  `nivel_alerta_id` como `prioridad_id` (es la misma escala de 4).
"""

from __future__ import annotations

import json
import re
from datetime import date

from ...decisions import (
    canon_alerta,
    distrito_ubigeo,
    map_prioridad_alerta,
    parse_fecha,
)
from .. import legacy
from ..context import LoadContext

NUMBER = 8
NAME = "Alertas + especies + vínculos"

_ORIGEN = "AVISA_HISTORICO"

# -- DIM_Alertas --------------------------------------------------------------
_AL_CODIGO = 1
_AL_CASO = 2
_AL_SECTORISTA = 3
_AL_FECHA = 4
_AL_DISTRITO = 8
_AL_TITULO = 10
_AL_SECTOR = 11
_AL_SITUACION = 12
_AL_HECHOS = 13
_AL_NIVEL = 14
_AL_RIESGO = 15
_AL_DESC_RIESGO = 16
_AL_ACCIONES_SUG = 17
_AL_ACCIONES_OAIPCS = 18
_AL_PASO = 19
_AL_FECHA_VALIDACION = 20
_AL_FECHA_REMISION = 21
_AL_ESTADO = 27
_AL_FUENTE_TIPO = 28
_AL_FUENTE_DESC = 29
_AL_FUENTE_URL = 30
_AL_MESA = 31

# -- bridges de alerta --------------------------------------------------------
_BA_ALERTA = 2
_BA_ACTOR = 3
_BR_RECURSO = 2
_BR_ALERTA = 3

# -- FACT_Hechos_Casos --------------------------------------------------------
_H_CODIGO = 1
_H_ALERTA = 10

_RE_SUFIJO = re.compile(r"^(.*)-(\d+)$")


def _fecha(valor: str | None) -> date | None:
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


def _entero(valor: str | None) -> int | None:
    if valor is None:
        return None
    limpio = valor.strip()
    if limpio.endswith(".0"):
        limpio = limpio[:-2]
    return int(limpio) if limpio.isdigit() else None


def _recorta(valor: str | None, limite: int) -> str | None:
    return valor[:limite] if valor else None


def _json(valor) -> str:
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, default=str)


async def _distritos_por_codigo(ctx: LoadContext) -> dict[str, int]:
    """`DIS-xxxx` -> id de `core.distritos` (resuelto por ubigeo INEI)."""
    ids = {
        fila["ubigeo"]: fila["id"]
        for fila in await ctx.conn.fetch("SELECT id, ubigeo FROM core.distritos")
    }
    sheet = legacy.sheet_of(ctx.sheets, "DIM_Distritos")
    mapa: dict[str, int] = {}
    for indice in range(sheet.filas):
        codigo = sheet.cell(indice, 1)
        ubigeo = sheet.cell(indice, 2)
        if codigo and ubigeo:
            distrito = ids.get(distrito_ubigeo(ubigeo))
            if distrito is not None:
                mapa[codigo] = distrito
    return mapa


async def _actores_por_codigo(ctx: LoadContext) -> dict[str, str]:
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


async def _indices(ctx: LoadContext) -> dict:
    return {
        "casos": {
            fila["codigo_caso"]: fila["id"]
            for fila in await ctx.conn.fetch("SELECT id, codigo_caso FROM core.casos")
        },
        "usuarios": {
            fila["codigo_legado"]: fila["id"]
            for fila in await ctx.conn.fetch(
                "SELECT id, codigo_legado FROM core.usuarios "
                "WHERE codigo_legado IS NOT NULL"
            )
        },
        "subsectores": {
            fila["codigo_legado"]: fila["id"]
            for fila in await ctx.conn.fetch(
                "SELECT id, codigo_legado FROM core.cat_subsectores"
            )
            if fila["codigo_legado"]
        },
        # `DIM_Alertas.ID_Sector` guarda el código de ÁREA (`AR-00x`), no el de
        # sector: parche 2 añadió `id_area_legado` justo para esto.
        "areas": {
            fila["id_area_legado"]: fila["id"]
            for fila in await ctx.conn.fetch(
                "SELECT id, id_area_legado FROM core.cat_subsectores"
            )
            if fila["id_area_legado"]
        },
        "distritos": await _distritos_por_codigo(ctx),
        "especies": {
            fila["codigo_legado"]: fila["id"]
            for fila in await ctx.conn.fetch(
                "SELECT id, codigo_legado FROM core.cat_especies "
                "WHERE codigo_legado IS NOT NULL"
            )
        },
        "actores": await _actores_por_codigo(ctx),
    }


async def _alertas(ctx: LoadContext, idx: dict) -> dict[str, str]:
    """Inserta las 83 alertas. Devuelve {código canónico/sufijado -> id}."""
    alertas = legacy.sheet_of(ctx.sheets, "DIM_Alertas")
    usados: dict[str, int] = {}
    ids: dict[str, str] = {}

    for indice in range(alertas.filas):
        codigo = canon_alerta(alertas.cell(indice, _AL_CODIGO))
        fecha = _fecha(alertas.cell(indice, _AL_FECHA))
        if not codigo or fecha is None:
            raise ValueError(
                f"DIM_Alertas fila {indice + 1}: falta código o fecha válida"
            )

        usados[codigo] = usados.get(codigo, 0) + 1
        codigo_unico = codigo if usados[codigo] == 1 else f"{codigo}-bis"

        caso_codigo = alertas.cell(indice, _AL_CASO)
        sectorista = alertas.cell(indice, _AL_SECTORISTA)
        distrito = alertas.cell(indice, _AL_DISTRITO)
        sector = alertas.cell(indice, _AL_SECTOR)
        nivel = alertas.cell(indice, _AL_NIVEL)
        riesgo = alertas.cell(indice, _AL_RIESGO)
        acciones = alertas.cell(indice, _AL_ACCIONES_SUG)
        mesa = alertas.cell(indice, _AL_MESA)

        # `nivel_alerta_id` y `prioridad_id` comparten la escala NA-001..NA-004.
        nivel_id = map_prioridad_alerta(nivel)

        alerta_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.alertas_tempranas (
                codigo_alerta, codigo_legado, caso_id, prioridad_id,
                fecha_reporte, situacion_actual, riesgos_json,
                acciones_sugeridas_json, titulo, nivel_alerta_id,
                descripcion_riesgo, hechos_recientes, acciones_oaipcs,
                paso_actual, fecha_validacion, fecha_remision, estado_legado,
                fuente_tipo, fuente_descripcion, fuente_url, distrito_id,
                sectorista_usuario_id, mesa_id, subsector_id,
                origen_dato, confidence, es_validado_humano, nivel_clasificacion)
            VALUES ($1, $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9,
                    $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, 1.00, TRUE, 2)
            RETURNING id
            """,
            codigo_unico,
            idx["casos"].get(caso_codigo) if caso_codigo else None,
            nivel_id,
            fecha,
            alertas.cell(indice, _AL_SITUACION),
            _json({"codigo_legado": riesgo}) if riesgo else "{}",
            _json({"texto": acciones}) if acciones else "{}",
            _recorta(alertas.cell(indice, _AL_TITULO), 500),
            nivel_id,
            alertas.cell(indice, _AL_DESC_RIESGO),
            alertas.cell(indice, _AL_HECHOS),
            alertas.cell(indice, _AL_ACCIONES_OAIPCS),
            _entero(alertas.cell(indice, _AL_PASO)),
            _fecha(alertas.cell(indice, _AL_FECHA_VALIDACION)),
            _fecha(alertas.cell(indice, _AL_FECHA_REMISION)),
            _recorta(alertas.cell(indice, _AL_ESTADO), 40),
            _recorta(alertas.cell(indice, _AL_FUENTE_TIPO), 120),
            alertas.cell(indice, _AL_FUENTE_DESC),
            _recorta(alertas.cell(indice, _AL_FUENTE_URL), 500),
            idx["distritos"].get(distrito) if distrito else None,
            idx["usuarios"].get(sectorista) if sectorista else None,
            None,  # ID_MESA_GRUPO viene vacío en las 83 alertas
            idx["areas"].get(sector) if sector else None,
            _ORIGEN,
        )
        ctx.add("core.alertas_tempranas")
        ids[codigo_unico] = alerta_id
        ids.setdefault(codigo, alerta_id)

    return ids


async def _alerta_actores(ctx: LoadContext, idx: dict, alertas: dict[str, str]) -> None:
    """`core.alertas_actores` con corrección de columnas invertidas."""
    vistas: set[tuple[str, str]] = set()
    for hoja in ("BRIDGE_Alerta_Actor", "BRIDGE_Alerta_ActorEstado"):
        sheet = legacy.sheet_of(ctx.sheets, hoja)
        for indice in range(sheet.filas):
            primero = sheet.cell(indice, _BA_ALERTA)
            segundo = sheet.cell(indice, _BA_ACTOR)

            # 3 filas de BRIDGE_Alerta_Actor traen actor y alerta al revés.
            if primero and primero.startswith("ACT-"):
                actor_codigo, alerta_cruda = primero, segundo
            else:
                alerta_cruda, actor_codigo = primero, segundo

            codigo = canon_alerta(alerta_cruda)
            alerta_id = alertas.get(codigo) if codigo else None
            if alerta_id is None:
                await ctx.conflicto(
                    "ALERTA_INEXISTENTE",
                    hoja=hoja,
                    fila=indice + 1,
                    codigo=codigo,
                    detalle={"actor": actor_codigo},
                )
                continue

            actor_uid = idx["actores"].get(actor_codigo) if actor_codigo else None
            if actor_uid is None:
                continue

            clave = (alerta_id, actor_uid)
            if clave in vistas:
                continue
            vistas.add(clave)
            await ctx.conn.execute(
                """
                INSERT INTO core.alertas_actores (alerta_id, actor_id)
                VALUES ($1, $2)
                """,
                alerta_id,
                actor_uid,
            )
            ctx.add("core.alertas_actores")


async def _alerta_especies(
    ctx: LoadContext, idx: dict, alertas: dict[str, str]
) -> None:
    """`core.alerta_especies` desde `BRIDGE_Alerta_Recurso` (32)."""
    sheet = legacy.sheet_of(ctx.sheets, "BRIDGE_Alerta_Recurso")
    vistas: set[tuple[str, int]] = set()
    for indice in range(sheet.filas):
        recurso = sheet.cell(indice, _BR_RECURSO)
        codigo = canon_alerta(sheet.cell(indice, _BR_ALERTA))
        alerta_id = alertas.get(codigo) if codigo else None
        especie_id = idx["especies"].get(recurso) if recurso else None
        if alerta_id is None:
            await ctx.conflicto(
                "ALERTA_INEXISTENTE",
                hoja="BRIDGE_Alerta_Recurso",
                fila=indice + 1,
                codigo=codigo,
                detalle={"recurso": recurso},
            )
            continue
        if especie_id is None:
            continue
        clave = (alerta_id, especie_id)
        if clave in vistas:
            continue
        vistas.add(clave)
        await ctx.conn.execute(
            """
            INSERT INTO core.alerta_especies (alerta_id, especie_id)
            VALUES ($1, $2)
            """,
            alerta_id,
            especie_id,
        )
        ctx.add("core.alerta_especies")


async def _vinculos_alerta(ctx: LoadContext, alertas: dict[str, str]) -> None:
    """Los 3 vínculos hecho↔alerta de `FACT_Hechos_Casos.ID_Alerta`."""
    cronologias = {
        fila["codigo_legado"]: fila["id"]
        for fila in await ctx.conn.fetch(
            "SELECT id, codigo_legado FROM core.caso_cronologia "
            "WHERE codigo_legado IS NOT NULL"
        )
    }
    hechos = legacy.sheet_of(ctx.sheets, "FACT_Hechos_Casos")
    vistas: set[tuple[str, str]] = set()
    for indice in range(hechos.filas):
        crudo = hechos.cell(indice, _H_ALERTA)
        if not crudo or not crudo.startswith("AT-"):
            # 2 filas traen una URL en esa columna: no son alertas.
            continue
        codigo_hecho = hechos.cell(indice, _H_CODIGO)
        alerta_id = alertas.get(canon_alerta(crudo))
        cronologia_id = cronologias.get(codigo_hecho)
        if alerta_id is None or cronologia_id is None:
            continue
        clave = (cronologia_id, alerta_id)
        if clave in vistas:
            continue
        vistas.add(clave)
        await ctx.conn.execute(
            """
            INSERT INTO core.cronologia_vinculos (cronologia_id, alerta_id)
            VALUES ($1, $2)
            """,
            cronologia_id,
            alerta_id,
        )
        ctx.add("core.cronologia_vinculos")


async def run(ctx: LoadContext) -> None:
    idx = await _indices(ctx)
    alertas = await _alertas(ctx, idx)
    await _alerta_actores(ctx, idx, alertas)
    await _alerta_especies(ctx, idx, alertas)
    await _vinculos_alerta(ctx, alertas)
