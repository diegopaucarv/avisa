"""Auditoria de cobertura: curaduria (docs/diccionario) vs catalogo vivo.

Solo lectura. Imprime mediciones en texto plano.
"""

import ast
import collections
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "migration"))

import curacion_legacy as CL
import curacion_v10 as CV
import curacion_v10_columnas as CC
import curacion_vistas as CVI

EXCL = ("public", "information_schema")


def q(sql):
    cmd = [
        "docker",
        "exec",
        "-i",
        "avisa-db",
        "psql",
        "-U",
        "avisa",
        "-d",
        "avisa",
        "-A",
        "-F",
        "\x1f",
        "-t",
        "-c",
        sql,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        raise SystemExit("psql fallo: " + out.stderr)
    rows = []
    for line in out.stdout.splitlines():
        if line.strip():
            rows.append(line.split("\x1f"))
    return rows


SCHEMA_FILTER = (
    "n.nspname not in ('public','information_schema') and n.nspname not like 'pg_%'"
)

# --- tablas fisicas y su condicion de particion ---
tablas = q(f"""
select n.nspname||'.'||c.relname,
       c.relkind,
       case when exists (select 1 from pg_inherits i where i.inhrelid = c.oid) then 'hija' else 'raiz' end,
       (select count(*) from pg_inherits i where i.inhparent = c.oid)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and {SCHEMA_FILTER}
order by 1
""")

tipo_tabla = {}
for t, kind, hija, nhijas in tablas:
    tipo_tabla[t] = (kind, hija, int(nhijas))

# --- columnas ---
cols = q(f"""
select n.nspname||'.'||c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnum,
       coalesce(col_description(c.oid, a.attnum), '')
from pg_attribute a join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p')
  and {SCHEMA_FILTER}
order by 1, a.attnum
""")

# --- vistas y matviews ---
vistas = q(f"""
select n.nspname||'.'||c.relname, c.relkind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v','m') and {SCHEMA_FILTER}
order by 1
""")

# --- comentarios de tabla ---
coment_tabla = {}
for t, com in q(f"""
select n.nspname||'.'||c.relname, coalesce(obj_description(c.oid,'pg_class'),'')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p','v','m') and {SCHEMA_FILTER}
"""):
    coment_tabla[t] = com

v10_schemas = {t.split(".")[0] for t in tipo_tabla if not t.startswith("legacy.")}
tablas_v10 = {t for t in tipo_tabla if not t.startswith("legacy.")}
# tabla logica = raiz (no hija de otra)
tablas_logicas = {t for t in tablas_v10 if tipo_tabla[t][1] == "raiz"}
tablas_hijas = {t for t in tablas_v10 if tipo_tabla[t][1] == "hija"}
tablas_legacy = {t for t in tipo_tabla if t.startswith("legacy.")}

cols_v10 = [c for c in cols if not c[0].startswith("legacy.")]
cols_legacy = [c for c in cols if c[0].startswith("legacy.")]
cols_logicas = [c for c in cols_v10 if c[0] in tablas_logicas]
cols_hijas = [c for c in cols_v10 if c[0] in tablas_hijas]

print("== INVENTARIO VIVO ==")
print("esquemas v10:", len(v10_schemas))
print(
    "tablas fisicas v10:",
    len(tablas_v10),
    "| logicas:",
    len(tablas_logicas),
    "| particiones hijas:",
    len(tablas_hijas),
)
print("tablas legacy:", len(tablas_legacy))
print(
    "columnas fisicas v10:",
    len(cols_v10),
    "| logicas:",
    len(cols_logicas),
    "| en hijas:",
    len(cols_hijas),
    "| legacy:",
    len(cols_legacy),
)
print("vistas/matviews:", len(vistas))

# --- PROPOSITO ---------------------------------------------------------
print("\n== PROPOSITO (tablas v10) ==")
P = CV.PROPOSITO
print("entradas:", len(P))
faltan = sorted(tablas_logicas - set(P))
sobran = sorted(set(P) - tablas_logicas)
print("tablas logicas sin proposito:", len(faltan))
for t in faltan:
    print("  FALTA", t)
print("entradas que no existen en catalogo:", len(sobran))
for t in sobran:
    detalle = (
        "existe como vista/matview"
        if any(v[0] == t for v in vistas)
        else ("es una particion hija" if t in tablas_hijas else "no existe")
    )
    print("  SOBRA", t, "->", detalle)


# --- duplicados de clave literal (AST) ---------------------------------
def claves_literal(fichero, var):
    src = open(os.path.join(ROOT, "migration", fichero), encoding="utf-8").read()
    arbol = ast.parse(src)
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == var for t in nodo.targets
        ):
            if isinstance(nodo.value, ast.Dict):
                claves = [
                    k.value for k in nodo.value.keys if isinstance(k, ast.Constant)
                ]
                repetidas = [k for k, n in collections.Counter(claves).items() if n > 1]
                return len(claves), repetidas
    return None, None


print("\n== CLAVES DUPLICADAS EN EL CODIGO ==")
for fichero, var in [
    ("curacion_v10.py", "PROPOSITO"),
    ("curacion_v10_columnas.py", "COLUMNAS"),
    ("curacion_vistas.py", "PROPOSITO"),
    ("curacion_vistas.py", "QUE_LEE"),
    ("curacion_vistas.py", "FRESCURA"),
    ("curacion_legacy.py", "PROPOSITO"),
    ("curacion_legacy.py", "COLUMNAS"),
]:
    try:
        n, rep = claves_literal(fichero, var)
    except Exception as e:  # noqa: BLE001
        print(f"  {fichero}:{var} no evaluable:", e)
        continue
    print(
        f"  {fichero}:{var} claves={n} duplicadas={len(rep) if rep else 0}", rep or ""
    )

