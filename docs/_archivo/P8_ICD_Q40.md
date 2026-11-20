# P8 — ICD: tope de ±10 puntos del ajuste automático (Q40)

**Estado:** aplicado y verificado en la base viva el **2026-11-18**.
**Entorno:** contenedor `avisa-db`, PostgreSQL 16.14, PostGIS 3.7.0, base `avisa`, rol `avisa`.
**Archivo SQL:** `docs/PARCHE_8_ICD_TOPE_Q40.sql` (idempotente; ejecutado 3 veces sin cambios adicionales).

---

## 1. Qué se decide y de dónde sale

| Documento                                     | Qué fija                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mvp.md` §4.1 K5                              | ICD 0–100 a partir de seis condiciones con evidencia obligatoria, `(suma ÷ 24) × 100`, **más un ajuste automático acotado a ±10 puntos y mostrado aparte, rotulado PROXY** |
| `AVISA_PRODUCE_v10.md` §8.4.ter (línea ~4113) | El ajuste automático queda **acotado a ±10** y se muestra como línea aparte («ICD del analista» y «ajuste automático»), nunca mezclado                                     |
| `AVISA_PRODUCE_v10.md` §18.ter, Q40           | Pide validar el tope; valor por defecto declarado: **se aplica el tope y se rotula «PROXY»**                                                                               |
| `docs/INDICE.md` §5                           | El tope se aplicó el 2026-11-18; queda pendiente la **confirmación formal** de la Dirección OAIPCS, no la implementación                                                   |

Hasta este parche, Q40 solo existía en prosa: no había columna, tabla ni función de ICD en la base. Este parche implementa el valor por defecto de Q40, no la confirmación de la Dirección: por eso el tope es un **parámetro** y no una constante.

---

## 2. Cambios aplicados

### 2.1 `config.parametro` — una fila nueva

| Columna                        | Valor                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `codigo`                       | `ICD.ajuste_tope_puntos`                                                               |
| `valor`                        | `10` (jsonb numérico, no la cadena `"10"`)                                             |
| `tipo`                         | `numero`                                                                               |
| `unidad`                       | `puntos`                                                                               |
| `descripcion`                  | `Q40: tope absoluto del ajuste automático del ICD; se muestra aparte y rotulado PROXY` |
| `valid_to`                     | `NULL` (vigente)                                                                       |
| `aprobado_por` / `aprobado_en` | `NULL` — la aprobación formal corresponde a la Dirección OAIPCS (Q40)                  |

La tabla no tenía UNIQUE sobre `codigo`; el índice único es **parcial** (`ux_parametro_vigente`, `WHERE valid_to IS NULL`). El INSERT usa por eso `ON CONFLICT (codigo) WHERE valid_to IS NULL DO NOTHING`, que es la única forma de que la idempotencia sea real sin bloquear versiones históricas del parámetro.

### 2.2 `core.icd_aplicar_ajuste(p_base numeric, p_ajuste numeric)`

Devuelve una fila con cinco columnas, con los dos números siempre separados:

| Columna            | Significado                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `icd_analista`     | el ICD que calculó el analista, tal como entra (`p_base`), sin tocar |
| `ajuste_propuesto` | lo que propuso la máquina, tal como llega (puede ser NULL)           |
| `ajuste_aplicado`  | el ajuste después del recorte a `[-tope, +tope]`                     |
| `ajuste_recortado` | `true` si hubo recorte                                               |
| `icd_final`        | `greatest(0, least(100, icd_analista + ajuste_aplicado))`            |

Reglas de comportamiento:

- El tope se **lee en cada llamada** de `config.parametro` (`codigo = 'ICD.ajuste_tope_puntos'` y `valid_to IS NULL`); no está codificado.
- Si falta la fila del parámetro: excepción `P0002` («no_data_found») con `HINT` que remite a este parche.
- Si `p_base` es NULL: excepción `22004` («null_value_not_allowed»). No se inventa un ICD.
- Si `p_ajuste` es NULL: `ajuste_aplicado = 0`, `ajuste_recortado = false`.
- Si el tope leído es negativo o no numérico: excepción `22023` (`invalid_parameter_value`).
- `COMMENT ON FUNCTION` cita Q40, `v10` §18.ter, §8.4.ter y `mvp.md` K5.

---

## 3. Casos demostrados (resultados reales de la base)

Ejecutado con `SELECT ... FROM (VALUES ...) AS v CROSS JOIN LATERAL core.icd_aplicar_ajuste(v.base, v.ajuste) a`:

| #   | Caso                   | `icd_analista` | `ajuste_propuesto` | `ajuste_aplicado` | `ajuste_recortado` | `icd_final` |
| --- | ---------------------- | -------------- | ------------------ | ----------------- | ------------------ | ----------- |
| 1   | +15 se recorta a +10   | 70             | 15                 | **10**            | **true**           | 80          |
| 2   | −3 queda tal cual      | 70             | −3                 | **−3**            | false              | 67          |
| 3   | 95 + 10, tope superior | 95             | 10                 | 10                | false              | **100**     |
| 4   | 5 − 10, tope inferior  | 5              | −10                | −10               | false              | **0**       |
| 5   | ajuste NULL cuenta 0   | 70             | NULL               | **0**             | false              | 70          |

Bordes del recorte, con base 60:

| `ajuste_propuesto` | Caso                       | `ajuste_aplicado` | `ajuste_recortado` | `icd_final` |
| ------------------ | -------------------------- | ----------------- | ------------------ | ----------- |
| 11                 | excede por arriba          | 10                | **true**           | 70          |
| 10                 | justo en el borde superior | 10                | false              | 70          |
| 0                  | sin ajuste                 | 0                 | false              | 60          |
| −10                | justo en el borde inferior | −10               | false              | 50          |
| −11                | excede por abajo           | −10               | **true**           | 50          |

Ejemplo con el valor del documento (K5: 2+2+1+2+3+1 = 11 → 45,8) y un ajuste de +12:

```
 icd_analista | ajuste_propuesto | ajuste_aplicado | ajuste_recortado | icd_final
