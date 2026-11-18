# Brecha de la capa de datos v9 — AVISA / PRODUCE-OAIPCS

Estado: **estructura completa; contenido y derivados parciales**.

Actualización **2026-11-18 — parches 6–10 aplicados.** El 6 cerró la clasificación
de documentos (§13.1); el 7 sembró el contrato de los guardrails G19–G25; el 8 el
tope del ajuste automático del ICD (Q40); el 9 el cifrado y la auditoría de los
datos personales; el 10 el flujo por pasos (D17). Estado, cifras y pendientes de
los cuatro últimos: §14. Las cifras de §1 y §2 están medidas sobre ese estado.

Actualización **2026-10-31 — parche 5 aplicado.** Se ejecutó
`docs/PREPARACION_V9_CARGA_LEGADO_5.sql`, que siembra `core.cat_pip_etapas`
(12 etapas), `config.schema_registry` (`avisa.raw_ingest` v1 y v2),
`agent.cat_detalle_schema` (v1, provisional) y la cabecera de las tres
plantillas de `ind.plantilla`. Detalle y verificación: §10. Lo que sigue
pendiente se marca expresamente en §3.1, §7 y §8.

Antes del parche 5, la única mutación de datos había sido el `REFRESH` de las 6
vistas materializadas, hecho para distinguir caché obsoleta de fuente vacía
(§5.4). El parche 5 repite ese `REFRESH` como parte de su aplicación.

Validación ejecutada al cerrar este informe (y repetida después del parche 5):
`python -m migration.loader.run --verify` pasó todas sus comprobaciones;
`python -m pytest migration/ -q` dio **14 passed**; y
`python migration/test_decisions.py` pasó todas sus comprobaciones. La carga no
se re-ejecutó.

Medición: **2026-10-31** sobre `avisa-db` (`localhost:55433`, base `avisa`),
PostgreSQL 16.14 + PostGIS 3.7 + pgvector 0.8.3. La carga del legado
(`BASE_CONFLICTOS_SOCIALES_2026.xlsx`, 86 hojas, 4 643 filas de datos) está
cerrada y verificada según `docs/ACTA_CIERRE_CARGA_V9.md`.

Este informe responde a una pregunta concreta: **¿qué falta para que la base
real cumpla la capa de datos descrita en `docs/AVISA_PRODUCE_v10.md` y
`backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql`?**

La respuesta corta es:

1. **No falta estructura del DDL.** Los 25 schemas declarados, más `audit` —el
   26.º, que añadió el parche 9—, con sus tablas, vistas, funciones y triggers
   existen. La comparación automática no encontró ningún `CREATE TABLE` ni
   `CREATE VIEW` real ausente.
2. **Faltaban seeds de contenido** que el propio documento exige. El parche 5
   cerró `core.cat_pip_etapas`, `config.schema_registry`,
   `agent.cat_detalle_schema` y la cabecera de `ind.plantilla`; siguen abiertos
   `ind.indicador` (y todo lo que depende de él), `ctx.cat_fuentes`,
   `ctx.zonas_maritimas` y los JSON Schema de `core.cat_tipos_documento`
   (ver §10 y §8).
3. **Faltan derivados**: el grafo KAG tiene 1 520 nodos y 450 aristas, pero son
   vínculos copiados de `core`, no conocimiento extraído;
   `kag.documento_fragmento`, `kag.embedding` y `kag.actor_profile` están vacíos;
   `lex.*` y `qda.*` no tienen datos; las capas de expansión aún no están
   activadas.
4. **Hay dos vistas materializadas que quedaron obsoletas** tras la carga del
   legado y requieren `REFRESH` (se refrescaron durante esta medición; ver §5.4).
5. **Faltan decisiones de contenido** que no se pueden resolver por SQL:
   qué indicadores de la Tabla 3 de la Guía se siembran, qué mapeo tienen las
   aristas KAG del legado, si las reuniones del legado se convierten en
   `core.reuniones_dialogo`, y qué JSON Schema se asigna a cada anexo.

---

## 1. Inventario real vs. documento

### 1.1 Schemas

| Dato                               | Medición |
| ---------------------------------- | -------: |
| Schemas declarados en el DDL       |   **25** |
| `audit` (creado por el parche 9)   |        1 |
| **Schemas de producto**            |   **26** |
| `public` (PostGIS)                 |        1 |
| `legacy` (staging de la migración) |        1 |
| **Schemas reales**                 |   **28** |

Los 25 schemas declarados son: `agent`, `analisis`, `analytics`, `avisa`,
`chat`, `community`, `config`, `consultation`, `core`, `ctx`, `domain`,
`economic`, `forecast`, `impact`, `ind`, `kag`, `lex`, `model`, `mype`,
`pesca`, `policy`, `proteccion`, `qda`, `staging`, `territorio`.

`legacy` **no forma parte del modelo v9**: es la evidencia reproducible de la
carga y no debe contarse como schema de producto. `public` tampoco: solo aloja
PostGIS. `audit` sí es de producto y **no está en el DDL**: lo creó el parche 9
(`docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql`) para la bitácora append-only de
accesos a datos personales (§14).

### 1.2 Tablas

| Objeto                                            | Cantidad |
| ------------------------------------------------- | -------: |
| Tablas base del modelo (sin particiones hijas)    |  **255** |
| Particiones hijas creadas en runtime              |   **24** |
| **Tablas del modelo incluyendo particiones**      |  **279** |
| Tablas creadas por los parches 1–4 de migración   |   **22** |
| Tablas creadas por el parche 5 (solo seeds)       |    **0** |
| Tablas creadas por el parche 9 (`audit`)          |    **1** |
| Tablas creadas por el parche 10 (D17)             |    **3** |
| Tablas base del DDL puro (255 − 22 − 1 − 3)       |  **229** |
| Tablas del DDL puro incluyendo sus 24 particiones |  **253** |
| `public.spatial_ref_sys` (PostGIS)                |        1 |
| `legacy.*`                                        |   **87** |
| **Total de tablas `r`/`p` en la base**            |  **367** |

**Por qué el documento dice 254 y aquí aparecen 253 del DDL puro.** La
diferencia de una tabla es consistente con haber contado el catálogo
`public.spatial_ref_sys` de PostGIS: **253 objetos del DDL puro + 1 de
PostGIS = 254**. El documento no explicita si incluyó ese catálogo. Lo que sí
advierte en §3.3 es que su recuento “no está verificado en corrida completa” y
que se obtuvo por aritmética de deltas. La medición real es la que manda:
**253 objetos del DDL + 22 de los parches 1–4 + 1 del parche 9 + 3 del parche 10
= 279 de modelo**, más 87 de `legacy` y 1 de PostGIS = **367 tablas `r`/`p` en el
clúster** (de las cuales **589 claves foráneas** son el grafo de relaciones; no
confundir ambas cifras).

Las 22 tablas de soporte de la carga son:

`core.alerta_especies`, `core.capacitacion_participantes`, `core.capacitaciones`,
`core.caso_regiones`, `core.cat_ciclos_intervencion`, `core.cat_niveles_alerta`,
`core.cat_perfiles_actor`, `core.cat_roles_funcionales`,
`core.cat_tipos_cambio_caso`, `core.cat_tipos_capacitacion`,
`core.cat_tipos_espacio_dialogo`, `core.cat_tipos_hecho`,
`core.cat_tipos_organizacion`, `core.documento_actores`,
`core.envios_comunicacion`, `core.locales`, `core.log_accesos`,
`core.mesa_miembros`, `core.mesas_dialogo`, `core.migracion_conflicto`,
`core.suscripcion_notificacion`, `core.usuario_territorio`.

Los parches 9 y 10 añadieron **cuatro más**: `audit.datos_personales_acceso` y,
en `core`, `flujo_definicion`, `flujo_estado` y `proceso_instancia` (§14).

No se encontró ninguna tabla declarada que haya fallado al crearse. Los dos
falsos positivos de la comparación automática fueron:

- `mype.ejecucion_nec` y `pesca.licencia_cites_denp`: el DDL crea primero una
  vista de compatibilidad y después la reemplaza por tabla física con
  `DROP VIEW ... CASCADE; CREATE TABLE ...`. El estado final correcto es tabla.
- `ctx.observaciones_%s`: es un nombre dinámico dentro de
  `core.crear_particion()`, no una tabla declarada.

### 1.3 Vistas y vistas materializadas

| Objeto                                    | Medición |
| ----------------------------------------- | -------: |
| Vistas del modelo                         |   **24** |
| Vistas materializadas del modelo          |    **6** |
| Vistas de PostGIS en `public`             |        2 |
| **Total de vistas + matviews del modelo** |   **30** |

El documento cita 21 vistas en la cabecera y 26 en §3.3. Ninguna de las dos
cifras coincide con la medición, pero **no falta ninguna vista**: el DDL crea 29
(23 vistas y 6 matviews) y todas existen; la 30.ª es
`core.v_actor_datos_personales_seguro`, que añadió el parche 9 (§14). La
diferencia es de conteo/documentación, no de objetos. Las 6 matviews son:

`analytics.mv_compromisos_inter_ministeriales`,
`analytics.mv_dashboard_alta_direccion`,
`analytics.mv_drift_embeddings`,
`analytics.mv_drift_grafo`,
`analytics.mv_tablero_decisional`,
`mype.mv_concentracion_lotes`.

### 1.4 Funciones, triggers, constraints y RLS

| Objeto                         |  Medición |
| ------------------------------ | --------: |
| Funciones del modelo           |    **50** |
| De ellas, funciones de trigger |    **34** |
| Triggers no internos           |    **52** |
| Claves foráneas                |   **589** |
| Restricciones `CHECK`          |   **330** |
| Claves primarias               |   **278** |
| Restricciones `UNIQUE`         |   **137** |
| Índices                        | **1 015** |
| Tablas con RLS                 |    **48** |
| Tablas con RLS forzada         |    **48** |
| Políticas RLS                  |   **173** |

Las **48** tablas con RLS lo llevan en modo `FORCE`. Cuarenta y siete son tablas
`relkind='r'` y la 48 es `agent.llm_call`, que está particionada: por eso un
recuento filtrado por `relkind` da 47 y otro por `pg_class.relrowsecurity` da 48.
Las cuatro tablas nuevas (3 de D17 y la bitácora de `audit`) acienden el total de
claves primarias a 278: la única tabla del modelo sin PK sigue siendo
`core.cronologia_vinculos`. La fila de índices conserva la medición del
2026-10-31, con un criterio de conteo que no es reproducible hoy con `pg_index`.

El documento base cita 18 funciones de trigger / 27 funciones totales, 352 FK, 203 `CHECK`,
514 índices, 32 tablas protegidas y 128 políticas. Son cifras de v8.3; la
medición real es mayor porque incluye v9, las capas nuevas y las 26 tablas de
los parches. **No se detectó ningún objeto de integridad nombrado en el
documento que falte.** Las funciones clave están presentes:

`core.set_audit`, `core.caso_historial`, `core.deriv_limite`,
`core.chk_compromiso`, `core.sync_hito_estado`, `core.crear_particion`,
`core.clasificacion_max`, `kag.actor_nace`, `kag.nombre_cierra_previo`,
`kag.sync_nombre_actual`, `kag.subgrafo`, `ctx.ultima_observacion`,
`agent.run_log_guard`, `policy.contexto_activo`, `policy.reglas_activas`,
`policy.crear_snapshot`, `policy.vencer_reglas`, `staging.promover`.

