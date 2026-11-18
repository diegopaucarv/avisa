"""Medición en vivo del delta legado → v10: atributos, clases, tipado y calidad.

Genera cinco gráficos en `docs/img/` y, si el documento padre tiene los
marcadores, inyecta en él la tabla de las 86 hojas:

    delta_estructura.svg    objetos de esquema, legado vs modelo
    delta_clases_legacy.svg hojas por clase, clase original vs clase final
    delta_atributos.svg     tipado de columnas y columnas por clase
    delta_esquemas.svg      tablas y columnas por esquema del modelo
    delta_calidad.svg       inconsistencias y duplicidades del legado

Ningún gráfico compara volumen de filas entre orillas: las filas solo aparecen
donde son el defecto (duplicidades, huecos, huérfanos).

Uso:
    python migration/reporte_estadistica.py

Solo lee. No escribe en la base.
"""

from __future__ import annotations

import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import psycopg

RAIZ = Path(__file__).resolve().parents[1]
DOCS = RAIZ / "docs"
IMG = DOCS / "img"
ANEXO_A = DOCS / "ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md"
PADRE = DOCS / "LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md"
MARCA_INICIO = "<!-- INICIO TABLA 86 HOJAS -->"
MARCA_FIN = "<!-- FIN TABLA 86 HOJAS -->"

COLOR = {"A": "#2f6f9f", "B": "#6fa8c7", "C": "#c9a227", "D": "#c0504d", "X": "#9e9e9e"}
COLOR_LEGADO = "#8c8c8c"
COLOR_MODELO = "#2f6f9f"

# `pg_%` cubre `pg_catalog` y `pg_toast`, que de otro modo infla los índices
# con 294 entradas de sistema.
LEGADO = "n.nspname = 'legacy'"
MODELO = (
    "n.nspname NOT LIKE 'pg_%' AND "
    "n.nspname NOT IN ('information_schema','public','legacy')"
)

# Clases que la v10 reclasifica: 16 por las tablas de soporte, 4 por el flujo
# por pasos (D17) y `dim_intervencion`, cuyas 4 filas ya tienen catálogo.
# Fuente: `DECISIONES_CARGA_LEGADO_V9.md` Anexo A.2.
CLASE_V10 = {
    "log_accesos": "B",
    "bridge_alerta_recurso": "B",
    "dim_locales": "B",
    "bridge_sectorista_departamento": "B",
    "dim_mesas_grupos": "B",
    "bridge_capacitacion_participant": "B",
    "dim_destinatarios_fijos": "B",
    "dim_capacitaciones": "B",
    "bridge_clima_actor": "B",
    "bridge_clima_actor_estado": "B",
    "bridge_reporte_actor": "B",
    "bridge_reporte_actor_estado": "B",
    "fact_red_radar": "B",
    "fact_nodo": "B",
    "bridge_radar_actor": "B",
    "bridge_nodo_actor": "B",
    "fact_proceso_caso": "B",
    "fact_proceso_reporte": "B",
    "dim_paso_proceso_caso": "B",
    "dim_paso_proceso": "B",
    "dim_intervencion": "B",
}

# Destinos que el Anexo A no podía nombrar porque se escribió contra v9.
DESTINO_V10 = {
    "log_accesos": ["core.log_accesos"],
    "bridge_alerta_recurso": ["core.alerta_especies"],
    "dim_locales": ["core.locales"],
    "bridge_sectorista_departamento": ["core.usuario_territorio"],
    "dim_mesas_grupos": ["core.mesas_dialogo", "core.mesa_miembros"],
    "bridge_capacitacion_participant": ["core.capacitacion_participantes"],
    "dim_destinatarios_fijos": ["core.suscripcion_notificacion"],
    "dim_capacitaciones": ["core.capacitaciones"],
    "bridge_clima_actor": ["core.documento_actores"],
    "bridge_clima_actor_estado": ["core.documento_actores"],
    "bridge_reporte_actor": ["core.documento_actores"],
    "bridge_reporte_actor_estado": ["core.documento_actores"],
    "fact_proceso_caso": ["core.proceso_instancia"],
    "fact_proceso_reporte": ["core.proceso_instancia"],
    "dim_paso_proceso": ["core.flujo_definicion"],
    "dim_paso_proceso_caso": ["core.flujo_definicion"],
    "dim_estado_proceso": ["core.flujo_estado"],
    "dim_intervencion": ["core.cat_ciclos_intervencion"],
}

# Las cuatro hojas RADAR siguen sin tabla: D18 las difiere a `territorio.*`.
NOTA_DESTINO = {
    "fact_red_radar": "diferido a `territorio.*` por D18",
    "fact_nodo": "diferido a `territorio.*` por D18",
    "bridge_radar_actor": "diferido a `territorio.*` por D18",
    "bridge_nodo_actor": "diferido a `territorio.*` por D18",
}

FICHA = re.compile(
    r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([\d\s\u00a0]+?)\s*\|\s*(\d+)\s*\|"
    r"\s*([ABCDX])\s*\|\s*(.*?)\s*\|\s*$"
)


# --------------------------------------------------------------------------- #
# Lectura
# --------------------------------------------------------------------------- #


