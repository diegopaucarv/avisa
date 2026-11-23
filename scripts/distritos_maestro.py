"""Maestro territorial canonico (INEI 2025) + reconciliacion contra la base.

Fuentes:
  gis/ubigeo_inei_2025.csv       nombres/ubigeo oficiales (verdad)
  gis/derived/distritos_capa.csv geometria (centroide, area, anillos)
  gis/derived/distritos_db.csv   catalogo actual (698 filas)
  base local (solo lectura)      conteo de referencias por distrito

Hallazgo: la base enumero los distritos ALFABETICAMENTE asignando CCDI
consecutivo, sin respetar los huecos del INEI. Por eso el re-anclaje correcto
es por NOMBRE dentro de la provincia, nunca por ubigeo ni por posicion.

Estrategia:
  - provincias: 70 existentes casan por (region, nombre); se insertan las 126
    faltantes. Los 4 digitos de ubigeo de las existentes ya son correctos.
  - distritos: cada fila base se casa por nombre normalizado dentro de su
    provincia. Alias de grafia resuelven variantes. Lo no casado se borra
    (exigiendo 0 referencias) y lo faltante del INEI se inserta.

Solo lectura sobre la base. Emite CSV en gis/derived/.
"""

from __future__ import annotations

import csv
import pathlib
import re
import sys
import unicodedata

import psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent
GIS = ROOT / "gis"
DER = GIS / "derived"

