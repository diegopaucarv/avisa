# P16 — Seguridad por fila en core y registro del banco de datos

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 RF-A03, Anexo D (Ley 29733, inscripción del banco de datos personales)
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16.14, esquema v10
**Parche:** `docs/PARCHE_16_RLS_CORE_Y_DC04.sql` (idempotente)
**Estado:** aplicado y verificado en la base viva el 2026-11-20

---

## 1. Resumen

El parche hace dos cosas.

**Cierra la seguridad por fila en `core`.** Antes, 12 de 98 tablas tenían RLS.
Las otras 86 quedaban abiertas a cualquiera con `SELECT`, incluidas las que
guardan datos personales de dirigentes. El parche protege 32 tablas más con el
mismo patrón que ya usaban las 12 originales: cuatro políticas `PERMISSIVE` por
nivel y tres `RESTRICTIVE` por capacidad. Al aplicar quedaron 44 de 99 tablas
protegidas y 301 políticas en `core` (76 antes, 225 nuevas). Las 12 anteriores
no se reescribieron y siguen en pie.

**Registra el banco de datos personales `BD-GSCS`** en
`core.banco_datos_tratamiento`, con finalidad, categorías, colectivos, plazo de
conservación de 120 meses, nivel de seguridad 3, medidas aplicadas y el oficial
de datos personales. La fecha de inscripción ante la ANPDP nace en `NULL`: es el
estado real del trámite, no un hueco.

Medido hoy en la base viva: **102 tablas en `core`, 45 con RLS, 303 políticas**.
La diferencia con las cifras del encabezado del parche (99 / 44 / 301) no es un
defecto: la produjo el parche 17, posterior, que creó tres tablas en `core`
(`cat_privilegio`, `privilegio_usuario`, `consulta_reniec`). Una de ellas,
`consulta_reniec`, nace con RLS y dos políticas. El desglose está en §2.

Dos salvedades que se desarrollan más abajo:

- La base **no tiene ningún dato de nivel 3**. Todo `core` está en nivel 2. La
  prueba de aislamiento con padre confidencial se hizo elevando una mesa de
  nivel dentro de una transacción y revirtiéndola con `ROLLBACK` (§6).
- `analytics` **no tiene RLS**: no posee tablas base, solo vistas y vistas
  materializadas (§8).

---

## 2. Antes y después: cobertura de RLS

Las cifras «antes» de `core` no son re-medibles hoy sin revertir el parche. Se
toman del encabezado del SQL y se contrastan con lo que sí se puede medir: las
12 tablas originales conservan hoy **76 políticas**, exactamente la cifra
«antes», y las 32 tablas del parche suman **225** (303 − 76 − 2 de
`consulta_reniec`), exactamente las «225 nuevas» que declara el encabezado.

### 2.1 El esquema `core`

| Momento                 | Tablas | Con RLS antes | Con RLS después |
| ----------------------- | -----: | ------------: | --------------: |
| Al aplicar el P16       |     99 |            12 |              44 |
| Medido hoy (2026-11-20) |    102 |            12 |              45 |
| Diferencia              |     +3 |             — |              +1 |

Las tres tablas nuevas y la tabla con RLS extra son del parche 17:

```sql
-- Q1 · tablas de core y cuántas tienen RLS
SELECT count(*) AS tablas,
       count(*) FILTER (WHERE c.relrowsecurity) AS con_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'core' AND c.relkind IN ('r','p');
-- 102 | 45
```

### 2.2 Cobertura en toda la base, por esquema

```sql
-- Q2 · cobertura por esquema (misma definición de Q1, sin filtrar esquema)
SELECT n.nspname, count(*) AS tablas,
       count(*) FILTER (WHERE c.relrowsecurity) AS con_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p')
   AND n.nspname NOT IN ('pg_catalog','information_schema','public')
   AND n.nspname NOT LIKE 'pg\_%'
 GROUP BY 1 ORDER BY 2 DESC;
```

