#!/usr/bin/env python
r"""Parser de la matriz de conflictos 2026 (formato A–Y) -> JSON.

Fuente: `docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx`,
hoja `CASOS OAIPCS - OPERATIVO`.

Sólo lectura del XLSX: no abre conexión a la base.

Reglas que no son obvias (y por qué)
------------------------------------
1. **Combinadas.** La hoja tiene ~405 rangos combinados. Si no se expanden, el
   90 % de las filas parece vacío. Se rellena cada rango con el valor de su
   celda origen.
2. **Inicio de caso.** Después de expandir, TODAS las filas de un bloque tienen
   el mismo `Nombre de Caso`. Un caso empieza donde la celda D es el **origen
   propio** de la combinada (valor real, no heredado). Segmentar por «D no
   vacía» daría 130 bloques en vez de 37.
3. **El eje fino es la fila.** Cada fila es un hito, o una demanda sin hito.
   `K` (demanda) va por fila; `M` (compromiso) va combinada por compromiso y se
   expande a varias filas. Por eso un compromiso puede cubrir varias demandas:
   la relación demanda↔compromiso se obtiene por **coincidencia de fila**, no
   por producto cartesiano.
4. **La clave del hito es `(compromiso, R, S)`**, nunca `R` sola: la columna R
   reinicia en `Hito 1` con cada compromiso.
5. **Actores.** `I` y `J` están combinadas por caso y traen varios actores en
   una celda, separados por doble salto de línea (`\n\s*\n`). No se parten por
   `/` para no romper siglas compuestas.

Uso:
    python scripts/matriz/parser_matriz.py                # parsea y escribe JSON
    python scripts/matriz/parser_matriz.py --verificar 3  # parsea y muestra 3 casos
"""

from __future__ import annotations

import argparse
import json
import random
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string as col_idx

RUTA_XLSX = Path("docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx")
HOJA = "CASOS OAIPCS - OPERATIVO"
RUTA_SALIDA = Path("scripts/matriz/salida/matriz_2026.json")
PRIMERA_FILA = 3

COLUMNAS = {
    "n": "A",
    "region": "B",
    "sectorista": "C",
    "nombre_caso": "D",
    "linea_tiempo": "E",
    "analisis": "F",
    "descripcion_riesgo": "G",
    "riesgo": "H",
    "actores_estado": "I",
    "actores_sociedad": "J",
    "demanda": "K",
    "tematica": "L",
    "compromiso": "M",
    "fuente_compromiso": "N",
    "area_responsable": "O",
    "punto_focal": "P",
    "status": "Q",
    "hito": "R",
    "descripcion_hito": "S",
    "responsable_hito": "T",
    "fecha_planificada": "U",
    "fecha_real": "V",
    "estado_hito": "W",
    "medios_verificacion": "X",
    "documentos": "Y",
}

_SEPARADOR_ACTORES = re.compile(r"\n\s*\n+")
_SALTO = re.compile(r"\s*\n\s*")


def normalizar(texto: str) -> str:
    """Minúsculas, sin tildes y con espacios colapsados (para comparar)."""
    sin = unicodedata.normalize("NFKD", texto)
    sin = "".join(c for c in sin if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sin).strip().lower()


def como_texto(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, datetime):
        return valor.date().isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def como_fecha(valor: Any) -> tuple[str | None, str | None]:
    """Devuelve (iso, crudo). `iso` sólo si la fecha es inequívoca."""
    if valor is None:
        return None, None
    if isinstance(valor, datetime):
        return valor.date().isoformat(), None
    if isinstance(valor, date):
        return valor.isoformat(), None
    crudo = como_texto(valor)
    if not crudo:
        return None, None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}([ T].*)?", crudo):
        return crudo[:10], None
    return None, crudo


def partir_actores(crudo: str) -> list[str]:
    """Separa actores por doble salto de línea y por barras.

    Las barras separan actores distintos (`DIREPRO Piura / DIREPRO Ica`), no
    siglas compuestas. Se conserva el crudo de cada parte para no perder nada.
    """
    if not crudo.strip():
        return []
    partes: list[str] = []
    for bloque in _SEPARADOR_ACTORES.split(crudo):
        for parte in re.split(r"\s*/\s*|/", bloque):
            limpio = parte.strip(" ;,\n")
            if limpio:
                partes.append(limpio)
    return partes


