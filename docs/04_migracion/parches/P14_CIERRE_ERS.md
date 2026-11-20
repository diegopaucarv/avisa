# P14 — Cierre de brechas del ERS

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 (`docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md`), RF-A03, RF-A04, RF-D01, §12.4, §12.5
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16.14, esquema v10
**Parche:** `docs/PARCHE_14_CIERRE_ERS.sql` (idempotente, 1 016 líneas)
**Estado:** aplicado y verificado en la base viva el 2026-11-20

---

## 1. Resumen

El parche cierra cinco brechas del ERS que el esquema v10 tenía abiertas:

1. RF-A03: la seguridad por fila no se aplicaba porque la aplicación usaba el rol
   `avisa`, superusuario con `BYPASSRLS`. Se crea `avisa_app` sin ese atributo.
2. RF-A04: la bitácora se podía leer sin restricción y su borrado dependía solo
   de los triggers del parche 9. Pasa a RLS forzada y privilegios de solo
   `INSERT` y `SELECT`; los triggers permanecen como segunda barrera.
3. RF-D01: una alerta no podía tener estado porque el CHECK de `tipo_origen` no
   admitía `alerta`. Ahora lo admite, tiene cuatro pasos de flujo y una vista de
   estado. Las 83 alertas existentes tienen proceso.
4. §12.4: los niveles 4 y 5 se podían georreferenciar y admitían datos
   personales. Un CHECK y un trigger lo impiden.
5. §12.5: `base_legal` era texto libre. Pasa a catálogo con columna de enlace y
   tabla de evidencia contra el corpus del KAG.

Las cifras de este informe salen de `SELECT` contra `avisa-db` y se reproducen en
§4. Los objetos del parche existen hoy: 8 tablas y vistas, 3 funciones,
2 triggers y los CHECK de los bloques 2 a 5.

Una salvedad importante: el vínculo con el corpus es estructural. La tabla
`ref.base_legal_evidencia` existe pero tiene **0 filas**, porque
`kag.documento_fragmento` también tiene 0 filas. El enlace no se puede poblar
hasta que el corpus esté segmentado (§6.1).

---

## 2. Objetos creados o modificados

