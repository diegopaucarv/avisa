#!/usr/bin/env python3
"""Extrae los puntos de `gis/Infraestructuras.kml` a CSV tabular y GeoJSON.

El KML de PRODUCE no usa `<ExtendedData>`: cada atributo vive en una tabla HTML
dentro de `<description>` (el globo de Google Earth). Este script la parsea con
la biblioteca estándar y resuelve el ubigeo de seis dígitos reutilizando el flujo
de nombres que ya usa `scripts/alcaldes_a_df.py`: correcciones de
`scripts/toponimos.json`, canonización tolerante contra el ubigeo
(`canonizar_ubigeo`) y la columna INEI de
`gis/equivalencia-ubigeos-oti-concytec.csv`.

La capa no es homogénea y el CSV lo refleja en `tipo_registro`:

- `derecho_acuicola` (13 229): cada punto es un derecho acuícola con `CODIGO`
  propio, titular, resolución, área, especie y categoría productiva. Son
  derechos privados, no instalaciones de PRODUCE.
- `institucional` (227): sedes y dependencias identificadas por `IDENTI`
  (ITP, SANIPES, IMARPE, DIREPRO, DPA, FONDEPES…).

`titular` (y `nombre`, que repite el titular en los derechos y en PNACP) es dato
personal bajo la Ley 29733: se escribe en el CSV para uso interno, pero el
GeoJSON **no** lo incluye y debe considerarse la capa publicable.

Uso:
    python scripts/kml_infraestructuras.py
    python scripts/kml_infraestructuras.py --kml gis/Infraestructuras.kml
    python scripts/kml_infraestructuras.py --sin-ubigeo

Requiere pandas sólo cuando se resuelve el ubigeo.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
KML_POR_DEFECTO = RAIZ / "gis" / "Infraestructuras.kml"
UBIGEO_POR_DEFECTO = RAIZ / "gis" / "equivalencia-ubigeos-oti-concytec.csv"
SALIDA_POR_DEFECTO = RAIZ / "gis" / "derived"

KML_NS = "http://www.opengis.net/kml/2.2"

# Claves del globo que se consumen; el resto se conserva en `otros` como JSON.
CAMPOS = {
    "FID",
    "NOMBRE_1",
    "IDENTI",
    "DEPARTAMEN",
    "PROVINCIA",
    "DISTRITO",
    "DIRECCION",
    "LONGITUD",
    "LATITUD",
    # Campos de derechos acuícolas.
    "CODIGO",
    "TITULAR",
    "AMBITO",
    "TIPO_DEREC",
    "CATEGORIA_",
    "ESPECIE",
    "TIPO_RECUR",
    "NOMBRE_REC",
    "ESTADO",
    "AREA_TOTAL",
    "FECHA_EMIS",
    "FECHA_VIGE",
    "RESOLUCION",
    "ZONA",
    "TIPO_COORD",
    # Campos institucionales.
    "SEDE",
    "NOMBRE_INF",
    "DIREC_PRED",
    "NAME",
    "NOMBRE",
}

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


class _GloboParser(HTMLParser):
    """Lee la tabla HTML de `<description>` y devuelve pares clave/valor.

    La tabla está anidada: una tabla exterior de portada con el nombre del activo
    y una interior con los campos. Al recolectar celdas por `<tr>`, las filas de
    la tabla exterior terminan con un número de celdas distinto de dos y se
    descartan solas, sin necesidad de seguir la profundidad.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pares: list[tuple[str, str]] = []
        self._celdas: list[str] = []
        self._celda: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "tr":
            self._celdas = []
        elif tag == "td":
            self._celda = []
        elif tag == "br" and self._celda is not None:
            self._celda.append(" ")

    def handle_startendtag(self, tag: str, attrs) -> None:
        if tag == "br" and self._celda is not None:
            self._celda.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._celda is not None:
            self._celdas.append(_limpiar("".join(self._celda)))
            self._celda = None
        elif tag == "tr":
            if len(self._celdas) == 2:
                self.pares.append((self._celdas[0], self._celdas[1]))
            self._celdas = []

    def handle_data(self, data: str) -> None:
        if self._celda is not None:
            self._celda.append(data)


def _limpiar(texto: str | None) -> str:
    return " ".join((texto or "").split())


def _norm(texto: str) -> str:
    """Normaliza para unir por nombre: sin tildes, mayúsculas, espacio simple."""
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )
    return " ".join(sin_tildes.upper().replace(".", "").split())


