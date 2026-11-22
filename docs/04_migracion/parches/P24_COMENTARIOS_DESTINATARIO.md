# P24 — Los siete comentarios del destinatario

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** modelo v10 y la regla de diccionario que fijó el parche 12 —ninguna columna del modelo sin descripción en la propia base—; cierre del hueco que abrió el parche 23 en `core.alerta_destinatario`.
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql` (idempotente, montado como `114_patch_24.sql` en `compose.yaml`, bloque `B.19` del unificado)
**Estado:** **aplicado y verificado en la base viva el 2026-11-21.**

---

## 1. Resumen

El parche 23 creó `core.alerta_destinatario` con once columnas y describió cuatro: `usuario_id`, `cargo`, `canal` y `notificado_en`. Las otras siete quedaron sin comentario: `id`, `alerta_id`, `motivo`, `created_at`, `updated_at`, `created_by` y `updated_by`. Hoy eran las **únicas siete columnas del modelo entero** sin descripción, y eran también la causa de que el parche 19 hubiera dejado de poder reejecutarse.

El parche hace una sola cosa: ejecutar siete sentencias `COMMENT ON COLUMN`. No crea ni altera tablas, no añade índices, no toca restricciones, no escribe filas de datos.

| Dato                                   |     Antes del P24 |       Después del P24 |                Hoy |
| -------------------------------------- | ----------------: | --------------------: | -----------------: |
| Columnas lógicas del modelo            |             2 161 |    2 161 (sin cambio) |          **2 161** |
| Columnas lógicas con comentario        |             2 154 |    **2 161 de 2 161** | **2 161 de 2 161** |
| Columnas lógicas sin comentario        |             **7** |                 **0** |              **0** |
| Columnas de `core.alerta_destinatario` | 11 (4 comentadas) |    11 (11 comentadas) |       **11 de 11** |
| Sentencias `COMMENT ON COLUMN`         |                 — |                 **7** |              **7** |
| Líneas del archivo                     |                 — |               **114** |                114 |
| El parche 19, ¿reejecutable?           | no (aborta con 7) | **sí (cierra con 0)** |                 sí |

El «Antes» está medido y, además, lo declara la guardia del propio parche 19: al reejecutarlo hoy aborta con `quedan 7 columnas del modelo sin comentario`. El «Después» lo garantiza el `DO` del archivo y está medido en §5. Las cifras estructurales no cambian en ninguna columna: 266 tablas lógicas, 290 físicas, 2 161 columnas, 616 claves ajenas (532 únicas), 360 `CHECK`, 767 índices, 91 tablas con seguridad por fila y 556 políticas.

---

## 2. Qué cambia

Las siete sentencias, en el orden del archivo, con su texto literal.

| Objeto                                | Tipo                | Texto del comentario                                                                                                       |
| ------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `core.alerta_destinatario.id`         | `COMMENT ON COLUMN` | «Identificador interno de la fila»                                                                                         |
| `core.alerta_destinatario.alerta_id`  | `COMMENT ON COLUMN` | «Alerta a la que pertenece el destinatario, según core.alertas_tempranas. Al borrar la alerta se borran sus destinatarios» |
| `core.alerta_destinatario.motivo`     | `COMMENT ON COLUMN` | «Motivo o causa del aviso, cuando el canal no basta para explicar por qué se remite a esta persona o cargo»                |
| `core.alerta_destinatario.created_at` | `COMMENT ON COLUMN` | «Momento en que se creó el registro»                                                                                       |
| `core.alerta_destinatario.updated_at` | `COMMENT ON COLUMN` | «Momento de la última modificación del registro»                                                                           |
| `core.alerta_destinatario.created_by` | `COMMENT ON COLUMN` | «Usuario que registró el destinatario»                                                                                     |
| `core.alerta_destinatario.updated_by` | `COMMENT ON COLUMN` | «Usuario que realizó la última modificación del registro»                                                                  |

Los cuatro textos de auditoría son literalmente los que usan las tablas vecinas —`core.alertas_tempranas`, por ejemplo—, para que el diccionario no muestre dos voces para la misma columna. El de `alerta_id` añade el efecto del `ON DELETE CASCADE` porque es información que ninguna otra columna de la tabla revela. El de `motivo` sigue la voz del parche 23: describa para qué sirve y cuándo falta.

_Posterior al parche (2026-11-22): la baja de una alerta es lógica desde `migration/12_anulacion_y_secuencia.sql` y `13_anulacion_segura.sql` (`anulado_en`; `core.anular_caso` la anula en cascada); el texto del comentario se conserva literal como se escribió._

---

## 3. Por qué, decisión por decisión

### 3.1 Un parche aparte, y no una edición del 23

El parche 23 ya está aplicado y se reejecuta entero al levantar un entorno nuevo. Añadirle sentencias cambiaría el contenido de un parche cerrado y el rastro de qué se corrigió y cuándo se perdería dentro de un archivo con otro alcance. Es exactamente el criterio que se aplicó al abrir el parche 19 contra el 17.

### 3.2 Idempotencia por la semántica de `COMMENT ON`

`COMMENT ON` sobrescribe el comentario anterior; no inserta. El archivo se puede ejecutar cuantas veces sea necesario sin error y sin duplicados, y no necesita `IF NOT EXISTS` ni borrados previos. Se comprobó corriéndolo dos veces seguidas (§5.3).

### 3.3 La guardia comprueba sus siete columnas, y solo informa del resto

La guardia del parche 19 mide **todas** las tablas del modelo y aborta si queda una sola columna sin comentario. Esa decisión es la que convirtió al 19 en no reejecutable en cuanto el 23 añadió columnas nuevas: el candado medía algo que el propio parche no controlaba.

Aquí se invierte el criterio. El `DO` del parche 24 verifica **sus propias siete columnas** y lanza `RAISE EXCEPTION` si alguna queda sin describir; el recuento global del modelo se emite como `RAISE NOTICE`, informativo y no bloqueante. Así el parche sigue siendo un guardián de lo que firma —«las once columnas de esta tabla están descritas»— sin volver a atarse a un número que otros parches mueven.

### 3.4 La guardia global sí mira las tablas particionadas

El `DO` del 19 filtra `relkind = 'r'`, de modo que mide 2 100 de las 2 161 columnas. El recuento global de este parche filtra `relkind IN ('r','p')` excluyendo las particiones hijas, de modo que sí cubre las 61 columnas de las tablas particionadas. No cambia el resultado —todas estaban ya comentadas—, pero el aviso que imprime es el del modelo completo y no el de una parte.

### 3.5 Por qué entra `motivo` y también las claves y la auditoría

`id`, `alerta_id`, `created_at`, `updated_at`, `created_by` y `updated_by` no tienen semántica de negocio propia, pero la regla del parche 12 es de cobertura, no de relevancia: una columna sin descripción es un hueco visible en el diccionario. `motivo`, en cambio, sí la tiene: es la columna que explica por qué se remite el aviso cuando el canal no lo explica. Ambos grupos entran por la misma razón operativa y por razones distintas de fondo.

---

## 4. Migración de datos

No hay migración. `COMMENT ON COLUMN` escribe en el catálogo `pg_description`; no toca ninguna tabla de usuario, no recalcula columnas, no reescribe filas y no cambia el tipo ni la restricción de nada. El parche no contiene un solo `INSERT`, `UPDATE`, `DELETE`, `ALTER TABLE` ni `CREATE`.

Por eso no hay cifra de filas antes y después: no hay filas que mover. La única escritura es de metadatos, y la única reversión posible es sobrescribir el comentario con otro texto. `core.alerta_destinatario` sigue vacía, como la dejó el parche 23.

---

## 5. Verificación con cifras medidas

### 5.1 El archivo tiene 7 sentencias y 114 líneas

```
$ wc -l docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql
114 docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql
$ grep -c 'COMMENT ON COLUMN' docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql
7
```

En el unificado, el bloque `B.19` empieza en la línea 21 486 y cierra el archivo en la 21 609; el cuerpo copiado ocupa 114 líneas. El archivo pasa a **27 bloques y 26 fuentes**, 21 609 líneas y 1 309 699 bytes (1 279,0 KB). Las dos cifras se remedieron el 2026-11-21, después de que el bloque `B.2` —el parche 7— cambiara de tamaño; el reparto de bloques no se movió.

### 5.2 El parche 19 vuelve a cerrar: esa es la prueba que importa

Antes de aplicar el 24, el 19 se reejecutó para dejar constancia del defecto:

```
$ psql ... -f docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
psql:<stdin>:116: ERROR:  quedan 7 columnas del modelo sin comentario
CONTEXT:  PL/pgSQL function inline_code_block line 24 at RAISE
```

La transacción revirtió: los 19 `COMMENT ON` del archivo no llegaron a persistir. Después de aplicar el 24:

```
$ psql ... -f docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
psql:<stdin>:116: NOTICE:  columnas del modelo sin comentario: 0
DO
COMMIT
PARCHE 19 · aplicado
```

### 5.3 El parche 24 es idempotente

```
$ psql ... -f docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql     # primera vez
COMMENT ×7
psql:<stdin>:110: NOTICE:  core.alerta_destinatario comentada · columnas del modelo sin comentario: 0
PARCHE 24 · aplicado

