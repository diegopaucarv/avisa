# Cierre de decisiones para la carga del legado AVISA 2026 → v9

**Fecha:** 2026-10-31
**Estado:** todos los bloqueos cerrados. **No queda ningún TBD.**
**Compañía de:**

- `docs/05_datos/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` — diagnóstico de las 86 hojas
- `docs/_archivo/MAPA_CARGA_LEGADO_A_V9.md` — mapa por dominio, decisiones D1–D22
- `docs/04_migracion/PLAN_PORTE_LEGADO_V9.md` — especificación de carga, D23–D42
- `docs/PREPARACION_V9_CARGA_LEGADO.sql` (parche 1) · `…_2.sql` (parche 2) · `…_3.sql` (parche 3, nuevo)
- `migration/decisions.py` (reglas ejecutables) · `migration/test_decisions.py` (**122 comprobaciones, 0 fallos**)

**Este documento manda.** Donde contradice al plan anterior, la contradicción está
marcada con ⚠ y explicada con la evidencia que la sostiene.

---

## 0. Resumen

Al especificar la carga columna por columna aparecieron **seis bloqueos nuevos**
que el plan anterior no veía, y **cinco de sus afirmaciones resultaron falsas**.
Todos están cerrados:

| #       | Bloqueo nuevo                                                                  | Efecto si no se cerraba                   | Cierre                                                       |
| ------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| **D43** | 45 DNI compartidos por 100 filas contra un índice `UNIQUE`                     | La carga **aborta** en la 2.ª aparición   | Índice único → índice normal + cola de revisión              |
| **D44** | `DIM_Demandas.ID_ALERTA` no sólo contiene alertas                              | 12 demandas con padre inventado o perdido | Reclasificado; `documento_origen_id` + `codigo_padre_legado` |
| **D45** | `tipo_actor_id` por defecto = 1 (_Actor del Estado_, canónico `Actor público`) | 586 personas reales mal clasificadas      | Default = 2 (Actor Sociedad Civil, canónico `Actor social`)  |
| **D46** | 8 de 9 participantes sin `ID_Capacitacion`                                     | Se perdían 8 de 9 participantes           | Único candidato posible → `CAP-2026-001`                     |
| **D47** | 2 alertas sin `ID_NIVEL_ALERTA` pero `prioridad_id` NOT NULL                   | Alertas no cargan                         | `prioridad_id` relajado a NULL                               |
| **D48** | Caso sin `ID_Riesgos` con `nivel_riesgo_id` NOT NULL                           | Caso 016 no carga                         | Derivado de sus propias alertas (dato del legado)            |

Y las correcciones a los documentos anteriores:

| #   | Antes se decía                                                | La realidad                                                                                                                                                                                                    | Origen                         |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| C1  | 27 "unidades orgánicas" ≠ 66 "áreas" (dos niveles)            | Son **las mismas 27** con la misma sigla                                                                                                                                                                       | Inspección 1:1                 |
| C2  | `entidades` = 1 fila                                          | **23** (`E-001`..`E-023`)                                                                                                                                                                                      | `DIM_Entidad_Responsable`      |
| C3  | `cat_especies` tiene 10 filas sembradas                       | **5** (ids 11–15)                                                                                                                                                                                              | Semilla v9                     |
| C4  | `cat_tipos_actor` está vacía                                  | 7 filas: 1–3 del legado + NEC/CITES/CITE/SANIPES                                                                                                                                                               | Semilla v9                     |
| C5  | 9 tablas con `FORCE ROW LEVEL SECURITY`                       | **11**, con nombres. Medición de hoy (2026-11-18, v10 + parches 7–10): **48**, todas `FORCE` — 47 con `relkind='r'` + `agent.llm_call`, que es particionada (`relkind='p'`) y también cuenta como tabla lógica | `pg_class.relforcerowsecurity` |
| C6  | `DIM_Provincias.Cod_INEI` "ya son 4 dígitos" (y distritos, 6) | Vienen **sin ceros a la izquierda**: 28 de 70 provincias tienen 3 dígitos y 307 de 698 distritos tienen 5 → hace falta `zfill(4)` / `zfill(6)`                                                                 | Datos reales                   |

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
OAIPCS, documentada en `docs/02_arquitectura/AVISA_PRODUCE_v10.md` (contiene v9 íntegro)).

**Corolario operativo:** todo lo que no resuelve va a `core.migracion_conflicto`
(parche 3), no a un log perdido. El dato entra marcado y con puntero para revisión
humana.