| Objeto                                      | Tipo                                                                  | Qué hace                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`                                       | esquema                                                               | Catálogos de referencia. Se crea en el bloque 1 para poder conceder permisos.                                                                                                                     |
| `avisa_app`                                 | rol                                                                   | Rol de la aplicación: `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `INHERIT`.                                                                                           |
| `core.puede_auditar()`                      | función `STABLE`                                                      | Devuelve `true` solo si `app.rol_codigo` es `administrador`, `auditor` o `alta_direccion`. Sin el parámetro devuelve `false`.                                                                     |
| `audit.datos_personales_acceso` (RLS)       | RLS y 2 políticas                                                     | `ENABLE` y `FORCE`; `p_audit_insert` (`INSERT`, `WITH CHECK true`) y `p_audit_lectura` (`SELECT`, `USING core.puede_auditar()`). Sin políticas de `UPDATE` ni `DELETE`. `REVOKE ALL` de `PUBLIC`. |
| `proceso_instancia_tipo_origen_check`       | CHECK                                                                 | Admite `caso`, `reporte` y `alerta`.                                                                                                                                                              |
| `proceso_instancia_origen_coherente_check`  | CHECK                                                                 | `alerta` exige `alerta_id` y prohíbe `caso_id`, `codigo_caso_legado` y `codigo_reporte`.                                                                                                          |
| `flujo_definicion_tipo_flujo_check`         | CHECK                                                                 | Admite `caso`, `reporte` y `alerta`.                                                                                                                                                              |
| `core.flujo_definicion` (4 filas)           | datos                                                                 | Pasos `DPPA-1` a `DPPA-4`: Elaboración, Validación, Remisión, Archivo.                                                                                                                            |
| `core.proceso_instancia` (72 filas)         | datos                                                                 | Filas heredadas de tipo `reporte` con `alerta_id` pasan a `alerta`. El código de reporte se conserva en `nota` y la columna queda nula.                                                           |
| `core.tg_alerta_nace()`                     | función trigger `SECURITY DEFINER`                                    | Crea el paso 1 al insertar una alerta. Si falta el catálogo del flujo, no bloquea el alta.                                                                                                        |
| `trg_alerta_nace`                           | trigger `AFTER INSERT`                                                | Dispara `core.tg_alerta_nace()` sobre `core.alertas_tempranas`.                                                                                                                                   |
| `core.proceso_instancia` (83 filas)         | datos                                                                 | Paso 4 de cierre (`EST-02`) para las 83 alertas archivadas: 57 con paso 1 previo y 26 sin ningún paso.                                                                                            |
| `core.vw_alerta_estado`                     | vista                                                                 | Último paso vigente de cada alerta, resuelto con `LATERAL` y orden descendente.                                                                                                                   |
| `core.cat_nivel_identificacion`             | tabla                                                                 | 5 niveles: DNI, otro documento, sin documento, seudónimo y colectivo anónimo.                                                                                                                     |
| `core.actores.nivel_identificacion_id`      | columna `smallint NOT NULL DEFAULT 3` y FK                            | Nivel de identificación del actor.                                                                                                                                                                |
| `core.actores.caso_ancla_id`                | columna `uuid` y FK                                                   | Caso al que se ata un actor sin identidad.                                                                                                                                                        |
| `core.actores.organizacion_ancla_uid`       | columna `uuid` y FK                                                   | Organización a la que se ata un actor sin identidad.                                                                                                                                              |
| `core.actores.confianza`                    | columna `numeric(3,2)` y CHECK                                        | Confianza de la identificación, entre 0 y 1.                                                                                                                                                      |
| `ck_actor_anclaje`                          | CHECK                                                                 | Nivel 4 o 5 exige `caso_ancla_id` u `organizacion_ancla_uid`.                                                                                                                                     |
| `core.actor_alias`                          | tabla                                                                 | Alias, abreviatura, cargo, nombre histórico o sobrenombre. Único por `(actor_uid, alias)`.                                                                                                        |
| `core.actores.region_id`                    | columna `integer` y FK, con índices sobre `region_id` y `distrito_id` | Departamento del actor, tomado de `core.regiones`.                                                                                                                                                |
| `ck_actor_sin_geo_si_no_identificado`       | CHECK                                                                 | Nivel 4 o 5 exige `distrito_id` y `region_id` nulos.                                                                                                                                              |
| `core.tg_pii_solo_identificados()`          | función trigger `SECURITY DEFINER`                                    | Rechaza datos personales de actores de nivel 4 o 5.                                                                                                                                               |
| `trg_pii_solo_identificados`                | trigger `BEFORE INSERT OR UPDATE`                                     | Aplica la función anterior sobre `core.actor_datos_personales`.                                                                                                                                   |
| `core.vw_actor_territorio`                  | vista                                                                 | Región, distrito, provincia y lugares vigentes por actor.                                                                                                                                         |
| `ref.base_legal_tratamiento`                | tabla                                                                 | 5 bases legales con finalidad, plazo, norma, artículo, sustento y vigencia.                                                                                                                       |
| `ref.base_legal_evidencia`                  | tabla                                                                 | Vínculo base legal con fragmento del corpus, con rol `SUSTENTO`, `CONDICION`, `PLAZO` o `EXCEPCION`.                                                                                              |
| `ref.vw_base_legal_fuente`                  | vista                                                                 | Base legal con su fragmento y el documento de origen.                                                                                                                                             |
| `core.actor_datos_personales.base_legal_id` | columna `smallint` y FK                                               | Base legal del tratamiento. Sustituye al texto libre `base_legal`.                                                                                                                                |
| `ref.nivel_identificacion`                  | vista                                                                 | Alias de `core.cat_nivel_identificacion` con el nombre que usa el plan del MVP.                                                                                                                   |

