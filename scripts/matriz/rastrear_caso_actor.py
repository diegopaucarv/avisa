#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rastrea el ORIGEN de los codigos de caso que quedaron sin resolver en
legacy.bridge_caso_actor (columna id_caso = c03).

Solo lectura:
  - Conexion con default_transaction_read_only=on + conn.read_only = True.
  - No ejecuta INSERT/UPDATE/DELETE/DDL.
  - Busca el codigo exacto en TODAS las columnas de texto de legacy y core.
  - Sigue la cadena hasta core.casos (via cualquier uuid de la fila + 1 salto).
  - Comprueba colision de CS-PRODUCE-2026-037 / -038 con CS-PRODUCE-2026-015.

Salida: scripts/matriz/salida/rastreo_caso_actor.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
except ImportError as exc:  # pragma: no cover
    print(f"ERROR: falta psycopg (v3): {exc}", file=sys.stderr)
    raise SystemExit(2)


# --------------------------------------------------------------------------- #
# Configuracion del encargo
# --------------------------------------------------------------------------- #
CODIGOS = [
    "CS-PA-REG-2026-01",
    "CS-PA-REG-2026-04",
    "CS-PRODUCE-2026-037",
    "CS-PRODUCE-2026-038",
    "CS-PRODUCE-2026-06",
    "CS-PRODUCE-2026-07",
]
CODIGO_COLISION = "CS-PRODUCE-2026-015"
CODIGOS_COLISION = ("CS-PRODUCE-2026-037", "CS-PRODUCE-2026-038")

TEXT_TYPES = {
    "character varying",
    "character",
    "text",
    "citext",
    "bpchar",
    "name",
}
CANONICAS = {
    "fact_casos",
    "dim_alertas",
    "dim_reporte_rapido",
    "fact_proceso_reporte",
    "mapa_matriz_excel",
}
PUENTE = ("legacy", "bridge_caso_actor")
CASO_REF_KEYS = {
    "caso_id",
    "id_caso",
    "caso",
    "idcaso",
    "caso_uuid",
    "uuid_caso",
    "id_caso_fk",
    "caso_fk",
}
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def es_puente(schema: str, table: str) -> bool:
    """Tablas espejo del puente (sintoma, no origen)."""
    return schema == "legacy" and table.lower().startswith("bridge")


def es_fuente_real(schema: str, table: str) -> bool:
    return schema == "core" or table in CANONICAS


# --------------------------------------------------------------------------- #
# Utilidades de entorno / conexion
# --------------------------------------------------------------------------- #
def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def cargar_env(root: Path) -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for nombre in (".env", ".env.local"):
        p = root / nombre
        if p.exists():
            load_dotenv(p, override=False)


def normalizar_dsn(dsn: str | None) -> str | None:
    if not dsn:
        return None
    dsn = dsn.strip()
    if dsn.startswith("postgres://"):
        dsn = "postgresql://" + dsn[len("postgres://") :]
    dsn = re.sub(r"^postgresql\+\w+://", "postgresql://", dsn)
    return dsn


def resolver_dsn() -> tuple[str | None, str]:
    for clave in ("DATABASE_URL", "APP_DATABASE_URL", "DB_URL", "AVISA_DATABASE_URL"):
        val = os.environ.get(clave)
        if val:
            return normalizar_dsn(val), clave
    db = os.environ.get("POSTGRES_DB")
    user = os.environ.get("POSTGRES_USER")
    if db and user:
        pwd = quote(os.environ.get("POSTGRES_PASSWORD", ""), safe="")
        host = os.environ.get("POSTGRES_HOST", "localhost")
        port = os.environ.get("POSTGRES_PORT", "5432")
        return f"postgresql://{user}:{pwd}@{host}:{port}/{db}", "POSTGRES_*"
    return None, ""


