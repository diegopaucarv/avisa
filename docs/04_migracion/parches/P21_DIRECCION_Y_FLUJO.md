# P21 — La Dirección y la normalización del flujo

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 — RN-04, RF-D09, G21 (§11.8), RNF-10 y §5.1
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_21_DIRECCION_Y_FLUJO.sql` (idempotente, re-ejecutable)
**Estado:** **aplicado y verificado en la base viva el 2026-11-20.** Se aplicó dos
veces seguidas para demostrar la idempotencia (§5.3) y una tercera y una cuarta
para confirmarla después, sin cambios.

---

## 1. Resumen

El parche 20 dejó el flujo de alerta bien modelado y **sin nadie que lo
ejecutara**: el rol `direccion_oaipcs` existía con 0 cuentas, así que el paso 3
(Aprobación definitiva) no tenía una sola cuenta elegible. Alrededor de ese
hueco quedaban otros tres: `rol_responsable` seguía en texto libre del sistema
anterior en los flujos `caso` y `reporte`; G21 pedía `aprobada_por` y
`aprobada_en` en la alerta, y la tabla no las tenía; y los dos últimos catálogos
del flujo (`core.flujo_estado`, `core.permiso_aprobacion`) no tenían política de
seguridad por fila.

El parche hace cuatro cosas:

1. Asigna `direccion_oaipcs` a la Directora de la OAIPCS (`SEC-11`).
2. Normaliza `rol_responsable` de los 7 pasos de `caso` y `reporte` que traían
   texto libre, y lo blinda con una restricción de formato y un trigger que
   valida cada token contra `core.roles`.
3. Cierra G21: añade `aprobada_por` y `aprobada_en`, las comenta, las indexa y
   las expone al final de `core.vw_alerta_estado`.
4. Pone RLS forzada en `core.flujo_estado` y `core.permiso_aprobacion`, con
   lectura abierta y escritura solo `administrador`.

En cifras (medidas, no estimadas):

| Dato                                                  |     Antes |                         Después |
| ----------------------------------------------------- | --------: | ------------------------------: |
| Cuentas vigentes de `direccion_oaipcs`                |         0 |                           **1** |
| Filas en `core.usuario_roles`                         |        35 |                          **36** |
| Pasos con `rol_responsable` en texto libre del legado |         7 |                           **0** |
| Filas en `core.flujo_definicion`                      |        12 |               **12** (sin alta) |
| Columnas de `core.alertas_tempranas`                  |        33 |                          **35** |
| Alertas con `aprobada_por` no nulo                    |         0 |              **0** (sin cambio) |
| Columnas de `core.vw_alerta_estado`                   |        17 |                          **19** |
| Filas de `core.vw_alerta_estado`                      |        83 |                          **83** |
| Tablas con RLS en todo el modelo                      |        88 |                          **90** |
| Políticas RLS en todo el modelo                       |       544 |                         **552** |
| Tablas con RLS / políticas en `core`                  |  49 / 319 |                    **51 / 327** |
| Columnas lógicas del modelo v10                       |     2 145 |                       **2 147** |
| Filas del modelo v10                                  |    13 354 |                      **13 355** |
| Columnas de vistas y materializadas (36 objetos)      |       298 |                         **300** |
| Claves ajenas (modelo / únicas para SQL Server)       | 610 / 526 |                   **611 / 527** |
| Filas en `core.proceso_instancia`                     |       218 | **218** (no se inserta ninguna) |
| Filas en `core.permiso_aprobacion`                    |         0 |              **0** (sin cambio) |

Lo que el parche **no** hace, y conviene decirlo antes de cualquier tabla: no
inserta ni una fila en `core.proceso_instancia`, no crea estados nuevos, no
inventa aprobaciones, no toca el flujo `alerta` (ya venía normalizado del parche 20) y no redacta comentarios de tabla para los catálogos. Se detalla en §3, §4 y
§6.

---

## 2. Qué cambia

| Objeto                                                         | Tipo                             | Qué hace                                                                                                    |
| -------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `core.usuario_roles`                                           | `INSERT` (1 fila)                | `SEC-11` + `direccion_oaipcs`, `desde = 2026-11-20`, `hasta = NULL` (vigente).                              |
| `core.flujo_definicion` (`DPPC-1`, `DPP-1..3`)                 | `UPDATE` (4 filas)               | `'Sectorista'` → `sectorista`.                                                                              |
| `core.flujo_definicion` (`DPPC-2..4`)                          | `UPDATE` (3 filas)               | `'Sectorista/Directora'` → `sectorista,direccion_oaipcs`.                                                   |
| `core.flujo_definicion.rol_responsable`                        | `COMMENT ON COLUMN`              | Fija la convención: un código es «solo ese rol»; varios separados por coma son «cualquiera de ellos».       |
| `flujo_definicion_rol_responsable_formato`                     | `CHECK`                          | Exige `^[a-z_]+(,[a-z_]+)*$`: minúsculas y comas sin espacios.                                              |
| `core.tg_flujo_def_valida_rol()`                               | función `SECURITY DEFINER`       | Comprueba que **cada** token exista en `core.roles.codigo` y nombra el token culpable si no.                |
| `flujo_definicion_valida_rol`                                  | trigger                          | `BEFORE INSERT OR UPDATE OF rol_responsable`; llama a la función anterior.                                  |
| `core.alertas_tempranas.aprobada_por`                          | columna nueva                    | `uuid REFERENCES core.usuarios(id) ON DELETE RESTRICT`, con comentario.                                     |
| `core.alertas_tempranas.aprobada_en`                           | columna nueva                    | `timestamptz`, con comentario.                                                                              |
| `alertas_aprobacion_coherente`                                 | `CHECK`                          | `aprobada_en IS NULL OR aprobada_por IS NOT NULL`: una fecha de aprobación sin aprobador no significa nada. |
| `core.ix_alertas_aprobada_por`                                 | índice parcial                   | `(aprobada_por, aprobada_en)` `WHERE aprobada_por IS NOT NULL`.                                             |
| `core.vw_alerta_estado`                                        | `CREATE OR REPLACE VIEW`         | Conserva sus 17 columnas en el mismo orden y añade `aprobada_por` y `aprobada_en` al final.                 |
| `p21_flujo_estado_select`                                      | política `PERMISSIVE FOR SELECT` | `USING (true)`: lectura abierta a toda sesión.                                                              |
| `p21_flujo_estado_insert` / `_update` / `_delete`              | políticas `PERMISSIVE`           | Solo `core.rol_actual() = 'administrador'`.                                                                 |
| `p21_permiso_aprob_select` / `_insert` / `_update` / `_delete` | políticas `PERMISSIVE`           | Mismo patrón, sobre `core.permiso_aprobacion`.                                                              |

Todo el cuerpo va entre `BEGIN` y `COMMIT`; el bloque 0 (comprobaciones previas)
corre **antes** del `BEGIN` para que un estado de partida equivocado no abra una
transacción que luego haya que deshacer a mano.

---

## 3. Por qué, decisión por decisión

### 3.1 La asignación se hace a `SEC-11`, y solo a ella

El rol nace del parche 20 con `max_clasificacion = 3`, `puede_crear` y
`puede_editar`, sin `puede_eliminar`. Quién lo ocupa es un **hecho
administrativo**, no una deducción del SQL: el sistema no tiene una columna que
diga «esta persona es la Directora» más allá de `core.usuarios.cargo`, que es
texto libre y puede estar escrito de varias formas.

Por eso la asignación se apoya en `codigo_legado = 'SEC-11'`, que sí es único y
es el código con el que la OAIPCS dio de alta a Edith Bautista León. El bloque 1
comprueba primero que exista **exactamente un** usuario con ese código y lanza
`RAISE EXCEPTION` si hay cero o más de uno; no adivina.

Solo a ella porque el rol es el de **la Dirección de la OAIPCS** como órgano: el
paso 3 lo firma quien la ocupa, y hoy la ocupa una sola persona. El parche no
asigna `direccion_oaipcs` a nadie más y no toca los otros roles de Edith
(`sectorista`, `administrador`, `alta_direccion` siguen con sus fechas de
origen). Añadir un cuarto rol **no altera ninguna política de RLS**: las
políticas leen `core.rol_actual()`, que la API fija por petición, y no existe un
rol «principal» que se elija solo.

La fila queda con `hasta = NULL`, que en esta tabla significa «vigente». La
guarda `NOT EXISTS … AND x.hasta IS NULL` evita duplicar una asignación abierta;
una asignación histórica ya cerrada no estorba y no se reabre.

### 3.2 La convención de `rol_responsable`

`rol_responsable` era `varchar(120)` sin clave ajena y sin validación. En el
flujo de alerta ya usaba códigos desde el parche 20; en `caso` y `reporte`
seguía el texto del sistema anterior. La convención que queda escrita en el
comentario de la columna es esta:

- **un** código de `core.roles.codigo` → «solo ese rol»;
- **varios** códigos separados por coma, sin espacios → «cualquiera de ellos»
  (alternativa, **no** secuencia).

Así, `sectorista,direccion_oaipcs` significa que el paso lo puede ejecutar el
sectorista **o** la Dirección, indistintamente. La coma es el separador y no
lleva espacios para que el formato sea comprobable por una sola expresión
regular.

Los dos `UPDATE` traducen el vocabulario del legado:

| Texto del legado       | Código(s)                     | Pasos                                  |
| ---------------------- | ----------------------------- | -------------------------------------- |
| `Sectorista`           | `sectorista`                  | `caso` 1, `reporte` 1, 2 y 3 (4 filas) |
| `Sectorista/Directora` | `sectorista,direccion_oaipcs` | `caso` 2, 3 y 4 (3 filas)              |

El texto libre del legado **no puede volver**, y no por disciplina sino por dos
cerrojos complementarios:

1. El `CHECK` de formato (`flujo_definicion_rol_responsable_formato`) rechaza
   mayúsculas, barras y comas con espacios. Es barato, no depende de las filas y
   se valida una sola vez sobre las 12.
2. El trigger `flujo_definicion_valida_rol` comprueba que cada token exista en
   `core.roles.codigo`. Este es el que caza un código bien formado pero
   inventado (`inventado` pasa el formato y no existe como rol).

La función es `SECURITY DEFINER` con
`SET search_path TO 'pg_catalog','core'` para que la consulta al catálogo no
dependa de la RLS de quien esté escribiendo el flujo: un rol sin privilegios de
lectura no debe poder colar un rol inexistente «porque no lo ve».

Un detalle que la prueba funcional dejó claro: PostgreSQL evalúa los `CHECK`
**después** de los triggers `BEFORE`, así que, cuando un valor incumple los dos
(`Sectorista/Directora`, por ejemplo), el mensaje que se ve es el del trigger
—`el token «Sectorista/Directora» no existe en core.roles.codigo`—. El `CHECK`
sigue siendo la última línea para las escrituras que no pasen por el trigger.

No se añadieron índices sobre `rol_responsable`: el catálogo tiene 12 filas y un
índice ahí solo costaría escritura.

### 3.3 G21: dos columnas y la vista ampliada al final

G21 (§11.8) pide que una alerta aprobada sea visible como tal. Hasta ahora el
único rastro del aprobador vivía en `core.proceso_instancia.usuario_id`, que no
distingue la aprobación de cualquier otro paso. Las dos columnas nuevas lo
separan:

- `aprobada_por`, con clave ajena a `core.usuarios` y `ON DELETE RESTRICT`: no
  se puede borrar al aprobador mientras su firma conste en una alerta.
- `aprobada_en`, la marca de tiempo del acto.

El `CHECK` es de una sola dirección a propósito: exige aprobador si hay fecha,
pero **no** exige fecha si hay aprobador. Al revés permitiría registrar al
aprobador y completar la fecha en el mismo acto sin fricción; y una fecha sin
aprobador es un dato sin sujeto, que no se debe poder guardar.

El índice es parcial (`WHERE aprobada_por IS NOT NULL`) porque hoy las 83 filas
están en `NULL` y un índice completo sería casi todo hueco.

La vista se reemplaza con `CREATE OR REPLACE VIEW` y las dos columnas nuevas van
**al final**, sin reordenar ni renombrar las 17 que ya había. Un consumidor que
lea la vista por nombre no se entera; uno que la lea por posición tampoco, porque
las posiciones 1..17 no cambian. Ese es el motivo de no insertarlas junto a
`es_validado_humano`, que habría sido el sitio «natural» de lectura.

### 3.4 RLS de los catálogos: la lectura abierta no es un descuido

`core.flujo_estado` y `core.permiso_aprobacion` eran los dos últimos catálogos
del flujo sin política. Cualquier sesión podía reescribir los cinco estados de
paso. La política es la misma del parche 20:

```sql
p21_flujo_estado_select  FOR SELECT USING (true)
p21_flujo_estado_insert  FOR INSERT WITH CHECK (core.rol_actual() = 'administrador')
p21_flujo_estado_update  FOR UPDATE USING/WITH CHECK (core.rol_actual() = 'administrador')
p21_flujo_estado_delete  FOR DELETE USING (core.rol_actual() = 'administrador')
```

La lectura **tiene** que quedar abierta, y no por comodidad:
`core.tg_alerta_nace()` es `SECURITY DEFINER` pero hace
`SELECT id FROM core.flujo_estado WHERE codigo = 'EST-01'` **con los permisos
del dueño de la función**, y aun así la política se aplica porque el catálogo es
`FORCE ROW LEVEL SECURITY`. Si una política de lectura devolviera 0 filas, las
alertas nacerían **sin paso 1 y sin error visible**. Dejar la lectura abierta es
lo que mantiene el alta de alertas funcionando.

`core.permiso_aprobacion` recibe el mismo patrón por coherencia, aunque hoy
tenga 0 filas y ningún consumidor: cerrarla cuesta lo mismo que dejarla abierta
y evita que alguien la llene por la puerta de atrás mientras se decide qué hacer
con ella.

### 3.5 Las 83 alertas se quedan sin aprobador

`aprobada_por` nace vacía y **no se rellena en ninguna de las 83 alertas
migradas**. No es un olvido ni un hueco de la migración: el sistema anterior no
registraba quién aprobaba, y rellenarlo con el sectorista asignado o con la
Directora sería fabricar un acto administrativo que nadie firmó. El dato que hay
es «no consta», y eso es exactamente lo que expresa `NULL`. Lo mismo vale para
`aprobada_en`.

---

## 4. Migración de datos

### 4.1 `core.usuario_roles`

Una sola fila:

| `usuario_id`                         | `rol_id`                  | `desde`      | `hasta` |
| ------------------------------------ | ------------------------- | ------------ | ------- |
| `fa454b34-…-b14c8cbd2eaf` (`SEC-11`) | `10` (`direccion_oaipcs`) | `2026-11-20` | `NULL`  |

De 35 a 36 filas. La segunda pasada devuelve `INSERT 0 0`.

### 4.2 `core.flujo_definicion`

Siete filas cambian de texto y ninguna de fila. Estado final de los 12 pasos
(medido):

| `tipo_flujo` | orden | nombre                | `rol_responsable`             | `estado_resultante` | `codigo_legado`    |
| ------------ | ----: | --------------------- | ----------------------------- | ------------------- | ------------------ |
| `alerta`     |     1 | Elaboración           | `sectorista`                  | Registrado          | `DPPA-1`           |
| `alerta`     |     2 | Validación previa     | `sectorista`                  | Validado            | `DPPA-2`           |
| `alerta`     |     3 | Aprobación definitiva | `direccion_oaipcs`            | Aprobado            | `V10-ALERTA-APROB` |
| `alerta`     |     4 | Remisión              | `servicio_agente`             | Remitido            | `DPPA-3`           |
| `alerta`     |     5 | Archivo               | `sectorista`                  | Archivado           | `DPPA-4`           |
| `caso`       |     1 | Elaboración           | `sectorista`                  | Registrado          | `DPPC-1`           |
| `caso`       |     2 | Remisión              | `sectorista,direccion_oaipcs` | Remitido            | `DPPC-2`           |
| `caso`       |     3 | Cierre                | `sectorista,direccion_oaipcs` | Cerrado             | `DPPC-3`           |
| `caso`       |     4 | Reapertura            | `sectorista,direccion_oaipcs` | Reaperturado        | `DPPC-4`           |
| `reporte`    |     1 | Elaboración           | `sectorista`                  | Activo              | `DPP-1`            |
| `reporte`    |     2 | Remisión              | `sectorista`                  | Remitido            | `DPP-2`            |
| `reporte`    |     3 | Archivo               | `sectorista`                  | Atendido            | `DPP-3`            |

Los `UPDATE` llevan `AND rol_responsable IS DISTINCT FROM <destino>` además del
filtro por el texto origen. Parece redundante —si filtro por el texto origen, ya
sé que es distinto— y lo es: está ahí para que la guarda de idempotencia sea
explícita y para que nadie «arregle» el parche quitando el filtro por origen sin
darse cuenta de que el `IS DISTINCT FROM` es el que impide reescribir
`updated_at`.

### 4.3 `core.alertas_tempranas` y `core.vw_alerta_estado`

Las 83 filas no se tocan. Las dos columnas nacen en `NULL` y la vista las
proyecta tal cual. Medido: 83 filas antes y después, 0 con `aprobada_por` no
nulo, 19 columnas en la vista.

### 4.4 Nada más se toca

`core.proceso_instancia` sigue en 218 filas (el bloque 6 lo verifica con
`RAISE EXCEPTION`), `core.permiso_aprobacion` sigue con 0, `core.flujo_estado`
sigue con 5 estados y el esquema `ref` no se menciona. El parche tampoco
inserta filas de prueba permanentes: la prueba funcional del trigger usa una
fila temporal que se borra dentro de la misma transacción (§5.4).

---

## 5. Verificación con cifras medidas

### 5.1 Cifras del estado posterior

Medidas en la base viva tras la aplicación, con consultas directas al catálogo
(no estimaciones):

| Dato                                                       |  Valor medido |
| ---------------------------------------------------------- | ------------: |
| Cuentas vigentes de `direccion_oaipcs`                     |             1 |
| … y son de `SEC-11`                                        |             1 |
| Filas en `core.usuario_roles`                              |            36 |
| Filas en `core.flujo_definicion`                           |            12 |
| Pasos con `rol_responsable` fuera de formato               |             0 |
| Tokens de `rol_responsable` que no existen en `core.roles` |             0 |
| Filas en `core.proceso_instancia`                          |           218 |
| Alertas con `aprobada_por` no nulo                         |             0 |
| Filas de `core.vw_alerta_estado`                           |            83 |
| Columnas de `core.vw_alerta_estado`                        |            19 |
| Tablas con RLS en el modelo / políticas                    |      90 / 552 |
| Tablas con RLS en `core` / políticas                       |      51 / 327 |
| Políticas en `core.flujo_estado`                           |             4 |
| Políticas en `core.permiso_aprobacion`                     |             4 |
| Tablas lógicas de `core` (con y sin RLS)                   | 102 (51 / 51) |

Cuentas vigentes por rol, medidas después:

| Rol                    | Cuentas |
| ---------------------- | ------: |
| `consulta_lectura`     |      17 |
| `sectorista`           |      15 |
| `alta_direccion`       |       2 |
| `administrador`        |       1 |
| `direccion_oaipcs`     |   **1** |
| `analista_cualitativo` |       0 |
| `auditor`              |       0 |
| `curador_politica`     |       0 |
| `externo_publico`      |       0 |
| `servicio_agente`      |       0 |
| **Total**              |  **36** |

### 5.2 Salida literal de una pasada completa

Ejecutada por entrada estándar. Los bind mounts de `avisa-db` se fijaron al
crear el contenedor y llegan solo hasta `109_patch_19.sql`, así que ni el 20 ni
el 21 están dentro del contenedor: se aplican por `-f -`. Estarán disponibles
como `110_patch_20.sql` y `111_patch_21.sql` tras el próximo
`docker compose up -d`, que recrea el contenedor:

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
    -v ON_ERROR_STOP=1 -f - < docs/PARCHE_21_DIRECCION_Y_FLUJO.sql
```

