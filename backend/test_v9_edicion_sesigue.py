#!/usr/bin/env python3
"""
Pruebas de la edición del 30 de octubre de 2026 sobre v9 (§15.4–15.7 del documento):
integración externa genérica — outbox transaccional, gate HITL, agregación N:1 y mapeo de estados.

Qué se prueba, y por qué:
  T1  el bloque carga sin errores y el catálogo de estados son 8 filas con 4 terminales;
  T2  un INSERT en core.outbox_integracion en estado 2 (aprobado_para_envio) sin aprobado_por
      se rechaza — el gate HITL lo impone la base, no la aplicación;
  T3  con aprobado_por sí entra, y aprobado_en se sella solo;
  T4  una fila en estado 1 (pendiente_aprobacion) NO queda marcada como aprobada
      (prueba del autofill anidado del trigger: sellar fuera del bloque sería el bug);
  T5  saltar de 1 a 3 (enviado) o a 4 (confirmado) sin aprobación también se rechaza;
  T6  tres filas de core.integraciones con el mismo entidad_destino_ref se agregan en
      core.vw_agregacion_compromiso_externo — la N:1 es una vista, no una tabla nueva;
  T7  core.cat_mapeo_estado_externo traduce un estado local a su estado externo;
  T8  ATOMICIDAD (la prueba que más vale): un hecho local y su fila de outbox escritos en la
      misma transacción desaparecen juntos con ROLLBACK, y persisten juntos con COMMIT;
  T9  un estado terminal de rechazo (5) no exige aprobación, y la columna
      protocolo_sincronizacion nace en 'oficio_manual' (no se asume API por defecto).

Cómo se ejecuta (este entorno de trabajo no tiene PostgreSQL, ver nota al final del documento):
  py -3.12 -m venv .venv
  .venv\\Scripts\\pip install "pgserver==0.1.4" "psycopg[binary]" sqlparse
  .venv\\Scripts\\python test_v9_edicion_sesigue.py

  Alternativa con un PostgreSQL ya levantado y el núcleo ya cargado:
  set AVISA_TEST_DSN=postgresql://postgres:pg@localhost:5433/avisa
  python test_v9_edicion_sesigue.py

El núcleo (v8.2 + v8.4) se busca junto a este script (AVISA_CORE_DIR) y es el mismo que usa
test_v9_seccion_0_6.py. Si falta, el script se detiene sin inventar un esquema: probar el gate
sobre tablas que no son las reales no probaría nada.
"""

import os
import re
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
NUCLEO = (
    "v8.2_nucleo_ddl.sql",
    "v8.2_expansion_ddl.sql",
    "policy_stub.sql",
    "v8.4_domain_ddl_probado.sql",
)
BLOQUE = "v9_seccion_sesigue_ddl.sql"

try:
    import psycopg
    import sqlparse
except ImportError:
    print(
        'Faltan dependencias: pip install "psycopg[binary]" sqlparse "pgserver==0.1.4"'
    )
    sys.exit(2)


def cargar(con, ruta):
    """Ejecuta un archivo sentencia a sentencia y cuenta los fallos."""
    n = bad = 0
    for s in sqlparse.split(open(ruta, encoding="utf-8").read()):
        if not re.search(r"[A-Za-z]", re.sub(r"--[^\n]*", "", s)):
            continue
        n += 1
        try:
            con.execute(s)
        except Exception as e:
            bad += 1
            print(
                "ERROR DE CARGA en",
                os.path.basename(ruta),
                ":",
                re.sub(r"\s+", " ", s)[:100],
                "=>",
                str(e).splitlines()[0],
            )
    return n, bad


dsn = os.environ.get("AVISA_TEST_DSN")
srv = None
if dsn:
    con = psycopg.connect(dsn, autocommit=True)
    print(f"Conectado a {dsn} (se asume el núcleo ya cargado).\n")
    total = bad = 0
