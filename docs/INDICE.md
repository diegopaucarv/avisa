# Índice documental — AVISA / SIPRECS (OAIPCS · PRODUCE)

Este archivo es el **punto de entrada único**. Si un documento contradice a otro, manda el que esta tabla marca como autoridad. No se crea ningún documento nuevo sin registrarlo aquí primero.

Última revisión: **2026-11-19** (consolidación del documento padre; estadística absorbida en §11; diccionario de datos unificado y generado; grafo KAG con nodos y aristas; comentarios de tabla y columna escritos en la base; priorización del modelo para el MVP; un solo formato para el nivel de clasificación de los datos; y RLS completo en `core` con el banco de datos registrado —parche 16—).

---

## 1. Jerarquía

```
AVISA_PRODUCE_v10.md  ── autoridad arquitectónica (v10 ⊇ v9)
        │
        ├── mvp.md ──────────── autoridad de ejecución (45 días, SQL Server)
        │        └── PRIORIZACION_MVP_v10.md ── orden de construcción: capas de la v10 y puente de las 55 tablas del MVP
        │                └── mvp_prioridad_tablas.csv · se regenera con migration/prioridad_mvp.py
        │
        ├── DECISIONES_CARGA_LEGADO_V9.md ── autoridad de migración (MIG D1–D51)
        │        └── Anexos A (clases), B y C (absorben `MAPA_CARGA`)
        │
        ├── PLAN_PORTE_LEGADO_V9.md ── especificación de carga (§2 corrige el mapa)
        │        └── Anexo E (mapa de fuentes: el detalle de `ANALISIS_PORTABILIDAD` §3 NO se traslada)
        │
        ├── ACTA_CIERRE_CARGA_V9.md ── cifras certificadas
        ├── LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md ── puente único sistema anterior ↔ v10 (lectura de entrada)
        │        └── §11 (estadística de atributos) y §12 (componentes) viven dentro del documento; SVG en img/*.svg
        ├── BRECHA_CAPA_DATOS_V9.md ── diagnóstico de la base viva (§12–13)
        ├── DICCIONARIO_DATOS.md ── diccionario único de las dos capas (sistema anterior + v10) y su correspondencia
        │        └── versión máquina en diccionario_datos.csv · se regenera con migration/generar_diccionario.py
        └── ENTORNO_DOCKER_POSTGRES.md ── runbook del entorno
```

---

## 2. Estado y destino de cada documento

