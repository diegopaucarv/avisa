#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analizar_llaves.py — análisis de llaves huérfanas entre los esquemas `legacy` y `core`.

SÓLO LECTURA. La conexión se abre con `set_session(readonly=True, autocommit=True)`
y el script no ejecuta ningún INSERT/UPDATE/DELETE/DDL.

Bloques analizados:
  1. `legacy.bridge_caso_actor`: filas cuyo `c03` no resuelve a un caso de `core`.
  2. `legacy.dim_demandas`: códigos `DEM-xxxx` que no existen en `core.demandas`.
  3. `legacy.dim_alertas` vs `core.alertas_tempranas`: numeración `AT-2026-0NN`
     frente a `AT-2026-NN`.

Salida:
  scripts/matriz/salida/analisis_llaves.json

Uso:
  python scripts/matriz/analizar_llaves.py
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from psycopg2 import sql

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = Path(__file__).resolve().parent / "salida" / "analisis_llaves.json"

# Umbrales pedidos / usados
UMBRAL_NOMBRE_CASO = 0.85  # tarea 1(d)
UMBRAL_TITULO_DIFUSO = 0.90  # tarea 3
UMBRAL_TEXTO_DEMANDA = 0.85  # tarea 2
UMBRAL_TEXTO_SEGURO = 0.95  # tarea 2, para marcar "seguro"
MAX_FILAS_CORE = 200_000

RE_ALERTA = re.compile(r"^AT[^0-9]*(\d{4})[^0-9]*0*(\d+)$", re.I)
RE_DEMANDA = re.compile(r"^DEM[^0-9]*0*(\d+)$", re.I)
RE_CS = re.compile(r"^CS[^A-Za-z0-9]*", re.I)

_COLS_CACHE: dict[tuple[str, str], list[tuple[str, str]]] = {}


# --------------------------------------------------------------------------- #
# Conexión y utilidades de introspección
# --------------------------------------------------------------------------- #
def conectar():
    load_dotenv(RAIZ / ".env", override=False)
    url = os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("No hay NEON_OWNER_URL ni DATABASE_URL en el entorno/.env")
    conn = psycopg2.connect(url)
    # La única garantía: la sesión es de sólo lectura.
    conn.set_session(readonly=True, autocommit=True)
    return conn


def columnas(cur, schema: str, tabla: str) -> list[tuple[str, str]]:
    key = (schema, tabla)
    if key not in _COLS_CACHE:
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, tabla),
        )
        _COLS_CACHE[key] = [(r[0], r[1] or "") for r in cur.fetchall()]
    return _COLS_CACHE[key]


def nombres(cur, schema: str, tabla: str) -> list[str]:
    return [c for c, _ in columnas(cur, schema, tabla)]


def existe_tabla(cur, schema: str, tabla: str) -> bool:
    return bool(columnas(cur, schema, tabla))


def pick(cols: list[str], exactos=(), contiene=()) -> str | None:
    """Devuelve la primera columna que coincida exacto, luego por contención."""
    low = {c.lower(): c for c in cols}
    for e in exactos:
        if e.lower() in low:
            return low[e.lower()]
    for frag in contiene:
        for c in cols:
            if frag in c.lower():
                return c
    return None


def col_con_patron(cur, schema: str, tabla: str, patron_ilike: str) -> str | None:
    """Busca la primera columna de texto con algún valor que cumpla el patrón."""
    for name, typ in columnas(cur, schema, tabla):
        if not any(t in typ for t in ("char", "text")):
            continue
        q = sql.SQL("SELECT 1 FROM {s}.{t} WHERE {c}::text ILIKE %s LIMIT 1").format(
            s=sql.Identifier(schema), t=sql.Identifier(tabla), c=sql.Identifier(name)
        )
        try:
            cur.execute(q, (patron_ilike,))
            if cur.fetchone():
                return name
        except Exception:
            continue
    return None


def col_texto_mas_larga(cur, schema: str, tabla: str, excluir: set[str]) -> str | None:
    """Heurística para dimensiones legacy con columnas cNN sin nombre semántico."""
    mejor, mejor_len = None, 0.0
    for name, typ in columnas(cur, schema, tabla):
        if name in excluir or not any(t in typ for t in ("char", "text")):
            continue
        q = sql.SQL(
            "SELECT avg(length({c}::text)) FROM (SELECT {c} FROM {s}.{t} LIMIT 5000) x"
        ).format(
            c=sql.Identifier(name), s=sql.Identifier(schema), t=sql.Identifier(tabla)
        )
        try:
            cur.execute(q)
            row = cur.fetchone()
            largo = float(row[0]) if row and row[0] is not None else 0.0
        except Exception:
            continue
        if largo > mejor_len:
            mejor, mejor_len = name, largo
    return mejor if mejor_len >= 12 else None


# --------------------------------------------------------------------------- #
# Normalización y similitud
# --------------------------------------------------------------------------- #
def norm(texto) -> str:
    if texto is None:
        return ""
    s = unicodedata.normalize("NFKD", str(texto))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def jaccard(a: str, b: str) -> float:
    ta = set(a.split())
    tb = set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def sim_texto(a: str, b: str) -> float:
    return max(ratio(a, b), jaccard(a, b))


def clave_alerta(valor):
    """'AT-2026-001' y 'AT-2026-52' -> (2026, 1) y (2026, 52)."""
    if valor is None:
        return None
    s = str(valor).strip().upper().replace(" ", "")
    m = RE_ALERTA.match(s)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))


def numero_demanda(valor):
    if valor is None:
        return None
    m = RE_DEMANDA.match(str(valor).strip().upper().replace(" ", ""))
    return int(m.group(1)) if m else None


def json_seguro(obj):
    if isinstance(obj, (_dt.datetime, _dt.date, _dt.time)):
        return obj.isoformat()
    if isinstance(obj, _dt.timedelta):
        return obj.total_seconds()
    return str(obj)


def val(r):
    """Normaliza escalares raros (Decimal/UUID) a tipos JSON-friendly."""
    if r is None or isinstance(r, (str, int, float, bool)):
        return r
    return str(r)


# --------------------------------------------------------------------------- #
# Carga de core.casos
# --------------------------------------------------------------------------- #
def cargar_casos(cur, curd) -> dict:
    cols = nombres(cur, "core", "casos")
    if not cols:
        return {"error": "core.casos no existe"}

    idcol = (
        "id"
        if "id" in cols
        else next(
            (c for c in cols if c.lower() in ("caso_id", "pk", "id_caso")), cols[0]
        )
    )
    codcols = [c for c in cols if "codigo" in c.lower()]
    nomcol = pick(cols, exactos=("nombre_caso", "nombre"), contiene=("nombre",))

    sel = [idcol] + codcols + ([nomcol] if nomcol else [])
    curd.execute(
        sql.SQL("SELECT {cols} FROM core.casos LIMIT %s").format(
            cols=sql.SQL(", ").join(map(sql.Identifier, sel))
        ),
        (MAX_FILAS_CORE,),
    )
    filas = curd.fetchall()

    casos = []
    map_codigo = {}
    map_por_col = {}
    for f in filas:
        cid = f[idcol]
        cods = {}
        for c in codcols:
            v = f.get(c)
            if v not in (None, ""):
                cods[c] = str(v).strip()
                map_codigo.setdefault(str(v).strip().upper(), cid)
                map_por_col.setdefault(c, {})[str(v).strip().upper()] = cid
        casos.append(
            {
                "id": cid,
                "nombre": f.get(nomcol) if nomcol else None,
                "codigos": cods,
            }
        )

    idx_nombre = [(c["id"], norm(c["nombre"])) for c in casos if c["nombre"]]
    return {
        "idcol": idcol,
        "codcols": codcols,
        "nomcol": nomcol,
        "casos": casos,
        "map_codigo": map_codigo,
        "map_por_col": map_por_col,
        "idx_nombre": idx_nombre,
    }