**Corolario para los actos de aprobación.** El mismo criterio —no fabricar actos
administrativos— vale para la firma de una alerta. Las 83 alertas migradas nunca
tuvieron validación previa en el sistema anterior, así que conservan
`fecha_validacion` y `aprobada_por` en NULL y `visibilidad = 'interna'`: no se
publican con un `UPDATE` ni sembrando una aprobación. Desde el parche 22 el gate
G21 es ejecutable —el trigger `alertas_g21_visibilidad` rechaza con
`G21_SIN_APROBACION` cualquier visibilidad distinta de `interna` mientras falte la
validación previa del Sectorista o la aprobación definitiva de la Dirección—, de
modo que publicar una de esas alertas exige que una persona la valide, que es
exactamente lo que la regla significa.

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

Cobertura real: **34/35**. Sólo `CS-PRODUCE-2026-024` (`codigo_legado`) no tiene `ID_Tipo` → NULL.
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
dejarlo en _Conflicto social_ por defecto o completarlo caso por caso.

La respuesta correcta es **ninguna de las tres**: el legado **ya tiene la escala**.
`FACT_Casos.ID_Tipo` → `DIM_Tipo_Caso` es exactamente la escala de 4 niveles de la
Guía (RM N.° 00207-2026-PRODUCE):

| Legado  | Texto de la Guía | `cat_niveles_conflicto` |
| ------- | ---------------- | ----------------------- |
| `TC-01` | Diferencias      | 1 `Diferencia`          |
| `TC-02` | Controversias    | 2 `Controversia`        |
| `TC-03` | Conflicto activo | 3 `Conflicto social`    |
| `TC-04` | Crisis           | 4 `Crisis social`       |

Distribución real: **TC-02 20, TC-03 13, TC-01 1, sin dato 1**. Cobertura 34/35.

Por qué **no** derivarlo de riesgo/nivel de alerta: son ejes distintos. Empíricamente
la correlación es débil — `NA-001` (máxima prioridad) aparece 20 veces con `RIE-001`
y 7 con `RIE-002`; **2 de los 4 casos `Urgente` son de riesgo `RIE-003` (Bajo)**.
Derivar habría fabricado escalones inexistentes. Es el criterio de máxima
compatibilidad: **el dato normativo se lee, no se estima.**

> Nota de implementación: `DIM_Tipo_Caso` y `DIM_Tipo_Cambio` **reusan** los
> códigos `TC-01..TC-06`. Se namespacean por hoja, jamás por código.

### 2(i) El literal del mapa de carga (absorbido de MAPA_CARGA_LEGADO_A_V9.md)

Proviene de `docs/_archivo/MAPA_CARGA_LEGADO_A_V9.md`, líneas 26 a 31, y se
conserva aquí porque el original se archivó el 2026-11-20. Es el literal de la
tabla, sin resumir:

| `dim_tipo_caso`          | Descripción en la hoja                                                               | `core.cat_niveles_conflicto` |
| ------------------------ | ------------------------------------------------------------------------------------ | ---------------------------- |
| `TC-01` Diferencias      | "Posiciones distintas entre actores sobre un tema, sin acciones de protesta activas" | `1 Diferencia`               |
| `TC-02` Controversias    | "Disputas formales que requieren atención institucional pero sin escalamiento"       | `2 Controversia`             |
| `TC-03` Conflicto Activo | "Situación que involucra acciones colectivas, protestas o riesgo de violencia"       | `3 Conflicto social`         |
| `TC-04` Crísis           | "Ruptura institucional, violencia generalizada e ingobernabilidad…"                  | `4 Crisis social`            |

---

## 3. D1–D22 — estado final