| Documento                                            | Estado                            | Rol                                                                                                                                                                | Destino                                                             |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `AVISA_PRODUCE_v10.md`                               | **vigente · autoridad**           | arquitectura objetivo; bloques `.v10` y Anexo E (DC-01…DC-12)                                                                                                      | se conserva                                                         |
| `mvp.md`                                             | **vigente**                       | MVP-45 sobre SQL Server; §2.3.bis, §2.3.ter, §2.5 nuevos                                                                                                           | se conserva                                                         |
| `DECISIONES_CARGA_LEGADO_V9.md`                      | **vigente**                       | decisiones MIG D1–D51; recibe Anexos A, B, C                                                                                                                       | se conserva y crece                                                 |
| `PLAN_PORTE_LEGADO_V9.md`                            | **vigente**                       | especificación de carga; su §2 corrige el mapa                                                                                                                     | se conserva y crece                                                 |
| `ACTA_CIERRE_CARGA_V9.md`                            | **vigente**                       | cifras certificadas de la carga                                                                                                                                    | se conserva                                                         |
| `LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md`          | **vigente**                       | **puente único** sistema anterior ↔ v10: qué no cambia, qué cambia, clases, estadística (§11), calidad del dato (§11.6), componentes (§12) y referencias (§13)     | se conserva                                                         |
| `DICCIONARIO_DATOS.md`                               | **vigente · generado**            | diccionario único de las dos capas: 87 tablas del sistema anterior + 255 tablas lógicas de v10, con propósito, claves, relaciones, columnas y correspondencia (§8) | se regenera con `migration/generar_diccionario.py`                  |
| `diccionario_datos.csv`                              | **vigente · generado**            | versión máquina del diccionario: una fila por columna física (3 173)                                                                                               | se regenera con el mismo script                                     |
| `migration/generar_diccionario.py`                   | **vigente**                       | genera el diccionario y el CSV leyendo el catálogo de la base; las particiones heredan la descripción de su padre; sólo lee                                        | se ejecuta                                                          |
| `migration/curacion_v10.py`                          | **vigente**                       | propósito de las 255 tablas lógicas                                                                                                                                | se edita a mano                                                     |
| `migration/curacion_v10_columnas.py`                 | **vigente**                       | descripción de las 2 036 columnas lógicas del modelo v10                                                                                                           | se edita a mano                                                     |
| `migration/generar_comentarios_sql.py`               | **vigente**                       | escribe el parche 12 desde la curaduría y verifica cada tabla y columna contra el catálogo; sólo lee                                                               | se ejecuta                                                          |
| `migration/curacion_vistas.py`                       | **vigente**                       | propósito, tipo y tablas que lee cada vista y matview                                                                                                              | se edita a mano                                                     |
| `migration/curacion_legacy.py`                       | **vigente**                       | propósito de las 87 tablas del sistema anterior y significado de sus columnas documentadas                                                                         | se edita a mano                                                     |
| `ESTADISTICA_LEGADO_V10.md`                          | **eliminado**                     | tabla de 86 correspondencias con filas origen y destino medidas en vivo                                                                                            | absorbido en `LEGADO_A_V10` §11.5; retirado el 2026-11-18           |
| `migration/reporte_estadistica.py`                   | **vigente**                       | mide la base viva, genera seis SVG de atributos e inyecta la tabla de §11.5                                                                                        | se ejecuta; su salida no se edita a mano                            |
| `img/delta_*.svg`                                    | **vigente · generado**            | seis gráficos de atributos lado a lado: `delta_estructura`, `delta_clases_legacy`, `delta_atributos`, `delta_esquemas`, `delta_calidad`, `delta_componentes`       | se regeneran con el script                                          |
| `BRECHA_CAPA_DATOS_V9.md`                            | **vigente**                       | diagnóstico de la base en vivo; recibe §12–§13                                                                                                                     | se conserva y crece                                                 |
| `ENTORNO_DOCKER_POSTGRES.md`                         | **vigente**                       | runbook del contenedor y credenciales                                                                                                                              | se conserva                                                         |
| `FLUJO_BASE_MVP_Y_MIGRACION.md`                      | **vigente**                       | recorrido completo: crear la base del MVP (sección A), cargar el legado, aplicar los parches 6–16, preparar la copia para SQL Server y rehacer desde cero          | se conserva                                                         |
| `PARCHE_6_CIERRE_CUMPLIMIENTO.sql`                   | **vigente · aplicado 2026-11-18** | CHECK de guardrails a G1–G25; 34 documentos `RED-` a `ayuda_memoria`                                                                                               | aplicado en la base viva                                            |
| `PARCHE_7_GUARDRAILS_G19_G25.sql`                    | **vigente · aplicado 2026-11-18** | contrato de guardrails de 18 a 25 filas: las 7 nuevas son `block`                                                                                                  | aplicado en la base viva                                            |
| `PARCHE_8_ICD_TOPE_Q40.sql`                          | **vigente · aplicado 2026-11-18** | Q40: `ICD.ajuste_tope_puntos` = 10 y `core.icd_aplicar_ajuste`                                                                                                     | aplicado en la base viva                                            |
| `PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql`                  | **vigente · aplicado 2026-11-18** | AES-256 de PII, `audit` append-only, vista segura y descifrado auditado                                                                                            | aplicado en la base viva                                            |
| `PARCHE_10_FLUJO_PROCESO_D17.sql`                    | **vigente · aplicado 2026-11-18** | D17: `flujo_definicion` 7, `flujo_estado` 5, `proceso_instancia` 135                                                                                               | aplicado en la base viva                                            |
| `PARCHE_11_GRAFO_KAG.sql`                            | **vigente · aplicado 2026-11-18** | grafo KAG: nodos de caso y demanda, aristas mínimas, tipo `MIEMBRO_DE`, marcas de tiempo y triggers de sincronía                                                   | aplicado en la base viva                                            |
| `PARCHE_12_COMENTARIOS_COLUMNAS.sql`                 | **vigente · aplicado 2026-11-18** | comentario de las 255 tablas lógicas y de 2 036 columnas del modelo v10                                                                                            | aplicado en la base viva                                            |
| `PARCHE_13_CLASIFICACION.sql`                        | **vigente · aplicado 2026-11-18** | nivel de clasificación único: `consultation.procesos` a `smallint`, FK al catálogo y 5 comentarios                                                                 | aplicado en la base viva                                            |
| `PARCHE_14_CIERRE_ERS.sql`                           | **vigente · aplicado**            | brechas del ERS: RLS efectiva con `avisa_app`, alerta con estado, niveles 0–5, enlace territorial y bases legales ligadas al KAG                                   | aplicado en la base viva                                            |
| `PARCHE_15_ROLES_Y_BORRADO.sql`                      | **vigente · aplicado**            | el rol manda: `clasificacion_max()` se deduce de `core.roles`; capacidades crear/editar/eliminar con RLS restrictivas; `avisa_api` como rol de login               | aplicado en la base viva                                            |
| `PARCHE_16_RLS_CORE_Y_DC04.sql`                      | **vigente · aplicado 2026-11-19** | RLS de `core` de 12 a 44 tablas y de 76 a 301 políticas; banco de datos `BD-GSCS` (DC-04) registrado, inscripción pendiente                                        | aplicado en la base viva                                            |
| `AVISA_V10_ESQUEMA_UNIFICADO.sql`                    | **vigente · generado**            | todo el esquema v10 en un solo archivo, sin `\i` externos: sección A (base vacía, parches 1–5) y sección B (post-carga, parches 6–16)                              | se regenera con `migration/consolidar_esquema.py`                   |
| `migration/consolidar_esquema.py`                    | **vigente**                       | compone el archivo unificado con el texto literal del DDL base y de los 16 parches; busca el DDL en `backend/` y en `backups/backend/`; sólo lee                   | se ejecuta                                                          |
| `REVISION_DICCIONARIO_Y_V10.md`                      | **vigente**                       | auditoría del diccionario y del modelo: cobertura de la curaduría, `nivel_clasificacion`, huecos del diseño                                                        | se conserva; todas sus propuestas quedaron aplicadas                |
| `parches/P7_G19_G25.md`                              | **vigente · aplicado 2026-11-18** | informe: guardrail → reason code, casos negativos y verificación                                                                                                   | se conserva                                                         |
| `parches/P8_ICD_Q40.md`                              | **vigente · aplicado 2026-11-18** | informe: parámetro, función, reglas de fallo y verificación                                                                                                        | se conserva                                                         |
| `parches/P9_SEGURIDAD.md`                            | **vigente · aplicado 2026-11-18** | informe: cifras, clave, verificaciones y lo que no resuelve                                                                                                        | se conserva                                                         |
| `parches/P10_FLUJO_D17.md`                           | **vigente · aplicado 2026-11-18** | informe: las tres tablas, RLS y los pendientes de D17                                                                                                              | se conserva                                                         |
| `parches/P11_GRAFO_KAG.md`                           | **vigente · aplicado 2026-11-18** | informe: los seis defectos del grafo, disparadores, aristas mínimas y hallazgos de datos                                                                           | se conserva                                                         |
| `parches/P12_COMENTARIOS.md`                         | **vigente · aplicado 2026-11-18** | informe: cobertura de los comentarios (2 036 de 2 036 columnas lógicas) y efecto en el diccionario                                                                 | se conserva                                                         |
| `parches/P13_CLASIFICACION.md`                       | **vigente · aplicado 2026-11-18** | informe: el catálogo único de clasificación, la conversión de `consultation.procesos` y las 7 comprobaciones                                                       | se conserva                                                         |
| `PRIORIZACION_MVP_v10.md`                            | **vigente · medido**              | orden de construcción: cinco capas de la v10 (31 / 11 / 72 / 22 / 119 tablas) y puente de las 55 tablas del MVP (27 exactas, 17 parciales, 11 a crear)             | se regenera con `migration/prioridad_mvp.py`                        |
| `mvp_prioridad_tablas.csv`                           | **vigente · generado**            | una fila por tabla lógica con capa, filas, dependencias, cargador y causa                                                                                          | se regenera con el mismo script                                     |
| `migration/prioridad_mvp.py`                         | **vigente**                       | mide filas, cargador, dependencias y consumidores, y aplica el contrato del MVP; sólo lee                                                                          | se ejecuta                                                          |
| `avisa_actual/CLASIFICACION_INPUT_PROCESO_OUTPUT.md` | **vigente**                       | clasificación por flujo (entrada / proceso / salida)                                                                                                               | se conserva                                                         |
| `avisa_actual/LEEME.md`                              | **vigente**                       | qué es cada artefacto del sistema en producción                                                                                                                    | se conserva                                                         |
| `ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md`           | **absorbido en parte**            | clases A/B/C/D/X; su **§3 (columna a columna) sigue aquí** como fuente única                                                                                       | → `DECISIONES` Anexo A (totales) + `PLAN` Anexo E (mapa de fuentes) |
| `MAPA_CARGA_LEGADO_A_V9.md`                          | **superado**                      | mapa de carga previo; su §5 tenía afirmaciones corregidas                                                                                                          | → `DECISIONES` Anexos B y C                                         |
| `avisa_actual/CLASIFICACION_BASE_V9_EN_VIVO.md`      | **eliminado**                     | inventario de las 279 tablas (255 lógicas) / 26 esquemas                                                                                                           | absorbido en `BRECHA` §12–§13 y retirado el 2026-11-18              |
| `AVISA_PRODUCE_v9(1).md`                             | **eliminado**                     | texto íntegro contenido en v10 (283/284 encabezados; sólo difiere el título y 57 líneas)                                                                           | absorbido en `AVISA_PRODUCE_v10.md`; retirado el 2026-11-18         |

