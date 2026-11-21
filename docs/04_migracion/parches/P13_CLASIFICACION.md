# P13 — Clasificación: una sola forma de escribirlo

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** modelo v10; catálogo `core.cat_clasificacion`; curaduría de columnas
(`migration/curacion_v10_columnas.py` y `PARCHE_12`); Ley N.° 29733, citada en
`docs/_archivo/P13_CLASIFICACION.md` §8
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_13_CLASIFICACION.sql` (idempotente, 300 líneas, montado como `103_patch_13.sql` en `compose.yaml`, bloque `B.7` del unificado)
**Estado:** **aplicado y verificado en la base viva el 2026-11-21.** La aplicación
consta el 2026-11-18 en `docs/README.md`; la verificación de este informe se hizo
hoy, solo con consultas de lectura.

---

## 1. Resumen

`nivel_clasificacion` dice qué tan reservado es un dato: `1` público, `2`
reservado, `3` confidencial. Antes del P13, 58 de las 59 columnas que lo usaban
eran `smallint` con clave ajena a `core.cat_clasificacion`; una sola,
`consultation.procesos`, era `varchar(20)`. Además, cinco comentarios describían
los mismos números como «público / interno / sensible» y un sexto usaba la
palabra «etiqueta».

El parche hace tres cosas:

1. Convierte `consultation.procesos.nivel_clasificacion` a `smallint` y le añade
   la clave ajena `procesos_nivel_clasificacion_fkey` al catálogo.
2. Alinea los cinco comentarios al vocabulario del catálogo, mediante la
   curaduría y el `PARCHE_12` regenerado.
3. Corrige el nombre visible del nivel 1, que se escribía «Publico» sin tilde.

| Dato                                       | Cabecera del parche (antes) | Medido hoy (2026-11-21) |
| ------------------------------------------ | --------------------------: | ----------------------: |
| Columnas llamadas `nivel_clasificacion`    |                          59 |                  **61** |
| De tipo `smallint`                         |                          58 |                  **61** |
| De tipo texto                              |                           1 |                   **0** |
| Con clave ajena a `core.cat_clasificacion` |                          58 |                  **61** |
| Nulables                                   |                           0 |                   **0** |
| Comentarios con el texto canónico          |                          47 |                  **53** |
| Comentarios con «interno» o «sensible»     |                           5 |        **1** (residual) |
| Filas de `consultation.procesos`           |                           0 |                   **0** |

El salto de 59 a 61 no lo produce este parche: lo producen `core.banco_datos_tratamiento` (P16)
y `core.consulta_reniec` (P17). El comentario residual de la primera se trata en §5.5 y §6.
El parche **no** añade un `CHECK` de rango, no rellena `consultation.procesos` y no toca las demás columnas de texto.

---

## 2. Qué cambia

| Objeto                                      | Tipo                             | Qué hace                                                                           |
| ------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `consultation.procesos.nivel_clasificacion` | `ALTER COLUMN … TYPE smallint`   | Pasa de `varchar(20)` a `smallint`; conserva `NOT NULL` y el defecto, ya como `2`. |
| `procesos_nivel_clasificacion_fkey`         | clave ajena                      | `FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel)`.      |
| `consultation.procesos.nivel_clasificacion` | `DROP DEFAULT` / `SET DEFAULT 2` | Retira `'Reservado'` antes del cambio de tipo y lo repone como número.             |
| Cinco comentarios de columna                | curaduría y `PARCHE_12`          | Cambian «interno / sensible» por «reservado / confidencial».                       |
| `core.cat_clasificacion`                    | `UPDATE`                         | Cambia `'Publico'` por `'Público'` en `nivel = 1`.                                 |
| Verificación previa                         | bloques `DO`                     | Abortan si el tipo, las filas o los tres niveles no son los esperados.             |

Todo el cuerpo va entre `BEGIN` y `COMMIT`; la verificación previa corre antes de tocar nada.

---

## 3. Por qué, decisión por decisión

### 3.1 Un campo, un vocabulario

`core.cat_clasificacion` tiene tres filas: `1 Público`, `2 Reservado` y `3 Confidencial`. «Interno» y «sensible» no existen en ese catálogo: quien leyera el diccionario habría supuesto dos niveles que la base nunca tuvo.

### 3.2 Numérico con clave ajena, no texto

Una columna de texto obliga a comparar cadenas donde las demás comparan enteros y
no garantiza que el valor exista en el catálogo. Con `smallint` y clave ajena, el
valor solo puede ser uno de los tres niveles.

### 3.3 Sin `CHECK` de rango repetido

La cabecera descarta añadir `CHECK (nivel_clasificacion BETWEEN 1 AND 3)` a cada tabla:
la clave ajena ya limita el valor a los tres del catálogo, y ese catálogo no admite
borrados mientras haya filas que lo referencien. Repetir el `CHECK` añadiría decenas
de objetos sin cambiar el comportamiento. La regla queda en el comentario de cada
columna: `nivel_clasificacion` es `smallint NOT NULL` con clave ajena a
`core.cat_clasificacion`; `1` público, `2` reservado, `3` confidencial.

### 3.4 La tilde es nombre visible, no clave

Nada compara contra la cadena `'Publico'`: la clave ajena es por número. Corregir
la tilde no rompe referencias y evita que el nombre visible salga mal escrito.

---

## 4. Migración de datos

| Concepto                                  | Valor                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Filas de `consultation.procesos`          | **0** (medido hoy: sigue en 0)                                                                                                        |
| Valores que hubo que mapear               | Ninguno: la tabla estaba vacía                                                                                                        |
| Defecto anterior                          | `'Reservado'`                                                                                                                         |
| Defecto posterior                         | `2`                                                                                                                                   |
| Traducción del `USING`                    | `Público`/`Publico` → 1, `Reservado` → 2, `Confidencial` → 3                                                                          |
| Filas tocadas en `core.cat_clasificacion` | **[EN BLANCO · a confirmar]**: la sentencia apunta solo a `nivel = 1`, pero el número de filas tocadas no se midió y ya está aplicada |

El `USING` deja el archivo utilizable en una copia con datos, aunque aquí la tabla esté vacía; ninguna otra fila se escribe.

---

## 5. Verificación con cifras medidas

### 5.1 Tipo, nulabilidad y defecto

```sql
SELECT data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema='consultation' AND table_name='procesos'
   AND column_name='nivel_clasificacion';