else:
    try:
        import pgserver
    except ImportError:
        print(
            "Sin AVISA_TEST_DSN y sin pgserver: no hay dónde ejecutar. Ver el docstring."
        )
        sys.exit(2)
    faltan = [f for f in NUCLEO if not os.path.exists(os.path.join(AQUI, f))]
    if faltan:
        print("Faltan los DDL del núcleo junto a este script:", ", ".join(faltan))
        print(
            "Cópialos a",
            AQUI,
            "o define AVISA_TEST_DSN apuntando a una base ya cargada.",
        )
        sys.exit(2)
    srv = pgserver.get_server(tempfile.mkdtemp(), cleanup_mode="stop")
    con = psycopg.connect(srv.get_uri(), autocommit=True)
    total = bad = 0
    for f in NUCLEO:
        n, b = cargar(con, os.path.join(AQUI, f))
        total += n
        bad += b

n, b = cargar(con, os.path.join(AQUI, BLOQUE))
total += n
bad += b
if bad:
    print(
        f"\n{total} sentencias, {bad} con error. Deteniendo: no tiene sentido probar "
        "comportamiento sobre un esquema que no cargó."
    )
    sys.exit(1)
print(
    f"Carga del bloque §4.5.bis: {n} sentencias, 0 errores (total corrido: {total}).\n"
)


def q(sql, params=None):
    return con.execute(sql, params).fetchall()


def ejecuta(sql, params=None):
    con.execute(sql, params)


ok = fail = 0


def T(nombre, cond):
    global ok, fail
    ok += bool(cond)
    fail += not cond
    print(("PASS  " if cond else "FAIL  ") + nombre)


def rechaza(sql, params=None):
    try:
        con.execute(sql, params)
        return False
    except Exception:
        return True


# ---------------------------------------------------------------- datos de apoyo
ejecuta(
    "insert into core.cat_tipos_actor(nombre) values ('Social'),('Publico'),('NEC')"
)
ejecuta("insert into core.cat_roles_actor(nombre) values ('Principal')")
ejecuta("insert into core.regiones(ubigeo,nombre) values ('20','Piura')")
ejecuta(
    "insert into core.provincias(region_id,ubigeo,nombre) values (1,'2007','Paita')"
)
ejecuta(
    "insert into core.distritos(provincia_id,ubigeo,nombre) values (1,'200701','Paita')"
)
ejecuta("insert into core.cat_subsectores(nombre) values ('Pesca')")
ejecuta("insert into core.cat_tematicas(nombre) values ('Infraestructura')")
ejecuta(
    "insert into core.cat_unidades_organicas(siglas,nombre_completo) values ('OAIPCS','Oficina')"
)
enlace = q(
    "insert into core.usuarios(nombre,email) values ('Enlace','enlace@x.pe') returning id"
)[0][0]
# El documento exige que la aplicación fije app.clasificacion_max (RLS por clasificación, §20.16).
# Un superusuario la saltaría; fijarla hace que la prueba también valga con un DSN no privilegiado.
ejecuta("select set_config('app.clasificacion_max','3',false)")
ejecuta("select set_config('app.user_id',%s,false)", (str(enlace),))


def integracion(dest_ref, tipo="hito", estado="activa"):
    return q(
        """insert into core.integraciones
                  (sistema_origen,sistema_destino,entidad_origen_tipo,entidad_origen_id,
                   entidad_destino_ref,tipo_sync,estado,tipo_fuente_id)
                values ('PRODUCE','SESIGUE',%s,gen_random_uuid(),%s,'push',%s,21)
                returning id""",
        (tipo, dest_ref, estado),
    )[0][0]


def outbox(integracion_id, estado=1, aprobado_por=None, payload='{"hito":"H-1"}'):
    return q(
        """insert into core.outbox_integracion
                  (integracion_id,payload_local,estado_id,aprobado_por)
                values (%s,%s::jsonb,%s,%s) returning id, aprobado_en, proximo_intento_en""",
        (integracion_id, payload, estado, aprobado_por),
    )[0]


