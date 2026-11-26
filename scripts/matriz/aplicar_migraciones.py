"""Aplica las migraciones pendientes 41–47 en Neon, con respaldo previo.

Orden de ejecución (dependencias reales verificadas contra la base viva):

  1. 41_medios_fotografias.sql      crea core.medios (+RLS)
  2. 44_semilla_fotos_medios.sql    siembra 142 filas en core.medios (requiere RLS activo)
  3. 46_medios_bytea.sql            añade contenido/content_type/hash/cargado_en
  4. 41_matriz_equipo.sql           mapa_matriz_excel, nudos, casos/compromisos/hitos
  5. 42_reuniones_sin_caso.sql      reuniones sin caso + señales
  6. 43_nudos_criticos_fieles.sql   nudos fieles a la fuente
  7. 44_decisiones_2026_11_24.sql   DIPFORPA, archivo, anexos 14/15 sin temática
  8. 45_compromisos_clasificacion.sql  clasificación + anexo 14 con 2 columnas nuevas
  9. 47_gis_distritos.sql           territorio.distrito (DDL; la carga es aparte)

La 44 y la 47 deben ir en ese orden relativo: 45 reemplaza el anexo 14 que la 44
acaba de recrear, y 45 ya está alineada para no reintroducir la temática.

Qué NO hace: cargar geometrías (lo hace scripts/cargar-gis-neon.mjs) ni bytes de
medios (scripts/cargar-medios-neon.mjs).

Uso:
    python scripts/matriz/aplicar_migraciones.py --dry-run
    python scripts/matriz/aplicar_migraciones.py --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import psycopg2
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
DSN = os.environ["NEON_OWNER_URL"]

MIGRATIONS = [
    "41_medios_fotografias.sql",
    "44_semilla_fotos_medios.sql",
    "46_medios_bytea.sql",
    "41_matriz_equipo.sql",
    "42_reuniones_sin_caso.sql",
    "43_nudos_criticos_fieles.sql",
    "44_decisiones_2026_11_24.sql",
    "45_compromisos_clasificacion.sql",
    "47_gis_distritos.sql",
]

BACKUP_TABLES = [
    ("core", "casos"),
    ("core", "compromisos"),
    ("core", "hitos_compromiso"),
    ("core", "documentos"),
    ("core", "demandas"),
    ("core", "alertas_tempranas"),
    ("core", "reuniones_dialogo"),
    ("core", "cat_tematicas"),
    ("core", "cat_unidades_organicas"),
    ("core", "cat_estados_hito"),
    ("core", "cat_niveles_riesgo"),
]

BACKUP_VIEWS = [
    ("analytics", "vw_anexo_14_seguimiento_compromisos"),
    ("analytics", "vw_anexo_15_matriz_conflictividad"),
]


def backup(conn) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = ROOT / "migration" / f"backup_{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    with conn.cursor() as cur:
        for schema, table in BACKUP_TABLES:
            path = out / f"{schema}.{table}.csv"
            with path.open("w", encoding="utf-8", newline="") as fh:
                cur.copy_expert(
                    f"COPY (SELECT * FROM {schema}.{table}) TO STDOUT WITH CSV HEADER",
                    fh,
                )
            print(
                f"  respaldo {schema}.{table} -> {path.name} ({path.stat().st_size} B)"
            )
        for schema, view in BACKUP_VIEWS:
            cur.execute(
                "SELECT pg_get_viewdef(%s::regclass, true)", (f"{schema}.{view}",)
            )
            ddl = cur.fetchone()[0]
            path = out / f"{schema}.{view}.sql"
            path.write_text(
                f"CREATE OR REPLACE VIEW {schema}.{view} AS\n{ddl}\n", encoding="utf-8"
            )
            print(f"  respaldo {schema}.{view} -> {path.name}")
    conn.commit()
    return out


def apply_file(conn, name: str) -> None:
    sql = (ROOT / "migration" / name).read_text(encoding="utf-8")
    with conn.cursor() as cur:
        # La semilla de medios pasa por RLS FORCE y necesita un rol con
        # puede_crear; el DDL es indiferente a esta variable.
        cur.execute("SET app.rol_codigo = 'administrador'")
        cur.execute(sql)
    conn.commit()


def verify(conn) -> None:
    with conn.cursor() as cur:
        print("\n== migracion_log ==")
        cur.execute(
            "SELECT clave, aplicada_en FROM core.migracion_log ORDER BY aplicada_en"
        )
        for clave, when in cur.fetchall():
            print(f"  {clave:<32} {when:%Y-%m-%d %H:%M}")
        print("\n== objetos ==")
        cur.execute("""
            SELECT 'columnas casos', count(*)::text FROM information_schema.columns
             WHERE table_schema='core' AND table_name='casos'
               AND column_name IN ('estado_actualizacion','nivel_riesgo_inicial_id','link_analisis_caso')
            UNION ALL
            SELECT 'columnas compromisos', count(*)::text FROM information_schema.columns
             WHERE table_schema='core' AND table_name='compromisos'
               AND column_name IN ('demanda_id','punto_focal_usuario_id','punto_focal_texto',
                                   'clasificacion_alcance','formal_verbal','asumido_ministro')
            UNION ALL
            SELECT 'caso_nudo_critico existe',
                   (SELECT count(*)::text FROM information_schema.tables
                     WHERE table_schema='core' AND table_name='caso_nudo_critico')
            UNION ALL
            SELECT 'medios filas', count(*)::text FROM core.medios
            UNION ALL
            SELECT 'distritos geojson', count(*)::text FROM territorio.distrito
            UNION ALL
            SELECT 'anexo14 columnas', count(*)::text FROM information_schema.columns
             WHERE table_schema='analytics' AND table_name='vw_anexo_14_seguimiento_compromisos'
            UNION ALL
            SELECT 'anexo15 columnas', count(*)::text FROM information_schema.columns
             WHERE table_schema='analytics' AND table_name='vw_anexo_15_matriz_conflictividad'
        """)
        for label, val in cur.fetchall():
            print(f"  {label:<26} {val}")
        print("\n== estado final ==")
        cur.execute("SELECT siglas FROM core.cat_unidades_organicas WHERE id=24")
        print("  unidad 24:", cur.fetchone()[0])
        cur.execute("""
            SELECT column_name FROM information_schema.columns
             WHERE table_schema IN ('core') AND column_name IN
                   ('archivado_en','motivo_archivo','tematica_equipo')
             ORDER BY 1
        """)
        print("  columnas archivo/temática:", [r[0] for r in cur.fetchall()])
        cur.execute("""
            SELECT has_table_privilege('avisa_app',
                'analytics.vw_anexo_14_seguimiento_compromisos','SELECT'),
                   has_table_privilege('avisa_app',
                'analytics.vw_anexo_15_matriz_conflictividad','SELECT')
        """)
        print("  avisa_app puede leer anexos 14/15:", cur.fetchone())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.apply:
        print("DRY-RUN: no se escribe nada. Migraciones en orden:")
        for name in MIGRATIONS:
            print("  -", name)
        print("\nAñade --apply para ejecutar.")
        return 0

    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    print("== respaldo previo ==")
    out = backup(conn)
    print(f"respaldo en {out}\n")

    for name in MIGRATIONS:
        print(f"== aplicando {name} ==")
        try:
            apply_file(conn, name)
        except Exception as exc:  # noqa: BLE001
            print(f"FALLO en {name}: {exc}")
            return 1
        print("  ok")

    verify(conn)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