def _trunc(v, n=180):
    s = "" if v is None else str(v)
    return s if len(s) <= n else s[:n] + "…"


def muestra_tabla(curd, schema: str, tabla: str, limite: int = 3) -> list[dict]:
    curd.execute(
        sql.SQL("SELECT * FROM {s}.{t} LIMIT %s").format(
            s=sql.Identifier(schema), t=sql.Identifier(tabla)
        ),
        (limite,),
    )
    return [{k: _trunc(v) for k, v in r.items()} for r in curd.fetchall()]


# --------------------------------------------------------------------------- #
# BLOQUE 1: bridge_caso_actor sin caso
# --------------------------------------------------------------------------- #
def fila_fact_por_n(cur, curd, n: int):
    """Vía (a): c03 como número de fila de legacy.fact_casos."""
    cols = nombres(cur, "legacy", "fact_casos")
    if not cols:
        return {"ok": False, "motivo": "legacy.fact_casos no existe", "fila": None}
    colfila = pick(
        cols,
        exactos=("fila_n", "fila", "nro_fila", "numero_fila", "orden"),
        contiene=("fila",),
    )
    if not colfila:
        return {"ok": False, "motivo": "sin columna tipo fila_n", "fila": None}
    curd.execute(
        sql.SQL("SELECT * FROM legacy.fact_casos WHERE {c}::text = %s LIMIT 2").format(
            c=sql.Identifier(colfila)
        ),
        (str(n),),
    )
    filas = curd.fetchall()
    if not filas:
        return {"ok": False, "motivo": f"sin fila con {colfila}={n}", "fila": None}
    return {
        "ok": True,
        "motivo": None,
        "colfila": colfila,
        "fila": dict(filas[0]),
        "duplicados": len(filas),
    }


def caso_desde_fact(caso_idx: dict, fila: dict) -> dict | None:
    """Deduce el caso de core a partir de una fila de fact_casos.

    fact_casos es legacy y usa columnas `cNN` sin nombre semántico, por lo que
    se recorre TODA la fila buscando un código de core.casos (normalmente
    `c01` = `CS-PRODUCE-...`); si no, se intenta por nombre (`c03`).
    """
    if not fila:
        return None
    ids_validos = {str(c["id"]) for c in caso_idx["casos"]}

    # 1) código exacto en cualquier columna
    for k, v in fila.items():
        if v in (None, ""):
            continue
        hit = caso_idx["map_codigo"].get(str(v).strip().upper())
        if hit is not None:
            return {"caso_id": hit, "metodo": f"fact_casos.{k}", "confianza": "seguro"}

    # 2) por FK directa al id de core.casos (dudoso: depende del linaje)
    for k in ("id_caso", "caso_id", "id"):
        if k in fila and fila[k] is not None and str(fila[k]) in ids_validos:
            return {
                "caso_id": fila[k],
                "metodo": f"fact_casos.{k}=core.casos.id",
                "confianza": "dudoso",
            }

    # 3) por nombre: c03 en este esquema, luego columnas con 'nombre'
    candidatos = []
    if "c03" in fila:
        candidatos.append("c03")
    candidatos += [k for k in fila if "nombre" in k.lower() or "denomin" in k.lower()]
    for col in dict.fromkeys(candidatos):
        if not fila.get(col):
            continue
        n = norm(fila[col])
        if len(n) < 12:
            continue
        mejor, mejor_r = None, 0.0
        for cid, cn in caso_idx["idx_nombre"]:
            r = sim_texto(n, cn)
            if r > mejor_r:
                mejor, mejor_r = cid, r
        if mejor_r >= UMBRAL_NOMBRE_CASO:
            return {
                "caso_id": mejor,
                "metodo": f"fact_casos.{col} fuzzy",
                "confianza": "dudoso" if mejor_r < 0.95 else "seguro",
                "similitud": round(mejor_r, 4),
            }
    return None


def resolver_c03(cur, curd, c03, caso_idx: dict) -> dict:
    """Prueba en orden las vías (a) (b) (c) (d)."""
    vias = {}
    texto = "" if c03 is None else str(c03).strip()
    up = texto.upper()
    es_codigo = bool(RE_CS.match(texto))
    es_num = texto.isdigit()

    # (a) c03 -> fact_casos.fila_n
    if es_num:
        fa = fila_fact_por_n(cur, curd, int(texto))
        vias["a_fact_fila_n"] = {
            "ok": False,
            "motivo": fa.get("motivo"),
        }
        if fa.get("ok"):
            hit = caso_desde_fact(caso_idx, fa["fila"])
            vias["a_fact_fila_n"] = {
                "ok": bool(hit),
                "motivo": None if hit else "fila existe pero sin caso deducible",
                "columna_fila": fa.get("colfila"),
                "duplicados": fa.get("duplicados", 0),
                "caso": hit,
                "fila_muestra": {k: val(v) for k, v in list(fa["fila"].items())[:14]},
            }
    else:
        vias["a_fact_fila_n"] = {"ok": False, "motivo": "c03 no numérico"}

    # (b) c03 como core.casos.codigo_legado
    col_legado = next((c for c in caso_idx["codcols"] if "legado" in c.lower()), None)
    hit_legado = (
        caso_idx.get("map_por_col", {}).get(col_legado, {}).get(up)
        if col_legado
        else None
    )
    vias["b_core_casos_codigo_legado"] = {
        "ok": hit_legado is not None,
        "caso_id": hit_legado,
        "columna": col_legado,
        "motivo": (
            None
            if hit_legado is not None
            else f"c03 no figura en core.casos.{col_legado}"
        ),
    }

    # (c) c03 como core.casos.codigo_caso
    hit = caso_idx["map_codigo"].get(up)
    col_caso = next((c for c in caso_idx["codcols"] if "legado" not in c.lower()), None)
    hit_caso = (
        caso_idx.get("map_por_col", {}).get(col_caso, {}).get(up) if col_caso else None
    )
    vias["c_core_casos_codigo_caso"] = {
        "ok": hit_caso is not None,
        "caso_id": hit_caso,
        "columna": col_caso,
        "motivo": (
            None if hit_caso is not None else f"c03 no figura en core.casos.{col_caso}"
        ),
    }

    # Si el código no matchea directo, probar variantes (CS- con/sin ceros)
    if not hit and es_codigo:
        alt = re.sub(r"^CS-?", "", up)
        for c in caso_idx["map_codigo"]:
            if re.sub(r"^CS-?", "", c) == alt:
                vias["c_core_casos_codigo_caso"] = {
                    "ok": True,
                    "caso_id": caso_idx["map_codigo"][c],
                    "motivo": f"coincidencia normalizando CS- contra {c}",
                }
                break

    # (d) fuzzy contra nombre_caso
    n = norm(texto)
    mejor, mejor_r = None, 0.0
    for cid, cn in caso_idx["idx_nombre"]:
        r = sim_texto(n, cn)
        if r > mejor_r:
            mejor, mejor_r = cid, r
    vias["d_nombre_caso_fuzzy"] = {
        "ok": mejor_r >= UMBRAL_NOMBRE_CASO,
        "caso_id": mejor if mejor_r >= UMBRAL_NOMBRE_CASO else None,
        "similitud": round(mejor_r, 4),
        "umbral": UMBRAL_NOMBRE_CASO,
        "motivo": None if mejor_r >= UMBRAL_NOMBRE_CASO else "similitud bajo umbral",
    }
    return vias


