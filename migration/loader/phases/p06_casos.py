"""Fase 6 — casos, su territorio y sus actores.

Fuentes (posiciones verificadas contra el workbook, nunca por cabecera):

* `FACT_Casos` (35)            -> `core.casos`
* `BRIDGE_Caso_Depto` (87)     -> `core.caso_regiones` (85 válidas)
* `FACT_Casos.ID_Distrito`     -> `core.caso_distritos` (23)
* `BRIDGE_Caso_Actor` (80)     -> `core.casos_actores`
  `BRIDGE_Caso_Actor_Estado` (61)

Decisiones que esta fase aplica:

* (a) `nivel_conflicto_id` es `NULL`-able y se toma de `DIM_Tipo_Caso` (decisión
  h): la escala de 4 niveles de la Guía, no una derivación de `ID_Riesgos`.
* (b) `CS-PRODUCE-2026-024` no trae `ID_Tipo`: queda `NULL`, no se rellena.
* D23: las referencias numéricas de los bridges son **ordinales posicionales**
  de `FACT_Casos`; se resuelven con `resolve_case_ref` y se acepta además el
  código largo cuando viene completo.
* D26: `unidad_responsable_id` es `OAIPCS` (la única fila que no sale del
  legado; ver parche 3). `FACT_Casos` no trae área y la columna es NOT NULL.
* D29: `ID_Ubigeo` de `FACT_Casos` es un **departamento** (`DEP-xx`), no un
  distrito. `DEP-20` ("Más de Uno") no es región: 8 casos quedan con
  `region_principal_id` NULL y se completan con `BRIDGE_Caso_Depto`. Su alcance
  ya no se inserta: `core.alcance_caso` lo deriva de las regiones (migración 28).
* D48: `CS-PRODUCE-2026-016` no trae `ID_Riesgos`; se deriva de la moda de
  `ID_Riesgos` de sus alertas vinculadas.

`core.caso_estado_historial` NO se carga: el trigger `core.caso_historial()`
inserta la fila inicial en cada INSERT de `core.casos` (D7). Las 27 filas de
`FACT_Historial_Estado` están corruptas (columnas intercambiadas) y quedan en
`legacy.*` para reconstrucción manual.
"""

from __future__ import annotations

import re
from datetime import date

from ...decisions import (
    boolean_si_no,
    distrito_ubigeo,
    map_nivel_conflicto,
    map_prioridad_caso,
    normalize_pct,
    parse_fecha,
    provincia_ubigeo,
    region_ubigeo_from_provincia,
    resolve_case_ref,
    resolve_nivel_riesgo_caso,
)
from .. import legacy
from ..context import LoadContext

NUMBER = 6
NAME = "Casos + territorios"

# -- FACT_Casos ---------------------------------------------------------------
_C_CODIGO = 1
_C_TIPO = 2
_C_NOMBRE = 3
_C_SECTOR = 4
_C_TEMATICA = 5
_C_FECHA_INICIO = 6
_C_UBIGEO = 7  # DEP-xx (departamento), no distrito
_C_PROVINCIA = 8  # PRO-xxx
_C_DISTRITO = 9  # DIS-xxxx
_C_SECTORISTA = 10  # SEC-xx
_C_PRIORIDAD = 11
_C_INTERVENCION = 12  # Ciclo-00x
_C_PCT = 13
_C_RIESGO = 14
_C_DESC_RIESGO = 15
_C_RESUMEN = 16
_C_FECHA_CIERRE = 20
_C_FECHA_REAPERTURA = 21
_C_N_REAPERTURAS = 22
_C_MOTIVO_CIERRE = 23

# -- DIM_Departamentos --------------------------------------------------------
_DEP_CODIGO = 1
_DEP_ALCANCE = 5

# -- DIM_Provincias / DIM_Distritos ------------------------------------------
_PROV_ID = 1
_PROV_COD_INEI = 2
_PROV_DEPARTAMENTO = 4
_DIS_ID = 1
_DIS_COD_INEI = 2

