"""Prioridad de construcción: qué tablas y relaciones de la v10 se crean primero.

Cruza cinco señales por tabla lógica:

    1. filas        -> la tabla tiene datos hoy
    2. cargador     -> alguna fase de `migration/loader` escribe en ella
    3. dependencia  -> cuántas tablas vivas la referencian (FK entrantes)
    4. consumidores -> aparece nombrada en el código de la aplicación
    5. contrato     -> el MVP-45 la exige (`docs/mvp.md` §2.4 y §2.5)

La correspondencia MVP -> v10 no se inventa aquí: sigue el **Anexo D.2** de
`docs/AVISA_PRODUCE_v10.md`, que es la fuente de verdad de la decisión D22.

Salidas:

    docs/mvp_prioridad_tablas.csv   una fila por tabla, con capa asignada
    stdout                          resumen para redactar el informe

Solo lee. No escribe en la base.

Uso:
    python migration/prioridad_mvp.py
"""

from __future__ import annotations

import csv
import sys
from collections import Counter
from pathlib import Path

import psycopg

RAIZ = Path(__file__).resolve().parents[1]
DOCS = RAIZ / "docs"
SALIDA_CSV = DOCS / "mvp_prioridad_tablas.csv"

MODELO = (
    "n.nspname NOT LIKE 'pg\\_%' AND "
    "n.nspname NOT IN ('information_schema','public','legacy')"
)

# --------------------------------------------------------------------------
# Contrato del MVP-45: `docs/mvp.md` §2.4 (50) + §2.5 (5).
#
# Cada entrada es (tabla que lo cumple hoy | None, estado, nota).
#   exacta  -> la tabla existe y hace lo mismo
#   parcial -> existe algo que cubre parte, u otro nombre de esquema
#   crear   -> el MVP la exige y la v10 no la tiene: hay que crearla
#
# Fuente de la correspondencia: Anexo D.2 de `AVISA_PRODUCE_v10.md`.
# --------------------------------------------------------------------------
MVP: dict[str, dict[str, tuple[str | None, str, str]]] = {
    "ref": {
        "nivel_identificacion": (
            "core.cat_nivel_identificacion",
            "exacta",
            "catálogo creado en el parche 14",
        ),
        "tipo_actor": ("core.cat_tipos_actor", "exacta", ""),
        "nivel_conflicto": ("core.cat_niveles_conflicto", "exacta", ""),
        "nivel_riesgo": ("core.cat_niveles_riesgo", "exacta", ""),
        "estado_caso": ("core.cat_estados_caso", "exacta", ""),
        "estado_compromiso": ("core.cat_estados_compromiso", "exacta", ""),
        "estado_hito": ("core.cat_estados_hito", "exacta", ""),
        "prioridad_alerta": ("core.cat_prioridades_alerta", "exacta", ""),
        "clasificacion": ("core.cat_clasificacion", "exacta", ""),
        "tipo_hecho": ("core.cat_tipos_hecho", "exacta", ""),
        "ubigeo": (
            "core.distritos",
            "parcial",
            "la v10 reparte la geografía en regiones, provincias y distritos",
        ),
        "base_legal_tratamiento": (
            "ref.base_legal_tratamiento",
            "exacta",
            "catálogo creado en el parche 14",
        ),
    },
    "core": {
        "actor": ("core.actores", "exacta", ""),
        "actor_pii": ("core.actor_datos_personales", "exacta", ""),
        "actor_alias": ("core.actor_alias", "exacta", ""),
        "organizacion": ("core.organizaciones", "exacta", ""),
        "membresia": ("core.actor_membresia", "exacta", ""),
        "caso": ("core.casos", "exacta", ""),
        "caso_actor": ("core.casos_actores", "exacta", ""),
        "actor_relacion": (
            "kag.aristas",
            "parcial",
            "D.2: `kag.aristas` ≈; el MVP la materializa en `core`",
        ),
        "hecho": ("core.caso_cronologia", "parcial", ""),
        "hecho_actor": ("core.cronologia_vinculos", "exacta", ""),
        "fuente": ("kag.documento_fuente", "parcial", "D.2: ≈"),
        "cita": (
            "kag.documento_fragmento",
            "parcial",
            "la cita añade offset_inicio/offset_fin",
        ),
        "compromiso": ("core.compromisos", "exacta", ""),
        "hito_compromiso": ("core.hitos_compromiso", "exacta", ""),
        "compromiso_colaboradores": ("core.compromiso_colaboradores", "exacta", ""),
        "alerta": ("core.alertas_tempranas", "exacta", ""),
        "alerta_fuente": (None, "crear", "no existe vínculo alerta → fuente"),
        "alerta_destinatario": ("core.alertas_actores", "parcial", "D.2: ≈"),
        "actor_consentimiento": (None, "crear", "pieza de la Ley 29733, §2.3.bis"),
        "padron_asistencia": (
            "core.reunion_participantes",
            "parcial",
            "cubre la asistencia a reuniones de diálogo",
        ),
        "actor_seudonimo": ("qda.mapeo_pseudonimo", "parcial", "existe, pero en `qda`"),
        "situacion_judicial_restricta": (
            "core.consulta_reniec",
            "parcial",
            "el parche 17 cubre la consulta PIDE-RENIEC; faltan las requisitorias MININTER",
        ),
        "banco_datos_tratamiento": (
            "core.banco_datos_tratamiento",
            "exacta",
            "inscripción ANPDP en el parche 16",
        ),
        "permiso_aprobacion": ("core.permiso_aprobacion", "exacta", ""),
        "actor_fusion": (
            "kag.entity_merge_log",
            "parcial",
            "D.2 prevé `core.actor_fusion`",
        ),
    },
    "analisis": {
        "evaluacion_riesgo": ("ind.resultado", "parcial", "D.2: valores de K1 y K5"),
        "escenario_regla": ("policy.escenario_regla", "exacta", ""),
        "simulacion": (
            "policy.escenario_regla",
            "parcial",
            "`forecast.whatif_scenarios` está prevista y no creada",
        ),
        "caso_analogo": (None, "crear", "`forecast.whatif_scenarios` no creada"),
        "informe": ("core.output_contracts", "parcial", "D.2: ≈"),
        "calidad_fuente": (None, "crear", "indicador de calidad de la información"),
    },
    "ia": {
        "corrida_ingesta": (
            "agent.run_log",
            "parcial",
            "D.2: `agent.run_log` + `avisa.raw_ingest`",
        ),
        "candidato_alerta": (
            "staging.lote",
            "parcial",
            "D.2: `avisa.raw_ingest` + `staging.lote`",
        ),
    },
    "seg": {
        "usuario": ("core.usuarios", "exacta", ""),
        "perfil": ("core.roles", "exacta", ""),
        "usuario_perfil": ("core.usuario_roles", "exacta", ""),
        "usuario_actor_externo": (None, "crear", "D.2: nueva"),
        "usuario_caso": (None, "crear", "D.2: nueva"),
    },
    "audit": {
        "bitacora_acceso": (
            "core.log_accesos",
            "parcial",
            "D.2: `agent.run_log` y el bloque estándar de auditoría",
        ),
        "bitacora_cambio": ("core.caso_estado_historial", "parcial", ""),
        "lectura_dato": ("audit.datos_personales_acceso", "exacta", ""),
        "exportacion": (None, "crear", "toda salida del perímetro con hash"),
        "incidente_seguridad": (None, "crear", "reloj de las 48 h"),
    },
}