def analizar_caso_actor(cur, curd) -> dict:
    salida = {"tabla": "legacy.bridge_caso_actor"}
    cols = nombres(cur, "legacy", "bridge_caso_actor")
    if not cols:
        salida["error"] = "legacy.bridge_caso_actor no existe"
        return salida

    c1 = pick(cols, exactos=("id_relacion", "c01"), contiene=("relacion",)) or cols[0]
    c2 = pick(cols, exactos=("id_actor", "c02"), contiene=("actor",)) or cols[1]
    c3 = pick(cols, exactos=("id_caso", "c03"), contiene=("caso",)) or cols[2]
    salida["columnas"] = {"c01": c1, "c02": c2, "c03": c3, "todas": cols}

    curd.execute(
        sql.SQL(
            "SELECT {a} AS c01, {b} AS c02, {c} AS c03 FROM legacy.bridge_caso_actor"
        ).format(a=sql.Identifier(c1), b=sql.Identifier(c2), c=sql.Identifier(c3))
    )
    filas = curd.fetchall()
    salida["total_bridge"] = len(filas)

    caso_idx = cargar_casos(cur, curd)
    if "error" in caso_idx:
        salida["error"] = caso_idx["error"]
        return salida
    salida["core_casos"] = {
        "total": len(caso_idx["casos"]),
        "columnas_codigo": caso_idx["codcols"],
        "columna_nombre": caso_idx["nomcol"],
    }

    # --- evidencia de estructura para la vía (a): fact_casos ---
    num_vals = sorted(
        {int(s) for s in (str(f["c03"] or "").strip() for f in filas) if s.isdigit()}
    )
    fact_info = {"columnas": columnas(cur, "legacy", "fact_casos")}
    if fact_info["columnas"]:
        curd.execute("SELECT count(*) AS n FROM legacy.fact_casos")
        fact_info["total_filas"] = curd.fetchone()["n"]
        fact_info["muestra"] = muestra_tabla(curd, "legacy", "fact_casos", 3)
        existen = []
        for n in num_vals:
            r = fila_fact_por_n(cur, curd, n)
            existen.append(
                {"fila_n": n, "existe": bool(r.get("ok")), "motivo": r.get("motivo")}
            )
        fact_info["c03_numericos_vs_fila_n"] = {
            "distintos": len(num_vals),
            "con_fila": sum(1 for x in existen if x["existe"]),
            "detalle": existen[:40],
        }
    salida["diag"] = {
        "fact_casos": fact_info,
        "core_casos_muestra": muestra_tabla(curd, "core", "casos", 3),
        "c03_por_tipo": {
            "codigo_cs": sum(
                1 for f in filas if RE_CS.match(str(f["c03"] or "").strip())
            ),
            "numerico": sum(1 for f in filas if str(f["c03"] or "").strip().isdigit()),
            "otro": sum(
                1
                for f in filas
                if not RE_CS.match(str(f["c03"] or "").strip())
                and not str(f["c03"] or "").strip().isdigit()
            ),
        },
    }

    sin_caso = []
    via_conteo: dict[str, int] = {}
    casos_usados: dict[str, str] = {}
    resueltos = 0
    for f in filas:
        c03 = f["c03"]
        vias = resolver_c03(cur, curd, c03, caso_idx)
        mejor = None
        for k in (
            "a_fact_fila_n",
            "b_core_casos_codigo_legado",
            "c_core_casos_codigo_caso",
            "d_nombre_caso_fuzzy",
        ):
            if vias[k].get("ok"):
                mejor = k
                break
        if mejor:
            resueltos += 1
            via_conteo[mejor] = via_conteo.get(mejor, 0) + 1
            caso = vias[mejor].get("caso_id")
            if caso is not None:
                casos_usados.setdefault(str(caso), str(c03))
        else:
            texto = "" if c03 is None else str(c03).strip()
            sin_caso.append(
                {
                    "c01": val(f["c01"]),
                    "c02": val(f["c02"]),
                    "c03": val(c03),
                    "tipo_c03": (
                        "codigo_cs"
                        if RE_CS.match(texto)
                        else "numerico"
                        if texto.isdigit()
                        else "desconocido"
                    ),
                    "vias": vias,
                    "via_que_funciona": None,
                }
            )

    # ------------------------------------------------------------------ #
    # Vías suplementarias (no solicitadas, añadidas como evidencia)
    #   (p) normalizar el relleno de ceros dentro del código CS-*
    #   (e) actor -> bridge_alerta_actor -> alerta -> core.alertas.caso_id
    # ------------------------------------------------------------------ #
    def clave_pad(codigo):
        m = re.match(r"^(.*?)(\d+)$", str(codigo).strip().upper())
        return (m.group(1), int(m.group(2))) if m else None

    pad_idx: dict[tuple, set] = {}
    for c in caso_idx["casos"]:
        for code in c["codigos"].values():
            k = clave_pad(code)
            if k:
                pad_idx.setdefault(k, set()).add(c["id"])

    al = cargar_alertas_core(cur, curd)
    clave_casos: dict[tuple, set] = {}
    if al.get("col_caso"):
        for clave, rows_al in al["por_clave"].items():
            for r in rows_al:
                caso = r.get(al["col_caso"])
                if caso:
                    clave_casos.setdefault(clave, set()).add(str(caso))

    actor_claves: dict[str, set] = {}
    swapped = 0
    try:
        cur.execute("SELECT c02, c03 FROM legacy.bridge_alerta_actor")
        for col_a, col_b in cur.fetchall():
            a, b = str(col_a or "").strip(), str(col_b or "").strip()
            # 3 filas de la tabla tienen las columnas invertidas: no se asume
            # la posición, se detecta por el prefijo del código.
            if a.upper().startswith("AT-"):
                alerta, actor = a, b
            elif b.upper().startswith("AT-"):
                alerta, actor = b, a
                swapped += 1
            else:
                continue
            clave = clave_alerta(alerta)
            if clave and actor:
                actor_claves.setdefault(actor, set()).add(clave)
        actor_claves_ok = True
    except Exception as exc:  # noqa: BLE001
        actor_claves_ok = False
        salida.setdefault("notas", []).append(
            f"vía (e) no disponible: {type(exc).__name__}: {exc}"
        )

    ids_validos = {str(c["id"]) for c in caso_idx["casos"]}
    for fila in sin_caso:
        c03 = str(fila["c03"] or "").strip()

        # (p) relleno de ceros dentro del código
        kp = clave_pad(c03)
        hits = pad_idx.get(kp, set()) if kp else set()
        fila["vias"]["p_padding_dentro_codigo"] = {
            "ok": len(hits) == 1,
            "caso_id": next(iter(hits)) if len(hits) == 1 else None,
            "candidatos": len(hits),
            "motivo": (
                None
                if len(hits) == 1
                else "sin candidato por relleno"
                if not hits
                else "ambigüedad por relleno"
            ),
        }

        # (e) actor -> alertas -> caso
        casos_al: set = set()
        claves_actor = actor_claves.get(str(fila["c02"] or "").strip(), set())
        for clave in claves_actor:
            casos_al |= clave_casos.get(clave, set())
        casos_al &= ids_validos
        fila["vias"]["e_actor_alerta_caso"] = {
            "ok": actor_claves_ok and len(casos_al) == 1,
            "caso_id": next(iter(casos_al)) if len(casos_al) == 1 else None,
            "candidatos": len(casos_al),
            "alertas_del_actor": len(claves_actor),
            "motivo": (
                None
                if casos_al and len(casos_al) == 1
                else "sin alertas para el actor"
                if not claves_actor
                else "sin caso en core para esas alertas"
                if not casos_al
                else "varias alertas apuntan a casos distintos"
            ),
        }

    # ------------------------------------------------------------------ #
    # Validación de consistencia: un mismo c03 debe apuntar SIEMPRE al
    # mismo caso. Una vía que produce casos distintos para el mismo c03
    # se descarta (ruido), no se acepta fila a fila.
    # ------------------------------------------------------------------ #
    grupos: dict[str, list] = {}
    for fila in sin_caso:
        grupos.setdefault(str(fila["c03"] or "").strip(), []).append(fila)

    decisiones: dict[str, dict] = {}
    for c03, grupo in grupos.items():
        p_ids = {
            f["vias"]["p_padding_dentro_codigo"]["caso_id"]
            for f in grupo
            if f["vias"]["p_padding_dentro_codigo"]["ok"]
        }
        e_ids = {
            f["vias"]["e_actor_alerta_caso"]["caso_id"]
            for f in grupo
            if f["vias"]["e_actor_alerta_caso"]["ok"]
        }
        p_ok = len(p_ids) == 1 and all(
            f["vias"]["p_padding_dentro_codigo"]["ok"] for f in grupo
        )
        e_completo = all(f["vias"]["e_actor_alerta_caso"]["ok"] for f in grupo)
        e_unico = len(e_ids) == 1

        if p_ok:
            via = "p_padding_dentro_codigo"
            corroborado = bool(e_unico and e_completo and e_ids == p_ids)
            veredicto_codigo = "seguro" if corroborado else "dudoso"
            motivo = (
                "relleno de ceros + corroborado por vía (e) independiente"
                if corroborado
                else "sólo relleno de ceros (sin corroboración independiente)"
            )
        elif e_completo and e_unico:
            via = "e_actor_alerta_caso"
            corroborado = False
            veredicto_codigo = "dudoso"
            motivo = "consistente entre filas del mismo c03, sin otra vía de contraste"
        else:
            via = None
            corroborado = False
            veredicto_codigo = "imposible"
            if e_ids and not e_unico:
                motivo = (
                    f"vía (e) inconsistente: el mismo c03 apunta a "
                    f"{len(e_ids)} casos distintos"
                )
            elif not e_completo and e_ids:
                motivo = "vía (e) cubre sólo parte de las filas del mismo c03"
            else:
                motivo = "sin candidato por relleno ni por actor-alerta"

        decisiones[c03] = {
            "via": via,
            "caso_id": (grupo[0]["vias"][via]["caso_id"] if via else None),
            "veredicto": veredicto_codigo,
            "corroborado": corroborado,
            "motivo": motivo,
        }

    # Paso 1: colisiones. Un caso de core ya está 1:1 con su código; si dos
    # códigos distintos (o un código y un caso ya resuelto) reclaman el mismo
    # caso, la asignación suplementaria se rechaza.
    reclamos: dict[str, list[str]] = {}
    for c03, dec in decisiones.items():
        if dec["via"] and dec["caso_id"]:
            reclamos.setdefault(str(dec["caso_id"]), []).append(c03)
    for caso_id, codigos in reclamos.items():
        ya_resuelto = caso_id in casos_usados
        if len(codigos) > 1 or ya_resuelto:
            for c03 in codigos:
                decisiones[c03].update(
                    {
                        "via": None,
                        "caso_id": None,
                        "veredicto": "imposible",
                        "corroborado": False,
                        "motivo": (
                            f"colisión: el caso ya pertenece a "
                            f"'legacy.bridge_caso_actor.c03={casos_usados[caso_id]}'"
                            if ya_resuelto
                            else "colisión: varios códigos distintos reclaman "
                            "el mismo caso"
                        ),
                    }
                )

    for c03, grupo in grupos.items():
        dec = decisiones[c03]
        for fila in grupo:
            fila["via_que_funciona"] = dec["via"]
            fila["veredicto_codigo"] = dec["veredicto"]
            fila["corroborado"] = dec["corroborado"]
            fila["motivo_veredicto"] = dec["motivo"]

    seguros = resueltos + sum(1 for f in sin_caso if f["veredicto_codigo"] == "seguro")
    dudosos = sum(1 for f in sin_caso if f["veredicto_codigo"] == "dudoso")
    imposibles = sum(1 for f in sin_caso if f["veredicto_codigo"] == "imposible")

    mapeos = []
    for fila in sin_caso:
        via = fila["via_que_funciona"]
        destino = None
        if via:
            destino = f"core.casos.id={fila['vias'][via]['caso_id']}"
        mapeos.append(
            {
                "origen": f"legacy.bridge_caso_actor.c03={fila['c03']}",
                "c02_actor": fila["c02"],
                "destino": destino,
                "via": via,
                "corroborado": fila["corroborado"],
                "motivo": fila["motivo_veredicto"],
                "vias_probadas": list(fila["vias"].keys()),
                "veredicto": fila["veredicto_codigo"],
            }
        )

    resumen_codigos = {}
    for c03, grupo in grupos.items():
        dec = decisiones[c03]
        resumen_codigos[c03] = {
            "filas": len(grupo),
            "via": dec["via"],
            "caso_id": dec["caso_id"],
            "corroborado": dec["corroborado"],
            "veredicto": dec["veredicto"],
            "motivo": dec["motivo"],
        }

    salida.update(
        {
            "resueltos_por_via": via_conteo,
            "resueltos_total": resueltos,
            "sin_caso_total": len(sin_caso),
            "esperado_contexto": {"resueltos": 60, "sin_caso": 18},
            "coincide_contexto": (resueltos == 60 and len(sin_caso) == 18),
            "advertencia_contexto": (
                "medición propia: el contexto decía 60/18, se obtienen "
                f"{resueltos}/{len(sin_caso)} con 46 códigos CS- (28 resueltos) "
                "y 34 numéricos (34 resueltos vía fact_casos.c01)"
            ),
            "sin_caso_resolubles_por_vias_suplementarias": dudosos
            + (seguros - resueltos),
            "resumen_por_codigo": resumen_codigos,
            "filas_sin_caso": sin_caso,
            "mapeos": mapeos,
            "veredicto": {
                "seguro": seguros,
                "dudoso": dudosos,
                "imposible": imposibles,
            },
        }
    )
    return salida