**Única deuda estructural menor detectada:** `core.cronologia_vinculos` no
tiene `PRIMARY KEY`. Tiene un `CHECK (num_nonnulls(alerta_id, documento_id) = 1)`
y tres índices, pero no impide duplicados exactos. No bloquea la carga; se
recomienda añadir dos índices únicos parciales (ver §7.3).

---

## 2. Cobertura de datos: 103 tablas con datos y 152 vacías

Del total de **255 tablas base del modelo**, 103 tienen filas y 152 están
vacías. “Vacía” no significa “rota”: hay que separar seed pendiente, tabla de
runtime, módulo de expansión y fuente inexistente.

| Schema         | Tablas base | Con datos |  Vacías | Vistas | Matviews |
| -------------- | ----------: | --------: | ------: | -----: | -------: |
| `agent`        |          11 |         2 |       9 |      0 |        0 |
| `analisis`     |           4 |         2 |       2 |      0 |        0 |
| `audit`        |           1 |         1 |       0 |      0 |        0 |
| `avisa`        |           2 |         0 |       2 |      0 |        0 |
| `chat`         |          14 |         0 |      14 |      0 |        0 |
| `community`    |           1 |         0 |       1 |      0 |        0 |
| `config`       |           6 |         6 |       0 |      0 |        0 |
| `consultation` |           4 |         0 |       4 |      0 |        0 |
| `core`         |      **96** |    **74** |  **22** |      2 |        0 |
| `ctx`          |          10 |         2 |       8 |      0 |        0 |
| `domain`       |           4 |         3 |       1 |      0 |        0 |
| `economic`     |           3 |         0 |       3 |      0 |        0 |
| `forecast`     |           3 |         0 |       3 |      0 |        0 |
| `impact`       |           5 |         0 |       5 |      0 |        0 |
| `ind`          |           9 |         1 |       8 |      0 |        0 |
| `kag`          |          30 |         8 |      22 |      0 |        0 |
| `lex`          |          11 |         0 |      11 |      1 |        0 |
| `model`        |           1 |         1 |       0 |      0 |        0 |
| `mype`         |           1 |         0 |       1 |      2 |        1 |
| `pesca`        |           2 |         0 |       2 |      1 |        0 |
| `policy`       |           8 |         2 |       6 |      0 |        0 |
| `proteccion`   |           1 |         0 |       1 |      0 |        0 |
| `qda`          |          10 |         0 |      10 |      0 |        0 |
| `staging`      |           2 |         0 |       2 |      0 |        0 |
| `territorio`   |          16 |         1 |      15 |      1 |        0 |
| `analytics`    |           0 |         0 |       0 |     17 |        5 |
| **Total**      |     **255** |   **103** | **152** | **24** |    **6** |

Lectura de las vacías:

- **Seed pendiente (P0/P1):** `ind.indicador` y sus dependientes
  (`variante`, `plantilla_slot`, `brecha`), `ctx.cat_fuentes`,
  `ctx.zonas_maritimas`, `ctx.variable_fuentes`, `core.capacidad_campo`.
  _(Hasta el parche 5 esta lista incluía también `core.cat_pip_etapas`,
  `config.schema_registry`, `agent.cat_detalle_schema` e `ind.plantilla`.)_
- **Derivado no construido:** `kag.documento_fragmento`,
  `kag.embedding`, `kag.actor_profile*`, `kag.metrica_nodo`, `lex.*`, `qda.*`.
  _(El parche 11 ya pobló `kag.aristas` con las tres relaciones que la base
  declaraba en sus tablas puente.)_
- **Runtime normal:** `agent.run_log`, `agent.llm_call`, `chat.*`,
  `core.notificaciones`, `core.outbox_integracion`, `core.query_cache`,
  `core.permiso_aprobacion`, `staging.*`.
- **Expansión aún no activada:** `forecast.*`, `economic.*`, `community.*`,
  `consultation.*`, `impact.*`, `proteccion.*`.
- **Sin fuente en el legado:** `territorio.*` (solo el catálogo
  `territorio.cat_tipos_lugar` está sembrado), `mype.*`, `pesca.*`,
  `domain.artefacto`.

No todas las 152 vacías son una brecha para el cutover del legado. Las que sí
impiden afirmar que la “capa de datos v9” está completa se detallan abajo.

---

## 3. Seeds exigidos por el documento que hoy faltan

### 3.1 Catálogos y registros

| Objeto                                  | Filas actuales | Esperado / referencia                                   | Estado                     |
| --------------------------------------- | -------------: | ------------------------------------------------------- | -------------------------- |
| `core.cat_pip_etapas`                   |         **12** | 12 etapas de §1.2.b                                     | **Cerrado (parche 5)**     |
| `ctx.cat_fuentes`                       |          **0** | fuentes de §7.6/§8.7 (ANA, SANIPES, OEFA, campo, …)     | **Falta seed**             |
| `ctx.zonas_maritimas`                   |          **0** | zonas marítimas de C5                                   | **Falta seed**             |
| `ctx.variable_fuentes`                  |          **0** | N:M variable↔fuente                                     | Depende del anterior       |
| `config.schema_registry`                |          **2** | `avisa.raw_ingest` v1 y v2 (§4.2, §4.bis)               | **Cerrado (parche 5)**     |
| `agent.cat_detalle_schema`              |          **1** | JSON Schema de `run_log.detalle` (T66)                  | **Provisional (v1)**       |
| `core.cat_tipos_documento.esquema_json` |    **0 de 15** | JSON Schema por tipo (§3.13)                            | **Falta contenido**        |
| `ind.indicador`                         |          **0** | indicadores estándar de la Tabla 3                      | **Bloqueado por decisión** |
| `ind.variante`                          |          **0** | 4 clases por indicador (estándar/factible/proxy/brecha) | Depende de `ind.indicador` |
| `ind.plantilla`                         |          **3** | 3 plantillas: Anexo 2, Anexo 15, Minister View          | **Cerrado (cabecera)**     |
| `ind.plantilla_slot`                    |          **0** | slots de las 3 plantillas                               | Depende de `ind.indicador` |
| `ind.proxy_justificacion`               |          **0** | justificación de cada variante proxy                    | Depende de `ind`           |
| `ind.seleccion`                         |          **0** | runtime (elección por período)                          | Runtime                    |
| `ind.resultado`                         |          **0** | runtime (cálculo)                                       | Runtime                    |
| `ind.brecha`                            |          **0** | brechas de recolección                                  | Depende de `ind`           |
| `ind.relacion_dependencia`              |          **0** | dependencias entre indicadores                          | Depende de `ind`           |
| `core.capacidad_campo`                  |          **0** | horas disponibles por persona/mes (T46)                 | **Falta seed operativo**   |
| `policy.gobierno`                       |          **0** | período de gobierno (§20.20)                            | **Falta contenido**        |
| `policy.titular`                        |          **0** | autoridades del período                                 | **Falta contenido**        |

Los catálogos que **sí** están sembrados y no requieren acción:

- `core.cat_*`: **32 catálogos, solo `cat_pip_etapas` vacío**. Los demás
  tienen filas: clasificación 3, niveles de conflicto 4, niveles de riesgo 3,
  prioridades 4/3, estados 4/5/5, tipos de documento 15, tipos de actor 7,
  roles de actor 7, temas 7, subsectores 3, especies 39, unidades orgánicas 66,
  tipos de fuente de integración 21, etc.
- `ctx.cat_dominios` 8 y `ctx.cat_variables` **20** (6 base + 14 C4–C6; la
  documentación lista 13 C4–C6 y el DDL añade `TEMPERATURA_AGUA` en §0.6;
  no falta ninguna variable listada).
- `kag.cat_tipos_nodo` 15, `kag.cat_clases_arista` 6,
  `kag.cat_tipos_arista` 19, `kag.cat_corpus` 6.
- `analisis.cat_herramientas` 7 y `analisis.punto_ingesta` 7.
- `policy.cat_tipos_regla` 5; `policy.regla` **10 normas C4–C6**, todas
  `clase='N'`, `estado='vigente'`, con `fuente_documento_id` no nulo.
- `domain.cat_estados_artefacto` 6, `domain.tipo_artefacto` 6,
  `domain.regla_negocio` 3.
- `territorio.cat_tipos_lugar` 9.
- `agent.plantilla_prompt` 4; `model.model_card` 12; `config.*` (salvo
  `schema_registry`) sembrado; `core.feature_flags` 9.

### 3.2 El caso especial de `policy.regla`

Las 10 normas de §8.8 están correctas. Lo que **no** existe es el resto del
contexto de política:

- `policy.gobierno` y `policy.titular` están vacíos, por lo que las 10 reglas
  tienen `gobierno_id` y `titular_id` nulos.
- Las 10 reglas son de clase **N** (normativa). No hay reglas **P**
  (prioridades de gobierno) ni **L** (lentes analíticos), que son las que
  alimentan la Minister View y el contexto de política.
- `policy.escenario`, `policy.escenario_regla`, `policy.snapshot` y
  `policy.snapshot_regla` están vacíos. Los snapshots son runtime, pero los
  escenarios de política (M5a) requieren contenido.

No se propone inventar el gobierno ni las prioridades: es una decisión de
contenido de OAIPCS.

### 3.3 Seed mínimo de `core.cat_pip_etapas`

Las 12 etapas están descritas en §1.2.b. Este es el SQL **aplicado** en el
parche 5 (§10), para que `core.compromiso_pip.etapa_id` deje de apuntar a una
tabla vacía:

```sql
INSERT INTO core.cat_pip_etapas (id, fase_id, numero, nombre) VALUES
 ( 1, 1,  1, 'Identificacion de la brecha'),
 ( 2, 1,  2, 'Registro en el PMI'),
 ( 3, 2,  3, 'Elaboracion del estudio de pre-inversion'),
 ( 4, 2,  4, 'Aprobacion de la viabilidad'),
 ( 5, 2,  5, 'Registro en el Banco de Inversiones'),
 ( 6, 3,  6, 'Elaboracion del expediente tecnico'),
 ( 7, 3,  7, 'Aprobacion del expediente tecnico'),
 ( 8, 3,  8, 'Proceso de seleccion del contratista'),
 ( 9, 3,  9, 'Firma del contrato'),
 (10, 4, 10, 'Ejecucion fisica y financiera'),
 (11, 4, 11, 'Cierre de la inversion'),
 (12, 5, 12, 'Operacion y mantenimiento')
ON CONFLICT DO NOTHING;
```

`fase_id` 1–5 corresponde a Programación, Pre-inversión, Inversión, Ejecución y
Funcionamiento. La fase 6 (`Desactivado`) no tiene etapas en la Guía.

---

## 4. El grafo KAG: de almacén de entidades a red de vínculos

**Estado al 2026-11-18.** El parche 11 (`docs/parches/P11_GRAFO_KAG.md`) creó los
nodos de demanda y las aristas que la propia base ya declaraba en sus tablas puente.
`kag.nodos` tiene **1 520 filas**: 1 160 actores, 325 demandas y 35 casos.
`kag.aristas` tiene **450 filas**:

