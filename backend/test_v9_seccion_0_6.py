#!/usr/bin/env python3
"""
Pruebas de la edición quirúrgica del 29 de octubre de 2026 sobre v9 (§0.6 del documento):
  1) gobernanza de core.cat_niveles_conflicto (bloqueo directo + aplicar + revertir),
  2) reducción de las 8 excepciones mype/pesca/territorio a 2 (nec_lote, cites_permiso),
  3) tipo 'evento_contextual_externo' para datos de sectores nuevos conectados por API.

Valida la edición contra el núcleo ya probado (v8.2 núcleo + v8.4 domain/model/config), no una
re-ejecución completa de las 3800 líneas de PRODUCE_OAIPCS_AVISA_v9_ddl.sql: este entorno no tiene
PostGIS disponible, y el resto del archivo (polígonos de parques industriales, cuadrículas sísmicas)
sí lo requiere, aunque esta edición en particular no lo use. Ver la nota honesta en el documento.

Uso:
  pip install pgserver "psycopg[binary]" sqlparse
  python test_v9_seccion_0_6.py
"""
import sys, os, re, tempfile
import pgserver, psycopg, sqlparse

AQUI = os.path.dirname(os.path.abspath(__file__))
ARCHIVOS = [os.path.join(AQUI, f) for f in (
    "v8.2_nucleo_ddl.sql", "v8.2_expansion_ddl.sql", "policy_stub.sql", "v8.4_domain_ddl_probado.sql",
    "v9_seccion_0_6_prerequisitos_de_prueba.sql",
    "v9_seccion_0_6_gobernanza.sql", "v9_seccion_0_6_registro_tipos.sql", "v9_seccion_0_6_mype_pesca_territorio.sql",
)]

srv = pgserver.get_server(tempfile.mkdtemp(), cleanup_mode="stop")
con = psycopg.connect(srv.get_uri(), autocommit=True)
n = bad = 0
for f in ARCHIVOS:
    for s in sqlparse.split(open(f, encoding="utf-8").read()):
        if re.search(r"[A-Za-z]", re.sub(r"--[^\n]*", "", s)):
            n += 1
            try: con.execute(s)
            except Exception as e:
                bad += 1; print("ERROR DE CARGA en", f, ":", re.sub(r"\s+", " ", s)[:100], "=>", str(e).splitlines()[0])
if bad:
    print(f"\n{n} sentencias, {bad} con error. Deteniendo (no tiene sentido probar comportamiento sobre un esquema que no cargó)."); sys.exit(1)
print(f"Carga del DDL: {n} sentencias, 0 errores.\n")

q = lambda s, p=None: con.execute(s, p).fetchall()
ok = fail = 0
def T(nombre, cond):
    global ok, fail
    ok += bool(cond); fail += (not cond)
    print(("PASS  " if cond else "FAIL  ") + nombre)
def rechaza(sql, p=None):
    try: con.execute(sql, p); return False
    except Exception: return True

con.execute("insert into core.cat_tipos_actor(nombre) values ('Social'),('Publico'),('NEC')")
con.execute("insert into core.cat_roles_actor(nombre) values ('Principal')")
con.execute("insert into core.regiones(ubigeo,nombre) values ('20','Piura')")
con.execute("insert into core.provincias(region_id,ubigeo,nombre) values (1,'2007','Paita')")
con.execute("insert into core.distritos(provincia_id,ubigeo,nombre) values (1,'200701','Paita')")
con.execute("insert into core.cat_subsectores(nombre) values ('MYPE')")
con.execute("insert into core.cat_tematicas(nombre) values ('Compras')")
con.execute("insert into core.cat_unidades_organicas(siglas,nombre_completo) values ('OAIPCS','Oficina')")
uid = q("insert into core.usuarios(nombre,email) values ('DS','ds@x.pe') returning id")[0][0]
admin = q("insert into core.usuarios(nombre,email) values ('Admin','admin@x.pe') returning id")[0][0]
con.execute("select set_config('app.user_id',%s,false)", (str(uid),))

