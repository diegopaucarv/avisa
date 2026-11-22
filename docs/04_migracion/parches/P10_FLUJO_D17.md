# P10 — Flujo por pasos (decisión de migración D17)

Estado: **abierta y cargada**. Parche ejecutado contra `avisa-db` el 2026-11-18.
Entregable SQL: `docs/PARCHE_10_FLUJO_PROCESO_D17.sql`.

Cubre las cuatro tablas del cargador que no tenían destino, más el catálogo de
estados que forma parte del mismo flujo:

| Tabla legacy                   | Filas | Destino                                   |
| ------------------------------ | ----: | ----------------------------------------- |
| `legacy.dim_paso_proceso`      |     3 | `core.flujo_definicion` (tipo `reporte`)  |
| `legacy.dim_paso_proceso_caso` |     4 | `core.flujo_definicion` (tipo `caso`)     |
| `legacy.dim_estado_proceso`    |     5 | `core.flujo_estado`                       |
| `legacy.fact_proceso_caso`     |    36 | `core.proceso_instancia` (tipo `caso`)    |
| `legacy.fact_proceso_reporte`  |    99 | `core.proceso_instancia` (tipo `reporte`) |

---

## 1. Modelo final

Tres tablas nuevas en `core`. Ninguna tabla existente se modificó.

```
core.flujo_definicion  (7)   catálogo de pasos, discriminado por tipo de flujo
core.flujo_estado      (5)   catálogo de estados por paso
core.proceso_instancia (135) hecho: un paso ejecutado sobre un caso o un reporte
        ├── caso_id ──────────► core.casos
        ├── alerta_id ────────► core.alertas_tempranas
        ├── flujo_definicion_id ► core.flujo_definicion
        ├── estado_id ────────► core.flujo_estado
        └── usuario_id ───────► core.usuarios
```

### 1.1 `core.flujo_definicion` — 7 filas

| Columna                    | Tipo         | Nulo | Notas                                           |
| -------------------------- | ------------ | ---- | ----------------------------------------------- |
| `id`                       | uuid         | no   | `gen_random_uuid()`                             |
| `tipo_flujo`               | varchar(10)  | no   | CHECK `caso` \| `reporte`                       |
| `orden`                    | smallint     | no   | CHECK `> 0`; único junto con `tipo_flujo`       |
| `nombre`                   | varchar(120) | no   |                                                 |
| `estado_resultante`        | varchar(60)  | no   | texto legado, **no** FK a `flujo_estado` (§2.3) |
| `rol_responsable`          | varchar(120) | sí   | `Sectorista`, `Sectorista/Directora`            |
| `descripcion`              | text         | sí   | solo el flujo de caso la trae                   |
| `codigo_legado`            | varchar(60)  | no   | único: `DPP-<n>` / `DPPC-<n>`                   |
| `created_at`, `updated_at` | timestamptz  | no   |                                                 |

### 1.2 `core.flujo_estado` — 5 filas

| Columna                    | Tipo        | Nulo | Notas                     |
| -------------------------- | ----------- | ---- | ------------------------- |
| `id`                       | uuid        | no   | `gen_random_uuid()`       |
| `codigo`                   | varchar(20) | no   | único, `EST-01..EST-05`   |
| `nombre`                   | varchar(60) | no   |                           |
| `color_hex`                | varchar(7)  | no   | CHECK `^#[0-9A-Fa-f]{6}$` |
| `es_final`                 | boolean     | no   |                           |
| `created_at`, `updated_at` | timestamptz | no   |                           |

### 1.3 `core.proceso_instancia` — 135 filas