def dsn() -> str:
    """DATABASE_URL de `.env`, sin depender de python-dotenv."""
    env = RAIZ / ".env"
    if env.exists():
        for linea in env.read_text(encoding="utf-8").splitlines():
            if linea.startswith("DATABASE_URL="):
                return linea.split("=", 1)[1].strip()
    return "postgresql://avisa:avisa@localhost:55433/avisa"


def uno(conn: psycopg.Connection, sql: str):
    return conn.execute(sql).fetchone()[0]


def leer_clases() -> dict[str, dict]:
    """Clase y destino declarados por hoja (Anexo A, fuente del detalle)."""
    salida = {}
    for linea in ANEXO_A.read_text(encoding="utf-8").splitlines():
        m = FICHA.match(linea)
        if not m:
            continue
        numero, hoja, filas, cols, clase, destino = m.groups()
        salida[hoja] = {
            "numero": int(numero),
            "filas_declaradas": int(re.sub(r"\D", "", filas)),
            "columnas_declaradas": int(cols),
            "clase": clase,
            "destinos": re.findall(r"`([a-z_]+\.[a-z_0-9]+)`", destino),
        }
    return salida


def leer_hojas(conn: psycopg.Connection) -> dict[str, dict]:
    """Columnas y filas reales por hoja, del manifiesto `legacy._hojas`."""
    return {
        r[0]: {"columnas": r[1], "filas": r[2]}
        for r in conn.execute(
            "SELECT tabla, columnas, filas FROM legacy._hojas ORDER BY 1"
        ).fetchall()
    }


def contar_filas(conn: psycopg.Connection, esquema: str) -> dict[str, int]:
    """count(*) real por tabla: `reltuples` está en -1 y no sirve."""
    tablas = [
        r[0]
        for r in conn.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname=%s AND c.relkind='r' ORDER BY 1",
            (esquema,),
        )
    ]
    return {
        t: conn.execute(f'SELECT count(*) FROM "{esquema}"."{t}"').fetchone()[0]
        for t in tablas
    }


def medir_estructura(conn: psycopg.Connection) -> dict[str, dict]:
    """Conteo de objetos de esquema por orilla."""

    def bloque(filtro: str) -> dict[str, int]:
        return {
            "tablas": uno(
                conn,
                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE c.relkind IN ('r','p') AND {filtro}",
            ),
            "logicas": uno(
                conn,
                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE c.relkind IN ('r','p') "
                "AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid) "
                f"AND {filtro}",
            ),
            "columnas": uno(
                conn,
                "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped "
                f"AND {filtro}",
            ),
            "pk": uno(
                conn,
                "SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE k.contype='p' AND {filtro}",
            ),
            "fk": uno(
                conn,
                "SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE k.contype='f' AND {filtro}",
            ),
            "uq": uno(
                conn,
                "SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE k.contype='u' AND {filtro}",
            ),
            "ck": uno(
                conn,
                "SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE k.contype='c' AND {filtro}",
            ),
            "idx": uno(
                conn,
                "SELECT count(*) FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid "
                "JOIN pg_namespace n ON n.oid=t.relnamespace "
                f"WHERE t.relkind IN ('r','p') AND {filtro}",
            ),
            "vistas": uno(
                conn,
                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE c.relkind IN ('v','m') AND {filtro}",
            ),
            "rls": uno(
                conn,
                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE c.relrowsecurity AND {filtro}",
            ),
            "pol": uno(
                conn,
                "SELECT count(*) FROM pg_policies "
                + (
                    "WHERE schemaname='legacy'"
                    if filtro == LEGADO
                    else "WHERE schemaname NOT LIKE 'pg_%' AND schemaname NOT IN "
                    "('information_schema','public','legacy')"
                ),
            ),
            "trg": uno(
                conn,
                "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                f"WHERE NOT t.tgisinternal AND {filtro}",
            ),
        }

    return {"legado": bloque(LEGADO), "modelo": bloque(MODELO)}


def medir_tipos(conn: psycopg.Connection) -> dict[str, dict[str, int]]:
    def bloque(filtro: str) -> dict[str, int]:
        return {
            r[0]: r[1]
            for r in conn.execute(
                "SELECT t.typname, count(*) FROM pg_attribute a "
                "JOIN pg_class c ON c.oid=a.attrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace "
                "JOIN pg_type t ON t.oid=a.atttypid "
                "WHERE c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped "
                f"AND {filtro} GROUP BY 1 ORDER BY 2 DESC"
            ).fetchall()
        }

    return {"legado": bloque(LEGADO), "modelo": bloque(MODELO)}


def medir_esquemas(conn: psycopg.Connection) -> list[tuple[str, int, int]]:
    return conn.execute(
        "SELECT n.nspname, count(DISTINCT c.oid) AS tablas, count(a.attnum) AS columnas "
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped "
        f"WHERE c.relkind IN ('r','p') AND {MODELO} GROUP BY 1 ORDER BY 3 DESC"
    ).fetchall()


