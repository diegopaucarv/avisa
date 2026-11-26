"""Respaldo lógico previo a la recarga + puente compromiso_demandas.

Paso 1-3 del plan: no borra ni inserta datos de negocio.
    python scripts/matriz/respaldar_recarga.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
MAPA = RAIZ / "scripts/matriz/salida/mapa_matriz_excel.json"
SALIDA = RAIZ / "backups/recarga_matriz_2026_11_26.json"


def main() -> None:
    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("select set_config('app.rol_codigo','administrador',true)")
    cur.execute(
        "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
    )

    caso_ids = sorted(
        {
            m["caso_id"]
            for m in json.loads(MAPA.read_text(encoding="utf-8"))
            if m.get("caso_id")
        }
    )
    print(f"casos a respaldar: {len(caso_ids)}")

    def filas(sql: str):
        cur.execute(sql, (caso_ids,))
        columnas = [d[0] for d in cur.description]
        return [dict(zip(columnas, f)) for f in cur.fetchall()]

    casos = filas(
        "select row_to_json(c)::text as j from core.casos c where c.id = any(%s::uuid[])"
    )
    casos = [json.loads(r["j"]) for r in casos]
    demandas = filas(
        "select row_to_json(d)::text as j from core.demandas d where d.caso_id = any(%s::uuid[])"
    )
    demandas = [json.loads(r["j"]) for r in demandas]
    compromisos = filas(
        "select row_to_json(m)::text as j from core.compromisos m where m.caso_id = any(%s::uuid[])"
    )
    compromisos = [json.loads(r["j"]) for r in compromisos]
    hitos = filas(
        "select row_to_json(h)::text as j from core.hitos_compromiso h "
        "where h.compromiso_id in (select id from core.compromisos where caso_id = any(%s::uuid[]))"
    )
    hitos = [json.loads(r["j"]) for r in hitos]
    documentos = filas(
        "select id::text, caso_id::text from core.documentos where caso_id = any(%s::uuid[])"
    )
    vinculos = filas(
        "select row_to_json(x)::text as j from core.casos_actores x where x.caso_id = any(%s::uuid[])"
    )
    vinculos = [json.loads(r["j"]) for r in vinculos]

    respaldo = {
        "generado": "2026-11-26",
        "caso_ids": caso_ids,
        "casos": casos,
        "demandas": demandas,
        "compromisos": compromisos,
        "hitos": hitos,
        "documentos": documentos,
        "casos_actores": vinculos,
    }
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(
        json.dumps(respaldo, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print(
        f"respaldo escrito: {SALIDA}\n"
        f"  casos={len(casos)} demandas={len(demandas)} compromisos={len(compromisos)} "
        f"hitos={len(hitos)} documentos={len(documentos)} vinculos={len(vinculos)}"
    )

    # Puente de la migración 65 (idempotente).
    cur.execute(
        """
        create table if not exists core.compromiso_demandas (
          compromiso_id uuid not null references core.compromisos(id) on delete cascade,
          demanda_id   uuid not null references core.demandas(id)    on delete cascade,
          es_principal boolean not null default false,
          orden        smallint not null default 1,
          created_at   timestamptz not null default now(),
          primary key (compromiso_id, demanda_id)
        )
        """
    )
    cur.execute(
        """create unique index if not exists uq_compromiso_demandas_principal
             on core.compromiso_demandas (compromiso_id) where es_principal"""
    )
    cur.execute(
        """insert into core.migracion_log (clave)
           values ('65_compromiso_demandas_2026_11_26') on conflict (clave) do nothing"""
    )
    conn.commit()
    cur.execute("select count(*) from core.compromiso_demandas")
    print("puente compromiso_demandas listo, filas:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
