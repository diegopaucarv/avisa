> **Estado documental:** superado. No editar.
> El mapa de carga vigente es `docs/PLAN_PORTE_LEGADO_V9.md` **§2**, que corrige esta tabla. Sus advertencias viven en `docs/DECISIONES_CARGA_LEGADO_V9.md` (Anexos B y C).
> Se conserva por trazabilidad histórica. Índice: `docs/INDICE.md`.

# Mapa de carga: legado 2026 → v9

**Fecha:** 2026-10-30
**Compañía de:** `docs/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` (diagnóstico) y
`docs/PREPARACION_V9_CARGA_LEGADO.sql` (script que hace posible esta carga).
**Objeto:** definir, tabla por tabla, cómo entran las 75 hojas con datos del
legado en el modelo v9 ya preparado, y dejar registradas las decisiones que
faltan antes de escribir el cargador.

Cifras verificadas contra `backend/BASE_CONFLICTOS_SOCIALES_2026.xlsx`:
86 hojas, **75 con filas**, 4.649 filas (4 643 con al menos un valor), 11 vacías.

---

## 1. Decisión (h): `nivel_conflicto` se deriva de `DIM_Tipo_Caso`

El legado **ya tiene** la escala de 4 niveles de la Guía §7.5.1. No está en
`id_riesgos` ni en `id_nivel_alerta`: está en `fact_casos.id_tipo` →
`DIM_Tipo_Caso`, y las descripciones de la hoja son, literalmente, las
definiciones de la Guía:

| `dim_tipo_caso`          | Descripción en la hoja                                                               | `core.cat_niveles_conflicto` |
| ------------------------ | ------------------------------------------------------------------------------------ | ---------------------------- |
| `TC-01` Diferencias      | "Posiciones distintas entre actores sobre un tema, sin acciones de protesta activas" | `1 Diferencia`               |
| `TC-02` Controversias    | "Disputas formales que requieren atención institucional pero sin escalamiento"       | `2 Controversia`             |
| `TC-03` Conflicto Activo | "Situación que involucra acciones colectivas, protestas o riesgo de violencia"       | `3 Conflicto_social`         |
| `TC-04` Crísis           | "Ruptura institucional, violencia generalizada e ingobernabilidad…"                  | `4 Crisis_social`            |

**Regla de carga:** `nivel_conflicto_id = map(id_tipo)`. Cobertura **34/35**
casos (no hay ningún `TC-04`). El caso sin `id_tipo` queda en `NULL`.

**Por qué no las otras opciones:**

- Derivarlo de `id_riesgos` colapsa §7.5.1 (hechos observables) con §7.5.2
  (probabilidad de escalamiento). v9 los separa a propósito.
- Derivarlo de `id_nivel_alerta` (Inmediato/Táctico/Preventivo/Monitoreo) usa un
  **SLA de respuesta** como si fuera gravedad del conflicto. Peor aún: los 4
  valores son de gestión interna, no del hecho.
- Poner `Conflicto_social` por defecto infla artificialmente el nivel 3 y
  contamina todo KPI de la Guía. Descartado.

Como la columna queda `NULL`-able (§3.1 del script), no hace falta inventar nada.

---

## 2. Correcciones a las decisiones (a) a (g)

