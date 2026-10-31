# Cierre de decisiones para la carga del legado AVISA 2026 → v9

**Fecha:** 2026-10-31
**Estado:** todos los bloqueos cerrados. **No queda ningún TBD.**
**Compañía de:**

- `docs/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` — diagnóstico de las 86 hojas
- `docs/MAPA_CARGA_LEGADO_A_V9.md` — mapa por dominio, decisiones D1–D22
- `docs/PLAN_PORTE_LEGADO_V9.md` — especificación de carga, D23–D42
- `docs/PREPARACION_V9_CARGA_LEGADO.sql` (parche 1) · `…_2.sql` (parche 2) · `…_3.sql` (parche 3, nuevo)
- `migration/decisions.py` (reglas ejecutables) · `migration/test_decisions.py` (**122 comprobaciones, 0 fallos**)

**Este documento manda.** Donde contradice al plan anterior, la contradicción está
marcada con ⚠ y explicada con la evidencia que la sostiene.

---

## 0. Resumen

Al especificar la carga columna por columna aparecieron **seis bloqueos nuevos**
que el plan anterior no veía, y **cinco de sus afirmaciones resultaron falsas**.
Todos están cerrados:

| #       | Bloqueo nuevo                                                | Efecto si no se cerraba                   | Cierre                                                       |
| ------- | ------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| **D43** | 45 DNI compartidos por 100 filas contra un índice `UNIQUE`   | La carga **aborta** en la 2.ª aparición   | Índice único → índice normal + cola de revisión              |
| **D44** | `DIM_Demandas.ID_ALERTA` no sólo contiene alertas            | 12 demandas con padre inventado o perdido | Reclasificado; `documento_origen_id` + `codigo_padre_legado` |
| **D45** | `tipo_actor_id` por defecto = 1 (_Actor del Estado_)         | 586 personas reales mal clasificadas      | Default = 2 (Actor Sociedad Civil)                           |
| **D46** | 8 de 9 participantes sin `ID_Capacitacion`                   | Se perdían 8 de 9 participantes           | Único candidato posible → `CAP-2026-001`                     |
| **D47** | 2 alertas sin `ID_NIVEL_ALERTA` pero `prioridad_id` NOT NULL | Alertas no cargan                         | `prioridad_id` relajado a NULL                               |
| **D48** | Caso sin `ID_Riesgos` con `nivel_riesgo_id` NOT NULL         | Caso 016 no carga                         | Derivado de sus propias alertas (dato del legado)            |

Y las correcciones a los documentos anteriores:

| #   | Antes se decía                                                | La realidad                                                                                                                                    | Origen                         |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| C1  | 27 "unidades orgánicas" ≠ 66 "áreas" (dos niveles)            | Son **las mismas 27** con la misma sigla                                                                                                       | Inspección 1:1                 |
| C2  | `entidades` = 1 fila                                          | **23** (`E-001`..`E-023`)                                                                                                                      | `DIM_Entidad_Responsable`      |
| C3  | `cat_especies` tiene 10 filas sembradas                       | **5** (ids 11–15)                                                                                                                              | Semilla v9                     |
| C4  | `cat_tipos_actor` está vacía                                  | 7 filas: 1–3 del legado + NEC/CITES/CITE/SANIPES                                                                                               | Semilla v9                     |
| C5  | 9 tablas con `FORCE ROW LEVEL SECURITY`                       | **11**, con nombres                                                                                                                            | `pg_class.relforcerowsecurity` |
| C6  | `DIM_Provincias.Cod_INEI` "ya son 4 dígitos" (y distritos, 6) | Vienen **sin ceros a la izquierda**: 28 de 70 provincias tienen 3 dígitos y 307 de 698 distritos tienen 5 → hace falta `zfill(4)` / `zfill(6)` | Datos reales                   |

> **C6 es el hallazgo más peligroso del cierre.** Sin el padding, `provincias.ubigeo`
> (`'101'`) y el prefijo de `distritos.ubigeo` (`'0101'`) no coinciden, y las 698
> filas quedan sin provincia. La regla de región (`ubigeo[:2]`) también depende de ello.

---

## 1. Doctrina: cómo se decide, no sólo qué se decide

Antes de las decisiones, el criterio. Sin él, cada caso se resuelve por opinión.
Hay cuatro niveles, y **siempre se usa el más alto posible**:

| Nivel                                   | Regla                                                                                              | Etiqueta en la fila                                                  | `confidence` |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| **1. Dato directo**                     | Existe en el legado                                                                                | `origen_dato='AVISA_HISTORICO'`, `es_validado_humano=true`           | 1.00         |
| **2. Derivado de otro dato del legado** | No está en la fila, pero sí en una fila relacionada (p. ej. riesgo tomado de las alertas del caso) | `origen_dato='AVISA_HISTORICO'`                                      | 0.90         |
| **3. Inferencia estructural**           | Sólo si el origen no tiene el dato y existe una regla verificable (ordinal de `FACT_Casos`)        | `es_validado_humano=false` + entrada en `core.migracion_conflicto`   | 0.50–0.80    |
| **4. Relajación de esquema**            | Ninguna fuente y v9 puede tolerar NULL                                                             | `NULL`; `confidence` queda NULL y la fila va a `migracion_conflicto` | —            |