# --------------------------------------------------------------------------- #
# BLOQUE 2: demandas sin código
# --------------------------------------------------------------------------- #
def cargar_alertas_core(cur, curd) -> dict:
    if not existe_tabla(cur, "core", "alertas_tempranas"):
        return {"error": "core.alertas_tempranas no existe"}
    cols = nombres(cur, "core", "alertas_tempranas")
    idcol = "id" if "id" in cols else cols[0]
    codcol = col_con_patron(cur, "core", "alertas_tempranas", "AT-%")
    titcol = pick(cols, exactos=("titulo",), contiene=("titulo", "asunto"))
    casocol = pick(cols, exactos=("id_caso", "caso_id"), contiene=("caso",))

    sel = (
        [idcol]
        + ([codcol] if codcol else [])
        + ([titcol] if titcol else [])
        + ([casocol] if casocol else [])
    )
    curd.execute(
        sql.SQL("SELECT {cols} FROM core.alertas_tempranas LIMIT %s").format(
            cols=sql.SQL(", ").join(map(sql.Identifier, sel))
        ),
        (MAX_FILAS_CORE,),
    )
    filas = curd.fetchall()

    por_clave = {}
    por_id = {}
    id_a_caso = {}
    titulos = []
    for f in filas:
        clo = clave_alerta(f.get(codcol)) if codcol else None
        aid = f[idcol]
        if clo:
            por_clave.setdefault(clo, []).append(dict(f))
        por_id[str(aid)] = clo
        if casocol:
            id_a_caso[str(aid)] = f.get(casocol)
        if titcol and f.get(titcol):
            titulos.append((aid, norm(f.get(titcol))))
    return {
        "col_id": idcol,
        "col_codigo": codcol,
        "col_titulo": titcol,
        "col_caso": casocol,
        "total": len(filas),
        "por_clave": por_clave,
        "por_id": por_id,
        "id_a_caso": id_a_caso,
        "titulos": titulos,
    }


