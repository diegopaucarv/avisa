"""Recarga de la matriz 2026 en Neon (transacción única).

Borrado + inserción + revinculación, a partir de:
  · scripts/matriz/salida/matriz_2026.json           (parser)
  · backups/recarga_matriz_2026_11_26.json           (respaldo de los 33 casos)

Uso:
    python scripts/matriz/cargar_matriz.py            # ensayo: sólo imprime
    python scripts/matriz/cargar_matriz.py --apply    # ejecuta y confirma
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
MATRIZ = RAIZ / "scripts/matriz/salida/matriz_2026.json"
RESPALDO = RAIZ / "backups/recarga_matriz_2026_11_26.json"

ESTADOS_HITO = {
    "cumplido": 4,
    "no cumplido": 6,
    "desestimado": 5,
    "en ejecución": 2,
    "paralizado": 3,
    "registrado": 1,
}
RIESGO = {"bajo": 1, "medio": 2, "alto": 3}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    cur = conn.cursor()

    datos = json.loads(MATRIZ.read_text(encoding="utf-8"))
    casos = [c for c in datos["casos"] if not c["duplicado_de"]]
    respaldo = json.loads(RESPALDO.read_text(encoding="utf-8"))
    previos = {c["id"]: c for c in respaldo["casos"]}

    cur.execute("select id, nombre from core.regiones")
    regiones = {n.lower(): i for i, n in cur.fetchall() if n}

    existentes = [c for c in casos if c["caso_id_existente"]]
    nuevos = [c for c in casos if not c["caso_id_existente"]]
    print(f"casos: {len(casos)} ({len(existentes)} con uuid, {len(nuevos)} nuevos)")
    print(
        f"demandas={sum(len(c['demandas']) for c in casos)} "
        f"compromisos={sum(len(c['compromisos']) for c in casos)} "
        f"hitos={sum(len(c['hitos']) for c in casos)} "
        f"vinculos={sum(len(c['vinculos_demanda_compromiso']) for c in casos)}"
    )

    if not args.apply:
        print("\nENSAYO: no se escribe nada. Usa --apply para ejecutar.")
        return

    conn.rollback()  # cierra la transacción implícita de las lecturas
    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )

        ids = [c["caso_id_existente"] for c in existentes]
        cur.execute("delete from core.casos where id = any(%s::uuid[])", (ids,))
        print(f"borrados: {cur.rowcount} casos")

        # Reinsertar los 33 con su uuid y codigo_caso originales.
        for caso in existentes:
            fila = dict(previos[caso["caso_id_existente"]])
            fila["nombre_caso"] = caso["nombre"][:255]
            fila["descripcion_riesgo"] = caso["descripcion_riesgo"]
            fila["nivel_riesgo_id"] = RIESGO.get((caso["riesgo"] or "").lower(), 2)
            fila["region_principal_id"] = regiones.get(
                (caso["region"] or "").lower(), fila.get("region_principal_id")
            )
            columnas = list(fila)
            cur.execute(
                f"insert into core.casos ({','.join(columnas)}) "
                f"values ({','.join(['%s'] * len(columnas))})",
                [fila[c] for c in columnas],
            )

        # Insertar los 3 nuevos con el código de la serie opaca.
        for caso in nuevos:
            cur.execute("select core.siguiente_codigo_caso(1, 1)")
            codigo = cur.fetchone()[0]
            cur.execute(
                """insert into core.casos
                     (codigo_caso, nombre_caso, subsector_id, unidad_responsable_id,
                      nivel_riesgo_id, descripcion_riesgo, region_principal_id, origen_dato)
                   values (%s,%s,1,1,%s,%s,%s,'MANUAL')""",
                (
                    codigo,
                    caso["nombre"][:255],
                    RIESGO.get((caso["riesgo"] or "").lower(), 2),
                    caso["descripcion_riesgo"],
                    regiones.get((caso["region"] or "").lower()),
                ),
            )
            caso["_codigo"] = codigo

        # Niños: demandas, compromisos, hitos y vínculos.
        for caso in casos:
            uuid = caso["caso_id_existente"]
            if not uuid:
                cur.execute(
                    "select id::text from core.casos where codigo_caso=%s",
                    (caso["_codigo"],),
                )
                uuid = cur.fetchone()[0]
            cur.execute("select codigo_caso from core.casos where id=%s", (uuid,))
            codigo_caso = cur.fetchone()[0]

            demanda_id = {}
            for i, d in enumerate(caso["demandas"], 1):
                cur.execute(
                    """insert into core.demandas (caso_id, descripcion_demanda, tematica_id, origen_dato)
                       values (%s,%s,%s,'MANUAL') returning id""",
                    (uuid, d["texto"], None),
                )
                demanda_id[d["texto"]] = cur.fetchone()[0]

            compromiso_id = {}
            for i, m in enumerate(caso["compromisos"], 1):
                cur.execute(
                    """insert into core.compromisos
                         (codigo_compromiso, caso_id, unidad_responsable_id, fecha_inicio,
                          accion_compromiso, tipo_compromiso, origen_dato)
                       values (%s,%s,1,current_date,%s,'Actividad','MANUAL') returning id""",
                    (
                        f"{codigo_caso}_COMP{i:03d}",
                        uuid,
                        (m["accion"] or m["texto"])[:20000],
                    ),
                )
                compromiso_id[m["texto"]] = cur.fetchone()[0]

            por_compromiso = {}
            for m in caso["compromisos"]:
                por_compromiso[m["texto"]] = []
            for v in caso["vinculos_demanda_compromiso"]:
                por_compromiso.setdefault(v["compromiso"], []).append(v["demanda"])

            for texto, demandas_del in por_compromiso.items():
                cid = compromiso_id.get(texto)
                if not cid:
                    continue
                for j, dtxt in enumerate(demandas_del, 1):
                    did = demanda_id.get(dtxt)
                    if not did:
                        continue
                    cur.execute(
                        """insert into core.compromiso_demandas
                             (compromiso_id, demanda_id, es_principal, orden)
                           values (%s,%s,%s,%s) on conflict do nothing""",
                        (cid, did, j == 1, j),
                    )
                    if j == 1:
                        cur.execute(
                            "update core.compromisos set demanda_id=%s where id=%s",
                            (did, cid),
                        )

            contador = {}
            for h in caso["hitos"]:
                cid = compromiso_id.get(h["compromiso"])
                if not cid:
                    continue
                contador[cid] = contador.get(cid, 0) + 1
                cur.execute(
                    """insert into core.hitos_compromiso
                         (compromiso_id, codigo_hito, descripcion_hito, estado_id,
                          fecha_vencimiento, fecha_real, origen_dato)
                       values (%s,%s,%s,%s,%s,%s,'MANUAL')""",
                    (
                        cid,
                        f"{codigo_caso}_C{list(compromiso_id).index(h['compromiso']) + 1:03d}_H{contador[cid]:03d}",
                        (h["descripcion"] or h["etiqueta"] or "Hito")[:20000],
                        ESTADOS_HITO.get((h["estado"] or "").lower(), 1),
                        h["fecha_planificada"],
                        h["fecha_real"],
                    ),
                )

        # Revincular documentos que el borrado dejó en NULL.
        for d in respaldo["documentos"]:
            cur.execute(
                "update core.documentos set caso_id=%s where id=%s",
                (d["caso_id"], d["id"]),
            )

        # El CASCADE de la 66 vacía la tabla de equivalencias: se restaura.
        mapa = json.loads(
            (RAIZ / "scripts/matriz/salida/mapa_matriz_excel.json").read_text(
                encoding="utf-8"
            )
        )
        for i, m in enumerate(mapa, 1):
            cur.execute(
                """insert into core.mapa_matriz_excel
                     (id, fuente, codigo_excel, bloque_fila, caso_id, confianza, nota)
                   values (%s,'MATRIZ_OAIPCS_2026',%s,%s,%s,%s,%s)""",
                (
                    i,
                    m.get("codigo_excel"),
                    m["bloque_fila"],
                    m["caso_id"],
                    m.get("confianza"),
                    None,
                ),
            )
        print(f"mapa restaurado: {len(mapa)} filas")

        conn.commit()
        print("COMMIT: recarga aplicada.")
        cur.execute("select count(*) from core.casos")
        print("casos en base:", cur.fetchone()[0])
        cur.execute("select count(*) from core.compromiso_demandas")
        print("vínculos en el puente:", cur.fetchone()[0])
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