def _a_float(texto: str | None) -> float | None:
    """Convierte a decimal; algunos globos guardan grados/minutos/segundos."""
    if not texto:
        return None
    try:
        return float(texto.strip())
    except ValueError:
        return None


def _a_fecha(texto: str | None) -> str:
    """`FECHA_EMIS`/`FECHA_VIGE` vienen como `d/m/yyyy`; se emiten en ISO.

    `FECHA_MODI` trae el literal `<Null>` y se deja intacto en `otros`.
    """
    if not texto:
        return ""
    limpio = texto.strip()
    for formato in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(limpio, formato).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


CATEGORIAS = ("AREL", "AMYPE", "AMYGE")


def _categoria_codigo(texto: str | None) -> str:
    """Extrae el siglón de `CATEGORIA_` («… (AMYPE)»)."""
    mayusculas = (texto or "").upper()
    for codigo in CATEGORIAS:
        if f"({codigo})" in mayusculas:
            return codigo
    return ""


def _tipo_coord(texto: str | None) -> str:
    """Unifica mayúsculas y espacios de `TIPO_COORD` (4 variantes de caja)."""
    return " ".join((texto or "").split()).upper()


def mapear(punto: dict) -> dict:
    """Traduce las claves del globo a las columnas del CSV.

    Los derechos acuícolas se reconocen por `CODIGO`; las sedes institucionales
    por `IDENTI`. El nombre del placemark (`<name>`) repite el titular en los
    derechos y en PNACP, así que se conserva pero se documenta como PII.
    """
    globo = punto["globo"]
    identi = globo.get("IDENTI", "")
    es_derecho = bool(globo.get("CODIGO"))
    if es_derecho:
        tipo_registro = "derecho_acuicola"
    elif identi:
        tipo_registro = "institucional"
    else:
        tipo_registro = "sin_clasificar"

    # `NAME` es nombre de persona en PNACP y nombre de infraestructura en DPA.
    titular = globo.get("TITULAR", "")
    if identi == "PNACP":
        titular = globo.get("NAME", "")

    infraestructura = globo.get("NOMBRE_INF", "")
    if not infraestructura and identi.startswith("DPA"):
        infraestructura = globo.get("NAME", "")
    if not infraestructura:
        infraestructura = globo.get("NOMBRE", "")

    return {
        "tipo_registro": tipo_registro,
        "identi": identi,
        "sede": globo.get("SEDE", ""),
        "nombre_infraestructura": infraestructura,
        "direccion": globo.get("DIRECCION", ""),
        "direccion_predio": globo.get("DIREC_PRED", ""),
        "codigo": globo.get("CODIGO", ""),
        "ambito": globo.get("AMBITO", ""),
        "tipo_derecho": globo.get("TIPO_DEREC", ""),
        "categoria_productiva": globo.get("CATEGORIA_", ""),
        "categoria_codigo": _categoria_codigo(globo.get("CATEGORIA_")),
        "especie": globo.get("ESPECIE", ""),
        "tipo_recurso": globo.get("TIPO_RECUR", ""),
        "nombre_recurso": globo.get("NOMBRE_REC", ""),
        "estado": globo.get("ESTADO", ""),
        "area_total_ha": globo.get("AREA_TOTAL", ""),
        "fecha_emision": _a_fecha(globo.get("FECHA_EMIS")),
        "fecha_vigencia": _a_fecha(globo.get("FECHA_VIGE")),
        "resolucion": globo.get("RESOLUCION", ""),
        "zona": globo.get("ZONA", ""),
        "tipo_coord": _tipo_coord(globo.get("TIPO_COORD")),
        "titular": titular,
        "otros": json.dumps(
            {k: v for k, v in globo.items() if k not in CAMPOS},
            ensure_ascii=False,
        ),
    }


def leer_globo(descripcion: str | None) -> dict[str, str]:
    """Devuelve un diccionario clave→valor a partir del HTML del globo."""
    if not descripcion:
        return {}
    parser = _GloboParser()
    parser.feed(descripcion)
    parser.close()
    campos: dict[str, str] = {}
    for clave_cruda, valor in parser.pares:
        clave = _norm(clave_cruda)
        if clave and clave not in campos:
            campos[clave] = valor
    return campos