| Decisión                                            | Lo que dice el dato                                                                                                                                           | Ajuste aplicado                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(c)** modelar capacitaciones, login, intervención | Existen y son pequeñas: 1+9, 857 y 4 filas                                                                                                                    | `core.capacitaciones` + `capacitacion_participantes`; `core.log_accesos`; `cat_ciclos_intervencion` (es un **catálogo**, no una tabla de hechos) + `casos.ciclo_intervencion_id` |
| **(d)** colisiones tipo #85                         | Las 27 "unidades orgánicas" son **las mismas 27 entidades** que 27 de las 66 "áreas": coinciden sigla _y_ nombre en 27/27. Las 93 filas son `E-014` (PRODUCE) | Se insertan **sólo las 66 áreas**; la fila recibe `codigo_legado_area` y `codigo_legado_unidad`. Sin jerarquía: no existe en el origen                                           |
| **(e)** conservar DNI y teléfonos                   | DNI: 642/828, con ceros a la izquierda como texto (`'00245199'`). Teléfonos: float (`'222.0'`, `'22302037.0'`)                                                | `actor_datos_personales.dni VARCHAR(12)` + índice único parcial; `telefono_raw` guarda el original                                                                               |
| **(f)** mesas → tabla nueva                         | 21 filas × 23 columnas con base legal, norma, prórrogas, presidente, secretario técnico, titular, alterno, vigencia                                           | `core.mesas_dialogo` + `core.mesa_miembros` (titular/alterno son personas, no columnas)                                                                                          |
| **(g)** conservar alerta↔demanda                    | `bridge_alerta_demandas`: 231 filas; unión **247**, **233 pares válidos** → **222 demandas** con `alerta_id` (el bridge gana en 11 conflictos)                | `core.demandas.alerta_id` (FK nullable). Basta una columna                                                                                                                       |
| **(a)** añadir columnas faltantes                   | Confirmado                                                                                                                                                    | §3 del script                                                                                                                                                                    |
| **(b)** `nivel_conflicto_id` a NULL                 | Confirmado y necesario                                                                                                                                        | §3.1 del script                                                                                                                                                                  |

### Dos hallazgos que cambian la forma de la carga

1. **`core.casos` no se puede llenar sin relajar dos `NOT NULL`**: 12/35 casos
   sólo tienen departamento (`distrito_principal_id`), y `unidad_responsable_id`
   no tiene fuente en absoluto (`dim_sectoristas.id_area`/`id_unidad` están
   vacías en las 15 filas).
2. **Los bridges del legado están desalineados de columnas**: `bridge_caso_actor`
   tiene 24/36 referencias de caso como `1.0`, `10.0`…;
   `bridge_caso_actor_estado` tiene **36/36** referencias apuntando a `ACT-xxx`
   en vez de `ACT-EST-xxx`; `bridge_alerta_actor` tiene alerta/actor
   intercambiados en 12 filas; `fact_historial_estado` tiene `fecha_cambio` =
   `TEMA-01` e `id_estado_nuevo` = fechas. **No se cargan tal cual**: se
   reconstruyen desde el lado limpio de cada relación.

---

## 3. Mapa de carga por dominio

### 3.1 Territorio (795 filas) → `core.regiones/provincias/distritos`

**Debe ejecutarse primero: v9 no trae ni una fila de geografía.**

| Legado              | Filas | Regla                                                                                  |
| ------------------- | ----: | -------------------------------------------------------------------------------------- |
| `dim_departamentos` |    27 | `ubigeo = lpad(codigo_depto,2,'0')`; `alcance` → `cat_alcances_geograficos` por nombre |
| `dim_provincias`    |    70 | `ubigeo = lpad(cod_inei,4,'0')` → `'0101'`; `region_id = left(ubigeo,2)`               |
| `dim_distritos`     |   698 | `ubigeo = lpad(cod_inei,6,'0')` → `'010101'`; `provincia_id = left(ubigeo,4)`          |

Los 17 distritos referenciados por casos resuelven todos. El legado cubre 698 de
los 1.874 distritos del Perú: **los que falten deben reportarse, no descartarse en
silencio**.

### 3.2 Catálogos (129 filas) → §1 y §2 del script

`dim_tipo_tematica` 7 · `dim_tipo_sector` 3 · `dim_tipo_actor` 3 ·
`dim_rol_actor` 4 · `dim_tipo_caso` 4 (**es el nivel de conflicto**, §1) ·
`dim_riesgos` 3 (⚠ `'Moderado '` con espacio final) · `dim_nivel_alertas` 4 ·
`dim_estado_proceso` 5 · `dim_tipo_cambio` 6 · `dim_perfil` 3 ·
`dim_tipo_org` 4 · `dim_intervencion` 4 · `dim_tipo_actor_radar` 3 ·
`dim_tipo_proceso` 4.