| #   | Decisión                                       | Estado final                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 33/83 alertas sin caso                         | ✅ `caso_id` NULL. No se inventan casos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D2  | 225/325 demandas sin caso                      | ✅ `caso_id` NULL + `alerta_id`. Ahora **226** (1 caso es de la serie anterior, D44)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D3  | 12/35 casos sin distrito                       | ✅ NULL + `region_principal_id` cuando el legado lo trae (8 de 35 quedan NULL: 006, 007, 010, 020, 021, 030, 032 y 035)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D4  | Sin fuente de `unidad_responsable_id`          | ✅ **D26**: unidad OAIPCS real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D5  | 1 caso sin `id_riesgos`                        | ⚠ **Sustituida por D48**: se deriva de las alertas, no de `Prioridad`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D6  | Escala de `Pct_Avance`                         | ✅ 0.0–0.9 → ×100. Verificado: `{0,70,80,90}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D7  | `FACT_Historial_Estado` huérfano               | ✅ No se carga; el trigger `caso_historial()` genera las 35 filas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | Qué bridge actor↔caso manda                    | ✅ Ambos son el mismo conjunto: **unión deduplicada** (62 y 45 filas)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D9  | Fusionar los dos censos de personas            | ❌ **ANULADA**: son disjuntos. 0 nombres en común y `DNI='N/D'` en 108/108                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D10 | `Id_organizacion` guarda nombres               | ✅ match por id (11) → nombre exacto (271) → sin vínculo (**368**, a `migracion_conflicto`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D11 | Credenciales en claro                          | ✅ No se trasladan. `clave_hash` aleatorio + reseteo forzado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D12 | `nivel_gobierno` basura                        | ✅ NULL (`'Perfil-01'`, `'Sí'`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D13 | Hitos sin compromisos                          | ✅ 8 compromisos sintéticos, 12 hitos (todos con `ACC-xxxx` válido)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D14 | Titular/alterno en texto libre                 | ✅ `mesa_miembros.nombre_texto`, sin fuzzy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D15 | Descripciones TEMA-03/04 cruzadas              | ✅ Bruto en `descripcion_legado`, `descripcion` NULL, `nota_calidad`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D16 | `tipo_documento='Otro'`                        | ✅ tipo 15 `otro`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D17 | `FACT_Proceso_*` sin workflow                  | ✅ **RESUELTA (2026-11-18)**. Parche `PARCHE_10_FLUJO_PROCESO_D17.sql`, informe `docs/04_migracion/parches/P10_FLUJO_D17.md`: `core.flujo_definicion` 7 · `core.flujo_estado` 5 · `core.proceso_instancia` 135. Esos tres números son lo que dejó **el parche 10**; hoy (2026-11-20) la base tiene `core.flujo_definicion` **12** · `core.flujo_estado` 5 · `core.proceso_instancia` **218**: el parche 14 sumó la definición de alerta y sus 83 instancias, y el 20 añadió un paso —la aprobación definitiva de la Dirección— y renumeró el Archivo del paso 4 al 5, sin insertar ninguna instancia. Ver Anexo A.2 · D18 sigue diferida |
| D18 | RADAR / NODO                                   | ⚠ **Diferida, no cargada**: `territorio.*` (4 tablas / 6 filas). Las 6 filas siguen en `legacy.*`; ver Anexo A.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D19 | Formatos `CS-2026-07` vs `CS-PRODUCE-2026-007` | ✅ **Confirmada y reforzada**: se comprobó por contenido que NO son el mismo caso. Los cortos se aparcan (D44)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D20 | Columna vs bridge de alertas                   | ⚠ **INVERTIDA por D31**: el bridge NO es la única verdad; la columna aporta 16 pares propios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D21 | ¿Se conserva `legacy.*`?                       | ✅ Sí, es la única fuente reproducible                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D22 | `cat_especies` 37 vs sembradas                 | ⚠ Era 5, no 10. Total final **39** (D25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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
vacíos. En v9, `cat_tipos_actor` era (hoy quedan 1–3, ya con los nombres de la Guía):

`1 Actor del Estado · 2 Actor Sociedad Civil · 3 Actor Privado · 4 NEC · 5 Exportador CITES · 6 CITE · 7 SANIPES`
(1 es `Actor público`, 2 `Actor social` y 3 `Actor privado` en el vocabulario de
la Guía; 4–7 —NEC, Exportador CITES, CITE, SANIPES— son **entidades o cargos**,
no tipos de actor.)

Y la distribución del legado es: `Tipo-Act-02` **233**, `Tipo-Act-03` 9,
vacío **575**, basura (`'Regional'`, `'Sí'`) 11. El **92 %** de los tipados es
Sociedad Civil (canónico `Actor social`) y la población es de pescadores y dirigentes.

→ Default = **2**. Resultado: `{2: 819, 3: 9}`. Etiquetar 586 pescadores y dirigentes como
_Actor del Estado_ (canónico `Actor público`) habría sido una afirmación falsa.

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
hace JOIN con esa columna. Inventar "Crítica inmediata" habría creado falsa
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

| Tabla                        |     Filas | Nota                                                                      |
| ---------------------------- | --------: | ------------------------------------------------------------------------- |
| `regiones`                   |    **25** | 27 − DEP-20 − fusión 15/16                                                |
| `provincias`                 |    **70** | `Cod_INEI` con `zfill(4)`                                                 |
| `distritos`                  |   **698** | `Cod_INEI` con `zfill(6)`                                                 |
| `cat_especies`               |    **39** | 5 semilla + 34 nuevas                                                     |
| `entidades`                  |    **23** | 22 externas + PRODUCE                                                     |
| `cat_unidades_organicas`     |    **66** | 66 áreas; `OAIPCS` **es** `AR-047`                                        |
| `usuarios`                   |    **32** | 31 del legado (34 − 3 solapamientos) + el admin; 28 activos y 4 inactivos |
| `actores`                    | **1 160** | 828 + 108 + 224                                                           |
| `actor_datos_personales`     |   **847** | 747 + 100                                                                 |
| `organizaciones`             |   **224** |                                                                           |
| `actor_membresia`            |   **292** | de 660 refs; 368 sin match; 254 con `valid_from` NULL (D50)               |
| `casos`                      |    **35** |                                                                           |
| `caso_regiones`              |    **81** | 87 bridge − 2 huérfanos − 4 fusión Lima; 32 principales                   |
| `caso_distritos`             |    **23** |                                                                           |
| `casos_actores`              |    **60** | 141 bridge → 60 pares; 11 casos sin actor                                 |
| `caso_cronologia`            |    **80** |                                                                           |
| `documentos`                 |   **153** |                                                                           |
| `caso_estado_historial`      |    **35** | por trigger, no se carga                                                  |
| `demandas`                   |   **325** | 222 con `alerta_id`, 99 con `caso_id`                                     |
| `demandas_evidencias`        |    **77** |                                                                           |
| `demandas_actores`           |    **98** |                                                                           |
| `alertas_tempranas`          |    **83** | 81 con `prioridad_id`                                                     |
| `alertas_actores`            |   **161** | 167 bridge − 5 alertas fantasma; 3 filas con columnas invertidas          |
| `alerta_especies`            |    **30** | 32 bridge − 2 alertas fantasma                                            |
| `compromisos`                |     **8** | sintéticos, estado `En proceso`                                           |
| `hitos_compromiso`           |    **12** |                                                                           |
| `mesas_dialogo`              |    **21** |                                                                           |
| `mesa_miembros`              |    **62** |                                                                           |
| `locales`                    |    **27** |                                                                           |
| `capacitaciones`             |     **1** |                                                                           |
| `capacitacion_participantes` |     **9** | ⚠ antes 1 (D46)                                                           |
| `envios_comunicacion`        |    **17** |                                                                           |
| `suscripcion_notificacion`   |     **4** |                                                                           |
| `log_accesos`                |   **857** |                                                                           |
| `usuario_territorio`         |    **25** | 27 − `DEP-20` − (`DEP-15/16` colapsan)                                    |

**Cambios respecto del plan anterior:** `demandas.alerta_id` 248 → **222**;
`capacitacion_participantes` 1 → **9**; `regiones` 27 → **25** (ya estaba previsto).

---

## 8. Lo que queda fuera de la carga (y por qué)

| Concepto                                                                         | Filas | Razón                                                                                       | Dónde queda  |
| -------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------- | ------------ |
| `DIM_Tipo_Proceso`                                                               |     4 | `TR-01..TR-04` sin catálogo destino; el discriminante vive en `flujo_definicion.tipo_flujo` | `legacy.*`   |
| `FACT_RED_RADAR`, `FACT_NODO`, `BRIDGE_RADAR/Nodo_Actor`, `DIM_Tipo_Actor_Radar` |    10 | RADAR diferido                                                                              | `legacy.*`   |
| `FACT_Historial_Estado`                                                          |    27 | 27/27 huérfanos + columnas cruzadas; el trigger lo sustituye                                | `legacy.*`   |
| `BRIDGE_Caso_{Descencadenantes,Impulsores,Causas,Medios}`                        |    10 | van a `documentos.contenido_json`                                                           | `documentos` |
| `Respuestas de formulario 1`                                                     |     1 | intake bruto; duplica una alerta                                                            | `legacy.*`   |
| `DIM_Responsable`                                                                |     3 | puntero polimórfico sin valor                                                               | descartado   |

Las hojas de flujo **ya no están fuera**: el parche 10 (D17) cargó
`FACT_Proceso_Caso` (36) + `FACT_Proceso_Reporte` (99) en `core.proceso_instancia`,
`DIM_Paso_Proceso*` (7) en `core.flujo_definicion` y `DIM_Estado_Proceso` (5) en
`core.flujo_estado`. Ver Anexo A.2 y `docs/04_migracion/parches/P10_FLUJO_D17.md`.

Nada de esto se borra: el staging es la garantía de que la decisión es reversible.

**Baja lógica, no `DELETE`.** En la base toda baja es anulación: `anulado_en`,
`anulado_por` y `motivo_anulacion`, nunca un `DELETE`. `core.anular_caso(uuid, motivo)`
anula en cascada caso, alertas, documentos, compromisos, hitos, demandas y hechos
(`caso_cronologia`), y `core.restaurar_caso(uuid)` revierte; migraciones 12 y 13
aplicadas, endpoints de API pendientes.

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
| 3   | 368 referencias sin organización                  | Sin vínculo                                            | Completar `DIM_Actores.Id_organizacion`                          |
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
4. `core.entidadess` (doble `s`) **no existe** en la DDL v9: el único objeto es `core.entidades` (L102). Si alguna copia del archivo muestra el typo, es una variante no versionada: no construir nada encima y no citarla como si fuera la DDL vigente.
5. **`core.plan_acciones`** (acciones) y **`core.planes_accion`** (plan) coexisten con
   nombres casi iguales y PKs distintas. Trampa para cualquier cargador.

---

## Anexo A — Clases de portabilidad y su ajuste a v10

Absorbe `docs/05_datos/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` §1.1 y §5. El detalle
columna a columna de ese documento (§3) **sigue siendo fuente única allí**: no se
duplica aquí porque crear una segunda copia de una tabla de mapeo es exactamente
el defecto que el índice documental está corrigiendo.

### A.1 Base certificada: las 86 hojas contra la DDL v9

| Clase | Significado                                                                                               | Tablas | Filas | % filas |
| ----- | --------------------------------------------------------------------------------------------------------- | -----: | ----: | ------: |
| **A** | Destino directo: mismo concepto, cambian tipos de id y alguna columna                                     |     14 | 1 342 |  28,9 % |
| **B** | Transformación estructural: cambia el padre o la granularidad, o hay que sintetizar columnas obligatorias |     27 | 2 077 |  44,7 % |
| **C** | Se absorbe en JSON o en un valor derivado                                                                 |     11 |    90 |   1,9 % |
| **D** | **Sin destino en v9**: el concepto no existe en el modelo                                                 |     23 | 1 140 |  24,5 % |
| **X** | Vacía (0 filas): se descarta sin trabajo                                                                  |     11 |     0 |     0 % |

Lectura original: 73 % de las filas y 52 de 86 tablas eran portables con trabajo
(A+B+C); 24,5 % de las filas no tenían casa.

### A.2 Lo que cambia al pasar a v10

La clase D medía la distancia contra **v9**. v10 y el parche 2 de migración crearon
**22 tablas de soporte**; el parche 10 añadió 3 más (`core.flujo_definicion`,
`core.flujo_estado`, `core.proceso_instancia`). Con eso, **21 de las 23 tablas de
clase D pasan a B** (16 del parche 2, 4 de D17 y 1 de la corrección de hoy):

| Grupo                                         | Tablas | Filas | Destino creado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | -----: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cargado en v9**                             |      8 |   978 | `log_accesos` 857 → `core.log_accesos` (857) · `bridge_alerta_recurso` 32 → `core.alerta_especies` (30) · `dim_locales` 27 → `core.locales` (27) · `bridge_sectorista_departamento` 27 → `core.usuario_territorio` (25; se pierden `DEP-20` y un colapso de PK) · `dim_mesas_grupos` 21 → `core.mesas_dialogo` (21) + `mesa_miembros` (62) · `bridge_capacitacion_participant` 9 → `core.capacitacion_participantes` (9) · `dim_destinatarios_fijos` 4 → `core.suscripcion_notificacion` (4) · `dim_capacitaciones` 1 → `core.capacitaciones` (1) |
| **Destino creado, sin uso**                   |      4 |     4 | `bridge_clima_actor`, `bridge_clima_actor_estado`, `bridge_reporte_actor`, `bridge_reporte_actor_estado` → `core.documento_actores` (0 filas: la tabla existe, el vínculo documento↔actor aún no se escribe)                                                                                                                                                                                                                                                                                                                                      |
| **Diferido por decisión D18**                 |      4 |     6 | `fact_red_radar` 1, `fact_nodo` 1, `bridge_radar_actor` 1, `bridge_nodo_actor` 3 → `territorio.*` (RADAR reclasificado como diferido, no como inexistente)                                                                                                                                                                                                                                                                                                                                                                                        |
| **Cargado por D17** (parche 10)               |      4 |   142 | `fact_proceso_reporte` 99 + `fact_proceso_caso` 36 → `core.proceso_instancia` (135; 218 con el parche 14, discriminado por `tipo_origen`) · `dim_paso_proceso_caso` 4 + `dim_paso_proceso` 3 → `core.flujo_definicion` (7; 11 con el parche 14 y 12 con el 20, discriminado por `tipo_flujo`)                                                                                                                                                                                                                                                     |
| **Reclasificado por corrección** (2026-11-18) |      1 |     4 | `dim_intervencion` 4 → `core.cat_ciclos_intervencion` (4, `Ciclo-001..004`). El Anexo A la daba por D porque **v9 no tenía ese catálogo**; el cargador ya la escribía (`p02_catalogos.py`, fase 2)                                                                                                                                                                                                                                                                                                                                                |

### A.3 Totales vigentes

| Clase     | Tablas |     Filas |   % filas |
| --------- | -----: | --------: | --------: |
| A         |     14 |     1 342 |    28,9 % |
| B         | **48** | **3 211** |    69,1 % |
| C         |     11 |        90 |     1,9 % |
| **D**     |  **2** |     **6** | **0,1 %** |
| X         |     11 |         0 |       0 % |
| **Total** | **86** | **4 649** |     100 % |

**Corrección de una cifra anterior.** El índice declaró «B 40 / 3 063 · D 10 / 154».
Ese reparto dejaba fuera el grupo D18 (4 tablas / 6 filas), que sí tiene destino
creado, luego el grupo D17 (4 tablas / 142 filas), cargado el 2026-11-18, y por
último `dim_intervencion` (1 tabla / 4 filas), que ya estaba cargada y seguía contada
como D. Los totales cuadran ahora uno a uno con las 86 hojas y las 4 649 filas, y
cada fila de A.2 es verificable contra `count(*)` de la base.

> **Nota de medición (2026-11-18): 4 649 declaradas, 4 643 medidas.** La única
> discrepancia entre este anexo y la réplica viva es `fact_historial_estado` (#15 del
> Anexo A de `ANALISIS_PORTABILIDAD`): aquí figuran **33** filas y el manifiesto
> `legacy._hojas` y `count(*)` dan **27**. Las otras 85 hojas cuadran una a una. Por
> eso los totales de esta tabla dicen 4 649 y la medición de la base dice **4 643**,
> y la clase B sería **3 205** en lugar de 3 211. **No cambia ninguna decisión de
> carga**: la hoja se migra igual, solo con 6 filas menos. Se conserva 4 649 en todo
> el conjunto documental para no romper las citas; manda esta nota. La medición es
> reproducible con `migration/reporte_estadistica.py`.

### A.4 Las 2 hojas que siguen sin destino (6 filas)

| Tabla                  | Filas | Por qué sigue sin casa                                                                  | Qué se decidió                                                             |
| ---------------------- | ----: | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dim_tipo_actor_radar` |     3 | Roles de participación en RED/NODO (`Titular`, `Alterno`, `Participante Institucional`) | **Diferida**: irá a `territorio.*` con D18; aún no hay tabla para RED/NODO |
| `dim_responsable`      |     3 | Puntero polimórfico (`tabla_origen`); v10 usa FK explícitas                             | **Descartada**: la asignación de usuarios ya cubre esos vínculos           |

`dim_tipo_actor_radar` no cabe en ningún catálogo existente: no son tipos de actor
(`core.cat_tipos_actor`: Actor del Estado —canónico `Actor público`—, Sociedad Civil
—`Actor social`—, Privado, NEC, CITES, CITE, SANIPES —estos cuatro son entidades o
cargos, no tipos de actor—), ni roles de actor (`core.cat_roles_actor`: Principal,
Secundario, Tercero imparcial, Proveedor MYPE —un cargo, no una función—…), ni roles
funcionales (`core.cat_roles_funcionales`: Decisor
Principal, Proveedor de evidencia, Implementador, Articulador territorial). Describen
la posición de un actor **dentro de una RED o NODO**, y ese modelo es justamente el
que está diferido en D18. `territorio.*` ya existe (17 tablas: `lugares`, caletas,
plantas, certificaciones…), pero ninguna modela RED ni NODO; por eso la hoja sigue en
D y no se cuenta como B. Se queda en `legacy.*` hasta entonces: inventarle un
catálogo ahora sería fijar un eje que todavía no existe.

`dim_responsable` se descarta sin costo: es un puntero polimórfico (`tabla_origen`)
que la asignación de usuarios (`core.usuarios` + unidad/rol) ya sustituye con FK
explícitas.

**No queda ninguna hoja de clase D esperando decisión de OAIPCS.**
`dim_intervencion` salió de esta lista al comprobarse que ya está cargada (A.2 y
Anexo C, fila 8), y las 142 filas del flujo las cargó el parche 10. Las 6 filas
restantes no son trabajo de carga: son el precio de tener RADAR diferido.

### A.5 Pendientes abiertos de D17 (no bloquean la carga)

El parche 10 escribió las 135 instancias (218 con el parche 14) y 16 registros de
catálogo (11 definiciones + 5 estados); el parche 20 añadió la definición de la
aprobación definitiva y renumeró el Archivo del paso 4 al 5, así que hoy son 12
definiciones y 5 estados. El parche 21 **no** añade definiciones ni estados: sólo
normaliza el `rol_responsable` de los 7 pasos de `caso` y `reporte` y añade las dos
columnas de aprobación (`aprobada_por`, `aprobada_en`) a `core.alertas_tempranas`,
sin mover ninguno de los pendientes de esta tabla. El parche 22 tampoco añade
definiciones ni estados: añade `visibilidad` a `core.alertas_tempranas` y corrige el
`paso_actual` de las **83** alertas, que seguían en 1 porque el cargador copió el
paso del sistema anterior y el parche 20 renumeró el Archivo en
`core.proceso_instancia` sin tocar la alerta. El valor nuevo (5) se **deriva** de
`max(orden)` del proceso de cada alerta, no se escribe a mano, y la corrección no es
una aprobación: las 83 siguen con `aprobada_por` en NULL y `visibilidad =
'interna'`. Lo que falta son los **padres**; ninguno de estos huecos impide la
carga: la instancia existe y se verifica, sólo queda sin enlace.

| #   | Pendiente                                                                     | Filas | Qué no se resuelve                                   | Se resuelve en                                                                                                        |
| --- | ----------------------------------------------------------------------------- | ----: | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `CS-PRODUCE-2026-037` y `038` no existen en `core.casos`                      |     2 | `caso_id`; el código queda en `codigo_caso_legado`   | Decidir si se crean los casos o se descartan                                                                          |
| 2   | Bloque `PR-001..PR-018` sin maestro de reporte                                |    18 | no hay padre: sólo queda `codigo_reporte` como texto | Definir maestro de reportes o aceptar enlace blando                                                                   |
| 3   | `DEST-01` no es usuario de `core.usuarios`                                    |     6 | `usuario_id`; queda `codigo_responsable_legado`      | Confirmar si es buzón colectivo y modelarlo como tal                                                                  |
| 4   | Pasos 4–6 sin definición en `core.flujo_definicion`                           |     9 | `flujo_definicion_id`; se conserva `orden`           | Documentado: se conservan sin definición a propósito (parche 22); se mapean si el módulo de reportes entra en alcance |
| 5   | `AT-2026-19, 27, 29, 31, 33, 34, 35, 39` no están en `core.alertas_tempranas` |     9 | `alerta_id`                                          | Confirmar que no existen o crearlas                                                                                   |

Los cinco son dato maestro ausente, no defecto de carga: 155 instancias tienen
`alerta_id` (72 las resolvió el parche 10 y 83 las cerró el parche 14) y 209
tienen `flujo_definicion_id`.
Detalle fila a fila en `docs/04_migracion/parches/P10_FLUJO_D17.md` §5 y §7.

**Decisión sobre los 9 pasos de `reporte` (parche 22).** Las 9 instancias de
`core.proceso_instancia` que caen en los pasos 4–6 del flujo `reporte` —3 en el 4,
3 en el 5 y 3 en el 6— se conservan con `flujo_definicion_id = NULL` **a
propósito**: son pasos del sistema anterior, que tenía seis, y no tienen
equivalente en el modelo de tres pasos del catálogo (1 Elaboración, 2 Remisión,
3 Archivo). La evidencia está en sus propias notas: «Mesa de diálogo convocada por
DVPA» (`PR-005`), «Reunión DVPA con gremios pesqueros» (`PR-011`), «En seguimiento
activo - paro indefinido latente» (`PR-017`), «Caso cerrado tras desbloqueo del
puente» (`PR-006`), «Archivado tras desescalamiento» (`PR-012`) y «Pendiente
resolución del conflicto» (`PR-018`); las tres del paso 4 (`PR-004`, `PR-010` y
`PR-016`) no traen nota. **Es una decisión, no un defecto de carga:** ampliar el
catálogo a seis pasos inventaría tres pasos, su rol responsable y su estado
resultante, y mapear el paso 6 al 3 reescribiría la historia de un reporte archivado
como si hubiera pasado por un flujo que no existía. El `COMMENT ON COLUMN` de
`core.proceso_instancia.flujo_definicion_id` fija ese significado del NULL.

---

## Anexo B — Qué se conservó de `MAPA_CARGA_LEGADO_A_V9.md` y dónde

`MAPA_CARGA` está **superado** por `PLAN_PORTE_LEGADO_V9.md` §2. No se elimina
porque conserva valores literales del origen que ningún otro documento transcribe.

| Sección del mapa                    | Destino vigente                      | Estado                                   |
| ----------------------------------- | ------------------------------------ | ---------------------------------------- |
| §1 — decisión (h) `nivel_conflicto` | este documento §2 (h)                | absorbido                                |
| §2 — correcciones a (a)–(g)         | `PLAN_PORTE_LEGADO_V9.md` §2         | superado por el plan                     |
| §3.1–§3.11 — mapa por dominio       | `PLAN_PORTE_LEGADO_V9.md` §4.1–§4.12 | superado; **el plan es la fuente única** |
| §4 — D1–D22                         | este documento §3                    | absorbido                                |
| §5 — advertencias                   | Anexo C de este documento            | absorbido                                |

Lo que **solo** existe en el mapa y por eso no se borra: la descripción literal de
cada hoja del legado (nombres de columna, formatos de código, casos de ejemplo) que
el plan cita sin volver a transcribir. Si alguna vez se discute qué decía una hoja,
se consulta ahí.

---

## Anexo C — Advertencias del mapa, con su estado

| #   | Advertencia (§5 del mapa)                                                                                                        | Estado                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Todos los contadores de avance del legado están en cero (`N_Acciones`, `N_Hitos_Total`, `N_Hitos_Cumplidos` = 0 en los 35 casos) | **Vigente.** Ningún KPI de avance puede salir del legado. Ver `PLAN` §8.3                                                                                                                                                                                                                                                                                            |
| 2   | `core.entidadess` (doble `s`) no existe                                                                                          | **Vigente y era la corrección.** El único objeto es `core.entidades` (DDL L102). No reintroducir el typo                                                                                                                                                                                                                                                             |
| 3   | Orden de ejecución del cargador                                                                                                  | **Sustituido** por `PLAN` §3 (orden por dependencias reales)                                                                                                                                                                                                                                                                                                         |
| 4   | Sin `app.user_id` y `app.clasificacion_max` los `INSERT` no fallan: desaparecen                                                  | **Vigente y ampliado**: `DECISIONES` §11 y `mvp.md` §3.3                                                                                                                                                                                                                                                                                                             |
| 5   | D17 describía `fact_proceso_*` como «135 filas»                                                                                  | **Resuelta: eran 142** (36 + 99 + 4 + 3) y **están cargadas desde el 2026-11-18** por el parche 10 en `core.proceso_instancia` (135) y `core.flujo_definicion` (7). El total de §3.11 sigue siendo **165** = 142 + 6 (RADAR) + 14 (JSON) + 3 (`dim_responsable`); el acta cita 160 y el desglose sin `dim_responsable` da 162. Ver `PLAN` §4.11 y `P10_FLUJO_D17.md` |
| 6   | D16 contaba «55 documentos» con `tipo_documento='Otro'`                                                                          | **Corregido por medición.** Antes del parche 6 eran **37** (34 `RED-` + 3 `CT-2026-00x`); después, **3** (solo los `CT-`). El total de `core.documentos` no cambió: **153**. El 55 era una estimación, no un conteo. Ver `LEGADO_A_V10…` §11.5                                                                                                                       |
| 7   | `DIM_Estado_Proceso` figuraba en el Anexo A de `ANALISIS_PORTABILIDAD` (#26) con destino `core.cat_estados_caso`                 | **Corregido: el destino es `core.flujo_estado`** (5 filas, `EST-01..EST-05`). `core.cat_estados_caso` son estados del **caso** (`Activo`, `En seguimiento`, `Resuelto`, `Archivado`, 4 filas), no del paso: el mapeo anterior era ficticio (5 filas a una tabla de 4). Ver `P10_FLUJO_D17.md` §3.1                                                                   |
| 8   | `DIM_Intervencion` figuraba como clase D «sin catálogo de tipos de intervención»                                                 | **Corregido: es clase B → `core.cat_ciclos_intervencion`.** La hoja tiene 4 filas (`Ciclo-001..004`) idénticas a las 4 del catálogo, que el parche 1 creó y `migration/loader/phases/p02_catalogos.py` ya carga. El Anexo A la daba por D porque **v9 no tenía el catálogo**; v10 sí. Nuevo reparto: **B 48 / 3 211 · D 2 / 6**                                      |
