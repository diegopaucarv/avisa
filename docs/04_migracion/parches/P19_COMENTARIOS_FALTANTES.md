# P19 — Los 19 comentarios que faltaban

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** modelo v10 y la regla de diccionario que fijó el parche 12 —ninguna columna del modelo sin descripción en la propia base—; trazabilidad RA-07, RF-D13, RA-08 y RN-17 de las tablas y columnas que creó el parche 17.
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_19_COMENTARIOS_FALTANTES.sql` (idempotente, montado como `109_patch_19.sql` en `compose.yaml`, bloque `B.14` del unificado)
**Estado:** **aplicado y verificado en la base viva el 2026-11-21.** El registro de aplicación que conserva `docs/README.md` es del 2026-11-20; la verificación de este informe se ejecutó contra el contenedor el 2026-11-21.

---

## 1. Resumen

El parche 12 comentó las columnas del modelo tal como estaban el 2026-11-18. Después, el parche 17 creó tres tablas —`core.cat_privilegio`, `core.privilegio_usuario` y `core.consulta_reniec`— y añadió cinco columnas a `core.envios_comunicacion`. De esas cinco, el propio parche 17 comentó tres (`id_externo`, `estado_entrega` y `costo_estimado_usd`); las otras dos quedaron sin descripción. Sumadas a las columnas de las tres tablas nuevas —cuatro, siete y seis—, el modelo v10 acumuló 19 columnas sin describir.

El parche hace una sola cosa: ejecutar 19 sentencias `COMMENT ON COLUMN`. No crea ni altera tablas, no añade índices, no toca restricciones, no escribe filas de datos. La aritmética de la cabecera se comprueba contra el archivo: 4 + 7 + 6 + 2 = 19.

| Dato                            | Antes del P19 |                  Después del P19 |                                        Hoy |
| ------------------------------- | ------------: | -------------------------------: | -----------------------------------------: |
| Columnas lógicas del modelo     |         2 145 |               2 145 (sin cambio) |                                  **2 161** |
| Columnas lógicas con comentario |         2 126 |               **2 145 de 2 145** |                         **2 161 de 2 161** |
| Columnas lógicas sin comentario |        **19** | **0** (el guardián aborta si no) | **0** (las siete del P23 las cerró el P24) |
| Sentencias `COMMENT ON COLUMN`  |             — |                           **19** |                                         19 |
| Líneas del archivo              |             — |                          **120** |                                        120 |

El «Antes» procede del informe del parche 18 (§3.1, medido el 2026-11-20): 2 145 columnas lógicas, 2 126 con comentario y 19 sin describir. El «Después» lo declara la cabecera del bloque `B.14` y lo garantiza el `DO` del propio parche. El «Hoy» está medido en §5. No se desglosa aquí la diferencia entre 2 145 y 2 161: cada parche posterior documenta las columnas que añadió, y sumarlas sin medirlas sería inventar la aritmética.

---

## 2. Qué cambia

Las 19 sentencias, en el orden del archivo, con su texto literal y el estado previo de cada columna.

| Objeto                                            | Tipo                | Qué hace                                                                                  | Antes          |
| ------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| `core.cat_privilegio.id`                          | `COMMENT ON COLUMN` | «Identificador corto del privilegio; es la clave que usan las tablas de concesión.»       | sin comentario |
| `core.cat_privilegio.codigo`                      | `COMMENT ON COLUMN` | «Código estable del privilegio, el que consultan las funciones de permiso.»               | sin comentario |
| `core.cat_privilegio.nombre`                      | `COMMENT ON COLUMN` | «Nombre del privilegio tal como se muestra a las personas.»                               | sin comentario |
| `core.cat_privilegio.descripcion`                 | `COMMENT ON COLUMN` | «Qué permite hacer el privilegio, en una frase.»                                          | sin comentario |
| `core.privilegio_usuario.id`                      | `COMMENT ON COLUMN` | «Identificador interno de la fila»                                                        | sin comentario |
| `core.privilegio_usuario.usuario_id`              | `COMMENT ON COLUMN` | «Persona que recibe el privilegio, según core.usuarios.»                                  | sin comentario |
| `core.privilegio_usuario.privilegio_id`           | `COMMENT ON COLUMN` | «Privilegio concedido, según core.cat_privilegio.»                                        | sin comentario |
| `core.privilegio_usuario.desde`                   | `COMMENT ON COLUMN` | «Fecha desde la que rige la concesión.»                                                   | sin comentario |
| `core.privilegio_usuario.otorgado_por_usuario_id` | `COMMENT ON COLUMN` | «Persona que autorizó la concesión; queda registrada para la auditoría.»                  | sin comentario |
| `core.privilegio_usuario.activo`                  | `COMMENT ON COLUMN` | «Si la concesión está vigente. Se apaga para retirar el privilegio sin borrar el rastro.» | sin comentario |
| `core.privilegio_usuario.creado_en`               | `COMMENT ON COLUMN` | «Momento en que se registró la concesión.»                                                | sin comentario |
| `core.consulta_reniec.id`                         | `COMMENT ON COLUMN` | «Identificador interno de la consulta.»                                                   | sin comentario |
| `core.consulta_reniec.actor_uid`                  | `COMMENT ON COLUMN` | «Actor sobre el que se consultó, según core.actores.»                                     | sin comentario |
| `core.consulta_reniec.caso_id`                    | `COMMENT ON COLUMN` | «Caso en cuyo contexto se pidió la consulta, si la consulta se hizo por uno.»             | sin comentario |
| `core.consulta_reniec.consultado_por_usuario_id`  | `COMMENT ON COLUMN` | «Persona que pidió y ejecutó la consulta; solo puede ser quien tiene el privilegio.»      | sin comentario |
| `core.consulta_reniec.fecha_consulta`             | `COMMENT ON COLUMN` | «Momento en que se hizo la consulta a PIDE-RENIEC.»                                       | sin comentario |
| `core.consulta_reniec.integracion_id`             | `COMMENT ON COLUMN` | «Integración por la que se llegó al servicio, según core.integraciones.»                  | sin comentario |
| `core.envios_comunicacion.plantilla_codigo`       | `COMMENT ON COLUMN` | «Código de la plantilla de mensaje con la que se redactó el envío.»                       | sin comentario |
| `core.envios_comunicacion.actualizado_en`         | `COMMENT ON COLUMN` | «Momento de la última actualización del estado del envío.»                                | sin comentario |

El «Antes» lo declara la cabecera del parche: esas 19 columnas «quedaron sin descripción en la base». No hay una medición independiente del estado previo columna por columna; la cifra agregada (19) sí está medida en el informe del parche 18.

---

## 3. Por qué, decisión por decisión

### 3.1 Un parche aparte, y no una edición del 17

El parche 17 ya está aplicado y se reejecuta entero al levantar un entorno nuevo. Añadirle sentencias cambiaría el contenido de un parche cerrado, y el registro de qué se corrigió y cuándo se perdería dentro de un archivo que ya tenía otro alcance. Un parche nuevo deja el rastro explícito: se sabe que el 17 creó las tablas y que el 19 las describió, y se sabe en qué orden.

La cabecera del bloque `B.14` añade la razón de orden: el parche se aplica después del 12 para que la comprobación final mida «lo que de verdad queda sin describir». Si se hubiera insertado antes, su propio guardián habría abortado por columnas que el 12 todavía no había tocado.

### 3.2 Idempotencia por la semántica de `COMMENT ON`

`COMMENT ON` no inserta: sobrescribe el comentario anterior. Por eso el parche se puede ejecutar cuantas veces sea necesario sin error y sin duplicados. Es idempotencia de la sentencia, no una idempotencia construida con `IF NOT EXISTS` ni con borrados previos; el archivo no necesita ninguna de esas ceremonias.

### 3.3 Solo dos de las cinco columnas de `core.envios_comunicacion`

El parche 17 añadió cinco columnas a `core.envios_comunicacion`: `id_externo`, `plantilla_codigo`, `estado_entrega`, `costo_estimado_usd` y `actualizado_en`. El mismo parche 17 comentó `id_externo`, `estado_entrega` y `costo_estimado_usd` —se comprueba en su archivo, líneas 404–415—, pero no `plantilla_codigo` ni `actualizado_en`. El parche 19 cierra exactamente ese hueco. No vuelve a comentar las otras tres: repetir el texto no habría aportado nada y habría dado la impresión de que el 17 las había olvidado.

### 3.4 Por qué entran también los `id` y las columnas de auditoría

Los tres `id` de las tablas nuevas y las columnas de auditoría (`created_at`, `updated_at`, `created_by`, `updated_by`) no tienen semántica de negocio, pero la regla del parche 12 es de cobertura, no de relevancia: una columna sin descripción es un hueco visible en el diccionario. Por eso el parche describe `core.cat_privilegio.id`, `core.privilegio_usuario.id` y `core.consulta_reniec.id` igual que las columnas con contenido propio. En `core.privilegio_usuario` la auditoría se reduce a `creado_en`, que es la única columna de ese tipo que el parche 17 dejó sin comentar.

### 3.5 El `DO` final no es decorativo

El bloque `DO $p19_verify$` cuenta las columnas del modelo sin comentario y lanza `RAISE EXCEPTION` si el resultado no es cero. La comprobación corre dentro de la misma transacción que los 19 `COMMENT ON`, así que un hueco inesperado revierte también los comentarios. Es un guardián, no un informe: convierte «creo que quedaron todas» en «o quedaron todas o el parche no termina». Su alcance, sin embargo, tiene dos límites que se tratan en §6.

---

## 4. Migración de datos

No hay migración. `COMMENT ON COLUMN` escribe en el catálogo `pg_description`; no toca ninguna tabla de usuario, no recalcula columnas, no reescribe filas y no cambia el tipo ni la restricción de nada. El parche no contiene un solo `INSERT`, `UPDATE`, `DELETE`, `ALTER TABLE` ni `CREATE`.

Por eso no hay cifra de filas antes y después: no hay filas que mover. La única escritura es de metadatos, y la única reversión posible es sobrescribir el comentario con otro texto.

---

## 5. Verificación con cifras medidas

### 5.1 El archivo tiene 19 sentencias y 120 líneas

```
$ wc -l docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
120 docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
$ grep -c 'COMMENT ON COLUMN' docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
19
```

Las 19 se reparten así: 4 en `core.cat_privilegio`, 7 en `core.privilegio_usuario`, 6 en `core.consulta_reniec` y 2 en `core.envios_comunicacion`. En el unificado, el cuerpo copiado del bloque `B.14` ocupa exactamente 120 líneas (18745–18864); con la cabecera de procedencia de 10 líneas que lo precede, el bloque completo ocupa 130 líneas del archivo.

### 5.2 Los 19 comentarios están en la base y coinciden con el archivo

La comparación se hizo columna por columna, con el texto del archivo como valor esperado:

```
sentencias verificadas: 19 | discrepancias de texto: 0
```

Muestra literal de seis de las 19, leída con `col_description`:

```
core.cat_privilegio.codigo → Código estable del privilegio, el que consultan las funciones de permiso.
core.cat_privilegio.id → Identificador corto del privilegio; es la clave que usan las tablas de concesión.
core.consulta_reniec.fecha_consulta → Momento en que se hizo la consulta a PIDE-RENIEC.
core.envios_comunicacion.plantilla_codigo → Código de la plantilla de mensaje con la que se redactó el envío.
core.privilegio_usuario.activo → Si la concesión está vigente. Se apaga para retirar el privilegio sin borrar el rastro.
core.privilegio_usuario.otorgado_por_usuario_id → Persona que autorizó la concesión; queda registrada para la auditoría.
```

Las tres tablas tienen, además, comentario de tabla, puesto por el parche 17 y verificado hoy:

- `core.cat_privilegio` → «Catálogo de privilegios nominales: capacidades que se conceden a una persona concreta y no a un rol. Origen: RA-07 del ERS v0.5.»
- `core.privilegio_usuario` → «Concesiones nominales y con fecha de caducidad. Una persona puede tener el privilegio y perderlo sin cambiar de rol. Origen: RA-07.»
- `core.consulta_reniec` → «Registro de cada consulta a PIDE-RENIEC (SVC-16): quién la pidió, sobre qué actor, por qué y cuándo, con el resultado cifrado. Sin columna de etiqueta: la base no clasifica personas (prohibición de etiquetado sin sentencia firme). Origen: RF-D13, RA-07, RA-08, RN-17.»

Y la cobertura por tabla, medida hoy: `core.cat_privilegio` 5 de 5 columnas comentadas, `core.privilegio_usuario` 9 de 9 y `core.consulta_reniec` 10 de 10. La diferencia entre esas cifras y las del parche son las columnas que el propio parche 17 ya había descrito.

### 5.3 Columnas sin comentario hoy

```
2161 columnas lógicas | 2161 con comentario | 0 sin comentario
```

Al cerrar este informe quedaban siete, todas en la tabla que creó el parche 23:

```
core.alerta_destinatario.alerta_id
core.alerta_destinatario.created_at
core.alerta_destinatario.created_by
core.alerta_destinatario.id
core.alerta_destinatario.motivo
core.alerta_destinatario.updated_at
core.alerta_destinatario.updated_by
```

El parche 24 las describió y hoy no queda ninguna (véase §8).

La convención de recuento importa y queda dicha: se cuentan las tablas y las tablas particionadas, sin las particiones hijas (`relkind IN ('r','p')`, excluyendo `pg_inherits`). Las particiones hijas no heredan comentarios, porque PostgreSQL no los propaga; si no se excluyen, la misma consulta devuelve cientos de filas de `agent.*`, `avisa.*` y `ctx.*`. La cifra 2 161 coincide con la que ya publica `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` §11.7.

---

## 6. Riesgos y lo que queda abierto

**1. El patrón se repitió, y esta vez el que dejó el hueco fue el parche 23.** El P23 creó `core.alerta_destinatario` con once columnas, describió las cuatro que tienen semántica propia (`usuario_id`, `cargo`, `canal`, `notificado_en`) y dejó siete sin comentario: las de auditoría, las claves y `motivo`. Hoy son las únicas siete columnas sin describir del modelo. Esto es exactamente lo que el P19 vino a corregir, y ya está anotado en el informe del P23 §6. El remedio natural es el mismo que se aplicó aquí: un parche de comentarios nuevo —o la regeneración del parche 12— que describa esas siete; no requiere cambio de esquema.

**2. Reejecutar el P19 hoy aborta, aunque las sentencias sean idempotentes.** El `DO` final no mide «las 19 columnas del parche»: mide todas las tablas regulares del modelo. Con las siete columnas del P23 en la base, el guardián encuentra un valor distinto de cero, lanza la excepción y, como corre dentro de la transacción, revierte también los 19 `COMMENT ON`. La idempotencia de `COMMENT ON` sigue siendo cierta; lo que dejó de ser reejecutable es el archivo completo. Cerrar el punto 1 con un parche de comentarios devuelve al P19 su condición de reejecutable sin tocarlo.

**3. El guardián no ve las tablas particionadas.** Su consulta filtra `relkind = 'r'`, así que mide 2 100 columnas, no las 2 161 de la convención del modelo. Las 61 columnas de las tablas particionadas (`relkind = 'p'`) quedan fuera de su red: hoy están todas comentadas, pero un parche futuro podría dejar una sin describir y el `DO` no lo notaría. Es un punto ciego del alcance, no un defecto de los comentarios.

**4. Las cifras fijas envejecen.** El encabezado del bloque `B.14` y el registro de `docs/README.md` dicen «2 145 de 2 145»; fue cierto al aplicar y hoy no lo es. Es el mismo problema de fondo que el punto 1: contar columnas en un documento que sigue creciendo exige una fecha o una remisión a la medición, no un número suelto. Las frases concretas quedan listadas en §7.

---

## 7. Frases de otros documentos que quedaban desactualizadas

| Documento y lugar                                              | Dice                                                                 | Debe decir hoy                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `docs/README.md`, fila del parche 19 (~L136)                   | «dejó el modelo con 2 145 de 2 145 columnas descritas»               | «dejó el modelo sin columnas sin describir en su momento; hoy está en 2 161 de 2 161 y no queda ninguna (parche 24)» |
| `docs/README.md`, lista de parches (~L206)                     | «el modelo queda sin columnas sin describir»                         | matizar: quedó así tras el 19; el parche 23 abrió siete huecos y el 24 los cerró                                     |
| `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`, cabecera (~L115–117)   | «deja el modelo con 2 145 de 2 145 columnas descritas»               | 2 161 de 2 161: B.14 conserva su texto de entonces y el bloque B.19 cierra el modelo                                 |
| `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`, §9 (~L483–487) | «Tras el 19, las 2 145 columnas lógicas quedan todas con comentario» | cierto entonces; hoy la serie cierra en 2 161 de 2 161 tras el 24                                                    |

Lo que se corrigió después: el parche 24 describió las siete columnas de
`core.alerta_destinatario`, y con eso `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md`
§11.7 y la fila de `migration/curacion_v10_columnas.py` en `docs/README.md` §2 pasaron
a decir 2 161 de 2 161. `docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md` (~L526–536)
ya acertaba al decir que este parche no altera las cifras estructurales y solo escribe
los 19 comentarios.

---

## 8. Actualización posterior (parche 24, 2026-11-21)

El parche 24 describe las siete columnas que abrió el 23. Se escribe después y **no
reescribe §6**, que queda como foto del estado que dejó este parche.

| Pendiente de §6                                     | Estado      | Quién lo cerró                                                                                                  |
| --------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Las siete columnas nuevas sin describir          | **Cerrado** | Parche 24: siete `COMMENT ON COLUMN`; el modelo cierra en **2 161 de 2 161**                                    |
| 2. Reejecutar el P19 aborta por esas siete          | **Cerrado** | Con las siete descritas, el `DO` de este parche vuelve a dar cero y el archivo se reejecuta entero, sin tocarlo |
| 3. El guardián global sigue midiendo todo el modelo | **Abierto** | Es el defecto de diseño: el 24 no lo replica y verifica solo sus propias columnas                               |

El detalle está en `04_migracion/parches/P24_COMENTARIOS_DESTINATARIO.md`.
