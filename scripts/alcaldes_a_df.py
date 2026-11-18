#!/usr/bin/env python3
"""Convierte un Word de alcaldes (texto - tabla - texto - tabla) y un Excel de
contactos en un único DataFrame, y exporta solo las cinco columnas que importan.

El Word se lee en orden de documento: cada bloque de texto que precede a una
tabla se interpreta como el nombre de la sección (la provincia), de modo que las
tablas no necesitan repetir la provincia en una columna. Los saltos de línea
irregulares, los párrafos vacíos y las tablas con celdas combinadas se toleran.

El Excel se usa únicamente para lo que falta:
  1. rellenar celdas vacías de las filas que ya existen (se cruzan por
     provincia + distrito, con respaldo difuso dentro de la misma provincia);
  2. agregar las filas que no están en el Word, marcadas en `distrito` con la
     etiqueta de alcalde provincial (por defecto "PROVINCIAL").

Salida (columnas de las dos hojas):
    distrito | provincia | nombres | apellidos | celular | celular_2 |
    correo_electronico | direccion

`nombre` (el nombre completo) es solo un insumo interno del cruce y del reparto:
no se escribe en ninguna hoja. Con `--sin-nombres` no hay reparto y se escribe
`nombre` en lugar de `nombres`/`apellidos`.

El libro de Excel lleva dos hojas con las mismas columnas:
    * «SALIENTES - En gestión»: el directorio de las autoridades que hoy están en
      el cargo (corte 2026), con el nombre partido en nombres/apellidos;
    * «ENTRANTES - Elegidos»: el Word 2027-2030 más lo que falte del Excel de
      contactos.

Con `--departamento`, las dos hojas se completan contra el ubigeo: hay una fila
por cada distrito del departamento en ambas y la que no tiene dato queda vacía.
El índice del ubigeo manda, no la fuente.

Cada fuente tiene un rol fijo: el Word 2027-2030 y su Excel de contactos son los
ELEGIDOS; el directorio es la gestión vigente. La dirección de la municipalidad se
toma del directorio y se usa en ambas hojas. Los nombres de hoja se cambian con
`--hoja-salida` y `--hoja-entrantes`.

Los nombres geográficos se corrigen con `toponimos.json` (ver `--toponimos` y
`--sin-correcciones`). El mapa vive fuera del código para poder editarlo a mano.

Uso
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --archivo2 base.xlsx
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --archivo2 base.xlsx --hoja Hoja1
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --departamento ancash \
        --directorio DIRECTORIO_ALCALDES_ANCASH_2026.csv --con-ubigeo
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --salida salida.csv
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --sin-directorio
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --sin-correcciones
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --toponimos mi_mapa.json
    python scripts/alcaldes_a_df.py --archivo1 alcaldes.docx --debug
    python scripts/alcaldes_a_df.py --autotest        # valida el parser solo

Los dos archivos se identifican por su extensión, así que el orden no importa;
`--docx` y `--excel` quedan como alias de `--archivo1` y `--archivo2`.

Dependencias: pandas, openpyxl, python-docx.

Notas de implementación
    * El orden texto/tabla se recupera recorriendo el cuerpo XML del documento;
      `Document.tables` lo perdería. También se desciende en los controles de
      contenido (`w:sdt`) y se lee el texto de los cuadros de texto.
    * Las columnas se detectan por encabezado con alias (DISTRITO, ALCALDE,
      CELULAR/TELÉFONO, CORREO...). Si una tabla no trae encabezado reconocible,
      se aplica una plantilla por ancho de tabla o la indicada con --columnas.
    * La provincia se busca en cualquier línea que nombre la palabra PROVINCIA
      ('PROVINCIA DE HUARAZ', 'HUARAZ - PROVINCIA', o un encabezado con el año
      alrededor) y, si no aparece, en un titular suelto en mayúsculas. Las tablas
      que traen columna de distrito heredan la última provincia anunciada.
    * Solo se escriben valores donde la celda está vacía: nunca se sobrescribe
      lo que ya trae el Word.
    * Ante una errata se compara con tres métricas a la vez (Jaro-Winkler,
      Damerau-Levenshtein y palabras ordenadas) y se exige un ganador claro: si
      dos candidatos quedan cerca, no se cruza nada en lugar de cruzar mal.
    * El directorio viene truncado por ancho fijo ('CHAVIN DE HUAN', 'SAN JUAN DE
      RON'): se lleva al ubigeo solo cuando el prefijo identifica a un único distrito
      de esa provincia. La dirección se cruza por municipalidad y el distrito
      capital hereda la de la provincia, porque el directorio lo registra en la
      fila PROVINCIAL.
    * El directorio trae al alcalde provincial, no al distrital del distrito
      capital: esa fila se agrega vacía al completar la hoja contra el ubigeo, y su
      dirección se hereda de la sede provincial, que es la misma.
    * La capital de provincia no está en el geodir. Se toma el nombre de la columna
      Distrito de la fila PROVINCIAL del directorio y se resuelve contra el ubigeo,
      pero ese código solo sirve para ubicar el distrito capital y heredarle la
      dirección: la fila PROVINCIAL no es un distrito, así que se queda sin `ubigeo`
      en las dos hojas. Los códigos del directorio no se usan nunca (en Áncash,
      Antonio Raymondi figura como 020301 y el del geodir es 021601). Se informa
      aparte cuando hubo que recurrir al código del directorio porque el nombre no
      estaba.
    * La hoja `diagnostico` suma a sus tablas vivas un bloque «AVISOS» con lo que
      ninguna fórmula puede deducir: provincias del ubigeo sin una sola fila de las
      entradas, distritos agregados vacíos, distritos fuera del ubigeo y filas
      descartadas del Word, del Excel o del directorio.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

COLUMNAS_FINALES = ["distrito", "provincia", "nombre", "celular", "correo_electronico"]
COLUMNA_CELULAR_2 = "celular_2"
COLUMNAS_SALIDA = [
    "distrito",
    "provincia",
    "nombre",
    "nombres",
    "apellidos",
    "celular",
    COLUMNA_CELULAR_2,
    "correo_electronico",
]
# Columnas que se escriben en las hojas: `nombre` queda como insumo interno.
COLUMNAS_VISIBLES = [columna for columna in COLUMNAS_SALIDA if columna != "nombre"]
TAG_PROVINCIAL = "PROVINCIAL"
MARGEN_FORMULA = 5000

# Los parecidos ortográficos (n-gramas de caracteres) actúan solo como último
# recurso, después del nombre exacto y del prefijo/contención única. Se apagan con
# `--sin-parecidos`.
USAR_PARECIDOS = True

# Hojas del Excel de salida (Excel admite 31 caracteres por nombre).
HOJA_SALIENTES = "SALIENTES - En gestión"
HOJA_ENTRANTES = "ENTRANTES - Elegidos"

# ---------------------------------------------------------------------------
# Utilidades de texto
# ---------------------------------------------------------------------------

_ESPACIOS_RAROS = re.compile(r"[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]")


def limpiar(valor) -> str:
    """Normaliza un valor a texto legible: sin espacios raros ni saltos dobles."""
    if valor is None:
        return ""
    texto = str(valor)
    if texto.lower() in {"nan", "none", "nat"}:
        return ""
    texto = unicodedata.normalize("NFKC", texto)
    texto = _ESPACIOS_RAROS.sub(" ", texto)
    texto = re.sub(r"\s+", " ", texto)
    return texto.strip()


def sin_acentos(texto: str) -> str:
    descompuesto = unicodedata.normalize("NFD", texto)
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn")


def clave(valor) -> str:
    """Clave agresiva para comparar (mayúsculas, sin acentos ni puntuación)."""
    texto = sin_acentos(limpiar(valor)).upper()
    texto = re.sub(r"[^A-Z0-9 ]+", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


_VACIOS = {
    "",
    "-",
    "--",
    "—",
    "–",
    ".",
    "0",
    "N/A",
    "NA",
    "N.A.",
    "S/D",
    "S/N",
    "SD",
    "SN",
    "SIN DATO",
    "SIN DATOS",
    "SIN CORREO",
    "SIN TELEFONO",
    "NO REGISTRA",
    "NO TIENE",
    "NINGUNO",
    "NINGUNA",
    "PENDIENTE",
}


def es_vacio(valor) -> bool:
    """True si el valor no aporta información (incluye NaN y marcadores de vacío)."""
    if valor is None:
        return True
    try:
        if pd.isna(valor):
            return True
    except (TypeError, ValueError):
        pass
    return clave(valor) in _VACIOS or limpiar(valor) in _VACIOS


_PARTICULAS = {"de", "del", "la", "las", "los", "y", "e", "el"}


def normalizar_toponimo(valor) -> str:
    """Deja un topónimo presentable: 'LA MAR' -> 'La Mar', 'Piura' -> 'Piura'."""
    texto = limpiar(valor)
    if not texto:
        return ""
    letras = [c for c in texto if c.isalpha()]
    if letras and all(c.isupper() for c in letras):
        palabras = texto.lower().split()
        texto = " ".join(
            p if (i > 0 and p in _PARTICULAS) else p[:1].upper() + p[1:]
            for i, p in enumerate(palabras)
        )
    return texto.strip(" .,-")


_RE_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def extraer_emails(valor) -> str:
    """Extrae uno o varios correos de una celda y los une con ' ; '."""
    if es_vacio(valor):
        return ""
    texto = limpiar(valor)
    texto = re.sub(r"\s*@\s*", "@", texto)
    encontrados: list[str] = []
    for correo in _RE_EMAIL.findall(texto):
        correo = correo.strip(".,;:").lower()
        if correo and correo not in encontrados:
            encontrados.append(correo)
    return " ; ".join(encontrados)


_RE_TELEFONO = re.compile(r"\+?\d[\d\s\-\.\(\)]{5,}\d")
_RE_SEPARADOR_TELEFONO = re.compile(r"\s*[/;,]\s*|\s+y\s+", re.IGNORECASE)


def _numeros_celular(valor) -> list[str]:
    """Números de una celda de teléfono: solo dígitos, sin prefijo país y sin repetir."""
    if es_vacio(valor):
        return []
    texto = limpiar(valor)
    candidatos: list[str] = []
    for trozo in _RE_SEPARADOR_TELEFONO.split(texto):
        if not trozo.strip():
            continue
        candidatos.extend(_RE_TELEFONO.findall(trozo) or [trozo])
    salida: list[str] = []
    for candidato in candidatos:
        digitos = re.sub(r"\D", "", candidato)
        if not digitos:
            continue
        if len(digitos) == 11 and digitos.startswith("51"):
            digitos = digitos[2:]
        elif len(digitos) == 12 and digitos.startswith("051"):
            digitos = digitos[3:]
        if digitos not in salida:
            salida.append(digitos)
    return salida


def normalizar_celular(valor) -> str:
    """Deja solo dígitos, quita el prefijo país 51 y une varios números con ' / '."""
    return " / ".join(_numeros_celular(valor))


def _limpiar_nombre(valor) -> str:
    """Nombre presentable: sin paréntesis accesorios ni numeración de lista."""
    texto = limpiar(valor)
    texto = re.sub(r"^[\-\u2022\*]\s*", "", texto)
    texto = re.sub(r"\s*\([^)]{0,40}\)\s*", " ", texto)
    return re.sub(r"\s+", " ", texto).strip(" .,-")


_RE_DNI = re.compile(
    r"(?i)\b(?:dni|d\.\s?n\.\s?i\.?|documento(?:\s+de\s+identidad)?)\s*[:.\-]?\s*(\d{8})\b"
)


def separar_dni(nombre: str) -> tuple[str, str]:
    """Si el nombre trae el DNI pegado en la misma celda, lo separa."""
    coincidencia = _RE_DNI.search(nombre)
    if not coincidencia:
        return nombre, ""
    limpio = (
        nombre[: coincidencia.start()] + " " + nombre[coincidencia.end() :]
    ).strip()
    return re.sub(r"\s+", " ", limpio).strip(" .,-"), coincidencia.group(1)


# ---------------------------------------------------------------------------
# Lectura del Word en orden de documento
# ---------------------------------------------------------------------------


def iterar_bloques(doc):
    """Recorre el cuerpo del documento devolviendo ('p'|'t', bloque) en orden."""

    def recorrer(contenedor):
        for hijo in contenedor.iterchildren():
            if hijo.tag == qn("w:p"):
                yield "p", Paragraph(hijo, doc)
            elif hijo.tag == qn("w:tbl"):
                yield "t", Table(hijo, doc)
            elif hijo.tag == qn(
                "w:sdt"
            ):  # control de contenido: puede envolver párrafos o tablas
                contenido = hijo.find(qn("w:sdtContent"))
                if contenido is not None:
                    yield from recorrer(contenido)

    yield from recorrer(doc.element.body)


def texto_de_parrafo(parrafo: Paragraph) -> str:
    texto = limpiar(parrafo.text)
    if texto:
        return texto
    partes: list[str] = []
    for nodo in parrafo._element.findall(".//" + qn("w:txbxContent")):
        partes.extend(t.text or "" for t in nodo.iter(qn("w:t")))
    return limpiar(" ".join(partes))


def texto_de_celda(celda) -> str:
    partes = [limpiar(p.text) for p in celda.paragraphs]
    return " ".join(p for p in partes if p)


def filas_de_tabla(tabla: Table) -> list[list[str]]:
    """Matriz de textos; las celdas combinadas repetidas se colapsan una vez."""
    filas: list[list[str]] = []
    for fila in tabla.rows:
        celdas: list[str] = []
        anterior = None
        for celda in fila.cells:
            if (
                celda._tc is anterior
            ):  # celda combinada horizontal: python-docx la repite
                continue
            anterior = celda._tc
            celdas.append(texto_de_celda(celda))
        while celdas and not celdas[-1]:
            celdas.pop()
        filas.append(celdas)
    return filas


# --- detección de la sección (la provincia) en el texto que precede a la tabla

_PALABRAS_NO_SECCION = {
    "RELACION",
    "LISTADO",
    "PADRON",
    "DIRECTORIO",
    "ANEXO",
    "TOTAL",
    "CUADRO",
    "TABLA",
    "FUENTE",
    "ELABORADO",
    "OBSERVACION",
    "OBSERVACIONES",
    "NOTA",
    "INDICE",
    "CONTENIDO",
    "INTRODUCCION",
    "ALCALDE",
    "ALCALDES",
    "ALCALDESA",
    "ALCALDESAS",
    "AUTORIDAD",
    "AUTORIDADES",
    "DISTRITAL",
    "DISTRITALES",
    "PROVINCIAL",
    "PROVINCIALES",
}

_RE_COLA_DESCRIPTIVA = re.compile(
    r"(?i)\b(relaci[oó]n|listado|padr[oó]n|directorio|alcaldes?|alcaldesas?|"
    r"distritales?|provinciales?|autoridades|anexo|cuadro|tabla)\b.*$"
)


def _extraer_toponimo(texto: str) -> str | None:
    """Devuelve el nombre de provincia si el párrafo funciona como encabezado."""
    original = limpiar(texto)
    if not texto_valido_para_seccion(original):
        return None

    t = original.rstrip(":")
    tiene_palabra_clave = bool(
        re.match(r"(?i)^(provincia|prov\.?|departamento|regi[oó]n|distrito)\b", t)
    )

    t = re.split(r"\s+[-\u2013\u2014:|]\s+|\s*\(\s*", t)[0]
    t = _RE_COLA_DESCRIPTIVA.sub("", t)
    t = re.sub(
        r"(?i)^(provincia|prov\.?|departamento|regi[oó]n|distrito)\s+"
        r"(constitucional\s+)?(de\s+|del\s+)?",
        "",
        t,
    )
    t = re.sub(r"^\d+[\.\)\-]\s*", "", t)
    t = t.strip(" .,-\u2013\u2014")

    if not t or len(t) > 45 or re.search(r"\d", t):
        return None
    if any(palabra in _PALABRAS_NO_SECCION for palabra in clave(t).split()):
        return None

    solo_letras = re.sub(r"\W", "", t)
    en_mayusculas = bool(solo_letras) and sum(c.isupper() for c in solo_letras) >= max(
        3, int(0.6 * len(solo_letras))
    )
    if not (tiene_palabra_clave or en_mayusculas or len(t.split()) <= 3):
        return None
    return normalizar_toponimo(t)


def texto_valido_para_seccion(texto: str) -> bool:
    """Descarta frases largas, con cifras o vacías; el resto lo decide _extraer_toponimo."""
    if not texto or len(texto) > 90:
        return False
    if re.search(r"\d{2,}", texto):
        return False
    return bool(clave(texto))


# --- provincia anunciada en una línea cualquiera (la palabra PROVINCIA manda)

# Palabras que delatan una frase y no un nombre de provincia.
_PALABRAS_NO_SECCION_EXTRA = {
    "PROVINCIA",
    "PROVINCIAS",
    "PROV",
    "DEPARTAMENTO",
    "REGION",
    "GOBIERNO",
    "REGIONAL",
    "MUNICIPALIDAD",
    "MUNICIPAL",
    "ELECTOS",
    "ELECTAS",
    "PERIODO",
    "ANIO",
    "ANO",
    "CONSTITUCIONAL",
}

_RE_PALABRA_PROVINCIA = re.compile(
    r"\b(?:PROVINCIAL(?:ES|IDAD)?|PROVINCIAS?|PROV)\.?\b"
)
_RE_CORTE_CANDIDATO = re.compile(r"[-\u2013\u2014:;|,()\[\]/]")
_RE_CONECTOR_INICIAL = re.compile(r"(?i)^(?:constitucional\s+)?(?:de|del)\s+")
_CONECTORES_SUELTOS = {"DE", "DEL", "LA", "EL", "LOS", "LAS", "Y"}


def _es_nombre_de_provincia(texto: str) -> bool:
    """Valida un candidato suelto: sin cifras, corto y sin palabras de relleno."""
    t = limpiar(texto).strip(" .,-\u2013\u2014")
    if not t or len(t) > 45 or re.search(r"\d", t):
        return False
    palabras = clave(t).split()
    if not palabras or len(palabras) > 5:
        return False
    if len(palabras) == 1 and palabras[0] in _CONECTORES_SUELTOS:
        return False
    return not any(
        p in _PALABRAS_NO_SECCION or p in _PALABRAS_NO_SECCION_EXTRA for p in palabras
    )


def _recortar_candidato(texto: str, desde_el_final: bool = False) -> str | None:
    """Parte el texto en tramos y devuelve el primero que parece una provincia."""
    tramos = [limpiar(x) for x in _RE_CORTE_CANDIDATO.split(texto)]
    tramos = [t for t in tramos if t]
    if desde_el_final:
        tramos.reverse()
    for tramo in tramos:
        tramo = _RE_CONECTOR_INICIAL.sub("", tramo)
        # Una provincia nunca lleva cifras: se corta el año o la numeración de lista
        tramo = re.sub(r"[\s,.]*\d.*$", "", tramo)
        tramo = re.sub(r"^\d+[.)\-]\s*", "", tramo)
        tramo = _RE_COLA_DESCRIPTIVA.sub("", tramo).strip(" .,-\u2013\u2014")
        if _es_nombre_de_provincia(tramo):
            return normalizar_toponimo(tramo)
    return None


def _provincia_en_linea(texto: str) -> str | None:
    """Extrae la provincia de una línea que menciona la palabra PROVINCIA.

    Acepta 'PROVINCIA DE HUARAZ', 'HUARAZ - PROVINCIA' y encabezados con más
    texto alrededor ('PROVINCIA DE HUARAZ 2027-2030 · ALCALDES DISTRITALES'): el
    nombre es el tramo contiguo a la palabra clave, no la línea completa.
    """
    t = limpiar(texto)
    if not t:
        return None
    plano = sin_acentos(t).upper()
    menciones = list(_RE_PALABRA_PROVINCIA.finditer(plano))
    if not menciones:
        return None
    # La última mención: 'REGISTRO DE ALCALDES DE LA PROVINCIA DE HUARAZ'
    ultima = menciones[-1]
    candidato = _recortar_candidato(t[ultima.end() :])
    if candidato:
        return candidato
    return _recortar_candidato(t[: ultima.start()], desde_el_final=True)


def detectar_seccion(parrafos: list[str]) -> str | None:
    """Busca la provincia en los últimos párrafos (el más cercano manda).

    Primero se buscan líneas que nombren la provincia explícitamente; si no hay,
    se aceptan encabezados sueltos ('HUARAZ') como hasta ahora.
    """
    ultimos = parrafos[-6:]
    for texto in reversed(ultimos):
        candidato = _provincia_en_linea(texto)
        if candidato:
            return candidato
    for texto in reversed(ultimos):
        candidato = _extraer_toponimo(texto)
        if candidato:
            return candidato
    return None


# ---------------------------------------------------------------------------
# Mapeo de columnas por encabezado
# ---------------------------------------------------------------------------

_ALIAS: dict[str, tuple[str, ...]] = {
    "distrito": ("DISTRITO", "DISTRITOS", "DISTRITO ELECTORAL"),
    "provincia": ("PROVINCIA", "PROVINCIAS"),
    "nombre": (
        "ALCALDE",
        "ALCALDESA",
        "ALCALDE SA",
        "NOMBRE",
        "NOMBRES",
        "APELLIDOS Y NOMBRES",
        "AUTORIDAD",
        "TITULAR",
    ),
    "celular": (
        "CELULAR",
        "CELULARES",
        "NRO CELULAR",
        "TELEFONO",
        "TELEFONOS",
        "TELEFONO FIJO",
        "MOVIL",
        "WHATSAPP",
        "TELF",
        "TEL",
    ),
    "correo_electronico": (
        "CORREO ELECTRONICO",
        "CORREO INSTITUCIONAL",
        "CORREO PERSONAL",
        "CORREO",
        "E MAIL",
        "EMAIL",
        "MAIL",
    ),
    "cargo": ("CARGO", "CARGO ACTUAL"),
    "dni": ("DNI", "NRO DNI", "DOCUMENTO", "DOCUMENTO DE IDENTIDAD"),
    "organizacion": (
        "ORGANIZACION POLITICA",
        "ORGANZIACION POLITICA",
        "ORGANIZACION",
        "PARTIDO POLITICO",
        "PARTIDO",
        "AGRUPACION",
        "MOVIMIENTO",
    ),
    "nro": ("NRO", "NUMERO", "NRO ORDEN", "ORDEN"),
}

# ---------------------------------------------------------------------------
# Topónimos: correcciones y equivalencias (archivo JSON editable)
# ---------------------------------------------------------------------------

RUTA_TOPONIMOS_POR_DEFECTO = Path(__file__).with_name("toponimos.json")


class Toponimos:
    """Correcciones de nombres geográficos y equivalencias para cruzar archivos.

    El mapa vive en `toponimos.json` para poder corregirlo sin tocar el código; las
    claves se comparan con `clave()`, así que mayúsculas, tildes y puntuación dan
    igual al escribir el archivo.
    """

    def __init__(self, provincias=None, distritos=None, equivalencias=None):
        self.provincias = {clave(k): v for k, v in (provincias or {}).items() if v}
        self.distritos: dict[str, dict[str, str]] = {}
        for provincia, reglas in (distritos or {}).items():
            self.distritos[clave(provincia)] = {
                clave(k): v for k, v in (reglas or {}).items() if v
            }
        self.equivalencias = {
            clave(k): v for k, v in (equivalencias or {}).items() if v
        }

    def __bool__(self) -> bool:
        return bool(self.provincias or self.distritos or self.equivalencias)

    def corregir_provincia(self, valor: str) -> str:
        if not valor:
            return valor
        return self.provincias.get(clave(valor), valor)

    def corregir_distrito(self, valor: str, provincia: str = "") -> str:
        if not valor:
            return valor
        nombre = clave(valor)
        # '*' funciona como regla global para cualquier provincia
        for alcance in (clave(provincia), "*"):
            reglas = self.distritos.get(alcance)
            if reglas and nombre in reglas:
                return reglas[nombre]
        return valor


def cargar_toponimos(ruta=None, avisar: bool = True) -> Toponimos:
    """Lee el JSON de correcciones; si falta, devuelve un mapa vacío."""
    ruta = Path(ruta) if ruta else RUTA_TOPONIMOS_POR_DEFECTO
    if not ruta.exists():
        if avisar:
            print(
                f"Aviso: no se encontró {ruta}; se dejan los nombres tal cual.",
                file=sys.stderr,
            )
        return Toponimos()
    with ruta.open(encoding="utf-8") as archivo:
        datos = json.load(archivo)
    return Toponimos(
        provincias=datos.get("provincias"),
        distritos=datos.get("distritos"),
        equivalencias=datos.get("equivalencias_provincia"),
    )


TOPONIMOS = cargar_toponimos()


def corregir_toponimos(df: pd.DataFrame) -> pd.DataFrame:
    """Aplica el mapa a provincia y distrito; la etiqueta PROVINCIAL no se toca."""
    if df.empty or not TOPONIMOS:
        return df
    df = df.copy()
    df["provincia"] = df["provincia"].map(TOPONIMOS.corregir_provincia)
    df["distrito"] = [
        TOPONIMOS.corregir_distrito(d, p)
        for d, p in zip(df["distrito"], df["provincia"])
    ]
    return df


_RE_PARENTESIS = re.compile(r"^(?P<fuera>[^()]+?)\s*\((?P<dentro>[^()]+)\)\s*$")


def dividir_provincia_distrito(valor) -> tuple[str, str]:
    """Desdobla 'Pamparomas (Huaylas)' en (provincia='Huaylas', distrito='Pamparomas').

    En el Excel de contactos el paréntesis contiene la PROVINCIA y el texto de fuera el
    distrito. Sin paréntesis, la celda solo trae provincia (fila de alcalde provincial).
    """
    texto = limpiar(valor)
    if not texto:
        return "", ""
    coincidencia = _RE_PARENTESIS.match(texto)
    if not coincidencia:
        return normalizar_toponimo(texto), ""
    distrito = normalizar_toponimo(coincidencia.group("fuera"))
    provincia = normalizar_toponimo(coincidencia.group("dentro"))
    return provincia, distrito


_UMBRAL_PROVINCIA = 0.85
_TOKEN_IGNORADO_PROVINCIA = {"DE", "DEL", "LOS", "LAS"}


def _tokens_provincia(texto: str) -> set[str]:
    return {t for t in clave(texto).split() if t not in _TOKEN_IGNORADO_PROVINCIA}


def _resolver_provincia(provincias_base: dict[str, str], provincia) -> tuple[str, str]:
    """Traduce el nombre de provincia del Excel al que usa el Word.

    `provincias_base` es {clave: nombre tal como aparece en el Word}. Devuelve
    (nombre_del_Word, motivo). Nunca inventa: si nada se parece lo suficiente,
    devuelve el nombre recibido con motivo 'nueva'.
    """
    texto = normalizar_toponimo(provincia)
    c = clave(texto)
    if not c:
        return "", "vacia"
    if c in provincias_base:
        return provincias_base[c], "exacto"

    alias = TOPONIMOS.equivalencias.get(c)
    if alias and clave(alias) in provincias_base:
        return provincias_base[clave(alias)], "alias"

    tokens = _tokens_provincia(texto)
    por_tokens = [
        nombre
        for nombre in provincias_base.values()
        if _tokens_provincia(nombre) == tokens
    ]
    if len(por_tokens) == 1:
        return por_tokens[0], "parecido"

    # Nombre abreviado: 'Fermin Fitzcarrald' dentro de 'Carlos Fermin Fitzcarrald'.
    # Se exigen al menos dos tokens en común para no confundir 'Mar' con 'La Mar'.
    por_inclusion = []
    for nombre in provincias_base.values():
        tokens_word = _tokens_provincia(nombre)
        comunes = tokens & tokens_word
        if len(comunes) >= 2 and (tokens <= tokens_word or tokens_word <= tokens):
            por_inclusion.append(nombre)
    if len(por_inclusion) == 1:
        return por_inclusion[0], "parecido"
    if len(por_inclusion) > 1:
        return texto, "ambigua"

    if not provincias_base:
        return texto, "nueva"
    puntajes = sorted(
        ((_similitud(texto, nombre), nombre) for nombre in provincias_base.values()),
        key=lambda par: par[0],
        reverse=True,
    )
    mejor, nombre_mejor = puntajes[0]
    segundo = puntajes[1][0] if len(puntajes) > 1 else 0.0
    if mejor >= _UMBRAL_PROVINCIA and mejor - segundo >= 0.05:
        return nombre_mejor, "parecido"
    return texto, "nueva"


_MAPA_EXACTO = {
    clave(alias): campo
    for campo, alias_lista in _ALIAS.items()
    for alias in alias_lista
}
_ALIAS_ORDENADOS = sorted(
    _MAPA_EXACTO.items(), key=lambda par: len(par[0]), reverse=True
)


def clasificar_encabezado(texto) -> str | None:
    """Traduce un encabezado ('TELÉFONO CELULAR', 'PROVINCIA\\n(COSTA)'...) a campo."""
    c = clave(texto)
    if not c:
        return None
    if c in _MAPA_EXACTO:
        return _MAPA_EXACTO[c]
    for alias, campo in _ALIAS_ORDENADOS:
        if c.startswith(alias) or (len(c) >= 4 and alias.startswith(c)):
            return campo
    for alias, campo in _ALIAS_ORDENADOS:
        if len(alias) >= 5 and alias in c:
            return campo
    return None


def _plantilla_por_ancho(ancho: int) -> list[str]:
    """Reparto posicional cuando la tabla no trae encabezado reconocible."""
    plantillas = {
        1: ["distrito"],
        2: ["distrito", "nombre"],
        3: ["distrito", "nombre", "celular"],
        4: ["distrito", "nombre", "celular", "correo_electronico"],
        5: ["distrito", "nombre", "organizacion", "celular", "correo_electronico"],
    }
    if ancho in plantillas:
        return plantillas[ancho]
    base = ["distrito", "nombre", "organizacion", "celular", "correo_electronico"]
    return base + [f"extra_{i}" for i in range(1, ancho - len(base) + 1)]


def _es_fila_encabezado(celdas: list[str]) -> bool:
    """Un encabezado son rótulos cortos; una celda larga ya es un dato."""
    cortas = [c for c in celdas if c and len(c) <= 30]
    if sum(1 for c in cortas if clasificar_encabezado(c)) >= 2:
        return True
    return (
        bool(cortas)
        and all(not re.search(r"\d", c) for c in cortas)
        and any(clasificar_encabezado(c) for c in cortas)
    )


def _titulo_de_seccion(texto: str) -> str | None:
    """Nombre de provincia en un rótulo suelto (dentro o fuera de una tabla)."""
    return _provincia_en_linea(texto) or _extraer_toponimo(texto)


def _es_separador_de_tabla(celdas: list[str]) -> bool:
    """Fila que solo rotula una sección dentro de la tabla (celda combinada)."""
    no_vacias = [c for c in celdas if c]
    if len(no_vacias) <= 1 or len(set(map(clave, no_vacias))) == 1:
        return bool(_titulo_de_seccion(no_vacias[0])) if no_vacias else False
    return False


def _es_pie_de_tabla(celdas: list[str]) -> bool:
    primera = clave(celdas[0]) if celdas else ""
    return any(
        primera.startswith(p)
        for p in ("TOTAL", "FUENTE", "NOTA", "ELABORADO", "SUBTOTAL")
    )


# ---------------------------------------------------------------------------
# Construcción de registros
# ---------------------------------------------------------------------------


_RE_ROTULO_DISTRITO = re.compile(
    r"(?i)^(?:distrito|dist\.?)\s*(?:(?:de|del|n[°ºo]?)\s*)?(?:\d+\s*[:.\-]?\s*)?"
)
_RE_PARENTESIS_COLA = re.compile(r"\s*\([^)]{0,60}\)\s*$")


def _limpiar_distrito(valor) -> str:
    """Deja solo el nombre del distrito: sin 'DISTRITO DE', numeración ni paréntesis."""
    texto = limpiar(valor)
    if not texto:
        return ""
    texto = _RE_ROTULO_DISTRITO.sub("", texto)
    texto = _RE_PARENTESIS_COLA.sub("", texto)
    return normalizar_toponimo(texto)


def _fila_a_registro(celdas, mapa, provincia):
    valores: dict[str, str] = {}
    for indice, celda in enumerate(celdas):
        campo = mapa.get(indice)
        if not campo or not celda:
            continue
        valores[campo] = f"{valores[campo]} / {celda}" if campo in valores else celda

    nombre, dni = separar_dni(_limpiar_nombre(valores.get("nombre", "")))
    if dni and not valores.get("dni"):
        valores["dni"] = dni

    distrito = _limpiar_distrito(valores.get("distrito", ""))
    provincia_fila = (
        _provincia_en_linea(valores.get("provincia", ""))
        or normalizar_toponimo(valores.get("provincia", ""))
        or provincia
    )

    registro = {
        "distrito": distrito,
        "provincia": provincia_fila,
        "nombre": nombre,
        "celular": normalizar_celular(valores.get("celular", "")),
        "correo_electronico": extraer_emails(valores.get("correo_electronico", "")),
    }
    if not any(registro[c] for c in ("nombre", "celular", "correo_electronico")):
        return None
    return registro


def leer_docx(
    ruta,
    columnas: list[str] | None = None,
    provincia_inicial: str | None = None,
    debug: bool = False,
) -> tuple[pd.DataFrame, list[dict]]:
    """Lee el Word completo y devuelve (dataframe, diagnóstico por tabla)."""
    doc = Document(str(ruta))
    registros: list[dict] = []
    diagnostico: list[dict] = []
    pendientes: list[str] = []
    provincia_actual = normalizar_toponimo(provincia_inicial or "")
    indice_tabla = 0

    for tipo, bloque in iterar_bloques(doc):
        if tipo == "p":
            texto = texto_de_parrafo(bloque)
            if texto:
                pendientes.append(texto)
                if debug:
                    print(f"  [párrafo] {texto[:100]}")
            continue

        indice_tabla += 1
        filas = filas_de_tabla(bloque)
        seccion = detectar_seccion(pendientes)
        if debug:
            print(
                f"[tabla {indice_tabla}] {len(filas)} filas · sección: {seccion or '(sin sección)'}"
            )
        pendientes = []
        if seccion:
            provincia_actual = seccion

        if not filas:
            diagnostico.append(
                {
                    "tabla": indice_tabla,
                    "provincia": provincia_actual,
                    "filas": 0,
                    "columnas": "",
                    "modo": "vacía",
                }
            )
            continue

        mapa: dict[int, str] = {}
        for indice, celda in enumerate(filas[0]):
            campo = clasificar_encabezado(celda)
            if campo:
                mapa.setdefault(indice, campo)
        modo = "encabezado" if len(mapa) >= 2 else "plantilla"
        if modo == "plantilla":
            plantilla = columnas or _plantilla_por_ancho(
                max((len(f) for f in filas), default=0)
            )
            mapa = {i: campo for i, campo in enumerate(plantilla)}
        cuerpo = filas[1:] if modo == "encabezado" else filas

        agregadas = 0
        for celdas in cuerpo:
            if not any(celdas) or _es_pie_de_tabla(celdas):
                continue
            if _es_separador_de_tabla(celdas):
                etiqueta = _titulo_de_seccion(next(c for c in celdas if c))
                if etiqueta:
                    provincia_actual = etiqueta
                continue
            if _es_fila_encabezado(celdas):
                continue
            registro = _fila_a_registro(celdas, mapa, provincia_actual)
            if registro:
                registros.append(registro)
                agregadas += 1

        diagnostico.append(
            {
                "tabla": indice_tabla,
                "provincia": provincia_actual,
                "filas": agregadas,
                "columnas": ", ".join(
                    f"{i}:{campo}" for i, campo in sorted(mapa.items())
                ),
                "modo": modo,
            }
        )

    df = pd.DataFrame(registros, columns=COLUMNAS_FINALES)
    return corregir_toponimos(df), diagnostico


# ---------------------------------------------------------------------------
# Lectura del Excel
# ---------------------------------------------------------------------------


def _detectar_fila_encabezado(crudo: pd.DataFrame, maximo: int = 25) -> int:
    mejor_fila, mejor_puntaje = 0, 0
    for indice in range(min(maximo, len(crudo))):
        celdas = [limpiar(c) for c in crudo.iloc[indice].tolist()]
        puntaje = sum(1 for c in celdas if clasificar_encabezado(c))
        if puntaje > mejor_puntaje:
            mejor_fila, mejor_puntaje = indice, puntaje
    if mejor_puntaje < 2:
        raise ValueError(
            "No se encontró una fila de encabezado reconocible en el Excel. "
            "Revisa la hoja o indícala con --fila-encabezado N."
        )
    return mejor_fila


def leer_excel(
    ruta,
    hoja=None,
    fila_encabezado: int | None = None,
    solo_confirmados: bool = False,
) -> tuple[pd.DataFrame, list[str]]:
    """Devuelve (dataframe canónico del Excel, lista de columnas no usadas)."""
    crudo = pd.read_excel(
        ruta, sheet_name=0 if hoja is None else hoja, header=None, dtype=object
    )
    fila = (
        _detectar_fila_encabezado(crudo) if fila_encabezado is None else fila_encabezado
    )
    encabezados = [limpiar(c) for c in crudo.iloc[fila].tolist()]

    mapa: dict[int, str] = {}
    for indice, texto in enumerate(encabezados):
        campo = clasificar_encabezado(texto)
        if campo:
            mapa.setdefault(indice, campo)
    no_usadas = [t for i, t in enumerate(encabezados) if t and i not in mapa]

    registros: list[dict] = []
    for _, fila_cruda in crudo.iloc[fila + 1 :].iterrows():
        valores: dict[str, str] = {}
        for indice, campo in mapa.items():
            valor = fila_cruda.iloc[indice] if indice < len(fila_cruda) else None
            if not es_vacio(valor):
                valores[campo] = limpiar(valor)
        if solo_confirmados and not _confirmado(fila_cruda, encabezados):
            continue
        nombre, dni = separar_dni(_limpiar_nombre(valores.get("nombre", "")))
        if dni and not valores.get("dni"):
            valores["dni"] = dni

        # En este Excel la celda de provincia trae 'Distrito (Provincia)' cuando la
        # fila es distrital, y solo la provincia cuando la fila es provincial.
        provincia_celda, distrito_celda = dividir_provincia_distrito(
            valores.get("provincia", "")
        )
        distrito = _limpiar_distrito(valores.get("distrito", "")) or _limpiar_distrito(
            distrito_celda
        )

        registro = {
            "distrito": distrito,
            "provincia": provincia_celda,
            "nombre": nombre,
            "celular": normalizar_celular(valores.get("celular", "")),
            "correo_electronico": extraer_emails(valores.get("correo_electronico", "")),
            "organizacion": limpiar(valores.get("organizacion", "")),
            "dni": limpiar(valores.get("dni", "")),
            "nro": _texto_nro(valores.get("nro", "")),
        }
        if not any(registro[c] for c in ("nombre", "celular", "correo_electronico")):
            continue
        registros.append(registro)

    df = pd.DataFrame(registros)
    for columna in (
        "distrito",
        "provincia",
        "nombre",
        "celular",
        "correo_electronico",
        "organizacion",
        "dni",
        "nro",
    ):
        if columna not in df.columns:
            df[columna] = ""
    # Las celdas combinadas del Excel dejan la provincia vacía en las filas siguientes.
    df["provincia"] = df["provincia"].replace("", pd.NA).ffill().fillna("")
    df["organizacion"] = df["organizacion"].replace("", pd.NA).ffill().fillna("")
    return corregir_toponimos(df), no_usadas


def _texto_nro(valor) -> str:
    """'1' para las filas numeradas y 'Dist.' para las filas distritales."""
    if es_vacio(valor):
        return ""
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return limpiar(valor)
    return str(int(numero)) if numero.is_integer() else limpiar(valor)


def _confirmado(fila_cruda, encabezados: list[str]) -> bool:
    for indice, texto in enumerate(encabezados):
        if clave(texto).startswith("CONFIRMADO"):
            valor = clave(fila_cruda.iloc[indice]) if indice < len(fila_cruda) else ""
            return valor in {
                "SI",
                "S",
                "X",
                "1",
                "TRUE",
                "VERDADERO",
                "OK",
                "CONFIRMADO",
            }
    return True


# ---------------------------------------------------------------------------
# Cruce: rellenar faltantes y agregar los que no están
# ---------------------------------------------------------------------------


def _jaro(a: str, b: str) -> float:
    """Similitud de Jaro: coincidencias en ventana, tolera letras fuera de orden."""
    if a == b:
        return 1.0
    la, lb = len(a), len(b)
    if not la or not lb:
        return 0.0

    ventana = max(max(la, lb) // 2 - 1, 0)
    marcado_a = [False] * la
    marcado_b = [False] * lb
    coincidencias = 0
    for i, letra in enumerate(a):
        for j in range(max(0, i - ventana), min(i + ventana + 1, lb)):
            if not marcado_b[j] and b[j] == letra:
                marcado_a[i] = marcado_b[j] = True
                coincidencias += 1
                break
    if not coincidencias:
        return 0.0

    # Transposiciones: pares coincidentes que aparecen en orden distinto
    k = 0
    desordenadas = 0
    for i in range(la):
        if marcado_a[i]:
            while not marcado_b[k]:
                k += 1
            if a[i] != b[k]:
                desordenadas += 1
            k += 1
    transposiciones = desordenadas // 2

    return (
        coincidencias / la
        + coincidencias / lb
        + (coincidencias - transposiciones) / coincidencias
    ) / 3


def _jaro_winkler(a: str, b: str) -> float:
    """Jaro con bonus por prefijo común: lo mejor para nombres cortos con erratas."""
    jaro = _jaro(a, b)
    prefijo = 0
    for letra_a, letra_b in zip(a, b):
        if letra_a != letra_b or prefijo == 4:
            break
        prefijo += 1
    if jaro > 0.7:
        jaro += prefijo * 0.1 * (1.0 - jaro)
    return jaro


def _damerau(a: str, b: str) -> int:
    """Distancia de edición con transposiciones (OSA)."""
    la, lb = len(a), len(b)
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            coste = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + coste)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + coste)
    return d[la][lb]


def _similitud(a: str, b: str) -> float:
    """Similitud para nombres propios: el máximo de tres vistas complementarias.

    * Jaro-Winkler: premia el prefijo común y tolera letras fuera de orden
      ('BOLGNESI' / 'BOLOGNESI').
    * Damerau-Levenshtein normalizada: mide erratas reales, incluidas las
      transposiciones ('BOOGNESI' / 'BOLOGNESI').
    * SequenceMatcher sobre las palabras ordenadas: tolera que cambie el orden
      ('MARISCAL LUZURIAGA' / 'LUZURIAGA MARISCAL').
    """
    ca, cb = clave(a), clave(b)
    if not ca or not cb:
        return 0.0
    if ca == cb:
        return 1.0

    jaro_winkler = _jaro_winkler(ca, cb)
    distancia = 1.0 - _damerau(ca, cb) / max(len(ca), len(cb))
    por_palabras = SequenceMatcher(
        None, " ".join(sorted(ca.split())), " ".join(sorted(cb.split()))
    ).ratio()
    return max(jaro_winkler, distancia, por_palabras)


def _mismo_nombre(a: str, b: str) -> bool:
    """Un nombre contenido en el otro: 'JUAN PEREZ' vs 'JUAN PEREZ GOMEZ'."""
    tokens_a, tokens_b = clave(a).split(), clave(b).split()
    if not tokens_a or not tokens_b:
        return False
    corto, largo = (
        (tokens_a, tokens_b) if len(tokens_a) <= len(tokens_b) else (tokens_b, tokens_a)
    )
    if len(corto) < 2:
        return False
    if largo[: len(corto)] == corto:
        return True
    return set(corto).issubset(set(largo))


def _buscar_indice(
    base,
    provincia: str,
    nombre: str,
    indice_por_clave,
    umbral: float,
    excluir_distrito: str | None = None,
):
    """Devuelve (índice, motivo). Nunca resuelve una coincidencia ambigua."""
    indice = indice_por_clave.get((provincia, nombre))
    if indice is not None and not (
        excluir_distrito and clave(base.at[indice, "distrito"]) == excluir_distrito
    ):
        return indice, "exacto"

    candidatos = [
        (i, f["nombre"])
        for i, f in base.iterrows()
        if clave(f["provincia"]) == provincia
        and clave(f["nombre"])
        and not (excluir_distrito and clave(f["distrito"]) == excluir_distrito)
    ]
    if not candidatos:
        return None, "sin candidatos"

    por_componentes = [i for i, otro in candidatos if _mismo_nombre(nombre, otro)]
    if len(por_componentes) == 1:
        return por_componentes[0], "componentes"
    if len(por_componentes) > 1:
        return None, "ambiguo"

    mejor, puntaje = max(
        ((i, _similitud(nombre, otro)) for i, otro in candidatos),
        key=lambda par: par[1],
    )
    if puntaje >= umbral:
        return mejor, "difuso"
    return None, "sin coincidencia"


def _buscar_por_distrito(base, provincia: str, distrito: str, umbral: float):
    """Cruza por (provincia, distrito) antes de mirar el nombre.

    El distrito es un dato estructural: si el Excel dice 'Ticapampa (Recuay)' y el
    Word trae 'TICAPAMPA' en Recuay, el nombre del alcalde puede estar mal escrito y
    aun así es la misma fila.
    """
    candidatos = [
        (i, f["distrito"])
        for i, f in base.iterrows()
        if clave(f["provincia"]) == provincia and clave(f["distrito"])
    ]
    if not candidatos:
        return None, "sin distritos"

    exactos = [i for i, otro in candidatos if clave(otro) == distrito]
    if len(exactos) == 1:
        return exactos[0], "distrito exacto"
    if len(exactos) > 1:
        return None, "distrito ambiguo"

    puntajes = sorted(
        ((_similitud(distrito, otro), i) for i, otro in candidatos),
        reverse=True,
    )
    mejor, indice = puntajes[0]
    segundo = puntajes[1][0] if len(puntajes) > 1 else 0.0
    if mejor >= umbral and mejor - segundo >= 0.05:
        return indice, "distrito parecido"
    return None, "distrito sin coincidencia"


def completar_con_excel(
    base: pd.DataFrame,
    excel: pd.DataFrame,
    agregar_faltantes: bool = True,
    etiqueta_faltantes: str = TAG_PROVINCIAL,
    umbral: float = 0.80,
) -> tuple[pd.DataFrame, dict, list[dict]]:
    """Rellena solo celdas vacías y agrega las filas del Excel que no existen.

    El cruce es estructural primero: una fila distrital del Excel busca por
    (provincia, distrito) y solo después por nombre. Una fila provincial (sin
    distrito) actualiza la fila marcada con `etiqueta_faltantes` de esa provincia y
    nunca se cruza por nombre con una fila distrital, para no duplicar a la misma
    persona en dos filas.
    """
    base = base.copy().reset_index(drop=True)
    for columna in COLUMNAS_FINALES:
        base[columna] = base[columna].astype(object).fillna("").map(limpiar)

    etiqueta = clave(etiqueta_faltantes)
    rellenados: Counter = Counter()
    motivos: Counter = Counter()
    provincias_base: dict[str, str] = {}
    for valor in base["provincia"]:
        c = clave(valor)
        if c and c not in provincias_base:
            provincias_base[c] = limpiar(valor)

    indice_por_estructura: dict[tuple[str, str], int] = {}
    indice_por_nombre: dict[tuple[str, str], int] = {}

    def registrar(indice: int) -> None:
        fila = base.loc[indice]
        prov = clave(fila["provincia"])
        dist = clave(fila["distrito"])
        if dist:
            indice_por_estructura.setdefault((prov, dist), indice)
        nombre = clave(fila["nombre"])
        if nombre:
            indice_por_nombre.setdefault((prov, nombre), indice)

    for indice in base.index:
        registrar(indice)

    agregadas = 0
    no_cruzados: list[dict] = []
    resoluciones: dict[tuple[str, str], dict] = {}

    for _, fila_ex in excel.iterrows():
        if not _tiene_contacto(fila_ex):
            continue
        prov_cruda = limpiar(fila_ex.get("provincia", ""))
        dist_ex = normalizar_toponimo(fila_ex.get("distrito", ""))
        nombre_ex = clave(fila_ex.get("nombre", ""))

        prov_ex, motivo_prov = _resolver_provincia(provincias_base, prov_cruda)
        motivos[f"provincia {motivo_prov}"] += 1
        if prov_ex and motivo_prov in {"alias", "parecido", "nueva"}:
            resoluciones.setdefault(
                (clave(prov_cruda), motivo_prov),
                {
                    "excel": prov_cruda,
                    "word": prov_ex if motivo_prov != "nueva" else "(nueva)",
                    "motivo": motivo_prov,
                },
            )
        clave_prov = clave(prov_ex)

        indice: int | None = None
        if dist_ex:
            indice = indice_por_estructura.get((clave_prov, clave(dist_ex)))
            if indice is not None:
                motivos["distrito exacto"] += 1
            else:
                indice, motivo = _buscar_por_distrito(
                    base, clave_prov, clave(dist_ex), umbral
                )
                motivos[motivo] += 1
        elif etiqueta:
            indice = indice_por_estructura.get((clave_prov, etiqueta))
            if indice is not None:
                motivos["provincial existente"] += 1

        # Último recurso: el nombre, pero solo para filas distritales y sin caer en la
        # fila provincial (que puede ser la misma persona que un distrito capital).
        if indice is None and nombre_ex and dist_ex:
            indice, motivo = _buscar_indice(
                base,
                clave_prov,
                nombre_ex,
                indice_por_nombre,
                0.90,
                excluir_distrito=etiqueta,
            )
            motivos[f"nombre {motivo}"] += 1

        # --- Caso 1: la fila ya existe -> solo se rellena lo vacío
        if indice is not None:
            for campo in ("nombre", "celular", "correo_electronico"):
                if es_vacio(base.at[indice, campo]) and not es_vacio(
                    fila_ex.get(campo, "")
                ):
                    base.at[indice, campo] = limpiar(fila_ex[campo])
                    rellenados[campo] += 1
            continue

        # --- Caso 2: no existe -> se agrega la fila tal como viene del Excel
        if not agregar_faltantes:
            no_cruzados.append(dict(fila_ex))
            continue

        if not prov_ex or not nombre_ex:
            motivo_sin = "sin provincia" if not prov_ex else "sin nombre"
            no_cruzados.append({**dict(fila_ex), "motivo": motivo_sin})
            continue

        fila_nueva = {
            "distrito": dist_ex if dist_ex else etiqueta_faltantes,
            "provincia": prov_ex,
            "nombre": limpiar(fila_ex.get("nombre", "")),
            "celular": normalizar_celular(fila_ex.get("celular", "")),
            "correo_electronico": extraer_emails(fila_ex.get("correo_electronico", "")),
        }
        base.loc[len(base)] = fila_nueva
        registrar(len(base) - 1)
        provincias_base.setdefault(clave_prov, prov_ex)
        agregadas += 1

    resumen = {
        "rellenados": dict(rellenados),
        "agregadas": agregadas,
        "no_cruzados": len(no_cruzados),
        "motivos": dict(motivos),
        "provincias": list(resoluciones.values()),
    }
    return base, resumen, no_cruzados


def _tiene_contacto(fila) -> bool:
    return any(
        not es_vacio(fila.get(c)) for c in ("nombre", "celular", "correo_electronico")
    )


# ---------------------------------------------------------------------------
# Ubigeo del departamento: qué distritos faltan
# ---------------------------------------------------------------------------

RUTA_UBIGEO_POR_DEFECTO = Path(__file__).with_name("geodir-ubigeo-reniec.csv")

_PARTICULAS_DISTRITO = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "EL"}


def _tokens_distrito(texto) -> set[str]:
    return {t for t in clave(texto).split() if t not in _PARTICULAS_DISTRITO}


def _distrito_contenido(a, b) -> bool:
    """'CORPANQUI' dentro de 'SAN MIGUEL DE CORPANQUI' y 'PAMPAS' en 'PAMPAS GRANDE'.

    Solo se acepta si la diferencia es de dos palabras o menos, para no confundir
    'SANTA' con 'SANTA ROSA'.
    """
    tokens_a, tokens_b = _tokens_distrito(a), _tokens_distrito(b)
    if not tokens_a or not tokens_b:
        return False
    if not (tokens_a <= tokens_b or tokens_b <= tokens_a):
        return False
    return abs(len(tokens_a) - len(tokens_b)) <= 2


def leer_ubigeo(ruta, departamento: str | None = None) -> pd.DataFrame:
    """Lee el CSV de ubigeo (RENIEC): un departamento o el país entero si es None.

    Sin departamento se devuelve el ubigeo completo, que es la línea base de nombres
    oficiales para cualquier salida.
    """
    ruta = Path(ruta) if ruta else RUTA_UBIGEO_POR_DEFECTO
    if not ruta.exists():
        raise SystemExit(
            f"No se encontró el CSV de ubigeo: {ruta}. Indícalo con --ubigeo RUTA."
        )

    crudo = None
    for codificacion in ("utf-8-sig", "latin-1"):
        try:
            crudo = pd.read_csv(ruta, dtype=str, encoding=codificacion)
            break
        except UnicodeDecodeError:
            continue
        except pd.errors.EmptyDataError as error:
            raise SystemExit(f"{ruta} está vacío.") from error
    if crudo is None:
        raise SystemExit(f"No se pudo leer {ruta}: revisa la codificación.")

    mapa = {clave(columna): columna for columna in crudo.columns}

    def columna(*nombres: str) -> str:
        for nombre in nombres:
            if clave(nombre) in mapa:
                return mapa[clave(nombre)]
        raise SystemExit(
            f"{ruta} no tiene la columna {'/'.join(nombres)}; "
            f"columnas encontradas: {', '.join(crudo.columns)}"
        )

    tabla = pd.DataFrame(
        {
            "ubigeo": crudo[columna("ubigeo")].map(limpiar),
            "distrito": crudo[columna("distrito")].map(limpiar),
            "provincia": crudo[columna("provincia")].map(limpiar),
            "departamento": crudo[columna("departamento", "region")].map(limpiar),
        }
    )
    if departamento:
        tabla = tabla[tabla["departamento"].map(clave) == clave(departamento)]
        if tabla.empty:
            disponibles = sorted(
                {limpiar(d) for d in crudo[columna("departamento", "region")]}
            )
            raise SystemExit(
                f"{ruta} no tiene distritos para «{departamento}». "
                f"Departamentos disponibles: {', '.join(disponibles)}"
            )

    tabla = tabla[tabla["distrito"].map(lambda d: bool(clave(d)))]
    tabla = corregir_toponimos(tabla)
    return tabla.drop_duplicates(["departamento", "provincia", "distrito"]).reset_index(
        drop=True
    )


def _buscar_distrito(
    base,
    provincia: str,
    distrito: str,
    reservados: set[int] | None = None,
    solo_exacto: bool = False,
):
    """Busca la fila de `base` que corresponde a un distrito del ubigeo.

    Solo acepta coincidencia exacta o que un nombre contenga al otro. No se usa
    similitud difusa: 'HUALLANCA' y 'HUAYLLACAYAN' se parecen mucho y son distritos
    distintos de la misma provincia, así que un parecido tentador agregaría un
    duplicado y perdería un distrito real. Lo que no coincida se informa.

    `reservados` son las filas que ya se emparejaron con otro distrito del ubigeo y
    no pueden reutilizarse: sin eso, 'Chimbote' se queda con la fila de 'Nuevo
    Chimbote' —su nombre lo contiene— y el distrito de Chimbote desaparece del
    índice. Con `solo_exacto` se busca únicamente el nombre idéntico.
    """
    reservados = reservados or set()
    candidatos = [
        (i, f["distrito"])
        for i, f in base.iterrows()
        if clave(f["provincia"]) == clave(provincia) and i not in reservados
    ]
    if not candidatos:
        return None, "sin candidatos"

    for indice, otro in candidatos:
        if clave(otro) == clave(distrito):
            return indice, "exacto"
    if solo_exacto:
        return None, "sin exacto"

    por_contencion = [
        indice for indice, otro in candidatos if _distrito_contenido(otro, distrito)
    ]
    if len(por_contencion) == 1:
        return por_contencion[0], "nombre contenido"
    if len(por_contencion) > 1:
        return None, "ambiguo"
    return None, "sin coincidencia"


def _mapa_provincias_departamento(
    base: pd.DataFrame, ubigeo: pd.DataFrame
) -> tuple[dict[str, str], list[dict]]:
    """{clave(provincia del ubigeo): provincia tal como aparece en `base`}.

    Traduce el ubigeo al vocabulario del archivo de entrada con el mismo criterio
    tolerante del resto del pipeline (exacto, alias, tokens, truncamiento). Devuelve
    además los avisos de las provincias que no coincidían letra por letra. Las
    provincias de `base` que no se mapean a ninguna del ubigeo quedan fuera del mapa:
    esas son, justamente, las que no pertenecen al departamento.
    """
    provincias_base = {
        clave(p): p for p in base.get("provincia", []) if not es_vacio(p)
    }
    mapa: dict[str, str] = {}
    avisos: list[dict] = []
    for provincia in ubigeo["provincia"]:
        c = clave(provincia)
        if c in mapa:
            continue
        if c in provincias_base:
            mapa[c] = provincias_base[c]
            continue
        nombre, motivo = _resolver_provincia(provincias_base, provincia)
        mapa[c] = nombre
        provincias_base.setdefault(clave(nombre), nombre)
        if motivo != "exacto":
            avisos.append({"ubigeo": provincia, "salida": nombre, "motivo": motivo})
    return mapa, avisos


def _provincias_del_ubigeo(ubigeo: pd.DataFrame) -> dict[str, str]:
    """{clave(provincia): nombre oficial}, sin repetir."""
    mapa: dict[str, str] = {}
    for provincia in ubigeo["provincia"]:
        nombre = limpiar(provincia)
        if nombre:
            mapa.setdefault(clave(nombre), nombre)
    return mapa


def _distritos_del_ubigeo(ubigeo: pd.DataFrame) -> dict[str, list[str]]:
    """{clave(provincia): distritos oficiales de esa provincia}."""
    mapa: dict[str, list[str]] = {}
    for provincia, distrito in zip(ubigeo["provincia"], ubigeo["distrito"]):
        p, d = clave(provincia), limpiar(distrito)
        if p and d:
            mapa.setdefault(p, []).append(d)
    return {p: sorted(set(ds)) for p, ds in mapa.items()}


def _canonizar_fila(
    provincia,
    distrito,
    provincias: dict[str, str],
    distritos: dict[str, list[str]],
    etiqueta: str = TAG_PROVINCIAL,
) -> tuple[str, str, str]:
    """Lleva (provincia, distrito) a los nombres oficiales del ubigeo.

    No adivina: la provincia se resuelve tolerando truncamientos y el distrito solo
    se cambia con coincidencia exacta, prefijo único, contención única dentro de su
    provincia ('Corpanqui' -> 'San Miguel de Corpanqui') o, como último recurso, el
    parecido ortográfico con ventaja clara. Si el distrito repite el nombre de la
    provincia y no existe como distrito, la fila es una provincial mal rotulada y se
    devuelve la etiqueta PROVINCIAL.
    """
    p = limpiar(provincia)
    d = limpiar(distrito)
    if not clave(p):
        return p, d, "sin provincia"

    oficial_p, motivo_p = _resolver_provincia(provincias, p)
    if motivo_p in {"vacia", "nueva", "ambigua"}:
        return p, d, "provincia fuera del ubigeo"

    if clave(d) == clave(etiqueta):
        return oficial_p, etiqueta, "provincial"
    if not clave(d):
        return oficial_p, d, "sin distrito"

    candidatos = distritos.get(clave(oficial_p), [])
    oficial_d, motivo_d = _expandir_nombre(d, candidatos)
    if motivo_d in {"exacto", "truncado", "parecido"}:
        return oficial_p, oficial_d, motivo_d

    contenidos = [c for c in candidatos if _distrito_contenido(d, c)]
    if len(contenidos) == 1:
        return oficial_p, contenidos[0], "nombre contenido"
    if clave(d) == clave(p):
        return oficial_p, etiqueta, "provincial mal rotulada"
    return oficial_p, d, "distrito fuera del ubigeo"


def canonizar_ubigeo(
    base: pd.DataFrame,
    ubigeo: pd.DataFrame,
    etiqueta: str = TAG_PROVINCIAL,
) -> tuple[pd.DataFrame, list[dict]]:
    """Reemplaza `distrito` y `provincia` por los nombres oficiales del ubigeo.

    El ubigeo es la única fuente de nombres: el Word, el Excel de contactos y el
    directorio llegan con variantes, truncamientos y tildes distintas, y la salida
    debe hablar siempre el mismo idioma. Lo que no se puede ubicar sin adivinar
    queda como vino y se informa con su motivo.
    """
    detalle: list[dict] = []
    if base is None or base.empty or ubigeo is None or ubigeo.empty:
        return base, detalle

    provincias = _provincias_del_ubigeo(ubigeo)
    distritos = _distritos_del_ubigeo(ubigeo)

    base = base.copy()
    nuevas_provincias: list[str] = []
    nuevos_distritos: list[str] = []
    for _, fila in base.iterrows():
        p, d, motivo = _canonizar_fila(
            fila.get("provincia"), fila.get("distrito"), provincias, distritos, etiqueta
        )
        nuevas_provincias.append(p)
        nuevos_distritos.append(d)
        if motivo not in {"exacto", "provincial"}:
            detalle.append(
                {
                    "provincia_origen": limpiar(fila.get("provincia")),
                    "distrito_origen": limpiar(fila.get("distrito")),
                    "provincia": p,
                    "distrito": d,
                    "motivo": motivo,
                }
            )
    base["provincia"] = nuevas_provincias
    base["distrito"] = nuevos_distritos
    return base, detalle


def restringir_al_departamento(
    base: pd.DataFrame,
    ubigeo: pd.DataFrame,
    etiqueta: str = TAG_PROVINCIAL,
) -> tuple[pd.DataFrame, dict]:
    """Deja solo las filas cuya provincia pertenece al departamento del ubigeo.

    `--departamento` es un recorte, no una sugerencia: si el Word o el Excel de
    contactos traen filas de otro departamento, se descartan acá y se informan. Una
    fila se conserva cuando su provincia es una de las del ubigeo (resuelta con el
    mismo criterio tolerante de `completar_con_ubigeo`); lo que no se puede ubicar se
    descarta con el motivo a la vista, nunca en silencio.
    """
    informe: dict = {"dentro": 0, "descartadas": [], "provincias": []}
    if base is None or base.empty:
        return base, informe
    if ubigeo is None or ubigeo.empty:
        informe["dentro"] = len(base)
        return base, informe

    mapa, avisos = _mapa_provincias_departamento(base, ubigeo)
    informe["provincias"] = avisos
    permitidas = {clave(nombre) for nombre in mapa.values() if limpiar(nombre)}

    posiciones: list[int] = []
    for posicion, (_, fila) in enumerate(base.iterrows()):
        provincia = limpiar(fila.get("provincia"))
        if clave(provincia) in permitidas:
            posiciones.append(posicion)
            continue
        informe["descartadas"].append(
            {
                "provincia": provincia,
                "distrito": limpiar(fila.get("distrito")),
                "nombre": limpiar(fila.get("nombre")),
                "motivo": (
                    "sin provincia"
                    if not clave(provincia)
                    else "provincia fuera del departamento"
                ),
            }
        )

    informe["dentro"] = len(posiciones)
    filtrado = base.iloc[posiciones].reset_index(drop=True)
    return filtrado, informe


def completar_con_ubigeo(
    base: pd.DataFrame,
    ubigeo: pd.DataFrame,
    etiqueta: str = TAG_PROVINCIAL,
) -> tuple[pd.DataFrame, dict]:
    """Agrega una fila vacía por cada distrito del ubigeo que falte en `base`.

    El ubigeo de RENIEC es la lista oficial de distritos del departamento y sirve
    para detectar los que el Word no trae. Esa comparación no puede ser literal: el
    ubigeo trae abreviaturas y truncamientos ('Carlos Fermin Fitzca', 'Pampas' por
    'Pampas Grande', 'San Miguel de Corpanqui' por 'Corpanqui'), así que el distrito
    se busca por provincia resuelta y por nombre, tolerando que uno contenga al otro.

    Las filas agregadas quedan con `nombre`, `celular` y `correo_electronico` vacíos
    para que la tabla de faltantes las cuente. Nada existente se sobrescribe.
    """
    informe: dict = {
        "agregados": [],
        "detalle": [],
        "no_reconocidos": [],
        "provincias": [],
        "coincidencias_por_nombre": 0,
    }
    if ubigeo is None or ubigeo.empty:
        return base, informe

    base = base.copy().reset_index(drop=True)
    if base.empty:
        base = pd.DataFrame(columns=COLUMNAS_FINALES)

    mapa_provincia, avisos = _mapa_provincias_departamento(base, ubigeo)
    informe["provincias"] = avisos

    # El emparejamiento va en dos pasadas. La primera busca solo nombres idénticos y
    # reserva la fila; la segunda, nombres contenidos, y únicamente sobre las filas
    # que quedaron libres. Sin la reserva, 'Chimbote' se queda con la fila de 'Nuevo
    # Chimbote' (su nombre lo contiene) y dos distritos del ubigeo apuntan a una sola
    # fila: uno se duplica y el otro desaparece.
    filas_ubigeo = [
        {
            "ubigeo": limpiar(fila["ubigeo"]),
            "provincia": mapa_provincia[clave(fila["provincia"])],
            "distrito": limpiar(fila["distrito"]),
        }
        for _, fila in ubigeo.iterrows()
    ]

    emparejados: list[tuple[int | None, str]] = [(None, "")] * len(filas_ubigeo)
    reservados: set[int] = set()
    pendientes: list[int] = []
    for posicion, datos in enumerate(filas_ubigeo):
        indice, motivo = _buscar_distrito(
            base, datos["provincia"], datos["distrito"], reservados, solo_exacto=True
        )
        if indice is None:
            pendientes.append(posicion)
            continue
        emparejados[posicion] = (indice, motivo)
        reservados.add(indice)
    for posicion in pendientes:
        datos = filas_ubigeo[posicion]
        indice, motivo = _buscar_distrito(
            base, datos["provincia"], datos["distrito"], reservados
        )
        emparejados[posicion] = (indice, motivo)
        if indice is not None:
            reservados.add(indice)

    encontrados: set[int] = set()
    for posicion, datos in enumerate(filas_ubigeo):
        indice, motivo = emparejados[posicion]
        entrada = {
            "ubigeo": datos["ubigeo"],
            "provincia": datos["provincia"],
            "distrito_ubigeo": datos["distrito"],
            "estado": "",
            "distrito_salida": "",
            "nombre_salida": "",
        }
        if indice is None:
            nueva = {columna: "" for columna in COLUMNAS_FINALES}
            nueva["distrito"] = datos["distrito"]
            nueva["provincia"] = datos["provincia"]
            base = pd.concat([base, pd.DataFrame([nueva])], ignore_index=True)
            encontrados.add(len(base) - 1)
            entrada["estado"] = "agregado vacío"
            entrada["distrito_salida"] = datos["distrito"]
            informe["detalle"].append(entrada)
            continue

        encontrados.add(indice)
        entrada["distrito_salida"] = limpiar(base.at[indice, "distrito"])
        entrada["nombre_salida"] = limpiar(base.at[indice, "nombre"])
        if motivo == "exacto":
            entrada["estado"] = "coincide"
        else:
            entrada["estado"] = f"coincide por nombre ({motivo})"
            informe["coincidencias_por_nombre"] += 1
        informe["detalle"].append(entrada)

    for indice, fila in base.iterrows():
        if indice in encontrados or clave(fila["distrito"]) == clave(etiqueta):
            continue
        informe["no_reconocidos"].append(
            {
                "provincia": limpiar(fila["provincia"]),
                "distrito": limpiar(fila["distrito"]),
                "nombre": limpiar(fila["nombre"]),
                "motivo": "no está en el ubigeo del departamento",
            }
        )

    informe["agregados"] = [
        entrada
        for entrada in informe["detalle"]
        if entrada["estado"] == "agregado vacío"
    ]
    return base, informe


# ---------------------------------------------------------------------------
# Fusión de las filas PROVINCIALES con el distrito de la capital
# ---------------------------------------------------------------------------


def _elegir_par_provincial(
    base: pd.DataFrame,
    indice: int,
    etiqueta: str = TAG_PROVINCIAL,
    umbral: float = 0.90,
    excluir: set[int] | None = None,
) -> tuple[int | None, str, list[dict]]:
    """Elige la fila distrital que corresponde a una fila PROVINCIAL.

    La fila provincial solo trae el nombre de la autoridad, así que el único lazo
    con el Word es ese nombre. Se acepta, en orden: nombre idéntico, nombre contenido
    en el otro ('JUAN PEREZ' dentro de 'JUAN PEREZ GOMEZ') y similitud >= `umbral`
    con una ventaja clara sobre el segundo candidato.

    Ante un empate no se elige nada: fusionar a ciegas mezclaría los contactos de dos
    personas distintas. El tercer valor devuelto son los candidatos empatados, para
    que el informe deje constancia de por qué no se fusionó.
    """
    excluir = excluir or set()
    provincia = clave(base.at[indice, "provincia"])
    nombre = clave(base.at[indice, "nombre"])
    if not nombre:
        return None, "sin nombre", []

    candidatos = [
        (i, clave(f["nombre"]))
        for i, f in base.iterrows()
        if i != indice
        and i not in excluir
        and clave(f["provincia"]) == provincia
        and clave(f["distrito"]) != clave(etiqueta)
        and clave(f["nombre"])
    ]
    if not candidatos:
        return None, "sin candidatos", []

    def _detalle_de(indices) -> list[dict]:
        return [
            {
                "distrito": limpiar(base.at[i, "distrito"]),
                "nombre": limpiar(base.at[i, "nombre"]),
            }
            for i in indices
        ]

    exactos = [i for i, otro in candidatos if otro == nombre]
    if len(exactos) == 1:
        return exactos[0], "nombre exacto", []
    if len(exactos) > 1:
        return None, "ambiguo", _detalle_de(exactos)

    componentes = [i for i, otro in candidatos if _mismo_nombre(nombre, otro)]
    if len(componentes) == 1:
        return componentes[0], "componentes", []
    if len(componentes) > 1:
        return None, "ambiguo", _detalle_de(componentes)

    puntajes = sorted(
        ((_similitud(nombre, otro), i) for i, otro in candidatos), reverse=True
    )
    mejor = puntajes[0][0]
    segundo = puntajes[1][0] if len(puntajes) > 1 else 0.0
    if mejor >= umbral and mejor - segundo >= 0.05:
        return puntajes[0][1], f"difuso {mejor:.2f}", []
    if mejor >= umbral:
        empatados = [i for puntaje, i in puntajes if abs(puntaje - mejor) < 1e-9]
        return None, "ambiguo", _detalle_de(empatados)
    return None, "sin coincidencia", []


def fusionar_provinciales(
    df: pd.DataFrame,
    etiqueta: str = TAG_PROVINCIAL,
    marca: str = "(PROVINCIAL)",
    umbral: float = 0.90,
) -> tuple[pd.DataFrame, dict]:
    """Une la fila PROVINCIAL del Excel con la fila del distrito de la capital.

    El Excel trae una fila por provincia (sin distrito) con el contacto de la
    autoridad provincial; en el Word esa misma persona aparece además como alcalde
    del distrito capital. En lugar de dos filas para una persona se deja una: la del
    distrito, con la marca `marca` en el nombre del distrito (`Chimbote (PROVINCIAL)`)
    para no perder el dato, y con el contacto del provincial **solo si la fila
    distrital no lo tenía**. Nunca se sobrescribe un dato del Word: lo descartado
    queda en el informe para poder auditarlo.

    Es opt-in (en el CLI, `--fusionar-provinciales`): sin el flag, la fila PROVINCIAL
    se mantiene aparte, como hasta ahora.
    """
    informe: dict = {
        "fusionadas": 0,
        "sin_par": [],
        "detalle": [],
        "rellenados": {"celular": 0, "correo_electronico": 0},
    }
    if df.empty:
        return df.copy(), informe

    base = df.copy().reset_index(drop=True)
    provinciales = [
        i for i, f in base.iterrows() if clave(f["distrito"]) == clave(etiqueta)
    ]
    if not provinciales:
        return base, informe

    descartar: list[int] = []
    usados: set[int] = set()
    for indice in provinciales:
        par, criterio, empatados = _elegir_par_provincial(
            base, indice, etiqueta=etiqueta, umbral=umbral, excluir=usados
        )
        if par is None:
            informe["sin_par"].append(
                {
                    "provincia": limpiar(base.at[indice, "provincia"]),
                    "nombre": limpiar(base.at[indice, "nombre"]),
                    "celular": limpiar(base.at[indice, "celular"]),
                    "correo_electronico": limpiar(
                        base.at[indice, "correo_electronico"]
                    ),
                    "motivo": criterio,
                    "candidatos": " | ".join(
                        f"{c['distrito']}: {c['nombre']}" for c in empatados
                    ),
                }
            )
            continue

        detalle = {
            "provincia": limpiar(base.at[par, "provincia"]),
            "distrito": limpiar(base.at[par, "distrito"]),
            "nombre_distrito": limpiar(base.at[par, "nombre"]),
            "nombre_provincial": limpiar(base.at[indice, "nombre"]),
            "criterio": criterio,
        }
        for columna in ("celular", "correo_electronico"):
            valor_distrital = limpiar(base.at[par, columna])
            valor_provincial = limpiar(base.at[indice, columna])
            if es_vacio(valor_distrital) and not es_vacio(valor_provincial):
                base.at[par, columna] = valor_provincial
                informe["rellenados"][columna] += 1
            detalle[f"{columna}_distrito"] = valor_distrital
            detalle[f"{columna}_provincial"] = valor_provincial
            detalle[f"{columna}_conservado"] = limpiar(base.at[par, columna])

        distrito_actual = limpiar(base.at[par, "distrito"])
        if marca and not clave(distrito_actual).endswith(clave(marca)):
            base.at[par, "distrito"] = f"{distrito_actual} {marca}"
        detalle["distrito_final"] = limpiar(base.at[par, "distrito"])

        usados.add(par)
        descartar.append(indice)
        informe["fusionadas"] += 1
        informe["detalle"].append(detalle)

    if descartar:
        base = base.drop(index=descartar)
    return base[COLUMNAS_FINALES].reset_index(drop=True), informe


# ---------------------------------------------------------------------------
# Consolidación y salida
# ---------------------------------------------------------------------------


def consolidar(df: pd.DataFrame) -> pd.DataFrame:
    """Une duplicados por (provincia, distrito, nombre) sin perder contactos."""
    if df.empty:
        return df[COLUMNAS_FINALES].copy()
    df = df.copy()
    df["_vacios"] = df[COLUMNAS_FINALES].apply(
        lambda f: sum(es_vacio(v) for v in f), axis=1
    )
    df["_k"] = df.apply(
        lambda f: (clave(f["provincia"]), clave(f["distrito"]), clave(f["nombre"])),
        axis=1,
    )
    df = df.sort_values("_vacios").drop_duplicates("_k", keep="first")

    df["_orden_d"] = df["distrito"].map(
        lambda v: (0 if clave(v) == clave(TAG_PROVINCIAL) else 1, clave(v))
    )
    df["_orden_p"] = df["provincia"].map(clave)
    df = df.sort_values(["_orden_p", "_orden_d"], kind="stable")
    return df[COLUMNAS_FINALES].reset_index(drop=True)


def _columna_nombre(df: pd.DataFrame) -> str | None:
    """Columna que hace de nombre: `nombres` si está partido, si no `nombre`."""
    for columna in ("nombres", "nombre"):
        if columna in df.columns:
            return columna
    return None


def _sin_nombre(df: pd.DataFrame) -> pd.DataFrame:
    """Quita `nombre` del volcado: la hoja ya trae nombres y apellidos separados.

    `nombre` sigue siendo la columna del cruce y del reparto; solo se omite al
    escribir. Con `--sin-nombres` no hay `nombres`/`apellidos`, así que se conserva.
    """
    if "nombre" in df.columns and "nombres" in df.columns:
        return df.drop(columns=["nombre"])
    return df


# ---------------------------------------------------------------------------
# Nombres y apellidos
# ---------------------------------------------------------------------------

_CONECTORES_NOMBRE = {
    "DE",
    "DEL",
    "LA",
    "LAS",
    "LOS",
    "Y",
    "E",
    "EL",
    "DA",
    "DAS",
    "DOS",
    "DI",
    "VAN",
    "VON",
}

_NLP = None
_NLP_INTENTADO = False


def _cargar_spacy():
    """Carga el modelo español de spaCy una sola vez; si no está, devuelve None."""
    global _NLP, _NLP_INTENTADO
    if _NLP_INTENTADO:
        return _NLP
    _NLP_INTENTADO = True
    try:
        import spacy
    except ImportError:
        return None
    for modelo in ("es_core_news_md", "es_core_news_sm", "es_core_news_lg"):
        try:
            _NLP = spacy.load(modelo, disable=["parser", "ner"])
            break
        except OSError:
            continue
    return _NLP


def motor_nombres() -> str:
    """Nombre del motor que separa los nombres, para informarlo."""
    nlp = _cargar_spacy()
    if nlp is None:
        return "reglas (spaCy no disponible)"
    return f"spaCy {nlp.meta.get('name', 'es')}"


def _tokens_nombre(nombre: str) -> list[str]:
    """Palabras del nombre, en orden, sin puntuación ni números."""
    texto = limpiar(nombre)
    if not texto:
        return []
    nlp = _cargar_spacy()
    if nlp is None:
        crudos = texto.split()
    else:
        crudos = [
            token.text
            for token in nlp(texto)
            if not (token.is_punct or token.is_space or token.like_num)
        ]
    return [
        token
        for token in crudos
        if clave(token) and not any(caracter.isdigit() for caracter in token)
    ]


def _es_sustantivo(token: str) -> bool:
    return clave(token) not in _CONECTORES_NOMBRE


def _partir_nombre(nombre: str) -> tuple[str, str, list[str], list[int]]:
    """(nombres, apellidos, palabras, posiciones de los sustantivos).

    La regla es la única que no adivina: con **cuatro** sustantivos se corta por la
    mitad ('WALTER JESÚS' + 'SOTO CAMPOS'); con tres o cinco el nombre completo queda
    en `nombres` y `apellidos` va vacío.
    """
    nombre = limpiar(nombre)
    tokens = _tokens_nombre(nombre)
    sustantivos = [i for i, token in enumerate(tokens) if _es_sustantivo(token)]
    if not nombre:
        return "", "", tokens, sustantivos
    if len(sustantivos) != 4:
        return nombre, "", tokens, sustantivos

    corte = sustantivos[2]
    # Los conectores pegados al corte pertenecen al apellido:
    # 'César Alberto' + 'de la Cruz Jave', no 'César Alberto de la' + 'Cruz Jave'
    while corte > 0 and not _es_sustantivo(tokens[corte - 1]):
        corte -= 1
    primer_nombre = " ".join(tokens[:corte]).strip()
    apellidos = " ".join(tokens[corte:]).strip()
    return primer_nombre, apellidos, tokens, sustantivos


def separar_nombres(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """Parte el nombre en `nombres` y `apellidos` cuando tiene cuatro sustantivos.

    Se cuentan los sustantivos sin conectores ('DE', 'LA', 'Y'...) ni números. Con
    exactamente cuatro, los dos primeros son nombres y los dos últimos apellidos
    ('WALTER JESÚS' + 'SOTO CAMPOS'). En cualquier otro caso el nombre completo queda
    en `nombres` y `apellidos` va vacío: partir un nombre de tres o cinco palabras
    sería adivinar. Todo el reparto queda en el detalle para poder revisarlo.
    """
    df = df.copy()
    detalle: list[dict] = []
    lista_nombres: list[str] = []
    lista_apellidos: list[str] = []

    for _, fila in df.iterrows():
        nombre = limpiar(fila["nombre"])
        primer_nombre, apellidos, tokens, sustantivos = _partir_nombre(nombre)
        con_conectores = len(sustantivos) != len(tokens)

        if not nombre:
            caso = "sin nombre"
        elif sustantivos and apellidos:
            caso = "partido: 2 nombres + 2 apellidos"
        else:
            caso = f"sin partir: {len(sustantivos)} sustantivos"

        lista_nombres.append(primer_nombre)
        lista_apellidos.append(apellidos)
        detalle.append(
            {
                "provincia": limpiar(fila["provincia"]),
                "distrito": limpiar(fila["distrito"]),
                "nombre": nombre,
                "sustantivos": len(sustantivos),
                "con_conectores": con_conectores,
                "nombres": primer_nombre,
                "apellidos": apellidos,
                "caso": caso,
            }
        )

    df["nombres"] = lista_nombres
    df["apellidos"] = lista_apellidos
    columnas = [c for c in df.columns if c not in {"nombres", "apellidos"}]
    posicion = columnas.index("nombre") + 1
    columnas[posicion:posicion] = ["nombres", "apellidos"]
    return df[columnas], detalle


MIN_DIGITOS_CELULAR = 6


def separar_celulares(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """Deja un número por columna: el primero en `celular`, el resto en `celular_2`.

    Una celda de origen puede traer dos números ('987 654 321 / 987 654 322') o un
    fragmento suelto ('930341391/9'). Una celda con dos teléfonos no se puede marcar
    ni contar, así que se reparte: `celular` y `celular_2`. Los fragmentos de menos
    de seis dígitos se descartan (son restos de una celda mal escrita, no un
    teléfono) y quedan en el detalle para poder revisarlos.
    """
    detalle: list[dict] = []
    if df is None or df.empty or "celular" not in df.columns:
        return df, detalle

    df = df.copy()
    principales: list[str] = []
    alternos: list[str] = []
    for _, fila in df.iterrows():
        todos = _numeros_celular(fila.get("celular"))
        numeros = [n for n in todos if len(n) >= MIN_DIGITOS_CELULAR]
        descartados = [n for n in todos if len(n) < MIN_DIGITOS_CELULAR]
        principales.append(numeros[0] if numeros else "")
        alternos.append(" / ".join(numeros[1:]))
        if len(numeros) > 1 or descartados:
            detalle.append(
                {
                    "provincia": limpiar(fila.get("provincia")),
                    "distrito": limpiar(fila.get("distrito")),
                    "nombre": limpiar(fila.get("nombre")),
                    "celular": numeros[0] if numeros else "",
                    COLUMNA_CELULAR_2: " / ".join(numeros[1:]),
                    "origen": limpiar(fila.get("celular")),
                    "descartado": " / ".join(descartados),
                }
            )

    df["celular"] = principales
    df[COLUMNA_CELULAR_2] = alternos
    columnas = [c for c in df.columns if c != COLUMNA_CELULAR_2]
    columnas.insert(columnas.index("celular") + 1, COLUMNA_CELULAR_2)
    return df[columnas], detalle


def escribir(
    df: pd.DataFrame,
    ruta,
    diagnostico: list[dict],
    no_cruzados: list[dict],
    extras: dict[str, list[dict]] | None = None,
    hoja_salida: str = HOJA_SALIENTES,
    entrantes: pd.DataFrame | None = None,
    hoja_entrantes: str = HOJA_ENTRANTES,
    informe: dict | None = None,
) -> None:
    ruta = Path(ruta)
    df = _sin_nombre(df)
    if entrantes is not None and not entrantes.empty:
        entrantes = _sin_nombre(entrantes)
    try:
        _escribir_archivo(
            df,
            ruta,
            diagnostico,
            no_cruzados,
            extras,
            hoja_salida,
            entrantes,
            hoja_entrantes,
            informe,
        )
    except PermissionError as error:
        raise SystemExit(
            f"No se pudo escribir {ruta}: puede estar abierto en Excel. "
            "Ciérralo o usa --salida con otro nombre."
        ) from error


# ---------------------------------------------------------------------------
# Gestión vigente: directorio de las autoridades en el cargo (CSV o Excel)
# ---------------------------------------------------------------------------

RUTA_DIRECTORIO_POR_DEFECTO = Path(__file__).with_name(
    "DIRECTORIO_ALCALDES_ANCASH_2026.csv"
)

COLUMNA_DIRECCION = "direccion"
COLUMNA_UBIGEO = "ubigeo"
# Columna que marca en la hoja de elegidos a quien ya estaba en el cargo al corte.
COLUMNA_REELECCION = "reelegido"
# El directorio es la hoja de salientes: lleva dirección, pero no la marca de
# reelección, que se calcula sobre los elegidos.
COLUMNAS_DIRECTORIO = COLUMNAS_SALIDA + [COLUMNA_DIRECCION]
COLUMNAS_VISIBLES_ELEGIDOS = COLUMNAS_VISIBLES + [
    COLUMNA_DIRECCION,
    COLUMNA_REELECCION,
]

# Alias aceptados en el CSV del directorio. Se comparan con `clave`, así que las
# tildes, los guiones y los espacios de más ('CELULAR_1' o 'CELULAR 1') dan igual.
_CAMPOS_DIRECTORIO = {
    "departamento": ("DEPARTAMENTO", "REGION"),
    "provincia": ("PROVINCIA", "PROVINCIA (PRIORITARIOS COSTA)"),
    "distrito": ("DISTRITO",),
    "ubigeo": ("UBIGEO", "CODIGO UBIGEO"),
    "cargo": ("CARGO",),
    "nombres": ("NOMBRES", "NOMBRE"),
    "nombre_completo": (
        "NOMBRES Y APELLIDOS DEL ALCALDE",
        "NOMBRES Y APELLIDOS",
        "NOMBRE COMPLETO",
    ),
    "paterno": ("APELLIDO_PATERNO", "APELLIDO PATERNO", "PATERNO"),
    "materno": ("APELLIDO_MATERNO", "APELLIDO MATERNO", "MATERNO"),
    "celular1": ("CELULAR_1", "CELULAR 1", "TELEFONO_1", "TELEFONO", "TELEFONOS"),
    "celular2": ("CELULAR_2", "CELULAR 2", "TELEFONO_2"),
    "correo": ("CORREO_ELECTRONICO", "CORREO", "EMAIL"),
    "direccion": ("DIRECCION", "DIRECCION MUNICIPAL"),
}


def _leer_csv_tolerante(ruta) -> pd.DataFrame:
    """Lee un CSV probando las codificaciones habituales (UTF-8 con BOM y latin-1)."""
    ruta = Path(ruta)
    if not ruta.exists():
        raise SystemExit(f"No se encontró el CSV: {ruta}")
    for codificacion in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(ruta, dtype=str, encoding=codificacion)
        except UnicodeDecodeError:
            continue
        except pd.errors.EmptyDataError as error:
            raise SystemExit(f"{ruta} está vacío.") from error
    raise SystemExit(f"No se pudo leer {ruta}: revisa la codificación.")


def _columna_por_alias(df: pd.DataFrame, *alias: str) -> str | None:
    """Devuelve la columna real que corresponde a cualquiera de los alias."""
    mapa = {clave(columna): columna for columna in df.columns}
    for nombre in alias:
        encontrada = mapa.get(clave(nombre))
        if encontrada:
            return encontrada
    return None


def _campo_por_alias(texto) -> str | None:
    """Campo del directorio al que corresponde un rótulo de encabezado."""
    c = clave(texto)
    if not c:
        return None
    for campo, alias in _CAMPOS_DIRECTORIO.items():
        for nombre in alias:
            buscado = clave(nombre)
            if c == buscado:
                return campo
            if len(buscado) >= 5 and (c.startswith(buscado) or buscado in c):
                return campo
    return None


def _fila_encabezado_directorio(crudo: pd.DataFrame, maximo: int = 40) -> int:
    """Fila del encabezado en un directorio en Excel.

    El directorio nacional trae un título, una línea en blanco y la fecha de
    actualización antes de la tabla; el encabezado es la fila que reconoce más
    campos del directorio.
    """
    mejor_fila, mejor_puntaje = 0, 0
    for indice in range(min(maximo, len(crudo))):
        campos = {_campo_por_alias(c) for c in crudo.iloc[indice].tolist()}
        campos.discard(None)
        if len(campos) > mejor_puntaje:
            mejor_fila, mejor_puntaje = indice, len(campos)
    if mejor_puntaje < 2:
        raise SystemExit(
            "No se encontró el encabezado del directorio: revisa que la hoja traiga "
            "columnas como UBIGEO, PROVINCIA, DISTRITO o NOMBRES Y APELLIDOS."
        )
    return mejor_fila


def _codigo_ubigeo(valor) -> str:
    """Código de ubigeo de seis dígitos ('020101'), aunque venga como número."""
    digitos = re.sub(r"\D", "", limpiar(valor))
    return digitos.zfill(6) if digitos else ""


def _leer_tabla_directorio(ruta, hoja=None) -> pd.DataFrame:
    """Lee el directorio venga en CSV o en Excel, y devuelve la tabla con encabezado.

    El CSV del proveedor trae el encabezado en la primera fila y las columnas
    truncadas por ancho fijo; el directorio nacional es un Excel con una sola hoja,
    el nombre completo en una columna y el código de ubigeo.
    """
    ruta = Path(ruta)
    if ruta.suffix.lower() in {".xlsx", ".xlsm", ".xls"}:
        crudo = pd.read_excel(
            ruta, sheet_name=0 if hoja is None else hoja, header=None, dtype=object
        )
        fila = _fila_encabezado_directorio(crudo)
        encabezados = [limpiar(c) for c in crudo.iloc[fila].tolist()]
        tabla = crudo.iloc[fila + 1 :].copy()
        tabla.columns = encabezados
        return tabla.loc[:, [c for c in encabezados if c]].reset_index(drop=True)
    if ruta.suffix.lower() not in {".csv", ".txt", ""}:
        raise SystemExit(f"No sé leer {ruta.name}: el directorio debe ser .csv o .xlsx")
    return _leer_csv_tolerante(ruta)


def _mapa_campos_directorio(df: pd.DataFrame) -> dict[str, str | None]:
    """{campo interno: columna real del CSV} tolerando nombres alternativos."""
    return {
        campo: _columna_por_alias(df, *alias)
        for campo, alias in _CAMPOS_DIRECTORIO.items()
    }


def _nombre_presentable(valor) -> str:
    """'JUAN DE DIOS PEREZ' -> 'Juan de Dios Perez'; no toca lo que ya viene bien."""
    return normalizar_toponimo(_limpiar_nombre(valor))


# ---------------------------------------------------------------------------
# Parecido ortográfico: n-gramas de caracteres
# ---------------------------------------------------------------------------
# Un topónimo no se resuelve con embeddings semánticos: son nombres propios y el
# problema es de ortografía, no de significado. Un vector de n-gramas de caracteres
# (2 a 4) mide justo eso —'CHAVIN DE HUAN' comparte casi todos sus trigramas con
# 'Chavín de Huántar'— y, con una regla de margen, no confunde a dos distritos
# vecinos ('Huacachi' y 'Huacchis' se parecen y son distintos).

UMBRAL_PARECIDO = 0.20
MARGEN_PARECIDO = 0.16
_TAMANOS_NGRAMA = (2, 3, 4)
_CACHE_NGRAMAS: dict[str, dict[str, float]] = {}


def _vector_ngramas(texto) -> dict[str, float]:
    """Vector disperso del nombre: n-gramas de caracteres con frecuencia suavizada."""
    c = clave(texto)
    if not c:
        return {}
    if c in _CACHE_NGRAMAS:
        return _CACHE_NGRAMAS[c]
    colchon = f" {c} "
    cuenta: Counter = Counter()
    for tamano in _TAMANOS_NGRAMA:
        for i in range(len(colchon) - tamano + 1):
            cuenta[colchon[i : i + tamano]] += 1
    vector = {grama: 1.0 + math.log(n) for grama, n in cuenta.items()}
    _CACHE_NGRAMAS[c] = vector
    return vector


def _coseno_vectores(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    numerador = sum(a[grama] * b[grama] for grama in set(a) & set(b))
    norma_a = math.sqrt(sum(v * v for v in a.values()))
    norma_b = math.sqrt(sum(v * v for v in b.values()))
    if not norma_a or not norma_b:
        return 0.0
    return numerador / (norma_a * norma_b)


def resolver_por_parecido(
    valor,
    candidatos: list[str],
    umbral: float | None = None,
    margen: float | None = None,
) -> tuple[str, float]:
    """Candidato más parecido en la ortografía, solo si gana con ventaja.

    Devuelve `("", puntaje)` cuando no hay ninguno suficientemente parecido o
    cuando el primero y el segundo quedan demasiado cerca. Ese empate es la
    diferencia entre 'Huacachi' y 'Huacchis': no se resuelve, se informa.
    """
    umbral = UMBRAL_PARECIDO if umbral is None else umbral
    margen = MARGEN_PARECIDO if margen is None else margen
    vector = _vector_ngramas(valor)
    if not vector or not candidatos:
        return "", 0.0

    pares = sorted(
        ((_coseno_vectores(vector, _vector_ngramas(c)), c) for c in candidatos),
        key=lambda par: -par[0],
    )
    puntaje = pares[0][0]
    if puntaje < umbral:
        return "", puntaje
    if len(pares) > 1 and (puntaje - pares[1][0]) < margen:
        return "", puntaje
    return pares[0][1], puntaje


def _expandir_nombre(
    valor: str, candidatos: list[str], permitir_parecido: bool | None = None
) -> tuple[str, str]:
    """Nombre oficial de `candidatos` que corresponde a `valor`.

    El directorio viene truncado por ancho fijo ('CHAVIN DE HUAN', 'SAN JUAN DE
    RON'), así que además del nombre exacto se acepta un prefijo, pero solo cuando
    identifica a un único candidato: 'SAN MIGUEL DE A' es 'San Miguel de Aco' y no
    'San Miguel de Corpanqui'. Como último recurso se acepta el parecido ortográfico
    (n-gramas de caracteres) siempre que le saque ventaja clara al segundo candidato.
    Si hay duda se deja lo recibido y se informa.
    """
    permitir_parecido = (
        USAR_PARECIDOS if permitir_parecido is None else permitir_parecido
    )
    buscado = clave(valor)
    if not buscado:
        return valor, "vacio"
    for candidato in candidatos:
        if clave(candidato) == buscado:
            return candidato, "exacto"
    por_prefijo = [c for c in candidatos if clave(c).startswith(buscado)]
    if len(por_prefijo) == 1:
        return por_prefijo[0], "truncado"
    if len(por_prefijo) > 1:
        if permitir_parecido:
            elegido, _ = resolver_por_parecido(valor, por_prefijo)
            if elegido:
                return elegido, "parecido"
        return valor, "ambiguo"
    if permitir_parecido:
        elegido, _ = resolver_por_parecido(valor, candidatos)
        if elegido:
            return elegido, "parecido"
    return valor, "sin coincidencia"


def _ajustar_al_ubigeo(provincia, distrito, ubigeo) -> tuple[str, str, str]:
    """Lleva (provincia, distrito) del directorio a los nombres oficiales del ubigeo."""
    provincia = _nombre_presentable(provincia)
    distrito = _nombre_presentable(distrito)
    if ubigeo is None or ubigeo.empty:
        return provincia, distrito, "sin ubigeo"

    provincias = sorted({limpiar(p) for p in ubigeo["provincia"] if limpiar(p)})
    oficial, motivo = _expandir_nombre(provincia, provincias)
    if motivo not in {"exacto", "truncado"}:
        return provincia, distrito, motivo
    provincia = oficial

    distritos = sorted(
        {
            limpiar(d)
            for d, p in zip(ubigeo["distrito"], ubigeo["provincia"])
            if clave(p) == clave(provincia) and limpiar(d)
        }
    )
    distrito, motivo = _expandir_nombre(distrito, distritos)
    return provincia, distrito, motivo


def _codigos_por_par(ubigeo: pd.DataFrame) -> dict[tuple[str, str], str]:
    """{(clave(provincia), clave(distrito)): código de seis dígitos} del ubigeo."""
    mapa: dict[tuple[str, str], str] = {}
    if ubigeo is None or ubigeo.empty:
        return mapa
    for codigo, provincia, distrito in zip(
        ubigeo["ubigeo"], ubigeo["provincia"], ubigeo["distrito"]
    ):
        c = _codigo_ubigeo(codigo)
        if c and limpiar(distrito):
            mapa.setdefault((clave(provincia), clave(distrito)), c)
    return mapa


def _con_ubigeo(
    base: pd.DataFrame | None,
    codigos: dict[tuple[str, str], str],
    etiqueta: str = TAG_PROVINCIAL,
) -> pd.DataFrame | None:
    """Agrega la columna `ubigeo` con el código del CSV de RENIEC.

    Es la misma llave en las dos hojas, así que sirve para conciliarlas. Las filas
    rotuladas PROVINCIAL no son un distrito: se quedan sin código en vez de tomar el
    de la capital, porque la municipalidad provincial no es un distrito del geodir.
    """
    if base is None or base.empty:
        return base
    base = base.copy()
    valores: list[str] = []
    for provincia, distrito in zip(base["provincia"], base["distrito"]):
        if clave(distrito) == clave(etiqueta):
            valores.append("")
        else:
            valores.append(codigos.get((clave(provincia), clave(distrito)), ""))
    base.insert(0, COLUMNA_UBIGEO, valores)
    return base


def _sugerencia_ruta(ruta) -> str:
    """Frase que ofrece el archivo parecido cuando la ruta pedida no existe.

    El error típico es equivocar la extensión (`...noviembre-2026.csv` cuando el
    archivo es `.xlsx`): mismo nombre y otra extensión en la misma carpeta.
    """
    ruta = Path(ruta)
    if not ruta.parent.is_dir():
        return ""
    parecidos = sorted(
        p
        for p in ruta.parent.iterdir()
        if p.is_file()
        and p.stem.lower() == ruta.stem.lower()
        and p.suffix.lower() != ruta.suffix.lower()
    )
    if not parecidos:
        return ""
    nombres = " o ".join(f"«{p.name}»" for p in parecidos)
    return f" ¿Querías {nombres}?"


def _descartada(valores: dict, motivo: str, nombre: str = "") -> dict:
    """Fila del directorio que no entra, con el motivo a la vista."""
    return {
        "provincia": valores.get("provincia"),
        "distrito": valores.get("distrito"),
        "nombre": nombre or valores.get("nombre_completo", ""),
        "motivo": motivo,
    }


def leer_directorio(
    ruta=None,
    departamento: str | None = None,
    expandir: bool = True,
    ruta_ubigeo=None,
    hoja=None,
) -> tuple[pd.DataFrame, dict]:
    """Lee el directorio de las autoridades en gestión y lo lleva al formato de la hoja.

    Acepta dos formas del mismo dato: el CSV por provincia (nombre partido en
    NOMBRES / APELLIDO_PATERNO / APELLIDO_MATERNO y dos celulares) y el directorio
    nacional en Excel (nombre completo en una columna, `Teléfonos` y código de
    ubigeo). La `direccion` es la de la municipalidad, así que sirve también para la
    hoja de elegidos. Las filas de alcalde provincial se rotulan PROVINCIAL, igual
    que en la hoja de elegidos.

    Cuando el archivo trae código de ubigeo se usa solo como respaldo: los códigos
    del ubigeo de referencia no siempre coinciden con los oficiales (el ubigeo trae
    Coris en 020203 y Huacllán en 020205), así que el nombre del distrito manda. Con
    `departamento` se descartan las filas de otros departamentos, por código si lo
    hay y, si no, por la columna DEPARTAMENTO.
    """
    ruta = Path(ruta) if ruta else RUTA_DIRECTORIO_POR_DEFECTO
    crudo = _leer_tabla_directorio(ruta, hoja)
    columnas = _mapa_campos_directorio(crudo)

    faltan = [
        etiqueta
        for campo, etiqueta in (("provincia", "PROVINCIA"),)
        if not columnas.get(campo)
    ]
    if not columnas.get("nombres") and not columnas.get("nombre_completo"):
        faltan.append("NOMBRES o NOMBRES Y APELLIDOS DEL ALCALDE")
    if faltan:
        raise SystemExit(
            f"{ruta} no tiene las columnas {', '.join(faltan)}; "
            f"columnas encontradas: {', '.join(map(str, crudo.columns))}"
        )

    ubigeo = None
    por_codigo: dict[str, tuple[str, str, str]] = {}
    if expandir:
        # El país entero se usa para dos cosas que no admiten recortes: traducir el
        # código de ubigeo y saber a qué departamento pertenece cada código.
        ubigeo_pais = leer_ubigeo(ruta_ubigeo, None)
        por_codigo = {
            _codigo_ubigeo(codigo): (limpiar(dep), limpiar(prov), limpiar(dist))
            for codigo, dep, prov, dist in zip(
                ubigeo_pais["ubigeo"],
                ubigeo_pais["departamento"],
                ubigeo_pais["provincia"],
                ubigeo_pais["distrito"],
            )
        }
        if departamento:
            ubigeo = ubigeo_pais[
                ubigeo_pais["departamento"].map(clave) == clave(departamento)
            ]
            if ubigeo.empty:
                disponibles = ", ".join(
                    sorted({limpiar(d) for d in ubigeo_pais["departamento"]})
                )
                raise SystemExit(
                    f"El ubigeo no tiene distritos para «{departamento}». "
                    f"Departamentos disponibles: {disponibles}"
                )
        else:
            ubigeo = ubigeo_pais

    filas: list[dict] = []
    ajustados: list[dict] = []
    descartadas: list[dict] = []
    corregidos: list[dict] = []
    capitales: dict[str, str] = {}
    capitales_detalle: list[dict] = []
    codigos = _codigos_por_par(ubigeo) if ubigeo is not None else {}
    for _, fila in crudo.iterrows():
        valores = {
            campo: limpiar(fila[columna]) if columna else ""
            for campo, columna in columnas.items()
        }

        codigo = _codigo_ubigeo(valores.get("ubigeo"))
        oficial = por_codigo.get(codigo) if codigo else None

        # El departamento se decide por el código cuando existe, porque es el único
        # dato que no depende de cómo esté escrita la palabra.
        if oficial is not None:
            if departamento and clave(oficial[0]) != clave(departamento):
                descartadas.append(
                    _descartada(valores, "departamento «" + oficial[0] + "»")
                )
                continue
        elif (
            departamento
            and columnas.get("departamento")
            and clave(valores.get("departamento")) != clave(departamento)
        ):
            descartadas.append(
                _descartada(
                    valores, "departamento «" + valores.get("departamento") + "»"
                )
            )
            continue

        if columnas.get("nombre_completo"):
            # Directorio nacional: un solo campo con el nombre completo.
            nombres, apellidos = _partir_nombre(valores.get("nombre_completo"))[:2]
            nombre = valores.get("nombre_completo")
        else:
            nombres = _nombre_presentable(valores.get("nombres"))
            paterno = _nombre_presentable(valores.get("paterno"))
            materno = _nombre_presentable(valores.get("materno"))
            apellidos = " ".join(p for p in (paterno, materno) if p)
            nombre = " ".join(p for p in (nombres, paterno, materno) if p)

        if not any((nombres, apellidos)):
            continue

        # Los códigos del CSV de RENIEC no son los oficiales: en Aija, Coris figura
        # como 020203 y Huacllán como 020205. Usarlos como llave asigna la fila de
        # un distrito al municipio de otro (dos confidentes en un mismo distrito y
        # uno ausente). Por eso el nombre manda y el código solo respalda cuando el
        # nombre no se puede ubicar en el ubigeo del departamento.
        provincia_nombre = _nombre_presentable(valores.get("provincia"))
        distrito_origen = _nombre_presentable(valores.get("distrito"))
        es_provincial = "PROVINCIAL" in clave(valores.get("cargo")) or not clave(
            distrito_origen
        )
        motivo = "sin ubigeo"
        if ubigeo is not None and not ubigeo.empty:
            provincia_ub, distrito_ub, motivo = _ajustar_al_ubigeo(
                provincia_nombre, distrito_origen, ubigeo
            )
            if motivo in {"exacto", "truncado", "parecido"}:
                provincia_nombre, distrito_origen = provincia_ub, distrito_ub
            elif oficial is not None:
                provincia_nombre, distrito_origen = oficial[1], oficial[2]
                motivo = "codigo"
        elif oficial is not None:
            provincia_nombre, distrito_origen = oficial[1], oficial[2]
            motivo = "codigo"

        # El ubigeo de la fila se toma del ubigeo de RENIEC resuelto por nombre, que
        # es el mismo que usa la hoja de elegidos. Si no coincide con el que trae
        # el directorio, se informa: es un dato de calidad del archivo de origen.
        codigo_resuelto = codigos.get(
            (clave(provincia_nombre), clave(distrito_origen)), ""
        )
        if codigo and codigo_resuelto and codigo != codigo_resuelto:
            corregidos.append(
                {
                    "provincia": provincia_nombre,
                    "distrito": distrito_origen,
                    "ubigeo_origen": codigo,
                    "ubigeo": codigo_resuelto,
                }
            )

        provincia = provincia_nombre
        distrito = TAG_PROVINCIAL if es_provincial else distrito_origen
        # El código del distrito capital solo se conoce por el nombre que trae el
        # directorio; sirve para ubicar ese distrito y heredarle la dirección, no
        # para escribir el ubigeo de la fila PROVINCIAL (que no es un distrito).
        if es_provincial and codigo_resuelto:
            capitales.setdefault(clave(provincia), codigo_resuelto)
            # La capital no está en el geodir: de dónde salió su nombre se deja
            # registrado, porque el código del directorio no es confiable.
            capitales_detalle.append(
                {
                    "provincia": provincia,
                    "distrito": distrito_origen,
                    "ubigeo": codigo_resuelto,
                    "motivo": (
                        "por nombre"
                        if motivo in {"exacto", "truncado", "parecido"}
                        else "por código del directorio"
                    ),
                }
            )
        if not es_provincial and motivo not in {"exacto", "codigo"}:
            ajustados.append(
                {
                    "provincia": provincia,
                    "distrito_origen": valores.get("distrito"),
                    "distrito": distrito,
                    "motivo": motivo,
                }
            )

        numeros: list[str] = []
        for bruto in (valores.get("celular1"), valores.get("celular2")):
            for numero in _numeros_celular(bruto):
                if numero not in numeros:
                    numeros.append(numero)

        filas.append(
            {
                "distrito": distrito,
                "provincia": provincia,
                "nombre": nombre,
                "nombres": nombres,
                "apellidos": apellidos,
                "celular": numeros[0] if numeros else "",
                COLUMNA_CELULAR_2: " / ".join(numeros[1:]),
                "correo_electronico": extraer_emails(valores.get("correo")),
                COLUMNA_DIRECCION: valores.get("direccion"),
            }
        )

    df = pd.DataFrame(filas, columns=COLUMNAS_DIRECTORIO)
    if ubigeo is not None and not df.empty:
        df, canonicos = canonizar_ubigeo(df, ubigeo, etiqueta=TAG_PROVINCIAL)
        ajustados.extend(
            {
                "provincia": ajuste["provincia_origen"],
                "distrito_origen": ajuste["distrito_origen"],
                "distrito": ajuste["distrito"],
                "motivo": ajuste["motivo"],
            }
            for ajuste in canonicos
        )

    informe = {
        "filas": len(df),
        "provinciales": int((df["distrito"] == TAG_PROVINCIAL).sum()),
        "sin_celular": int(
            (df["celular"].map(es_vacio) & df[COLUMNA_CELULAR_2].map(es_vacio)).sum()
        ),
        "con_celular_alternativo": int((~df[COLUMNA_CELULAR_2].map(es_vacio)).sum()),
        "sin_correo": int(df["correo_electronico"].map(es_vacio).sum()),
        "sin_direccion": int(df[COLUMNA_DIRECCION].map(es_vacio).sum()),
        "ajustados": ajustados,
        "corregidos": corregidos,
        "capitales": capitales,
        "capitales_detalle": capitales_detalle,
        "descartadas": descartadas,
    }
    return df, informe


# ---------------------------------------------------------------------------
# Reelección: quién de los elegidos ya figuraba en la hoja de salientes
# ---------------------------------------------------------------------------

UMBRAL_REELECCION = 0.90


def _firma_persona(texto) -> str:
    """Nombre reducido a sus palabras ordenadas: ignora el orden y los acentos.

    'ROSALES TINOCO DAVID MANUEL' y 'DAVID MANUEL ROSALES TINOCO' dan la misma
    firma; 'ROSALES' y 'ROSALES TINOCO' no, y por eso después se mide la similitud.
    """
    return " ".join(sorted(clave(texto).split()))


def verificar_alineacion(
    salientes: pd.DataFrame | None, entrantes: pd.DataFrame | None
) -> dict:
    """Compara las municipalidades de las dos hojas por (provincia, distrito).

    Las dos hojas tienen que hablar de los mismos municipios. El ubigeo no se
    escribe en las hojas, así que la llave práctica es el par de nombres oficiales
    del ubigeo: si un distrito de los elegidos no aparece entre los salientes, el
    libro está contando dos catálogos distintos y hay que corregir el directorio.
    """
    informe: dict = {
        "entrantes": 0,
        "salientes": 0,
        "solo_entrantes": [],
        "solo_salientes": [],
        "repetidos": [],
    }
    if salientes is None or entrantes is None:
        return informe
    if salientes.empty or entrantes.empty:
        return informe

    pares_salientes = {
        (clave(p), clave(d))
        for p, d in zip(salientes["provincia"], salientes["distrito"])
    }
    pares_entrantes: dict[tuple[str, str], dict] = {}
    for provincia, distrito in zip(entrantes["provincia"], entrantes["distrito"]):
        par = (clave(provincia), clave(distrito))
        registro = pares_entrantes.setdefault(
            par,
            {
                "provincia": limpiar(provincia),
                "distrito": limpiar(distrito),
                "filas": 0,
            },
        )
        registro["filas"] += 1

    informe["entrantes"] = len(pares_entrantes)
    informe["salientes"] = len(pares_salientes)
    informe["repetidos"] = [
        registro for registro in pares_entrantes.values() if registro["filas"] > 1
    ]
    informe["solo_entrantes"] = [
        {"provincia": registro["provincia"], "distrito": registro["distrito"]}
        for par, registro in pares_entrantes.items()
        if par not in pares_salientes
    ]
    informe["solo_salientes"] = [
        {"provincia": p, "distrito": d}
        for p, d in sorted(pares_salientes - set(pares_entrantes))
    ]
    return informe


def marcar_reelegidos(
    salientes: pd.DataFrame | None,
    entrantes: pd.DataFrame | None,
    umbral: float = UMBRAL_REELECCION,
) -> tuple[pd.DataFrame | None, list[dict]]:
    """Marca en `entrantes` a quien ya estaba en la hoja de salientes.

    La comparación es de nombres completos, no de distritos: se ordenan las palabras
    para que el orden no importe y la similitud tolera tildes y una errata. Se exige
    además que sea la misma municipalidad, porque dos homónimos en distritos
    distintos no son una reelección: esos casos se informan aparte como coincidencia
    dudosa y no se marcan. Devuelve la tabla marcada y el detalle para la consola.
    """
    detalle: list[dict] = []
    if salientes is None or salientes.empty:
        return entrantes, detalle
    if entrantes is None or entrantes.empty:
        return entrantes, detalle

    entrantes = entrantes.copy()
    if COLUMNA_REELECCION not in entrantes.columns:
        entrantes[COLUMNA_REELECCION] = ""

    previos = [
        (
            limpiar(fila.get("nombre")),
            _firma_persona(fila.get("nombre")),
            clave(fila.get("provincia")),
            clave(fila.get("distrito")),
        )
        for _, fila in salientes.iterrows()
        if limpiar(fila.get("nombre"))
    ]
    if not previos:
        return entrantes, detalle

    for indice, fila in entrantes.iterrows():
        nombre = limpiar(fila.get("nombre"))
        if not nombre:
            continue
        firma = _firma_persona(nombre)
        provincia = clave(fila.get("provincia"))
        distrito = clave(fila.get("distrito"))

        elegido = None
        fuera_de_zona = None
        for otro, firma_otro, provincia_otro, distrito_otro in previos:
            puntaje = 1.0 if firma_otro == firma else _similitud(nombre, otro)
            if puntaje < umbral:
                continue
            mismo_lugar = provincia_otro == provincia and distrito_otro == distrito
            registro = (puntaje, otro, provincia_otro, distrito_otro)
            if mismo_lugar:
                if elegido is None or puntaje > elegido[0]:
                    elegido = registro
            elif elegido is None and (
                fuera_de_zona is None or puntaje > fuera_de_zona[0]
            ):
                fuera_de_zona = registro

        if elegido is not None:
            entrantes.at[indice, COLUMNA_REELECCION] = "Sí"
            detalle.append(
                {
                    "provincia": limpiar(fila.get("provincia")),
                    "distrito": limpiar(fila.get("distrito")),
                    "nombre": nombre,
                    "anterior": elegido[1],
                    "similitud": round(elegido[0], 2),
                    "caso": "reelegido",
                }
            )
            continue

        entrantes.at[indice, COLUMNA_REELECCION] = "No"
        if fuera_de_zona is not None:
            detalle.append(
                {
                    "provincia": limpiar(fila.get("provincia")),
                    "distrito": limpiar(fila.get("distrito")),
                    "nombre": nombre,
                    "anterior": fuera_de_zona[1],
                    "similitud": round(fuera_de_zona[0], 2),
                    "caso": "mismo nombre en otro distrito",
                }
            )

    return entrantes, detalle


def _indice_direcciones(entrantes: pd.DataFrame) -> dict:
    """Índices de dirección por municipalidad, para cruzar con los salientes."""
    zona: dict[tuple[str, str], str] = {}
    distrito: dict[str, str] = {}
    ambiguos: set[str] = set()
    contenido: list[tuple[str, str, str]] = []
    provincia: dict[str, str] = {}
    for _, fila in entrantes.iterrows():
        direccion = limpiar(fila.get(COLUMNA_DIRECCION))
        if not direccion:
            continue
        p = clave(fila.get("provincia"))
        d = clave(fila.get("distrito"))
        if d and d != clave(TAG_PROVINCIAL):
            zona[(p, d)] = direccion
            contenido.append((p, d, direccion))
            if d in distrito:
                ambiguos.add(d)  # dos distritos homónimos en el departamento
            distrito[d] = direccion
        if p:
            provincia.setdefault(p, direccion)
    for nombre in ambiguos:
        distrito.pop(nombre, None)
    return {
        "zona": zona,
        "distrito": distrito,
        "contenido": contenido,
        "provincia": provincia,
    }


def _misma_provincia(a: str, b: str) -> bool:
    """Dos claves de provincia que designan la misma, tolerando el truncamiento de RENIEC."""
    if not a or not b:
        return False
    if a == b or a.startswith(b) or b.startswith(a):
        return True
    return _similitud(a, b) >= 0.85


def _mapa_capitales(
    ubigeo, entrantes: pd.DataFrame | None = None
) -> list[tuple[str, str]]:
    """Pares (provincia, distrito capital) según el ubigeo.

    El directorio trae una sola fila por municipalidad: la del distrito capital
    aparece como fila PROVINCIAL y no como distrito. Por eso el capital de cada
    provincia es el distrito del ubigeo que no tiene fila propia en el directorio.
    Si esa deducción no da un único candidato ('Huaraz' arrastra también a 'Pampas'
    por un error del CSV), se usa el distrito homónimo de la provincia y, en último
    caso, el código de ubigeo más bajo.
    """
    if ubigeo is None or getattr(ubigeo, "empty", True):
        return []

    provincias: dict[str, list[str]] = {}
    codigos: dict[str, dict[str, str]] = {}
    for _, fila in ubigeo.iterrows():
        p = clave(fila.get("provincia"))
        d = clave(fila.get("distrito"))
        if not p or not d:
            continue
        provincias.setdefault(p, []).append(d)
        codigos.setdefault(p, {})[d] = limpiar(fila.get("ubigeo"))

    con_fila: dict[str, set[str]] = {}
    if entrantes is not None and not entrantes.empty:
        for _, fila in entrantes.iterrows():
            d = clave(fila.get("distrito"))
            if d and d != clave(TAG_PROVINCIAL):
                con_fila.setdefault(clave(fila.get("provincia")), set()).add(d)

    pares: list[tuple[str, str]] = []
    for provincia, distritos in provincias.items():
        sin_fila = [d for d in distritos if d not in con_fila.get(provincia, set())]
        if len(sin_fila) == 1:
            pares.append((provincia, sin_fila[0]))
        elif provincia in distritos:
            pares.append((provincia, provincia))
        else:
            pares.append(
                (provincia, min(distritos, key=lambda d: codigos[provincia].get(d, "")))
            )
    return pares


def _direccion_de_distrito(indice: dict, provincia: str, distrito: str) -> str:
    """Dirección de un distrito: exacta, por nombre único o por contención única."""
    direccion = indice["zona"].get((provincia, distrito), "")
    if direccion:
        return direccion
    direccion = indice["distrito"].get(distrito, "")
    if direccion:
        return direccion
    # El Word trae 'Corpanqui' y 'Buena Vista'; el directorio, 'San Miguel de
    # Corpanqui' y 'Buena Vista Alta'. Se acepta la contención solo si identifica
    # un único distrito de esa provincia.
    candidatos = {
        otro: valor
        for p, otro, valor in indice["contenido"]
        if p == provincia and _distrito_contenido(otro, distrito)
    }
    if len(candidatos) == 1:
        return next(iter(candidatos.values()))
    return ""


def _distrito_por_codigo(ubigeo) -> dict[str, str]:
    """{código de ubigeo: clave(distrito)}, para volver de un código a su nombre."""
    mapa: dict[str, str] = {}
    if ubigeo is None or getattr(ubigeo, "empty", True):
        return mapa
    for codigo, distrito in zip(ubigeo["ubigeo"], ubigeo["distrito"]):
        c = _codigo_ubigeo(codigo)
        d = clave(distrito)
        if c and d:
            mapa.setdefault(c, d)
    return mapa


def _pares_capitales(ubigeo, directorio, capitales=None) -> list[tuple[str, str]]:
    """Pares (clave(provincia), clave(distrito capital)) del departamento.

    El geodir no dice cuál distrito es la capital: no trae esa columna y ninguna
    regla derivada de él acierta siempre (el código terminado en 01 falla en Bagua y
    Ocros; el distrito homónimo, en Santa —su capital es Chimbote— y Huaylas —Caraz—).
    Por eso el nombre de la capital se toma de la fila PROVINCIAL del directorio y se
    resuelve contra el ubigeo; `capitales` ya son códigos **del ubigeo**, no del
    directorio (ver `leer_directorio`). Sin ellos se deduce del propio directorio.
    """
    if capitales:
        por_codigo = _distrito_por_codigo(ubigeo)
        pares = [
            (clave(provincia), por_codigo[_codigo_ubigeo(codigo)])
            for provincia, codigo in capitales.items()
            if _codigo_ubigeo(codigo) in por_codigo
        ]
        if pares:
            return pares
    return _mapa_capitales(ubigeo, directorio)


def _heredar_direccion_capital(
    base: pd.DataFrame,
    pares: list[tuple[str, str]],
    etiqueta: str = TAG_PROVINCIAL,
) -> tuple[pd.DataFrame, int]:
    """Rellena la dirección vacía de los distritos capital con la de su provincia.

    La municipalidad provincial y la del distrito capital comparten sede, así que el
    distrito capital hereda la dirección de la fila PROVINCIAL. Solo se rellenan
    vacíos: la dirección que cada fila ya trae no se toca.
    """
    if base is None or base.empty or not pares:
        return base, 0
    if COLUMNA_DIRECCION not in base.columns:
        return base, 0
    por_provincia: dict[str, str] = {}
    for _, fila in base.iterrows():
        if clave(fila.get("distrito")) != clave(etiqueta):
            continue
        direccion = limpiar(fila.get(COLUMNA_DIRECCION))
        if direccion:
            por_provincia.setdefault(clave(fila.get("provincia")), direccion)
    if not por_provincia:
        return base, 0
    base = base.copy()
    rellenados = 0
    for indice, fila in base.iterrows():
        if not es_vacio(fila.get(COLUMNA_DIRECCION)):
            continue
        provincia = clave(fila.get("provincia"))
        distrito = clave(fila.get("distrito"))
        if not distrito or distrito == clave(etiqueta):
            continue
        if not any(
            distrito == capital and _misma_provincia(provincia, otra)
            for otra, capital in pares
        ):
            continue
        direccion = por_provincia.get(provincia, "")
        if direccion:
            base.at[indice, COLUMNA_DIRECCION] = direccion
            rellenados += 1
    return base, rellenados


def _ordenar_por_provincia(
    base: pd.DataFrame, etiqueta: str = TAG_PROVINCIAL
) -> pd.DataFrame:
    """Reubica las filas dentro de su bloque de provincia sin mover los bloques.

    Las filas que agrega `completar_con_ubigeo` entran al final del marco; aquí
    vuelven a su provincia, con la fila PROVINCIAL primero y los distritos por
    nombre, igual que la hoja de elegidos.
    """
    if base is None or base.empty:
        return base
    bloques: dict[str, int] = {}
    for provincia in base["provincia"]:
        bloques.setdefault(clave(provincia), len(bloques))
    llaves = [
        (
            bloques.get(clave(fila["provincia"]), len(bloques)),
            0 if clave(fila["distrito"]) == clave(etiqueta) else 1,
            clave(fila["distrito"]),
        )
        for _, fila in base.iterrows()
    ]
    orden = sorted(range(len(base)), key=llaves.__getitem__)
    return base.iloc[orden].reset_index(drop=True)


def aplicar_direcciones(
    base: pd.DataFrame,
    directorio: pd.DataFrame | None,
    etiqueta: str = TAG_PROVINCIAL,
    ubigeo=None,
    capitales: dict[str, str] | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Agrega `direccion` a la hoja de elegidos usando el directorio.

    La dirección es de la municipalidad, no de la persona: se busca por
    (provincia, distrito) y, para las filas PROVINCIAL, por provincia. El distrito
    capital usa la dirección de la municipalidad provincial, que es la misma sede.
    `capitales` son los códigos de capital que trae el directorio (ver
    `_pares_capitales`). Nunca se inventa: lo que no se encuentre queda vacío y se
    cuenta.
    """
    base = base.copy()
    if COLUMNA_DIRECCION in base.columns:
        base = base.drop(columns=[COLUMNA_DIRECCION])

    informe: dict = {"con_direccion": 0, "sin_direccion": 0, "detalle": {}}
    if directorio is None or directorio.empty:
        base[COLUMNA_DIRECCION] = ""
        informe["sin_direccion"] = len(base)
        return base, informe

    indice = _indice_direcciones(directorio)
    pares = _pares_capitales(ubigeo, directorio, capitales)
    direcciones: list[str] = []
    motivos: Counter = Counter()
    for _, fila in base.iterrows():
        p = clave(fila.get("provincia"))
        d = clave(fila.get("distrito"))
        if not d or d == clave(etiqueta):
            direccion, motivo = indice["provincia"].get(p, ""), "por provincia"
        else:
            direccion, motivo = _direccion_de_distrito(indice, p, d), "por distrito"
            if not direccion and any(
                d == capital and _misma_provincia(p, provincia)
                for provincia, capital in pares
            ):
                direccion = indice["provincia"].get(p, "")
                motivo = "por capital de provincia"
        motivos[motivo if direccion else "sin dirección"] += 1
        direcciones.append(direccion)

    base[COLUMNA_DIRECCION] = direcciones
    informe["con_direccion"] = int((~base[COLUMNA_DIRECCION].map(es_vacio)).sum())
    informe["sin_direccion"] = len(base) - informe["con_direccion"]
    informe["detalle"] = dict(motivos)
    return base, informe


def _conteos_faltantes(df: pd.DataFrame) -> list[dict]:
    """Conteos de faltantes calculados en Python (para la salida CSV)."""
    total = len(df)
    columna_nombre = _columna_nombre(df)

    def vacios(columna: str | None) -> int:
        if columna not in df.columns:
            return 0
        return int(df[columna].map(es_vacio).sum())

    def sin_celular_serie():
        if "celular" not in df.columns:
            return pd.Series(False, index=df.index)
        vacio = df["celular"].map(es_vacio)
        if COLUMNA_CELULAR_2 in df.columns:
            vacio = vacio & df[COLUMNA_CELULAR_2].map(es_vacio)
        return vacio

    filas = [
        ("filas", total),
        ("sin nombre", vacios(columna_nombre)),
        ("sin celular", int(sin_celular_serie().sum())),
        ("sin correo", vacios("correo_electronico")),
        ("sin apellidos", vacios("apellidos") if "apellidos" in df.columns else 0),
        (
            "con celular alternativo",
            int((~df[COLUMNA_CELULAR_2].map(es_vacio)).sum())
            if COLUMNA_CELULAR_2 in df.columns
            else 0,
        ),
        (
            "sin ningún contacto",
            int((sin_celular_serie() & df["correo_electronico"].map(es_vacio)).sum()),
        ),
        (
            "con nombre, celular y correo",
            int(
                (
                    ~df[columna_nombre].map(es_vacio)
                    & ~sin_celular_serie()
                    & ~df["correo_electronico"].map(es_vacio)
                ).sum()
            )
            if columna_nombre
            else 0,
        ),
    ]
    return [
        {
            "métrica": nombre,
            "cantidad": cantidad,
            "porcentaje": ""
            if nombre == "filas" or not total
            else round(cantidad / total, 4),
        }
        for nombre, cantidad in filas
    ]


def _resumir(lista: list[str], maximo: int = 8) -> str:
    """Lista en una sola línea, recortada cuando es larga."""
    if not lista:
        return ""
    if len(lista) <= maximo:
        return "; ".join(lista)
    return "; ".join(lista[:maximo]) + f"; … y {len(lista) - maximo} más"


def _par(provincia, distrito) -> str:
    """'Provincia / Distrito' sin barras sobrantes."""
    partes = [limpiar(provincia), limpiar(distrito)]
    return " / ".join(parte for parte in partes if parte)


def _avisos_diagnostico(
    informe: dict | None, no_cruzados: list[dict]
) -> list[tuple[str, str]]:
    """Pares (aviso, detalle) con lo que quedó fuera de las entradas o de la salida.

    Las tablas de la hoja se recalculan con fórmulas; estos avisos son lo que una
    fórmula no puede deducir: qué provincias del ubigeo no traen ni una fila, qué
    distritos se agregaron vacíos, qué quedó fuera del ubigeo y qué se descartó del
    Word, del Excel o del directorio.
    """
    if not informe:
        return []

    resumen = informe.get("resumen") or {}
    directorio = informe.get("directorio") or {}
    avisos: list[tuple[str, str]] = []

    sin_datos = informe.get("provincias_sin_datos")
    if sin_datos is not None:
        avisos.append(
            (
                "Provincias sin datos",
                _resumir(sin_datos)
                or "ninguna: todas las provincias del ubigeo traen filas",
            )
        )

    word = informe.get("word") or {}
    if word.get("vacias"):
        avisos.append(
            (
                "Tablas del Word vacías",
                f"{word['vacias']} de {word.get('tablas', 0)}",
            )
        )

    agregados = (resumen.get("ubigeo") or {}).get("agregados") or []
    if agregados:
        avisos.append(
            (
                "Distritos sin datos (elegidos)",
                f"{len(agregados)} agregado(s) vacío(s): "
                + _resumir(
                    [
                        _par(a.get("provincia"), a.get("distrito_ubigeo"))
                        for a in agregados
                    ]
                ),
            )
        )

    agregados_dir = directorio.get("agregados") or []
    if agregados_dir:
        avisos.append(
            (
                "Distritos sin datos (salientes)",
                f"{len(agregados_dir)} agregado(s) vacío(s): "
                + _resumir(
                    [
                        _par(a.get("provincia"), a.get("distrito_ubigeo"))
                        for a in agregados_dir
                    ]
                ),
            )
        )

    canonico = resumen.get("canonico") or []
    fuera = [
        _par(a.get("provincia_origen"), a.get("distrito_origen"))
        for a in canonico
        if a.get("motivo")
        in {"provincia fuera del ubigeo", "distrito fuera del ubigeo"}
    ]
    if fuera:
        avisos.append(("Fuera del ubigeo (se conservó, elegidos)", _resumir(fuera)))

    sin_ubigeo = (resumen.get("ubigeo") or {}).get("no_reconocidos") or []
    if sin_ubigeo:
        avisos.append(
            (
                "No reconocidos en el ubigeo (elegidos)",
                f"{len(sin_ubigeo)}: "
                + _resumir(
                    [_par(d.get("provincia"), d.get("distrito")) for d in sin_ubigeo]
                ),
            )
        )

    descartadas = (resumen.get("departamento") or {}).get("descartadas") or []
    if descartadas:
        avisos.append(
            (
                "Descartadas por departamento (elegidos)",
                f"{len(descartadas)}: "
                + _resumir(
                    [_par(d.get("provincia"), d.get("distrito")) for d in descartadas]
                ),
            )
        )

    fuera_dir = directorio.get("descartadas") or []
    if fuera_dir:
        motivos = sorted(
            {limpiar(d.get("motivo")) for d in fuera_dir if limpiar(d.get("motivo"))}
        )
        avisos.append(
            ("Directorio descartado", f"{len(fuera_dir)} fila(s) — {_resumir(motivos)}")
        )

    capitales_codigo = [
        c
        for c in (directorio.get("capitales_detalle") or [])
        if limpiar(c.get("motivo")) != "por nombre"
    ]
    if capitales_codigo:
        avisos.append(
            (
                "Capitales resueltas por código del directorio",
                f"{len(capitales_codigo)}: "
                + _resumir(
                    [
                        _par(c.get("provincia"), c.get("distrito"))
                        for c in capitales_codigo
                    ]
                ),
            )
        )

    ajustes = [
        a
        for a in (directorio.get("ajustados") or [])
        if limpiar(a.get("motivo")) not in {"exacto", "truncado"}
    ]
    if ajustes:
        avisos.append(
            (
                "Directorio sin ajustar al ubigeo",
                f"{len(ajustes)}: "
                + _resumir(
                    [
                        f"{limpiar(a.get('distrito_origen'))}"
                        f" ({limpiar(a.get('motivo'))})"
                        for a in ajustes
                    ]
                ),
            )
        )

    if no_cruzados:
        avisos.append(
            (
                "Excel sin cruzar",
                f"{len(no_cruzados)} fila(s) en la hoja «excel_no_cruzado»",
            )
        )

    provincias_excel = resumen.get("provincias") or []
    if provincias_excel:
        avisos.append(
            (
                "Provincias del Excel emparejadas",
                _resumir(
                    [
                        f"{limpiar(p.get('excel'))} -> {limpiar(p.get('word'))}"
                        f" ({limpiar(p.get('motivo'))})"
                        for p in provincias_excel
                    ]
                ),
            )
        )

    sin_partir = [
        fila
        for fila in (resumen.get("nombres") or [])
        if str(fila.get("caso", "")).startswith("sin partir")
    ]
    if sin_partir:
        avisos.append(
            ("Nombres sin partir", f"{len(sin_partir)} (detalle en la consola)")
        )

    return avisos


def _hoja_formula(nombre: str) -> str:
    """Nombre de hoja listo para una fórmula: Excel lo exige entre comillas."""
    return "'" + str(nombre).replace("'", "''") + "'"


def _referencia_rango(hoja: str, columna: str, columnas) -> str:
    """Rango de una columna de otra hoja, desde la fila 2 hasta el margen."""
    letra = get_column_letter(list(columnas).index(columna) + 1)
    return f"{_hoja_formula(hoja)}!${letra}$2:${letra}${MARGEN_FORMULA}"


def _ajustar_anchos(hoja, df: pd.DataFrame) -> None:
    """Ancho de columna proporcional al contenido, sin pasar de 55."""
    for indice, columna in enumerate(df.columns, start=1):
        valores = [len(str(columna))] + [len(str(v)) for v in df[columna].head(200)]
        hoja.column_dimensions[get_column_letter(indice)].width = min(
            max(12, max(valores) + 2), 55
        )


def _hoja_resumen(
    escritor,
    df: pd.DataFrame,
    hoja_datos: str = HOJA_SALIENTES,
    entrantes: pd.DataFrame | None = None,
    hoja_entrantes: str = HOJA_ENTRANTES,
    informe: dict | None = None,
    no_cruzados: list[dict] | None = None,
) -> None:
    """Hoja `diagnostico`: tablas vivas de faltantes y avisos de cobertura.

    Tres tablas: faltantes por campo, faltantes por provincia (hoja principal) y
    el resumen de la hoja de elegidos. Al final, un bloque «AVISOS» con lo que
    ninguna fórmula puede deducir: provincias del ubigeo sin una sola fila de las
    entradas, distritos agregados vacíos y filas descartadas o no cruzadas.

    Los conteos son FÓRMULAS sobre las hojas de datos, no números congelados: al
    completar o borrar una celda en la hoja principal, estas tablas se actualizan solas.
    """
    hoja = escritor.book.create_sheet("diagnostico")
    negrita = Font(bold=True)
    columnas = list(df.columns)
    columna_nombre = "nombres" if "nombres" in columnas else "nombre"
    if columna_nombre not in columnas:
        columna_nombre = None

    def letra(columna: str | None) -> str | None:
        if columna not in columnas:
            return None
        return get_column_letter(columnas.index(columna) + 1)

    def rango(columna: str) -> str:
        return _referencia_rango(hoja_datos, columna, columnas)

    filas_rango = rango("distrito")
    hoja["A1"] = "FALTANTES POR CAMPO"
    hoja["A1"].font = negrita
    hoja["A2"] = (
        "Tabla viva: se recalcula sola al completar o borrar datos en la hoja "
        f"«{hoja_datos}». No hace falta volver a ejecutar el script."
    )
    for columna, texto in zip("ABC", ("Métrica", "Cantidad", "% del total")):
        celda = hoja[f"{columna}4"]
        celda.value = texto
        celda.font = negrita

    fila = 5
    total_formula = f"COUNTA({filas_rango})"
    metricas: list[tuple[str, str]] = [("filas", f"={total_formula}")]
    if columna_nombre and letra(columna_nombre):
        metricas.append(
            ("sin nombre", f"={total_formula}-COUNTA({rango(columna_nombre)})")
        )
    if letra("celular"):
        if letra(COLUMNA_CELULAR_2):
            metricas.append(
                (
                    "sin celular",
                    f'=COUNTIFS({rango("celular")},"",{rango(COLUMNA_CELULAR_2)},"")',
                )
            )
        else:
            metricas.append(
                ("sin celular", f"={total_formula}-COUNTA({rango('celular')})")
            )
    if letra(COLUMNA_CELULAR_2):
        metricas.append(
            (
                "con celular alternativo",
                f"=COUNTA({rango(COLUMNA_CELULAR_2)})",
            )
        )
    if letra("correo_electronico"):
        metricas.append(
            ("sin correo", f"={total_formula}-COUNTA({rango('correo_electronico')})")
        )
    if letra("apellidos"):
        metricas.append(
            ("sin apellidos", f"={total_formula}-COUNTA({rango('apellidos')})")
        )
    if letra("celular") and letra("correo_electronico"):
        contacto = f'{rango("celular")},"",{rango("correo_electronico")},""'
        if letra(COLUMNA_CELULAR_2):
            contacto = (
                f'{rango("celular")},"",{rango(COLUMNA_CELULAR_2)},"",'
                f'{rango("correo_electronico")},""'
            )
        metricas.append(("sin ningún contacto", f"=COUNTIFS({contacto})"))
    if (
        columna_nombre
        and letra(columna_nombre)
        and letra("celular")
        and letra("correo_electronico")
    ):
        if letra(COLUMNA_CELULAR_2):
            completo = (
                f'=COUNTIFS({rango(columna_nombre)},"<>",'
                f'{rango("correo_electronico")},"<>")'
                f'-COUNTIFS({rango(columna_nombre)},"<>",'
                f'{rango("correo_electronico")},"<>",'
                f'{rango("celular")},"",{rango(COLUMNA_CELULAR_2)},"")'
            )
        else:
            completo = (
                f'=COUNTIFS({rango(columna_nombre)},"<>",{rango("celular")},"<>",'
                f'{rango("correo_electronico")},"<>")'
            )
        metricas.append(("con nombre, celular y correo", completo))

    fila_total = fila
    for indice, (nombre, formula) in enumerate(metricas):
        actual = fila_total + indice
        hoja[f"A{actual}"] = nombre
        hoja[f"B{actual}"] = formula
        if indice:
            hoja[f"C{actual}"] = f'=IFERROR($B${actual}/$B${fila_total},"")'
            hoja[f"C{actual}"].number_format = "0.0%"

    fila = fila_total + len(metricas) + 2
    hoja[f"A{fila}"] = "POR PROVINCIA"
    hoja[f"A{fila}"].font = negrita
    fila += 1
    encabezados = ["Provincia", "Filas", "Sin nombre", "Sin celular", "Sin correo"]
    for indice, texto in enumerate(encabezados, start=1):
        celda = hoja.cell(row=fila, column=indice, value=texto)
        celda.font = negrita

    provincia_rango = rango("provincia")
    for provincia in sorted(df["provincia"].dropna().unique()):
        fila += 1
        hoja.cell(row=fila, column=1, value=provincia)
        hoja.cell(row=fila, column=2, value=f"=COUNTIF({provincia_rango},$A{fila})")
        for columna, destino in (
            (columna_nombre, 3),
            ("celular", 4),
            ("correo_electronico", 5),
        ):
            if not columna or not letra(columna):
                continue
            if columna == "celular" and letra(COLUMNA_CELULAR_2):
                formula = (
                    f'=COUNTIFS({provincia_rango},$A{fila},{rango("celular")},"",'
                    f'{rango(COLUMNA_CELULAR_2)},"")'
                )
            else:
                formula = f'=COUNTIFS({provincia_rango},$A{fila},{rango(columna)},"")'
            hoja.cell(row=fila, column=destino, value=formula)

    if entrantes is not None and not entrantes.empty:
        columnas_e = list(entrantes.columns)
        total_e = (
            "COUNTA(" + _referencia_rango(hoja_entrantes, "distrito", columnas_e) + ")"
        )
        fila += 2
        hoja[f"A{fila}"] = "ELEGIDOS (WORD 2027-2030)"
        hoja[f"A{fila}"].font = negrita
        fila += 1
        for indice, texto in enumerate(("Métrica", "Cantidad"), start=1):
            celda = hoja.cell(row=fila, column=indice, value=texto)
            celda.font = negrita
        metricas_e = [("filas", f"={total_e}")]
        for columna, texto in (
            ("nombres", "sin nombre"),
            ("celular", "sin celular"),
            ("correo_electronico", "sin correo"),
            (COLUMNA_DIRECCION, "sin dirección"),
        ):
            if columna not in columnas_e:
                continue
            if columna == "celular" and COLUMNA_CELULAR_2 in columnas_e:
                metricas_e.append(
                    (
                        texto,
                        '=COUNTIFS({},"",{},"")'.format(
                            _referencia_rango(hoja_entrantes, "celular", columnas_e),
                            _referencia_rango(
                                hoja_entrantes, COLUMNA_CELULAR_2, columnas_e
                            ),
                        ),
                    )
                )
                continue
            referencia = _referencia_rango(hoja_entrantes, columna, columnas_e)
            metricas_e.append((texto, f"={total_e}-COUNTA({referencia})"))
        if COLUMNA_CELULAR_2 in columnas_e:
            metricas_e.append(
                (
                    "con celular alternativo",
                    f"=COUNTA({_referencia_rango(hoja_entrantes, COLUMNA_CELULAR_2, columnas_e)})",
                )
            )
        for nombre, formula in metricas_e:
            fila += 1
            hoja.cell(row=fila, column=1, value=nombre)
            hoja.cell(row=fila, column=2, value=formula)

    avisos = _avisos_diagnostico(informe, no_cruzados or [])
    if avisos:
        fila += 2
        hoja[f"A{fila}"] = "AVISOS"
        hoja[f"A{fila}"].font = negrita
        for titulo, detalle in avisos:
            fila += 1
            hoja[f"A{fila}"] = titulo
            hoja[f"B{fila}"] = detalle

    hoja.column_dimensions["A"].width = 34
    for columna in "BCDEF":
        hoja.column_dimensions[columna].width = 14


_PREFIJOS_REGLAS = ("=", "+", "-", "@")


def _seguro_csv(valor) -> str:
    """Neutraliza valores que Excel interpretaría como fórmula al abrir el CSV."""
    texto = limpiar(valor)
    if texto.startswith(_PREFIJOS_REGLAS):
        return f"'{texto}"
    return texto


def _escribir_xlsx(
    df: pd.DataFrame,
    ruta: Path,
    no_cruzados: list[dict],
    extras: dict[str, list[dict]],
    hoja_salida: str,
    entrantes: pd.DataFrame | None,
    hoja_entrantes: str,
    informe: dict | None = None,
) -> None:
    """Libro completo: salientes, entrantes, anexos y la hoja de diagnóstico."""
    with pd.ExcelWriter(ruta, engine="openpyxl") as escritor:
        df.to_excel(escritor, sheet_name=hoja_salida, index=False)
        if entrantes is not None and not entrantes.empty:
            entrantes.to_excel(escritor, sheet_name=hoja_entrantes, index=False)
        if no_cruzados:
            pd.DataFrame(no_cruzados).to_excel(
                escritor, sheet_name="excel_no_cruzado", index=False
            )
        for nombre, filas in extras.items():
            pd.DataFrame(filas).to_excel(
                escritor, sheet_name=str(nombre)[:31], index=False
            )
        _hoja_resumen(
            escritor,
            df,
            hoja_salida,
            entrantes,
            hoja_entrantes,
            informe,
            no_cruzados,
        )
        _ajustar_anchos(escritor.sheets[hoja_salida], df)
        if entrantes is not None and not entrantes.empty:
            _ajustar_anchos(escritor.sheets[hoja_entrantes], entrantes)


def _escribir_csv(
    df: pd.DataFrame,
    ruta: Path,
    diagnostico: list[dict],
    no_cruzados: list[dict],
    extras: dict[str, list[dict]],
    entrantes: pd.DataFrame | None,
    informe: dict | None = None,
) -> None:
    """CSV principal más un archivo por cada anexo (no hay hojas en un CSV)."""
    df.to_csv(ruta, index=False, encoding="utf-8-sig")

    def companero(sufijo: str, tabla: pd.DataFrame) -> None:
        ruta.with_name(f"{ruta.stem}_{sufijo}{ruta.suffix}").write_text(
            tabla.to_csv(index=False), encoding="utf-8-sig"
        )

    if entrantes is not None and not entrantes.empty:
        companero("entrantes", entrantes)
    if no_cruzados:
        companero("no_cruzado", pd.DataFrame(no_cruzados))
    for nombre, filas in extras.items():
        companero(nombre, pd.DataFrame(filas))
    companero("faltantes", pd.DataFrame(_conteos_faltantes(df)))
    if diagnostico:
        companero("diagnostico", pd.DataFrame(diagnostico))
    avisos = _avisos_diagnostico(informe, no_cruzados)
    if avisos:
        companero("avisos", pd.DataFrame(avisos, columns=["aviso", "detalle"]))


def _escribir_archivo(
    df: pd.DataFrame,
    ruta: Path,
    diagnostico: list[dict],
    no_cruzados: list[dict],
    extras: dict[str, list[dict]] | None = None,
    hoja_salida: str = HOJA_SALIENTES,
    entrantes: pd.DataFrame | None = None,
    hoja_entrantes: str = HOJA_ENTRANTES,
    informe: dict | None = None,
) -> None:
    extras = {k: v for k, v in (extras or {}).items() if v}
    if ruta.suffix.lower() in {".xlsx", ".xlsm"}:
        _escribir_xlsx(
            df,
            ruta,
            no_cruzados,
            extras,
            hoja_salida,
            entrantes,
            hoja_entrantes,
            informe,
        )
    else:
        _escribir_csv(df, ruta, diagnostico, no_cruzados, extras, entrantes, informe)


def _imprimir_recortado(
    lineas: list[str], maximo: int | None = 5, nota: str | None = None
) -> None:
    """Imprime las líneas; con `maximo`, solo las primeras y un resumen del resto."""
    if maximo is None:
        for linea in lineas:
            print(linea)
        return
    for linea in lineas[:maximo]:
        print(linea)
    resto = len(lineas) - maximo
    if resto > 0:
        print(f"  ... y {resto} más{nota or ''}")


def construir(
    ruta_docx=None,
    ruta_excel=None,
    columnas: list[str] | None = None,
    hoja=None,
    fila_encabezado: int | None = None,
    provincia_inicial: str | None = None,
    agregar_faltantes: bool = True,
    etiqueta_faltantes: str = TAG_PROVINCIAL,
    solo_confirmados: bool = False,
    fusionar: bool = False,
    marca_fusion: str = "(PROVINCIAL)",
    departamento: str | None = None,
    ruta_ubigeo=None,
    restringir: bool = True,
    canonizar: bool = True,
    separar: bool = True,
    debug: bool = False,
) -> tuple[pd.DataFrame, dict, list[dict], list[dict]]:
    """Pipeline completo: Word -> DataFrame -> cruce con Excel -> consolidado.

    Con `departamento`, el ubigeo de ese departamento es la línea base: se descartan
    las filas de otros departamentos (`restringir`) y los nombres de distrito y
    provincia se reemplazan por los oficiales (`canonizar`). Sin departamento se usa
    el ubigeo completo solo para canonizar los nombres.
    """
    df = pd.DataFrame(columns=COLUMNAS_FINALES)
    diagnostico: list[dict] = []
    no_usadas: list[str] = []

    if ruta_docx:
        df, diagnostico = leer_docx(
            ruta_docx,
            columnas=columnas,
            provincia_inicial=provincia_inicial,
            debug=debug,
        )
        print(f"Word: {len(df)} filas en {len(diagnostico)} tablas")

    resumen = {"rellenados": {}, "agregadas": 0, "no_cruzados": 0}
    no_cruzados: list[dict] = []
    if ruta_excel:
        excel, no_usadas = leer_excel(
            ruta_excel,
            hoja=hoja,
            fila_encabezado=fila_encabezado,
            solo_confirmados=solo_confirmados,
        )
        print(f"Excel: {len(excel)} filas útiles, {len(no_usadas)} columnas no usadas")
        df, resumen, no_cruzados = completar_con_excel(
            df,
            excel,
            agregar_faltantes=agregar_faltantes,
            etiqueta_faltantes=etiqueta_faltantes,
        )
        print(
            f"Cruce: {resumen['rellenados'] or 'sin rellenos'} · agregadas {resumen['agregadas']}"
            f" · no cruzadas {resumen['no_cruzados']}"
        )
        for resolucion in resumen.get("provincias", []):
            print(
                f"  provincia {resolucion['excel']} -> "
                f"{resolucion['word']} ({resolucion['motivo']})"
            )

    if fusionar and not df.empty:
        df, fusiones = fusionar_provinciales(
            df, etiqueta=etiqueta_faltantes, marca=marca_fusion
        )
        resumen["fusiones"] = fusiones
        print(
            f"Fusiones: {fusiones['fusionadas']} filas PROVINCIALES unidas a su distrito"
            f" · rellenos {fusiones['rellenados']}"
            f" · sin par {len(fusiones['sin_par'])}"
        )

    ubigeo = None
    if departamento:
        ubigeo = leer_ubigeo(ruta_ubigeo, departamento)
        print(f"Ubigeo: {len(ubigeo)} distritos en {limpiar(departamento)}")
    elif canonizar:
        try:
            ubigeo = leer_ubigeo(ruta_ubigeo, None)
        except SystemExit:
            ubigeo = None
        if ubigeo is not None:
            print(f"Ubigeo: {len(ubigeo)} distritos en todo el país")

    if ubigeo is not None:
        if departamento and restringir:
            df, informe_departamento = restringir_al_departamento(
                df, ubigeo, etiqueta=etiqueta_faltantes
            )
            resumen["departamento"] = informe_departamento
            print(
                f"  filtro {limpiar(departamento)}: {informe_departamento['dentro']} filas"
                f" dentro · {len(informe_departamento['descartadas'])} descartadas"
            )
            _imprimir_recortado(
                [
                    f"  - {descartada['provincia']} / {descartada['distrito']}"
                    f" ({descartada['motivo']})"
                    for descartada in informe_departamento["descartadas"]
                ],
                maximo=None,
            )

        if canonizar:
            df, informe_canonico = canonizar_ubigeo(
                df, ubigeo, etiqueta=etiqueta_faltantes
            )
            resumen["canonico"] = informe_canonico
            cambios = [
                ajuste
                for ajuste in informe_canonico
                if ajuste["motivo"] != "provincial"
            ]
            print(f"  nombres oficiales: {len(cambios)} ajustes")
            for ajuste in cambios:
                if ajuste["motivo"] in {
                    "distrito fuera del ubigeo",
                    "provincia fuera del ubigeo",
                }:
                    print(
                        f"  ! {ajuste['provincia_origen']} / {ajuste['distrito_origen']}"
                        f" ({ajuste['motivo']})"
                    )

    if departamento and ubigeo is not None:
        # Provincias que sí traen filas de las entradas, antes de que el ubigeo
        # agregue los distritos vacíos: es la base del aviso de cobertura.
        resumen["provincias_con_datos"] = sorted(
            {limpiar(p) for p in df["provincia"] if limpiar(p)}
        )
        df, informe_ubigeo = completar_con_ubigeo(
            df, ubigeo, etiqueta=etiqueta_faltantes
        )
        resumen["ubigeo"] = informe_ubigeo
        print(
            f"  agregados vacíos: {len(informe_ubigeo['agregados'])}"
            f" · coinciden por nombre: {informe_ubigeo['coincidencias_por_nombre']}"
            f" · fuera del ubigeo: {len(informe_ubigeo['no_reconocidos'])}"
        )
        for resolucion in informe_ubigeo["provincias"]:
            print(
                f"  provincia {resolucion['ubigeo']} -> {resolucion['salida']}"
                f" ({resolucion['motivo']})"
            )
        for agregado in informe_ubigeo["agregados"]:
            print(
                f"  + {agregado['provincia']} / {agregado['distrito_ubigeo']}"
                f" (ubigeo {agregado['ubigeo']})"
            )

    final = consolidar(df)
    if separar:
        final, reparto = separar_nombres(final)
        resumen["nombres"] = reparto
    final, celulares = separar_celulares(final)
    resumen["celulares"] = celulares
    return final, resumen, diagnostico, no_cruzados


# ---------------------------------------------------------------------------
# Autorprueba con un Word y un Excel sintéticos
# ---------------------------------------------------------------------------


def autotest() -> int:
    """Genera un Word/Excel con la misma forma que los reales y valida el pipeline."""
    import tempfile

    with tempfile.TemporaryDirectory() as carpeta:
        carpeta = Path(carpeta)

        doc = Document()
        doc.add_paragraph("RELACIÓN DE ALCALDES 2026")
        doc.add_paragraph()
        doc.add_paragraph("")
        doc.add_paragraph("PROVINCIA DE PIURA - ALCALDES DISTRITALES")
        tabla = doc.add_table(rows=1, cols=4)
        for celda, texto in zip(
            tabla.rows[0].cells, ["DISTRITO", "ALCALDE", "CELULAR", "CORREO"]
        ):
            celda.text = texto
        for distrito, alcalde, celular, correo in [
            ("TALARA", "JUAN PÉREZ GÓMEZ", "987654321", "jperez@munitalara.gob.pe"),
            ("PAITA", "MARÍA DE LOS ÁNGELES RUIZ", "", ""),
            (
                "LA ARENA",
                "JOSÉ  RAMÍREZ   DNI 44556677",
                "987 111 222 / 987 333 444",
                "jramirez@munilaarena.gob.pe ; contacto@munilaarena.gob.pe",
            ),
        ]:
            fila = tabla.add_row()
            for celda, texto in zip(fila.cells, [distrito, alcalde, celular, correo]):
                celda.text = texto

        doc.add_paragraph("")
        doc.add_paragraph("PROVINCIA DE TUMBES")
        tabla2 = doc.add_table(
            rows=0, cols=3
        )  # sin encabezado: se usa la plantilla por ancho
        for distrito, alcalde, celular in [
            ("ZORRITOS", "CARLOS ALBERTO VEGA DÍAZ", "999111222"),
            ("TUMBES", "ANA FLORES", "51 999 333 444"),
        ]:
            fila = tabla2.add_row()
            for celda, texto in zip(fila.cells, [distrito, alcalde, celular]):
                celda.text = texto
        ruta_docx = carpeta / "alcaldes.docx"
        doc.save(ruta_docx)

        encabezados = [
            "CONFIRMADO",
            "NRO.",
            "PROVINCIA\n(PRIORITARIOS COSTA)",
            "TIPO DE RIESGO",
            "ALCALDE",
            "ORGANIZACION POLITICA",
            "CELULAR",
            "CORREO ELECTRONICO",
            "COMENTARIOS",
        ]
        filas_job = [
            # Misma persona, distrito con nombre igual: se cruza por distrito y no se
            # duplica ni se sobrescribe lo que ya trae el Word.
            [
                "SI",
                "Dist.",
                "Talara (Piura)",
                "Alto",
                "JUAN PEREZ GOMEZ",
                "Partido X",
                "",
                "jperez@munipiura.gob.pe",
                "",
            ],
            # Sin tilde, celular vacío en el Word: debe rellenar.
            [
                "SI",
                "Dist.",
                "Paita (Piura)",
                "Bajo",
                "MARIA DE LOS ANGELES RUIZ",
                "Partido Z",
                "955444333",
                "",
                "",
            ],
            # Distrito que no está en el Word: debe agregarse como fila distrital.
            [
                "SI",
                "Dist.",
                "Mancora (Piura)",
                "Medio",
                "LUIS VEGA",
                "Partido W",
                "966777888",
                "lvega@munimancora.gob.pe",
                "",
            ],
            # Filas provinciales (NRO. numérico y sin paréntesis): una por provincia.
            [
                "SI",
                1,
                "Piura",
                "Alto",
                "PEDRO CASTILLO",
                "Partido V",
                "912345678",
                "",
                "",
            ],
            [
                "SI",
                2,
                "Tumbes",
                "Medio",
                "LUIS RAMOS SILVA",
                "Partido Y",
                "988777666",
                "lramos@regiontumbes.gob.pe",
                "",
            ],
        ]
        ruta_excel = carpeta / "base.xlsx"
        pd.DataFrame([encabezados] + filas_job).to_excel(
            ruta_excel, header=False, index=False
        )

        # Resolución de nombres de provincia (alias y erratas) antes del cruce
        provincias = {"PIURA": "Piura", "BOLGNESI": "Bolgnesi"}
        assert _resolver_provincia(provincias, "Piura") == ("Piura", "exacto")
        assert _resolver_provincia(provincias, "Bolognesi") == (
            "Bolgnesi",
            "parecido",
        ), _resolver_provincia(provincias, "Bolognesi")
        assert _resolver_provincia({"CHIMBOTE": "Chimbote"}, "Santa") == (
            "Chimbote",
            "alias",
        )
        assert _resolver_provincia(provincias, "Sechura") == ("Sechura", "nueva")
        assert _resolver_provincia(
            {"CARLOS FERMIN FITZCARRALD": "Carlos Fermin Fitzcarrald"},
            "Fermin Fitzcarrald",
        ) == ("Carlos Fermin Fitzcarrald", "parecido")
        assert _resolver_provincia({"LA MAR": "La Mar", "MAR": "Mar"}, "Mar") == (
            "Mar",
            "exacto",
        )
        assert dividir_provincia_distrito("Ticapampa (Recuay)") == (
            "Recuay",
            "Ticapampa",
        )
        assert dividir_provincia_distrito("Santa") == ("Santa", "")

        # La provincia se lee aunque el encabezado traiga texto y años alrededor
        assert _provincia_en_linea("PROVINCIA DE HUARAZ") == "Huaraz"
        assert (
            _provincia_en_linea(
                "ALCALDES DISTRITALES DE LA PROVINCIA DE SANTA 2027 - 2030"
            )
            == "Santa"
        ), _provincia_en_linea(
            "ALCALDES DISTRITALES DE LA PROVINCIA DE SANTA 2027 - 2030"
        )
        assert (
            _provincia_en_linea("MUNICIPALIDAD PROVINCIAL DE YUNGAY - REGISTRO")
            == "Yungay"
        )
        assert _provincia_en_linea("ANCASH - PROVINCIA DE CARHUAZ") == "Carhuaz"
        assert _provincia_en_linea("PROVINCIA: BOLOGNESI") == "Bolognesi"
        assert _provincia_en_linea("RELACION DE ALCALDES 2027 - 2030") is None
        assert _provincia_en_linea("PROVINCIA DE") is None
        # Un distrito rotulado y con el paréntesis de la provincia se limpia
        assert _limpiar_distrito("DISTRITO DE HUARAZ") == "Huaraz"
        assert _limpiar_distrito("SAN MARCOS (HUARI)") == "San Marcos"

        df, resumen, diagnostico, no_cruzados = construir(
            ruta_docx=ruta_docx,
            ruta_excel=ruta_excel,
            fusionar=True,
            canonizar=False,
            debug=False,
        )

        assert list(df.columns) == COLUMNAS_SALIDA, f"columnas: {list(df.columns)}"
        # 5 del Word + Mancora distrital + 2 provinciales del Excel
        assert len(df) == 8, f"se esperaban 8 filas, hay {len(df)}\n{df}"
        fila_juan = df[df["nombre"].str.contains("JUAN", na=False)].iloc[0]
        assert fila_juan["provincia"] == "Piura", fila_juan["provincia"]
        assert fila_juan["celular"] == "987654321", fila_juan["celular"]
        assert fila_juan["correo_electronico"] == "jperez@munitalara.gob.pe", fila_juan[
            "correo_electronico"
        ]
        provincial = df[df["distrito"] == TAG_PROVINCIAL]
        assert len(provincial) == 2, f"provinciales: {len(provincial)}\n{df}"
        assert set(provincial["provincia"]) == {"Piura", "Tumbes"}, provincial
        assert set(provincial["celular"]) == {"912345678", "988777666"}, provincial
        assert (
            df[df["nombre"].str.contains("ANA", na=False)].iloc[0]["celular"]
            == "999333444"
        )
        assert len(diagnostico) == 2, diagnostico
        assert resumen["agregadas"] == 3 and not no_cruzados, resumen
        assert resumen["rellenados"].get("celular") == 1, resumen
        assert resumen["motivos"].get("distrito exacto") == 2, resumen["motivos"]
        assert (
            df[df["nombre"].str.contains("RUIZ", na=False)].iloc[0]["celular"]
            == "955444333"
        )
        # Con la fusión pedida, nada se une aquí: los provinciales del Excel no
        # coinciden con ningún alcalde distrital del Word.
        assert resumen["fusiones"]["fusionadas"] == 0, resumen["fusiones"]
        # Distrito del Excel que no estaba en el Word: se agrega con su distrito real,
        # no con la etiqueta PROVINCIAL.
        fila_mancora = df[df["distrito"] == "Mancora"]
        assert len(fila_mancora) == 1, fila_mancora
        assert fila_mancora.iloc[0]["provincia"] == "Piura", fila_mancora
        assert fila_mancora.iloc[0]["correo_electronico"] == (
            "lvega@munimancora.gob.pe"
        ), fila_mancora
        # Varios teléfonos y correos en una celda, y DNI pegado al nombre
        fila_jose = df[df["nombre"].str.contains("RAM", na=False)].iloc[0]
        assert fila_jose["nombre"] == "JOSÉ RAMÍREZ", fila_jose["nombre"]
        assert fila_jose["distrito"] == "La Arena", fila_jose["distrito"]
        # Dos números en una celda: el primero va a `celular` y el otro a `celular_2`
        assert fila_jose["celular"] == "987111222", fila_jose["celular"]
        assert fila_jose["celular_2"] == "987333444", fila_jose["celular_2"]
        assert fila_jose["correo_electronico"].count("@") == 2, fila_jose[
            "correo_electronico"
        ]

        # Fusión de la fila PROVINCIAL con el distrito capital (opt-in)
        base_fusion = pd.DataFrame(
            [
                ["Chimbote", "Santa", "WALTER SOTO CAMPOS", "", ""],
                ["Coishco", "Santa", "OTRA PERSONA", "900000000", ""],
                [
                    TAG_PROVINCIAL,
                    "Santa",
                    "WALTER SOTO CAMPOS",
                    "911111111",
                    "wsoto@munisanta.gob.pe",
                ],
            ],
            columns=COLUMNAS_FINALES,
        )
        fusionado, informe_fusion = fusionar_provinciales(base_fusion)
        assert informe_fusion["fusionadas"] == 1, informe_fusion
        assert len(fusionado) == 2, fusionado
        fila_fusionada = fusionado[fusionado["distrito"] == "Chimbote (PROVINCIAL)"]
        assert len(fila_fusionada) == 1, fusionado
        fila_fusionada = fila_fusionada.iloc[0]
        assert fila_fusionada["celular"] == "911111111", fila_fusionada
        assert fila_fusionada["correo_electronico"] == "wsoto@munisanta.gob.pe"
        assert "Coishco" in set(fusionado["distrito"]), fusionado
        assert informe_fusion["rellenados"] == {
            "celular": 1,
            "correo_electronico": 1,
        }, informe_fusion
        assert informe_fusion["sin_par"] == [], informe_fusion
        # La marca es opcional: sin ella el distrito conserva su nombre original
        sin_marca, _informe = fusionar_provinciales(base_fusion, marca="")
        assert set(sin_marca["distrito"]) == {"Chimbote", "Coishco"}, sin_marca

        # Lo que trae el Word no se sobrescribe; el valor descartado queda en el informe
        base_con_contacto = base_fusion.copy()
        base_con_contacto.at[0, "celular"] = "900111222"
        con_contacto, informe_contacto = fusionar_provinciales(base_con_contacto)
        assert con_contacto.iloc[0]["celular"] == "900111222", con_contacto
        assert informe_contacto["rellenados"]["celular"] == 0, informe_contacto
        detalle_contacto = informe_contacto["detalle"][0]
        assert detalle_contacto["celular_provincial"] == "911111111", detalle_contacto
        assert detalle_contacto["celular_conservado"] == "900111222", detalle_contacto

        # Provincial que no está en ningún distrito: no se fusiona y se informa
        base_sin_par = pd.DataFrame(
            [
                ["Chimbote", "Santa", "WALTER SOTO CAMPOS", "", ""],
                [TAG_PROVINCIAL, "Santa", "OTRA PERSONA", "922222222", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        intacto, informe_sin_par = fusionar_provinciales(base_sin_par)
        assert informe_sin_par["fusionadas"] == 0, informe_sin_par
        assert len(intacto) == 2, intacto
        assert len(informe_sin_par["sin_par"]) == 1, informe_sin_par
        assert informe_sin_par["sin_par"][0]["motivo"] == "sin coincidencia", (
            informe_sin_par
        )

        # Nombres y apellidos: solo se parte cuando hay cuatro sustantivos
        fila_zorritos = df[df["distrito"] == "Zorritos"].iloc[0]
        assert fila_zorritos["nombres"] == "CARLOS ALBERTO", fila_zorritos["nombres"]
        assert fila_zorritos["apellidos"] == "VEGA DÍAZ", fila_zorritos["apellidos"]
        assert fila_juan["nombres"] == "JUAN PÉREZ GÓMEZ", fila_juan["nombres"]
        assert fila_juan["apellidos"] == "", fila_juan["apellidos"]

        # Separación de nombres: cuatro sustantivos se parten, los conectores no cuentan
        base_nombres = pd.DataFrame(
            [
                ["A", "P", "WALTER JESÚS SOTO CAMPOS", "", ""],
                ["B", "P", "MARÍA DE LOS ÁNGELES RUIZ", "", ""],
                ["C", "P", "", "", ""],
                ["D", "P", "JUAN DE DIOS PÉREZ GÓMEZ", "", ""],
                ["E", "P", "CÉSAR ALBERTO DE LA CRUZ JAVE", "", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        partido, reparto = separar_nombres(base_nombres)
        assert list(partido.columns) == [
            "distrito",
            "provincia",
            "nombre",
            "nombres",
            "apellidos",
            "celular",
            "correo_electronico",
        ], list(partido.columns)
        assert partido.iloc[0]["nombres"] == "WALTER JESÚS", partido.iloc[0]
        assert partido.iloc[0]["apellidos"] == "SOTO CAMPOS", partido.iloc[0]
        assert partido.iloc[1]["nombres"] == "MARÍA DE LOS ÁNGELES RUIZ", partido.iloc[
            1
        ]
        assert partido.iloc[1]["apellidos"] == "", partido.iloc[1]
        assert partido.iloc[2]["nombres"] == "" and partido.iloc[2]["apellidos"] == ""
        # Los conectores se conservan en el lado que les toca
        assert partido.iloc[3]["nombres"] == "JUAN DE DIOS", partido.iloc[3]
        assert partido.iloc[3]["apellidos"] == "PÉREZ GÓMEZ", partido.iloc[3]
        assert partido.iloc[4]["nombres"] == "CÉSAR ALBERTO", partido.iloc[4]
        assert partido.iloc[4]["apellidos"] == "DE LA CRUZ JAVE", partido.iloc[4]
        assert reparto[1]["sustantivos"] == 3, reparto[1]
        assert reparto[1]["con_conectores"], reparto[1]

        # Ubigeo: el distrito que falta se agrega vacío; la variante no se duplica
        ruta_ubigeo = carpeta / "ubigeo.csv"
        ruta_ubigeo.write_text(
            "Ubigeo,Distrito,Provincia,Departamento,Poblacion,Superficie,Y,X\n"
            "020101,Huaraz,Huaraz,Ancash,1,1,0,0\n"
            "020109,Pampas Grande,Huaraz,Ancash,1,1,0,0\n"
            "020201,Chiquián,Bolognesi,Ancash,1,1,0,0\n"
            "020202,San Miguel de Corpanqui,Bolognesi,Ancash,1,1,0,0\n"
            "150101,Lima,Lima,Lima,1,1,0,0\n",
            encoding="utf-8",
        )
        ubigeo = leer_ubigeo(ruta_ubigeo, "ancash")
        assert len(ubigeo) == 4, ubigeo
        base_ubigeo = pd.DataFrame(
            [
                ["Pampas Grande", "Huaraz", "UNO", "1", ""],
                ["Corpanqui", "Bolognesi", "DOS", "2", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        con_ubigeo, informe_ubigeo = completar_con_ubigeo(base_ubigeo, ubigeo)
        assert len(con_ubigeo) == 4, con_ubigeo
        assert informe_ubigeo["coincidencias_por_nombre"] == 1, informe_ubigeo
        assert not informe_ubigeo["no_reconocidos"], informe_ubigeo
        agregados = {f["distrito_ubigeo"] for f in informe_ubigeo["agregados"]}
        assert agregados == {"Huaraz", "Chiquián"}, informe_ubigeo["agregados"]
        fila_chiquian = con_ubigeo[con_ubigeo["distrito"] == "Chiquián"].iloc[0]
        assert fila_chiquian["provincia"] == "Bolognesi", fila_chiquian
        assert es_vacio(fila_chiquian["nombre"]), fila_chiquian

        # 'Chimbote' no se queda con la fila de 'Nuevo Chimbote': el emparejamiento
        # por nombre exacto reserva la fila y el distrito que falta se agrega vacío.
        ubigeo_santa = pd.DataFrame(
            [
                ["021301", "Chimbote", "Santa", "Ancash"],
                ["021309", "Nuevo Chimbote", "Santa", "Ancash"],
            ],
            columns=["ubigeo", "distrito", "provincia", "departamento"],
        )
        solo_nuevo = pd.DataFrame(
            [["Nuevo Chimbote", "Santa", "UNO", "1", ""]],
            columns=COLUMNAS_FINALES,
        )
        con_santa, informe_santa = completar_con_ubigeo(solo_nuevo, ubigeo_santa)
        assert len(con_santa) == 2, con_santa
        assert {f["distrito_ubigeo"] for f in informe_santa["agregados"]} == {
            "Chimbote"
        }, informe_santa["agregados"]
        assert con_santa.iloc[0]["nombre"] == "UNO", con_santa
        assert es_vacio(con_santa.iloc[1]["nombre"]), con_santa

        # --departamento recorta TODAS las entradas: lo de otro departamento se va
        mezcla = pd.DataFrame(
            [
                ["Huaraz", "Huaraz", "UNO", "1", ""],
                ["Talara", "Piura", "DOS", "2", ""],
                [TAG_PROVINCIAL, "Piura", "TRES", "3", ""],
                ["Zorritos", "Tumbes", "CUATRO", "4", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        dentro, informe_dep = restringir_al_departamento(mezcla, ubigeo)
        assert len(dentro) == 1, dentro
        assert dentro.iloc[0]["distrito"] == "Huaraz", dentro
        assert len(informe_dep["descartadas"]) == 3, informe_dep
        assert {d["motivo"] for d in informe_dep["descartadas"]} == {
            "provincia fuera del departamento"
        }, informe_dep

        # Los nombres de la salida salen del ubigeo, no de lo que escriba el archivo
        variantes = pd.DataFrame(
            [
                ["Corpanqui", "Bolognesi", "UNO", "1", ""],
                ["corpanqui ", "bolognesi", "DOS", "2", ""],
                ["Pampas", "Huaraz", "TRES", "3", ""],
                ["Bolognesi", "Bolognesi", "CUATRO", "4", ""],
                ["Chavin", "Huaraz", "CINCO", "5", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        canonicos, informe_canonico = canonizar_ubigeo(variantes, ubigeo)
        assert canonicos.iloc[0]["distrito"] == "San Miguel de Corpanqui", canonicos
        assert canonicos.iloc[1]["distrito"] == "San Miguel de Corpanqui", canonicos
        assert canonicos.iloc[1]["provincia"] == "Bolognesi", canonicos
        assert canonicos.iloc[2]["distrito"] == "Pampas Grande", canonicos
        # Un distrito que repite el nombre de la provincia no existe: es provincial
        assert canonicos.iloc[3]["distrito"] == TAG_PROVINCIAL, canonicos
        # Lo que no está en el ubigeo no se inventa: se deja y se informa
        assert canonicos.iloc[4]["distrito"] == "Chavin", canonicos
        assert canonicos.iloc[4]["provincia"] == "Huaraz", canonicos
        motivos = {ajuste["motivo"] for ajuste in informe_canonico}
        assert "distrito fuera del ubigeo" in motivos, informe_canonico
        assert "provincial mal rotulada" in motivos, informe_canonico

        # Un número por columna; el fragmento suelto se descarta y se informa
        telefonos = pd.DataFrame(
            [
                ["A", "P", "UNO", "939709157 / 954499566", ""],
                ["B", "P", "DOS", "930341391/9", ""],
                ["C", "P", "TRES", "", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        repartidos, informe_celulares = separar_celulares(telefonos)
        assert repartidos.iloc[0]["celular"] == "939709157", repartidos
        assert repartidos.iloc[0]["celular_2"] == "954499566", repartidos
        assert repartidos.iloc[1]["celular"] == "930341391", repartidos
        assert repartidos.iloc[1]["celular_2"] == "", repartidos
        assert repartidos.iloc[2]["celular"] == "", repartidos
        assert repartidos.iloc[2]["celular_2"] == "", repartidos
        assert any(fila["descartado"] == "9" for fila in informe_celulares), (
            informe_celulares
        )

        # La exportación también se verifica: hojas y columnas
        ruta_salida = carpeta / "salida.xlsx"
        extras_salida = {"fusiones": informe_fusion["detalle"]}
        escribir(df, ruta_salida, diagnostico, no_cruzados, extras=extras_salida)
        libro = pd.read_excel(ruta_salida, sheet_name=None)
        assert {HOJA_SALIENTES, "diagnostico", "fusiones"} <= set(libro), list(libro)
        assert list(libro[HOJA_SALIENTES].columns) == COLUMNAS_VISIBLES, list(
            libro[HOJA_SALIENTES].columns
        )
        assert len(libro[HOJA_SALIENTES]) == len(df), (
            len(libro[HOJA_SALIENTES]),
            len(df),
        )

        # La hoja diagnostico lleva fórmulas vivas sobre la hoja alcaldes
        crudo = load_workbook(ruta_salida)
        formulas = [
            celda.value
            for fila_celdas in crudo["diagnostico"].iter_rows()
            for celda in fila_celdas
            if isinstance(celda.value, str) and celda.value.startswith("=")
        ]
        assert any("COUNTA('" in f for f in formulas), formulas[:5]
        assert any("'!$A$2:$A$" in f for f in formulas), formulas[:5]
        assert any(f"{_hoja_formula(HOJA_SALIENTES)}!" in f for f in formulas), (
            formulas[:5]
        )
        assert any("COUNTIF(" in f for f in formulas), formulas[:5]
        assert any("COUNTIFS(" in f for f in formulas), formulas[:5]
        assert len(formulas) >= len(df["provincia"].unique()) + 3, len(formulas)
        assert not any("{" in f for f in formulas), [f for f in formulas if "{" in f]

        # Documento con la provincia anunciada en una línea con texto y años alrededor,
        # y distritos rotulados: la lectura debe ser la misma.
        doc2 = Document()
        doc2.add_paragraph("MUNICIPALIDAD PROVINCIAL DE SECHURA")
        doc2.add_paragraph(
            "ALCALDES DISTRITALES DE LA PROVINCIA DE SECHURA 2027 - 2030"
        )
        tabla3 = doc2.add_table(rows=1, cols=2)
        for celda, texto in zip(tabla3.rows[0].cells, ["DISTRITO", "ALCALDE"]):
            celda.text = texto
        for distrito, alcalde in [
            ("DISTRITO DE BELLAVISTA DE LA UNION", "PEDRO SANCHEZ VEGA"),
            ("VICE", "ANA TORRES RIVAS"),
        ]:
            fila = tabla3.add_row()
            for celda, texto in zip(fila.cells, [distrito, alcalde]):
                celda.text = texto
        ruta_docx2 = carpeta / "otro.docx"
        doc2.save(ruta_docx2)

        df2, diagnostico2 = leer_docx(ruta_docx2)
        assert len(df2) == 2, df2
        assert len(diagnostico2) == 1, diagnostico2
        assert set(df2["provincia"]) == {"Sechura"}, df2
        assert [d.lower() for d in df2["distrito"]] == [
            "bellavista de la union",
            "vice",
        ], df2

        # Los archivos se reparten por extensión, sin importar el orden recibido
        assert _repartir_archivos(ruta_excel, ruta_docx) == (ruta_docx, ruta_excel)
        assert _repartir_archivos(ruta_docx, None) == (ruta_docx, None)
        assert _repartir_archivos(None, ruta_excel) == (None, ruta_excel)

        # Mapa de topónimos: corrección global, por provincia y limpieza de la etiqueta
        mapa = Toponimos(
            provincias={"Bolgnesi": "Bolognesi", "Chimbote": "Santa"},
            distritos={
                "Pallasca": {"Boognesi": "Bolognesi"},
                "Huarmey": {"Huayllan": "Huayán"},
                "Pomabamba": {"Huayllan": "Huayllán"},
            },
            equivalencias={"Santa": "Chimbote"},
        )
        assert mapa.corregir_provincia("BOLGNESI") == "Bolognesi"
        assert mapa.corregir_provincia("Huarmey") == "Huarmey"
        assert mapa.corregir_distrito("Boognesi", "pallasca") == "Bolognesi"
        assert mapa.corregir_distrito("Huayllan", "Huarmey") == "Huayán"
        assert mapa.corregir_distrito("Huayllan", "Pomabamba") == "Huayllán"
        assert mapa.corregir_distrito("Huayllan", "Huaylas") == "Huayllan"
        assert mapa.corregir_distrito(TAG_PROVINCIAL, "Pallasca") == TAG_PROVINCIAL
        assert not Toponimos()

        # El JSON que acompaña al script debe cargarse y tener las correcciones reales
        reales = cargar_toponimos(avisar=False)
        assert reales, "toponimos.json no se cargó"
        assert reales.corregir_provincia("Chimbote") == "Santa"
        assert (
            reales.corregir_provincia("Mariscal de Luzuriaga") == "Mariscal Luzuriaga"
        )
        assert reales.corregir_distrito("Conchudos", "Pallasca") == "Conchucos"
        assert reales.corregir_distrito("Huayllan", "Huarmey") == "Huayán"

        # Corrección de punta a punta con el mapa real: el Word rotula "CHIMBOTE" y
        # la salida debe usar el nombre oficial de la provincia, "Santa".
        doc3 = Document()
        doc3.add_paragraph("PROVINCIA DE CHIMBOTE")
        tabla4 = doc3.add_table(rows=1, cols=3)
        for celda, texto in zip(
            tabla4.rows[0].cells, ["DISTRITO", "ALCALDE", "CELULAR"]
        ):
            celda.text = texto
        for distrito, alcalde, celular in [
            ("COISCO", "WALTER SOTO CAMPOS", "912345678"),
            ("CACERES DEL PERU", "ANA RIVAS PONCE", ""),
        ]:
            fila = tabla4.add_row()
            for celda, texto in zip(fila.cells, [distrito, alcalde, celular]):
                celda.text = texto
        ruta_docx3 = carpeta / "chimbote.docx"
        doc3.save(ruta_docx3)

        df3, _diag3 = leer_docx(ruta_docx3)
        assert set(df3["provincia"]) == {"Santa"}, df3
        assert set(df3["distrito"]) == {"Coishco", "Cáceres del Perú"}, df3

        # Similitud: tolera erratas y transposiciones sin confundir provincias
        assert _similitud("BOLOGNESI", "BOLOGNESI") == 1.0
        assert _similitud("BOLGNESI", "BOLOGNESI") >= 0.9, _similitud(
            "BOLGNESI", "BOLOGNESI"
        )
        assert _similitud("BOOGNESI", "BOLOGNESI") >= 0.85, _similitud(
            "BOOGNESI", "BOLOGNESI"
        )
        assert _similitud("ANTONIO RAYMONDI", "ANTONIO RAIMONDI") >= 0.9
        assert _similitud("HUARAZ", "HUARI") < 0.9, _similitud("HUARAZ", "HUARI")
        assert _similitud("MARISCAL LUZURIAGA", "LUZURIAGA MARISCAL") >= 0.9

        # Directorio de la gestión vigente: nombre partido, dos celulares en uno y
        # direcciones. Trae lo que en el libro es la hoja de salientes.
        ruta_dir = carpeta / "directorio.csv"
        ruta_dir.write_text(
            "DEPARTAMENTO,PROVINCIA,DISTRITO,CARGO,DNI,NOMBRES,APELLIDO_PATERNO,"
            "APELLIDO_MATERNO,CELULAR_1,CELULAR_2,CORREO_ELECTRONICO,DIRECCION\n"
            "ÁNCASH,HUARAZ,,ALCALDE PROVINCIAL,1,JUAN DE DIOS,PEREZ,GOMEZ,"
            "999 888 777,999 888 666,JUAN@EJEMPLO.PE,Av. Siempre Viva N° 100\n"
            "ÁNCASH,BOLOGNESI,CHIQUIA,ALCALDE DISTRITAL,2,ANA,MARIA,,"
            "944 111 222,,ana@ejemplo.pe,Plaza de Armas S/N\n"
            "ÁNCASH,BOLOGNESI,SAN MIGUEL DE CORPANQUI,ALCALDE DISTRITAL,4,LUIS,QUISPE,,"
            ",,luis@ejemplo.pe,Jr. Bolognesi N° 22\n"
            "APURÍMAC,ANDAHUAYLAS,,ALCALDE PROVINCIAL,3,OTRO,CASO,,,,\n",
            encoding="utf-8",
        )
        directorio, informe_e = leer_directorio(
            ruta_dir, departamento="ancash", ruta_ubigeo=ruta_ubigeo
        )
        assert len(directorio) == 3, directorio  # solo el departamento pedido
        assert list(directorio.columns) == COLUMNAS_DIRECTORIO, list(directorio.columns)
        assert COLUMNA_REELECCION not in directorio.columns, list(directorio.columns)
        provincial_e = directorio[directorio["distrito"] == TAG_PROVINCIAL].iloc[0]
        assert provincial_e["nombre"] == "Juan de Dios Perez Gomez", provincial_e
        assert provincial_e["apellidos"] == "Perez Gomez", provincial_e
        assert provincial_e["celular"] == "999888777", provincial_e
        assert provincial_e["celular_2"] == "999888666", provincial_e
        assert provincial_e["correo_electronico"] == "juan@ejemplo.pe", provincial_e
        distrital_e = directorio[directorio["distrito"] == "Chiquián"].iloc[0]
        assert distrital_e["provincia"] == "Bolognesi", distrital_e
        assert distrital_e["apellidos"] == "Maria", distrital_e
        assert informe_e["ajustados"], informe_e

        # Regresión del ubigeo: los códigos del ubigeo de referencia no siempre son
        # los oficiales (Coris en 020203, Huacllán en 020205). Como el nombre manda,
        # la fila de Huacllán no puede terminar como Coris ni repetir municipio.
        ruta_ubigeo_falso = carpeta / "ubigeo_falso.csv"
        ruta_ubigeo_falso.write_text(
            "Ubigeo,Distrito,Provincia,Departamento\n"
            "020201,Aija,Aija,Ancash\n"
            "020203,Coris,Aija,Ancash\n"
            "020205,Huacllan,Aija,Ancash\n",
            encoding="utf-8",
        )
        ruta_dir_codigos = carpeta / "directorio_codigos.csv"
        ruta_dir_codigos.write_text(
            "UBIGEO,DEPARTAMENTO,PROVINCIA,DISTRITO,CARGO,"
            "NOMBRES Y APELLIDOS DEL ALCALDE\n"
            "020202,ANCASH,AIJA,CORIS,ALCALDE DISTRITAL,LUIS BARBA MAGUINA\n"
            "020203,ANCASH,AIJA,HUACLLAN,ALCALDE DISTRITAL,JESUS BARRETO ESPINOZA\n",
            encoding="utf-8",
        )
        con_codigos, informe_codigos = leer_directorio(
            ruta_dir_codigos, departamento="ancash", ruta_ubigeo=ruta_ubigeo_falso
        )
        assert sorted(map(clave, con_codigos["distrito"])) == [
            "CORIS",
            "HUACLLAN",
        ], con_codigos
        assert con_codigos[["provincia", "distrito"]].drop_duplicates().shape[0] == 2, (
            con_codigos
        )
        assert {
            (clave(c["distrito"]), c["ubigeo_origen"], c["ubigeo"])
            for c in informe_codigos["corregidos"]
        } == {
            ("CORIS", "020202", "020203"),
            ("HUACLLAN", "020203", "020205"),
        }, informe_codigos["corregidos"]

        # La capital de provincia no sale del código del directorio: se resuelve por
        # nombre contra el geodir y el código que se escribe es el del geodir. Aquí el
        # directorio trae un código corrido (021401, que en el geodir no es Santa).
        ruta_ubigeo_santa = carpeta / "ubigeo_santa.csv"
        ruta_ubigeo_santa.write_text(
            "Ubigeo,Distrito,Provincia,Departamento\n"
            "021301,Chimbote,Santa,Ancash\n"
            "021307,Santa,Santa,Ancash\n",
            encoding="utf-8",
        )
        ruta_dir_capital = carpeta / "directorio_capital.csv"
        ruta_dir_capital.write_text(
            "UBIGEO,DEPARTAMENTO,PROVINCIA,DISTRITO,CARGO,"
            "NOMBRES Y APELLIDOS DEL ALCALDE\n"
            "021401,ANCASH,SANTA,CHIMBOTE,ALCALDE PROVINCIAL,"
            "WALTER JESUS SOTO CAMPOS\n",
            encoding="utf-8",
        )
        gestion_capital, informe_capital = leer_directorio(
            ruta_dir_capital, departamento="ancash", ruta_ubigeo=ruta_ubigeo_santa
        )
        assert informe_capital["capitales"][clave("SANTA")] == "021301", (
            informe_capital["capitales"]
        )
        assert informe_capital["capitales_detalle"] == [
            {
                "provincia": "Santa",
                "distrito": "Chimbote",
                "ubigeo": "021301",
                "motivo": "por nombre",
            }
        ], informe_capital["capitales_detalle"]
        assert gestion_capital.iloc[0]["distrito"] == TAG_PROVINCIAL, gestion_capital
        assert {
            (c["distrito"], c["ubigeo_origen"], c["ubigeo"])
            for c in informe_capital["corregidos"]
        } == {("Chimbote", "021401", "021301")}, informe_capital["corregidos"]

        # Las dos hojas tienen que hablar de los mismos municipios
        alineado = verificar_alineacion(
            pd.DataFrame(
                {"provincia": ["Aija", "Aija"], "distrito": ["Coris", "Aija"]}
            ),
            con_codigos,
        )
        assert alineado["entrantes"] == 2, alineado
        assert len(alineado["solo_entrantes"]) == 1, alineado
        assert not alineado["repetidos"], alineado

        # La columna ubigeo (--con-ubigeo) usa la llave del CSV de RENIEC y deja
        # vacío lo que no conoce, en vez de inventar un código. Las filas PROVINCIAL
        # no son un distrito del geodir, así que tampoco llevan código.
        marco = pd.DataFrame(
            {"provincia": ["Aija", "Aija"], "distrito": ["Coris", TAG_PROVINCIAL]}
        )
        marcado = _con_ubigeo(marco, {("AIJA", "CORIS"): "020203"})
        assert list(marcado.columns) == [COLUMNA_UBIGEO, "provincia", "distrito"]
        assert list(marcado[COLUMNA_UBIGEO]) == ["020203", ""], marcado
        assert list(_con_ubigeo(marco, {})[COLUMNA_UBIGEO]) == ["", ""]

        # La dirección de la municipalidad se comparte con la hoja de salientes
        base_dir = pd.DataFrame(
            [
                ["Chiquián", "Bolognesi", "ALGUIEN", "1", ""],
                [TAG_PROVINCIAL, "Huaraz", "OTRO", "2", ""],
                ["Corpanqui", "Bolognesi", "TERCERO", "", ""],
                ["Huaraz", "Huaraz", "CUARTO", "", ""],
                ["Huari", "Huari", "QUINTO", "", ""],
            ],
            columns=COLUMNAS_FINALES,
        )
        con_dir, informe_dir = aplicar_direcciones(base_dir, directorio, ubigeo=ubigeo)
        assert list(con_dir.columns) == COLUMNAS_FINALES + [COLUMNA_DIRECCION]
        assert con_dir.iloc[0][COLUMNA_DIRECCION] == "Plaza de Armas S/N", con_dir
        assert con_dir.iloc[1][COLUMNA_DIRECCION] == "Av. Siempre Viva N° 100", con_dir
        # 'Corpanqui' se reconoce dentro de 'San Miguel de Corpanqui'
        assert con_dir.iloc[2][COLUMNA_DIRECCION] == "Jr. Bolognesi N° 22", con_dir
        # Huaraz es la capital de Huaraz en el ubigeo de prueba: usa la provincial
        assert con_dir.iloc[3][COLUMNA_DIRECCION] == "Av. Siempre Viva N° 100", con_dir
        # Sin coincidencia ni capitalidad, no se inventa una dirección
        assert es_vacio(con_dir.iloc[4][COLUMNA_DIRECCION]), con_dir
        assert informe_dir["con_direccion"] == 4, informe_dir

        # Nombre de hoja configurable, y las dos hojas en el mismo libro
        assert _validar_hoja(HOJA_SALIENTES) == HOJA_SALIENTES
        for malo in ("", "a" * 32, "Hoja[1]"):
            try:
                _validar_hoja(malo)
            except SystemExit:
                continue
            raise AssertionError(f"se aceptó como hoja {malo!r}")

        # Las dos hojas en el mismo libro, con el reparto del pipeline: el directorio
        # en «SALIENTES» y los elegidos (con dirección y marca de reelección) en
        # «ENTRANTES».
        ruta_dos = carpeta / "dos_hojas.xlsx"
        elegidos_dir, _ = aplicar_direcciones(df, directorio, ubigeo=ubigeo)
        elegidos, _ = marcar_reelegidos(directorio, elegidos_dir)
        escribir(directorio, ruta_dos, diagnostico, [], entrantes=elegidos)
        dos = pd.read_excel(ruta_dos, sheet_name=None)
        assert {HOJA_SALIENTES, HOJA_ENTRANTES, "diagnostico"} <= set(dos), list(dos)
        assert len(dos[HOJA_SALIENTES]) == 3, dos[HOJA_SALIENTES]
        assert list(dos[HOJA_SALIENTES].columns) == COLUMNAS_VISIBLES + [
            COLUMNA_DIRECCION
        ], list(dos[HOJA_SALIENTES].columns)
        assert len(dos[HOJA_ENTRANTES]) == len(df), dos[HOJA_ENTRANTES]
        assert list(dos[HOJA_ENTRANTES].columns) == COLUMNAS_VISIBLES_ELEGIDOS, list(
            dos[HOJA_ENTRANTES].columns
        )

        # Ninguna fórmula puede quedar como plantilla sin formatear
        crudo_dos = load_workbook(ruta_dos)
        celdas_diag = [
            celda.value
            for fila_celdas in crudo_dos["diagnostico"].iter_rows()
            for celda in fila_celdas
            if isinstance(celda.value, str)
        ]
        assert not any("{" in valor for valor in celdas_diag), [
            valor for valor in celdas_diag if "{" in valor
        ]

        # Reparto de las hojas de punta a punta: el directorio (gestión vigente) va a
        # «SALIENTES - En gestión» y el Word 2027-2030 (elegidos) a «ENTRANTES -
        # Elegidos», cada uno con su propia gente. Se ejecuta `main` de verdad.
        doc4 = Document()
        doc4.add_paragraph("PROVINCIA DE HUARAZ")
        tabla5 = doc4.add_table(rows=1, cols=3)
        for celda, texto in zip(
            tabla5.rows[0].cells, ["DISTRITO", "ALCALDE", "CELULAR"]
        ):
            celda.text = texto
        for distrito, alcalde, celular in [
            ("HUARAZ", "JABICO ROBLES BLACIDO", "910000001"),
            ("PAMPAS GRANDE", "ELECTA PAMPAS VEGA", "910000002"),
        ]:
            fila = tabla5.add_row()
            for celda, texto in zip(fila.cells, [distrito, alcalde, celular]):
                celda.text = texto
        ruta_docx4 = carpeta / "electos.docx"
        doc4.save(ruta_docx4)

        ruta_dir4 = carpeta / "gestion.csv"
        ruta_dir4.write_text(
            "UBIGEO,DEPARTAMENTO,PROVINCIA,DISTRITO,CARGO,NOMBRES,APELLIDO_PATERNO,"
            "APELLIDO_MATERNO,CELULAR_1,CELULAR_2,CORREO_ELECTRONICO,DIRECCION\n"
            "020101,ÁNCASH,HUARAZ,,ALCALDE PROVINCIAL,DAVID MANUEL,ROSALES,TINOCO,"
            "956 981 202,,alcaldia@munihuaraz.gob.pe,Av. Luzuriaga N° 734\n",
            encoding="utf-8",
        )
        ruta_orden = carpeta / "orden_hojas.xlsx"
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            codigo = main(
                [
                    "--docx",
                    str(ruta_docx4),
                    "--directorio",
                    str(ruta_dir4),
                    "--departamento",
                    "ancash",
                    "--ubigeo",
                    str(ruta_ubigeo),
                    "--con-ubigeo",
                    "--salida",
                    str(ruta_orden),
                ]
            )
        assert codigo == 0, codigo
        orden = pd.read_excel(ruta_orden, sheet_name=None, dtype={COLUMNA_UBIGEO: str})
        assert {HOJA_SALIENTES, HOJA_ENTRANTES} <= set(orden), list(orden)
        de_gestion = orden[HOJA_SALIENTES]
        de_electos = orden[HOJA_ENTRANTES]
        # El directorio es la base de la hoja de salientes y el índice del ubigeo
        # manda: una fila por distrito del departamento, más la PROVINCIAL. El
        # distrito capital no viene en el directorio, así que entra vacío.
        assert len(de_gestion) == 1 + 4, de_gestion
        provincial = de_gestion[de_gestion["distrito"] == TAG_PROVINCIAL]
        assert len(provincial) == 1, de_gestion
        nombre_gestion = clave(
            " ".join(str(provincial.iloc[0][c]) for c in ("nombres", "apellidos"))
        )
        assert "ROSALES" in nombre_gestion, de_gestion
        capital = de_gestion[
            (de_gestion["distrito"] == "Huaraz") & (de_gestion["provincia"] == "Huaraz")
        ]
        assert len(capital) == 1, de_gestion
        for columna in ("nombres", "apellidos", "celular", "correo_electronico"):
            assert es_vacio(capital.iloc[0][columna]), de_gestion
        # Los elegidos son el Word 2027-2030 y trae a su propia gente, con la marca
        # de reelección y sin la columna en la hoja de gestión.
        nombres_electos = clave(
            " ".join(
                de_electos[c].fillna("").astype(str).str.cat(sep=" ")
                for c in ("nombres", "apellidos")
            )
        )
        assert "ROBLES" in nombres_electos, de_electos
        assert "ROSALES" not in nombres_electos, de_electos
        assert COLUMNA_REELECCION in de_electos.columns, list(de_electos.columns)
        assert COLUMNA_REELECCION not in de_gestion.columns, list(de_gestion.columns)
        # La dirección es la misma en las dos hojas y el código lo lleva el distrito
        # capital. La fila PROVINCIAL no es un distrito del geodir: va sin código.
        direccion_gestion = provincial.iloc[0][COLUMNA_DIRECCION]
        fila_huaraz = de_electos[de_electos["distrito"] == "Huaraz"].iloc[0]
        assert fila_huaraz[COLUMNA_DIRECCION] == direccion_gestion, de_electos
        # La sede provincial es la misma del distrito capital: la dirección se hereda.
        assert capital.iloc[0][COLUMNA_DIRECCION] == direccion_gestion, de_gestion
        assert es_vacio(provincial.iloc[0][COLUMNA_UBIGEO]), de_gestion
        # En los elegidos no hay fila PROVINCIAL (el Word no la trae); si la hubiera,
        # iría sin código igual. Todo distrito lleva su código del geodir.
        for marco in (de_gestion, de_electos):
            distritos = marco[marco["distrito"] != TAG_PROVINCIAL]
            assert not distritos[COLUMNA_UBIGEO].map(es_vacio).any(), marco
            provinciales = marco[marco["distrito"] == TAG_PROVINCIAL]
            assert provinciales[COLUMNA_UBIGEO].map(es_vacio).all(), marco
        codigo_huaraz = "020101"
        assert fila_huaraz[COLUMNA_UBIGEO] == codigo_huaraz, de_electos
        assert capital.iloc[0][COLUMNA_UBIGEO] == codigo_huaraz, de_gestion
        # Las dos hojas tienen los mismos municipios: el ubigeo es la única llave.
        pares_gestion = {
            (clave(p), clave(d))
            for p, d in zip(de_gestion["provincia"], de_gestion["distrito"])
            if clave(d) != clave(TAG_PROVINCIAL)
        }
        pares_electos = {
            (clave(p), clave(d))
            for p, d in zip(de_electos["provincia"], de_electos["distrito"])
            if clave(d) != clave(TAG_PROVINCIAL)
        }
        assert pares_electos == pares_gestion, pares_electos ^ pares_gestion

        print(
            "Autoprueba OK: provincia inferida (también en líneas con texto y años), "
            "cruce por distrito antes que por nombre, relleno sin sobrescribir, "
            "provinciales y distritos nuevos agregados, archivos repartidos por extensión, "
            "nombres partidos 2+2, distritos faltantes del ubigeo agregados vacíos, "
            "tabla de faltantes con fórmulas vivas, directorio en la hoja de salientes, "
            "Word 2027-2030 en la de elegidos, dirección y código del distrito capital "
            "compartidos (PROVINCIAL sin ubigeo), "
            "gestión completada con el índice del ubigeo."
        )
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _lista_columnas(texto: str | None) -> list[str] | None:
    if not texto:
        return None
    return [c.strip() for c in texto.split(",") if c.strip()]


_CARACTERES_INVALIDOS_HOJA = set(":/\\?*[]")


def _validar_hoja(nombre: str) -> str:
    """Comprueba que el nombre sirva como hoja de Excel."""
    texto = limpiar(nombre)
    if not texto:
        raise SystemExit("El nombre de la hoja no puede estar vacío.")
    if len(texto) > 31:
        raise SystemExit(
            f"El nombre de hoja «{texto}» pasa de los 31 caracteres que admite Excel."
        )
    invalidos = sorted(set(texto) & _CARACTERES_INVALIDOS_HOJA)
    if invalidos:
        raise SystemExit(
            f"El nombre de hoja «{texto}» no puede llevar " + ", ".join(invalidos)
        )
    return texto


_SUFIJOS_DOCX = {".docx", ".docm", ".doc"}
_SUFIJOS_EXCEL = {".xlsx", ".xlsm", ".xls", ".csv"}


def _tipo_archivo(ruta) -> str | None:
    sufijo = Path(ruta).suffix.lower()
    if sufijo in _SUFIJOS_DOCX:
        return "docx"
    if sufijo in _SUFIJOS_EXCEL:
        return "excel"
    return None


def _repartir_archivos(archivo1, archivo2) -> tuple[Path | None, Path | None]:
    """Asigna cada archivo a su lector por extensión, sin importar el orden."""
    rutas = [Path(r) for r in (archivo1, archivo2) if r]
    tipos = [_tipo_archivo(r) for r in rutas]
    desconocidos = [str(r) for r, t in zip(rutas, tipos) if t is None]
    if desconocidos:
        raise SystemExit(
            "No se reconoce el tipo de: "
            + ", ".join(desconocidos)
            + " (se espera .docx/.doc y .xlsx/.xls/.csv)"
        )
    if len(rutas) == 2 and tipos[0] == tipos[1]:
        raise SystemExit(
            "Los dos archivos son del mismo tipo ("
            + tipos[0]
            + "): se espera un Word y un Excel de contactos."
        )
    docx = next((r for r, t in zip(rutas, tipos) if t == "docx"), None)
    excel = next((r for r, t in zip(rutas, tipos) if t == "excel"), None)
    return docx, excel


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convierte un Word de alcaldes (texto-tabla-texto-tabla) y un Excel "
        "de contactos en un único DataFrame.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--archivo1",
        "--docx",
        dest="docx",
        type=Path,
        metavar="RUTA",
        help="Archivo 1: Word (.docx) con el texto y las tablas de alcaldes",
    )
    parser.add_argument(
        "--archivo2",
        "--excel",
        dest="excel",
        type=Path,
        metavar="RUTA",
        help="Archivo 2: Excel (.xlsx) con los contactos que faltan",
    )
    parser.add_argument(
        "--salida",
        type=Path,
        default=Path("alcaldes.xlsx"),
        help="Archivo de salida (.xlsx escribe hojas de diagnóstico; otro formato: CSV)",
    )
    parser.add_argument(
        "--hoja", help="Hoja del Excel (nombre o índice); por defecto la primera"
    )
    parser.add_argument(
        "--fila-encabezado",
        type=int,
        default=None,
        help="Fila del encabezado en el Excel (base 0), si la detección falla",
    )
    parser.add_argument(
        "--columnas",
        default=None,
        help="Plantilla para tablas sin encabezado, p. ej. "
        "'distrito,nombre,celular,correo_electronico'",
    )
    parser.add_argument(
        "--provincia",
        default=None,
        help="Provincia inicial si el Word no la declara antes de la primera tabla",
    )
    parser.add_argument(
        "--etiqueta-faltantes",
        default=TAG_PROVINCIAL,
        help=f"Etiqueta en `distrito` para los que solo están en el Excel "
        f"(por defecto {TAG_PROVINCIAL})",
    )
    parser.add_argument(
        "--sin-agregar",
        action="store_true",
        help="No agrega filas nuevas del Excel: solo rellena celdas vacías",
    )
    parser.add_argument(
        "--solo-confirmados",
        action="store_true",
        help="Usa solo las filas del Excel con CONFIRMADO verdadero",
    )
    parser.add_argument(
        "--fusionar-provinciales",
        action="store_true",
        help="Une la fila PROVINCIAL del Excel con la fila del distrito capital "
        "(mismo nombre) y conserva el contacto que falte",
    )
    parser.add_argument(
        "--marca-fusion",
        default="(PROVINCIAL)",
        help="Marca que se agrega al distrito fusionado, p. ej. 'Chimbote (PROVINCIAL)'; "
        'usa "" para no marcarlo',
    )
    parser.add_argument(
        "--departamento",
        default=None,
        help="Recorta la salida al departamento: descarta las filas de otros "
        "departamentos, añade una fila vacía por cada distrito del ubigeo que "
        "falte y usa los nombres oficiales del ubigeo, p. ej. ancash",
    )
    parser.add_argument(
        "--sin-restringir",
        action="store_true",
        help="Con --departamento: no descarta filas de otros departamentos "
        "(solo las informa)",
    )
    parser.add_argument(
        "--sin-canonizar",
        action="store_true",
        help="No reemplaza distrito ni provincia por los nombres oficiales del ubigeo",
    )
    parser.add_argument(
        "--ubigeo",
        type=Path,
        default=None,
        help="CSV de ubigeo de RENIEC (por defecto geodir-ubigeo-reniec.csv "
        "junto al script)",
    )
    parser.add_argument(
        "--hoja-salida",
        default=HOJA_SALIENTES,
        metavar="NOMBRE",
        help=f"Nombre de la hoja con los alcaldes en gestión "
        f"(por defecto «{HOJA_SALIENTES}»)",
    )
    parser.add_argument(
        "--hoja-entrantes",
        default=HOJA_ENTRANTES,
        metavar="NOMBRE",
        help=f"Nombre de la hoja con los alcaldes elegidos "
        f"(por defecto «{HOJA_ENTRANTES}»)",
    )
    parser.add_argument(
        "--directorio",
        type=str,
        metavar="RUTA",
        help="Directorio de las autoridades en gestión (.csv o .xlsx). Por defecto, "
        "el CSV de Áncash junto al script; con el directorio nacional (.xlsx) se "
        "puede pedir cualquier departamento con --departamento",
    )
    parser.add_argument(
        "--hoja-directorio",
        default=None,
        metavar="NOMBRE",
        help="Hoja del directorio en Excel (por defecto la primera)",
    )
    parser.add_argument(
        "--sin-directorio",
        "--sin-entrantes",
        dest="sin_directorio",
        action="store_true",
        help="No lee el directorio: el libro sale solo con la hoja de elegidos",
    )
    parser.add_argument(
        "--sin-expandir",
        action="store_true",
        help="No ajusta al ubigeo los nombres truncados del directorio",
    )
    parser.add_argument(
        "--sin-parecidos",
        action="store_true",
        help="No resuelve topónimos por parecido ortográfico (n-gramas de "
        "caracteres): deja solo el nombre exacto, el prefijo único y la "
        "contención única",
    )
    parser.add_argument(
        "--sin-nombres",
        action="store_true",
        help="No separa nombres y apellidos: deja solo la columna nombre",
    )
    parser.add_argument(
        "--toponimos",
        type=Path,
        default=None,
        help="JSON con correcciones de nombres (por defecto toponimos.json, junto al script)",
    )
    parser.add_argument(
        "--sin-correcciones",
        action="store_true",
        help="No aplica el mapa de topónimos: deja los nombres como vienen en los archivos",
    )
    parser.add_argument(
        "--con-ubigeo",
        action="store_true",
        help="Agrega la columna ubigeo (código del CSV de RENIEC) al inicio de las "
        "dos hojas, para conciliarlas fila por fila",
    )
    parser.add_argument(
        "--debug", action="store_true", help="Muestra el recorrido del Word"
    )
    parser.add_argument(
        "--autotest", action="store_true", help="Valida el parser con datos sintéticos"
    )
    args = parser.parse_args(argv)

    if args.autotest:
        return autotest()

    # La ruta del directorio se valida antes de procesar nada: con una ruta mal
    # escrita (por ejemplo, extensión .csv en un archivo .xlsx) el libro saldría sin
    # la hoja de la gestión vigente y es fácil no notarlo.
    if not args.sin_directorio and args.directorio:
        if not Path(args.directorio).is_file():
            raise SystemExit(
                f"No se encontró el directorio: {args.directorio}."
                f"{_sugerencia_ruta(args.directorio)}"
            )

    global TOPONIMOS
    if args.sin_correcciones:
        TOPONIMOS = Toponimos()
    elif args.toponimos:
        TOPONIMOS = cargar_toponimos(args.toponimos)

    global USAR_PARECIDOS
    if args.sin_parecidos:
        USAR_PARECIDOS = False

    docx, excel = _repartir_archivos(args.docx, args.excel)
    if not docx and not excel and not args.directorio:
        parser.error(
            "indica --archivo1 y/o --archivo2 (o --directorio para trabajar solo "
            "con las autoridades en gestión)"
        )

    # El Word 2027-2030 y el Excel de contactos describen a los alcaldes ELEGIDOS:
    # son la hoja «ENTRANTES - Elegidos».
    elegidos, resumen, diagnostico, no_cruzados = construir(
        ruta_docx=docx,
        ruta_excel=excel,
        columnas=_lista_columnas(args.columnas),
        hoja=args.hoja,
        fila_encabezado=args.fila_encabezado,
        provincia_inicial=args.provincia,
        agregar_faltantes=not args.sin_agregar,
        etiqueta_faltantes=args.etiqueta_faltantes,
        solo_confirmados=args.solo_confirmados,
        fusionar=args.fusionar_provinciales,
        marca_fusion=args.marca_fusion,
        departamento=args.departamento,
        ruta_ubigeo=args.ubigeo,
        restringir=not args.sin_restringir,
        canonizar=not args.sin_canonizar,
        separar=not args.sin_nombres,
        debug=args.debug,
    )

    # Sin entradas no hay hoja de elegidos, pero el libro puede seguir teniendo
    # sentido: el directorio de la gestión vigente es una fuente propia.
    if elegidos.empty:
        print(
            "No se extrajo ninguna fila del Word ni del Excel de contactos: la hoja "
            f"«{HOJA_ENTRANTES}» se queda sin nombres ni contactos.",
            file=sys.stderr,
        )

    hoja_salida = _validar_hoja(args.hoja_salida)
    hoja_entrantes = _validar_hoja(args.hoja_entrantes)
    if hoja_salida == hoja_entrantes:
        parser.error("--hoja-salida y --hoja-entrantes no pueden llamarse igual")

    # El directorio es la GESTIÓN VIGENTE: la hoja «SALIENTES - En gestión».
    gestion: pd.DataFrame | None = None
    informe_gestion: dict = {}
    ubigeo_departamento = (
        leer_ubigeo(args.ubigeo, args.departamento) if args.departamento else None
    )
    if not args.sin_directorio:
        ruta_directorio = args.directorio or RUTA_DIRECTORIO_POR_DEFECTO
        if Path(ruta_directorio).is_file():
            gestion, informe_gestion = leer_directorio(
                ruta_directorio,
                departamento=args.departamento,
                expandir=not args.sin_expandir,
                ruta_ubigeo=args.ubigeo,
                hoja=args.hoja_directorio,
            )
            ambito = limpiar(args.departamento) or "todos los departamentos"
            print(
                f"Directorio ({ambito}): {informe_gestion['filas']} filas"
                f" · provinciales {informe_gestion['provinciales']}"
                f" · sin celular {informe_gestion['sin_celular']}"
                f" · con 2.º celular {informe_gestion['con_celular_alternativo']}"
                f" · sin correo {informe_gestion['sin_correo']}"
                f" · sin dirección {informe_gestion['sin_direccion']}"
            )
            fuera_entrantes = informe_gestion.get("descartadas", [])
            ajustes_entrantes = informe_gestion.get("ajustados", [])
            corregidos_entrantes = informe_gestion.get("corregidos", [])
            # La capital de cada provincia no está en el geodir: el nombre se toma de
            # la fila PROVINCIAL del directorio y se resuelve contra el ubigeo. El
            # código que se escribe es siempre el del geodir; si hubo que recurrir al
            # código del directorio, se dice, porque ese código viene corrido.
            capitales_detalle = informe_gestion.get("capitales_detalle") or []
            if capitales_detalle:
                por_nombre = [
                    c for c in capitales_detalle if c.get("motivo") == "por nombre"
                ]
                por_codigo = [
                    c for c in capitales_detalle if c.get("motivo") != "por nombre"
                ]
                print(
                    f"Capitales de provincia: {len(por_nombre)} por nombre"
                    f" · {len(por_codigo)} por código del directorio"
                )
                if por_codigo:
                    print(
                        "  Revisar: el nombre de la capital no estaba en el "
                        "directorio y se usó su código"
                    )
                    _imprimir_recortado(
                        [
                            f"  ? {c['provincia']}: {c['distrito']}"
                            f" (geodir {c['ubigeo']})"
                            for c in por_codigo
                        ],
                        maximo=None,
                    )
            if fuera_entrantes:
                # Con el directorio nacional son cientos de filas de otros
                # departamentos: se cuenta por departamento en vez de listarlas.
                por_departamento: dict[str, int] = {}
                for descartada in fuera_entrantes:
                    motivo = str(descartada.get("motivo", ""))
                    por_departamento[motivo] = por_departamento.get(motivo, 0) + 1
                print(f"  Descartadas del directorio ({len(fuera_entrantes)}):")
                _imprimir_recortado(
                    [
                        f"  - {motivo}: {total}"
                        for motivo, total in por_departamento.items()
                    ],
                    maximo=10,
                )
            if ajustes_entrantes:
                print(f"  Nombres ajustados al ubigeo ({len(ajustes_entrantes)}):")
                _imprimir_recortado(
                    [
                        f"  {ajuste['distrito_origen']} -> {ajuste['distrito']}"
                        f" ({ajuste['motivo']})"
                        for ajuste in ajustes_entrantes
                    ],
                    maximo=None,
                )
            if corregidos_entrantes:
                print(
                    f"  Ubigeo del directorio distinto al de RENIEC"
                    f" ({len(corregidos_entrantes)}); se usa el de RENIEC por distrito:"
                )
                _imprimir_recortado(
                    [
                        f"  {c['provincia']} / {c['distrito']}: "
                        f"{c['ubigeo_origen']} -> {c['ubigeo']}"
                        for c in corregidos_entrantes
                    ],
                    maximo=15,
                )
            elegidos, informe_direcciones = aplicar_direcciones(
                elegidos,
                gestion,
                etiqueta=args.etiqueta_faltantes,
                ubigeo=ubigeo_departamento,
                capitales=informe_gestion.get("capitales") or None,
            )
            print(
                f"Direcciones: {informe_direcciones['con_direccion']} de "
                f"{len(elegidos)} filas · sin dirección "
                f"{informe_direcciones['sin_direccion']}"
            )

            # El índice manda: la hoja de gestión se completa con el ubigeo para que
            # haya una fila por distrito del departamento, aunque quede vacía. El
            # directorio solo trae al alcalde provincial; el del distrito capital no
            # está en la fuente, así que su fila se agrega sin nombre ni contactos.
            if ubigeo_departamento is not None and not ubigeo_departamento.empty:
                gestion, informe_completado = completar_con_ubigeo(
                    gestion, ubigeo_departamento, etiqueta=args.etiqueta_faltantes
                )
                agregados = informe_completado.get("agregados") or []
                if agregados:
                    print(
                        f"Gestión completada con el geodir: {len(agregados)} "
                        f"distrito(s) agregados vacíos"
                    )
                    _imprimir_recortado(
                        [
                            f"  + {agregado['provincia']} / "
                            f"{agregado['distrito_ubigeo']}"
                            f" (ubigeo {agregado['ubigeo']})"
                            for agregado in agregados
                        ],
                        maximo=None,
                    )
                reconocidos = [
                    entrada
                    for entrada in informe_completado.get("detalle") or []
                    if str(entrada.get("estado", "")).startswith("coincide por nombre")
                ]
                if reconocidos:
                    print(f"  Distritos reconocidos por nombre: {len(reconocidos)}")
                    _imprimir_recortado(
                        [
                            f"  {entrada['provincia']} / "
                            f"{entrada['distrito_ubigeo']} -> "
                            f"{entrada['distrito_salida']}"
                            for entrada in reconocidos
                        ],
                        maximo=None,
                    )
                fuera_gestion = informe_completado.get("no_reconocidos") or []
                if fuera_gestion:
                    print(
                        f"  Aviso: {len(fuera_gestion)} fila(s) del directorio fuera "
                        f"del ubigeo del departamento"
                    )
                    _imprimir_recortado(
                        [
                            f"  ! {r['provincia']} / {r['distrito']}"
                            for r in fuera_gestion
                        ],
                        maximo=None,
                    )
                pares = _pares_capitales(
                    ubigeo_departamento,
                    gestion,
                    informe_gestion.get("capitales") or None,
                )
                gestion, rellenados = _heredar_direccion_capital(gestion, pares)
                if rellenados:
                    print(
                        f"  Dirección de la sede provincial heredada en "
                        f"{rellenados} distrito(s) capital"
                    )
                gestion = _ordenar_por_provincia(gestion)
                informe_gestion["agregados"] = agregados
                informe_gestion["filas"] = len(gestion)
        else:
            print(
                f"Aviso: no se encontró {ruta_directorio}; "
                f"se omite la hoja «{hoja_salida}»."
                f"{_sugerencia_ruta(ruta_directorio)}",
                file=sys.stderr,
            )

    # Orden del libro: la hoja principal es la gestión vigente (directorio) y la
    # segunda, los elegidos (Word 2027-2030). Sin directorio el libro lleva solo la
    # hoja de elegidos, con su nombre propio.
    if gestion is not None and not gestion.empty:
        df, entrantes = gestion, elegidos
    else:
        df, entrantes = elegidos, None
        hoja_salida, hoja_entrantes = hoja_entrantes, hoja_salida

    if df.empty and (entrantes is None or entrantes.empty):
        print(
            "No hay nada que escribir: ni filas del directorio ni filas del Word. "
            "Revisa el Word con --debug.",
            file=sys.stderr,
        )
        return 1

    # Los ubigeos de las dos hojas tienen que coincidir. Se comparan los pares
    # (provincia, distrito) ya canonizados al ubigeo de RENIEC.
    alineacion = verificar_alineacion(df, entrantes)
    if alineacion["repetidos"]:
        print(
            f"Aviso: {len(alineacion['repetidos'])} municipio(s) repetidos en la "
            f"hoja de elegidos; revisa el Word y el Excel de contactos.",
            file=sys.stderr,
        )
        _imprimir_recortado(
            [
                f"  {r['provincia']} / {r['distrito']}: {r['filas']} filas"
                for r in alineacion["repetidos"]
            ],
            maximo=None,
        )
    if alineacion["entrantes"]:
        print(
            f"Ubigeo alineado: {alineacion['entrantes']} municipios en elegidos"
            f" · {len(alineacion['solo_entrantes'])} sin par en salientes"
            f" · {len(alineacion['solo_salientes'])} de salientes sin elegido"
        )
    if alineacion["solo_entrantes"]:
        print("  En elegidos y no en la hoja de salientes:")
        _imprimir_recortado(
            [
                f"  ! {r['provincia']} / {r['distrito']}"
                for r in alineacion["solo_entrantes"]
            ],
            maximo=None,
        )

    # Quién de los elegidos ya figuraba en la hoja de salientes (directorio). Se
    # calcula antes de descartar la columna interna `nombre`, que es la que se compara.
    entrantes, reelegidos = marcar_reelegidos(df, entrantes)
    if reelegidos:
        reelectos = [r for r in reelegidos if r["caso"] == "reelegido"]
        dudosos = [r for r in reelegidos if r["caso"] != "reelegido"]
        print(
            f"Reelección: {len(reelectos)} de {len(entrantes)} elegidos ya estaban"
            f" en la hoja de salientes · mismo nombre en otra municipalidad"
            f" {len(dudosos)}"
        )
        if reelectos:
            print("  Reelegidos:")
            _imprimir_recortado(
                [
                    f"    {r['provincia']} / {r['distrito']}: {r['nombre']}"
                    f" <- {r['anterior']} ({r['similitud']})"
                    for r in reelectos
                ],
                maximo=None,
            )
        if dudosos:
            print("  Coinciden en nombre pero no en municipio (no se marcan):")
            _imprimir_recortado(
                [
                    f"    {r['provincia']} / {r['distrito']}: {r['nombre']}"
                    f" ~ {r['anterior']} ({r['similitud']})"
                    for r in dudosos
                ],
                maximo=None,
            )

    provincias_sin_datos: list[str] | None = None
    if ubigeo_departamento is not None and not ubigeo_departamento.empty:
        oficiales = _provincias_del_ubigeo(ubigeo_departamento)
        con_datos = {
            clave(p) for p in (resumen.get("provincias_con_datos") or []) if limpiar(p)
        }
        if df is not None and not df.empty:
            con_datos |= {clave(p) for p in df["provincia"] if limpiar(p)}
        if entrantes is not None and not entrantes.empty:
            con_datos |= {clave(p) for p in entrantes["provincia"] if limpiar(p)}
        provincias_sin_datos = [
            nombre for c, nombre in oficiales.items() if c not in con_datos
        ]

    fusiones = resumen.get("fusiones") or {}
    ubigeo = resumen.get("ubigeo") or {}
    departamento_informe = resumen.get("departamento") or {}

    df = _sin_nombre(df)
    if entrantes is not None and not entrantes.empty:
        entrantes = _sin_nombre(entrantes)

    if args.con_ubigeo:
        # El ubigeo sale siempre del CSV de RENIEC, que es la referencia de las dos
        # hojas. Las filas PROVINCIAL no son un distrito: no llevan código.
        codigos_ubigeo = _codigos_por_par(ubigeo_departamento)
        df = _con_ubigeo(df, codigos_ubigeo, etiqueta=TAG_PROVINCIAL)
        if entrantes is not None and not entrantes.empty:
            entrantes = _con_ubigeo(entrantes, codigos_ubigeo, etiqueta=TAG_PROVINCIAL)
        marcos = [df] if df is not None and not df.empty else []
        if entrantes is not None and not entrantes.empty:
            marcos.append(entrantes)
        sin_codigo_provincial = sin_codigo_distrito = 0
        for marco in marcos:
            for distrito, codigo in zip(marco["distrito"], marco[COLUMNA_UBIGEO]):
                if not es_vacio(codigo):
                    continue
                if clave(distrito) == clave(TAG_PROVINCIAL):
                    sin_codigo_provincial += 1
                else:
                    sin_codigo_distrito += 1
        print(
            "Ubigeo (RENIEC): columna agregada a las dos hojas"
            f" · {sin_codigo_provincial} fila(s) PROVINCIAL sin código (no son distrito)"
            f" · {sin_codigo_distrito} distrito(s) sin código"
        )

    escribir(
        df,
        args.salida,
        diagnostico,
        no_cruzados,
        hoja_salida=hoja_salida,
        entrantes=entrantes,
        hoja_entrantes=hoja_entrantes,
        informe={
            "provincias_sin_datos": provincias_sin_datos,
            "resumen": resumen,
            "directorio": informe_gestion,
            "word": {
                "tablas": len(diagnostico),
                "vacias": sum(1 for r in diagnostico if not r.get("filas")),
            },
        },
    )
    print(f"\n{len(df)} filas en «{hoja_salida}» · columnas: {', '.join(df.columns)}")
    print(f"Provincias: {df['provincia'].nunique()} · escritos: {args.salida}")
    if diagnostico:
        por_plantilla = sum(1 for r in diagnostico if r.get("modo") == "plantilla")
        vacias = sum(1 for r in diagnostico if not r.get("filas"))
        print(
            f"Lectura del Word: {len(diagnostico)} tablas · {por_plantilla} por plantilla"
            f" · {vacias} vacías"
        )
    if entrantes is not None and not entrantes.empty:
        if args.salida.suffix.lower() in {".xlsx", ".xlsm"}:
            print(
                f"Hojas: «{hoja_salida}» ({len(df)} filas) y "
                f"«{hoja_entrantes}» ({len(entrantes)} filas)"
            )
        else:
            print(f"Elegidos: {len(entrantes)} filas en el CSV aparte")
    faltantes = _conteos_faltantes(df)
    print(
        f"Faltantes en «{hoja_salida}»: "
        + " · ".join(
            f"{fila['métrica']} {fila['cantidad']}"
            for fila in faltantes
            if fila["métrica"] != "filas"
        )
    )
    if resumen.get("nombres"):
        casos = Counter(fila["caso"] for fila in resumen["nombres"])
        print(
            "Nombres (elegidos, "
            + motor_nombres()
            + "): "
            + " · ".join(f"{caso} {total}" for caso, total in casos.items())
        )
        dudosos = [
            f"  {fila['provincia']} / {fila['distrito']}: {fila['nombre']}"
            f" ({fila['caso']})"
            for fila in resumen["nombres"]
            if str(fila.get("caso", "")).startswith("sin partir")
        ]
        if dudosos:
            print(f"  Sin partir ({len(dudosos)}, revisar a mano):")
            _imprimir_recortado(dudosos, maximo=None)
    if ubigeo:
        print(
            f"Ubigeo (elegidos): {len(ubigeo['agregados'])} distrito(s) agregados vacíos"
            f" · {ubigeo['coincidencias_por_nombre']} coinciden por nombre"
            f" · {len(ubigeo['no_reconocidos'])} fuera del ubigeo"
        )
        fuera = ubigeo.get("no_reconocidos") or []
        if fuera:
            print(f"  Fuera del ubigeo ({len(fuera)}, revisar a mano):")
            _imprimir_recortado(
                [
                    f"  {fila.get('provincia', '')} / {fila.get('distrito', '')}"
                    f" — {fila.get('nombre') or 'sin nombre'}"
                    for fila in fuera
                ],
                maximo=None,
            )
    if departamento_informe:
        print(
            f"Filtro de departamento (elegidos): {departamento_informe['dentro']} "
            f"filas dentro · {len(departamento_informe['descartadas'])} descartadas"
        )
    if resumen.get("canonico"):
        cambios = [
            ajuste for ajuste in resumen["canonico"] if ajuste["motivo"] != "provincial"
        ]
        print(f"Nombres oficiales del ubigeo (elegidos): {len(cambios)} ajustes")
        _imprimir_recortado(
            [
                f"  {ajuste['provincia_origen']} / {ajuste['distrito_origen']}"
                f" -> {ajuste['provincia']} / {ajuste['distrito']}"
                f" ({ajuste['motivo']})"
                for ajuste in cambios
            ],
            maximo=None,
        )
    if resumen.get("celulares"):
        print(
            f"Celulares (elegidos): {len(resumen['celulares'])} filas con más de un "
            f"número"
        )
        detalle_celulares: list[str] = []
        for fila in resumen["celulares"]:
            numeros = limpiar(fila.get("celular"))
            if limpiar(fila.get(COLUMNA_CELULAR_2)):
                numeros += f" + {limpiar(fila.get(COLUMNA_CELULAR_2))}"
            if limpiar(fila.get("descartado")):
                numeros += f" (descartado {limpiar(fila.get('descartado'))})"
            detalle_celulares.append(
                f"  {fila['provincia']} / {fila['distrito']}: "
                f"{fila['nombre'] or 'sin nombre'} — {numeros or 'sin número'}"
            )
        _imprimir_recortado(detalle_celulares, maximo=None)
    if fusiones:
        print(
            f"Fusiones (elegidos): {fusiones['fusionadas']} fila(s) PROVINCIALES unidas a "
            f"su distrito · rellenos {fusiones['rellenados']}"
            f" · sin par {len(fusiones['sin_par'])}"
        )
        _imprimir_recortado(
            [
                f"  {fila['provincia']} / {fila['distrito']}: "
                f"{fila['nombre_distrito'] or 'sin nombre'} <- "
                f"{fila['nombre_provincial'] or 'sin nombre'} ({fila['criterio']})"
                for fila in fusiones.get("detalle", [])
            ],
            maximo=None,
        )
        if fusiones.get("sin_par"):
            print("  Sin par:")
            _imprimir_recortado(
                [
                    f"  {fila['provincia']}: {fila['nombre'] or 'sin nombre'}"
                    f" ({fila['motivo']})"
                    for fila in fusiones["sin_par"]
                ],
                maximo=None,
            )
    if no_cruzados:
        print(
            f"Atención: {len(no_cruzados)} filas del Excel no se cruzaron; "
            f"quedaron en la hoja 'excel_no_cruzado'."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