---

## 3. Las cinco brechas, una por una

| Brecha                                   | Antes                                                                                                      | Después                                                                                                                | Cómo se verifica                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| RF-A03 · RLS inerte                      | La aplicación usaba `avisa`, superusuario con `BYPASSRLS`. Ninguna política limitaba ese rol.              | Rol `avisa_app` sin `BYPASSRLS`; 81 tablas con RLS forzada; privilegios acotados por esquema.                          | `pg_roles.rolbypassrls = false`. Con `SET ROLE avisa_app`, la bitácora devuelve 0 filas sin `app.rol_codigo` y 3 088 con `auditor`.   |
| RF-A04 · auditoría legible y borrable    | No tenía RLS. El `DELETE` solo lo frenaban los triggers del parche 9, que el propietario puede desactivar. | `ENABLE` y `FORCE`; solo políticas de `INSERT` y `SELECT`; los triggers append-only del parche 9 siguen activos.       | `DELETE ... WHERE false` devuelve «append-only: DELETE no está permitido». `has_table_privilege('avisa_app', ..., 'DELETE') = false`. |
| RF-D01 · alerta sin estado               | El CHECK de `tipo_origen` solo admitía `caso` y `reporte`. Las alertas no entraban al motor.               | CHECK admite `alerta`; 4 pasos de flujo; trigger de alta; 155 filas de proceso cubren las 83 alertas; vista de estado. | 83 alertas y 0 sin proceso. `vw_alerta_estado` devuelve 83 filas, todas `EST-02`.                                                     |
| §12.4 · niveles 4 y 5 georreferenciables | No había restricción geográfica ni de datos personales por nivel.                                          | CHECK `ck_actor_sin_geo_si_no_identificado` y trigger `trg_pii_solo_identificados`.                                    | Definición del CHECK. 1 160 de 1 160 actores lo cumplen. Un `UPDATE` de prueba a nivel 4 con región es rechazado.                     |
| §12.5 · base legal sin sustento          | `base_legal` era texto libre con un solo valor de migración.                                               | Catálogo `ref.base_legal_tratamiento`; columna `base_legal_id`; tabla de evidencia y vista de fuente.                  | 5 bases, 847 de 847 registros con `base_legal_id = 5` y 0 evidencias enlazadas.                                                       |

---

## 4. Cifras reales