| Columna                                                | Tipo        | Nulo | Notas                                         |
| ------------------------------------------------------ | ----------- | ---- | --------------------------------------------- |
| `id`                                                   | uuid        | no   | `gen_random_uuid()`                           |
| `tipo_origen`                                          | varchar(10) | no   | CHECK `caso` \| `reporte`                     |
| `caso_id`                                              | uuid        | sí   | FK `core.casos(id)` ON DELETE CASCADE         |
| `codigo_caso_legado`                                   | varchar(50) | sí   | código tal como vino                          |
| `alerta_id`                                            | uuid        | sí   | FK `core.alertas_tempranas(id)`               |
| `codigo_reporte`                                       | varchar(50) | sí   | texto, enlace blando                          |
| `flujo_definicion_id`                                  | uuid        | sí   | FK `core.flujo_definicion(id)`                |
| `estado_id`                                            | uuid        | sí   | FK `core.flujo_estado(id)`                    |
| `usuario_id`                                           | uuid        | sí   | FK `core.usuarios(id)`                        |
| `codigo_responsable_legado`                            | varchar(50) | sí   | `SEC-nn`, `DEST-01`                           |
| `ocurrido_en`                                          | timestamptz | sí   | inicio del paso                               |
| `finalizado_en`                                        | timestamptz | sí   | fin del paso                                  |
| `orden`                                                | smallint    | no   | CHECK `> 0`                                   |
| `nota`                                                 | text        | sí   |                                               |
| `codigo_legado`                                        | varchar(50) | no   | `PC-nnnn`, `PR-nnn`, `PR-AL-nnnn`             |
| `fila_legado`                                          | smallint    | no   | `fila_n` de origen; clave de idempotencia     |
| `created_at`, `updated_at`, `created_by`, `updated_by` |             |      | convención de auditoría                       |
| `nivel_clasificacion`                                  | smallint    | no   | default 2, FK `core.cat_clasificacion(nivel)` |

Restricciones y convenciones:

- `UNIQUE (tipo_origen, fila_legado)` — clave de idempotencia. Se usa esta y no
  `codigo_legado` porque **`PR-AL-0021` viene dos veces** en el legado, con
  instantes distintos (`...32.470` y `...32.546`). Son dos hechos, se conservan los dos.
- `CHECK` de coherencia de origen: un `caso` no lleva `codigo_reporte` ni `alerta_id`;
  un `reporte` no lleva `caso_id` ni `codigo_caso_legado`.
- `CHECK` `finalizado_en >= ocurrido_en`.
- RLS `ENABLE` + `FORCE`, cuatro políticas `p_clasificacion` / `p_insert` /
  `p_update` / `p_delete` sobre `nivel_clasificacion`, y `trg_audit` con
  `core.set_audit()`. Verificado: `rls = t`, `rls_force = t`, 4 políticas, 1 trigger.
- Índices: `(caso_id, ocurrido_en DESC)`, `(alerta_id)` parcial, `(flujo_definicion_id)`.
- Los dos catálogos van **sin** RLS ni `nivel_clasificacion`, igual que `core.cat_*`:
  son vocabulario compartido, no dato de un caso.

---

## 2. Decisiones y su evidencia

### 2.1 No se reutilizó `analisis.plan` ni `analisis.plan_paso`

`analisis.plan` se llama «plan» pero modela la investigación analítica (pregunta,
pauta, aprobación, entregables qdpx/pdf) y cuelga de `caso_id`. El flujo operativo
tiene otra forma: pasos ordenados, estado por paso, responsable humano, y también
aplica a reportes que no son casos. Reutilizarla habría metido dos conceptos en una
tabla. No se tocó.

### 2.2 Sí existe maestro para 72 de los 99 reportes

El encargo suponía que no había tabla padre de reporte. **No es así para todos.**
`core.alertas_tempranas` tiene `codigo_alerta` único (83 filas, `AT-2026-01` a
`AT-2026-90`) y **72 de las 81** filas de `fact_proceso_reporte` cuyo `c02` es un
código `AT-YYYY-nn` resuelven contra ella.

Por eso el modelo guarda **las dos cosas**:

- `codigo_reporte` (texto): conserva siempre el código, resuelva o no — es el enlace blando.
- `alerta_id` (FK opcional): enlace duro cuando el código existe.

Las 18 filas de `PR-001..PR-018` **no** tienen maestro: en ellas `c02` no es un
código sino el **nombre del tipo de reporte**, `Alerta Temprana` — que
`legacy.dim_tipo_proceso` identifica como `TR-01`. En esas filas el código de
reporte que se conserva es `c01` (`PR-nnn`).

### 2.3 `estado_resultante` es texto y `estado_id` queda nulo

Los dos vocabularios no coinciden:

- `dim_paso_proceso*`: `Activo`, `Remitido`, `Atendido`, `Registrado`, `Cerrado`, `Reaperturado`.
- `dim_estado_proceso`: `Pendiente`, `Completado`, `Observado`, `Devuelto`, `Omitido`.

Equivalencias como `Activo` → `Pendiente` serían interpretación, no migración, y
renombrarían el dato. Se conserva el literal en `flujo_definicion.estado_resultante`
y `estado_id` queda **nulo en las 135 filas**: ninguna columna del legado registra el
estado de un paso concreto. El catálogo se carga igual (5 filas) porque es el
vocabulario previsto del flujo y debe existir antes de que el flujo se use en vivo.

### 2.4 El catálogo de pasos está incompleto para reportes

`dim_paso_proceso` define 3 pasos (`Elaboración`, `Remisión`, `Archivo`), pero
`fact_proceso_reporte.c03` llega a **6**:

| `c03` |   1 |   2 |   3 |   4 |   5 |   6 |
| ----- | --: | --: | --: | --: | --: | --: |
| filas |  84 |   3 |   3 |   3 |   3 |   3 |

Las **9 filas** con paso 4, 5 y 6 quedan con `flujo_definicion_id` nulo y conservan
su `orden`. No se inventan pasos. El flujo de caso, en cambio, define 4 pasos pero
los datos solo usan el 1: los otros tres quedan definidos y sin instancias.

### 2.5 Columnas añadidas respecto del diseño propuesto

| Columna                     | Por qué                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `alerta_id`                 | existe maestro real para 72 filas (§2.2); sin esta FK se perdería el enlace duro                         |
| `codigo_caso_legado`        | instrucción de conservar el código cuando no resuelve; hay 2 filas sin caso                              |
| `codigo_responsable_legado` | ídem para `DEST-01`, que no es usuario; hay 6 filas así                                                  |
| `finalizado_en`             | `c06` del legado es una fecha de fin real en 16 filas; descartarla perdía información                    |
| `fila_legado`               | `codigo_legado` **no es único** (`PR-AL-0021` duplicado); sin esta columna la carga no sería idempotente |

No se añadió columna para `c07` (diferencia en días): es derivable de
`finalizado_en - ocurrido_en`, y se verificó que coincide en **16 de 16** filas con
ambas fechas.

### 2.6 Interpretación de `c01..cNN`, con evidencia

No es intuición; cada columna se contrastó contra los datos:

**`fact_proceso_caso`** (36 filas)

| Columna | Evidencia                                                                                               | Lectura                             |
| ------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `c01`   | 36 valores distintos, todos `PC-nnnn`, uno por fila                                                     | identificador de la fila de proceso |
| `c02`   | 35 distintos, todos `CS-PRODUCE-2026-nnn`; 34 de las 36 filas resuelven contra `core.casos.codigo_caso` | código de caso                      |
| `c03`   | constante `1`                                                                                           | número de paso                      |
| `c04`   | solo `SEC-01..SEC-04`, los 4 existen en `usuarios.codigo_legado`                                        | responsable                         |
| `c05`   | 36 instantes distintos, con milisegundos, crecientes                                                    | instante del paso                   |
| `c06`   | vacío en las 36                                                                                         | sin fecha de fin                    |
| `c07`   | constante `0`                                                                                           | sin semántica evidenciada           |
| `c08`   | constante `1`                                                                                           | sin semántica evidenciada           |
| `c09`   | constante `Elaboración del caso`, coincide con el nombre del paso 1                                     | nota del paso                       |

