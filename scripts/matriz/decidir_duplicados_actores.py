#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Decisiones de calidad sobre alertas duplicadas y actores dudosos.

SÓLO LECTURA
------------
Abre la conexión con ``set_session(readonly=True, autocommit=True)`` y no
ejecuta INSERT/UPDATE/DELETE ni DDL. Produce un informe de decisiones y el
SQL propuesto; NO lo aplica.

Entradas
--------
* ``scripts/matriz/salida/match_actores.json`` (filas con veredicto "dudoso").
* ``core.alertas_tempranas``: los dos códigos ``AT-2026-48*``.
* Destinos de los actores dudosos en ``core.actores``,
  ``core.organizaciones`` y ``core.cat_unidades_organicas``.

Salida
------
* ``scripts/matriz/salida/decisiones.json``
* Tabla compacta y resumen por stdout.

Uso
---
    python scripts/matriz/decidir_duplicados_actores.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = Path(__file__).resolve().parent / "salida" / "match_actores.json"
SALIDA = Path(__file__).resolve().parent / "salida" / "decisiones.json"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Hijos que cuelgan de una alerta (sección 1 del encargo).
TABLAS_HIJAS = [
    "core.alertas_actores",
    "core.alerta_especies",
    "core.proceso_instancia",
    "core.demandas",
]


def conectar():
    load_dotenv(RAIZ / ".env", override=False)
    url = os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("No hay NEON_OWNER_URL ni DATABASE_URL en el entorno/.env")
    conn = psycopg2.connect(url)
    # La única garantía: la sesión es de sólo lectura.
    conn.set_session(readonly=True, autocommit=True)
    return conn


def q(cur, sql, params=None):
    cur.execute(sql, params or ())
    return cur.fetchall()