### 3.3 Organización interna (168 filas)

| Legado                            | Filas | Destino                                                                                                                                                       |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dim_entidad_responsable`         |    23 | **No son tenants.** `E-014` = PRODUCE → `entidades.id=1`. Las otras 22 son ministerios externos: se cargan en `entidades` como catálogo (ninguna como tenant) |
| `dim_area_responsable`            |    66 | `cat_unidades_organicas` (66 filas, `codigo_legado_area=AR-xxx`)                                                                                              |
| `dim_unidades_organicas_responsa` |    27 | **Descartar como filas** (duplicado de 27 áreas): sólo rellenar `codigo_legado_unidad` por _join_ de sigla                                                    |
| `dim_responsable`                 |     3 | Puntero polimórfico, sin valor → descartar                                                                                                                    |

### 3.4 Personas y organizaciones (1.160 filas)

| Legado                           | Filas | Regla                                                                                                                                                                                                                                                     |
| -------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dim_actores`                    |   828 | `naturaleza='persona'`; `dni`→PII; `telefono` normalizado; `cargo`→`cargo_actual`; `nivel_gobierno` (⚠ `Perfil-01`,`Sí`→NULL); `categoria` (`Actor Primario`→rol 1, `Actor Secundario`→2, resto→7); `id_perfil` (⚠ `ROL-01`→NULL); `fotografa`→`foto_url` |
| `dim_actores_estado`             |   108 | Misma tabla, `naturaleza='persona'`, `tipo_actor_id=1`. **Fusionar por DNI**                                                                                                                                                                              |
| `dim_organizacion`               |   224 | `naturaleza='organizacion'`; `ruc` (5 filas, BIGINT→`CHAR(11)` con _left-pad_), `numero_integrantes`, `n_embarcaciones`, `n_armadores`, `direccion`, `fecha_constitucion`, `inscripcion_sunarp`, `tipo_organizacion_id`                                   |
| `dim_sectoristas`                |    15 | → `core.usuarios` + `usuario_roles('sectorista')`. Credenciales: ver D11                                                                                                                                                                                  |
| `dim_punto_focal`                |    17 | → `core.usuarios` + rol `consulta_lectura`/`sectorista`                                                                                                                                                                                                   |
| `dim_autoridades`                |     2 | → `core.usuarios` + rol `alta_direccion`                                                                                                                                                                                                                  |
| `bridge_caso_actor`              |    80 | ⚠ inservible (24/36 IDs numéricos): reconstruir                                                                                                                                                                                                           |
| `bridge_caso_actor_estado`       |    61 | ⚠ inservible (36/36 apuntan a `ACT-xxx`): reconstruir                                                                                                                                                                                                     |
| `bridge_alerta_actor`            |   162 | ⚠ 12 filas con columnas intercambiadas                                                                                                                                                                                                                    |
| `bridge_alerta_actorestado`      |     5 | → `alertas_actores` (crosswalk)                                                                                                                                                                                                                           |
| `bridge_sectorista_departamento` |    27 | → `core.usuario_territorio`                                                                                                                                                                                                                               |

### 3.5 Casos (35) → `core.casos`

```
codigo_caso            <- ID_Caso
nombre_caso            <- Nombre_Caso
nivel_conflicto_id     <- map(ID_Tipo)            34/35 · resto NULL
nivel_riesgo_id        <- map(ID_Riesgos)         34/35 · resto por D5
prioridad_id           <- Prioridad (Urgente/Moderado/Bajo -> 1/2/3)
subsector_id           <- map(ID_Sector)          35/35
tematica_id            <- map(ID_Tematica)        35/35
distrito_principal_id  <- DIS-xxxx                23/35 · resto NULL
region_principal_id    <- DEP-xxxx                35/35
provincia_principal_id <- PRO-xxxx                25/35
punto_focal_usuario_id <- SEC-xx -> core.usuarios
ciclo_intervencion_id  <- map(ID_Intervencion)
pct_avance             <- Pct_Avance (0.0-0.9 -> D6)
resumen_ejecutivo, descripcion_riesgo
estado_id              <- 1 (Activo): el legado no trae estado de caso
fuente_original='avisa_historico', es_seed_historico=true,
origen_dato='AVISA_HISTORICO'
n_acciones / n_hitos_total / n_hitos_cumplidos  -> NO se almacenan:
    100 % ceros y derivables -> vista
```