| Arista         | Origen → destino | Filas | De dónde sale           |
| -------------- | ---------------- | ----: | ----------------------- |
| `PARTICIPA_EN` | actor → caso     |    60 | `core.casos_actores`    |
| `EXIGE`        | actor → demanda  |    98 | `core.demandas_actores` |
| `MIEMBRO_DE`   | actor → actor    |   292 | `core.actor_membresia`  |

`MIEMBRO_DE` es actor→actor porque las organizaciones entraron al grafo como
actores. Con esto se puede recorrer participación, exigencia y membresía.

**Lo que sigue faltando.** La capa MACTOR no es funcional todavía:
`kag.actor_profile`, `kag.actor_profile_attribute` y `kag.metrica_nodo` siguen
vacíos (no hay perfiles ni centralidad), y `analytics.vw_mactor_red_actores` sigue
sin la red de alianzas y tensiones.

El legado **sí tiene** más relaciones que pueden alimentar el grafo:

| Fuente ya cargada        | Filas | Uso potencial                  | Estado                          |
| ------------------------ | ----: | ------------------------------ | ------------------------------- |
| `core.actor_membresia`   |   292 | actor ↔ organización           | ya es `MIEMBRO_DE`              |
| `core.casos_actores`     |    60 | actor ↔ caso                   | ya es `PARTICIPA_EN`            |
| `core.alertas_actores`   |   161 | actor ↔ alerta                 | pendiente: falta tipo de arista |
| `core.demandas_actores`  |    98 | actor ↔ demanda                | ya es `EXIGE`                   |
| `core.mesa_miembros`     |    62 | actor ↔ mesa                   | pendiente: falta nodo de mesa   |
| `core.documento_actores` |     0 | autoría documental (sin datos) | sin datos                       |

No se debe hacer un mapeo automático de los 19 tipos de
`kag.cat_tipos_arista` sin una decisión semántica. Las tres aristas creadas son las
que no admiten duda: una membresía es membresía, un vínculo caso↔actor es
participación y un vínculo demanda↔actor es una exigencia. En cambio, una relación
actor↔caso puede ser `PARTICIPA_EN`, `INFLUYE_SOBRE` o `A_FAVOR_DE` según el caso.
**Decisión pendiente:** definir la tabla de equivalencias legado → tipo de arista
para las fuentes que quedan y si la arista se valida por humano
(`es_validado_humano`).

Mientras esa decisión no exista para las fuentes restantes, el KAG cubre solo
participación, exigencia y membresía, y la capa MACTOR no es funcional.

---

## 5. Capas derivadas: KAG/RAG, léxica, cualitativa y analítica

### 5.1 KAG/RAG

| Objeto                                    | Filas | Estado                                                      |
| ----------------------------------------- | ----: | ----------------------------------------------------------- |
| `kag.nodos`                               | 1 520 | Poblado por triggers de actores, casos y demandas           |
| `kag.aristas`                             |   450 | Tres relaciones copiadas de `core`; faltan las documentales |
| `kag.documento_fragmento`                 |     0 | Sin fragmentación de documentos                             |
| `kag.embedding`                           |     0 | Sin embeddings                                              |
| `kag.actor_profile`                       |     0 | Sin perfiles                                                |
| `kag.metrica_nodo`                        |     0 | Sin métricas                                                |
| `kag.hipotesis` / `kag.vacio_informacion` |     0 | Sin hipótesis/vacíos                                        |

La capa RAG (Capa 4) no puede operar sin fragmentos ni embeddings. No es un
problema de DDL: es un pipeline de ingesta que aún no se ejecutó.

### 5.2 Capa léxica `lex.*`

Las 11 tablas de `lex` están vacías y `lex.vw_clases_publicables` devuelve 0.
No hay corpus, términos, clases, coocurrencias ni corridas. Es una capa de
Nivel 1b que depende de datos externos (CSV/IRaMuTeQ), no del legado AVISA.

### 5.3 Capa cualitativa `qda.*`

Las 10 tablas de `qda` están vacías: no hay proyecto, código, segmento,
memo ni exportación REFI-QDA. Igual que `lex`, requiere una fuente cualitativa
que el legado no contiene.

### 5.4 Vistas y matviews

Antes de esta medición, **las 6 matviews tenían 0 filas**. Se refrescaron para
distinguir “caché obsoleta” de “fuente vacía”. Resultado después del
`REFRESH`:

| Matview                                        | Antes | Después | Causa                                                                                                       |
| ---------------------------------------------- | ----: | ------: | ----------------------------------------------------------------------------------------------------------- |
| `analytics.mv_dashboard_alta_direccion`        |     0 |   **9** | Estaba obsoleta                                                                                             |
| `analytics.mv_tablero_decisional`              |     0 |   **9** | Estaba obsoleta                                                                                             |
| `analytics.mv_compromisos_inter_ministeriales` |     0 |       0 | Las 2 integraciones de compromiso apuntan a SESIGUE; la vista solo incluye MEF/MINAM/MINCETUR/MININTER/RREE |
| `analytics.mv_drift_embeddings`                |     0 |       0 | `kag.embedding` vacío                                                                                       |
| `analytics.mv_drift_grafo`                     |     0 |       0 | `kag.metrica_nodo` vacío                                                                                    |
| `mype.mv_concentracion_lotes`                  |     0 |       0 | `mype.ejecucion_nec` vacío                                                                                  |

**Acción:** agregar el `REFRESH` al final del cargador o al runbook de cutover.
No debe quedar como un paso manual que se olvide.

De las 24 vistas ordinarias, 12 devuelven datos y 12 devuelven 0:

| Vista con datos                                 | Filas |
| ----------------------------------------------- | ----: |
| `core.v_actor_datos_personales_seguro`          |   847 |
| `analytics.vw_geo_distrito`                     |   698 |
| `analytics.vw_organizaciones_vigencia`          |   224 |
| `analytics.vw_anexo_17_registro_reportes`       |    42 |
| `analytics.vw_casos_estancados`                 |    35 |
| `analytics.vw_marco_situacional_robustez`       |    35 |
| `analytics.vw_riesgo_sistemico`                 |    35 |
| `analytics.vw_eravisa_survival`                 |    32 |
| `analytics.vw_anexo_15_matriz_conflictividad`   |    22 |
| `analytics.vw_anexo_14_seguimiento_compromisos` |    13 |
| `analytics.vw_anexo_02_panorama_regional`       |    11 |
| `analytics.vw_erop_milestones`                  |     2 |

| Vista vacía                                  | Causa                                      |
| -------------------------------------------- | ------------------------------------------ |
| `analytics.vw_anexo_16_registro_reuniones`   | `core.reuniones_dialogo` vacío             |
| `analytics.vw_carga_campo`                   | `ind.brecha`/`core.capacidad_campo` vacíos |
| `analytics.vw_indicadores_minister`          | `ind.*` vacío                              |
| `analytics.vw_indicadores_obsoletos`         | `ind.relacion_dependencia` vacío           |
| `analytics.vw_mactor_red_actores`            | `kag.aristas` vacío                        |
| `analytics.vw_selecciones_vigentes`          | `ind.seleccion` vacío                      |
| `core.vw_agregacion_compromiso_externo`      | `core.outbox_integracion` vacío            |
| `lex.vw_clases_publicables`                  | `lex.*` vacío                              |
| `mype.inspeccion_cite`                       | `domain.artefacto` sin `inspeccion_cite`   |
| `mype.v_ejecucion_nec_mora_vigente`          | `mype.ejecucion_nec` vacío                 |
| `pesca.cuota_cites_especie`                  | `domain.artefacto` sin `cites_cuota`       |
| `territorio.vw_monitoreo_hidrico_excede_eca` | `ctx.observaciones` vacío                  |

### 5.5 Reuniones, mesas y Anexo 16

`core.mesas_dialogo` tiene **21 filas** y `core.mesa_miembros` **62**, pero
`core.reuniones_dialogo` y `core.reunion_participantes` están vacías. La vista
`analytics.vw_anexo_16_registro_reuniones` usa `core.reuniones_dialogo`, no
`core.mesas_dialogo`; por eso devuelve 0.

El legado tiene `legacy.dim_redaccion` (51 filas) con registros que parecen
reuniones o reportes de reunión, pero **no son una entidad de reunión**: son
documentos. **Decisión pendiente:** ¿se sintetizan reuniones a partir de
`DIM_Redaccion` o se deja el Anexo 16 vacío hasta que exista una fuente de
reuniones? No se debe crear una reunión inventada solo para poblar la vista.

---

## 6. Cobertura del legado y remanente

La carga del legado está cerrada:

- 86 hojas, **4 643 filas de datos** + 86 filas de metadatos en `legacy._hojas`.
- `legacy` tiene 87 tablas, **807 columnas** y 4 729 filas totales (4 643 + 86).
- 76 tablas de `legacy` tienen filas.
- **160 filas quedaron sin destino dedicado** según el acta y el mapa
  (`docs/MAPA_CARGA_LEGADO_A_V9.md` §3.11). El desglose de esa sección suma
  **165**: 142 de workflow + 6 de RADAR + 14 bridges absorbidos en JSON + 3 de
  `dim_responsable` descartadas (162 sin estas últimas). La cifra conciliada y
  su aritmética están en `PLAN` §4.11; ninguna de las tres versiones cambia lo
  que se carga.
  - ~~`fact_proceso_caso` 36 + `fact_proceso_reporte` 99 + `dim_paso_proceso*` 7
    = 142 filas de workflow que v9 aún no modela (D17).~~ **Resuelto el
    2026-11-18 por el parche 10.** Las 142 filas de workflow, más las 5 de
    `dim_estado_proceso`, están escritas: `core.proceso_instancia` **135**
    (36 de caso + 99 de reporte), `core.flujo_definicion` **7** (3 pasos de
    reporte + 4 de caso) y `core.flujo_estado` **5**, con RLS `FORCE` y 4
    políticas. El defecto ya no es «no hay tabla»: es el maestro que falta para
    resolver los enlaces (§14).
  - `fact_red_radar` 1 + `fact_nodo` 1 + bridges 4 = 6 filas de RADAR (D18).
    **Sigue diferido** a `territorio.*`.
  - `bridge_caso_{descencadenantes,impulsores,causas,medios}` 1+5+4+4 = 14
    filas absorbidas en el JSON de análisis de caso.
- 27 filas de `fact_historial_estado` no se cargaron porque sus columnas vienen
  desalineadas (D7); el trigger de v9 reconstruye el historial.

De los 160 remanentes, **D17 dejó de ser una brecha de capa**: las 147 filas del
flujo (142 + 5 de estados) tienen tabla y columna. Queda abierto, por un lado,
D18 (6 filas de RADAR, sin destino); por otro, los maestros que D17 no pudo
resolver: 2 casos `CS-PRODUCE-2026-037/038` que no están en `core.casos`, 18
códigos `PR-001..PR-018` sin maestro de reporte, el buzón `DEST-01` que no es
usuario y los pasos 4–6 sin definición. Ninguna fila se perdió por eso: cada
instancia conserva su código legado en una columna de texto. El detalle, en
§14.

---

## 7. Acciones priorizadas para cerrar la capa de datos

### P0 — sin esto no se puede decir que la capa v9 está completa

