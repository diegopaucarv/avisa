from __future__ import annotations

import importar_historico
import pytest
from plan_historico import clave


def test_clave_texto_igual_pese_a_puntuacion_tildes_mayusculas_y_espacios():
    assert importar_historico._clave_texto("¿Qué pasó, pues?") == (
        importar_historico._clave_texto("que paso pues")
    )
    assert importar_historico._clave_texto(
        "  Tala  ILEGAL, en (Madre) de Dios!! "
    ) == importar_historico._clave_texto("tala ilegal en madre de dios")


def test_clave_no_iguala_textos_que_solo_difieren_en_puntuacion():
    assert clave("¿Qué pasó, pues?") != clave("que paso pues")


def test_actor_datos_personales_devuelve_actor_uid():
    assert importar_historico.COLUMNA_ID["actor_datos_personales"] == "actor_uid"


@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(
            ["--excel", "inexistente.xlsx", "--apply"],
            id="apply_sin_confirmar",
        ),
        pytest.param(
            [
                "--excel",
                "inexistente.xlsx",
                "--apply",
                "--ensayo-escritura",
                "--confirmar",
            ],
            id="apply_y_ensayo_escritura_excluyentes",
        ),
        pytest.param(
            ["--excel", "inexistente.xlsx", "--ensayo-escritura"],
            id="ensayo_escritura_sin_confirmar",
        ),
    ],
)
def test_guardas_del_cli_abortan_sin_leer_el_libro_ni_conectar(
    argv, monkeypatch, capsys
):
    def prohibido(*args, **kwargs):
        raise AssertionError("la guarda debía abortar antes de este paso")

    monkeypatch.setattr(importar_historico, "leer_libro", prohibido)
    monkeypatch.setattr(importar_historico, "conectar", prohibido)

    codigo = importar_historico.main(argv)

    assert codigo == 2
    assert capsys.readouterr().err