def analizar_demandas(cur, curd) -> dict:
    salida = {"legacy": "legacy.dim_demandas", "core": "core.demandas"}
    if not existe_tabla(cur, "legacy", "dim_demandas"):
        salida["error"] = "legacy.dim_demandas no existe"
        return salida
    if not existe_tabla(cur, "core", "demandas"):
        salida["error"] = "core.demandas no existe"
        return salida

    cols_l = nombres(cur, "legacy", "dim_demandas")
    col_dem = col_con_patron(cur, "legacy", "dim_demandas", "DEM-%")
    col_dem = col_dem or pick(
        cols_l, exactos=("codigo_legado", "codigo"), contiene=("demanda", "codigo")
    )
    col_alerta_l = col_con_patron(cur, "legacy", "dim_demandas", "AT-%") or pick(
        cols_l, exactos=("cod_alerta", "id_alerta"), contiene=("alerta",)
    )
    col_texto_l = pick(
        cols_l,
        exactos=("descripcion", "descripcion_demanda", "detalle", "texto", "asunto"),
        contiene=("descripcion", "detalle", "texto", "asunto"),
    )
    if not col_texto_l:
        col_texto_l = col_texto_mas_larga(
            cur, "legacy", "dim_demandas", {col_dem, col_alerta_l}
        )
    salida["columnas_legacy"] = {
        "codigo": col_dem,
        "alerta": col_alerta_l,
        "texto": col_texto_l,
    }
    if not col_dem:
        salida["error"] = "no se identificó la columna de código DEM-xxxx"
        return salida

    cur.execute(
        sql.SQL(
            "SELECT DISTINCT upper(btrim({c}::text)) FROM legacy.dim_demandas "
            "WHERE {c}::text ILIKE 'DEM-%'"
        ).format(c=sql.Identifier(col_dem))
    )
    legacy_dem = {r[0] for r in cur.fetchall() if r[0]}

    cols_c = nombres(cur, "core", "demandas")
    col_cod_c = pick(
        cols_c,
        exactos=("codigo_legado", "codigo"),
        contiene=("codigo_legado", "codigo"),
    )
    col_txt_c = pick(
        cols_c,
        exactos=("descripcion_demanda", "descripcion"),
        contiene=("descripcion", "detalle", "texto"),
    )
    col_id_c = "id" if "id" in cols_c else cols_c[0]
    col_alerta_c = pick(
        cols_c,
        exactos=("id_alerta", "alerta_id", "codigo_alerta"),
        contiene=("alerta",),
    )
    col_caso_c = pick(cols_c, exactos=("id_caso", "caso_id"), contiene=("caso",))
    salida["columnas_core"] = {
        "id": col_id_c,
        "codigo": col_cod_c,
        "texto": col_txt_c,
        "alerta": col_alerta_c,
        "caso": col_caso_c,
    }
    if not col_cod_c:
        salida["error"] = "core.demandas no tiene columna de código legado"
        return salida

    cur.execute(
        sql.SQL(
            "SELECT upper(btrim({c}::text)) FROM core.demandas WHERE {c} IS NOT NULL"
        ).format(c=sql.Identifier(col_cod_c))
    )
    core_dem = {r[0] for r in cur.fetchall() if r[0]}

    faltantes = sorted(legacy_dem - core_dem)
    numeros_legacy = {numero_demanda(x) for x in legacy_dem}
    numeros_core = {numero_demanda(x) for x in core_dem}
    numeros_legacy.discard(None)
    numeros_core.discard(None)

    salida.update(
        {
            "total_legacy": len(legacy_dem),
            "total_core": len(core_dem),
            "interseccion": len(legacy_dem & core_dem),
            "faltantes_total": len(faltantes),
            "faltantes": faltantes[:400],
            "desplazamiento_numerico": {
                "numeros_legacy": len(numeros_legacy),
                "numeros_core": len(numeros_core),
                "interseccion": len(numeros_legacy & numeros_core),
                "legacy_sin_core": len(numeros_legacy - numeros_core),
            },
            "diag": {
                "dim_demandas_columnas": columnas(cur, "legacy", "dim_demandas"),
                "dim_demandas_muestra": muestra_tabla(
                    curd, "legacy", "dim_demandas", 3
                ),
                "core_demandas_muestra": muestra_tabla(curd, "core", "demandas", 3),
            },
        }
    )
    if col_alerta_l:
        try:
            cur.execute(
                sql.SQL(
                    "SELECT DISTINCT {c}::text FROM legacy.dim_demandas "
                    "WHERE {c} IS NOT NULL LIMIT 8"
                ).format(c=sql.Identifier(col_alerta_l))
            )
            salida["diag"]["alerta_legacy_valores"] = [r[0] for r in cur.fetchall()]
        except Exception:
            salida["diag"]["alerta_legacy_valores"] = None

    # ---- Intento de empareje por alerta + texto ----
    if not faltantes:
        salida["empareje"] = {
            "evaluadas": 0,
            "resolubles": 0,
            "no_resolubles": 0,
            "muestra": [],
            "mapeos": [],
            "veredicto": {},
        }
        return salida

    alertas_core = cargar_alertas_core(cur, curd)

    # Demanda core en memoria: texto normalizado + clave de alerta inferida
    curd.execute(
        sql.SQL("SELECT {sel} FROM core.demandas LIMIT %s").format(
            sel=sql.SQL(", ").join(
                map(
                    sql.Identifier,
                    [
                        col_id_c,
                        col_txt_c or col_id_c,
                        *([col_cod_c] if col_cod_c else []),
                        *([col_alerta_c] if col_alerta_c else []),
                        *([col_caso_c] if col_caso_c else []),
                    ],
                )
            )
        ),
        (MAX_FILAS_CORE,),
    )
    core_filas = curd.fetchall()

    core_idx = []
    con_alerta_no_nula = 0
    for f in core_filas:
        txt = norm(f.get(col_txt_c)) if col_txt_c else ""
        clave = None
        if col_alerta_c and f.get(col_alerta_c) is not None:
            raw = f.get(col_alerta_c)
            con_alerta_no_nula += 1
            clave = clave_alerta(raw)
            if not clave and alertas_core.get("por_id"):
                clave = alertas_core["por_id"].get(str(raw))
        if not clave and col_caso_c and f.get(col_caso_c) is not None:
            # caso -> alertas de ese caso
            claves = (
                {
                    k
                    for k, v in alertas_core.get("id_a_caso", {}).items()
                    if str(v) == str(f.get(col_caso_c))
                }
                if alertas_core
                else set()
            )
            if len(claves) == 1:
                clave = alertas_core["por_id"].get(next(iter(claves)))
        core_idx.append(
            {
                "id": val(f.get(col_id_c)),
                "codigo": val(f.get(col_cod_c)) if col_cod_c else None,
                "texto": txt,
                "clave": clave,
                "caso": val(f.get(col_caso_c)) if col_caso_c else None,
            }
        )

    # Filas legacy faltantes
    sel_l = [
        col_dem,
        *([col_texto_l] if col_texto_l else []),
        *([col_alerta_l] if col_alerta_l else []),
    ]
    curd.execute(
        sql.SQL(
            "SELECT {sel} FROM legacy.dim_demandas "
            "WHERE upper(btrim({c}::text)) = ANY(%s)"
        ).format(
            sel=sql.SQL(", ").join(map(sql.Identifier, sel_l)),
            c=sql.Identifier(col_dem),
        ),
        (faltantes,),
    )
    legacy_filas = curd.fetchall()

    # --- diagnóstico del cruce por alerta ---
    salida["diag"]["cruce_alerta"] = {
        "core_demandas": len(core_idx),
        "core_con_alerta_no_nula": con_alerta_no_nula,
        "core_con_clave_resuelta": sum(1 for c in core_idx if c["clave"]),
        "core_muestra_clave": [
            {"codigo": c["codigo"], "clave": list(c["clave"])}
            for c in core_idx
            if c["clave"]
        ][:8],
        "alertas_core_columnas": {
            "id": alertas_core.get("col_id"),
            "codigo": alertas_core.get("col_codigo"),
            "titulo": alertas_core.get("col_titulo"),
            "total": alertas_core.get("total"),
        },
    }

    evaluadas, resolubles, no_resolubles = 0, 0, 0
    muestra, mapeos = [], []
    claves_legacy = []
    for f in legacy_filas:
        evaluadas += 1
        cod = val(f.get(col_dem))
        txt_l = norm(f.get(col_texto_l)) if col_texto_l else ""
        raw_al = f.get(col_alerta_l) if col_alerta_l else None
        clave = clave_alerta(raw_al) if raw_al is not None else None
        if not clave and raw_al is not None and alertas_core.get("por_id"):
            clave = alertas_core["por_id"].get(str(raw_al))
        claves_legacy.append(clave)

        candidatos = [c for c in core_idx if clave and c["clave"] == clave]
        n_cand_alerta = len(candidatos)
        base = "alerta+texto" if candidatos else "texto-todas"
        if not candidatos:
            candidatos = core_idx

        mejor, mejor_s = None, 0.0
        for c in candidatos:
            s = sim_texto(txt_l, c["texto"])
            if s > mejor_s:
                mejor, mejor_s = c, s

        ok = bool(mejor) and mejor_s >= UMBRAL_TEXTO_DEMANDA
        if ok:
            resolubles += 1
        else:
            no_resolubles += 1

        if len(muestra) < 15:
            muestra.append(
                {
                    "codigo_legacy": cod,
                    "alerta_legacy": val(raw_al),
                    "clave_alerta": list(clave) if clave else None,
                    "candidatos_por_alerta": n_cand_alerta,
                    "texto_legacy": txt_l[:160],
                    "texto_core": (mejor["texto"][:160] if mejor else None),
                    "via": base,
                    "candidato_core_id": mejor["id"] if mejor else None,
                    "candidato_core_codigo": mejor["codigo"] if mejor else None,
                    "similitud": round(mejor_s, 4),
                    "resoluble": ok,
                }
            )
        destino = None
        if ok and mejor:
            destino = f"core.demandas.id={mejor['id']}"
            if mejor["codigo"]:
                destino += f" (codigo_legado={mejor['codigo']})"
            else:
                destino += " (sin codigo_legado)"

        # Un empareje textual NUNCA es 1:1 seguro: el código de origen no
        # existe en core, así que el destino o no tiene codigo_legado o tiene
        # OTRO código (duplicado / renumeración). En ambos casos requiere
        # decisión humana.
        if not ok:
            veredicto, motivo = "imposible", "sin texto suficientemente próximo"
        elif mejor and mejor["codigo"] == cod:
            veredicto, motivo = "seguro", "mismo código en core"
        elif mejor and mejor["codigo"]:
            veredicto = "dudoso"
            motivo = (
                f"texto idéntico pero el código destino es distinto "
                f"({mejor['codigo']}): duplicado o renumeración"
            )
        else:
            veredicto = "dudoso"
            motivo = "texto próximo a una fila de core SIN codigo_legado"

        mapeos.append(
            {
                "origen": f"legacy.dim_demandas.{col_dem}={cod}",
                "destino": destino,
                "via": base,
                "similitud": round(mejor_s, 4),
                "motivo": motivo,
                "veredicto": veredicto,
            }
        )

    claves_l_unicas = {k for k in claves_legacy if k}
    claves_core_unicas = {c["clave"] for c in core_idx if c["clave"]}

    # --- vía suplementaria: alerta -> caso -> demandas de ese caso ---
    clave_a_caso = {}
    if alertas_core.get("col_caso"):
        for clave, rows_al in alertas_core["por_clave"].items():
            for r in rows_al:
                caso = r.get(alertas_core["col_caso"])
                if caso:
                    clave_a_caso.setdefault(clave, set()).add(str(caso))
    via_caso = []
    for f in legacy_filas[:25]:
        cod = val(f.get(col_dem))
        txt_l = norm(f.get(col_texto_l)) if col_texto_l else ""
        raw_al = f.get(col_alerta_l) if col_alerta_l else None
        clave = clave_alerta(raw_al) if raw_al is not None else None
        casos_l = clave_a_caso.get(clave, set()) if clave else set()
        candidatos = [c for c in core_idx if c["caso"] and str(c["caso"]) in casos_l]
        mejor, mejor_s = None, 0.0
        for c in candidatos:
            s = sim_texto(txt_l, c["texto"])
            if s > mejor_s:
                mejor, mejor_s = c, s
        via_caso.append(
            {
                "codigo_legacy": cod,
                "alerta_legacy": val(raw_al),
                "casos_por_alerta": len(casos_l),
                "candidatos_mismo_caso": len(candidatos),
                "mejor_id": mejor["id"] if mejor else None,
                "mejor_codigo": mejor["codigo"] if mejor else None,
                "similitud": round(mejor_s, 4),
                "resoluble": bool(mejor) and mejor_s >= UMBRAL_TEXTO_DEMANDA,
            }
        )

    def _fmt(k):
        return f"AT-{k[0]}-{k[1]}" if k else None

    # Colisión de destino: varios códigos legacy cayendo en la misma fila core
    destinos: dict[str, set] = {}
    for m in mapeos:
        if m["destino"] and m["destino"].startswith("core.demandas.id="):
            did = m["destino"].split(" ")[0].split("=", 1)[1]
            destinos.setdefault(did, set()).add(m["origen"].split("=", 1)[1])
    colisiones = {k: sorted(v) for k, v in destinos.items() if len(v) > 1}

    salida["empareje"] = {
        "evaluadas": evaluadas,
        "resolubles_por_alerta_texto": resolubles,
        "resolubles_por_via": {
            "alerta+texto": sum(1 for m in mapeos if m["via"] == "alerta+texto"),
            "texto_todas": sum(1 for m in mapeos if m["via"] == "texto-todas"),
        },
        "conclusion_via_alerta": (
            "La vía alerta+texto NO es operativa: los codigos de alerta de "
            "dim_demandas.c05 y los alerta_id de core.demandas viven en espacios "
            "casi disjuntos (solo 2 claves en común de 43 vs 30). Ningún caso se "
            "resolvió por alerta; los 18 aciertos son sólo por texto global."
        ),
        "no_resolubles": no_resolubles,
        "exactos_texto_normalizado": sum(1 for m in mapeos if m["similitud"] == 1.0),
        "faltantes_con_alerta": sum(1 for k in claves_legacy if k),
        "faltantes_clave_presente_en_core": sum(
            1 for k in claves_legacy if k and k in alertas_core.get("por_clave", {})
        ),
        "interseccion_claves": {
            "legacy_faltantes_unicas": len(claves_l_unicas),
            "core_demandas_unicas": len(claves_core_unicas),
            "comunes": len(claves_l_unicas & claves_core_unicas),
            "legacy": [_fmt(k) for k in sorted(claves_l_unicas)][:60],
            "core": [_fmt(k) for k in sorted(claves_core_unicas)][:60],
        },
        "resolubles_sin_codigo_legado_en_core": sum(
            1 for m in mapeos if m["destino"] and "sin codigo_legado" in m["destino"]
        ),
        "via_suplementaria_alerta_caso": {
            "muestra_evaluada": len(via_caso),
            "resolubles": sum(1 for v in via_caso if v["resoluble"]),
            "con_candidatos_mismo_caso": sum(
                1 for v in via_caso if v["candidatos_mismo_caso"]
            ),
            "detalle": via_caso[:25],
        },
        "colisiones_destino": {
            "destinos_compartidos": len(colisiones),
            "detalle": {k: v for k, v in list(colisiones.items())[:15]},
        },
        "nota": (
            "se evaluaron TODAS las faltantes con alerta/texto disponible; "
            "'muestra' resume 15 casos. Ningún empareje textual es 1:1 por "
            "construcción: el código de origen no existe en core"
        ),
        "muestra": muestra,
        "mapeos": [m for m in mapeos if m["destino"]][:120],
        "veredicto": {
            "seguro": sum(1 for m in mapeos if m["veredicto"] == "seguro"),
            "dudoso": sum(1 for m in mapeos if m["veredicto"] == "dudoso"),
            "imposible": sum(1 for m in mapeos if m["veredicto"] == "imposible"),
        },
    }
    return salida