def describir_dsn(dsn: str) -> str:
    try:
        u = urlsplit(dsn)
        return f"{u.scheme}://{u.username}@{u.hostname}:{u.port}/{u.path.lstrip('/')}"
    except Exception:
        return "<dsn>"


def conectar(dsn: str) -> "psycopg.Connection":
    conn = psycopg.connect(
        dsn,
        autocommit=True,
        connect_timeout=15,
        options="-c default_transaction_read_only=on",
    )
    try:
        conn.read_only = True
    except Exception:
        with conn.cursor() as cur:
            cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    return conn


def fetch(conn, query, params=None):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params)
        return cur.fetchall()


# --------------------------------------------------------------------------- #
# Inventario de columnas de texto
# --------------------------------------------------------------------------- #
def inventario_texto(conn) -> dict[tuple[str, str], list[str]]:
    filas = fetch(
        conn,
        """
        SELECT table_schema, table_name, column_name, data_type
          FROM information_schema.columns
         WHERE table_schema IN ('legacy', 'core')
         ORDER BY table_schema, table_name, ordinal_position
        """,
    )
    tablas: dict[tuple[str, str], list[str]] = {}
    for f in filas:
        if (f["data_type"] or "").lower() in TEXT_TYPES:
            tablas.setdefault((f["table_schema"], f["table_name"]), []).append(
                f["column_name"]
            )
    return tablas


def pk_columnas(conn, schema: str, table: str, cache: dict) -> list[str]:
    clave = (schema, table)
    if clave in cache:
        return cache[clave]
    try:
        filas = fetch(
            conn,
            """
            SELECT a.attname
              FROM pg_index i
              JOIN pg_attribute a
                ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = to_regclass(%s) AND i.indisprimary
            """,
            (f"{schema}.{table}",),
        )
        cols = [f["attname"] for f in filas]
    except Exception:
        cols = []
    cache[clave] = cols
    return cols


def buscar_en_tabla(conn, schema, table, columnas, valores, limite=5000):
    cond = sql.SQL(" OR ").join(
        sql.SQL("t.{c}::text = ANY(%(vals)s)").format(c=sql.Identifier(c))
        for c in columnas
    )
    base = sql.SQL(
        "SELECT t.ctid::text AS __ctid, to_jsonb(t) AS __row "
        "FROM {tbl} t WHERE ({cond}) LIMIT {lim}"
    ).format(
        tbl=sql.Identifier(schema, table),
        cond=cond,
        lim=sql.Literal(int(limite)),
    )
    try:
        return fetch(conn, base, {"vals": list(valores)})
    except Exception:
        base2 = sql.SQL(
            "SELECT NULL::text AS __ctid, to_jsonb(t) AS __row "
            "FROM {tbl} t WHERE ({cond}) LIMIT {lim}"
        ).format(
            tbl=sql.Identifier(schema, table),
            cond=cond,
            lim=sql.Literal(int(limite)),
        )
        return fetch(conn, base2, {"vals": list(valores)})


def ident_fila(conn, schema, table, data, ctid, cache) -> str:
    pks = pk_columnas(conn, schema, table, cache)
    if pks:
        partes = [f"{p}={data.get(p)}" for p in pks if data.get(p) is not None]
        if partes:
            return ",".join(partes)
    return f"ctid={ctid}" if ctid else "fila"


# --------------------------------------------------------------------------- #
# core.casos
# --------------------------------------------------------------------------- #
def meta_casos(conn, cache) -> dict | None:
    filas = fetch(
        conn,
        """
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'casos'
         ORDER BY ordinal_position
        """,
    )
    nombres = [f["column_name"] for f in filas]
    if not nombres:
        return None
    pks = pk_columnas(conn, "core", "casos", cache)
    id_col = "id" if "id" in nombres else (pks[0] if pks else nombres[0])
    cod_cols = [c for c in nombres if "codigo" in c.lower()]
    return {"id_col": id_col, "cod_cols": cod_cols, "cols": nombres}


