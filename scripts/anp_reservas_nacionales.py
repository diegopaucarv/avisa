#!/usr/bin/env python
"""Genera la capa de Reservas Nacionales (ANP) como GeoJSON WGS84.

Lee ``gis/ANP Nacional Definitivas/ANPNacionalDefinitivas`` (103 registros) con
pyshp y deja SÓLO los de ``anp_cate == "Reserva Nacional"`` (48 features).
Escribe un ``FeatureCollection`` en ``gis/derived/anp_reserva_nacional.geojson``
con ``properties`` = ``{codigo, nombre, categoria}``.

Este script NO escribe en la base: sólo produce el GeoJSON. La carga la hace
``scripts/_cargar_anp_reserva_nacional.mjs`` con el rol dueño.

CODIFICACIÓN (por qué NO se fuerza latin-1)
    El ``.cpg`` que acompaña al shapefile declara ``UTF-8``. Forzar ``latin-1``
    decodifica mal los acentos (p. ej. «Junín» se transforma en «JunÃ­n»), así
    que se respeta la codificación declarada por el ``.cpg`` y se usa UTF-8 como
    respaldo. ``--encoding`` permite forzar otra si un insumo distinto lo exige.

GEOMETRÍA
    pyshp expone cada shape vía ``__geo_interface__``; puede ser ``Polygon`` o
    ``MultiPolygon``. Se normaliza siempre a ``MultiPolygon`` (una ``Polygon``
    suelta se envuelve) para respetar el tipo declarado en
    ``territorio.anp_reserva_nacional.geom``. Las coordenadas se redondean a 5
    decimales (~1,1 m) para no inflar el archivo sin perder precisión útil en un
    mapa nacional.

Uso
    python scripts/anp_reservas_nacionales.py
    python scripts/anp_reservas_nacionales.py --fuente=RUTA --salida=RUTA.geojson
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import shapefile  # pyshp

RAIZ = Path(__file__).resolve().parent.parent
FUENTE_POR_DEFECTO = (
    RAIZ / "gis" / "ANP Nacional Definitivas" / "ANPNacionalDefinitivas"
)
SALIDA_POR_DEFECTO = RAIZ / "gis" / "derived" / "anp_reserva_nacional.geojson"

CATEGORIA = "Reserva Nacional"
ESPERADAS = 48
DECIMALES = 5


def leer_opciones() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Genera el GeoJSON de Reservas Nacionales (ANP).",
    )
    parser.add_argument(
        "--fuente",
        default=str(FUENTE_POR_DEFECTO),
        help="Shapefile de entrada (sin extensión o con .shp).",
    )
    parser.add_argument(
        "--salida",
        default=str(SALIDA_POR_DEFECTO),
        help="GeoJSON de salida.",
    )
    parser.add_argument(
        "--encoding",
        default=None,
        help=(
            "Codificación del .dbf. Por defecto se lee la del .cpg (UTF-8 en el "
            "insumo vigente). latin-1 corrompe los acentos, por eso no es el "
            "valor por defecto."
        ),
    )
    return parser.parse_args()


def codificacion(fuente: Path, forzada: str | None) -> str:
    """Devuelve la codificación a usar, priorizando --encoding y luego el .cpg."""
    if forzada:
        return forzada
    cpg = fuente.with_suffix(".cpg")
    if cpg.exists():
        declarada = cpg.read_text(encoding="utf-8", errors="replace").strip()
        if declarada:
            return declarada
    return "utf-8"


def redondear(coords: Any, decimales: int = DECIMALES) -> Any:
    """Redondea recursivamente una estructura de coordenadas GeoJSON."""
    if isinstance(coords, (list, tuple)):
        # Un punto es [x, y] (o [x, y, z]): primer elemento numérico.
        if coords and isinstance(coords[0], (int, float)):
            return [round(float(valor), decimales) for valor in coords]
        return [redondear(valor, decimales) for valor in coords]
    return coords


def a_multipoligono(geom: dict | None) -> dict | None:
    """Normaliza la geometría a MultiPolygon y redondea sus coordenadas."""
    if not geom:
        return None
    tipo = geom.get("type")
    coords = geom.get("coordinates")
    if coords is None:
        return None
    if tipo == "Polygon":
        coords = [coords]
    elif tipo != "MultiPolygon":
        return None
    return {"type": "MultiPolygon", "coordinates": redondear(coords)}


def generar(fuente: Path, salida: Path, encoding: str | None) -> int:
    if not fuente.exists() and not fuente.with_suffix(".shp").exists():
        raise SystemExit(f"No existe el shapefile: {fuente}")

    lector = shapefile.Reader(str(fuente), encoding=codificacion(fuente, encoding))
    campos = [campo[0] for campo in lector.fields[1:]]
    for requerido in ("anp_codi", "anp_nomb", "anp_cate"):
        if requerido not in campos:
            raise SystemExit(
                f"El shapefile no trae el campo «{requerido}». "
                f"Campos disponibles: {campos}"
            )

    features: list[dict] = []
    codigos: set[str] = set()
    total = 0
    descartes = 0

    for shape_rec in lector.iterShapeRecords():
        total += 1
        registro = dict(zip(campos, shape_rec.record))
        if (registro.get("anp_cate") or "").strip() != CATEGORIA:
            continue

        codigo = (registro.get("anp_codi") or "").strip()
        nombre = (registro.get("anp_nomb") or "").strip()
        geom = a_multipoligono(shape_rec.shape.__geo_interface__)
        if not codigo or geom is None:
            descartes += 1
            continue

        # Se conservan las secciones con el mismo `anp_codi` (RN05 y RN18 vienen
        # partidas): el GeoJSON mantiene las 48 features y la carga disuelve por
        # código. Descartarlas aquí perdería área.
        codigos.add(codigo)
        features.append(
            {
                "type": "Feature",
                "id": codigo,
                "geometry": geom,
                "properties": {
                    "codigo": codigo,
                    "nombre": nombre,
                    # Se normaliza al literal del filtro: es lo que declara la
                    # columna `categoria` y evita reenviar ruido del .dbf.
                    "categoria": CATEGORIA,
                },
            }
        )

    print(f"Fuente        : {fuente}")
    print(f"Registros     : {total} totales en el shapefile")
    print(f"Reserva Nac.  : {len(features)} features (filtro anp_cate)")
    print(f"Códigos anp_codi distintos: {len(codigos)}")
    if descartes:
        print(f"Descartadas sin código o geometría: {descartes}")

    if len(features) != ESPERADAS:
        raise SystemExit(
            f"Se esperaban {ESPERADAS} Reservas Nacionales y se encontraron "
            f"{len(features)}. Se aborta para no generar una capa incompleta."
        )

    salida.parent.mkdir(parents=True, exist_ok=True)
    coleccion = {"type": "FeatureCollection", "features": features}
    salida.write_text(
        json.dumps(coleccion, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    bytes_totales = salida.stat().st_size
    print(
        f"Escrito       : {salida} "
        f"({bytes_totales:,} bytes · {bytes_totales / (1024 * 1024):.2f} MB)"
    )
    return len(features)


def main() -> None:
    opciones = leer_opciones()
    generar(
        Path(opciones.fuente),
        Path(opciones.salida),
        opciones.encoding,
    )


if __name__ == "__main__":
    main()