**Regla de retirada.** Un archivo solo se elimina si su contenido **completo**
vive ya en otro documento verificable, y su retirada se anota en esta tabla. Los
absorbidos que aún conservan algo único (`ANALISIS_PORTABILIDAD` §3, `MAPA_CARGA`
§3, `ACTA`) se quedan.

Retirados el 2026-11-18: `ESTADISTICA_LEGADO_V10.md`, absorbido en
`LEGADO_A_V10` §11.5; `img/delta_documentos.svg`, que era el gráfico del «parche 6»
y desaparece con ese eje; `avisa_actual/CLASIFICACION_BASE_V9_EN_VIVO.md`; y los
siete fragmentos `avisa_actual/js1..js7.html`, que eran un único flujo base64
consolidado en `avisa_actual/legacy_bundle.js` (ver `avisa_actual/LEEME.md`). Ese
mismo día se borró `img/delta_integridad.svg`, un gráfico huérfano de una versión
anterior del script: ni lo regenera `migration/reporte_estadistica.py` ni lo enlaza
documento alguno. También se retiró `_archivo/AVISA_PRODUCE_v9(1).md`: su contenido
íntegro vive en `AVISA_PRODUCE_v10.md` (283 de 284 encabezados idénticos y 3 268 de
3 325 líneas literales; las 57 restantes son el título, una línea reescrita y la tabla
§3.14, que en v10 aparece ampliada). Antes de borrarlo se repuntó el enlace vivo de
`ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` §fuentes a `AVISA_PRODUCE_v10.md`.

