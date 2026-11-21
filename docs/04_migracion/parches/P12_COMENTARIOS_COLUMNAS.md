# P12 — Comentarios de tablas y columnas

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 — regla de diccionario que fijó el parche 12 (ninguna tabla ni columna del modelo v10 sin descripción en la propia base) y cadena de artefactos de `docs/README.md` §6
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql` (**artefacto generado**, montado como `102_patch_12.sql` en `compose.yaml`, bloque `B.13` del unificado)
**Estado:** **regenerado el 2026-11-21 y verificado contra la base viva.**

---

## 1. Resumen

Este parche no se redacta: se **genera**. Lo produce
`migration/generar_comentarios_sql.py` desde tres módulos de curaduría
(`migration/curacion_v10.py`, `migration/curacion_v10_columnas.py` y
`migration/curacion_vistas.py`), verifica cada tabla y columna contra el catálogo
vivo y emite `COMMENT ON TABLE` y `COMMENT ON COLUMN` para todo el modelo. Así el
diccionario se alimenta del catálogo y no de un archivo paralelo. Es idempotente
por naturaleza: `COMMENT ON` sobrescribe el texto anterior y nunca lo duplica.

Cifras medidas hoy (2026-11-21):

| Dato                                     | Valor medido |
| ---------------------------------------- | -----------: |
| Sentencias `COMMENT ON TABLE` emitidas   |          259 |
| Sentencias `COMMENT ON COLUMN` emitidas  |        2 067 |
| Sentencias totales (solo `COMMENT ON`)   |        2 326 |
| Líneas del archivo                       |        2 353 |
| Tablas lógicas del modelo v10            |          266 |
| Columnas lógicas del modelo v10          |        2 161 |
| Columnas lógicas con / sin comentario    |    2 154 / 7 |
| Particiones fuera del alcance (columnas) |     24 (366) |

Lo que **no** hace: no describe las 24 particiones (§3.3), no comenta `legacy`, no
escribe datos de usuario ni cubre los objetos de los parches posteriores (§6).

---

## 2. Qué cambia

| Objeto                                    | Tipo                  | Qué hace                                                                                   |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql` | artefacto generado    | 2 326 sentencias `COMMENT ON`, sin ninguna otra clase de sentencia.                        |
| 259 tablas lógicas                        | `COMMENT ON TABLE`    | Fija el propósito de cada tabla desde `curacion_v10.PROPOSITO`.                            |
| 2 067 columnas lógicas                    | `COMMENT ON COLUMN`   | Fija la descripción de cada columna desde `curacion_v10_columnas.COLUMNAS`.                |
| `migration/generar_comentarios_sql.py`    | generador             | Lee la curaduría, valida contra el catálogo y escribe el SQL; se detiene si algo no calza. |
| `migration/curacion_v10.py`               | curaduría de tablas   | 259 claves `esquema.tabla`.                                                                |
| `migration/curacion_v10_columnas.py`      | curaduría de columnas | 2 067 claves `esquema.tabla.columna`.                                                      |
| Bloque `B.13` del unificado               | integración           | Su nota declara «2 326 comentarios», que coincide con lo medido.                           |
| `102_patch_12.sql` en `compose.yaml`      | montaje               | Deja el archivo en `/opt/avisa/sql/` para aplicarlo a mano tras la carga.                  |

No se emite `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP` ni `GRANT`: el
archivo contiene 2 326 líneas `COMMENT ON` y nada más (§5.2).

---

## 3. Por qué, decisión por decisión

### 3.1 Generado, no escrito a mano, y con el texto en el catálogo

Un archivo de más de dos mil sentencias no se mantiene a mano sin derivar: la
primera columna que cambie de nombre lo deja mintiendo. La fuente de verdad es la
curaduría y el SQL es su proyección; por eso la cabecera dice «Generado por
`migration/generar_comentarios_sql.py`. No editar a mano.» Antes de escribir, el
generador comprueba que cada tabla y columna existan y, si falta alguna, aborta en
vez de producir un parche incompleto. El texto debe vivir en el catálogo porque el
diccionario se genera leyendo `obj_description` y `col_description`: si solo
estuviera en la curaduría, quien abriera la base con `psql` vería nombres sin
significado.