print("== T1. Catálogo de estados del ciclo de vida del envío ==")
estados = q("select codigo, es_terminal from core.cat_estados_integracion order by id")
T(
    "T1.1 son 8 estados, con los códigos del encargo",
    [e[0] for e in estados]
    == [
        "pendiente_aprobacion",
        "aprobado_para_envio",
        "enviado",
        "confirmado",
        "rechazado_por_destino",
        "rechazado_por_enlace",
        "reintentando",
        "fallo_definitivo",
    ],
)
T("T1.2 exactamente 4 son terminales", sum(1 for e in estados if e[1]) == 4)
T(
    "T1.3 la fuente externa es una fila de catálogo (id 21, código 'sesigue'), no una tabla",
    q("select codigo from core.cat_tipos_fuente_integracion where id = 21")[0][0]
    == "sesigue",
)

print("\n== T2–T5. Gate HITL impuesto por la base ==")
i1 = integracion("SESIGUE-COMP-001")
T(
    "T2 estado 2 (aprobado_para_envio) sin aprobado_por se rechaza",
    rechaza(
        """insert into core.outbox_integracion(integracion_id,payload_local,estado_id)
             values (%s,'{}'::jsonb,2)""",
        (i1,),
    ),
)
T(
    "T3 estado 2 con aprobado_por entra y sella aprobado_en",
    (lambda r: r[1] is not None)(outbox(i1, estado=2, aprobado_por=enlace)),
)
r1 = outbox(i1, estado=1)
T(
    "T4 estado 1 (pendiente_aprobacion) NO queda marcado como aprobado (autofill anidado)",
    r1[1] is None and r1[2] is None,
)
fila = r1[0]
T(
    "T5 saltar de 1 a 3 (enviado) sin aprobación se rechaza",
    rechaza("update core.outbox_integracion set estado_id = 3 where id = %s", (fila,)),
)
T(
    "T5 saltar de 1 a 4 (confirmado) sin aprobación se rechaza",
    rechaza("update core.outbox_integracion set estado_id = 4 where id = %s", (fila,)),
)
T(
    "T5 con aprobado_por, el mismo UPDATE a 3 sí procede",
    not rechaza(
        "update core.outbox_integracion set estado_id = 3, aprobado_por = %s where id = %s",
        (enlace, fila),
    ),
)

print("\n== T6. Agregación N:1 como vista, no como tabla ==")
ref = "SESIGUE-COMP-777"
integracion(ref, tipo="hito")
integracion(ref, tipo="entregable")
integracion(ref, tipo="hito", estado="pausada")
fila_agg = q(
    """select hitos_locales_asociados, tipos_origen, todos_activos
                  from core.vw_agregacion_compromiso_externo
                 where sistema_destino = 'SESIGUE' and entidad_destino_ref = %s""",
    (ref,),
)
T(
    "T6.1 tres hitos locales con el mismo entidad_destino_ref cuentan como 3",
    fila_agg and fila_agg[0][0] == 3,
)
T(
    "T6.2 tipos_origen distingue hito y entregable (sin duplicar el 'hito' repetido)",
    fila_agg and list(fila_agg[0][1]) == ["entregable", "hito"],
)
T(
    "T6.3 con un hito pausado, todos_activos es FALSE",
    fila_agg and fila_agg[0][2] is False,
)
T(
    "T6.4 la agregación NO crea tabla de concordancia (no existe core.relacion_sesigue)",
    not q(
        """select 1 from information_schema.tables
            where table_schema = 'core' and table_name like '%sesigue%'"""
    ),
)

print("\n== T7. Traducción de estados local -> externo ==")
T(
    "T7.1 'En_Contratación' se traduce a 'En_Cumplimiento_En_Plazo'",
    q("""select estado_externo from core.cat_mapeo_estado_externo
        where sistema_destino = 'SESIGUE' and estado_local = 'En_Contratación'""")[0][0]
    == "En_Cumplimiento_En_Plazo",
)
T(
    "T7.2 el par (sistema, estado_local) es único",
    rechaza("""insert into core.cat_mapeo_estado_externo(id,sistema_destino,estado_local,estado_externo)
             values (99,'SESIGUE','En_Contratación','X')"""),
)

