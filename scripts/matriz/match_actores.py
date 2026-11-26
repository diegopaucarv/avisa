#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Empareja los actores/instituciones de la matriz 2026 contra el núcleo.

Reglas del emparejamiento
-------------------------
* Es una **cascada if/else**, no un voto ponderado: la primera rama que se
  cumple decide. Las demás señales (sobre todo el tipo) sólo *verifican* que
  el acierto fuerte no contradiga lo evidente: una persona nunca se acepta
  contra una organización ni al revés.
* La señal semántica son **embeddings reales** de
  ``sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`` (caché
  local, ``HF_HUB_OFFLINE=1``); si no está, ``BAAI/bge-m3``. Nunca TF-IDF.
* La similitud léxica (``rapidfuzz``, ``difflib`` como respaldo) es señal
  secundaria de verificación, no la base del emparejamiento.

Cascada (gana la primera que cumple)
------------------------------------
1. Siglas exactas normalizadas ....... ``auto`` 1.0 (token completo; sin
   siglas genéricas ni topónimos, y con ``abreviatura`` NULL sólo valen las
   que salen del propio nombre)
2. Nombre exacto normalizado ......................... ``auto``
3. Léxico >= 0.90 .................................... ``auto`` (exige
   respaldo de embedding >= 0.78; si no, ``dudoso``: trampa de prefijo)
4. Embedding >= 0.87 ................................. ``auto``
5. Embedding >= 0.78 o léxico >= 0.72 ................ ``dudoso``
6. Nada .............................................. ``nuevo`` (propuesta
   ``crear``; no se crea nada)

Sólo lectura
------------
La sesión se abre con ``set_session(readonly=True, autocommit=True)``. No hay
INSERT/UPDATE/DELETE ni DDL. La consulta de verificación final comprueba que
cada id emitido existe en la tabla declarada.

Uso
---
    python scripts/matriz/match_actores.py
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

# Offline ANTES de importar sentence_transformers: usar la caché local.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
ENTRADA = AQUI / "salida" / "matriz_2026.json"
SALIDA = AQUI / "salida" / "match_actores.json"

MODELOS = [
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "BAAI/bge-m3",
]

UMBRAL_EMB_AUTO = 0.87
UMBRAL_EMB_DUDOSO = 0.78
UMBRAL_LEX_AUTO = 0.90
UMBRAL_LEX_DUDOSO = 0.72
UMBRAL_SOPORTE_EMB = 0.78  # un acierto léxico/infraléxico exige respaldo semántico
UMBRAL_FRAGIL = 0.90  # umbral alternativo para medir fragilidad
DECIMALES = 4

TITULOS = {
    "ING",
    "INGA",
    "SR",
    "SRA",
    "SRTA",
    "LIC",
    "LCDO",
    "LCDA",
    "DR",
    "DRA",
    "ABOG",
    "ABG",
    "ECON",
    "MG",
    "MAG",
    "BACH",
    "ARQ",
    "CPC",
    "CAP",
    "GRAL",
    "CRNL",
    "TTE",
    "MYR",
    "ALM",
    "PROF",
    "PRESB",
    "PADRE",
    "MONSENOR",
    "CONT",
    "ADM",
    "TEC",
    "SOC",
}

ORG_KW = {
    "ASOCIACION",
    "ASOC",
    "GREMIOS",
    "GREMIAL",
    "FEDERACION",
    "CONFEDERACION",
    "COMITE",
    "SUBCOMITE",
    "CONSEJO",
    "MESA",
    "RED",
    "COALICION",
    "PLATAFORMA",
    "SINDICATO",
    "COOPERATIVA",
    "EMPRESA",
    "EMPRESAS",
    "CONSORCIO",
    "CONTRATISTA",
    "CONSULTORA",
    "MINISTERIO",
    "DIRECCION",
    "GERENCIA",
    "OFICINA",
    "SERVICIO",
    "INSTITUTO",
    "ORGANISMO",
    "AUTORIDAD",
    "MUNICIPALIDAD",
    "GOBIERNO",
    "PROGRAMA",
    "PROYECTO",
    "UNIVERSIDAD",
    "FACULTAD",
    "ESCUELA",
    "HOSPITAL",
    "CLINICA",
    "BANCO",
    "FONDO",
    "CAMARA",
    "COLEGIO",
    "ORDEN",
    "ASAMBLEA",
    "SOCIEDAD",
    "ACADEMIA",
    "CENTRO",
    "JUNTA",
    "COMISION",
    "DEFENSORIA",
    "DEFENSOR",
    "PROCURADURIA",
    "FISCALIA",
    "JUZGADO",
    "CORTE",
    "TRIBUNAL",
    "REGISTRO",
    "SUPERINTENDENCIA",
    "AGENCIA",
    "FEDERACION",
    "SINDICATO",
    "SINDICATOS",
    "CULTURAL",
    "DEPORTIVO",
    "DEPORTIVA",
    "PESCADORES",
    "ARMADORES",
    "TRANSPORTISTAS",
    "AGRICULTORES",
    "MYPES",
    "MYPE",
    "RONDAS",
    "FRENTE",
    "PLATAFORMA",
    "MOVIMIENTO",
    "PARTIDO",
    "IGLESIA",
    "PARROQUIA",
    "COMUNIDAD",
    "COMUNIDADES",
    "SUBCOMISION",
    "GRUPO",
    "COLECTIVO",
    "TALLER",
    "SOCIEDAD",
    "SAC",
    "SAA",
    "EIRL",
    "SRL",
    "SA",
    "ONG",
    "OSC",
    "ODS",
    "APAFA",
    "AEDA",
    "ANPE",
    "CONFIEP",
    "SNI",
    "ADEX",
    "SUNAT",
    "SERNANP",
    "SERFOR",
    "IMARPE",
    "DIPFORPA",
    "DGPA",
    "DIREPRO",
    "DIRESA",
    "DREM",
    "ATFFS",
    "PRODUCE",
}