1. ~~**Sembrar `ind.*`** con las 3 plantillas del Nivel 1 (Anexo 2, Anexo 15,
   Minister View)~~ **Parcial.** El parche 5 sembró la cabecera de las tres
   plantillas (§8.4). Los indicadores estándar de la Tabla 3 de la Guía siguen
   sin fuente: es la decisión pendiente nº 1 (§8). Sin ellos,
   `ind.plantilla_slot`, `analytics.vw_indicadores_minister`,
   `vw_selecciones_vigentes` y `vw_carga_campo` siguen sin filas.
2. ~~**Sembrar `core.cat_pip_etapas`** con las 12 etapas (§3.3)~~ **Cerrado por
   el parche 5: 12 filas.**
3. ~~**Sembrar `config.schema_registry`** con al menos `avisa.raw_ingest` v1 y
   v2~~ **Cerrado por el parche 5.** v1 es el JSON literal de §4.2; v2 se deriva
   de v1 y sólo añade lo que el DDL impone (fuentes C–G, `tipo_registro`,
   `policy_snapshot_id`). Los `$defs` por tipo de registro siguen pendientes
   porque §4.bis no los especifica.
4. ~~**Sembrar `agent.cat_detalle_schema`** con el JSON Schema versionado de
   `run_log.detalle` (T66)~~ **Cerrado de forma provisional por el parche 5:**
   versión 1 con esquema permisivo, marcado como provisional en su propia
   `description`. T66 sólo será real cuando OAIPCS escriba la versión 2 con los
   campos del detalle.
5. **Definir y sembrar `core.cat_tipos_documento.esquema_json`** para los
   tipos documentales que lo requieran (anexos 4–9); hoy 0 de 15.
6. **Construir las aristas KAG que faltan** desde las relaciones del legado, con
   una tabla de equivalencia aprobada. Las tres relaciones unívocas ya están
   (450 aristas); falta decidir las demás: `core.alertas_actores` (161) y
   `core.mesa_miembros` (62) no tienen tipo de arista asignado.
7. **Refrescar las matviews al final del cargador** y añadir una comprobación
   de “matview poblada” al `--verify`. El parche 5 ya incluye el `REFRESH` no
   concurrente de las 6 vistas, así que `./scripts/db.sh apply` no deja caché
   obsoleta; falta llevarlo también al cierre del cargador.
8. **Sembrar `ctx.cat_fuentes`, `ctx.zonas_maritimas` y
   `ctx.variable_fuentes`** si se va a operar la capa C5/C6. No hay seed en el
   DDL.

### P1 — necesario para operar el modelo, no para que exista

9. **`policy.gobierno` / `policy.titular` y reglas P/L.** Las 10 normas están;
   falta el contexto de gobierno y los lentes. Sin P/L, la Minister View no
   tiene prioridades ni lentes que aplicar.
10. **`core.capacidad_campo`** (horas por persona/mes) e **`ind.brecha`** para
    que T46 y `vw_carga_campo` sean operables.
11. **Decidir `core.reuniones_dialogo`**: ¿se puebla desde
    `legacy.dim_redaccion` o se espera una fuente de reuniones? Mientras no se
    decida, el Anexo 16 queda vacío.
12. **Decidir el destino de `territorio.*`**: el legado no tiene caletas,
    estaciones ni plantas; solo geografía administrativa en `core.*`. Si se
    quiere el módulo territorial, hay que definir la fuente (datos abiertos o
    carga manual).
13. **Añadir PK o unicidad a `core.cronologia_vinculos`**:
    ```sql
    CREATE UNIQUE INDEX ux_cronologia_alerta
      ON core.cronologia_vinculos (cronologia_id, alerta_id)
      WHERE alerta_id IS NOT NULL;
    CREATE UNIQUE INDEX ux_cronologia_documento
      ON core.cronologia_vinculos (cronologia_id, documento_id)
      WHERE documento_id IS NOT NULL;
    ```
14. **Incorporar la suite de pruebas del documento.** Hoy existen
    `backend/test_v9_edicion_sesigue.py` (requiere `AVISA_TEST_DSN`), `migration/test_decisions.py` y 14 pruebas de migración. **No existen**
    `test_ddl_v8_3.sql` ni `test_ddl_v8.2.py`, y por tanto no es reproducible
    la afirmación de 75 pruebas T1–T75 ni el contrato T76–T90.
15. **Revisar los 160/162 remanentes del legado** si se exige paridad total con
    AVISA 2026. El bloque de workflow (142 filas, D17) quedó cerrado por el
    parche 10; de él solo faltan maestros. RADAR (6 filas, D18) sigue sin tabla
    de destino (§14).

### P2 — capas de roadmap, no bloquean el cutover

16. Poblar `kag.documento_fragmento` y `kag.embedding` para RAG.
17. Poblar `lex.*` y `qda.*` con datos reales.
18. Activar `forecast.*`, `economic.*`, `community.*`, `consultation.*`,
    `impact.*` y `proteccion.*` cuando arranquen M1–M13.
19. Poblar `agent.run_log`, `agent.llm_call`, `chat.*` cuando los agentes
    entren en operación.
20. Resolver la base legal y retención de PII (`actor_datos_personales`):
    el marcador `LEGADO_AVISA_2026` debe sustituirse antes de exponer la tabla
    fuera de `administrador` (ya señalado en el acta). El parche 9 cerró la
    exposición del dato en claro —cifrado, vista sin PII y descifrado auditado
    (§14)—, pero no la base legal ni la retención, que siguen siendo decisión
    de OAIPCS.

---

## 8. Decisiones que aún faltan antes de ejecutar la migración

Aunque la carga del legado ya ocurrió, estas decisiones siguen abiertas para
que la capa v9 quede cerrada:

| #   | Decisión                                                                                        | Por qué bloquea                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Qué indicadores de la Tabla 3 se siembran, con código, definición, componente y anexo           | `ind.indicador` y sus dependientes no se pueden inventar (las 3 plantillas ya están sembradas)         |
| 2   | Qué JSON Schema corresponde a cada tipo documental (anexos 4–9)                                 | Sin `esquema_json` no se valida `documentos.contenido_json`                                            |
| 3   | Qué esquema versionado usa `run_log.detalle`                                                    | T66 no es ejecutable                                                                                   |
| 4   | Qué mapeo legado → `kag.cat_tipos_arista` se aprueba                                            | El grafo no se puede poblar sin semántica                                                              |
| 5   | Si `DIM_Redaccion` se convierte en `reuniones_dialogo` o sigue solo como documentos             | Anexo 16 vacío                                                                                         |
| 6   | Si se siembra `territorio.lugares` desde geografía administrativa o se espera fuente de caletas | 15 de 16 tablas territoriales vacías                                                                   |
| 7   | Si se siembran `policy.gobierno`/`titular` y reglas P/L                                         | Ministerio View sin prioridades/lentes                                                                 |
| 8   | Si `ctx.cat_fuentes` y `ctx.zonas_maritimas` se siembran ahora o en F1b                         | C5/C6 no operable                                                                                      |
| 9   | Si el `REFRESH` de matviews va en el cargador o en un job                                       | Riesgo de caché obsoleta                                                                               |
| 10  | Si se añade PK/unique a `core.cronologia_vinculos`                                              | Duplicados silenciosos                                                                                 |
| 11  | Quién mantiene la suite T1–T90 y con qué datos                                                  | La integridad no es reproducible                                                                       |
| 12  | Si se abre D18 (RADAR): las 6 filas siguen diferidas                                            | D17 ya está cargado (parche 10); solo RADAR queda fuera                                                |
| 13  | Qué `$defs` tiene cada valor de `tipo_registro` en `avisa.raw_ingest.v2`                        | La v2 sembrada valida la envoltura, no el detalle de cada ruta C–G                                     |
| 14  | Cómo se normalizan los identificadores de contrato de `agent.plantilla_prompt`                  | `avisa.raw_ingest.v2` usa punto; `pauta_a2.v1`, `minister_view_v1` y `critic_v1` no encajan en `codigo |     | '.' |     | version` |

---

## 9. Checklist de cierre y verificación

### 9.1 Aplicar seeds (después de aprobar contenido)

```sql
-- 1) Etapas PIP (SQL exacto en §3.3) ....................... APLICADO (parche 5)
-- 2) ind.*: indicadores, variantes, slots y proxy_justificacion  PENDIENTE
--    (la cabecera de las 3 plantillas ya está en el parche 5)
-- 3) config.schema_registry: raw_ingest.v1 y v2 ............ APLICADO (parche 5)
-- 4) agent.cat_detalle_schema: run_log.detalle ............ APLICADO v1 provisional
-- 5) core.cat_tipos_documento.esquema_json ................ PENDIENTE
-- 6) ctx.cat_fuentes / ctx.zonas_maritimas / ctx.variable_fuentes  PENDIENTE
-- 7) policy.gobierno / policy.titular / reglas P y L ...... PENDIENTE
```

Los puntos 1, 3 y 4 (y la cabecera del 2) los aplica
`docs/PREPARACION_V9_CARGA_LEGADO_5.sql`. Los demás siguen requiriendo contenido
que no existe en el repositorio.

### 9.2 Refrescar derivados

```sql
REFRESH MATERIALIZED VIEW analytics.mv_compromisos_inter_ministeriales;
REFRESH MATERIALIZED VIEW analytics.mv_dashboard_alta_direccion;
REFRESH MATERIALIZED VIEW analytics.mv_drift_embeddings;
REFRESH MATERIALIZED VIEW analytics.mv_drift_grafo;
REFRESH MATERIALIZED VIEW analytics.mv_tablero_decisional;
REFRESH MATERIALIZED VIEW mype.mv_concentracion_lotes;
```

`mv_compromisos_inter_ministeriales`, `mv_drift_embeddings`,
`mv_drift_grafo` y `mv_concentracion_lotes` seguirán en 0 hasta que existan
sus fuentes (integraciones de compromiso, embeddings/métricas y lotes MYPE).

### 9.3 Verificar

```bash
python -m migration.loader.run --verify
python -m pytest migration/ -q
python migration/test_decisions.py
```

Y añadir al `--verify` (hoy no lo comprueba):

- `core.cat_pip_etapas` = 12. → **ya lo comprueba `20_verify.sql`**
- `ind.plantilla` = 3 y `ind.indicador` > 0. → la primera mitad **ya se
  comprueba**; `ind.indicador` sigue en 0 a propósito.
- `config.schema_registry` ≥ 2. → **ya lo comprueba `20_verify.sql`**
- `agent.cat_detalle_schema` ≥ 1. → **ya lo comprueba `20_verify.sql`**
- `kag.aristas` > 0 (cuando se decida el mapeo).
- matviews `mv_dashboard_alta_direccion` y `mv_tablero_decisional` > 0.
- `core.cronologia_vinculos` sin duplicados.

### 9.4 Consulta reproducible de tablas vacías

```sql
WITH t AS (
  SELECT n.nspname AS s, c.relname AS r
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p')
     AND NOT c.relispartition
     AND n.nspname NOT IN ('legacy','public','pg_catalog','information_schema')
), x AS (
  SELECT s, r,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM %I.%I', s, r),
                             false, true, '')))[1]::text::int AS filas
    FROM t
)
SELECT s AS schema, count(*) FILTER (WHERE filas = 0) AS vacias,
       string_agg(r, ', ' ORDER BY r) FILTER (WHERE filas = 0) AS tablas
  FROM x
 GROUP BY s
 ORDER BY s;
```