Retirados del árbol de trabajo el 2026-11-18: `migration/_tmp_cols.py` y
`migration/_tmp_diff.py` (esbozos sin referencias), `migration/out_v9_columns.txt`
(foto obsoleta del esquema, regenerable con la receta de `migration/README.md`) y
`migration/__pycache__` (que ahora ignora `.gitignore`).

**Parches SQL.** Son dieciséis y se aplican en orden. Los cinco primeros forman parte del
`initdb`; los once últimos se aplican **a mano, después de cargar el legado**.

| #   | Archivo                              | Qué cierra                                                                         | Se aplica en       |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------ |
| 1   | `PREPARACION_V9_CARGA_LEGADO.sql`    | preparación de v9: catálogos y columnas que el legado necesita                     | `initdb` · `91`    |
| 2   | `PREPARACION_V9_CARGA_LEGADO_2.sql`  | huecos columna a columna del `PLAN` §5; 16 tablas de clase D ganan destino         | `initdb` · `92`    |
| 3   | `PREPARACION_V9_CARGA_LEGADO_3.sql`  | cierre de los bloqueos D43–D49                                                     | `initdb` · `93`    |
| 4   | `PREPARACION_V9_CARGA_LEGADO_4.sql`  | membresías sin fecha (D50)                                                         | `initdb` · `94`    |
| 5   | `PREPARACION_V9_CARGA_LEGADO_5.sql`  | seeds de cierre: etapas PIP, schemas y plantillas `ind`                            | `initdb` · `95`    |
| 6   | `PARCHE_6_CIERRE_CUMPLIMIENTO.sql`   | CHECK de guardrails a G1–G25; 34 documentos `RED-` a `ayuda_memoria`               | post-carga · `96`  |
| 7   | `PARCHE_7_GUARDRAILS_G19_G25.sql`    | contrato de 18 a 25 filas; las 7 nuevas son `block` y traen reason code            | post-carga · `97`  |
| 8   | `PARCHE_8_ICD_TOPE_Q40.sql`          | Q40: `ICD.ajuste_tope_puntos` = 10 y `core.icd_aplicar_ajuste`                     | post-carga · `98`  |
| 9   | `PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql`  | cifrado AES-256 de datos personales, `audit` append-only, vista y descifrado       | post-carga · `99`  |
| 10  | `PARCHE_10_FLUJO_PROCESO_D17.sql`    | D17: `flujo_definicion` 7, `flujo_estado` 5, `proceso_instancia` 135               | post-carga · `100` |
| 11  | `PARCHE_11_GRAFO_KAG.sql`            | grafo KAG: nodos de caso y demanda, aristas mínimas y `MIEMBRO_DE`                 | post-carga · `101` |
| 12  | `PARCHE_12_COMENTARIOS_COLUMNAS.sql` | comentario de 255 tablas lógicas y 2 036 columnas del modelo v10                   | post-carga · `102` |
| 13  | `PARCHE_13_CLASIFICACION.sql`        | nivel de clasificación único: tipo, FK y comentarios                               | post-carga · `103` |
| 14  | `PARCHE_14_CIERRE_ERS.sql`           | brechas del ERS: RLS efectiva, alerta con estado, niveles 0–5 y enlace territorial | post-carga         |
| 15  | `PARCHE_15_ROLES_Y_BORRADO.sql`      | el rol manda: nivel desde `core.roles` y capacidades crear/editar/eliminar         | post-carga         |
| 16  | `PARCHE_16_RLS_CORE_Y_DC04.sql`      | RLS de `core` de 12 a 44 tablas; banco de datos `BD-GSCS` (DC-04)                  | post-carga         |