def casos_por_id(conn, meta, ids):
    ids = [i for i in dict.fromkeys(ids) if i and UUID_RE.match(i)]
    if not ids or not meta:
        return {}
    sel = sql.SQL(", ").join(
        [sql.Identifier(meta["id_col"])] + [sql.Identifier(c) for c in meta["cod_cols"]]
    )
    q = sql.SQL("SELECT {sel} FROM core.casos WHERE {idc}::text = ANY(%(ids)s)").format(
        sel=sel, idc=sql.Identifier(meta["id_col"])
    )
    return {str(r[meta["id_col"]]): r for r in fetch(conn, q, {"ids": ids})}


def casos_por_codigo(conn, meta, valores):
    valores = [v for v in dict.fromkeys(valores) if v]
    if not valores or not meta or not meta["cod_cols"]:
        return {}
    sel = sql.SQL(", ").join(
        [sql.Identifier(meta["id_col"])] + [sql.Identifier(c) for c in meta["cod_cols"]]
    )
    cond = sql.SQL(" OR ").join(
        sql.SQL("{c}::text = ANY(%(v)s)").format(c=sql.Identifier(c))
        for c in meta["cod_cols"]
    )
    q = sql.SQL("SELECT {sel} FROM core.casos WHERE ({cond})").format(
        sel=sel, cond=cond
    )
    return {str(r[meta["id_col"]]): r for r in fetch(conn, q, {"v": valores})}


def refs_fila(data: dict):
    salida = []
    for col, val in data.items():
        if col.startswith("__") or val is None:
            continue
        if col.lower() in CASO_REF_KEYS:
            texto = str(val).strip()
            if texto:
                salida.append((col, texto))
    return salida


def candidatos_caso(data: dict) -> dict[str, str]:
    """uuid presente en la fila -> columna (para verificar contra core.casos)."""
    out: dict[str, str] = {}
    for col, val in refs_fila(data):
        if UUID_RE.match(val):
            out[val] = col
    for col, val in data.items():
        if col.startswith("__") or not isinstance(val, str):
            continue
        v = val.strip()
        if UUID_RE.match(v):
            out.setdefault(v, col)
    return out


def _corto(v, n=48) -> str:
    s = str(v)
    return s if len(s) <= n else s[: n - 1] + "..."


def dossier(conn, occ, cache, limite=14) -> dict:
    pks = pk_columnas(conn, occ["schema"], occ["table"], cache)
    ident = ident_fila(
        conn, occ["schema"], occ["table"], occ["data"], occ["ctid"], cache
    )
    campos = []
    for k, v in occ["data"].items():
        if k.startswith("__") or v is None:
            continue
        lk = k.lower()
        if (
            k in pks
            or lk.endswith("_id")
            or "caso" in lk
            or "codigo" in lk
            or "estado" in lk
            or "tipo" in lk
        ):
            campos.append(f"{k}={_corto(v)}")
        if len(campos) >= limite:
            break
    return {
        "tabla": f"{occ['schema']}.{occ['table']}",
        "id": ident,
        "columnas": campos,
    }


# --------------------------------------------------------------------------- #
# Puente legacy.bridge_caso_actor
# --------------------------------------------------------------------------- #
def analizar_puente(conn):
    filas = fetch(
        conn,
        """
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'legacy' AND table_name = 'bridge_caso_actor'
         ORDER BY ordinal_position
        """,
    )
    nombres = [f["column_name"] for f in filas]
    if not nombres:
        return None

    def elegir(candidatos, alternos):
        for c in candidatos:
            if c in nombres:
                return c
        for c in alternos:
            if c in nombres:
                return c
        return None

    c_rel = elegir(["id_relacion", "relacion_id"], ["c01"])
    c_act = elegir(["id_actor", "actor_id"], ["c02"])
    c_cas = elegir(["id_caso", "caso_id"], ["c03"])
    if not (c_rel and c_act and c_cas):
        return None

    q = sql.SQL(
        "SELECT {r}::text AS rel, {a}::text AS act, {c}::text AS cas "
        "FROM legacy.bridge_caso_actor WHERE {c}::text = ANY(%(codes)s)"
    ).format(
        r=sql.Identifier(c_rel),
        a=sql.Identifier(c_act),
        c=sql.Identifier(c_cas),
    )
    filas = fetch(conn, q, {"codes": CODIGOS})
    por_codigo: dict[str, list[dict]] = {c: [] for c in CODIGOS}
    for f in filas:
        if f["cas"] in por_codigo:
            por_codigo[f["cas"]].append(f)
    return {"cols": {"rel": c_rel, "act": c_act, "cas": c_cas}, "filas": por_codigo}