### 3.6 Demandas (325) → `core.demandas`

- `descripcion_demanda` = texto íntegro. `problema_3p`/`pedido_3p` = NULL
  (relajados: no se fabrica la estructura 3P).
- `caso_id` ← `ID_CASO` (100; uno huérfano: `CS-2026-07`).
- `alerta_id` ← `ID_ALERTA` (**236** códigos `AT-`; 12 de los valores no vacíos no son alertas). **Aquí vive (g)**; el bridge de 231 filas se
  usa como verificación cruzada: unión 247, 233 pares válidos, 222 demandas.
- `tematica_id` ← `ID_TEMATICA` (277; ⚠ un valor es un _timestamp_).
- `ID_ORGANIZACION` (98) → `demandas_actores(rol_en_demanda='Formulador')`.
- `Tipo_Evidencia_Registro` → `demandas_evidencias.fuente_tipo`
  (`Publicaciones o Redes Sociales`→`Medios`, `Hecho Ocurrido`→`Institucional`),
  con el original en `tipo_evidencia_legado` (los valores son `HECHO-037`, no URLs).

### 3.7 Alertas (83) → `core.alertas_tempranas`

`titulo` (83/83) · `situacion_actual` · `hechos_recientes` ·
`descripcion_riesgo` · `riesgos_json` · `acciones_sugeridas_json` ·
`acciones_oaipcs` · `nivel_alerta_id` ← `ID_NIVEL_ALERTA` ·
`prioridad_id` ← derivado del nivel · `fecha_reporte` ← `Fecha` ·
`estado_legado='Archivado'` · `paso_actual=1` · `distrito_id` ·
`sectorista_usuario_id` · `fuente_*` · `caso_id` ← `ID_Caso_Vinculado`
(**50/83; 33 quedan NULL**). `link_pdf_drive` → `core.documentos` tipo 13 (83 filas).

### 3.8 Cronología y documentos (167)

- `fact_hechos_casos` 80 → `caso_cronologia` (`tipo_hecho_id`,
  `es_hecho_critico` ← `Hecho_Crítico`, `link_evidencia`). ⚠ 2 filas traen una URL
  en `ID_Alerta`.
- `dim_redaccion` 51 + `dim_coordinacion_tecnica` 4 → `core.documentos`
  (tipos 10 Ayuda Memoria / 11 Relatoria / **15 Otro**); `link_archivo`,
  `link_lista`, `link_foto` → columnas nuevas; `id_ubigeo` → `distrito_id`.
- `dim_alertas` (PDF) · `dim_reporte_rapido` 1 (tipo 1) · `dim_climasocial` 7
  (tipo 2) · `dim_climasocial_focalizado` 6 (tipo 3) · `fact_analisis_casos` 1
  (tipo 6, 26 columnas → `contenido_json`).
- `fact_historial_estado` 27 → **no se carga**: sus 27 referencias son `CS-MI-REG-*`,
  inexistentes en `fact_casos`; el trigger `core.caso_historial()` escribe la fila inicial y deja **35** filas en `core.caso_estado_historial`.

### 3.9 Compromisos e hitos (20)

`dim_hitos` 12 + `dim_acciones_hitos` 8. `compromisos.compromiso_id` es `NOT NULL`
y `codigo_hito` es `UNIQUE`, pero el legado cuelga los hitos de `id_caso` →
compromisos sintéticos `<codigo_caso>_COMP001` (cumple `~ '_COMP[0-9]{3}$'`),
`unidad_responsable_id` ← `ID_Area`, `estado_id` ← map(`Estado_Hito`).

