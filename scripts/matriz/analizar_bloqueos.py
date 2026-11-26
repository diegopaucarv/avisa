"""Análisis de bloqueos de borrado para los 34 casos mapeados. Sólo lectura.

Responde: para cada FK que NO es ON DELETE CASCADE hacia core.casos,
core.demandas, core.compromisos o core.hitos_compromiso, cuántas filas de los
casos a borrar la bloquean, si la columna admite NULL y qué opción tiene.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
load_dotenv(RAIZ / ".env")
conn = psycopg2.connect(os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"])
conn.set_session(readonly=True, autocommit=True)
cur = conn.cursor()

mapa = json.loads(
    (RAIZ / "scripts/matriz/salida/mapa_matriz_excel.json").read_text(encoding="utf-8")
)
caso_ids = sorted({m["caso_id"] for m in mapa if m.get("caso_id")})
print(f"casos a borrar (del mapa): {len(caso_ids)}")


def ids(sql: str):
    cur.execute(sql, (caso_ids,))
    return [r[0] for r in cur.fetchall()]


demanda_ids = ids("select id from core.demandas where caso_id = any(%s::uuid[])")
compromiso_ids = ids("select id from core.compromisos where caso_id = any(%s::uuid[])")
alerta_ids = ids(
    "select id from core.alertas_tempranas where caso_id = any(%s::uuid[])"
)
if compromiso_ids:
    cur.execute(
        "select id from core.hitos_compromiso where compromiso_id = any(%s::uuid[])",
        (compromiso_ids,),
    )
    hito_ids = [r[0] for r in cur.fetchall()]
else:
    hito_ids = []
print(
    f"demandas={len(demanda_ids)} compromisos={len(compromiso_ids)} "
    f"hitos={len(hito_ids)} alertas={len(alerta_ids)}"
)

padres = {
    "core.casos": caso_ids,
    "core.demandas": demanda_ids,
    "core.compromisos": compromiso_ids,
    "core.hitos_compromiso": hito_ids,
    "core.alertas_tempranas": alerta_ids,
}

# FK no cascada hacia los cuatro padres
cur.execute(
    """
    select c.conname, ns.nspname, cl.relname, a.attname, c.confdeltype,
           pns.nspname, pcl.relname
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_class pcl on pcl.oid = c.confrelid
      join pg_namespace pns on pns.oid = pcl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confdeltype <> 'c'
       and (pns.nspname || '.' || pcl.relname) = any(%s::text[])
     order by 2, 3
    """,
    (list(padres),),
)

filas = []
print("\n--- FK no cascada que bloquean ---")
print(f"{'hijo':34} {'col':26} {'padre':22} {'accion':7} {'nulos':6} {'filas':>7}")
for conname, nsp, tabla, col, accion, pns, padre in cur.fetchall():
    padre_full = f"{pns}.{padre}"
    ids_padre = padres.get(padre_full) or []
    if not ids_padre:
        count = 0
    else:
        cur.execute(
            f'select count(*) from "{nsp}"."{tabla}" where "{col}" = any(%s::uuid[])',
            (ids_padre,),
        )
        count = cur.fetchone()[0]
    cur.execute(
        """select is_nullable from information_schema.columns
            where table_schema=%s and table_name=%s and column_name=%s""",
        (nsp, tabla, col),
    )
    nulos = (cur.fetchone() or ("?",))[0]
    if count:
        filas.append(
            {
                "hijo": f"{nsp}.{tabla}",
                "columna": col,
                "padre": padre_full,
                "accion": accion,
                "nullable": nulos,
                "filas": count,
                "constraint": conname,
            }
        )
        print(
            f"{nsp}.{tabla:28} {col:26} {padre_full:22} {accion:7} {nulos:6} {count:>7}"
        )

total = sum(f["filas"] for f in filas)
print(f"\nTOTAL filas bloqueantes: {total} en {len(filas)} constraints")

salida = RAIZ / "scripts/matriz/salida/analisis_bloqueos.json"
salida.write_text(
    json.dumps(
        {
            "caso_ids": len(caso_ids),
            "demandas": len(demanda_ids),
            "compromisos": len(compromiso_ids),
            "hitos": len(hito_ids),
            "total_bloqueantes": total,
            "detalle": filas,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
print("Escrito", salida)
