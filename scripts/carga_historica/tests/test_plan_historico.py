from __future__ import annotations

import copy

from plan_historico import clave, construir_plan

LEGADO_ALERTA = "historico_sectorista_iaes-AT-001"
LEGADO_DEMANDA = "historico_sectorista_iaes-AT-001-D01"
LEGADO_DOCUMENTO = "historico_sectorista_iaes-RD-001"
LEGADO_DEMANDA_DOCUMENTO = "historico_sectorista_iaes-RD-001-D01"


def alerta(**cambios):
    fila = {
        "codigo_legado": LEGADO_ALERTA,
        "fecha_reporte": "2026-05-10",
        "origen_dato": "AVISA_HISTORICO",
        "titulo": "Tala ilegal en la cuenca del Chira",
    }
    fila.update(cambios)
    return fila


def hecho(padre=LEGADO_ALERTA, **cambios):
    fila = {
        "alerta_codigo_legado": padre,
        "descripcion": "Se observó maquinaria dentro del cauce.",
        "orden": 1,
        "fecha": "2026-05-09",
    }
    fila.update(cambios)
    return fila


def actor_de_alerta(padre=LEGADO_ALERTA, **cambios):
    fila = {
        "alerta_codigo_legado": padre,
        "nombre": "Comunidad Nativa San Juan",
        "descripcion": "Presidente",
        "tipo_actor": "Organización social",
    }
    fila.update(cambios)
    return fila


def demanda_de_alerta(padre=LEGADO_ALERTA, **cambios):
    fila = {
        "codigo_legado": LEGADO_DEMANDA,
        "descripcion_demanda": "Solicitan fiscalización inmediata.",
        "alerta_codigo_legado": padre,
        "fecha_registro": "2026-05-11",
    }
    fila.update(cambios)
    return fila


def documento(**cambios):
    fila = {
        "codigo_legado": LEGADO_DOCUMENTO,
        "tipo_documento": "Informe",
        "titulo": "Informe de la reunión",
        "fecha": "2026-05-12",
        "origen_dato": "AVISA_HISTORICO",
    }
    fila.update(cambios)
    return fila


def demanda_de_documento(padre=LEGADO_DOCUMENTO, **cambios):
    fila = {
        "codigo_legado": LEGADO_DEMANDA_DOCUMENTO,
        "descripcion_demanda": "Solicitan copia del acta.",
        "documento_codigo_legado": padre,
        "fecha_registro": "2026-05-13",
    }
    fila.update(cambios)
    return fila


def inserciones_de(plan, tabla):
    return [i for i in plan.inserciones if i.tabla == tabla]


def omisiones_de(plan, tabla):
    return [o for o in plan.omitidos if o.tabla == tabla]


def rechazos_de(plan, tabla):
    return [r for r in plan.rechazos if r.tabla == tabla]


def test_plan_minimo_inserta_alerta_hecho_actor_vinculo_y_demanda(ctx_minimo):
    ctx_minimo.secuencias = {("alerta", 2026): 91}
    hojas = {
        "alertas_tempranas": [alerta()],
        "alerta_hechos": [hecho()],
        "alertas_actores": [actor_de_alerta()],
        "demandas": [demanda_de_alerta()],
    }

    plan = construir_plan(hojas, ctx_minimo)

    assert len(plan.inserciones) == 5
    assert len(inserciones_de(plan, "alertas_tempranas")) == 1
    assert len(inserciones_de(plan, "alerta_hechos")) == 1
    assert len(inserciones_de(plan, "actores")) == 1
    assert len(inserciones_de(plan, "alertas_actores")) == 1
    assert len(inserciones_de(plan, "demandas")) == 1

    datos_alerta = inserciones_de(plan, "alertas_tempranas")[0].datos
    assert datos_alerta["origen_dato"] == "AVISA_HISTORICO"
    assert datos_alerta["es_validado_humano"] is False
    assert datos_alerta["codigo_alerta"] == "AT-2026-91"

    datos_hecho = inserciones_de(plan, "alerta_hechos")[0].datos
    assert datos_hecho["alerta_ref"] == LEGADO_ALERTA

    datos_actor = inserciones_de(plan, "actores")[0].datos
    assert datos_actor["tipo_actor_id"] == 7
    assert datos_actor["origen_dato"] == "AVISA_HISTORICO"

    datos_vinculo = inserciones_de(plan, "alertas_actores")[0].datos
    assert datos_vinculo["alerta_ref"] == LEGADO_ALERTA

    datos_demanda = inserciones_de(plan, "demandas")[0].datos
    assert datos_demanda["alerta_ref"] == LEGADO_ALERTA
    assert datos_demanda["origen_dato"] == "AVISA_HISTORICO"