### 3.10 Mesas, capacitaciones, locales, login, envíos (927)

`dim_mesas_grupos` 21 → `mesas_dialogo` + `mesa_miembros` (rol textual) ·
`dim_capacitaciones` 1 + `bridge_capacitacion_participant` 9 ·
`log_accesos` 857 → `core.log_accesos` (12 DNI; `11111111` y `1234567` son
cuentas de prueba) · `dim_locales` 27 → `core.locales` ·
`LOG_Envios` 17 → `envios_comunicacion` · `dim_destinatarios_fijos` 4 →
`suscripcion_notificacion` · `bridge_alerta_recurso` 32 → `alerta_especies`.

### 3.11 Absorbidos en JSON o sin destino (160)

`fact_analisis_casos` (JSON) · `dim_anuncios_acuerdos` 0 ·
`bridge_caso_{posiciones,intereses,necesidades,ineteres_comunes}` 0 ·
`dim_{descencadenantes,impulsores,causas,medios}` 0 ·
`bridge_caso_{descencadenantes,impulsores,causas,medios}` 1+5+4+4 (al JSON del
análisis) · `fact_proceso_caso` 36 + `fact_proceso_reporte` 99 +
`dim_paso_proceso*` 7 (**v9 no tiene schema de workflow**, D17) ·
`fact_red_radar` 1 + `fact_nodo` 1 + bridges 4 (D18).

---

## 4. Decisiones pendientes antes de escribir el cargador

