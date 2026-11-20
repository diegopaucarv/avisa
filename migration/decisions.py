"""Reglas ejecutables del cierre de decisiones legado AVISA 2026 -> v9.

Este módulo es la forma *ejecutable* de `docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md`: cada
función implementa una decisión cerrada, sin acceder a la base. El cargador
importa estas funciones; `migration/test_decisions.py` las verifica contra el
workbook real.

Regla de oro del cierre: **el legado sólo se transforma, no se inventa**. Cuando
v9 exige un NOT NULL que el legado no tiene, la columna se relaja (parches 1 y 3)
salvo que exista una fuente autoritativa externa (D26: unidad OAIPCS).

Uso: python migration/decisions.py
"""

import os
import re
import unicodedata

import openpyxl

XLSX = os.path.join(
    os.path.dirname(__file__), "..", "backend", "BASE_CONFLICTOS_SOCIALES_2026.xlsx"
)

# =============================================================================
# 1. LECTURA POSICIONAL DEL LEGADO
#    Nunca por nombre: los encabezados vienen mutilados ('descripcin',
#    'situacin', 'DIM_Unidades_Organicas_Responsa') y hay hojas con las
#    columnas corridas (BRIDGE_Caso_Depto, LOG_Envios).
# =============================================================================


def text(value):
    """Normaliza una celda a texto o None. 222.0 -> '222' (no '222.0')."""
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    s = str(value).strip()
    return s or None


def sheet_rows(wb, name):
    """(header, filas) con filas y header rellenados al ancho máximo."""
    ws = wb[name]
    raw = [r for r in ws.iter_rows(values_only=True)]
    raw = [r for r in raw if any(x is not None and str(x).strip() != "" for x in r)]
    if not raw:
        return [], []
    width = max(len(r) for r in raw)
    header_row = raw[0]
    header = [
        text(header_row[i]) if i < len(header_row) else None for i in range(width)
    ]
    data = [[text(x) for x in (list(r) + [None] * (width - len(r)))] for r in raw[1:]]
    return header, data


def load_workbook():
    return openpyxl.load_workbook(XLSX, read_only=True, data_only=True)


def col_index(header, name):
    """Índice posicional de una columna por nombre, tolerante a None."""
    for i, h in enumerate(header):
        if h == name:
            return i
    raise KeyError(f"columna {name!r} no existe en {header}")


# =============================================================================
# 2. CATÁLOGOS (IDs verificados en core.* del contenedor avisa-v9-test)
# =============================================================================

# DIM_Tipo_Caso ES la escala de 4 niveles de la Guía (decisión B/h). No se
# confunde con DIM_Tipo_Cambio, que reusa los mismos códigos TC-xx.
NIVEL_CONFLICTO = {"TC-01": 1, "TC-02": 2, "TC-03": 3, "TC-04": 4}

# RIE-001 Alto / RIE-002 Moderado / RIE-003 Bajo
NIVEL_RIESGO = {"RIE-001": 3, "RIE-002": 2, "RIE-003": 1}

PRIORIDAD_CASO = {"urgente": 1, "moderado": 2, "bajo": 3}

# NA-001 Critica_Inmediata ... NA-004 Seguimiento
PRIORIDAD_ALERTA = {"NA-001": 1, "NA-002": 2, "NA-003": 3, "NA-004": 4}

ESTADO_HITO = {"cumplido": 4, "en curso": 2, "en ejecucion": 2, "no cumplido": 1}

# core.cat_tipos_actor (parche 1): 1 Estado, 2 Sociedad Civil, 3 Privado.
TIPO_ACTOR = {"tipo-act-01": 1, "tipo-act-02": 2, "tipo-act-03": 3}
TIPO_ACTOR_ESTADO = 1  # censo de funcionarios públicos
TIPO_ACTOR_DEFAULT = 2  # ver D45: NO 1 (Actor del Estado)

# core.cat_roles_actor: 1 Principal, 2 Secundario, 3 Tercero, 7 No_determinado
ROL_ACTOR = {"actor primario": 1, "actor secundario": 2}
ROL_ACTOR_DEFAULT = 7

NIVEL_GOBIERNO_VALIDOS = {
    "nacional",
    "regional",
    "local",
    "empresa",
    "sociedad_civil",
}

# Semilla real de core.cat_especies en v9 (verificada en el contenedor).
ESPECIES_SEED = [
    (11, "Trucha arcoíris", "Oncorhynchus mykiss"),
    (12, "Tiburón martillo", "Sphyrna lewini"),
    (13, "Tiburón zorro", "Alopias vulpinus"),
    (14, "Tiburón ballena", "Rhincodon typus"),
    (15, "Tiburón azul", "Prionace glauca"),
]