**`fact_proceso_reporte`** (99 filas)

| Columna | Evidencia                                                                                 | Lectura                                                  |
| ------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `c01`   | `PR-nnn` o `PR-AL-nnnn`; `PR-AL-0021` repetido con `c05` distinto                         | identificador de fila, **no único**                      |
| `c02`   | 18 × `Alerta Temprana` + 81 códigos `AT-2026-nn`; 72 resuelven contra `alertas_tempranas` | código de reporte, o nombre de tipo cuando no hay código |
| `c03`   | 1..6 (§2.4)                                                                               | número de paso                                           |
| `c04`   | `SEC-01..SEC-14` + `DEST-01`; los `SEC` resuelven, `DEST-01` no                           | responsable                                              |
| `c05`   | fecha de inicio; **1 vacía** (`PR-018`)                                                   | inicio del paso                                          |
| `c06`   | vacío en 83, presente en 16                                                               | fin del paso                                             |
| `c07`   | `0/1/3` + 2 vacías; **coincide con `c06::date - c05::date` en 16 de 16**                  | diferencia en días, derivada                             |
| `c08`   | texto libre (`Elaboración - Alerta` o descripción del hecho)                              | nota del paso                                            |

Las dos tablas **no comparten** el significado de `c05..c09` aunque compartan forma:
en `fact_proceso_caso` la nota está en `c09` y `c06/c07/c08` son constantes o vacías;
en `fact_proceso_reporte` la nota está en `c08` y `c07` es una diferencia de días.
El mapeo se hizo por tabla, no por posición.

_Posterior al parche (2026-11-22): los códigos `CS-PRODUCE-2026-nnn` que aquí se emparejan con `core.casos.codigo_caso` se recodificaron al Anexo 15 por `migration/16_recodificacion_anexo15.sql` —hoy son `CS-<PA|MI>-<INF|OAT|NOR|DBE|GOB|ITE>-<AAAA>-<NN>`— y el literal vive en `core.casos.codigo_legado`; `migration/19_codigos_genericos.sql` añadió después la sigla `GEN` sin recodificar ningún caso._

---

## 3. Mapeo columna a columna

### 3.1 `legacy.dim_estado_proceso` → `core.flujo_estado`

| Legacy   | Nueva       | Transformación                            |
| -------- | ----------- | ----------------------------------------- |
| `fila_n` | —           | sin destino (orden de carga)              |
| `c01`    | `codigo`    | `btrim`, clave única                      |
| `c02`    | `nombre`    | `btrim`                                   |
| `c03`    | `color_hex` | `btrim`, validado con CHECK               |
| `c04`    | `es_final`  | `'Si'` → `true`, cualquier otro → `false` |

### 3.2 `legacy.dim_paso_proceso` → `core.flujo_definicion` (`tipo_flujo = 'reporte'`)

| Legacy   | Nueva               | Transformación                                        |
| -------- | ------------------- | ----------------------------------------------------- |
| `fila_n` | —                   | sin destino                                           |
| `c01`    | `orden`             | `btrim::smallint`                                     |
| `c02`    | `nombre`            | `btrim`                                               |
| `c03`    | `estado_resultante` | `btrim` (texto literal)                               |
| `c04`    | `rol_responsable`   | `NULLIF(btrim,'')`                                    |
| `c05`    | —                   | sin destino: constante `1`, sin semántica evidenciada |
| —        | `tipo_flujo`        | constante `'reporte'`                                 |
| —        | `descripcion`       | `NULL`: esta tabla no trae descripción                |
| —        | `codigo_legado`     | `'DPP-' \|\| c01`                                     |

### 3.3 `legacy.dim_paso_proceso_caso` → `core.flujo_definicion` (`tipo_flujo = 'caso'`)