| Dato                                            | Valor                                                | Consulta                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tablas y vistas del parche                      | 8 de 8 existen                                       | `SELECT o, to_regclass(o) IS NOT NULL FROM unnest(ARRAY['core.cat_nivel_identificacion','core.actor_alias','core.vw_alerta_estado','core.vw_actor_territorio','ref.base_legal_tratamiento','ref.base_legal_evidencia','ref.vw_base_legal_fuente','ref.nivel_identificacion']) o;` |
| Funciones, triggers y CHECK                     | 3 funciones, 2 triggers y todos los CHECK del parche | `SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='core' AND proname IN ('puede_auditar','tg_alerta_nace','tg_pii_solo_identificados');` y consultas análogas sobre `pg_trigger` y `pg_constraint`.                                          |
| Índices nuevos                                  | 6 de 6 existen                                       | `SELECT indexname FROM pg_indexes WHERE indexname IN ('ix_actores_region','ix_actores_distrito','ix_actor_alias_actor','ix_lugar_actores_lugar','ix_lugar_actores_vigencia','ix_base_legal_evidencia_fragmento');`                                                                |
| Versión del motor                               | 16.14                                                | `SELECT version();`                                                                                                                                                                                                                                                               |
| `avisa_app`: superusuario / `BYPASSRLS` / login | `false` / `false` / `false`                          | `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname='avisa_app';`                                                                                                                                                                                             |
| `avisa`: superusuario / `BYPASSRLS`             | `true` / `true`                                      | `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='avisa';`                                                                                                                                                                                                              |
| Tablas con RLS activa y forzada                 | 81 y 81                                              | `SELECT count(*) FROM pg_class WHERE relrowsecurity AND relkind='r';` y `... relforcerowsecurity ...`                                                                                                                                                                             |
| Políticas totales en la base                    | 520                                                  | `SELECT count(*) FROM pg_policies;`                                                                                                                                                                                                                                               |
| Políticas sobre la bitácora                     | 2                                                    | `SELECT count(*) FROM pg_policies WHERE schemaname='audit' AND tablename='datos_personales_acceso';`                                                                                                                                                                              |
| Filas de la bitácora                            | 3 088                                                | `SET ROLE avisa_app; SELECT set_config('app.rol_codigo','auditor',false); SELECT count(*) FROM audit.datos_personales_acceso; RESET ROLE;`                                                                                                                                        |
| Alertas cargadas                                | 83                                                   | `SELECT count(*) FROM core.alertas_tempranas;`                                                                                                                                                                                                                                    |
| Filas de proceso de tipo `alerta`               | 155                                                  | `SELECT count(*) FROM core.proceso_instancia WHERE tipo_origen='alerta';`                                                                                                                                                                                                         |
| Alertas con proceso                             | 83                                                   | `SELECT count(DISTINCT alerta_id) FROM core.proceso_instancia WHERE tipo_origen='alerta';`                                                                                                                                                                                        |
| Alertas sin proceso                             | 0                                                    | `SELECT count(*) FROM core.alertas_tempranas a WHERE NOT EXISTS (SELECT 1 FROM core.proceso_instancia p WHERE p.tipo_origen='alerta' AND p.alerta_id=a.id);`                                                                                                                      |
| Filas en paso 1 y alertas cubiertas             | 72 y 57                                              | `SELECT orden, count(*), count(DISTINCT alerta_id) FROM core.proceso_instancia WHERE tipo_origen='alerta' GROUP BY orden;`                                                                                                                                                        |
| Filas en paso 4 (cierre)                        | 83                                                   | Misma consulta anterior, fila `orden = 4`.                                                                                                                                                                                                                                        |
| Cierres sin paso previo                         | 26                                                   | `SELECT count(*) FROM core.proceso_instancia WHERE codigo_legado LIKE 'ALERTA-%-CIERRE' AND nota LIKE '%no registra ningún paso%';`                                                                                                                                               |
| Filas convertidas de `reporte` a `alerta`       | 72, cubren 57 alertas                                | `SELECT count(*), count(DISTINCT alerta_id) FROM core.proceso_instancia WHERE tipo_origen='alerta' AND nota LIKE '%código de reporte heredado%';`                                                                                                                                 |
| Pasos del flujo de alerta                       | 4                                                    | `SELECT count(*) FROM core.flujo_definicion WHERE tipo_flujo='alerta';`                                                                                                                                                                                                           |
| Filas totales de `core.proceso_instancia`       | 218 (36 caso, 27 reporte, 155 alerta)                | `SELECT tipo_origen, count(*) FROM core.proceso_instancia GROUP BY tipo_origen;`                                                                                                                                                                                                  |
| Niveles de identificación                       | 5                                                    | `SELECT count(*) FROM core.cat_nivel_identificacion;`                                                                                                                                                                                                                             |
| Actores por nivel 1, 3 y 4–5                    | 642, 518 y 0                                         | `SELECT nivel_identificacion_id, count(*) FROM core.actores GROUP BY 1 ORDER BY 1;`                                                                                                                                                                                               |
| Actores con región y con distrito               | 236 y 0                                              | `SELECT count(*) FROM core.actores WHERE region_id IS NOT NULL;` y `... distrito_id IS NOT NULL;`                                                                                                                                                                                 |
| Alias registrados                               | 143, todos de tipo `ABREVIATURA`                     | `SELECT tipo, count(*) FROM core.actor_alias GROUP BY tipo;`                                                                                                                                                                                                                      |
| Enlace territorial fino                         | 0 filas en `territorio.lugar_actores`                | `SELECT count(*) FROM territorio.lugar_actores;`                                                                                                                                                                                                                                  |
| Bases legales del catálogo                      | 5                                                    | `SELECT count(*) FROM ref.base_legal_tratamiento;`                                                                                                                                                                                                                                |
| Evidencias de base legal                        | 0                                                    | `SELECT count(*) FROM ref.base_legal_evidencia;`                                                                                                                                                                                                                                  |
| Registros de PII con `base_legal_id`            | 847 de 847, todos con el valor 5                     | `SELECT count(*) FILTER (WHERE base_legal_id = 5), count(*) FROM core.actor_datos_personales;`                                                                                                                                                                                    |
| Documentos y fragmentos del KAG                 | 10 y 0                                               | `SELECT count(*) FROM kag.documento_fuente;` y `... kag.documento_fragmento;`                                                                                                                                                                                                     |
| Tabla `core.base_legal`                         | no existe                                            | `SELECT to_regclass('core.base_legal');` devuelve nulo.                                                                                                                                                                                                                           |