def medir_calidad(conn: psycopg.Connection) -> dict[str, int]:
    """Huecos, duplicidades e integridad blanda de la data original."""

    def q(sql: str) -> int:
        return uno(conn, sql)

    act = "legacy.dim_actores"
    return {
        "actores": q(f"SELECT count(*) FROM {act}"),
        "sin_dni": q(f"SELECT count(*) FROM {act} WHERE c03 IS NULL OR btrim(c03)=''"),
        "dni_mal": q(
            f"SELECT count(*) FROM {act} WHERE c03 IS NOT NULL AND btrim(c03)<>'' "
            "AND length(btrim(c03))<>8"
        ),
        "dni_ok": q(f"SELECT count(*) FROM {act} WHERE c03 ~ '^[0-9]{{8}}$'"),
        "sin_tel": q(f"SELECT count(*) FROM {act} WHERE c04 IS NULL OR btrim(c04)=''"),
        "sin_mail": q(f"SELECT count(*) FROM {act} WHERE c05 IS NULL OR btrim(c05)=''"),
        "sin_contacto": q(
            f"SELECT count(*) FROM {act} WHERE (c04 IS NULL OR btrim(c04)='') "
            "AND (c05 IS NULL OR btrim(c05)='')"
        ),
        "sin_org": q(f"SELECT count(*) FROM {act} WHERE c07 IS NULL OR btrim(c07)=''"),
        "sin_cargo": q(
            f"SELECT count(*) FROM {act} WHERE c06 IS NULL OR btrim(c06)=''"
        ),
        "dni_dup_val": q(
            f"SELECT count(*) FROM (SELECT btrim(c03) FROM {act} "
            "WHERE c03 IS NOT NULL AND btrim(c03)<>'' GROUP BY 1 HAVING count(*)>1) x"
        ),
        "dni_dup_filas": q(
            f"SELECT count(*) FROM {act} a WHERE c03 IS NOT NULL AND btrim(c03)<>'' "
            f"AND EXISTS (SELECT 1 FROM {act} b WHERE btrim(b.c03)=btrim(a.c03) "
            "AND b.fila_n<>a.fila_n)"
        ),
        "nom_dup_val": q(
            f"SELECT count(*) FROM (SELECT btrim(c02) FROM {act} "
            "WHERE c02 IS NOT NULL GROUP BY 1 HAVING count(*)>1) x"
        ),
        "nom_dup_filas": q(
            f"SELECT count(*) FROM {act} a WHERE EXISTS (SELECT 1 FROM {act} b "
            "WHERE btrim(b.c02)=btrim(a.c02) AND b.fila_n<>a.fila_n)"
        ),
        "estado": q("SELECT count(*) FROM legacy.dim_actores_estado"),
        "estado_nd": q(
            "SELECT count(*) FROM legacy.dim_actores_estado WHERE c03='N/D'"
        ),
        "estado_dup_val": q(
            "SELECT count(*) FROM (SELECT btrim(c02) FROM legacy.dim_actores_estado "
            "GROUP BY 1 HAVING count(*)>1) x"
        ),
        "estado_dup_filas": q(
            "SELECT count(*) FROM legacy.dim_actores_estado d WHERE EXISTS "
            "(SELECT 1 FROM legacy.dim_actores_estado e WHERE btrim(e.c02)=btrim(d.c02) "
            "AND e.fila_n<>d.fila_n)"
        ),
        "solape_nombres": q(
            "SELECT count(*) FROM (SELECT btrim(c02) FROM legacy.dim_actores "
            "INTERSECT SELECT btrim(c03) FROM legacy.dim_actores_estado) x"
        ),
        "org": q("SELECT count(*) FROM legacy.dim_organizacion"),
        "org_dup_val": q(
            "SELECT count(*) FROM (SELECT btrim(c02) FROM legacy.dim_organizacion "
            "WHERE c02 IS NOT NULL GROUP BY 1 HAVING count(*)>1) x"
        ),
        "org_dup_filas": q(
            "SELECT count(*) FROM legacy.dim_organizacion o WHERE EXISTS "
            "(SELECT 1 FROM legacy.dim_organizacion p WHERE btrim(p.c02)=btrim(o.c02) "
            "AND p.fila_n<>o.fila_n)"
        ),
        "casos": q("SELECT count(*) FROM legacy.fact_casos"),
        "casos_dup": q(
            "SELECT count(*) FROM (SELECT btrim(c01) FROM legacy.fact_casos "
            "GROUP BY 1 HAVING count(*)>1) x"
        ),
        "alertas": q("SELECT count(*) FROM legacy.dim_alertas"),
        "alertas_dup_val": q(
            "SELECT count(*) FROM (SELECT btrim(c01) FROM legacy.dim_alertas "
            "GROUP BY 1 HAVING count(*)>1) x"
        ),
        "alertas_dup_filas": q(
            "SELECT count(*) FROM legacy.dim_alertas a WHERE EXISTS "
            "(SELECT 1 FROM legacy.dim_alertas b WHERE btrim(b.c01)=btrim(a.c01) "
            "AND b.fila_n<>a.fila_n)"
        ),
        "demandas": q("SELECT count(*) FROM legacy.dim_demandas"),
        "dem_dup_val": q(
            "SELECT count(*) FROM (SELECT btrim(c02) FROM legacy.dim_demandas "
            "WHERE c02 IS NOT NULL GROUP BY 1 HAVING count(*)>1) x"
        ),
        "dem_dup_filas": q(
            "SELECT count(*) FROM legacy.dim_demandas d WHERE EXISTS "
            "(SELECT 1 FROM legacy.dim_demandas e WHERE btrim(e.c02)=btrim(d.c02) "
            "AND e.fila_n<>d.fila_n)"
        ),
        "docs": q("SELECT count(*) FROM core.documentos"),
        "docs_dup_val": q(
            "SELECT count(*) FROM (SELECT btrim(titulo) FROM core.documentos "
            "WHERE titulo IS NOT NULL GROUP BY 1 HAVING count(*)>1) x"
        ),
        "docs_dup_filas": q(
            "SELECT count(*) FROM core.documentos a WHERE EXISTS "
            "(SELECT 1 FROM core.documentos b WHERE btrim(b.titulo)=btrim(a.titulo) "
            "AND b.id<>a.id)"
        ),
        "baa": q("SELECT count(*) FROM legacy.bridge_alerta_actor"),
        "baa_huerfanos": q(
            "SELECT count(*) FROM legacy.bridge_alerta_actor b WHERE NOT EXISTS "
            "(SELECT 1 FROM legacy.dim_actores a WHERE btrim(a.c01)=btrim(b.c03))"
        ),
        "baa_sin_maestro": q(
            "SELECT count(*) FROM legacy.bridge_alerta_actor b WHERE b.c02 LIKE 'AT-%' "
            "AND NOT EXISTS (SELECT 1 FROM legacy.dim_alertas a "
            "WHERE btrim(a.c01)=btrim(b.c02))"
        ),
        "baa_otros": q(
            "SELECT count(*) FROM legacy.bridge_alerta_actor WHERE c02 NOT LIKE 'AT-%'"
        ),
        "bca": q("SELECT count(*) FROM legacy.bridge_caso_actor"),
        "bca_huerfanos": q(
            "SELECT count(*) FROM legacy.bridge_caso_actor b WHERE NOT EXISTS "
            "(SELECT 1 FROM legacy.dim_actores a WHERE btrim(a.c01)=btrim(b.c02))"
        ),
        "bca_numerico": q(
            "SELECT count(*) FROM legacy.bridge_caso_actor WHERE c03 ~ '^[0-9]+$'"
        ),
        "bca_cs": q(
            "SELECT count(*) FROM legacy.bridge_caso_actor WHERE c03 LIKE 'CS-%'"
        ),
        "bca_sin_maestro": q(
            "SELECT count(*) FROM legacy.bridge_caso_actor b WHERE b.c03 LIKE 'CS-%' "
            "AND NOT EXISTS (SELECT 1 FROM legacy.fact_casos a "
            "WHERE btrim(a.c01)=btrim(b.c03))"
        ),
    }