def test_nivel_riesgo_desconocido_advierte_y_queda_null(ctx_minimo):
    hojas = {"alertas_tempranas": [alerta(nivel_riesgo="Muy alto")]}

    plan = construir_plan(hojas, ctx_minimo)

    assert rechazos_de(plan, "alertas_tempranas") == []
    assert len(inserciones_de(plan, "alertas_tempranas")) == 1
    assert inserciones_de(plan, "alertas_tempranas")[0].datos["nivel_riesgo_id"] is None
    assert any(
        "nivel_riesgo" in aviso and "Muy alto" in aviso for aviso in plan.advertencias
    )


def test_alias_de_perfil_resuelve_y_suma_en_alias_usados(ctx_minimo):
    ctx_minimo.perfiles_actor = {clave("Conflictivo"): 9}
    ctx_minimo.alias = {"perfil": {clave("Disruptivo"): "Conflictivo"}}
    hojas = {
        "alertas_tempranas": [alerta()],
        "alertas_actores": [actor_de_alerta(perfil="Disruptivo")],
    }

    plan = construir_plan(hojas, ctx_minimo)

    assert len(inserciones_de(plan, "actores")) == 1
    assert inserciones_de(plan, "actores")[0].datos["perfil_id"] == 9
    assert plan.alias_usados.get("perfil") == 1


def test_demanda_con_alerta_padre_inexistente_se_rechaza(ctx_minimo):
    hojas = {"demandas": [demanda_de_alerta(padre="NO-EXISTE")]}

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "demandas") == []
    rechazos = rechazos_de(plan, "demandas")
    assert len(rechazos) == 1
    assert "padre" in rechazos[0].motivo
    assert "no existe" in rechazos[0].motivo


def test_codigo_legado_repetido_en_el_libro_rechaza_el_duplicado(ctx_minimo):
    hojas = {"alertas_tempranas": [alerta(), alerta()]}

    plan = construir_plan(hojas, ctx_minimo)

    assert len(inserciones_de(plan, "alertas_tempranas")) == 1
    rechazos = rechazos_de(plan, "alertas_tempranas")
    assert len(rechazos) == 1
    assert "duplicado dentro del libro" in rechazos[0].motivo


def test_registro_ya_existente_se_omite_sin_insertar(ctx_minimo):
    ctx_minimo.existentes = {"alertas_tempranas": {LEGADO_ALERTA: "id-existente"}}

    plan = construir_plan({"alertas_tempranas": [alerta()]}, ctx_minimo)

    assert inserciones_de(plan, "alertas_tempranas") == []
    omisiones = omisiones_de(plan, "alertas_tempranas")
    assert len(omisiones) == 1
    assert omisiones[0].motivo == "ya existe en core.alertas_tempranas"


def test_alerta_duplicada_por_contenido_omite_hijos_y_demanda(ctx_minimo):
    ctx_minimo.duplicados = {
        "alertas_tempranas": {
            LEGADO_ALERTA: "ya existe como AT-2026-18: mismo título y fecha"
        }
    }
    hojas = {
        "alertas_tempranas": [alerta()],
        "alerta_hechos": [hecho()],
        "alertas_actores": [actor_de_alerta()],
        "demandas": [demanda_de_alerta()],
    }

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "alertas_tempranas") == []
    assert inserciones_de(plan, "alerta_hechos") == []
    assert inserciones_de(plan, "alertas_actores") == []
    assert inserciones_de(plan, "actores") == []
    assert inserciones_de(plan, "demandas") == []

    assert len(omisiones_de(plan, "alerta_hechos")) == 1
    assert len(omisiones_de(plan, "alertas_actores")) == 1
    omisiones_demanda = omisiones_de(plan, "demandas")
    assert len(omisiones_demanda) == 1
    assert omisiones_demanda[0].motivo.startswith("la alerta padre ya existe")


def test_documento_duplicado_por_contenido_omite_hijos_y_demanda(ctx_minimo):
    ctx_minimo.duplicados = {
        "documentos": {LEGADO_DOCUMENTO: "ya existe como RED-2026-001: mismo texto"}
    }
    hojas = {
        "documentos": [documento()],
        "documento_actores": [
            {"documento_codigo_legado": LEGADO_DOCUMENTO, "nombre": "Comunidad X"}
        ],
        "demandas": [demanda_de_documento()],
    }

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "documentos") == []
    assert inserciones_de(plan, "documento_actores") == []
    assert inserciones_de(plan, "demandas") == []

    assert len(omisiones_de(plan, "documento_actores")) == 1
    omisiones_demanda = omisiones_de(plan, "demandas")
    assert len(omisiones_demanda) == 1
    assert omisiones_demanda[0].motivo.startswith("el documento padre ya existe: ")


def test_huella_es_estable_y_sensible_a_los_datos(ctx_minimo):
    hojas = {"alertas_tempranas": [alerta()]}

    plan_a = construir_plan(hojas, ctx_minimo)
    plan_b = construir_plan(hojas, ctx_minimo)
    assert plan_a.huella() == plan_b.huella()

    otras_hojas = copy.deepcopy(hojas)
    otras_hojas["alertas_tempranas"][0]["titulo"] = "Título completamente distinto"
    plan_c = construir_plan(otras_hojas, ctx_minimo)
    assert plan_c.huella() != plan_a.huella()