---

## 5. Cómo se reproduce

Aplicación del parche, pasando el archivo por entrada estándar para evitar los
problemas de ruta de MSYS:

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < docs/PARCHE_14_CIERRE_ERS.sql
```

El bloque 6 imprime un resumen por secciones: seguridad, alertas, identificación,
territorio y base legal. Si alguna cifra no cuadra, emite `WARNING`; no corrige
datos.

Verificaciones de solo lectura: las consultas de §4. Las pruebas negativas se
hacen en transacción con `ROLLBACK`:

```sql
-- La bitácora rechaza DELETE
BEGIN;
DELETE FROM audit.datos_personales_acceso WHERE false;
ROLLBACK;

-- Un nivel 4 no puede tener región
BEGIN;
UPDATE core.actores
   SET nivel_identificacion_id = 4,
       caso_ancla_id = (SELECT id FROM core.casos ORDER BY id LIMIT 1),
       region_id = (SELECT id FROM core.regiones ORDER BY id LIMIT 1)
 WHERE actor_uid = (SELECT actor_uid FROM core.actores ORDER BY actor_uid LIMIT 1);
ROLLBACK;

-- RLS con el rol de aplicación
SET ROLE avisa_app;
SELECT count(*) FROM audit.datos_personales_acceso;              -- 0
SELECT set_config('app.rol_codigo','auditor',false);
SELECT count(*) FROM audit.datos_personales_acceso;              -- 3 088
RESET ROLE;
```

Resultados obtenidos: `DELETE` falla con «append-only: DELETE no está permitido»;
el `UPDATE` a nivel 4 falla con `check_violation` de
`ck_actor_sin_geo_si_no_identificado`; la lectura con `avisa_app` devuelve 0 y
3 088 filas según el parámetro de sesión.

El parche no se re-ejecutó durante esta verificación. Su idempotencia se apoya en
las guardas del archivo (`IF NOT EXISTS`, `ON CONFLICT`, `DROP ... IF EXISTS` y
`NOT EXISTS` en los rellenos) y no se midió aquí.

---

## 6. Lo que el SQL no resuelve

### 6.1 El corpus del KAG está vacío

`kag.documento_fragmento` tiene 0 filas y `kag.documento_fuente` tiene 10.
`ref.base_legal_evidencia` queda en 0 filas y `ref.vw_base_legal_fuente` no
devuelve ninguna. El parche crea el vínculo, no lo puebla.

El ERS v0.6, sección 14.3.3, deja el esquema `kag` fuera del MVP y lo retoma en
2027 con CT-07; las tres tablas de `kag` entran en la migración solo para que la
clave ajena de `ref.base_legal_evidencia` tenga destino. Segmentar y cargar el
corpus es un trabajo aparte, sin `H-xx` asignado en el ERS.

### 6.2 La base legal definitiva sigue pendiente

Los 847 registros de PII apuntan a `LEGADO_AVISA_2026`, que el propio SQL describe
como marca de migración y no como base del artículo 14 de la Ley 29733. Sustituirla
por la base definitiva exige dictamen de Asesoría Jurídica y de la OGTI (H-04; el
SQL cita además la decisión D49).

### 6.3 Los plazos de conservación son propuesta

`plazo_conservacion_meses` tiene 60, 120, 60, 120 y 24 meses según la base. El
ERS deja abierto cuánto se conserva cada tipo de dato (H-42).

### 6.4 Los niveles 4 y 5 no se ejercen

Hoy no hay ningún actor en nivel 4 o 5. La regla del §12.4 se cumple de forma
vacía: 1 160 de 1 160 actores están en niveles 1 o 3. Clasificar actores sin
documento es una decisión de la OAIPCS, no del esquema. El trigger de PII tampoco
se puede probar con datos reales por la misma razón.

### 6.5 La identidad de la sesión depende de la aplicación

`core.puede_auditar()` lee `app.rol_codigo`, un parámetro que fija la aplicación.
La base no autentica a nadie ni demuestra quién lo fijó. Es la misma limitación
L2/L3 del informe P9; mientras no exista un rol de base por funcionario, la
bitácora no identifica a la persona que consultó.

### 6.6 El rol de aplicación no está impuesto

`avisa_app` existe y no puede saltarse RLS, pero nada obliga a la aplicación a
usarlo. Si se conecta como `avisa` (superusuario con `BYPASSRLS`), las políticas
vuelven a ser inertes. La separación efectiva exige que la cadena de conexión use
un rol limitado, o que la sesión haga `SET ROLE avisa_app` antes de consultar.

### 6.7 Privilegios para tablas futuras

Los `GRANT ... ON ALL TABLES IN SCHEMA` del bloque 1 solo alcanzan a las tablas
existentes cuando corre el parche. Las tablas nuevas necesitan `ALTER DEFAULT
PRIVILEGES` para heredar permisos de `avisa_app`; el archivo no lo hace.

### 6.8 Borrado de alertas con proceso

`proceso_instancia_alerta_id_fkey` no tiene `ON DELETE CASCADE`, a diferencia de
la clave de caso. Una alerta con filas de proceso no se puede borrar sin borrar
antes esas filas. El parche no cambia esa clave.

### 6.9 La bitácora se puede falsear

La política `p_audit_insert` usa `WITH CHECK true`: cualquier rol con `INSERT`
puede añadir filas a la bitácora. El append-only impide borrar y modificar, no
inventar. La integridad real exige enviar la evidencia fuera del servidor.

### 6.10 La cobertura territorial es parcial

Solo 236 de 1 160 actores tienen departamento. Las causas medidas: 334 actores no
provienen de `legacy.dim_actores`; hay 587 emparejamientos con `c13` vacío y 3 con
un departamento que no existe en el modelo («Lima Provincias» y «Más de Uno»).
`distrito_id` sigue en 0 y `territorio.lugar_actores` en 0. El parche no inventa
distritos, como declara su encabezado.

### 6.11 Discrepancias entre el encabezado y la base viva

- El encabezado cita la ERS v0.4; en `docs/` solo existe la v0.6. El parche se
  redactó contra una versión anterior del documento.
- El encabezado dice que había 173 políticas. Hoy la base tiene 520 en total y
  303 en `core`; no es una cifra actual.
- El encabezado dice que la bitácora «se podía borrar». Los triggers append-only
  del parche 9 ya rechazaban `DELETE` a cualquier sesión; lo que faltaba era RLS
  y la restricción de privilegios.
- No existe una tabla `core.base_legal`. El catálogo es
  `ref.base_legal_tratamiento` y el texto heredado vive en la columna
  `core.actor_datos_personales.base_legal`.
