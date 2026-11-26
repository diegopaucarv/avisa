#!/usr/bin/env python
"""Ruteo de colectivos y entidades públicas (etapa 2 del matcher).

Problema que resuelve
---------------------
El matcher por embeddings confunde **descriptores colectivos** («Pescadores»,
«Gremios de pescadores artesanales zona norte») con organizaciones concretas, y
arrastra tipos equivocados (una OSPA clasificada como persona). Aquí se aplica
un ruteo previo, con **reglas generales** (no una lista de los casos vistos) y
apoyo de embeddings.

Reglas (no dependen de ningún texto concreto)
---------------------------------------------
1. **Ancla propia.** Una frase es "anclada" si, después de la primera palabra,
   contiene un nombre propio (token capitalizado de 3+ letras), una sigla en
   mayúsculas de 4+ letras, o el nombre de una región/distrito que existe en la
   base. Si no tiene ancla, es un **descriptor colectivo**, no una entidad.
2. **Colectivo ⇒ OSPA.** Todo descriptor colectivo se tipifica como
   `organizacion` (nunca persona) y se rutea contra las OSPA existentes. Si la
   frase nombra un ámbito (p. ej. un distrito), se restringe a las OSPA de ese
   ámbito; si hay una sola, se propone; si hay varias, queda dudoso; si no hay,
   se propone crear una OSPA con ese ámbito.
3. **Entidad pública.** Si la cabeza del nombre es municipalidad, procuraduría,
   dirección, ministerio, instituto, oficina o autoridad, no es un colectivo ni
   una OSPA: se rutea contra las unidades orgánicas.
4. **Anclada.** Se conserva el veredicto del matcher, pero se corrige el tipo
   cuando el nombre delata una organización.

Sólo lectura: no escribe en la base. Uso:
    python scripts/matriz/ruteo_colectivos.py
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from collections import Counter
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = RAIZ / "scripts/matriz/salida/match_actores.json"
SALIDA = RAIZ / "scripts/matriz/salida/match_ruteado.json"

HEADS_PUBLICAS = {
    "municipalidad",
    "procuraduria",
    "direccion",
    "ministerio",
    "instituto",
    "oficina",
    "autoridad",
    "gobierno",
    "gore",
    "prefectura",
    "subprefectura",
}
MARCAS_ORGANIZACION = (
    "ospa",
    "gremio",
    "asociacion",
    "sindicato",
    "comite",
    "federacion",
    "cooperativa",
    "confederacion",
    "camara",
    "union",
    "consejo",
    "mesa",
)


def norm(texto: str | None) -> str:
    valor = unicodedata.normalize("NFKD", texto or "")
    valor = "".join(c for c in valor if not unicodedata.combining(c))
    valor = "".join(c.lower() if c.isalnum() else " " for c in valor)
    return " ".join(valor.split())


def conectar():
    load_dotenv(RAIZ / ".env", override=False)
    url = os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Falta NEON_OWNER_URL o DATABASE_URL")
    conn = psycopg2.connect(url)
    conn.set_session(readonly=True, autocommit=True)
    return conn


def cargar(conn):
    cur = conn.cursor()
    localidades: set[str] = set()
    for tabla, columna in (
        ("core.regiones", "nombre"),
        ("core.distritos", "nombre"),
    ):
        cur.execute(f"select distinct {columna} from {tabla}")
        for (valor,) in cur.fetchall():
            if valor:
                localidades.update(norm(valor).split())

    cur.execute(
        "select actor_uid::text, razon_social, abreviatura from core.organizaciones "
        "where razon_social is not null"
    )
    organizaciones = [
        {"tabla": "core.organizaciones", "id": uid, "nombre": nombre, "siglas": abrev}
        for uid, nombre, abrev in cur.fetchall()
    ]

    cur.execute(
        "select actor_uid::text, nombre_actual, abreviatura, naturaleza, tipo_actor_id "
        "from core.actores where nombre_actual is not null"
    )
    actores = [
        {
            "tabla": "core.actores",
            "id": uid,
            "nombre": nombre,
            "siglas": abrev,
            "naturaleza": nat,
            "tipo_actor_id": tipo,
        }
        for uid, nombre, abrev, nat, tipo in cur.fetchall()
    ]

    cur.execute(
        "select id::text, siglas, nombre_completo from core.cat_unidades_organicas"
    )
    unidades = [
        {
            "tabla": "core.cat_unidades_organicas",
            "id": uid,
            "nombre": nombre,
            "siglas": siglas,
        }
        for uid, siglas, nombre in cur.fetchall()
    ]
    return localidades, organizaciones, actores, unidades


def localidades_de(texto: str, localidades: set[str]) -> set[str]:
    return {t for t in norm(texto).split() if t in localidades}


def analizar_ancla(crudo: str, localidades: set[str]):
    """Devuelve (tiene_ancla_propia, localidades_nombradas)."""
    palabras = [p for p in crudo.split() if p]
    propias = [
        p
        for p in palabras[1:]
        if p[:1].isupper() and len(re.sub(r"[^A-Za-zÁÉÍÓÚÑáéíóúñ]", "", p)) >= 3
    ]
    siglas = re.findall(r"\b[A-ZÁÉÍÓÚÑ0-9]{4,}\b", crudo)
    locs = localidades_de(crudo, localidades)
    return bool(propias or siglas or locs), locs


def es_ospa(nombre: str) -> bool:
    return "ospa" in norm(nombre).split()


def clasificar(
    crudo: str, tipo_matcher: str, localidades: set[str]
) -> tuple[str, set[str]]:
    """Etapa de reglas: decide la familia antes de mirar embeddings."""
    texto = norm(crudo)
    cabeza = texto.split()[0] if texto.split() else ""
    if cabeza in HEADS_PUBLICAS:
        return "entidad_publica", set()
    ancla, locs = analizar_ancla(crudo, localidades)
    if es_ospa(crudo) or not ancla:
        return "colectivo_ospa", locs
    if tipo_matcher == "persona" and any(m in texto for m in MARCAS_ORGANIZACION):
        return "organizacion", locs
    return "anclado", locs


def main() -> None:
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    conn = conectar()
    localidades, organizaciones, actores, unidades = cargar(conn)

    candidatos = organizaciones + [
        a for a in actores if a["naturaleza"] == "organizacion"
    ]
    pool_ospa = [c for c in candidatos if es_ospa(c["nombre"])]
    print(
        f"localidades={len(localidades)} organizaciones={len(organizaciones)} "
        f"actores_org={len(candidatos) - len(organizaciones)} ospa={len(pool_ospa)} "
        f"unidades={len(unidades)}"
    )

    datos = json.loads(ENTRADA.read_text(encoding="utf-8"))
    filas = datos["filas"]
    crudos = sorted({f["crudo"] for f in filas})
    modelo = SentenceTransformer(
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    vec_crudo = dict(
        zip(
            crudos,
            modelo.encode(crudos, normalize_embeddings=True, show_progress_bar=False),
        )
    )
    vec_ospa = modelo.encode(
        [c["nombre"] for c in pool_ospa],
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    vec_unidades = modelo.encode(
        [u["nombre"] for u in unidades],
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    salida = []
    for fila in filas:
        crudo = fila["crudo"]
        familia, locs = clasificar(crudo, fila["tipo"], localidades)
        destino, veredicto, rama, cos = (
            None,
            fila["veredicto"],
            fila["rama"],
            fila["coseno"],
        )

        if familia == "colectivo_ospa":
            indices = list(range(len(pool_ospa)))
            if locs:
                indices = [
                    i
                    for i in indices
                    if locs & set(norm(pool_ospa[i]["nombre"]).split())
                ] or indices
            sims = cosine_similarity(
                vec_crudo[crudo].reshape(1, -1), vec_ospa[indices]
            )[0]
            mejor = int(sims.argmax())
            cos = float(sims[mejor])
            destino = pool_ospa[indices[mejor]]
            if cos >= 0.80:
                veredicto, rama = "auto_ospa", "ruteo_ospa_ambito"
            elif cos >= 0.62:
                veredicto, rama = "dudoso_ospa", "ruteo_ospa_ambito"
            else:
                veredicto, rama, destino = (
                    "nuevo_ospa",
                    "ruteo_ospa_sin_candidato",
                    None,
                )
        elif familia == "entidad_publica":
            sims = cosine_similarity(vec_crudo[crudo].reshape(1, -1), vec_unidades)[0]
            mejor = int(sims.argmax())
            cos = float(sims[mejor])
            if cos >= 0.72:
                destino = unidades[mejor]
                veredicto, rama = "auto_unidad", "ruteo_unidad_organica"
            else:
                veredicto, rama, destino = (
                    "nuevo_unidad",
                    "ruteo_unidad_sin_candidato",
                    None,
                )

        salida.append(
            {
                **fila,
                "familia": familia,
                "localidades": sorted(locs),
                "tipo_final": "organizacion"
                if familia in ("colectivo_ospa", "anclado")
                else "entidad_publica",
                "subtipo": "ospa" if familia == "colectivo_ospa" else None,
                "veredicto_final": veredicto,
                "rama_final": rama,
                "coseno_final": None if cos is None else round(float(cos), 3),
                "destino_final": destino,
            }
        )

    resumen = {
        "filas": len(salida),
        "por_familia": dict(Counter(f["familia"] for f in salida)),
        "por_veredicto": dict(Counter(f["veredicto_final"] for f in salida)),
        "por_rama": dict(Counter(f["rama_final"] for f in salida)),
        "tipo_corregido_a_organizacion": sum(
            1
            for f in salida
            if f["tipo"] == "persona" and f["tipo_final"] == "organizacion"
        ),
    }
    SALIDA.write_text(
        json.dumps({"resumen": resumen, "filas": salida}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\nRESUMEN:", json.dumps(resumen, ensure_ascii=False, indent=2))
    print("\n== ruteo de colectivos / OSPA ==")
    for f in salida:
        if f["familia"] != "colectivo_ospa":
            continue
        destino = (f["destino_final"] or {}).get("nombre")
        print(
            f"  {str(f['crudo'])[:62]:64} {f['veredicto_final']:14} "
            f"cos={f['coseno_final']}  {str(destino)[:44]}"
        )
    print(f"\nEscrito {SALIDA} (sin escribir en la base)")


if __name__ == "__main__":
    main()