**Por qué los parches 6–16 no van en el `initdb`.** Los parches 6, 9, 10, 11 y 14
dependen de datos que sólo existen después de la carga: el 6 reclasifica documentos
`RED-%`; el 9 y el 10 leen `legacy.dim_actores`, `legacy.dim_paso_proceso` y
`legacy.fact_proceso_*`; el 11 rellena el grafo con las filas ya cargadas, de modo
que en un arranque limpio crearía cero nodos; y el 14 copia el departamento de
`legacy.dim_actores` y crea una fila de proceso por alerta. El 12 no depende de
datos, pero comenta columnas que añade el 11 y se aplica después. El 15 y el 16 se
apoyan en lo ya aplicado: el 16 exige las funciones del 15. Los parches 14–16 no
tienen hueco en el `initdb`: se aplican desde `docs/`, en el orden de la tabla. El
`initdb` se detiene en el parche 5; el procedimiento manual está en
`ENTORNO_DOCKER_POSTGRES.md` **§9**.

Verificación del parche 6: 34/34 filas movidas, 0 `RED-` restantes en tipo 15, y la
instantánea `core.patch6_documentos_snapshot` retirada tras validar. El parche 7 dejó
el contrato de `config.guardrail_contract` en 25 filas (G1–G25): 22 `block` y 3 `warn`.
Los parches 7–13 también quedaron ejecutados y verificados el 2026-11-18; sus cifras
están en los informes de `docs/parches/`. El parche 11 dejó el grafo con 1 520 nodos
y 450 aristas, el 12 con 2 036 columnas comentadas (todas las lógicas del modelo,
porque las 24 particiones heredan la descripción en el diccionario) y el 13 con
59 de 59 columnas de nivel validadas contra un catálogo único. El parche 16 dejó `core`
con 44 de 99 tablas con RLS (eran 12) y 301 políticas (eran 76); su prueba,
`migration/tests/test_16_rls_core.sql`, pasa las 11 comprobaciones con
`SET LOCAL ROLE avisa_app` y datos sintéticos que terminan en `ROLLBACK`.

