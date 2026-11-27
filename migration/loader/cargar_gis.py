#!/usr/bin/env python3
"""Carga `gis/derived/infraestructuras_puntos.csv` en la capa de puntos.

La capa vive en `territorio.infraestructura_punto` desde la migración 75; antes
estaba en `gis.infraestructuras_puntos`. El loader pregunta cuál existe y escribe
en la que haya, así que sirve tanto antes como después de aplicar la 75 (la
migración deja en `gis` una vista de compatibilidad, y una vista no admite
`TRUNCATE`).

Standalone: no depende de `migration/loader/run.py` ni del xlsx del legado.
Aplica `migration/39_gis_infraestructuras.sql` (idempotente), trunca la tabla y
recarga desde el CSV con `COPY` a una tabla temporal. El `distrito_id` se resuelve
sólo para los ubigeos presentes en `core.distritos`; el resto queda en NULL.
Después aplica `gis/derived/0004_revincular_infraestructuras_por_nombre.sql`,
que corrige los ubigeos corridos del KML (Tayacaja y otros) re-vinculando por el
nombre del globo. Ese SQL generado sigue apuntando a `gis.infraestructuras_puntos`;
aquí se reescribe al nombre resuelto antes de ejecutarlo.

Uso:
    python migration/loader/cargar_gis.py
    python migration/loader/cargar_gis.py --csv otro.csv
    python migration/loader/cargar_gis.py --solo-esquema
    python migration/loader/cargar_gis.py --dsn postgresql://…

El DSN se toma de `--dsn`, luego de `DATABASE_URL` y por último de `.env`.
Nunca apunta a producción por defecto: sólo usa lo que se le pase o lo que haya
en `.env`. Revisar el destino antes de ejecutar contra Neón.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sys
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
CSV_POR_DEFECTO = RAIZ / "gis" / "derived" / "infraestructuras_puntos.csv"
SQL_ESQUEMA = RAIZ / "migration" / "39_gis_infraestructuras.sql"
SQL_REVINCULAR = (
    RAIZ / "gis" / "derived" / "0004_revincular_infraestructuras_por_nombre.sql"
)
TABLA = "territorio.infraestructura_punto"
TABLA_LEGADO = "gis.infraestructuras_puntos"
VISTA_DESEMBARCADEROS = ("territorio.v_desembarcaderos", "gis.v_desembarcaderos")
VISTA_POR_DISTRITO = (
    "territorio.v_infraestructuras_por_distrito",
    "gis.v_infraestructuras_por_distrito",
)


async def resolver_nombre(conexion, canonico: str, legado: str) -> str:
    """Nombre que existe hoy entre el canónico y el heredado.

    La migración 75 movió la capa de `gis` a `territorio`. Preguntar en vez de
    asumir deja al loader sirviendo a una base migrada y a una que no lo está.
    """
    if await conexion.fetchval("select to_regclass($1) is not null", canonico):
        return canonico
    return legado


# Columnas del CSV, en el orden de la tabla temporal. `distrito_id` y `geom` se
# calculan en SQL, y `ubigeo_region`/`ubigeo_provincia` son columnas generadas.
COLUMNAS = [
    "id",
    "tipo_registro",
    "nombre",
    "identi",
    "sede",
    "nombre_infraestructura",
    "direccion",
    "direccion_predio",
    "departamento",
    "provincia",
    "distrito",
    "ubigeo",
    "metodo_ubigeo",
    "latitud",
    "longitud",
    "coincide_coords",
    "codigo",
    "ambito",
    "tipo_derecho",
    "categoria_productiva",
    "categoria_codigo",
    "especie",
    "tipo_recurso",
    "nombre_recurso",
    "estado",
    "area_total_ha",
    "fecha_emision",
    "fecha_vigencia",
    "resolucion",
    "zona",
    "tipo_coord",
    "titular",
    "fid_origen",
    "tipo_geometria",
    "otros",
]

TIPOS_TMP = """
CREATE TEMP TABLE _tmp_infra (
    id                     text,
    tipo_registro          text,
    nombre                 text,
    identi                 text,
    sede                   text,
    nombre_infraestructura text,
    direccion              text,
    direccion_predio       text,
    departamento           text,
    provincia              text,
    distrito               text,
    ubigeo                 text,
    metodo_ubigeo          text,
    latitud                double precision,
    longitud               double precision,
    coincide_coords        boolean,
    codigo                 text,
    ambito                 text,
    tipo_derecho           text,
    categoria_productiva   text,
    categoria_codigo       text,
    especie                text,
    tipo_recurso           text,
    nombre_recurso         text,
    estado                 text,
    area_total_ha          numeric,
    fecha_emision          date,
    fecha_vigencia         date,
    resolucion             text,
    zona                   text,
    tipo_coord             text,
    titular                text,
    fid_origen             integer,
    tipo_geometria         text,
    otros                  jsonb
);
"""


def insertar_sql(tabla: str) -> str:
    return f"""
