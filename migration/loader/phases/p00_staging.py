"""Fase 0 — staging `legacy.*`.

Copia cada hoja del workbook a una tabla propia del schema `legacy`, con TODAS
las columnas `TEXT` y un `fila_n` ordinal. No interpreta nada: es la única copia
reproducible del origen (D21) y contra ella se depuran las fases siguientes.

Decisiones de forma:

* Las columnas se llaman `c01`, `c02`, … **por posición**, no por cabecera. Las
  cabeceras del origen están mutiladas y varias son duplicadas.
* `cNN` (1-based) equivale a `r[NN - 1]` de la fila de datos.
* El schema completo se recrea en cada corrida (`DROP SCHEMA … CASCADE`), de modo
  que la fase es idempotente y no deja tablas huérfanas de una corrida anterior.
* `legacy._hojas` guarda el nombre original de cada hoja, el nombre de su tabla,
  el ancho y el número de filas. Es el índice para auditar la carga.
"""

from __future__ import annotations

from .. import legacy
from ..context import LoadContext

NUMBER = 0
NAME = "Staging legacy.*"


def _column_list(width: int) -> list[str]:
    return [f"c{i:02d}" for i in range(1, width + 1)]


async def run(ctx: LoadContext) -> None:
    conn = ctx.conn

    await conn.execute("DROP SCHEMA IF EXISTS legacy CASCADE")
    await conn.execute("CREATE SCHEMA legacy")
    await conn.execute(
        """
        CREATE TABLE legacy._hojas (
            hoja        TEXT PRIMARY KEY,
            tabla       TEXT NOT NULL,
            columnas    INTEGER NOT NULL,
            filas       INTEGER NOT NULL,
            cargado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    usados: dict[str, str] = {}

    for nombre, hoja in ctx.sheets.items():
        base = legacy.sanitize_identifier(nombre)
        slug = base
        sufijo = 2
        while slug in usados:
            slug = f"{base}_{sufijo}"
            sufijo += 1
        usados[slug] = nombre

        columnas = _column_list(hoja.width)
        definicion = ", ".join(f"{c} TEXT" for c in columnas)
        if definicion:
            definicion = f", {definicion}"

        await conn.execute(
            f'CREATE TABLE legacy."{slug}" (fila_n INTEGER PRIMARY KEY{definicion})'
        )

        if hoja.rows and columnas:
            registros = [(indice + 1, *fila) for indice, fila in enumerate(hoja.rows)]
            await conn.copy_records_to_table(
                slug,
                schema_name="legacy",
                columns=["fila_n", *columnas],
                records=registros,
            )

        await conn.execute(
            """
            INSERT INTO legacy._hojas (hoja, tabla, columnas, filas)
            VALUES ($1, $2, $3, $4)
            """,
            nombre,
            slug,
            hoja.width,
            hoja.filas,
        )

        ctx.add(f"legacy.{slug}", hoja.filas)
