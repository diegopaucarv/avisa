# Clasificación de la base v9 en vivo — tablas por clase y correspondencias

Fuente: base `avisa` en `avisa-db` (PostgreSQL 16.14 + PostGIS 3.7 + pgvector 0.8.3, `localhost:55433`), consultada el **2026-11-01**. Todo conteo proviene de `count(*)` real sobre la base vivа (`pg_class.reltuples` era `-1` en 185 de 254 tablas, es decir, sin `ANALYZE`; usarlo habría dado ceros falsos).

Complementa `CLASIFICACION_INPUT_PROCESO_OUTPUT.md` (clasificación del **código**); este documento clasifica el **estado de los datos**.

---

## 1. Inventario en vivo

254 relaciones en 27 esquemas. Solo **4 esquemas contienen datos de negocio cargados**; el resto son «cáscaras» con estructura y catálogos.

| Esquema                                                                                                                                                        | Tablas | Vistas |                             Filas de datos | Estado real                                                                                      | Clase               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | -----: | -----------------------------------------: | ------------------------------------------------------------------------------------------------ | ------------------- |
| `core`                                                                                                                                                         |     93 |      1 |                                     ~7 800 | Dominio operativo migrado (solo casos/alertas/demandas/actores)                                  | **I + O**           |
| `legacy`                                                                                                                                                       |     87 |      0 |                                     ~6 900 | Réplica inmutable de las 86 hojas + `_hojas`; toda su fila tiene `origen_dato='AVISA_HISTORICO'` | **Archivo muerto**  |
| `agent`                                                                                                                                                        |     23 |      0 |          **1** (solo `cat_detalle_schema`) | Pipeline de agentes: esquema creado, **cero ejecuciones**                                        | **P (vacío)**       |
| `avisa`                                                                                                                                                        |      8 |      0 |                                      **0** | `raw_ingest` particionada; ninguna captura recibida                                              | **I (vacío)**       |
| `ind`                                                                                                                                                          |      9 |      0 |                  **3** plantillas, 0 slots | Salida declarada **sin contenido**: `ind.plantilla_slot` vacía                                   | **O (vacío)**       |
| `kag`                                                                                                                                                          |     30 |      0 |                1 195 nodos / 1 160 nombres | Grafo = proyección de `core.actores`, no de documentos                                           | **P (derivado)**    |
| `config`, `policy`, `ctx`, `analisis`                                                                                                                          |     40 |      0 |                                    20+18+… | Parámetros sembrados, ningún proceso que los consuma                                             | **INF / P (vacío)** |
| `chat`, `qda`, `lex`, `model`, `forecast`, `impact`, `economic`, `territorio`, `mype`, `pesca`, `proteccion`, `domain`, `consultation`, `community`, `staging` |     51 |      4 | ≈ 0 (12 `model_card`, 9 `cat_tipos_lugar`) | Expansión declarada, sin uso                                                                     | **INF (futuro)**    |
| `analytics`, `public`                                                                                                                                          |      0 |     19 |                                          — | Vistas de lectura desde `core`                                                                   | **O**               |

**Diagnóstico de una línea**: lo que existe en la base es el **pasado** (`legacy`) copiado al **presente** (`core`); lo que falta es el **proceso** (`agent`, `avisa`, `staging`, `ind` vacíos). La base es hoy un sistema de registro, no un sistema de inteligencia.

---

## 2. Clasificación de las tablas

Uso las tres clases del documento anterior más dos auxiliares:

- **I · Entrada**: donde aterriza o aterrizará el dato del mundo.
- **O · Salida**: se deriva de datos ya presentes; reproducible.
- **P · Proceso**: intermedios de extracción, pauta, síntesis y su trazabilidad.
- **INF · Infraestructura/transversal**: no es contenido; gobierna.
- **X · Archivo / vacía**: no participa del flujo; se conserva por auditoría.

### 2.1 ENTRADA (I) — 31 tablas

**I-a · Captura cruda (vacía, es el diseño correcto)**

