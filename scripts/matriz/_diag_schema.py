#!/usr/bin/env python
"""Esquema (sólo lectura) de las tablas destino del importador."""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
)
URL = os.environ["NEON_OWNER_URL"]
conn = psycopg2.connect(URL)
conn.set_session(readonly=True, autocommit=True)

TABLAS = [
    "core.casos",
    "core.demandas",
    "core.compromisos",
    "core.hitos_compromiso",
    "core.alertas_tempranas",
    "core.reuniones_dialogo",
    "core.documentos",
    "core.caso_cronologia",
    "core.actores",
    "core.casos_actores",
]
with conn.cursor() as cur:
    for t in TABLAS:
        sch, rel = t.split(".")
        cur.execute(
            """SELECT column_name, data_type, is_nullable, column_default
               FROM information_schema.columns
               WHERE table_schema=%s AND table_name=%s
               ORDER BY ordinal_position""",
            (sch, rel),
        )
        rows = cur.fetchall()
        print(f"\n=== {t} ({len(rows)} cols) ===")
        for name, typ, nul, dflt in rows:
            extra = ""
            if dflt:
                extra += f" default={dflt[:40]}"
            if nul == "NO":
                extra += " NOTNULL"
            print(f"  {name}: {typ}{extra}")
conn.close()
