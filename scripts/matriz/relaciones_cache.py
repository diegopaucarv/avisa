#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Staging en archivos de la "tercera tabla" de relaciones de la matriz.

No abre ninguna conexion: lee ``scripts/matriz/salida/matriz_2026.json`` y
escribe, junto a el, ``relaciones.json`` y ``relaciones_vinculos.csv``.

Claves sinteticas deterministas: ``sha1(texto_normalizado)[:16]`` con prefijo
de tabla. El texto normalizado es ``caso|...`` para compromisos, hitos y
actores, de modo que un texto repetido en dos casos genere claves distintas.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
SALIDA = AQUI / "salida"
ENTRADA = SALIDA / "matriz_2026.json"
JSON_SALIDA = SALIDA / "relaciones.json"
CSV_SALIDA = SALIDA / "relaciones_vinculos.csv"

try:
    RAIZ = AQUI.parents[1]
except IndexError:  # pragma: no cover - estructura inesperada
    RAIZ = AQUI

# Totales que debe reportar el parser para el mismo insumo.
ESPERADO = {
    "casos": 37,
    "demandas": 23,
    "compromisos": 56,
    "hitos": 111,
    "actores": 243,
    "vinculos_demanda_compromiso": 19,
    "vinculos_compromiso_hito": 107,  # 111 hitos - 4 hito sin compromiso
    "vinculos_caso_actor": 243,
    "claves_mapa": 470,  # 37 + 23 + 56 + 111 + 243
}

_ESPACIOS = re.compile(r"\s+")


def normalizar(valor) -> str:
    """Normalizacion estable: NFC, espacios colapsados, sin extremos, casefold."""
    texto = "" if valor is None else str(valor)
    texto = unicodedata.normalize("NFC", texto)
    texto = _ESPACIOS.sub(" ", texto).strip()
    return texto.casefold()


def sha16(texto: str) -> str:
    return hashlib.sha1(texto.encode("utf-8")).hexdigest()[:16]


def clave(tabla: str, *partes) -> str:
    compuesto = "|".join(normalizar(p) for p in partes)
    return f"{tabla}:{sha16(compuesto)}"


def ruta_visible(p: Path) -> str:
    try:
        return p.resolve().relative_to(RAIZ.resolve()).as_posix()
    except ValueError:
        return str(p)


def una_linea(valor) -> str:
    return _ESPACIOS.sub(" ", "" if valor is None else str(valor)).strip()