ORG_FRAGMENTOS = (
    "ASOCIACION DE",
    "S.A.C",
    "S.A.",
    "E.I.R.L",
    "S.R.L",
    "SOCIEDAD ANONIMA",
    "PERSONA JURIDICA",
    "R.L.",
    "ONG",
)


def hf_offline() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


# --------------------------------------------------------------------------
# Normalización
# --------------------------------------------------------------------------
def sin_tildes(texto: str) -> str:
    nfkd = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def norm_texto(texto: str | None) -> str:
    if not texto:
        return ""
    limpio = sin_tildes(texto).upper()
    limpio = re.sub(r"[^A-Z0-9]+", " ", limpio)
    return re.sub(r"\s+", " ", limpio).strip()


def siglas_key(texto: str | None) -> str:
    if not texto:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", sin_tildes(texto).upper())


def parse_siglas(valor: str | None) -> set[str]:
    """Abreviatura/siglas → conjunto de claves normalizadas (>= 2 chars)."""
    if not valor:
        return set()
    out: set[str] = set()
    for parte in re.split(r"[/,;|]", str(valor)):
        clave = siglas_key(parte)
        if 2 <= len(clave) <= 24:
            out.add(clave)
    return out


# Siglas que describen un tipo de entidad o un recinto, no una identidad concreta:
# usarlas como llave provocaría falsos exactos (`DPA San José` ↔ cualquier
# organización de San José).
SIGLAS_GENERICAS = {
    "dpa",
    "ospa",
    "ospas",
    "gore",
    "mype",
    "mypes",
    "pcm",
    "ong",
    "ongs",
    "ii",
    "iii",
    "iv",
    "vi",
    "vii",
    "viii",
    "ix",
    "x",
}


# Topónimos (regiones y distritos) cargados de la BD: una sigla que coincide con
# el nombre de un lugar no identifica a una organización concreta.
TOPONIMOS: set[str] = set()


def sigla_valida(clave: str) -> bool:
    """Sirve como llave sólo si es un token propio, no genérico ni topónimo."""
    k = siglas_key(clave)
    return (
        2 <= len(k) <= 24
        and k.casefold() not in SIGLAS_GENERICAS
        and k not in TOPONIMOS
    )


def siglas_del_nombre(nombre: str | None) -> set[str]:
    """Siglas que están dentro del nombre, no en la columna `abreviatura`.

    La base tiene organizaciones cuya sigla vive sólo en `razon_social`
    (p. ej. «Fed. Integr. Unitaria de los Pesc. Art. FIUPAP» con `abreviatura`
    NULL, o «OSPA APEPAL (Asociación …)»). Sin esto, la búsqueda por siglas las
    pierde y el caso cae a embeddings, que es donde aparecen los falsos
    positivos.
    """
    if not nombre:
        return set()
    out: set[str] = set()
    # Contenido entre paréntesis: «(ASARPAR)».
    for match in re.finditer(r"\(([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 /-]{1,23})\)", nombre):
        out |= parse_siglas(match.group(1))
    # Tokens en mayúsculas de 4+ caracteres: FIUPAP, FIMEPAP, APEPAL.
    # Si el nombre entero está en mayúsculas, cada palabra parece sigla
    # («GREMIO DE PESCADORES…» → gremio, pescadores): sólo se acepta cuando es
    # una única palabra («FIMEPAP»).
    letras = [c for c in nombre if c.isalpha()]
    proporcion_mayus = (
        (sum(1 for c in letras if c.isupper()) / len(letras)) if letras else 0
    )
    es_frase_en_mayusculas = proporcion_mayus > 0.8 and len(nombre.split()) > 1
    if not es_frase_en_mayusculas:
        for token in re.findall(r"\b[A-ZÁÉÍÓÚÑ0-9]{4,}\b", nombre):
            out |= parse_siglas(token)
    return {s for s in out if sigla_valida(s)}


def quitar_titulos(texto: str) -> str:
    partes = [p for p in re.split(r"\s+", (texto or "").strip()) if p]
    while partes and siglas_key(partes[0]) in TITULOS:
        partes.pop(0)
    return " ".join(partes)