# -- BRIDGE_Caso_Depto (columnas corridas: ver plan §2.5) ---------------------
_BCD_CASO = 2
_BCD_DEPARTAMENTO = 4
_BCD_PRINCIPAL = 6

# -- DIM_Alertas --------------------------------------------------------------
_AL_CASO = 2
_AL_RIESGO = 15

_ESTADO_ACTIVO = 1
_FUENTE = "avisa_historico"
_ORIGEN = "AVISA_HISTORICO"

# Sufijo de D41: un código repetido se numeró `-2`, `-3`…
_RE_SUFIJO = re.compile(r"^(.*)-(\d+)$")


def _fecha(valor: str | None) -> date | None:
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


def _entero(valor: str | None) -> int:
    if valor is None:
        return 0
    limpio = valor.strip()
    if limpio.endswith(".0"):
        limpio = limpio[:-2]
    return int(limpio) if limpio.isdigit() else 0


async def _mapas_geograficos(ctx: LoadContext) -> dict:
    """Índices de resolución geográfica, todos construidos desde el legado.

    * `region_por_dep`:    DEP-xx -> id de `core.regiones` (DEP-20 ausente).
    * `alcance_por_dep`:   DEP-xx -> id de `core.cat_alcances_geograficos`.
    * `provincia_por_pro`: PRO-xxx -> id de `core.provincias`.
    * `distrito_por_dis`:  DIS-xxxx -> id de `core.distritos`.
    """
    conn = ctx.conn

    provincias = legacy.sheet_of(ctx.sheets, "DIM_Provincias")
    distritos = legacy.sheet_of(ctx.sheets, "DIM_Distritos")
    departamentos = legacy.sheet_of(ctx.sheets, "DIM_Departamentos")

    ids_region = {
        fila["ubigeo"]: fila["id"]
        for fila in await conn.fetch("SELECT id, ubigeo FROM core.regiones")
    }
    ids_provincia = {
        fila["ubigeo"]: fila["id"]
        for fila in await conn.fetch("SELECT id, ubigeo FROM core.provincias")
    }
    ids_distrito = {
        fila["ubigeo"]: fila["id"]
        for fila in await conn.fetch("SELECT id, ubigeo FROM core.distritos")
    }
    ids_alcance = {
        fila["codigo"]: fila["id"]
        for fila in await conn.fetch(
            "SELECT id, codigo FROM core.cat_alcances_geograficos"
        )
    }

    # DEP-xx -> región, derivada SÓLO del prefijo INEI de sus provincias. Es la
    # misma regla de la fase 1 (DEP-15 y DEP-16 se fusionan en '15').
    region_por_dep: dict[str, int] = {}
    provincia_por_pro: dict[str, int] = {}
    for indice in range(provincias.filas):
        dep = provincias.cell(indice, _PROV_DEPARTAMENTO)
        cod = provincias.cell(indice, _PROV_COD_INEI)
        if dep and cod:
            region = ids_region.get(region_ubigeo_from_provincia(cod))
            if region is not None:
                region_por_dep.setdefault(dep, region)
        codigo_pro = provincias.cell(indice, _PROV_ID)
        if codigo_pro and cod:
            provincia = ids_provincia.get(provincia_ubigeo(cod))
            if provincia is not None:
                provincia_por_pro[codigo_pro] = provincia

    distrito_por_dis: dict[str, int] = {}
    for indice in range(distritos.filas):
        codigo_dis = distritos.cell(indice, _DIS_ID)
        cod = distritos.cell(indice, _DIS_COD_INEI)
        if codigo_dis and cod:
            distrito = ids_distrito.get(distrito_ubigeo(cod))
            if distrito is not None:
                distrito_por_dis[codigo_dis] = distrito

    alcance_por_dep: dict[str, int] = {}
    for indice in range(departamentos.filas):
        dep = departamentos.cell(indice, _DEP_CODIGO)
        alcance = departamentos.cell(indice, _DEP_ALCANCE)
        if dep and alcance:
            alcance_id = ids_alcance.get(alcance)
            if alcance_id is not None:
                alcance_por_dep[dep] = alcance_id

    return {
        "region_por_dep": region_por_dep,
        "alcance_por_dep": alcance_por_dep,
        "provincia_por_pro": provincia_por_pro,
        "distrito_por_dis": distrito_por_dis,
    }