**Lo que nunca se hace:** inventar un valor para satisfacer un `NOT NULL`. Si el
esquema no tolera NULL y no hay fuente, se **relaja el esquema** (parches 1 y 3),
salvo que exista una fuente autoritativa externa (única excepción: D26, la unidad
OAIPCS, documentada en `docs/AVISA_PRODUCE_v9(1).md`).

**Corolario operativo:** todo lo que no resuelve va a `core.migracion_conflicto`
(parche 3), no a un log perdido. El dato entra marcado y con puntero para revisión
humana.

---

## 2. Las decisiones a–h, cerradas

### (a) Todas las columnas del legado entran o se declaran descartadas

**Cerrada.** Ninguna columna se pierde por omisión:

1. **Parches 1 + 2 + 3** añaden a v9 las columnas que faltaban (`codigo_legado` en 22 tablas, `tipo_evidencia_legado`, `link_evidencia`, `distrito_id`, `sectorista_usuario_id`, `documento_origen_id` y `codigo_padre_legado` en `demandas`, etc.).
2. **Fase 0 del cargador**: cada hoja se copia íntegra a `legacy.<hoja>`, todas las columnas `TEXT`, con `fila_n` ordinal, **mapeando por posición y nunca por nombre** (D21: el staging es la única fuente reproducible).
3. Las columnas que no tienen destino se listan explícitamente en §4.11 del plan y quedan sólo en `legacy.*`.

> ⚠ Ejemplo concreto que pediste: `demandas.descripcion_demanda` es `TEXT` NULL y
> recibe el texto íntegro; `problema_3p` y `pedido_3p` (NOT NULL en v9) se
> relajaron porque el legado **no tiene** estructura 3P. No se fabrica.

---

### (b) `core.casos.nivel_conflicto_id` → NULL

**Cerrada y aplicada** (parche 1, `ALTER COLUMN … DROP NOT NULL`).

Cobertura real: **34/35**. Sólo `CS-PRODUCE-2026-024` no tiene `ID_Tipo` → NULL.
No se deriva de `ID_Riesgos` ni de `ID_NIVEL_ALERTA`: son ejes distintos
(probabilidad de escalamiento y SLA de respuesta).

---

### (c) Tablas no modeladas: capacitaciones, login, intervención

**Cerrada.** Tres tablas nuevas + dos catálogos:

| Hoja legada                       | Filas | Destino v9                                                |
| --------------------------------- | ----: | --------------------------------------------------------- |
| `DIM_Capacitaciones`              |     1 | `core.capacitaciones` (+ `cat_tipos_capacitacion`)        |
| `BRIDGE_Capacitacion_Participant` |     9 | `core.capacitacion_participantes` — **9, no 1** (ver D46) |
| `LOG_Accesos`                     |   857 | `core.log_accesos`                                        |
| `DIM_Intervencion`                |     4 | `core.cat_ciclos_intervencion`                            |
| `DIM_Mesas_Grupos`                |    21 | `core.mesas_dialogo` + `core.mesa_miembros` (62)          |

---

### (d) Colisión #85 — unidades orgánicas

**Cerrada, y la premisa estaba equivocada.** `DIM_Area_Responsable` (66) y
`DIM_Unidades_Organicas_Responsa` (27) **no son dos niveles**: las 27 "unidades"
son las mismas 27 entidades que 27 de las 66 "áreas", con sigla y nombre idénticos.

→ Se insertan **sólo las 66** áreas; la fila de área recibe **ambos** códigos
legados (`codigo_legado_area` y `codigo_legado_unidad`). `padre_id` queda
disponible pero NULL (la jerarquía no existe en el origen y no se inventa).

---

### (e) DNI y teléfonos — se conservan

**Cerrada.** Van a `core.actor_datos_personales`:

| Dato       | Destino                              | Regla                                                                             |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `DNI`      | `dni VARCHAR(12)`                    | **Texto**, con ceros a la izquierda (`'00245199'`). Nunca castear. `'N/D'` → NULL |
| `Telefono` | `telefono_raw` + `telefono_contacto` | raw intacto; E.164 sólo si son 9 dígitos (celular)                                |
| `Email`    | `email`                              |                                                                                   |

`actor_datos_personales` = **847 filas** (747 de `DIM_Actores` + 100 de
`DIM_Actores_Estado`), verificadas.

`base_legal` = `'LEGADO_AVISA_2026'` (ver **D49**), `nivel_clasificacion = 3`.
`fecha_consentimiento` NULL: el legado no tiene consentimiento y no se inventa.

---

### (f) Mesas / grupos de diálogo — tabla nueva

**Cerrada.** `core.mesas_dialogo` + `core.mesa_miembros`.

21 filas, 21 códigos únicos (`OAIPCS-001`…). `tipo_espacio_id` mapea 1:1 contra
`cat_tipos_espacio_dialogo` (7 valores). `naturaleza` sólo admite los 3 valores
que el CHECK de v9 permite y el legado usa exactamente esos 3.

