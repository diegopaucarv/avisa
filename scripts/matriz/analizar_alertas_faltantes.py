#!/usr/bin/env python3
"""AVISA · demandas del legado cuyo codigo de alerta (c05) no existe en core.

Recorre el legado cargado en PostgreSQL y responde, codigo a codigo:

  1. que codigos ``AT-`` de ``legacy.dim_demandas.c05`` no tienen contraparte en
     ``core.alertas_tempranas`` y cuantas demandas arrastra cada uno;
  2. si la alerta existe en ``legacy.dim_alertas`` (y por que no entro a core);
  3. que vinculo tienen esas alertas en ``legacy.bridge_alerta_demandas`` y que
     ``caso_id`` se les podria asignar;
  4. que salida conviene: crear la alerta, colgar la demanda de una alerta
     existente o declararla imposible.

Solo lectura: la sesion se abre con ``set_session(readonly=True)`` y el script
unicamente ejecuta SELECT. Escribe ``salida/alertas_faltantes.json``.

Uso:
    python scripts/matriz/analizar_alertas_faltantes.py
    python scripts/matriz/analizar_alertas_faltantes.py --dsn "postgresql://..."
    python scripts/matriz/analizar_alertas_faltantes.py --sin-escanear-legado
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from psycopg2 import sql

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = Path(__file__).resolve().parent / "salida" / "alertas_faltantes.json"

# Un codigo de alerta del legado: AT-2026-19, AT-2026-019, AT-2026-19-bis.
RE_CODIGO_AT = re.compile(r"AT-\d{4}-0*\d+(?:-bis)?", re.IGNORECASE)
RE_CODIGO_EXACTO = re.compile(r"^(AT)[-\s]*(\d{4})[-\s]*0*(\d+)(-bis)?$", re.IGNORECASE)
# TEMA-03 -> 3
RE_TEMA = re.compile(r"TEMA-0*(\d+)", re.IGNORECASE)

VEREDICTOS = ("crear_la_alerta", "colgar_de_alerta_existente", "imposible")


# --------------------------------------------------------------------------- #
#  Conexion
# --------------------------------------------------------------------------- #
def conectar(dsn_cli: str | None):
    """Abre la base en modo solo lectura y devuelve (conn, etiqueta)."""
    load_dotenv(RAIZ / ".env", override=False)

    candidatos: list[tuple[str, str]] = []
    if dsn_cli:
        candidatos.append(("--dsn", dsn_cli))
    if os.environ.get("AVISA_DSN"):
        candidatos.append(("AVISA_DSN", os.environ["AVISA_DSN"]))

    # Preferencia por el PostgreSQL local del compose: es el que tiene el
    # legado cargado y el que inspeccionan los demas scripts de scripts/matriz.
    usuario = os.environ.get("POSTGRES_USER")
    clave = os.environ.get("POSTGRES_PASSWORD")
    base = os.environ.get("POSTGRES_DB")
    if usuario and base:
        host = os.environ.get("POSTGRES_HOST", "localhost")
        puerto = os.environ.get("POSTGRES_PORT", "5432")
        candidatos.append(
            (
                "POSTGRES_*",
                f"postgresql://{usuario}:{clave or ''}@{host}:{puerto}/{base}",
            )
        )

    if os.environ.get("NEON_OWNER_URL"):
        candidatos.append(("NEON_OWNER_URL", os.environ["NEON_OWNER_URL"]))
    if os.environ.get("DATABASE_URL"):
        candidatos.append(("DATABASE_URL", os.environ["DATABASE_URL"]))

    if not candidatos:
        raise SystemExit("No hay DSN: revisa .env (POSTGRES_*/DATABASE_URL).")

    errores = []
    for etiqueta, dsn in candidatos:
        try:
            conn = psycopg2.connect(dsn, connect_timeout=8)
        except Exception as exc:  # noqa: BLE001 - se informan todos los intentos
            errores.append(f"{etiqueta}: {type(exc).__name__}")
            continue
        conn.set_session(readonly=True, autocommit=True)
        return conn, f"{etiqueta} → {_destino(dsn)}"

    raise SystemExit("No se pudo conectar: " + "; ".join(errores))


def _destino(dsn: str) -> str:
    """Describe el DSN sin exponer credenciales."""
    limpio = re.sub(r"//[^@/]*@", "//***@", dsn)
    return limpio if len(limpio) <= 90 else limpio[:87] + "..."


# --------------------------------------------------------------------------- #
#  Normalizacion de codigos
# --------------------------------------------------------------------------- #
def clave(codigo: str | None):
    """Devuelve la clave canonica de un codigo AT.

    Ignora el relleno con ceros y la marca de colision, de modo que
    ``AT-2026-19``, ``AT-2026-019`` y ``AT-2026-19-bis`` comparten clave.
    """
    if not codigo:
        return None
    m = RE_CODIGO_EXACTO.match(str(codigo).strip())
    if not m:
        return None
    return f"AT-{m.group(2)}-{int(m.group(3))}"


def tema_num(valor: str | None):
    if not valor:
        return None
    m = RE_TEMA.search(str(valor))
    return int(m.group(1)) if m else None


def norm_texto(texto: str | None) -> str:
    if not texto:
        return ""
    return re.sub(r"\s+", " ", str(texto)).strip().lower()


def como_json(valor):
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


# --------------------------------------------------------------------------- #
#  Lectura de datos (solo SELECT)
# --------------------------------------------------------------------------- #
def leer(cur, consulta: str):
    cur.execute(consulta)
    return [dict(f) for f in cur.fetchall()]


def cargar(cur) -> dict:
    return {
        "dim_alertas": leer(
            cur,
            """
            select fila_n, c01 as codigo, c03 as sector, c04 as fecha,
                   c09 as titulo
              from legacy.dim_alertas
             order by fila_n
            """,
        ),
        "dim_demandas": leer(
            cur,
            """
            select fila_n, c01 as codigo, c02 as texto, c05 as alerta,
                   c06 as tema
              from legacy.dim_demandas
             order by fila_n
            """,
        ),
        "bridge": leer(
            cur,
            """
            select fila_n, c01 as codigo, c02 as tra, c03 as alerta,
                   c04 as tema, c05 as demanda
              from legacy.bridge_alerta_demandas
             order by fila_n
            """,
        ),
        "bridge_actor": leer(
            cur,
            "select fila_n, c01 as codigo, c02 as alerta, c03 as actor "
            "from legacy.bridge_alerta_actor order by fila_n",
        ),
        "bridge_recurso": leer(
            cur,
            "select fila_n, c01 as codigo, c02 as recurso, c03 as alerta "
            "from legacy.bridge_alerta_recurso order by fila_n",
        ),
        "proceso": leer(
            cur,
            """
            select fila_n, c01 as reporte, c02 as alerta, c03 as paso,
                   c04 as sector, c05 as fecha, c08 as nota
              from legacy.fact_proceso_reporte
             order by fila_n
            """,
        ),
        "fact_casos": leer(
            cur,
            """
            select fila_n, c01 as codigo, c03 as nombre, c05 as tema,
                   c06 as fecha, c10 as sector
              from legacy.fact_casos
             order by fila_n
            """,
        ),
        "core_alertas": leer(
            cur,
            """
            select a.id, a.codigo_alerta, a.titulo, a.caso_id,
                   c.codigo_caso, a.codigo_legado
              from core.alertas_tempranas a
              left join core.casos c on c.id = a.caso_id
             order by a.codigo_alerta
            """,
        ),
        "core_demandas": leer(
            cur,
            """
            select d.id, d.codigo_legado, d.descripcion_demanda, d.alerta_id,
                   d.caso_id, d.tematica_id
              from core.demandas d
             order by d.codigo_legado
            """,
        ),
        "core_casos": leer(
            cur,
            "select id, codigo_legado, codigo_caso, nombre_caso from core.casos "
            "order by codigo_legado",
        ),
    }


def escanear_legado(cur, numeros_objetivo: set[int]) -> dict[int, dict[str, int]]:
    """Busca cada codigo huerfano en TODAS las tablas del schema legacy.

    Devuelve {numero: {tabla: filas}}. Es la prueba de si el bloque existe en
    algun sitio del origen o si de plano nunca se importo.
    """
    cur.execute(
        """
        select table_name
          from information_schema.tables
         where table_schema = 'legacy' and table_type = 'BASE TABLE'
         order by table_name
        """
    )
    tablas = [f["table_name"] for f in cur.fetchall()]
    hallazgos: dict[int, dict[str, int]] = {n: {} for n in numeros_objetivo}
    if not tablas or not numeros_objetivo:
        return hallazgos

    patron = "|".join(f"0*{n}" for n in sorted(numeros_objetivo))
    regex = f"AT-[0-9]{{4}}-({patron})([^0-9]|$)"

    con_hits: list[str] = []
    for tabla in tablas:
        cur.execute(
            sql.SQL(
                "select count(*) as n from legacy.{} x where to_jsonb(x)::text ~ %s"
            ).format(sql.Identifier(tabla)),
            (regex,),
        )
        if cur.fetchone()["n"]:
            con_hits.append(tabla)

    for numero in sorted(numeros_objetivo):
        patron_num = f"AT-[0-9]{{4}}-0*{numero}([^0-9]|$)"
        for tabla in con_hits:
            cur.execute(
                sql.SQL(
                    "select count(*) as n from legacy.{} x where to_jsonb(x)::text ~ %s"
                ).format(sql.Identifier(tabla)),
                (patron_num,),
            )
            n = cur.fetchone()["n"]
            if n:
                hallazgos[numero][tabla] = n
    return hallazgos


# --------------------------------------------------------------------------- #
#  Analisis
# --------------------------------------------------------------------------- #
def analizar(datos: dict, hallazgos: dict, escaneo_ok: bool) -> dict:
    # --- codigos existentes -------------------------------------------------
    core_por_clave: dict[str, list[dict]] = defaultdict(list)
    for alerta in datos["core_alertas"]:
        k = clave(alerta["codigo_alerta"]) or clave(alerta["codigo_legado"])
        if k:
            core_por_clave[k].append(alerta)

    dim_por_clave: dict[str, list[dict]] = defaultdict(list)
    for fila in datos["dim_alertas"]:
        k = clave(fila["codigo"])
        if k:
            dim_por_clave[k].append(fila)

    dim_filas = len(datos["dim_alertas"])
    dim_claves = len(
        {clave(f["codigo"]) for f in datos["dim_alertas"] if clave(f["codigo"])}
    )
    duplicados_dim = {k: len(v) for k, v in dim_por_clave.items() if len(v) > 1}
    bis_core = [
        a["codigo_alerta"]
        for a in datos["core_alertas"]
        if "-bis" in (a["codigo_alerta"] or "")
    ]

    # --- demandas del legado ----------------------------------------------
    total = len(datos["dim_demandas"])
    con_c05 = [d for d in datos["dim_demandas"] if (d["alerta"] or "").strip()]
    sin_c05 = total - len(con_c05)

    at_demandas = []
    c05_no_at = Counter()
    for d in con_c05:
        k = clave(d["alerta"])
        if k:
            at_demandas.append((d, k))
        else:
            c05_no_at[d["alerta"].strip()] += 1

    resueltas, formato_distinto = [], []
    faltantes: dict[str, list] = defaultdict(list)
    for d, k in at_demandas:
        if k in core_por_clave:
            destinos = {a["codigo_alerta"] for a in core_por_clave[k]}
            if d["alerta"].strip() in destinos:
                resueltas.append(d)
            else:
                formato_distinto.append((d, sorted(destinos)))
        else:
            faltantes[k].append(d)

    # --- indices auxiliares ------------------------------------------------
    demanda_por_codigo = {
        (d["codigo_legado"] or "").strip(): d for d in datos["core_demandas"]
    }
    por_texto: dict[str, list[dict]] = defaultdict(list)
    for d in datos["core_demandas"]:
        t = norm_texto(d["descripcion_demanda"])
        if t:
            por_texto[t].append(d)

    alerta_por_id = {a["id"]: a for a in datos["core_alertas"]}
    caso_por_legado = {}
    for c in datos["core_casos"]:
        for llave in (c["codigo_legado"], c["codigo_caso"]):
            if llave:
                caso_por_legado.setdefault(llave.strip(), c)

    bridge_por_alerta: dict[str, list[dict]] = defaultdict(list)
    for b in datos["bridge"]:
        k = clave(b["alerta"])
        if k:
            bridge_por_alerta[k].append(b)

    def indexar_por_codigo(filas: list[dict]) -> dict[str, list[dict]]:
        indice: dict[str, list[dict]] = defaultdict(list)
        for fila in filas:
            visto = False
            # Una fila puede citar el mismo codigo en varias columnas: se indexa
            # una sola vez para no inflar los conteos del reporte.
            for valor in fila.values():
                if visto:
                    break
                if not isinstance(valor, str):
                    continue
                for bruto in RE_CODIGO_AT.findall(valor):
                    k = clave(bruto)
                    if k:
                        indice[k].append(fila)
                        visto = True
                        break
        return indice

    actores_por_alerta = indexar_por_codigo(datos["bridge_actor"])
    recursos_por_alerta = indexar_por_codigo(datos["bridge_recurso"])
    proceso_por_alerta = indexar_por_codigo(datos["proceso"])

    def caso_de(codigo_legado: str | None):
        """Caso de core que corresponde a un codigo de fact_casos."""
        if not codigo_legado:
            return None, None
        caso = caso_por_legado.get(codigo_legado.strip())
        if not caso:
            return None, None
        return como_json(caso["id"]), caso["codigo_caso"] or caso["codigo_legado"]

    def candidatos_caso(sector, temas):
        """Casos compatibles por sector y tema, con confianza declarada."""
        temas = {t for t in temas if t is not None}
        candidatos = []
        for caso in datos["fact_casos"]:
            tema = tema_num(caso["tema"])
            if sector and caso["sector"] and caso["sector"] != sector:
                continue
            if temas and tema is not None and tema not in temas:
                continue
            candidatos.append(caso)
        candidatos.sort(key=lambda c: c["codigo"] or "")
        if not candidatos:
            confianza, elegido = "nula", None
        elif len(candidatos) == 1:
            confianza, elegido = "alta", candidatos[0]
        elif len(candidatos) <= 3:
            confianza, elegido = "media", candidatos[0]
        else:
            confianza, elegido = "baja", candidatos[0]
        return elegido, candidatos, confianza

    # --- analisis por codigo faltante -------------------------------------
    codigos = []
    for k, demandas in sorted(
        faltantes.items(), key=lambda kv: int(kv[0].rsplit("-", 1)[1])
    ):
        numero = int(k.rsplit("-", 1)[1])
        literales = sorted({(d["alerta"] or "").strip() for d in demandas})
        demandas_cod = [(d["codigo"] or "").strip() for d in demandas]
        temas = [tema_num(d["tema"]) for d in demandas]
        temas_validos = {t for t in temas if t is not None}

        # 2. Existe en dim_alertas? (literal o con otro relleno de ceros)
        filas_dim = dim_por_clave.get(k, [])
        existe_dim = bool(filas_dim)
        titulo = None
        sector_dim = None
        fecha_dim = None
        if filas_dim:
            con_titulo = [f for f in filas_dim if (f["titulo"] or "").strip()]
            elegida = con_titulo[0] if con_titulo else filas_dim[0]
            titulo = (elegida["titulo"] or "").strip() or None
            sector_dim = elegida["sector"]
            fecha_dim = elegida["fecha"]

        # 3. Vinculo en el puente
        filas_bridge = bridge_por_alerta.get(k, [])
        actores = actores_por_alerta.get(k, [])
        recursos = recursos_por_alerta.get(k, [])
        procesos = proceso_por_alerta.get(k, [])
        vinculo_bridge = sorted({(b["demanda"] or "").strip() for b in filas_bridge})
        sectores_proceso = sorted({p["sector"] for p in procesos if p["sector"]})
        fechas_proceso = sorted({como_json(p["fecha"]) for p in procesos if p["fecha"]})
        sector = sector_dim or (sectores_proceso[0] if sectores_proceso else None)
        fecha = fecha_dim or (fechas_proceso[0] if fechas_proceso else None)

        # Gemelos textuales ya vinculados a una alerta de core
        votos: Counter = Counter()
        gemelos: list[dict] = []
        for d in demandas:
            d_core = demanda_por_codigo.get((d["codigo"] or "").strip())
            if not d_core:
                continue
            t = norm_texto(d_core["descripcion_demanda"])
            for otro in por_texto.get(t, []):
                if not otro["alerta_id"] or otro["id"] == d_core["id"]:
                    continue
                if (otro["codigo_legado"] or "") == (d_core["codigo_legado"] or ""):
                    continue
                votos[otro["alerta_id"]] += 1
                gemelos.append(
                    {
                        "demanda": (d_core["codigo_legado"] or "").strip(),
                        "gemelo": (otro["codigo_legado"] or "").strip(),
                        "alerta": alerta_por_id.get(otro["alerta_id"], {}).get(
                            "codigo_alerta"
                        ),
                        "caso_id": como_json(otro["caso_id"]),
                    }
                )
        cobertura_gemelos = (
            len({g["demanda"] for g in gemelos}) / len(demandas) if demandas else 0
        )
        destino = None
        if votos:
            destino = alerta_por_id.get(votos.most_common(1)[0][0])

        # 4. Caso candidato
        caso_cand, casos_cand, confianza_caso = candidatos_caso(sector, temas_validos)
        caso_id_cand, caso_codigo_cand = caso_de((caso_cand or {}).get("codigo"))

        # 4. Veredicto
        if existe_dim and titulo:
            veredicto = "crear_la_alerta"
            via = "dim_alertas"
            caso_id, caso_codigo = caso_id_cand, caso_codigo_cand
            motivo = (
                f"La alerta existe en dim_alertas ({filas_dim[0]['codigo']}) y no "
                f"entro a core: reimportarla por codigo_legado. "
                f"{len(demandas)} demanda(s) se recuperan al crearla."
            )
        elif cobertura_gemelos >= 0.5 and destino:
            veredicto = "colgar_de_alerta_existente"
            via = "duplicado_textual"
            caso_id = como_json(destino["caso_id"])
            caso_codigo = destino.get("codigo_caso")
            motivo = (
                f"{len({g['demanda'] for g in gemelos})}/{len(demandas)} demanda(s) "
                f"tienen texto identico ya vinculado a {destino['codigo_alerta']} "
                f"(codigo distinto: el bloque se renumero o duplico). Colgarlas de "
                f"esa alerta recupera el vinculo, pero quedan demandas gemelas en "
                f"la misma alerta: evaluar deduplicacion antes de aplicar."
            )
        elif (procesos or (actores and filas_bridge)) and (sector or fecha):
            veredicto = "crear_la_alerta"
            via = "trazas_legado"
            caso_id, caso_codigo = caso_id_cand, caso_codigo_cand
            motivo = (
                "El maestro (dim_alertas) no trae la fila, pero el legado conserva "
                f"sector={sector or '?'}, fecha={fecha or '?'}, "
                f"{len(procesos)} proceso(s), {len(actores)} actor(es) y "
                f"{len(filas_bridge)} vinculo(s) a demandas: se puede crear una "
                "alerta cabecera con esos datos. Titulo y descripcion solo salen "
                "del origen (hoja de alertas), no de la base."
            )
        else:
            veredicto = "imposible"
            via = "ninguna"
            caso_id, caso_codigo = caso_id_cand, caso_codigo_cand
            motivo = (
                "Sin fila en dim_alertas, sin proceso que fije sector o fecha y sin "
                "demanda gemela vinculada: no hay origen para reconstruir la alerta. "
                "Solo sobreviven relaciones sueltas "
                f"({len(filas_bridge)} puente, {len(actores)} actor(es)). La demanda "
                "queda sin alerta y sin caso hasta recuperar el origen."
            )

        # Solo se propone caso si la evidencia lo sostiene: con gemelos
        # vinculados el caso sale del destino; por sector/tema se exige media.
        if veredicto == "colgar_de_alerta_existente" and destino:
            tiene_caso = bool(destino["caso_id"])
            confianza_caso = "alta" if tiene_caso else "nula"
            n_casos = 1 if tiene_caso else 0
            if not tiene_caso:
                caso_id, caso_codigo = None, None
        else:
            n_casos = len(casos_cand)
            if confianza_caso in ("baja", "nula"):
                caso_id, caso_codigo = None, None

        codigos.append(
            {
                "codigo": k,
                "literales": literales,
                "demandas": len(demandas),
                "demanda_codigos": demandas_cod,
                "temas": sorted(temas_validos),
                "existe_en_dim_alertas": existe_dim,
                "dim_alertas": {
                    "filas": len(filas_dim),
                    "codigo": filas_dim[0]["codigo"] if filas_dim else None,
                    "sector": sector_dim,
                    "fecha": como_json(fecha_dim),
                },
                "existe_en_core": False,
                "titulo": titulo,
                "caso_id": caso_id,
                "caso_codigo": caso_codigo,
                "confianza_caso": confianza_caso,
                "casos_candidatos": n_casos,
                "veredicto": veredicto,
                "via": via,
                "alerta_destino": (destino or {}).get("codigo_alerta"),
                "alerta_destino_titulo": (destino or {}).get("titulo"),
                "motivo": motivo,
                "vinculo": {
                    "bridge_filas": len(filas_bridge),
                    "bridge_demandas": vinculo_bridge,
                    "actores": len(actores),
                    "recursos": len(recursos),
                    "procesos": len(procesos),
                    "sector": sector,
                    "fechas": fechas_proceso,
                },
                "gemelos_vinculados": gemelos,
                "cobertura_gemelos": round(cobertura_gemelos, 3),
                "origen_en_legado": hallazgos.get(numero, {}),
            }
        )

    variantes_formato = {}
    for d, destinos in formato_distinto:
        llave = (d["alerta"] or "").strip()
        item = variantes_formato.setdefault(
            llave, {"legado": llave, "core": destinos, "demandas": 0}
        )
        item["demandas"] += 1
    variantes_formato = sorted(variantes_formato.values(), key=lambda v: v["legado"])

    resumen_veredicto = {v: {"codigos": 0, "demandas": 0} for v in VEREDICTOS}
    for c in codigos:
        resumen_veredicto[c["veredicto"]]["codigos"] += 1
        resumen_veredicto[c["veredicto"]]["demandas"] += c["demandas"]

    resumen = {
        "legado": {
            "dim_alertas_filas": dim_filas,
            "dim_alertas_codigos_distintos": dim_claves,
            "dim_alertas_codigos_duplicados": duplicados_dim,
            "core_alertas": len(datos["core_alertas"]),
            "core_alertas_bis": bis_core,
            "dim_demandas": total,
            "dim_demandas_con_c05": len(con_c05),
            "dim_demandas_sin_c05": sin_c05,
            "c05_con_codigo_at": len(at_demandas),
            "c05_no_at": dict(c05_no_at),
            "resueltas_literal": len(resueltas),
            "resueltas_por_formato": len(formato_distinto),
            "resueltas_total": len(resueltas) + len(formato_distinto),
            "codigos_faltantes": len(codigos),
            "demandas_faltantes": sum(c["demandas"] for c in codigos),
        },
        "bridge": {
            "filas": len(datos["bridge"]),
            "alertas": len(bridge_por_alerta),
            "demandas": len({(b["demanda"] or "").strip() for b in datos["bridge"]}),
        },
        "por_veredicto": resumen_veredicto,
        "recuperables_por_salida": {
            v: resumen_veredicto[v]["demandas"] for v in VEREDICTOS
        },
        "escaneo_legado": {
            "ejecutado": escaneo_ok,
            "codigos_con_rastro": sorted(
                c["codigo"] for c in codigos if c["origen_en_legado"]
            ),
        },
    }

    return {
        "generado_en": datetime.now().isoformat(timespec="seconds"),
        "premisa_encargo": {
            "declarado": {
                "dim_alertas": 83,
                "core_alertas_tempranas": 82,
                "resueltas_por_titulo": 81,
                "demandas_con_c05": 248,
                "demandas_resolubles": 190,
                "codigos_faltantes": 58,
            },
            "observado": {
                "dim_alertas_filas": dim_filas,
                "dim_alertas_codigos_distintos": dim_claves,
                "core_alertas_tempranas": len(datos["core_alertas"]),
                "demandas_con_c05": len(con_c05),
                "demandas_resolubles": len(resueltas) + len(formato_distinto),
                "codigos_faltantes": len(codigos),
                "demandas_faltantes": sum(c["demandas"] for c in codigos),
            },
            "nota": (
                "El total de demandas con c05 si coincide (248). El resto no: la "
                "base actual tiene 83 alertas en core (no 82) y 222 demandas "
                "resueltas (no 190). El 83/82 del encargo se explica contando "
                "filas frente a codigos: dim_alertas tiene 83 filas pero 81 "
                "codigos distintos (AT-2026-48 y -49 duplicados), y core conserva "
                "esos duplicados como '-bis' (83 = 81 + 2). Los 58 faltantes del "
                "encargo no se reproducen: hoy son 14 demandas en 5 codigos AT "
                "(mas 12 demandas cuyo c05 no es un codigo de alerta: RR-, CS-, "
                "TEMA-). El conteo de faltantes se hace por clave canonica "
                "(ignora relleno de ceros), que es la unica forma estable con "
                "este legado."
            ),
        },
        "diagnostico": {
            "c05_que_no_es_alerta": dict(c05_no_at),
            "variantes_de_formato": variantes_formato,
        },
        "codigos": codigos,
        "resumen": resumen,
    }


# --------------------------------------------------------------------------- #
#  Presentacion
# --------------------------------------------------------------------------- #
def imprimir(resultado: dict) -> None:
    resumen = resultado["resumen"]
    legado = resumen["legado"]

    print("=" * 100)
    print("AVISA · demandas del legado sin alerta en core")
    print("=" * 100)
    print(
        f"dim_alertas: {legado['dim_alertas_filas']} filas / "
        f"{legado['dim_alertas_codigos_distintos']} codigos distintos   "
        f"core.alertas_tempranas: {legado['core_alertas']} alertas "
        f"({len(legado['core_alertas_bis'])} '-bis')"
    )
    print(
        f"dim_demandas: {legado['dim_demandas']} | con c05: "
        f"{legado['dim_demandas_con_c05']} | sin c05: {legado['dim_demandas_sin_c05']} "
        f"| c05 AT-: {legado['c05_con_codigo_at']} "
        f"(resueltas {legado['resueltas_total']}: {legado['resueltas_literal']} "
        f"literal + {legado['resueltas_por_formato']} por formato; faltantes "
        f"{legado['demandas_faltantes']})"
    )
    if legado["c05_no_at"]:
        otros = ", ".join(f"{k}={v}" for k, v in sorted(legado["c05_no_at"].items()))
        print(f"c05 con otros prefijos (no son alertas): {otros}")
    print()

    cabecera = [
        ("CODIGO", 14),
        ("DEM", 4),
        ("DIM_AL", 6),
        ("VEREDICTO", 26),
        ("DESTINO", 12),
        ("CASO", 9),
        ("MOTIVO", 58),
    ]
    print("  ".join(t.ljust(w) for t, w in cabecera))
    print("-" * 100)
    for c in resultado["codigos"]:
        fila = [
            c["codigo"],
            str(c["demandas"]),
            "si" if c["existe_en_dim_alertas"] else "no",
            c["veredicto"],
            c["alerta_destino"] or "-",
            (c["caso_codigo"] or "-")[:9],
            c["motivo"],
        ]
        print("  ".join(str(v)[:w].ljust(w) for v, (_, w) in zip(fila, cabecera)))

    print()
    print("-" * 100)
    print("RESUMEN POR VEREDICTO")
    for veredicto in VEREDICTOS:
        datos = resumen["por_veredicto"][veredicto]
        print(
            f"  {veredicto:<28} codigos {datos['codigos']:>2}   "
            f"demandas recuperables {datos['demandas']:>2}"
        )
    print(
        f"  {'TOTAL':<28} codigos {legado['codigos_faltantes']:>2}   "
        f"demandas {legado['demandas_faltantes']:>2}"
    )

    print()
    print("Casos propuestos:")
    for c in resultado["codigos"]:
        if c["caso_id"]:
            print(
                f"  {c['codigo']}: caso {c['caso_codigo']} ({c['caso_id']}) "
                f"[{c['confianza_caso']}, {c['casos_candidatos']} candidato(s), "
                f"via {c['via']}]"
            )
        else:
            print(
                f"  {c['codigo']}: sin caso determinable "
                f"({c['casos_candidatos']} candidato(s) por sector/tema)"
            )
    print()
    print(f"JSON: {SALIDA}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", help="DSN explicito (por defecto usa .env)")
    parser.add_argument("--salida", default=str(SALIDA), help="Ruta del JSON de salida")
    parser.add_argument(
        "--sin-escanear-legado",
        action="store_true",
        help="Omite el barrido de todas las tablas del schema legacy",
    )
    args = parser.parse_args()

    conn, etiqueta = conectar(args.dsn)
    print(f"conexion: {etiqueta}")
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            datos = cargar(cur)
            faltantes_nums = {
                int(clave(d["alerta"]).rsplit("-", 1)[1])
                for d in datos["dim_demandas"]
                if clave(d["alerta"])
                and clave(d["alerta"])
                not in {clave(a["codigo_alerta"]) for a in datos["core_alertas"]}
            }
            hallazgos: dict = {}
            escaneo_ok = False
            if not args.sin_escanear_legado and faltantes_nums:
                hallazgos = escanear_legado(cur, faltantes_nums)
                escaneo_ok = True
        resultado = analizar(datos, hallazgos, escaneo_ok)
    finally:
        conn.close()

    resultado["conexion"] = etiqueta

    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(
        json.dumps(resultado, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    imprimir(resultado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