# =============================================================================
# 3. NORMALIZACIÓN Y MAPEO DE CATÁLOGOS
# =============================================================================


def norm_key(value):
    """minúsculas, sin acentos, espacios colapsados. Para comparar categorías."""
    if value is None:
        return None
    s = unicodedata.normalize("NFKD", str(value))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s).strip().lower()


def map_code(value, table):
    """Mapea un código exacto ('TC-03', 'RIE-001') a su id v9, o None."""
    if not value:
        return None
    k = str(value).strip()
    return table.get(k.upper()) or table.get(k) or table.get(norm_key(k))


def map_nivel_conflicto(tc_code):
    """DIM_Tipo_Caso -> core.cat_niveles_conflicto (decisión h).

    Es la escala normativa de la Guía (RM 00207-2026-PRODUCE), no una
    inferencia: 34/35 casos traen TC-xx. El que no lo trae queda NULL (b).
    NO se deriva de ID_Riesgos ni de ID_NIVEL_ALERTA: son ejes distintos.
    """
    return map_code(tc_code, NIVEL_CONFLICTO)


def map_nivel_riesgo(rie_code):
    """DIM_Riesgos -> cat_niveles_riesgo. 'Moderado ' trae espacio final."""
    if not rie_code:
        return None
    return map_code(str(rie_code).strip(), NIVEL_RIESGO)


def map_prioridad_caso(prioridad):
    return map_code(norm_key(prioridad), PRIORIDAD_CASO)


def map_prioridad_alerta(na_code):
    """NA-001..004 -> prioridad. None si el legado no trae nivel (D47)."""
    return map_code(na_code, PRIORIDAD_ALERTA)


def map_estado_hito(value):
    return map_code(norm_key(value), ESTADO_HITO)


def map_tipo_actor(value, es_censo_estado=False):
    """D45: el default del censo civil es 2 (Sociedad Civil), no 1 (Estado).

    92 % de los actores tipados son Tipo-Act-02; los 575 sin tipo pertenecen a
    la misma población (pescadores, dirigentes). Etiquetarlos 'Actor del
    Estado' sería una afirmación falsa.
    """
    if es_censo_estado:
        return TIPO_ACTOR_ESTADO
    return map_code(norm_key(value), TIPO_ACTOR) or TIPO_ACTOR_DEFAULT


def map_rol_actor(categoria):
    """'Actor Primario'->1, 'Actor Secundario'->2, resto->7 No_determinado."""
    return map_code(norm_key(categoria), ROL_ACTOR) or ROL_ACTOR_DEFAULT


def map_nivel_gobierno(value):
    """CHECK cerrado en v9. Basura ('Perfil-01', 'Sí') -> None (D12)."""
    k = norm_key(value)
    if k is None:
        return None
    return k if k in NIVEL_GOBIERNO_VALIDOS else None