| Legacy   | Nueva               | Transformación                                                              |
| -------- | ------------------- | --------------------------------------------------------------------------- |
| `fila_n` | —                   | sin destino                                                                 |
| `c01`    | `orden`             | `btrim::smallint`                                                           |
| `c02`    | `nombre`            | `btrim`                                                                     |
| `c03`    | `estado_resultante` | `btrim` (texto literal)                                                     |
| `c04`    | `rol_responsable`   | `NULLIF(btrim,'')`                                                          |
| `c05`    | —                   | sin destino: `2` en el paso 1 y `1` en los demás, sin semántica evidenciada |
| `c06`    | `descripcion`       | `NULLIF(btrim,'')`                                                          |
| —        | `tipo_flujo`        | constante `'caso'`                                                          |
| —        | `codigo_legado`     | `'DPPC-' \|\| c01`                                                          |

### 3.4 `legacy.fact_proceso_caso` → `core.proceso_instancia` (36 filas)

| Legacy   | Nueva                         | Transformación                                            |
| -------- | ----------------------------- | --------------------------------------------------------- |
| `fila_n` | `fila_legado`                 | `::smallint`; clave de idempotencia                       |
| `c01`    | `codigo_legado`               | `btrim`                                                   |
| `c02`    | `codigo_caso_legado`          | `btrim`                                                   |
| `c02`    | `caso_id`                     | `core.casos.codigo_caso = c02`; nulo si no resuelve       |
| `c03`    | `orden`                       | `btrim::smallint`                                         |
| `c03`    | `flujo_definicion_id`         | `flujo_definicion(tipo_flujo='caso', orden = c03)`        |
| `c04`    | `codigo_responsable_legado`   | `btrim`                                                   |
| `c04`    | `usuario_id`                  | `core.usuarios.codigo_legado = c04`; nulo si no resuelve  |
| `c05`    | `ocurrido_en`                 | `NULLIF(btrim,'')::timestamp AT TIME ZONE 'America/Lima'` |
| `c06`    | `finalizado_en`               | ídem; vacío en las 36 → nulo                              |
| `c07`    | —                             | sin destino: constante `0`                                |
| `c08`    | —                             | sin destino: constante `1`                                |
| `c09`    | `nota`                        | `NULLIF(btrim,'')`                                        |
| —        | `tipo_origen`                 | constante `'caso'`                                        |
| —        | `estado_id`                   | nulo: el legado no registra estado por paso               |
| —        | `alerta_id`, `codigo_reporte` | nulos: son de reporte                                     |

_Posterior al parche (2026-11-22): el emparejamiento `core.casos.codigo_caso = c02` solo vale con los códigos anteriores a la recodificación; hoy `c02` casa contra `core.casos.codigo_legado` (Anexo 15, `migration/16_recodificacion_anexo15.sql`)._

### 3.5 `legacy.fact_proceso_reporte` → `core.proceso_instancia` (99 filas)

| Legacy   | Nueva                           | Transformación                                                     |
| -------- | ------------------------------- | ------------------------------------------------------------------ |
| `fila_n` | `fila_legado`                   | `::smallint`; clave de idempotencia                                |
| `c01`    | `codigo_legado`                 | `btrim`                                                            |
| `c01`    | `codigo_reporte`                | solo cuando `c02` **no** es `AT-YYYY-nn` (18 filas)                |
| `c02`    | `codigo_reporte`                | cuando `c02 ~ '^AT-[0-9]{4}-[0-9]+$'` (81 filas)                   |
| `c02`    | `alerta_id`                     | `core.alertas_tempranas.codigo_alerta = c02`; nulo si no resuelve  |
| `c03`    | `orden`                         | `btrim::smallint`                                                  |
| `c03`    | `flujo_definicion_id`           | `flujo_definicion(tipo_flujo='reporte', orden = c03)`; nulo en 4–6 |
| `c04`    | `codigo_responsable_legado`     | `btrim`                                                            |
| `c04`    | `usuario_id`                    | `core.usuarios.codigo_legado = c04`; nulo si no resuelve           |
| `c05`    | `ocurrido_en`                   | `NULLIF(btrim,'')::timestamp AT TIME ZONE 'America/Lima'`          |
| `c06`    | `finalizado_en`                 | ídem                                                               |
| `c07`    | —                               | sin destino: es `c06::date - c05::date` (16/16 verificado)         |
| `c08`    | `nota`                          | `NULLIF(btrim,'')`                                                 |
| —        | `tipo_origen`                   | constante `'reporte'`                                              |
| —        | `caso_id`, `codigo_caso_legado` | nulos: son de caso                                                 |
| —        | `estado_id`                     | nulo: el legado no registra estado por paso                        |

