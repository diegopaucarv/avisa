"""Verifica cada decisión cerrada contra el workbook real del legado.

No toca la base: comprueba que las reglas de `migration/decisions.py` producen
exactamente las cifras del acta de cierre de `docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md`.
Si algo cambia en el origen, este archivo es el que avisa.

Uso: python migration/test_decisions.py          (o pytest migration/)
"""

import collections
import sys

import decisions as d

WB = d.load_workbook()

FALLOS = []


def check(nombre, obtenido, esperado):
    if obtenido == esperado:
        print(f"  ok   {nombre}: {obtenido}")
    else:
        FALLOS.append(nombre)
        print(f"  FAIL {nombre}: obtenido={obtenido!r} esperado={esperado!r}")


# -----------------------------------------------------------------------------
# (a) / §2.1  Geografía: padding de Cod_INEI, 25 regiones, DEP-20 fuera
# -----------------------------------------------------------------------------
def test_geografia():
    print("\n[geografía] 25 regiones / padding INEI")
    h, provincias = d.sheet_rows(WB, "DIM_Provincias")
    i_cod = d.col_index(h, "Cod_INEI")
    ubigeos = [d.provincia_ubigeo(r[i_cod]) for r in provincias]
    check("provincias", len(provincias), 70)
    check("ubigeos provincia de 4 dígitos", sum(len(u) == 4 for u in ubigeos), 70)
    check("ubigeos provincia distintos", len(set(ubigeos)), 70)

    hd, distritos = d.sheet_rows(WB, "DIM_Distritos")
    i_cod_d = d.col_index(hd, "Cod_INEI")
    dub = [d.distrito_ubigeo(r[i_cod_d]) for r in distritos]
    check("distritos", len(distritos), 698)
    check("ubigeos distrito de 6 dígitos", sum(len(u) == 6 for u in dub), 698)
    check("ubigeos distrito distintos", len(set(dub)), 698)

    prov_set = set(ubigeos)
    huerfanos = [u for u in dub if u[:4] not in prov_set]
    check("distritos con provincia inexistente", len(huerfanos), 0)

    region_map = d.build_region_map(WB)
    check("regiones derivadas", len(set(region_map.values())), 25)
    check("DEP-20 excluido", "DEP-20" in region_map, False)
    check("DEP-15 -> 15", d.region_ubigeo_from_provincia("1501"), "15")
    check("DEP-16 -> 15 (fusión)", d.region_ubigeo_from_provincia("1502"), "15")
    check("Loreto province 1601 -> 16", d.region_ubigeo_from_provincia("1601"), "16")


# -----------------------------------------------------------------------------
# (h) nivel_conflicto desde DIM_Tipo_Caso
# -----------------------------------------------------------------------------
def test_nivel_conflicto():
    print("\n[(h)] nivel_conflicto desde DIM_Tipo_Caso")
    check("TC-01 -> 1", d.map_nivel_conflicto("TC-01"), 1)
    check("TC-02 -> 2", d.map_nivel_conflicto("TC-02"), 2)
    check("TC-03 -> 3", d.map_nivel_conflicto("TC-03"), 3)
    check("TC-04 -> 4", d.map_nivel_conflicto("TC-04"), 4)

    h, casos = d.sheet_rows(WB, "FACT_Casos")
    i_tc = d.col_index(h, "ID_Tipo")
    con = [r[0] for r in casos if d.map_nivel_conflicto(r[i_tc]) is not None]
    sin = [r[0] for r in casos if d.map_nivel_conflicto(r[i_tc]) is None]
    check("casos con nivel", len(con), 34)
    check("caso sin nivel", sin, ["CS-PRODUCE-2026-024"])