$ psql ... -f docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql     # segunda vez
COMMENT ×7
psql:<stdin>:110: NOTICE:  core.alerta_destinatario comentada · columnas del modelo sin comentario: 0
PARCHE 24 · aplicado
```

### 5.4 La tabla quedó con 11 de 11 columnas descritas

Lectura con `col_description`, columna por columna:

```
id           → Identificador interno de la fila
alerta_id    → Alerta a la que pertenece el destinatario, según core.alertas_tempranas. Al borrar la alerta se borran sus destinatarios
usuario_id   → Persona con cuenta en el sistema a la que se remite la alerta. Excluyente con cargo
cargo        → Cargo sin cuenta en el sistema al que se remite la alerta, por ejemplo una jefatura de gabinete. Excluyente con usuario_id. Se compara sin distinguir mayúsculas en la unicidad
canal        → Canal del aviso: correo, whatsapp o sms. Un mismo destinatario puede tener una fila por canal
motivo       → Motivo o causa del aviso, cuando el canal no basta para explicar por qué se remite a esta persona o cargo
notificado_en→ Momento en que el envío se completó por este canal. NULL mientras el aviso esté pendiente; no puede ser anterior a la creación de la fila
created_at   → Momento en que se creó el registro
updated_at   → Momento de la última modificación del registro
created_by   → Usuario que registró el destinatario
updated_by   → Usuario que realizó la última modificación del registro
```

### 5.5 Cobertura del modelo

```
2 161 columnas lógicas | 2 161 con comentario | 0 sin comentario
```

La convención de recuento es la del informe del parche 19: tablas y tablas particionadas, sin las particiones hijas (`relkind IN ('r','p')`, excluyendo `pg_inherits`). Las particiones hijas no heredan comentarios porque PostgreSQL no los propaga. La cifra coincide con la que publica `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` §11.7, medida después de aplicar este parche.

---

## 6. Riesgos y lo que queda abierto

**1. La curación del parche 12 no conoce esta tabla, y por eso el hueco no se cierra regenerando el 12.** `migration/curacion_v10_columnas.py` y `migration/curacion_v10.py` tienen **cero** menciones a `alerta_destinatario`. Si alguien regenerara `PARCHE_12_COMENTARIOS_COLUMNAS.sql` desde la curación, las once columnas de la tabla seguirían fuera del archivo generado; las cuatro del parche 23 y las siete de este parche viven solo en sus propios parches. Es consistente con la convención —los parches cerrados no se editan— pero conviene saberlo antes de tocar el generador: hoy la descripción de esa tabla no tiene respaldo en la curación.

**2. El candado global sigue siendo frágil por diseño, y no se replicó.** El `DO` del parche 19 volverá a abortar en cuanto un parche futuro cree una tabla sin comentar todas sus columnas. Es un defecto heredado que este parche no corrige: arreglarlo exige o bien editar el 19 —cerrado— o bien que todo parche nuevo describa sus columnas en el acto. La segunda vía es la sana y es la que se siguió aquí.

**3. El punto ciego de las particiones sigue en la guardia del 19.** Mide 2 100 de las 2 161 columnas. Este parche informa del total, pero no lo impone: si un parche futuro deja una columna de tabla particionada sin describir, el aviso lo dirá y la guardia no lo impedirá.

**4. Las cifras fijas envejecen.** «2 161 de 2 161» es cierto hoy y dejará de serlo con el próximo parche que cree columnas. Se documenta con fecha, como se hizo con el 19.

---

## 7. Frases de otros documentos que quedaban desactualizadas

| Documento y lugar                                                                        | Dice                                                                               | Debe decir hoy                                                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/04_migracion/parches/P19_COMENTARIOS_FALTANTES.md` §6, puntos 1 y 2 (~L157–159)    | «Hoy son las únicas siete columnas sin describir» y «Reejecutar el P19 hoy aborta» | cierto entonces; el parche 24 cerró las siete y devolvió al 19 su reejecutabilidad |
| `docs/04_migracion/parches/P19_COMENTARIOS_FALTANTES.md` §5.3 y tabla de §1 (~L21, L136) | «2 154 de 2 161», «7 sin comentario»                                               | 2 161 de 2 161 y 0 sin comentario desde el parche 24                               |
| `docs/04_migracion/parches/P23_DESTINATARIOS_Y_CUATRO_OJOS.md` §6                        | deja las siete columnas como pendiente de diccionario                              | el parche 24 las describió                                                         |
| `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` §11.7                          | siete columnas sin comentario                                                      | regenerado: hoy informa 0                                                          |
| `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md` §9                                        | «Tras el 19, las 2 145 columnas lógicas quedan todas con comentario»               | tras el 24, las 2 161 columnas del modelo quedan todas con comentario              |
| `docs/README.md`, tabla de parches                                                       | no tiene fila del parche 24                                                        | añadir la fila, y pasar de dieciocho a diecinueve informes                         |

Lo que **no** hay que cambiar, porque se regeneró con este parche: `migration/consolidar_esquema.py` ya declara el bloque `B.19`; `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`, `docs/sql_server/AVISA_V10_ESQUEMA_SIN_FK.sql`, `docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql`, `docs/05_datos/DICCIONARIO_DATOS.md` y `docs/05_datos/diccionario_datos.csv` se reescribieron desde la base y desde el unificado nuevos.

**Estado de esta tabla.** Las filas de `LEGADO` §11.7, `ENTORNO_DOCKER` §9 y `README` (tabla de parches) quedaron aplicadas en la misma sesión: hoy dicen 2 161 de 2 161, la serie de §9 cierra con el 24 y el índice registra el parche y sus diecinueve informes. Las filas de `P19` §6 y `P23` §6 se dejan **como están a propósito**, porque son informes fechados y su texto describe lo que había entonces; el `P23` lleva además una §8 que declara cerrado su riesgo 4.
