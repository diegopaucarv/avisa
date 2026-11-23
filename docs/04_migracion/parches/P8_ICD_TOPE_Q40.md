# P8 — ICD: tope de ±10 puntos del ajuste automático (Q40)

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** `mvp.md` §4.1, K5 (ICD de 0 a 100 con seis condiciones y evidencia, más un ajuste automático acotado y mostrado aparte); `AVISA_PRODUCE_v10.md` §8.4.ter (decisión v10 sobre K5) y §18.ter, Q40
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_8_ICD_TOPE_Q40.sql` (idempotente, montado como `98_patch_08.sql` en `compose.yaml`, bloque `B.3` del unificado)
**Estado:** **aplicado y verificado en la base viva el 2026-11-21.**

Sustituye, como documento vivo, al informe archivado `docs/_archivo/P8_ICD_Q40.md`,
que `docs/README.md` §2 da por archivado el 2026-11-20 y anuncia «en el informe
posterior»: este. Aquel fechó la aplicación el 2026-11-18; hoy se midió sin escribir.

---

## 1. Resumen

Q40 existía solo en prosa: «se acepta el tope de ±10 puntos para el ajuste
automático del ICD». El parche la convierte en dos piezas ejecutables: siembra en
`config.parametro` la fila `ICD.ajuste_tope_puntos` (valor `10`, `tipo` `numero`,
`unidad` `puntos`) y crea `core.icd_aplicar_ajuste(p_base, p_ajuste)`, que devuelve
en una sola fila el ICD del analista, el ajuste propuesto, el ajuste aplicado, si
hubo recorte y el ICD final, sin mezclar los dos números.

| Dato                                      | Antes (fuente)              |            Después |
| ----------------------------------------- | --------------------------- | -----------------: |
| Parámetros vigentes en `config.parametro` | 16 (comentario del SQL)     |             **17** |
| Filas con código `ICD.*`                  | 0 (comentario del SQL)      |              **1** |
| Funciones `core.icd_aplicar_ajuste`       | 0 (comentario del SQL)      |              **1** |
| Tablas que persisten el ICD               | 0 (comentario del SQL)      | **0** (sin cambio) |
| Líneas del bloque `B.3` del unificado     | —                           |            **331** |
| Tope del ajuste automático                | no era un dato (solo prosa) |      **10 puntos** |

Los «16» y los «0» no son medibles hoy: el parche ya está aplicado (los 17
parámetros vigentes son los 17 totales). Se citan del SQL, cuyo bloque 0.3 dice «16
antes del parche, 17 después» y cuyos bloques 0.1 y 0.2 parten de 0 filas.

Lo que el parche **no** hace: no calcula el ajuste automático (solo lo acota) y no
persiste ningún ICD. El ICD del analista sigue siendo `(suma ÷ 24) × 100` sobre las
seis condiciones con evidencia (`mvp.md` K5). Tampoco toca guardrails ni actores.

---

## 2. Qué cambia

| Objeto                                                          | Tipo                                             | Qué hace                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `config.parametro` (`ICD.ajuste_tope_puntos`)                   | fila nueva (`INSERT … ON CONFLICT … DO NOTHING`) | Siembra el tope `10`, `tipo` `numero`, `unidad` `puntos` y la descripción de Q40.                         |
| bloque `DO` de control de divergencia                           | control en la transacción (bloque 1.1)           | Aborta si no quedó fila vigente y avisa con `WARNING` si el valor existente no es 10, sin sobrescribirlo. |
| `core.icd_aplicar_ajuste(p_base numeric, p_ajuste numeric)`     | función `plpgsql` `STABLE`                       | Devuelve cinco columnas con los dos números separados y acota el ajuste al tope leído. No escribe.        |
| `COMMENT ON FUNCTION core.icd_aplicar_ajuste(numeric, numeric)` | comentario de catálogo                           | Deja constancia de Q40, de §18.ter, de §8.4.ter y de `mvp.md` K5.                                         |

El cuerpo va entre `BEGIN` y `COMMIT` (líneas 73 y 193); el bloque 0 de
comprobaciones previas corre **antes**, para no abrir una transacción en falso.

---

## 3. Por qué, decisión por decisión

### 3.1 El tope es un parámetro, no una constante

La decisión Q40 corresponde a la Dirección OAIPCS, así que el tope no vive en el
cuerpo de la función: se lee de `config.parametro` en cada llamada y, si el valor
confirmado fuera otro, basta cambiar la fila. `pg_get_functiondef` cita
`ICD.ajuste_tope_puntos` dos veces (el `SELECT` y el texto de la excepción) y el
cuerpo no contiene `INSERT`, `UPDATE` ni `DELETE`. El precio es que la función
depende de una fila de configuración; por eso falla con `P0002` si no existe.

### 3.2 Los dos números nunca se mezclan

`icd_analista` es `p_base` tal como entra; `ajuste_propuesto` es lo que propuso la
máquina; `ajuste_aplicado` es ese ajuste tras el recorte a `[-tope, +tope]`;
`ajuste_recortado` dice si hubo recorte; e `icd_final` es
`greatest(0, least(100, icd_analista + ajuste_aplicado))`, la suma acotada. Así se
muestran «ICD del analista» y «ajuste automático» en líneas distintas, con PROXY en
la segunda. `icd_final` no es «el ICD», sino solo esa suma saneada.

### 3.3 No se persiste el ICD, porque no hay dónde

No se crea tabla ni vista de ICD: no existe ninguna relación con «icd» en el nombre
en ningún esquema, y `analisis` tiene cuatro relaciones (`cat_herramientas`, `plan`,
`plan_paso`, `punto_ingesta`), ninguna de evaluación de riesgo. K5 sigue «Parcial»
porque «hoy no hay dónde guardarlo». La función calcula; no registra.

### 3.4 Errores explícitos antes que valores inventados

- `p_base` nulo: excepción `22004` con `HINT` a las seis condiciones y su evidencia.
- Falta el parámetro: excepción `P0002` con `HINT` que remite a este parche.
- Tope negativo: excepción `22023`.
- `p_ajuste` nulo: se cuenta como 0 y `ajuste_recortado = false`.
- `icd_final` siempre se satura a 0–100, aunque el ajuste no se haya recortado.

### 3.5 Idempotencia real, no aparente

`config.parametro` no tiene unicidad sobre `codigo` a secas: tiene el índice único
**parcial** `ux_parametro_vigente`, sobre `(codigo) WHERE valid_to IS NULL`. Por eso
el `INSERT` usa `ON CONFLICT (codigo) WHERE valid_to IS NULL DO NOTHING`, y la
función se reemplaza con `CREATE OR REPLACE`. Re-ejecutar no acumula nada.

---

## 4. Migración de datos

| Concepto                                        | Valor medido hoy                |
| ----------------------------------------------- | ------------------------------- |
| Filas insertadas en `config.parametro`          | **1**                           |
| Filas actualizadas / borradas                   | **0 / 0**                       |
| `valid_from` de la fila                         | `2026-11-18 04:41:47.836625-05` |
| `valid_to`                                      | `NULL` (vigente)                |
| `aprobado_por` / `aprobado_en`                  | `NULL` / `NULL`                 |
| Parámetros vigentes / en total                  | **17 / 17**                     |
| Filas de datos tocadas en `core` u otro esquema | **0**                           |

Ninguna otra tabla se escribe. La fila del parámetro es el único cambio persistente
y la función, el único objeto nuevo; los 17 vigentes de 17 totales indican que el
versionado (`valid_to`, `supersedes_id`) está sin estrenar. El parche **no se
re-ejecutó** aquí (sesión de solo lectura): la segunda pasada no se midió hoy; el
informe archivado registró `INSERT 0 0` en la 2.ª y 3.ª.

---

## 5. Verificación con cifras medidas

Consultas en solo lectura con el rol `avisa`: `MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -At -F'|' -c "…"`.

### 5.1 El parámetro

| Columna                        | Valor medido                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `codigo`                       | `ICD.ajuste_tope_puntos`                                                               |
| `valor` (`jsonb_typeof`)       | `10` (`number`, no la cadena `"10"`)                                                   |
| `tipo` / `unidad`              | `numero` / `puntos`                                                                    |
| `descripcion`                  | `Q40: tope absoluto del ajuste automático del ICD; se muestra aparte y rotulado PROXY` |
| `valid_from` / `valid_to`      | `2026-11-18 04:41:47.836625-05` / `NULL`                                               |
| `aprobado_por` / `aprobado_en` | `NULL` / `NULL`                                                                        |

PostgreSQL no admite `COMMENT ON` sobre una **fila**: ese papel lo cumple
`descripcion`; la tabla sí tiene comentario («Parámetro operativo con su valor vigente, unidad y norma de origen…»).

### 5.2 Firma, volatilidad y comentario

```
core.icd_aplicar_ajuste(p_base numeric, p_ajuste numeric)
→ TABLE(icd_analista numeric, ajuste_propuesto numeric, ajuste_aplicado numeric,
        ajuste_recortado boolean, icd_final numeric)