def limpiar_crudo(crudo: str) -> str:
    lineas = [l.strip() for l in (crudo or "").splitlines() if l.strip()]
    for linea in lineas:
        if re.search(
            r"(?i)\b(cel|celular|tel|telef|telf|fono|email|correo|ruc|dni)\b", linea
        ):
            continue
        if re.search(r"\d{6,}", linea):
            continue
        return linea
    return lineas[0] if lineas else ""


def parece_sigla(texto: str) -> bool:
    t = (texto or "").strip()
    return bool(t) and t == t.upper() and bool(re.fullmatch(r"[A-Z0-9.\-]{2,14}", t))


# --------------------------------------------------------------------------
# Tipo (persona / organización)
# --------------------------------------------------------------------------
def clasificar_por_nombre(nombre: str) -> str:
    original = (nombre or "").strip()
    norm = norm_texto(original)
    if not norm:
        return "persona"
    tokens = norm.split()
    if any(t in ORG_KW for t in tokens):
        return "organizacion"
    plano = sin_tildes(original).upper()
    if any(frag in plano for frag in ORG_FRAGMENTOS):
        return "organizacion"
    if any(ch.isdigit() for ch in plano):
        return "organizacion"
    if len(tokens) == 1:
        if parece_sigla(original) or siglas_key(tokens[0]) in ORG_KW:
            return "organizacion"
        return "persona"
    if siglas_key(tokens[0]) in TITULOS:
        return "persona"
    if (
        any(t in ("DE", "DEL", "LA", "LAS", "LOS", "EL") for t in tokens)
        and len(tokens) <= 6
    ):
        # "Juan de la Cruz" es persona; "Mesa de ..." ya cayó por ORG_KW.
        return "persona"
    if 2 <= len(tokens) <= 5:
        return "persona"
    return "organizacion"


def tipo_desde(naturaleza: str | None, tipo_nombre: str | None, nombre: str) -> str:
    blob = norm_texto(f"{naturaleza or ''} {tipo_nombre or ''}")
    if any(
        k in blob
        for k in ("ORGANIZ", "JURIDIC", "INSTITU", "EMPRESA", "GREMIAL", "COLECTIV")
    ):
        return "organizacion"
    if any(k in blob for k in ("PERSONA", "NATURAL", "CIUDADAN")):
        return "persona"
    return clasificar_por_nombre(nombre)


def tipo_fragmento(texto: str) -> str:
    if "/" in texto:
        return "organizacion"
    return clasificar_por_nombre(texto)


# --------------------------------------------------------------------------
# Insumos
# --------------------------------------------------------------------------
def split_instituciones(valor: str | None) -> list[str]:
    if not valor:
        return []
    partes = [p.strip() for p in re.split(r"[/;]", str(valor))]
    return [p for p in partes if len(norm_texto(p)) >= 2]


def extraer_fragmentos(doc: dict) -> tuple[list[tuple[str, str, str, str]], int]:
    fragmentos: list[tuple[str, str, str, str]] = []
    for caso in doc.get("casos") or []:
        etiqueta = f"caso {caso.get('n', '?')}"
        for actor in caso.get("actores") or []:
            crudo = (actor.get("crudo") or "").strip()
            nombre = (actor.get("nombre") or "").strip()
            texto = nombre or limpiar_crudo(crudo)
            if len(norm_texto(texto)) < 2:
                continue
            tipo = tipo_fragmento(texto)
            fragmentos.append((crudo or texto, texto, tipo, f"{etiqueta}:actores"))
        for comp in caso.get("compromisos") or []:
            for seg in split_instituciones(comp.get("area_responsable")):
                fragmentos.append(
                    (seg, seg, "organizacion", f"{etiqueta}:area_responsable")
                )
        for hito in caso.get("hitos") or []:
            for seg in split_instituciones(hito.get("responsable")):
                fragmentos.append((seg, seg, "organizacion", f"{etiqueta}:responsable"))
    return fragmentos, len(fragmentos)


def construir_unicos(fragmentos: list[tuple[str, str, str, str]]) -> list[dict]:
    indice: dict[tuple[str, str], dict] = {}
    orden: list[tuple[str, str]] = []
    for crudo, texto, tipo, fuente in fragmentos:
        norm = norm_texto(quitar_titulos(texto))
        if not norm:
            continue
        clave = (norm, tipo)
        reg = indice.get(clave)
        if reg is None:
            reg = {
                "crudo": crudo,
                "texto": texto,
                "norm": norm,
                "tipo": tipo,
                "ocurrencias": 0,
                "fuentes": [],
                "variantes": [],
            }
            indice[clave] = reg
            orden.append(clave)
        reg["ocurrencias"] += 1
        if fuente not in reg["fuentes"] and len(reg["fuentes"]) < 3:
            reg["fuentes"].append(fuente)
        if crudo and crudo not in reg["variantes"] and len(reg["variantes"]) < 4:
            reg["variantes"].append(crudo)
    return [indice[k] for k in orden]