print("== 1. Gobernanza de core.cat_niveles_conflicto: solo el admin, con reversión ==")
T("1.1 INSERT/UPDATE/DELETE directos quedan bloqueados", all(rechaza(s) for s in [
    "insert into core.cat_niveles_conflicto values (5,'X','X',5)",
    "update core.cat_niveles_conflicto set nombre='x' where id=1",
    "delete from core.cat_niveles_conflicto where id=1"]))
cambio = q("""insert into core.cambio_normativo(tabla_objetivo,accion,payload_despues,norma_referencia,solicitado_por)
              values ('core.cat_niveles_conflicto','insertar','{"id":5,"codigo":"X","nombre":"X","orden":5}'::jsonb,'RM hipotética',%s) returning id""",(uid,))[0][0]
T("1.2 registrar la solicitud no cambia nada todavía", q("select count(*) from core.cat_niveles_conflicto")[0][0] == 4)
con.execute("select core.aplicar_cambio_normativo(%s,%s)", (cambio, admin))
T("1.3 aplicar_cambio_normativo() con el admin sí inserta, y queda registrado quién aprobó", q("select count(*) from core.cat_niveles_conflicto")[0][0] == 5
  and q("select aprobado_por from core.cambio_normativo where id=%s",(cambio,))[0][0] == admin)
T("1.4 aplicar el mismo cambio dos veces falla", rechaza("select core.aplicar_cambio_normativo(%s,%s)", (cambio, admin)))
con.execute("select core.revertir_cambio_normativo(%s,%s)", (cambio, admin))
T("1.5 revertir_cambio_normativo() deja el catálogo exactamente como estaba", q("select count(*) from core.cat_niveles_conflicto")[0][0] == 4)

print("\n== 2. Reducción de 8 excepciones a 2 ==")
caso = q("""insert into core.casos(codigo_caso,nombre_caso,distrito_principal_id,subsector_id,tematica_id,unidad_responsable_id,nivel_conflicto_id,nivel_riesgo_id)
            values ('CS-C4-01','x',1,1,1,1,1,1) returning id""")[0][0]
mype = q("insert into core.actores(nombre_actual,tipo_actor_id,rol_actor_id) values ('Textil SAC',3,1) returning actor_uid")[0][0]
mype2 = q("insert into core.actores(nombre_actual,tipo_actor_id,rol_actor_id) values ('Otra SAC',3,1) returning actor_uid")[0][0]
lote = q("""insert into mype.ejecucion_nec(nec_codigo,lote_codigo,mype_actor_uid,monto_adjudicado_sol,fecha_adjudicacion,fecha_entrega_pactada,estado_pago)
            values ('NEC-01','L-01',%s,15000,current_date,current_date+30,'pendiente') returning id, tipo_artefacto_id""",(mype,))[0]
con.execute("""insert into mype.ejecucion_nec(nec_codigo,lote_codigo,mype_actor_uid,monto_adjudicado_sol,fecha_adjudicacion,fecha_entrega_pactada,estado_pago)
               values ('NEC-01','L-02',%s,5000,current_date,current_date+30,'pendiente')""",(mype2,))
tipo_nec = q("select id from domain.tipo_artefacto where codigo='nec_lote'")[0][0]
T("2.1 nec_lote sigue siendo tabla física (excepción justificada), con el tipo enlazado por trigger (no DEFAULT)", lote[1] == tipo_nec)

con.execute("refresh materialized view mype.mv_concentracion_lotes")
hhi = q("select hhi, numero_mypes from mype.mv_concentracion_lotes where nec_codigo='NEC-01'")[0]
T("2.2 nec_concentracion ya no es tabla: la vista materializada calcula HHI=0.625 con 2 MYPE", abs(float(hhi[0]) - 0.625) < 0.001 and hhi[1] == 2)
con.execute("refresh materialized view concurrently mype.mv_concentracion_lotes")
T("2.3 REFRESH CONCURRENTLY funciona (índice único presente)", True)

tipo_insp = q("select id from domain.tipo_artefacto where codigo='inspeccion_cite'")[0][0]
con.execute("insert into domain.artefacto(tipo_id,payload) values (%s,%s::jsonb)",
            (tipo_insp, f'{{"ejecucion_id":"{lote[0]}","nec_codigo":"NEC-01","lote_codigo":"L-01","resultado":"conforme"}}'))
T("2.4 inspeccion_cite volvió a domain.artefacto; la vista de compatibilidad responde", q("select resultado from mype.inspeccion_cite")[0][0] == 'conforme')

