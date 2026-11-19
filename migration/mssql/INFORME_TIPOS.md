# Informe de tipos · Paso 3 · `avisa_mssql` → SQL Server

Medición hecha el **2026-11-19** sobre la base `avisa_mssql` (PostgreSQL 16.14,
contenedor `avisa-db`, puerto host `55433`), con el alcance del MVP **cerrado por
dependencias**: **74 tablas** —las 37 declaradas en `00_alcance_mvp.sql`, las 36
incorporadas para que ninguna clave ajena quede sin destino y `core.banco_datos_tratamiento`,
creada por el parche 16— y `legacy` con sus 87 tablas.

Todas las cifras de este informe salen del catálogo de PostgreSQL y de
`count(*)` sobre las tablas; ninguna es estimada.

Cómo se midió (reproducible):

```sh
cd C:\Users\Julia\Downloads\avisa
docker compose exec -T db psql -U avisa -d avisa_mssql -c "SELECT ..."
```

> Las cuentas de filas se tomaron con el rol `avisa`, que es superusuario
> (`rolsuper` y `rolbypassrls`), de modo que las políticas RLS **no** recortan
> los resultados. Si se midiera con el rol de la aplicación, varias tablas
> devolverían 0 filas sin dar error.

---

## 0. Por qué el alcance pasó de 37 a 74 tablas

El paso 1 recortaba el MVP a 37 tablas elegidas por prioridad, tabla por tabla.
Ese criterio deja columnas que apuntan a tablas que ya no existen: el esquema no
se puede migrar ni consultar, porque cada `*_id` se queda sin el catálogo que le
da sentido y los `JOIN` de la aplicación no tienen a qué unirse.

Medido sobre la copia completa (`avisa`): de las 37 tablas declaradas salen 113
claves ajenas, y **34 de ellas apuntaban a tablas de esos mismos esquemas que
quedaban fuera del alcance**. Son 34 columnas huérfanas sobre 25 tablas padre
distintas (otras 4 apuntan a esquemas de 2027 y se descartan a propósito).
Muestra:

| Columna huérfana (con alcance de 37)        | Padre que faltaba             |
| ------------------------------------------- | ----------------------------- |
| `core.casos.region_principal_id`            | `core.regiones`               |
| `core.actores.region_id`                    | `core.regiones`               |
| `core.usuarios.unidad_id`                   | `core.cat_unidades_organicas` |
| `core.casos.unidad_responsable_id`          | `core.cat_unidades_organicas` |
| `core.distritos.provincia_id`               | `core.provincias`             |
| `core.compromisos.documento_origen_id`      | `core.documentos`             |
| `core.actor_datos_personales.base_legal_id` | `ref.base_legal_tratamiento`  |

La corrección (bloque 1.2 de `00_alcance_mvp.sql`) recorre el grafo de claves
ajenas desde las 37 tablas y añade automáticamente cada padre que falte, una y
otra vez, hasta que no queda ninguna arista por cerrar. La recursión se detiene
en los esquemas diferidos a 2027 (`chat`, `ctx`, `analisis`, `territorio`, `lex`,
`mype`, `pesca`, `economic`, `impact`, `community`, `forecast`, `consultation`,
`proteccion`, `domain`, `model`, `config`, `avisa`), para no arrastrar medio
producto del año que viene a una migración de diciembre.

Resultado: **74 tablas** = 37 declaradas + 36 incorporadas + la tabla nueva
`core.banco_datos_tratamiento` (parche 16). De esas 36, dos son las de `ref`
(se siembran enteras porque sostienen la base legal) y 34 son
padres alcanzados por el cierre, algunos de segundo salto —por ejemplo
`core.cat_tipos_documento`, que entra porque `core.documentos` la necesita— y
tres de `kag`, que cuelgan de `ref.base_legal_evidencia`.

Qué se evitó, en una frase: un esquema que SSMA migra sin protestar y que la
aplicación no puede usar. Hoy **las 156 claves ajenas del alcance tienen destino
dentro del alcance**. Las únicas columnas sin padre son 6 que apuntan a esquemas
de 2027 y que se listan en §2.10.

---

## 1. Cifras clave

| Categoría                                                                                              |                       Cifra medida |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------: |
| Tablas en `avisa_mssql` (antes del paso 1: 371)                                                        |                            **162** |
| Tablas del alcance (37 declaradas + 36 por dependencias + parche 16)                                   |                             **74** |
| Tablas de `legacy`                                                                                     |                             **87** |
| Columnas en las 74 tablas del alcance                                                                  |                            **651** |
| Columnas en `legacy`                                                                                   |                            **807** |
| Columnas `uuid` en el alcance                                                                          |                            **115** |
| Columnas `uuid` con `DEFAULT` (antes del paso 3; hoy **0**)                                            | **25** (todas `gen_random_uuid()`) |
| Columnas `uuid` con `DEFAULT uuid_generate_v4()`                                                       |                              **0** |
| Columnas `json` / `jsonb`                                                                              |                         **0 / 12** |
| Columnas de tipo array                                                                                 |                              **0** |
| Columnas `timestamptz` (alcance; `legacy` aporta 1 más)                                                |                             **46** |
| Columnas `timestamptz` con `DEFAULT now()`                                                             |                             **36** |
| Columnas `timestamp without time zone`                                                                 |                              **0** |
| Enums / dominios / tipos compuestos reales                                                             |                      **0 / 0 / 0** |
| Columnas `bytea`                                                                                       |                              **4** |
| Columnas `vector`, `tsvector`, `inet`, `cidr`, `macaddr`, `interval`, rangos, `hstore`, `xml`, `money` |           **0 en todos los casos** |
| Columnas generadas (`GENERATED ALWAYS AS ... STORED`)                                                  |                              **0** |
| Columnas `IDENTITY`                                                                                    |                              **3** |
| Columnas `serial` (restos de secuencia)                                                                |                              **8** |
| Claves ajenas (todas con destino dentro del alcance)                                                   |                            **156** |
| Tablas con RLS activa **y** forzada                                                                    |                             **28** |
| Políticas RLS                                                                                          |                            **189** |
| Triggers (no internos)                                                                                 |                             **25** |
| Índices parciales                                                                                      |                             **10** |
| Comentarios de objeto + de columna                                                                     |                            **704** |
| Filas en las 74 tablas del alcance                                                                     |                          **8 244** |
| Filas en `legacy` (87 tablas)                                                                          |                          **4 729** |

