#!/usr/bin/env python3
"""Extrae de `0001_distritos_inei_2025.sql` el bloque §7 (re-vinculación de
`gis.infraestructuras_puntos` por nombre) a un SQL ejecutable e idempotente.

Por qué existe
--------------
`0001` hace §7 dentro de la misma transacción, pero **sólo funciona si la capa
GIS ya estaba cargada**. `migration/loader/cargar_gis.py` trunca y recarga la
tabla resolviendo `distrito_id` por `ubigeo`; el ubigeo del KML está corrido en
algunos distritos (Tayacaja), así que una recarga posterior a `0001` deshace la
re-vinculación por nombre. Este archivo deja ese paso disponible para
re-ejecutarlo después de cada carga.

Uso:
    python scripts/extraer_revinculacion_gis.py
"""

from __future__ import annotations

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "gis" / "derived" / "0001_distritos_inei_2025.sql"
DESTINO = RAIZ / "gis" / "derived" / "0004_revincular_infraestructuras_por_nombre.sql"

INICIO = "-- 7) Re-vincular infraestructuras por nombre"
FIN = "-- 8) Restaurar unicidades"

CABECERA = """\
-- 0004 · Re-vincular `gis.infraestructuras_puntos` por nombre
--
-- GENERADO por `scripts/extraer_revinculacion_gis.py` desde el bloque §7 de
-- `0001_distritos_inei_2025.sql`. No editar a mano.
--
-- Cuándo ejecutarlo
-- -----------------
-- DESPUÉS de cargar la capa con `migration/loader/cargar_gis.py`. El loader
-- resuelve `distrito_id` por `ubigeo`, y el ubigeo del KML está corrido en
-- Tayacaja (0907) y en un puñado de filas más: la resolución por ubigeo deja
-- NULLs y puede asignar el distrito vecino. Este bloque re-vincula por el
-- **nombre** del globo, en el orden región → provincia → ubigeo.
--
-- Resultado esperado: 13 454 filas con distrito; quedan 2 sin distrito y
-- ninguna es un distrito (MATARANI y MAZAMARI - PANGOA).
--
-- Idempotente: sólo actualiza cuando `distrito_id` difiere. No toca `ubigeo`.

begin;

"""

PIE = """
commit;
"""


def main() -> int:
    lineas = ORIGEN.read_text(encoding="utf-8").splitlines()
    try:
        desde = next(i for i, l in enumerate(lineas) if INICIO in l)
        hasta = next(i for i, l in enumerate(lineas) if FIN in l)
    except StopIteration:
        print("ERROR: no se encontraron los marcadores §7/§8", file=sys.stderr)
        return 1
    if hasta <= desde:
        print("ERROR: los marcadores están en orden inesperado", file=sys.stderr)
        return 1

    bloque = lineas[desde:hasta]
    bloques = sum(
        1 for l in bloque if l.startswith("UPDATE gis.infraestructuras_puntos")
    )
    if bloques == 0:
        print("ERROR: el bloque extraído no contiene UPDATEs", file=sys.stderr)
        return 1

    DESTINO.write_text(
        CABECERA + "\n".join(bloque).rstrip() + "\n" + PIE, encoding="utf-8"
    )
    print(
        f"{DESTINO.relative_to(RAIZ)}: {len(bloque)} líneas, {bloques} bloques UPDATE"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