INSERT INTO {tabla} (
    {", ".join(COLUMNAS)}, distrito_id, geom
)
SELECT
    {", ".join("t." + c for c in COLUMNAS)},
    d.id,
    CASE
        WHEN t.longitud IS NOT NULL AND t.latitud IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(t.longitud, t.latitud), 4326)
    END
FROM _tmp_infra t
LEFT JOIN core.distritos d ON d.ubigeo::text = t.ubigeo;
"""


def dsn_desde_entorno(argumento: str | None) -> str:
    if argumento:
        return argumento
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = RAIZ / ".env"
    if env.exists():
        for linea in env.read_text(encoding="utf-8", errors="replace").splitlines():
            if linea.startswith("DATABASE_URL="):
                return linea.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("No hay DSN: pasa --dsn, define DATABASE_URL o revisa .env")


def _texto(valor: str) -> str | None:
    valor = (valor or "").strip()
    return valor or None


def _decimal(valor: str) -> float | None:
    valor = (valor or "").strip()
    return float(valor) if valor else None


def _entero(valor: str) -> int | None:
    valor = (valor or "").strip()
    return int(valor) if valor else None


def _booleano(valor: str) -> bool | None:
    valor = (valor or "").strip().lower()
    if valor == "si":
        return True
    if valor == "no":
        return False
    return None


def _fecha(valor: str) -> date | None:
    valor = (valor or "").strip()
    return date.fromisoformat(valor) if valor else None


def leer_registros(ruta: Path) -> list[tuple]:
    registros: list[tuple] = []
    with ruta.open(encoding="utf-8-sig", newline="") as archivo:
        for fila in csv.DictReader(archivo):
            otros = (fila["otros"] or "").strip()
            registros.append(
                (
                    _texto(fila["id"]),
                    _texto(fila["tipo_registro"]),
                    _texto(fila["nombre"]),
                    _texto(fila["identi"]),
                    _texto(fila["sede"]),
                    _texto(fila["nombre_infraestructura"]),
                    _texto(fila["direccion"]),
                    _texto(fila["direccion_predio"]),
                    _texto(fila["departamento"]),
                    _texto(fila["provincia"]),
                    _texto(fila["distrito"]),
                    _texto(fila["ubigeo"]),
                    _texto(fila["metodo_ubigeo"]),
                    _decimal(fila["latitud"]),
                    _decimal(fila["longitud"]),
                    _booleano(fila["coincide_coords"]),
                    _texto(fila["codigo"]),
                    _texto(fila["ambito"]),
                    _texto(fila["tipo_derecho"]),
                    _texto(fila["categoria_productiva"]),
                    _texto(fila["categoria_codigo"]),
                    _texto(fila["especie"]),
                    _texto(fila["tipo_recurso"]),
                    _texto(fila["nombre_recurso"]),
                    _texto(fila["estado"]),
                    _decimal(fila["area_total_ha"]),
                    _fecha(fila["fecha_emision"]),
                    _fecha(fila["fecha_vigencia"]),
                    _texto(fila["resolucion"]),
                    _texto(fila["zona"]),
                    _texto(fila["tipo_coord"]),
                    _texto(fila["titular"]),
                    _entero(fila["fid_origen"]),
                    _texto(fila["tipo_geometria"]),
                    otros if otros else None,
                )
            )
    return registros


async def cargar(dsn: str, csv_ruta: Path, solo_esquema: bool) -> None:
    import asyncpg

    if not csv_ruta.exists():
        raise SystemExit(f"No existe el CSV: {csv_ruta}")

    conexion = await asyncpg.connect(dsn)
    try:
        servidor = await conexion.fetchval("select inet_server_addr()::text")
        base = await conexion.fetchval("select current_database()")
        print(f"Base destino: {base} ({servidor or 'local'})")

        print(f"Aplicando esquema: {SQL_ESQUEMA.name}")
        await conexion.execute(SQL_ESQUEMA.read_text(encoding="utf-8"))

        if solo_esquema:
            print("Sólo esquema: no se cargaron filas.")
            return

        registros = leer_registros(csv_ruta)
        print(f"CSV: {csv_ruta} → {len(registros)} registros")

        tabla = await resolver_nombre(conexion, TABLA, TABLA_LEGADO)
        print(f"Tabla destino: {tabla}")

        async with conexion.transaction():
            await conexion.execute("TRUNCATE " + tabla)
            await conexion.execute(TIPOS_TMP)
            await conexion.copy_records_to_table(
                "_tmp_infra", records=registros, columns=COLUMNAS
            )
            await conexion.execute(insertar_sql(tabla))

        # La resolución por ubigeo asigna el distrito vecino cuando el ubigeo del
        # KML está corrido; 0004 re-vincula por nombre. Va fuera de la transacción
        # anterior porque el archivo trae su propio BEGIN/COMMIT. El SQL generado
        # nombra la ubicación heredada: se reescribe al nombre resuelto.
        if SQL_REVINCULAR.exists():
            print(f"Re-vinculando por nombre: {SQL_REVINCULAR.name}")
            await conexion.execute(
                SQL_REVINCULAR.read_text(encoding="utf-8").replace(TABLA_LEGADO, tabla)
            )
        else:
            print(
                f"AVISO: falta {SQL_REVINCULAR.name}; el distrito_id queda resuelto "
                "sólo por ubigeo"
            )

        total = await conexion.fetchval(f"select count(*) from {tabla}")
        resolubles = await conexion.fetchval(
            "select count(*) from core.distritos where ubigeo::text in "
            f"(select ubigeo from {tabla} where ubigeo is not null)"
        )
        print(f"Filas cargadas: {total}")
        print(f"Ubigeos distintos en la capa presentes en core.distritos: {resolubles}")
    finally:
        await conexion.close()


async def resumen(dsn: str) -> None:
    import asyncpg

    conexion = await asyncpg.connect(dsn)
    try:
        print("\n--- Verificación ---")
        tabla = await resolver_nombre(conexion, TABLA, TABLA_LEGADO)
        v_desembarcaderos = await resolver_nombre(conexion, *VISTA_DESEMBARCADEROS)
        v_por_distrito = await resolver_nombre(conexion, *VISTA_POR_DISTRITO)
        for fila in await conexion.fetch(
            f"""
            select tipo_registro, count(*) as filas,
                   count(*) filter (where ubigeo is not null) as con_ubigeo,
                   count(*) filter (where distrito_id is not null) as con_distrito_id,
                   count(*) filter (where geom is not null) as con_geom,
                   count(*) filter (where titular is not null) as con_titular
            from {tabla}
            group by tipo_registro order by tipo_registro
            """
        ):
            print("  " + " · ".join(f"{k}={v}" for k, v in fila.items()))
        print(
            "  total:",
            await conexion.fetchval(f"select count(*) from {tabla}"),
        )
        print(
            "  desembarcaderos (vista):",
            await conexion.fetchval(f"select count(*) from {v_desembarcaderos}"),
        )
        print(
            "  distritos con derechos (vista):",
            await conexion.fetchval(f"select count(*) from {v_por_distrito}"),
        )
        print(
            "  área otorgada total (ha):",
            await conexion.fetchval(
                f"select round(sum(area_total_ha), 2) from {tabla} "
                "where tipo_registro = 'derecho_acuicola'"
            ),
        )
    finally:
        await conexion.close()


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--csv", type=Path, default=CSV_POR_DEFECTO)
    argumentos.add_argument("--dsn", default=None)
    argumentos.add_argument(
        "--solo-esquema",
        action="store_true",
        help="Aplica el SQL pero no carga filas.",
    )
    argumentos.add_argument(
        "--sin-resumen",
        action="store_true",
        help="Omite la verificación posterior.",
    )
    opciones = argumentos.parse_args()

    dsn = dsn_desde_entorno(opciones.dsn)
    asyncio.run(cargar(dsn, opciones.csv, opciones.solo_esquema))
    if not opciones.solo_esquema and not opciones.sin_resumen:
        asyncio.run(resumen(dsn))
    return 0


if __name__ == "__main__":
    sys.exit(main())