def main() -> int:
    if not ENTRADA.exists():
        print(f"ERROR: no existe el insumo {ENTRADA}")
        return 2

    with ENTRADA.open(encoding="utf-8") as fh:
        datos = json.load(fh)
    casos_fuente = datos.get("casos") or []
    resumen = datos.get("resumen") or {}
    anomalias = datos.get("anomalias") or []

    casos = []
    demandas = []
    compromisos = []
    hitos = []
    actores = []
    v_dem_comp = []
    v_comp_hito = []
    v_caso_actor = []

    mapa_claves: dict[str, dict] = {}
    colisiones: list[dict] = []
    texto_por_clave: dict[str, str] = {}
    nombre_por_caso: dict[str, str] = {}

    def registrar(clave_, tabla, caso_nombre, caso_id, n, fila_origen) -> None:
        previa = mapa_claves.get(clave_)
        if previa is not None:
            colisiones.append(
                {
                    "clave": clave_,
                    "tabla": tabla,
                    "previo": previa,
                    "nuevo": {
                        "caso": caso_nombre,
                        "caso_id": caso_id,
                        "n": n,
                        "fila_origen": fila_origen,
                    },
                }
            )
            return
        mapa_claves[clave_] = {
            "tabla": tabla,
            "caso": caso_nombre,
            "caso_id": caso_id,
            "n": n,
            "fila_origen": fila_origen,
        }

    for indice, fuente in enumerate(casos_fuente, start=1):
        # ``n`` no sirve como identidad: falta en 3 casos y se repite ("15")
        # en 2. Se usa el ordinal del JSON, determinista y unico.
        caso_id = f"C{indice:02d}"
        caso_nombre = fuente.get("nombre")
        caso_n = fuente.get("n")
        nombre_por_caso[caso_id] = caso_nombre or ""

        caso_clave = clave("caso", caso_id, caso_nombre)
        registrar(
            caso_clave,
            "casos",
            caso_nombre,
            caso_id,
            caso_n,
            fuente.get("filas"),
        )
        casos.append(
            {
                "clave": caso_clave,
                "caso": caso_id,
                "indice": indice,
                "n": caso_n,
                "nombre": caso_nombre,
                "region": fuente.get("region"),
                "sectorista": fuente.get("sectorista"),
                "altura": fuente.get("altura"),
                "filas": fuente.get("filas"),
                "orden": indice,
            }
        )
        texto_por_clave[caso_clave] = caso_nombre or ""

        mapa_demanda: dict[str, str] = {}
        for orden, fila in enumerate(fuente.get("demandas") or [], start=1):
            texto = fila.get("texto")
            k = clave("demanda", caso_id, texto)
            registrar(k, "demandas", caso_nombre, caso_id, caso_n, fila.get("fila"))
            demandas.append(
                {
                    "clave": k,
                    "caso_clave": caso_clave,
                    "caso": caso_id,
                    "caso_n": caso_n,
                    "texto": texto,
                    "tematica": fila.get("tematica"),
                    "fila": fila.get("fila"),
                    "orden": orden,
                }
            )
            texto_por_clave[k] = texto or ""
            mapa_demanda[texto] = k

        mapa_compromiso: dict[str, str] = {}
        for orden, fila in enumerate(fuente.get("compromisos") or [], start=1):
            texto = fila.get("texto")
            k = clave("compromiso", caso_id, texto)
            registrar(k, "compromisos", caso_nombre, caso_id, caso_n, fila.get("fila"))
            compromisos.append(
                {
                    "clave": k,
                    "caso_clave": caso_clave,
                    "caso": caso_id,
                    "caso_n": caso_n,
                    "texto": texto,
                    "fuente": fila.get("fuente"),
                    "area_responsable": fila.get("area_responsable"),
                    "punto_focal": fila.get("punto_focal"),
                    "status": fila.get("status"),
                    "fila": fila.get("fila"),
                    "orden": orden,
                }
            )
            texto_por_clave[k] = texto or ""
            mapa_compromiso[texto] = k

        contador_hitos: dict[str, int] = {}
        for orden, fila in enumerate(fuente.get("hitos") or [], start=1):
            comp_texto = fila.get("compromiso")
            comp_clave = mapa_compromiso.get(comp_texto) if comp_texto else None
            etiqueta = fila.get("etiqueta")
            descripcion = fila.get("descripcion")
            k = clave("hito", caso_id, comp_texto, etiqueta, descripcion)
            registrar(k, "hitos", caso_nombre, caso_id, caso_n, fila.get("fila"))
            hitos.append(
                {
                    "clave": k,
                    "caso_clave": caso_clave,
                    "caso": caso_id,
                    "caso_n": caso_n,
                    "compromiso_clave": comp_clave,
                    "compromiso_texto": comp_texto,
                    "etiqueta": etiqueta,
                    "descripcion": descripcion,
                    "responsable": fila.get("responsable"),
                    "fecha_planificada": fila.get("fecha_planificada"),
                    "fecha_planificada_texto": fila.get("fecha_planificada_texto"),
                    "fecha_real": fila.get("fecha_real"),
                    "fecha_real_texto": fila.get("fecha_real_texto"),
                    "estado": fila.get("estado"),
                    "medios": fila.get("medios"),
                    "documentos": fila.get("documentos"),
                    "fila": fila.get("fila"),
                    "orden": orden,
                }
            )
            texto_por_clave[k] = (
                f"{una_linea(etiqueta)}: {una_linea(descripcion)}".strip(": ")
            )

            if comp_clave:
                contador_hitos[comp_clave] = contador_hitos.get(comp_clave, 0) + 1
                v_comp_hito.append(
                    {
                        "caso_clave": caso_clave,
                        "origen_clave": comp_clave,
                        "destino_clave": k,
                        "orden": contador_hitos[comp_clave],
                    }
                )

        for orden, fila in enumerate(fuente.get("actores") or [], start=1):
            origen = fila.get("origen")
            crudo = fila.get("crudo")
            k = clave("actor", caso_id, origen, crudo)
            registrar(k, "actores", caso_nombre, caso_id, caso_n, fila.get("fila"))
            actores.append(
                {
                    "clave": k,
                    "caso_clave": caso_clave,
                    "caso": caso_id,
                    "caso_n": caso_n,
                    "origen": origen,
                    "nombre": fila.get("nombre"),
                    "telefono": fila.get("telefono"),
                    "detalle": fila.get("detalle"),
                    "crudo": crudo,
                    "orden": orden,
                }
            )
            texto_por_clave[k] = una_linea(fila.get("nombre") or crudo)
            v_caso_actor.append(
                {
                    "caso_clave": caso_clave,
                    "origen_clave": caso_clave,
                    "destino_clave": k,
                    "orden": orden,
                }
            )

        for orden, fila in enumerate(
            fuente.get("vinculos_demanda_compromiso") or [], start=1
        ):
            v_dem_comp.append(
                {
                    "caso_clave": caso_clave,
                    "origen_clave": mapa_demanda.get(fila.get("demanda")),
                    "destino_clave": mapa_compromiso.get(fila.get("compromiso")),
                    "orden": orden,
                }
            )

    entidades = {
        "casos": casos,
        "demandas": demandas,
        "compromisos": compromisos,
        "hitos": hitos,
        "actores": actores,
    }
    vinculos = {
        "demanda_compromiso": v_dem_comp,
        "compromiso_hito": v_comp_hito,
        "caso_actor": v_caso_actor,
    }

    # ------------------------------------------------------------------
    # Integridad
    # ------------------------------------------------------------------
    def revisar_vinculos(tipo, filas, prefijo_origen, prefijo_destino):
        rotos = []
        for numero, vinculo in enumerate(filas, start=1):
            for lado, prefijo in (
                ("origen_clave", prefijo_origen),
                ("destino_clave", prefijo_destino),
            ):
                k = vinculo.get(lado)
                if not k or k not in mapa_claves or not k.startswith(prefijo + ":"):
                    rotos.append(
                        {
                            "tipo": tipo,
                            "n": numero,
                            "lado": lado,
                            "clave": k,
                            "caso_clave": vinculo.get("caso_clave"),
                        }
                    )
        return {
            "ok": not rotos,
            "total": len(filas),
            "rotos": rotos,
        }

    check_vinculos = {
        "demanda_compromiso": revisar_vinculos(
            "demanda_compromiso", v_dem_comp, "demanda", "compromiso"
        ),
        "compromiso_hito": revisar_vinculos(
            "compromiso_hito", v_comp_hito, "compromiso", "hito"
        ),
        "caso_actor": revisar_vinculos("caso_actor", v_caso_actor, "caso", "actor"),
    }
    total_vinculos = sum(c["total"] for c in check_vinculos.values())
    total_rotos = sum(len(c["rotos"]) for c in check_vinculos.values())

    sin_compromiso = [h for h in hitos if not h.get("compromiso_clave")]
    anomalias_hito = {
        (a.get("caso"), a.get("hito"))
        for a in anomalias
        if a.get("motivo") == "hito sin compromiso"
    }
    cubiertos = sum(
        1
        for h in sin_compromiso
        if (nombre_por_caso.get(h["caso"]), h.get("etiqueta")) in anomalias_hito
    )
    excepciones = [
        {
            "caso": nombre_por_caso.get(h["caso"]),
            "caso_id": h["caso"],
            "etiqueta": h.get("etiqueta"),
            "fila": h.get("fila"),
            "descripcion": h.get("descripcion"),
        }
        for h in sin_compromiso
    ]

    total_filas = sum(len(filas) for filas in entidades.values())
    check_claves = {
        "ok": not colisiones and len(mapa_claves) == total_filas,
        "total_claves": len(mapa_claves),
        "total_filas": total_filas,
        "duplicadas": colisiones,
    }

    filas_conteo = [
        ("casos", len(casos), ESPERADO["casos"]),
        ("demandas", len(demandas), ESPERADO["demandas"]),
        ("compromisos", len(compromisos), ESPERADO["compromisos"]),
        ("hitos", len(hitos), ESPERADO["hitos"]),
        ("actores", len(actores), ESPERADO["actores"]),
        (
            "vinculos demanda_compromiso",
            len(v_dem_comp),
            ESPERADO["vinculos_demanda_compromiso"],
        ),
        (
            "vinculos compromiso_hito",
            len(v_comp_hito),
            ESPERADO["vinculos_compromiso_hito"],
        ),
        ("vinculos caso_actor", len(v_caso_actor), ESPERADO["vinculos_caso_actor"]),
        ("claves en mapa_claves", len(mapa_claves), ESPERADO["claves_mapa"]),
    ]
    totales_ok = all(actual == esperado for _, actual, esperado in filas_conteo)

    pares_resumen = {
        "casos": ("casos", resumen.get("casos")),
        "demandas": ("pares_caso_demanda", resumen.get("pares_caso_demanda")),
        "compromisos": (
            "pares_caso_compromiso",
            resumen.get("pares_caso_compromiso"),
        ),
        "hitos": ("hitos", resumen.get("hitos")),
        "vinculos_demanda_compromiso": (
            "pares_demanda_compromiso",
            resumen.get("pares_demanda_compromiso"),
        ),
    }
    actuales = {
        "casos": len(casos),
        "demandas": len(demandas),
        "compromisos": len(compromisos),
        "hitos": len(hitos),
        "vinculos_demanda_compromiso": len(v_dem_comp),
    }
    coincide_resumen = all(
        resumen.get(llave_resumen) == actuales[nombre]
        for nombre, (llave_resumen, _) in pares_resumen.items()
    )

    check_totales = {
        "ok": totales_ok and coincide_resumen,
        "esperado": dict(ESPERADO),
        "filas": [
            {
                "conjunto": nombre,
                "actual": actual,
                "esperado": esperado,
                "ok": actual == esperado,
            }
            for nombre, actual, esperado in filas_conteo
        ],
        "coincide_resumen_insumo": coincide_resumen,
    }

    check_hitos = {
        "ok": not sin_compromiso,
        "total_hitos": len(hitos),
        "con_compromiso": len(hitos) - len(sin_compromiso),
        "sin_compromiso": len(sin_compromiso),
        "coinciden_con_anomalias_insumo": cubiertos == len(sin_compromiso)
        and len(anomalias_hito) == len(sin_compromiso),
        "excepciones": excepciones,
    }

    incidencias = (
        (0 if check_claves["ok"] else 1)
        + (0 if total_rotos == 0 else 1)
        + (0 if check_totales["ok"] else 1)
        + (0 if check_hitos["ok"] else 1)
    )
    integridad = {
        "ok": incidencias == 0,
        "ok_salvo_excepciones_documentadas": incidencias == 0
        or (incidencias == 1 and check_hitos["coinciden_con_anomalias_insumo"]),
        "checks": {
            "hitos_con_compromiso": check_hitos,
            "vinculos_resolubles": {
                "ok": total_rotos == 0,
                "total": total_vinculos,
                "por_tipo": {
                    tipo: {
                        "total": datos_tipo["total"],
                        "rotos": len(datos_tipo["rotos"]),
                    }
                    for tipo, datos_tipo in check_vinculos.items()
                },
                "rotos": [roto for c in check_vinculos.values() for roto in c["rotos"]],
            },
            "claves_unicas": check_claves,
            "totales": check_totales,
        },
    }

    contenido = {
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fuente": ruta_visible(ENTRADA),
        "entidades": entidades,
        "vinculos": vinculos,
        "mapa_claves": mapa_claves,
        "integridad": integridad,
    }
    JSON_SALIDA.write_text(
        json.dumps(contenido, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    with CSV_SALIDA.open("w", encoding="utf-8-sig", newline="") as fh:
        escritor = csv.writer(fh)
        escritor.writerow(
            [
                "tipo",
                "caso_id",
                "caso_nombre",
                "orden",
                "origen_clave",
                "destino_clave",
                "origen_texto",
                "destino_texto",
            ]
        )
        for tipo, filas in vinculos.items():
            for vinculo in filas:
                info_caso = mapa_claves.get(vinculo.get("caso_clave"), {})
                escritor.writerow(
                    [
                        tipo,
                        info_caso.get("caso_id") or "",
                        info_caso.get("caso") or "",
                        vinculo.get("orden"),
                        vinculo.get("origen_clave") or "",
                        vinculo.get("destino_clave") or "",
                        una_linea(texto_por_clave.get(vinculo.get("origen_clave"))),
                        una_linea(texto_por_clave.get(vinculo.get("destino_clave"))),
                    ]
                )

    # ------------------------------------------------------------------
    # Reporte por pantalla
    # ------------------------------------------------------------------
    print("relaciones_cache.py - staging de relaciones (sin base de datos)")
    print(f"fuente : {ruta_visible(ENTRADA)}")
    print(f"json   : {ruta_visible(JSON_SALIDA)}")
    print(f"csv    : {ruta_visible(CSV_SALIDA)}")
    print()

    print("CONTEOS")
    print("-" * 62)
    print(f"{'conjunto':<30}{'actual':>8}{'esperado':>11}  estado")
    print("-" * 62)
    for nombre, actual, esperado in filas_conteo:
        estado = "OK" if actual == esperado else "FALLA"
        print(f"{nombre:<30}{actual:>8}{esperado:>11}  {estado}")
    print("-" * 62)
    print()

    print("INTEGRIDAD")
    print("-" * 62)

    estado_hitos = "OK" if check_hitos["ok"] else "FALLA"
    print(
        f"[{estado_hitos}] hitos con compromiso: "
        f"{check_hitos['con_compromiso']}/{check_hitos['total_hitos']}"
        f" ({check_hitos['sin_compromiso']} sin compromiso)"
    )
    if sin_compromiso:
        print(
            "        excepciones documentadas en anomalias del insumo: "
            f"{cubiertos}/{len(sin_compromiso)}"
        )
        for excepcion in excepciones[:10]:
            print(
                f"        - {excepcion['caso_id']} {excepcion['caso']} / "
                f"{excepcion['etiqueta']} (fila {excepcion['fila']})"
            )

    estado_vinculos = "OK" if total_rotos == 0 else "FALLA"
    print(
        f"[{estado_vinculos}] vinculos resueltos: {total_vinculos - total_rotos}"
        f"/{total_vinculos}"
    )
    for roto in integridad["checks"]["vinculos_resolubles"]["rotos"][:10]:
        print(f"        - {roto['tipo']} n={roto['n']} {roto['lado']}={roto['clave']}")

    estado_claves = "OK" if check_claves["ok"] else "FALLA"
    print(
        f"[{estado_claves}] claves unicas: {check_claves['total_claves']} claves, "
        f"{len(colisiones)} duplicadas"
    )
    for colision in colisiones[:10]:
        print(
            f"        - {colision['clave']} en {colision['tabla']} "
            f"(caso {colision['nuevo']['caso_id']})"
        )

    estado_totales = "OK" if check_totales["ok"] else "FALLA"
    print(
        f"[{estado_totales}] totales cuadran con el resumen del parser"
        f" (coincide_resumen={coincide_resumen})"
    )
    print()

    if integridad["ok"]:
        print("RESULTADO: OK")
    elif integridad["ok_salvo_excepciones_documentadas"]:
        print(
            "RESULTADO: OK salvo las excepciones documentadas "
            f"({check_hitos['sin_compromiso']} hito sin compromiso en el insumo)"
        )
    else:
        print("RESULTADO: FALLA")

    return 0 if integridad["ok_salvo_excepciones_documentadas"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
