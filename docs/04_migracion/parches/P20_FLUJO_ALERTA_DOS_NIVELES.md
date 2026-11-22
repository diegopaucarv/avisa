# P20 — Los dos niveles de aprobación de la alerta temprana

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 — RN-04, RF-D09, RN-02, CU-08 y §5.1 (H-25 cerrado)
**Entorno de ensayo:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_20_FLUJO_ALERTA.sql` (idempotente, re-ejecutable)
**Estado:** **aplicado y verificado en la base viva el 2026-11-20.** Antes se
ensayó dentro de una transacción terminada en `ROLLBACK` (§6.1–§6.3); la
aplicación en firme, con sus cifras medidas y el estado del montaje, está en §6.4.

---

## 1. Resumen

`core.flujo_definicion` no modelaba los dos niveles que exige RN-04. El paso 2
(«Validación») apuntaba a `analista_cualitativo` —el rol del análisis
cualitativo REFI-QDA, ajeno a las alertas— y el paso 3 (Remisión) apuntaba a
`alta_direccion`, que es el ministerio que **recibe** la alerta: el flujo decía
que el destinatario se remitía a sí mismo. La aprobación definitiva de la
Dirección de la OAIPCS no existía en ninguna tabla.

El parche deja el flujo de alerta en **cinco pasos** —Elaboración → Validación
previa → Aprobación definitiva → Remisión → Archivo—, crea el rol
`direccion_oaipcs`, renombre y reapunta los pasos existentes, renumera las 83
instancias del Archivo del paso 4 al 5 y pone RLS en el catálogo de pasos.

En cifras (medidas, no estimadas):

| Dato                                                 | Antes |                         Después |
| ---------------------------------------------------- | ----: | ------------------------------: |
| Pasos del flujo `alerta`                             |     4 |                               5 |
| Filas en `core.flujo_definicion`                     |    11 |                              12 |
| Filas en `core.roles`                                |     9 |                              10 |
| Filas en `core.flujo_estado`                         |     5 |              **5** (sin cambio) |
| Filas en `core.proceso_instancia`                    |   218 | **218** (no se inserta ninguna) |
| Instancias de alerta en el paso 1                    |    72 |                              72 |
| Instancias de alerta en el paso 4                    |    83 |                           **0** |
| Instancias de alerta en el paso 5                    |     0 |                              83 |
| Políticas en `core.flujo_definicion`                 |     0 |                               4 |
| Tablas con RLS en todo el modelo                     |    87 |                              88 |
| Políticas RLS en todo el modelo                      |   540 |                             544 |
| Pasos con `rol_responsable = 'analista_cualitativo'` |     1 |                           **0** |
| Filas en `core.permiso_aprobacion`                   |     0 |              **0** (sin cambio) |

Lo que el parche **no** hace, y conviene decirlo antes de cualquier tabla: no
inserta ni una fila en `core.proceso_instancia`, no crea estados, no asigna
cuentas al rol nuevo y no toca `core.permiso_aprobacion`. Se detalla en §4 y §7.

---

## 2. Secuencia final de pasos (`tipo_flujo = 'alerta'`)

| orden | nombre                | `rol_responsable`  | `estado_resultante` | `codigo_legado`    | qué pasó con la fila                                             |
| ----: | --------------------- | ------------------ | ------------------- | ------------------ | ---------------------------------------------------------------- |
|     1 | Elaboración           | `sectorista`       | Registrado          | `DPPA-1`           | intacta (anclaje del trigger)                                    |
|     2 | Validación previa     | `sectorista`       | Validado            | `DPPA-2`           | cambia nombre y rol (`analista_cualitativo` → `sectorista`)      |
|     3 | Aprobación definitiva | `direccion_oaipcs` | Aprobado            | `V10-ALERTA-APROB` | **fila nueva**, sin equivalente en el legado                     |
|     4 | Remisión              | `servicio_agente`  | Remitido            | `DPPA-3`           | sube de 3 a 4; cambia rol (`alta_direccion` → `servicio_agente`) |
|     5 | Archivo               | `sectorista`       | Archivado           | `DPPA-4`           | sube de 4 a 5; sin más cambios                                   |

Los destinatarios no aparecen aquí a propósito: la Secretaría General y las
jefaturas de gabinete **no son usuarios del sistema** (RN-02), no son roles de
`core.roles` y no deben modelarse como tales. La gravedad decide a quién se
avisa y en cuánto tiempo; no decide quién autoriza.

---

## 3. Qué cambia

| Objeto                                     | Tipo                             | Qué hace                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core.roles` (`direccion_oaipcs`)          | fila nueva (`id = 10`)           | Responsable del paso de aprobación: nivel 3, crea, edita, no borra.                                                                                                                  |
| `core.flujo_definicion` `DPPA-2`           | `UPDATE`                         | Nombre «Validación previa», rol `sectorista`, descripción alineada a RN-04.                                                                                                          |
| `core.flujo_definicion` `DPPA-3`           | `UPDATE`                         | `orden` 3 → 4, rol `alta_direccion` → `servicio_agente`, descripción con los destinatarios por gravedad.                                                                             |
| `core.flujo_definicion` `DPPA-4`           | `UPDATE`                         | `orden` 4 → 5.                                                                                                                                                                       |
| `core.flujo_definicion` `V10-ALERTA-APROB` | `INSERT`                         | El paso de aprobación definitiva de la Dirección.                                                                                                                                    |
| `core.proceso_instancia` (83 filas)        | `UPDATE`                         | `orden` 4 → 5, con `flujo_definicion_id` reapuntado a `DPPA-4` por código.                                                                                                           |
| `p20_flujo_def_sel`                        | política `PERMISSIVE FOR SELECT` | `USING (true)`: la lectura queda abierta a toda sesión.                                                                                                                              |
| `p20_flujo_def_ins` / `_upd` / `_del`      | políticas `PERMISSIVE`           | Solo `core.rol_actual() = 'administrador'` escribe el catálogo.                                                                                                                      |
| Comentarios                                | 5 `COMMENT ON COLUMN`            | Corrigen el texto que el cambio dejó falso (pasos «cuatro» → «cinco», vocabulario de `estado_resultante`, `codigo_legado` con prefijo `V10-`, `proceso_instancia.orden` renumerado). |