| Esquema        |  Tablas | Con RLS antes del P16 | Con RLS después (hoy) |
| -------------- | ------: | --------------------: | --------------------: |
| `core`         |     102 |                    12 |                    45 |
| `legacy`       |      87 |                     — |                     0 |
| `kag`          |      30 |                     — |                    11 |
| `agent`        |      23 |                     — |                     2 |
| `territorio`   |      16 |                     — |                     0 |
| `ctx`          |      16 |                     — |                     1 |
| `chat`         |      14 |                     — |                     8 |
| `lex`          |      11 |                     — |                     2 |
| `qda`          |      10 |                     — |                     4 |
| `ind`          |       9 |                     — |                     0 |
| `avisa`        |       8 |                     — |                     0 |
| `policy`       |       8 |                     — |                     1 |
| `config`       |       6 |                     — |                     0 |
| `impact`       |       5 |                     — |                     0 |
| `consultation` |       4 |                     — |                     0 |
| `analisis`     |       4 |                     — |                     1 |
| `domain`       |       4 |                     — |                     1 |
| `forecast`     |       3 |                     — |                     0 |
| `economic`     |       3 |                     — |                     0 |
| `staging`      |       2 |                     — |                     1 |
| `pesca`        |       2 |                     — |                     2 |
| `ref`          |       2 |                     — |                     0 |
| `audit`        |       1 |                     — |                     1 |
| `proteccion`   |       1 |                     — |                     1 |
| `model`        |       1 |                     — |                     0 |
| `mype`         |       1 |                     — |                     1 |
| `community`    |       1 |                     — |                     0 |
| **Total**      | **374** |                     — |                **82** |

El parche 16 solo toca `core` (y añade una columna en `ref`). El RLS del resto
de esquemas viene de otros parches; el guion significa «no es estado previo del
P16».

`analytics` no aparece en la tabla porque **no tiene tablas base**: son 5 vistas
materializadas (`relkind = 'm'`) y 17 vistas (`relkind = 'v'`).

### 2.3 Políticas RLS en la base

```sql
-- Q3 · total y desglose por esquema
SELECT schemaname, count(*) FROM pg_policies GROUP BY 1 ORDER BY 2 DESC;
```

| Esquema      | Políticas |
| ------------ | --------: |
| `core`       |       303 |
| `kag`        |        77 |
| `chat`       |        41 |
| `qda`        |        28 |
| `agent`      |        14 |
| `lex`        |        14 |
| `analisis`   |         7 |
| `ctx`        |         7 |
| `policy`     |         7 |
| `domain`     |         6 |
| `pesca`      |         5 |
| `mype`       |         4 |
| `staging`    |         4 |
| `audit`      |         2 |
| `proteccion` |         1 |
| **Total**    |   **520** |

Las 303 de `core` se descomponen así: 76 en las 12 tablas originales, 225 en
las 32 tablas del P16 y 2 en `core.consulta_reniec` (parche 17). No hay políticas
huérfanas: **0 políticas sobre tablas de `core` sin `relrowsecurity`**.

```sql
-- Q4 · políticas en tablas de core sin RLS (debe ser 0)
SELECT count(*)
  FROM pg_policies p
  JOIN pg_class c ON c.relname = p.tablename
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
 WHERE p.schemaname = 'core' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
-- 0
```

---

## 3. Los tres grupos de tablas protegidas

El parche describe 32 tablas. La cuenta real es 5 con nivel propio + 26 de
detalle por herencia + 1 banco de datos; las dos mixtas (`hitos_compromiso`,
`output_contracts`) están dentro de las 5 y reciben una política adicional.

### 3.1 Grupo A — nivel propio (`nivel_clasificacion` en la tabla)

```sql
-- Q5 · grupo A: RLS, FORCE y número de políticas
SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname='core' AND p.tablename=c.relname) AS politicas
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname='core' AND c.relkind IN ('r','p')
   AND c.relname IN ('capacitaciones','mesas_dialogo','hitos_compromiso',
                     'output_contracts','log_accesos','banco_datos_tratamiento');
```