# --------------------------------------------------------------------------
# Catálogo
# --------------------------------------------------------------------------
class Candidato:
    __slots__ = ("id", "tabla", "nombre", "tipo", "norm", "textos", "siglas")

    def __init__(self, id_, tabla, nombre, tipo, textos, siglas):
        self.id = id_
        self.tabla = tabla
        self.nombre = nombre
        self.tipo = tipo
        self.norm = norm_texto(quitar_titulos(nombre))
        vistos: list[str] = []
        for t in textos:
            t = (t or "").strip()
            if t and t not in vistos:
                vistos.append(t)
        self.textos = vistos or [nombre]
        self.siglas = siglas

    def como_dict(self) -> dict:
        return {
            "id": self.id,
            "tabla": self.tabla,
            "nombre": self.nombre,
            "tipo": self.tipo,
            "siglas": sorted(self.siglas),
        }


def conectar():
    from dotenv import load_dotenv

    for ruta in (RAIZ / ".env", RAIZ.parent / ".env"):
        if ruta.exists():
            load_dotenv(ruta, override=False)
            break
    url = os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("No hay NEON_OWNER_URL ni DATABASE_URL en el entorno/.env")
    import psycopg2

    conn = psycopg2.connect(url)
    # Garantía dura: la sesión no puede escribir.
    conn.set_session(readonly=True, autocommit=True)
    return conn


def cargar_toponimos(cur) -> set[str]:
    """Nombres de regiones y distritos, en clave completa y por token."""
    cur.execute(
        """
        SELECT nombre FROM core.regiones
         UNION
        SELECT nombre FROM core.distritos
        """
    )
    out: set[str] = set()
    for (nombre,) in cur.fetchall():
        norm = norm_texto(nombre)
        if not norm:
            continue
        out.add(siglas_key(norm))
        out.update(t for t in norm.split() if len(t) >= 3)
    return out


def cargar_catalogo(cur) -> list[Candidato]:
    global TOPONIMOS
    TOPONIMOS = cargar_toponimos(cur)
    cur.execute(
        """
        SELECT a.actor_uid::text, a.nombre_actual, a.abreviatura,
               a.naturaleza, t.nombre
          FROM core.actores a
          LEFT JOIN core.cat_tipos_actor t ON t.id = a.tipo_actor_id
         WHERE a.actor_uid IS NOT NULL
           AND a.nombre_actual IS NOT NULL
           AND btrim(a.nombre_actual) <> ''
        """
    )
    actores = cur.fetchall()

    cur.execute(
        """
        SELECT actor_uid::text, razon_social, abreviatura
          FROM core.organizaciones
         WHERE actor_uid IS NOT NULL
        """
    )
    organizaciones = cur.fetchall()

    cur.execute(
        "SELECT id::text, siglas, nombre_completo FROM core.cat_unidades_organicas"
    )
    unidades = cur.fetchall()

    por_uid = {r[0]: r for r in actores if r[0]}
    candidatos: list[Candidato] = []
    cubiertos: set[str] = set()

    for uid, razon, abrev in organizaciones:
        actor = por_uid.get(uid)
        nombre = (razon or (actor[1] if actor else "") or "").strip()
        if not nombre:
            continue
        textos = [nombre]
        if actor and actor[1] and norm_texto(actor[1]) != norm_texto(nombre):
            textos.append(actor[1])
        # Con `abreviatura` NULL sólo valen las siglas que salen del propio
        # nombre; nunca las de otra fuente.
        siglas = {s for s in siglas_del_nombre(nombre) if sigla_valida(s)}
        for fuente_abrev in (abrev, actor[2] if actor else None):
            if fuente_abrev:
                siglas |= {s for s in parse_siglas(fuente_abrev) if sigla_valida(s)}
        candidatos.append(
            Candidato(
                uid, "core.organizaciones", nombre, "organizacion", textos, siglas
            )
        )
        cubiertos.add(uid)

    for uid, nombre, abrev, naturaleza, tipo_nombre in actores:
        if uid in cubiertos:
            continue
        nombre = (nombre or "").strip()
        if not nombre:
            continue
        tipo = tipo_desde(naturaleza, tipo_nombre, nombre)
        candidatos.append(
            Candidato(
                uid,
                "core.actores",
                nombre,
                tipo,
                [nombre],
                {
                    s
                    for s in (
                        siglas_del_nombre(nombre)
                        | (parse_siglas(abrev) if abrev else set())
                    )
                    if sigla_valida(s)
                },
            )
        )

    for iid, siglas_valor, nombre_completo in unidades:
        nombre = (nombre_completo or "").strip() or (siglas_valor or "").strip()
        if not nombre:
            continue
        candidatos.append(
            Candidato(
                str(iid),
                "core.cat_unidades_organicas",
                nombre,
                "organizacion",
                [nombre],
                {s for s in parse_siglas(siglas_valor) if sigla_valida(s)},
            )
        )
    return candidatos