---

## 3. De dónde salió cada cifra (cadena de autoridad)

La comparación legacy ↔ v10 tiene documento propio (`LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md`),
pero ese documento **no fija cifras**: las hereda de esta cadena y las mide contra la
base. Cuando una cifra del puente y una de estos documentos discrepen, manda el
documento de la cadena y se corrige el puente.

| Salto                        | Documento que lo establece                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| legado (86 tablas) → v9      | `ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` §1.1 (clases A/B/C/D/X) y §5 (las 23 tablas clase D)                   |
| decisiones de esa carga      | `DECISIONES_CARGA_LEGADO_V9.md` (MIG D1–D51)                                                                      |
| corrección del mapa de carga | `PLAN_PORTE_LEGADO_V9.md` **§2** (manda sobre `MAPA_CARGA`)                                                       |
| v9 → v10                     | `AVISA_PRODUCE_v10.md` §0 (mapa de bloques B11–B16) y **Anexo D.2** (puente de nombres)                           |
| cifras de la base viva       | **medición**, no herencia: `migration/reporte_estadistica.py` → `LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` §11.5 |

Totales vigentes tras el ajuste a v10, los parches 6–10 y la corrección de `legacy.dim_intervencion`: **A 14 / 1 342 · B 48 / 3 205 · C 11 / 90 · D 2 / 6 · X 11 / 0** (suman 4 643, el total medido). El desglose y la corrección de la cifra anterior están en `DECISIONES` **Anexo A**. El reparto de las 86 hojas es idéntico en tablas y filas al del análisis de portabilidad; lo único que cambia es el destino de 21 tablas de la clase D, que pasan a B: 16 con el parche 2, 4 con el parche 10 (las 142 filas del flujo por pasos) y 1 con la corrección de `legacy.dim_intervencion`, idéntica a `core.cat_ciclos_intervencion`, que ya existe con sus 4 filas. En D quedan solo `dim_tipo_actor_radar` (3 filas) y `dim_responsable` (3).

**Cifras estructurales (tablas, columnas, FK, RLS, triggers) no se heredan: se
miden.** Se obtienen con `count(*)` tabla por tabla sobre la base viva y quedan en
`LEGADO_A_V10…` §11 (la tabla de correspondencias, en §11.5). La única cifra del
conjunto que no cuadra con la réplica es `fact_historial_estado` (33 declaradas /
27 medidas); la nota que manda está en `DECISIONES` **A.3**.

**Medición del 2026-11-18**, tras los parches 6–13: 26 esquemas AVISA, 279 tablas
físicas (24 particiones, 255 lógicas), 2 366 columnas, 12 257 filas (103 tablas con
datos y 152 vacías), 590 FK, 48 tablas con RLS (todas `FORCE`, contando como una la
particionada `agent.llm_call`), 173 políticas y 60 triggers. `legacy`: 87 tablas,
807 columnas y 4 729 filas. De las 2 366 columnas del modelo, 2 036 tienen comentario
(todas las lógicas) y las 330 restantes son copias de partición que heredan la
descripción de su tabla padre.