| Tabla                          | Políticas | `FORCE RLS` | Nota                                  |
| ------------------------------ | --------: | ----------- | ------------------------------------- |
| `core.capacitaciones`          |         7 | sí          | patrón completo                       |
| `core.mesas_dialogo`           |         7 | sí          | patrón completo                       |
| `core.hitos_compromiso`        |         8 | sí          | + `r_herencia` (grupo C)              |
| `core.output_contracts`        |         8 | sí          | + `r_herencia` (grupo C)              |
| `core.log_accesos`             |         6 | sí          | sin `r_rol_insert`: escritura abierta |
| `core.banco_datos_tratamiento` |         7 | sí          | DC-04, nivel 2 (§5)                   |

Las 7 políticas del patrón son:

| Política          | Tipo        | Para   | Condición                                                   |
| ----------------- | ----------- | ------ | ----------------------------------------------------------- |
| `p_clasificacion` | PERMISSIVE  | SELECT | `nivel_clasificacion <= core.clasificacion_max()`           |
| `p_insert`        | PERMISSIVE  | INSERT | `clasificacion_max() >= 2 AND nivel <= clasificacion_max()` |
| `p_update`        | PERMISSIVE  | UPDATE | `clasificacion_max() >= 2 AND ...` / `WITH CHECK` del nivel |
| `p_delete`        | PERMISSIVE  | DELETE | `clasificacion_max() >= 3 AND nivel <= clasificacion_max()` |
| `r_rol_insert`    | RESTRICTIVE | INSERT | `core.puede_crear()`                                        |
| `r_rol_update`    | RESTRICTIVE | UPDATE | `core.puede_editar()`                                       |
| `r_rol_delete`    | RESTRICTIVE | DELETE | `core.puede_eliminar()`                                     |

Las `PERMISSIVE` se suman con `OR`; las `RESTRICTIVE` con `AND`. Juntas dicen:
«lees hasta tu nivel, y además solo haces lo que tu rol permite».

`log_accesos` es la excepción razonada: se protege la lectura y la corrección,
no la escritura. Si se exigiera `puede_crear()`, el rol `consulta_lectura` —17
de los 32 usuarios— no podría registrar su propio acceso y se rompería la
trazabilidad que exige la Ley 29733 justo para el rol que más consulta.

### 3.2 Grupo B — 26 tablas de detalle que heredan del padre

```sql
-- Q6 · grupo B: la marca de herencia es la subconsulta contra el alias hp
SELECT count(DISTINCT tablename)
  FROM pg_policies
 WHERE schemaname='core' AND policyname='p_clasificacion' AND qual LIKE '%hp.%';
-- 26
```

| Tabla protegida                     | Padre(s)                                             | ¿Admite nulo?     |
| ----------------------------------- | ---------------------------------------------------- | ----------------- |
| `actor_alias`                       | `actores`                                            | no                |
| `actor_membresia`                   | `actores` (persona y organización)                   | no                |
| `alertas_actores`                   | `alertas_tempranas`, `actores`                       | no                |
| `capacitacion_participantes`        | `capacitaciones`, `actores`                          | no                |
| `casos_actores`                     | `casos`, `actores`                                   | no                |
| `compromiso_colaboradores`          | `compromisos`, `actores`                             | no                |
| `demandas_actores`                  | `demandas`, `actores`                                | no                |
| `documento_actores`                 | `documentos`, `actores`                              | no                |
| `mesa_miembros`                     | `mesas_dialogo`, `actores`                           | sí (`actor_uid`)  |
| `organizaciones`                    | `actores`                                            | no                |
| `plan_acciones`                     | `actores` (`responsable_uid`)                        | sí                |
| `planes_accion`                     | `documentos`                                         | no                |
| `reunion_participantes`             | `reuniones_dialogo`, `actores`                       | no                |
| `alerta_especies`                   | `alertas_tempranas`                                  | no                |
| `cronologia_vinculos`               | `caso_cronologia`, `alertas_tempranas`, `documentos` | sí (dos columnas) |
| `derivaciones_alerta`               | `alertas_tempranas`                                  | no                |
| `fuentes_evidencia`                 | `caso_cronologia`                                    | no                |
| `caso_distritos`                    | `casos`                                              | no                |
| `caso_estado_historial`             | `casos`                                              | no                |
| `caso_factores`                     | `casos`                                              | no                |
| `caso_lugares`                      | `casos`                                              | no                |
| `caso_regiones`                     | `casos`                                              | no                |
| `compromiso_distritos`              | `compromisos`                                        | no                |
| `compromiso_pip`                    | `compromisos`                                        | no                |
| `demandas_evidencias`               | `demandas`                                           | no                |
| `hitos_compromiso_estado_historico` | `hitos_compromiso`                                   | no                |

