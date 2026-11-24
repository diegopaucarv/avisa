#!/usr/bin/env python
"""Catálogos y filas existentes relevantes para el importador (sólo lectura)."""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
)
conn = psycopg2.connect(os.environ["NEON_OWNER_URL"])
conn.set_session(readonly=True, autocommit=True)

Q = {
    "cat_estados_hito": "SELECT id, codigo, es_terminal FROM core.cat_estados_hito ORDER BY id",
    "cat_niveles_riesgo": "SELECT id, codigo, orden FROM core.cat_niveles_riesgo ORDER BY id",
    "cat_prioridades": "SELECT id, codigo FROM core.cat_prioridades ORDER BY id",
    "cat_tipos_compromiso": "SELECT * FROM core.cat_tipos_compromiso ORDER BY 1",
    "unidades": "SELECT id, nombre, siglas FROM core.unidades ORDER BY id",
    "compromisos_existentes": """SELECT codigo_compromiso, tipo_compromiso, unidad_responsable_id,
        fecha_inicio, fecha_vencimiento, estado_id, left(accion_compromiso,60) AS accion
        FROM core.compromisos ORDER BY codigo_compromiso LIMIT 20""",
    "hitos_existentes": """SELECT compromiso_id, codigo_hito, fecha_vencimiento, estado_id, validacion,
        left(descripcion_hito,40) FROM core.hitos_compromiso ORDER BY 1 LIMIT 20""",
    "compromiso_cols_nuevas": """SELECT column_name FROM information_schema.columns
        WHERE table_schema='core' AND table_name='compromisos'
        AND column_name IN ('demanda_id','punto_focal_usuario_id','punto_focal_texto','tematica_equipo')""",
}
with conn.cursor() as cur:
    for name, sql in Q.items():
        try:
            cur.execute(sql)
            rows = cur.fetchall()
            print(f"\n=== {name} ({len(rows)}) ===")
            for r in rows:
                print("  ", r)
        except Exception as e:
            conn.rollback()
            print(f"\n=== {name} ERROR: {e} ===")
conn.close()