Después de esa medición, el parche 16 llevó `core` de 12 a 44 tablas con RLS y de 76 a
301 políticas: 5 tablas tienen columna propia `nivel_clasificacion` (`capacitaciones`,
`mesas_dialogo`, `hitos_compromiso`, `output_contracts`, `log_accesos`) y 26 son de
detalle que heredan el nivel de su padre con `EXISTS`, de modo que la lista de
participantes de una reunión confidencial deja de ser legible para quien no ve esa
reunión. Quedan **55 tablas de `core` sin RLS a propósito** —catálogos `cat_*`,
geografía, roles y configuración de servicio—: no guardan dato personal del actor y
aplicarles nivel rompería las uniones y el login. `core.log_accesos` protege lectura y
corrección y deja abierta la escritura, porque `consulta_lectura` (17 de los 32
usuarios) debe registrar su propio acceso; `core.usuarios` es la otra excepción
deliberada, porque el login tiene que leer el usuario antes de conocer su rol.

El **diccionario** (`DICCIONARIO_DATOS.md`) no fija cifras propias: se genera midiendo
esa misma base, de modo que sus totales coinciden con esta medición por construcción.
Si alguna cifra discrepa, el que está desactualizado es el diccionario y se regenera.

---

### 3.1 Las dos clasificaciones no son la misma

Se confunden porque ambas usan letras para hablar de «clases». Son ejes distintos y
una tabla puede estar en dos a la vez:

| Qué clasifica                 | Documento                                                              | Clases                                     | Unidad                         |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------ |
| **Función en el flujo**       | `avisa_actual/CLASIFICACION_INPUT_PROCESO_OUTPUT.md`                   | I / P / O / INF / M                        | 244 + 450 funciones del código |
| **Función de la tabla viva**  | `BRECHA_CAPA_DATOS_V9.md` **§12**                                      | I / P / O / INF / X                        | 255 lógicas / 279 físicas      |
| **Destino de la hoja legacy** | `ANALISIS_PORTABILIDAD` §1.1 y §5; totales en `DECISIONES` **Anexo A** | A / B / C / D / X                          | 86 hojas                       |
| **Estado del documento base** | este índice §2                                                         | vigente / absorbido / superado / archivado | filas de §2                    |

El desglose I/P/O/INF/X de `BRECHA` **§12** es una medición anterior y no se
reconcilia con las cifras de hoy; lo que sí se sostiene es el conteo. El modelo tiene
**255 tablas lógicas**, 24 de ellas particionadas en **279 relaciones físicas**
(255 + 24 = 279).

**Regla**: A/B/C/D/X describen **destino** (¿dónde cabe?); I/P/O/INF describen
**función** (¿qué hace?). `core.demandas` es clase B para el cargador (cambia la
granularidad) y clase I en el modelo (recibe el dato del mundo). No hay contradicción.

---

## 4. Numeración: qué serie es cuál

Las series se confunden con facilidad porque comparten letra. Son cuatro y no se mezclan:

| Serie           | Qué es                                         | Vive en                         |
| --------------- | ---------------------------------------------- | ------------------------------- |
| `D9`–`D12`      | **diagramas** de clase                         | `v10` §3.12.bis                 |
| `D22`–`D29`     | **decisiones v10** (propuestas)                | `v10` §18.ter                   |
| `MIG D1`–`D51`  | **decisiones de migración**                    | `DECISIONES_CARGA_LEGADO_V9.md` |
| `DC-01`–`DC-12` | **decisiones de cumplimiento** (Ley 29733, IA) | `v10` **Anexo E**               |
| `T91`–`T105`    | pruebas v10                                    | `v10` §22.3.ter                 |
| `T106`–`T110`   | pruebas de cumplimiento                        | `v10` Anexo E                   |

Regla de citación: desde el MVP hacia v10, `[v10 §3.6.v10]`. Desde v10 hacia el MVP, `[MVP §2.3]`. Las secciones del **DDL** se citan siempre con el prefijo, `DDL §4.5.bis`, porque su numeración es independiente de la de v10.