| Tabla                                             | Filas | Qué recibirá                                       | Corresponde a                                                                               |
| ------------------------------------------------- | ----: | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `avisa.raw_ingest` (+ 5 particiones, `_rejected`) |     0 | Texto/audio/JSON del canal WhatsApp y carga manual | `guardarCaso`, `guardarHecho`, `guardarAlerta`, `guardarRR`, `guardarClima` (código legacy) |
| `staging.lote`, `staging.registro`                |     0 | Importaciones externas validadas por esquema       | `subirEvidencia*`, carga de Excel                                                           |
| `ctx.captura`                                     |     0 | Material recolectado (7.5)                         | —                                                                                           |

**I-b · Hechos del dominio (cargados desde el legado)**

| Tabla                                                                         |              Filas | Procedencia                                                           |
| ----------------------------------------------------------------------------- | -----------------: | --------------------------------------------------------------------- |
| `core.casos`                                                                  |                 35 | `legacy.fact_casos`                                                   |
| `core.alertas_tempranas`                                                      |                 83 | `legacy.dim_alertas`                                                  |
| `core.demandas`                                                               |                325 | `legacy.dim_demandas` + `bridge_alerta_demandas`                      |
| `core.caso_cronologia`                                                        |                 80 | `legacy.fact_hechos_casos`                                            |
| `core.documentos`                                                             |                153 | `dim_redaccion` 51 + `dim_coordinacion_tecnica` 4 + PDFs de 8 tipos   |
| `core.compromisos` / `hitos_compromiso`                                       |             8 / 12 | `dim_acciones_hitos` / `dim_hitos`                                    |
| `core.mesas_dialogo` + `mesa_miembros`                                        |            21 / 62 | `dim_mesas_grupos`                                                    |
| `core.capacitaciones` + participantes                                         |              1 / 9 | `dim_capacitaciones`                                                  |
| `core.locales`                                                                |                 27 | `dim_locales`                                                         |
| `core.envios_comunicacion`                                                    |                 17 | `LOG_Envios`                                                          |
| `core.actores`                                                                |          **1 160** | `dim_actores` 828 + `dim_actores_estado` 108 + `dim_organizacion` 224 |
| `core.organizaciones`                                                         |                224 | `dim_organizacion` (misma entidad, vista de organización)             |
| `core.caso_regiones` / `caso_distritos` / `casos_actores` / `alertas_actores` | 81 / 23 / 60 / 161 | bridges                                                               |
| `core.demandas_actores` / `demandas_evidencias` / `alerta_especies`           |       98 / 77 / 30 | `bridge_alerta_recurso` etc.                                          |

**I-c · Identidad y seguridad**

`core.usuarios` (32) · `usuario_roles` (34) · `usuario_territorio` (25) · `actor_datos_personales` (847, DNI) · `actor_membresia` (292) — todos `AVISA_HISTORICO`.

### 2.2 SALIDA (O) — 24 tablas + 19 vistas

| Tabla / vista                                                                   |        Filas | Qué renderiza                                                                                            | Riesgo                                                               |
| ------------------------------------------------------------------------------- | -----------: | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `core.cat_tipos_documento`                                                      |           15 | **La tabla de salida más importante del sistema.** Es el contrato: 15 tipos, cada uno con `anexo_numero` | `esquema_json` es **NULL en las 15** → ningún documento es validable |
| `ind.plantilla`                                                                 |            3 | `anexo_02_panorama_regional`, `anexo_15_matriz_conflictividad`, `minister_view`                          | Solo se sembró la **cabecera**                                       |
| `ind.plantilla_slot`                                                            |        **0** | **Ninguna plantilla define qué indicador va en cada espacio**                                            | La salida está declarada e inutilizable                              |
| `ind.indicador`, `ind.resultado`, `ind.variante`, `ind.brecha`, `ind.seleccion` |            0 | Cuadro de mando, Minister View                                                                           | Vacías                                                               |
| `core.output_contracts`                                                         |            0 | Congelado de la respuesta entregada al usuario                                                           | Vacía                                                                |
| `analytics.*` (17 vistas)                                                       |            — | KPIs, agregados                                                                                          | `getKPIsReporte` (§ salida del doc anterior)                         |
| `core.caso_estado_historial`                                                    |           35 | Recorrido del proceso                                                                                    | Escrito por trigger                                                  |
| `core.log_accesos`, `envios_comunicacion`, `suscripcion_notificacion`           | 857 / 17 / 4 | Logs y destinatarios                                                                                     | —                                                                    |