Esta consulta se ejecutó con el rol `avisa` (superusuario de esta instancia),
por lo que las políticas RLS no ocultaron filas. En una sesión de aplicación
hay que fijar `app.clasificacion_max` y `app.user_id` antes de medir.

---

## 10. Patch 5 aplicado (2026-10-31)

Archivo: `docs/PREPARACION_V9_CARGA_LEGADO_5.sql` (montado como
`/opt/avisa/sql/95_patch_05.sql`). Es idempotente: se aplicó dos veces seguidas
y la segunda corrida insertó `0` filas en las cinco sentencias.

### 10.1 Qué quedó sembrado

| Objeto                     | Antes | Después | Contenido                                                                |
| -------------------------- | ----: | ------: | ------------------------------------------------------------------------ |
| `core.cat_pip_etapas`      |     0 |  **12** | Las 12 etapas de §1.2.b, `id` 1–12, fase 1–5                             |
| `config.schema_registry`   |     0 |   **2** | `avisa.raw_ingest` v1 (JSON literal de §4.2) y v2                        |
| `agent.cat_detalle_schema` |     0 |   **1** | versión 1, esquema permisivo marcado como provisional                    |
| `ind.plantilla`            |     0 |   **3** | Anexo 2, Anexo 15 y Minister View, con `tipo_documento_id` NULL          |
| `ind.plantilla_slot`       |     0 |       0 | sigue vacío: `indicador_id` es NOT NULL y no hay catálogo de indicadores |
| `ind.indicador`            |     0 |       0 | **no se sembró a propósito** (ver §10.2)                                 |

La v2 de `config.schema_registry` **no se copió a mano**: se deriva de la v1 con
`jsonb_set` dentro de la misma transacción, así que sólo difiere en lo que el
DDL ya impone (fuentes C–G, `tipo_registro`, `policy_snapshot_id`) y no puede
desincronizarse de la parte común.

### 10.2 Por qué `ind.indicador` sigue en 0

El documento remite a “los indicadores de la Tabla 3 de la Guía” y a un
inventario de 54 indicadores que **no están en este repositorio**. El legado
AVISA 2026 tampoco trae catálogo de indicadores: se revisaron las 86 hojas y no
existe ninguna hoja de indicadores. Sembrar códigos, definiciones,
`componente_guia` o `anexo_origen` inventados contaminaría `ind.variante`,
`ind.plantilla_slot`, `ind.resultado` y `analytics.vw_indicadores_minister`.

Por eso el parche siembra la **cabecera** de las tres plantillas (que el
documento sí nombra) y deja el catálogo de indicadores a la decisión nº 1 de
§8. Es la diferencia entre “existe la estructura” y “existe el contenido”:
`ind.plantilla` tiene 3 filas, `ind.plantilla_slot` tiene 0.

### 10.3 Convención de identificadores de esquema

`config.schema_registry` guarda `codigo` y `version` por separado. El parche usa
`codigo = 'avisa.raw_ingest'` y `version = 'v1' | 'v2'`, de modo que
`codigo || '.' || version` reproduce **literalmente** el valor que ya existe en
`agent.plantilla_prompt.output_schema_id` para A1 (`avisa.raw_ingest.v2`).

Las otras tres plantillas de prompt usan formas que no encajan en esa
convención (`pauta_a2.v1`, `minister_view_v1`, `critic_v1`); normalizarlas es la
decisión pendiente nº 14 de §8. No se inventaron filas para ellas.

### 10.4 Cableado y verificación

El parche se agregó al entorno, no se aplicó a mano:

- `compose.yaml` → bind mount `docs/PREPARACION_V9_CARGA_LEGADO_5.sql` como
  `/opt/avisa/sql/95_patch_05.sql`.
- `docker/postgres/initdb/10_apply_v9.sql` → lo ejecuta después del parche 4.
- `scripts/db.sh apply` → lo ejecuta después del parche 4.
- `docker/postgres/initdb/20_verify.sql` → valida los cuatro seeds nuevos.

**`20_verify.sql` también se corrigió.** Comparaba los catálogos contra valores
**exactos** (`cat_especies <> 5`, `cat_unidades_organicas <> 1`) y por eso
`./scripts/db.sh verify` **fallaba** en la base ya cargada (39 especies, 66
unidades). Ahora compara contra **mínimos**, que es lo correcto: el legado
agranda los catálogos, no los reduce. Esto era un bloqueo real: la rutina de
verificación del entorno no era válida después de la carga.

Salida medida tras aplicar el parche:

```
NOTICE:  verificación OK: PostGIS + pgvector, 3 tablas de territorio, parches 1-5 y catálogos sembrados
```

| Control                    | Valor |
| -------------------------- | ----: |
| `cat_pip_etapas`           |    12 |
| `config.schema_registry`   |     2 |
| `agent.cat_detalle_schema` |     1 |
| `ind.plantilla`            |     3 |
| `ind.indicador`            |     0 |

Y las tres validaciones del cargador siguen pasando **después** del parche:

- `python -m migration.loader.run --verify` → todas las comprobaciones OK.
- `python -m pytest migration/ -q` → **14 passed**.
- `python migration/test_decisions.py` → todas las comprobaciones OK.

### 10.5 Lo que el parche NO cierra

Ninguno de estos puntos se puede resolver sin contenido o decisiones externas:

- `ind.indicador`, `ind.variante`, `ind.plantilla_slot`, `ind.brecha` (§8 nº 1).
- `core.cat_tipos_documento.esquema_json` (§8 nº 2).
- Los `$defs` por `tipo_registro` de `avisa.raw_ingest.v2` (§8 nº 13).
- `agent.cat_detalle_schema` v2 real (T66 completo).
- `kag.aristas` (§8 nº 4), `ctx.cat_fuentes` / `ctx.zonas_maritimas` (§8 nº 8) y
  `policy.gobierno` / `policy.titular` / reglas P y L (§8 nº 7).

---

## 11. Conclusión

La capa de datos v9 **no está incompleta por el DDL**: las tablas, vistas,
funciones, triggers, claves y políticas existen y la comparación automática no
encontró objetos declarados ausentes. El déficit es de **contenido y de
derivados**:

- 153 de 255 tablas base están vacías; muchas son runtime o módulos de
  expansión, pero varias son seeds exigidos por el documento.
- El KAG tiene nodos pero no aristas; la capa RAG no tiene fragmentos ni
  embeddings; `lex` y `qda` están vacías.
- Faltan seeds de indicadores (la cabecera de plantillas ya está), fuentes de
  contexto y JSON Schema documentales; las etapas PIP y el registro de esquemas
  quedaron cerrados por el parche 5 (§10).
- Las matviews requieren un `REFRESH` posterior a la carga (dos quedaron
  obsoletas y se corrigieron en esta medición).
- La única deuda estructural menor es la ausencia de PK/unique en
  `core.cronologia_vinculos`.

Con las acciones P0 y P1 de §7, la capa de datos queda alineada con el
documento v9 para el cutover; las P2 corresponden al roadmap de expansión y no
deben bloquear la puesta en marcha del núcleo.

---

## 12. Clasificación de las tablas por función: entrada · proceso · salida

Absorbe el inventario y la clasificación funcional del antiguo
`CLASIFICACION_BASE_V9_EN_VIVO.md` §2 y §3, eliminado del repositorio el
2026-11-18 al quedar íntegramente contenido aquí (su §4 vive en §13). Aquel §1 decía
cuántas tablas hay y el §2 cuántas tienen datos; esta sección responde la pregunta
que faltaba: **para qué sirve cada tabla en el flujo**. De ahí sale el reparto que
decide qué se automatiza y qué no.

Las mediciones de esta sección son del **2026-11-01**, anteriores a los parches
5–10; los conteos de §1–§2 son los vigentes de hoy. Aquí manda la **función**, no
el recuento. Las cuatro tablas que añadieron los parches 9–10 no están
clasificadas en este inventario: `core.flujo_definicion` y `core.flujo_estado` son
vocabulario (**INF**), `core.proceso_instancia` es proceso (**P**) y
`audit.datos_personales_acceso` es transversal (**INF**).

| Clase                   | Definición                                                        |
| ----------------------- | ----------------------------------------------------------------- |
| **I · Entrada**         | Donde aterriza o aterrizará el dato del mundo.                    |
| **O · Salida**          | Se deriva de datos ya presentes; reproducible con la misma base.  |
| **P · Proceso**         | Intermedios de extracción, pauta, síntesis y su trazabilidad.     |
| **INF · Transversal**   | No es contenido: catálogos, parámetros, geografía, integraciones. |
| **X · Archivo / vacía** | No participa del flujo; se conserva por auditoría.                |

**Diagnóstico de una línea**: lo que existe es el **pasado** (`legacy`) copiado al
**presente** (`core`); lo que falta es el **proceso** (`agent`, `avisa`, `staging`,
`ind` están vacíos). La base es hoy un sistema de registro, no de inteligencia.

### 12.1 Entrada (I) — 31 tablas

**I-a · Captura cruda (vacía, y es el diseño correcto)**

| Tabla                                            | Filas | Qué recibirá                                          | Código legacy que sustituye                                                 |
| ------------------------------------------------ | ----: | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `avisa.raw_ingest` (+5 particiones, `_rejected`) |     0 | Texto, audio o JSON del canal WhatsApp y carga manual | `guardarCaso`, `guardarHecho`, `guardarAlerta`, `guardarRR`, `guardarClima` |
| `staging.lote`, `staging.registro`               |     0 | Importaciones externas validadas por esquema          | `subirEvidencia*`, carga de Excel                                           |
| `ctx.captura`                                    |     0 | Material recolectado (v10 §7.5)                       | —                                                                           |

**I-b · Hechos del dominio (todo cargado desde el legado)**

| Tabla                                                               |        Filas | Procedencia                                                           |
| ------------------------------------------------------------------- | -----------: | --------------------------------------------------------------------- |
| `core.actores`                                                      |        1 160 | `dim_actores` 828 + `dim_actores_estado` 108 + `dim_organizacion` 224 |
| `core.organizaciones`                                               |          224 | `dim_organizacion` (la misma entidad vista como organización)         |
| `core.demandas`                                                     |          325 | `legacy.dim_demandas` + `bridge_alerta_demandas`                      |
| `core.documentos`                                                   |          153 | `dim_redaccion` 51 + `dim_coordinacion_tecnica` 4 + PDFs de 8 tipos   |
| `core.alertas_tempranas`                                            |           83 | `dim_alertas`                                                         |
| `core.caso_cronologia`                                              |           80 | `fact_hechos_casos`                                                   |
| `core.casos`                                                        |           35 | `fact_casos`                                                          |
| `core.locales`                                                      |           27 | `dim_locales`                                                         |
| `core.mesas_dialogo` + `mesa_miembros`                              |      21 / 62 | `dim_mesas_grupos`                                                    |
| `core.envios_comunicacion`                                          |           17 | `LOG_Envios`                                                          |
| `core.compromisos` / `hitos_compromiso`                             |       8 / 12 | `dim_acciones_hitos` / `dim_hitos`                                    |
| `core.capacitaciones` + participantes                               |        1 / 9 | `dim_capacitaciones`                                                  |
| `core.caso_regiones` / `caso_distritos`                             |      81 / 23 | bridges                                                               |
| `core.casos_actores` / `alertas_actores`                            |     60 / 161 | bridges                                                               |
| `core.demandas_actores` / `demandas_evidencias` / `alerta_especies` | 98 / 77 / 30 | `bridge_alerta_recurso` y otros                                       |