def leer_puntos(ruta: Path) -> list[dict]:
    """Devuelve un diccionario por `<Placemark>` del KML.

    El archivo declara `xsi:schemaLocation` en el elemento raíz sin declarar el
    prefijo `xmlns:xsi`, lo que hace fallar a un parser XML estricto. Se inyecta
    la declaración en memoria en lugar de tocar el original.
    """
    datos = ruta.read_bytes().replace(
        b"<kml xmlns=",
        b'<kml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns=',
        1,
    )
    puntos: list[dict] = []
    for _, elemento in ET.iterparse(io.BytesIO(datos), events=("end",)):
        if elemento.tag != f"{{{KML_NS}}}Placemark":
            continue

        globo = leer_globo(elemento.findtext(f"{{{KML_NS}}}description"))
        nombre = _limpiar(elemento.findtext(f"{{{KML_NS}}}name"))

        geometria = "sin_geometria"
        lon = lat = ""
        for hijo in elemento:
            tipo = hijo.tag.rsplit("}", 1)[-1]
            if tipo not in {"Point", "LineString", "Polygon", "MultiGeometry"}:
                continue
            coords = hijo.find(f".//{{{KML_NS}}}coordinates")
            if coords is not None and coords.text:
                geometria = tipo
                partes = coords.text.strip().split()[0].split(",")
                if len(partes) >= 2:
                    lon, lat = partes[0], partes[1]
            break

        puntos.append(
            {
                "id": elemento.get("id", ""),
                "nombre": nombre,
                "departamento": globo.get("DEPARTAMEN", ""),
                "provincia": globo.get("PROVINCIA", ""),
                "distrito": globo.get("DISTRITO", ""),
                "fid_origen": globo.get("FID", ""),
                "longitud_atributo": globo.get("LONGITUD", ""),
                "latitud_atributo": globo.get("LATITUD", ""),
                "longitud": lon,
                "latitud": lat,
                "tipo_geometria": geometria,
                "globo": globo,
            }
        )
        elemento.clear()
    return puntos