Todo el cuerpo va entre `BEGIN` y `COMMIT`; los `UPDATE` llevan guarda
`IS DISTINCT FROM`, así que una segunda pasada devuelve `UPDATE 0` en todos
ellos y no reescribe `updated_at`.

---

## 4. Por qué, decisión por decisión

### 4.1 El rol: se crea `direccion_oaipcs`

**No sirve `alta_direccion`.** Es el ministerio que recibe la alerta: nivel 3 y
solo lectura (`puede_crear = f`). Usarlo como responsable del paso de
aprobación era el error de origen, no la solución.

**No sirve reutilizar `sectorista`.** `flujo_definicion.rol_responsable` es un
texto libre sin FK, de modo que técnicamente se podría escribir `sectorista` en
los dos pasos. Pero entonces el catálogo no distinguiría quién valida de quién
aprueba, y RN-04 pide dos niveles precisamente para que sean dos actos
distintos. Un mismo código en los pasos 2 y 3 borra esa distinción del modelo.

Rol nuevo, con estas capacidades:

| `codigo`           | `max_clasificacion` | crea | edita | borra | razón                                                                                                                                                                                                                                             |
| ------------------ | ------------------: | :--: | :---: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direccion_oaipcs` |                   3 |  sí  |  sí   |  no   | Nivel 3 para ver alertas confidenciales; aprobar es un acto de escritura (registra el paso en `core.proceso_instancia` y la aprobación en la alerta), y ningún paso del flujo borra nada. `puede_eliminar = false` cumple `ck_roles_capacidades`. |

El nivel 3 y las capacidades replican el patrón de `auditor` y
`servicio_agente`, que también crean y editan sin borrar.

**Qué pasa con las 32 cuentas: nada.** El rol nace con **0 cuentas**; las 32
cuentas y las 35 asignaciones quedan intactas (medido: 9 roles y 35 asignaciones
antes y después del `ROLLBACK`).

**Qué pasa con la Directora.** Edith Bautista León (código legado `SEC-11`) tiene
hoy tres roles (`sectorista`, `administrador`, `alta_direccion`). **Este parche
no le asigna `direccion_oaipcs`**: quién ocupa la Dirección es un hecho
administrativo, no un dato que el SQL pueda deducir, y asignar roles sin acto de
por medio sería inventar historia. Consecuencia inmediata: hasta que exista esa
asignación, el paso 3 no tiene ninguna cuenta elegible. El comando para cuando la
OAIPCS lo autorice es este (idempotente, y tal cual escrito lleva las
asignaciones de 35 a 36; `desde` toma `CURRENT_DATE` y `hasta` queda en `NULL`,
que es «abierta»):

```sql
INSERT INTO core.usuario_roles (usuario_id, rol_id)
SELECT u.id, r.id
  FROM core.usuarios u, core.roles r
 WHERE u.codigo_legado = 'SEC-11'          -- Edith Bautista León
   AND r.codigo = 'direccion_oaipcs'
   AND NOT EXISTS (SELECT 1 FROM core.usuario_roles x
                    WHERE x.usuario_id = u.id AND x.rol_id = r.id);