def responsable_de(actor: str) -> dict[str, Any]:
    """Separa nombre, cargo, teléfono e institución de un bloque de actor."""
    lineas = [l.strip() for l in _SALTO.split(actor) if l.strip()]
    telefono = None
    for linea in lineas:
        match = re.search(
            r"(?:cel|tel|telf|teléfono|telefono)\.?\s*:?\s*([0-9][0-9\s-]{6,})",
            linea,
            re.I,
        )
        if match:
            telefono = re.sub(r"\D", "", match.group(1))
            break
        if re.fullmatch(r"9\d{2}[\s-]?\d{3}[\s-]?\d{3}", linea):
            telefono = re.sub(r"\D", "", linea)
            break
    return {
        "nombre": lineas[0] if lineas else None,
        "detalle": lineas[1:],
        "telefono": telefono,
        "crudo": actor,
    }


def parsear(ruta: Path = RUTA_XLSX) -> dict[str, Any]:
    libro = load_workbook(ruta, data_only=True)
    hoja = libro[HOJA]
    idx = {clave: col_idx(letra) for clave, letra in COLUMNAS.items()}

    # 1 · Expansión de combinadas y registro de los orígenes reales.
    expandido: dict[tuple[int, int], Any] = {}
    origenes: set[tuple[int, int]] = set()
    for rango in hoja.merged_cells.ranges:
        valor = hoja.cell(rango.min_row, rango.min_col).value
        origenes.add((rango.min_row, rango.min_col))
        for fila in range(rango.min_row, rango.max_row + 1):
            for col in range(rango.min_col, rango.max_col + 1):
                expandido[(fila, col)] = valor

    def valor(fila: int, clave: str) -> Any:
        col = idx[clave]
        return expandido.get((fila, col), hoja.cell(fila, col).value)

    def texto(fila: int, clave: str) -> str:
        return como_texto(valor(fila, clave))

    # 2 · Inicios de bloque: la celda D tiene valor propio.
    inicios = [
        fila
        for fila in range(PRIMERA_FILA, hoja.max_row + 1)
        if como_texto(hoja.cell(fila, idx["nombre_caso"]).value)
        or (fila, idx["nombre_caso"]) in origenes
    ]

    # Última fila con dato real (columnas A–Y). El bloque final no debe
    # absorberse hasta la fila 1000, que está vacía.
    ultima_fila = PRIMERA_FILA
    for fila in range(PRIMERA_FILA, hoja.max_row + 1):
        if any(
            como_texto(hoja.cell(fila, col_idx(clave)).value)
            for clave in COLUMNAS.values()
        ):
            ultima_fila = fila

    casos: list[dict[str, Any]] = []
    anomalias: list[dict[str, Any]] = []
    for posicion, inicio in enumerate(inicios):
        fin = (
            (inicios[posicion + 1] - 1) if posicion + 1 < len(inicios) else ultima_fila
        )

        demandas: dict[str, dict[str, Any]] = {}
        compromisos: dict[str, dict[str, Any]] = {}
        hitos: list[dict[str, Any]] = []
        pares: set[tuple[str, str]] = set()

        for fila in range(inicio, fin + 1):
            k = texto(fila, "demanda")
            m = texto(fila, "compromiso")
            r = texto(fila, "hito")
            if k:
                demandas.setdefault(
                    k,
                    {
                        "texto": k,
                        "tematica": texto(fila, "tematica") or None,
                        "fila": fila,
                    },
                )
            if m:
                compromisos.setdefault(
                    m,
                    {
                        "texto": m,
                        "fuente": texto(fila, "fuente_compromiso") or None,
                        "area_responsable": texto(fila, "area_responsable") or None,
                        "punto_focal": texto(fila, "punto_focal") or None,
                        "status": texto(fila, "status") or None,
                        "fila": fila,
                    },
                )
            if k and m:
                pares.add((k, m))
            if r:
                if not m:
                    anomalias.append(
                        {
                            "caso": texto(inicio, "nombre_caso"),
                            "fila": fila,
                            "motivo": "hito sin compromiso",
                            "hito": r,
                        }
                    )
                planificada, planificada_texto = como_fecha(
                    valor(fila, "fecha_planificada")
                )
                real, real_texto = como_fecha(valor(fila, "fecha_real"))
                hitos.append(
                    {
                        "compromiso": m or None,
                        "etiqueta": r,
                        "descripcion": texto(fila, "descripcion_hito") or None,
                        "responsable": texto(fila, "responsable_hito") or None,
                        "fecha_planificada": planificada,
                        "fecha_planificada_texto": planificada_texto,
                        "fecha_real": real,
                        "fecha_real_texto": real_texto,
                        "estado": texto(fila, "estado_hito") or None,
                        "medios": texto(fila, "medios_verificacion") or None,
                        "documentos": texto(fila, "documentos") or None,
                        "fila": fila,
                    }
                )

        actores = []
        for clave, origen in (
            ("actores_estado", "Estado"),
            ("actores_sociedad", "Sociedad civil"),
        ):
            for actor in partir_actores(texto(inicio, clave)):
                actores.append({"origen": origen, **responsable_de(actor)})

        casos.append(
            {
                "n": texto(inicio, "n") or None,
                "nombre": texto(inicio, "nombre_caso"),
                "region": texto(inicio, "region") or None,
                "sectorista": texto(inicio, "sectorista") or None,
                "linea_tiempo": texto(inicio, "linea_tiempo") or None,
                "analisis": texto(inicio, "analisis") or None,
                "descripcion_riesgo": texto(inicio, "descripcion_riesgo") or None,
                "riesgo": texto(inicio, "riesgo") or None,
                "filas": [inicio, fin],
                "altura": fin - inicio + 1,
                "actores": actores,
                "demandas": sorted(demandas.values(), key=lambda d: d["fila"]),
                "compromisos": sorted(compromisos.values(), key=lambda c: c["fila"]),
                "hitos": hitos,
                "vinculos_demanda_compromiso": [
                    {"demanda": k, "compromiso": m} for k, m in sorted(pares)
                ],
            }
        )

    return {"fuente": str(ruta), "hoja": HOJA, "casos": casos, "anomalias": anomalias}


