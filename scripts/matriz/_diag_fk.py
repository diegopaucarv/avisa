#!/usr/bin/env python
"""FKs y catálogos reales (sólo lectura)."""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
)
conn = psycopg2.connect(os.environ["NEON_OWNER_URL"])
conn.set_session(readonly=True, autocommit=True)

with conn.cursor() as cur:
    cur.execute("""
      SELECT tc.table_name, kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='core'
        AND tc.table_name IN ('casos','compromisos','hitos_compromiso','demandas','alertas_tempranas','reuniones_dialogo')
      ORDER BY tc.table_name, kcu.column_name
    """)
    print("=== FKs ===")
    for r in cur.fetchall():
        print("  ", r)

    for t in ("core.cat_unidades", "core.unidades_responsables", "public.unidades"):
        try:
            cur.execute(f"SELECT * FROM {t} LIMIT 3")
            print(f"\n=== {t} OK ===", cur.fetchall())
        except Exception as e:
            conn.rollback()
            print(f"\n=== {t} no existe ===")

    cur.execute("""SELECT table_schema||'.'||table_name FROM information_schema.tables
                   WHERE table_schema='core' AND table_name LIKE 'cat_%' ORDER BY 1""")
    print("\n=== tablas cat_ en core ===")
    print("  ", [r[0] for r in cur.fetchall()])
conn.close()
