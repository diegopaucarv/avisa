#!/usr/bin/env python3
"""Genera el script SQL que comenta las tablas y columnas del modelo v10.

Toma los textos de `curacion_v10.PROPOSITO` (una entrada por tabla logica) y de
`curacion_v10_columnas.COLUMNAS` (una entrada por columna logica), y escribe
`docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql`.

Antes de escribir verifica contra la base que cada tabla y cada columna existan,
de modo que el script no falle a mitad de camino. Si algo no coincide, se detiene
y lo informa en vez de generar un archivo incompleto.

Las particiones se omiten a propósito: PostgreSQL no propaga los comentarios a
las particiones, y el diccionario resuelve eso heredando la descripcion del padre.

Uso:
    python migration/generar_comentarios_sql.py

Solo lee la base. No la modifica.
"""

from __future__ import annotations

import sys
from pathlib import Path

from psycopg import Connection, connect

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from curacion_v10 import PROPOSITO  # noqa: E402
from curacion_v10_columnas import COLUMNAS  # noqa: E402
from generar_diccionario import dsn  # noqa: E402

PROPOSITO_DICCIONARIO = PROPOSITO

DESTINO = RAIZ / "docs" / "PARCHE_12_COMENTARIOS_COLUMNAS.sql"

ENCABEZADO = [
    "-- ==================================================================",
    "-- PARCHE 12 - COMENTARIOS DE TABLAS Y COLUMNAS DEL MODELO v10",
    "-- ==================================================================",
    "-- Generado por migration/generar_comentarios_sql.py. No editar a mano.",
    "--",
    "-- Escribe el proposito de cada tabla logica y la descripcion de cada",
    "-- columna del modelo v10 en el catalogo del motor (COMMENT ON), para que",
    "-- el diccionario de datos se alimente de la base y no de un archivo",
    "-- paralelo.",
    "--",
    "-- Cobertura:",
    "--   - tablas logicas del modelo v10, sin las particiones;",
    "--   - columnas de esas mismas tablas.",
    "--",
    "-- Queda fuera, a proposito:",
    "--   - las 24 particiones, porque PostgreSQL no hereda comentarios; el",
    "--     diccionario copia la descripcion de la tabla padre al generarse;",
    "--   - el esquema legacy, que se documenta con la curaduria del proyecto.",
    "--",
    "-- Idempotente: COMMENT ON reemplaza el comentario anterior.",
    "-- ==================================================================",
    "",
]


def escapar(texto: str) -> str:
    """Convierte un texto en un literal SQL entre comillas simples."""
    compacto = " ".join(str(texto).split())
    return compacto.replace("'", "''")


def catalogo(conn: Connection) -> tuple[set[str], set[str]]:
    """Devuelve las tablas y columnas que existen, como `esquema.nombre`."""
    tablas = {
        f"{esq}.{nom}"
        for esq, nom in conn.execute(
            """
            SELECT n.nspname, c.relname
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p')
               AND NOT c.relispartition
               AND n.nspname NOT IN ('public', 'information_schema')
               AND n.nspname !~ '^pg_'
            """
        )
    }
    columnas = {
        f"{esq}.{nom}.{col}"
        for esq, nom, col in conn.execute(
            """
            SELECT n.nspname, c.relname, a.attname
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE a.attnum > 0
               AND NOT a.attisdropped
               AND c.relkind IN ('r', 'p')
               AND NOT c.relispartition
               AND n.nspname NOT IN ('public', 'information_schema')
               AND n.nspname !~ '^pg_'
            """
        )
    }
    return tablas, columnas


def main() -> None:
    with connect(dsn()) as conexion:
        tablas_vivas, columnas_vivas = catalogo(conexion)

    faltan_tablas = sorted(set(PROPOSITO_DICCIONARIO) - tablas_vivas)
    faltan_columnas = sorted(set(COLUMNAS) - columnas_vivas)

    if faltan_tablas or faltan_columnas:
        print(f"tablas en la curaduria: {len(PROPOSITO_DICCIONARIO)}")
        print(f"columnas en la curaduria: {len(COLUMNAS)}")
        for clave in faltan_tablas[:20]:
            print("  TABLA INEXISTENTE", clave)
        for clave in faltan_columnas[:20]:
            print("  COLUMNA INEXISTENTE", clave)
        raise SystemExit(
            "la curaduria no calza con el catalogo: no se escribe el parche"
        )

    lineas = list(ENCABEZADO)

    lineas.append("-- ---- Proposito de cada tabla --------------------------------")
    lineas.append("")
    for clave in sorted(PROPOSITO_DICCIONARIO):
        texto = escapar(PROPOSITO_DICCIONARIO[clave])
        lineas.append(f"COMMENT ON TABLE {clave} IS '{texto}';")
    lineas.append("")

    lineas.append("-- ---- Descripcion de cada columna ----------------------------")
    lineas.append("")
    for clave in sorted(COLUMNAS):
        texto = escapar(COLUMNAS[clave])
        lineas.append(f"COMMENT ON COLUMN {clave} IS '{texto}';")
    lineas.append("")

    destino = DESTINO
    with open(destino, "w", encoding="utf-8", newline="\n") as archivo:
        archivo.write("\n".join(lineas))

    print(f"escrito {destino.name}:")
    print(f"  {len(PROPOSITO_DICCIONARIO)} tablas")
    print(f"  {len(COLUMNAS)} columnas")


if __name__ == "__main__":
    main()