⚠ **D37 corregida**: el plan decía que `FECHA_FIN_VIGENCIA` contenía el literal `'Sin fecha'`
en 2 filas. **No es así**: esa columna tiene 8 NULL y ningún texto. El literal
`'Sin fecha'` está en **`ESTADO_VIGENCIA`** (2 filas) y se copia como texto, no se
castea. El parser de fechas es defensivo igualmente: cualquier valor no-ISO → NULL.

---

### (g) Vínculo alerta ↔ demanda — se conserva

**Cerrada, con la cifra corregida.**

`core.demandas.alerta_id` (FK) conserva el vínculo. Pero **no son 248 vínculos**
(el plan contó los valores no nulos sin validarlos):

| Fuente                                           | Pares válidos |
| ------------------------------------------------ | ------------: |
| `DIM_Demandas.ID_ALERTA` con código `AT-2026-xx` |           236 |
| `BRIDGE_Alerta_Demandas`                         |           231 |
| Intersección                                     |           220 |
| **Unión**                                        |       **247** |
| − pares que apuntan a alertas inexistentes       |           −14 |
| Pares válidos                                    |           233 |
| **Demandas con `alerta_id` asignada**            |       **222** |

Los 11 desacuerdos entre columna y bridge se resuelven **a favor del bridge**
(fuente normalizada). Las 5 alertas fantasma (`AT-2026-19/24/27/34/39`) no
existen en `DIM_Alertas` y no se inventan: los 14 pares que las referencian van a
`core.migracion_conflicto` y la demanda carga sin alerta.

---

### (h) `nivel_conflicto` — no se deriva, se lee

**Cerrada.** La pregunta era si derivarlo de `id_riesgos`/`id_nivel_alerta`,
dejarlo en _Conflicto_social_ por defecto o completarlo caso por caso.

La respuesta correcta es **ninguna de las tres**: el legado **ya tiene la escala**.
`FACT_Casos.ID_Tipo` → `DIM_Tipo_Caso` es exactamente la escala de 4 niveles de la
Guía (RM N.° 00207-2026-PRODUCE):

| Legado  | Texto de la Guía | `cat_niveles_conflicto` |
| ------- | ---------------- | ----------------------- |
| `TC-01` | Diferencias      | 1 `Diferencia`          |
| `TC-02` | Controversias    | 2 `Controversia`        |
| `TC-03` | Conflicto activo | 3 `Conflicto_social`    |
| `TC-04` | Crisis           | 4 `Crisis_social`       |

Distribución real: **TC-02 20, TC-03 13, TC-01 1, sin dato 1**. Cobertura 34/35.

Por qué **no** derivarlo de riesgo/nivel de alerta: son ejes distintos. Empíricamente
la correlación es débil — `NA-001` (máxima prioridad) aparece 20 veces con `RIE-001`
y 7 con `RIE-002`; **2 de los 4 casos `Urgente` son de riesgo `RIE-003` (Bajo)**.
Derivar habría fabricado escalones inexistentes. Es el criterio de máxima
compatibilidad: **el dato normativo se lee, no se estima.**

> Nota de implementación: `DIM_Tipo_Caso` y `DIM_Tipo_Cambio` **reusan** los
> códigos `TC-01..TC-06`. Se namespacean por hoja, jamás por código.

---

## 3. D1–D22 — estado final

| #   | Decisión                                       | Estado final                                                                                                   |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D1  | 33/83 alertas sin caso                         | ✅ `caso_id` NULL. No se inventan casos                                                                        |
| D2  | 225/325 demandas sin caso                      | ✅ `caso_id` NULL + `alerta_id`. Ahora **226** (1 caso es de la serie anterior, D44)                           |
| D3  | 12/35 casos sin distrito                       | ✅ NULL + `region_principal_id` siempre                                                                        |
| D4  | Sin fuente de `unidad_responsable_id`          | ✅ **D26**: unidad OAIPCS real                                                                                 |
| D5  | 1 caso sin `id_riesgos`                        | ⚠ **Sustituida por D48**: se deriva de las alertas, no de `Prioridad`                                          |
| D6  | Escala de `Pct_Avance`                         | ✅ 0.0–0.9 → ×100. Verificado: `{0,70,80,90}`                                                                  |
| D7  | `FACT_Historial_Estado` huérfano               | ✅ No se carga; el trigger `caso_historial()` genera las 35 filas                                              |
| D8  | Qué bridge actor↔caso manda                    | ✅ Ambos son el mismo conjunto: **unión deduplicada** (62 y 45 filas)                                          |
| D9  | Fusionar los dos censos de personas            | ❌ **ANULADA**: son disjuntos. 0 nombres en común y `DNI='N/D'` en 108/108                                     |
| D10 | `Id_organizacion` guarda nombres               | ✅ match por id (11) → nombre exacto (271) → sin vínculo (**378**, a `migracion_conflicto`)                    |
| D11 | Credenciales en claro                          | ✅ No se trasladan. `clave_hash` aleatorio + reseteo forzado                                                   |
| D12 | `nivel_gobierno` basura                        | ✅ NULL (`'Perfil-01'`, `'Sí'`)                                                                                |
| D13 | Hitos sin compromisos                          | ✅ 8 compromisos sintéticos, 12 hitos (todos con `ACC-xxxx` válido)                                            |
| D14 | Titular/alterno en texto libre                 | ✅ `mesa_miembros.nombre_texto`, sin fuzzy                                                                     |
| D15 | Descripciones TEMA-03/04 cruzadas              | ✅ Bruto en `descripcion_legado`, `descripcion` NULL, `nota_calidad`                                           |
| D16 | `tipo_documento='Otro'`                        | ✅ tipo 15 `otro`                                                                                              |
| D17 | `FACT_Proceso_*` sin workflow                  | ✅ Sólo `legacy.*` (135 filas)                                                                                 |
| D18 | RADAR / NODO                                   | ✅ Sólo `legacy.*` (6 filas)                                                                                   |
| D19 | Formatos `CS-2026-07` vs `CS-PRODUCE-2026-007` | ✅ **Confirmada y reforzada**: se comprobó por contenido que NO son el mismo caso. Los cortos se aparcan (D44) |
| D20 | Columna vs bridge de alertas                   | ⚠ **INVERTIDA por D31**: el bridge NO es la única verdad; la columna aporta 16 pares propios                   |
| D21 | ¿Se conserva `legacy.*`?                       | ✅ Sí, es la única fuente reproducible                                                                         |
| D22 | `cat_especies` 37 vs sembradas                 | ⚠ Era 5, no 10. Total final **39** (D25)                                                                       |

