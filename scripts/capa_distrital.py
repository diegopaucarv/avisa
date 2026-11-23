"""Extrae la capa distrital censal (shapefile) a artefactos derivados.

No usa pyshp/geopandas: parsea el .shp y el .dbf a mano, como
`kml_infraestructuras.py`. Lee la poblacion del Censo, calcula area y
centroide por poligono y descarta los campos de contacto de terceros que
trae el .dbf (`descargar`, `contacto`, `whatsapp`).

Uso:
    python scripts/capa_distrital.py                 # CSV + GeoJSON + centroides
    python scripts/capa_distrital.py --simplificar 0.002   # + version simplificada
    python scripts/capa_distrital.py --sin-geojson

Salidas en gis/derived/:
    distritos_capa.csv              atributos, poblacion, area, centroide
    distritos_capa.geojson          poligonos WGS84 (geometria completa)
    distritos_capa_simple.geojson   solo si --simplificar

El .dbf viene en UTF-8 aunque el .cpg declare latin-1: se decodifica UTF-8 y se
cae a latin-1 solo si un registro falla.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (
    ROOT / "gis" / "Poblacion Censo 2025 geogpsperu" / "Poblacion Censo 2025 geogpsperu"
)
OUT = ROOT / "gis" / "derived"

# Campos del .dbf que no salen a los derivados.
PII = {"descargar", "contacto", "whatsapp"}


def read_dbf(path: pathlib.Path) -> list[dict]:
    with path.open("rb") as fh:
        header = fh.read(32)
        n_rec = struct.unpack("<I", header[4:8])[0]
        header_len = struct.unpack("<H", header[8:10])[0]
        rec_len = struct.unpack("<H", header[10:12])[0]

        fields = []
        while True:
            d = fh.read(32)
            if d[:1] == b"\r":
                break
            name = d[:11].split(b"\x00")[0].decode("ascii", "replace")
            fields.append((name, chr(d[11]), d[16]))

        fh.seek(header_len)
        rows = []
        for _ in range(n_rec):
            rec = fh.read(rec_len)
            if rec[:1] == b"*":  # registro borrado
                continue
            pos = 1
            out = {}
            for name, ftype, flen in fields:
                raw = rec[pos : pos + flen]
                pos += flen
                txt = raw.decode("utf-8", "replace").strip()
                if "\ufffd" in txt:
                    txt = raw.decode("latin-1", "replace").strip()
                if ftype in ("N", "F"):
                    txt = txt.replace(",", "")
                    try:
                        out[name] = int(float(txt)) if "." not in txt else float(txt)
                    except ValueError:
                        out[name] = None
                else:
                    out[name] = txt
            rows.append(out)
    return rows


def read_shp(path: pathlib.Path):
    """Devuelve [(bbox, [anillos])] en el mismo orden que el .dbf.

    Cada anillo es una lista de (x, y). Los agujeros van como anillos
    adicionales, tal como los entrega el .shp (sin resolver el anidamiento).
    """
    with path.open("rb") as fh:
        data = fh.read()
    if struct.unpack(">i", data[0:4])[0] != 9994:
        raise SystemExit("no es un shapefile")
    pos = 100
    shapes = []
    while pos < len(data):
        rec_num, content_len = struct.unpack(">2i", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + content_len * 2]
        pos += 8 + content_len * 2
        shape_type = struct.unpack("<i", body[0:4])[0]
        if shape_type == 0:
            shapes.append((None, []))
            continue
        if shape_type != 5:
            raise SystemExit(
                f"tipo de geometria {shape_type} no soportado (solo 5 = poligono)"
            )
        xmin, ymin, xmax, ymax = struct.unpack("<4d", body[4:36])
        n_parts, n_points = struct.unpack("<2i", body[36:44])
        idx = struct.unpack(f"<{n_parts}i", body[44 : 44 + 4 * n_parts])
        pts_off = 44 + 4 * n_parts
        pts = struct.unpack(
            f"<{2 * n_points}d", body[pts_off : pts_off + 16 * n_points]
        )
        coords = list(zip(pts[0::2], pts[1::2]))
        rings = []
        for k in range(n_parts):
            a = idx[k]
            b = idx[k + 1] if k + 1 < n_parts else n_points
            rings.append(coords[a:b])
        shapes.append(((xmin, ymin, xmax, ymax), rings))
    return shapes


def ring_area(r):
    """Area con signo (shoelace)."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
        s += x1 * y2 - x2 * y1
    return s / 2.0