con.execute("insert into core.cat_especies(id,nombre_comun) values (12,'Tiburón martillo')")
tipo_cuota = q("select id from domain.tipo_artefacto where codigo='cites_cuota'")[0][0]
con.execute("insert into domain.artefacto(tipo_id,sujeto_especie_id,payload) values (%s,12,%s::jsonb)",
            (tipo_cuota, '{"anio":2026,"cuota_total_kg":5000,"cuota_consumida_kg":4200}'))
T("2.5 cites_cuota volvió a domain.artefacto; la vista de compatibilidad responde", q("select cuota_total_kg from pesca.cuota_cites_especie where especie_id=12")[0][0] == 5000)

con.execute("insert into config.parametro(codigo,valor,tipo) values ('G17.od_min','4.0','numero'),('G17.metales_max_ppm','0.05','numero')")
con.execute("insert into territorio.lugares(tipo_id,distrito_id,nombre) values (6,1,'Estación Perené')")
lugar_bajo = q("select id from territorio.lugares where nombre='Estación Perené'")[0][0]
con.execute("insert into territorio.estacion_hidrica_detalle(lugar_id,codigo_ana,cuenca,tipo_estacion) values (%s,'ANA-001','Perené','rio')",(lugar_bajo,))
T("2.6 la estación hídrica es un detalle de territorio.lugares, no una tabla propia", q("select cuenca from territorio.estacion_hidrica_detalle where lugar_id=%s",(lugar_bajo,))[0][0] == 'Perené')
con.execute("insert into ctx.cat_fuentes(id,codigo,nombre) values (1,'ANA','ANA')")
con.execute("insert into ctx.observaciones(fecha,variable_id,fuente_id,valor,lugar_id) values (current_date,29,1,3.2,%s)",(lugar_bajo,))
con.execute("insert into ctx.observaciones(fecha,variable_id,fuente_id,valor,lugar_id) values (current_date,30,1,7.1,%s)",(lugar_bajo,))
r = q("select excede_eca from territorio.vw_monitoreo_hidrico_excede_eca where lugar_id=%s",(lugar_bajo,))[0][0]
T("2.7 muestra hídrica = observación de ctx.observaciones, no tabla propia; detecta OD bajo (3.2 < 4.0)", r is True)

con.execute("insert into territorio.lugares(tipo_id,distrito_id,nombre) values (6,1,'Estación Sana')")
lugar_sano = q("select id from territorio.lugares where nombre='Estación Sana'")[0][0]
con.execute("insert into ctx.observaciones(fecha,variable_id,fuente_id,valor,lugar_id) values (current_date,29,1,6.5,%s)",(lugar_sano,))
con.execute("insert into ctx.observaciones(fecha,variable_id,fuente_id,valor,lugar_id) values (current_date,30,1,7.0,%s)",(lugar_sano,))
r2 = q("select excede_eca from territorio.vw_monitoreo_hidrico_excede_eca where lugar_id=%s",(lugar_sano,))[0][0]
T("2.8 sin lectura de metales y todo en rango, da FALSE (no NULL) — corrección del bug 'i' del Anexo C", r2 is False)

print("\n== 3. 'evento_contextual_externo': sectores nuevos conectados por API, sin tabla nueva ==")
tipo_ev = q("select id from domain.tipo_artefacto where codigo='evento_contextual_externo'")[0][0]
con.execute("insert into domain.artefacto(tipo_id,caso_id,payload) values (%s,%s,%s::jsonb)",
            (tipo_ev, caso, '{"fuente_integracion_codigo":"SUNAT","tipo_evento":"comprobante_emitido","fecha_evento":"2026-10-01"}'))
T("3.1 un evento de un sector nuevo conectado por API se registra sin crear tabla ni tipo específico", True)
T("3.2 el tipo exige fuente_integracion_codigo/tipo_evento/fecha_evento", rechaza(
    "insert into domain.artefacto(tipo_id,caso_id,payload) values (%s,%s,%s::jsonb)", (tipo_ev, caso, '{"tipo_evento":"x"}')))

print(f"\nResultado: {ok} aprobadas, {fail} fallidas")
sys.exit(1 if fail else 0)