La lista coincide tabla por tabla con el bloque 2 del parche. Dos trampas de
nombres que conviene tener presentes: **`plan_acciones`** (apunta a `actores`)
y **`planes_accion`** (apunta a `documentos`) son tablas distintas, y ambas
están protegidas.

Se excluyen a propósito dos columnas que sí son «vínculo»:
`organizaciones.representante_uid` (el representante es atributo de la
organización, no su identidad: si fuera confidencial desaparecería la
organización entera) y `reunion_participantes.institucion_uid` (las entidades
públicas son dato público).

### 3.3 Grupo C — las dos mixtas (nivel propio + herencia)

| Tabla                   | Política extra | Efecto                                                                     |
| ----------------------- | -------------- | -------------------------------------------------------------------------- |
| `core.hitos_compromiso` | `r_herencia`   | exige además `compromisos.nivel <= clasificacion_max()`                    |
| `core.output_contracts` | `r_herencia`   | exige además `casos.nivel <= clasificacion_max()`, salvo `caso_id IS NULL` |

Sin la política extra, un hito de nivel 2 podría colgar de un compromiso de
nivel 3 y quedar visible. `r_herencia` es `RESTRICTIVE FOR ALL`, así que suma
con `AND` a las siete anteriores.

---

## 4. Cómo se hereda el nivel del padre

La regla es una sola: **el nivel de una fila de detalle es el máximo de sus
padres**. Por eso la condición es un `AND` de `EXISTS` y no un `OR`. Con `OR`
bastaría con ver a uno de los implicados y se revelaría la existencia del otro.

Dicho en simple: para ver una fila de la lista de asistencia hay que poder ver
la reunión **y** a la persona. Si una de las dos está fuera de tu nivel, la fila
no existe para ti.

Esta es la condición tal como quedó escrita en el catálogo para
`core.mesa_miembros` (`SELECT qual FROM pg_policies ...`), con el formato que
emite PostgreSQL:

```sql
(((actor_uid IS NULL) OR (EXISTS ( SELECT 1
   FROM core.actores hp
  WHERE ((hp.actor_uid = mesa_miembros.actor_uid)
     AND (hp.nivel_clasificacion <= core.clasificacion_max())))))
 AND (EXISTS ( SELECT 1
   FROM core.mesas_dialogo hp
  WHERE ((hp.id = mesa_miembros.mesa_id)
     AND (hp.nivel_clasificacion <= core.clasificacion_max())))))
```

Tres cosas que hace esa expresión:

1. `actor_uid IS NULL OR EXISTS (...)`. Las columnas que admiten nulo se tratan
   aparte. Sin ese trato, una fila sin padre se volvería invisible para todo el
   mundo y el sistema parecería haber perdido registros. En esta base **las 62
   filas de `mesa_miembros` tienen `actor_uid` nulo**: la asistencia se guarda
   con `nombre_texto`, no con un actor. Es decir, hoy la lista de asistencia se
   protege solo por el nivel de la mesa.
2. El alias `hp` es la marca de la herencia: es lo que permite contarlas con
   una sola consulta (Q6) y distinguirlas de las de nivel propio.
3. `<= core.clasificacion_max()` se evalúa contra el rol de la sesión
   (`app.rol_codigo`), no contra el usuario. Ver §8.

Ejemplo real, medido en §6: la mesa `0aeefe40-…` tiene 4 asistentes. Con el rol
`consulta_lectura` (nivel máximo 2) y la mesa en nivel 2, se ven los 4. Si la
mesa pasa a nivel 3 —confidencial—, el mismo rol ve **0** asistentes de esa
mesa, y la mesa misma desaparece de su `SELECT`. Con `administrador` (nivel 3)
vuelven a verse los 4. No hace falta tocar la tabla de asistencia: el nivel se
hereda.

---