Reparto de los 651 tipos de columna del alcance:

| Tipo                       | Columnas |
| -------------------------- | -------: |
| `character varying`        |  **202** |
| `uuid`                     |  **115** |
| `smallint`                 |   **99** |
| `timestamp with time zone` |   **46** |
| `integer`                  |   **39** |
| `text`                     |   **42** |
| `date`                     |   **33** |
| `boolean`                  |   **29** |
| `numeric`                  |   **16** |
| `jsonb`                    |   **12** |
| `character`                |   **12** |
| `bytea`                    |    **4** |
| `bigint`                   |    **2** |
| **Total**                  |  **651** |

Aclaración sobre el reparto: si se cuenta con `information_schema.columns` en
lugar de con `pg_attribute`, salen 672 columnas porque se cuelan las 3 vistas del
alcance (21 columnas en total). Los tipos de arriba son
los de las 74 tablas y suman 651, que es el número correcto.

Composición por esquema (162 tablas):

| Esquema   | Tablas | Nota                                  |
| --------- | -----: | ------------------------------------- |
| `core`    |     54 | 31 declaradas + 22 padres + parche 16 |
| `legacy`  |     87 | fuera del MVP, se conserva            |
| `policy`  |      7 | 1 declarada + 6 padres                |
| `ind`     |      3 | 1 declarada + 2 padres                |
| `kag`     |      3 | padres de `ref.base_legal_evidencia`  |
| `qda`     |      2 | 1 declarada + `proyecto`              |
| `ref`     |      2 | se conserva entero                    |
| `agent`   |      1 |                                       |
| `audit`   |      1 |                                       |
| `staging` |      1 |                                       |
| `public`  |      1 | `spatial_ref_sys`, de PostGIS         |

---

## 2. Inventario por categoría

### 2.1 · `uuid` y su `DEFAULT`

115 columnas `uuid` en el alcance (0 en `legacy`, que es todo texto y entero).
De ellas **25 tenían `DEFAULT`**, todas con `gen_random_uuid()`. Hoy **ninguna
lo conserva**: lo retiró el paso 3. La columna 115 es
`ref.base_legal_tratamiento.banco_datos_id`, que nació sin `DEFAULT` y apunta al
único banco de datos: las 5 bases legales existentes quedaron con
`banco_datos_id = 1`.

`uuid_generate_v4()` **no aparece** en ninguna parte: la extensión `uuid-ossp`
no está instalada. `gen_random_uuid()` es nativa desde PostgreSQL 13, así que
`pgcrypto` no hace falta para esto.

Las 25 columnas, con las filas de su tabla:

| Esquema.Tabla                | Columna     | PK        | DEFAULT original    | Filas |
| ---------------------------- | ----------- | --------- | ------------------- | ----: |
| `agent.run_log`              | `id`        | compuesta | `gen_random_uuid()` |     0 |
| `core.actor_membresia`       | `id`        | única     | `gen_random_uuid()` |   292 |
| `core.actores`               | `actor_uid` | única     | `gen_random_uuid()` | 1 160 |
| `core.alertas_tempranas`     | `id`        | única     | `gen_random_uuid()` |    83 |
| `core.caso_cronologia`       | `id`        | única     | `gen_random_uuid()` |    80 |
| `core.caso_estado_historial` | `id`        | única     | `gen_random_uuid()` |    35 |
| `core.casos`                 | `id`        | única     | `gen_random_uuid()` |    35 |
| `core.compromisos`           | `id`        | única     | `gen_random_uuid()` |     8 |
| `core.documentos`            | `id`        | única     | `gen_random_uuid()` |   153 |
| `core.hitos_compromiso`      | `id`        | única     | `gen_random_uuid()` |    12 |
| `core.mesas_dialogo`         | `id`        | única     | `gen_random_uuid()` |    21 |
| `core.output_contracts`      | `id`        | única     | `gen_random_uuid()` |     0 |
| `core.permiso_aprobacion`    | `id`        | única     | `gen_random_uuid()` |     0 |
| `core.reuniones_dialogo`     | `id`        | única     | `gen_random_uuid()` |     0 |
| `core.usuarios`              | `id`        | única     | `gen_random_uuid()` |    32 |
| `ind.indicador`              | `id`        | única     | `gen_random_uuid()` |     0 |
| `ind.resultado`              | `id`        | única     | `gen_random_uuid()` |     0 |
| `ind.variante`               | `id`        | única     | `gen_random_uuid()` |     0 |
| `kag.documento_fragmento`    | `id`        | única     | `gen_random_uuid()` |     0 |
| `kag.documento_fuente`       | `id`        | única     | `gen_random_uuid()` |    10 |
| `policy.escenario`           | `id`        | única     | `gen_random_uuid()` |     0 |
| `policy.regla`               | `id`        | única     | `gen_random_uuid()` |    10 |
| `policy.snapshot`            | `id`        | única     | `gen_random_uuid()` |     0 |
| `qda.proyecto`               | `id`        | única     | `gen_random_uuid()` |     0 |
| `staging.lote`               | `id`        | única     | `gen_random_uuid()` |     0 |

Las 25 generan su propio identificador y las 25 son miembros de la clave
primaria. Veinticuatro son `PRIMARY KEY` de una sola columna; la excepción es
`agent.run_log.id`, que va en la PK compuesta `(id, ts)` heredada de la tabla
particionada que el paso 1 aplanó (de ahí que su PK se llame
`run_log_simple_pkey`). En SQL Server el `DEFAULT` recomendado sigue siendo
`NEWSEQUENTIALID()` en las 25.

