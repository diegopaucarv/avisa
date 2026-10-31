"""Volcado de valores reales: filas completas para hojas pequenas, muestra para grandes."""

import json
import os
import sys

import openpyxl

XLSX = os.path.join(
    os.path.dirname(__file__), "..", "backend", "BASE_CONFLICTOS_SOCIALES_2026.xlsx"
)

SMALL = 40  # filas completas por debajo de este umbral
BIG_SAMPLE = 3

TARGETS = [
    "DIM_Departamentos",
    "DIM_Provincias",
    "DIM_Distritos",
    "DIM_Tipo_Caso",
    "DIM_Riesgos",
    "DIM_Nivel_Alertas",
    "DIM_Estado_Proceso",
    "DIM_Intervencion",
    "DIM_Perfil",
    "DIM_TIPO_ORG",
    "DIM_Tipo_Cambio",
    "DIM_Tipo_Actor_Radar",
    "DIM_Tipo_Proceso",
    "DIM_Rol_Actor",
    "DIM_Tipo_Sector",
    "DIM_Tipo_Actor",
    "DIM_Tipo_Tematica",
    "DIM_Recurso_Pesca",
    "DIM_Destinatarios_Fijos",
    "DIM_Entidad_Responsable",
    "DIM_Unidades_Organicas_Responsa",
    "DIM_MESAS_GRUPOS",
    "FACT_Casos",
    "BRIDGE_Caso_Depto",
    "DIM_Sectoristas",
    "DIM_Punto_Focal",
    "DIM_Autoridades",
    "DIM_Capacitaciones",
    "DIM_Hitos",
    "DIM_Acciones_Hitos",
    "DIM_REDACCION",
    "DIM_COORDINACION_TECNICA",
    "DIM_Locales",
    "DIM_Actores",
    "DIM_Actores_Estado",
    "DIM_ORGANIZACION",
    "DIM_Demandas",
    "DIM_Alertas",
    "FACT_Hechos_Casos",
    "BRIDGE_Alerta_Actor",
    "BRIDGE_Caso_Actor",
    "BRIDGE_Caso_Actor_Estado",
    "BRIDGE_Alerta_Demandas",
    "BRIDGE_Caso_Demandas",
    "LOG_Envios",
    "LOG_Accesos",
]


def clean(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip().replace("\n", " ")[:120]


def main():
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    out = []

    def emit(sheet, rows, header, limit):
        out.append(f"\n{'=' * 100}\n## {sheet}  ({len(rows)} filas)\n{'=' * 100}")
        out.append(
            " | ".join(clean(h) if h else f"<c{i}>" for i, h in enumerate(header, 1))
        )
        for row in rows[:limit]:
            out.append(" | ".join(clean(v).replace("|", "/") for v in row))

    for name in TARGETS:
        if name not in wb.sheetnames:
            out.append(f"\n## {name} :: NO EXISTE")
            continue
        ws = wb[name]
        rows = [
            r
            for r in ws.iter_rows(values_only=True)
            if any(c is not None and str(c).strip() != "" for c in r)
        ]
        if not rows:
            out.append(f"\n## {name} :: VACIA")
            continue
        width = max(len(r) for r in rows)
        header = list(rows[0]) + [None] * (width - len(rows[0]))
        data = [list(r) + [None] * (width - len(r)) for r in rows[1:]]
        limit = len(data) if len(data) <= SMALL else BIG_SAMPLE
        emit(name, data, header, limit)

    text = "\n".join(out)
    path = os.path.join(os.path.dirname(__file__), "..", "docs", "_legacy_samples.txt")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"-> {path}  ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