```

### 4.2 La secuencia: cinco pasos, y Remisión la ejecuta el servicio

Se mantiene la propuesta del encargo. La única elección propia es el
responsable de Remisión:

- `alta_direccion` no puede ser: remitiría el propio destinatario.
- `sectorista` podría, pero Remisión no es un acto de criterio: es el envío que
  queda registrado en `core.envios_comunicacion` (correo, WhatsApp, borrador en
  Drive), y su ejecutor natural en este modelo es el servicio. `servicio_agente`
  existe con `puede_crear/editar` y 0 cuentas, que es exactamente el perfil de
  un actor automático.

El paso 1 **no** se toca: `core.tg_alerta_nace()` lo busca por
`tipo_flujo = 'alerta' AND orden = 1`, y moverlo habría roto el alta de alertas.
Verificado: la función sigue igual y sigue creando el paso 1 (§6, ensayo T3/T4).

### 4.3 El estado: **no** se crea `EST-06`

`core.flujo_estado` no es «los estados de una alerta»: son los **cinco estados
de un paso** que trajo el legado (`legacy.dim_estado_proceso` → `EST-01..05`,
parche 10). El parche 10 fijó expresamente (§2.3) que el estado de negocio vive
en `core.flujo_definicion.estado_resultante` como texto, y que emparejar los dos
vocabularios «sería inventar la equivalencia». Añadir `EST-06 Aprobado` metería
un estado de negocio en un catálogo de estados de paso y reabriría esa decisión.

Con «Aprobado» en `estado_resultante`, el paso 3 ya tiene su estado de negocio, y
su estado de paso es el de siempre: `EST-01` mientras está pendiente, `EST-02`
cuando se completa, `EST-03`/`EST-04` si se observa o se devuelve. La vista
`core.vw_alerta_estado` no necesita nada más: muestra `Aprobación definitiva`
como `paso_nombre` y `EST-02` como estado del paso.

### 4.4 Los `codigo_legado`: se conservan en el paso equivalente

`codigo_legado` identifica la **identidad** del paso, no su posición. Por eso
`DPPA-3` sigue siendo Remisión (ahora en el orden 4) y `DPPA-4` sigue siendo
Archivo (ahora en el 5). Renumerarlos habría roto la trazabilidad con
`dim_paso_proceso` sin ganar nada.

El paso nuevo **no** puede llamarse `DPPA-5`: no viene del legado y numerarlo en
esa serie haría creer que sí. Lleva `V10-ALERTA-APROB`, con prefijo `V10-` para
que cualquier filtro `codigo_legado LIKE 'DPPA-%'` siga devolviendo exactamente
los cuatro pasos heredados.

### 4.5 RLS: lectura abierta, escritura solo `administrador`

El catálogo de pasos no tenía ninguna política: cualquier sesión de aplicación
podía reescribir el flujo de toda la organización. Ahora tiene `ENABLE` +
`FORCE` y cuatro políticas:

```sql
p20_flujo_def_sel  FOR SELECT USING (true)
p20_flujo_def_ins  FOR INSERT WITH CHECK (core.rol_actual() = 'administrador')
p20_flujo_def_upd  FOR UPDATE USING/WITH CHECK (core.rol_actual() = 'administrador')
p20_flujo_def_del  FOR DELETE USING (core.rol_actual() = 'administrador')
```

La lectura **tiene** que quedar abierta: `core.tg_alerta_nace()` hace `SELECT`
sobre esta tabla y, si las políticas devolvieran 0 filas, las alertas nacerían
sin paso 1 y sin error visible. Se comprobó con el trigger, dentro del ensayo:

```sql
BEGIN;
SET LOCAL ROLE avisa_app;
SET LOCAL app.rol_codigo = 'sectorista';
SELECT count(*) FROM core.flujo_definicion;      -- 12  (la lectura no se bloquea)
INSERT INTO core.alertas_tempranas
       (codigo_alerta, titulo, nivel_clasificacion)