def filas_puente_por_caso(conn, puente, valor):
    if not puente:
        return []
    inm = puente["cols"]
    q = sql.SQL(
        "SELECT {r}::text AS rel, {a}::text AS act, {c}::text AS cas "
        "FROM legacy.bridge_caso_actor WHERE {c}::text = %(v)s"
    ).format(
        r=sql.Identifier(inm["rel"]),
        a=sql.Identifier(inm["act"]),
        c=sql.Identifier(inm["cas"]),
    )
    return fetch(conn, q, {"v": valor})


def filas_puente_por_pares(conn, puente, pares):
    """Filas del puente con el mismo (id_relacion, id_actor) y c03 ya resuelto (uuid)."""
    if not puente or not pares:
        return []
    inm = puente["cols"]
    condiciones = []
    params = {}
    for i, (rel, act) in enumerate(pares):
        plantilla = (
            "({r}::text = %(r" + str(i) + ")s AND {a}::text = %(a" + str(i) + ")s)"
        )
        condiciones.append(
            sql.SQL(plantilla).format(
                r=sql.Identifier(inm["rel"]),
                a=sql.Identifier(inm["act"]),
            )
        )
        params[f"r{i}"] = rel
        params[f"a{i}"] = act
    q = sql.SQL(
        "SELECT {r}::text AS rel, {a}::text AS act, {c}::text AS cas "
        "FROM legacy.bridge_caso_actor WHERE ({cond}) AND {c}::text ~ %(uuid)s"
    ).format(
        r=sql.Identifier(inm["rel"]),
        a=sql.Identifier(inm["act"]),
        c=sql.Identifier(inm["cas"]),
        cond=sql.SQL(" OR ").join(condiciones),
    )
    params["uuid"] = (
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )
    return fetch(conn, q, params)


# --------------------------------------------------------------------------- #
# Busqueda generica por valor (para seguir la cadena)
# --------------------------------------------------------------------------- #
def buscar_valor(conn, tablas_ordenadas, valor, excluir, presupuesto, limite=12):
    encontrados = []
    for schema, table in tablas_ordenadas:
        if (schema, table) in excluir:
            continue
        columnas = tablas_ordenadas[(schema, table)]
        if not columnas:
            continue
        if presupuesto["q"] >= presupuesto["max"]:
            break
        presupuesto["q"] += 1
        try:
            filas = buscar_en_tabla(conn, schema, table, columnas, [valor], limite)
        except Exception:
            continue
        for f in filas:
            encontrados.append(
                {
                    "schema": schema,
                    "table": table,
                    "data": f["__row"],
                    "ctid": f["__ctid"],
                }
            )
        if len(encontrados) >= limite:
            break
    return encontrados