**I-c · Identidad y seguridad**: `core.usuarios` (32), `usuario_roles` (34),
`usuario_territorio` (25), `actor_datos_personales` (847, PII cifrada),
`actor_membresia` (292). Todo con `origen_dato='AVISA_HISTORICO'`.

> **`dni` no es legible en `core`.** Desde el parche 9 (2026-11-18) las columnas
> `dni`, `email`, `telefono_contacto` y `telefono_raw` de
> `core.actor_datos_personales` están **vacías** (0 valores no nulos) y el dato vive
> en `dni_cifrado`, `dni_hmac`, `email_cifrado` y `telefono_cifrado`. El DNI en
> claro solo se recupera por `core.actor_datos_personales_descifrar(uuid, motivo)`
> —nivel 3, motivo obligatorio, con registro en `audit`— o desde el origen,
> **`legacy.dim_actores.c03`**. La vista `core.v_actor_datos_personales_seguro`
> nunca proyecta el plano.

> **Lectura**: 24 de 31 tablas de entrada tienen datos, pero **todas son historia**.
> La entrada nueva (`raw_ingest`) está en cero. Cualquier cálculo de salida que se
> haga hoy se hace sobre historia congelada.

### 12.2 Proceso (P) — 78 tablas, con una excepción

Es la parte estructuralmente completa y funcionalmente en cero, salvo una
excepción: `core.proceso_instancia`, del parche 10, tiene **135 filas** de flujo
heredadas del legado (§14). No entra en el recuento de 78 porque éste es del
2026-11-01.

| Grupo      | Tablas                                                                                                                                   |  Filas | Función                                                 | Proceso del código que cubre |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------- | ---------------------------- |
| Extracción | `agent.cat_detalle_schema` (1), `config.schema_registry` (2), `agent.run_log_*`, `agent.llm_call_*`                                      |      3 | **A1**: cada mensaje validado contra esquema versionado | P1, P2, P3                   |
| Pauta      | `agent.sesion`, `sesion_paso`, `analisis.plan`, `plan_paso`, `punto_ingesta` (7), `config.a2_transiciones` (10)                          |     17 | **A2**: generador de pautas con máquina de estados      | P4, P5, P7                   |
| Síntesis   | sin tabla propia: usa `core.documentos` + `ind.seleccion`                                                                                |      0 | **A3**: sintetizador                                    | P6                           |
| Prompting  | `agent.plantilla_prompt`                                                                                                                 |      4 | system prompt, few-shot y esquema por agente y versión  | control de A1–A3             |
| Calidad    | `config.guardrail_contract` (25), `agent.feedback_log`, `lessons_learned`, `synthetic_test_cases`                                        |     25 | guardrails deterministas y aprendizaje curado           | transversal                  |
| Grafo      | `kag.nodos` (1 520), `kag.actor_name_history` (1 160), `aristas` (450), `documento_fuente` (10), `embedding`, `comunidad*`, `hipotesis*` | ~2 900 | KAG bitemporal                                          | P5 (triangulación)           |
| Contexto   | `ctx.cat_variables` (20), `cat_dominios` (8), `observaciones_*`                                                                          |     28 | contexto sistémico (ENOS, pobreza)                      | P7                           |
| QDA        | `qda.proyecto`, `codigo`, `segmento`, `libro_codigos`                                                                                    |      0 | codificación cualitativa                                | P4                           |
| Chat       | `chat.repositorio`, `commit`, `rama`, `turno` y 10 más                                                                                   |      0 | historial de conversación tipo Git                      | trazabilidad A2              |

> **Advertencia sobre `kag`**: los 1 520 nodos **no** son conocimiento extraído.
> `kag.nodos` = 1 520 (1 160 actores, 325 demandas y 35 casos), `core.actores` =
> 1 160 y `kag.actor_name_history` = 1 160 exactos; las 450 aristas repiten
> vínculos que ya están en `core`, y `kag.embedding` está en 0. El grafo es **la
> tabla de actores proyectada** más sus vínculos: sirve para resolución de
> entidades, **no es KAG todavía** (ver §4).

### 12.3 Salida (O) — 24 tablas + 19 vistas

| Tabla o vista                                                         |        Filas | Qué renderiza                                                                     | Riesgo                                                           |
| --------------------------------------------------------------------- | -----------: | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `core.cat_tipos_documento`                                            |           15 | **La tabla de salida más importante**: el contrato de 15 tipos con `anexo_numero` | `esquema_json` es NULL en las 15 → ningún documento es validable |
| `ind.plantilla`                                                       |            3 | `anexo_02_panorama_regional`, `anexo_15_matriz_conflictividad`, `minister_view`   | Solo se sembró la cabecera                                       |
| `ind.plantilla_slot`                                                  |            0 | **Ninguna plantilla define qué indicador va en cada espacio**                     | La salida está declarada e inutilizable                          |
| `ind.indicador`, `resultado`, `variante`, `brecha`, `seleccion`       |            0 | Cuadro de mando, Minister View                                                    | Vacías                                                           |
| `core.output_contracts`                                               |            0 | Congelado de la respuesta entregada                                               | Vacía                                                            |
| `analytics.*` (17 vistas)                                             |            — | KPIs y agregados                                                                  | Es `getKPIsReporte`                                              |
| `core.caso_estado_historial`                                          |           35 | Recorrido del proceso                                                             | Escrito por trigger                                              |
| `core.log_accesos`, `envios_comunicacion`, `suscripcion_notificacion` | 857 / 17 / 4 | Logs y destinatarios                                                              | —                                                                |

> **Hallazgo clave O**: las 153 filas de `core.documentos` son URLs de Drive
> (`url_pdf`, `url_lista`, `url_foto`). El sistema actual **no produce salida desde
> datos: la produce a mano y la archiva**. Los 12 `generar*` (≈1 400 líneas) existen
> para re-empaquetar lo que una persona ya escribió. En v10 la salida pasa a
> plantilla + vista; el texto que no se puede derivar lo redacta A3.

### 12.4 Transversal (INF) — 54 tablas

| Grupo                 | Tablas                                                                                                                                                                                          | Filas | Comentario                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catálogos del dominio | `core.cat_*` (38 distintas, 41 tablas)                                                                                                                                                          |  4–66 | `cat_unidades_organicas` 66, `cat_pip_etapas` 12, `cat_tipos_documento` 15. **`cat_especies` dice 5 en `pg_class` y tiene 39 reales**: el estimate estaba desactualizado |
| Geografía             | `core.regiones` (25), `provincias` (70), `distritos` (698)                                                                                                                                      |   793 | Ubigeo cargado y consistente                                                                                                                                             |
| Gobierno transversal  | `config.parametro` (17), `aplicacion` (4), `libreria` (6); `policy.regla` (10), `cat_tipos_regla` (5); `model.model_card` (12); `core.feature_flags` (9), `roles` (9), `cat_clasificacion` (3)  |    70 | **Sin bitácora de uso**: nada registra qué regla se aplicó                                                                                                               |
| Integraciones         | `core.integraciones` (20), `cat_tipos_fuente_integracion` (21), `cat_estados_integracion` (8), `cat_mapeo_estado_externo` (3), `outbox_integracion` (0)                                         |    52 | Adapter SESIGUE declarado, nunca ejercitado                                                                                                                              |
| Expansión sin uso     | `territorio.*` (16), `pesca.*` (2), `mype.*` (1), `proteccion.*` (1), `impact.*` (5), `economic.*` (3), `forecast.*` (3), `consultation.*` (4), `community.*` (1), `domain.*` (4), `lex.*` (11) |   ≈12 | Solo catálogos sembrados                                                                                                                                                 |

### 12.5 Vacías que son de proceso (no son expansión)

Estas tablas de `core` son procesos diseñados que el sistema actual **no
alimenta**. No deben confundirse con la expansión de §12.4; el inventario
completo de vacías está en el Anexo A.

`caso_factores`, `caso_lugares`, `reunion_participantes`, `reuniones_dialogo`,
`derivaciones_alerta`, `planes_accion`, `plan_acciones`, `fuentes_evidencia`,
`permiso_aprobacion`, `riesgo_social_ordinal`, `cambio_normativo`,
`notificaciones`, `query_cache`, `documento_actores`, `acuerdo_ospa_sni`,
`capacidad_campo`, `compromiso_distritos`, `compromiso_pip`,
`compromiso_colaboradores`, `hitos_compromiso_estado_historico`,
`output_contracts`.

El caso más claro es `derivaciones_alerta`: **no tiene escritor**. El flujo de
pendientes del sistema actual vive solo en `core.casos.estado_id`.

### 12.6 Archivo (X) — 87 tablas de `legacy`

- **`legacy.*` (87 tablas, 807 columnas, 4 729 filas)**: las 86 hojas originales
  (4 643 filas de datos) más `_hojas` (86 filas: manifiesto de columnas y filas por
  hoja). Es la única fuente reproducible de la migración (D21). **No se lee en
  producción; no se borra.**

  Las tres cifras están medidas con `count(*)` sobre las 87 tablas, no estimadas. La
  suma declarada en el resto del conjunto documental es **4 649** porque
  `ANALISIS_PORTABILIDAD` Anexo A atribuye 33 filas a `fact_historial_estado`; la
  réplica tiene **27** (`count(*)` y el manifiesto `legacy._hojas` coinciden). Las 86
  hojas suman por tanto **4 643**, y esa es la cifra que usa §6. La de 4 649 se
  mantiene para no romper las citas, según §11.6 de
  `LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md`.

- **9 tablas de `legacy` que confirman que el análisis de conflictividad nunca se
  pobló**: `dim_medios`, `dim_causas`, `dim_impulsores`, `dim_descencadenantes` y
  los 5 bridges causales (`posiciones`, `intereses`, `necesidades`,
  `interes_comunes`, `actor_grupo`). El JSON libre de `fact_analisis_casos` se llevó
  a `core.documentos.contenido_json` con **1 fila**.

### 12.7 Correspondencias ya resueltas (código legacy → tabla v10)