| #       | Decisión                                                                                                             | Por qué bloquea                     | Recomendación                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | **33/83 alertas sin caso** (`caso_id` es el padre de todo)                                                           | Alertas y sus demandas no cargan    | `caso_id` NULL (ya relajado). **No** inventar casos: contaminaría el registro y los KPI                                      |
| **D2**  | **226/325 demandas sin caso** (sólo `alerta_id`)                                                                     | Igual                               | `caso_id` NULL + `alerta_id`; la alerta es el padre real                                                                     |
| **D3**  | **12/35 casos sin distrito** (sólo `DEP-xx`)                                                                         | `distrito_principal_id`             | NULL + `region_principal_id` siempre. **No** usar la capital provincial: es una ubicación inventada                          |
| **D4**  | **Sin fuente para `unidad_responsable_id`** (`id_area`/`id_unidad` vacíos en sectoristas)                            | Los casos no cargan                 | Crear una unidad `OAIPCS` en `cat_unidades_organicas` y poner al sectorista en `punto_focal_usuario_id`. Confirmar el nombre |
| **D5**  | **1 caso sin `id_riesgos`**                                                                                          | `nivel_riesgo_id` NOT NULL          | Derivar de `Prioridad` (Urgente→Alto, Moderado→Moderado, Bajo→Bajo), `confidence=0.5`, `es_validado_humano=false`            |
| **D6**  | **Escala de `Pct_Avance`** (`0.0 / 0.7 / 0.8 / 0.9`)                                                                 | Define si se guarda `70` o `0.7`    | Tratar como fracción → ×100. OAIPCS debe confirmar; **no** es derivable de hitos (los contadores están todos en 0)           |
| **D7**  | **27/27 `fact_historial_estado` huérfanos** + columnas desalineadas                                                  | No puede tener FK                   | Excluir de la v1; dejar en `legacy.*` para reconstrucción manual                                                             |
| **D8**  | **Qué relación actor↔caso es autoritativa** (`bridge_caso_actor` corrupto vs `bridge_caso_actor_estado` desalineado) | Define `casos_actores`              | Reconstruir desde `bridge_caso_actor_estado` cruzado con `dim_actores`; validar conteo antes del INSERT                      |
| **D9**  | **Dos censos de personas** (828 + 108)                                                                               | Actores duplicados                  | Fusionar por DNI; sin DNI → nombre+organización; registrar en `kag.entity_merge_log`                                         |
| **D10** | **`dim_actores.id_organizacion` guarda nombres**, 358/368 sin match                                                  | Vínculos de membresía               | Match exacto normalizado, luego `pg_trgm` ≥ 0.85, si no: sin vínculo + reporte                                               |
| **D11** | **Credenciales `clave_sectorista`/`clave_pf`/`clave_autoridades` (INT, en claro)**                                   | Seguridad                           | Nunca tal cual: `clave_hash` con valor aleatorio + reseteo forzado en el primer ingreso. Confirmar                           |
| **D12** | `dim_actores_estado.categoria` vacía; 4 actores con `id_tipo_actor` basura (`Regional`,`Sí`)                         | Integridad de rol/tipo              | NULL. No adivinar                                                                                                            |
| **D13** | **Hitos sin compromisos**: sintéticos vs `core.hitos_caso`                                                           | 12 filas                            | Compromisos sintéticos, `tipo_compromiso='Actividad'`                                                                        |
| **D14** | `dim_mesas_grupos.titular`/`alterno` en texto libre                                                                  | Miembros sin actor                  | `mesa_miembros.nombre_texto`, sin fuzzy                                                                                      |
| **D15** | **Descripciones TEMA-03/TEMA-04 desalineadas**                                                                       | Semántica                           | El script descarta el texto erróneo y marca `nota_calidad`; OAIPCS debe redactar TEMA-03                                     |
| **D16** | `tipo_documento='Otro'` sin equivalente                                                                              | 55 documentos                       | Tipo 15 `otro` añadido                                                                                                       |
| **D17** | `fact_proceso_*` (135 filas) sin schema de workflow en v9                                                            | Modelado                            | Diferir; diseñar `proceso_instancia`/`proceso_paso` o reusar `config.a2_transiciones`                                        |
| **D18** | `fact_red_radar`/`fact_nodo` (2 registros + 4 bridges)                                                               | Modelado                            | Diferir; dejar en `legacy.*`                                                                                                 |
| **D19** | **Formatos de `codigo_caso`**: `CS-2026-07` vs `CS-PRODUCE-2026-007`, y `RR-2026-01`                                 | Huérfanos de `bridge_caso_demandas` | Normalizar sólo la forma larga documentada; los cortos se aparcan, no se inventan                                            |
| **D20** | `dim_demandas.id_alerta` vs `bridge_alerta_demandas` (verdad duplicada)                                              | Doble conteo                        | Unión **247**, **233 pares válidos** → **222 demandas** con `alerta_id`; el bridge gana en 11 conflictos                     |
| **D21** | ¿Se conserva `legacy.*` (staging) o se borra?                                                                        | Auditabilidad                       | Conservarlo: es la única fuente reproducible                                                                                 |
| **D22** | `cat_especies`: 37 recursos vs **5** sembradas                                                                       | FK de `alerta_especies`             | Insertar las **34** nuevas desde id 16 (total **39**); `familia`/`grupo_biologico`/`ambito` ya añadidos en §2.10             |

---

## 5. Advertencias finales

1. **Todo contador de avance del legado está en cero.** `N_Acciones`,
   `N_Hitos_Total`, `N_Hitos_Cumplidos` valen `0` en los 35 casos, pese a que
   existen 12 hitos en otra hoja. Cualquier tablero que muestre progreso desde
   estos campos mostrará cero para todos. No cargarlos como verdad.
2. **`core.entidadess`** (con doble `s`) **no existe** en la DDL v9: el único
   objeto es `core.entidades` (L102). Si alguna copia del archivo muestra el
   typo, es una variante no versionada; no construir nada encima.
3. **Orden de ejecución:** DDL v9 → `PREPARACION_V9_CARGA_LEGADO.sql` →
   geografía (§3.1) → catálogos → actores → usuarios → casos → documentos →
   cronología → demandas → alertas → compromisos sintéticos → notificaciones.
4. **RLS:** el cargador debe fijar `app.user_id`, `app.clasificacion_max >= 2` y
   `app.staff_bypass_subject_rls`; de lo contrario los `INSERT` no fallan,
   desaparecen.