VALUES ('P20-ENSAYO-B','Ensayo RLS',2);
SELECT p.orden, d.codigo_legado, e.codigo
  FROM core.proceso_instancia p
  JOIN core.flujo_definicion d ON d.id = p.flujo_definicion_id
  JOIN core.flujo_estado e     ON e.id = p.estado_id
 WHERE p.alerta_id = (SELECT id FROM core.alertas_tempranas
                       WHERE codigo_alerta = 'P20-ENSAYO-B');
ROLLBACK;
-- 1 | DPPA-1 | EST-01
```

El paso 1 nace igual que antes. Doble motivo: la política `SELECT` deja pasar la
fila y, además, la función es `SECURITY DEFINER` de un dueño superusuario, que
no está sujeto a RLS. La escritura sí se cierra, también medido:

```sql
-- con app.rol_codigo = 'sectorista'
UPDATE core.flujo_definicion SET descripcion = descripcion
 WHERE codigo_legado = 'DPPA-1';          -- UPDATE 0
-- con app.rol_codigo = 'administrador'
UPDATE core.flujo_definicion SET descripcion = descripcion
 WHERE codigo_legado = 'DPPA-1';          -- UPDATE 1
```

### 4.6 `core.permiso_aprobacion`: queda fuera por ahora

La arquitectura (§11.8) dice que «las aprobaciones no se dan por rol sino por
permiso» y reserva esa tabla para conceder aprobaciones con vigencia. Este
parche **no la usa**: tiene 0 filas, no tiene RLS y no tiene ningún consumidor;
enlazarla ahora habría dejado la apariencia de un control que nadie ejerce.

Queda **reservada** para un solo caso, la suplencia del aprobador (cuando la
Dirección delega la firma en otra persona durante un periodo). El nombre de
objeto que se reserva es `alerta.aprobar_definitiva`, para que el agente que la
implemente no invente otro. Mientras no exista fila, el paso 3 se ejecuta con el
rol `direccion_oaipcs` y nadie más. Se anota en §7 como pendiente, con su
consecuencia: hoy no hay suplencia posible.

### 4.7 `analista_cualitativo` sale del flujo de alertas

El paso 2 era el único que lo usaba. Tras el parche, la verificación falla si
queda algún paso con ese rol (bloque 6.4) y la medición da **0 filas**. El rol
sigue existiendo en `core.roles` para el análisis cualitativo `qda`, que es su
sitio; simplemente ya no aparece como responsable de ningún paso.

---

## 5. Migración de datos

### 5.1 `core.flujo_definicion`

Dos restricciones mandan el orden de las sentencias: `UNIQUE (tipo_flujo, orden)`
y `UNIQUE (codigo_legado)`. Ninguna es diferible, así que no se puede insertar en
el 3 mientras el 3 esté ocupado. El parche renumera de arriba abajo:

1. `DPPA-4` (Archivo) pasa de 4 a 5 → libera el 4.
2. `DPPA-3` (Remisión) pasa de 3 a 4 → libera el 3.
3. Se inserta el paso nuevo en el 3.

### 5.2 `core.proceso_instancia`

**No se inserta ninguna fila.** El `UNIQUE (tipo_origen, fila_legado)` obligaría
a inventar `fila_legado` para los pasos 2 y 3, y el legado nunca registró
validación ni remisión: esos pasos no existen como dato y no se fabrican.

| Filas | `orden` antes | `orden` después | `flujo_definicion_id`            | Tratamiento                                                                                                                                                               |
| ----: | ------------: | --------------: | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    72 |             1 |               1 | `DPPA-1` (sin cambio)            | Intactas.                                                                                                                                                                 |
|    83 |             4 |               5 | `DPPA-4` (reapuntado por código) | Renumeradas: la vista ordena por `orden` descendente y, dejándolas en 4, el Archivo habría empatado con Remisión y `vw_alerta_estado` habría mostrado el paso equivocado. |

Resultado medido tras el parche: `orden 1 → 72`, `orden 4 → 0`, `orden 5 → 83`,
`core.proceso_instancia → 218` filas. Las 83 alertas conservan una fila y las 57
que tenían paso 1 lo conservan.

### 5.3 Un error que el ensayo cazó

La primera versión de la guarda era
`AND (p.orden = 4 OR p.flujo_definicion_id IS DISTINCT FROM d.id)`. El segundo
término también era cierto para las 72 filas del paso 1 (apuntan a `DPPA-1`, que
es distinto de `DPPA-4`), así que las arrastraba al paso 5: el ensayo devolvió
`UPDATE 155` y `orden 1 → 0`. La guarda quedó en **`AND p.orden = 4`** y el
ensayo pasó a `UPDATE 83`. Es el motivo por el que el ensayo se hace con
`ROLLBACK`: ese `UPDATE` habría dejado las 72 filas del paso 1 en el paso 5 sin
un solo error.

---

## 6. Verificación con cifras medidas

Método, sin dejar rastro en la base:

```sh
sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' \
    docs/PARCHE_20_FLUJO_ALERTA.sql > /tmp/p20_body.sql
