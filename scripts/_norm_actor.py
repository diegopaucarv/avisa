"""Helper de normalización y carga de entorno para los scripts B2/B3.

Se mantiene fuera de ``lib/`` porque son utilidades operativas de un solo uso
(no forman parte del runtime de la app) y así evitamos tocar código de producto.
La normalización replica exactamente ``parse_matriz.norm`` para que los matches
sean comparables con lo ya importado por ``scripts/matriz/*``.
"""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def norm(texto) -> str:
    """Minúsculas, sin tildes/diacríticos y con espacios colapsados.

    Igual que ``parse_matriz.norm``: se usa para emparejar por nombre
    normalizado exacto (nunca fuzzy) contra ``core.actores``.
    """
    if texto is None:
        return ""
    s = unicodedata.normalize("NFKD", str(texto))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s).strip().lower()


def tokens(texto: str) -> set[str]:
    """Tokens alfanuméricos (>2 chars) para medir parecido entre organizaciones."""
    return {t for t in re.split(r"[^a-z0-9]+", norm(texto)) if len(t) > 2}


def load_env_file(path: Path | str = RAIZ / ".env") -> None:
    """Equivalente a ``process.loadEnvFile('.env')`` de Node.

    - No sobreescribe variables ya presentes en el entorno (mismo criterio que
      ``loadEnvFile``: el entorno real gana sobre el archivo).
    - Ignora líneas vacías, comentarios ``#`` y las que no tengan ``=``.
    - Recorta comillas envolventes simples/dobles.
    """
    ruta = Path(path)
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding="utf-8", errors="replace").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        clave = clave.strip()
        if not clave or clave in os.environ:
            continue
        os.environ[clave] = valor.strip().strip('"').strip("'")


def url_owner() -> str:
    """Devuelve ``NEON_OWNER_URL``; el rol owner es obligatorio por RLS FORCE."""
    load_env_file()
    url = os.environ.get("NEON_OWNER_URL")
    if not url:
        raise SystemExit(
            "Falta NEON_OWNER_URL en el entorno ni en .env; se requiere el rol owner."
        )
    return url