# -----------------------------------------------------------------------------
# D48 / D27  riesgo del caso cuando falta ID_Riesgos
# -----------------------------------------------------------------------------
def test_riesgo_caso():
    print("\n[D48] riesgo del caso 016 desde sus alertas")
    h, casos = d.sheet_rows(WB, "FACT_Casos")
    i_caso, i_rie, i_pri = (
        d.col_index(h, "ID_Caso"),
        d.col_index(h, "ID_Riesgos"),
        d.col_index(h, "Prioridad"),
    )
    sin_rie = [r for r in casos if not r[i_rie]]
    check("casos sin ID_Riesgos", [r[i_caso] for r in sin_rie], ["CS-PRODUCE-2026-016"])

    ha, alertas = d.sheet_rows(WB, "DIM_Alertas")
    i_cv, i_rie_a = d.col_index(ha, "ID_Caso_Vinculado"), d.col_index(ha, "ID_Riesgos")
    riesgos = [r[i_rie_a] for r in alertas if r[i_cv] == "CS-PRODUCE-2026-016"]
    check("alertas vinculadas al caso 016", len(riesgos), 7)
    check(
        "riesgos de esas alertas",
        collections.Counter(riesgos),
        collections.Counter({"RIE-001": 4, "RIE-002": 3}),
    )
    check("moda -> RIE-001 (mayor severidad)", d.map_nivel_riesgo("RIE-001"), 3)

    fila = sin_rie[0]
    nivel, origen, conf = d.resolve_nivel_riesgo_caso(fila[i_rie], fila[i_pri], riesgos)
    check("nivel_riesgo resultante", nivel, 3)
    check("origen", origen, "alerta_vinculada")
    check("confidence", conf, 0.90)

    # y el camino directo sigue mandando cuando hay dato
    check(
        "directo manda",
        d.resolve_nivel_riesgo_caso("RIE-002", "Urgente", ["RIE-001"]),
        (2, "legado_directo", 1.00),
    )
    check("RIE-001 -> 3 (Alto)", d.map_nivel_riesgo("RIE-001"), 3)


# -----------------------------------------------------------------------------
# D47  prioridad de alerta desconocida -> NULL
# -----------------------------------------------------------------------------
def test_prioridad_alerta():
    print("\n[D47] prioridad de alerta")
    check("NA-001 -> 1", d.map_prioridad_alerta("NA-001"), 1)
    check("NA-004 -> 4", d.map_prioridad_alerta("NA-004"), 4)
    check("sin nivel -> None", d.map_prioridad_alerta(None), None)

    h, alertas = d.sheet_rows(WB, "DIM_Alertas")
    i_na = d.col_index(h, "ID_NIVEL_ALERTA")
    sin = sorted(r[0] for r in alertas if d.map_prioridad_alerta(r[i_na]) is None)
    check("alertas sin prioridad", sin, ["AT-2026-59", "AT-2026-80"])
    check("alertas totales", len(alertas), 83)


# -----------------------------------------------------------------------------
# D25  especies
# -----------------------------------------------------------------------------
def test_especies():
    print("\n[D25] cat_especies")
    _, filas = d.sheet_rows(WB, "DIM_Recurso_Pesca")
    check("recursos del legado", len(filas), 37)
    legacy = []
    for r in filas:
        legacy.append((r[0], r[1], r[2], r[3], r[4], r[5]))
    res = d.reconcile_especies(legacy)
    check("total tras carga", res["total"], 39)
    check("especies nuevas", len(res["nuevas"]), 34)
    check("reutilizadas", len(legacy) - len(res["nuevas"]), 3)
    check("RECU-008 -> 15 (Tiburón azul)", res["mapping"]["RECU-008"], 15)
    check("RECU-025 -> 11 (Trucha arcoíris)", res["mapping"]["RECU-025"], 11)
    check("RECU-009 -> 12 (Tiburón martillo, común)", res["mapping"]["RECU-009"], 12)
    check("conflicto científico registrado", len(res["conflictos"]), 1)
    check(
        "conflicto = Sphyrna zygaena vs lewini",
        res["conflictos"][0]["nombre_cientifico_legado"],
        "Sphyrna zygaena",
    )
    check(
        "ids nuevos no colisionan",
        min(e["id"] for e in res["nuevas"]) > 15,
        True,
    )