# ---------------------------------------------------------------------------
# Encargo 1 · ¿AT-2026-48 y AT-2026-48-bis son duplicados?
# ---------------------------------------------------------------------------
def comparar_alertas(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    filas = q(
        cur,
        """
        SELECT id, codigo_alerta, titulo, fecha_reporte, situacion_actual,
               caso_id::text AS caso_id, codigo_legado,
               estado_legado, created_at
          FROM core.alertas_tempranas
         WHERE codigo_alerta LIKE %s
         ORDER BY codigo_alerta
        """,
        ("AT-2026-48%",),
    )
    alertas = [dict(f) for f in filas]

    # Conteo de hijos por alerta.
    for a in alertas:
        conteo = {}
        for t in TABLAS_HIJAS:
            r = q(
                cur, f"SELECT count(*) AS n FROM {t} WHERE alerta_id = %s", (a["id"],)
            )
            conteo[t] = r[0]["n"]
        a["hijos"] = conteo
        a["hijos_total"] = sum(conteo.values())

    por_codigo = {a["codigo_alerta"]: a for a in alertas}
    a48 = por_codigo.get("AT-2026-48")
    abis = por_codigo.get("AT-2026-48-bis")

    if not a48 or not abis:
        return {
            "encontrados": [a["codigo_alerta"] for a in alertas],
            "decision": "no tocar",
            "motivo": "No aparecen ambas alertas; nada que fusionar.",
            "sql_propuesto": [],
        }

    distintos = {
        "titulo": a48["titulo"] != abis["titulo"],
        "fecha_reporte": a48["fecha_reporte"] != abis["fecha_reporte"],
        "situacion_actual": a48["situacion_actual"] != abis["situacion_actual"],
        "caso_id": a48["caso_id"] != abis["caso_id"],
        "codigo_legado": a48["codigo_legado"] != abis["codigo_legado"],
    }
    son_duplicados = not any(
        distintos[k] for k in ("titulo", "fecha_reporte", "situacion_actual", "caso_id")
    )

    resultado = {
        "a": a48,
        "bis": abis,
        "campos_distintos": distintos,
        "son_duplicados": son_duplicados,
    }

    if son_duplicados:
        # Sólo si de verdad comparten título/fecha/situación/caso.
        canónico, sobrante = a48, abis
        if sobrante["hijos_total"] > canónico["hijos_total"]:
            canónico, sobrante = abis, a48
        repunte = ", ".join(f"{t}={sobrante['hijos'][t]}" for t in TABLAS_HIJAS)
        sql = [
            "-- Mover hijos del sobrante al canónico (ajustar si hay unicidad):",
            *[
                f"UPDATE {t} SET alerta_id = '{canónico['id']}' "
                f"WHERE alerta_id = '{sobrante['id']}';"
                for t in TABLAS_HIJAS
                if sobrante["hijos"][t]
            ],
            f"DELETE FROM core.alertas_tempranas WHERE id = '{sobrante['id']}';",
        ]
        resultado.update(
            {
                "canonico": canónico["codigo_alerta"],
                "sobrante": sobrante["codigo_alerta"],
                "decision": f"fusionar en {canónico['codigo_alerta']}",
                "motivo": (
                    "Título, fecha, situación y caso coinciden; el código -bis es "
                    f"un duplicado. Hijos del sobrante: {repunte or 'ninguno'}."
                ),
                "sql_propuesto": sql,
            }
        )
    else:
        resultado.update(
            {
                "decision": "no tocar",
                "motivo": (
                    "No son duplicados: difieren título, fecha, situación y caso. "
                    "El sufijo -bis es un error de numeración, no una copia del "
                    "registro. AT-2026-48 es MYPES/plantón nacional (caso "
                    f"{a48['caso_id']}); AT-2026-48-bis es DPA Morro Sama/Tacna "
                    "(sin caso). Cada una conserva sus propios hijos."
                ),
                "sql_propuesto": [
                    "-- no tocar: registros distintos, no hay UPDATE/DELETE.",
                ],
            }
        )
    return resultado


# ---------------------------------------------------------------------------
# Encargo 2 · Los actores dudosos
# ---------------------------------------------------------------------------
# Decisión razonada por fragmento (una línea de justificación cada uno).
# 'vincular' = misma entidad; 'crear' = entidad distinta; 'no registrar' =
# descriptor genérico (Pescadores / Gremios de… sin ancla propia, o un
# topónimo que no identifica a una organización concreta).
DECISIONES = {
    "OSPAS DE LOMAS": (
        "crear",
        "OSPAS de Lomas es una OSPA local de Caravelí; el destino OSPAs de "
        "Tumbes es otra OSPA (otra jurisdicción). Entidad distinta.",
    ),
    "Pescadores de la Macro Sur (Ica, Arequipa, Moquegua, Tacna)": (
        "no registrar",
        "Descriptor colectivo por macro-región sin organización nombrada; no "
        "identifica una entidad concreta.",
    ),
    "Gremios de maricultores de Sechura": (
        "no registrar",
        "«Gremios de…» es descriptor sectorial; Sechura es topónimo, no ancla "
        "propia de una organización concreta.",
    ),
    "Pescadores": (
        "no registrar",
        "Descriptor genérico puro; no hay entidad identificable.",
    ),
    "Gremios de pescadores artesanales zona norte": (
        "no registrar",
        "Descriptor genérico «Gremios de… zona norte» sin ancla propia.",
    ),
    "Pescadores artesanales de Chérrepe": (
        "no registrar",
        "Descriptor de pescadores anclado sólo en un topónimo; no nombra la "
        "organización.",
    ),
    "Gremios de pescadores artesanales de La Libertad y Lambayeque": (
        "no registrar",
        "Descriptor gremial por dos regiones; sin ancla propia.",
    ),
    "Pescadores artesanales tradicionales y ancestrales (a favor)": (
        "no registrar",
        "Descriptor genérico (posición «a favor»); no identifica entidad.",
    ),
    "Pescadores del DPA Chimbote": (
        "no registrar",
        "«Pescadores del DPA <lugar>» es descriptor por desembarcadero; no "
        "nombra al sindicato ni a una organización concreta.",
    ),
    "Asociación de Buzos Artesanales Isla Blanca": (
        "crear",
        "Asociación formal de buzos de Isla Blanca; el destino es una "
        "asociación de armadores de Yacila. Entidad distinta.",
    ),
    "Procuraduría PRODUCE": (
        "crear",
        "Procuraduría sectorial de PRODUCE; el destino «PROCURADURÍA PÚBLICA» "
        "es la genérica. Entidad distinta.",
    ),
    "ADARPESCA": (
        "crear",
        "Sigla propia que no coincide con APESCAN (otra asociación). Entidad distinta.",
    ),
    "Pescadores del DPA Supe": (
        "no registrar",
        "Descriptor «Pescadores del DPA <lugar>»; el destino es Sechura, otro "
        "ámbito. No vincula y no nombra organización.",
    ),
    "Pescadores del DPA San Juan de Marcona": (
        "no registrar",
        "Descriptor por desembarcadero; el destino es Colán (Piura). Topónimo "
        "no identifica.",
    ),
    "OSPA Asociación de Bolichitos de Marcona": (
        "crear",
        "Asociación de bolichitos de Marcona; el destino es la de Puerto Ilo. "
        "Entidad distinta.",
    ),
    "Pescadores artesanales con EP cerco de bolsillo": (
        "no registrar",
        "Descriptor por arte de pesca; no nombra ninguna organización.",
    ),
    "Pescadores del DPA Atico": (
        "no registrar",
        "Descriptor «Pescadores del DPA <lugar>»; el destino es Sechura. "
        "Topónimo no identifica.",
    ),
    "Pescadores artesanales DPA San José": (
        "no registrar",
        "Descriptor por desembarcadero; no equivale al Sindicato de Pescadores "
        "San José.",
    ),
    "Municipalidad de San José": (
        "crear",
        "Municipalidad distrital (entidad de gobierno); el destino es una "
        "cooperativa pesquera. Entidad distinta.",
    ),
}


def datos_destino(cur, destino):
    """Devuelve nombre, abreviatura y naturaleza verificados en la base."""
    if not destino:
        return {}
    tabla = destino.get("tabla")
    ident = destino.get("id")
    if tabla == "core.cat_unidades_organicas":
        cur.execute(
            """
            SELECT nombre_completo, siglas, estado
              FROM core.cat_unidades_organicas WHERE id = %s
            """,
            (ident,),
        )
        r = cur.fetchone()
        if not r:
            return {"existe_en_bd": False}
        return {
            "existe_en_bd": True,
            "nombre_bd": r["nombre_completo"],
            "siglas": [r["siglas"]] if r["siglas"] else [],
            "naturaleza": r["estado"],
        }
    if tabla in ("core.actores", "core.organizaciones"):
        cur.execute(
            """
            SELECT a.nombre_actual, a.abreviatura, a.naturaleza,
                   o.razon_social
              FROM core.actores a
              LEFT JOIN core.organizaciones o USING (actor_uid)
             WHERE a.actor_uid = %s
            """,
            (ident,),
        )
        r = cur.fetchone()
        if not r:
            return {"existe_en_bd": False}
        siglas = (
            [r["abreviatura"]]
            if r["abreviatura"]
            else list(destino.get("siglas") or [])
        )
        return {
            "existe_en_bd": True,
            "nombre_bd": r["razon_social"] or r["nombre_actual"],
            "nombre_actor": r["nombre_actual"],
            "siglas": siglas,
            "naturaleza": r["naturaleza"],
        }
    return {"existe_en_bd": False, "motivo": f"tabla no manejada: {tabla}"}


def decidir_dudosos(conn):
    data = json.loads(ENTRADA.read_text(encoding="utf-8"))
    dudosos = [f for f in data["filas"] if f.get("veredicto") == "dudoso"]
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    salida = []
    for f in dudosos:
        crudo = f["crudo"]
        decision, motivo = DECISIONES.get(
            crudo, ("no registrar", "Sin regla explícita: se trata como descriptor.")
        )
        verificado = datos_destino(cur, f.get("destino"))
        destino = {
            "id": (f.get("destino") or {}).get("id"),
            "tabla": (f.get("destino") or {}).get("tabla"),
            "nombre": (f.get("destino") or {}).get("nombre"),
            "siglas": verificado.get(
                "siglas", (f.get("destino") or {}).get("siglas") or []
            ),
            **{k: v for k, v in verificado.items() if k != "siglas"},
        }
        salida.append(
            {
                "crudo": crudo,
                "tipo": f.get("tipo"),
                "coseno": f.get("coseno"),
                "lexico": f.get("lexico"),
                "decision": decision,
                "destino": destino,
                "motivo": motivo,
            }
        )
    return salida


def main():
    conn = conectar()
    try:
        alerta = comparar_alertas(conn)
        dudosos = decidir_dudosos(conn)
    finally:
        conn.close()

    resumen = {"vinculables": 0, "crear": 0, "no registrar": 0}
    for d in dudosos:
        resumen[d["decision"]] = resumen.get(d["decision"], 0) + 1

    salida = {
        "generado_en": __import__("datetime")
        .datetime.now(__import__("datetime").timezone.utc)
        .isoformat(),
        "solo_lectura": True,
        "alerta_duplicada": alerta,
        "dudosos": dudosos,
        "resumen": resumen,
        "total_dudosos": len(dudosos),
    }
    SALIDA.write_text(
        json.dumps(salida, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )

    # -------- tabla compacta --------
    print(f"\n{'CRUDO':48} {'DECISIÓN':13} {'DESTINO (BD)':40} {'siglas'}")
    print("-" * 118)
    for d in dudosos:
        dest = d["destino"].get("nombre_bd") or d["destino"].get("nombre") or "-"
        siglas = ",".join(d["destino"].get("siglas") or []) or "-"
        print(f"{d['crudo'][:47]:48} {d['decision']:13} {str(dest)[:39]:40} {siglas}")

    print("\n=== ALERTA ===")
    print(f"decisión: {alerta.get('decision')}")
    print(f"motivo  : {alerta.get('motivo')}")
    for a in (alerta.get("a"), alerta.get("bis")):
        if a:
            print(
                f"  {a['codigo_alerta']:16} fecha={a['fecha_reporte']} "
                f"caso={a['caso_id']} hijos={a['hijos']} total={a['hijos_total']}"
            )
    print("  SQL propuesto:")
    for linea in alerta.get("sql_propuesto", []):
        print("   ", linea)

    print("\n=== RESUMEN DUDOSOS ===")
    for k in ("vinculables", "crear", "no registrar"):
        print(f"  {k:14} {resumen.get(k, 0)}")
    print(f"  {'total':14} {len(dudosos)}")
    print(f"\nEscrito: {SALIDA}")


if __name__ == "__main__":
    main()