# Mapa de funciones y componentes (mensaje de investigación, verificado contra el
# catálogo de funciones y el clúster). Alimenta `delta_componentes.svg`.
FUNCIONES_POR_ESTADO = {"TRANSFORMA": 297, "MANTIENE": 102, "DESAPARECE": 32}
COMPONENTES_POR_ESTADO = {"TRANSFORMA": 21, "MANTIENE": 5, "DESAPARECE": 2}
COMPONENTES_POR_FLUJO = {
    "Entrada (captura manual)": 15,
    "Proceso (agentes A1–A3)": 3,
    "Salida (automatizable)": 6,
    "Infraestructura": 4,
}
COMPONENTES_NUEVOS = {
    "Base de datos (RLS, auditoría, cifrado)": 3,
    "IA y proceso cognitivo": 4,
    "Salida y gobernanza": 2,
    "Dominio nuevo": 3,
}


# --------------------------------------------------------------------------- #
# Gráficos
# --------------------------------------------------------------------------- #


def _guardar(fig, nombre: str) -> Path:
    IMG.mkdir(parents=True, exist_ok=True)
    ruta = IMG / nombre
    fig.savefig(ruta, format="svg", bbox_inches="tight")
    plt.close(fig)
    return ruta


def _rotular(ax, valores, offsets, formato="{:,.0f}"):
    for v, off in zip(valores, offsets):
        if v == 0:
            continue
        ax.text(
            v, off, " " + formato.format(v).replace(",", " "), va="center", fontsize=8
        )


