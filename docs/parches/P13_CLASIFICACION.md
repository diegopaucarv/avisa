# P13 — Un solo formato para el nivel de clasificación

Estado: **aplicado y verificado**. Parche ejecutado contra `avisa-db` el 2026-11-18.
Entregable SQL: `docs/PARCHE_13_CLASIFICACION.sql`.

El campo `nivel_clasificacion` marca qué tan reservado es un dato: `1` público,
`2` reservado, `3` confidencial. Aparece en 59 columnas del modelo y todas dicen lo
mismo. Menos una.

---

## 1. El problema: 58 columnas iguales y 1 distinta

| | Columnas | Tipo | Clave ajena |
| --- | ---: | --- | --- |
| Resto del modelo | 58 | `smallint` | sí, a `core.cat_clasificacion` |
| `consultation.procesos` | 1 | `varchar(20)` | **no** |

La excepción no era inocua. Quien leyera el diccionario encontraba dos
vocabularios para el mismo campo:

- el del catálogo: **público, reservado, confidencial**;
- el de cinco comentarios: «público, **interno**, **sensible**».

«Interno» y «sensible» no existen en `core.cat_clasificacion`. Eran dos niveles
imaginarios que la base nunca tuvo, escritos en la documentación de 53 tablas.

---

## 2. Qué hace el parche

1. `consultation.procesos.nivel_clasificacion` pasa de `varchar(20)` a `smallint`,
   conserva `NOT NULL`, estrena `DEFAULT 2` y gana la clave ajena
   `procesos_nivel_clasificacion_fkey`.
2. El `USING` traduce etiquetas a números (`Público`/`Publico` → 1, `Reservado` → 2,
   `Confidencial` → 3), de modo que el archivo sirve también en una copia con datos.
3. `core.cat_clasificacion` deja de escribir «Publico» sin tilde.

Es **idempotente**: si la columna ya es `smallint` no convierte nada, y si la clave
ajena ya existe no la duplica. Se ejecutó dos veces seguidas para comprobarlo.

---

## 3. Por qué no se añade un `CHECK`

Un `CHECK (nivel_clasificacion BETWEEN 1 AND 3)` repetido en 53 tablas no añadiría
ninguna garantía: la clave ajena ya limita el valor a los tres del catálogo, y ese
catálogo no admite borrados mientras haya filas que lo referencien. Añadiría 53
objetos al inventario sin cambiar el comportamiento. La regla queda escrita en el
comentario de cada columna.

---

## 4. Verificación ejecutada

| Comprobación | Esperado | Obtenido |
| --- | --- | --- |
| Tipo y nulabilidad de la columna migrada | `smallint`, `NO`, defecto `2` | `smallint`, `NO`, `2` |
| Clave ajena al catálogo | existe | `procesos_nivel_clasificacion_fkey` |
| Columnas del campo que siguen en texto | 0 | **0** |
| Columnas del campo con clave ajena | 59 de 59 | **59 de 59** |
| Comentarios con «interno» o «sensible» | 0 | **0** |
| Valores fuera del catálogo | 0 | **0** |
| Nombre del nivel 1 | `Público` | `Público` |

Los tres niveles quedan así: `1 Público`, `2 Reservado`, `3 Confidencial`.

---

## 5. Efecto en los documentos

- **Diccionario**: la columna deja de describirse como texto; el CSV cambia el tipo
  de una fila. Se regenera con `python migration/generar_diccionario.py`.
- **Esquema unificado**: el parche entra como bloque **B.8** en
  `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`.
- **`compose.yaml`**: se monta en `/opt/avisa/sql/103_patch_13.sql`, junto a la
  serie 96–102. El `initdb` no lo aplica: es post-carga.
- **`AVISA_PRODUCE_v10.md`**: `consultation.procesos` deja de figurar con el nivel
  en texto.

---

## 6. Cómo verificar

```sql
-- 4.1 tipo, nulabilidad y defecto
SELECT data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='consultation' AND table_name='procesos'
   AND column_name='nivel_clasificacion';

-- 4.4 todas las columnas del campo con clave ajena
SELECT count(*) AS columnas,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM pg_constraint con
          WHERE con.conrelid = c.oid AND con.contype = 'f'
            AND pg_get_constraintdef(con.oid) LIKE '%cat_clasificacion%')) AS con_clave_ajena
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 WHERE c.relkind IN ('r','p') AND a.attname = 'nivel_clasificacion'
   AND n.nspname NOT IN ('pg_catalog','information_schema','public','legacy');
```

---

## 7. Lo que el parche no hace

- **No rellena** `consultation.procesos`: sigue con 0 filas y sin tabla de origen en
  el legado. Decidir de dónde sale cada consulta es otro análisis.
- **No toca** las otras columnas de texto de esa tabla (`fase_actual`, `estado`,
  `pueblo_indigena`): no son niveles cerrados y no hay catálogo al que apuntarlas.
  Forzarlas sería inventar el vocabulario.
- **No cambia** el número de tablas ni de columnas del modelo: 255 tablas lógicas y
  2 036 columnas siguen siendo las mismas.

---

## 8. Referencias

1. `docs/PARCHE_13_CLASIFICACION.sql` — el entregable.
2. `docs/parches/P12_COMENTARIOS.md` — el parche que escribió los comentarios, ahora
   con la redacción canónica.
3. `docs/DICCIONARIO_DATOS.md` — el diccionario regenerado.
4. `docs/AVISA_PRODUCE_v10.md` — el diseño; §3.3.bis trata la clasificación de la
   información.
5. Ley N.° 29733 y su Reglamento (D.S. N.° 003-2013-JUS) — niveles de seguridad y
   tratamiento de datos personales.