> **Hallazgo clave O**: `core.documentos` tiene **153 filas** y todas son URLs en Drive (`url_pdf`, `url_lista`, `url_foto`). El sistema actual **no produce salida desde datos: la produce a mano y la archiva**. Los 12 generadores `generar*` (≈1 400 líneas) existen solo para re-empaquetar lo que una persona ya escribió.

### 2.3 PROCESO (P) — 78 tablas, **todas vacías**

Esta es la parte estructuralmente completa y funcionalmente en cero.

| Grupo          | Tablas                                                                                                                                 |  Filas | Qué haría                                                             | Corresponde a proceso |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -----: | --------------------------------------------------------------------- | --------------------- |
| **Extracción** | `agent.cat_detalle_schema` (1), `config.schema_registry` (2), `agent.run_log_*` (0), `agent.llm_call_*` (0)                            |      3 | **A1** estructurador: cada mensaje validado contra esquema versionado | P1, P2, P3            |
| **Pauta**      | `agent.sesion`, `agent.sesion_paso`, `analisis.plan`, `plan_paso`, `punto_ingesta` (7), `config.a2_transiciones` (10)                  |     17 | **A2** generador de pautas con máquina de estados                     | P4, P5, P7            |
| **Síntesis**   | No hay tabla propia; usa `core.documentos` + `ind.seleccion`                                                                           |      0 | **A3** sintetizador                                                   | P6                    |
| **Prompting**  | `agent.plantilla_prompt`                                                                                                               |      4 | system prompt, few-shot y schema por agente y versión                 | control de A1–A3      |
| **Calidad**    | `config.guardrail_contract` (18), `agent.feedback_log`, `agent.lessons_learned`, `synthetic_test_cases`                                |     18 | Guardrails deterministas y aprendizaje curado                         | transversal           |
| **Grafo**      | `kag.nodos` (1 195), `kag.actor_name_history` (1 160), `kag.aristas`, `documento_fuente` (10), `embedding`, `comunidad*`, `hipotesis*` | ~2 400 | KAG bitemporal                                                        | P5 (triangulación)    |
| **Contexto**   | `ctx.cat_variables` (20), `cat_dominios` (8), `observaciones_*`                                                                        |     28 | Contexto sistémico (ENOS, pobreza)                                    | P7                    |
| **QDA**        | `qda.proyecto`, `codigo`, `segmento`, `libro_codigos`                                                                                  |      0 | Codificación cualitativa                                              | P4                    |
| **Chat**       | `chat.repositorio`, `commit`, `rama`, `turno`, … (14)                                                                                  |      0 | Historial de conversación tipo Git                                    | trazabilidad A2       |

> **Advertencia sobre `kag`**: los 1 195 nodos no son conocimiento extraído. `kag.nodos` = 1 195 y `core.actores` = 1 160, con `kag.actor_name_history` = 1 160 exactos. El grafo es **la tabla de actores proyectada**, no evidencia documental (`kag.aristas` = 0, `kag.embedding` = 0). Sirve para resolución de entidades; **no es KAG todavía**.

### 2.4 INFRAESTRUCTURA (INF) — 54 tablas

| Grupo                 | Tablas                                                                                                                                                                                          | Filas | Comentario                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catálogos del dominio | `core.cat_*` (38 distintas, 41 tablas)                                                                                                                                                          |  4–66 | `cat_unidades_organicas` 66, `cat_pip_etapas` 12, `cat_tipos_documento` 15. **`cat_especies` dice 5 en `pg_class` pero tiene 39 reales** — el estimate estaba desactualizado. |
| Geografía             | `core.regiones` (25), `provincias` (70), `distritos` (698)                                                                                                                                      |   793 | Ubigeo cargado y consistente                                                                                                                                                  |
| Gobierno transversal  | `config.parametro` (16), `aplicacion` (4), `libreria` (6); `policy.regla` (10), `cat_tipos_regla` (5); `model.model_card` (12); `core.feature_flags` (9), `roles` (9), `cat_clasificacion` (3)  |    69 | Sin bitácora de uso                                                                                                                                                           |
| Integraciones         | `core.integraciones` (20), `cat_tipos_fuente_integracion` (21), `cat_estados_integracion` (8), `cat_mapeo_estado_externo` (3), `outbox_integracion` (0)                                         |    52 | Adapter SESIGUE declarado                                                                                                                                                     |
| Expansión sin uso     | `territorio.*` (16), `pesca.*` (2), `mype.*` (1), `proteccion.*` (1), `impact.*` (5), `economic.*` (3), `forecast.*` (3), `consultation.*` (4), `community.*` (1), `domain.*` (4), `lex.*` (11) |  ≈ 12 | Solo catálogos sembrados                                                                                                                                                      |

