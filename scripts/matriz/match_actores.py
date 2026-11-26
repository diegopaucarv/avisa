#!/usr/bin/env python
"""Vincula menciones de actores de la matriz con los registros ya existentes.

Insumo
------
``scripts/matriz/salida/matriz_2026.json`` (lo produce otro agente). Se toleran
varias formas: ``{"filas": [...]}``, ``{"casos": [...]}`` o una lista de filas.
Cada fila puede traer los textos como cadena cruda (``*_raw``) o como lista de
cadenas/objetos. Los campos lógicos que interesan son:

* ``actores_estado``    → columna **I** (actores del Estado)
* ``actores_sociedad``  → columna **J** (actores de la sociedad civil)
* ``area_responsable``  → columna **O** (institución)
* ``punto_focal``       → columna **P** (persona)
* ``responsable_hito``  → columna **T** (institución)

Si el archivo no existe todavía, el script usa un puñado de menciones internas
que provienen literalmente de las celdas I/J de la matriz ya parseada
(``casos.json``). No se inventan datos de negocio: los textos de ejemplo son
los del Excel. El modo queda declarado en ``meta.modo``.

Lectura estricta
----------------
La conexión se abre con ``set_session(readonly=True, autocommit=True)`` y el
script no ejecuta ningún ``insert``/``update``/``delete``/``merge``. Tampoco
crea actores: cuando no hay evidencia suficiente emite la propuesta ``crear``.

Las tres búsquedas
------------------
1. **Siglas exactas**: normaliza (mayúsculas, sin tildes, sin puntos ni
   espacios) y compara contra ``core.organizaciones`` (razón social y
   abreviatura), ``core.actores.abreviatura``,
   ``core.cat_unidades_organicas.siglas`` y ``core.entidades.siglas``.
   Coincidencia exacta = confianza 1,0.
2. **Similitud estadística**: ``0,6 × similitud del nombre + 0,4 × similitud
   de siglas``, con mínimos separados por componente y una guarda de
   «cobertura distintiva» para no casar nombres genéricos.
3. **Vectores**: interfaz ``Vectorizador`` con ``EmbeddingsRemotos`` (sólo si
   hay proveedor configurado por entorno) y ``NgramasLocales`` (TF-IDF de
   n-gramas de caracteres, offline y determinista) como respaldo obligatorio.

Decisión
--------
* ``auto_vinculado``: confianza ≥ 0,92 **y** al menos una segunda estrategia
  que apunte al mismo registro (≥ piso de acuerdo).
* ``dudoso``: confianza entre 0,75 y 0,92, o una sola estrategia fuerte.
* ``sin_match`` + propuesta ``crear``: las tres estrategias quedan por debajo
  de 0,75.

Uso
---
    python scripts/matriz/match_actores.py
    python scripts/matriz/match_actores.py --matriz RUTA.json --salida RUTA.json
    python scripts/matriz/match_actores.py --sin-bd --sin-red
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import math
import os
import random
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Iterable, Sequence

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

try:  # Sólo se usa si ya está instalado; no es una dependencia nueva.
    from rapidfuzz import fuzz as _fuzz
except Exception:  # pragma: no cover - entorno sin rapidfuzz
    _fuzz = None


# ---------------------------------------------------------------------------
# Rutas y constantes
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

RUTA_MATRIZ = os.path.join(HERE, "salida", "matriz_2026.json")
RUTA_SALIDA = os.path.join(HERE, "salida", "match_actores.json")
RUTA_ENV = os.path.join(REPO, ".env")

UMBRAL_AUTO = 0.92
UMBRAL_DUDA = 0.75
PESO_NOMBRE = 0.6
PESO_SIGLAS = 0.4
MIN_NOMBRE = 0.55
MIN_SIGLAS = 0.55
MIN_COBERTURA = 0.50
PISO_ESTADISTICA = 0.75
PISO_VECTOR = 0.70
SEMILLA = 20261126

TIPOS = ("persona", "organizacion", "institucion", "actor")

# Cada tipo de mención sólo puede casar con estos tipos de registro. Es la
# regla que impide vincular una persona con una organización.
PERMITIDOS = {
    "persona": {"persona"},
    "organizacion": {"organizacion"},
    "institucion": {"institucion"},
    "actor": {"institucion", "organizacion"},
}

# Palabras que no distinguen una organización de otra.
GENERICOS = {
    "ASOCIACION", "ASOCIACIONES", "GREMIOS", "GREMIAL", "COMITE", "COMITES",
    "FEDERACION", "FEDERACIONES", "CONFEDERACION", "SINDICATO", "SINDICATOS",
    "ORGANIZACION", "ORGANIZACIONES", "COOPERATIVA", "COOPERATIVAS",
    "EMPRESA", "EMPRESAS", "SOCIEDAD", "SOCIEDADES", "CIVIL", "JUNTA",
    "JUNTAS", "COMUNIDAD", "COMUNIDADES", "RONDA", "RONDAS", "CLUB", "RED",
    "REDES", "MOVIMIENTO", "COLECTIVO", "AGRUPACION", "CAMARA", "COLEGIO",
    "PESCADORES", "PESCADOR", "PESQUEROS", "PESQUERO", "ARTESANALES",
    "ARTESANAL", "PRODUCTORES", "PRODUCTOR", "PROPIETARIOS", "ARMADORES",
    "TRABAJADORES", "POBLADORES", "CAMPESINOS", "AGRICULTORES", "USUARIOS",
    "VECINOS", "BASE", "NIVEL", "NACIONAL", "REGIONAL", "LOCAL", "PERU",
    "DEL", "DE", "LA", "LAS", "LOS", "EL", "Y", "E", "EN", "PARA", "POR",
    "CON", "A", "AL", "UN", "UNA", "SIN", "SOBRE", "ENTRE", "OTROS",
}

MARCAS_ORG = {
    "ASOCIACION", "ASOC", "GREMIOS", "GREMIAL", "COMITE", "FEDERACION",
    "CONFEDERACION", "SINDICATO", "COOPERATIVA", "ORGANIZACION", "JUNTA",
    "COMUNIDAD", "RONDA", "OSPA", "EMPRESA", "PYME", "MYPE", "CAMARA",
    "COLEGIO", "CLUB", "AGRUPACION", "MOVIMIENTO", "COLECTIVO", "RED",
}

MARCAS_INST = {
    "MINISTERIO", "DIRECCION", "DIRECTORAL", "GERENCIA", "OFICINA",
    "INSTITUTO", "GOBIERNO", "GOBIERNO", "MUNICIPALIDAD", "FONDO",
    "SERVICIO", "ORGANISMO", "AUTORIDAD", "CONSEJO", "COMISION", "PROGRAMA",
    "CONTRALORIA", "DEFENSORIA", "SERNANP", "IMARPE", "PRODUCE", "DIREPRO",
    "OEFA", "ANA", "SUNASS", "SUNAT", "AGRORURAL", "SENASA", "INIA",
    "DEVIDA", "FONCODES", "PRONABEC", "INDECI", "CENEPRED", "PNP",
    "EJERCITO", "MARINA", "FAP", "PODER", "JUDICIAL", "FISCALIA",
    "CONGRESO", "PRESIDENCIA", "VICEMINISTERIO", "SECRETARIA", "ARCHIVO",
    "BIBLIOTECA", "BANCO", "SUPERINTENDENCIA", "REGISTRO", "UNIDAD",
}

STOP_SIGLAS = {
    "DE", "DEL", "LA", "LAS", "LOS", "