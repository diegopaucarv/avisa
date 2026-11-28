"""B3 - Carga el directorio DVPA del Excel de la matriz (2026-11-28).

Fuente: hoja ``DVPA`` de
``docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx``.

Alcance y decisiones:
- Se insertan SOLO personas (``naturaleza='persona'``) que no existen ya en
  ``core.actores`` (dedupe por nombre normalizado EXACTO, nunca fuzzy).
- NO se crean organizaciones: la mayoria de los gremios del Excel tienen
  near-duplicados en BD (Jaccard alto) y crearlas ensuciaria el maestro.
- Solo se inserta membresia cuando la organizacion del Excel empareja EXACTO
  (por nombre o por siglas/``abreviatura``) con una organizacion existente.
- PII: no se lee ni se persiste DNI, telefono ni correo en claro. Los actores se
  insertan sin esos datos y se reportan como pendientes de enriquecimiento PII.
- ``origen_dato='AVISA_HISTORICO'``: es el valor que ya usan TODAS las cargas de
  actores del proyecto (``cargar_matriz.py``, ``aplicar_matcher.py``, etc.) y la
  hoja proviene del mismo Excel legado; ``MANUAL`` implicaria captura humana.
- ``codigo_legado`` queda NULL: la columna ``N°`` del Excel solo trae 6 valores
  y no es un codigo estable ni unico (el proyecto usa ``ACT-###`` UNIQUE).

Uso:
    python scripts/b3_cargar_dvpa.py                  # dry-run (no escribe)
    python scripts/b3_cargar_dvpa.py --apply          # escribe + respaldo JSON
    python scripts/b3_cargar_dvpa.py --rollback       # preview del rollback
    python scripts/b3_cargar_dvpa.py --rollback --apply

El respaldo se guarda en ``backups/`` ANTES del commit para poder revertir.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import openpyxl
import psycopg2
from _norm_actor import RAIZ, norm, tokens, url_owner

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

XLSX_DEFECTO = (
    RAIZ / "docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx"
)
BACKUP_DEFECTO = RAIZ / "backups/dvpa_2026-11-28.json"

# Valores neutros y documentados para columnas NOT NULL sin default logico.
TIPO_ACTOR_SOCIAL = 2
ROL_NO_DETERMINADO = 7
NIVEL_SIN_DOC = 3
ORIGEN = "AVISA_HISTORICO"
USER_AUDIT = "00000000-0000-0000-0000-000000000001"
CONTEXTO_RLS = (
    ("app.rol_codigo", "administrador"),
    ("app.user_id", USER_AUDIT),
)

PLACEHOLDERS = {
    "(por confirmar)",
    "(organizacion por confirmar)",
    "(organización por confirmar)",
    "por confirmar",
    "-",
    "n/a",
}


# --------------------------------------------------------------------------- #
# Lectura del Excel
# --------------------------------------------------------------------------- #
def _texto(valor) -> str | None:
    if valor is None:
        return None
    texto = str(valor).strip()
    return texto or None


def _tiene_valor(fila: tuple, indice: int) -> bool:
    """Indica si la celda trae algo SIN materializar el contenido (evita PII)."""
    if indice >= len(fila):
        return False
    valor = fila[indice]
    return valor is not None and str(valor).strip() != ""


def leer_dvpa(xlsx: Path) -> list[dict]:
    """Devuelve las filas utiles de la hoja DVPA (datos desde la fila 3)."""
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    if "DVPA" not in wb.sheetnames:
        raise SystemExit(f"La hoja 'DVPA' no existe en {xlsx}")
    ws = wb["DVPA"]

    filas: list[dict] = []
    for indice, fila in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        if len(fila) < 11:
            continue
        nombre = _texto(fila[6])  # G - Nombres y Apellidos
        if not nombre or norm(nombre) in PLACEHOLDERS:
            continue
        filas.append(
            {
                "fila": indice,
                "nombre": nombre,
                "departamento": _texto(fila[3]),  # D
                "cargo": _texto(fila[8]),  # I
                "organizacion": _texto(fila[9]),  # J
                "siglas": _texto(fila[10]),  # K
                # Solo booleanos: los valores PII nunca salen de aqui.
                "tiene_dni": _tiene_valor(fila, 7),
                "tiene_telefono": _tiene_valor(fila, 11),
                "tiene_correo": _tiene_valor(fila, 12),
            }
        )
    return filas


# --------------------------------------------------------------------------- #
# BD
# --------------------------------------------------------------------------- #
def cargar_mapas(cur) -> tuple:
    cur.execute(
        "select actor_uid::text, nombre_actual, naturaleza, abreviatura "
        "from core.actores"
    )
    actores = cur.fetchall()
    por_nombre: dict[str, list[tuple]] = defaultdict(list)
    por_abrev: dict[str, list[tuple]] = defaultdict(list)
    for uid, nombre, naturaleza, abreviatura in actores:
        tupla = (uid, naturaleza, nombre)
        por_nombre[norm(nombre)].append(tupla)
        if abreviatura:
            por_abrev[norm(abreviatura)].append(tupla)

    cur.execute("select id, nombre from core.regiones")
    regiones = {norm(nombre): region_id for region_id, nombre in cur.fetchall()}
    return por_nombre, por_abrev, regiones


def aplicar_contexto(cur) -> None:
    """Fija el contexto que leen las politicas RLS y el trigger core.set_audit."""
    for clave, valor in CONTEXTO_RLS:
        cur.execute("select set_config(%s, %s, false)", (clave, valor))


def _region_id(departamento: str | None, regiones: dict[str, int]) -> int | None:
    if not departamento:
        return None
    clave = norm(departamento)
    if clave in ("(por confirmar)", "por confirmar", "vacío", "vacio"):
        return None
    return regiones.get(clave)


def _resolver_org(org, por_nombre) -> tuple | None:
    """Resuelve la organizacion SOLO por nombre exacto normalizado.

    No se usa la sigla: acronimos como ``SONAPESCAL`` estan compartidos por
    organizaciones distintas (e incluso por una persona), asi que emparejar
    por sigla produce falsos positivos. La sigla se reporta aparte como
    "posible pero no fiable" para revision manual.
    """
    if not org:
        return None
    candidatos = [x for x in por_nombre.get(norm(org), []) if x[1] == "organizacion"]
    if len({x[0] for x in candidatos}) == 1:
        return candidatos[0]
    return None


def _resolver_sigla(siglas, por_abrev) -> tuple | None:
    """Solo para diagnostico: a que organizacion apunta una sigla (no se inserta)."""
    if not siglas:
        return None
    candidatos = [x for x in por_abrev.get(norm(siglas), []) if x[1] == "organizacion"]
    if len({x[0] for x in candidatos}) == 1:
        return candidatos[0]
    return None


def _casi_duplicados(nuevos: list[dict], por_nombre) -> list[dict]:
    """Personas nuevas cuyo nombre es un subconjunto/superconjunto de tokens de
    una unica persona existente (p. ej. 'Elsa Vega' vs 'Elsa Graciela Vega
    Pardo').

    No se usa para enlazar (no es fuzzy matching): es una alerta de posible
    duplicado. Por defecto NO se excluyen (la dedupe contratada es exacta);
    ``--excluir-casi-duplicados`` las deja fuera para revision manual.
    """
    personas: list[tuple[set[str], str]] = []
    for clave, tuplas in por_nombre.items():
        for _uid, naturaleza, nombre in tuplas:
            if naturaleza == "persona":
                conjunto = tokens(clave)
                if len(conjunto) >= 2:
                    personas.append((conjunto, nombre))

    resultado: list[dict] = []
    for fila in nuevos:
        conjunto = tokens(fila["nombre"])
        if len(conjunto) < 2:
            continue
        parecidos = {
            nombre
            for existente, nombre in personas
            if existente != conjunto
            and (conjunto <= existente or existente <= conjunto)
        }
        if parecidos:
            resultado.append({**fila, "posibles_duplicados": sorted(parecidos)})
    return resultado


def planificar(filas: list[dict], por_nombre, por_abrev, regiones) -> dict:
    """Clasifica cada fila del Excel contra la BD. Solo emparejamiento exacto."""
    conteo_norm = Counter(norm(f["nombre"]) for f in filas)
    colisiones_internas = {k for k, v in conteo_norm.items() if v > 1}

    existentes: list[dict] = []
    ambiguos_bd: list[dict] = []
    colision_org: list[dict] = []
    colision_interna: list[dict] = []
    nuevos: list[dict] = []

    for fila in filas:
        clave = norm(fila["nombre"])
        if clave in colisiones_internas:
            colision_interna.append(fila)
            continue
        candidatos = por_nombre.get(clave, [])
        if candidatos:
            naturalezas = {c[1] for c in candidatos}
            if len({c[0] for c in candidatos}) > 1:
                ambiguos_bd.append({**fila, "candidatos": [c[2] for c in candidatos]})
            elif "organizacion" in naturalezas:
                colision_org.append(fila)
            else:
                existentes.append({**fila, "actor_uid": candidatos[0][0]})
            continue
        nuevos.append(fila)

    # Membresia solo para personas nuevas con organizacion resoluble por NOMBRE.
    membresias: list[dict] = []
    membresias_sigla: list[dict] = []
    for fila in nuevos:
        resuelta = _resolver_org(fila["organizacion"], por_nombre)
        if resuelta:
            membresias.append(
                {
                    "fila": fila["fila"],
                    "nombre": fila["nombre"],
                    "organizacion_uid": resuelta[0],
                    "organizacion": resuelta[2],
                    "cargo": fila["cargo"],
                }
            )
            continue
        # Sigla resoluble pero nombre distinto: se reporta, NO se inserta.
        if fila["organizacion"] and resuelta is None:
            por_sigla = _resolver_sigla(fila["siglas"], por_abrev)
            if por_sigla:
                membresias_sigla.append(
                    {
                        "fila": fila["fila"],
                        "nombre": fila["nombre"],
                        "organizacion_excel": fila["organizacion"],
                        "siglas": fila["siglas"],
                        "organizacion_bd": por_sigla[2],
                    }
                )

    return {
        "colisiones_internas": colisiones_internas,
        "colision_interna": colision_interna,
        "existentes": existentes,
        "ambiguos_bd": ambiguos_bd,
        "colision_org": colision_org,
        "nuevos": nuevos,
        "membresias": membresias,
        "membresias_sigla": membresias_sigla,
        "casi_duplicados": _casi_duplicados(nuevos, por_nombre),
    }


# --------------------------------------------------------------------------- #
# Salidas
# --------------------------------------------------------------------------- #
def imprimir_plan(plan: dict, filas: list[dict]) -> None:
    nuevos = plan["nuevos"]
    print("=" * 64)
    print("B3 DVPA - plan de carga (dry-run por defecto)")
    print("=" * 64)
    print(f"filas utiles en hoja DVPA .......... {len(filas)}")
    print(
        f"nombres normalizados distintos ..... {len({norm(f['nombre']) for f in filas})}"
    )
    print(f"personas ya existentes en BD ....... {len(plan['existentes'])}")
    print(f"nuevas insertables ................. {len(nuevos)}")
    print(f"colisiones internas (omitidas) ..... {len(plan['colision_interna'])} filas")
    for clave in sorted(plan["colisiones_internas"]):
        print(f"   - '{clave}' (2+ filas) -> se omiten ambas para revision manual")
    print(f"ambiguos contra BD (omitidos) ...... {len(plan['ambiguos_bd'])}")
    for item in plan["ambiguos_bd"]:
        print(f"   - '{item['nombre']}' -> {item['candidatos']}")
    print(f"colision persona vs organizacion ... {len(plan['colision_org'])}")
    for item in plan["colision_org"]:
        print(f"   - '{item['nombre']}'")

    region_ok = region_null = 0
    regiones_nulas = []
    regiones_no_map = []
    regiones = plan.get("regiones", {})
    for fila in nuevos:
        dep = fila["departamento"]
        if not dep or norm(dep) in (
            "(por confirmar)",
            "por confirmar",
            "vacío",
            "vacio",
        ):
            region_null += 1
            if dep:
                regiones_nulas.append(dep)
        elif norm(dep) in regiones:
            region_ok += 1
        else:
            regiones_no_map.append(dep)
    print(f"region mapeada ..................... {region_ok}")
    print(f"region NULL (vacia / por confirmar)  {region_null}")
    if regiones_nulas:
        print(f"   valores: {sorted(set(regiones_nulas))}")
    if regiones_no_map:
        print(f"   NO mapeadas (quedan NULL): {sorted(set(regiones_no_map))}")

    print(f"membresias insertables ............. {len(plan['membresias'])}")
    for m in plan["membresias"]:
        print(
            f"   - {m['nombre']} -> {m['organizacion']} ({m['cargo'] or 'sin cargo'})"
        )

    siglas = plan.get("membresias_sigla", [])
    if siglas:
        print(f"membresias por sigla (NO fiables) .. {len(siglas)} (revision manual)")
        for m in siglas:
            print(
                f"   - {m['nombre']}: Excel '{m['organizacion_excel']}' "
                f"[{m['siglas']}] -> BD '{m['organizacion_bd']}' (nombres distintos)"
            )

    casi = plan.get("casi_duplicados", [])
    excluidos = plan.get("casi_duplicados_excluidos", False)
    if casi:
        estado = (
            "EXCLUIDAS"
            if excluidos
            else "se cargan (regla exacta; usa --excluir-casi-duplicados)"
        )
        print(f"posibles duplicados (casi exactos) . {len(casi)} -> {estado}")
        for item in casi:
            print(f"   - {item['nombre']} ~ {item['posibles_duplicados']}")

    dni = sum(1 for f in nuevos if f["tiene_dni"])
    tel = sum(1 for f in nuevos if f["tiene_telefono"])
    mail = sum(1 for f in nuevos if f["tiene_correo"])
    print(f"personas con DNI en Excel .......... {dni} (PII pendiente, NO se persiste)")
    print(f"personas con telefono en Excel ..... {tel} (PII pendiente, NO se persiste)")
    print(
        f"personas con correo en Excel ....... {mail} (PII pendiente, NO se persiste)"
    )

    print("\nEjemplos de nuevas (primeras 5):")
    for fila in nuevos[:5]:
        print(
            f"   - fila {fila['fila']}: {fila['nombre']} | "
            f"{fila['departamento'] or 'sin region'} | {fila['organizacion'] or 'sin org'}"
        )


def escribir_backup(ruta: Path, payload: dict) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Apply / rollback
# --------------------------------------------------------------------------- #
def aplicar(conn, cur, plan: dict, xlsx: Path, backup: Path) -> None:
    nuevos = plan["nuevos"]
    membresias_plan = plan["membresias"]

    aplicar_contexto(cur)

    insertados: list[dict] = []
    for fila in nuevos:
        region_id = _region_id(fila["departamento"], plan["regiones"])
        cur.execute(
            """insert into core.actores
                 (nombre_actual, naturaleza, tipo_actor_id, rol_actor_id,
                  origen_dato, nivel_identificacion_id, region_id,
                  cargo_actual, es_validado_humano)
               values (%s, 'persona', %s, %s, %s, %s, %s, %s, false)
               returning actor_uid::text""",
            (
                fila["nombre"],
                TIPO_ACTOR_SOCIAL,
                ROL_NO_DETERMINADO,
                ORIGEN,
                NIVEL_SIN_DOC,
                region_id,
                fila["cargo"],
            ),
        )
        actor_uid = cur.fetchone()[0]
        insertados.append(
            {
                "actor_uid": actor_uid,
                "nombre": fila["nombre"],
                "fila_excel": fila["fila"],
                "region_id": region_id,
            }
        )

    uid_por_fila = {item["fila_excel"]: item["actor_uid"] for item in insertados}

    membresias_insertadas: list[dict] = []
    for m in membresias_plan:
        persona_uid = uid_por_fila.get(m["fila"])
        if not persona_uid:
            continue
        cur.execute(
            """select 1 from core.actor_membresia
                where persona_uid=%s::uuid and organizacion_uid=%s::uuid""",
            (persona_uid, m["organizacion_uid"]),
        )
        if cur.fetchone():
            continue
        cur.execute(
            """insert into core.actor_membresia
                 (persona_uid, organizacion_uid, cargo, valid_from)
               values (%s::uuid, %s::uuid, %s, %s)
               returning id::text""",
            (persona_uid, m["organizacion_uid"], m["cargo"], date.today()),
        )
        membresias_insertadas.append(
            {
                "id": cur.fetchone()[0],
                "persona_uid": persona_uid,
                "organizacion_uid": m["organizacion_uid"],
                "cargo": m["cargo"],
            }
        )

    uids = [item["actor_uid"] for item in insertados]

    # Nodos KAG creados por el trigger kag.actor_nace (no tienen FK a actores).
    cur.execute(
        "select id::text from kag.nodos where tipo='actor' and ref_id = any(%s::uuid[])",
        (uids,),
    )
    nodos = [r[0] for r in cur.fetchall()]
    aristas: list[str] = []
    if nodos:
        cur.execute(
            """select id::text from kag.aristas
                where tipo_id = 20
                  and (origen_id = any(%s::uuid[]) or destino_id = any(%s::uuid[]))""",
            (nodos, nodos),
        )
        aristas = [r[0] for r in cur.fetchall()]

    payload = {
        "tarea": "B3 DVPA",
        "generado_en": datetime.now(timezone.utc).isoformat(),
        "xlsx": str(xlsx),
        "contexto_rls": dict(CONTEXTO_RLS),
        "totales": {
            "actores": len(insertados),
            "membresias": len(membresias_insertadas),
            "kag_nodos": len(nodos),
            "kag_aristas": len(aristas),
        },
        "actores": insertados,
        "membresias": membresias_insertadas,
        "kag_nodos": nodos,
        "kag_aristas": aristas,
    }
    escribir_backup(backup, payload)
    print(f"\nRespaldo escrito ANTES del commit: {backup}")

    conn.commit()
    print(
        f"COMMIT: {len(insertados)} actores, "
        f"{len(membresias_insertadas)} membresias, "
        f"{len(nodos)} nodos KAG y {len(aristas)} aristas KAG."
    )


def revertir(conn, cur, backup: Path, aplicar_cambios: bool) -> None:
    if not backup.exists():
        raise SystemExit(f"No existe el respaldo {backup}")
    payload = json.loads(backup.read_text(encoding="utf-8"))
    uids = [a["actor_uid"] for a in payload.get("actores", [])]
    nodos = payload.get("kag_nodos", [])
    aristas = payload.get("kag_aristas", [])
    membresias = [m["id"] for m in payload.get("membresias", [])]

    aplicar_contexto(cur)
    print("=" * 64)
    print("ROLLBACK B3 DVPA")
    print("=" * 64)
    print(f"respaldo ........................... {backup}")
    print(f"actores a borrar ................... {len(uids)}")
    print(f"membresias a borrar ................ {len(membresias)}")
    print(f"nodos KAG a borrar ................. {len(nodos)}")
    print(f"aristas KAG a borrar ............... {len(aristas)}")

    if not aplicar_cambios:
        print("\nENSAYO: agrega --apply para ejecutar el rollback.")
        return
    if not uids:
        print("Nada que revertir.")
        return

    if aristas:
        cur.execute("delete from kag.aristas where id = any(%s::uuid[])", (aristas,))
    if nodos:
        # Red de seguridad: cualquier arista MIEMBRO_DE que toque nodos nuestros.
        cur.execute(
            """delete from kag.aristas
                where tipo_id = 20
                  and (origen_id = any(%s::uuid[]) or destino_id = any(%s::uuid[]))""",
            (nodos, nodos),
        )
        cur.execute("delete from kag.nodos where id = any(%s::uuid[])", (nodos,))
    if membresias:
        cur.execute(
            "delete from core.actor_membresia where id = any(%s::uuid[])", (membresias,)
        )
    cur.execute(
        "delete from core.actor_membresia where persona_uid = any(%s::uuid[])", (uids,)
    )
    cur.execute("delete from core.actores where actor_uid = any(%s::uuid[])", (uids,))
    borrados = cur.rowcount
    conn.commit()
    print(f"COMMIT: {borrados} actores borrados y sus vinculos KAG/membresias.")


# --------------------------------------------------------------------------- #
def main() -> None:
    parser = argparse.ArgumentParser(description="B3 - carga del directorio DVPA")
    parser.add_argument("--apply", action="store_true", help="escribe en la BD")
    parser.add_argument(
        "--rollback", action="store_true", help="revierte usando el respaldo JSON"
    )
    parser.add_argument("--xlsx", type=Path, default=XLSX_DEFECTO)
    parser.add_argument("--backup", type=Path, default=BACKUP_DEFECTO)
    parser.add_argument(
        "--dump-plan",
        action="store_true",
        help="escribe el plan dry-run en el respaldo sin tocar la BD",
    )
    parser.add_argument(
        "--excluir-casi-duplicados",
        action="store_true",
        help=(
            "omite las personas nuevas cuyo nombre es subconjunto de tokens de "
            "una persona existente (se reportan para revision manual)"
        ),
    )
    args = parser.parse_args()

    conn = psycopg2.connect(url_owner())
    cur = conn.cursor()

    if args.rollback:
        revertir(conn, cur, args.backup, args.apply)
        conn.close()
        return

    filas = leer_dvpa(args.xlsx)
    por_nombre, por_abrev, regiones = cargar_mapas(cur)
    plan = planificar(filas, por_nombre, por_abrev, regiones)
    plan["regiones"] = regiones

    if args.excluir_casi_duplicados and plan["casi_duplicados"]:
        excluidas = {item["fila"] for item in plan["casi_duplicados"]}
        plan["nuevos"] = [f for f in plan["nuevos"] if f["fila"] not in excluidas]
        plan["membresias"] = [
            m for m in plan["membresias"] if m["fila"] not in excluidas
        ]
        plan["casi_duplicados_excluidos"] = True

    imprimir_plan(plan, filas)

    if not args.apply:
        if args.dump_plan:
            # No pisar el respaldo de rollback: el plan va a un archivo aparte.
            ruta_plan = args.backup.with_name(args.backup.stem + ".plan.json")
            escribir_backup(
                ruta_plan,
                {
                    "tarea": "B3 DVPA (plan dry-run, sin escrituras)",
                    "generado_en": datetime.now(timezone.utc).isoformat(),
                    "xlsx": str(args.xlsx),
                    "actores": [
                        {
                            "fila_excel": f["fila"],
                            "nombre": f["nombre"],
                            "region_id": _region_id(f["departamento"], regiones),
                        }
                        for f in plan["nuevos"]
                    ],
                    "membresias": plan["membresias"],
                },
            )
            print(f"\nPlan escrito en {ruta_plan}")
        print("\nENSAYO: agrega --apply para escribir en la BD.")
        conn.close()
        return

    aplicar(conn, cur, plan, args.xlsx, args.backup)
    conn.close()


if __name__ == "__main__":
    main()