cat /tmp/p20_head.sql  /tmp/p20_body.sql /tmp/p20_body.sql /tmp/p20_tests.sql \
    > /tmp/p20_r.sql          # BEGIN + el parche dos veces + pruebas + ROLLBACK
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
    -v ON_ERROR_STOP=1 -A -F'|' -f - < /tmp/p20_r.sql
```

| Dato                                                            |                         Valor | Consulta |
| --------------------------------------------------------------- | ----------------------------: | -------- |
| Pasos del flujo de alerta                                       |                             5 | Q1       |
| Filas en `core.flujo_definicion` (dentro de la transacción)     |                            12 | Q2       |
| Filas en `core.flujo_definicion` (tras `ROLLBACK`)              |                            11 | Q2       |
| Filas en `core.flujo_estado`                                    |                             5 | Q2       |
| Filas en `core.roles` (dentro / tras `ROLLBACK`)                |                        10 / 9 | Q2       |
| Filas en `core.proceso_instancia`                               |                           218 | Q2       |
| Instancias de alerta en el paso 1                               |                            72 | Q3       |
| Instancias de alerta en el paso 4                               |                             0 | Q3       |
| Instancias de alerta en el paso 5                               |                            83 | Q3       |
| Filas de `core.vw_alerta_estado`                                |                            83 | Q4       |
| Pasos con `analista_cualitativo`                                |                             0 | Q5       |
| Cuentas con `direccion_oaipcs`                                  |                             0 | Q6       |
| Políticas en `core.flujo_definicion` (dentro / tras `ROLLBACK`) |                         4 / 0 | Q7       |
| Segunda ejecución del parche                                    | todo `UPDATE 0`, `INSERT 0 0` | §6.2     |
| Filas insertadas en `core.proceso_instancia` por el parche      |                             0 | Q3       |

```sql
-- Q1 · el flujo resultante
SELECT orden, nombre, rol_responsable, estado_resultante, codigo_legado
  FROM core.flujo_definicion WHERE tipo_flujo = 'alerta' ORDER BY orden;

-- Q2 · conteos de cabecera
SELECT 'flujo_definicion' AS dato, count(*) FROM core.flujo_definicion
UNION ALL SELECT 'flujo_estado',       count(*) FROM core.flujo_estado
UNION ALL SELECT 'roles',              count(*) FROM core.roles
UNION ALL SELECT 'proceso_instancia',  count(*) FROM core.proceso_instancia;

-- Q3 · instancias de alerta por paso
SELECT orden, count(*) FROM core.proceso_instancia
 WHERE tipo_origen = 'alerta' GROUP BY orden ORDER BY orden;

-- Q4 · la vista dependiente
SELECT count(*) FROM core.vw_alerta_estado;

-- Q5 · el rol que sale
SELECT count(*) FROM core.flujo_definicion
 WHERE rol_responsable = 'analista_cualitativo';

-- Q6 · cuentas del rol nuevo
SELECT count(*) FROM core.usuario_roles ur JOIN core.roles r ON r.id = ur.rol_id
 WHERE r.codigo = 'direccion_oaipcs';

-- Q7 · RLS del catálogo
SELECT count(*) FROM pg_policies
 WHERE schemaname = 'core' AND tablename = 'flujo_definicion';