---

## 4. D23–D42 — resueltas en firme

| #       | Decisión                                                                   | Resolución final                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D23** | ¿Las refs numéricas de `BRIDGE_Caso_Actor*` son ordinales de `FACT_Casos`? | **Sí, aceptado.** 34/34 caen en `1..35` sin excepción. Recupera 62/80 y 45/61. `confidence=0.75`, `es_validado_humano=false`                                                                                                                                                                                                                                                      |
| **D24** | Fusión de censos                                                           | **No fusionar** (D9 anulada). 828 + 108 = 936 personas distintas                                                                                                                                                                                                                                                                                                                  |
| **D25** | `Trucha` vs `Trucha arcoíris`                                              | **Es la misma especie** (mismo nombre científico `Oncorhynchus mykiss`) → `RECU-025` → id 11. Total **39**                                                                                                                                                                                                                                                                        |
| **D26** | Unidad responsable                                                         | **No se inventa**: `OAIPCS` **ya existe en el legado** como `AR-047` (_Oficina de Articulación Intergubernamental y Prevención de Conflictos Sociales_). El parche 3 la siembra como `id=1` porque el cargador la necesita antes de la fase 3 (unidad del usuario de auditoría); la fase 3 la reconcilia con `codigo_legado_area='AR-047'`. `entidad_id=1`. ⚠ **Total 66, no 67** |
| **D27** | `nivel_riesgo_id` NOT NULL sin origen                                      | ⚠ **Sustituida por D48**: derivar de las alertas del caso (0.90), no de `Prioridad` (0.50)                                                                                                                                                                                                                                                                                        |
| **D28** | DEP-20 / DEP-15+16                                                         | ✅ 25 regiones. DEP-20 fuera; 15+16 fusionadas en INEI `15`                                                                                                                                                                                                                                                                                                                       |
| **D29** | 8 casos con DEP-20                                                         | ✅ Se completan con `BRIDGE_Caso_Depto` → `caso_regiones` (81 pares, 32 principales)                                                                                                                                                                                                                                                                                              |
| **D30** | 2 alertas sin nivel                                                        | ⚠ **Sustituida por D47**: `prioridad_id` → NULL                                                                                                                                                                                                                                                                                                                                   |
| **D31** | Alerta↔demanda                                                             | ✅ Unión **247**, bridge gana en 11. **Corrige D20**                                                                                                                                                                                                                                                                                                                              |
| **D32** | `AT-2026-48/-49` duplicadas y 5 fantasmas                                  | ✅ Sufijo `-bis`; las 5 fantasma no se crean                                                                                                                                                                                                                                                                                                                                      |
| **D33** | `BRIDGE_Caso_Depto` corrido                                                | ✅ Leído por posición: 85/87 válidas, 2 fantasmas descartadas                                                                                                                                                                                                                                                                                                                     |
| **D34** | Columnas de `DIM_Hitos` sin destino                                        | ✅ Añadidas en parche 2                                                                                                                                                                                                                                                                                                                                                           |
| **D35** | 22 entidades externas                                                      | ✅ Cargadas como catálogo; **ninguna** como tenant                                                                                                                                                                                                                                                                                                                                |
| **D36** | `abreviatura` truncaba                                                     | ✅ `VARCHAR(150)`                                                                                                                                                                                                                                                                                                                                                                 |
| **D37** | `'Sin fecha'` en mesas                                                     | ⚠ **Corregida**: el literal está en `ESTADO_VIGENCIA` (2), no en `FECHA_FIN_VIGENCIA`                                                                                                                                                                                                                                                                                             |
| **D38** | `LOG_Envios` corrido                                                       | ✅ Por posición; **hay dos formas de fila**: el mensaje está en `c11` y el resultado en `c13` (filas 1–7) o `c12` (8–17). `url_pdf` no tiene fuente (0 URLs) → NULL                                                                                                                                                                                                               |
| **D39** | `LOG_Accesos` con cuentas de prueba                                        | ✅ Se cargan las 857; `usuario_id=NULL` en las **25 filas** de las 2 cuentas de prueba y en **3 filas** con DNI inexistente (`7626563`×2, `76265630`) → 28 NULL                                                                                                                                                                                                                   |
| **D40** | `Pct_Avance`                                                               | ✅ ×100                                                                                                                                                                                                                                                                                                                                                                           |
| **D41** | Duplicados de ID                                                           | ✅ Sufijar el segundo; no descartar                                                                                                                                                                                                                                                                                                                                               |
| **D42** | `actor_membresia.valid_from`                                               | ✅ `fecha_constitucion` de la org → `fecha_inicio` del caso más antiguo del actor → `NULL` si no consta (**D50**); nunca `CURRENT_DATE`                                                                                                                                                                                                                                           |