## 5. El banco de datos personales BD-GSCS

```sql
-- Q7 · el banco y su oficial
SELECT id, codigo, estado, nivel_seguridad, tiempo_conservacion_meses,
       flujo_transfronterizo, fecha_inscripcion_anpdp, codigo_registro_anpdp,
       nivel_clasificacion, activo
  FROM core.banco_datos_tratamiento;
-- 1 fila
```

| Campo                       | Valor                                                       |
| --------------------------- | ----------------------------------------------------------- |
| `id`                        | 1                                                           |
| `codigo`                    | `BD-GSCS`                                                   |
| `nombre`                    | Banco de Datos de Gestión Social y Conflictividad Sectorial |
| `estado`                    | `pendiente`                                                 |
| `nivel_seguridad`           | 3 (alto)                                                    |
| `tiempo_conservacion_meses` | 120                                                         |
| `flujo_transfronterizo`     | `false`                                                     |
| `oficial_datos_usuario_id`  | `fa454b34-b866-4313-9606-b14c8cbd2eaf`                      |
| ODP (resuelto por correo)   | `ebautista@produce.gob.pe` — Edith Bautista León, activa    |
| `fecha_inscripcion_anpdp`   | `NULL` (inscripción pendiente)                              |
| `codigo_registro_anpdp`     | `NULL`                                                      |
| `nivel_clasificacion`       | 2                                                           |
| `activo`                    | `true`                                                      |
| Filas en la tabla           | 1                                                           |
| RLS                         | 7 políticas, `ENABLE` + `FORCE`                             |

El `CHECK ck_banco_inscripcion` impide marcar `estado = 'inscrito'` sin fecha y
sin código de registro: la declaración tiene que ser verificable. Hoy el estado
es `pendiente`, coherente con los dos `NULL`.

### 5.1 Finalidad, categorías y medidas

No son catálogos normalizados: son tres columnas de texto en la misma fila. El
parche no crea tablas `cat_finalidad` ni similares, y en `core` no existe
ninguna. Lo que hay, literal:

| Campo                  | Contenido                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `finalidad`            | Prevención, monitoreo y seguimiento de controversias sociales del sector Producción; seguimiento de compromisos y acuerdos de mesas de diálogo; emisión de alertas tempranas a la Alta Dirección.                                                                                                                                                                                                                                    |
| `categorias_datos`     | DNI, nombres y apellidos, teléfono, correo electrónico, cargo, organización o gremio de pertenencia, condición de dirigente, participación en reuniones y asambleas, firmas de asistencia. Resultado de consultas de requisitorias y antecedentes obtenido de PIDE-RENIEC (cifrado).                                                                                                                                                 |
| `colectivos_afectados` | Dirigentes de organizaciones sociales, gremios MYPE, OSPAs, representantes de comunidades y autoridades locales.                                                                                                                                                                                                                                                                                                                     |
| `medidas_seguridad`    | TLS 1.2+ en tránsito; AES-256 (pgcrypto) en los campos identificables; HMAC para búsqueda sobre dato cifrado; seguridad a nivel de fila por rol y nivel de clasificación; bitácora de accesos inmutable; exportaciones restringidas a roles habilitados. Resultado RENIEC en tabla propia, cifrado con AES-256, de solo agregar, accesible únicamente por privilegio nominal (RA-07) y excluido de tableros y exportaciones (RA-08). |

Las dos últimas frases de `categorias_datos` y `medidas_seguridad` no las
escribió el P16: las **añadió el parche 17** con un `UPDATE ... SET
categorias_datos = categorias_datos || '…'`. El texto del banco quedó, por
tanto, más largo que el de la semilla. Ver §8.

### 5.2 Vínculo con las bases legales

```sql
-- Q8 · bases legales ligadas al banco
SELECT count(*) AS total, count(*) FILTER (WHERE banco_datos_id = 1) AS ligadas
  FROM ref.base_legal_tratamiento;
-- 5 | 5
```

La columna `ref.base_legal_tratamiento.banco_datos_id` es del P16. Las cinco
bases legales del parche 14 quedaron ligadas al banco 1.

---

## 6. Pruebas de aislamiento

