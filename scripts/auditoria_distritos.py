"""Audita el catalogo territorial de la base contra la capa censal y la tabla OTI.

Solo lectura: no escribe en la base. Emite
    gis/derived/auditoria_distritos.csv    una fila por ubigeo del catalogo
    gis/derived/auditoria_resumen.txt      cifras y listas cortas
"""

from __future__ import annotations

import csv
import pathlib
import re
import unicodedata
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
DER = ROOT / "gis" / "derived"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.upper()
    s = re.sub(r"\bDISTRITO\s+DE\b", " ", s)
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    return re.sub(r" +", " ", s).strip()


def load_db():
    with (DER / "distritos_db.csv").open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def load_capa():
    with (DER / "distritos_capa.csv").open(encoding="utf-8", newline="") as fh:
        return {r["UBIGEO"]: r for r in csv.DictReader(fh)}


def load_oti():
    p = ROOT / "gis" / "equivalencia-ubigeos-oti-concytec.csv"
    txt = p.read_bytes().decode("cp1252")
    out = {}
    for r in csv.DictReader(txt.splitlines()):
        u = r["cod_ubigeo_inei"].strip()
        if not u:
            continue
        out[u] = {
            "distrito": r["desc_ubigeo_inei"].strip(),
            "provincia": r["desc_prov_inei"].strip(),
            "departamento": r["desc_dep_inei"].strip(),
        }
    return out


def main():
    db, capa, oti = load_db(), load_capa(), load_oti()
    print(f"base: {len(db)} | capa: {len(capa)} | OTI: {len(oti)}")

    rows = []
    c = Counter()
    for r in db:
        u = r["ubigeo"]
        n_db = r["distrito"]
        in_oti, in_capa = u in oti, u in capa
        ref = oti.get(u) or capa.get(u)
        nombre_ref = ref["distrito"] if ref else None
        prov_ref = ref["provincia"] if ref else None
        dep_ref = ref["departamento"] if ref else None

        if not in_oti and not in_capa:
            estado = "ubigeo inexistente"
        elif nombre_ref and norm(n_db) != norm(nombre_ref):
            estado = "nombre desalineado"
        elif prov_ref and norm(r["provincia"]) != norm(prov_ref):
            estado = "provincia desalineada"
        else:
            estado = "ok"
        c[estado] += 1
        rows.append(
            {
                **r,
                "en_oti": in_oti,
                "en_capa": in_capa,
                "nombre_oficial": nombre_ref,
                "provincia_oficial": prov_ref,
                "departamento_oficial": dep_ref,
                "estado": estado,
            }
        )

    faltan = sorted(set(capa) - {r["ubigeo"] for r in db})
    sobran = sorted({r["ubigeo"] for r in db} - set(capa))
    print(dict(c))
    print(f"la capa tiene {len(faltan)} ubigeos que la base no tiene")
    print(f"la base tiene {len(sobran)} ubigeos que la capa no tiene")

    with (DER / "auditoria_distritos.csv").open(
        "w", encoding="utf-8", newline=""
    ) as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    bad = [r for r in rows if r["estado"] != "ok"]
    with (DER / "auditoria_resumen.txt").open("w", encoding="utf-8") as fh:
        fh.write(f"base={len(db)} capa={len(capa)} oti={len(oti)}\n")
        fh.write(f"{dict(c)}\n\n")
        fh.write("== filas con problema ==\n")
        for r in sorted(bad, key=lambda x: x["ubigeo"]):
            fh.write(
                f"{r['ubigeo']} base={r['distrito']!r} ({r['provincia']!r}) "
                f"oficial={r['nombre_oficial']!r} ({r['provincia_oficial']!r}) "
                f"[{r['estado']}] oti={r['en_oti']} capa={r['en_capa']}\n"
            )
        fh.write("\n== ubigeos de la capa ausentes en la base ==\n")
        for u in faltan:
            fh.write(
                f"{u} {capa[u]['DISTRITO']} / {capa[u]['PROVINCIA']} / {capa[u]['DEPARTAMEN']}\n"
            )

    print(f"problemas: {len(bad)}")
    print(f"-> {(DER / 'auditoria_distritos.csv').relative_to(ROOT)}")
    print(f"-> {(DER / 'auditoria_resumen.txt').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
