#!/usr/bin/env python
"""Diagnóstico de duplicados e inconsistencias del padrón (SÓLO LECTURA).

Lee `core.actores` (~1190 filas) y `core.organizaciones` (224), detecta:

1. duplicados exactos (nombre normalizado),
2. duplicados por siglas (columna `abreviatura`, paréntesis y tokens en
   mayúsculas de 4+ letras dentro del nombre),
3. duplicados por similitud (`rapidfuzz` >= 0.92 y embeddings locales con
   `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, coseno >= 0.90),
4. inconsistencias de tipo (personas con nombre de organización),
5. huérfanos y vacíos,

y escribe `scripts/matriz/salida/duplicados.json`.

No modifica la base: la sesión se abre con `readonly=True`, se fija
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` y sólo se ejecutan
SELECT. No fusiona, no borra, no actualiza.

Uso:
    python scripts/matriz/detectar_duplicados.py
    python scripts/matriz/detectar_duplicados.py --dsn postgresql://…

El DSN se busca en `--dsn`, `AVISA_DSN`, `DATABASE_URL` y `NEON_OWNER_URL`
(entorno y `.env`), en ese orden, usando el primero que responda.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

# Offline antes de importar sentence-transformers: nada de descargas.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = Path(__file__).resolve().parent / "salida" / "duplicados.json"

MODELO_EMBEDDINGS = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
UMBRAL_FUZZY = 0.92
UMBRAL_EMBEDDINGS = 0.90
UMBRAL_COMPATIBILIDAD = 0.88
MAX_MIEMBROS_GRUPO = 12
LARGO_MINIMO_SIMILITUD = 4

PALABRAS_ORGANIZACION = (
    "ospa",
    "ospas",
    "gremio",
    "gremios",
    "asociacion",
    "asociaciones",
    "sindicato",
    "sindicatos",
    "comite",
    "comites",
    "federacion",
    "federaciones",
    "cooperativa",
    "cooperativas",
    "municipalidad",
    "municipalidades",
    "direccion",
    "direcciones",
    "ministerio",
    "ministerios",
    "instituto",
    "institutos",
    "procuraduria",
    "procuradurias",
)
RE_ORGANIZACION = re.compile(
    r"\b("
    + "|".join(sorted(set(PALABRAS_ORGANIZACION), key=len, reverse=True))
    + r")\b"
)

REGIONES = [
    "madre de dios",
    "la libertad",
    "san martin",
    "tumbes",
    "piura",
    "lambayeque",
    "ancash",
    "lima",
    "callao",
    "ica",
    "arequipa",
    "moquegua",
    "tacna",
    "puno",
    "cusco",
    "apurimac",
    "ayacucho",
    "huancavelica",
    "junin",
    "huanuco",
    "pasco",
    "ucayali",
    "loreto",
    "amazonas",
    "cajamarca",
]

GENERICOS_SIGLAS = {
    "SAC",
    "SAA",
    "SRL",
    "SA",
    "SAS",
    "EIRL",
    "EIR",
    "LTDA",
    "SOCIEDAD",
    "EMPRESA",
    "PERU",
    "DNI",
    "RUC",
    "DEL",
    "LAS",
    "LOS",
    "POR",
    "PARA",
    "CON",
    "SIN",
    "OTROS",
    "TODAS",
    "TODOS",
    "NACION",
    "ESTADO",
    # Palabras de denominación genérica: no identifican una organización.
    "ASOCIACION",
    "ASOCIACIONES",
    "PESCADORES",
    "PESCADOR",
    "ARTESANALES",
    "ARTESANAL",
    "ARMADORES",
    "ARMADOR",
    "GREMIOS",
    "COMITES",
    "SINDICATOS",
    "FEDERACIONES",
    "COOPERATIVAS",
    "MUNICIPALIDADES",
    "DIRECCIONES",
    "MINISTERIOS",
    "INSTITUTOS",
    "PROCURADURIAS",
    "EXTRACTORES",
    "ACUICULTORES",
    "MARICULTORES",
    "PRODUCTORES",
    "AGRICULTORES",
    "DUDOSO",
    "DUDOSA",
}

PALABRAS_VACIAS = {"de", "del", "la", "el", "los", "las", "y", "en", "a"}

ORDEN_MOTIVO = {"exacto": 0, "tipo": 1, "siglas": 2, "similitud": 3}


# --------------------------------------------------------------------------
# Normalización
# --------------------------------------------------------------------------


def plegar(texto: str) -> str:
    """Quita tildes/diacríticos sin cambiar el caso."""
    descompuesto = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn")


def normalizar(texto: str) -> str:
    """Minúsculas, sin puntuación, espacios colapsados y sin tildes."""
    limpio = plegar(texto).lower().replace("&", " y ")
    limpio = re.sub(r"[^a-z0-9]+", " ", limpio)
    return re.sub(r"\s+", " ", limpio).strip()


def compactar(sigla: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", plegar(sigla).upper())


def extraer_siglas(nombre: str, abreviatura: str | None) -> list[dict]:
    """Siglas visibles: columna, paréntesis y tokens en mayúsculas de 4+."""
    halladas: list[dict] = []
    vistos: set[str] = set()

    def agregar(valor: str, fuente: str) -> None:
        valor = (valor or "").strip().strip(".,;:")
        if not valor:
            return
        clave = compactar(valor)
        if not clave or clave in vistos:
            return
        letras = sum(c.isalpha() for c in clave)
        if len(clave) < 2 or letras < 2:
            return
        vistos.add(clave)
        halladas.append({"sigla": valor, "compacta": clave, "fuente": fuente})

    if abreviatura:
        agregar(abreviatura, "abreviatura")

    texto = plegar(nombre or "")
    for contenido in re.findall(r"[\(\[]([^\)\]]{2,40})[\)\]]", texto):
        agregar(contenido, "parentesis")

    # Un nombre íntegramente en mayúsculas no distingue siglas: el token en
    # mayúsculas sólo se busca cuando el nombre es de caso mixto.
    letras_texto = [c for c in texto if c.isalpha()]
    proporcion_mayusculas = (
        sum(1 for c in letras_texto if c.isupper()) / len(letras_texto)
        if letras_texto
        else 0.0
    )
    if proporcion_mayusculas < 0.6:
        for token in re.findall(r"\b[A-Z][A-Z0-9]{3,}\b", texto):
            agregar(token, "nombre_mayusculas")

    return halladas


def regiones_en(norm: str) -> list[str]:
    return [r for r in REGIONES if re.search(r"\b" + re.escape(r) + r"\b", norm)]


def base_sin_region(norm: str) -> str:
    base = norm
    for region in REGIONES:
        base = re.sub(r"\b" + re.escape(region) + r"\b", " ", base)
    return re.sub(r"\s+", " ", base).strip()


# --------------------------------------------------------------------------
# Conexión (sólo lectura)
# --------------------------------------------------------------------------


def leer_env(ruta: Path = RAIZ / ".env") -> dict[str, str]:
    datos: dict[str, str] = {}
    if not ruta.exists():
        return datos
    for linea in ruta.read_text(encoding="utf-8", errors="replace").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        datos[clave.strip()] = valor.strip().strip('"').strip("'")
    return datos


def candidatos_dsn(argumento: str | None) -> list[tuple[str, str]]:
    env = leer_env()
    fuentes: list[tuple[str, str]] = []
    if argumento:
        fuentes.append(("--dsn", argumento))
    for variable in ("AVISA_DSN", "DATABASE_URL", "NEON_OWNER_URL"):
        valor = os.environ.get(variable) or env.get(variable)
        if valor:
            fuentes.append((variable, valor))

    vistos: set[str] = set()
    unicos: list[tuple[str, str]] = []
    for etiqueta, dsn in fuentes:
        if dsn in vistos:
            continue
        vistos.add(dsn)
        unicos.append((etiqueta, dsn))
    return unicos


def describir_dsn(dsn: str) -> str:
    """Host/base sin credenciales."""
    try:
        partes = urlsplit(dsn)
        if partes.hostname:
            puerto = partes.port or ""
            base = (partes.path or "").lstrip("/")
            return f"{partes.hostname}{':' + str(puerto) if puerto else ''}/{base}"
    except Exception:
        pass
    return "(dsn no analizable)"


def conectar(candidatos: list[tuple[str, str]]):
    import psycopg

    errores: list[str] = []
    for etiqueta, dsn in candidatos:
        try:
            con = psycopg.connect(dsn, autocommit=True, connect_timeout=8)
        except Exception as error:  # noqa: BLE001
            primero = str(error).splitlines()[0][:140]
            errores.append(
                f"{etiqueta} ({describir_dsn(dsn)}): {type(error).__name__} {primero}"
            )
            continue

        try:
            con.read_only = True
        except Exception:  # noqa: BLE001
            pass

        try:
            con.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
            con.execute("SET statement_timeout = '240s'")
            estado = con.execute("SHOW transaction_read_only").fetchone()[0]
        except Exception as error:  # noqa: BLE001
            con.close()
            errores.append(f"{etiqueta}: no se pudo fijar sólo lectura ({error})")
            continue

        if str(estado).lower() not in ("on", "true", "1"):
            con.close()
            errores.append(f"{etiqueta}: transaction_read_only={estado!r}")
            continue

        return con, etiqueta, dsn

    detalle = "\n  - ".join(errores) if errores else "sin DSN configurado"
    raise SystemExit(
        "No se pudo abrir una conexión de sólo lectura.\n  - "
        + detalle
        + "\nRevisa DATABASE_URL / NEON_OWNER_URL o pasa --dsn."
    )


# --------------------------------------------------------------------------
# Lectura del padrón
# --------------------------------------------------------------------------


def mapa_catalogo(con, tabla: str, prefijo: str) -> dict:
    columnas = [
        fila[0]
        for fila in con.execute(
            "select column_name from information_schema.columns "
            "where table_schema = 'core' and table_name = %s",
            (tabla,),
        )
    ]
    if not columnas:
        return {}
    col_id = next(
        (c for c in (f"{prefijo}_id", "id", "codigo") if c in columnas), columnas[0]
    )
    col_nombre = next(
        (
            c
            for c in (
                "nombre",
                "descripcion",
                "nombre_tipo",
                "denominacion",
                "etiqueta",
                "detalle",
            )
            if c in columnas
        ),
        None,
    )
    if not col_nombre:
        return {}
    filas = con.execute(
        f'select "{col_id}", "{col_nombre}" from core."{tabla}"'
    ).fetchall()
    return {fila[0]: fila[1] for fila in filas}


def leer_padron(con) -> tuple[list[dict], list[dict]]:
    tipos_actor = mapa_catalogo(con, "cat_tipos_actor", "tipo_actor")
    tipos_org = mapa_catalogo(con, "cat_tipos_organizacion", "tipo_organizacion")

    actores: list[dict] = []
    for uid, nombre, naturaleza, abreviatura, tipo_id, activo in con.execute(
        """
        select actor_uid::text, nombre_actual, naturaleza, abreviatura,
               tipo_actor_id, activo
          from core.actores
         order by nombre_actual nulls last, actor_uid
        """
    ).fetchall():
        actores.append(
            {
                "uid": uid,
                "tabla": "core.actores",
                "nombre": (nombre or "").strip(),
                "naturaleza": (naturaleza or "").strip() or None,
                "abreviatura": (abreviatura or "").strip() or None,
                "tipo_actor_id": tipo_id,
                "tipo_actor": tipos_actor.get(tipo_id)
                or (f"tipo_actor_id={tipo_id}" if tipo_id else None),
                "activo": activo,
            }
        )

    organizaciones: list[dict] = []
    for uid, razon_social, abreviatura, tipo_id in con.execute(
        """
        select actor_uid::text, razon_social, abreviatura, tipo_organizacion_id
          from core.organizaciones
         order by razon_social nulls last, actor_uid
        """
    ).fetchall():
        organizaciones.append(
            {
                "uid": uid,
                "tabla": "core.organizaciones",
                "nombre": (razon_social or "").strip(),
                "naturaleza": "organizacion",
                "abreviatura": (abreviatura or "").strip() or None,
                "tipo_actor_id": tipo_id,
                "tipo_actor": tipos_org.get(tipo_id)
                or (f"tipo_organizacion_id={tipo_id}" if tipo_id else None),
                "activo": None,
            }
        )

    return actores, organizaciones


# --------------------------------------------------------------------------
# Utilidades de agrupación
# --------------------------------------------------------------------------


class UnionFind:
    def __init__(self, n: int) -> None:
        self.padre = list(range(n))

    def find(self, x: int) -> int:
        while self.padre[x] != x:
            self.padre[x] = self.padre[self.padre[x]]
            x = self.padre[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.padre[rb] = ra


def recortar(texto: str, ancho: int = 70) -> str:
    texto = (texto or "").replace("\n", " ").strip()
    return texto if len(texto) <= ancho else texto[: ancho - 1] + "…"


# --------------------------------------------------------------------------
# Detección
# --------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reporte de duplicados del padrón (sólo lectura)."
    )
    parser.add_argument("--dsn", help="DSN de PostgreSQL; por defecto .env/entorno")
    parser.add_argument("--salida", default=str(SALIDA), help="ruta del JSON de salida")
    args = parser.parse_args()

    con, etiqueta_dsn, dsn = conectar(candidatos_dsn(args.dsn))
    try:
        actores, organizaciones = leer_padron(con)
    finally:
        con.close()

    filas = actores + organizaciones
    for fila in filas:
        fila["norm"] = normalizar(fila["nombre"])
        fila["siglas"] = extraer_siglas(fila["nombre"], fila["abreviatura"])

    # Cada organización tiene una fila espejo en `core.actores` (mismo
    # actor_uid y mismo nombre). Se analiza una sola vez y se anota el espejo.
    actores_por_uid = {a["uid"]: a for a in actores}
    espejos: set[tuple[str, str]] = set()
    for org in organizaciones:
        actor = actores_por_uid.get(org["uid"])
        if not actor or actor["naturaleza"] != "organizacion":
            continue
        if org["norm"] != actor["norm"]:
            continue
        abrev_org = sorted(
            s["compacta"] for s in org["siglas"] if s["fuente"] == "abreviatura"
        )
        abrev_actor = sorted(
            s["compacta"] for s in actor["siglas"] if s["fuente"] == "abreviatura"
        )
        if abrev_org != abrev_actor:
            continue
        espejos.add((org["tabla"], org["uid"]))
        actor["espejo_en"] = "core.organizaciones"

    analizables = [
        f for f in filas if f["norm"] and (f["tabla"], f["uid"]) not in espejos
    ]

    inconsistencias: list[dict] = []

    # ---------------- 4. Inconsistencias de tipo (persona con nombre de org)
    candidatos_tipo: list[dict] = []
    for actor in actores:
        if actor["naturaleza"] != "persona" or not actor["norm"]:
            continue
        coincidencias = RE_ORGANIZACION.findall(actor["norm"])
        if coincidencias:
            candidatos_tipo.append({"actor": actor, "palabra": coincidencias[0]})
            inconsistencias.append(
                {
                    "tipo": "naturaleza_incorrecta",
                    "tabla": actor["tabla"],
                    "id": actor["uid"],
                    "nombre": actor["nombre"],
                    "naturaleza": actor["naturaleza"],
                    "tipo_actor": actor["tipo_actor"],
                    "palabra_detectada": coincidencias[0],
                    "siglas": [s["sigla"] for s in actor["siglas"]],
                }
            )

    # ---------------- 5. Huérfanos y vacíos
    for org in organizaciones:
        if not org["nombre"]:
            inconsistencias.append(
                {
                    "tipo": "organizacion_sin_razon_social",
                    "tabla": org["tabla"],
                    "id": org["uid"],
                    "nombre": None,
                    "abreviatura": org["abreviatura"],
                    "tipo_actor": org["tipo_actor"],
                }
            )
    for actor in actores:
        if not actor["nombre"]:
            inconsistencias.append(
                {
                    "tipo": "actor_sin_nombre",
                    "tabla": actor["tabla"],
                    "id": actor["uid"],
                    "nombre": None,
                    "naturaleza": actor["naturaleza"],
                    "abreviatura": actor["abreviatura"],
                    "tipo_actor": actor["tipo_actor"],
                }
            )

    siglas_en_nombre = 0
    for fila in analizables:
        if fila["abreviatura"] or not fila["nombre"]:
            continue
        visibles = [s for s in fila["siglas"] if s["fuente"] != "abreviatura"]
        if not visibles:
            continue
        siglas_en_nombre += 1
        inconsistencias.append(
            {
                "tipo": "abreviatura_vacia_con_sigla_en_nombre",
                "tabla": fila["tabla"],
                "id": fila["uid"],
                "nombre": fila["nombre"],
                "siglas": [s["sigla"] for s in visibles],
                "fuentes": sorted({s["fuente"] for s in visibles}),
            }
        )

    # ---------------- 1. Duplicados exactos
    grupos: list[dict] = []

    def miembro(fila: dict, extra: dict | None = None) -> dict:
        dato = {
            "tabla": fila["tabla"],
            "id": fila["uid"],
            "nombre": fila["nombre"],
            "siglas": [s["sigla"] for s in fila["siglas"]],
            "naturaleza": fila["naturaleza"],
            "tipo_actor": fila["tipo_actor"],
        }
        if fila.get("espejo_en"):
            dato["espejo_en"] = fila["espejo_en"]
        if extra:
            dato.update(extra)
        return dato

    def es_variante_regional(miembros_filas: list[dict]) -> bool:
        regiones: list[str] = []
        bases: list[str] = []
        for fila in miembros_filas:
            propias = regiones_en(fila["norm"])
            if len(propias) != 1:
                return False
            regiones.append(propias[0])
            bases.append(base_sin_region(fila["norm"]))
        if len(set(regiones)) != len(regiones):
            return False
        return len(set(bases)) == 1

    por_norm: dict[str, list[dict]] = defaultdict(list)
    for fila in analizables:
        por_norm[fila["norm"]].append(fila)

    uids_actor = {a["uid"] for a in actores}
    pares_uid_compartido = 0
    for org in organizaciones:
        if org["uid"] in uids_actor:
            pares_uid_compartido += 1

    for clave, filas_grupo in por_norm.items():
        if len(filas_grupo) < 2:
            continue
        uids_actores = {f["uid"] for f in filas_grupo if f["tabla"] == "core.actores"}
        filtradas = [
            f
            for f in filas_grupo
            if not (f["tabla"] == "core.organizaciones" and f["uid"] in uids_actores)
        ]
        if len(filtradas) < 2:
            continue

        tablas = {f["tabla"] for f in filtradas}
        naturalezas = {f["naturaleza"] for f in filtradas}
        if tablas == {"core.organizaciones"} or (
            tablas == {"core.actores"} and naturalezas == {"organizacion"}
        ):
            recomendacion = "fusionar"
        else:
            recomendacion = "revisar"

        nota = None
        if es_variante_regional(filtradas):
            recomendacion = "ninguna"
            nota = "misma denominación en regiones distintas; no son duplicados"
        elif tablas == {"core.actores"} and naturalezas == {"persona"}:
            nota = "homónimos posibles entre personas; verificar región y tipo antes de fusionar"
        elif len(tablas) > 1:
            nota = "coincidencia entre actores y organizaciones: probable error de tipo, no fusión directa"

        grupos.append(
            {
                "clave": f"nombre:{clave}",
                "motivo": "exacto",
                "miembros": [
                    miembro(f)
                    for f in sorted(filtradas, key=lambda x: (x["tabla"], x["nombre"]))
                ],
                "recomendacion": recomendacion,
                "puntaje": 1.0,
                **({"nota": nota} if nota else {}),
            }
        )

    # ---------------- 2. Duplicados por siglas
    por_sigla: dict[str, list[dict]] = defaultdict(list)
    fuentes_sigla: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for fila in analizables:
        for sigla in fila["siglas"]:
            compacta = sigla["compacta"]
            if len(compacta) < 3 or compacta in GENERICOS_SIGLAS:
                continue
            por_sigla[compacta].append(fila)
            fuentes_sigla[(compacta, fila["tabla"], fila["uid"])].add(sigla["fuente"])

    try:
        from rapidfuzz import fuzz as fuzz_simple
    except Exception:  # noqa: BLE001
        fuzz_simple = None

    for compacta, filas_sigla in por_sigla.items():
        unicas = {(f["tabla"], f["uid"]): f for f in filas_sigla}
        if len(unicas) < 2:
            continue
        miembros_filas = sorted(
            unicas.values(), key=lambda x: (x["tabla"], x["nombre"])
        )
        tablas = {f["tabla"] for f in miembros_filas}
        naturalezas = {f["naturaleza"] for f in miembros_filas}

        puntaje = None
        if fuzz_simple is not None:
            textos = [f["nombre"] or f["norm"] for f in miembros_filas]
            puntaje = max(
                fuzz_simple.token_sort_ratio(textos[a], textos[b]) / 100.0
                for a in range(len(textos))
                for b in range(a + 1, len(textos))
            )

        if es_variante_regional(miembros_filas):
            recomendacion = "ninguna"
            nota = "misma sigla pero denominación por región; no son duplicados"
        elif (
            len(tablas) == 1
            and naturalezas == {"organizacion"}
            and (puntaje or 0) >= 0.95
        ):
            recomendacion = "fusionar"
            nota = "sigla y denominación casi idénticas; confirmar antes de fusionar"
        else:
            recomendacion = "revisar"
            nota = "sigla compartida; confirmar si son la misma entidad"

        if len(naturalezas) > 1:
            nota = "sigla compartida entre personas y organizaciones"

        grupos.append(
            {
                "clave": f"siglas:{compacta}",
                "motivo": "siglas",
                "miembros": [
                    miembro(
                        f,
                        {
                            "fuente_sigla": sorted(
                                fuentes_sigla[(compacta, f["tabla"], f["uid"])]
                            )
                        },
                    )
                    for f in miembros_filas
                ],
                "recomendacion": recomendacion,
                "puntaje": round(puntaje, 4) if puntaje is not None else None,
                "nota": nota,
            }
        )

    # ---------------- 3. Duplicados por similitud
    nodos = analizables
    n = len(nodos)
    m_fuzzy = m_embeddings = None
    embeddings_estado = {
        "modelo": MODELO_EMBEDDINGS,
        "estado": "no_ejecutado",
        "detalle": None,
    }
    pares_fuzzy = pares_embeddings = 0

    if n >= 2:
        import numpy as np
        from rapidfuzz import fuzz, process

        textos = [f["nombre"] or f["norm"] for f in nodos]
        print(f"Comparando {n} nombres con rapidfuzz…", flush=True)
        m_ratio = process.cdist(textos, textos, scorer=fuzz.ratio, workers=-1) / 100.0
        m_token = (
            process.cdist(textos, textos, scorer=fuzz.token_sort_ratio, workers=-1)
            / 100.0
        )
        m_fuzzy = np.maximum(m_ratio, m_token)

        print(f"Calculando embeddings locales ({MODELO_EMBEDDINGS})…", flush=True)
        try:
            import torch
            from sentence_transformers import SentenceTransformer

            torch.set_num_threads(max(1, os.cpu_count() or 4))
            modelo = SentenceTransformer(MODELO_EMBEDDINGS, device="cpu")
            vectores = modelo.encode(
                textos,
                batch_size=64,
                normalize_embeddings=True,
                show_progress_bar=False,
                convert_to_numpy=True,
            )
            m_embeddings = vectores @ vectores.T
            embeddings_estado = {
                "modelo": MODELO_EMBEDDINGS,
                "estado": "ok",
                "detalle": f"{len(textos)} textos codificados en CPU",
            }
        except Exception as error:  # noqa: BLE001
            embeddings_estado = {
                "modelo": MODELO_EMBEDDINGS,
                "estado": "no_disponible",
                "detalle": f"{type(error).__name__}: {str(error).splitlines()[0][:200]}",
                "nota": "no se sustituyen por n-gramas; el reporte queda sin la capa de embeddings",
            }
            print(
                "AVISO: embeddings no disponibles →",
                embeddings_estado["detalle"],
                flush=True,
            )

        mascara = m_fuzzy >= UMBRAL_FUZZY
        if m_embeddings is not None:
            mascara = mascara | (m_embeddings >= UMBRAL_EMBEDDINGS)
        mascara = np.triu(mascara, 1)

        largos = np.array([len(f["norm"]) for f in nodos])
        cortos = largos < LARGO_MINIMO_SIMILITUD
        mascara[cortos, :] = False
        mascara[:, cortos] = False

        indices_i, indices_j = np.nonzero(mascara)

        def puntaje_par(a: int, b: int) -> float:
            valor = float(m_fuzzy[a, b])
            if m_embeddings is not None:
                valor = max(valor, float(m_embeddings[a, b]))
            return valor

        def compatible(a: int, b: int) -> bool:
            # Un buen coseno no basta: los nombres deben compartir texto.
            # Evita que cadenas de nombres propios se agrupen sólo por embeddings.
            if float(m_fuzzy[a, b]) < 0.80:
                return False
            return puntaje_par(a, b) >= UMBRAL_COMPATIBILIDAD

        pares: list[tuple[float, int, int, float, float]] = []
        for i, j in zip(indices_i.tolist(), indices_j.tolist()):
            fi, fj = nodos[i], nodos[j]
            if fi["norm"] == fj["norm"]:  # ya reportado como exacto
                continue
            if fi["uid"] == fj["uid"] and fi["tabla"] != fj["tabla"]:
                continue  # fila espejo actor/organización de la misma entidad
            fz = float(m_fuzzy[i, j])
            em = float(m_embeddings[i, j]) if m_embeddings is not None else 0.0
            if not (fz >= UMBRAL_FUZZY or em >= UMBRAL_EMBEDDINGS):
                continue
            if fz >= UMBRAL_FUZZY:
                pares_fuzzy += 1
            if m_embeddings is not None and em >= UMBRAL_EMBEDDINGS:
                pares_embeddings += 1
            pares.append((max(fz, em), i, j, fz, em))

        pares.sort(key=lambda p: p[0], reverse=True)
        uf = UnionFind(n)
        conjuntos: dict[int, set[int]] = {i: {i} for i in range(n)}

        for puntaje, i, j, _fz, _em in pares:
            ra, rb = uf.find(i), uf.find(j)
            if ra == rb:
                continue
            conjunto_a, conjunto_b = conjuntos[ra], conjuntos[rb]
            if len(conjunto_a) + len(conjunto_b) > MAX_MIEMBROS_GRUPO:
                continue
            es_compatible = all(
                compatible(a, b) for a in conjunto_a for b in conjunto_b
            )
            if not es_compatible:
                continue
            uf.union(ra, rb)  # deja a `ra` como raíz
            conjuntos[ra] = conjunto_a | conjunto_b
            conjuntos.pop(rb, None)

        raiz_de = {i: uf.find(i) for i in range(n)}
        puntajes_por_raiz: dict[int, list[float]] = defaultdict(list)
        for puntaje, i, j, _fz, _em in pares:
            if raiz_de[i] == raiz_de[j]:
                puntajes_por_raiz[raiz_de[i]].append(puntaje)

        for raiz, indices in conjuntos.items():
            if len(indices) < 2:
                continue
            filas_grupo = [nodos[i] for i in indices]
            filas_grupo.sort(key=lambda x: (x["tabla"], x["nombre"]))
            puntajes = puntajes_por_raiz.get(raiz) or []
            puntaje_max = max(puntajes) if puntajes else 0.0
            tablas = {f["tabla"] for f in filas_grupo}
            naturalezas = {f["naturaleza"] for f in filas_grupo}

            if es_variante_regional(filas_grupo):
                recomendacion = "ninguna"
                nota = "misma denominación en regiones distintas; no son duplicados"
            elif len(tablas) > 1 or len(naturalezas) > 1:
                recomendacion = "revisar"
                nota = "similitud cruzada entre actores y organizaciones; probable error de tipo"
            elif any(
                tokens_a < tokens_b or tokens_b < tokens_a
                for tokens_a in (
                    set(f["norm"].split()) - PALABRAS_VACIAS for f in filas_grupo
                )
                for tokens_b in (
                    set(f["norm"].split()) - PALABRAS_VACIAS for f in filas_grupo
                )
            ):
                recomendacion = "revisar"
                nota = "un nombre contiene al otro; puede faltar el calificativo (región, alcance)"
            elif puntaje_max >= 0.97 and naturalezas == {"organizacion"}:
                recomendacion = "fusionar"
                nota = "nombres casi idénticos; confirmar antes de fusionar"
            else:
                recomendacion = "revisar"
                nota = "similitud alta; verificar manualmente"

            if len(filas_grupo) > 6:
                nota = (
                    nota + "; " if nota else ""
                ) + "grupo amplio (cadena de similitudes): revisar por pares"

            grupos.append(
                {
                    "clave": f"similitud:{filas_grupo[0]['norm'][:40]}|{filas_grupo[0]['uid'][:8]}",
                    "motivo": "similitud",
                    "miembros": [miembro(f) for f in filas_grupo],
                    "recomendacion": recomendacion,
                    "puntaje": round(puntaje_max, 4),
                    "puntaje_medio": round(sum(puntajes) / len(puntajes), 4)
                    if puntajes
                    else None,
                    **({"nota": nota} if nota else {}),
                }
            )

    # ---------------- 4b. Grupos de tipo
    for candidato in candidatos_tipo:
        actor = candidato["actor"]
        grupos.append(
            {
                "clave": f"tipo:{actor['uid']}",
                "motivo": "tipo",
                "miembros": [
                    miembro(actor, {"palabra_detectada": candidato["palabra"]})
                ],
                "recomendacion": "corregir_tipo",
                "puntaje": None,
                "nota": (
                    f"figura como persona pero el nombre contiene «{candidato['palabra']}», "
                    "término de organización"
                ),
            }
        )

    # ---------------- Deduplicar grupos con el mismo conjunto de miembros
    finales: dict[frozenset, dict] = {}
    for grupo in sorted(grupos, key=lambda g: ORDEN_MOTIVO.get(g["motivo"], 9)):
        firma = frozenset((m["tabla"], m["id"]) for m in grupo["miembros"])
        if firma in finales:
            previo = finales[firma]
            adicionales = previo.setdefault("motivos_adicionales", [])
            if (
                grupo["motivo"] not in adicionales
                and grupo["motivo"] != previo["motivo"]
            ):
                adicionales.append(grupo["motivo"])
            if grupo.get("puntaje") and (previo.get("puntaje") or 0) < grupo["puntaje"]:
                previo["puntaje"] = grupo["puntaje"]
            continue
        finales[firma] = grupo

    grupos = sorted(
        finales.values(),
        key=lambda g: (
            ORDEN_MOTIVO.get(g["motivo"], 9),
            -len(g["miembros"]),
            g["clave"],
        ),
    )

    # ---------------- Resumen
    conteo_motivos = Counter(g["motivo"] for g in grupos)
    conteo_recomendaciones = Counter(g["recomendacion"] for g in grupos)
    conteo_inconsistencias = Counter(i["tipo"] for i in inconsistencias)
    filas_afectadas = {(m["tabla"], m["id"]) for g in grupos for m in g["miembros"]}

    resumen = {
        "universo": {
            "actores": len(actores),
            "actores_con_nombre": sum(1 for a in actores if a["nombre"]),
            "organizaciones": len(organizaciones),
            "organizaciones_con_razon_social": sum(
                1 for o in organizaciones if o["nombre"]
            ),
            "filas_analizadas": len(filas),
            "filas_analizables": len(analizables),
            "filas_espejo_excluidas": len(espejos),
        },
        "grupos": {
            "total": len(grupos),
            "por_motivo": {
                "exacto": conteo_motivos.get("exacto", 0),
                "siglas": conteo_motivos.get("siglas", 0),
                "similitud": conteo_motivos.get("similitud", 0),
                "tipo": conteo_motivos.get("tipo", 0),
            },
            "por_recomendacion": {
                "fusionar": conteo_recomendaciones.get("fusionar", 0),
                "corregir_tipo": conteo_recomendaciones.get("corregir_tipo", 0),
                "revisar": conteo_recomendaciones.get("revisar", 0),
                "ninguna": conteo_recomendaciones.get("ninguna", 0),
            },
            "filas_afectadas": len(filas_afectadas),
        },
        "inconsistencias": {
            "total": len(inconsistencias),
            "por_tipo": {
                "naturaleza_incorrecta": conteo_inconsistencias.get(
                    "naturaleza_incorrecta", 0
                ),
                "organizacion_sin_razon_social": conteo_inconsistencias.get(
                    "organizacion_sin_razon_social", 0
                ),
                "actor_sin_nombre": conteo_inconsistencias.get("actor_sin_nombre", 0),
                "abreviatura_vacia_con_sigla_en_nombre": conteo_inconsistencias.get(
                    "abreviatura_vacia_con_sigla_en_nombre", 0
                ),
            },
        },
        "pares": {
            "fuzzy_sobre_umbral": pares_fuzzy,
            "embeddings_sobre_umbral": pares_embeddings,
        },
        "embeddings": embeddings_estado,
        "relacion_actor_organizacion": {
            "actor_uid_compartidos": pares_uid_compartido,
            "organizaciones": len(organizaciones),
            "nota": (
                "`core.organizaciones.actor_uid` referencia a `core.actores`: "
                "compartir uid es la relación estructural, no un duplicado. "
                "Esos pares se excluyen de los grupos."
            ),
        },
    }

    reporte = {
        "generado_en": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente": {
            "dsn_etiqueta": etiqueta_dsn,
            "destino": describir_dsn(dsn),
            "solo_lectura": True,
            "consulta": "SELECT únicamente",
        },
        "umbrales": {
            "fuzzy": UMBRAL_FUZZY,
            "embeddings": UMBRAL_EMBEDDINGS,
            "compatibilidad_grupo": UMBRAL_COMPATIBILIDAD,
            "max_miembros_por_grupo": MAX_MIEMBROS_GRUPO,
        },
        "resumen": resumen,
        "grupos": grupos,
        "inconsistencias": inconsistencias,
    }

    ruta_salida = Path(args.salida)
    ruta_salida.parent.mkdir(parents=True, exist_ok=True)
    ruta_salida.write_text(
        json.dumps(reporte, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )

    # ---------------- Impresión
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    print()
    print("=" * 78)
    print(
        f"DUPLICADOS E INCONSISTENCIAS · {describir_dsn(dsn)} ({etiqueta_dsn}) · SÓLO LECTURA"
    )
    print("=" * 78)
    print(
        f"Universo: {len(actores)} actores "
        f"({resumen['universo']['actores_con_nombre']} con nombre) · "
        f"{len(organizaciones)} organizaciones "
        f"({resumen['universo']['organizaciones_con_razon_social']} con razón social)"
    )
    print(
        f"Grupos: {resumen['grupos']['total']} "
        f"(exacto {conteo_motivos.get('exacto', 0)}, "
        f"siglas {conteo_motivos.get('siglas', 0)}, "
        f"similitud {conteo_motivos.get('similitud', 0)}, "
        f"tipo {conteo_motivos.get('tipo', 0)}) · "
        f"filas afectadas: {resumen['grupos']['filas_afectadas']}"
    )
    print(
        "Recomendaciones: "
        + ", ".join(
            f"{k} {v}" for k, v in resumen["grupos"]["por_recomendacion"].items()
        )
    )
    print(
        f"Inconsistencias: {len(inconsistencias)} "
        f"(tipo {conteo_inconsistencias.get('naturaleza_incorrecta', 0)}, "
        f"org sin razón social {conteo_inconsistencias.get('organizacion_sin_razon_social', 0)}, "
        f"actor sin nombre {conteo_inconsistencias.get('actor_sin_nombre', 0)}, "
        f"abreviatura vacía {conteo_inconsistencias.get('abreviatura_vacia_con_sigla_en_nombre', 0)})"
    )
    print(
        f"Pares sobre umbral: fuzzy {pares_fuzzy} · embeddings {pares_embeddings} "
        f"({embeddings_estado['estado']})"
    )
    print(
        f"actor_uid compartidos actor/organización: {pares_uid_compartido} "
        f"de {len(organizaciones)} organizaciones (relación estructural)"
    )

    print("\n" + "-" * 78)
    print("15 GRUPOS MÁS GRANDES / MEJOR PUNTUADOS")
    print("-" * 78)
    for posicion, grupo in enumerate(
        sorted(grupos, key=lambda g: (-len(g["miembros"]), -(g.get("puntaje") or 0)))[
            :15
        ],
        1,
    ):
        puntaje = grupo.get("puntaje")
        cabecera = (
            f"{posicion:2d}. [{grupo['motivo']}] {len(grupo['miembros'])} miembros · "
            f"{'puntaje ' + format(puntaje, '.3f') if puntaje is not None else 'sin puntaje'} · "
            f"{grupo['recomendacion']}"
        )
        print(cabecera)
        print(f"    clave: {grupo['clave']}")
        for dato in grupo["miembros"][:8]:
            siglas = ", ".join(dato.get("siglas") or []) or "—"
            print(
                f"    - {dato['tabla']:22s} {dato['id']}  "
                f"{recortar(dato['nombre'] or '(sin nombre)', 60):60s} "
                f"naturaleza={dato.get('naturaleza')} siglas={siglas}"
            )
        if len(grupo["miembros"]) > 8:
            print(f"    … y {len(grupo['miembros']) - 8} miembros más en el JSON")
        if grupo.get("nota"):
            print(f"    nota: {grupo['nota']}")

    print("\n" + "-" * 78)
    print("INCONSISTENCIAS DE TIPO (naturaleza='persona' con nombre de organización)")
    print("-" * 78)
    de_tipo = [i for i in inconsistencias if i["tipo"] == "naturaleza_incorrecta"]
    if not de_tipo:
        print("  (ninguna)")
    for item in de_tipo:
        print(
            f"  - {item['tabla']}  id={item['id']}  «{item['nombre']}»  "
            f"palabra={item['palabra_detectada']!r}  tipo_actor={item['tipo_actor']}"
        )

    print("\n" + "-" * 78)
    print("OTROS VACÍOS / HUÉRFANOS")
    print("-" * 78)
    for tipo, etiqueta in (
        ("organizacion_sin_razon_social", "organizaciones sin razón social"),
        ("actor_sin_nombre", "actores sin nombre_actual"),
        (
            "abreviatura_vacia_con_sigla_en_nombre",
            "abreviatura vacía con sigla visible",
        ),
    ):
        items = [i for i in inconsistencias if i["tipo"] == tipo]
        print(f"  {etiqueta}: {len(items)}")
        for item in items[:20]:
            detalle = ", ".join(item.get("siglas") or []) or "—"
            print(
                f"    - {item['tabla']:22s} id={item['id']}  "
                f"{recortar(item.get('nombre') or '(sin nombre)', 55):55s} siglas={detalle}"
            )
        if len(items) > 20:
            print(f"    … y {len(items) - 20} más en el JSON")

    print(f"\nJSON escrito en: {ruta_salida}")


if __name__ == "__main__":
    main()