# --------------------------------------------------------------------------- #
# Resolucion de un codigo
# --------------------------------------------------------------------------- #
def resolver_caso(conn, fuentes, tablas_ordenadas, meta, cache, presupuesto, excluir):
    """Devuelve (caso_id | None, cadena, regla, estado, trazas)."""
    trazas: list[dict] = []

    cand: dict[str, tuple[dict, str]] = {}
    refs_codigo: list[tuple[dict, str, str]] = []
    for o in fuentes:
        for col, val in refs_fila(o["data"]):
            if UUID_RE.match(val):
                cand.setdefault(val, (o, col))
            else:
                refs_codigo.append((o, col, val))
        for val, col in candidatos_caso(o["data"]).items():
            cand.setdefault(val, (o, col))

    existentes = casos_por_id(conn, meta, list(cand))
    if refs_codigo:
        extra = casos_por_codigo(conn, meta, [v for _, _, v in refs_codigo])
        for k, v in extra.items():
            existentes.setdefault(k, v)

    if len(existentes) == 1:
        cid = next(iter(existentes))
        o, col = cand.get(cid, (None, "?"))
        cadena = []
        if o:
            etiqueta = ident_fila(
                conn, o["schema"], o["table"], o["data"], o["ctid"], cache
            )
            cadena.append(f"{o['schema']}.{o['table']}[{etiqueta}]")
            cadena.append(f"{o['table']}.{col} = {cid}")
        else:
            cadena.append(f"referencia de codigo = {cid}")
        cadena.append(f"-> core.casos.{meta['id_col']} = {cid}")
        return cid, cadena, "referencia directa -> core.casos", "ok", trazas

    if len(existentes) > 1:
        return (
            None,
            [f"candidatos: {sorted(existentes)}"],
            None,
            "ambiguo",
            trazas,
        )

    # Un salto: buscar los uuid de las filas fuente en el resto de la BD
    frontera = list(
        dict.fromkeys(v for o in fuentes for v in candidatos_caso(o["data"]))
    )
    vistos: set[str] = set()
    for _ in range(2):
        nuevos: dict[str, tuple[str, dict, str]] = {}
        for val in frontera[:6]:
            if val in vistos:
                continue
            vistos.add(val)
            hits = buscar_valor(
                conn, tablas_ordenadas, val, excluir, presupuesto, limite=12
            )
            for hit in hits:
                if (hit["schema"], hit["table"]) == ("core", "casos"):
                    continue
                if es_puente(hit["schema"], hit["table"]):
                    continue
                d = dossier(conn, hit, cache, limite=8)
                d["buscado"] = val
                if len(trazas) < 10:
                    trazas.append(d)
                for col2, rv in candidatos_caso(hit["data"]).items():
                    if rv == val:
                        continue
                    nuevos.setdefault(rv, (val, hit, col2))
        if not nuevos:
            break
        existentes2 = casos_por_id(conn, meta, list(nuevos))
        if len(existentes2) == 1:
            cid = next(iter(existentes2))
            val, hit, col2 = nuevos[cid]
            src = next(
                (o for o in fuentes if val in candidatos_caso(o["data"])),
                fuentes[0],
            )
            etiqueta = ident_fila(
                conn, src["schema"], src["table"], src["data"], src["ctid"], cache
            )
            col_val = candidatos_caso(src["data"]).get(val, "?")
            cadena = [
                f"{src['schema']}.{src['table']}[{etiqueta}].{col_val} = {val}",
                f"-> {hit['schema']}.{hit['table']}.{col2} = {cid}",
                f"-> core.casos.{meta['id_col']} = {cid}",
            ]
            return cid, cadena, "cadena en dos saltos -> core.casos", "ok", trazas
        if len(existentes2) > 1:
            return (
                None,
                [f"candidatos en salto: {sorted(existentes2)}"],
                None,
                "ambiguo",
                trazas,
            )
        frontera = list(nuevos.keys())

    return None, [], None, "sin_enlace", trazas