def grafico_estructura(e: dict[str, dict]) -> Path:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.8))

    nuevos = [
        ("FK", "fk"),
        ("CHECK", "ck"),
        ("Políticas RLS", "pol"),
        ("UNIQUE", "uq"),
        ("Triggers", "trg"),
        ("Tablas con RLS", "rls"),
        ("Vistas y matviews", "vistas"),
    ]
    etiquetas = [n for n, _ in nuevos]
    valores = [e["modelo"][k] for _, k in nuevos]
    y = np.arange(len(etiquetas))
    ax1.barh(y, valores, color=COLOR_MODELO)
    ax1.set_yticks(y, etiquetas)
    ax1.invert_yaxis()
    _rotular(ax1, valores, y)
    ax1.set_xlim(0, max(valores) * 1.2)
    ax1.set_title("Objetos que el legado no tiene\nlegado: 0 en los siete", fontsize=10)
    ax1.grid(axis="x", alpha=0.25)
    ax1.spines[["top", "right"]].set_visible(False)

    grupos = [
        ("Tablas", "tablas"),
        ("PK", "pk"),
        ("Índices", "idx"),
        ("Columnas", "columnas"),
    ]
    etiquetas = [n for n, _ in grupos]
    leg = [e["legado"][k] for _, k in grupos]
    mod = [e["modelo"][k] for _, k in grupos]
    y = np.arange(len(etiquetas))
    alto = 0.36
    ax2.barh(y - alto / 2, leg, alto, color=COLOR_LEGADO, label="legado (87 tablas)")
    ax2.barh(y + alto / 2, mod, alto, color=COLOR_MODELO, label="v10 (279 tablas)")
    ax2.set_xscale("log")
    ax2.set_xlim(50, max(mod) * 2)
    ax2.set_yticks(y, etiquetas)
    ax2.invert_yaxis()
    _rotular(ax2, leg, y - alto / 2)
    _rotular(ax2, mod, y + alto / 2)
    ax2.set_title("Volumen de estructura (escala logarítmica)", fontsize=10)
    ax2.legend(
        frameon=False,
        fontsize=8,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.12),
        ncol=2,
    )
    ax2.grid(axis="x", alpha=0.25, which="both")
    ax2.spines[["top", "right"]].set_visible(False)

    fig.suptitle(
        "El legado no tiene una sola relación declarada: la integridad vivía en Apps Script",
        fontsize=10,
    )
    fig.tight_layout()
    return _guardar(fig, "delta_estructura.svg")


def grafico_clases(hojas_orig: dict[str, int], hojas_v10: dict[str, int]) -> Path:
    orden = ["A", "B", "C", "D", "X"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.6))

    x = np.arange(len(orden))
    ancho = 0.38
    a = [hojas_orig[c] for c in orden]
    b = [hojas_v10[c] for c in orden]
    ax1.bar(x - ancho / 2, a, ancho, color=COLOR_LEGADO, label="clase original")
    ax1.bar(
        x + ancho / 2, b, ancho, color=[COLOR[c] for c in orden], label="clase en v10"
    )
    ax1.set_xticks(x, orden)
    ax1.set_ylabel("hojas")
    ax1.set_title("Hojas legadas por clase", fontsize=10)
    for i in range(len(orden)):
        ax1.text(i - ancho / 2, a[i], str(a[i]), ha="center", va="bottom", fontsize=8)
        ax1.text(i + ancho / 2, b[i], str(b[i]), ha="center", va="bottom", fontsize=8)
    ax1.set_ylim(0, max(a + b) * 1.22)
    ax1.legend(frameon=False, fontsize=8)
    ax1.grid(axis="y", alpha=0.25)
    ax1.spines[["top", "right"]].set_visible(False)

    izquierda = 0
    for c in orden:
        ax2.barh(["clase en v10"], [hojas_v10[c]], left=izquierda, color=COLOR[c])
        if hojas_v10[c]:
            ax2.text(
                izquierda + hojas_v10[c] / 2,
                0,
                str(hojas_v10[c]),
                ha="center",
                va="center",
                fontsize=9,
                color="white" if c != "C" else "#222",
            )
        izquierda += hojas_v10[c]
    izquierda = 0
    for c in orden:
        ax2.barh(["clase original"], [hojas_orig[c]], left=izquierda, color=COLOR[c])
        if hojas_orig[c]:
            ax2.text(
                izquierda + hojas_orig[c] / 2,
                1,
                str(hojas_orig[c]),
                ha="center",
                va="center",
                fontsize=9,
                color="white" if c != "C" else "#222",
            )
        izquierda += hojas_orig[c]
    ax2.set_xlim(0, 86)
    ax2.set_yticks([0, 1], ["clase en v10", "clase original"])
    ax2.set_title("Composición: 21 hojas salen de D hacia B", fontsize=10)
    ax2.spines[["top", "right", "left"]].set_visible(False)
    etiquetas = " · ".join(f"{c} {hojas_orig[c]} → {hojas_v10[c]}" for c in orden)
    ax2.text(0, -0.28, etiquetas, fontsize=7.5, color="#444", transform=ax2.transAxes)

    fig.tight_layout()
    return _guardar(fig, "delta_clases_legacy.svg")