El resto de columnas `uuid` (90) nunca tuvo `DEFAULT`: o las rellena la
aplicación, o heredan el valor de la clave de otra tabla (por ejemplo
`core.actor_datos_personales.actor_uid`, `core.reunion_participantes.actor_uid`,
`core.organizaciones.actor_uid`). Ponerles un `DEFAULT` en SQL Server rompería
esa herencia.

### 2.2 · `json` / `jsonb`

`json`: **0 columnas**. `jsonb`: **12 columnas** en 11 tablas.

| Esquema.Tabla                   | Columna                   | DEFAULT       | Filas |
| ------------------------------- | ------------------------- | ------------- | ----: |
| `agent.run_log`                 | `detalle`                 | —             |     0 |
| `audit.datos_personales_acceso` | `contexto`                | `'{}'::jsonb` | 3 088 |
| `core.alertas_tempranas`        | `acciones_sugeridas_json` | —             |    83 |
| `core.alertas_tempranas`        | `riesgos_json`            | —             |    83 |
| `core.cat_tipos_documento`      | `esquema_json`            | —             |    15 |
| `core.compromisos`              | `criterios_smart`         | —             |     8 |
| `core.documentos`               | `contenido_json`          | `'{}'::jsonb` |   153 |
| `core.output_contracts`         | `response_json`           | —             |     0 |
| `ind.variante`                  | `especificacion`          | `'{}'::jsonb` |     0 |
| `policy.cat_tipos_regla`        | `esquema_json`            | —             |     5 |
| `policy.regla`                  | `parametros`              | `'{}'::jsonb` |    10 |
| `staging.lote`                  | `validacion`              | —             |     0 |

Cuatro de las doce llevan `DEFAULT '{}'::jsonb`:
`audit.datos_personales_acceso.contexto`, `core.documentos.contenido_json`,
`ind.variante.especificacion` y `policy.regla.parametros`.

### 2.3 · Arrays

**No hay columnas de tipo array en el alcance.** Quedaba una, y el paso 3 la
convirtió: `policy.cat_tipos_regla.claves_requeridas` pasó de `text[]` a `text`
con JSON dentro. El recuento es 0 tanto en las 74 tablas como en las 87 de
`legacy`. La única función del esquema que devuelve arrays (`ARRAY[...]` en
`prosrc`) es código PL/pgSQL, no una columna.

Detalle a no perder: el `DEFAULT` de esa columna **sobrevivió** al cambio de
tipo y sigue siendo `'{}'::text[]`, una expresión de tipo `text[]` sobre una
columna `text`. Producir, produce `{}` (la conversión `text[] → text` funciona
por I/O), pero conviene dejarlo explícito con `SET DEFAULT '{}'` o quitarlo.

### 2.4 · `timestamptz` frente a `timestamp without time zone`

**46 columnas `timestamptz`** en 27 tablas del alcance.
**0 columnas `timestamp without time zone`**: todo el esquema guarda instantes
con huso. `legacy` aporta 1 columna `timestamptz` más (47 en total).
36 de las 46 tienen `DEFAULT now()`.

| Esquema.Tabla                   | Columnas `timestamptz` | Con `now()` |                                                                 Filas |
| ------------------------------- | ---------------------: | ----------: | --------------------------------------------------------------------: |
| `agent.run_log`                 |                      1 |           1 |                                                                     0 |
| `audit.datos_personales_acceso` |                      1 |           1 |                                                                 3 088 |
| `core.actor_datos_personales`   |                      1 |           1 |                                                                   847 |
| `core.actores`                  |                      2 |           2 |                                                                 1 160 |
| `core.alertas_tempranas`        |                      2 |           2 |                                                                    83 |
| `core.banco_datos_tratamiento`  |                      2 |           2 |                                                                     1 |
| `core.caso_cronologia`          |                      2 |           2 |                                                                    80 |
| `core.caso_estado_historial`    |                      2 |           1 |                                                                    35 |
| `core.casos`                    |                      3 |           3 |                                                                    35 |
| `core.compromisos`              |                      2 |           2 |                                                                     8 |
| `core.documentos`               |                      2 |           2 |                                                                   153 |
| `core.log_accesos`              |                      1 |           0 |                                                                   857 |
| `core.mesas_dialogo`            |                      2 |           2 |                                                                    21 |
| `core.organizaciones`           |                      1 |           0 |                                                                   224 |
| `core.output_contracts`         |                      1 |           1 |                                                                     0 |
| `core.reuniones_dialogo`        |                      3 |           2 |                                                                     0 |
| `core.usuarios`                 |                      1 |           1 |                                                                    32 |
| `ind.resultado`                 |                      3 |           2 |                                                                     0 |
| `ind.variante`                  |                      1 |           1 |                                                                     0 |
| `kag.documento_fuente`          |                      1 |           1 |                                                                    10 |
| `policy.escenario`              |                      1 |           1 |                                                                     0 |
| `policy.regla`                  |                      4 |           2 |                                                                    10 |
| `policy.snapshot`               |                      3 |           1 |                                                                     0 |
| `qda.proyecto`                  |                      1 |           0 |                                                                     0 |
| `ref.base_legal_evidencia`      |                      1 |           1 |                                                                     0 |
| `ref.base_legal_tratamiento`    |                      1 |           1 |                                                                     5 |
| `staging.lote`                  |                      1 |           1 |                                                                     0 |
| **Total**                       |                 **46** |      **36** | **6 649** (filas de las tablas afectadas, cada tabla contada una vez) |

### 2.5 · Tipos definidos por el usuario

| Tipo                                                     | Cifra |
| -------------------------------------------------------- | ----: |
| `CREATE TYPE ... AS ENUM`                                | **0** |
| Dominios (`CREATE DOMAIN`)                               | **0** |
| Tipos compuestos explícitos (`CREATE TYPE ... AS (...)`) | **0** |

Aclaración importante: el catálogo devuelve 169 entradas de `pg_type` con
`typtype = 'c'`. **No son tipos compuestos de usuario**: son el tipo-fila
implícito que PostgreSQL crea por cada tabla y por cada vista. Ninguna columna
del esquema usa un tipo compuesto.

