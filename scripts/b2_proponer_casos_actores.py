"""B2 (PROPUESTA) - Vincular casos con actores desde la matriz parseada.

ESTADO: script propuesto. NO se ejecuto ni se aplico en esta tarea. Por defecto
hace dry-run y NO escribe nada. Se deja listo para que el usuario lo revise y
decida.

Causa raiz que motiva este script: ``scripts/matriz/salida/matriz_2026.json``
(hoja «CASOS OAIPCS - OPERATIVO») ya trae ``actores`` por caso, pero
``scripts/matriz/cargar_matriz.py`` nunca los cargo en ``core.casos_actores``.
Las 63 filas actuales provienen del puente legacy
(``scripts/matriz/cargar_casos_actores.py``) mas 3 altas manuales.

Regla de emparejamiento (ESTRICTA, sin fuzzy):
- Se normaliza el nombre del actor (``_norm_actor.norm``: NFKD, sin tildes,
  espacios colapsados, minusculas) y se busca igualdad EXACTA contra
  ``core.actores.nombre_actual`` normalizado.
- ``--con-institucion`` exige ademas que la institucion del Excel aparezca
  (substring normalizado) en el nombre del actor, para desambiguar homonimos.
- Nombres que matchean 2+ actores distintos se rechazan (ambiguos).
- Solo se usan casos cuyo ``caso_id_existente`` exista en ``core.casos``.

Riesgo conocido de falsos positivos: hay personas historicas mal tipadas cuyo
``nombre_actual`` es en realidad una institucion (``GORE Piura``, ``OSPAS ...``,
``PCM (SSGD)``...). El script las reporta aparte para revision manual.

Uso:
    python scripts/b2_proponer_casos_actores.py                 # dry-run
    python scripts/b2_proponer_casos_actores.py --con-institucion
    python scripts/b2_proponer_casos_actores.py --emitir-propuesta
    # NO ejecutado / no aplicado:
    python scripts/b2_proponer_casos_actores.py --apply
    python scripts/b2_proponer_casos_actores.py --rollback [--apply]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from _norm_actor import RAIZ, norm, url_owner

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

JSON_DEFECTO = RAIZ / "scripts/matriz/salida/matriz_2026.json"
BACKUP_DEFECTO = RAIZ / "backups/b2_casos_actores_2026-11-28.json"
CONTEXTO_RLS = (
    ("app.rol_codigo", "administrador"),
    ("app.user_id", "00000000-0000-0000-0000-000000000001"),
)
PATRON_INSTITUCIONAL = re.compile(
    r"^(gore\b|gobierno regional|ospas\b|ospa\b|ssgd|pcm\b)"
)


def cargar_mapas(cur):
    cur.execute("select actor_uid::text, nombre_actual, naturaleza from core.actores")
    por_nombre: dict[str, list[tuple]] = defaultdict(list)
    for uid, nombre, naturaleza in cur.fetchall():
        por_nombre[norm(nombre)].append((uid, naturaleza, nombre))
    cur.execute("select id::text, codigo_caso from core.casos")
    casos = {uid: codigo for uid, codigo in cur.fetchall()}
    return por_nombre, casos


def emparejar(datos: dict, por_nombre, casos_bd, con_institucion: bool) -> dict:
    pares: set[tuple[str, str]] = set()
    detalle: list[dict] = []
    ambiguos: list[dict] = []
    sin_match = 0
    entradas_usadas = 0
    casos_usados: set[str] = set()

    for caso in datos.get("casos", []):
        caso_id = caso.get("caso_id_existente")
        if not caso_id or caso_id not in casos_bd:
            continue
        for actor in caso.get("actores") or []:
            nombre = actor.get("nombre")
            if not nombre:
                sin_match += 1
                continue
            candidatos = por_nombre.get(norm(nombre), [])
            institucion = actor.get("institucion")
            if con_institucion and institucion:
                inst = norm(institucion)
                candidatos = [
                    c for c in candidatos if inst in norm(c[2]) or norm(c[2]) in inst
                ]
            if not candidatos:
                sin_match += 1
                continue
            if len({c[0] for c in candidatos}) > 1:
                ambiguos.append(
                    {
                        "caso_id": caso_id,
                        "caso_codigo": casos_bd.get(caso_id),
                        "nombre": nombre,
                        "candidatos": [c[2] for c in candidatos],
                    }
                )
                continue
            uid, naturaleza, nombre_bd = candidatos[0]
            pares.add((caso_id, uid))
            casos_usados.add(caso_id)
            entradas_usadas += 1
            detalle.append(
                {
                    "caso_id": caso_id,
                    "caso_codigo": casos_bd.get(caso_id),
                    "actor_uid": uid,
                    "actor_nombre": nombre_bd,
                    "naturaleza": naturaleza,
                    "nombre_excel": nombre,
                    "institucion_excel": institucion,
                    # FP probable: persona con nombre de institucion.
                    "fp_probable": naturaleza == "persona"
                    and bool(PATRON_INSTITUCIONAL.match(norm(nombre_bd))),
                }
            )
    return {
        "pares": sorted(pares),
        "detalle": detalle,
        "ambiguos": ambiguos,
        "sin_match": sin_match,
        "entradas_usadas": entradas_usadas,
        "casos_usados": sorted(casos_usados),
    }


def imprimir(resultado: dict, casos_bd, con_institucion: bool) -> None:
    pares = resultado["pares"]
    print("=" * 64)
    print("B2 - vínculos caso-actor derivables de la matriz (dry-run)")
    print("=" * 64)
    print(
        f"regla ................................ {'nombre+institucion' if con_institucion else 'solo nombre'}"
    )
    print(f"entradas con match ................... {resultado['entradas_usadas']}")
    print(f"pares únicos caso-actor .............. {len(pares)}")
    print(f"casos cubiertos ...................... {len(resultado['casos_usados'])}")
    print(f"actores distintos .................... {len({a for _, a in pares})}")
    print(f"ambiguos rechazados .................. {len(resultado['ambiguos'])}")
    for item in resultado["ambiguos"]:
        print(
            f"   - caso {item['caso_codigo']}: '{item['nombre']}' -> {item['candidatos']}"
        )
    print(f"entradas sin match ................... {resultado['sin_match']}")
    fps = [d for d in resultado["detalle"] if d["fp_probable"]]
    print(f"personas con nombre institucional (FP probable) ... {len(fps)}")
    for item in fps:
        print(f"   - {item['actor_nombre']}")


def escribir_backup(ruta: Path, payload: dict) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def aplicar(conn, cur, resultado: dict, backup: Path) -> None:
    for clave, valor in CONTEXTO_RLS:
        cur.execute("select set_config(%s, %s, false)", (clave, valor))
    ya = set(resultado["pares"])
    cur.execute("select caso_id::text, actor_id::text from core.casos_actores")
    existentes = {(c, a) for c, a in cur.fetchall()}
    nuevos = sorted(ya - existentes)

    insertados = 0
    for caso_id, actor_id in nuevos:
        cur.execute(
            """insert into core.casos_actores
                 (caso_id, actor_id, nivel_influencia, posicion, vigente_desde)
               values (%s::uuid, %s::uuid, 50, 'Neutral', current_date)
               on conflict do nothing""",
            (caso_id, actor_id),
        )
        insertados += cur.rowcount

    escribir_backup(
        backup,
        {
            "tarea": "B2 casos_actores",
            "generado_en": datetime.now(timezone.utc).isoformat(),
            "pares": [{"caso_id": c, "actor_id": a} for c, a in nuevos],
            "insertados": insertados,
        },
    )
    print(f"Respaldo escrito ANTES del commit: {backup}")
    conn.commit()
    print(f"COMMIT: {insertados} vínculos insertados (de {len(nuevos)} propuestos).")


def revertir(conn, cur, backup: Path, aplicar_cambios: bool) -> None:
    if not backup.exists():
        raise SystemExit(f"No existe el respaldo {backup}")
    payload = json.loads(backup.read_text(encoding="utf-8"))
    pares = payload.get("pares", [])
    print(f"vínculos a borrar .................... {len(pares)}")
    if not aplicar_cambios:
        print("ENSAYO: agrega --apply para revertir.")
        return
    for clave, valor in CONTEXTO_RLS:
        cur.execute("select set_config(%s, %s, false)", (clave, valor))
    borrados = 0
    for par in pares:
        cur.execute(
            "delete from core.casos_actores where caso_id=%s::uuid and actor_id=%s::uuid",
            (par["caso_id"], par["actor_id"]),
        )
        borrados += cur.rowcount
    conn.commit()
    print(f"COMMIT: {borrados} vínculos borrados.")


def main() -> None:
    parser = argparse.ArgumentParser(description="B2 - propuesta de casos_actores")
    parser.add_argument("--json", type=Path, default=JSON_DEFECTO)
    parser.add_argument("--backup", type=Path, default=BACKUP_DEFECTO)
    parser.add_argument("--con-institucion", action="store_true")
    parser.add_argument(
        "--emitir-propuesta",
        action="store_true",
        help="escribe el JSON de propuesta (sin escribir en la BD)",
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()

    conn = psycopg2.connect(url_owner())
    cur = conn.cursor()
    por_nombre, casos_bd = cargar_mapas(cur)

    if args.rollback:
        revertir(conn, cur, args.backup, args.apply)
        conn.close()
        return

    datos = json.loads(args.json.read_text(encoding="utf-8"))
    resultado = emparejar(datos, por_nombre, casos_bd, args.con_institucion)
    imprimir(resultado, casos_bd, args.con_institucion)

    if args.emitir_propuesta:
        # No pisar el respaldo de rollback: la propuesta va a un archivo aparte.
        ruta_propuesta = args.backup.with_name(args.backup.stem + ".propuesta.json")
        escribir_backup(
            ruta_propuesta,
            {
                "tarea": "B2 propuesta (solo lectura)",
                "generado_en": datetime.now(timezone.utc).isoformat(),
                "con_institucion": args.con_institucion,
                "detalle": resultado["detalle"],
                "ambiguos": resultado["ambiguos"],
                "sin_match": resultado["sin_match"],
            },
        )
        print(f"\nPropuesta escrita en {ruta_propuesta}")

    if not args.apply:
        print("\nENSAYO: script propuesto; no se ejecutó --apply.")
        conn.close()
        return

    aplicar(conn, cur, resultado, args.backup)
    conn.close()


if __name__ == "__main__":
    main()
