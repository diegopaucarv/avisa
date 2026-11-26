"""Aplica los mapeos de llaves y crea los actores nuevos del matcher.

(a) alertas/casos por (prefijo, año, entero) — el prefijo puede llevar guion.
(b) actores `nuevo` de match_actores.json, con guardas: no crea descriptores
    genéricos ni nombres que ya existan (normalizados).

Uso: python scripts/matriz/aplicar_matcher.py [--apply]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PATRON = re.compile(r"^(?P<pref>.+)-(?P<anio>\d{4})-(?P<num>\d+)$")
MARCAS = re.compile(
    r"\b(asociacion|gremio|sindicato|comite|federacion|cooperativa|ospa|"
    r"confederacion|camara|union|consejo|municipalidad|direccion|ministerio|"
    r"instituto|oficina|procuraduria|autoridad|empresa)\b"
)


def norm(t: str | None) -> str:
    v = unicodedata.normalize("NFKD", t or "")
    v = "".join(c for c in v if not unicodedata.combining(c))
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in v).split())


def clave(codigo: str | None):
    m = PATRON.match((codigo or "").strip().upper())
    return (m.group("pref"), int(m.group("anio")), int(m.group("num"))) if m else None


def es_entidad(nombre: str) -> bool:
    """Descarta descriptores genéricos sin ancla propia."""
    if MARCAS.search(norm(nombre)):
        return True
    palabras = [p for p in nombre.split() if p]
    propias = [p for p in palabras[1:] if p[:1].isupper() and len(p) >= 3]
    siglas = re.findall(r"\b[A-ZÁÉÍÓÚÑ]{3,}\b", nombre)
    return bool(propias or siglas)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    cur = conn.cursor()

    # ---------- A · mapeos de llaves ----------
    cur.execute(
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_clave = {}
    for codigo, cid in cur.fetchall():
        k = clave(codigo)
        if k:
            caso_por_clave.setdefault(k, cid)

    cur.execute(
        "select codigo_legado, actor_uid::text from core.actores where codigo_legado is not null"
    )
    actor_por_codigo = {c: i for c, i in cur.fetchall()}

    cur.execute("select c02, c03 from legacy.bridge_caso_actor")
    pares_caso = set()
    for actor, caso in cur.fetchall():
        uid = actor_por_codigo.get(actor)
        cid = caso_por_clave.get(clave(caso))
        if uid and cid:
            pares_caso.add((cid, uid))
    print(f"caso-actor resolubles por (prefijo, año, entero): {len(pares_caso)}")

    # ---------- B · actores nuevos ----------
    datos = json.loads(
        (RAIZ / "scripts/matriz/salida/match_actores.json").read_text(encoding="utf-8")
    )
    cur.execute("select nombre_actual from core.actores")
    existentes = {norm(r[0]) for r in cur.fetchall()}

    nuevos, descartados = [], 0
    for fila in datos["filas"]:
        if fila["veredicto"] != "nuevo":
            continue
        nombre = (fila.get("crudo") or "").split("\n")[0].strip(" ;,")
        if len(nombre) < 4 or norm(nombre) in existentes:
            descartados += 1
            continue
        if not es_entidad(nombre):
            descartados += 1
            continue
        existentes.add(norm(nombre))
        nuevos.append((nombre, fila.get("tipo") or "organizacion"))
    print(f"actores nuevos a crear: {len(nuevos)} | descartados: {descartados}")

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )

        n_caso = 0
        for cid, uid in sorted(pares_caso):
            cur.execute(
                """insert into core.casos_actores
                     (caso_id, actor_id, nivel_influencia, posicion, vigente_desde)
                   select %s::uuid, %s::uuid, 50, 'Neutral', current_date
                    where not exists (select 1 from core.casos_actores x
                                       where x.caso_id=%s::uuid and x.actor_id=%s::uuid)""",
                (cid, uid, cid, uid),
            )
            n_caso += cur.rowcount

        n_actor = 0
        for nombre, tipo in nuevos:
            cur.execute(
                """insert into core.actores
                     (nombre_actual, naturaleza, tipo_actor_id, rol_actor_id,
                      origen_dato, nivel_clasificacion, nivel_identificacion_id,
                      es_validado_humano)
                   values (%s,%s,%s,7,'AVISA_HISTORICO',2,3,false)""",
                (
                    nombre[:255],
                    "persona" if tipo == "persona" else "organizacion",
                    2 if tipo == "persona" else 2,
                ),
            )
            n_actor += cur.rowcount
        conn.commit()
        print(f"COMMIT: {n_caso} caso-actor y {n_actor} actores nuevos.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    for tabla in ("casos_actores", "actores"):
        cur.execute(f"select count(*) from core.{tabla}")
        print(f"core.{tabla}:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