--------------+------------------+-----------------+------------------+-----------
         45.8 |               12 |              10 | t                |      55.8
```

Ese es exactamente el uso previsto: la interfaz muestra «ICD del analista 45,8», «ajuste automático +10 (PROXY, recortado de +12)» y «ICD final 55,8».

---

## 4. Verificaciones ejecutadas

| Verificación                                | Consulta                                                                         | Resultado real                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parámetro vigente                           | `SELECT ... WHERE codigo = 'ICD.ajuste_tope_puntos' AND valid_to IS NULL`        | 1 fila, `valor = 10`, `tipo = numero`, `unidad = puntos`, `valid_to NULL`, `valor_es_10 = true`                                                                                    |
| Firma y comentario                          | `pg_proc` + `obj_description`                                                    | `core.icd_aplicar_ajuste(p_base numeric, p_ajuste numeric)` → `TABLE(…)` con las cinco columnas; comentario presente citando Q40                                                   |
| Parámetros vigentes en total                | `count(*) FROM config.parametro WHERE valid_to IS NULL`                          | 16 → **17** (16 previos + 1)                                                                                                                                                       |
| Idempotencia                                | 2.ª y 3.ª ejecución del archivo                                                  | `INSERT 0 0`, `CREATE OR REPLACE`, `filas_vigentes = 1`                                                                                                                            |
| No hay valor incrustado (estático)          | `pg_get_functiondef` cita `ICD.ajuste_tope_puntos`                               | `lee_parametro = true`, 2 menciones (el SELECT y el texto de la excepción)                                                                                                         |
| El tope sigue al parámetro (comportamiento) | En transacción desechable, `valor := 3`, luego `core.icd_aplicar_ajuste(70, 15)` | `ajuste_aplicado = 3`, `recortado = true`, `icd_final = 73`; tras `ROLLBACK`, el parámetro vuelve a **10**                                                                         |
| `p_base` NULL                               | `DO` con manejador de excepción                                                  | `NOTICE: OK 3.5: p_base NULL lanza SQLSTATE 22004 — ICD: la base del analista (p_base) es obligatoria; no se sustituye por un valor inventado`                                     |
| Falta el parámetro                          | Revisión del cuerpo de la función                                                | Rama `IF NOT FOUND` → `RAISE EXCEPTION ... ERRCODE = 'no_data_found'` con `HINT` al parche. No se probó borrando la fila real para no exponer la base a una caída de configuración |

La prueba de comportamiento (cambiar el parámetro a 3 y ver que recorta a 3) es la que demuestra que el tope no está hardcodeado; un análisis textual de literales no serviría, porque el mensaje de la excepción también contiene el número 10.

---

## 5. Cómo se consume

```sql
SELECT icd_analista, ajuste_propuesto, ajuste_aplicado, ajuste_recortado, icd_final
FROM core.icd_aplicar_ajuste(45.8, 12.0);
```

La función no persiste nada. Queda para el frente de evaluación:

- guardar en `core.evaluacion_riesgo` (o su equivalente) el par `icd_analista` / `ajuste_aplicado` con el rótulo PROXY, de modo que la traza conserve ambos números;
- sembrar la prueba del anexo v10 (§22.3.ter) que recalcule los casos de este informe.

---

## 6. Lo que este parche no hace

- No crea tablas ni vistas de ICD: el ICD se calcula, no se almacena aquí.
- No calcula el ajuste automático: solo lo acota y hace explícito el recorte.
- No toca `config.guardrail_contract` (frente del parche 7) ni tablas de actores.
- No fija la aprobación del parámetro: `aprobado_por` y `aprobado_en` quedan NULL hasta que la Dirección OAIPCS cierre Q40. Si el valor aprobado fuera otro, se sustituye la fila del parámetro (nueva vigencia con `supersedes_id`); la función no se toca.

---

## 7. Rollback

```sql
BEGIN;
  DROP FUNCTION IF EXISTS core.icd_aplicar_ajuste(numeric, numeric);
  DELETE FROM config.parametro
   WHERE codigo = 'ICD.ajuste_tope_puntos'
     AND descripcion LIKE 'Q40:%';
COMMIT;
```

El `DROP` es seguro: la función no está referenciada por triggers ni vistas. El `DELETE` se acota por descripción para no borrar una fila que ya existiera con otro origen (caso en el que el parche solo emite un `WARNING`).