# Directorios que cuentan como "consumidores en el código de la aplicación".
CODIGO = ["app", "components", "lib", "frontend", "backend"]


def dsn() -> str:
    """DATABASE_URL de `.env`, sin depender de python-dotenv."""
    env = RAIZ / ".env"
    if env.exists():
        for linea in env.read_text(encoding="utf-8").splitlines():
            if linea.startswith("DATABASE_URL="):
                return linea.split("=", 1)[1].strip()
    return "postgresql://avisa:avisa@localhost:55433/avisa"


def tablas_que_escribe_el_cargador() -> set[str]:
    """Tablas que alguna fase del loader escribe (INSERT INTO esquema.tabla)."""
    vistas: set[str] = set()
    for ruta in (RAIZ / "migration" / "loader").rglob("*.py"):
        texto = ruta.read_text(encoding="utf-8", errors="replace")
        for linea in texto.splitlines():
            bajo = linea.lower()
            if "into " not in bajo:
                continue
            for trozo in bajo.split("into ")[1:]:
                nombre = trozo.split()[0].strip(",;()")
                if nombre.count(".") == 1:
                    vistas.add(nombre)
    return vistas


def referencias_codigo(nombres: set[str]) -> dict[str, int]:
    """Cuántas veces aparece `esquema.tabla` en el código de la aplicación.

    El DDL no cuenta: define tablas, no las consume.
    """
    refs = {n: 0 for n in nombres}
    for carpeta in CODIGO:
        base = RAIZ / carpeta
        if not base.exists():
            continue
        for ruta in base.rglob("*"):
            if ruta.suffix.lower() not in {".py", ".ts", ".tsx", ".js", ".jsx"}:
                continue
            if "__pycache__" in ruta.parts:
                continue
            try:
                texto = ruta.read_text(encoding="utf-8", errors="replace").lower()
            except OSError:
                continue
            for nombre in nombres:
                refs[nombre] += texto.count(nombre)
    return refs


