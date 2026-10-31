"""Fase 3 — entidades responsables y unidades orgánicas.

Dos fuentes, dos reglas:

* `DIM_Entidad_Responsable` (23) → `core.entidades`. Sólo `E-014` (PRODUCE) es
  un tenant real y ya existe como entidad 1, así que se le rellena el
  `codigo_legado` en vez de insertarla. Las otras 22 son ministerios externos:
  se cargan para no perder el catálogo, nunca como tenant de unidades.
* `DIM_Area_Responsable` (66) → `core.cat_unidades_organicas`. Todas cuelgan de
  `entidad_id = 1`, como manda el plan §4.3.

`DIM_Unidades_Organicas_Responsa` (27) **no se inserta como filas** (colisión
#85): aporta el segundo código legado, `codigo_legado_unidad = U-xxx`, sobre las
mismas filas de área.

Sobre esa colisión, dos hallazgos del dato real:

1. El `Id_Area` de la hoja de unidades **no pertenece al namespace** `AR-xxx` de
   `DIM_Area_Responsable`: coincide en 1 de 27 filas. Emparejar por
   `Abreviatura + Id_Area`, como decía el plan, sólo rescataría una unidad.
2. La abreviatura sí es única en ambas hojas (66 y 27 valores distintos) y los
   27 nombres coinciden con su área, así que la clave sin ambigüedad es la
   abreviatura, corroborada por el nombre.

`AR-047` (OAIPCS) ya existe como fila 1, sembrada por el parche 3 (D26). Se
**fusiona** con el legado en vez de duplicarla: `cat_unidades_organicas` tiene
`UNIQUE (entidad_id, siglas)` y ambas se llaman `OAIPCS`.
"""

from __future__ import annotations

from ...decisions import norm_key, text
from .. import legacy
from ..context import LoadContext

NUMBER = 3
NAME = "Entidades + unidades orgánicas"

# DIM_Entidad_Responsable
_ENT_CODIGO = 1
_ENT_NOMBRE = 2
_ENT_SIGLAS = 3
_ENT_NIVEL = 4
_ENT_ESTADO = 5

# DIM_Area_Responsable
_AREA_CODIGO = 1
_AREA_NOMBRE = 2
_AREA_SIGLAS = 3
_AREA_ESTADO = 5

# DIM_Unidades_Organicas_Responsa
_UNIDAD_CODIGO = 1
_UNIDAD_SIGLAS = 3

# Todas las áreas del legado son de PRODUCE (E-014 = entidad 1).
_ENTIDAD_PRODUCE = 1


