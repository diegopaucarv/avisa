# P12 — Comentarios de tablas y columnas del modelo v10

Estado: **aplicado y verificado**. Parche ejecutado contra `avisa-db` el 2026-11-18.
Entregable SQL: `docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql`.
Generador: `migration/generar_comentarios_sql.py`.

Antes del parche, el diccionario de datos se armaba con un archivo de curaduría
paralelo a la base. Cualquiera que abriera la base con `psql` veía nombres de
columna y ningún significado. Este parche escribe el significado **en el catálogo
del motor**, que es donde debe vivir.

---

## 1. El problema de las columnas «sin descripción»

Al medir el diccionario aparecieron miles de columnas sin descripción. El número
parecía excesivo y se desglosó:

| Grupo                      | Columnas | Qué era                                                                  |
| -------------------------- | -------: | ------------------------------------------------------------------------ |
| `legacy`                   |      610 | sistema anterior: 519 columnas posicionales `cNN` y 91 con nombre propio |
| modelo v10, tablas lógicas |    2 036 | columnas reales del diseño, sin comentario en la base                    |
| modelo v10, particiones    |      330 | copias de columnas del padre en las 24 particiones                       |

Las 330 de partición no son columnas nuevas: son la misma columna repetida por
partición. Y las 610 del sistema anterior se explican porque el legado es un
archivo, no un modelo: sus columnas `c01..cNN` solo tienen sentido en el contexto
de su hoja.

De ahí que el trabajo real fuera de **2 036** columnas lógicas, no de todo lo
anterior. De esas 2 036, 29 solo tenían descripción dentro de los parches 9 a 11 y
no en la curaduría; este trabajo las promovió a `curacion_v10_columnas.py` para que
una futura regeneración no las perdiera.

---

## 2. Qué hace el parche

```sql
COMMENT ON TABLE  esquema.tabla        IS '...';
COMMENT ON COLUMN esquema.tabla.col    IS '...';
```

- **255 tablas lógicas** del modelo v10 reciben su propósito.
- **2 036 columnas lógicas** reciben su descripción.
- Las **24 particiones** quedan fuera a propósito: PostgreSQL no propaga
  comentarios a las particiones, así que el diccionario copia la descripción de la
  tabla padre al generarse.
- El esquema `legacy` queda fuera: se documenta con `migration/curacion_legacy.py`.

Es idempotente: `COMMENT ON` reemplaza el comentario anterior, nunca lo duplica.

---

## 3. De dónde salen los textos

| Fuente                | Qué aporta                                | Archivo                              |
| --------------------- | ----------------------------------------- | ------------------------------------ |
| Curaduría de tablas   | propósito de las 255 tablas lógicas       | `migration/curacion_v10.py`          |
| Curaduría de columnas | descripción de las 2 036 columnas lógicas | `migration/curacion_v10_columnas.py` |

Cada texto se redactó leyendo la columna, sus claves ajenas y su tabla, no
deduciéndolo del nombre. El generador **verifica contra el catálogo** que cada
tabla y cada columna existan antes de escribir el archivo; si la curaduría y la
base no calzan, se detiene y lo lista.

---

## 4. Resultado medido

| Métrica                         | Antes |                       Después |
| ------------------------------- | ----: | ----------------------------: |
| Tablas v10 con comentario       |     0 |                       **255** |
| Columnas v10 con comentario     |    27 |                     **2 036** |
| Columnas lógicas con comentario |    27 |             **2 036** (todas) |
| Columnas de partición           |     0 | 0 (heredan en el diccionario) |

Las 27 columnas que ya tenían comentario eran las 25 de `core` que dejó el parche 9
y 2 de `audit`. Se conservaron y, donde la curaduría tenía un texto mejor, se
reemplazaron.

---

## 5. Efecto en el diccionario

`migration/generar_diccionario.py` gana dos reglas:

1. **Herencia en particiones**: si una columna de partición no tiene comentario
   propio, copia el de su tabla padre. Son 330 columnas.
2. **Origen nuevo en el CSV**: `heredado_padre`, para no confundir una descripción
   escrita en la base con una copia del padre.

`origen_descripcion` queda así:

| Origen            | Filas del CSV | Qué significa                                            |
| ----------------- | ------------: | -------------------------------------------------------- |
| `comentario_bd`   |         2 036 | texto escrito en la base por este parche o anterior      |
| `heredado_padre`  |           330 | copia de la descripción del padre en una partición       |
| `curaduria`       |           197 | columnas del legado documentadas en `curacion_legacy.py` |
| `sin_descripcion` |           610 | columnas del legado sin documentar                       |

El CSV queda en **3 173** filas de columna.

---

## 6. Cómo verificar

```sql
-- Tablas del modelo con comentario
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p') AND NOT c.relispartition
   AND n.nspname NOT IN ('public','information_schema','legacy')
   AND n.nspname !~ '^pg_' AND obj_description(c.oid, 'pg_class') IS NOT NULL;
-- 255

-- Columnas con comentario
SELECT n.nspname, count(*) FILTER (WHERE col_description(c.oid, a.attnum) IS NOT NULL)
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
   AND n.nspname NOT IN ('public','information_schema') AND n.nspname !~ '^pg_'
 GROUP BY 1 ORDER BY 1;
```

Regenerar el parche y el diccionario:

```
python migration/generar_comentarios_sql.py
python migration/generar_diccionario.py
```

---

## 7. Lo que el parche no hace

- No comenta las particiones: se resuelve por herencia en el diccionario.
- No comenta el esquema `legacy`: sus 610 columnas sin descripción siguen visibles
  como hueco declarado, no como olvido.
- No reescribe la curaduría: si una descripción mejora, se edita
  `curacion_v10_columnas.py` y se regenera el parche.