# -----------------------------------------------------------------------------
# D44 / D45 / D31  demandas: padre real y unión con el bridge
# -----------------------------------------------------------------------------
def _pares():
    h, demandas = d.sheet_rows(WB, "DIM_Demandas")
    i_caso, i_al = d.col_index(h, "ID_CASO"), d.col_index(h, "ID_ALERTA")
    col = {
        (r[0], r[i_al])
        for r in demandas
        if d.clasificar_padre_demanda(r[i_al]) == "alerta"
    }
    hb, bridge = d.sheet_rows(WB, "BRIDGE_Alerta_Demandas")
    i_b_dem, i_b_al = d.col_index(hb, "ID_DEMANDA"), d.col_index(hb, "ID_ALERTA")
    bri = {(r[i_b_dem], r[i_b_al]) for r in bridge}
    _, alertas = d.sheet_rows(WB, "DIM_Alertas")
    existentes = {r[0] for r in alertas}
    return demandas, i_caso, i_al, col, bri, existentes


def test_demandas_padres():
    print("\n[D44] qué contiene DIM_Demandas.ID_ALERTA")
    demandas, i_caso, i_al, col, _bri, _existentes = _pares()
    check("demandas", len(demandas), 325)
    tipos = collections.Counter(d.clasificar_padre_demanda(r[i_al]) for r in demandas)
    check("AT-xxxx (alerta)", tipos["alerta"], 236)
    check("CS-xxxx (serie anterior)", tipos["caso"], 6)
    check("RR-xxxx (reporte rápido)", tipos["reporte"], 5)
    check("basura", tipos["basura"], 1)
    check("vacías", tipos["vacio"], 77)
    check("suma", sum(tipos.values()), 325)
    check("pares de columna", len(col), 236)

    resueltos = [
        r[0] for r in demandas if r[i_caso] and d.RE_CASO_LARGO.match(r[i_caso])
    ]
    parkeados = [
        r[i_caso]
        for r in demandas
        if r[i_caso] and not d.RE_CASO_LARGO.match(r[i_caso])
    ]
    check("demandas con caso resoluble", len(resueltos), 99)
    check("demandas con caso parkeado", parkeados, ["CS-2026-07"])


def test_union_alerta_demanda():
    print("\n[D45] unión columna + bridge")
    _, _, _, col, bri, existentes = _pares()
    finales, descartados, st = d.union_alerta_demanda(col, bri, existentes)
    check("bridge", st["bridge"], 231)
    check("columna", st["columna"], 236)
    check("unión", st["union"], 247)
    check("intersección", st["interseccion"], 220)
    check("sólo columna", st["solo_columna"], 16)
    check("sólo bridge (conflictos)", st["solo_bridge"], 11)
    check("descartados por alerta inexistente", st["descartados"], 14)
    check("pares con alerta existente", st["validos"], 233)
    check("demandas con alerta_id asignada", st["asignados"], 222)
    check("conflictos resueltos a favor del bridge", st["conflictos"], 11)
    alertas_desc = {a for _, a in descartados}
    check(
        "alertas fantasma",
        sorted(alertas_desc),
        ["AT-2026-19", "AT-2026-24", "AT-2026-27", "AT-2026-34", "AT-2026-39"],
    )
    check("una alerta por demanda", len({p[0] for p in finales}), len(finales))
    check("demandas distintas con alerta", len({p[0] for p in finales}), 222)


# -----------------------------------------------------------------------------
# D43  DNI compartidos
# -----------------------------------------------------------------------------
def test_dni():
    print("\n[D43] DNI no único")
    h, actores = d.sheet_rows(WB, "DIM_Actores")
    i_dni = d.col_index(h, "DNI")
    dnis = [d.normalize_dni(r[i_dni]) for r in actores]
    dnis = [x for x in dnis if x]
    c = collections.Counter(dnis)
    dup = {k: n for k, n in c.items() if n > 1}
    check("actores", len(actores), 828)
    check("DNI no nulos", len(dnis), 642)
    check("DNI distintos", len(set(dnis)), 587)
    check("valores DNI en conflicto", len(dup), 45)
    check("filas implicadas", sum(dup.values()), 100)
    check(
        "no se fusiona: dos personas distintas comparten DNI",
        d.normalize_dni("N/D"),
        None,
    )

    hn, estado = d.sheet_rows(WB, "DIM_Actores_Estado")
    i_dni_e = d.col_index(hn, "DNI")
    crudos = {r[i_dni_e] for r in estado}
    check("censo Estado sin DNI real", crudos, {"N/D"})
    check("'N/D' normaliza a None", {d.normalize_dni(x) for x in crudos}, {None})