def test_origen_dato_invalido_se_rechaza(ctx_minimo):
    hojas = {"alertas_tempranas": [alerta(origen_dato="IMPORTACION")]}

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "alertas_tempranas") == []
    rechazos = rechazos_de(plan, "alertas_tempranas")
    assert len(rechazos) == 1
    assert "fuera de los valores permitidos" in rechazos[0].motivo


def test_fecha_reporte_vacia_se_rechaza(ctx_minimo):
    hojas = {"alertas_tempranas": [alerta(fecha_reporte="")]}

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "alertas_tempranas") == []
    rechazos = rechazos_de(plan, "alertas_tempranas")
    assert len(rechazos) == 1
    assert "fecha_reporte" in rechazos[0].motivo


def test_texto_que_excede_el_limite_se_recorta_y_se_advierte(ctx_minimo):
    ctx_minimo.longitudes = {("alertas_tempranas", "titulo"): 20}
    largo = "T" * 45

    plan = construir_plan({"alertas_tempranas": [alerta(titulo=largo)]}, ctx_minimo)

    datos = inserciones_de(plan, "alertas_tempranas")[0].datos
    assert datos["titulo"] == "T" * 20
    assert all(
        largo != valor for ins in plan.inserciones for valor in ins.datos.values()
    )
    assert any(
        "alertas_tempranas" in aviso and "titulo" in aviso and "recortado" in aviso
        for aviso in plan.advertencias
    )


def test_texto_dentro_del_limite_no_se_altera_ni_advierte(ctx_minimo):
    ctx_minimo.longitudes = {("alertas_tempranas", "titulo"): 100}
    titulo = "Tala ilegal breve"

    plan = construir_plan({"alertas_tempranas": [alerta(titulo=titulo)]}, ctx_minimo)

    datos = inserciones_de(plan, "alertas_tempranas")[0].datos
    assert datos["titulo"] == titulo
    assert not any("recortado" in aviso for aviso in plan.advertencias)


def test_columna_sin_limite_no_se_recorta(ctx_minimo):
    ctx_minimo.longitudes = {("actores", "cargo_actual"): 5}
    largo = "T" * 45

    plan = construir_plan({"alertas_tempranas": [alerta(titulo=largo)]}, ctx_minimo)

    datos = inserciones_de(plan, "alertas_tempranas")[0].datos
    assert datos["titulo"] == largo
    assert not any("titulo recortado" in aviso for aviso in plan.advertencias)


def test_recorte_respeta_la_ultima_palabra_cuando_esta_avanzada(ctx_minimo):
    ctx_minimo.longitudes = {("alertas_tempranas", "titulo"): 20}
    titulo = "Tala ilegal en la cuenca del Chira"

    plan = construir_plan({"alertas_tempranas": [alerta(titulo=titulo)]}, ctx_minimo)

    datos = inserciones_de(plan, "alertas_tempranas")[0].datos
    assert datos["titulo"] == "Tala ilegal en la"
    assert len(datos["titulo"]) <= 20


def test_demanda_duplicada_por_contenido_se_omite(ctx_minimo):
    ctx_minimo.duplicados = {
        "demandas": {LEGADO_DEMANDA: "ya existe en AT-2026-18: misma descripción"}
    }
    hojas = {
        "alertas_tempranas": [alerta()],
        "demandas": [demanda_de_alerta()],
    }

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "demandas") == []
    omisiones = omisiones_de(plan, "demandas")
    assert len(omisiones) == 1
    assert omisiones[0].motivo == "ya existe en AT-2026-18: misma descripción"


def test_alerta_fusionada_inserta_sus_hijos_y_no_la_alerta(ctx_minimo):
    ctx_minimo.existentes = {"alertas_tempranas": {LEGADO_ALERTA: "id-existente"}}
    ctx_minimo.duplicados_ids = {"alertas_tempranas": {LEGADO_ALERTA: "id-existente"}}
    hojas = {
        "alertas_tempranas": [alerta()],
        "alerta_hechos": [hecho()],
        "alertas_actores": [actor_de_alerta()],
        "demandas": [demanda_de_alerta()],
    }

    plan = construir_plan(hojas, ctx_minimo)

    assert inserciones_de(plan, "alertas_tempranas") == []
    assert len(inserciones_de(plan, "alerta_hechos")) == 1
    assert len(inserciones_de(plan, "alertas_actores")) == 1
    assert len(inserciones_de(plan, "demandas")) == 1
    assert inserciones_de(plan, "demandas")[0].datos["alerta_ref"] == LEGADO_ALERTA


def test_alerta_fusionada_no_reintroduce_la_omision_por_padre(ctx_minimo):
    ctx_minimo.existentes = {"alertas_tempranas": {LEGADO_ALERTA: "id-existente"}}
    ctx_minimo.duplicados = {}

    plan = construir_plan({"demandas": [demanda_de_alerta()]}, ctx_minimo)

    assert len(inserciones_de(plan, "demandas")) == 1
    assert omisiones_de(plan, "demandas") == []