No hay ninguna fila de nivel 3 en la base: `actores` (1 160), `casos` (35),
`compromisos` (8), `capacitaciones` (1) y `mesas_dialogo` (21) están todas en
nivel 2. Tampoco hay reuniones: `reuniones_dialogo` y `reunion_participantes`
tienen 0 filas. Por eso la lista de asistencia real de esta base es
`mesa_miembros` (62 filas, 21 mesas), y el caso «padre confidencial» se probó
elevando una mesa a nivel 3 dentro de una transacción, con `ROLLBACK` al final.
**Ningún dato quedó modificado** (comprobado: 0 mesas en nivel 3 después).

Todas las pruebas se ejecutaron con `SET LOCAL ROLE avisa_api` porque el rol de
conexión `avisa` es superusuario con `BYPASSRLS` y el RLS no lo alcanza (§8).

```sql
-- T1 · rol de nivel 1 contra datos reales de nivel 2
BEGIN;
  SET LOCAL ROLE avisa_api;
  SET LOCAL app.rol_codigo = 'externo_publico';   -- clasificacion_max() = 1
  SELECT (SELECT count(*) FROM core.mesas_dialogo),
         (SELECT count(*) FROM core.mesa_miembros),
         (SELECT count(*) FROM core.actores),
         (SELECT count(*) FROM core.banco_datos_tratamiento);
ROLLBACK;

-- T2 · rol de nivel 2 contra los mismos datos
BEGIN;
  SET LOCAL ROLE avisa_api;
  SET LOCAL app.rol_codigo = 'consulta_lectura';  -- clasificacion_max() = 2
  SELECT (SELECT count(*) FROM core.mesas_dialogo),
         (SELECT count(*) FROM core.mesa_miembros),
         (SELECT count(*) FROM core.actores),
         (SELECT count(*) FROM core.banco_datos_tratamiento);
ROLLBACK;

-- T3 · padre confidencial: se eleva una mesa a nivel 3 y se revierte
BEGIN;
  UPDATE core.mesas_dialogo SET nivel_clasificacion = 3
   WHERE id = '0aeefe40-ce0a-49db-841f-1e13a5052690';   -- tiene 4 asistentes
  SET LOCAL ROLE avisa_api;
  SET LOCAL app.rol_codigo = 'consulta_lectura';
  SELECT (SELECT count(*) FROM core.mesa_miembros
           WHERE mesa_id = '0aeefe40-ce0a-49db-841f-1e13a5052690'),
         (SELECT count(*) FROM core.mesa_miembros),
         (SELECT count(*) FROM core.mesas_dialogo
           WHERE id = '0aeefe40-ce0a-49db-841f-1e13a5052690');
  RESET ROLE;
  SET LOCAL app.rol_codigo = 'administrador';          -- clasificacion_max() = 3
  SET LOCAL ROLE avisa_api;
  SELECT (SELECT count(*) FROM core.mesa_miembros
           WHERE mesa_id = '0aeefe40-ce0a-49db-841f-1e13a5052690'),
         (SELECT count(*) FROM core.mesa_miembros),
         (SELECT count(*) FROM core.mesas_dialogo
           WHERE id = '0aeefe40-ce0a-49db-841f-1e13a5052690');
ROLLBACK;
```