# -----------------------------------------------------------------------------
# D23  bridges actor<->caso por ordinal
# -----------------------------------------------------------------------------
def test_bridges():
    print("\n[D23] bridges actor<->caso")
    _, casos = d.sheet_rows(WB, "FACT_Casos")
    codigos = [r[0] for r in casos]

    for hoja, esperado, col in [
        ("BRIDGE_Caso_Actor", 62, 2),
        ("BRIDGE_Caso_Actor_Estado", 45, 2),
    ]:
        _, filas = d.sheet_rows(WB, hoja)
        ok = 0
        metodos = collections.Counter()
        for r in filas:
            cod, metodo = d.resolve_case_ref(r[col], codigos)
            metodos[metodo] += 1
            if cod:
                ok += 1
        check(f"{hoja} recuperables", ok, esperado)
        check(f"{hoja} filas", len(filas), 80 if hoja == "BRIDGE_Caso_Actor" else 61)
        check(f"{hoja} ordinales en rango", metodos["ordinal"], 34)

    check(
        "ordinal 1 -> primer caso",
        d.resolve_case_ref("1", codigos),
        ("CS-PRODUCE-2026-001", "ordinal"),
    )
    check(
        "ordinal fuera de rango",
        d.resolve_case_ref("99", codigos),
        (None, "ordinal_fuera_de_rango"),
    )
    check(
        "código largo",
        d.resolve_case_ref("CS-PRODUCE-2026-005", codigos),
        ("CS-PRODUCE-2026-005", "codigo"),
    )


# -----------------------------------------------------------------------------
# D45  tipo de actor
# -----------------------------------------------------------------------------
def test_tipo_actor():
    print("\n[D45] tipo_actor_id por defecto = 2 (Sociedad Civil)")
    check("Tipo-Act-01 -> 1 Estado", d.map_tipo_actor("Tipo-Act-01"), 1)
    check("Tipo-Act-02 -> 2 Sociedad Civil", d.map_tipo_actor("Tipo-Act-02"), 2)
    check("Tipo-Act-03 -> 3 Privado", d.map_tipo_actor("Tipo-Act-03"), 3)
    check("vacío -> 2 (no 1)", d.map_tipo_actor(None), 2)
    check("basura 'Regional' -> 2", d.map_tipo_actor("Regional"), 2)
    check("censo Estado -> 1", d.map_tipo_actor(None, es_censo_estado=True), 1)

    h, actores = d.sheet_rows(WB, "DIM_Actores")
    i_tipo = d.col_index(h, "ID_Tipo_Actor")
    dist = collections.Counter(d.map_tipo_actor(r[i_tipo]) for r in actores)
    check("distribución", dict(sorted(dist.items())), {2: 819, 3: 9})

    check("rol: Actor Primario -> 1", d.map_rol_actor("Actor Primario"), 1)
    check("rol: vacío -> 7", d.map_rol_actor(None), 7)
    check("nivel_gobierno basura -> None", d.map_nivel_gobierno("Perfil-01"), None)
    check("nivel_gobierno Local", d.map_nivel_gobierno("Local"), "local")


# -----------------------------------------------------------------------------
# D46  capacitaciones huérfanas
# -----------------------------------------------------------------------------
def test_capacitaciones():
    print("\n[D46] participantes sin ID_Capacitacion")
    _, caps = d.sheet_rows(WB, "DIM_Capacitaciones")
    check("capacitaciones", len(caps), 1)
    check("código", caps[0][0], "CAP-2026-001")

    hb, part = d.sheet_rows(WB, "BRIDGE_Capacitacion_Participant")
    i_cap = d.col_index(hb, "ID_Capacitacion")
    sin = [r for r in part if not r[i_cap]]
    check("participantes", len(part), 9)
    check("sin capacitacion explicita", len(sin), 8)
    check(
        "candidato único -> asignables",
        len({c[0] for c in caps}) == 1,
        True,
    )


