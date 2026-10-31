"""Cuantifica cuánto de cada bridge del legado es recuperable."""

import os
from collections import Counter

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
    data = [list(r) + [None] * (width - len(r)) for r in rows[1:]]
    return data


casos = [txt(r[0]) for r in sheet("FACT_Casos")]  # ordinal -> codigo
caso_set = set(casos)


def resolver(ref):
    """Devuelve (codigo, metodo) o (None, motivo)."""
    if ref is None:
        return None, "vacio"
    if ref.replace(".", "", 1).isdigit():
        idx = int(float(ref))
        if 1 <= idx <= len(casos):
            return casos[idx - 1], f"ordinal:{idx}"
        return None, f"ordinal fuera de rango:{idx}"
    if ref in caso_set:
        return ref, "codigo"
    return None, f"codigo inexistente:{ref}"


def auditar(nombre, col_caso):
    rows = sheet(nombre)
    res = Counter()
    fallos = Counter()
    for r in rows:
        cod, metodo = resolver(txt(r[col_caso]))
        if cod:
            res[metodo.split(":")[0]] += 1
        else:
            fallos[metodo] += 1
    print(f"\n{nombre}: {len(rows)} filas")
    print(f"  recuperables: {dict(res)}  total={sum(res.values())}")
    print(f"  NO recuperables: {dict(fallos)}  total={sum(fallos.values())}")
    # ¿cuántos casos distintos quedan cubiertos?
    cubiertos = {resolver(txt(r[col_caso]))[0] for r in rows} - {None}
    print(f"  casos distintos cubiertos: {len(cubiertos)}/{len(caso_set)}")
    print(f"  casos sin ningun actor: {sorted(caso_set - cubiertos)}")


auditar("BRIDGE_Caso_Actor", 2)
auditar("BRIDGE_Caso_Actor_Estado", 2)
auditar("BRIDGE_Caso_Depto", 1)

# actores del bridge: ¿existen?
actores = {txt(r[0]) for r in sheet("DIM_Actores")}
estado = {txt(r[0]) for r in sheet("DIM_Actores_Estado")}
for nombre, col in [("BRIDGE_Caso_Actor", 1), ("BRIDGE_Caso_Actor_Estado", 1)]:
    refs = [txt(r[col]) for r in sheet(nombre)]
    print(
        f"\n{nombre}: actores {len(set(refs))} distintos; en dim_actores={len(set(refs) & actores)}; en dim_actores_estado={len(set(refs) & estado)}; huerfanos={sorted(set(refs) - actores - estado)[:10]}"
    )

# alertas <-> demandas
alerta_ids = {txt(r[0]) for r in sheet("DIM_Alertas")}
b = sheet("BRIDGE_Alerta_Demandas")
dem = {txt(r[0]): txt(r[4]) for r in sheet("DIM_Demandas")}
print(f"\nBRIDGE_Alerta_Demandas: {len(b)} filas")
print(
    f"  alertas distintas: {len({txt(r[2]) for r in b})}; inexistentes: {sorted({txt(r[2]) for r in b} - alerta_ids)[:10]}"
)
print(
    f"  demandas distintas: {len({txt(r[4]) for r in b})}; inexistentes: {sorted({txt(r[4]) for r in b} - set(dem))[:10]}"
)
# comparar con dim_demandas.id_alerta
pares_bridge = {(txt(r[2]), txt(r[4])) for r in b}
pares_col = {(dem[d], d) for d in dem if dem[d]}
print(
    f"  pares (alerta,demanda) bridge vs columna: coinciden={len(pares_bridge & pares_col)} solo_bridge={len(pares_bridge - pares_col)} solo_columna={len(pares_col - pares_bridge)}"
)
print(f"  demandas con ID_ALERTA en dim_demandas: {sum(1 for d in dem if dem[d])}")

# organizaciones
orgs = sheet("DIM_ORGANIZACION")
print(
    f"\nDIM_ORGANIZACION: {len(orgs)} filas; tipos={Counter(txt(r[5]) for r in orgs).most_common(10)}"
)
print(f"  RUC no nulo={sum(1 for r in orgs if txt(r[13]))}")
act_org = [txt(r[6]) for r in sheet("DIM_Actores")]
print(
    f"  DIM_Actores.Id_organizacion no nulo={sum(1 for r in act_org if r)}; distintos={len({a for a in act_org if a})}"
)
org_ids = {txt(r[0]) for r in orgs}
org_names = {txt(r[1]) for r in orgs}
print(
    f"  referencias que son ID_ORGANIZACION valido: {sum(1 for a in act_org if a in org_ids)}"
)
print(
    f"  referencias que son nombre exacto de organizacion: {sum(1 for a in act_org if a in org_names)}"
)

# tipos de organizacion
print(f"\nDIM_TIPO_ORG: {[(txt(r[0]), txt(r[1])) for r in sheet('DIM_TIPO_ORG')]}")