Las etiquetas de estado, nivel y clasificación no son enums: son `smallint`
con `CHECK` o catálogos (`core.cat_estados_caso`, `core.cat_niveles_riesgo`,
etc.). Eso es buena noticia para SSMA, porque los enums son uno de sus puntos
débiles.

### 2.6 · Tipos especiales

| Tipo                                            | Columnas | Detalle                                                                                                                                                                          |
| ----------------------------------------------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vector` (pgvector)                             |    **0** | Extensión instalada, sin uso en el alcance                                                                                                                                       |
| `tsvector`                                      |    **0** | —                                                                                                                                                                                |
| `bytea`                                         |    **4** | `core.actor_datos_personales` (847 filas): `dni_cifrado` (72–75 bytes), `dni_hmac` (32 exactos), `email_cifrado` (76–102), `telefono_cifrado` (67–99). `legacy` no tiene ninguno |
| `inet` / `cidr`                                 |    **0** | —                                                                                                                                                                                |
| `macaddr` / `macaddr8`                          |    **0** | —                                                                                                                                                                                |
| `interval`                                      |    **0** | —                                                                                                                                                                                |
| Rangos (`int4range`, `tsrange`, `daterange`, …) |    **0** | —                                                                                                                                                                                |
| `hstore`                                        |    **0** | Extensión no instalada                                                                                                                                                           |
| `xml`                                           |    **0** | —                                                                                                                                                                                |
| `money`                                         |    **0** | —                                                                                                                                                                                |
| Geometría PostGIS (`geometry`, `geography`)     |    **0** | Extensión instalada, sin uso en el alcance                                                                                                                                       |

### 2.7 · Columnas generadas, `IDENTITY` y `serial`

| Tabla                           | Columna | Tipo       | Naturaleza                     | Filas |
| ------------------------------- | ------- | ---------- | ------------------------------ | ----: |
| `audit.datos_personales_acceso` | `id`    | `bigint`   | `GENERATED ALWAYS AS IDENTITY` | 3 088 |
| `core.log_accesos`              | `id`    | `bigint`   | `GENERATED ALWAYS AS IDENTITY` |   857 |
| `policy.titular`                | `id`    | `smallint` | `GENERATED ALWAYS AS IDENTITY` |     0 |
| `core.cat_roles_actor`          | `id`    | `integer`  | `serial` (`nextval`)           |     7 |
| `core.cat_subsectores`          | `id`    | `integer`  | `serial` (`nextval`)           |     3 |
| `core.cat_tematicas`            | `id`    | `integer`  | `serial` (`nextval`)           |     7 |
| `core.cat_tipos_actor`          | `id`    | `integer`  | `serial` (`nextval`)           |     7 |
| `core.cat_unidades_organicas`   | `id`    | `integer`  | `serial` (`nextval`)           |    66 |
| `core.distritos`                | `id`    | `integer`  | `serial` (`nextval`)           |   698 |
| `core.provincias`               | `id`    | `integer`  | `serial` (`nextval`)           |    70 |
| `core.regiones`                 | `id`    | `integer`  | `serial` (`nextval`)           |    25 |

Columnas generadas (`GENERATED ALWAYS AS (...) STORED`): **0**.

El cierre de dependencias añadió cuatro catálogos con `serial`
(`cat_roles_actor`, `cat_subsectores`, `cat_tematicas`,
`cat_unidades_organicas`), dos geográficas (`provincias`, `regiones`) y una
tabla con `IDENTITY` (`policy.titular`); de ahí que ahora sean 8 y 3, y no 2 y 2.

### 2.7.1 · Extensiones instaladas y dependencias reales

| Extensión    | Versión | ¿La usa alguna columna del alcance?                                               |
| ------------ | ------- | --------------------------------------------------------------------------------- |
| `plpgsql`    | 1.0     | Sí: 52 funciones (42 en PL/pgSQL)                                                 |
| `pgcrypto`   | 1.3     | Sí, indirectamente: `core.actor_datos_personales_descifrar` usa `pgp_sym_decrypt` |
| `postgis`    | 3.7.0   | **No**: 0 columnas `geometry`/`geography`                                         |
| `vector`     | 0.8.3   | **No**: 0 columnas `vector`                                                       |
| `btree_gist` | 1.7     | **No**: 0 constraints de exclusión                                                |
| `pg_trgm`    | 1.6     | **No**: los 222 índices son btree, ninguno usa `gin_trgm_ops`                     |

Medición: **0 columnas** tienen un tipo propiedad de una extensión. Es decir,
ningún tipo de PostGIS ni de pgvector llega a SQL Server; `pgcrypto` sólo
aparece dentro del cuerpo de una función.

### 2.8 · Objetos que SSMA no migra (conteo real en el alcance)

| Objeto                                  |                                        Cifra medida |
| --------------------------------------- | --------------------------------------------------: |
| Tablas con RLS activa **y** forzada     |                                              **28** |
| Políticas RLS                           |                                             **189** |
| Triggers (no internos)                  |                                              **25** |
| Funciones                               |                             **52** (42 en PL/pgSQL) |
| Vistas                                  | **13** (1 en `core`, 2 en `ref`, 10 en `analytics`) |
| Índices no asociados a constraints      |                                              **79** |
| — de ellos, parciales (`WHERE`)         |                                              **10** |
| — de ellos, por expresión               |                                               **0** |
| Constraints de exclusión (`EXCLUDE`)    |                                               **0** |
| Comentarios de objeto (tablas y vistas) |                                              **76** |
| Comentarios de columna                  |                                             **628** |

Detalle de RLS (28 tablas, 189 políticas). Veintitrés tablas llevan 7 políticas,
dos llevan 8 (`core.hitos_compromiso` y `core.output_contracts`), `core.log_accesos`
lleva 6, `staging.lote` 4 y `audit.datos_personales_acceso` 2:

| Tabla                           | Políticas |
| ------------------------------- | --------: |
| `audit.datos_personales_acceso` |         2 |
| `core.actor_datos_personales`   |         7 |
| `core.actor_membresia`          |         7 |
| `core.actores`                  |         7 |
| `core.alertas_actores`          |         7 |
| `core.alertas_tempranas`        |         7 |
| `core.banco_datos_tratamiento`  |         7 |
| `core.caso_cronologia`          |         7 |
| `core.caso_estado_historial`    |         7 |
| `core.casos`                    |         7 |
| `core.casos_actores`            |         7 |
| `core.compromiso_colaboradores` |         7 |
| `core.compromisos`              |         7 |
| `core.cronologia_vinculos`      |         7 |
| `core.documentos`               |         7 |
| `core.hitos_compromiso`         |         8 |
| `core.log_accesos`              |         6 |
| `core.mesas_dialogo`            |         7 |
| `core.organizaciones`           |         7 |
| `core.output_contracts`         |         8 |
| `core.reunion_participantes`    |         7 |
| `core.reuniones_dialogo`        |         7 |
| `kag.documento_fragmento`       |         7 |
| `kag.documento_fuente`          |         7 |
| `policy.regla`                  |         7 |
| `qda.mapeo_pseudonimo`          |         7 |
| `qda.proyecto`                  |         7 |
| `staging.lote`                  |         4 |
| **Total**                       |   **189** |

El parche 16 (bloque B.11) completó la cobertura de `core`: añadió RLS a las
tablas de detalle que heredan el nivel de su padre y a la tabla nueva
`core.banco_datos_tratamiento`. Por eso el alcance pasa de 15 a 28 tablas con RLS
y de 97 a 189 políticas.

Detalle de los 10 índices parciales — todos expresan reglas de negocio, no sólo
rendimiento:

| Índice                        | Tabla                        | Columnas                            | Predicado (`WHERE`)          | ¿Único? |
| ----------------------------- | ---------------------------- | ----------------------------------- | ---------------------------- | :-----: |
| `ux_usuarios_dni`             | `core.usuarios`              | `dni`                               | `dni IS NOT NULL`            |   sí    |
| `ux_caso_historial_vigente`   | `core.caso_estado_historial` | `caso_id`                           | `hasta IS NULL`              |   sí    |
| `ux_ind_resultado_vigente`    | `ind.resultado`              | `variante_id, distrito_id, periodo` | `superseded_at IS NULL`      |   sí    |
| `ux_regla_codigo_vigente`     | `policy.regla`               | `codigo`                            | `superseded_at IS NULL`      |   sí    |
| `entidades_codigo_legado_key` | `core.entidades`             | `codigo_legado`                     | `codigo_legado IS NOT NULL`  |   sí    |
| `ix_casos_activos`            | `core.casos`                 | —                                   | `estado_id IN (1,2)`         |   no    |
| `ix_hitos_por_vencer`         | `core.hitos_compromiso`      | —                                   | `estado_id NOT IN (4,5)`     |   no    |
| `ix_membresia_org`            | `core.actor_membresia`       | —                                   | `valid_to IS NULL`           |   no    |
| `ix_documentos_reunion`       | `core.documentos`            | —                                   | `reunion_id IS NOT NULL`     |   no    |
| `ix_output_chat_commit`       | `core.output_contracts`      | —                                   | `chat_commit_id IS NOT NULL` |   no    |

Los cinco únicos son los que importan: sin ellos se pueden crear dos estados
vigentes del mismo caso, dos resultados vigentes de la misma combinación
variante+distrito+periodo, dos códigos de regla vigentes, dos entidades con el
mismo código legado o dos usuarios con el mismo DNI.

Funciones por esquema: `core` 22, `kag` 16, `policy` 6, `ind` 3, `qda` 2,
`agent` 1, `audit` 1, `staging` 1. Las de `kag` no son decorativas: los
triggers `trg_actor_nace`, `trg_actor_renombra`, `trg_caso_nace` y
`trg_caso_renombra` llaman a `kag.actor_nace`, `kag.actor_renombra`,
`kag.caso_nace` y `kag.caso_renombra`.

Las 13 vistas: `core.v_actor_datos_personales_seguro`,
`ref.nivel_identificacion`, `ref.vw_base_legal_fuente` y diez objetos en
`analytics` (9 vistas y 1 vista materializada:
`mv_dashboard_alta_direccion`, `vw_anexo_02_panorama_regional`,
`vw_anexo_15_matriz_conflictividad`, `vw_anexo_16_registro_reuniones`,
`vw_anexo_17_registro_reportes`, `vw_casos_estancados`,
`vw_eravisa_survival`, `vw_erop_milestones`, `vw_geo_distrito`,
`vw_organizaciones_vigencia`). Sobrevivieron al recorte porque sólo leen tablas
que están en el alcance.

### 2.9 · Filas

Medidas con `count(*)`, tabla por tabla (no con `pg_stat_user_tables`, cuyo
`n_live_tup` puede quedarse corto):

| Conjunto                | Tablas |      Filas |
| ----------------------- | -----: | ---------: |
| Alcance (74 tablas)     |     74 |  **8 244** |
| `legacy`                |     87 |  **4 729** |
| **Total** (sin PostGIS) |    161 | **12 973** |

Las 8 244 filas salen de sumar el `count(*)` real de las 74 tablas del alcance
**sin** `public`: `public.spatial_ref_sys` es de PostGIS, tiene 8 500 filas y no
es dato de negocio, por eso no entra ni en la fila del alcance ni en el total.
Por eso el total de tablas de esta tabla es 161 (74 + 87) y no 162, que es el
recuento físico con PostGIS (§1). El incremento de 8 242 a 8 244 no viene sólo
de la tabla nueva: son la fila sembrada de `core.banco_datos_tratamiento` y una
fila nueva en `core.usuario_roles` (el rol `administrador` asignado a la
Oficial de Datos Personales).

Por esquema: `core` 5 120, `audit` 3 088, `ref` 5, `kag` 16, `policy` 15,
`ind` 0, `qda` 0, `agent` 0, `staging` 0, `legacy` 4 729.

Las tablas con volumen son `core.actores` (1 160), `audit.datos_personales_acceso`
(3 088), `core.log_accesos` (857), `core.actor_datos_personales` (847),
`core.distritos` (698), `core.actor_membresia` (292), `core.organizaciones`
(224), `core.alertas_tempranas` (83), `core.caso_cronologia` (80),
`core.provincias` (70) y `core.cat_unidades_organicas` (66). El resto son
catálogos por debajo de 60 filas o tablas vacías.

### 2.10 · Columnas que apuntan a esquemas diferidos

Seis columnas del alcance conservan su nombre `*_id` pero **ya no tienen clave
ajena**: su destino vive en un esquema de 2027 y el `DROP ... CASCADE` se llevó
la constraint. Siguen existiendo como columnas sueltas:

| Columna                                | Destino perdido          |
| -------------------------------------- | ------------------------ |
| `core.output_contracts.chat_commit_id` | `chat.commit`            |
| `core.output_contracts.snapshot_id`    | `ctx.snapshot`           |
| `ind.variante.variable_id`             | `ctx.cat_variables`      |
| `qda.proyecto.plan_paso_id`            | `analisis.plan_paso`     |
| `staging.lote.plan_paso_id`            | `analisis.plan_paso`     |
| `staging.lote.punto_ingesta_id`        | `analisis.punto_ingesta` |

El comentario de cabecera de `00_alcance_mvp.sql` habla de 4: era la cuenta con
el alcance de 37 tablas. Con el cierre son 6.

---

## 3. Qué se normalizó y qué se dejó igual

### 3.1 · Normalizado: `DEFAULT` de las 25 columnas `uuid`

`02_normalizar_tipos.sql` retiró el `DEFAULT` de las 25 columnas de la tabla
2.1, recorriendo el catálogo con un bloque `DO` que emite un `RAISE NOTICE`
por columna. Es sólo metadato: no reescribe datos ni bloquea las tablas.

**Por qué:** SSMA no traduce `gen_random_uuid()`. Al verlo, o aborta la
creación de la tabla o descarta el `DEFAULT` en silencio; en el segundo caso
el `.NET` descubre el problema en el primer `INSERT` que omita el `id`.

**Qué recrear en SQL Server:** `DEFAULT NEWSEQUENTIALID()` en las 25.
Veinticuatro son `PRIMARY KEY` de una sola columna y ese `DEFAULT` produce
valores monótonos (evita la fragmentación del índice clustered que provoca
`NEWID()`); `agent.run_log.id` va en la PK compuesta `(id, ts)` y admite el
mismo generador. `NEWSEQUENTIALID()` sólo funciona como `DEFAULT` de una
columna `uniqueidentifier`; en `UPDATE` hay que usar `NEWID()`.

### 3.2 · Normalizado: array → texto JSON

Había una columna array y el script la convirtió:
`policy.cat_tipos_regla.claves_requeridas` pasó de `text[]` a `text` mediante
`array_to_json(col)::text`, que produce JSON válido y sin pérdida de estructura.
Hoy el recuento de columnas array en todo `avisa_mssql` es **0**.

Si en el futuro el alcance incluyera otra, el bloque ya está escrito y la
detecta solo.

### 3.3 · Dejado igual: `jsonb`

Las 12 columnas `jsonb` quedan intactas a propósito. En origen se comparan e
indexan con operadores JSON; convertirlas a texto aquí sólo quitaría capacidad
a quien todavía consulte la base de staging.

**Mapeo en SSMA: `jsonb` → `nvarchar(max)`.**

Consecuencias al otro lado: no hay tipo JSON nativo, así que las consultas
pasan por `JSON_VALUE` / `OPENJSON`, o por columnas calculadas persistidas con
índice. El `CHECK` de origen se puede replicar barato con `ISJSON(col) = 1`
(equivalente a `CHECK (jsonb_typeof(col) = 'object')` si se quiere forzar
objeto). En EF Core hace falta `HasConversion<string>()` o un `ValueConverter`.

Ojo con los cuatro `DEFAULT '{}'::jsonb`: en SQL Server quedan como
`DEFAULT N'{}'` sobre `nvarchar(max)`.

### 3.4 · Dejado igual: `timestamptz`

No se tocó ninguna columna. Se recomienda mapear en SSMA:

```
timestamp with time zone  →  datetimeoffset(7)
```

Existe un bloque opcional, **desactivado por defecto**, que convierte a
`timestamp without time zone`. Sólo se ejecuta si la sesión activa
`avisa.convertir_timestamptz = 'on'`. **No se ha ejecutado nunca** sobre
`avisa_mssql`, a propósito: convertiría las 46 columnas y no habría vuelta
atrás sin recargar. El compromiso está explicado en el propio script: se
conserva la hora local de Lima (`AT TIME ZONE 'America/Lima'`, no el huso de
la sesión) pero **se pierde el offset**, y un instante de verano y otro de
invierno quedan indistinguibles. Úsese sólo si el destino no admite
`datetimeoffset`.

### 3.5 · Lo que quedó igual sin cambios

- `jsonb` (12).
- `bytea` (4): mapeo natural a `varbinary(max)`.
- `IDENTITY` (3): mapeo natural a `bigint` / `smallint` `IDENTITY(1,1)`.
- `serial` (8): mapeo natural a `int IDENTITY(1,1)`.
- `character(n)` (12: siete `char(64)`, un `char(11)`, un `char(6)`, un
  `char(4)`, un `char(2)` y un `char(1)`): mapeo a `char(n)`.
- Todos los `CHECK`, `FK` y `PK`: estructura, aunque SSMA los recrea con otro
  nombre.
- Los 36 `DEFAULT now()` de las columnas `timestamptz`: se dejan como están.

---

## 4. Riesgos para el equipo .NET

1. **Sin `DEFAULT` en origen, el `INSERT` falla en PostgreSQL.**
   Tras el paso 3, cualquier `INSERT` en `avisa_mssql` que omita el `id`
   revienta con
   `ERROR: null value in column "id" of relation "casos" violates not-null constraint`.
   Es intencionado (la base de staging es de sólo lectura para SSMA), pero si
   alguien apunta la aplicación o los tests a `avisa_mssql`, fallará. Para
   reponerlo en PostgreSQL:

   ```sql
   ALTER TABLE core.casos ALTER COLUMN id SET DEFAULT gen_random_uuid();
   ```

   (repetir con las 25 de la tabla 2.1).

2. **`datetime2` produce un desfase de 5 horas con Lima.**
   Si SSMA mapea `timestamptz` a `datetime2`, el desplazamiento desaparece. Un
   hecho ocurrido a las 09:00 en Lima (14:00 UTC) se guarda como `14:00` y el
   informe lo muestra como si hubiera ocurrido a las 14:00 de Lima. Afecta a
   las 46 columnas de la tabla 2.4, incluidas `audit.datos_personales_acceso`
   (3 088 filas) y `core.log_accesos` (857). **Usar `datetimeoffset(7)`**; en
   .NET se lee como `System.DateTimeOffset` sin conversiones manuales.

3. **Las protecciones de la PII no llegan a SQL Server.**
   SSMA no migra las 189 políticas RLS ni los 25 triggers. La migración de
   datos funciona porque `ssql_migrator` tiene `BYPASSRLS`, pero la aplicación
   .NET se conectará a un esquema **sin** seguridad por fila y **sin** los
   triggers de auditoría y de sólo-adición
   (`tg_append_only_row`, `tg_append_only_stmt`, `tg_append_only_truncate` en
   `audit.datos_personales_acceso`; `trg_pii_solo_identificados` y
   `tg_audit_datos_personales` en `core.actor_datos_personales`). Resultado:
   lectura de PII sin filtro por nivel de clasificación y bitácora de accesos
   que se puede editar o borrar. En SQL Server hay que reconstruirlo con
   Security Policies con función de predicado y `DENY UPDATE/DELETE` mediante
   roles.

4. **`pgcrypto` no existe en SQL Server: 847 registros con PII cifrada.**
   `core.actor_datos_personales` guarda `dni_cifrado`, `email_cifrado`,
   `telefono_cifrado` y `dni_hmac` como `bytea` (4 columnas, 847 filas).
   El **descifrado** sí está en la base (`core.actor_datos_personales_descifrar`,
   con `pgp_sym_decrypt`); el **cifrado** no aparece en el esquema: lo hace la
   aplicación. Al portar hay que localizar en el código .NET la llamada
   equivalente (`pgp_sym_encrypt` o una librería PGP) y sustituirla, porque
   SQL Server no tiene PGP simétrico. Opciones: Always Encrypted, cifrado en la
   aplicación con AES-GCM, o recifrado con backfill. Tamaños medidos:
   `dni_hmac` siempre 32 bytes (SHA-256, 642 de 847 filas lo tienen; 205 son
   NULL) → `varbinary(32)`; los cifrados van de 67 a 102 bytes →
   `varbinary(200)` o `varbinary(max)`. El índice
   `core.ix_actor_datos_personales_dni_hmac` es btree sobre `bytea` y en SQL
   Server sería un índice sobre `varbinary(32)`.

5. **Los 10 índices parciales son reglas de negocio, no rendimiento.**
   Los cinco únicos (`ux_usuarios_dni`, `ux_caso_historial_vigente`,
   `ux_ind_resultado_vigente`, `ux_regla_codigo_vigente`,
   `entidades_codigo_legado_key`) impiden duplicados que hoy no existen
   precisamente porque el índice los bloquea. En SQL Server deben ser
   **filtered indexes**; SSMA no los genera.

6. **Colación: los hashes hexadecimales pueden colisionar en silencio.**
   Siete columnas son `character(64)` con hex:
   `agent.run_log.hash`, `.input_hash`, `.prev_hash`,
   `kag.documento_fuente.hash_contenido`, `policy.snapshot.policy_hash`,
   `qda.proyecto.hash` y `staging.lote.hash_archivo`. La colación por defecto
   de SQL Server es _case-insensitive_, así que `'ab…'` y `'AB…'` comparan
   iguales y las cadenas de hashes pierden sentido. Usar una colación binaria
   (`Latin1_General_100_BIN2`) en esas siete columnas.

7. **`jsonb` sin índice GIN al otro lado.**
   `audit.datos_personales_acceso.contexto` (3 088 filas) es `jsonb` y pasa a
   `nvarchar(max)`. Si la aplicación filtra por claves del JSON, ese acceso
   será un escaneo completo salvo que se cree una columna calculada
   persistida con índice.

8. **`GENERATED ALWAYS AS IDENTITY` no tiene equivalente exacto.**
   `audit.datos_personales_acceso.id`, `core.log_accesos.id` (ambas `bigint`) y
   `policy.titular.id` (`smallint`) son `GENERATED ALWAYS`. SQL Server no
   impide el `INSERT` explícito: sólo lo bloquea con `IDENTITY_INSERT`. Tras
   la carga inicial hay que hacer
   `DBCC CHECKIDENT (tabla, RESEED, <max id>)` o los nuevos registros chocarán
   con claves existentes.

9. **Doble `DEFAULT` en PK compuestas.**
   Nueve tablas del alcance tienen clave primaria compuesta:
   `agent.run_log (id, ts)`, `core.alertas_actores (alerta_id, actor_id)`,
   `core.casos_actores (caso_id, actor_id)`,
   `core.compromiso_colaboradores (compromiso_id, actor_uid)`,
   `core.reunion_participantes (reunion_id, actor_uid)`,
   `core.usuario_roles (usuario_id, rol_id, desde)`,
   `policy.escenario_regla (escenario_id, regla_id)`,
   `qda.mapeo_pseudonimo (proyecto_id, token)` y
   `ref.base_legal_evidencia (base_legal_id, fragmento_id)`.
   Ninguna de esas columnas debe recibir `DEFAULT`: el valor lo aporta la
   aplicación o viene por clave foránea. Si se les pone `DEFAULT`, cada lado
   de la relación generaría un identificador distinto y se romperían los
   vínculos.

10. **Seis columnas quedaron sin clave ajena (§2.10).**
    `core.output_contracts.chat_commit_id`, `core.output_contracts.snapshot_id`,
    `ind.variante.variable_id`, `qda.proyecto.plan_paso_id`,
    `staging.lote.plan_paso_id` y `staging.lote.punto_ingesta_id` apuntan a
    tablas de 2027 que no están en la base. En SQL Server serán columnas
    normales, sin `FK`. La aplicación no debe asumir integridad referencial en
    ellas, y cuando lleguen esos esquemas habrá que recrear las constraints.

11. **Pérdida de comentarios.**
    Hay 76 comentarios de objeto y 628 de columna (704 en total). SSMA los
    descarta, y en este esquema documentan la semántica de la PII y de las
    reglas de clasificación. Si el equipo .NET va a leer el esquema desde SQL
    Server, conviene reinyectarlos como `sp_addextendedproperty`.

---

## 5. Lo que SSMA no va a migrar y hay que reconstruir a mano

| #   | Objeto                                                               |                                 Cuántos | Dónde                                                                                | Prioridad                            |
| --- | -------------------------------------------------------------------- | --------------------------------------: | ------------------------------------------------------------------------------------ | ------------------------------------ |
| 1   | Políticas RLS                                                        |                                 **189** | 28 tablas (`audit`, `core`, `kag`, `policy`, `qda`, `staging`)                       | **Crítica** — protege la PII         |
| 2   | Triggers                                                             |                                  **25** | 14 tablas; incluye auditoría, sólo-adición y validaciones                            | **Crítica**                          |
| 3   | Funciones                                                            |                    **52** (42 PL/pgSQL) | `core` 22, `kag` 16, `policy` 6, `ind` 3, `qda` 2, `agent` 1, `audit` 1, `staging` 1 | Alta                                 |
| 4   | Vistas                                                               |                                  **13** | `core` 1, `ref` 2 y 10 en `analytics` (9 vistas + 1 materializada)                   | Alta                                 |
| 5   | Índices parciales                                                    |                                  **10** | ver tabla en §2.8                                                                    | **Crítica** — son reglas de unicidad |
| 6   | Índices por expresión                                                |                                   **0** | —                                                                                    | —                                    |
| 7   | Constraints de exclusión                                             |                                   **0** | —                                                                                    | —                                    |
| 8   | Comentarios                                                          | **704** (76 de objeto + 628 de columna) | todo el alcance                                                                      | Media                                |
| 9   | Secuencias (`serial`)                                                |                                   **8** | los ocho catálogos de §2.7                                                           | Baja — `IDENTITY` las cubre          |
| 10  | Extensiones `postgis`, `vector`, `pgcrypto`, `btree_gist`, `pg_trgm` |                                   **5** | ninguna columna las usa, salvo `pgcrypto` en 1 función                               | Media (sólo `pgcrypto`)              |

Lo que **sí** migra SSMA sin intervención: las 74 tablas del alcance, sus 651
columnas, las 156 `FK`, los `PK`, `CHECK`, los `DEFAULT` no-uuid y los índices
btree "normales" (222 índices, de los que 79 no cuelgan de una constraint).

---

## 6. Reproducir y verificar

```sh
cd C:\Users\Julia\Downloads\avisa