### 2.5 ARCHIVO / VACÍA (X)

- **`legacy.*` (87 tablas, ≈6 900 filas)**: las 86 hojas originales + `_hojas` (manifiesto con columnas y filas por hoja). Es la única fuente reproducible de la migración (decisión D21 del mapa). **No debe leerse en producción**, pero tampoco borrarse.
- **4 tablas `legacy` vacías con bridge equivalente en `core`**: `dim_medios`, `dim_causas`, `dim_impulsores`, `dim_descencadenantes` y los 5 bridges causales (`posiciones`, `intereses`, `necesidades`, `interes_comunes`, `actor_grupo`). Es decir, **el análisis de conflictividad del legado nunca se pobló**: el JSON libre de `fact_analisis_casos` se llevó a `core.documentos.contenido_json` (1 fila).
- **32 tablas core con 0 filas** que sí son de proceso (no expansión): `caso_factores`, `caso_lugares`, `reunion_participantes`, `reuniones_dialogo`, `derivaciones_alerta`, `planes_accion`, `plan_acciones`, `fuentes_evidencia`, `permiso_aprobacion`, `riesgo_social_ordinal`, `cambio_normativo`, `notificaciones`, `query_cache`, `documento_actores`, `acuerdo_ospa_sni`, `capacidad_campo`, `compromiso_distritos/pip/colaboradores`, `hitos_compromiso_estado_historico`, `output_contracts`. Son procesos diseñados que el sistema actual **no alimenta** (p. ej. `derivaciones_alerta` no tiene escritor: el flujo de pendientes vive solo en `core.casos.estado_id`).

---

## 3. Correspondencias

### 3.1 Del código legacy a las tablas nuevas (qué ya está resuelto)

| Componente del sistema actual                              | Tabla destino v9                                  | Estado                                                  |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `guardarCaso` / `actualizarCaso` / `avanzarPasoCaso`       | `core.casos` + `caso_estado_historial`            | **Migrado** (35)                                        |
| `guardarAlerta` / `actualizarAlerta`                       | `core.alertas_tempranas`                          | **Migrado** (83)                                        |
| `guardarBridgeDemandas` / `guardarDemandasAlerta`          | `core.demandas` (FK `caso_id` + `alerta_id`)      | **Migrado** (325)                                       |
| `guardarHecho` / `actualizarHecho`                         | `core.caso_cronologia`                            | **Migrado** (80)                                        |
| `guardarActor` / `guardarActorEstado` / `crearActorRapido` | `core.actores` (union) + `actor_datos_personales` | **Migrado** (1 160)                                     |
| `guardarOrganizacion`                                      | `core.organizaciones`                             | **Migrado** (224)                                       |
| `guardarHito` / `actualizarAvanceHito` / `guardarAccion`   | `compromisos` + `hitos_compromiso`                | **Migrado** (12)                                        |
| `guardarRedRadar` / `guardarNodoRadar`                     | `territorio.*` (red/nodo sin diseño equivalente)  | **Diferido** (D18)                                      |
| `guardarAnalisisCaso` / `guardarAnalisisRegional`          | `core.documentos` tipo 8 + `contenido_json`       | **Degradado**: 1 fila, JSON plano                       |
| `generarPDFAnalisis` / `generarWordAnalisis`               | `core.documentos` tipo 8 (`url_pdf`)              | **Degradado**: se archiva el PDF, no se genera de datos |
| `generarReporteAlerta` / `generarPDFReporte`               | `core.documentos` tipo 13                         | **Degradado** (83 PDFs archivados)                      |
| `getKPIsReporte` (21 indicadores)                          | `analytics.*` + `ind.indicador`                   | **Roto**: `ind.indicador` = 0 filas                     |
| `getPendientes` + `renderPendientes`                       | `core.casos.estado_id` (sin tabla de derivación)  | **Parcial**                                             |
| `verificarLogin` / `registrarAcceso`                       | `core.usuarios` + `usuario_roles` + `log_accesos` | **Migrado** (857 logins, con cuentas de prueba)         |