def ring_centroid(r):
    a = ring_area(r)
    if abs(a) < 1e-12:
        xs = [p[0] for p in r]
        ys = [p[1] for p in r]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return cx / (6 * a), cy / (6 * a)


def polygon_area_km2(rings):
    """Area neta (exterior menos agujeros) aproximada a km2.

    A esta latitud 1 grado de latitud ~= 110,57 km y 1 de longitud ~=
    111,32*cos(lat). Se usa el centroide del bbox como lat de referencia:
    suficiente para una cifra de contexto, no para geodesia fina.
    """
    if not rings:
        return 0.0
    ext = ring_area(rings[0])
    net = abs(ext) - sum(abs(ring_area(r)) for r in rings[1:])
    # grados^2 -> km^2 con la escala local en el centroide del anillo exterior
    cx, cy = ring_centroid(rings[0])
    ky = 110.574
    kx = 111.320 * math.cos(math.radians(cy))
    return net * kx * ky


def simplify(ring, tol):
    """Douglas-Peucker iterativo (sin recursion) para anillos cerrados."""
    if len(ring) <= 4:
        return ring
    pts = ring
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            x0, y0 = pts[i]
            if norm == 0:
                d = math.hypot(x0 - x1, y0 - y1)
            else:
                d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    out = [p for p, k in zip(pts, keep) if k]
    return out if len(out) >= 4 else ring


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simplificar", type=float, default=None, metavar="GRADOS")
    ap.add_argument("--sin-geojson", action="store_true")
    args = ap.parse_args()

    attrs = read_dbf(pathlib.Path(f"{SRC}.dbf"))
    shapes = read_shp(pathlib.Path(f"{SRC}.shp"))
    n = len(attrs)
    if n != len(shapes):
        raise SystemExit(f"desalineado: {n} registros dbf vs {len(shapes)} shapes")

    cols = [k for k in attrs[0] if k not in PII]
    OUT.mkdir(parents=True, exist_ok=True)

    feats_csv = []
    feats_geo = []
    feats_sim = []
    verts = 0
    for a, (bbox, rings) in zip(attrs, shapes):
        if not rings:
            continue
        cx, cy = ring_centroid(rings[0])
        area = polygon_area_km2(rings)
        verts += sum(len(r) for r in rings)
        row = {k: a.get(k) for k in cols}
        row["centroide_lat"] = round(cy, 6)
        row["centroide_lon"] = round(cx, 6)
        row["area_km2"] = round(area, 3)
        row["anillos"] = len(rings)
        feats_csv.append(row)

        props = {
            "ubigeo": a["UBIGEO"],
            "distrito": a["DISTRITO"],
            "provincia": a["PROVINCIA"],
            "departamento": a["DEPARTAMEN"],
            "total": a.get("Total"),
            "area_km2": round(area, 3),
        }

        def rings_json(rs):
            return [[[round(x, 6), round(y, 6)] for x, y in r] for r in rs]

        feats_geo.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Polygon", "coordinates": rings_json(rings)},
            }
        )
        if args.simplificar is not None:
            feats_sim.append(
                {
                    "type": "Feature",
                    "properties": props,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": rings_json(
                            [simplify(r, args.simplificar) for r in rings]
                        ),
                    },
                }
            )

    csv_path = OUT / "distritos_capa.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(feats_csv[0].keys()))
        w.writeheader()
        w.writerows(feats_csv)

    print(f"distritos: {len(feats_csv)} | vertices: {verts}")
    print(f"CSV   -> {csv_path.relative_to(ROOT)}")

    if not args.sin_geojson:
        gj = {"type": "FeatureCollection", "features": feats_geo}
        p = OUT / "distritos_capa.geojson"
        p.write_text(
            json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"GEO   -> {p.relative_to(ROOT)}  ({p.stat().st_size / 1e6:.1f} MB)")

    if args.simplificar is not None:
        gj = {"type": "FeatureCollection", "features": feats_sim}
        p = OUT / "distritos_capa_simple.geojson"
        p.write_text(
            json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        v2 = sum(len(r) for f in feats_sim for r in f["geometry"]["coordinates"])
        print(
            f"SIMPL -> {p.relative_to(ROOT)}  ({p.stat().st_size / 1e6:.1f} MB, {v2} vertices)"
        )


if __name__ == "__main__":
    main()