---

## 5. Bloqueos nuevos (D43–D49) — con evidencia

### D43 · Los DNI no son únicos, y no siempre son la misma persona

`DIM_Actores` trae **642 DNI con sólo 587 valores distintos**: 45 valores aparecen
en **100 filas**. El parche 1 había creado `UNIQUE (dni)`, que **aborta la carga**.

**No se fusionan.** La evidencia:

| DNI      | Fila A                                | Fila B                              | ¿Misma persona?       |
| -------- | ------------------------------------- | ----------------------------------- | --------------------- |
| 46901273 | `ACT-004` Diego Armando Paiva Jacinto | `ACT-541` Diego Paico Seminario     | **No**                |
| 41350598 | `ACT-053` Roger Ruiz Eche             | `ACT-097` Ruiz Eche Rogger Bernardo | Sí (nombre invertido) |
| 77379715 | `ACT-031` Ronal Paul Cornejo Palma    | `ACT-523` Ronald Cornejo Palmo      | Sí (typo)             |

Fusionar por DNI colapsaría personas distintas. → `ux_actor_dni` pasa a índice
**no único**; los 45 grupos van a `core.migracion_conflicto` (`DNI_DUPLICADO`) con
la forma "probable_duplicado" o "probable_error_de_digito" según similitud de nombre.

### D44 · `DIM_Demandas.ID_ALERTA` no contiene sólo alertas

Valores reales de esa columna en las 325 demandas:

| Contenido          | Filas | Destino                                               |
| ------------------ | ----: | ----------------------------------------------------- |
| `AT-2026-xx`       |   236 | `alerta_id`                                           |
| `RR-2026-01`       |     5 | `documento_origen_id` (reporte rápido → `documentos`) |
| `CS-2026-xx`       |     6 | `codigo_padre_legado` (no resuelve)                   |
| `TEMA-03` (basura) |     1 | `codigo_padre_legado`                                 |
| vacío              |    77 | —                                                     |

**No se fuerza el match** `CS-2026-02` → `CS-PRODUCE-2026-002`. Se comprobó por
contenido: `CS-2026-02` agrupa demandas sobre **DPA Chancay / DPA Huacho**,
mientras que `CS-PRODUCE-2026-002` es _"Rehabilitación del Desembarcadero de Los
Órganos"_. Son series distintas (D19). Las 12 filas se conservan con su código
crudo.

Hallazgo adicional: `BRIDGE_Caso_Demandas` (12 filas) es **redundante** con esta
columna — nombra exactamente el mismo padre. No aporta vínculos nuevos.

### D45 · `tipo_actor_id` por defecto: 2, no 1

`actores.tipo_actor_id` es **NOT NULL**. El plan proponía 1 para los valores
vacíos. En v9, `cat_tipos_actor` es:

`1 Actor del Estado · 2 Actor Sociedad Civil · 3 Actor Privado · 4 NEC · 5 Exportador CITES · 6 CITE · 7 SANIPES`

Y la distribución del legado es: `Tipo-Act-02` **233**, `Tipo-Act-03` 9,
vacío **575**, basura (`'Regional'`, `'Sí'`) 11. El **92 %** de los tipados es
Sociedad Civil y la población es de pescadores y dirigentes.

→ Default = **2**. Resultado: `{2: 819, 3: 9}`. Etiquetar 586 pescadores y dirigentes como
_Actor del Estado_ habría sido una afirmación falsa.

El censo `DIM_Actores_Estado` (108 funcionarios) sí va a **1**, fijo.

### D46 · Participantes de capacitación: 9, no 1

`BRIDGE_Capacitacion_Participant` tiene 9 filas pero `ID_Capacitacion` sólo está
presente en **1**. El plan cargaba 1 participante y perdía 8.

**Pero `DIM_Capacitaciones` tiene exactamente 1 fila** (`CAP-2026-001`). Con un
único candidato posible, la asignación no es una suposición: es la única solución
posible. → **9 participantes** en `CAP-2026-001`, `confidence=0.90`.