---

## 5. Pendientes que bloquean el cierre

| #   | Pendiente                                                                                   | Quién decide  |
| --- | ------------------------------------------------------------------------------------------- | ------------- |
| 1   | Versión de SQL Server de OGTI: ¿2022+ o proxy para TLS 1.3? (DC-01)                         | OGTI          |
| 2   | Inscripción del banco `BD-GSCS` ante la ANPDP: registrado, no inscrito (DC-04)              | ODP / PRODUCE |
| 3   | Criterio de los 51 documentos `RED-%`: ¿`ayuda_memoria` o `relatoria`? (hoy 44 + 7)         | OAIPCS        |
| 4   | TLS en tránsito, `pgaudit` y custodia/rotación de `APP_CRYPTO_KEY` (no hay `clave_version`) | OGTI + OAIPCS |

**Cerrado, no pendiente: `alta_direccion` y datos personales.** La OAIPCS decidió que
`alta_direccion` puede leer datos personales (nivel 3) y que eso **no** es una violación
de la Ley N° 29733; la Oficial de Datos Personales es, además, `administrador` del
sistema. El punto queda cerrado.

Los pendientes que quedan son de cumplimiento y de infraestructura, no de carga. El
parche 10 dio destino a las 142 filas que no lo tenían, así que no queda ninguna fila
del legado sin casa. El parche 9 dejó cifrados 642 DNI (587 distintos), 141 correos y
606 teléfonos, con 2 241 registros en `audit.datos_personales_acceso`. Lo que falta de
esa serie es el tránsito (TLS), el registro de sentencias (`pgaudit`, que no está en
`pg_available_extensions`) y la custodia de la clave: `APP_CRYPTO_KEY` no tiene
`clave_version`, así que rotarla obliga a re-cifrar todo. El parche 16 cerró además la
seguridad por fila de `core` (44 de 99 tablas protegidas y 301 políticas) y registró el
banco de datos con `fecha_inscripcion_anpdp` en NULL, que significa «trámite pendiente»:
el esquema registra la inscripción, no la tramita, así que DC-04 está **registrado en el
sistema**, no cumplido.

Los 51 documentos `RED-%` se reparten hoy 44 en `ayuda_memoria` (tipo 10) y 7 en
`relatoria` (tipo 11). El traslado de anexos y secciones quedó hecho el 2026-11-18 y ya
no figura aquí.

---

## 6. Cómo se mantiene

1. Los cambios van al documento que esta tabla marca como autoridad, no a un archivo nuevo.
2. Toda decisión nueva entra en su serie (`MIG`, `DC`, `D22–D29`) con su fila de prueba. Sin prueba, no es decisión: es una intención.
3. Al absorber un documento se le pone el encabezado de §7 **antes** de mover nada.
4. Al archivar, se verifica que no queden enlaces vivos: `grep -rn "MAPA_CARGA\|v9(1)" docs/*.md`.
5. `DICCIONARIO_DATOS.md` y `diccionario_datos.csv` no se editan a mano: se regeneran con
   `python migration/generar_diccionario.py` cada vez que cambie el esquema o la carga.
6. `AVISA_V10_ESQUEMA_UNIFICADO.sql` tampoco se edita a mano: se recompone con
   `python migration/consolidar_esquema.py` cada vez que cambie el DDL base o cualquiera de
   los dieciséis parches. El consolidador busca el DDL fuente en `backend/` y, si no está,
   en `backups/backend/`: hoy vive en `backups/backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql`.
   `PARCHE_12_COMENTARIOS_COLUMNAS.sql` se regenera con
   `python migration/generar_comentarios_sql.py` cuando cambie la curaduría de columnas.

---

## 7. Encabezado de estado para documentos absorbidos o archivados

```markdown
> **Estado documental:** absorbido. No editar.
> Contenido vigente en: `<documento destino> §<sección>`.
> Se conserva por trazabilidad histórica. Índice: `docs/INDICE.md`.
```