Las fechas se interpretan como **hora de Perú**, no como la zona de la sesión, para
que la carga dé el mismo resultado desde cualquier cliente. Todas las 135 fechas de
inicio y las 16 de fin son parseables: **0 inválidas**.

---

## 4. Conteos reales

Medidos después de ejecutar el parche, y re-medidos tras una segunda ejecución
(idempotencia).

| Verificación                                           | Esperado      | Obtenido          |
| ------------------------------------------------------ | ------------- | ----------------- |
| `core.flujo_definicion`                                | 7             | **7**             |
| `core.flujo_estado`                                    | 5             | **5**             |
| `core.proceso_instancia`                               | 135           | **135**           |
| instancias de caso                                     | 36            | **36**            |
| instancias de reporte                                  | 99            | **99**            |
| filas de caso con `caso_id`                            | 34            | **34**            |
| filas de caso sin `caso_id`                            | 2             | **2**             |
| reportes con `codigo_reporte`                          | 99            | **99**            |
| reportes con `alerta_id` (enlace duro)                 | 72            | **72**            |
| reportes con enlace solo textual                       | 27            | **27**            |
| responsables resueltos (caso)                          | 36            | **36**            |
| responsables resueltos (reporte)                       | 93            | **93**            |
| con `flujo_definicion_id`                              | 126           | **126**           |
| sin `flujo_definicion_id` (paso 4–6)                   | 9             | **9**             |
| con `estado_id`                                        | 0             | **0**             |
| con `ocurrido_en` (reporte)                            | 98            | **98**            |
| con `finalizado_en` (reporte)                          | 16            | **16**            |
| pares de fechas incoherentes                           | 0             | **0**             |
| instancias duplicadas por `(tipo_origen, fila_legado)` | 0             | **0**             |
| cuadre contra el legado                                | 36/36 y 99/99 | **36/36 y 99/99** |

Reparto de las 9 instancias sin definición de paso: paso 4 → 3, paso 5 → 3, paso 6 → 3.

---

## 5. Filas que no resolvieron

### 5.1 Casos sin maestro (2 filas)

| `codigo_legado` | `codigo_caso_legado`  | `ocurrido_en`              | Motivo                                                  |
| --------------- | --------------------- | -------------------------- | ------------------------------------------------------- |
| `PC-0001`       | `CS-PRODUCE-2026-037` | 2026-08-31 06:55:38.814-05 | el código no existe en `core.casos` (llega hasta `035`) |
| `PC-0002`       | `CS-PRODUCE-2026-038` | 2026-08-31 06:59:09.26-05  | ídem                                                    |

`caso_id` queda nulo y el código se conserva en `codigo_caso_legado`. No se crearon
casos: eso sería inventar datos maestros.

### 5.2 Reportes sin maestro (27 filas, 9 códigos)