### D47 · 2 alertas sin prioridad

`AT-2026-59` y `AT-2026-80` no tienen `ID_NIVEL_ALERTA`, y `prioridad_id` era
NOT NULL. Ambas sí traen `ID_Riesgos = RIE-001`, pero la correlación
nivel↔riesgo es débil (`NA-001` aparece con `RIE-001` 20 veces y con `RIE-002` 7).

→ `prioridad_id` **relajado a NULL** (parche 3). El único consumidor es
`core.deriv_limite()`, que ya tolera NULL (`IF v_sla IS NOT NULL`); ninguna vista
hace JOIN con esa columna. Inventar "Critica_Inmediata" habría creado falsa
urgencia; inventar "Seguimiento" habría ocultado una alerta real.

### D48 · Riesgo del caso 016 desde sus propias alertas

`CS-PRODUCE-2026-016` no tiene `ID_Riesgos`. Pero sí tiene **7 alertas vinculadas**,
con `RIE-001` ×4 y `RIE-002` ×3.

→ `nivel_riesgo_id = 3 (Alto)` derivado de la **moda de un dato del legado**
(`alerta_vinculada`, `confidence=0.90`), no de `Prioridad` (que sería 0.50). La
regla completa, en orden: dato directo → alertas vinculadas → prioridad del caso →
NULL.

### D49 · `base_legal` de los datos personales

Con (e) aceptada, la base contiene **642 DNI, 606 teléfonos y 141 correos**
(verificado sobre `actor_datos_personales`: 847 filas). `base_legal` no puede
quedar NULL sin política: se puebla con el token **`LEGADO_AVISA_2026`** (dato
heredado del prototipo, sin consentimiento individual en archivo),
`nivel_clasificacion=3` y `fecha_consentimiento=NULL`. **OAIPCS debe sustituirlo**
por la base legal formal de la Ley 29733 antes de exponer la tabla a usuarios
fuera de `administrador`.

### D50 · Membresías sin fecha: `valid_from` admite NULL

`actor_membresia.valid_from` es `NOT NULL` y D42 no alcanza para la mayoría de los
vínculos. Medición verificada sobre el cargador real:

| Concepto                                                    |   Filas |
| ----------------------------------------------------------- | ------: |
| Referencias no vacías en `DIM_Actores.Id_organizacion`      |     660 |
| Referencias resueltas (11 `ORG-xxx` + 272 nombre + 8 trgm)  |     291 |
| **Filas-persona con organización identificada**             | **292** |
| — con `fecha_constitucion` de la organización               |      13 |
| — sin fecha de org, con `Fecha_Inicio` del caso más antiguo |      25 |
| **— con fecha derivable (D42 estricto)**                    |  **38** |
| **— sin fecha derivable alguna**                            | **254** |

Exigir `valid_from` no nulo obligaría a descartar 254 vínculos que **sí existen** en
el origen, o a inventar una fecha (`CURRENT_DATE`, el mínimo global de `FACT_Casos`,
la fecha del representante…). Ambas opciones son peores: la primera pierde datos
reales; la segunda falsea el modelo temporal.

→ `valid_from` pasa a **admite NULL** (parche 4), con la semántica explícita
`valid_from IS NULL ⇔ la fecha de inicio no consta en el legado`. Ninguna vista ni
trigger consume la columna; el índice `ix_membresia_org ... WHERE valid_to IS NULL`
no la usa. Se cargan **las 292** membresías: 38 con fecha y 254 con `valid_from = NULL`.

### D51 · El historial del caso arrastra el `NOT NULL` del nivel de conflicto

La decisión (b) relaja `casos.nivel_conflicto_id`, pero el trigger
`core.caso_historial()` copia ese valor a `core.caso_estado_historial`, donde la
columna **también** es `NOT NULL`. El caso `CS-PRODUCE-2026-024` (sin `ID_Tipo`)
abortaba la carga desde el trigger, no desde el `INSERT`.

→ Se relaja **sólo** `caso_estado_historial.nivel_conflicto_id` (parche 4). El
historial debe poder representar el mismo estado que el caso; `nivel_riesgo_id` y
`estado_id` siguen `NOT NULL` porque `casos` también los exige. Verificado: 35 filas
de historial, una por caso, generadas por el trigger.

---

## 6. Parche 3 — qué cambia el esquema y por qué

`docs/PREPARACION_V9_CARGA_LEGADO_3.sql`, probado contra PostgreSQL 16
(contenedor `avisa-v9-test`): **verde e idempotente** (dos ejecuciones seguidas).

| #   | Cambio                                                               | Motivo                                                                                      |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | `ux_actor_dni` (UNIQUE) → `ix_actor_dni` (normal)                    | D43                                                                                         |
| 2   | `alertas_tempranas.prioridad_id` → NULL-able                         | D47                                                                                         |
| 3   | `demandas.documento_origen_id` (FK) + `demandas.codigo_padre_legado` | D44                                                                                         |
| 4   | `cat_especies.nombre_cientifico_legado`                              | D25 — preserva `Sphyrna zygaena` sin duplicar "Tiburón martillo" (`nombre_comun` es UNIQUE) |
| 5   | **Seed de la unidad `OAIPCS`**                                       | D26                                                                                         |
| 6   | **`core.migracion_conflicto`** (cola de revisión humana)             | D43–D49 + D10                                                                               |