# Variantes de grafia: nombre_base (normalizado) -> nombre_inei (normalizado).
# Solo se aplican dentro de la misma provincia.
ALIAS = {
    "RAYMONDI": "RAIMONDI",
    "PAMPAS": "PAMPAS GRANDE",
    "MARCARA": "MARCARA",
}


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c)).upper()
    t = re.sub(r"[^A-Z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def db_url() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("sin DATABASE_URL")


def read_inei():
    raw = (GIS / "ubigeo_inei_2025.csv").read_bytes().decode("utf-8-sig")
    out = {}
    for r in csv.DictReader(raw.splitlines(), delimiter=";"):
        u = r["ubigeo"].strip()
        out[u] = {
            "ubigeo": u,
            "departamento": r["departamento"].strip(),
            "provincia": r["provincia"].strip(),
            "distrito": r["distrito"].strip(),
            "capital": (r.get("capital_legal") or "").strip(),
            "categoria": (r.get("categoría") or "").strip(),
            "altitud": (r.get("altitud") or "").strip(),
            "poblacion": (r.get("población") or "").strip(),
            "lat": (r.get("latitud") or "").strip(),
            "lon": (r.get("longitud") or "").strip(),
        }
    # Reparar provincia por prefijo: 061306 trae "Ninabamba" donde va "Santa Cruz"
    por_prefijo: dict[str, dict[str, int]] = {}
    for u, r in out.items():
        por_prefijo.setdefault(u[:4], {}).setdefault(r["provincia"], 0)
        por_prefijo[u[:4]][r["provincia"]] += 1
    reparadas = []
    for u, r in out.items():
        freq = por_prefijo[u[:4]]
        oficial = max(freq, key=freq.get)
        if r["provincia"] != oficial:
            reparadas.append((u, r["distrito"], r["provincia"], oficial))
            r["provincia"] = oficial
    return out, reparadas


def read_capa():
    out = {}
    with (DER / "distritos_capa.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out[r["UBIGEO"].strip()] = r
    return out


def read_db():
    with (DER / "distritos_db.csv").open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def refs_por_distrito() -> dict[int, int]:
    q = """
    SELECT distrito_id, count(*) FROM (
        SELECT distrito_id FROM core.actores
        UNION ALL SELECT distrito_id FROM core.alertas_tempranas
        UNION ALL SELECT distrito_id FROM core.capacitaciones
        UNION ALL SELECT distrito_id FROM core.caso_distritos
        UNION ALL SELECT distrito_principal_id FROM core.casos
        UNION ALL SELECT distrito_id FROM core.documentos
        UNION ALL SELECT distrito_id FROM core.locales
        UNION ALL SELECT distrito_id FROM core.compromiso_distritos
        UNION ALL SELECT distrito_id FROM territorio.lugares
        UNION ALL SELECT distrito_id FROM ctx.observaciones
        UNION ALL SELECT distrito_id FROM ind.resultado
        UNION ALL SELECT distrito_id FROM ind.seleccion
        UNION ALL SELECT distrito_id FROM gis.infraestructuras_puntos
    ) t WHERE distrito_id IS NOT NULL GROUP BY distrito_id
    """
    with psycopg.connect(db_url()) as conn, conn.cursor() as cur:
        cur.execute(q)
        return {int(i): int(n) for i, n in cur.fetchall()}


def main() -> int:
    inei, prov_reparadas = read_inei()
    capa = read_capa()
    db = read_db()
    refs = refs_por_distrito()

    print(f"INEI {len(inei)} | capa {len(capa)} | base {len(db)}")
    if prov_reparadas:
        print("provincias reparadas en INEI:", prov_reparadas)

    regiones: dict[str, str] = {}
    provincias: dict[str, dict] = {}
    for u, r in inei.items():
        regiones.setdefault(u[:2], r["departamento"])
        provincias.setdefault(
            u[:4], {"ubigeo": u[:4], "region_ubigeo": u[:2], "nombre": r["provincia"]}
        )
    print(f"regiones {len(regiones)} | provincias {len(provincias)}")

    # indice INEI por provincia -> nombre normalizado -> ubigeo
    por_prov: dict[str, dict[str, str]] = {}
    for u, r in inei.items():
        por_prov.setdefault(u[:4], {})[norm(r["distrito"])] = u

    # base: provincia_id -> (nombre, region) y region nombre -> ubigeo
    region_ubigeo = {norm(n): u for u, n in regiones.items()}
    prov_ubigeo_por_nombre: dict[tuple[str, str], str] = {
        (p["region_ubigeo"], norm(p["nombre"])): u for u, p in provincias.items()
    }

    base_prov: dict[str, dict] = {}
    for r in db:
        base_prov.setdefault(
            r["provincia_id"],
            {"nombre": r["provincia"], "region": r["region"], "filas": 0},
        )
        base_prov[r["provincia_id"]]["filas"] += 1

    prov_id_a_ubigeo: dict[str, str] = {}
    sin_prov = []
    for pid, b in base_prov.items():
        reg_u = region_ubigeo.get(norm(b["region"]))
        pu = prov_ubigeo_por_nombre.get((reg_u, norm(b["nombre"])))
        if pu is None:
            sin_prov.append((pid, b["nombre"], b["region"]))
        else:
            prov_id_a_ubigeo[pid] = pu
    if sin_prov:
        print("PROVINCIAS BASE SIN MATCH:", sin_prov)

    # --- reconciliacion de distritos ---
    acciones = []
    destinos: dict[str, list[dict]] = {}
    for r in db:
        did = int(r["distrito_id"])
        nombre_base = r["distrito"]
        pu = prov_id_a_ubigeo.get(r["provincia_id"])
        n = refs.get(did, 0)
        accion = {
            "distrito_id": did,
            "ubigeo_base": r["ubigeo"].strip(),
            "nombre_base": nombre_base,
            "provincia_base": r["provincia"],
            "referencias": n,
        }
        if pu is None:
            accion.update(
                accion="REVISAR", ubigeo_final="", nombre_final="", provincia_ubigeo=""
            )
            acciones.append(accion)
            continue
        mapa = por_prov.get(pu, {})
        objetivo = mapa.get(norm(nombre_base))
        if objetivo is None:
            alias = ALIAS.get(norm(nombre_base))
            if alias and alias in mapa:
                objetivo = mapa[alias]
        if objetivo is None:
            accion.update(ubigeo_final="", nombre_final="", provincia_ubigeo=pu)
            accion["accion"] = "BORRAR" if n == 0 else "REVISAR"
            acciones.append(accion)
            continue
        accion.update(
            ubigeo_final=objetivo,
            nombre_final=inei[objetivo]["distrito"],
            provincia_ubigeo=pu,
            accion="MANTENER",
        )
        destinos.setdefault(objetivo, []).append(accion)
        acciones.append(accion)

    # colisiones: dos filas base al mismo ubigeo final (p.ej. Saña/Zaña)
    colisiones = {u: v for u, v in destinos.items() if len(v) > 1}
    for u, v in colisiones.items():
        v.sort(key=lambda x: (-x["referencias"], x["distrito_id"]))
        for extra in v[1:]:
            extra["accion"] = "BORRAR" if extra["referencias"] == 0 else "REVISAR"
            extra["ubigeo_final"] = ""
            extra["nombre_final"] = ""
        print(
            f"colision {u}: {[(x['distrito_id'], x['nombre_base'], x['referencias']) for x in v]}"
        )

    destinado = {a["ubigeo_final"] for a in acciones if a["accion"] == "MANTENER"}
    insertar = sorted(set(inei) - destinado)

    conteo = {}
    for a in acciones:
        conteo[a["accion"]] = conteo.get(a["accion"], 0) + 1
    revisar = [a for a in acciones if a["accion"] == "REVISAR"]
    print("acciones base:", conteo)
    print("a insertar:", len(insertar), "| a borrar:", conteo.get("BORRAR", 0))
    if revisar:
        print("REVISAR (con referencias, no borrar):")
        for a in revisar:
            print("  ", a)
        print(
            "ABORTO: hay filas con referencias sin destino. Revisar antes de migrar.",
            file=sys.stderr,
        )
        return 2

    # --- emitir maestros ---
    with (DER / "regiones_maestro.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ubigeo", "nombre"])
        for ru in sorted(regiones):
            w.writerow([ru, regiones[ru]])

    with (DER / "provincias_maestro.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ubigeo", "region_ubigeo", "nombre"])
        for pu in sorted(provincias):
            p = provincias[pu]
            w.writerow([p["ubigeo"], p["region_ubigeo"], p["nombre"]])

    base_por_ubigeo = {
        a["ubigeo_final"]: a for a in acciones if a["accion"] == "MANTENER"
    }
    with (DER / "distritos_maestro.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "ubigeo",
                "distrito",
                "provincia",
                "provincia_ubigeo",
                "departamento",
                "region_ubigeo",
                "poblacion_inei",
                "altitud",
                "lat_capital",
                "lon_capital",
                "capital",
                "categoria",
                "poblacion_capa",
                "centroide_lat",
                "centroide_lon",
                "area_km2",
                "anillos",
                "distrito_id",
                "ubigeo_anterior",
                "tiene_geometria",
            ]
        )
        for u in sorted(inei):
            r = inei[u]
            c = capa.get(u, {})
            b = base_por_ubigeo.get(u)
            w.writerow(
                [
                    u,
                    r["distrito"],
                    r["provincia"],
                    u[:4],
                    r["departamento"],
                    u[:2],
                    r["poblacion"],
                    r["altitud"],
                    r["lat"],
                    r["lon"],
                    r["capital"],
                    r["categoria"],
                    c.get("Total", ""),
                    c.get("centroide_lat", ""),
                    c.get("centroide_lon", ""),
                    c.get("area_km2", ""),
                    c.get("anillos", ""),
                    b["distrito_id"] if b else "",
                    b["ubigeo_base"] if b else "",
                    "1" if c else "0",
                ]
            )

    with (DER / "reconciliacion_distritos.csv").open(
        "w", encoding="utf-8", newline=""
    ) as fh:
        w = csv.DictWriter(
            fh,
            fieldnames=[
                "accion",
                "distrito_id",
                "ubigeo_base",
                "nombre_base",
                "provincia_base",
                "referencias",
                "ubigeo_final",
                "nombre_final",
                "provincia_ubigeo",
            ],
        )
        w.writeheader()
        for a in acciones:
            w.writerow(a)
        for u in insertar:
            w.writerow(
                {
                    "accion": "INSERTAR",
                    "distrito_id": "",
                    "ubigeo_base": "",
                    "nombre_base": "",
                    "provincia_base": "",
                    "referencias": "",
                    "ubigeo_final": u,
                    "nombre_final": inei[u]["distrito"],
                    "provincia_ubigeo": u[:4],
                }
            )

    with (DER / "maestro_resumen.txt").open("w", encoding="utf-8") as fh:
        fh.write("Maestro territorial INEI 2025\n")
        fh.write(f"regiones            : {len(regiones)}\n")
        fh.write(f"provincias          : {len(provincias)}\n")
        fh.write(f"distritos           : {len(inei)}\n")
        fh.write(f"base actual         : {len(db)}\n")
        fh.write(f"mantener (re-ancla) : {conteo.get('MANTENER', 0)}\n")
        fh.write(f"borrar              : {conteo.get('BORRAR', 0)}\n")
        fh.write(f"insertar            : {len(insertar)}\n")
        fh.write(f"revisar             : {len(revisar)}\n")
        fh.write("\nprovincias reparadas en el CSV INEI:\n")
        for u, d, antes, ahora in prov_reparadas:
            fh.write(f"  {u} {d}: {antes!r} -> {ahora!r}\n")

    print("emitidos: regiones/provincias/distritos maestro, reconciliacion, resumen")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