| #   | Rol (nivel)            | Consulta                                | Filas | Esperado |
| --- | ---------------------- | --------------------------------------- | ----: | -------: |
| T1a | `externo_publico` (1)  | `count(*) core.mesas_dialogo`           |     0 |        0 |
| T1b | `externo_publico` (1)  | `count(*) core.mesa_miembros`           |     0 |        0 |
| T1c | `externo_publico` (1)  | `count(*) core.actores`                 |     0 |        0 |
| T1d | `externo_publico` (1)  | `count(*) core.banco_datos_tratamiento` |     0 |        0 |
| T2a | `consulta_lectura` (2) | `count(*) core.mesas_dialogo`           |    21 |       21 |
| T2b | `consulta_lectura` (2) | `count(*) core.mesa_miembros`           |    62 |       62 |
| T2c | `consulta_lectura` (2) | `count(*) core.actores`                 | 1 160 |    1 160 |
| T2d | `consulta_lectura` (2) | `count(*) core.banco_datos_tratamiento` |     1 |        1 |
| T3a | `consulta_lectura` (2) | asistentes de la mesa elevada a nivel 3 |     0 |        0 |
| T3b | `consulta_lectura` (2) | `count(*) core.mesa_miembros` (total)   |    58 |       58 |
| T3c | `consulta_lectura` (2) | la mesa elevada, por `id`               |     0 |        0 |
| T3d | `administrador` (3)    | asistentes de la mesa elevada a nivel 3 |     4 |        4 |
| T3e | `administrador` (3)    | `count(*) core.mesa_miembros` (total)   |    62 |       62 |
| T3f | `administrador` (3)    | la mesa elevada, por `id`               |     1 |        1 |
| T4  | — (`post-ROLLBACK`)    | mesas en nivel 3 tras revertir          |     0 |        0 |

Lectura del resultado: la fila de asistencia **no tiene nivel propio**. Con el
padre en nivel 3 y el rol en nivel 2, el `EXISTS` contra `mesas_dialogo` falla y
la fila deja de existir para ese rol; el total visible baja de 62 a 58 —las
cuatro de esa mesa— sin que nadie haya borrado nada. Al subir el rol a nivel 3,
la mesa y sus cuatro asistentes reaparecen.

Ninguna de estas pruebas escribió de forma permanente: las tres terminan en
`ROLLBACK` y T4 lo confirma.

---

## 7. Cómo se reproduce

Requisitos: contenedor `avisa-db` arriba y el parche 15 aplicado (el bloque 0
aborta si faltan `core.clasificacion_max()`, `core.puede_crear()`,
`core.puede_editar()` o `core.puede_eliminar()`).

```sh
# 1 · aplicar (idempotente; se puede repetir)
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < docs/PARCHE_16_RLS_CORE_Y_DC04.sql

# 2 · cobertura y políticas (Q1 y Q3)
MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -c "
SELECT n.nspname, count(*) AS tablas,
       count(*) FILTER (WHERE c.relrowsecurity) AS con_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p')
   AND n.nspname NOT IN ('pg_catalog','information_schema','public')
   AND n.nspname NOT LIKE 'pg\_%'
 GROUP BY 1 ORDER BY 2 DESC;"

# 3 · el banco DC-04
MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -c "
SELECT codigo, estado, nivel_seguridad, tiempo_conservacion_meses,
       fecha_inscripcion_anpdp,
       (SELECT email FROM core.usuarios WHERE id = oficial_datos_usuario_id) AS odp
  FROM core.banco_datos_tratamiento;"

# 4 · aislamiento (bloques de §6, con BEGIN … ROLLBACK)
```

El parche verifica solo, en su bloque 5, con `RAISE NOTICE`: 44 tablas de `core`
con RLS, las 12 originales intactas, 26 tablas con herencia, 1 fila en el banco,
ODP resuelto, 5 bases legales ligadas y la ODP con rol `administrador`. Al
re-ejecutarlo los `INSERT` caen en `ON CONFLICT DO NOTHING` y las políticas se
sueltan y recrean.

Nota de operación: hoy el bloque 5 sigue diciendo «esperado 44» y la base tiene 45. No es un fallo del parche —el `RAISE NOTICE` imprime 45—, pero el texto
quedó desfasado en cuanto entró el parche 17.

---

## 8. Lo que el SQL no resuelve

**A1. `analytics` no está aislado.** El esquema tiene 0 tablas base, 5 vistas
materializadas y 17 vistas. `mv_dashboard_alta_direccion` es `relkind = 'm'` con
`relrowsecurity = false`, y PostgreSQL no admite `CREATE POLICY` sobre vistas
materializadas: no es un olvido, es que no hay dónde ponerla.

```sql
-- Q9
SELECT c.relname, c.relkind, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'analytics' AND c.relname = 'mv_dashboard_alta_direccion';
-- mv_dashboard_alta_direccion | m | f
```