async def _entidades(ctx: LoadContext) -> None:
    """`DIM_Entidad_Responsable` (23) → `core.entidades`."""
    hoja = "DIM_Entidad_Responsable"
    sheet = legacy.sheet_of(ctx.sheets, hoja)

    existentes = await ctx.conn.fetch(
        "SELECT id, siglas, codigo_legado FROM core.entidades"
    )
    por_siglas = {norm_key(f["siglas"]): f["id"] for f in existentes if f["siglas"]}
    por_codigo = {f["codigo_legado"]: f["id"] for f in existentes if f["codigo_legado"]}
    siguiente = max(f["id"] for f in existentes) + 1

    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _ENT_CODIGO))
        nombre = text(sheet.cell(indice, _ENT_NOMBRE))
        siglas = text(sheet.cell(indice, _ENT_SIGLAS))
        nivel = text(sheet.cell(indice, _ENT_NIVEL)) or "Nacional"
        estado = text(sheet.cell(indice, _ENT_ESTADO)) or "Activo"
        if not codigo or not nombre or not siglas:
            raise ValueError(
                f"{hoja} fila {indice + 1}: faltan código, nombre o siglas"
            )

        existente = por_codigo.get(codigo) or por_siglas.get(norm_key(siglas))
        if existente is not None:
            # PRODUCE (E-014) ya existe como entidad 1: sólo se rellena lo que
            # falte. Su nombre editado en v9 no se sobrescribe.
            await ctx.conn.execute(
                """
                UPDATE core.entidades
                   SET codigo_legado = $1,
                       nivel = COALESCE(nivel, $2),
                       estado = COALESCE(estado, $3)
                 WHERE id = $4
                """,
                codigo,
                nivel,
                estado,
                existente,
            )
        else:
            await ctx.conn.execute(
                """
                INSERT INTO core.entidades
                    (id, siglas, nombre, codigo_legado, nivel, estado)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                siguiente,
                siglas,
                nombre,
                codigo,
                nivel,
                estado,
            )
            por_siglas[norm_key(siglas)] = siguiente
            por_codigo[codigo] = siguiente
            siguiente += 1
        ctx.add("core.entidades")


def _codigos_de_unidad(unidades: legacy.Sheet) -> dict[str, str]:
    """{abreviatura normalizada -> código U-xxx} de la hoja de unidades."""
    codigos: dict[str, str] = {}
    for indice in range(unidades.filas):
        abreviatura = text(unidades.cell(indice, _UNIDAD_SIGLAS))
        codigo = text(unidades.cell(indice, _UNIDAD_CODIGO))
        if not abreviatura or not codigo:
            continue
        clave = norm_key(abreviatura)
        previo = codigos.get(clave)
        if previo is not None and previo != codigo:
            raise ValueError(
                f"DIM_Unidades_Organicas_Responsa fila {indice + 1}: la "
                f"abreviatura {abreviatura!r} aparece con dos códigos "
                f"({previo!r} y {codigo!r}); no se puede resolver sin ambigüedad"
            )
        codigos[clave] = codigo
    return codigos


async def _unidades(ctx: LoadContext) -> None:
    """`DIM_Area_Responsable` (66) → `core.cat_unidades_organicas`."""
    hoja = "DIM_Area_Responsable"
    areas = legacy.sheet_of(ctx.sheets, hoja)
    unidades = legacy.sheet_of(ctx.sheets, "DIM_Unidades_Organicas_Responsa")
    codigo_u = _codigos_de_unidad(unidades)

    existentes = await ctx.conn.fetch(
        "SELECT id, siglas, codigo_legado_area FROM core.cat_unidades_organicas"
    )
    por_siglas = {norm_key(f["siglas"]): f["id"] for f in existentes if f["siglas"]}
    por_area = {
        f["codigo_legado_area"]: f["id"] for f in existentes if f["codigo_legado_area"]
    }

    for indice in range(areas.filas):
        area = text(areas.cell(indice, _AREA_CODIGO))
        nombre = text(areas.cell(indice, _AREA_NOMBRE))
        siglas = text(areas.cell(indice, _AREA_SIGLAS))
        estado = text(areas.cell(indice, _AREA_ESTADO)) or "Activo"
        if not area or not nombre or not siglas:
            raise ValueError(
                f"{hoja} fila {indice + 1}: faltan código, nombre o abreviatura"
            )
        unidad = codigo_u.get(norm_key(siglas))

        existente = por_area.get(area) or por_siglas.get(norm_key(siglas))
        if existente is not None:
            # La fila OAIPCS (id 1, D26) es la misma AR-047: se reutiliza.
            await ctx.conn.execute(
                """
                UPDATE core.cat_unidades_organicas
                   SET codigo_legado_area = $1,
                       codigo_legado_unidad = COALESCE(codigo_legado_unidad, $2),
                       estado = COALESCE(estado, $3)
                 WHERE id = $4
                """,
                area,
                unidad,
                estado,
                existente,
            )
        else:
            await ctx.conn.execute(
                """
                INSERT INTO core.cat_unidades_organicas
                    (entidad_id, siglas, nombre_completo,
                     codigo_legado_area, codigo_legado_unidad, estado)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                _ENTIDAD_PRODUCE,
                siglas,
                nombre,
                area,
                unidad,
                estado,
            )
        ctx.add("core.cat_unidades_organicas")


async def run(ctx: LoadContext) -> None:
    await _entidades(ctx)
    await _unidades(ctx)