def leer_tablas(conn: psycopg.Connection) -> list[dict]:
    sql = f"""
        SELECT n.nspname, c.relname,
               (SELECT count(*) FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS cols,
               (SELECT count(*) FROM pg_constraint k
                 WHERE k.contype = 'f' AND k.confrelid = c.oid) AS fk_in,
               (SELECT count(*) FROM pg_constraint k
                 WHERE k.contype = 'f' AND k.conrelid = c.oid) AS fk_out,
               c.relrowsecurity AS rls,
               (SELECT count(*) FROM pg_trigger t
                 WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS trig,
               EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = c.oid AND a.attname = 'codigo_legado') AS legado
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p')
           AND {MODELO}
           AND c.oid NOT IN (SELECT inhrelid FROM pg_inherits)
         ORDER BY 1, 2
    """
    salida = []
    for nsp, nom, cols, fk_in, fk_out, rls, trig, legado in conn.execute(sql):
        total = conn.execute(f'SELECT count(*) FROM "{nsp}"."{nom}"').fetchone()[0]
        salida.append(
            dict(
                esquema=nsp,
                tabla=nom,
                completo=f"{nsp}.{nom}",
                cols=cols,
                filas=total,
                fk_in=fk_in,
                fk_out=fk_out,
                rls=rls,
                trig=trig,
                legado=legado,
                refs=0,
                loader=False,
                ref_por=set(),
                escribe_a=set(),
            )
        )

    aristas = conn.execute(
        f"""
        SELECT pn.nspname || '.' || pc.relname AS destino,
               cn.nspname || '.' || cc.relname AS origen
          FROM pg_constraint k
          JOIN pg_class pc ON pc.oid = k.confrelid
          JOIN pg_namespace pn ON pn.oid = pc.relnamespace
          JOIN pg_class cc ON cc.oid = k.conrelid
          JOIN pg_namespace cn ON cn.oid = cc.relnamespace
         WHERE k.contype = 'f'
           AND {MODELO.replace("n.nspname", "pn.nspname")}
           AND {MODELO.replace("n.nspname", "cn.nspname")}
        """
    ).fetchall()
    por_nombre = {t["completo"]: t for t in salida}
    for destino, origen in aristas:
        if destino in por_nombre and origen in por_nombre:
            por_nombre[destino]["ref_por"].add(origen)
            por_nombre[origen]["escribe_a"].add(destino)
    return salida