```
PARCHE 21 · bloque 0/7 · comprobaciones previas
NOTICE:  PARCHE 21 · estado de partida coherente
DO
BEGIN
PARCHE 21 · bloque 1/7 · la Directora recibe direccion_oaipcs
DO
INSERT 0 0
PARCHE 21 · bloque 2/7 · normalización de rol_responsable
UPDATE 0
UPDATE 0
COMMENT
ALTER TABLE
ALTER TABLE
CREATE FUNCTION
DROP TRIGGER
CREATE TRIGGER
PARCHE 21 · bloque 3/7 · aprobación de la alerta (G21)
NOTICE:  column "aprobada_por" of relation "alertas_tempranas" already exists, skipping
ALTER TABLE
NOTICE:  column "aprobada_en" of relation "alertas_tempranas" already exists, skipping
ALTER TABLE
ALTER TABLE
ALTER TABLE
COMMENT
COMMENT
NOTICE:  relation "ix_alertas_aprobada_por" already exists, skipping
CREATE INDEX
CREATE VIEW
COMMENT
PARCHE 21 · bloque 4/7 · RLS de los catálogos del flujo
ALTER TABLE
… (ENABLE/FORCE ×2 y DROP/CREATE POLICY ×8) …
PARCHE 21 · bloque 5/7 · comentarios de los catálogos
DO
PARCHE 21 · bloque 6/7 · verificación
NOTICE:  catálogos del flujo: 2 de 2 tablas con comentario de tabla, 0 columnas sin comentario
NOTICE:  direccion_oaipcs: 1 cuenta vigente (SEC-11) · usuario_roles: 36 · flujo_definicion: 12 pasos · proceso_instancia: 218 · alertas: 83 · columnas de vw_alerta_estado: 19
DO
COMMIT
PARCHE 21 · aplicado
```