Consecuencia: el tablero de Alta Dirección agrega datos que en origen están
protegidos por nivel, pero se lee sin filtro de nivel. Quien tenga `SELECT`
sobre la vista materializada ve el agregado completo. La única barrera es el
`GRANT`. Si el tablero debe respetar niveles, la vista tiene que ser una vista
normal con `security_invoker` sobre las tablas con RLS, o refrescarse por rol.

**A2. H-78: el acto de designación del ODP.** El parche guarda el UUID del
oficial en `oficial_datos_usuario_id` y le asegura el rol `administrador`. El
acto administrativo que lo designa —la resolución, su fecha, su publicación— no
se crea ni se registra aquí, y es lo que la ANPDP exige junto con la inscripción
del banco. Mientras el expediente no tenga ese documento, el banco no es
inscribible aunque la tabla esté completa.

**A3. La inscripción está pendiente y nada lo recuerda.** `estado = 'pendiente'`
y `fecha_inscripcion_anpdp` nula son correctos hoy. No hay trigger, alerta ni
tarea que avise del trámite; el plazo depende de gestión externa.

**A4. El RLS no alcanza al rol de conexión.** `avisa` es superusuario con
`rolbypassrls`. Las 45 tablas tienen `FORCE ROW LEVEL SECURITY`, pero `FORCE` no
frena a un superusuario. Todo lo que se demuestra en §6 se demuestra con
`avisa_api`, que no es superusuario. Si el aplicativo se conecta como `avisa`,
el RLS es decorativo.

**A5. `app.rol_codigo` no es una credencial.** Es un parámetro de sesión:
cualquiera con conexión puede fijarlo en `administrador` y ver todo. La base no
puede probar que quien lo fijó se autenticó. El control real es la red y el
backend.

**A6. La declaración del banco es texto libre.** `finalidad`, `categorias_datos`
y `medidas_seguridad` son `text`. No hay catálogo de finalidades ni de
categorías contra el que validar, así que la base no puede comprobar que lo
tratado coincide con lo declarado —y tratar para un fin no declarado es
infracción—. El P17 amplió `categorias_datos` con `||` y el `estado` siguió en
`pendiente`. Hoy no hay contradicción porque el banco no está inscrito; si ya
estuviera `inscrito`, esa ampliación habría exigido `actualizacion_pendiente` y
nada la habría forzado.

**A7. `banco_datos_id` es opcional.** El `UPDATE` del P16 llenó las 5 bases
legales existentes. Una base legal nueva puede nacer con `banco_datos_id` nulo y
quedar fuera de toda declaración. Falta `NOT NULL` o un trigger.

**A8. 57 tablas de `core` sin RLS, a propósito.** 34 son `cat_*` y 23 son
geografía, integración, colas y autenticación:

```sql
-- Q10
SELECT count(*) AS sin_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='core' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;  -- 57
```

Entre las 23 están `usuarios`, `usuario_roles` y `roles`: el login tiene que
poder leer al usuario antes de conocer su rol, y el RLS por rol haría imposible
autenticarse. De las 57, **dos llegaron con el parche 17** (`cat_privilegio` y
`privilegio_usuario`); las otras 55 son el inventario que el P16 dejó fuera a
propósito.

**A9. La asistencia vive en texto libre.** Las 62 filas de `mesa_miembros`
tienen `actor_uid` nulo y el nombre en `nombre_texto`. Esa columna no tiene
nivel propio: se protege solo por el nivel de la mesa. Con las 21 mesas en nivel
2, cualquier rol de nivel 2 lee los 62 nombres. Si esos nombres corresponden a
dirigentes que deberían ser confidenciales, el nivel hay que subirlo en la mesa,
no en la fila.

**A10. Nada mantiene `updated_at`.** La tabla del banco tiene default `now()`
pero ningún trigger; un `UPDATE` deja la fecha vieja salvo que el código la
escriba. El P17 sí la escribió en su `UPDATE`.

---

_Verificado contra `avisa-db` (PostgreSQL 16.14, base `avisa`, usuario `avisa`) el
2026-11-20. Todas las cifras provienen de consultas ejecutadas en esa sesión y
se reproducen en las secciones indicadas. Ninguna prueba de escritura quedó
confirmada: §6 cierra con `ROLLBACK`._