def grafico_atributos(
    tipos: dict[str, dict[str, int]],
    cols_orig: dict[str, int],
    cols_v10: dict[str, int],
) -> Path:
    """Tipado de columnas y columnas por clase: atributos, nunca filas."""
    familias = [
        ("varchar", ["varchar", "_varchar"], "#2f6f9f"),
        ("uuid", ["uuid", "_uuid"], "#1f4e79"),
        ("texto (text, bpchar)", ["text", "bpchar", "_text"], "#6fa8c7"),
        (
            "temporal (ts, date)",
            ["timestamptz", "date", "timestamp", "time"],
            "#c9a227",
        ),
        ("entero (int2/4/8)", ["int2", "int4", "int8"], "#7f9a3c"),
        ("numeric", ["numeric", "float8", "float4"], "#8c6d1f"),
        ("jsonb", ["jsonb", "json"], "#7d5ba6"),
        ("bool", ["bool"], "#c0504d"),
        (
            "otros (bytea, geography, vector)",
            ["bytea", "geography", "vector", "inet"],
            "#9e9e9e",
        ),
    ]
    asignado = {t for _, ts, _ in familias for t in ts}

    def por_familia(d: dict[str, int]) -> dict[str, int]:
        salida = {}
        for nombre, tipos_f, _ in familias:
            salida[nombre] = sum(d.get(t, 0) for t in tipos_f)
        resto = sum(v for k, v in d.items() if k not in asignado)
        if resto:
            salida["otros (bytea, geography, vector)"] += resto
        return salida

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.8))

    leg = por_familia(tipos["legado"])
    mod = por_familia(tipos["modelo"])
    for i, (d, rotulo, total) in enumerate(
        (
            (leg, "legado", sum(tipos["legado"].values())),
            (mod, "v10", sum(tipos["modelo"].values())),
        )
    ):
        izquierda = 0
        for nombre, _, color in familias:
            v = d[nombre]
            if not v:
                continue
            ax1.barh([rotulo], [v], left=izquierda, color=color)
            if v / total > 0.05:
                ax1.text(
                    izquierda + v / 2,
                    i if rotulo == "legado" else i,
                    f"{v}",
                    ha="center",
                    va="center",
                    fontsize=7.5,
                    color="white" if color not in ("#c9a227",) else "#222",
                )
            izquierda += v
        ax1.text(
            izquierda + total * 0.01,
            i,
            f" {total:,}".replace(",", " "),
            va="center",
            fontsize=8,
        )

    ax1.set_xlim(0, max(sum(leg.values()), sum(mod.values())) * 1.12)
    ax1.set_title(
        "Tipos de dato: 2 en las 86 hojas legadas frente a 17 en la v10\n"
        "el legado guarda todo como texto salvo fila_n",
        fontsize=10,
    )
    ax1.set_yticks([0, 1], ["legado", "v10"])
    ax1.spines[["top", "right"]].set_visible(False)
    ax1.grid(axis="x", alpha=0.25)

    orden = ["A", "B", "C", "D", "X"]
    x = np.arange(len(orden))
    ancho = 0.38
    a = [cols_orig[c] for c in orden]
    b = [cols_v10[c] for c in orden]
    ax2.bar(x - ancho / 2, a, ancho, color=COLOR_LEGADO, label="clase original")
    ax2.bar(
        x + ancho / 2, b, ancho, color=[COLOR[c] for c in orden], label="clase en v10"
    )
    ax2.set_xticks(x, orden)
    ax2.set_ylabel("columnas de hoja")
    ax2.set_title("Columnas por clase (716 en total, sin fila_n)", fontsize=10)
    for i in range(len(orden)):
        ax2.text(i - ancho / 2, a[i], str(a[i]), ha="center", va="bottom", fontsize=8)
        ax2.text(i + ancho / 2, b[i], str(b[i]), ha="center", va="bottom", fontsize=8)
    ax2.set_ylim(0, max(a + b) * 1.22)
    ax2.legend(frameon=False, fontsize=8)
    ax2.grid(axis="y", alpha=0.25)
    ax2.spines[["top", "right"]].set_visible(False)

    fig.tight_layout()
    return _guardar(fig, "delta_atributos.svg")


def grafico_esquemas(esquemas: list[tuple[str, int, int]]) -> Path:
    nombres = [e[0] for e in esquemas]
    tablas = [e[1] for e in esquemas]
    columnas = [e[2] for e in esquemas]
    y = np.arange(len(nombres))

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 6.4), sharey=True)

    ax1.barh(y, tablas, color=COLOR_MODELO)
    ax1.set_yticks(y, nombres)
    ax1.invert_yaxis()
    ax1.set_title(f"Tablas por esquema ({sum(tablas)} físicas)", fontsize=10)
    _rotular(ax1, tablas, y)
    ax1.set_xlim(0, max(tablas) * 1.18)
    ax1.grid(axis="x", alpha=0.25)
    ax1.spines[["top", "right"]].set_visible(False)

    ax2.barh(y, columnas, color="#6fa8c7")
    ax2.set_title(
        f"Columnas por esquema ({sum(columnas):,} en total)".replace(",", " "),
        fontsize=10,
    )
    _rotular(ax2, columnas, y)
    ax2.set_xlim(0, max(columnas) * 1.18)
    ax2.grid(axis="x", alpha=0.25)
    ax2.spines[["top", "right"]].set_visible(False)

    fig.suptitle(
        "La estructura se concentra en core; kag y audit pesan por datos, no por tablas.\n"
        "analytics no tiene tablas base: 24 vistas y 6 vistas materializadas.",
        fontsize=9,
    )
    fig.tight_layout()
    return _guardar(fig, "delta_esquemas.svg")


