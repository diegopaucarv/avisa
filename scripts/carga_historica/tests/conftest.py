from __future__ import annotations

import sys
from pathlib import Path

import pytest

RAIZ_CARGA = Path(__file__).resolve().parents[1]
if str(RAIZ_CARGA) not in sys.path:
    sys.path.insert(0, str(RAIZ_CARGA))

from plan_historico import Contextos, clave


@pytest.fixture()
def ctx_minimo() -> Contextos:
    return Contextos(
        alcances={clave("Nacional"): 1},
        subsectores={clave("Pesca"): 2},
        niveles_riesgo={clave("Bajo"): 2, clave("Medio"): 3, clave("Alto"): 4},
        tipos_actor={clave("Organización social"): 7, clave("Empresa"): 8},
        roles_actor={clave("No determinado"): 5},
        perfiles_actor={clave("Conflictivo"): 9},
        tipos_documento={clave("Informe"): 3},
        tipos_reunion={clave("Taller"): 1},
        usuarios={clave("Iván Ascurra"): "usuario-sectorista"},
        regiones={clave("Piura"): 10},
        provincias={(clave("Piura"), clave("Talara")): 20},
        distritos={(clave("Piura"), clave("Talara"), clave("Máncora")): 30},
        distritos_por_nombre={clave("Máncora"): 30},
        actores_directorio={},
        existentes={},
        secuencias={("alerta", 2026): 91},
        alias={},
        duplicados={},
    )
