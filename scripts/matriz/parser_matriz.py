#!/usr/bin/env python
r"""Parser de la matriz de conflictos 2026 (formato A–Y) -> JSON.

Fuente: `docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx`,
hoja `CASOS OAIPCS - OPERATIVO`; complemento `METADATOS CASOS` para el código.

Reglas que no son obvias (y por qué)
------------------------------------
1. **Combinadas.** La hoja tiene ~405 rangos combinados. Si no se expanden, el
   90 % de las filas parece vacío. Se rellena cada rango con su celda origen.
2. **Inicio de caso.** Después de expandir, TODAS las filas de un bloque tienen
   el mismo `Nombre de Caso`. Un caso empieza donde la celda D es **origen
   propio** (valor real, no heredado). Segmentar por «D no vacía» daría 130
   bloques en vez de 37.
3. **El eje fino es la fila.** Cada fila es un hito, o una demanda sin hito.
   `K` va por fila; `M` va combinada por compromiso y se expande a varias filas.
   La relación demanda↔compromiso se obtiene por **coincidencia de fila**, no
   por producto cartesiano.
4. **La clave del hito es `(compromiso, R, S)`**, nunca `R` sola: `R` reinicia
   en `Hito 1` con cada compromiso.
5. **Celdas compuestas.** `I` y `J` traen varios actores. Se separan por doble
   salto, por `/` y por **coma de primer nivel** (respetando paréntesis), pero
   la coma sólo divide cuando al menos dos partes parecen entidades: así
   «Pescadores de Cabo Blanco, Órganos, Ñuro» queda entero.
6. **Código del caso.** `METADATOS CASOS` está alineada fila a fila y repite
   código/nombre por bloque; se resuelve por nombre normalizado y se valida por
   posición (`bloque_fila - 1`).

Uso:
    python scripts/matriz/parser_matriz.py
    python scripts/matriz/parser_matriz.py --verificar 3
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
HOJA_METADATOS = "METADATOS CASOS"
RUTA_SALIDA = Path("scripts/matriz/salida/matriz_2026.json")
RUTA_MAPA = Path("scripts/matriz/salida/mapa_matriz_excel.json")
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

CAMPOS_CASO = (
    "region",
    "sectorista",
    "linea_tiempo",
    "analisis",
    "descripcion_riesgo",
    "riesgo",
)

TEMATICAS = (
    "infraestructura",
    "ordenamiento y acceso territorial",
    "normatividad",
    "distribucion de beneficios",
    "gobernanza",
    "impactos de terceros",
)

# Nombre canónico del catálogo `core.cat_tematicas` (estable, no dato de caso).
CANONICO_TEMATICAS = {
    "infraestructura": "Infraestructura",
    "ordenamiento y acceso territorial": "Ordenamiento y acceso territorial",
    "normatividad": "Normatividad",
    "distribucion de beneficios": "Distribución de beneficios",
    "gobernanza": "Gobernanza",
    "impactos de terceros": "Impactos de terceros",
}

_SEPARADOR_ACTORES = re.compile(r"\n\s*\n+")
_SALTO = re.compile(r"\s*\n\s*")
_SIGLA = re.compile(r"\b[A-ZÁÉÍÓÚÑ0-9]{3,}\b")

_MARCAS_ENTIDAD = re.compile(
    r"\b(asociacion|asociaciones|gremio|gremios|ospa|ospas|sindicato|sindicatos|"
    r"comite|comites|federacion|federaciones|cooperativa|cooperativas|"
    r"confederacion|camara|union|consejo|municipalidad|direccion|ministerio|"
    r"instituto|oficina|procuraduria|autoridad|empresa|consorcio)\b"
)
_TITULOS = re.compile(
    r"\b(ing|sr|sra|srta|blgo|lic|dr|dra|alcalde|alcaldesa|congresista|"
    r"presidente|presidenta|gestor|gestora|representante|gobernador|"
    r"consejero|director|directora|secretario|secretaria)\b"
)
_CARGOS = (
    "presidente",
    "presidenta",
    "vicepresidente",
    "secretario",
    "secretaria",
    "director",
    "directora",
    "gerente",
    "representante",
    "coordinador",
    "coordinadora",
    "alcalde",
    "alcaldesa",
    "congresista",
    "gestor",
    "gestora",
    "delegado",
    "delegada",
    "titular",
    "ex presidente",
    "ex presidenta",
)


def norm(texto: str | None) -> str:
    valor = unicodedata.normalize("NFKD", texto or "")
    valor = "".join(c for c in valor if not unicodedata.combining(c))
    valor = "".join(c.lower() if c.isalnum() else " " for c in valor)
    return " ".join(valor.split())


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


def _dividir_primer_nivel(texto: str, separador: str) -> list[str]:
    """Divide por `separador` sólo fuera de paréntesis."""
    partes: list[str] = []
    actual: list[str] = []
    profundidad = 0
    for caracter in texto:
        if caracter == "(":
            profundidad += 1
        elif caracter == ")":
            profundidad = max(0, profundidad - 1)
        if caracter == separador and profundidad == 0:
            partes.append("".join(actual))
            actual = []
            continue
        actual.append(caracter)
    partes.append("".join(actual))
    return [p.strip() for p in partes if p.strip()]


def _parece_entidad(parte: str) -> bool:
    texto = norm(parte)
    return bool(
        _MARCAS_ENTIDAD.search(texto) or _TITULOS.search(texto) or _SIGLA.search(parte)
    )


def partir_actores(crudo: str) -> list[str]:
    """Separa actores de una celda compuesta, sin romper listas de lugares."""
    if not crudo.strip():
        return []
    salida: list[str] = []
    for bloque in _SEPARADOR_ACTORES.split(crudo):
        por_coma = _dividir_primer_nivel(bloque, ",")
        if len(por_coma) > 1 and sum(1 for p in por_coma if _parece_entidad(p)) >= 2:
            candidatos = por_coma
        else:
            candidatos = [bloque]
        for candidato in candidatos:
            for parte in _dividir_primer_nivel(candidato, "/"):
                limpio = parte.strip(" ;,\n")
                if limpio:
                    salida.append(limpio)
    return salida


def analizar_actor(actor: str) -> dict[str, Any]:
    """Nombre, cargo, institución y teléfono de un bloque de actor."""
    lineas = [l.strip() for l in _SALTO.split(actor) if l.strip()]
    telefono = None
    cargo = None
    institucion = None
    for linea in lineas:
        coincidencia = re.search(
            r"(?:cel|tel|telf|teléfono|telefono)\.?\s*:?\s*([0-9][0-9\s-]{6,})",
            linea,
            re.I,
        )
        if not telefono and coincidencia:
            telefono = re.sub(r"\D", "", coincidencia.group(1))
        if not telefono and re.fullmatch(r"9\d{2}[\s-]?\d{3}[\s-]?\d{3}", linea):
            telefono = re.sub(r"\D", "", linea)
    for linea in lineas[1:]:
        minuscula = norm(linea)
        if telefono and re.sub(r"\D", "", linea) == telefono:
            continue
        if cargo is None and any(c in minuscula for c in _CARGOS):
            cargo = linea
            continue
        if institucion is None and _MARCAS_ENTIDAD.search(minuscula):
            institucion = linea
    # Si el cargo nombra la institución («Director de la DIREPRO»), se deriva.
    if institucion is None and cargo:
        derivada = re.search(r"\b(?:de la|del|de)\s+([A-ZÁÉÍÓÚÑ].+)$", cargo)
        if derivada:
            institucion = derivada.group(1).strip()
    nombre = lineas[0] if lineas else None
    persona, organizacion = dividir_persona_organizacion(nombre or "")
    if persona:
        nombre = persona
    return {
        "nombre": nombre,
        "representa_a": organizacion,
        "cargo": cargo,
        "institucion": institucion,
        "telefono": telefono,
        "detalle": lineas[1:],
        "crudo": actor,
    }


def _parece_persona(texto: str) -> bool:
    palabras = [p for p in texto.split() if p]
    if not 2 <= len(palabras) <= 5:
        return False
    if _MARCAS_ENTIDAD.search(norm(texto)) or _SIGLA.search(texto):
        return False
    return all(p[:1].isupper() or p[:1] in "ÁÉÍÓÚÑ" for p in palabras if len(p) > 2)


def dividir_persona_organizacion(texto: str) -> tuple[str | None, str | None]:
    """«Nombre Apellido - Asociación X» -> (persona, organización)."""
    partes = re.split(r"\s+[-–—]\s+", texto, maxsplit=1)
    if len(partes) == 2:
        izquierda, derecha = partes[0].strip(), partes[1].strip()
        if _parece_persona(izquierda) and _MARCAS_ENTIDAD.search(norm(derecha)):
            return izquierda, derecha
    return None, None


def separar_plan(texto: str) -> tuple[str | None, str]:
    """Si el compromiso empieza con un plan y sigue la acción, los separa."""
    lineas = [l.strip() for l in texto.split("\n") if l.strip()]
    if len(lineas) >= 2 and norm(lineas[0]).startswith("plan "):
        return lineas[0].rstrip(":"), " ".join(lineas[1:])
    return None, texto


def normalizar_tematica(crudo: str) -> str | None:
    """Nombre canónico del catálogo, corrigiendo la errata de origen."""
    limpio = re.sub(r"ordenanamiento", "ordenamiento", crudo, flags=re.I)
    clave = norm(limpio)
    return CANONICO_TEMATICAS.get(clave)


def _expandir(hoja) -> tuple[dict[tuple[int, int], Any], set[tuple[int, int]]]:
    expandido: dict[tuple[int, int], Any] = {}
    origenes: set[tuple[int, int]] = set()
    for rango in hoja.merged_cells.ranges:
        valor = hoja.cell(rango.min_row, rango.min_col).value
        origenes.add((rango.min_row, rango.min_col))
        for fila in range(rango.min_row, rango.max_row + 1):
            for col in range(rango.min_col, rango.max_col + 1):
                expandido[(fila, col)] = valor
    return expandido, origenes


def leer_metadatos(libro) -> dict[str, dict[str, Any]]:
    """Código, fecha y sectorista por nombre de caso normalizado."""
    if HOJA_METADATOS not in libro.sheetnames:
        return {}
    hoja = libro[HOJA_METADATOS]
    expandido, _ = _expandir(hoja)

    def valor(fila: int, col: int) -> Any:
        return expandido.get((fila, col), hoja.cell(fila, col).value)

    mapa: dict[str, dict[str, Any]] = {}
    por_fila: dict[int, dict[str, Any]] = {}
    for fila in range(2, hoja.max_row + 1):
        codigo = como_texto(valor(fila, 1))
        nombre = como_texto(valor(fila, 6))
        if not nombre or not re.match(r"^[A-Z]{2}-[A-Z]{2}-", codigo or ""):
            continue
        entrada = {
            "codigo": codigo,
            "fecha_registro": como_fecha(valor(fila, 2))[0],
            "sectorista": como_texto(valor(fila, 4)) or None,
            "prioridad": como_texto(valor(fila, 5)) or None,
        }
        mapa.setdefault(norm(nombre), entrada)
        por_fila[fila] = entrada
    return mapa, por_fila


def parsear(
    ruta: Path = RUTA_XLSX, ruta_mapa: Path | None = RUTA_MAPA
) -> dict[str, Any]:
    libro = load_workbook(ruta, data_only=True)
    hoja = libro[HOJA]
    idx = {clave: col_idx(letra) for clave, letra in COLUMNAS.items()}
    expandido, origenes = _expandir(hoja)

    def valor(fila: int, clave: str) -> Any:
        col = idx[clave]
        return expandido.get((fila, col), hoja.cell(fila, col).value)

    def texto(fila: int, clave: str) -> str:
        return como_texto(valor(fila, clave))

    inicios = [
        fila
        for fila in range(PRIMERA_FILA, hoja.max_row + 1)
        if como_texto(hoja.cell(fila, idx["nombre_caso"]).value)
        or (fila, idx["nombre_caso"]) in origenes
    ]

    ultima_fila = PRIMERA_FILA
    for fila in range(PRIMERA_FILA, hoja.max_row + 1):
        if any(
            como_texto(hoja.cell(fila, col_idx(clave)).value)
            for clave in COLUMNAS.values()
        ):
            ultima_fila = fila

    metadatos, metadatos_fila = leer_metadatos(libro)

    mapa_codigos: dict[int, str] = {}
    mapa_casos: dict[int, dict[str, Any]] = {}
    ruta_mapa = Path(ruta_mapa) if ruta_mapa else None
    if ruta_mapa and ruta_mapa.exists():
        for entrada in json.loads(ruta_mapa.read_text(encoding="utf-8")):
            bloque = entrada.get("bloque_fila")
            if not bloque:
                continue
            mapa_casos[int(bloque)] = entrada
            if entrada.get("codigo_excel"):
                mapa_codigos[int(bloque)] = entrada["codigo_excel"]

    casos: list[dict[str, Any]] = []
    anomalias: list[dict[str, Any]] = []
    for posicion, inicio in enumerate(inicios):
        fin = (
            (inicios[posicion + 1] - 1) if posicion + 1 < len(inicios) else ultima_fila
        )
        nombre = texto(inicio, "nombre_caso")

        demandas: dict[str, dict[str, Any]] = {}
        compromisos: dict[str, dict[str, Any]] = {}
        hitos: list[dict[str, Any]] = []
        pares: set[tuple[str, str]] = set()
        actores: list[dict[str, Any]] = []
        vistos: set[str] = set()

        for fila in range(inicio, fin + 1):
            k = texto(fila, "demanda")
            m = texto(fila, "compromiso")
            r = texto(fila, "hito")
            s = texto(fila, "descripcion_hito")

            if k:
                tematica = texto(fila, "tematica") or None
                demandas.setdefault(
                    k,
                    {
                        "texto": k,
                        "tematica": tematica,
                        "tematica_normalizada": normalizar_tematica(tematica)
                        if tematica
                        else None,
                        "fila": fila,
                    },
                )
                if tematica and not normalizar_tematica(tematica):
                    anomalias.append(
                        {
                            "tipo": "tematica_fuera_catalogo",
                            "caso": nombre,
                            "fila": fila,
                            "valor": tematica,
                        }
                    )
            if m:
                plan, accion = separar_plan(m)
                compromisos.setdefault(
                    m,
                    {
                        "texto": m,
                        "plan": plan,
                        "accion": accion,
                        "fuente": texto(fila, "fuente_compromiso") or None,
                        "area_responsable": texto(fila, "area_responsable") or None,
                        "punto_focal": texto(fila, "punto_focal") or None,
                        "status": texto(fila, "status") or None,
                        "fila": fila,
                    },
                )
            if k and m:
                pares.add((k, m))
            if r or s:
                if not m:
                    anomalias.append(
                        {
                            "tipo": "hito_sin_compromiso",
                            "caso": nombre,
                            "fila": fila,
                            "hito": r or None,
                        }
                    )
                if not r:
                    # Fila con descripción de hito y sin etiqueta «Hito N»: se
                    # recupera como hito real y se declara la carencia.
                    anomalias.append(
                        {
                            "tipo": "hito_sin_etiqueta",
                            "caso": nombre,
                            "fila": fila,
                            "descripcion": s[:120],
                        }
                    )
                planificada, planificada_texto = como_fecha(
                    valor(fila, "fecha_planificada")
                )
                real, real_texto = como_fecha(valor(fila, "fecha_real"))
                hitos.append(
                    {
                        "compromiso": m or None,
                        "etiqueta": r or None,
                        "descripcion": s or None,
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

        for clave, origen in (
            ("actores_estado", "Estado"),
            ("actores_sociedad", "Sociedad civil"),
        ):
            for actor in partir_actores(texto(inicio, clave)):
                analizado = analizar_actor(actor)
                huella = norm(analizado["nombre"] or actor)
                if huella in vistos:
                    continue
                vistos.add(huella)
                actores.append({"origen": origen, **analizado})
                if analizado.get("representa_a"):
                    organizacion = analizado["representa_a"]
                    if norm(organizacion) not in vistos:
                        vistos.add(norm(organizacion))
                        actores.append(
                            {
                                "origen": origen,
                                "nombre": organizacion,
                                "cargo": None,
                                "institucion": organizacion,
                                "telefono": None,
                                "detalle": [],
                                "crudo": organizacion,
                                "representa_a": None,
                            }
                        )

        sin_hitos = [
            c
            for c in compromisos
            if c not in {h["compromiso"] for h in hitos if h["compromiso"]}
        ]
        if sin_hitos:
            anomalias.append(
                {
                    "tipo": "compromiso_sin_hitos",
                    "caso": nombre,
                    "cantidad": len(sin_hitos),
                }
            )
        if not demandas:
            anomalias.append({"tipo": "caso_sin_demandas", "caso": nombre})

        meta = (
            metadatos.get(norm(nombre))
            or metadatos_fila.get(inicio - 1)
            or metadatos_fila.get(inicio)
            or {}
        )
        completitud = {campo: bool(texto(inicio, campo)) for campo in CAMPOS_CASO}
        casos.append(
            {
                "n": texto(inicio, "n") or None,
                "codigo_excel": meta.get("codigo") or mapa_codigos.get(inicio),
                "caso_id_existente": (mapa_casos.get(inicio) or {}).get("caso_id"),
                "clave_importacion": (mapa_casos.get(inicio) or {}).get("caso_id")
                or f"nuevo-{inicio}",
                "mapa_confianza": (mapa_casos.get(inicio) or {}).get("confianza"),
                "fecha_registro": meta.get("fecha_registro"),
                "nombre": nombre,
                "region": texto(inicio, "region") or None,
                "sectorista": texto(inicio, "sectorista") or meta.get("sectorista"),
                "prioridad_excel": meta.get("prioridad"),
                "linea_tiempo": texto(inicio, "linea_tiempo") or None,
                "analisis": texto(inicio, "analisis") or None,
                "descripcion_riesgo": texto(inicio, "descripcion_riesgo") or None,
                "riesgo": texto(inicio, "riesgo") or None,
                "filas": [inicio, fin],
                "altura": fin - inicio + 1,
                "completitud": completitud,
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

    compartidos: dict[str, set[str]] = defaultdict(set)
    demandas_por_caso: dict[str, set[str]] = defaultdict(set)
    for caso in casos:
        for compromiso in caso["compromisos"]:
            compartidos[compromiso["texto"]].add(caso["nombre"])
        for demanda in caso["demandas"]:
            demandas_por_caso[demanda["texto"]].add(caso["nombre"])

    demands_por_compromiso = Counter()
    for caso in casos:
        por_compromiso: dict[str, set[str]] = defaultdict(set)
        for vinculo in caso["vinculos_demanda_compromiso"]:
            por_compromiso[vinculo["compromiso"]].add(vinculo["demanda"])
        demands_por_compromiso.update(len(v) for v in por_compromiso.values())

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
        "demandas_por_compromiso": dict(demands_por_compromiso),
        "casos_sin_demandas": sum(1 for c in casos if not c["demandas"]),
        "actores": sum(len(c["actores"]) for c in casos),
        "casos_con_codigo": sum(1 for c in casos if c["codigo_excel"]),
        "casos_con_caso_id": sum(1 for c in casos if c["caso_id_existente"]),
        "completitud": dict(
            Counter(
                campo for c in casos for campo, ok in c["completitud"].items() if ok
            )
        ),
        "anomalias_por_tipo": dict(Counter(a["tipo"] for a in datos["anomalias"])),
    }


def imprimir_casos(datos: dict[str, Any], cuantos: int, semilla: int = 42) -> None:
    elegidos = random.Random(semilla).sample(
        datos["casos"], min(cuantos, len(datos["casos"]))
    )
    for caso in elegidos:
        print(f"\n=== {caso['nombre'][:78]} ===")
        print(
            f"  código={caso['codigo_excel']!r} filas={caso['filas']} riesgo={caso['riesgo']!r} "
            f"sectorista={caso['sectorista']!r}"
        )
        print(f"  demandas ({len(caso['demandas'])}):")
        for d in caso["demandas"]:
            print(
                f"    - [{d['tematica_normalizada'] or d['tematica']}] {d['texto'][:62]}"
            )
        print(f"  compromisos ({len(caso['compromisos'])}):")
        for c in caso["compromisos"]:
            plan = f"[{c['plan'][:34]}] " if c["plan"] else ""
            print(f"    - {plan}{c['accion'][:58]!r} · área={c['area_responsable']!r}")
        print(f"  hitos ({len(caso['hitos'])})")
        print(f"  actores ({len(caso['actores'])}):")
        for a in caso["actores"][:5]:
            print(
                f"    - {a['nombre']!r} cargo={a['cargo']!r} inst={a['institucion']!r} tel={a['telefono']!r}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verificar", type=int, default=0, metavar="N")
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