| Componente legacy                                          | Tabla destino v10                                    | Estado                                                |
| ---------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `guardarCaso` / `actualizarCaso` / `avanzarPasoCaso`       | `core.casos` + `caso_estado_historial`               | **Migrado** (35)                                      |
| `guardarAlerta` / `actualizarAlerta`                       | `core.alertas_tempranas`                             | **Migrado** (83)                                      |
| `guardarBridgeDemandas` / `guardarDemandasAlerta`          | `core.demandas` (FK `caso_id` + `alerta_id`)         | **Migrado** (325)                                     |
| `guardarHecho` / `actualizarHecho`                         | `core.caso_cronologia`                               | **Migrado** (80)                                      |
| `guardarActor` / `guardarActorEstado` / `crearActorRapido` | `core.actores` + `actor_datos_personales`            | **Migrado** (1 160)                                   |
| `guardarOrganizacion`                                      | `core.organizaciones`                                | **Migrado** (224)                                     |
| `guardarHito` / `actualizarAvanceHito` / `guardarAccion`   | `compromisos` + `hitos_compromiso`                   | **Migrado** (12)                                      |
| `verificarLogin` / `registrarAcceso`                       | `core.usuarios` + `usuario_roles` + `log_accesos`    | **Migrado** (857 logins, con cuentas de prueba)       |
| `registrarEnvioWA` / `enviarCorreo*`                       | `core.envios_comunicacion`                           | **Migrado** (17), sin `paso_num` ni `rol_remitente`   |
| `agregarActorEstadoACaso`                                  | `core.actores` (`tipo_actor_id=1`) + `casos_actores` | **Resuelto por fusión** de `dim_actores_estado` (108) |
| `getPendientes` + `renderPendientes`                       | `core.casos.estado_id`                               | **Parcial**: sin tabla de derivación                  |
| `getKPIsReporte` (21 indicadores)                          | `analytics.*` + `ind.indicador`                      | **Roto**: `ind.indicador` = 0 filas                   |
| `guardarAnalisisCaso` / `guardarAnalisisRegional`          | `core.documentos` tipo 8 + `contenido_json`          | **Degradado**: 1 fila, JSON plano                     |
| `generarPDFAnalisis` / `generarWordAnalisis`               | `core.documentos` tipo 8 (`url_pdf`)                 | **Degradado**: archiva el PDF, no lo genera de datos  |
| `generarReporteAlerta` / `generarPDFReporte`               | `core.documentos` tipo 13                            | **Degradado** (83 PDFs archivados)                    |
| `guardarRedRadar` / `guardarNodoRadar`                     | `territorio.*`                                       | **Diferido** (D18)                                    |

### 12.8 Lo que el código hace y la base **no tiene dónde poner**

Esto es lo que hay que decidir antes de portar cualquier módulo.

| Componente legacy                                                     | Datos que pide                                                              | Tabla más cercana                                                | Gap real                                                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guardarRR` / `guardarClimaSocial` / `guardarClimaSocialFocalizado`   | `anuncios_acuerdos`, `focos_tension`, `oportunidades`, `riesgos_inmediatos` | `core.documentos` (tipo 1, 2, 3) + `compromisos`                 | **Sin columnas de contenido estructurado.** `dim_anuncios_acuerdos` (0 filas) no tiene sucesora; los acuerdos deberían ser `compromisos`, pero nadie los crea |
| `guardarBridgeDeptos`                                                 | `bridge_caso_depto` con `es_principal`                                      | `caso_regiones` + `caso_distritos`                               | **Falta `es_principal`**: 81 filas de región para 35 casos, sin jerarquía                                                                                     |
| `guardarBridgeRecursos`                                               | `bridge_caso_recurso` (0 filas)                                             | `territorio.*` / `pesca.*`                                       | Sin diseño; los recursos quedaron como catálogo (`cat_especies` 39)                                                                                           |
| `guardarBridgeAnalisis` (causas, impulsores, desencadenantes, medios) | 5 bridges + 4 dimensiones                                                   | `kag.aristas` / `domain.artefacto`                               | Los 4 `dim_*` y los 5 bridges están **vacíos**; no hay tabla sustituta                                                                                        |
| `guardarAnunciosAcuerdos`                                             | `dim_anuncios_acuerdos`                                                     | `core.compromisos`                                               | Requiere normalizar anuncio → compromiso; no está definido                                                                                                    |
| `subirEvidenciaDemanda/Alerta/Caso/Radar`                             | `link_evidencia`                                                            | `demandas_evidencias` (77), `core.documentos`, `caso_cronologia` | **Parcial**: `subirEvidenciaRadar` no tiene destino                                                                                                           |
| `getTodasLasDemandas` (consolidado de 3 orígenes)                     | demanda sin caso ni alerta                                                  | `core.demandas` con ambos NULL                                   | Funciona: 26 demandas «directas» cargadas                                                                                                                     |

### 12.9 Las correspondencias que faltan crear (C1–C8)

No hay ruta de `raw_ingest` a `core`. Cada flecha existe como **tabla**, ninguna
existe como **dato ni como escritor**:

```
avisa.raw_ingest (0)  ──A1──▶  staging.registro (0)  ──HITL──▶  core.casos / caso_cronologia / demandas
                                                                        │
                                              A2 ──▶ analisis.plan (0) ──▶ ind.seleccion (0)
                                                                        │
                                              A3 ──▶ core.documentos (153, todos legacy)