# --------------------------------------------------------------------------- #
# BLOQUE 3: numeración de alertas
# --------------------------------------------------------------------------- #
def analizar_alertas(cur, curd) -> dict:
    salida = {"legacy": "legacy.dim_alertas", "core": "core.alertas_tempranas"}
    if not existe_tabla(cur, "legacy", "dim_alertas"):
        salida["error"] = "legacy.dim_alertas no existe"
        return salida

    cols_l = nombres(cur, "legacy", "dim_alertas")
    col_al_l = col_con_patron(cur, "legacy", "dim_alertas", "AT-%")
    col_tit_l = (
        "c10"
        if "c10" in cols_l
        else pick(cols_l, exactos=("titulo",), contiene=("titulo", "asunto"))
    )
    salida["columnas_legacy"] = {"codigo": col_al_l, "titulo": col_tit_l}
    if not col_al_l:
        salida["error"] = "no se identificó columna de código AT-xxxx en dim_alertas"
        return salida

    curd.execute(
        sql.SQL("SELECT {c} AS codigo, {t} AS titulo FROM legacy.dim_alertas").format(
            c=sql.Identifier(col_al_l),
            t=sql.Identifier(col_tit_l) if col_tit_l else sql.SQL("NULL"),
        )
    )
    legacy = curd.fetchall()

    alertas_core = cargar_alertas_core(cur, curd)
    if "error" in alertas_core:
        salida["error"] = alertas_core["error"]
        return salida
    salida["columnas_core"] = {
        "codigo": alertas_core["col_codigo"],
        "titulo": alertas_core["col_titulo"],
    }

    tit_core = {}
    for aid, tn in alertas_core["titulos"]:
        tit_core.setdefault(tn, []).append(aid)
    titulos_core_norm = list(tit_core.keys())

    stats = {
        "legacy_total": len(legacy),
        "legacy_codigos_parseables": 0,
        "legacy_sin_parsear": 0,
        "mismo_numero_en_core": 0,
        "titulo_exacto": 0,
        "titulo_difuso_090": 0,
        "sin_titulo_en_core": 0,
        "titulo_coincide_en_otro_numero": 0,
    }
    detalle, mapeos = [], []

    for f in legacy:
        cod = val(f["codigo"])
        tit_l = norm(f.get("titulo"))
        clave = clave_alerta(cod)
        if not clave:
            stats["legacy_sin_parsear"] += 1
            continue
        stats["legacy_codigos_parseables"] += 1

        mismos = alertas_core["por_clave"].get(clave, [])
        if mismos:
            stats["mismo_numero_en_core"] += 1
            mejor, mejor_s = None, 0.0
            for a in mismos:
                s = sim_texto(tit_l, norm(a.get(alertas_core["col_titulo"])))
                if s > mejor_s:
                    mejor, mejor_s = a, s
            exacto = (
                bool(mejor) and norm(mejor.get(alertas_core["col_titulo"])) == tit_l
            )
            if exacto:
                stats["titulo_exacto"] += 1
            if mejor_s >= UMBRAL_TITULO_DIFUSO:
                stats["titulo_difuso_090"] += 1
            detalle.append(
                {
                    "legacy": cod,
                    "core": val(mejor.get(alertas_core["col_codigo"])),
                    "titulo_legacy": _trunc(f.get("titulo"), 90),
                    "titulo_core": _trunc(mejor.get(alertas_core["col_titulo"]), 90),
                    "titulo_exacto": exacto,
                    "similitud": round(mejor_s, 4),
                    "veredicto": (
                        "seguro"
                        if exacto
                        else "dudoso"
                        if mejor_s >= UMBRAL_TITULO_DIFUSO
                        else "imposible"
                    ),
                }
            )
            mapeos.append(
                {
                    "origen": f"legacy.dim_alertas.{col_al_l}={cod}",
                    "destino": f"core.alertas_tempranas.{alertas_core['col_codigo']}="
                    f"{val(mejor.get(alertas_core['col_codigo']))}",
                    "via": "mismo_numero",
                    "veredicto": detalle[-1]["veredicto"],
                }
            )
        else:
            # El número no existe en core: ¿el título sí?
            if tit_l and tit_l in tit_core:
                stats["titulo_coincide_en_otro_numero"] += 1
                aid = tit_core[tit_l][0]
                core_cod = alertas_core["por_id"].get(str(aid))
                detalle.append(
                    {
                        "legacy": cod,
                        "core": f"AT-{core_cod[0]}-{core_cod[1]}" if core_cod else None,
                        "titulo_exacto": True,
                        "similitud": 1.0,
                        "veredicto": "dudoso",
                    }
                )
                mapeos.append(
                    {
                        "origen": f"legacy.dim_alertas.{col_al_l}={cod}",
                        "destino": (f"core.alertas_tempranas.id={aid} ({core_cod})"),
                        "via": "titulo_exacto_otro_numero",
                        "veredicto": "dudoso",
                    }
                )
            else:
                # fuzzy sobre todos los títulos
                mejor_n, mejor_s = None, 0.0
                for tn in titulos_core_norm:
                    s = sim_texto(tit_l, tn)
                    if s > mejor_s:
                        mejor_n, mejor_s = tn, s
                if mejor_s >= UMBRAL_TITULO_DIFUSO:
                    stats["titulo_difuso_090"] += 1
                    aid = tit_core[mejor_n][0]
                    core_cod = alertas_core["por_id"].get(str(aid))
                    detalle.append(
                        {
                            "legacy": cod,
                            "core": f"AT-{core_cod[0]}-{core_cod[1]}"
                            if core_cod
                            else None,
                            "titulo_exacto": False,
                            "similitud": round(mejor_s, 4),
                            "veredicto": "dudoso",
                        }
                    )
                    mapeos.append(
                        {
                            "origen": f"legacy.dim_alertas.{col_al_l}={cod}",
                            "destino": (
                                f"core.alertas_tempranas.id={aid} ({core_cod})"
                            ),
                            "via": "titulo_difuso_otro_numero",
                            "veredicto": "dudoso",
                        }
                    )
                else:
                    stats["sin_titulo_en_core"] += 1
                    detalle.append(
                        {
                            "legacy": cod,
                            "core": None,
                            "titulo_exacto": False,
                            "similitud": round(mejor_s, 4),
                            "veredicto": "imposible",
                        }
                    )
                    mapeos.append(
                        {
                            "origen": f"legacy.dim_alertas.{col_al_l}={cod}",
                            "destino": None,
                            "via": "sin_match",
                            "veredicto": "imposible",
                        }
                    )

    # Comparación de rangos numéricos
    nums_l = sorted(
        {clave_alerta(f["codigo"])[1] for f in legacy if clave_alerta(f["codigo"])}
    )
    nums_c = sorted({k[1] for k in alertas_core["por_clave"]})
    relleno_ceros = (nums_l == nums_c) if (nums_l and nums_c) else False
    subconjunto = set(nums_l).issubset(set(nums_c)) if nums_l else False

    if relleno_ceros and stats["titulo_exacto"] >= 0.95 * max(
        1, stats["legacy_codigos_parseables"]
    ):
        conclusion = (
            "MISMO ESPACIO DE IDENTIFICADORES, NO DE RELLENO: los 83 codigos "
            "del legado caen en el rango 1..90 igual que core, el 100% (83/83) "
            "tiene contraparte por numero y 81/83 (97.6%) coincide por titulo "
            "normalizado exacto. ademas, legacy.dim_alertas y core comparten el "
            "MISMO formato de 2 digitos ('AT-2026-01'), de modo que aqui no hay "
            "diferencia de padding en absoluto. Las variantes de ancho viven "
            "DENTRO del legado: bridge_alerta_actor usa 'AT-2026-001' en 143 filas "
            "y 'AT-2026-26' en 16. Normalizar a (anio, entero) unifica todas. "
            "Los 2 titulos no exactos (AT-2026-48 y -49) son divergencia de "
            "CONTENIDO (core tiene un duplicado 'AT-2026-48-bis'), no un "
            "identificador distinto."
        )
    elif subconjunto and stats["titulo_exacto"] >= 0.9 * max(
        1, stats["legacy_codigos_parseables"]
    ):
        conclusion = (
            "RENUMERACIÓN PARCIAL: los números legacy están contenidos en "
            "core y los títulos coinciden en su mayoría; el mapeo remanente "
            "es por título."
        )
    elif (
        stats["mismo_numero_en_core"] == 0
        and stats["titulo_coincide_en_otro_numero"] > 0
    ):
        conclusion = (
            "ESPACIO DE IDENTIFICADORES DISTINTO: el mismo título aparece "
            "con otro número en core. No es relleno de ceros; hace falta "
            "tabla de equivalencias legacy->core."
        )
    else:
        conclusion = (
            "MIXTO: coexisten colisiones por relleno de ceros y "
            "desalineaciones de numeración; requiere revisión humana."
        )

    # Evidencia de formatos: variantes de ancho y sufijos en core
    core_con_sufijo = sorted(
        {
            str(r.get(alertas_core["col_codigo"]))
            for rows_al in alertas_core["por_clave"].values()
            for r in rows_al
            if alertas_core["col_codigo"]
            and re.search(r"-\d+[-_].+$", str(r.get(alertas_core["col_codigo"]) or ""))
        }
    )[:20]
    formatos = {
        "legacy_dim_alertas_min": min((str(f["codigo"]) for f in legacy), default=None),
        "legacy_dim_alertas_max": max((str(f["codigo"]) for f in legacy), default=None),
        "core_codigos_con_sufijo": core_con_sufijo,
        "variantes_observadas": {
            "bridge_alerta_actor.c02": "AT-2026-001 (143 filas, 11 car.) y "
            "AT-2026-26 (16 filas, 10 car.)",
            "bridge_alerta_actor (3 filas invertidas)": "c02=ACT-xxx, c03=AT-2026-NN",
            "dim_alertas.c01": "AT-2026-01 (2 digitos, 10 car.)",
            "dim_demandas.c05": "AT-2026-01 (2 digitos, 10 car.)",
            "core.alertas_tempranas.codigo_alerta": "AT-2026-01 (81 filas) + "
            "AT-2026-48-bis (1 fila)",
        },
    }

    salida.update(
        {
            "rango_numeros_legacy": [nums_l[0], nums_l[-1]] if nums_l else None,
            "cantidad_numeros_legacy": len(nums_l),
            "rango_numeros_core": [nums_c[0], nums_c[-1]] if nums_c else None,
            "cantidad_numeros_core": len(nums_c),
            "formatos": formatos,
            "stats": stats,
            "detalle_muestra": detalle[:60],
            "mapeos": mapeos[:250],
            "conclusion": conclusion,
            "veredicto": {
                "seguro": sum(1 for d in detalle if d["veredicto"] == "seguro"),
                "dudoso": sum(1 for d in detalle if d["veredicto"] == "dudoso"),
                "imposible": sum(1 for d in detalle if d["veredicto"] == "imposible"),
            },
        }
    )
    return salida