def grafico_calidad(c: dict[str, int]) -> Path:
    fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(16, 5))

    huecos = [
        ("sin correo", c["sin_mail"]),
        ("sin teléfono", c["sin_tel"]),
        ("sin ningún contacto", c["sin_contacto"]),
        ("sin DNI", c["sin_dni"]),
        ("DNI longitud ≠ 8", c["dni_mal"]),
        ("sin organización", c["sin_org"]),
        ("sin cargo", c["sin_cargo"]),
    ]
    etiquetas = [h for h, _ in huecos]
    valores = [v for _, v in huecos]
    y = np.arange(len(etiquetas))
    ax1.barh(y, valores, color="#c0504d")
    ax1.set_yticks(y, etiquetas)
    ax1.invert_yaxis()
    _rotular(ax1, valores, y)
    ax1.set_xlim(0, max(valores) * 1.22)
    ax1.set_title(
        f"Huecos en dim_actores ({c['actores']} actores)\n"
        f"solo {c['dni_ok']} ({c['dni_ok'] * 100 // c['actores']} %) tiene DNI de 8 dígitos",
        fontsize=9.5,
    )
    ax1.grid(axis="x", alpha=0.25)
    ax1.spines[["top", "right"]].set_visible(False)

    dups = [
        ("DNI de actores", c["dni_dup_val"], c["dni_dup_filas"]),
        ("nombres de actores", c["nom_dup_val"], c["nom_dup_filas"]),
        ("nombres en actores_estado", c["estado_dup_val"], c["estado_dup_filas"]),
        ("textos de demandas", c["dem_dup_val"], c["dem_dup_filas"]),
        ("títulos de documentos", c["docs_dup_val"], c["docs_dup_filas"]),
        ("organizaciones", c["org_dup_val"], c["org_dup_filas"]),
        ("códigos de alerta", c["alertas_dup_val"], c["alertas_dup_filas"]),
    ]
    etiquetas = [d for d, _, _ in dups]
    vals = [v for _, v, _ in dups]
    filas = [f for _, _, f in dups]
    y = np.arange(len(etiquetas))
    alto = 0.36
    ax2.barh(y - alto / 2, vals, alto, color="#6fa8c7", label="valores repetidos")
    ax2.barh(y + alto / 2, filas, alto, color="#2f6f9f", label="filas afectadas")
    ax2.set_yticks(y, etiquetas)
    ax2.invert_yaxis()
    _rotular(ax2, vals, y - alto / 2)
    _rotular(ax2, filas, y + alto / 2)
    ax2.set_xlim(0, max(vals + filas) * 1.22)
    ax2.set_title("Duplicidades en la data original", fontsize=9.5)
    ax2.legend(frameon=False, fontsize=8, loc="lower right")
    ax2.grid(axis="x", alpha=0.25)
    ax2.spines[["top", "right"]].set_visible(False)

    bridges = [
        ("alerta: actor huérfano", c["baa_huerfanos"]),
        ("alerta: código AT sin maestro", c["baa_sin_maestro"]),
        ("alerta: otro valor", c["baa_otros"]),
        ("caso: actor huérfano", c["bca_huerfanos"]),
        ("caso: número en vez de código", c["bca_numerico"]),
        ("caso: código CS sin maestro", c["bca_sin_maestro"]),
    ]
    etiquetas = [b for b, _ in bridges]
    valores = [v for _, v in bridges]
    y = np.arange(len(etiquetas))
    ax3.barh(y, valores, color="#c9a227")
    ax3.set_yticks(y, etiquetas)
    ax3.invert_yaxis()
    _rotular(ax3, valores, y)
    ax3.set_xlim(0, max(valores) * 1.3)
    ax3.set_title("Integridad referencial blanda en los bridges", fontsize=9.5)
    ax3.text(
        0.5,
        -0.13,
        "alerta = bridge_alerta_actor · caso = bridge_caso_actor",
        transform=ax3.transAxes,
        ha="center",
        va="top",
        fontsize=8,
    )
    ax3.grid(axis="x", alpha=0.25)
    ax3.spines[["top", "right"]].set_visible(False)

    fig.suptitle(
        "El problema del legado no era el volumen: era la ausencia de reglas en el esquema",
        fontsize=10,
    )
    fig.tight_layout()
    return _guardar(fig, "delta_calidad.svg")


def grafico_componentes() -> Path:
    """Qué se mantiene, qué se transforma, qué se automatiza y qué es nuevo."""
    fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(15, 4.8))

    orden = ["TRANSFORMA", "MANTIENE", "DESAPARECE"]
    colores = {"TRANSFORMA": "#2f6f9f", "MANTIENE": "#6fa8c7", "DESAPARECE": "#c0504d"}
    valores = [FUNCIONES_POR_ESTADO[k] for k in orden]
    total = sum(valores)
    izquierda = 0
    for nombre, v in zip(orden, valores):
        ax1.barh(
            ["431 funciones"], [v], left=izquierda, color=colores[nombre], label=nombre
        )
        if v / total > 0.06:
            ax1.text(
                izquierda + v / 2,
                0,
                f"{v}\n{v * 100 / total:.0f} %",
                ha="center",
                va="center",
                fontsize=8,
                color="white",
            )
        izquierda += v
    ax1.set_xlim(0, total * 1.02)
    ax1.legend(
        frameon=False,
        fontsize=8,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.08),
        ncol=3,
    )
    ax1.set_title(
        "Funciones del legado por estado\n"
        + " · ".join(f"{k.lower()} {v}" for k, v in COMPONENTES_POR_ESTADO.items()),
        fontsize=9.5,
    )
    ax1.spines[["top", "right", "left"]].set_visible(False)

    etiquetas = list(COMPONENTES_POR_FLUJO)
    valores = list(COMPONENTES_POR_FLUJO.values())
    y = np.arange(len(etiquetas))
    ax2.barh(y, valores, color="#c9a227")
    ax2.set_yticks(y, etiquetas)
    ax2.invert_yaxis()
    _rotular(ax2, valores, y)
    ax2.set_xlim(0, max(valores) * 1.25)
    ax2.set_title("Componentes legacy por flujo\n28 en total", fontsize=9.5)
    ax2.grid(axis="x", alpha=0.25)
    ax2.spines[["top", "right"]].set_visible(False)

    etiquetas = list(COMPONENTES_NUEVOS)
    valores = list(COMPONENTES_NUEVOS.values())
    y = np.arange(len(etiquetas))
    ax3.barh(y, valores, color="#7d5ba6")
    ax3.set_yticks(y, etiquetas)
    ax3.invert_yaxis()
    _rotular(ax3, valores, y)
    ax3.set_xlim(0, max(valores) * 1.4)
    ax3.set_title("Componentes de la v10 sin equivalente\n12 en total", fontsize=9.5)
    ax3.grid(axis="x", alpha=0.25)
    ax3.spines[["top", "right"]].set_visible(False)

    fig.suptitle(
        "Lo que sobrevive del legado es el flujo de negocio, no su implementación",
        fontsize=10,
    )
    fig.tight_layout()
    return _guardar(fig, "delta_componentes.svg")