Ejecución verificada:

```
BEGIN → DROP INDEX → CREATE INDEX → ALTER TABLE (×3) → INSERT 0 1 → CREATE TABLE → DO
NOTICE:  Parche 3 aplicado correctamente (unidad OAIPCS id=1).
COMMIT
```

### Parche 4 — membresías sin fecha y nivel de conflicto nulo (D50–D51)

`docs/PREPARACION_V9_CARGA_LEGADO_4.sql` relaja dos columnas:

| #   | Cambio                                                 | Motivo |
| --- | ------------------------------------------------------ | ------ |
| 1   | `actor_membresia.valid_from` → NULL-able               | D50    |
| 2   | `caso_estado_historial.nivel_conflicto_id` → NULL-able | D51    |

Ejecución verificada:

```
BEGIN → ALTER TABLE → ALTER TABLE → DO
NOTICE:  Parche 4 aplicado correctamente (valid_from y nivel_conflicto_id del historial admiten NULL).
COMMIT
```

Carga verificada con `--to 5`: `actor_membresia` = **292** (38 con fecha, 254 con
`valid_from IS NULL`) y `MEMBRESIA_SIN_MATCH` = 368 (sólo las referencias que no
resuelven a ninguna organización).

---

## 7. Acta de cierre — cifras objetivo de la carga

Todas verificadas contra el workbook (no estimadas):

| Tabla                        |     Filas | Nota                                                             |
| ---------------------------- | --------: | ---------------------------------------------------------------- |
| `regiones`                   |    **25** | 27 − DEP-20 − fusión 15/16                                       |
| `provincias`                 |    **70** | `Cod_INEI` con `zfill(4)`                                        |
| `distritos`                  |   **698** | `Cod_INEI` con `zfill(6)`                                        |
| `cat_especies`               |    **39** | 5 semilla + 34 nuevas                                            |
| `entidades`                  |    **23** | 22 externas + PRODUCE                                            |
| `cat_unidades_organicas`     |    **66** | 66 áreas; `OAIPCS` **es** `AR-047`                               |
| `usuarios`                   |    **31** | 34 − 3 solapamientos                                             |
| `actores`                    | **1 160** | 828 + 108 + 224                                                  |
| `actor_datos_personales`     |   **847** | 747 + 100                                                        |
| `organizaciones`             |   **224** |                                                                  |
| `actor_membresia`            |   **292** | de 660 refs; 368 sin match; 254 con `valid_from` NULL (D50)      |
| `casos`                      |    **35** |                                                                  |
| `caso_regiones`              |    **81** | 87 bridge − 2 huérfanos − 4 fusión Lima; 32 principales          |
| `caso_distritos`             |    **23** |                                                                  |
| `casos_actores`              |    **60** | 141 bridge → 60 pares; 11 casos sin actor                        |
| `caso_cronologia`            |    **80** |                                                                  |
| `documentos`                 |   **153** |                                                                  |
| `caso_estado_historial`      |    **35** | por trigger, no se carga                                         |
| `demandas`                   |   **325** | 222 con `alerta_id`, 99 con `caso_id`                            |
| `demandas_evidencias`        |    **77** |                                                                  |
| `demandas_actores`           |    **98** |                                                                  |
| `alertas_tempranas`          |    **83** | 81 con `prioridad_id`                                            |
| `alertas_actores`            |   **161** | 167 bridge − 5 alertas fantasma; 3 filas con columnas invertidas |
| `alerta_especies`            |    **30** | 32 bridge − 2 alertas fantasma                                   |
| `compromisos`                |     **8** | sintéticos, estado `En_proceso`                                  |
| `hitos_compromiso`           |    **12** |                                                                  |
| `mesas_dialogo`              |    **21** |                                                                  |
| `mesa_miembros`              |    **62** |                                                                  |
| `locales`                    |    **27** |                                                                  |
| `capacitaciones`             |     **1** |                                                                  |
| `capacitacion_participantes` |     **9** | ⚠ antes 1 (D46)                                                  |
| `envios_comunicacion`        |    **17** |                                                                  |
| `suscripcion_notificacion`   |     **4** |                                                                  |
| `log_accesos`                |   **857** |                                                                  |
| `usuario_territorio`         |    **25** | 27 − `DEP-20` − (`DEP-15/16` colapsan)                           |

**Cambios respecto del plan anterior:** `demandas.alerta_id` 248 → **222**;
`capacitacion_participantes` 1 → **9**; `regiones` 27 → **25** (ya estaba previsto).

---

## 8. Lo que queda fuera de la carga (y por qué)