def resolver_ubigeo(puntos: list[dict], ruta_ubigeo: Path):
    """Une cada punto con el ubigeo usando el flujo de nombres del proyecto.

    Primero se deduplican los pares (departamento, provincia, distrito) —son
    cientos, no miles— para no canonizar trece veces el mismo distrito. Se
    corrigen los topónimos con `toponimos.json`, se canonizan contra el ubigeo
    tolerando truncamientos y erratas, y sólo entonces se busca el código.
    """
    if str(Path(__file__).resolve().parent) not in sys.path:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
    import pandas as pd
    from alcaldes_a_df import canonizar_ubigeo, clave, corregir_toponimos, leer_ubigeo

    tabla = leer_ubigeo(ruta_ubigeo)

    combos = sorted(
        {
            (p["departamento"], p["provincia"], p["distrito"])
            for p in puntos
            if p["distrito"]
        }
    )
    base = pd.DataFrame(combos, columns=["departamento", "provincia", "distrito"])
    base = corregir_toponimos(base)
    canon, detalle = canonizar_ubigeo(base, tabla)

    indice = {}
    for fila in tabla.itertuples(index=False):
        indice.setdefault((clave(fila.provincia), clave(fila.distrito)), fila)

    motivos = {
        (clave(d["provincia_origen"]), clave(d["distrito_origen"])): d["motivo"]
        for d in detalle
    }

    # El parecido ortográfico sólo se acepta cuando lo respalda `toponimos.json`: en
    # esta fuente bastan dos tokens en común ('SAN ANTONIO' / 'SAN CRISTOBAL') para
    # emparejar distritos distintos, y un ubigeo inventado es peor que un hueco.
    resuelto: dict[tuple[str, str, str], dict] = {}
    for original, provincia, distrito in zip(
        combos, canon["provincia"], canon["distrito"]
    ):
        fila = indice.get((clave(provincia), clave(distrito)))
        provincia_igual = clave(provincia) == clave(original[1])
        distrito_igual = clave(distrito) == clave(original[2])
        if provincia_igual and distrito_igual:
            motivo = "exacto"
        else:
            motivo = motivos.get((clave(original[1]), clave(original[2])))
            if not motivo:
                # Cambió sin que `canonizar_ubigeo` lo reporte: lo corrigió
                # `toponimos.json` o se resolvió la provincia por aproximación.
                if not provincia_igual and not distrito_igual:
                    motivo = "corregido"
                elif not provincia_igual:
                    motivo = "provincia aproximada"
                else:
                    motivo = "distrito corregido"
        if fila is not None and motivo != "parecido":
            resuelto[original] = {
                "departamento": fila.departamento,
                "provincia": fila.provincia,
                "distrito": fila.distrito,
                "ubigeo": fila.ubigeo,
                "metodo_ubigeo": motivo,
            }
            continue
        resuelto[original] = {
            "departamento": original[0],
            "provincia": original[1],
            "distrito": original[2],
            "ubigeo": "",
            "metodo_ubigeo": (
                "parecido descartado" if fila is not None else "fuera del ubigeo"
            ),
        }

    cambios = sorted(
        (
            {
                "provincia_origen": origen[1],
                "distrito_origen": origen[2],
                "provincia": final["provincia"],
                "distrito": final["distrito"],
                "metodo_ubigeo": final["metodo_ubigeo"],
            }
            for origen, final in resuelto.items()
            if final["ubigeo"]
            and (
                clave(origen[1]) != clave(final["provincia"])
                or clave(origen[2]) != clave(final["distrito"])
            )
        ),
        key=lambda d: (d["provincia_origen"], d["distrito_origen"]),
    )
    return resuelto, cambios


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--kml", type=Path, default=KML_POR_DEFECTO)
    argumentos.add_argument("--ubigeo", type=Path, default=UBIGEO_POR_DEFECTO)
    argumentos.add_argument("--out-dir", type=Path, default=SALIDA_POR_DEFECTO)
    argumentos.add_argument(
        "--sin-ubigeo",
        action="store_true",
        help="No unir con el ubigeo aunque el CSV exista.",
    )
    opciones = argumentos.parse_args()

    if not opciones.kml.exists():
        print(f"No existe el KML: {opciones.kml}", file=sys.stderr)
        return 1

    puntos = leer_puntos(opciones.kml)

    resuelto: dict[tuple[str, str, str], dict] = {}
    cambios: list[dict] = []
    if not opciones.sin_ubigeo and opciones.ubigeo.exists():
        resuelto, cambios = resolver_ubigeo(puntos, opciones.ubigeo)

    opciones.out_dir.mkdir(parents=True, exist_ok=True)
    ruta_csv = opciones.out_dir / "infraestructuras_puntos.csv"
    ruta_geojson = opciones.out_dir / "infraestructuras_puntos.geojson"

    con_distrito = 0
    sin_geometria = 0
    coords_distintas = 0
    con_ubigeo = 0
    con_titular = 0
    distritos_simples: set[str] = set()
    distritos_completos: set[str] = set()
    sin_ubigeo: Counter[tuple[str, str, str]] = Counter()
    metodos: Counter[str] = Counter()
    instituciones: Counter[str] = Counter()
    tipos: Counter[str] = Counter()
    ambitos: Counter[str] = Counter()
    derechos: Counter[str] = Counter()
    categorias: Counter[str] = Counter()
    especies: Counter[str] = Counter()
    coordenadas: Counter[tuple[str, str]] = Counter()
    features: list[dict] = []

    with ruta_csv.open("w", encoding="utf-8-sig", newline="") as archivo_csv:
        escritor = csv.DictWriter(archivo_csv, fieldnames=COLUMNAS)
        escritor.writeheader()

        for punto in puntos:
            campos = mapear(punto)
            clave_combo = (
                punto["departamento"],
                punto["provincia"],
                punto["distrito"],
            )
            oficial = resuelto.get(clave_combo)
            departamento = oficial["departamento"] if oficial else punto["departamento"]
            provincia = oficial["provincia"] if oficial else punto["provincia"]
            distrito = oficial["distrito"] if oficial else punto["distrito"]
            ubigeo = oficial["ubigeo"] if oficial else ""
            metodo = oficial["metodo_ubigeo"] if oficial else ""

            tipos[campos["tipo_registro"]] += 1
            if campos["identi"]:
                instituciones[campos["identi"]] += 1
            if campos["ambito"]:
                ambitos[campos["ambito"]] += 1
            if campos["tipo_derecho"]:
                derechos[campos["tipo_derecho"]] += 1
            if campos["categoria_codigo"]:
                categorias[campos["categoria_codigo"]] += 1
            if campos["especie"]:
                especies[campos["especie"]] += 1
            if campos["titular"]:
                con_titular += 1

            if punto["distrito"]:
                con_distrito += 1
                distritos_simples.add(_norm(punto["distrito"]))
                distritos_completos.add(clave_combo)
            if ubigeo:
                con_ubigeo += 1
            elif punto["distrito"]:
                sin_ubigeo[clave_combo] += 1
            if metodo:
                metodos[metodo] += 1
            if punto["tipo_geometria"] == "sin_geometria":
                sin_geometria += 1

            coincide = ""
            if punto["longitud"]:
                lon_punto = _a_float(punto["longitud"])
                lat_punto = _a_float(punto["latitud"])
                lon_globo = _a_float(punto["longitud_atributo"])
                lat_globo = _a_float(punto["latitud_atributo"])
                if None not in (lon_punto, lat_punto, lon_globo, lat_globo):
                    iguales = (
                        abs(lon_punto - lon_globo) < 0.001
                        and abs(lat_punto - lat_globo) < 0.001
                    )
                    coincide = "si" if iguales else "no"
                    if not iguales:
                        coords_distintas += 1
                coordenadas[(punto["longitud"], punto["latitud"])] += 1

            escritor.writerow(
                {
                    "id": punto["id"],
                    "tipo_registro": campos["tipo_registro"],
                    "nombre": punto["nombre"],
                    "identi": campos["identi"],
                    "sede": campos["sede"],
                    "nombre_infraestructura": campos["nombre_infraestructura"],
                    "direccion": campos["direccion"],
                    "direccion_predio": campos["direccion_predio"],
                    "departamento": departamento,
                    "provincia": provincia,
                    "distrito": distrito,
                    "ubigeo": ubigeo,
                    "metodo_ubigeo": metodo,
                    "latitud": punto["latitud"],
                    "longitud": punto["longitud"],
                    "coincide_coords": coincide,
                    "codigo": campos["codigo"],
                    "ambito": campos["ambito"],
                    "tipo_derecho": campos["tipo_derecho"],
                    "categoria_productiva": campos["categoria_productiva"],
                    "categoria_codigo": campos["categoria_codigo"],
                    "especie": campos["especie"],
                    "tipo_recurso": campos["tipo_recurso"],
                    "nombre_recurso": campos["nombre_recurso"],
                    "estado": campos["estado"],
                    "area_total_ha": campos["area_total_ha"],
                    "fecha_emision": campos["fecha_emision"],
                    "fecha_vigencia": campos["fecha_vigencia"],
                    "resolucion": campos["resolucion"],
                    "zona": campos["zona"],
                    "tipo_coord": campos["tipo_coord"],
                    "titular": campos["titular"],
                    "fid_origen": punto["fid_origen"],
                    "tipo_geometria": punto["tipo_geometria"],
                    "otros": campos["otros"],
                }
            )

            if punto["longitud"]:
                # Proyección publicable: sin `titular` ni `nombre`, que son PII. La
                # etiqueta da texto al popup sin exponer nombres de personas.
                if campos["tipo_registro"] == "derecho_acuicola":
                    etiqueta = f"Derecho acuícola {campos['codigo']}".strip()
                elif campos["identi"] == "PNACP":
                    etiqueta = campos["sede"] or "PNACP"
                else:
                    etiqueta = punto["nombre"]
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [
                                float(punto["longitud"]),
                                float(punto["latitud"]),
                            ],
                        },
                        "properties": {
                            "id": punto["id"],
                            "tipo_registro": campos["tipo_registro"],
                            "etiqueta": etiqueta,
                            "identi": campos["identi"],
                            "sede": campos["sede"],
                            "nombre_infraestructura": campos["nombre_infraestructura"],
                            "direccion": campos["direccion"],
                            "departamento": departamento,
                            "provincia": provincia,
                            "distrito": distrito,
                            "ubigeo": ubigeo,
                            "codigo": campos["codigo"],
                            "ambito": campos["ambito"],
                            "tipo_derecho": campos["tipo_derecho"],
                            "categoria_codigo": campos["categoria_codigo"],
                            "especie": campos["especie"],
                            "estado": campos["estado"],
                        },
                    }
                )

    ruta_geojson.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    repetidas = sum(c - 1 for c in coordenadas.values() if c > 1)

    lineas = [
        f"KML: {opciones.kml}",
        f"Puntos: {len(puntos)}",
        "",
        "Tipos de registro:",
        *(f"  {tipo}: {cantidad}" for tipo, cantidad in tipos.most_common()),
        "",
        "Instituciones (IDENTI):",
        *(
            f"  {nombre}: {cantidad}"
            for nombre, cantidad in instituciones.most_common()
        ),
        "",
        "Derechos acuícolas por ámbito:",
        *(f"  {ambito}: {cantidad}" for ambito, cantidad in ambitos.most_common()),
        "Por tipo de derecho:",
        *(f"  {tipo}: {cantidad}" for tipo, cantidad in derechos.most_common()),
        "Por categoría productiva:",
        *(f"  {codigo}: {cantidad}" for codigo, cantidad in categorias.most_common()),
        "",
        "Cobertura:",
        f"  Con distrito: {con_distrito}",
        f"  Con ubigeo: {con_ubigeo} de {len(puntos)}",
        f"  Con titular (PII): {con_titular}",
        f"  Sin geometría: {sin_geometria}",
        f"  Distritos (nombre): {len(distritos_simples)}",
        f"  Distritos (dpto+prov+dist): {len(distritos_completos)}",
        f"  Coordenadas repetidas: {repetidas}",
        f"  Lat/lon del globo != Point: {coords_distintas}",
    ]
    if resuelto:
        lineas.append("")
        lineas.append("Métodos de emparejamiento de ubigeo:")
        lineas.extend(
            f"  {metodo}: {cantidad}" for metodo, cantidad in metodos.most_common()
        )
        if cambios:
            lineas.append("")
            lineas.append(f"Nombres corregidos o canonizados ({len(cambios)}):")
            lineas.extend(
                f"  {d['provincia_origen']} / {d['distrito_origen']}"
                f"  ->  {d['provincia']} / {d['distrito']}  ({d['metodo_ubigeo']})"
                for d in cambios
            )
        if sin_ubigeo:
            lineas.append("")
            lineas.append(
                f"Sin ubigeo ({len(sin_ubigeo)} distritos, {sum(sin_ubigeo.values())} puntos):"
            )
            lineas.extend(
                f"  {dep} / {prov} / {dist}  ({cantidad} puntos)"
                for (dep, prov, dist), cantidad in sin_ubigeo.most_common()
            )
    lineas.append("")
    lineas.append("Especies más frecuentes:")
    lineas.extend(
        f"  {especie}: {cantidad}" for especie, cantidad in especies.most_common(15)
    )

    ruta_resumen = opciones.out_dir / "resumen.txt"
    ruta_resumen.write_text("\n".join(lineas) + "\n", encoding="utf-8")

    print(f"KML:                       {opciones.kml}")
    print(f"Puntos:                    {len(puntos)}")
    for tipo, cantidad in tipos.most_common():
        print(f"  {tipo:24} {cantidad}")
    print(f"Con distrito:              {con_distrito}")
    print(f"Con titular (PII):         {con_titular}")
    print(f"Sin geometría:             {sin_geometria}")
    print(f"Distritos (nombre):        {len(distritos_simples)}")
    print(f"Distritos (dpto+prov+dist): {len(distritos_completos)}")
    print(f"Coordenadas repetidas:     {repetidas}")
    print(f"Lat/lon del globo != Point: {coords_distintas}")
    if resuelto:
        print(f"Ubigeo resuelto:           {con_ubigeo} de {len(puntos)}")
        print("Métodos de emparejamiento:")
        for metodo, cantidad in metodos.most_common():
            print(f"  {metodo}: {cantidad}")
        if cambios:
            print(f"\nNombres corregidos o canonizados ({len(cambios)}):")
            for d in cambios[:40]:
                print(
                    f"  {d['provincia_origen']} / {d['distrito_origen']}"
                    f"  ->  {d['provincia']} / {d['distrito']}  ({d['metodo_ubigeo']})"
                )
        if sin_ubigeo:
            print(
                f"\nSin ubigeo ({len(sin_ubigeo)} distritos, {sum(sin_ubigeo.values())} puntos):"
            )
            for (dep, prov, dist), cantidad in sin_ubigeo.most_common(20):
                print(f"  {dep} / {prov} / {dist}  ({cantidad} puntos)")
    print("\nInstituciones (IDENTI):")
    for nombre, cantidad in instituciones.most_common():
        print(f"  {nombre}: {cantidad}")
    print(f"\nCSV:     {ruta_csv}")
    print(f"GeoJSON: {ruta_geojson}")
    print(f"Resumen: {ruta_resumen}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