provolatile = s (STABLE) · prosecdef = f · lenguaje = plpgsql
```

`s` es `STABLE`, `prosecdef = f` («no es `SECURITY DEFINER`») y el cuerpo no contiene
`INSERT`, `UPDATE` ni `DELETE`: se pudo llamar sin riesgo. El comentario del objeto
acota el ajuste «al tope vigente en config.parametro (codigo = 'ICD.ajuste_tope_puntos',
hoy 10)» y devuelve «ICD del analista y ajuste aplicado en columnas separadas».

### 5.3 Las llamadas, con su salida literal

Salida de `psql -At -F'|'`; la primera columna es la etiqueta que puso la consulta,
no un campo de la función, y la línea de cabecera se añadió para leerla:

```
# caso | icd_analista | ajuste_propuesto | ajuste_aplicado | ajuste_recortado | icd_final
(70,15)|70|15|10|t|80
(70,-15)|70|-15|-10|t|60
(70,5)|70|5|5|f|75
(70,-3)|70|-3|-3|f|67
(95,10)|95|10|10|f|100
(5,-10)|5|-10|-10|f|0
(70,NULL)|70||0|f|70
```

El recorte ocurre en los dos primeros casos y solo en ellos: `+15` pasa a `+10` y
`−15` pasa a `−10`.

### 5.4 Bordes y valores fuera de rango

| Caso       | `p_base` | `p_ajuste` | `ajuste_recortado` | `icd_final` | Lectura                                                       |
| ---------- | -------- | ---------- | ------------------ | ----------- | ------------------------------------------------------------- |
| `(100, 5)` | 100      | 5          | false              | **100**     | el total se satura sin marcar recorte                         |
| `(98, 10)` | 98       | 10         | false              | **100**     | satura por encima del borde superior                          |
| `(0, −5)`  | 0        | −5         | false              | **0**       | saturación en el borde inferior                               |
| `(120, 0)` | 120      | 0          | false              | **100**     | `p_base` no se valida: entra 120 y `icd_analista` lo conserva |
| `(−5, 0)`  | −5       | 0          | false              | **0**       | ídem por abajo                                                |

`ajuste_recortado` mide el recorte del **ajuste**, no la saturación del **total**: por eso
`(100, 5)` da `false` con `icd_final = 100`; quien satura es `greatest(0, least(100, …))`.
El caso de `p_base` nulo, capturado en un bloque `DO`:

```
NOTICE:  SQLSTATE 22004 | ICD: la base del analista (p_base) es obligatoria;
         no se sustituye por un valor inventado