# --------------------------------------------------------------------------- #
# Inyección de la tabla de correspondencias
# --------------------------------------------------------------------------- #


def inyectar_tabla(clases: dict[str, dict], hojas: dict[str, dict]) -> Path | None:
    if not PADRE.exists():
        print(f"aviso: no existe {PADRE.name}; no se inyecta la tabla")
        return None
    texto = PADRE.read_text(encoding="utf-8")
    if MARCA_INICIO not in texto or MARCA_FIN not in texto:
        print(
            "aviso: el documento padre no tiene los marcadores; no se inyecta la tabla"
        )
        return None

    lineas = [
        "| # | Hoja del sistema anterior | Clase original | Clase actual | Columnas | Filas | Dónde vive hoy |",
        "| --: | --- | :---: | :---: | ---: | ---: | --- |",
    ]
    for tabla, info in sorted(clases.items(), key=lambda x: x[1]["numero"]):
        h = hojas.get(tabla, {})
        clase10 = CLASE_V10.get(tabla, info["clase"])
        marca = f"**{clase10}**" if clase10 != info["clase"] else clase10
        destinos = DESTINO_V10.get(tabla) or info["destinos"]
        if destinos:
            destino = ", ".join(f"`{d}`" for d in destinos)
        else:
            destino = NOTA_DESTINO.get(tabla, "—")
        lineas.append(
            f"| {info['numero']} | `{tabla}` | {info['clase']} | {marca} "
            f"| {h.get('columnas', '—')} | {h.get('filas', '—')} | {destino} |"
        )

    pre, resto = texto.split(MARCA_INICIO, 1)
    _, post = resto.split(MARCA_FIN, 1)
    nuevo = pre + MARCA_INICIO + "\n" + "\n".join(lineas) + "\n\n" + MARCA_FIN + post
    PADRE.write_text(nuevo, encoding="utf-8")
    return PADRE


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main() -> None:
    clases = leer_clases()
    with psycopg.connect(dsn()) as conn:
        estructura = medir_estructura(conn)
        tipos = medir_tipos(conn)
        esquemas = medir_esquemas(conn)
        calidad = medir_calidad(conn)
        hojas = leer_hojas(conn)
        vivas_legado = contar_filas(conn, "legacy")

    orden = ["A", "B", "C", "D", "X"]
    hojas_orig = {c: 0 for c in orden}
    hojas_v10 = {c: 0 for c in orden}
    cols_orig = {c: 0 for c in orden}
    cols_v10 = {c: 0 for c in orden}
    for tabla, info in clases.items():
        original = info["clase"]
        final = CLASE_V10.get(tabla, original)
        reales = hojas.get(tabla, {}).get("columnas", 0)
        hojas_orig[original] += 1
        hojas_v10[final] += 1
        cols_orig[original] += reales
        cols_v10[final] += reales

    print(
        f"hojas: {len(clases)} · filas declaradas: "
        f"{sum(i['filas_declaradas'] for i in clases.values())} · "
        f"filas en el manifiesto: {sum(h['filas'] for h in hojas.values())} · "
        f"legacy total: {sum(vivas_legado.values())}"
    )
    for c in orden:
        print(
            f"  clase {c}: original {hojas_orig[c]} hojas / {cols_orig[c]} cols · "
            f"v10 {hojas_v10[c]} hojas / {cols_v10[c]} cols"
        )
    print("estructura:", estructura)
    print("tipos:", len(tipos["legado"]), "legado ·", len(tipos["modelo"]), "v10")

    grafico_estructura(estructura)
    grafico_clases(hojas_orig, hojas_v10)
    grafico_atributos(tipos, cols_orig, cols_v10)
    grafico_esquemas(esquemas)
    grafico_calidad(calidad)
    grafico_componentes()

    destino = inyectar_tabla(clases, hojas)
    if destino:
        print(f"tabla de 86 hojas inyectada en {destino}")


if __name__ == "__main__":
    main()
