"""Fase 1 — geografía del legado: 25 regiones, 70 provincias, 698 distritos.

Tres correcciones del plan (§2.1) que esta fase aplica y que ningún otro módulo
debe repetir:

1. `core.regiones.ubigeo` se deriva del **prefijo de `DIM_Provincias.Cod_INEI`**,
   nunca de `Codigo_Depto`: a partir del departamento 16 el código del origen
   está corrido y Loreto quedaría con el ubigeo de Madre de Dios.
2. `DEP-15` (Lima) y `DEP-16` (Lima Provincias) comparten el ubigeo INEI `15` y
   `regiones.ubigeo` es UNIQUE: se **fusionan** en una sola región `15 Lima`.
   La separación Lima / Lima Provincias sobrevive donde corresponde, en
   `provincias` (`1501` frente a `1502..1505`).
3. `DEP-20` ("Más de Uno") no es una región: no tiene provincias y se excluye.

Además `Cod_INEI` llega **sin ceros a la izquierda** en 28 provincias y 307
distritos (`'101'`, `'10101'`). Por eso se rellena a 4 y 6 dígitos antes de
cortar: sin ese `zfill`, los 698 distritos perderían su provincia.

Los distritos del Perú que no están en el legado (698 de 1 874) no se inventan
ni se reportan como conflicto: el plan sólo pide dejarlos fuera.
"""

from __future__ import annotations

from ...decisions import (
    DEPARTAMENTOS_NO_REGION,
    distrito_ubigeo,
    provincia_ubigeo,
    region_ubigeo_from_provincia,
)
from .. import legacy
from ..context import LoadContext

NUMBER = 1
NAME = "Geografía 25/70/698"

# Posiciones 1-based verificadas contra el workbook. Nunca por cabecera: los
# encabezados del origen vienen mutilados y varias columnas son duplicadas.
_DEP_CODIGO = 1
_DEP_NOMBRE = 2

_PROV_COD_INEI = 2
_PROV_NOMBRE = 3
_PROV_DEPARTAMENTO = 4

_DIS_COD_INEI = 2
_DIS_NOMBRE = 3


def _codigo(valor: str | None, hoja: str, fila: int) -> str:
    """Código INEI obligatorio: sin él no hay ubigeo que derivar."""
    if not valor:
        raise ValueError(f"{hoja} fila {fila}: falta el código INEI")
    return valor


def _regiones(
    provincias: legacy.Sheet, nombres_dep: dict[str, str]
) -> list[tuple[str, str]]:
    """[(ubigeo, nombre)] de las 25 regiones, derivado sólo de las provincias.

    `DEP-20` no aparece porque no tiene provincias. Cuando dos departamentos
    caen en el mismo ubigeo (DEP-15 y DEP-16) se conserva el nombre del
    departamento de código menor, es decir `DEP-15 Lima`.
    """
    candidatos: dict[str, list[tuple[str, str]]] = {}
    for indice in range(provincias.filas):
        departamento = provincias.cell(indice, _PROV_DEPARTAMENTO)
        if departamento is None or departamento in DEPARTAMENTOS_NO_REGION:
            continue
        ubigeo = region_ubigeo_from_provincia(
            _codigo(
                provincias.cell(indice, _PROV_COD_INEI), "DIM_Provincias", indice + 1
            )
        )
        nombre = nombres_dep.get(departamento)
        if not nombre:
            raise ValueError(
                f"DIM_Provincias fila {indice + 1}: el departamento "
                f"{departamento!r} no existe en DIM_Departamentos"
            )
        pares = candidatos.setdefault(ubigeo, [])
        if all(codigo != departamento for codigo, _ in pares):
            pares.append((departamento, nombre))

    return [(ubigeo, min(pares)[1]) for ubigeo, pares in sorted(candidatos.items())]


async def run(ctx: LoadContext) -> None:
    conn = ctx.conn

    departamentos = legacy.sheet_of(ctx.sheets, "DIM_Departamentos")
    provincias = legacy.sheet_of(ctx.sheets, "DIM_Provincias")
    distritos = legacy.sheet_of(ctx.sheets, "DIM_Distritos")

    nombres_dep: dict[str, str] = {}
    for indice in range(departamentos.filas):
        codigo = departamentos.cell(indice, _DEP_CODIGO)
        nombre = departamentos.cell(indice, _DEP_NOMBRE)
        if codigo and nombre:
            nombres_dep[codigo] = nombre

    # -- regiones (25) ------------------------------------------------------
    for ubigeo, nombre in _regiones(provincias, nombres_dep):
        await conn.execute(
            "INSERT INTO core.regiones (ubigeo, nombre) VALUES ($1, $2)",
            ubigeo,
            nombre,
        )
        ctx.add("core.regiones")

    ids_region = {
        fila["ubigeo"]: fila["id"]
        for fila in await conn.fetch("SELECT id, ubigeo FROM core.regiones")
    }

    # -- provincias (70) ----------------------------------------------------
    filas_provincia: list[tuple[int, str, str]] = []
    for indice in range(provincias.filas):
        ubigeo = provincia_ubigeo(
            _codigo(
                provincias.cell(indice, _PROV_COD_INEI), "DIM_Provincias", indice + 1
            )
        )
        nombre = provincias.cell(indice, _PROV_NOMBRE)
        if not nombre:
            raise ValueError(
                f"DIM_Provincias fila {indice + 1}: falta Nombre_Provincia"
            )
        region_id = ids_region.get(ubigeo[:2])
        if region_id is None:
            raise ValueError(
                f"DIM_Provincias fila {indice + 1}: el ubigeo {ubigeo!r} apunta a "
                f"una región INEI inexistente ({ubigeo[:2]!r})"
            )
        filas_provincia.append((region_id, ubigeo, nombre))

    await conn.executemany(
        "INSERT INTO core.provincias (region_id, ubigeo, nombre) VALUES ($1, $2, $3)",
        filas_provincia,
    )
    ctx.add("core.provincias", len(filas_provincia))

    ids_provincia = {
        fila["ubigeo"]: fila["id"]
        for fila in await conn.fetch("SELECT id, ubigeo FROM core.provincias")
    }

    # -- distritos (698) ----------------------------------------------------
    filas_distrito: list[tuple[int, str, str]] = []
    for indice in range(distritos.filas):
        ubigeo = distrito_ubigeo(
            _codigo(distritos.cell(indice, _DIS_COD_INEI), "DIM_Distritos", indice + 1)
        )
        nombre = distritos.cell(indice, _DIS_NOMBRE)
        if not nombre:
            raise ValueError(f"DIM_Distritos fila {indice + 1}: falta Nombre_Distrito")
        provincia_id = ids_provincia.get(ubigeo[:4])
        if provincia_id is None:
            raise ValueError(
                f"DIM_Distritos fila {indice + 1}: el ubigeo {ubigeo!r} apunta a "
                f"una provincia INEI inexistente ({ubigeo[:4]!r})"
            )
        filas_distrito.append((provincia_id, ubigeo, nombre))

    await conn.executemany(
        "INSERT INTO core.distritos (provincia_id, ubigeo, nombre) VALUES ($1, $2, $3)",
        filas_distrito,
    )
    ctx.add("core.distritos", len(filas_distrito))