### 3.2 Lo que el código del sistema actual hace y la base nueva **no tiene dónde poner**

Esto es lo que hay que decidir antes de portar cualquier módulo.

| Componente legacy                                                     | Datos que pide                                                              | Tabla v9 más cercana                                             | Gap real                                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `guardarRR` / `guardarClimaSocial` / `guardarClimaSocialFocalizado`   | `anuncios_acuerdos`, `focos_tension`, `oportunidades`, `riesgos_inmediatos` | `core.documentos` (`tipo_id` 1, 2, 3) + `compromisos`            | **Sin columnas de contenido estructurado.** `dim_anuncios_acuerdos` (0 filas) no tiene sucesora; los acuerdos deberían ser `compromisos` pero nadie los crea |
| `guardarBridgeDeptos`                                                 | `bridge_caso_depto` con `es_principal`                                      | `core.caso_regiones` + `caso_distritos`                          | **Falta `es_principal`**: no se puede saber cuál es la región/territorio del caso (81 filas en regiones para 35 casos → 2,3 regiones por caso sin jerarquía) |
| `guardarBridgeRecursos`                                               | `bridge_caso_recurso` (0 filas)                                             | `territorio.*` / `pesca.*`                                       | Sin diseño; los recursos pesqueros quedaron como catálogo (`legacy.dim_recurso_pesca` 37, `core.cat_especies` 39)                                            |
| `guardarBridgeAnalisis` (causas, impulsores, desencadenantes, medios) | 5 bridges + 4 dimensiones                                                   | `kag.aristas` / `domain.artefacto`                               | Los 4 `dim_*` y los 5 bridges del legado están **vacíos**; no hay tabla sustituta                                                                            |
| `guardarAnunciosAcuerdos`                                             | `dim_anuncios_acuerdos`                                                     | `core.compromisos`                                               | Requiere normalizar anuncio → compromiso; no está definido                                                                                                   |
| `subirEvidenciaDemanda/Alerta/Caso/Radar`                             | `link_evidencia`                                                            | `demandas_evidencias` (77), `core.documentos`, `caso_cronologia` | **Parcial**: `subirEvidenciaRadar` no tiene destino                                                                                                          |
| `getTodasLasDemandas` (consolidado 3 orígenes)                        | demanda sin caso/alerta («directa»)                                         | `core.demandas` con `caso_id`/`alerta_id` ambos NULL             | **Sin restricción** que lo impida; hoy `demandas` post-2026 legacy tiene 99 con caso y 222 con alerta                                                        |
| `agregarActorEstadoACaso`                                             | actor del Estado en caso                                                    | `core.actores` (`tipo_actor_id=1`) + `casos_actores`             | **Resuelto por fusión** de `dim_actores_estado` (108) en `core.actores`; ya no hay tabla separada                                                            |
| `registrarEnvioWA` / `enviarCorreo*`                                  | `log_envios` (17)                                                           | `core.envios_comunicacion`                                       | **Migrado**, pero sin `paso_num` ni `rol_remitente`                                                                                                          |

### 3.3 Correspondencias que **deben** crearse para el proceso (hoy no existen)

El mapeo de las tres clases deja ver un hueco de diseño: **no hay ruta de `raw_ingest` a `core`**.

```
avisa.raw_ingest (0)  ──A1──▶  staging.registro (0)  ──HITL──▶  core.casos / casos_cronologia / demandas
                                                                        │
                                              A2 ──▶ analisis.plan (0) ──▶ ind.seleccion (0)
                                                                        │
                                              A3 ──▶ core.documentos (153, todos legacy)
```

Cada flecha existe como **tabla**, pero ninguna flecha existe como **dato o como escritor**. Las correspondencias faltantes, en orden de dependencia:

| #   | Correspondencia a crear                                      | De                           | A                                           | Bloquea a                               |
| --- | ------------------------------------------------------------ | ---------------------------- | ------------------------------------------- | --------------------------------------- |
| C1  | `raw_ingest.payload_json` → campos tipados de dominio        | `avisa.raw_ingest`           | `core.casos`, `caso_cronologia`, `demandas` | P1–P3, todos los ingresos nuevos        |
| C2  | `raw_ingest.estado` → `staging.registro.errores` → cola HITL | `avisa`, `staging`           | `avisa`→`staging`→`core`                    | Todo ingreso asistido                   |
| C3  | actores extraídos → resolución de entidad                    | `raw_ingest` (A1)            | `core.actores` + `kag.entity_merge_log`     | P3, P5                                  |
| C4  | `analisis.plan` → `ind.seleccion` → `ind.resultado`          | `analisis`, `ind`            | `ind`                                       | P4, P7, KPIs, Minister View             |
| C5  | `core.documentos` → `core.cat_tipos_documento.esquema_json`  | `ind.plantilla`              | `cat_tipos_documento`                       | O: los 15 tipos sin esquema             |
| C6  | `ind.plantilla_slot` (0 filas) → indicadores por anexo       | `ind.plantilla`              | `ind.indicador`                             | O: Anexo 2, Anexo 15, Minister View     |
| C7  | `compromisos` como sucesor de `dim_anuncios_acuerdos`        | `core.documentos` tipo 1/2/3 | `core.compromisos`                          | Seguimiento de RR/Clima                 |
| C8  | `derivaciones_alerta` (0) como ruta alerta→caso→punto focal  | `alertas_tempranas`          | `core.casos`                                | Bandeja de pendientes (`getPendientes`) |

---

## 4. Correspondencias del legado: verificación contra la base

Todos los conteos fueron contrastados con `python -m migration.loader.run --verify`: **58 de 58 comprobaciones pasan**. La migración está certificada; lo que sigue separa defectos reales de huecos de cobertura del origen.

| Verificación                                |         Esperado (mapa) |                Real en vivo | Veredicto                                                                                      |
| ------------------------------------------- | ----------------------: | --------------------------: | ---------------------------------------------------------------------------------------------- |
| `dim_actores` → `core.actores`              | 828 + 108 + 224 = 1 160 |                       1 160 | **Correcto**                                                                                   |
| `dim_actores` personas                      |                     936 |                         936 | **Correcto** (828 + 108)                                                                       |
| `dim_organizacion` → `organizaciones`       |                     224 |                         224 | **Correcto**                                                                                   |
| `dim_demandas` → `core.demandas`            |                     325 |                         325 | **Correcto**                                                                                   |
| Alertas con caso                            |                      50 |           50 (+33 sin caso) | **Correcto** (D1)                                                                              |
| Demandas con alerta / con caso              |                222 / 99 |                    222 / 99 | **Correcto** (D20)                                                                             |
| Demandas sin caso ni alerta                 |                      26 |                          26 | **Correcto** (son las «directas» de `getTodasLasDemandas`)                                     |
| `dim_alertas` → `documentos` tipo 13        |                      83 |                          83 | **Correcto**                                                                                   |
| `fact_historial_estado`                     |          excluidas (D7) |                 0 en `core` | **Correcto**, pero `caso_estado_historial` tiene **35 filas del trigger**, no 27 reconstruidas |
| `cat_especies`                              |                      39 | **39** (`pg_class` decía 5) | **Correcto** (D22); el estimate de `reltuples` era engañoso                                    |
| `core.locales` / `mesas_dialogo` / `envios` |            27 / 21 / 17 |                27 / 21 / 17 | **Correcto**                                                                                   |
| `core.cat_tematicas`                        |                       7 |                           7 | **Correcto**                                                                                   |

### 4.1 Lo que **parece** un defecto y no lo es

| Medición                         |   Real en vivo | Por qué no es defecto                                                                                                                                              |
| -------------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Casos sin demanda                |   **32 de 35** | En `legacy.dim_demandas` solo 3 casos (`CS-PRODUCE-2026-007`, `-020`, `-002`) tienen demandas; sus 64/27/8 filas se cargaron exactas. Los otros 32 nunca tuvieron. |
| Casos sin cronología             |   **30 de 35** | `legacy.fact_hechos_casos` cubre **5 casos**; `core.caso_cronologia` tiene exactamente esos 5 (80 filas).                                                          |
| Casos sin actor                  |   **11 de 35** | 24 con actor en `core.casos_actores`, consistente con la reconstrucción D8 desde un bridge de origen inservible.                                                   |
| Casos sin `nivel_conflicto`      |              1 | Decisión (b) confirmada por el verificador.                                                                                                                        |
| Alertas con `prioridad` NULL     |              2 | Decisión D47.                                                                                                                                                      |
| Membresías con `valid_from` NULL |     254 de 292 | Decisión D50.                                                                                                                                                      |
| `log_accesos` de prueba          | 25 sin usuario | Decisión D39 (`11111111`, `1234567`).                                                                                                                              |