async def _riesgo_por_caso(ctx: LoadContext) -> dict[str, list[str]]:
    """{código de caso -> [ID_Riesgos de sus alertas]} para D48."""
    alertas = legacy.sheet_of(ctx.sheets, "DIM_Alertas")
    mapa: dict[str, list[str]] = {}
    for indice in range(alertas.filas):
        caso = alertas.cell(indice, _AL_CASO)
        riesgo = alertas.cell(indice, _AL_RIESGO)
        if caso and riesgo:
            mapa.setdefault(caso.strip(), []).append(riesgo.strip())
    return mapa


async def _ids_catalogo(ctx: LoadContext, tabla: str) -> dict[str, int]:
    """{codigo_legado -> id} de un catálogo de `core` que guarda el código."""
    filas = await ctx.conn.fetch(f"SELECT id, codigo_legado FROM core.{tabla}")
    return {
        fila["codigo_legado"]: fila["id"] for fila in filas if fila["codigo_legado"]
    }


async def _unidad_oaipcs(ctx: LoadContext) -> int:
    """`unidad_responsable_id` (D26): OAIPCS, la única fila no tomada del legado."""
    unidad = await ctx.conn.fetchval(
        "SELECT id FROM core.cat_unidades_organicas WHERE siglas = 'OAIPCS' LIMIT 1"
    )
    if unidad is None:
        raise RuntimeError("no existe la unidad OAIPCS (¿falta el parche 3?)")
    return unidad


async def _usuarios_por_codigo(ctx: LoadContext) -> dict[str, str]:
    filas = await ctx.conn.fetch(
        "SELECT id, codigo_legado FROM core.usuarios WHERE codigo_legado IS NOT NULL"
    )
    return {fila["codigo_legado"]: fila["id"] for fila in filas}


async def _actores_por_codigo(ctx: LoadContext) -> dict[str, str]:
    """{ACT-xxx -> actor_uid}. D41 sufijó los códigos repetidos con `-2`."""
    filas = await ctx.conn.fetch(
        "SELECT actor_uid, codigo_legado FROM core.actores WHERE codigo_legado IS NOT NULL"
    )
    mapa: dict[str, str] = {}
    for fila in filas:
        mapa.setdefault(fila["codigo_legado"], fila["actor_uid"])
    for fila in filas:
        coincidencia = _RE_SUFIJO.match(fila["codigo_legado"])
        if coincidencia:
            mapa.setdefault(coincidencia.group(1), fila["actor_uid"])
    return mapa