```

### 5.5 Que no se persiste

```
SELECT table_schema, table_name FROM information_schema.tables
 WHERE table_name ILIKE '%icd%' OR table_name ILIKE '%evaluacion%';
→ impact|evaluaciones_efectividad      (único resultado; no es una tabla de ICD)

SELECT table_schema, table_name, column_name FROM information_schema.columns
 WHERE column_name ILIKE '%icd%';
→ (sin filas)
```

Tampoco hay relación con «icd» en `pg_class`; las que coinciden con «evaluacion» o
«riesgo» son `analytics.vw_riesgo_sistemico`, `core.cat_niveles_riesgo`,
`core.riesgo_social_ordinal`, `impact.evaluaciones_efectividad` y `legacy.dim_riesgos`.

### 5.6 Lo que no se pudo medir aquí

- **El tope sigue al parámetro.** El bloque 3.7 lo prueba cambiando la fila a `3`: `+15`
  se recortaría a `+3`. Es escritura y la sesión fue de solo lectura: **no se ejecutó**.
- **La rama `P0002`** no se probó borrando la fila real; el informe archivado tampoco.
- **Idempotencia medida**: no se remidió hoy (§4).

---

## 6. Riesgos y lo que queda abierto

**1. Falta la confirmación formal de la Dirección.** Q40 se aplicó el 2026-11-18 (v10
§18.ter), pero `aprobado_por` y `aprobado_en` están en `NULL` (medido hoy): esa firma
—no el valor— mantiene abierta la decisión.

**2. No hay dónde persistir el ICD.** Brecha de K5 que el parche no cierra, por
diseño. Las salidas posibles (tabla de evaluación, o `ind.seleccion` +
`ind.resultado` por caso y período) no están decididas ni creadas.

**3. `p_base` no se valida contra 0–100.** Solo se sanea `icd_final`: `(120, 0)` da
`icd_analista = 120` con `icd_final = 100`, y `(−5, 0)` da `−5` con `0`. Un consumidor
que muestre `icd_analista` sin acotar mostrará un ICD imposible.

**4. Cambiar el tope no versiona por sí solo.** Cerrar la fila anterior con `valid_to`
y `supersedes_id` es el diseño, pero no hay procedimiento que lo haga; la prueba 3.7
del propio SQL cambia el valor con `UPDATE`. Los 17 vigentes de 17 lo confirman.

**5. `icd_final` puede leerse como «el ICD».** La función separa los números, pero la
interfaz decide; la mitigación es de presentación, no de esquema.

**6. La referencia del SQL está desactualizada.** La cabecera remite a `docs/README.md`
§5 para Q40, y esa sección es de curaduría documental. Se detalla en §7.

---

## 7. Frases de otros documentos que quedan desactualizadas

«Viejo» es el texto que hay hoy; «nuevo», lo que debe decir. No se editó ninguno.

| Documento y sección                                    | Dice (viejo)                                                                                | Debe decir (nuevo)                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PARCHE_8_ICD_TOPE_Q40.sql`, cabecera (línea 29)  | «(Q40 sigue abierta en `docs/README.md` §5)»                                                | «Q40 se aplicó el 2026-11-18; queda pendiente la confirmación formal de la Dirección OAIPCS (`aprobado_por` y `aprobado_en` siguen nulos). Véase `AVISA_PRODUCE_v10.md` §18.ter.» |
| `docs/03_ejecucion/mvp.md` §7.2, fila Q40 (línea 1520) | «Tope de ±10 puntos … Valor por defecto si no llega: Se aplica el tope y se rotula «PROXY»» | Conservar la fila y poner en la última columna: «Ya aplicado el 2026-11-18: `ICD.ajuste_tope_puntos` = 10; falta la confirmación formal de la Dirección OAIPCS».                  |

Lo que **no** hay que cambiar:

- `docs/02_arquitectura/AVISA_PRODUCE_v10.md` §8.4.ter y §18.ter ya describen
  función, parámetro y firma pendiente.
- `docs/05_datos/BRECHA_CAPA_DATOS_V9.md` §14, fila del parche 8, es correcta.
- `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md` no menciona el ICD (verificado por
  búsqueda de «ICD» y «ajuste automático»): nada que corregir.
- `docs/_archivo/P8_ICD_Q40.md` sigue archivado; este informe es su sucesor, como
  anuncia el README. Y `docs/README.md` lo actualiza el responsable documental.