# --- COLUMNAS v10 ------------------------------------------------------
print("\n== COLUMNAS (v10) ==")
D = CC.COLUMNAS
print("entradas:", len(D))
vivas = {t + "." + c for t, c, *_ in cols_logicas}
faltan_col = sorted(vivas - set(D))
sobran_col = sorted(set(D) - vivas)
print("columnas logicas vivas sin descripcion:", len(faltan_col))
por_tabla = collections.Counter(
    c.split(".")[0] + "." + c.split(".")[1] for c in faltan_col
)
for t, n in sorted(por_tabla.items()):
    print(f"  FALTA {n:3d}  {t}")
for c in faltan_col[:40]:
    print("   ej:", c)
print("entradas sin columna viva:", len(sobran_col))
for c in sobran_col[:60]:
    tab = c.rsplit(".", 1)[0]
    motivo = (
        "tabla no existe" if tab not in tablas_v10 else "columna eliminada/renombrada"
    )
    print("  SOBRA", c, "->", motivo)

# cobertura por esquema
print("\n-- cobertura por esquema (columnas logicas) --")
cub = collections.Counter()
tot = collections.Counter()
for t, c, *_ in cols_logicas:
    tot[t.split(".")[0]] += 1
    if t + "." + c in D:
        cub[t.split(".")[0]] += 1
for s in sorted(tot):
    print(f"  {s:14s} {cub[s]:4d}/{tot[s]:4d}")

# --- COLUMNAS legacy ---------------------------------------------------
print("\n== LEGACY ==")
PL = CL.PROPOSITO
CLM_nested = CL.COLUMNAS
CLM = {t + "." + c: d for t, cols_ in CLM_nested.items() for c, d in cols_.items()}
print("PROPOSITO entradas:", len(PL), "| tablas legacy vivas:", len(tablas_legacy))
f_leg = sorted(t.replace("legacy.", "", 1) for t in tablas_legacy if t not in PL)
s_leg = sorted(t for t in PL if t not in tablas_legacy)
# claves legacy pueden ir sin prefijo
f_leg2 = sorted(
    t for t in tablas_legacy if t not in PL and t.replace("legacy.", "", 1) not in PL
)
s_leg2 = sorted(
    k for k in PL if ("legacy." + k) not in tablas_legacy and k not in tablas_legacy
)
print("tablas sin proposito:", len(f_leg2), [t for t in f_leg2][:10])
print("entradas de proposito sobrantes:", len(s_leg2), s_leg2[:10])
print("COLUMNAS legacy entradas:", len(CLM))
leg_vivas = {c[0].replace("legacy.", "", 1) + "." + c[1] for c in cols_legacy}
falt_leg = sorted(leg_vivas - set(CLM))
sob_leg = sorted(set(CLM) - leg_vivas)
print(
    "columnas legacy vivas:",
    len(leg_vivas),
    "| sin ficha:",
    len(falt_leg),
    "| fichas sin columna:",
    len(sob_leg),
)
print("  ejemplos sin ficha:", falt_leg[:8])
# columnas legacy con comentario en la base
con_com = [c for c in cols_legacy if c[4]]
print("columnas legacy con COMMENT en la base:", len(con_com))

# --- VISTAS ------------------------------------------------------------
print("\n== VISTAS ==")
VP = CVI.PROPOSITO
viv_v = {v[0] for v in vistas}
print("entradas proposito:", len(VP), "| vistas/matview vivas:", len(viv_v))
print("sin proposito:", len(sorted(viv_v - set(VP))), sorted(viv_v - set(VP)))
print("sobrantes:", len(sorted(set(VP) - viv_v)), sorted(set(VP) - viv_v)[:20])
QL = CVI.QUE_LEE
FL = CVI.FRESCURA
print("QUE_LEE entradas:", len(QL), "| FRESCURA:", len(FL))
print("vistas sin QUE_LEE:", sorted(viv_v - set(QL)))
print("QUE_LEE sobrantes:", sorted(set(QL) - viv_v))

# --- comentarios -------------------------------------------------------
print("\n== COMENTARIOS EN LA BASE ==")
sin_com_tabla = sorted(t for t in tablas_logicas if not coment_tabla.get(t))
print("tablas logicas sin COMMENT:", len(sin_com_tabla), sin_com_tabla)
sin_com_col = [c for c in cols_logicas if not c[4]]
print("columnas logicas sin COMMENT:", len(sin_com_col))
for c in sin_com_col[:20]:
    print("   ", c[0] + "." + c[1], c[2])
part_sin = [c for c in cols_hijas if not c[4]]
print("columnas en particiones sin COMMENT:", len(part_sin))
print(
    "tablas hijas sin COMMENT:",
    len([t for t in tablas_hijas if not coment_tabla.get(t)]),
)

# --- nivel_clasificacion ----------------------------------------------
print("\n== COLUMNAS DE CLASIFICACION ==")
clas = q(f"""
select n.nspname||'.'||c.relname, a.attname, format_type(a.atttypid,a.atttypmod)
from pg_attribute a join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where a.attnum>0 and not a.attisdropped and {SCHEMA_FILTER}
  and (a.attname like '%clasific%' or a.attname like '%sensibilidad%'
       or a.attname in ('nivel_acceso','nivel_seguridad','nivel_reserva','clasificacion'))
order by 1, 2
""")
for t, c, tipo in clas:
    print("  ", t + "." + c, "->", tipo)