async def _casos(ctx: LoadContext, geo: dict) -> list[dict]:
    """Inserta los 35 casos y devuelve su descripción resuelta."""
    casos = legacy.sheet_of(ctx.sheets, "FACT_Casos")
    riesgos_alertas = await _riesgo_por_caso(ctx)
    tematicas = await _ids_catalogo(ctx, "cat_tematicas")
    subsectores = await _ids_catalogo(ctx, "cat_subsectores")
    ciclos = await _ids_catalogo(ctx, "cat_ciclos_intervencion")
    unidad = await _unidad_oaipcs(ctx)
    usuarios = await _usuarios_por_codigo(ctx)

    resueltos: list[dict] = []
    for indice in range(casos.filas):
        codigo = casos.cell(indice, _C_CODIGO)
        nombre = casos.cell(indice, _C_NOMBRE)
        if not codigo or not nombre:
            raise ValueError(
                f"FACT_Casos fila {indice + 1}: faltan ID_Caso o Nombre_Caso"
            )

        fila = indice + 1
        dep = casos.cell(indice, _C_UBIGEO)
        provincia = casos.cell(indice, _C_PROVINCIA)
        distrito = casos.cell(indice, _C_DISTRITO)
        sectorista = casos.cell(indice, _C_SECTORISTA)

        nivel_riesgo, _origen, _conf = resolve_nivel_riesgo_caso(
            casos.cell(indice, _C_RIESGO),
            casos.cell(indice, _C_PRIORIDAD),
            riesgos_alertas.get(codigo, []),
        )
        if nivel_riesgo is None:
            raise RuntimeError(
                f"FACT_Casos fila {fila}: sin nivel de riesgo ni fuente para derivarlo"
            )

        await ctx.conn.execute(
            """
            -- El alcance ya no se almacena: `core.alcance_caso` lo deriva de las
            -- regiones del caso (migración 28).
            INSERT INTO core.casos
                (codigo_caso, nombre_caso, codigo_legado, entidad_id,
                 distrito_principal_id, subsector_id, tematica_id,
                 unidad_responsable_id, punto_focal_usuario_id,
                 nivel_conflicto_id, nivel_riesgo_id, prioridad_id, estado_id,
                 descripcion_riesgo, resumen_ejecutivo,
                 fecha_inicio, fecha_cierre, fecha_reapertura, n_reaperturas,
                 motivo_cierre, pct_avance, ciclo_intervencion_id,
                 region_principal_id, provincia_principal_id,
                 fuente_original, es_seed_historico, origen_dato,
                 confidence, es_validado_humano, nivel_clasificacion)
            VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
                    $24, TRUE, $25, 1.00, TRUE, 2)
            """,
            codigo,
            nombre[:255],
            codigo,
            geo["distrito_por_dis"].get(distrito) if distrito else None,
            subsectores.get(casos.cell(indice, _C_SECTOR)),
            tematicas.get(casos.cell(indice, _C_TEMATICA)),
            unidad,
            usuarios.get(sectorista) if sectorista else None,
            map_nivel_conflicto(casos.cell(indice, _C_TIPO)),
            nivel_riesgo,
            map_prioridad_caso(casos.cell(indice, _C_PRIORIDAD)),
            _ESTADO_ACTIVO,
            casos.cell(indice, _C_DESC_RIESGO),
            casos.cell(indice, _C_RESUMEN),
            _fecha(casos.cell(indice, _C_FECHA_INICIO)),
            _fecha(casos.cell(indice, _C_FECHA_CIERRE)),
            _fecha(casos.cell(indice, _C_FECHA_REAPERTURA)),
            _entero(casos.cell(indice, _C_N_REAPERTURAS)),
            casos.cell(indice, _C_MOTIVO_CIERRE),
            normalize_pct(casos.cell(indice, _C_PCT)),
            ciclos.get(casos.cell(indice, _C_INTERVENCION)),
            geo["region_por_dep"].get(dep) if dep else None,
            geo["provincia_por_pro"].get(provincia) if provincia else None,
            _FUENTE,
            _ORIGEN,
        )
        ctx.add("core.casos")
        resueltos.append(
            {
                "codigo": codigo,
                "fila": fila,
                "dep": dep,
                "distrito": geo["distrito_por_dis"].get(distrito) if distrito else None,
            }
        )
    return resueltos


async def _ids_caso(ctx: LoadContext) -> dict[str, str]:
    filas = await ctx.conn.fetch("SELECT id, codigo_caso FROM core.casos")
    return {fila["codigo_caso"]: fila["id"] for fila in filas}


