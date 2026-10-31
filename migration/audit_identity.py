"""Duplicados de ID, consistencia alerta->caso, y solape de los dos censos de personas."""

import os
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


# Placeholders de DNI que en realidad significan "sin dato": deben ir a NULL.
DNI_NULOS = {"N/D", "ND", "N/A", "NA", "S/D", "-"}


def dni(v):
    """DNI normalizado: los placeholders ('N/D' del censo Estado) valen None."""
    s = txt(v)
    if s is None:
        return None
    return None if s.upper() in DNI_NULOS else s


def dup(nombre, col=0):
    ids = [txt(r[col]) for r in sheet(nombre)]
    c = Counter(ids)
    d = {k: v for k, v in c.items() if v > 1 and k}
    print(f"{nombre}: {len(ids)} filas, {len(set(ids))} ids distintos, duplicados={d}")
    return d


dup("DIM_Alertas")
dup("DIM_Demandas")
dup("DIM_Actores")
dup("DIM_ORGANIZACION")
dup("FACT_Hechos_Casos")
dup("DIM_REDACCION")
dup("DIM_COORDINACION_TECNICA")

# alerta -> caso declarado en la alerta vs caso de sus demandas
casos = {txt(r[0]) for r in sheet("FACT_Casos")}
al = sheet("DIM_Alertas")
al_caso = {txt(r[0]): txt(r[1]) for r in al}
print(
    f"\nAlertas: ID_Caso_Vinculado inexistente en FACT_Casos: "
    f"{sorted({c for c in al_caso.values() if c} - casos)}"
)

dem = sheet("DIM_Demandas")
incons = 0
for r in dem:
    a, c = txt(r[4]), txt(r[3])
    if a and c and al_caso.get(a) and al_caso[a] != c:
        incons += 1
print(f"Demandas con caso != caso de su alerta: {incons}")

# solape de censos de personas
p = sheet("DIM_Actores")
pe = sheet("DIM_Actores_Estado")
nombres = {txt(r[1]) for r in p if txt(r[1])}
nombres_e = {txt(r[1]) for r in pe if txt(r[1])}
print(f"\nDIM_Actores: {len(p)} filas, {len(nombres)} nombres distintos")
print(f"DIM_Actores_Estado: {len(pe)} filas, {len(nombres_e)} nombres distintos")
print(f"  nombres en ambos censos: {len(nombres & nombres_e)}")
print(f"  solo en Actores_Estado: {len(nombres_e - nombres)}")

dnis = [dni(r[2]) for r in p]
reales = [d for d in dnis if d]
c_dni = Counter(reales)
dni_dup = {k: v for k, v in c_dni.items() if v > 1}
print(f"  DNI en DIM_Actores: {len(reales)} no nulos, {len(c_dni)} distintos")
print(f"  DNI duplicados: {len(dni_dup)} valores en {sum(dni_dup.values())} filas")
dnis_e = [dni(r[2]) for r in pe]
print(
    f"  DNI en Actores_Estado: {sum(1 for d in dnis_e if d)} no nulos "
    f"(los 'N/D' se normalizan a NULL)"
)

# organizaciones: membresía
orgs = {txt(r[0]): txt(r[1]) for r in sheet("DIM_ORGANIZACION")}
refs = [txt(r[6]) for r in p if txt(r[6])]
print(f"\nMembresías: {len(refs)} referencias, {len(set(refs))} distintos")
print(f"  resuelven por ID_ORGANIZACION: {sum(1 for x in refs if x in orgs)}")
print(
    f"  resuelven por NOMBRE exacto: {sum(1 for x in refs if x in set(orgs.values()))}"
)
resueltos = sum(1 for x in refs if x in orgs or x in set(orgs.values()))
print(
    f"  sin resolver: {len(refs) - resueltos} ({(len(refs) - resueltos) / len(refs) * 100:.1f}%)"
)

# Cod_Actor en organizaciones -> ¿ya existe como actor?
cod_actor = [txt(r[7]) for r in sheet("DIM_ORGANIZACION") if txt(r[7])]
print(
    f"\nDIM_ORGANIZACION.Cod_Actor: {len(cod_actor)} no nulos, {len(set(cod_actor))} distintos"
)
print(
    f"  ¿son IDs de DIM_Actores?: {sum(1 for x in cod_actor if x.startswith('ACT-'))}"
)

# Pct_Avance valores
print(f"\nPct_Avance: {Counter(txt(r[12]) for r in sheet('FACT_Casos')).most_common()}")
print(f"Prioridad: {Counter(txt(r[10]) for r in sheet('FACT_Casos')).most_common()}")
print(
    f"ID_Sector casos: {Counter(txt(r[3]) for r in sheet('FACT_Casos')).most_common()}"
)
