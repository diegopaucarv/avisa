"""Diseño y prueba del puente legacy_case_code -> core.casos.id.

Sólo lectura. Imprime la tabla de cruce y los desajustes.
"""

import os
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
load_dotenv(RAIZ / ".env")
conn = psycopg2.connect(os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"])
conn.set_session(readonly=True, autocommit=True)
cur = conn.cursor()


def norm(texto: str | None) -> str:
    v = unicodedata.normalize("NFKD", texto or "")
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = "".join(c.lower() if c.isalnum() else " " for c in v)
    return " ".join(v.split())


# 1 · columnas reales de fact_casos
cur.execute(
    "select column_name from information_schema.columns "
    "where table_schema='legacy' and table_name='fact_casos' order by ordinal_position"
)
cols = [r[0] for r in cur.fetchall()]
cur.execute("select * from legacy.fact_casos limit 200")
filas = cur.fetchall()
print("columnas fact_casos:", cols)

# `fact_casos` usa columnas posicionales: c01 = código de caso, c03 = nombre.
col_codigo = cols.index("c01") if "c01" in cols else None
col_nombre = cols.index("c03") if "c03" in cols else None
print(
    "columna código:",
    cols[col_codigo] if col_codigo is not None else None,
    "| columna nombre:",
    cols[col_nombre] if col_nombre is not None else None,
)

legacy = []
for f in filas:
    if col_codigo is None or f[col_codigo] is None:
        continue
    legacy.append(
        (
            str(f[col_codigo]),
            str(f[col_nombre]) if col_nombre is not None and f[col_nombre] else "",
        )
    )
print(f"casos legacy: {len(legacy)}")

# 2 · core.casos
cur.execute("select id::text, codigo_caso, codigo_legado, nombre_caso from core.casos")
core = [
    {"id": r[0], "codigo": r[1], "legado": r[2], "nombre": r[3] or ""}
    for r in cur.fetchall()
]
print(f"casos core: {len(core)}")

por_legado = {c["legado"]: c for c in core if c["legado"]}
por_codigo = {c["codigo"]: c for c in core}
por_nombre = {norm(c["nombre"]): c for c in core if c["nombre"]}

print(f"\ncodigo_legado poblado en core: {len(por_legado)} de {len(core)}")
print("ejemplos codigo_legado:", list(por_legado)[:5])

# 3 · cruce
print(
    f"\n{'código legacy':26} {'nombre legacy':38} {'match':22} {'vía':10} {'ratio':>5}"
)
resumen = {
    "exacto_legado": 0,
    "exacto_codigo": 0,
    "nombre": 0,
    "difuso": 0,
    "sin_match": 0,
}
desajustes = []
for codigo, nombre in legacy:
    destino, via, ratio = None, "ninguna", 0.0
    if codigo in por_legado:
        destino, via, ratio = por_legado[codigo], "legado", 1.0
    elif codigo in por_codigo:
        destino, via, ratio = por_codigo[codigo], "codigo", 1.0
    elif norm(nombre) in por_nombre:
        destino, via, ratio = por_nombre[norm(nombre)], "nombre", 1.0
    else:
        mejor = max(
            core,
            key=lambda c: SequenceMatcher(
                None, norm(nombre), norm(c["nombre"])
            ).ratio(),
        )
        r = SequenceMatcher(None, norm(nombre), norm(mejor["nombre"])).ratio()
        if r >= 0.85:
            destino, via, ratio = mejor, "difuso", r
        else:
            ratio = r
    clave = {
        "legado": "exacto_legado",
        "codigo": "exacto_codigo",
        "nombre": "nombre",
        "difuso": "difuso",
    }.get(via, "sin_match")
    resumen[clave] += 1
    etiqueta = f"{destino['codigo']}" if destino else "—"
    print(
        f"{codigo[:26]:26} {nombre[:38]:38} {etiqueta[:22]:22} {via:10} {ratio:>5.2f}"
    )
    if via in ("difuso", "ninguna"):
        desajustes.append((codigo, nombre, etiqueta, via, ratio))

print("\nresumen:", resumen)
print("\ndesajustes a revisar:")
for d in desajustes:
    print("  ", d)