### 4.2 El único defecto real de migración

| Medición                              |         Real en vivo | Diagnóstico                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentos en `Otro (sin clasificar)` | **37 de 153** (24 %) | Son `RED-2026-0xx`, provenientes de `dim_redaccion`. Deberían ser **Ayuda Memoria (tipo 10)**; el mapeo dejó 11 en tipo 10 y 37 en tipo 15. El verificador lo acepta porque su control es «ningún documento con tipo nulo», no «ningún documento sin clasificar». **Es una clasificación incorrecta, no un nulo.** |

### 4.3 El hallazgo de fondo: cobertura del origen

Los tres «huecos» de §4.1 revelan el problema que justifica todo el trabajo de IA:

> **3 de 35 casos tienen demandas · 5 de 35 tienen hechos · 24 de 35 tienen actores.**

La base hereda esa escasez porque el sistema actual registra cada conflicto en **un párrafo de texto libre** y no lo desagrega. No es un fallo de carga: es la evidencia empírica de que, sin extracción estructurada (P1–P3), cada caso nace sin demandas, sin cronología y sin actores desagregados.

---

## 5. Resumen ejecutivo

| Clase                 |         Tablas |         Con datos | Lectura                                                                                                                                       |
| --------------------- | -------------: | ----------------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **I · Entrada**       |             31 | 24 (≈7 600 filas) | Todo lo que hay es historia. La entrada nueva (`raw_ingest`) está **en cero**.                                                                |
| **O · Salida**        | 24 + 19 vistas |                 8 | La salida existe como _archivo_ (`153` PDFs), no como _cálculo_. `ind.plantilla_slot` = 0 y `cat_tipos_documento.esquema_json` NULL en 15/15. |
| **P · Proceso**       |             78 |                 4 | Estructura completa, **cero ejecuciones**. `kag` es la tabla de actores proyectada.                                                           |
| **INF · Transversal** |             54 |                22 | Catálogos y parámetros sanos; expansión sin uso.                                                                                              |
| **X · Archivo**       |    87 `legacy` |                86 | Copia inmutable; no leer en producción, no borrar.                                                                                            |

Tres conclusiones operativas:

1. **La base actual no tiene proceso**: el 100 % de los datos es `origen_dato='AVISA_HISTORICO'`. Cualquier cálculo de salida (KPIs, Minister View) hoy daría resultados sobre historia congelada.
2. **La migración está certificada** (`--verify`: 58/58, incluida la integridad referencial). Los «huecos» de relación no son de carga: 3 casos con demanda, 5 con cronología y 24 con actor es exactamente lo que había en origen. El único defecto real es la **clasificación documental: 37 de 153 documentos en `Otro`**, siendo `RED-2026-0xx` que deberían ser Ayuda Memoria (tipo 10).
3. **La ruta `raw_ingest → staging → core` no existe como correspondencia**, aunque sus tres tablas están creadas. Es el primer trabajo de implementación y no requiere crear tablas: solo los 8 cruces C1–C8.

### 5.1 Límites de este análisis

- `pg_class.reltuples` estaba en `-1` para la mayoría de tablas (sin `ANALYZE`), de modo que un `reltuples` habría informado 0 filas falsas; todos los conteos se hicieron con `count(*)`.
- `legacy.*` almacena las hojas crudas en columnas genéricas (`c01…c09`); su interpretación semántica se tomó de `docs/MAPA_CARGA_LEGADO_A_V9.md` y se verificó solo donde confirmaba un conteo.
- No se inspeccionó el contenido de `kag.nodos` columna a columna: la conclusión «es la tabla de actores proyectada» se apoya en la igualdad 1 195 / 1 160 / 1 160 y en que `kag.aristas` y `kag.embedding` están a 0.
- No se evaluó el RLS ni el rendimiento; hay 6 vistas materializadas de `analytics` cuyo estado de refresco no se comprobó.