# --------------------------------------------------------------------------
# Embeddings + léxico
# --------------------------------------------------------------------------
def cargar_modelo():
    hf_offline()
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise SystemExit(
            "Falta sentence-transformers. No se sustituye por TF-IDF: instala "
            "la librería y el modelo desde caché."
        ) from exc
    errores = []
    for nombre in MODELOS:
        try:
            modelo = SentenceTransformer(nombre, device="cpu")
            modelo.encode(
                ["prueba"], normalize_embeddings=True, show_progress_bar=False
            )
            return modelo, nombre
        except Exception as exc:  # noqa: BLE001 - se reporta el fallo del modelo
            errores.append(f"{nombre}: {exc.__class__.__name__}: {exc}")
    raise SystemExit(
        "No hay modelo de embeddings disponible en la caché local "
        "(HF_HUB_OFFLINE=1).\n" + "\n".join(errores)
    )


def construir_matriz_embeddings(modelo, candidatos: list[Candidato]):
    textos: list[str] = []
    tramos: list[tuple[int, int]] = []
    for cand in candidatos:
        inicio = len(textos)
        textos.extend(cand.textos)
        tramos.append((inicio, len(textos)))
    vectores = modelo.encode(
        textos,
        batch_size=64,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return vectores, [t[0] for t in tramos]


def similitud_coseno_matriz(vectores, inicios, vectores_crudo):
    import numpy as np

    salida = np.empty((len(vectores_crudo), len(inicios)), dtype="float32")
    for i in range(len(vectores_crudo)):
        bruto = vectores @ vectores_crudo[i]
        salida[i] = np.maximum.reduceat(bruto, np.asarray(inicios))
    return salida


def motor_lexico():
    try:
        from rapidfuzz import fuzz

        return (lambda a, b: fuzz.ratio(a, b) / 100.0), "rapidfuzz"
    except ImportError:
        from difflib import SequenceMatcher

        return (lambda a, b: SequenceMatcher(None, a, b).ratio()), "difflib"


def matriz_lexica(
    unicos: list[dict], candidatos: list[Candidato], ratio
) -> list[list[float]]:
    filas: list[list[float]] = []
    for reg in unicos:
        a = reg["norm"]
        filas.append([ratio(a, c.norm) if c.norm else 0.0 for c in candidatos])
    return filas


# --------------------------------------------------------------------------
# Cascada
# --------------------------------------------------------------------------
def decidir(
    reg, cos, lex, candidatos, mascara, siglas_idx, nombre_idx, emb_auto=UMBRAL_EMB_AUTO
) -> dict:
    import numpy as np

    idx_validos = np.nonzero(mascara)[0]
    if len(idx_validos) == 0:
        return {
            "veredicto": "nuevo",
            "rama": "6_sin_candidatos_tipo",
            "destino": None,
            "coseno": None,
            "lexico": None,
            "siglas_exactas": False,
            "motivo": f"sin candidatos compatibles de tipo {reg['tipo']}",
        }

    cos_ok = np.where(mascara, cos, -1.0)
    lex_ok = np.where(mascara, lex, -1.0)

    # --- 1. Siglas exactas --------------------------------------------
    # Sólo cuentan siglas que sean un token completo del nombre: nunca un
    # prefijo ni una subcadena. Si el nombre es un solo token («FIUPAP»,
    # «DGA») la clave coincide con ese token; en frases se compara token a
    # token.
    indices_siglas: list[int] = []
    tokens = reg["norm"].split()
    clave = siglas_key(reg["norm"])
    if len(tokens) == 1 and sigla_valida(clave):
        for i in siglas_idx.get(clave, []):
            if mascara[i]:
                indices_siglas.append(i)
    if reg["tipo"] == "organizacion":
        if len(tokens) <= 6:
            for token in tokens:
                if len(token) >= 4 and sigla_valida(token):
                    for i in siglas_idx.get(token, []):
                        if mascara[i]:
                            indices_siglas.append(i)
    if indices_siglas:
        elegido = max(sorted(set(indices_siglas)), key=lambda i: (cos_ok[i], -i))
        return {
            "veredicto": "auto",
            "rama": "1_siglas_exactas",
            "destino": elegido,
            "coseno": float(cos[elegido]),
            "lexico": float(lex[elegido]),
            "siglas_exactas": True,
            "motivo": "siglas exactas normalizadas",
        }

    # --- 2. Nombre exacto normalizado ---------------------------------
    indices_nombre = [i for i in nombre_idx.get(reg["norm"], []) if mascara[i]]
    if indices_nombre:
        elegido = max(indices_nombre, key=lambda i: (cos_ok[i], -i))
        return {
            "veredicto": "auto",
            "rama": "2_nombre_exacto",
            "destino": elegido,
            "coseno": float(cos[elegido]),
            "lexico": float(lex[elegido]),
            "siglas_exactas": False,
            "motivo": "nombre exacto normalizado",
        }

    # --- 3. Léxico >= 0.90 (con respaldo semántico) -------------------
    i_lex = int(np.argmax(lex_ok))
    if lex_ok[i_lex] >= UMBRAL_LEX_AUTO:
        c, l = float(cos_ok[i_lex]), float(lex_ok[i_lex])
        if c >= UMBRAL_SOPORTE_EMB:
            return {
                "veredicto": "auto",
                "rama": "3_lexico",
                "destino": i_lex,
                "coseno": c,
                "lexico": l,
                "siglas_exactas": False,
                "motivo": f"léxico {l:.3f} con respaldo de embedding {c:.3f}",
            }
        return {
            "veredicto": "dudoso",
            "rama": "3_lexico_sin_respaldo",
            "destino": i_lex,
            "coseno": c,
            "lexico": l,
            "siglas_exactas": False,
            "motivo": (
                f"léxico {l:.3f} pero embedding {c:.3f} < {UMBRAL_SOPORTE_EMB:.2f}: "
                "posible coincidencia de prefijo"
            ),
        }

    # --- 4. Embedding >= 0.87 -----------------------------------------
    i_cos = int(np.argmax(cos_ok))
    # Guarda: si el origen contiene una sigla en mayúsculas (DIREPRO, OSPA,
    # DGPARPA) o es un texto muy corto, el embedding no es evidencia: acerca
    # cualquier nombre con forma institucional (DIREPRO → APROBENTO, 0,95;
    # «DIREPRO La Libertad» → «Cámara de Calzado… La Libertad», 0,88). Esos
    # casos sólo se aceptan por siglas exactas o por léxico alto.
    tiene_sigla = bool(
        __import__("re").search(r"\b[A-ZÁÉÍÓÚÑ]{4,}\b", reg["crudo"] or "")
    )
    palabras = len(reg["norm"].split())
    admite_embedding = not tiene_sigla and (palabras >= 3 or len(reg["norm"]) >= 24)
    if admite_embedding and cos_ok[i_cos] >= emb_auto:
        return {
            "veredicto": "auto",
            "rama": "4_embedding",
            "destino": i_cos,
            "coseno": float(cos_ok[i_cos]),
            "lexico": float(lex_ok[i_cos]),
            "siglas_exactas": False,
            "motivo": f"embedding {float(cos_ok[i_cos]):.3f}",
        }

    # --- 5. Dudoso -----------------------------------------------------
    if admite_embedding and cos_ok[i_cos] >= UMBRAL_EMB_DUDOSO:
        return {
            "veredicto": "dudoso",
            "rama": "5_embedding",
            "destino": i_cos,
            "coseno": float(cos_ok[i_cos]),
            "lexico": float(lex_ok[i_cos]),
            "siglas_exactas": False,
            "motivo": f"embedding {float(cos_ok[i_cos]):.3f} entre umbrales",
        }
    if lex_ok[i_lex] >= UMBRAL_LEX_DUDOSO:
        return {
            "veredicto": "dudoso",
            "rama": "5_lexico",
            "destino": i_lex,
            "coseno": float(cos_ok[i_lex]),
            "lexico": float(lex_ok[i_lex]),
            "siglas_exactas": False,
            "motivo": f"léxico {float(lex_ok[i_lex]):.3f} sin respaldo semántico",
        }

    mejor_cos = float(cos_ok[i_cos])
    mejor_lex = max(float(lex_ok[i_cos]), float(lex_ok[i_lex]))
    return {
        "veredicto": "nuevo",
        "rama": "6_nuevo",
        "destino": None,
        "coseno": mejor_cos,
        "lexico": mejor_lex,
        "siglas_exactas": False,
        "motivo": (
            f"sin acierto suficiente (embedding {mejor_cos:.3f}, "
            f"léxico {mejor_lex:.3f})"
        ),
    }


# --------------------------------------------------------------------------
# Verificación
# --------------------------------------------------------------------------
def verificar_ids(cur, destinos: list[dict]) -> list[dict]:
    por_tabla: dict[str, set[str]] = {}
    for d in destinos:
        por_tabla.setdefault(d["tabla"], set()).add(str(d["id"]))
    existentes: dict[str, set[str]] = {}
    if "core.actores" in por_tabla:
        cur.execute(
            "SELECT actor_uid::text FROM core.actores WHERE actor_uid::text = ANY(%s)",
            (sorted(por_tabla["core.actores"]),),
        )
        existentes["core.actores"] = {r[0] for r in cur.fetchall()}
    if "core.organizaciones" in por_tabla:
        cur.execute(
            "SELECT actor_uid::text FROM core.organizaciones "
            "WHERE actor_uid::text = ANY(%s)",
            (sorted(por_tabla["core.organizaciones"]),),
        )
        existentes["core.organizaciones"] = {r[0] for r in cur.fetchall()}
    if "core.cat_unidades_organicas" in por_tabla:
        cur.execute(
            "SELECT id::text FROM core.cat_unidades_organicas WHERE id::text = ANY(%s)",
            (sorted(por_tabla["core.cat_unidades_organicas"]),),
        )
        existentes["core.cat_unidades_organicas"] = {r[0] for r in cur.fetchall()}

    faltantes: list[dict] = []
    vistos = set()
    for d in destinos:
        clave = (d["tabla"], str(d["id"]))
        if clave in vistos:
            continue
        vistos.add(clave)
        if str(d["id"]) not in existentes.get(d["tabla"], set()):
            faltantes.append(d)
    return faltantes


def muestra_auto(filas: list[dict], n: int = 10) -> list[dict]:
    autos = [f for f in filas if f["veredicto"] == "auto"]
    if len(autos) <= n:
        return autos
    paso = max(1, len(autos) // n)
    elegidos = [autos[i] for i in range(0, len(autos), paso)][:n]
    return elegidos


# --------------------------------------------------------------------------
# Principal
# --------------------------------------------------------------------------
def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    print("== match_actores: emparejamiento de la matriz 2026 ==")
    if not ENTRADA.exists():
        raise SystemExit(f"No existe el insumo: {ENTRADA}")
    doc = json.loads(ENTRADA.read_text(encoding="utf-8"))

    fragmentos, total_fragmentos = extraer_fragmentos(doc)
    unicos = construir_unicos(fragmentos)
    print(f"  fragmentos de entrada: {total_fragmentos}")
    print(f"  fragmentos únicos:     {len(unicos)}")

    conn = conectar()
    try:
        cur = conn.cursor()
        candidatos = cargar_catalogo(cur)
        print(f"  candidatos del núcleo: {len(candidatos)}")
        por_tipo_cat: dict[str, int] = {}
        for c in candidatos:
            por_tipo_cat[c.tipo] = por_tipo_cat.get(c.tipo, 0) + 1
        print(f"    por tipo: {por_tipo_cat}")

        modelo, nombre_modelo = cargar_modelo()
        print(f"  modelo de embeddings:  {nombre_modelo} (offline)")

        vectores, inicios = construir_matriz_embeddings(modelo, candidatos)
        vectores_crudo = modelo.encode(
            [reg["texto"] for reg in unicos],
            batch_size=64,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        cos_mat = similitud_coseno_matriz(vectores, inicios, vectores_crudo)

        ratio, motor_lex = motor_lexico()
        lex_mat = matriz_lexica(unicos, candidatos, ratio)
        print(f"  motor léxico:          {motor_lex}")

        tipos = [c.tipo for c in candidatos]
        mask_persona = [t == "persona" for t in tipos]
        mask_org = [t == "organizacion" for t in tipos]

        import numpy as np

        mask_persona_np = np.array(mask_persona, dtype=bool)
        mask_org_np = np.array(mask_org, dtype=bool)

        siglas_idx: dict[str, list[int]] = {}
        nombre_idx: dict[str, list[int]] = {}
        for i, cand in enumerate(candidatos):
            for s in cand.siglas:
                siglas_idx.setdefault(s, []).append(i)
            if cand.norm:
                nombre_idx.setdefault(cand.norm, []).append(i)

        filas: list[dict] = []
        decisiones: list[dict] = []
        descartes_tipo: list[dict] = []
        for i, reg in enumerate(unicos):
            cos = cos_mat[i]
            lex = lex_mat[i]
            mascara = mask_persona_np if reg["tipo"] == "persona" else mask_org_np

            # Trazabilidad de descartes por tipo: el mejor candidato global
            # era del tipo contrario y puntuaba fuerte.
            j_global = int(np.argmax(cos))
            if (not mascara[j_global]) and cos[j_global] >= UMBRAL_EMB_AUTO:
                descartes_tipo.append(
                    {
                        "crudo": reg["crudo"],
                        "tipo_crudo": reg["tipo"],
                        "descartado": candidatos[j_global].como_dict(),
                        "coseno": round(float(cos[j_global]), DECIMALES),
                        "motivo": "tipo incompatible",
                    }
                )

            res = decidir(reg, cos, lex, candidatos, mascara, siglas_idx, nombre_idx)
            decisiones.append(res)
            destino = (
                candidatos[res["destino"]].como_dict()
                if res["destino"] is not None
                else None
            )
            filas.append(
                {
                    "crudo": reg["crudo"],
                    "tipo": reg["tipo"],
                    "coseno": None
                    if res["coseno"] is None
                    else round(res["coseno"], DECIMALES),
                    "lexico": None
                    if res["lexico"] is None
                    else round(res["lexico"], DECIMALES),
                    "siglas_exactas": res["siglas_exactas"],
                    "destino": destino,
                    "veredicto": res["veredicto"],
                    "rama": res["rama"],
                    "motivo": res["motivo"],
                    "ocurrencias": reg["ocurrencias"],
                    "fuentes": reg["fuentes"],
                    "variantes": reg["variantes"],
                }
            )

        # --- Verificación de ids --------------------------------------
        destinos_auto = [
            f["destino"] for f in filas if f["veredicto"] == "auto" and f["destino"]
        ]
        ids_inexistentes = verificar_ids(cur, destinos_auto)

        # --- Fragilidad: umbral de embedding a 0.90 -------------------
        fragiles: list[dict] = []
        for i, reg in enumerate(unicos):
            fila = filas[i]
            if fila["veredicto"] != "auto":
                continue
            mascara = mask_persona_np if reg["tipo"] == "persona" else mask_org_np
            alt = decidir(
                reg,
                cos_mat[i],
                lex_mat[i],
                candidatos,
                mascara,
                siglas_idx,
                nombre_idx,
                emb_auto=UMBRAL_FRAGIL,
            )
            mismo = (
                alt["veredicto"] == fila["veredicto"]
                and (alt["destino"] is None) == (fila["destino"] is None)
                and (
                    alt["destino"] is None
                    or candidatos[alt["destino"]].id == fila["destino"]["id"]
                )
            )
            if not mismo:
                fragiles.append(
                    {
                        "crudo": fila["crudo"],
                        "destino": fila["destino"],
                        "coseno": fila["coseno"],
                        "veredicto_con_0.90": alt["veredicto"],
                        "rama_con_0.90": alt["rama"],
                    }
                )

        # --- Resumen ---------------------------------------------------
        resumen = {
            "auto": {},
            "dudoso": {},
            "nuevo": {},
        }
        for veredicto in ("auto", "dudoso", "nuevo"):
            for tipo in ("persona", "organizacion"):
                resumen[veredicto][tipo] = sum(
                    1
                    for f in filas
                    if f["veredicto"] == veredicto and f["tipo"] == tipo
                )
            resumen[veredicto]["total"] = sum(resumen[veredicto].values())

        por_rama: dict[str, int] = {}
        for f in filas:
            por_rama[f["rama"]] = por_rama.get(f["rama"], 0) + 1

        salida = {
            "meta": {
                "script": "scripts/matriz/match_actores.py",
                "generado_en": dt.datetime.now()
                .astimezone()
                .isoformat(timespec="seconds"),
                "entrada": str(ENTRADA.relative_to(RAIZ)).replace("\\", "/"),
                "solo_lectura": True,
                "autocommit": True,
                "escritura_en_bd": False,
                "modelo_embeddings": nombre_modelo,
                "motor_lexico": motor_lex,
                "umbrales": {
                    "embedding_auto": UMBRAL_EMB_AUTO,
                    "embedding_dudoso": UMBRAL_EMB_DUDOSO,
                    "lexico_auto": UMBRAL_LEX_AUTO,
                    "lexico_dudoso": UMBRAL_LEX_DUDOSO,
                    "soporte_embedding_para_lexico": UMBRAL_SOPORTE_EMB,
                },
                "tipo_de_regla": "cascada if/else (no votos)",
            },
            "resumen": {
                "fragmentos_entrada": total_fragmentos,
                "fragmentos_unicos": len(unicos),
                "candidatos_catalogo": len(candidatos),
                "candidatos_por_tipo": por_tipo_cat,
                **resumen,
                "por_rama": por_rama,
            },
            "filas": filas,
            "verificacion": {
                "muestra_auto": muestra_auto(filas, 10),
                "ids_inexistentes": ids_inexistentes,
                "ids_inexistentes_n": len(ids_inexistentes),
                "fragiles_umbral_090": {
                    "n": len(fragiles),
                    "ejemplos": fragiles[:20],
                },
                "descartes_por_tipo": {
                    "n": len(descartes_tipo),
                    "ejemplos": descartes_tipo[:20],
                },
                "tablas_destino": sorted(
                    {f["destino"]["tabla"] for f in filas if f["destino"]}
                ),
            },
        }

        SALIDA.parent.mkdir(parents=True, exist_ok=True)
        SALIDA.write_text(
            json.dumps(salida, ensure_ascii=False, indent=2, default=str) + "\n",
            encoding="utf-8",
        )

        # --- Reporte a consola ----------------------------------------
        print("\n== resultado ==")
        for veredicto in ("auto", "dudoso", "nuevo"):
            d = resumen[veredicto]
            print(
                f"  {veredicto:<7} total={d['total']:<4} "
                f"persona={d['persona']:<4} organizacion={d['organizacion']}"
            )
        print("\n== ramas de la cascada ==")
        for rama in sorted(por_rama):
            print(f"  {rama:<26} {por_rama[rama]}")
        print(f"\n  ids inexistentes:       {len(ids_inexistentes)}")
        print(f"  auto frágiles (0.90):   {len(fragiles)}")
        print(f"  descartes por tipo:     {len(descartes_tipo)}")
        print(f"  salida: {SALIDA}")

        print("\n== muestra de 10 auto ==")
        print(
            f"  {'crudo':<38} {'destino':<10} {'nombre destino':<38} "
            f"{'cos':>6} {'lex':>6} rama"
        )
        for f in muestra_auto(filas, 10):
            d = f["destino"] or {}
            crudo = f["crudo"].replace("\n", " ")[:37]
            nombre = (d.get("nombre") or "")[:37]
            print(
                f"  {crudo:<38} {str(d.get('id'))[:9]:<10} {nombre:<38} "
                f"{f['coseno'] if f['coseno'] is not None else 0:>6.3f} "
                f"{f['lexico'] if f['lexico'] is not None else 0:>6.3f} {f['rama']}"
            )

        if fragiles:
            print("\n== auto que cambiarían con umbral 0.90 (primeros 5) ==")
            for f in fragiles[:5]:
                d = f["destino"] or {}
                print(
                    f"  {f['crudo'][:40]:<42} cos={f['coseno']} "
                    f"-> {f['veredicto_con_0.90']} ({f['rama_con_0.90']}) "
                    f"{d.get('nombre', '')[:30]}"
                )

        print("\n  listo (sólo lectura, nada escrito en la BD)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