def normalize_dni(value):
    """D46: 'N/D' es ausencia, no un DNI. Conserva ceros a la izquierda."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or norm_key(s) in ("n/d", "nd", "sin dni", "no tiene"):
        return None
    return s


def normalize_telefono(raw):
    """Normaliza a E.164 SÓLO cuando no hay que adivinar.

    Del legado: 473 de 508 teléfonos son 9 dígitos (celular peruano 9xxxxxxxx)
    -> '+51XXXXXXXXX'. Los otros son fijos de 7–8 dígitos SIN código de área
    (Lima 4xxxxxxx coincide, pero los actores son de Piura, Ancash, etc.), así
    que prefijar '+511' inventaría la procedencia: se dejan sólo en
    telefono_raw.

    Devuelve (telefono_contacto|None, telefono_raw|None). El raw nunca se
    pierde.
    """
    if not raw:
        return None, None
    raw = str(raw).strip()
    if norm_key(raw) in ("n/d", "nd", "sin telefono"):
        return None, None
    # \D también elimina NBSP (\xa0) y marcas direccionales (\u202c) que el
    # legado arrastra ('984\xa0048\xa0718\u202c').
    digits = re.sub(r"\D", "", re.sub(r"\.0+$", "", raw))
    if len(digits) == 9:
        return "+51" + digits, raw
    if len(digits) == 11 and digits.startswith("51"):
        return "+" + digits, raw
    return None, raw


def normalize_pct(value):
    """D6/D40: el legado guarda fracción (0.7) -> 70. CHECK v9 0..100."""
    if value is None or str(value).strip() == "":
        return None
    v = float(str(value).replace(",", "."))
    return round(v * 100) if v <= 1 else round(v)


def boolean_si_no(value, default_when_null=None):
    k = norm_key(value)
    if k in ("si", "s", "true", "1"):
        return True
    if k in ("no", "n", "false", "0"):
        return False
    return default_when_null


RE_FECHA = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?")


def parse_fecha(value):
    """'2026-07-15 22:00:00' -> '2026-07-15'. Sin conversión de zona horaria.

    El legado guarda datetimes *naive* (hora local de la hoja) y hay marcas a
    las 01:04 o 22:34. Convertir desde UTC desplazaría el día en los extremos;
    copiar la parte de fecha es la lectura fiel y no inventa nada.

    Devuelve None si la celda está vacía o no es una fecha ISO.
    """
    if not value:
        return None
    m = RE_FECHA.match(str(value).strip())
    return m.group(1) if m else None


def parse_hora(value):
    """'2026-07-15 22:34:00' -> '22:34'. Para columnas TIMESTAMPTZ."""
    if not value:
        return None
    m = RE_FECHA.match(str(value).strip())
    if not m:
        return None
    return f"{m.group(2)}:{m.group(3)}" if m.group(2) else None


# =============================================================================
# 4. GEOGRAFÍA (corrección §2.1 + padding de Cod_INEI, hallazgo del cierre)
# =============================================================================


def provincia_ubigeo(cod_inei):
    """DIM_Provincias.Cod_INEI viene sin ceros a la izquierda: '101' -> '0101'."""
    return str(cod_inei).strip().zfill(4)


def distrito_ubigeo(cod_inei):
    """DIM_Distritos.Cod_INEI: '10101' -> '010101'."""
    return str(cod_inei).strip().zfill(6)


def region_ubigeo_from_provincia(cod_inei):
    """v9 regiones.ubigeo = prefijo INEI de la provincia, jamás Codigo_Depto."""
    return provincia_ubigeo(cod_inei)[:2]


# 'Más de Uno' no es una región: no tiene provincias ni distritos (D28).
DEPARTAMENTOS_NO_REGION = {"DEP-20"}


def build_region_map(wb):
    """{DEP-xx -> ubigeo de región}.

    Se deriva SÓLO de las provincias. Consecuencia buscada: DEP-15 (Lima) y
    DEP-16 (Lima Provincias) caen ambas en '15' y se fusionan, porque
    core.regiones.ubigeo es UNIQUE. DEP-20 queda fuera del mapa.
    """
    header, rows = sheet_rows(wb, "DIM_Provincias")
    i_dep = col_index(header, "ID_Ubigeo")
    i_cod = col_index(header, "Cod_INEI")
    mapping = {}
    for row in rows:
        dep = row[i_dep]
        if dep in DEPARTAMENTOS_NO_REGION:
            continue
        region = region_ubigeo_from_provincia(row[i_cod])
        prev = mapping.setdefault(dep, region)
        if prev != region:
            raise ValueError(f"{dep} apunta a dos regiones INEI: {prev} y {region}")
    return mapping


# =============================================================================
# 5. REFERENCIAS ENTRE CASOS
# =============================================================================


def resolve_case_ref(ref, caso_codigos, n_casos=None, por_ordinal=True):
    """Resuelve una referencia de caso. Devuelve (codigo|None, metodo).

    metodo: 'codigo' | 'ordinal' | 'vacio' | 'ordinal_fuera_de_rango' |
            'codigo_inexistente'.

    D23: las referencias numéricas de BRIDGE_Caso_Actor* son ordinales
    posicionales de FACT_Casos. Es una inferencia (34/34 caen en rango y ningún
    caso la documenta), por eso el cargador la marca con confidence=0.75 y
    es_validado_humano=false.
    """
    codigos = list(caso_codigos)
    if ref is None or str(ref).strip() == "":
        return None, "vacio"
    s = str(ref).strip()
    if por_ordinal and re.fullmatch(r"\d+(\.0+)?", s):
        idx = int(float(s))
        if 1 <= idx <= len(codigos):
            return codigos[idx - 1], "ordinal"
        return None, "ordinal_fuera_de_rango"
    if s in set(codigos):
        return s, "codigo"
    return None, "codigo_inexistente"


# =============================================================================
# 6. ESPECIES (D25)
# =============================================================================


def reconcile_especies(legacy_rows, seed=None):
    """Resuelve DIM_Recurso_Pesca contra core.cat_especies.

    Prioridad de match: nombre científico exacto -> nombre común exacto (que es
    UNIQUE en v9) -> especie nueva.

    Los 3 casos reales:
      RECU-008 Tiburón azul / Prionace glauca      -> id 15 (científico)
      RECU-025 Trucha / Oncorhynchus mykiss        -> id 11 (científico)
      RECU-009 Tiburón martillo / Sphyrna zygaena  -> id 12 (común; el nombre
        científico discrepa y NO puede insertarse otro 'Tiburón martillo'
        porque nombre_comun es UNIQUE) -> se registra conflicto.

    Devuelve dict con 'mapping' (codigo_legado -> id), 'nuevas' (filas),
    'conflictos' (filas) y 'total'.
    """
    seed = seed or ESPECIES_SEED
    por_cientifico = {norm_key(c): i for i, _, c in seed if c}
    por_comun = {norm_key(n): i for i, n, _ in seed}
    ids_usados = {i for i, _, _ in seed}
    siguiente = max(ids_usados) + 1

    mapping, nuevas, conflictos = {}, [], []
    for codigo, comun, cientifico, familia, grupo, ambito in legacy_rows:
        cien = norm_key(cientifico)
        com = norm_key(comun)
        if cien and cien in por_cientifico:
            mapping[codigo] = por_cientifico[cien]
        elif com and com in por_comun:
            mapping[codigo] = por_comun[com]
            conflictos.append(
                {
                    "codigo_legado": codigo,
                    "especie_id": por_comun[com],
                    "nombre_comun": comun,
                    "nombre_cientifico_legado": cientifico,
                }
            )
        else:
            especie_id = siguiente
            siguiente += 1
            mapping[codigo] = especie_id
            nuevas.append(
                {
                    "id": especie_id,
                    "codigo_legado": codigo,
                    "nombre_comun": comun,
                    "nombre_cientifico": cientifico,
                    "familia": familia,
                    "grupo_biologico": grupo,
                    "ambito": ambito,
                }
            )
    return {
        "mapping": mapping,
        "nuevas": nuevas,
        "conflictos": conflictos,
        "total": len(seed) + len(nuevas),
    }


# =============================================================================
# 7. ALERTA <-> DEMANDA (D31 / D44 / D45) y RIESGO DEL CASO (D48)
# =============================================================================

RE_ALERTA = re.compile(r"^AT-\d{4}-\d+$")
RE_CASO_LARGO = re.compile(r"^CS-PRODUCE-\d{4}-\d{3}$")
RE_ALERTA_CANON = re.compile(r"^(AT-\d{4})-0*(\d+)$")


def canon_alerta(valor):
    """Normaliza el relleno de un código de alerta: `AT-2026-001` -> `AT-2026-01`.

    `DIM_Alertas` usa dos dígitos y los bridges mezclan dos y tres. Sin esta
    canonización, 16 vínculos de `BRIDGE_Alerta_Actor` no resolverían.
    """
    if not valor:
        return None
    s = str(valor).strip()
    m = RE_ALERTA_CANON.match(s)
    if not m:
        return s
    return f"{m.group(1)}-{int(m.group(2)):02d}"


def clasificar_padre_demanda(valor):
    """Distingue lo que DIM_Demandas.ID_ALERTA realmente contiene (D44).

    'alerta'   AT-2026-xx
    'caso'     CS-2026-xx (serie anterior; no resuelve, D19)
    'reporte'  RR-2026-01 (-> documentos, reporte rápido)
    'basura'   cualquier otra cosa (p. ej. 'TEMA-03')
    'vacio'    None
    """
    if not valor:
        return "vacio"
    s = str(valor).strip()
    if RE_ALERTA.match(s):
        return "alerta"
    if s.startswith("CS-"):
        return "caso"
    if s.startswith("RR-"):
        return "reporte"
    return "basura"


def union_alerta_demanda(pares_columna, pares_bridge, alertas_existentes):
    """Une la columna denormalizada con el bridge.

    Corrige D20 y D31: la columna NO es copia, aporta 16 pares propios; el
    bridge aporta 11. El bridge gana en los 11 conflictos (misma demanda,
    alerta distinta) por ser la fuente normalizada.

    Devuelve (pares_finales, descartados, estadisticas).
    """
    col = set(pares_columna)
    bri = set(pares_bridge)
    solo_col = col - bri
    solo_bri = bri - col
    union = col | bri

    descartados = {p for p in union if p[1] not in alertas_existentes}
    validos = union - descartados

    # demandas.alerta_id es un FK único: sólo cabe UNA alerta por demanda. Si la
    # columna y el bridge discrepan para la misma demanda, prevalece el bridge
    # (fuente normalizada). No se pierde información: la discrepancia queda
    # registrada como conflicto para revisión humana.
    por_demanda = {}
    for d_, a_ in solo_col:
        por_demanda.setdefault(d_, a_)
    for d_, a_ in bri:
        por_demanda[d_] = a_

    asignados = {(d_, a_) for d_, a_ in validos if por_demanda.get(d_) == a_}
    return (
        asignados,
        descartados,
        {
            "columna": len(col),
            "bridge": len(bri),
            "union": len(union),
            "interseccion": len(col & bri),
            "solo_columna": len(solo_col),
            "solo_bridge": len(solo_bri),
            "validos": len(validos),
            "descartados": len(descartados),
            "asignados": len(asignados),
            "conflictos": len(solo_bri),
        },
    )


def resolve_nivel_riesgo_caso(id_riesgos, prioridad, riesgos_alertas):
    """D48: riesgo del caso cuando falta ID_Riesgos (sólo CS-PRODUCE-2026-016).

    Orden de preferencia:
      1. ID_Riesgos del propio caso                        -> confidence 1.00
      2. ID_Riesgos de las alertas vinculadas (moda; empate -> mayor severidad)
         Es dato del legado, no una inferencia de negocio -> confidence 0.90
      3. Prioridad del caso (Urgente->Alto)                       -> 0.50
      4. Nada                                                     -> (None, 0)

    Se prefiere (2) a (3) porque en el caso 016 LAS DOS alertas vinculadas
    traen RIE-001, y la relación Prioridad/Riesgo observada es débil (2 de 4
    casos 'Urgente' son RIE-003).
    """
    directo = map_nivel_riesgo(id_riesgos)
    if directo is not None:
        return directo, "legado_directo", 1.00

    niveles = [map_nivel_riesgo(r) for r in riesgos_alertas if r]
    niveles = [n for n in niveles if n is not None]
    if niveles:
        conteo = {n: niveles.count(n) for n in set(niveles)}
        maximo = max(conteo.values())
        return (
            max(n for n, c in conteo.items() if c == maximo),
            "alerta_vinculada",
            0.90,
        )

    por_prioridad = {1: 3, 2: 2, 3: 1}.get(map_prioridad_caso(prioridad))
    if por_prioridad is not None:
        return por_prioridad, "prioridad_caso", 0.50

    return None, "sin_fuente", 0.0


# =============================================================================
# 8. RESUMEN EJECUTABLE
# =============================================================================


def resumen(wb=None):
    """Imprime las cifras que sostienen cada decisión cerrada."""
    wb = wb or load_workbook()

    _, provincias = sheet_rows(wb, "DIM_Provincias")
    region_map = build_region_map(wb)
    regiones = sorted(set(region_map.values()))

    h_act, actores = sheet_rows(wb, "DIM_Actores")
    i_dni = col_index(h_act, "DNI")
    i_tipo = col_index(h_act, "ID_Tipo_Actor")
    dnis = [normalize_dni(r[i_dni]) for r in actores]
    dnis = [d for d in dnis if d]
    duplicados = {}
    for d in dnis:
        duplicados[d] = duplicados.get(d, 0) + 1
    valores_dup = {d: n for d, n in duplicados.items() if n > 1}

    h_cas, casos = sheet_rows(wb, "FACT_Casos")
    i_tc = col_index(h_cas, "ID_Tipo")
    con_nivel = sum(1 for c in casos if map_nivel_conflicto(c[i_tc]) is not None)

    h_al, alertas = sheet_rows(wb, "DIM_Alertas")
    i_na = col_index(h_al, "ID_NIVEL_ALERTA")
    sin_prioridad = [a[0] for a in alertas if map_prioridad_alerta(a[i_na]) is None]

    print(f"regiones derivadas        : {len(regiones)} (esperado 25)")
    print(f"departamentos sin region  : {sorted(DEPARTAMENTOS_NO_REGION)}")
    print(f"provincias                : {len(provincias)}")
    print(f"casos con nivel_conflicto : {con_nivel}/{len(casos)}")
    print(f"alertas sin prioridad     : {sin_prioridad}")
    print(f"DNI no nulos              : {len(dnis)} ({len(set(dnis))} distintos)")
    print(
        f"DNI en conflicto          : {len(valores_dup)} valores / "
        f"{sum(valores_dup.values())} filas"
    )
    tipos = {}
    for a in actores:
        t = map_tipo_actor(a[i_tipo])
        tipos[t] = tipos.get(t, 0) + 1
    print(f"tipo_actor_id distribuido : {dict(sorted(tipos.items()))}")


if __name__ == "__main__":
    resumen()