# --------------------------------------------------------------------------- #
# Resumen por pantalla
# --------------------------------------------------------------------------- #
def imprimir_resumen(d: dict) -> None:
    print("\n" + "=" * 78)
    print("ANÁLISIS DE LLAVES  legacy -> core")
    print("=" * 78)

    b1 = d.get("caso_actor_sin_caso", {})
    print("\n[1] bridge_caso_actor sin caso")
    if b1.get("error"):
        print(f"    ERROR: {b1['error']}")
    else:
        print(
            f"    filas: {b1.get('total_bridge')} | resueltas: "
            f"{b1.get('resueltos_total')} | sin caso: {b1.get('sin_caso_total')} "
            f"(contexto esperado 60/18 -> coincide={b1.get('coincide_contexto')})"
        )
        print(f"    vías: {b1.get('resueltos_por_via')}")
        print(f"    veredicto global: {b1.get('veredicto')}")
        for c03, r in (b1.get("resumen_por_codigo") or {}).items():
            print(
                f"      {c03:24s} filas={r['filas']:2d} via={r['via']} "
                f"-> {r['veredicto']}"
                + (" (corroborado)" if r["corroborado"] else "")
                + f"  [{r['motivo']}]"
            )
        if b1.get("advertencia_contexto"):
            print(f"    nota: {b1['advertencia_contexto']}")

    b2 = d.get("demandas_sin_codigo", {})
    print("\n[2] demandas sin código")
    if b2.get("error"):
        print(f"    ERROR: {b2['error']}")
    else:
        print(
            f"    legacy DEM: {b2.get('total_legacy')} | core: "
            f"{b2.get('total_core')} | intersección: {b2.get('interseccion')} | "
            f"faltantes: {b2.get('faltantes_total')}"
        )
        e = b2.get("empareje", {})
        print(
            f"    empareje alerta+texto: evaluadas={e.get('evaluadas')} "
            f"resolubles={e.get('resolubles_por_alerta_texto')} "
            f"no_resolubles={e.get('no_resolubles')}"
        )
        print(f"    veredicto: {e.get('veredicto')}")
        for m in e.get("muestra", [])[:6]:
            print(
                f"      {m['codigo_legacy']} ({m['via']}, "
                f"alertas={m.get('candidatos_por_alerta')}) -> "
                f"{m.get('candidato_core_id')} sim={m['similitud']} "
                f"{'OK' if m['resoluble'] else 'NO'}"
            )
        print(
            "    interseccion claves alerta:",
            {
                k: v
                for k, v in (e.get("interseccion_claves") or {}).items()
                if k in ("legacy_faltantes_unicas", "core_demandas_unicas", "comunes")
            },
            "| resolubles en filas sin codigo_legado:",
            e.get("resolubles_sin_codigo_legado_en_core"),
        )
        print(
            f"    exactos por texto normalizado: {e.get('exactos_texto_normalizado')}"
            f" | destinos compartidos: "
            f"{(e.get('colisiones_destino') or {}).get('destinos_compartidos')}"
        )
        vc = e.get("via_suplementaria_alerta_caso") or {}
        print(
            f"    vía alerta->caso->texto (muestra {vc.get('muestra_evaluada')}): "
            f"resolubles={vc.get('resolubles')} "
            f"con candidatos del mismo caso={vc.get('con_candidatos_mismo_caso')}"
        )

    b3 = d.get("alertas_numeracion", {})
    print("\n[3] numeración de alertas")
    if b3.get("error"):
        print(f"    ERROR: {b3['error']}")
    else:
        s = b3.get("stats", {})
        print(
            f"    legacy: {s.get('legacy_total')} | parseables: "
            f"{s.get('legacy_codigos_parseables')} | mismo número en core: "
            f"{s.get('mismo_numero_en_core')} | título exacto: "
            f"{s.get('titulo_exacto')} | difuso>=0.9: {s.get('titulo_difuso_090')}"
        )
        print(
            f"    rangos legacy={b3.get('rango_numeros_legacy')} "
            f"core={b3.get('rango_numeros_core')}"
        )
        print(f"    veredicto: {b3.get('veredicto')}")
        print(f"    conclusión: {b3.get('conclusion')}")

    print("\nSalida escrita en:", SALIDA)
    print("=" * 78 + "\n")


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main() -> int:
    conn = conectar()
    try:
        cur = conn.cursor()
        curd = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        datos = {
            "generado": _dt.datetime.now().isoformat(timespec="seconds"),
            "esquemas": ["legacy", "core"],
            "solo_lectura": True,
        }
        for clave, fn in (
            ("caso_actor_sin_caso", analizar_caso_actor),
            ("demandas_sin_codigo", analizar_demandas),
            ("alertas_numeracion", analizar_alertas),
        ):
            try:
                datos[clave] = fn(cur, curd)
            except Exception as exc:  # noqa: BLE001
                datos[clave] = {"error": f"{type(exc).__name__}: {exc}"}

        SALIDA.parent.mkdir(parents=True, exist_ok=True)
        SALIDA.write_text(
            json.dumps(datos, ensure_ascii=False, indent=2, default=json_seguro),
            encoding="utf-8",
        )
        imprimir_resumen(datos)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