| `codigo_reporte`                            | Filas | Motivo                                                                                                   |
| ------------------------------------------- | ----: | -------------------------------------------------------------------------------------------------------- |
| `Alerta Temprana` (bloque `PR-001..PR-018`) |    18 | `c02` es el **nombre del tipo de reporte** (`TR-01` en `dim_tipo_proceso`), no un código; no hay maestro |
| `AT-2026-19`                                |     2 | el código no existe en `core.alertas_tempranas`                                                          |
| `AT-2026-27`                                |     1 | ídem                                                                                                     |
| `AT-2026-29`                                |     1 | ídem                                                                                                     |
| `AT-2026-31`                                |     1 | ídem                                                                                                     |
| `AT-2026-33`                                |     1 | ídem                                                                                                     |
| `AT-2026-34`                                |     1 | ídem                                                                                                     |
| `AT-2026-35`                                |     1 | ídem                                                                                                     |
| `AT-2026-39`                                |     1 | ídem                                                                                                     |

En las 18 filas del primer bloque se conserva `c01` (`PR-nnn`) como código de
reporte, porque es lo único identificable que trae el legado.

### 5.3 Responsables sin usuario (6 filas)

| Código    | Filas | Motivo                                                                                                                                           |
| --------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEST-01` |     6 | no existe en `core.usuarios.codigo_legado`; por contexto (remisiones y convocatorias de DVPA/Gabinete) parece un buzón colectivo, no una persona |

`usuario_id` nulo, `codigo_responsable_legado = 'DEST-01'` conservado.

### 5.4 Fechas

Ninguna fecha inválida. 1 fila sin inicio (`PR-018`, «Pendiente resolución del
conflicto») y 83 sin fin; las que no tienen texto quedan en nulo.

---

## 6. Cómo verificar

```sh
docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
  -f - < docs/PARCHE_10_FLUJO_PROCESO_D17.sql
```

La sección 6 del parche trae 16 consultas con el resultado esperado en el comentario.
Consulta rápida de los tres conteos:

```sh
docker exec -i avisa-db psql -U avisa -d avisa -At -F'|' -c \
  "SELECT (SELECT count(*) FROM core.flujo_definicion),
          (SELECT count(*) FROM core.flujo_estado),
          (SELECT count(*) FROM core.proceso_instancia)"
```

Esperado: `7|5|135`. Ejecutado dos veces seguidas: los tres conteos no cambian y no
aparece ningún error, porque los catálogos se cargan con UPSERT por código y las
instancias por `(tipo_origen, fila_legado)`.

---

## 7. Pendiente (a propósito)

1. **Pasos 4–6 del flujo de reporte.** `dim_paso_proceso` solo define 3. Falta que
   OAIPCS dicte nombre, estado resultante y responsable de los pasos 4 a 6; mientras
   tanto 9 instancias quedan sin definición y conservan su `orden`.
2. **`estado_id` nulo en las 135 filas.** Derivarlo (por ejemplo «tiene fecha de fin
   → Completado») es una regla nueva, no una migración. No se aplicó.
3. **Casos `037` y `038`.** Decidir si se crean en `core.casos` o se descartan.
4. **Alertas faltantes.** `AT-2026-19, 27, 29, 31, 33, 34, 35, 39` no están en
   `core.alertas_tempranas`; y el bloque `PR-001..PR-018` no tiene maestro de
   reporte en ninguna tabla.
5. **`DEST-01`.** Confirmar si es un destino colectivo y, si lo es, modelarlo como
   tal (unidad orgánica o mesa) en vez de dejarlo como código huérfano.
6. **Observación menor.** Los casos `CS-PRODUCE-2026-001` y `CS-PRODUCE-2026-002`
   existen en `core.casos` pero no tienen ninguna instancia de proceso en el legado.
   `core.casos` va de `001` a `035`; el `036` no existe en ninguna de las dos capas.

_Posterior al parche (2026-11-22): esos dos casos existen hoy con el código del Anexo 15 y el literal `CS-PRODUCE-2026-00n` quedó en `core.casos.codigo_legado` por `migration/16_recodificacion_anexo15.sql`._