def analizar_codigo(
    conn, code, ocurrencias, tablas_ordenadas, meta, cache, presupuesto
):
    occs = ocurrencias.get(code, [])
    aparece_en = sorted({f"{o['schema']}.{o['table']}.{o['col']}" for o in occs})
    fuentes = [o for o in occs if not es_puente(o["schema"], o["table"])]
    solo_puente = len(fuentes) == 0
    reales = [o for o in fuentes if es_fuente_real(o["schema"], o["table"])]

    cadena: list[str] = []
    caso_id: str | None = None
    regla: str | None = None
    veredicto = "imposible"
    motivo = ""

    if solo_puente:
        motivo = (
            "Solo aparece en el puente y sus espejos (legacy.bridge_*): "
            "el bloque de origen NO se importo a ninguna tabla fuente."
        )
    else:
        excluir = set()
        for st in tablas_ordenadas:
            if es_puente(st[0], st[1]):
                excluir.add(st)
        excluir.add(("core", "casos"))
        excluir |= {(o["schema"], o["table"]) for o in fuentes}

        caso_id, cadena, regla, estado, trazas = resolver_caso(
            conn, fuentes, tablas_ordenadas, meta, cache, presupuesto, excluir
        )

        dossiers = [dossier(conn, o, cache) for o in reales[:6]]
        for t in trazas:
            if len(dossiers) < 10 and t not in dossiers:
                dossiers.append(t)

        if estado == "ok" and caso_id:
            veredicto = "seguro"
            motivo = (
                "Se verifica la cadena hasta core.casos; el caso existe y el "
                "codigo queda identificado de forma univoca."
            )
        elif estado == "ambiguo":
            veredicto = "dudoso"
            motivo = "La cadena alcanza varios casos distintos; no es univoca."
        else:
            veredicto = "dudoso"
            if reales:
                tablas_reales = ", ".join(
                    sorted({f"{o['schema']}.{o['table']}.{o['col']}" for o in reales})
                )
                motivo = (
                    f"Existe traza en {tablas_reales}, pero NO hay enlace "
                    "verificable a core.casos (no hay caso creado/asignado)."
                )
            else:
                motivo = (
                    "Aparece solo en tablas no canonicas (posible staging) y "
                    "sin columna de enlace a caso verificable."
                )
        # La cadena util muestra el origen aunque no haya caso
        if not cadena:
            cadena = [
                f"{o['schema']}.{o['table']}[{d['id']}].{o['col']} = {code!r}"
                for o, d in zip(reales[:6], dossiers)
            ]
            if cadena:
                cadena.append("-> sin enlace a core.casos")
        return {
            "aparece_en": aparece_en,
            "cadena": cadena,
            "caso_id": caso_id,
            "veredicto": veredicto,
            "motivo": motivo,
            "regla": regla,
            "solo_puente": False,
            "fuentes_reales": sorted(
                {f"{o['schema']}.{o['table']}.{o['col']}" for o in reales}
            ),
            "dossier": dossiers,
        }

    return {
        "aparece_en": aparece_en,
        "cadena": [f"legacy.bridge_caso_actor.c03 = {code!r} (sintoma, no origen)"],
        "caso_id": None,
        "veredicto": "imposible",
        "motivo": motivo,
        "regla": None,
        "solo_puente": True,
        "fuentes_reales": [],
        "dossier": [],
    }


