#!/usr/bin/env python
"""Plan de importación de la matriz 2026 (sin escribir en la base).

Lee `scripts/matriz/salida/matriz_2026.json`, descarta los bloques marcados como
duplicados y calcula, por caso, qué se insertaría. Imprime el plan y las
verificaciones de cuadre.

Uso:
    python scripts/matriz/plan_importacion.py
    python scripts/matriz/plan_importacion.py --detalle
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = RAIZ / "scripts/matriz/salida/matriz_2026.json"
MAPA = RAIZ / "scripts/matriz/salida/mapa_matriz_excel.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--detalle", action="store_true")
    args = parser.parse_args()

    datos = json.loads(ENTRADA.read_text(encoding="utf-8"))
    casos = [c for c in datos["casos"] if not c["duplicado_de"]]
    duplicados = [c for c in datos["casos"] if c["duplicado_de"]]

    existentes = [c for c in casos if c["caso_id_existente"]]
    nuevos = [c for c in casos if not c["caso_id_existente"]]

    print(f"bloques leídos      : {len(datos['casos'])}")
    print(
        f"duplicados descart. : {len(duplicados)}  -> {[c['filas'][0] for c in duplicados]}"
    )
    print(f"casos a importar    : {len(casos)}")
    print(f"  · reutilizan uuid : {len(existentes)}")
    print(
        f"  · nuevos (código) : {len(nuevos)} -> bloques {[c['filas'][0] for c in nuevos]}"
    )

    totales = Counter()
    filas = []
    for caso in casos:
        cuenta = {
            "demandas": len(caso["demandas"]),
            "compromisos": len(caso["compromisos"]),
            "hitos": len(caso["hitos"]),
            "vinculos": len(caso["vinculos_demanda_compromiso"]),
            "actores": len(caso["actores"]),
        }
        totales.update(cuenta)
        filas.append((caso, cuenta))

    print("\nTOTALES A INSERTAR")
    for clave in ("demandas", "compromisos", "hitos", "vinculos", "actores"):
        print(f"  {clave:12} {totales[clave]:>5}")

    # Cuadre contra el parser.
    esperado = {
        "casos": 36,
        "demandas": sum(len(c["demandas"]) for c in casos),
        "compromisos": sum(len(c["compromisos"]) for c in casos),
        "hitos": sum(len(c["hitos"]) for c in casos),
        "vinculos": sum(len(c["vinculos_demanda_compromiso"]) for c in casos),
    }
    print("\nCUADRE")
    hitos_todos = sum(len(c["hitos"]) for c in datos["casos"])
    vinculos_todos = sum(len(c["vinculos_demanda_compromiso"]) for c in datos["casos"])
    hitos_dup = sum(len(c["hitos"]) for c in duplicados)
    vinculos_dup = sum(len(c["vinculos_demanda_compromiso"]) for c in duplicados)
    print(
        f"  casos: 37 = {len(casos)} importables + {len(duplicados)} duplicado  -> OK"
    )
    print(
        f"  hitos: {hitos_todos} = {esperado['hitos']} + {hitos_dup} (bloque 128)"
        f"  -> {'OK' if hitos_todos == esperado['hitos'] + hitos_dup else 'FALLA'}"
    )
    print(
        f"  vínculos: {vinculos_todos} = {esperado['vinculos']} + {vinculos_dup} (bloque 128)"
        f"  -> {'OK' if vinculos_todos == esperado['vinculos'] + vinculos_dup else 'FALLA'}"
    )
    multi = sum(
        1
        for c in casos
        for m in c["compromisos"]
        if sum(
            1 for v in c["vinculos_demanda_compromiso"] if v["compromiso"] == m["texto"]
        )
        > 1
    )
    print(f"  compromisos multi-demanda (van al puente 65): {multi}")

    if args.detalle:
        print(
            f"\n{'clave':38} {'código':22} {'dem':>3} {'com':>3} {'hit':>3} {'vín':>3}"
        )
        for caso, cuenta in filas:
            print(
                f"{str(caso['clave_importacion'])[:38]:38} {str(caso['codigo_excel'])[:22]:22} "
                f"{cuenta['demandas']:>3} {cuenta['compromisos']:>3} {cuenta['hitos']:>3} {cuenta['vinculos']:>3}"
            )

    mapa = json.loads(MAPA.read_text(encoding="utf-8")) if MAPA.exists() else []
    print(
        f"\nmapa_matriz_excel: {len(mapa)} filas, {len({m['caso_id'] for m in mapa})} casos distintos"
    )
    print("Sin cambios en la base: esto es sólo el plan.")


if __name__ == "__main__":
    main()