```

```
smallint|NO|2
```

### 5.2 La clave ajena

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='consultation.procesos'::regclass
   AND conname='procesos_nivel_clasificacion_fkey';
```

```
procesos_nivel_clasificacion_fkey|FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel)
```

### 5.3 El catálogo

```sql
SELECT nivel, nombre FROM core.cat_clasificacion ORDER BY nivel;
```

```
1|Público
2|Reservado
3|Confidencial
```

La columna del catálogo se llama `nivel` (no `id`), y la de tipo documental en `core.documentos` es `tipo_id`.

### 5.4 Recuento de columnas del campo

```sql
SELECT count(*) AS total, count(*) FILTER (WHERE format_type(a.atttypid,a.atttypmod)='smallint') AS smallint, count(*) FILTER (WHERE format_type(a.atttypid,a.atttypmod) LIKE 'character varying%') AS texto, count(*) FILTER (WHERE NOT a.attnotnull) AS nulables, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conrelid=c.oid AND con.contype='f' AND con.conkey=ARRAY[a.attnum] AND pg_get_constraintdef(con.oid) LIKE '%cat_clasificacion%')) AS con_fk
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE c.relkind IN ('r','p') AND a.attname='nivel_clasificacion' AND n.nspname NOT IN ('pg_catalog','information_schema','public','legacy');
```

```
61|61|0|0|61
```

Hoy son **61** columnas, **61** `smallint`, **0** de texto, **0** nulables y **61** con
clave ajena. El desglose da `p|1` y `r|60`: una tabla particionada (`agent.llm_call`), 54
ordinarias y 6 particiones, es decir 55 lógicas y 6 particiones. La cabecera hablaba de
53 lógicas; las dos restantes son las tablas del P16 y del P17. Tres vistas exponen el
mismo nombre y no se cuentan: `information_schema` daría 64.

### 5.5 Comentarios: los cinco corregidos y un residuo

```sql
SELECT count(*), col_description(c.oid,a.attnum) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE c.relkind IN ('r','p') AND a.attname='nivel_clasificacion' AND n.nspname NOT IN ('pg_catalog','information_schema','public','legacy')
 GROUP BY 2 ORDER BY 1 DESC;
```

```
53|Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial
6|
1|Fijo en 3 (Confidencial). Las reglas de acceso solo distinguen niveles 1 a 3; fijarlo impide degradar la protección por error.
1|Nivel de clasificación de la información del propio registro (1 público, 2 interno, 3 reservado)
```

El listado es completo: no hay ninguna fila con «sensible» ni con «etiqueta», y
«interno» aparece solo en la última. Las cinco columnas que corrigió el P13 **no se
pueden nombrar hoy desde la base**: comparten el texto de las demás. El único rastro
es `docs/_archivo/REVISION_DICCIONARIO_Y_V10.md` §2, que las sitúa en las líneas 965,
1033, 1062, 1093 y 1111 de una versión anterior de `migration/curacion_v10_columnas.py`,
no conservada. **Nombres: [EN BLANCO · a confirmar].**