# --------------------------------------------------------------------------- #
# Colision -037 / -038 contra -015
# --------------------------------------------------------------------------- #
def analizar_colision(conn, meta, puente, code):
    if not puente or not meta:
        return None
    c015 = casos_por_codigo(conn, meta, [CODIGO_COLISION])
    if not c015:
        return {
            "caso_015": None,
            "colision": False,
            "motivo": "No se encontro CS-PRODUCE-2026-015 en core.casos.",
        }
    caso_015 = next(iter(c015))
    filas_015 = filas_puente_por_caso(conn, puente, caso_015)
    filas_code = puente["filas"].get(code, [])

    pares_015 = {(f["rel"], f["act"]) for f in filas_015}
    pares_code = {(f["rel"], f["act"]) for f in filas_code}
    compartidos = sorted(pares_015 & pares_code)

    # Filas del puente con el mismo (relacion, actor) ya resueltas a un uuid
    otras = filas_puente_por_pares(conn, puente, list(pares_code))
    otros_casos = casos_por_id(conn, meta, [f["cas"] for f in otras])
    colision_indirecta = caso_015 in otros_casos

    m = re.search(r"(\d+)$", code)
    n_code = int(m.group(1)) if m else None
    m = re.search(r"(\d+)$", CODIGO_COLISION)
    n_015 = int(m.group(1)) if m else None

    colision = bool(compartidos) or colision_indirecta

    if colision_indirecta:
        motivo = (
            f"COLISION INDIRECTA: el par (id_relacion,id_actor) de {code} ya "
            f"esta resuelto en el puente al caso {caso_015} ({CODIGO_COLISION}). "
            "Asignarlo de nuevo duplicaria la relacion."
        )
    elif compartidos:
        motivo = (
            f"COLISIONA directamente: {len(compartidos)} par(es) "
            f"(id_relacion,id_actor) coinciden con filas del caso {caso_015} "
            f"({CODIGO_COLISION})."
        )
    else:
        motivo = (
            f"No colisiona con {CODIGO_COLISION} (caso {caso_015}): "
            f"no comparte (id_relacion,id_actor) y el numero {n_code} != {n_015}. "
            "El rango numerado de core.casos llega a 035, asi que 037/038 estan "
            "fuera de serie; un recorte al maximo existente apuntaria a 035, no a 015."
        )

    return {
        "caso_015": caso_015,
        "codigos_015": {
            k: c015[caso_015].get(k) for k in (meta["cod_cols"] if meta else [])
        },
        "colision": colision,
        "colision_directa": bool(compartidos),
        "colision_indirecta": colision_indirecta,
        "pares_compartidos": [
            {"id_relacion": r, "id_actor": a} for r, a in compartidos
        ],
        "pares_resueltos": [
            {"id_relacion": f["rel"], "id_actor": f["act"], "caso_id": f["cas"]}
            for f in otras
        ],
        "numeros": {"codigo": n_code, "codigo_015": n_015},
        "filas_015": len(filas_015),
        "filas_codigo": len(filas_code),
        "motivo": motivo,
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    root = repo_root()
    cargar_env(root)
    dsn, origen = resolver_dsn()
    if not dsn:
        print(
            "ERROR: no hay DSN. Defina DATABASE_URL (o POSTGRES_* en .env).",
            file=sys.stderr,
        )
        return 2

    print(f"DSN ({origen}): {describir_dsn(dsn)}")
    conn = conectar(dsn)
    print("Conexion READ-ONLY establecida.\n")

    cache: dict = {}
    tablas = inventario_texto(conn)
    tablas_ordenadas = {
        st: tablas[st]
        for st in sorted(
            tablas,
            key=lambda st: (
                0 if st[0] == "core" else 1,
                0 if st[1] in CANONICAS else 1,
                st[0],
                st[1],
            ),
        )
    }
    print(f"Tablas con columnas de texto: {len(tablas_ordenadas)}")
    meta = meta_casos(conn, cache)
    if meta:
        print(f"core.casos: id={meta['id_col']} codigos={meta['cod_cols']}")
    else:
        print("ADVERTENCIA: no se encontro core.casos")
    puente = analizar_puente(conn)
    if puente:
        print(f"Puente: columnas {puente['cols']}")
    else:
        print("ADVERTENCIA: no se pudo leer legacy.bridge_caso_actor")

    ocurrencias: dict[str, list[dict]] = {c: [] for c in CODIGOS}
    for schema, table in tablas_ordenadas:
        columnas = tablas_ordenadas[(schema, table)]
        try:
            filas = buscar_en_tabla(conn, schema, table, columnas, CODIGOS)
        except Exception as exc:
            print(f"  ! {schema}.{table}: {exc}")
            continue
        for f in filas:
            data = f["__row"] or {}
            for code in CODIGOS:
                for col in columnas:
                    val = data.get(col)
                    if val is None:
                        continue
                    if str(val).strip() == code:
                        ocurrencias[code].append(
                            {
                                "schema": schema,
                                "table": table,
                                "col": col,
                                "data": data,
                                "ctid": f["__ctid"],
                            }
                        )

    resultados: dict[str, dict] = {}
    for code in CODIGOS:
        presupuesto = {"q": 0, "max": 160}
        res = analizar_codigo(
            conn, code, ocurrencias, tablas_ordenadas, meta, cache, presupuesto
        )
        if code in CODIGOS_COLISION:
            res["colision_015"] = analizar_colision(conn, meta, puente, code)
        res["filas_bridge"] = len(puente["filas"].get(code, [])) if puente else 0
        resultados[code] = res

    print("\n" + "=" * 118)
    print(f"{'CODIGO':<24} {'FILAS':>5}  {'VEREDICTO':<10} {'CASO_ID':<38} ORIGEN")
    print("=" * 118)
    reglas: dict[str, int] = {}
    filas_totales = 0
    filas_seguras = 0
    filas_potenciales = 0
    filas_sin_origen = 0
    for code in CODIGOS:
        r = resultados[code]
        filas_totales += r["filas_bridge"]
        if r["veredicto"] == "seguro":
            filas_seguras += r["filas_bridge"]
            if r["regla"]:
                reglas[r["regla"]] = reglas.get(r["regla"], 0) + r["filas_bridge"]
        elif r["solo_puente"]:
            filas_sin_origen += r["filas_bridge"]
        else:
            filas_potenciales += r["filas_bridge"]
        origen_txt = ", ".join(r["aparece_en"]) if r["aparece_en"] else "(nada)"
        if len(origen_txt) > 46:
            origen_txt = origen_txt[:43] + "..."
        print(
            f"{code:<24} {r['filas_bridge']:>5}  {r['veredicto']:<10} "
            f"{(r['caso_id'] or '-'):<38} {origen_txt}"
        )
        print(f"    motivo: {r['motivo']}")
        if r.get("colision_015"):
            print(f"    colision -015: {r['colision_015']['motivo']}")
    print("=" * 118)
    print(f"Filas en el puente: {filas_totales}")
    print(f"Recuperables con caso verificado (seguro): {filas_seguras}")
    print(f"Con traza de origen pero sin caso creado (dudoso): {filas_potenciales}")
    print(f"Sin bloque de origen importado (imposible): {filas_sin_origen}")
    if reglas:
        print("Regla(s) de recuperacion directa:")
        for regla, n in sorted(reglas.items(), key=lambda x: -x[1]):
            print(f"  - {regla}: {n} fila(s)")

    if filas_seguras == 0:
        print(
            "VEREDICTO FINAL: 0/18 filas recuperables con evidencia en la BD. "
            f"{filas_potenciales} tienen traza (proceso_instancia) sin caso; "
            f"{filas_sin_origen} no tienen bloque de origen importado."
        )

    salida = {
        "generado_en": datetime.now(timezone.utc).isoformat(),
        "readonly": True,
        "fuente": describir_dsn(dsn),
        "codigos": resultados,
        "resumen": {
            "filas_totales": filas_totales,
            "filas_recuperables": filas_seguras,
            "filas_con_traza_sin_caso": filas_potenciales,
            "filas_sin_origen": filas_sin_origen,
            "recuperables_por_regla": reglas,
            "regla_general": (
                "Resolver por core.casos.codigo_legado/codigo_caso o por "
                "caso_id verificable; si el codigo solo vive en legacy.bridge_* "
                "no hay origen importado."
            ),
        },
    }
    destino = root / "scripts" / "matriz" / "salida" / "rastreo_caso_actor.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(
        json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nJSON escrito en: {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