print("\n== T8. Atomicidad del patrón Transactional Outbox (la prueba central) ==")
caso = q("""insert into core.casos(codigo_caso,nombre_caso,distrito_principal_id,subsector_id,
                               tematica_id,unidad_responsable_id,nivel_conflicto_id,nivel_riesgo_id)
            values ('CS-SES-01','Caso de prueba SESIGUE',1,1,1,1,1,1) returning id""")[
    0
][0]
comp = q(
    """insert into core.compromisos(codigo_compromiso,caso_id,unidad_responsable_id,
                                      fecha_inicio,accion_compromiso,tipo_compromiso)
            values ('CS-SES-01_COMP001',%s,1,'2026-01-01','Prueba de atomicidad','Actividad')
            returning id""",
    (caso,),
)[0][0]
i2 = integracion("SESIGUE-COMP-888")

con.autocommit = False
ejecuta(
    """insert into core.hitos_compromiso(codigo_hito,compromiso_id,descripcion_hito,
                                            fecha_vencimiento,estado_id)
           values ('CS-SES-01_COMP001_H01',%s,'TDR aprobado','2026-11-15',4)""",
    (comp,),
)
ejecuta(
    """insert into core.outbox_integracion(integracion_id,payload_local,estado_id)
           values (%s,%s::jsonb,1)""",
    (i2, '{"hito":"CS-SES-01_COMP001_H01"}'),
)
con.rollback()
T(
    "T8.1 el ROLLBACK deshace el hecho local Y su mensaje juntos",
    q(
        "select count(*) from core.hitos_compromiso where codigo_hito='CS-SES-01_COMP001_H01'"
    )[0][0]
    == 0
    and q(
        "select count(*) from core.outbox_integracion where integracion_id=%s", (i2,)
    )[0][0]
    == 0,
)

ejecuta(
    """insert into core.hitos_compromiso(codigo_hito,compromiso_id,descripcion_hito,
                                            fecha_vencimiento,estado_id)
           values ('CS-SES-01_COMP001_H02',%s,'TDR aprobado','2026-11-15',4)""",
    (comp,),
)
ejecuta(
    """insert into core.outbox_integracion(integracion_id,payload_local,estado_id)
           values (%s,%s::jsonb,1)""",
    (i2, '{"hito":"CS-SES-01_COMP001_H02"}'),
)
con.commit()
con.autocommit = True
T(
    "T8.2 el COMMIT persiste el hecho local Y su mensaje juntos",
    q(
        "select count(*) from core.hitos_compromiso where codigo_hito='CS-SES-01_COMP001_H02'"
    )[0][0]
    == 1
    and q(
        "select count(*) from core.outbox_integracion where integracion_id=%s", (i2,)
    )[0][0]
    == 1,
)

print("\n== T9. Rechazo terminal y nivel de integración por fuente ==")
T(
    "T9.1 un estado terminal de rechazo (5) no exige aprobación",
    (lambda r: r[1] is None)(outbox(i2, estado=5)),
)
T(
    "T9.2 protocolo_sincronizacion nace en 'oficio_manual' (no se asume API por defecto)",
    q("select protocolo_sincronizacion from core.integraciones where id = %s", (i2,))[
        0
    ][0]
    == "oficio_manual",
)
T(
    "T9.3 el CHECK rechaza un protocolo inventado",
    rechaza(
        "update core.integraciones set protocolo_sincronizacion = 'grpc' where id = %s",
        (i2,),
    ),
)
T(
    "T9.4 los índices del worker existen (ix_outbox_pendientes es parcial)",
    q("""select count(*) from pg_indexes
        where schemaname = 'core' and indexname in ('ix_outbox_pendientes','ix_outbox_integracion')""")[
        0
    ][0]
    == 2,
)

print(f"\nResultado: {ok} aprobadas, {fail} fallidas")
sys.exit(1 if fail else 0)
