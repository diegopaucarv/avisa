"""Verifica la verdad duplicada alerta<->demanda y el padding de IDs de alerta."""

import os
import re
from collections import Counter, defaultdict

import openpyxl

XLSX = os.path.join(
    os.path.dirname(__file__), "..", "backend", "BASE_CONFLICTOS_SOCIALES_2026.xlsx"
)
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)


def txt(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return s or None


def sheet(name):
    ws = wb[name]
    rows = [
        r
        for r in ws.iter_rows(values_only=True)
        if any(c is not None and str(c).strip() != "" for c in r)
    ]
    width = max(len(r) for r in rows)
    return [list(r) + [None] * (width - len(r)) for r in rows[1:]]


alertas = sheet("DIM_Alertas")
a_ids = [txt(r[0]) for r in alertas]
demandas = sheet("DIM_Demandas")
d_ids = [txt(r[0]) for r in demandas]
d_alerta = {txt(r[0]): txt(r[4]) for r in demandas}
bridge = sheet("BRIDGE_Alerta_Demandas")

print(
    "IDs de alerta en DIM_Alertas:",
    a_ids[:6],
    "... formatos:",
    Counter(re.sub(r"\d", "9", x or "") for x in a_ids).most_common(),
)
print(
    "IDs de alerta en BRIDGE:",
    Counter(re.sub(r"\d", "9", txt(r[2]) or "") for r in bridge).most_common(),
)


def norm(a):
    """AT-2026-1 -> AT-2026-01"""
    if not a:
        return None
    m = re.match(r"^(.*?)(\d+)$", a)
    if not m:
        return a
    return f"{m.group(1)}{int(m.group(2)):02d}"


a_norm = {norm(a): a for a in a_ids}
print("\nAlertas distintas (crudo):", len(set(a_ids)), "| normalizado:", len(a_norm))
print(
    "Bridge alertas (crudo):",
    len({txt(r[2]) for r in bridge}),
    "| normalizado:",
    len({norm(txt(r[2])) for r in bridge}),
)
print(
    "Bridge alertas que siguen sin existir:",
    sorted({norm(txt(r[2])) for r in bridge} - set(a_norm)),
)

b_pairs = {(norm(txt(r[2])), txt(r[4])) for r in bridge}
# Solo los códigos AT- son alertas: los valores CS-/RR-/TEMA- de ID_ALERTA son
# datos corruptos que nunca existirán en DIM_Alertas ni en el bridge.
c_pairs = {
    (norm(d_alerta[d]), d)
    for d in d_alerta
    if d_alerta[d] and d_alerta[d].startswith("AT-")
}
no_at = sum(1 for d in d_alerta if d_alerta[d] and not d_alerta[d].startswith("AT-"))
print(
    f"\nPares (alerta,demanda) AT-: bridge={len(b_pairs)} columna={len(c_pairs)} union={len(b_pairs | c_pairs)}"
)
print(f"  coinciden: {len(b_pairs & c_pairs)}")
print(f"  solo en bridge: {len(b_pairs - c_pairs)}")
print(f"  solo en columna: {len(c_pairs - b_pairs)}")
phantom = {(a, d) for a, d in (b_pairs | c_pairs) if a not in set(a_norm)}
validos = (b_pairs | c_pairs) - phantom
print(
    f"  pares con alerta inexistente (fantasma): {len(phantom)} -> validos={len(validos)} en {len({d for _, d in validos})} demandas"
)
print(f"  ID_ALERTA no-AT excluidos (CS-/RR-/TEMA-): {no_at}")
print(
    f"  demanda(s) con alerta contradictoria: {len({d for _, d in (b_pairs ^ c_pairs) if d in {x for _, x in b_pairs} and d in {x for _, x in c_pairs}})}"
)

# ¿la columna es un subconjunto? ¿el bridge?
print(
    f"  demandas: bridge={len({d for _, d in b_pairs})} columna={len({d for _, d in c_pairs})} union={len({d for _, d in b_pairs | c_pairs})}"
)

# Alertas con más de un caso
multi = defaultdict(set)
for r in demandas:
    if txt(r[4]) and txt(r[3]):
        multi[norm(txt(r[4]))].add(txt(r[3]))
print(
    f"\nAlertas con >1 caso en dim_demandas: {sum(1 for k, v in multi.items() if len(v) > 1)}"
)

# demanda con varios tematicas por alerta
tema_por_demanda = defaultdict(set)
for r in demandas:
    if txt(r[5]):
        tema_por_demanda[txt(r[0])].add(txt(r[5]))
print(
    f"Demandas con >1 tematica: {sum(1 for v in tema_por_demanda.values() if len(v) > 1)}"
)

# Chequeo: ¿bridge temática coincide con la de la demanda?
dif = 0
for r in bridge:
    d = txt(r[4])
    bt = txt(r[3])
    dt = next((txt(x[5]) for x in demandas if txt(x[0]) == d), None)
    if bt and dt and bt != dt:
        dif += 1
print(
    f"Bridge: filas donde ID_Tematica != tematica de la demanda: {dif} de {len(bridge)}"
)