```

| #   | Correspondencia a crear                                      | De                           | A                                           | Bloquea a                           |
| --- | ------------------------------------------------------------ | ---------------------------- | ------------------------------------------- | ----------------------------------- |
| C1  | `raw_ingest.payload_json` → campos tipados de dominio        | `avisa.raw_ingest`           | `core.casos`, `caso_cronologia`, `demandas` | P1–P3 y todo ingreso nuevo          |
| C2  | `raw_ingest.estado` → `staging.registro.errores` → cola HITL | `avisa`, `staging`           | `avisa` → `staging` → `core`                | Todo ingreso asistido               |
| C3  | actores extraídos → resolución de entidad                    | `raw_ingest` (A1)            | `core.actores` + `kag.entity_merge_log`     | P3, P5                              |
| C4  | `analisis.plan` → `ind.seleccion` → `ind.resultado`          | `analisis`, `ind`            | `ind`                                       | P4, P7, KPIs, Minister View         |
| C5  | `core.documentos` → `cat_tipos_documento.esquema_json`       | `ind.plantilla`              | `cat_tipos_documento`                       | O: los 15 tipos sin esquema         |
| C6  | `ind.plantilla_slot` → indicadores por anexo                 | `ind.plantilla`              | `ind.indicador`                             | O: Anexo 2, Anexo 15, Minister View |
| C7  | `compromisos` como sucesor de `dim_anuncios_acuerdos`        | `core.documentos` tipo 1/2/3 | `core.compromisos`                          | Seguimiento de RR y clima           |
| C8  | `derivaciones_alerta` como ruta alerta → caso → punto focal  | `alertas_tempranas`          | `core.casos`                                | Bandeja de pendientes               |

**Ninguna de las ocho exige crear una tabla.** Es el primer trabajo de
implementación y es de cableado.

---

## 13. El defecto real de la migración y la cobertura del origen

Absorbe el §4 de `CLASIFICACION_BASE_V9_EN_VIVO.md` (retirado del repositorio el
2026-11-18). Los conteos se contrastaron con
`python -m migration.loader.run --verify`: **58 de 58 comprobaciones pasan**.

**Nota de numeración: hay dos D17 y dos D18.** En este informe, **D17** es la
decisión de migración «`FACT_Proceso_*` sin workflow» y **D18** es «RADAR sin
destino» (series de `DECISIONES_CARGA_LEGADO_V9.md`): el flujo por pasos de D17
quedó resuelto por el parche 10 (§6 y §14), mientras D18 sigue diferido a
`territorio.*` —`fact_red_radar`, `fact_nodo`, `bridge_radar_actor` y
`bridge_nodo_actor`, ninguna de las cuales existe hoy en la base—. En
`AVISA_PRODUCE_v10.md` §18.bis, en cambio, **D17 es «tercer perfil técnico para
M11–M13»** y **D18 es la política de retención de `mype.ejecucion_nec` y
`pesca.licencia_cites_denp`**: son series de numeración distintas —decisiones de
migración frente a decisiones de producto— y no deben confundirse al citar.

### 13.1 El defecto único de clasificación — **corregido el 2026-11-18**

| Estado           | Medición                                                    | Diagnóstico                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Antes del parche | Documentos en `Otro (sin clasificar)`: **37 de 153** (24 %) | 34 `RED-2026-0xx` de `dim_redaccion` + 3 `CT-2026-00x`. El mapeo dejó **10** `RED-` en tipo 10 y **34** en tipo 15 (no 11/37 como decía esta tabla: esa cifra no cuadraba con `count(*)`). |
| Después          | `Otro`: **3 de 153** (2 %)                                  | El parche 6 movió los 34 `RED-` a Ayuda Memoria (tipo 10). Los 3 `CT-` se quedan: no vienen de `dim_redaccion` y su tipo es criterio de contenido.                                         |

El verificador aceptaba el defecto porque su control era «ningún documento con
tipo nulo», no «ningún documento sin clasificar». **Era una clasificación
incorrecta, no un nulo.**

**Inconsistencia que el parche no resuelve.** De los 51 documentos `RED-%`, 7 ya
estaban en `relatoria` (tipo 11) y 44 quedan en `ayuda_memoria` (tipo 10). Por
título son el mismo producto —acta de reunión—. Si la política es una sola, hay
que decidir si los 7 bajan a 10 o los 44 suben a 11. Es una decisión de OAIPCS,
no de migración. Evidencia y efecto completo: `LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` §11.5.

### 13.2 Lo que parece defecto y no lo es

| Medición                           |   Real en vivo | Por qué no es defecto                                                                                                                |
| ---------------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| Casos sin demanda                  |   **32 de 35** | En `legacy.dim_demandas` solo 3 casos (`CS-PRODUCE-2026-007`, `-020`, `-002`) tienen demandas; sus 64/27/8 filas se cargaron exactas |
| Casos sin cronología               |   **30 de 35** | `legacy.fact_hechos_casos` cubre 5 casos; `core.caso_cronologia` tiene exactamente esos 5 (80 filas)                                 |
| Casos sin actor                    |   **11 de 35** | 24 con actor en `casos_actores`, consistente con la reconstrucción D8                                                                |
| Casos sin `nivel_conflicto`        |              1 | Decisión (b) confirmada por el verificador                                                                                           |
| Alertas con `prioridad` NULL       |              2 | Decisión D47                                                                                                                         |
| Membresías con `valid_from` NULL   |     254 de 292 | Decisión D50                                                                                                                         |
| `log_accesos` de prueba            | 25 sin usuario | Decisión D39 (`11111111`, `1234567`)                                                                                                 |
| `fact_historial_estado` no cargado |    0 en `core` | D7: columnas desalineadas; `caso_estado_historial` tiene 35 filas del trigger                                                        |

### 13.2.bis Cifras del legado verificadas contra la base

| Verificación                                |         Esperado (mapa) |            Real en vivo | Veredicto                            |
| ------------------------------------------- | ----------------------: | ----------------------: | ------------------------------------ |
| `dim_actores` → `core.actores`              | 828 + 108 + 224 = 1 160 |                   1 160 | Correcto                             |
| `dim_actores` personas                      |                     936 |                     936 | Correcto (828 + 108)                 |
| `dim_organizacion` → `organizaciones`       |                     224 |                     224 | Correcto                             |
| `dim_demandas` → `core.demandas`            |                     325 |                     325 | Correcto                             |
| Alertas con caso                            |                      50 |       50 (+33 sin caso) | Correcto (D1)                        |
| Demandas con alerta / con caso              |                222 / 99 |                222 / 99 | Correcto (D20)                       |
| Demandas sin caso ni alerta                 |                      26 |                      26 | Correcto (son las «directas»)        |
| `dim_alertas` → `documentos` tipo 13        |                      83 |                      83 | Correcto                             |
| `cat_especies`                              |                      39 | 39 (`pg_class` decía 5) | Correcto (D22); `reltuples` engañoso |
| `core.locales` / `mesas_dialogo` / `envios` |            27 / 21 / 17 |            27 / 21 / 17 | Correcto                             |
| `core.cat_tematicas`                        |                       7 |                       7 | Correcto                             |

### 13.3 El hallazgo de fondo: cobertura del origen

> **3 de 35 casos tienen demandas · 5 de 35 tienen hechos · 24 de 35 tienen actores.**

La base hereda esa escasez porque el sistema actual registra cada conflicto en **un
párrafo de texto libre** y no lo desagrega. **No es un fallo de carga**: es la
evidencia empírica de que, sin extracción estructurada (P1–P3 del catálogo de
código), cada caso nace sin demandas, sin cronología y sin actores desagregados.

Es también el argumento cuantitativo de la calidad de la información del
`mvp.md` §2.3.ter: un caso con 3 demandas y 0 hechos no sostiene triangulación
posible, y por tanto no puede publicar Marco Situacional.

---

## 14. Estado tras los parches 7–10

Cuatro parches aplicados y verificados sobre la base viva el **2026-11-18**,
después de la medición que sostiene §1–§13. El SQL vive en
`docs/PARCHE_7_GUARDRAILS_G19_G25.sql`, `docs/PARCHE_8_ICD_TOPE_Q40.sql`,
`docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql` y `docs/PARCHE_10_FLUJO_PROCESO_D17.sql`;
el detalle y las verificaciones, en `docs/parches/`. Tres tocan estructura y
contenido; el 7 solo contenido.

| Parche | Objeto                                                                   | Antes                                 | Después                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7      | `config.guardrail_contract`                                              | 18 filas (G1–G18)                     | **25** (G1–G25); `block` 22 / `warn` 3; las 7 nuevas son `block`                                                                                                  |
| 8      | `config.parametro` + `core.icd_aplicar_ajuste()`                         | el ajuste del ICD no tenía tope       | `ICD.ajuste_tope_puntos` = **10**, leído en cada llamada; la función separa `ajuste_propuesto`, `ajuste_aplicado`, `ajuste_recortado` e `icd_final`               |
| 9      | `core.actor_datos_personales` (cifrado)                                  | `dni`, `email` y `telefono` en claro  | plano purgado (0 valores no nulos); `dni_cifrado` **642**, `dni_hmac` **642** (587 distintos), `email_cifrado` **141**, `telefono_cifrado` **606**                |
| 9      | `audit.datos_personales_acceso` (auditoría)                              | no existía                            | **2 241 filas** append-only: rechaza `UPDATE`, `DELETE` y `TRUNCATE`; vista `v_actor_datos_personales_seguro` y `..._descifrar(uid, motivo)` con nivel 3 y motivo |
| 10     | `core.flujo_definicion` · `core.flujo_estado` · `core.proceso_instancia` | 142 filas de workflow sin tabla (D17) | **7 · 5 · 135**; RLS `FORCE` + 4 políticas; 72 instancias con FK real a `alerta_id`                                                                               |

**Qué movió la aguja.** El parche 10 cierra D17 (§6), que era la mayor masa de
hojas clase D. La medición de hoy deja las clases de las 86 hojas así —sobre la
serie declarada de 4 649 filas de §12.6—: **A 14/1 342 · B 48/3 211 · C 11/90 ·
D 2/6 · X 11/0**. En D solo quedan `dim_tipo_actor_radar` (3) y `dim_responsable`
(3); `dim_intervencion`, de 4 filas (`Ciclo-001..004`), pasó a clase B porque es
idéntica a `core.cat_ciclos_intervencion` y el cargador ya la escribe. El parche 9
no añade filas de dominio: vacía el plano y crea el esquema `audit`, que con 2 241
filas pasa a ser el tercer consumidor de filas del modelo tras `core` y `kag`. Los
parches 7 y 8 no crean tablas: siembran contrato y parámetro, y el 8 añade una
función de cálculo que no persiste nada.

**Lo que sigue abierto.**

- **TLS en tránsito.** El contenedor escucha con `ssl=off` y `pg_hba` local en
  `trust`. Cerrarlo exige certificado, `hostssl` y otra imagen: no es un `ALTER`.
- **`pgaudit`.** No está en `pg_available_extensions`; haría falta el paquete
  `postgresql-16-pgaudit`. La trazabilidad de hoy la da
  `audit.datos_personales_acceso`, que es de fila y de aplicación, no de sentencia.
- **`clave_version`.** No hay columna de versión de clave en
  `core.actor_datos_personales`: rotar `APP_CRYPTO_KEY` obliga a re-cifrar todo de
  una vez. Falta la columna, no la decisión de diseño.
- **Las columnas que G21 necesita.** `core.alertas_tempranas` no tiene
  `visibilidad`, `aprobada_por` ni `aprobada_en`. El contrato de G21 está sembrado y
  verificado (parche 7), pero vigila columnas que todavía no existen.
- **La tabla que G25 necesita.** `core.situacion_judicial_restricta` no existe en la
  base, aunque v10 §13.6.bis.v10 y §2.3.bis la definen.
- **Los cuatro frentes de D17.** Las 147 filas del flujo están escritas, pero **29
  de las 135 instancias** conservan al menos un enlace sin maestro. Las categorías
  se solapan; la unión distinta es 29:
  - **2 instancias de caso** cuyo caso no existe en `core.casos`
    (`CS-PRODUCE-2026-037` y `038`);
  - **27 instancias de reporte** cuyo código no resuelve: 18 filas del bloque
    `PR-001..PR-018`, que no tiene maestro de reporte, y 9 filas en 8 códigos
    `AT-2026-19, 27, 29, 31, 33, 34, 35, 39` que no están en
    `core.alertas_tempranas`;
  - **6 instancias** con responsable `DEST-01`, que no es usuario;
  - **9 instancias** en los pasos 4–6, sin definición en el catálogo.

  No se inventaron maestros: cada instancia conserva su código legado en una
  columna de texto.

**Cifras de cabecera.** Tras los parches 6–12 el modelo tiene **26 esquemas** de
producto (el último es `audit`), **279 tablas físicas** (255 lógicas + 24
particiones), **2 366 columnas**, **12 257 filas** (core 6 664 · kag 3 187 · audit
2 241 · config 64 · otros 22 esquemas 101), **103 con datos y 152 vacías**, **589
FK**, 48 tablas con RLS forzada (todas en `FORCE`; una es particionada), **173
políticas** y **60 triggers**. `legacy` no
cambia: 87 tablas, 807 columnas, 4 729 filas. Las cabeceras de §1 y §2 ya están
medidas sobre este estado.

---

## Anexo A — Inventario completo de tablas vacías (153)

Lista exacta medida con la consulta de §9.4, **recalculada después del parche 5**
(que pobló `core.cat_pip_etapas`, `config.schema_registry`,
`agent.cat_detalle_schema` e `ind.plantilla`). No incluye `analytics` porque ese
schema no tiene tablas base; sí incluye sus vistas y matviews en §2.

| Schema         | Tablas vacías                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`        | `feedback_log`, `lessons_learned`, `llm_call`, `llm_call_fragmento`, `modelo_registro`, `run_log`, `sesion`, `sesion_paso`, `synthetic_test_cases`                                                                                                                                                                                                                                                                                                                               |
| `analisis`     | `plan`, `plan_paso`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `avisa`        | `raw_ingest`, `raw_ingest_rejected`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `chat`         | `blame`, `blob`, `cherry_pick`, `commit`, `diff`, `hook`, `merge`, `rama`, `ref`, `reflog`, `remote`, `repositorio`, `stash`, `turno`                                                                                                                                                                                                                                                                                                                                            |
| `community`    | `encuestas_percepcion`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `consultation` | `actores`, `etapas`, `procesos`, `resultados`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `core`         | `acuerdo_ospa_sni`, `cambio_normativo`, `capacidad_campo`, `caso_factores`, `caso_lugares`, `compromiso_colaboradores`, `compromiso_distritos`, `compromiso_pip`, `derivaciones_alerta`, `documento_actores`, `fuentes_evidencia`, `hitos_compromiso_estado_historico`, `notificaciones`, `outbox_integracion`, `output_contracts`, `permiso_aprobacion`, `plan_acciones`, `planes_accion`, `query_cache`, `reunion_participantes`, `reuniones_dialogo`, `riesgo_social_ordinal` |
| `ctx`          | `captura`, `cat_fuentes`, `herramienta`, `observaciones`, `snapshot`, `trabajo_recoleccion`, `variable_fuentes`, `zonas_maritimas`                                                                                                                                                                                                                                                                                                                                               |
| `domain`       | `artefacto`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `economic`     | `anexo_metodologico`, `counterfactual_analysis`, `impact_scenarios`                                                                                                                                                                                                                                                                                                                                                                                                              |
| `forecast`     | `model_drift_log`, `model_registry`, `predictions`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `impact`       | `analisis_recurrencia`, `encuestas_post_resolucion`, `evaluaciones_efectividad`, `indicadores_bienestar`, `lecciones_aprendidas_automaticas`                                                                                                                                                                                                                                                                                                                                     |
| `ind`          | `brecha`, `indicador`, `plantilla_slot`, `proxy_justificacion`, `relacion_dependencia`, `resultado`, `seleccion`, `variante`                                                                                                                                                                                                                                                                                                                                                     |
| `kag`          | `actor_profile`, `actor_profile_attribute`, `anomalia_contextual`, `arista_evidencia`, `aristas`, `atributo_evidencia`, `comunidad`, `comunidad_corrida`, `comunidad_miembro`, `comunidad_resumen`, `contraste`, `documento_fragmento`, `embedding`, `entity_merge_log`, `entity_merge_members`, `hipotesis`, `hipotesis_en_salida`, `hipotesis_evidencia`, `metrica_nodo`, `objetivo`, `saturacion`, `vacio_informacion`, `validacion_hallazgo`                                 |
| `lex`          | `clase`, `clase_termino`, `coocurrencia`, `corpus`, `corpus_documento`, `corrida`, `diccionario`, `diccionario_entrada`, `serie`, `termino`, `uce`                                                                                                                                                                                                                                                                                                                               |
| `mype`         | `ejecucion_nec`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pesca`        | `licencia_cites_denp`, `trazabilidad_qr`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `policy`       | `escenario`, `escenario_regla`, `gobierno`, `snapshot`, `snapshot_regla`, `titular`                                                                                                                                                                                                                                                                                                                                                                                              |
| `proteccion`   | `registro_parametrico`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `qda`          | `codigo`, `exportacion`, `fuente`, `libro_codigos`, `mapeo_pseudonimo`, `memo`, `perdida_roundtrip`, `proyecto`, `segmento`, `segmento_fragmento`                                                                                                                                                                                                                                                                                                                                |
| `staging`      | `lote`, `registro`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `territorio`   | `anomalias_ais`, `caleta_detalle`, `certificaciones_planta`, `cuadricula_sismica`, `desembarcadero_detalle`, `estacion_hidrica_detalle`, `expansion_informal`, `impacto_conflicto_planta`, `lugar_actores`, `lugares`, `parque_industrial`, `patrones_seguridad_caleta`, `planta_detalle`, `terminal_detalle`, `zona_pesca`                                                                                                                                                      |

**Total: 9 + 2 + 2 + 14 + 1 + 0 + 4 + 22 + 8 + 1 + 3 + 3 + 5 + 8 + 23 + 11 + 1 + 2 + 6 + 1 + 10 + 2 + 15 = 153.**