| Concepto                                                                         | Filas | Razón                                                        | Dónde queda  |
| -------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------ | ------------ |
| `FACT_Proceso_Caso`, `FACT_Proceso_Reporte`, `DIM_Paso_Proceso*`                 |   135 | v9 no tiene workflow                                         | `legacy.*`   |
| `FACT_RED_RADAR`, `FACT_NODO`, `BRIDGE_RADAR/Nodo_Actor`, `DIM_Tipo_Actor_Radar` |    10 | RADAR diferido                                               | `legacy.*`   |
| `FACT_Historial_Estado`                                                          |    27 | 27/27 huérfanos + columnas cruzadas; el trigger lo sustituye | `legacy.*`   |
| `BRIDGE_Caso_{Descencadenantes,Impulsores,Causas,Medios}`                        |    10 | van a `documentos.contenido_json`                            | `documentos` |
| `Respuestas de formulario 1`                                                     |     1 | intake bruto; duplica una alerta                             | `legacy.*`   |
| `DIM_Responsable`                                                                |     3 | puntero polimórfico sin valor                                | descartado   |
| `DIM_Estado_Proceso`, `DIM_Tipo_Proceso`                                         |     9 | workflow inexistente                                         | `legacy.*`   |

Nada de esto se borra: el staging es la garantía de que la decisión es reversible.

---

## 9. Validación ejecutable

`migration/test_decisions.py` → **122 comprobaciones, 0 fallos.**

```
python migration/test_decisions.py
```

Cubre: 25 regiones · padding INEI de 70+698 ubigeos · 34/35 nivel_conflicto ·
caso 016 → riesgo 3 (`alerta_vinculada`, 0.90) · 2 alertas sin prioridad ·
39 especies (3 reutilizadas por nombre científico) · 236/6/5/1/77 padres de
demanda · unión 247 → 233 válidos → 222 asignados · 45 DNI / 100 filas ·
62+45 bridges ordinales · `tipo_actor {2:819, 3:9}` · 9 participantes ·
21 mesas · transformaciones (fecha, pct, teléfono).

Esto es lo que **prueba** que los bloqueos están cerrados: si el origen cambia,
el test falla antes de que el cargador escriba una fila.

---

## 10. Lo que queda en manos de OAIPCS (no bloquea la carga)

Ninguno de estos puntos impide cargar; todos entran marcados y revisables:

| #   | Dato                                              | Estado en la carga                                     | Acción                                                           |
| --- | ------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| 1   | Unidad `OAIPCS` (siglas/nombre)                   | Cargada con el nombre del glosario oficial             | Ratificar o corregir en `cat_unidades_organicas`                 |
| 2   | 45 grupos de DNI compartido                       | Cargados sin fusionar                                  | Revisar `migracion_conflicto` y fusionar los que sean duplicados |
| 3   | 378 membresías sin organización                   | Sin vínculo                                            | Completar `DIM_Actores.Id_organizacion`                          |
| 4   | 12 demandas con padre de serie anterior           | Código crudo preservado                                | Decidir si `CS-2026-xx` se mapea a un caso real                  |
| 5   | 14 vínculos alerta↔demanda a alertas inexistentes | Descartados                                            | Confirmar que AT-2026-19/24/27/34/39 no existen                  |
| 6   | `Sphyrna zygaena` vs `Sphyrna lewini`             | Mismo id (12), nombre científico del legado preservado | Confirmar taxonomía                                              |
| 7   | `base_legal` de los datos personales              | `LEGADO_AVISA_2026`                                    | Sustituir por base legal formal (Ley 29733)                      |
| 8   | Descripción de `TEMA-03`                          | NULL                                                   | Redactar                                                         |
| 9   | 698 de 1 874 distritos                            | Cobertura parcial                                      | Ampliar catálogo si se necesita                                  |

---

## 11. Siguiente paso

Los bloqueos están cerrados y el esquema está probado. El orden ya no tiene
incógnitas:

1. **Entorno Docker + PostgreSQL 16 + PostGIS** (el DDL lo exige: `GEOGRAPHY` en 3 tablas).
2. Aplicar DDL v9 → **dos pasadas** (la DDL tiene una FK adelantada, ver §12) → parche 1 → 2 → 3.
3. Capa de repositorio asyncpg con la sesión obligatoria:
   ```sql
   SET LOCAL app.clasificacion_max = '3';
   SET LOCAL app.user_id = '<uuid admin>';
   ```
4. Cargador por fases 0–13 (plan §3), importando `migration/decisions.py`.
5. Validaciones del plan §7 + `core.migracion_conflicto` como entregable de revisión.

---

## 12. Defectos conocidos de la DDL v9 (se reportan, no se corrigen aquí)

1. **No corre de una sola pasada**: `core.cambio_normativo` (L137) tiene FK a
   `core.usuarios` (creado en L297) → `relation "core.usuarios" does not exist`, y
   por eso tampoco se crean los triggers de L138/169/190. Solución operativa:
   ejecutar dos veces tolerando errores la primera.
2. **PostGIS obligatorio.**
3. El seed de `cat_variables` (L3007) viola `cat_variables_dominio_id_fkey`.
4. Existe `core.entidadess` (doble `s`): typo de la DDL.
5. `core.plan_acciones` (acciones) y `core.planes_accion` (plan) coexisten con
   nombres casi iguales y PKs distintas. Trampa para cualquier cargador.