def resumen(datos: dict[str, Any]) -> dict[str, Any]:
    casos = datos["casos"]
    textos_demanda = [d["texto"] for c in casos for d in c["demandas"]]
    textos_compromiso = [m["texto"] for c in casos for m in c["compromisos"]]
    compartidos = defaultdict(set)
    for caso in casos:
        for compromiso in caso["compromisos"]:
            compartidos[compromiso["texto"]].add(caso["nombre"])

    demandas_por_caso = defaultdict(set)
    for caso in casos:
        for demanda in caso["demandas"]:
            demandas_por_caso[demanda["texto"]].add(caso["nombre"])

    demandas_por_compromiso = Counter()
    for caso in casos:
        por_compromiso = defaultdict(set)
        for vinculo in caso["vinculos_demanda_compromiso"]:
            por_compromiso[vinculo["compromiso"]].add(vinculo["demanda"])
        demandas_por_compromiso.update(len(v) for v in por_compromiso.values())

    return {
        "casos": len(casos),
        "alturas": dict(Counter(c["altura"] for c in casos)),
        "pares_caso_demanda": len(textos_demanda),
        "demandas_texto_distintas": len(set(textos_demanda)),
        "demandas_compartidas": sum(
            1 for v in demandas_por_caso.values() if len(v) > 1
        ),
        "pares_caso_compromiso": len(textos_compromiso),
        "compromisos_texto_distintos": len(set(textos_compromiso)),
        "compromisos_compartidos_entre_casos": sum(
            1 for v in compartidos.values() if len(v) > 1
        ),
        "hitos": sum(len(c["hitos"]) for c in casos),
        "pares_demanda_compromiso": sum(
            len(c["vinculos_demanda_compromiso"]) for c in casos
        ),
        "demandas_por_compromiso": dict(demandas_por_compromiso),
        "casos_sin_demandas": sum(1 for c in casos if not c["demandas"]),
        "anomalias": len(datos["anomalias"]),
    }


def imprimir_casos(datos: dict[str, Any], cuantos: int, semilla: int = 42) -> None:
    elegidos = random.Random(semilla).sample(
        datos["casos"], min(cuantos, len(datos["casos"]))
    )
    for caso in elegidos:
        print(f"\n=== {caso['nombre'][:80]} ===")
        print(
            f"  filas {caso['filas']} · riesgo={caso['riesgo']!r} · sectorista={caso['sectorista']!r}"
        )
        print(f"  demandas ({len(caso['demandas'])}):")
        for d in caso["demandas"]:
            print(f"    - [{d['tematica']}] {d['texto'][:70]}")
        print(f"  compromisos ({len(caso['compromisos'])}):")
        for c in caso["compromisos"]:
            print(
                f"    - {c['texto'][:70]!r} · área={c['area_responsable']!r} · focal={c['punto_focal']!r}"
            )
        print(f"  hitos ({len(caso['hitos'])}):")
        for h in caso["hitos"]:
            print(
                f"    - {h['etiqueta']!r} {h['estado']!r} real={h['fecha_real']!r} · {h['descripcion'][:50] if h['descripcion'] else ''}"
            )
        print(
            f"  actores ({len(caso['actores'])}): {[a['nombre'] for a in caso['actores'][:4]]}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verificar", type=int, default=0, metavar="N", help="muestra N casos al azar"
    )
    parser.add_argument("--salida", default=str(RUTA_SALIDA))
    args = parser.parse_args()

    datos = parsear()
    datos["resumen"] = resumen(datos)
    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Escrito {salida} · {len(datos['casos'])} casos")
    print(json.dumps(datos["resumen"], ensure_ascii=False, indent=2))
    if args.verificar:
        imprimir_casos(datos, args.verificar)


if __name__ == "__main__":
    main()