# -----------------------------------------------------------------------------
# D37  mesas
# -----------------------------------------------------------------------------
def test_mesas():
    print("\n[(f)] mesas de diálogo")
    h, mesas = d.sheet_rows(WB, "DIM_MESAS_GRUPOS")
    check("mesas", len(mesas), 21)
    check("códigos distintos", len({r[0] for r in mesas}), 21)
    i_est = d.col_index(h, "ESTADO_VIGENCIA")
    est = collections.Counter(r[i_est] for r in mesas)
    check("'Sin fecha' en estado_vigencia", est["Sin fecha"], 2)
    i_fin = d.col_index(h, "FECHA_FIN_VIGENCIA")
    check(
        "'Sin fecha' textual en fecha_fin",
        sum(1 for r in mesas if r[i_fin] and not d.parse_fecha(r[i_fin])),
        0,
    )
    i_nat = d.col_index(h, "NATURALEZA")
    check(
        "naturalezas válidas",
        {r[i_nat] for r in mesas} <= {"Permanente", "Temporal", "No definida"},
        True,
    )


# -----------------------------------------------------------------------------
# Fechas, porcentajes, teléfonos
# -----------------------------------------------------------------------------
def test_transformaciones():
    print("\n[transformaciones]")
    check("fecha con hora", d.parse_fecha("2026-07-15 22:00:00"), "2026-07-15")
    check("fecha sin hora", d.parse_fecha("2026-01-16"), "2026-01-16")
    check("texto no fecha", d.parse_fecha("Sin fecha"), None)
    check("vacío", d.parse_fecha(None), None)

    check("pct 0.9", d.normalize_pct("0.9"), 90)
    check("pct 0", d.normalize_pct("0"), 0)
    check("pct 70 ya en escala", d.normalize_pct("70"), 70)

    check(
        "tel celular 9 dígitos", d.normalize_telefono("987 436 598")[0], "+51987436598"
    )
    check(
        "tel con caracteres invisibles",
        d.normalize_telefono("984\xa0048\xa0718\u202c")[0],
        "+51984048718",
    )
    check("fijo 8 dígitos no se adivina", d.normalize_telefono("43848392")[0], None)
    check("tel raw se conserva", d.normalize_telefono("43848392")[1], "43848392")
    check("tel N/D", d.normalize_telefono("N/D"), (None, None))

    h, casos = d.sheet_rows(WB, "FACT_Casos")
    i_pct = d.col_index(h, "Pct_Avance")
    valores = {d.normalize_pct(r[i_pct]) for r in casos if r[i_pct] is not None}
    check("pct del legado", valores, {0, 70, 80, 90})


# -----------------------------------------------------------------------------
# (c)  hojas/columnas que el plan no cubría
# -----------------------------------------------------------------------------
def test_hojas_no_cubiertas():
    print("\n[(c)] hojas y totales")
    _, orgs = d.sheet_rows(WB, "DIM_ORGANIZACION")
    check("organizaciones", len(orgs), 224)
    ho, o = d.sheet_rows(WB, "DIM_ORGANIZACION")
    i_ruc = d.col_index(ho, "RUC")
    rucs = [r[i_ruc] for r in o if r[i_ruc]]
    check("RUC no nulos", len(rucs), 5)
    check("RUC distintos (UNIQUE ok)", len(set(rucs)), 5)
    check("RUC de 11 dígitos", all(len(x) == 11 for x in rucs), True)

    _, bcd = d.sheet_rows(WB, "BRIDGE_Caso_Demandas")
    check("BRIDGE_Caso_Demandas filas (redundante con columna)", len(bcd), 12)

    _, sectoristas = d.sheet_rows(WB, "DIM_Sectoristas")
    _, pf = d.sheet_rows(WB, "DIM_Punto_Focal")
    _, aut = d.sheet_rows(WB, "DIM_Autoridades")
    check("usuarios crudos (15+17+2)", len(sectoristas) + len(pf) + len(aut), 34)


def main():
    for fn in [
        test_geografia,
        test_nivel_conflicto,
        test_riesgo_caso,
        test_prioridad_alerta,
        test_especies,
        test_demandas_padres,
        test_union_alerta_demanda,
        test_dni,
        test_bridges,
        test_tipo_actor,
        test_capacitaciones,
        test_mesas,
        test_transformaciones,
        test_hojas_no_cubiertas,
    ]:
        fn()

    print("\n" + "=" * 60)
    if FALLOS:
        print(f"FALLARON {len(FALLOS)} comprobaciones: {FALLOS}")
        return 1
    print("Todas las comprobaciones pasaron.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