La comprobación indirecta es concluyente: «sensible» aparece **0** veces en las 61 columnas
y «interno» **1** vez, en `core.banco_datos_tratamiento` (P16, posterior al P13). Esa
columna no puede ser una de las cinco; luego las cinco están entre las 53 canónicas.

---

## 6. Riesgos y lo que queda abierto

**1. Un comentario posterior contradice la regla canónica.** El P16 creó
`core.banco_datos_tratamiento` y su comentario entró por la curaduría
(`migration/curacion_v10_columnas.py` L2059), que el `PARCHE_12` escribe en
`docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql` L784. Dice «1 público, 2 interno,
3 reservado»: inventa «interno» y rotula el 3 como «reservado» cuando el catálogo
dice «confidencial». La comprobación 4.5 del P13 esperaba **0** y hoy da **1**.
Corrección propuesta, **sin aplicar**:

```sql
-- NO APLICADO
COMMENT ON COLUMN core.banco_datos_tratamiento.nivel_clasificacion IS
    'Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial';
```

Debe quedar también en `migration/curacion_v10_columnas.py` L2059; si solo se
cambia la base, la próxima regeneración del `PARCHE_12` la revierte.

**2. El parche ya no describe el inventario de hoy, y no hace falta que lo haga.**
Sus consultas 4.4 y 4.5 esperaban 59 columnas y 0 comentarios viejos; hoy dan 61 y 1.
Son fotos del estado de partida y `SELECT` de comprobación: reaplicar no falla por ellas.

**3. Los nombres de las cinco columnas corregidas no quedaron registrados**
(§5.5, **[EN BLANCO · a confirmar]**). No impide verificar el efecto, pero impide
auditar columna por columna sin la versión anterior de la curaduría.

**4. La garantía del rango depende solo de la clave ajena.** No hay `CHECK` repetido,
por la decisión de §3.3. La prueba de borrado del catálogo no se ejecutó aquí porque el
encargo prohíbe escribir. La única excepción es `core.consulta_reniec`, que añade
`CHECK (nivel_clasificacion = 3)` en el P17.

**5. `consultation.procesos` sigue vacía y sin tabla de origen en el legado.** El
parche la alinea con el modelo, pero no la rellena; las otras columnas de texto de
esa tabla (`fase_actual`, `estado`, `pueblo_indigena`) siguen siendo texto libre.

**6. El caso del P16 muestra que la regla no se aplica sola.** Queda como
propuesta añadir a `migration/loader/checks.py` una comprobación de que toda
columna `nivel_clasificacion` tenga el texto canónico.

---

## 7. Frases de otros documentos que quedan desactualizadas

«Viejo» es el texto que hay hoy; «nuevo» es lo que debe decir. No se ha editado
ninguno de estos documentos.

| Documento / sección                                            | Dice (viejo)                                                                                                 | Debe decir (nuevo)                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/02_arquitectura/AVISA_PRODUCE_v10.md` §14.4, línea ~5360 | `nivel_clasificacion VARCHAR(20) NOT NULL DEFAULT 'Reservado'`                                               | `nivel_clasificacion SMALLINT NOT NULL DEFAULT 2`, con clave ajena a `core.cat_clasificacion(nivel)`                                        |
| `docs/_archivo/REVISION_DICCIONARIO_Y_V10.md` §2 y §3.2        | «52 columnas dicen "público / reservado / confidencial"; **ninguna** dice ya "público / interno / sensible"» | «53 columnas dicen el texto canónico; una (`core.banco_datos_tratamiento`, P16) dice "1 público, 2 interno, 3 reservado" y debe corregirse» |
| `docs/_archivo/P13_CLASIFICACION.md` §1 y §5                   | «Aparece en 59 columnas del modelo»; «el parche entra como bloque **B.8**»                                   | «61 columnas al 2026-11-21: el P16 y el P17 añadieron dos»; «bloque **B.7**»                                                                |
| `docs/_archivo/P13_CLASIFICACION.md` §4                        | «Comentarios con "interno" o "sensible": 0 / 0»                                                              | «0 con "sensible"; 1 con "interno", en `core.banco_datos_tratamiento` (P16)»                                                                |
| `docs/PARCHE_13_CLASIFICACION.sql`, cabecera y 4.4–4.5         | «58 de las 59»; «Esperado: 59 columnas y 59 con clave ajena»; «Esperado: 0»                                  | No se reescribe: es la foto del estado de partida. Si se cita como medición viva, hoy es 61 de 61 y 1 comentario viejo                      |

Lo que **no** hay que cambiar: la fila del P13 en `docs/README.md` sigue correcta (aplicado
el 2026-11-18, cinco comentarios); el bloque `B.7` conserva las 300 líneas de la fuente;
y el diagrama §3.12 de `AVISA_PRODUCE_v10.md` ya muestra `+smallint nivel_clasificacion FK`.
