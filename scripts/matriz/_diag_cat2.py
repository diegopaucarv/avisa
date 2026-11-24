#!/usr/bin/env python
"""Contenido de catálogos necesarios para el importador (sólo lectura)."""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
)
conn = psycopg2.connect(os.environ["NEON_OWNER_URL"])
conn.set_session(readonly=True, autocommit=True)

CATS = [
    "cat_unidades_organicas",
    "cat_prioridades_atencion",
    "cat_tipos_reunion",
    "cat_niveles_conflicto",
    "cat_subsectores",
    "cat_estados_caso",
    "cat_tipos_documento",
    "cat_niveles_alerta",
    "cat_prioridades_alerta",
    "cat_estados_compromiso",
    "cat_tipos_hecho",
    "cat_tematicas",
    "cat_alcances_geograficos",
    "cat_naturalezas_caso",
]
with conn.cursor() as cur:
    for c in CATS:
        try:
            cur.execute(f"SELECT * FROM core.{c} ORDER BY 1")
            cols = [d.name for d in cur.description]
            rows = cur.fetchall()
            print(f"\n=== core.{c} ({len(rows)}) cols={cols} ===")
            for r in rows:
                print("  ", r)
        except Exception as e:
            conn.rollback()
            print(f"\n=== core.{c} ERROR {e} ===")
conn.close()