Los tres `NOTICE` de «already exists, skipping» y los `UPDATE 0` / `INSERT 0 0`
son la prueba de que esa pasada fue la segunda (o posterior): la primera devolvió
`INSERT 0 1`, `UPDATE 4`, `UPDATE 3`.

El bloque 5 confirma algo que el encargo daba por dudoso: **los dos catálogos ya
tienen comentario de tabla** (2 de 2) y **no queda ninguna columna sin
comentario** (0). No había nada que redactar, y el parche no reformula
comentarios ajenos.

### 5.3 Idempotencia, medida dos veces

La segunda pasada completa no falla, no duplica y no reescribe `updated_at`. La
prueba dura es la marca de tiempo: se leyó `max(updated_at)` de
`core.flujo_definicion`, se volvió a aplicar el parche entero y se volvió a leer:

```
antes   → 2026-11-20 21:58:18.406921-05
pasada  → exit=0 · INSERT 0 0 · UPDATE 0 · UPDATE 0
después → 2026-11-20 21:58:18.406921-05
```

Idéntica. Las sentencias que sí se ejecutan en cada pasada son las que no
escriben datos: `CREATE OR REPLACE FUNCTION/VIEW`, `DROP CONSTRAINT IF EXISTS` +
`ADD CONSTRAINT`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` y
`DROP POLICY IF EXISTS` + `CREATE POLICY`. Recrear una política no cambia su
definición efectiva.

### 5.4 Prueba funcional del trigger, sin dejar rastro

Dentro de una transacción, sobre una fila temporal que después se borra (y en el
bloque 6 del propio parche, para que la verificación viaje con él):

```
token inexistente        → rol_responsable: el token «inventado» no existe en core.roles.codigo
texto libre del legado   → rol_responsable: el token «Sectorista/Directora» no existe en core.roles.codigo
alternativa aceptada     → sectorista,direccion_oaipcs
tras borrar la fila de prueba: 12 filas
```

La fila de prueba se elimina antes de terminar y el recuento vuelve a 12. En el
parche, además, si el trigger aceptara `inventado` la verificación lanza
`RAISE EXCEPTION` y toda la transacción se deshace.

### 5.5 Las columnas de las vistas y materializadas

Ampliar `core.vw_alerta_estado` de 17 a 19 columnas mueve el recuento de la
documentación, que habla de «**36 vistas y materializadas (298 columnas)**»:

| Objeto                    |   Antes | Después |
| ------------------------- | ------: | ------: |
| Vistas (30 objetos)       |     261 | **263** |
| Tablas materializadas (6) |      37 |      37 |
| **Total (36 objetos)**    | **298** | **300** |

La cuenta cuadra: 298 + 2 columnas nuevas = 300. `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`
(§193) y `docs/README.md` (§275–276) todavía dicen 298 y hay que llevarlos a 300.

---

## 6. Riesgos y lo que queda abierto

**1. G21 sigue sin poder ejecutarse, y no por estas columnas.** El contrato G21 de
`config.guardrail_contract` se dispara con `visibilidad = 'perfil_b'` y
`aprobada_por IS NULL`. `core.alertas_tempranas` **no tiene `visibilidad`**: el
parche pone las columnas de la aprobación, pero el gate necesita además la
columna de visibilidad, que es de otro parche. Hoy la restricción de G21 es
declarativa: existe el contrato, existen las dos columnas nuevas, falta la
tercera pieza.

**2. `core.permiso_aprobacion` sigue sin filas y sin consumidor.** Tiene RLS y
lectura abierta, pero nadie la lee ni la escribe. Está reservada para la
suplencia del aprobador con el objeto `alerta.aprobar_definitiva` (parche 20
§4.6). Mientras esté vacía no hay suplencia posible.

**3. La RLS de `core.flujo_estado` es carga estructural para el alta de
alertas.** `core.tg_alerta_nace()` busca `EST-01` en ese catálogo. Si alguien
cambia `p21_flujo_estado_select` por una política con `WITH CHECK`/`USING`
restringido, o la elimina, las alertas nuevas se crean **sin paso 1 y sin
error**. La lectura abierta no es un descuido que se pueda «endurecer» sin
romper el trigger. Lo mismo vale para `core.flujo_definicion` y su política
`p20_flujo_def_sel`.

**4. Cuatro ojos a nivel de persona, no de sesión.** Edith acumula ahora cuatro
roles (`sectorista`, `administrador`, `alta_direccion`, `direccion_oaipcs`), de
modo que puede validar en una sesión (paso 2) y aprobar en otra (paso 3). La
regla «quien valida no aprueba» la tendrá que imponer el gate con una condición
de persona (`aprobada_por <> validada_por`), no la RLS. Queda abierto con H-79
(cómo se elige el rol de la sesión).

**5. `core.alertas_tempranas.paso_actual` sigue desfasado.** Las 83 alertas
tienen `paso_actual = 1` mientras siguen cargadas con
`estado_legado = 'Archivado'` (se documentan como **Atendidas**; la
migración de ese estado sigue pendiente). Es un resto del sistema
anterior, no lo usa `core.vw_alerta_estado` y el parche no le inventa
semántica: o se recalcula desde `core.proceso_instancia` o se retira.

**6. El flujo `reporte` sigue con pasos sin definición.** `core.flujo_definicion`
define tres pasos de reporte (1..3), pero `core.proceso_instancia` tiene 9 filas
de reporte en los pasos 4, 5 y 6, todas sin `flujo_definicion_id`. El parche
normaliza el rol de los tres pasos existentes y no toca esas 9 filas: cerrar el
flujo de reporte es otro parche. Hoy no rompe nada porque `vw_alerta_estado` solo
mira `tipo_origen = 'alerta'`.

**7. `core.vw_alerta_estado` no tiene propósito en el diccionario.** Su ficha
sale como «Sin propósito documentado» porque no hay entrada en la curaduría de
vistas. Es anterior a este parche (viene del 14); ahora que la vista crece, el
hueco se nota más. Es de `migration/curacion_vistas.py`, no del parche.

**8. `core.alertas_tempranas` no tiene `visibilidad`.** Ya explicado en el punto
1; se repite aquí porque es la pieza que separa «G21 modelado» de «G21
ejecutable».

**9. Propagación: cerrada en lo que toca a los artefactos; abierta en lo
documental.**

- `compose.yaml` monta el parche como `111_patch_21.sql`, a continuación del
  `110`; `docker compose config --quiet` pasa. En el contenedor actual el montaje
  todavía llega al `109`, así que el archivo entra con el próximo
  `docker compose up -d`.
- `migration/consolidar_esquema.py` lo incorpora como bloque **B.16**, justo
  después de B.15, con `tolera_errores=False`.
- `migration/curacion_v10_columnas.py` **no recibe entradas nuevas**: las dos
  columnas de aprobación llevan su `COMMENT` dentro del parche (B.16) y, si
  estuvieran en la curaduría, `PARCHE_12` las comentaría antes de que existan.
  Lo único que se tocó ahí es la descripción de `core.flujo_definicion.rol_responsable`,
  que decía solo «Rol que debe ejecutar el paso del flujo», para que el
  diccionario cuente la convención.
- La cadena regenerada (comentarios → consolidar → diccionario → estadística →
  prioridad MVP → FKs) da: 2 147 columnas lógicas, 13 355 filas, 265 tablas
  lógicas / 289 físicas, 90 tablas con RLS y 552 políticas, 36 objetos
  derivados con 300 columnas, 611 claves ajenas (527 únicas para SQL Server) y
  3 320 filas en el CSV del diccionario.

Lo que queda abierto es documental y de otro dueño. Estas frases todavía llevan
las cifras anteriores:

| Documento                                         | Línea(s)            | Dice                                                                                                       | Debe decir                                                  |
| ------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `docs/README.md`                                  | 5 (nota de pasadas) | «88 tablas y 544 políticas», «49 de 102 tablas y 319 políticas»                                            | 90 / 552 y 51 de 102 / 327, más la nota de la octava pasada |
| `docs/README.md`                                  | 270–279             | «2 145 columnas lógicas», «36 … con 298 columnas», «544 políticas sobre 88 tablas», «49 de sus 102 tablas» | 2 147, 300, 552 / 90, 51                                    |
| `docs/README.md`                                  | 135–137, 360        | tabla de parches hasta el 20, «los 20 SQL», «parches 6–20»                                                 | fila del 21 como `111`, «21 SQL», «6–21»                    |
| `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`    | 179, 191–196        | «49 (… tras el parche 20)», «298 columnas», «2 145 columnas», «610 claves ajenas», «544 … sobre 88 tablas» | 51, 300, 2 147, 611, 552 / 90                               |
| `docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md` | 545–547             | cifras de RLS anteriores                                                                                   | 90 / 552                                                    |
| `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md`    | §6                  | tabla de roles sin `direccion_oaipcs`; cifras de columnas/RLS                                              | añadir el rol y las cifras nuevas                           |

Los informes P18 y P20 conservan sus cifras: son fotos de su momento y no se
reescriben.

---

## 7. Actualización posterior (parches 22 y 23)

Se escribe después y **no reescribe** los pendientes de §6, que quedan como foto
del estado que este parche dejó. Lo que sigue dice qué cerró cada parche
posterior.

| Pendiente de §6                                            | Estado                         | Quién lo cerró                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. G21 sigue sin poder ejecutarse                          | **Cerrado**                    | Parche 22: `visibilidad` y el trigger `alertas_g21_visibilidad`; parche 23: el gate pasa a exigir cuatro ojos y destinatarios                                     |
| 2. `core.permiso_aprobacion` sin filas y sin consumidor    | **Cerrado en el consumo**      | Parche 22: `core.puede_aprobar()` la consulta y `core.vw_permiso_aprobacion` la expone. Sigue con **0 filas** porque no hay suplente designado                    |
| 3. La RLS de `core.flujo_estado` es carga estructural      | **Abierto, como recordatorio** | No cambió: la lectura abierta sigue siendo obligatoria para `core.tg_alerta_nace()`                                                                               |
| 4. Cuatro ojos a nivel de persona                          | **Cerrado**                    | Parche 23: `core.alertas_tempranas.validada_por`, el `CHECK` `alertas_cuatro_ojos` y la comprobación en el gate G21 (H-84). H-79, que es otra cosa, sigue abierto |
| 5. `paso_actual` desfasado                                 | **Cerrado**                    | Parche 22: de 1 a 5 en las 83 alertas, derivado de `core.proceso_instancia`                                                                                       |
| 6. El flujo `reporte` con pasos sin definición             | **Abierto, y documentado**     | Parche 22: los 9 pasos se explican con `flujo_definicion_id = NULL`; el catálogo no se amplía                                                                     |
| 7. `core.vw_alerta_estado` sin propósito en el diccionario | **Cerrado**                    | Parche 22: `migration/curacion_vistas.py` documenta su propósito y añade `core.vw_permiso_aprobacion`                                                             |
| 8. `core.alertas_tempranas` sin `visibilidad`              | **Cerrado**                    | Parche 22: `varchar(12)` con tres valores, `CHECK` e índice parcial                                                                                               |
| 9. Propagación documental                                  | **Cerrada**                    | Pasadas novena y décima: las frases del cierre de §6 ya llevan las cifras vigentes                                                                                |