### 3.2 Las 24 particiones quedan fuera, a propósito

PostgreSQL no propaga los comentarios del padre a las particiones. Comentarlas una
por una repetiría 366 veces el mismo texto y habría que rehacerlo en cada partición
anual. El generador las excluye (`NOT c.relispartition`) y
`migration/generar_diccionario.py` hereda la descripción del padre al generar el
diccionario.

### 3.3 La curaduría excluye las columnas de parches posteriores

El bloque `B.13` corre **antes** de `B.14` a `B.18`. Si una columna creada por el
parche 21 o el 23 estuviera en la curaduría, el unificado emitiría un `COMMENT ON
COLUMN` sobre una columna que aún no existe y la reconstrucción desde cero
fallaría. Por eso `visibilidad` (P22) o `validada_por` y las columnas de
`core.alerta_destinatario` (P23) no están en la curaduría: las describe el parche
que las crea. Es la razón que documentan el P22 §6 y el P23 §6.

### 3.4 `COMMENT ON` sobrescribe

No hay `BEGIN`/`COMMIT` ni comprobaciones previas: cada sentencia reemplaza el texto
anterior. Volver a aplicar el archivo no cambia el estado.

---

## 4. Migración de datos

No hay migración de datos. El parche escribe solo en el catálogo del motor
(`pg_description`), no en tablas del modelo.

| Concepto                               | Valor |
| -------------------------------------- | ----: |
| Sentencias que escriben filas o DDL    |     0 |
| Filas modificadas en tablas del modelo |     0 |
| Objetos del catálogo que reciben texto | 2 326 |

No toca `core.alertas_tempranas`, `core.proceso_instancia` ni ninguna otra tabla,
así que no hay recuento de filas que medir antes y después.

---

## 5. Verificación con cifras medidas

### 5.1 Cifras del estado posterior

El modelo tiene **266 tablas lógicas y 290 físicas** (24 particiones), con
**2 161 columnas lógicas y 2 527 físicas**: 61 en las 4 tablas particionadas y 366
en las 24 hijas. De las lógicas, **2 154 tienen comentario y 7 no** al aplicar este
parche; hoy, tras el parche 24, son **2 161 de 2 161** (véase §8).

### 5.2 Conteo por `grep` y longitud

```
$ grep -c "^COMMENT ON TABLE" docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql
259
$ grep -c "^COMMENT ON COLUMN" docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql
2067
$ wc -l docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql
2353 docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql
```

Las 2 326 sentencias no tienen duplicados: `uniq -d` devuelve 0 sobre los 259
destinos de tabla y sobre los 2 067 destinos de columna.

### 5.3 Regeneración reproducible

Se ejecutó `python migration/generar_comentarios_sql.py`; es el único archivo que
escribe y es el propio artefacto. Salida literal:

```
escrito PARCHE_12_COMENTARIOS_COLUMNAS.sql:
  259 tablas
  2067 columnas
```

El recuento y la longitud (2 353 líneas) no cambian. Frente a `HEAD`, `git diff`
marca **8 líneas**: descripciones ya actualizadas en la curaduría por los parches
20, 21 y 22 (`core.permiso_aprobacion`, `core.alertas_tempranas.paso_actual`,
`core.flujo_definicion.*` y `core.proceso_instancia.*`). No puedo saber si el
archivo ya estaba modificado antes; lo medido es que la regeneración no altera los
259/2 067 ni la longitud.

### 5.4 Columnas sin comentario

La consulta literal del encargo devuelve **373 filas**, no 7, porque también
recorre las particiones físicas: 366 columnas de partición —`agent.llm_call` 6×21,
`agent.run_log` 6×13, `avisa.raw_ingest` 6×14 y `ctx.observaciones` 6×13— más las 7
reales. Excluyendo las particiones (`AND NOT c.relispartition`), la salida es:

```
core.alerta_destinatario.alerta_id
core.alerta_destinatario.created_at
core.alerta_destinatario.created_by
core.alerta_destinatario.id
core.alerta_destinatario.motivo
core.alerta_destinatario.updated_at
core.alerta_destinatario.updated_by
```

### 5.5 Por qué 2 067 no contradice 2 161

Son dos universos distintos: el generador emite lo que está en la curaduría y el
modelo tiene además columnas que describen otros parches.

| Concepto                                                                   | Columnas |
| -------------------------------------------------------------------------- | -------: |
| Columnas lógicas del modelo                                                |    2 161 |
| Emitidas por el P12                                                        |    2 067 |
| Comentadas por otros parches en tablas ya curadas                          |       40 |
| Columnas de 6 de las 7 tablas posteriores, comentadas por su propio parche |       47 |
| Suma con comentario (2 067 + 40 + 47)                                      |    2 154 |
| Columnas de las 7 tablas posteriores sin comentario                        |        7 |
| Suma total (2 154 + 7)                                                     |    2 161 |

Las siete tablas que no reciben `COMMENT ON TABLE` del P12 son
`config.servicio_externo`, `config.tope_gasto`, `core.alerta_destinatario`,
`core.cat_nivel_identificacion`, `core.cat_privilegio`, `core.consulta_reniec` y
`core.privilegio_usuario`; las comentan sus propios parches. Las 24 particiones y
sus 366 columnas quedan fuera de las 2 161 por convención de recuento, igual que en
el P19 (§5.3).

---

## 6. Riesgos y lo que queda abierto

**1. `core.alerta_destinatario` es el hueco de hoy y repite el patrón del P19.** La
tabla la creó el **parche 23**, posterior a la curaduría que alimenta este
generador. Su parche describió cuatro columnas (`usuario_id`, `cargo`, `canal`,
`notificado_en`) y dejó siete sin comentario: `id`, `alerta_id`, `motivo`,
`created_at`, `updated_at`, `created_by` y `updated_by`. Es el mismo mecanismo que
motivó el **parche 19**: tras el parche 17 quedaron 19 columnas sin describir y
hubo que escribirlas aparte. El hueco no es un defecto del generador; es la
consecuencia de generar antes de que existan los objetos.

**2. El P12 no tiene guardián y el generador solo valida existencia.** A diferencia
del P19, que termina con un `DO` que aborta si queda alguna columna sin comentario,
este archivo no mide cobertura: solo escribe. Además, el generador aborta si una
clave de la curaduría desaparece del catálogo, pero no dice nada si aparece una
columna nueva. Un parche futuro volverá a abrir huecos sin que nada avise; el único
detector es el recuento del diccionario.

**3. Las dos curadurías están desincronizadas en una tabla.**
`curacion_v10_columnas.py` tiene tres claves de `core.cat_nivel_identificacion`
(líneas 2063–2065) y `curacion_v10.py` no tiene la entrada de tabla. Por eso el P12
emite `COMMENT ON COLUMN` para sus tres columnas pero ningún `COMMENT ON TABLE`.
Hoy es inocuo —la tabla ya tiene comentario de su parche—, pero muestra que las dos
listas se editan por separado.

**4. Dependencia de orden.** El bloque `B.13` corre antes de `B.14`–`B.18`. Incluir
`visibilidad` o `validada_por` en la curaduría rompería la reconstrucción desde
cero, y mover `B.13` después de `B.17` reordenaría la cadena entera. La decisión
está declarada en el P22 §6 y el P23 §6.

**5. El remedio para las siete columnas, sin aplicar.** No requiere cambio de
esquema: basta añadir las siete entradas a `curacion_v10_columnas.COLUMNAS` y
regenerar, o escribir un parche de comentarios nuevo, como se hizo en el P19. El
texto de cada descripción es una decisión de curaduría y no se fija aquí:

```sql
-- NO APLICADO. Las siete columnas siguen el mismo patrón; el texto lo decide
-- la curaduría: id, alerta_id, motivo, created_at, updated_at, created_by, updated_by.
-- COMMENT ON COLUMN core.alerta_destinatario.<columna> IS '...';
```

**6. Las cifras fijas envejecen.** Este informe y `docs/README.md` citan 259, 2 067,
2 154 y 7; cualquier parche posterior las mueve. Conviene leerlas con la fecha de
medición del encabezado, no como constantes.

---

## 7. Frases de otros documentos que quedan desactualizadas

Lista para que otros agentes las propaguen. No se ha editado ninguno de estos
documentos en este parche; `docs/README.md` lo actualiza su dueño.

| Documento y lugar                                    | Dice (viejo)                                                                                                           | Debe decir (nuevo)                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/README.md` §2, fila del parche 12              | «las 6 tablas y 78 columnas restantes las comentan los parches 14, 17, 18 y 19»                                        | «las 7 tablas y 87 columnas restantes las comentan los parches posteriores»                           |
| `docs/README.md` §2, fila `curacion_v10.py`          | «propósito de las 263 tablas lógicas»                                                                                  | «propósito de las 259 tablas lógicas»                                                                 |
| `docs/README.md` §2, fila `curacion_v10_columnas.py` | «descripción de las 2 107 columnas lógicas … las 47 que crearon los parches 17 (19), 18 (19), 21 (2), 22 (1) y 23 (6)» | «descripción de las 2 067 columnas lógicas … las 87 que comentan otros parches»                       |
| `docs/05_datos/DICCIONARIO_DATOS.md` §2 (~L46)       | «las seis tablas que llegaron con los parches [14], [17] y [18] traen el suyo»                                         | añadir las tablas que llegaron después, hasta [23]: hoy son siete                                     |
| `docs/05_datos/DICCIONARIO_DATOS.md` §2 (~L48)       | «salvo los de las tablas que llegaron con los parches [14] a [19] y los de las dos columnas de aprobación … [21]»      | añadir las columnas de [22] y [23]: `visibilidad`, `validada_por` y las de `core.alerta_destinatario` |
| `docs/_archivo/P12_COMENTARIOS.md` (archivado)       | «255 tablas», «2 036 columnas», «CSV en 3 173 filas»                                                                   | este informe lo sustituye; se conserva como foto y no se reescribe                                    |

Lo que **no** hay que cambiar: la fila del artefacto en `docs/README.md` §6 (259
tablas y 2 067 columnas) sigue siendo correcta, igual que su dependencia
«`migration/curacion_*.py` + catálogo vivo»; la medición del §3 del README dice hoy
«2 161 de 2 161», sin ninguna pendiente (el parche 24 cerró las siete de
`core.alerta_destinatario`); y la nota del bloque `B.13` en
`migration/consolidar_esquema.py` («2 326 comentarios») coincide con lo medido.

---

## 8. Actualización posterior (parche 24, 2026-11-21)

Se escribe después y **no reescribe §6**, que queda como foto del estado que dejó
el parche 12.

| Pendiente de §6                                                   | Estado      | Quién lo cerró                                                                               |
| ----------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| 1. `core.alerta_destinatario` es el hueco de hoy                  | **Cerrado** | Parche 24: describe las siete columnas; el modelo queda en **2 161 de 2 161**                |
| 2. El P12 no tiene guardián y el generador solo valida existencia | **Abierto** | Es cierto y sigue siéndolo: el 24 tampoco añade al generador la detección de columnas nuevas |
| 3. Las cifras fijas envejecen                                     | **Abierto** | Se documentan con fecha, como pide este mismo riesgo                                         |

El detalle está en `04_migracion/parches/P24_COMENTARIOS_DESTINATARIO.md`. La
diferencia que importa: el generador —y por tanto este parche— **sigue sin conocer**
la tabla, así que regenerarlo no cubriría esas once columnas; hoy viven en los
parches 23 y 24.