-- Q8 · RLS de todo el modelo (las particiones no llevan RLS propia: una por tabla)
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relrowsecurity AND c.relkind IN ('r','p')
   AND n.nspname NOT IN ('pg_catalog','information_schema');
SELECT count(*) FROM pg_policy;

-- Q9 · RLS dentro de core
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relrowsecurity AND c.relkind IN ('r','p') AND n.nspname = 'core';
SELECT count(*) FROM pg_policy p JOIN pg_class k ON k.oid = p.polrelid
  JOIN pg_namespace m ON m.oid = k.relnamespace WHERE m.nspname = 'core';
```

### 6.1 Salida literal, tras aplicar el parche dos veces y antes del `ROLLBACK`

```
dato|valor
flujo_definicion|12
flujo_estado|5
pi_alerta_orden1|72
pi_alerta_orden5|83
proceso_instancia|218
roles|10
vw_alerta_estado|83

orden|nombre|rol_responsable|estado_resultante|codigo_legado
1|Elaboración|sectorista|Registrado|DPPA-1
2|Validación previa|sectorista|Validado|DPPA-2
3|Aprobación definitiva|direccion_oaipcs|Aprobado|V10-ALERTA-APROB
4|Remisión|servicio_agente|Remitido|DPPA-3
5|Archivo|sectorista|Archivado|DPPA-4
```

Ensayo del trigger dentro de la misma transacción (T3 y T4 de §4.5): la alerta
insertada como superusuario nace con `1 | DPPA-1 | Elaboración | EST-01 |
fila_legado 1084`, y la insertada como `avisa_app`/`sectorista` nace con
`1 | DPPA-1 | EST-01`. Ninguna nace sin paso.

Cifras con los dos datos de prueba ya dentro: `proceso_instancia → 220` y
`flujo_definicion → 12`, que son las 218 + 2 filas de paso 1 creadas por el
trigger.

### 6.2 Idempotencia

Segunda ejecución del cuerpo completo, dentro de la misma transacción:

```
bloque 1 · INSERT 0 0 · UPDATE 0
bloque 2 · UPDATE 0 · UPDATE 0 · UPDATE 0 · INSERT 0 0
bloque 3 · UPDATE 0
bloque 4 · ALTER TABLE ×2 · DROP/CREATE POLICY ×4 (sin avisos)
bloque 5 · COMMENT ×5
bloque 6 · DO  (5 pasos · 72 en el paso 1 · 83 en el paso 5 · 83 filas en la vista)
```

Ninguna sentencia falla, no se duplica nada y no se reescribe `updated_at`.

### 6.3 Durante el ensayo: tras el `ROLLBACK` la base quedaba como estaba

```
dato|valor
flujo_definicion|11
flujo_estado|5
pi_alerta_orden1|72
pi_alerta_orden4_legado|83
pi_alerta_orden5|0
proceso_instancia|218
roles|9
roles_direccion_oaipcs|0
vw_alerta_estado|83
```

Comprobaciones adicionales tras el `ROLLBACK`: `core.flujo_definicion` con
`relrowsecurity = f`, `relforcerowsecurity = f` y **0** políticas; 83 alertas;
**0** filas en `core.permiso_aprobacion`; 57 alertas con paso 1 y 83 con Archivo.
No quedó ningún archivo temporal en el repositorio: los del ensayo viven en
`/tmp` y el parche en `docs/`.

Ese fue el estado **durante el ensayo**. El mismo 2026-11-20 el parche se aplicó
en firme, así que la base viva ya no está como se describe en este apartado: ver
§6.4.

### 6.4 La aplicación en firme, medida el 2026-11-20

El parche se aplicó sobre `avisa-db` por entrada estándar (`-f -`), y estas son
las cifras medidas **después** de la aplicación con las consultas de §6:

| Dato                                           |    Valor medido | Consulta |
| ---------------------------------------------- | --------------: | -------- |
| Pasos del flujo `alerta`                       |               5 | Q1       |
| Filas en `core.flujo_definicion`               |              12 | Q2       |
| Filas en `core.flujo_estado`                   |               5 | Q2       |
| Filas en `core.roles`                          |              10 | Q2       |
| Filas en `core.proceso_instancia`              |             218 | Q2       |
| Instancias de alerta en el paso 1 / 4 / 5      | 72 / **0** / 83 | Q3       |
| Filas de `core.vw_alerta_estado`               |              83 | Q4       |
| Pasos con `analista_cualitativo`               |               0 | Q5       |
| Cuentas con `direccion_oaipcs`                 |               0 | Q6       |
| Políticas en `core.flujo_definicion`           |               4 | Q7       |
| Tablas con RLS en todo el modelo               |              88 | Q8       |
| Políticas RLS en todo el modelo                |             544 | Q8       |
| Tablas con RLS en `core` / políticas en `core` |        49 / 319 | Q9       |

Las dos filas de RLS del modelo y la de `core` no las imprime el parche: se miden
en el catálogo. El parche añade exactamente una tabla protegida
(`core.flujo_definicion`, antes sin RLS) con cuatro políticas, así que el salto
cuadra: 87 + 1 = 88 tablas y 540 + 4 = 544 políticas en el modelo; 48 + 1 = 49 y
315 + 4 = 319 en `core`. Ninguna partición lleva RLS propia, de modo que el
recuento es por tabla lógica.

**El montaje.** `compose.yaml` ya declara el archivo como
`./docs/PARCHE_20_FLUJO_ALERTA.sql` → `/opt/avisa/sql/110_patch_20.sql`, en solo
lectura. Pero los bind mounts se fijan al crear el contenedor, así que el archivo
**todavía no está dentro de `avisa-db`**: la aplicación de hoy se hizo por
entrada estándar desde `docs/`. Estará disponible como `110_patch_20.sql` dentro
del contenedor tras el próximo `docker compose up -d` (que recrea el contenedor).

---

## 7. Riesgos y pendientes

**1. El paso 3 no tiene con quién ejecutarse todavía.** El rol `direccion_oaipcs`
nace con 0 cuentas. Hasta que la Directora (o quien la OAIPCS designe) reciba la
asignación, el flujo está bien modelado y es inoperante para aprobar. Es una
decisión administrativa, no un defecto del parche. Se resuelve con el `INSERT`
de §4.1.

**2. Cuatro ojos a nivel de persona, no de sesión.** Si Edith acumula
`sectorista` y `direccion_oaipcs`, puede validar en una sesión y aprobar en otra.
El parche separa los roles, no a las personas. La regla «quien valida no
aprueba» tiene que imponerla el gate G21 con una condición de persona
(`aprobada_por <> validada_por`). Queda abierto, junto con H-79 (cómo se elige
el rol de la sesión).

**3. La aprobación no cabe todavía en `core.alertas_tempranas`.** La tabla tiene
`es_validado_humano`, `fecha_validacion` y `fecha_remision`, pero **no** tiene
`aprobada_por` ni `aprobada_en`, que es lo que pide G21 en la arquitectura. Hoy
el rastro del aprobador solo puede vivir en `proceso_instancia.usuario_id`. Ese
`INSERT` hay que hacerlo en el parche que implemente G21, no aquí.

**4. `core.permiso_aprobacion` sigue sin RLS y sin uso.** Reservada para la
suplencia del aprobador con el objeto `alerta.aprobar_definitiva`. Sin filas, sin
política y sin consumidor: mientras siga así, no hay suplencia y cualquiera con
sesión de aplicación podría escribir en ella. La política le corresponde al
parche que la active.

**5. `avisa_app` conserva `INSERT`, `UPDATE` y `DELETE` sobre el catálogo.** Se
mantuvo el patrón del parche 18 para `core.roles`: los privilegios quedan y el
control es la RLS. Un `REVOKE` sería defensa en profundidad, pero también
impediría al `administrador` mantener el catálogo desde la API, que es para lo
que existe.

**6. Inconsistencia `reporte`, reportada y no arreglada.** `core.flujo_definicion`
define tres pasos de reporte (1..3), pero `core.proceso_instancia` tiene filas de
reporte en los pasos **4, 5 y 6** (3 cada uno, **9 filas**, todas con
`flujo_definicion_id` vacío), además de 3 filas en el paso 2 y 3 en el 3, que sí
resuelven. Es la deuda que el anexo A.5 del cierre de D17 ya señalaba («pasos
4–6 sin definición», 9 filas). No entra en este parche; queda para el que cierre
el flujo de reporte. Hoy no rompe nada: `core.vw_alerta_estado` solo mira
`tipo_origen = 'alerta'`.

**7. `core.alertas_tempranas.paso_actual` está en desfase, y ya lo estaba.** Las
83 alertas tienen `paso_actual = 1` mientras todas siguen cargadas con
`estado_legado = 'Archivado'` (se documentan como **Atendidas**; la migración
de ese estado sigue pendiente). La columna no la usa
`core.vw_alerta_estado`. Tras el parche la definición tiene cinco
pasos, así que el campo sigue siendo un resto sin mantenimiento: o se recalcula
desde `proceso_instancia` o se retira. No se toca aquí para no inventar su
semántica.

**8. `core.flujo_estado` y `core.permiso_aprobacion` siguen sin RLS.** Se cerró
el catálogo de pasos, no sus vecinos. Cualquier sesión puede reescribir los cinco
estados de paso, y `tg_alerta_nace()` los lee por código (`EST-01`): un cambio
ahí sí puede dejar alertas sin paso. Es el siguiente agujero de la misma familia.

**9. Propagación: cerrada en lo que toca a los artefactos.** `compose.yaml` monta
el parche como `110_patch_20.sql` a continuación del 19, `consolidar_esquema.py`
lo incorporó a la lista ordenada (bloque B.15) y estrenó la cadena completa:
esquema unificado, `PARCHE_12_COMENTARIOS_COLUMNAS.sql`, diccionario y CSV,
`LEGADO_A_V10`, `mvp_prioridad_tablas.csv` y la copia de `sql_server/` con sus
`delta_*.svg`. Lo que sigue abierto es documental y de otro dueño: el §6 del ERS
todavía dice que `core.roles` tiene **9 roles** (la base tiene 10 desde este
parche) y su tabla de roles no incluye `direccion_oaipcs`. El flujo de dos
niveles, en cambio, ya está descrito en RN-04, RF-D09, CU-08 y OBJ-02.

---

## 8. Actualización posterior (parches 21, 22 y 23)

Esta sección se escribe después y **no reescribe** lo anterior: los pendientes de
§7 se conservan como foto del estado que este parche dejó. Lo que sigue dice qué
cerró cada parche posterior, para que nadie lea §7 como si siguiera vigente.

| Pendiente de §7                                                      | Estado                     | Quién lo cerró                                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. El paso 3 no tiene con quién ejecutarse                           | **Cerrado**                | Parche 21: `direccion_oaipcs` pasa de 0 a 1 cuenta, la Directora (`SEC-11`)                                                                                       |
| 2. Cuatro ojos a nivel de persona                                    | **Cerrado**                | Parche 23: `validada_por`, el `CHECK` `alertas_cuatro_ojos` y la comprobación en el gate G21 (H-84)                                                               |
| 3. La aprobación no cabe en `core.alertas_tempranas`                 | **Cerrado**                | Parche 21: `aprobada_por` y `aprobada_en`; el parche 22 da el gate y el 23 la primera firma                                                                       |
| 4. `core.permiso_aprobacion` sin RLS ni uso                          | **Cerrado**                | Parche 21: RLS forzada con lectura abierta; parche 22: `core.puede_aprobar()` y `core.vw_permiso_aprobacion` como consumidores. Sigue con **0 filas** a propósito |
| 5. `avisa_app` conserva `INSERT`, `UPDATE` y `DELETE` en el catálogo | **Abierto, como estaba**   | Se mantuvo el patrón del parche 18: el control es la RLS                                                                                                          |
| 6. Las 9 filas de `reporte` sin definición                           | **Abierto, y documentado** | Parche 22: se explican como pasos del sistema anterior sin equivalente; el catálogo no se amplía                                                                  |
| 7. `paso_actual` en desfase                                          | **Cerrado**                | Parche 22: las 83 alertas pasan de 1 a 5, derivándolo de `core.proceso_instancia`                                                                                 |
| 8. `core.flujo_estado` y `core.permiso_aprobacion` sin RLS           | **Cerrado**                | Parche 21: RLS forzada en ambas, con lectura abierta                                                                                                              |
| 9. Propagación documental                                            | **Cerrada**                | Pasadas octava, novena y décima: el §6 del ERS ya incluye `direccion_oaipcs` y sus cifras                                                                         |

Ninguna de esas piezas cambió el contenido de este parche: las filas que movió
siguen siendo las mismas y su SQL no se ha tocado.