async def _caso_regiones(ctx: LoadContext, geo: dict, ids_caso: dict[str, str]) -> None:
    """`core.caso_regiones` desde `BRIDGE_Caso_Depto` (85 válidas de 87)."""
    bridge = legacy.sheet_of(ctx.sheets, "BRIDGE_Caso_Depto")
    vistas: set[tuple[str, int]] = set()
    principales: set[str] = set()

    for indice in range(bridge.filas):
        codigo = bridge.cell(indice, _BCD_CASO)
        caso_id = ids_caso.get(codigo) if codigo else None
        if caso_id is None:
            continue
        dep = bridge.cell(indice, _BCD_DEPARTAMENTO)
        region = geo["region_por_dep"].get(dep) if dep else None
        if region is None:
            # DEP-20 no es una región (D28/D29): el vínculo no tiene destino.
            continue

        es_principal = boolean_si_no(
            bridge.cell(indice, _BCD_PRINCIPAL), default_when_null=False
        )
        clave = (caso_id, region)
        if clave in vistas:
            continue
        if es_principal:
            if caso_id in principales:
                # `caso_regiones_un_principal` admite UNA principal por caso.
                es_principal = False
            else:
                principales.add(caso_id)
        vistas.add(clave)
        await ctx.conn.execute(
            """
            INSERT INTO core.caso_regiones (caso_id, region_id, es_principal)
            VALUES ($1, $2, $3)
            """,
            caso_id,
            region,
            es_principal,
        )
        ctx.add("core.caso_regiones")


async def _caso_distritos(
    ctx: LoadContext, resueltos: list[dict], ids_caso: dict[str, str]
) -> None:
    """`core.caso_distritos` desde `FACT_Casos.ID_Distrito` (23)."""
    for caso in resueltos:
        distrito = caso["distrito"]
        caso_id = ids_caso.get(caso["codigo"])
        if distrito is None or caso_id is None:
            continue
        await ctx.conn.execute(
            "INSERT INTO core.caso_distritos (caso_id, distrito_id) VALUES ($1, $2)",
            caso_id,
            distrito,
        )
        ctx.add("core.caso_distritos")


async def _casos_actores(ctx: LoadContext) -> None:
    """`core.casos_actores` desde los dos bridges (D23: referencias ordinales)."""
    casos = legacy.sheet_of(ctx.sheets, "FACT_Casos")
    codigos = [
        casos.cell(indice, _C_CODIGO)
        for indice in range(casos.filas)
        if casos.cell(indice, _C_CODIGO)
    ]
    ids_caso = await _ids_caso(ctx)
    actores = await _actores_por_codigo(ctx)

    vistas: set[tuple[str, str]] = set()
    for hoja, col_actor in (
        ("BRIDGE_Caso_Actor", 2),
        ("BRIDGE_Caso_Actor_Estado", 2),
    ):
        bridge = legacy.sheet_of(ctx.sheets, hoja)
        for indice in range(bridge.filas):
            actor_codigo = bridge.cell(indice, col_actor)
            referencia = bridge.cell(indice, 3)
            actor_uid = actores.get(actor_codigo) if actor_codigo else None
            if actor_uid is None:
                continue

            codigo_caso, metodo = resolve_case_ref(referencia, codigos)
            if metodo in ("vacio", "ordinal_fuera_de_rango", "codigo_inexistente"):
                continue
            caso_id = ids_caso.get(codigo_caso)
            if caso_id is None:
                continue

            clave = (caso_id, actor_uid)
            if clave in vistas:
                continue
            vistas.add(clave)
            await ctx.conn.execute(
                """
                INSERT INTO core.casos_actores (caso_id, actor_id)
                VALUES ($1, $2)
                """,
                caso_id,
                actor_uid,
            )
            ctx.add("core.casos_actores")


async def run(ctx: LoadContext) -> None:
    geo = await _mapas_geograficos(ctx)
    resueltos = await _casos(ctx, geo)
    ids_caso = await _ids_caso(ctx)
    await _caso_regiones(ctx, geo, ids_caso)
    await _caso_distritos(ctx, resueltos, ids_caso)
    await _casos_actores(ctx)
