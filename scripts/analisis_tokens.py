"""Mide el volumen real de la data de entrada del legado (Excel y Postgres).

Objetivo: saber cuántos caracteres y cuántos tokens de LLM hay en la fuente
antes de diseñar el ETL con extracción asistida por modelos.

Uso:
    python scripts/analisis_tokens.py

Salida: por hoja — filas, columnas, celdas con dato, caracteres, tokens
(valores sueltos) y tokens (CSV serializado, que es lo que recibe un LLM).
Al final, totales y proyección de costo para un pipeline de 3 agentes.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import zipfile
from pathlib import Path

import tiktoken
from openpyxl import load_workbook

RAIZ = Path(__file__).resolve().parent.parent
XLSX = RAIZ / "backend" / "BASE_CONFLICTOS_SOCIALES_2026.xlsx"

ENC_CL100K = tiktoken.get_encoding("cl100k_base")  # GPT-4 / GPT-3.5
ENC_O200K = tiktoken.get_encoding("o200k_base")  # GPT-4o / modelos nuevos


def _texto(valor: object) -> str:
    if valor is None:
        return ""
    if isinstance(valor, str):
        return valor
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, float):
        # Evita "1.0" donde el legado escribió un entero.
        return str(int(valor)) if valor.is_integer() else repr(valor)
    return str(valor)


def medir_hoja(hoja) -> dict:
    """Recorre una hoja y devuelve sus métricas de volumen."""
    filas = 0
    columnas = 0
    celdas_con_dato = 0
    caracteres = 0
    lineas_csv: list[str] = []
    cabecera: list[str] | None = None
    valores_sueltos: list[str] = []

    for fila in hoja.iter_rows(values_only=True):
        if fila is None:
            continue
        textos = [_texto(v) for v in fila]
        if not any(textos):
            continue
        filas += 1
        columnas = max(columnas, len(fila))
        for t in textos:
            if t:
                celdas_con_dato += 1
                caracteres += len(t)
                valores_sueltos.append(t)
        if cabecera is None:
            cabecera = textos
        else:
            lineas_csv.append(",".join(textos))

    # Tokens de los valores sueltos (concatenados con espacio).
    bloque_valores = " ".join(valores_sueltos)
    tok_valores = len(ENC_CL100K.encode(bloque_valores))

    # Tokens del CSV serializado: cabecera + una línea por fila.
    bloque_csv = "\n".join([",".join(cabecera or [])] + lineas_csv)
    tok_csv_100k = len(ENC_CL100K.encode(bloque_csv))
    tok_csv_200k = len(ENC_O200K.encode(bloque_csv))

    return {
        "filas": filas,
        "columnas": columnas,
        "celdas": celdas_con_dato,
        "caracteres": caracteres,
        "tok_valores": tok_valores,
        "tok_csv": tok_csv_100k,
        "tok_csv_o200k": tok_csv_200k,
        "caracteres_csv": len(bloque_csv),
    }


def _tokens(texto: str) -> tuple[int, int]:
    """(cl100k, o200k) para un bloque de texto."""
    return len(ENC_CL100K.encode(texto)), len(ENC_O200K.encode(texto))


def _texto_docx(ruta: Path) -> str:
    with zipfile.ZipFile(ruta) as z:
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    xml = re.sub(r"</w:p>", "\n", xml)
    return re.sub(r"<[^>]+>", "", xml)


def _texto_pdf(ruta: Path) -> str:
    from pypdf import PdfReader

    lector = PdfReader(str(ruta))
    return "\n".join((pagina.extract_text() or "") for pagina in lector.pages)


def _texto_tabla(ruta: Path) -> str:
    """Serializa una tabla (xlsx/csv) como CSV para medir su costo de prompt."""
    partes: list[str] = []
    if ruta.suffix.lower() == ".csv":
        with ruta.open(encoding="utf-8-sig", errors="ignore", newline="") as f:
            for fila in csv.reader(f):
                if any(celda.strip() for celda in fila):
                    partes.append(",".join(celda.strip() for celda in fila))
    else:
        wb = load_workbook(ruta, read_only=True, data_only=True)
        for nombre in wb.sheetnames:
            for fila in wb[nombre].iter_rows(values_only=True):
                textos = [_texto(v) for v in fila]
                if any(textos):
                    partes.append(",".join(textos))
        wb.close()
    return "\n".join(partes)


def medir_insumos_complementarios() -> list[dict]:
    """Mide los archivos de apoyo y el esquema v10 usado como contexto."""
    insumos = [
        ("alcaldes.xlsx", RAIZ / "scripts" / "alcaldes.xlsx"),
        (
            "PROVINCIALES ELECTOS - ANCASH.xlsx",
            RAIZ / "scripts" / "PROVINCIALES ELECTOS - ANCASH (1).xlsx",
        ),
        (
            "directorio municipalidades 2026.xlsx",
            RAIZ
            / "scripts"
            / "3908763-directorio-nacional-de-municipalidades-provinciales-y-distritales-noviembre-2026.xlsx",
        ),
        (
            "DIRECTORIO_ALCALDES_ANCASH_2026.csv",
            RAIZ / "scripts" / "DIRECTORIO_ALCALDES_ANCASH_2026.csv",
        ),
        ("geodir-ubigeo-reniec.csv", RAIZ / "scripts" / "geodir-ubigeo-reniec.csv"),
        ("toponimos.json", RAIZ / "scripts" / "toponimos.json"),
        ("ALCALDES 2027-2030.docx", RAIZ / "scripts" / "ALCALDES 2027 - 2030.docx"),
        (
            "TDR locador (docx)",
            RAIZ
            / "backups"
            / "tdr"
            / "TDR_LOCADOR_Nov-Dic_26_REVF_2productos_45d.docx",
        ),
        (
            "TDR locador (pdf)",
            RAIZ
            / "backups"
            / "tdr"
            / "TDR_LOCADOR_Nov-Dic_26_REVF_2productos_45d-anexo b.pdf",
        ),
        (
            "esquema v10 unificado (DDL)",
            RAIZ / "docs" / "AVISA_V10_ESQUEMA_UNIFICADO.sql",
        ),
    ]

    resultados: list[dict] = []
    for etiqueta, ruta in insumos:
        if not ruta.exists():
            resultados.append(
                {"insumo": etiqueta, "estado": "no encontrado", "tamano_mb": 0.0}
            )
            continue

        sufijo = ruta.suffix.lower()
        try:
            if sufijo in (".xlsx", ".csv"):
                contenido = _texto_tabla(ruta)
            elif sufijo == ".docx":
                contenido = _texto_docx(ruta)
            elif sufijo == ".pdf":
                contenido = _texto_pdf(ruta)
            else:
                contenido = ruta.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:  # noqa: BLE001 - se reporta, no se aborta
            resultados.append(
                {"insumo": etiqueta, "estado": f"error: {exc}", "tamano_mb": 0.0}
            )
            continue

        tok_100k, tok_200k = _tokens(contenido)
        resultados.append(
            {
                "insumo": etiqueta,
                "estado": "ok",
                "tamano_mb": round(ruta.stat().st_size / 1024 / 1024, 2),
                "caracteres": len(contenido),
                "tokens_cl100k": tok_100k,
                "tokens_o200k": tok_200k,
            }
        )
    return resultados


def main() -> int:
    if not XLSX.exists():
        print(f"No se encuentra el Excel: {XLSX}", file=sys.stderr)
        return 1

    print(f"Fuente: {XLSX.name}")
    print(f"Tamaño en disco: {XLSX.stat().st_size / 1024 / 1024:.2f} MB\n")

    wb = load_workbook(XLSX, read_only=True, data_only=True)
    resultados: dict[str, dict] = {}

    for nombre in wb.sheetnames:
        resultados[nombre] = medir_hoja(wb[nombre])
    wb.close()

    # Orden por tokens (lo que más pesa primero).
    ordenadas = sorted(resultados.items(), key=lambda kv: -kv[1]["tok_csv"])

    print("=" * 108)
    print(
        f"{'Hoja':<38}{'Filas':>7}{'Cols':>6}{'Celdas':>8}"
        f"{'Chars':>10}{'Tok.val':>10}{'Tok.CSV':>10}{'GBP4o':>9}"
    )
    print("=" * 108)
    for nombre, m in ordenadas:
        print(
            f"{nombre[:37]:<38}{m['filas']:>7}{m['columnas']:>6}{m['celdas']:>8}"
            f"{m['caracteres']:>10}{m['tok_valores']:>10}{m['tok_csv']:>10}"
            f"{m['tok_csv_o200k']:>9}"
        )

    total_filas = sum(m["filas"] for m in resultados.values())
    total_celdas = sum(m["celdas"] for m in resultados.values())
    total_chars = sum(m["caracteres"] for m in resultados.values())
    total_chars_csv = sum(m["caracteres_csv"] for m in resultados.values())
    total_tok_val = sum(m["tok_valores"] for m in resultados.values())
    total_tok_csv = sum(m["tok_csv"] for m in resultados.values())
    total_tok_o200k = sum(m["tok_csv_o200k"] for m in resultados.values())

    print("=" * 108)
    print(
        f"{'TOTAL (' + str(len(resultados)) + ' hojas)':<38}{total_filas:>7}"
        f"{'':>6}{total_celdas:>8}{total_chars:>10}{total_tok_val:>10}"
        f"{total_tok_csv:>10}{total_tok_o200k:>9}"
    )
    print("=" * 108)

    # Distribución: cuánto pesa el 10% de hojas más grande.
    acumulado = 0
    for i, (_, m) in enumerate(ordenadas, start=1):
        acumulado += m["tok_csv"]
        if acumulado >= total_tok_csv * 0.8:
            print(f"\nEl 80% de los tokens vive en {i} hojas (de {len(ordenadas)}).")
            break

    print("\n--- Volumen bruto ---")
    print(f"Filas con dato          : {total_filas:,}")
    print(f"Celdas con dato         : {total_celdas:,}")
    print(f"Caracteres (valores)    : {total_chars:,}")
    print(f"Caracteres (CSV)        : {total_chars_csv:,}")
    print(f"Ratio chars/token (CSV) : {total_chars_csv / total_tok_csv:.2f}")
    print(f"Tokens valores sueltos  : {total_tok_val:,} (cl100k)")
    print(f"Tokens CSV serializado  : {total_tok_csv:,} (cl100k / GPT-4)")
    print(f"Tokens CSV serializado  : {total_tok_o200k:,} (o200k / GPT-4o)")

    # ------------------------------------------------------------------
    # Proyección de un pipeline con 3 agentes.
    #
    # A1 — extractor: recibe la fila y devuelve JSON estructurado.
    # A2 — normalizador/resolutor: recibe el JSON de A1 + catálogos y
    #      devuelve entidades enlazadas (actores, distritos, casos).
    # A3 — sintetizador: recibe los JSON ya normalizados y redacta el
    #      registro final / marco situacional.
    #
    # Supuestos conservadores, declarados para que se puedan cambiar:
    # ------------------------------------------------------------------
    PASAJES = 3  # A1, A2, A3 consumen cada uno la data base
    SALIDA_A1 = 0.55  # JSON estructurado ≈ 55% de los tokens de entrada
    SALIDA_A2 = 0.35  # JSON enriquecido ≈ 35%
    SALIDA_A3 = 0.45  # redacción final ≈ 45%
    SOBRECARGA = 0.15  # prompts de sistema, catálogos, instrucciones

    entrada_a1 = total_tok_csv
    salida_a1 = int(entrada_a1 * SALIDA_A1)
    entrada_a2 = salida_a1 + int(entrada_a1 * SOBRECARGA)
    salida_a2 = int(entrada_a2 * SALIDA_A2)
    entrada_a3 = salida_a2 + int(entrada_a2 * SOBRECARGA)
    salida_a3 = int(entrada_a3 * SALIDA_A3)

    total_entrada = entrada_a1 + entrada_a2 + entrada_a3
    total_salida = salida_a1 + salida_a2 + salida_a3
    total_pipeline = total_entrada + total_salida

    print("\n--- Proyección pipeline de 3 agentes (una pasada por fila) ---")
    print(f"{'Agente':<34}{'Entrada':>12}{'Salida':>12}{'Total':>13}")
    for nombre, ent, sal in (
        ("A1 extractor de entidades", entrada_a1, salida_a1),
        ("A2 normalizador / resolutor", entrada_a2, salida_a2),
        ("A3 sintetizador de registro", entrada_a3, salida_a3),
    ):
        print(f"{nombre:<34}{ent:>12,}{sal:>12,}{ent + sal:>13,}")
    print(f"{'TOTAL':<34}{total_entrada:>12,}{total_salida:>12,}{total_pipeline:>13,}")
    print(f"\nMultiplicador sobre la data cruda: {total_pipeline / total_tok_csv:.1f}x")

    # Costo de referencia con precios públicos de lista (USD por 1M tokens).
    # Se declaran como supuestos: cambian con el proveedor y la fecha.
    for etiqueta, precio_ent, precio_sal in (
        ("GPT-4o (2.50 / 10.00)", 2.50, 10.00),
        ("GPT-4o mini (0.15 / 0.60)", 0.15, 0.60),
        ("Claude Sonnet (3.00 / 15.00)", 3.00, 15.00),
    ):
        costo = (total_entrada / 1e6) * precio_ent + (total_salida / 1e6) * precio_sal
        print(f"{etiqueta:<30} ≈ USD {costo:,.2f} por pasada completa")

    # Escenarios de reutilización: si el catálogo y los prompts se cachean,
    # el costo real baja. Se informa el techo, no el ahorro.
    print("\n--- Escenarios de ejecución ---")
    for etiqueta, factor in (
        ("1 pasada (carga inicial)", 1),
        ("2 pasadas (carga + reproceso)", 2),
        ("3 pasadas (iteración de calidad)", 3),
    ):
        print(
            f"{etiqueta:<34}{int(total_pipeline * factor):>13,} tokens"
            f"   ≈ USD {(total_pipeline * factor / 1e6) * 2.50:,.2f} (GPT-4o entrada media)"
        )

    # ------------------------------------------------------------------
    # Insumos complementarios: directorios, ubigeo y documentos de contexto.
    # ------------------------------------------------------------------
    print("\n--- Insumos complementarios (fuera del Excel del legado) ---")
    complementarios = medir_insumos_complementarios()
    print(f"{'Insumo':<42}{'MB':>7}{'Chars':>12}{'Tok.4':>10}{'Tok.4o':>10}")
    print("-" * 81)
    for m in complementarios:
        if m["estado"] != "ok":
            print(f"{m['insumo'][:41]:<42}{'--':>7}{m['estado']:>32}")
            continue
        print(
            f"{m['insumo'][:41]:<42}{m['tamano_mb']:>7.2f}"
            f"{m['caracteres']:>12,}{m['tokens_cl100k']:>10,}{m['tokens_o200k']:>10,}"
        )

    tok_comp = sum(m.get("tokens_cl100k", 0) for m in complementarios)
    print("-" * 81)
    print(f"{'TOTAL insumos complementarios':<42}{'':>7}{'':>12}{tok_comp:>10,}")

    # Costo recurrente de mandar el esquema en cada llamada (contexto fijo).
    ddl = next(
        (m for m in complementarios if m["insumo"].startswith("esquema v10")), None
    )
    if ddl and ddl["estado"] == "ok":
        costo_ctx = ddl["tokens_cl100k"] * total_filas
        print(
            f"\nSi cada una de las {total_filas:,} filas viaja con el DDL completo "
            f"como contexto: {costo_ctx:,} tokens extra ({costo_ctx / 1e6:.1f}M)."
        )

    salida = RAIZ / "scripts" / "out_analisis_tokens.json"
    salida.write_text(
        json.dumps(
            {
                "fuente": str(XLSX),
                "hojas": resultados,
                "totales": {
                    "filas": total_filas,
                    "celdas": total_celdas,
                    "caracteres": total_chars,
                    "caracteres_csv": total_chars_csv,
                    "tokens_valores_cl100k": total_tok_val,
                    "tokens_csv_cl100k": total_tok_csv,
                    "tokens_csv_o200k": total_tok_o200k,
                },
                "pipeline": {
                    "entrada": total_entrada,
                    "salida": total_salida,
                    "total": total_pipeline,
                    "multiplicador": round(total_pipeline / total_tok_csv, 2),
                },
                "insumos_complementarios": complementarios,
                "tokens_insumos_complementarios": tok_comp,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nDetalle por hoja guardado en: {salida.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
