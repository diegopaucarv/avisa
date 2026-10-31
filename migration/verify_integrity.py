"""Verificaciones puntuales de integridad referencial del legado."""

import os
from collections import Counter

import openpyxl

XLSX = os.path.join(
    os.path.dirname(__file__), "..", "backend", "BASE_CONFLICTOS_SOCIALES_2026.xlsx"
)
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)


def sheet(name):
    ws = wb[name]
    rows = [
        r
        for r in ws.iter_rows(values_only=True)
        if any(c is not None and str(c).strip() != "" for c in r)
    ]
    width = max(len(r) for r in rows)
    header = list(rows[0]) + [None] * (width - len(rows[0]))
    data = [list(r) + [None] * (width - len(r)) for r in rows[1:]]
    return header, data


def txt(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return s or None


h, casos = sheet("FACT_Casos")
case_ids = [txt(r[0]) for r in casos]
print(f"FACT_Casos: {len(case_ids)} casos")
print(f"  primeros: {case_ids[:3]}  ultimos: {case_ids[-3:]}")
print(
    f"  formatos: {Counter('largo' if c and c.startswith('CS-PRODUCE') else 'otro' for c in case_ids)}"
)

for name in ["BRIDGE_Caso_Actor", "BRIDGE_Caso_Actor_Estado"]:
    h, rows = sheet(name)
    col = [txt(r[2]) for r in rows]
    nums = [c for c in col if c and c.replace(".", "").isdigit()]
    print(f"\n{name}: {len(rows)} filas, col ID_Caso -> {Counter(col).most_common(8)}")
    print(
        f"  numericos: {len(nums)}/{len(col)}; rango={min(int(float(n)) for n in nums) if nums else '-'}..{max(int(float(n)) for n in nums) if nums else '-'}"
    )
    if nums:
        idx_ok = all(1 <= int(float(n)) <= len(case_ids) for n in nums)
        print(f"  ¿todos caen en 1..{len(case_ids)} (ordinal de FACT_Casos)? {idx_ok}")

h, rows = sheet("BRIDGE_Caso_Depto")
print(f"\nBRIDGE_Caso_Depto: {len(rows)} filas")
print(f"  ids caso distintos: {len(set(txt(r[1]) for r in rows))}")
faltan = sorted({txt(r[1]) for r in rows} - set(case_ids))
print(f"  casos referenciados que NO existen en FACT_Casos ({len(faltan)}): {faltan}")
print(f"  col3 (ID_Ubigeo nominal): {Counter(txt(r[2]) for r in rows).most_common(5)}")
print(
    f"  col4 (Departamento nominal): {Counter(txt(r[3]) for r in rows).most_common(5)}"
)
print(
    f"  col5 (Es_Principal nominal): {Counter(txt(r[4]) for r in rows).most_common(5)}"
)
print(f"  col6 (sin nombre): {Counter(txt(r[5]) for r in rows).most_common(5)}")

h, rows = sheet("DIM_Actores")
print(
    f"\nDIM_Actores: {len(rows)} filas; DNI 'N/D': {sum(1 for r in rows if txt(r[2]) == 'N/D')}"
)
print(f"  categoria: {Counter(txt(r[10]) for r in rows).most_common(8)}")
print(f"  nivel_gobierno: {Counter(txt(r[9]) for r in rows).most_common(8)}")
print(f"  id_perfil: {Counter(txt(r[11]) for r in rows).most_common(8)}")
print(f"  tipo_actor: {Counter(txt(r[8]) for r in rows).most_common(8)}")
print(f"  activo: {Counter(txt(r[14]) for r in rows).most_common(8)}")

h, rows = sheet("DIM_Actores_Estado")
print(
    f"\nDIM_Actores_Estado: {len(rows)} filas; DNI distintos: {Counter(txt(r[2]) for r in rows).most_common(5)}"
)
nombres = [txt(r[1]) for r in rows]
print(
    f"  nombres distintos: {len(set(nombres))} de {len(nombres)}; duplicados: {[n for n, c in Counter(nombres).items() if c > 1][:5]}"
)

h, rows = sheet("DIM_Demandas")
tem = Counter(txt(r[5]) for r in rows)
print(f"\nDIM_Demandas: {len(rows)} filas; tematicas: {tem.most_common(10)}")
print(
    f"  caso nulo: {sum(1 for r in rows if not txt(r[3]))}, alerta nulo: {sum(1 for r in rows if not txt(r[4]))}"
)
solo_alerta = sum(1 for r in rows if not txt(r[3]) and txt(r[4]))
sin_padre = sum(1 for r in rows if not txt(r[3]) and not txt(r[4]))
print(f"  solo alerta: {solo_alerta}, sin alerta ni caso: {sin_padre}")

h, rows = sheet("DIM_Alertas")
print(
    f"\nDIM_Alertas: {len(rows)} filas; con caso: {sum(1 for r in rows if txt(r[1]))}"
)
print(f"  ID_Sector: {Counter(txt(r[10]) for r in rows).most_common(5)}")
print(f"  nivel: {Counter(txt(r[13]) for r in rows).most_common(6)}")
print(f"  estado: {Counter(txt(r[26]) for r in rows).most_common(5)}")
print(f"  paso_actual: {Counter(txt(r[18]) for r in rows).most_common(5)}")

h, rows = sheet("DIM_Hitos")
print(f"\nDIM_Hitos estado: {Counter(txt(r[8]) for r in rows).most_common(5)}")
print(f"  validacion: {Counter(txt(r[5]) for r in rows).most_common(5)}")

h, rows = sheet("DIM_ORGANIZACION")
print(f"\nDIM_ORGANIZACION: {len(rows)} filas")
print(f"  ID_TIPO_ORG: {Counter(txt(r[5]) for r in rows).most_common(10)}")
print(f"  Cod_Actor no nulo: {sum(1 for r in rows if txt(r[7]))}")

h, rows = sheet("DIM_TIPO_ORG")
print(f"DIM_TIPO_ORG: {[(txt(a), txt(b)) for a, b in [(r[0], r[1]) for r in rows]]}")