# aplicar (idempotente)
cat migration/mssql/02_normalizar_tipos.sql \
  | docker compose exec -T db psql -U avisa -d avisa_mssql

# comprobación puntual: ninguna columna uuid conserva DEFAULT
docker compose exec -T db psql -U avisa -d avisa_mssql -c \
  "SELECT count(*) AS uuid_con_default
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
      AND a.atttypid = 'uuid'::regtype
      AND n.nspname IN ('core','audit','ind','policy','qda','staging','agent','ref','kag');"
# esperado: 0

# comprobación: el alcance tiene 74 tablas y 651 columnas
docker compose exec -T db psql -U avisa -d avisa_mssql -c \
  "SELECT count(*) AS tablas FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('core','audit','ind','policy','qda','staging','agent','ref','kag');"
# esperado: 74
```

**Estado actual e idempotencia.** La base `avisa_mssql` reconstruida ya tiene
0 columnas `uuid` con `DEFAULT` y 0 arrays: los 25 `DEFAULT` y la única columna
array quedaron normalizados en la primera pasada. El script es idempotente por
construcción (detecta antes de tocar y no emite `ALTER` cuando no hay nada que
cambiar), y eso se comprueba con la consulta de arriba: devuelve 0.

No se ejecutó contra la base `avisa` (la de trabajo) ni una sola vez: el
bloque 0 aborta con `Este script sólo se ejecuta en avisa_mssql` antes de
tocar nada. Esa guarda es la misma que usa `00_alcance_mvp.sql`.

---

## 7. Objetos fuera del alcance que SSMA verá igualmente

La base `avisa_mssql` conserva tres cosas que no pertenecen al MVP y que
conviene **excluir del asistente** para no ensuciar el informe de errores:

- `public.spatial_ref_sys` (tabla del propio PostGIS), sus dos vistas
  `geometry_columns` y `geography_columns`, y los tipos compuestos
  `geometry_dump`, `valid_detail` y `simple_detail`. Son de PostGIS, no de
  AVISA.
- `legacy` (87 tablas, 807 columnas, 4 729 filas): está en la base para
  consulta histórica, no para migrar.
- Las 16 funciones de `kag`, que sobreviven porque tres tablas de `kag` sí
  entraron en el alcance y los triggers de `core.actores` y `core.casos` las
  llaman. Si SSMA no traduce bien alguna, la tabla se migra igual pero los
  triggers que dependen de ellas no tienen equivalente en destino.

El esquema `analytics` no tiene tablas: sólo las 9 vistas y la vista
materializada citadas en §2.8. No aportan datos propios, pero SSMA intentará
traducirlas si no se marcan como excluidas.