def main() -> None:
    # La consola de Windows abre en cp1252 y las flechas del resumen revientan.
    for flujo in (sys.stdout, sys.stderr):
        if flujo.encoding and flujo.encoding.lower().replace("-", "") != "utf8":
            flujo.reconfigure(encoding="utf-8", errors="replace")

    mvp_destino = {
        destino
        for grupo in MVP.values()
        for destino, _estado, _nota in grupo.values()
        if destino
    }
    with psycopg.connect(dsn()) as conn:
        tablas = leer_tablas(conn)

    existentes = {t["completo"] for t in tablas}
    faltan = sorted(mvp_destino - existentes)
    if faltan:
        raise SystemExit(f"el puente apunta a tablas inexistentes: {faltan}")

    loader = tablas_que_escribe_el_cargador()
    refs = referencias_codigo(existentes)

    for t in tablas:
        t["loader"] = t["completo"] in loader
        t["refs"] = refs.get(t["completo"], 0)

    vivas = {t["completo"] for t in tablas if t["filas"] > 0 or t["loader"]}

    for t in tablas:
        en_mvp = t["completo"] in mvp_destino
        vivo = t["completo"] in vivas
        t["fk_in_vivas"] = len(t["ref_por"] & vivas)
        causas = []
        if t["fk_in_vivas"]:
            causas.append("referencia_viva")
        if t["trig"]:
            causas.append("trigger")
        if t["refs"]:
            causas.append("codigo")
        t["causa"] = "+".join(causas) if causas else "nada"
        if en_mvp and vivo:
            t["capa"] = "T0"
            t["motivo"] = "MVP-45 y ya tiene datos o cargador"
        elif en_mvp:
            t["capa"] = "T1"
            t["motivo"] = "MVP-45, todavía vacía"
        elif vivo:
            t["capa"] = "T2"
            t["motivo"] = "fuera del MVP-45 pero con datos o cargador"
        elif t["fk_in_vivas"] > 0 or t["refs"] > 0 or t["trig"] > 0:
            t["capa"] = "T3"
            t["motivo"] = "vacía, pero algo vivo la usa"
        else:
            t["capa"] = "T4"
            t["motivo"] = "vacía y solo se relaciona con otras vacías"

    SALIDA_CSV.parent.mkdir(parents=True, exist_ok=True)
    with SALIDA_CSV.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "capa",
                "esquema",
                "tabla",
                "columnas",
                "filas",
                "fk_entrantes",
                "fk_entrantes_vivas",
                "fk_salientes",
                "rls",
                "triggers",
                "codigo_legado",
                "cargador",
                "refs_codigo",
                "motivo",
                "causa",
            ]
        )
        for t in sorted(tablas, key=lambda x: (x["capa"], x["esquema"], x["tabla"])):
            w.writerow(
                [
                    t["capa"],
                    t["esquema"],
                    t["tabla"],
                    t["cols"],
                    t["filas"],
                    t["fk_in"],
                    t["fk_in_vivas"],
                    t["fk_out"],
                    t["rls"],
                    t["trig"],
                    t["legado"],
                    t["loader"],
                    t["refs"],
                    t["motivo"],
                    t["causa"],
                ]
            )

    # ---- resumen para redactar -------------------------------------------
    print(f"tablas medidas: {len(tablas)}")
    for capa in ("T0", "T1", "T2", "T3", "T4"):
        grupo = [t for t in tablas if t["capa"] == capa]
        print(
            f"{capa}: {len(grupo)} tablas, {sum(t['cols'] for t in grupo)} columnas, "
            f"{sum(t['filas'] for t in grupo)} filas, "
            f"{sum(1 for t in grupo if t['rls'])} con RLS"
        )

    print("\n-- T0 (crear primero) --")
    for t in sorted(
        (x for x in tablas if x["capa"] == "T0"),
        key=lambda x: (-x["fk_in"], x["completo"]),
    ):
        print(
            f"  {t['completo']:<34} filas={t['filas']:<6} fk_in={t['fk_in']:<3} "
            f"cols={t['cols']}"
        )

    print("\n-- T1 (MVP vacío) --")
    for t in sorted(
        (x for x in tablas if x["capa"] == "T1"), key=lambda x: x["completo"]
    ):
        print(f"  {t['completo']:<34} cols={t['cols']} fk_in={t['fk_in']}")

    print("\n-- T3 por causa --")
    for causa, n in Counter(
        t["causa"] for t in tablas if t["capa"] == "T3"
    ).most_common():
        print(f"  {causa:<26} {n:>3} tablas")

    print("\n-- por esquema y capa --")
    for esq in sorted({t["esquema"] for t in tablas}):
        cuenta = Counter(t["capa"] for t in tablas if t["esquema"] == esq)
        linea = "  ".join(
            f"{c}={cuenta[c]}" for c in ("T0", "T1", "T2", "T3", "T4") if cuenta[c]
        )
        print(f"  {esq:<14} {linea}")

    # ---- puente MVP -------------------------------------------------------
    print("\n-- puente MVP-45 --")
    estados = Counter(estado for g in MVP.values() for _d, estado, _n in g.values())
    print(
        f"  exacta={estados['exacta']} parcial={estados['parcial']} crear={estados['crear']}"
    )
    print("\n  a crear:")
    for esq, grupo in MVP.items():
        for nom, (destino, estado, nota) in grupo.items():
            if estado == "crear":
                print(f"    {esq}.{nom:<30} {nota}")
    print("\n  parciales:")
    for esq, grupo in MVP.items():
        for nom, (destino, estado, nota) in grupo.items():
            if estado == "parcial":
                print(f"    {esq}.{nom:<28} -> {destino:<28} {nota}")

    # ---- islas dormidas ---------------------------------------------------
    t4 = {t["completo"]: t for t in tablas if t["capa"] == "T4"}
    apunta: dict[str, str] = {n: n for n in t4}

    def raiz(x: str) -> str:
        while apunta[x] != x:
            apunta[x] = apunta[apunta[x]]
            x = apunta[x]
        return x

    for t in t4.values():
        for vecino in t["ref_por"] | t["escribe_a"]:
            if vecino in t4:
                apunta[raiz(t["completo"])] = raiz(vecino)

    grupos: dict[str, list[str]] = {}
    for nombre in t4:
        grupos.setdefault(raiz(nombre), []).append(nombre)

    print(f"\n-- islas dormidas: {len(grupos)} (mayores de 1) --")
    for miembros in sorted(grupos.values(), key=lambda m: -len(m)):
        if len(miembros) < 2:
            continue
        esquemas = sorted({m.split(".")[0] for m in miembros})
        print(
            f"  {len(miembros):>3} tablas  [{' '.join(esquemas)}]  "
            f"{', '.join(miembros[:5])}{'…' if len(miembros) > 5 else ''}"
        )
    sueltas = sum(1 for m in grupos.values() if len(m) == 1)
    print(f"  + {sueltas} islas de una sola tabla")


if __name__ == "__main__":
    main()
