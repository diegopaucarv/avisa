> **Estado documental:** absorbido en parte. §3 no se edita desde otros documentos.
> §1.1 y §5 quedaron como **Anexo A** de `docs/DECISIONES_CARGA_LEGADO_V9.md` (con los totales ajustados a v10).
> **§3 (mapa columna a columna) permanece aquí como fuente única**: no se traslada ni se duplica. Ver `docs/PLAN_PORTE_LEGADO_V9.md` Anexo E.
> Se conserva por trazabilidad histórica. Índice: `docs/INDICE.md`.

# Análisis de portabilidad: `BASE_CONFLICTOS_SOCIALES_2026` (86 tablas MySQL) → DDL v9 (PostgreSQL)

**Fecha:** 2026-10-30
**Objeto:** determinar qué porcentaje del modelo legado tiene destino en el DDL v9, con qué
transformación, y qué impide cargarlo tal cual.
**Fuentes comparadas:**

| Fuente                               | Archivo                                            | Tamaño                                            |
| ------------------------------------ | -------------------------------------------------- | ------------------------------------------------- |
| Modelo legado (derivado del `.xlsx`) | `backend/BASE_CONFLICTOS_SOCIALES_2026_SCHEMA.sql` | 86 tablas, 1.275 líneas, MySQL `InnoDB`/`utf8mb4` |
| Modelo destino                       | `backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql`       | 254 tablas, 25 schemas, 21 vistas, 4.058 líneas   |
| Contexto de arquitectura             | `docs/AVISA_PRODUCE_v10.md`                        | —                                                 |

**Método:** lectura completa del esquema legado (tabla por tabla, con sus recuentos de filas
declarados en el generador) y lectura dirigida de las 40 tablas de v9 que son candidatas a
recibir esos datos, más los catálogos sembrados, los triggers de auditoría y los bloques de RLS.
Las referencias `L###` apuntan a líneas del DDL v9.

---

## 1. Resumen ejecutivo

El volumen no es el problema: **4.649 filas en 86 tablas** (11 completamente vacías). El problema
es que el legado es un _modelo de hojas de cálculo_ —sin claves foráneas, sin unicidad, con tipos
inferidos al vuelo— y v9 es un modelo normalizado con ~180 columnas `NOT NULL` y catálogos
cerrados. La distancia es semántica, no de tamaño.

### 1.1 Clasificación de las 86 tablas

| Clase | Significado                                                                                                        | Tablas | Filas | % filas |
| ----- | ------------------------------------------------------------------------------------------------------------------ | -----: | ----: | ------: |
| **A** | Destino directo: mismo concepto, sólo cambian tipos de id y alguna columna                                         |     14 | 1.342 |  28,9 % |
| **B** | Requiere transformación estructural (cambia el padre, la granularidad, o hay que sintetizar columnas obligatorias) |     27 | 2.077 |  44,7 % |
| **C** | Se absorbe en JSON o en un valor derivado (`core.documentos.contenido_json`, `motivo` texto)                       |     11 |    90 |   1,9 % |
| **D** | **Sin destino en v9**: concepto que no existe en el modelo nuevo                                                   |     23 | 1.140 |  24,5 % |
| **X** | Vacía (0 filas): se descarta sin trabajo                                                                           |     11 |     0 |     0 % |

Lectura: **73 % de las filas y 52 de 86 tablas son portables** con trabajo de transformación
(A+B+C). **24,5 % de las filas no tienen casa** en v9 (D).

### 1.2 Los cinco bloqueos que hay que decidir antes de escribir una línea de cargador

1. **`core.casos` exige seis columnas que el legado no tiene.** `distrito_principal_id`,
   `subsector_id`, `tematica_id`, `unidad_responsable_id`, `nivel_conflicto_id` y
   `nivel_riesgo_id` son `NOT NULL` (L391–397). El legado trae ubigeo, sector, temática,
   sectorista y riesgo, pero **no trae nivel de conflicto** (Diferencia/Controversia/Conflicto
   social/Crisis social). ¿Se deriva? ¿Se asume `Conflicto_social`? ¿Se deja nulo relajando v9?
2. **Los catálogos que el legado debería llenar están vacíos.** `core.cat_tematicas` y
   `core.cat_subsectores` se crean sin un solo `INSERT` (L253–254), y `core.cat_tipos_actor` /
   `core.cat_roles_actor` sólo siembran id 4–7 y 4–6 (L3055–3063): **faltan los id 1–3**
   (Social/Público/Privado, Principal/Secundario/Tercero). Con el DDL tal como está, _ningún_
   `INSERT` en `core.casos` ni en `core.actores` puede tener éxito. El legado es justamente la
   fuente para llenarlos: `dim_tipo_tematica` (7), `dim_tipo_sector` (3), `dim_tipo_actor` (3),
   `dim_rol_actor` (4).
3. **`core.demandas` exige la estructura 3P.** `problema_3p`, `pedido_3p` son `NOT NULL` y
   `caso_id` es obligatorio (L539–541). El legado guarda **una sola** `descripcion_demanda` de
   texto libre (325 filas). Hay que decidir si se parte el texto, si se duplica en ambos campos,
   o si se acepta un `pedido_3p` vacío con relleno.
4. **`core.hitos_compromiso` cuelga de un compromiso, no de un caso.** `compromiso_id` es
   `NOT NULL` y `codigo_hito` es `UNIQUE` (L596–599). Los 12 `dim_hitos` del legado cuelgan de
   `id_caso`. Sin compromisos en el origen, hay que inventar compromisos sintéticos por caso
   (`<caso>_COMP001`) o dejar los hitos fuera del modelo.
5. **Las mesas y grupos de diálogo no existen en v9.** `dim_mesas_grupos` (21 filas, 23 columnas:
   base legal, norma, prórrogas, presidente, secretario técnico, titular, alterno, vigencia) no
   tiene contraparte. `core.reuniones_dialogo` son reuniones puntuales, no espacios permanentes.
   Es el hueco conceptual más caro del inventario.

---

## 2. El legado en números

- 86 tablas, **0 claves foráneas**, 0 `UNIQUE` salvo 30 `PRIMARY KEY`, 0 columnas de auditoría
  (`created_at`/`created_by`), 0 noción de tenant/clasificación.
- 11 tablas vacías: `bridge_caso_recurso`, `dim_anuncios_acuerdos`, `bridge_actor_grupo`,
  `bridge_caso_posiciones`, `bridge_caso_intereses`, `bridge_caso_necesidades`,
  `bridge_caso_ineteres_comunes`, `dim_descencadenantes`, `dim_impulsores`, `dim_causas`,
  `dim_medios`.
- Concentración de filas: `log_accesos` 857, `dim_actores` 828, `dim_distritos` 698,
  `dim_demandas` 325, `bridge_alerta_demandas` 231, `dim_organizacion` 224,
  `bridge_alerta_actor` 162. **Esas 7 tablas son el 72 % de las filas.**
- El esquema fue generado desde Excel e **infirió tipos por muestra**: decenas de columnas que
  son fechas, ids o URLs quedaron como `DECIMAL(10,2)` (ver §7.1).

---

## 3. Mapa por dominio (detalle columna a columna)

### 3.1 Casos

`fact_casos` (35 filas, 28 columnas) → `core.casos` (L388–410) + `core.caso_distritos` (L413) +
`core.caso_factores` (L430).

| Legado                                                                            | v9                                                                  | Nota                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id_caso`                                                                         | `codigo_caso`                                                       | `UNIQUE` en ambos; sirve como clave natural, no hace falta tabla de mapeo                                 |
| `nombre_caso`                                                                     | `nombre_caso`                                                       | directo                                                                                                   |
| `id_ubigeo`/`id_provincia`/`id_distrito`                                          | `distrito_principal_id` + `core.caso_distritos`                     | requiere resolver ubigeo → `core.distritos.id`; el legado puede traer los tres a la vez y contradictorios |
| `id_sector`                                                                       | `subsector_id`                                                      | `dim_tipo_sector` sólo tiene 3 valores: hay que sembrar `cat_subsectores`                                 |
| `id_tematica`                                                                     | `tematica_id`                                                       | `dim_tipo_tematica` (7) es la semilla de `cat_tematicas` (vacía)                                          |
| `id_sectorista`                                                                   | `punto_focal_usuario_id` / `unidad_responsable_id`                  | el legado apunta a una persona; v9 necesita además una unidad orgánica `NOT NULL`                         |
| `id_riesgos`                                                                      | `nivel_riesgo_id`                                                   | `dim_riesgos` (3) = `cat_niveles_riesgo` (3): mapeo 1:1                                                   |
| `prioridad`                                                                       | `prioridad_id`                                                      | `Urgente/Moderado/Bajo` coincide con `cat_prioridades_atencion` (L200)                                    |
| —                                                                                 | `nivel_conflicto_id`                                                | **no existe en el origen** (§1.2 #1)                                                                      |
| `fecha_inicio`                                                                    | `fecha_inicio`                                                      | `DATETIME` → `DATE`                                                                                       |
| `fecha_cierre`, `fecha_reapertura`, `motivo_cierre`                               | `fecha_cierre`                                                      | en el legado son `DECIMAL(10,2)`: seriales de Excel (§7.1)                                                |
| `pct_avance`                                                                      | **sin columna**                                                     | v9 deriva el avance de hitos/compromisos; la UI de `frontend/` lo muestra. Decisión pendiente             |
| `n_acciones`, `n_hitos_total`, `n_hitos_cumplidos`                                | **sin columna**                                                     | derivados por diseño (3FN): calcular con vistas                                                           |
| `n_reaperturas`                                                                   | **sin columna**                                                     | se puede derivar contando `caso_estado_historial`                                                         |
| `link_pdf_drive`, `fecha_envio_correo`, `destinatarios_*`, `fecha_envio_whatsapp` | **sin columna**                                                     | trazabilidad de envío: no existe en v9 (§6.3)                                                             |
| `descripcion_riesgo`, `resumen_ejecutivo`                                         | `descripcion_riesgo`, y `core.documentos.resumen_ejecutivo`         | el resumen pertenece al documento, no al caso                                                             |
| —                                                                                 | `es_seed_historico`, `fuente_original`, `origen_dato`, `confidence` | **se completan en la carga**: `TRUE`, `'avisa_historico'`, `'AVISA_HISTORICO'`, `1.0`                     |

`fact_historial_estado` (33) → `core.caso_estado_historial` (L421–429): exige
`nivel_conflicto_id` + `nivel_riesgo_id` + `estado_id` simultáneos y un índice único parcial
("un solo vigente", L429). El legado guarda `fecha_cambio` como `VARCHAR` y
`id_estado_nuevo` como `DATETIME` (tipos invertidos, §7.1), y no tiene nivel de conflicto.
`dim_tipo_cambio` (6) no tiene catálogo en v9: se colapsa en `motivo TEXT`.

### 3.2 Alertas

`dim_alertas` (83 filas, 31 columnas) → `core.alertas_tempranas` (L448–459) +
`core.alertas_actores` (L461) + `core.derivaciones_alerta` (L465).

| Legado                                                            | v9                              | Nota                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id_alerta`                                                       | `codigo_alerta`                 | clave natural `UNIQUE`                                                                                                                                                                     |
| `id_caso_vinculado`                                               | `caso_id`                       | **`NOT NULL` en v9, opcional en el legado** → alertas huérfanas (§1.2)                                                                                                                     |
| `id_nivel_alerta`                                                 | `prioridad_id`                  | `dim_nivel_alertas` (4: Crítico/Inminente/Intermedio/…) vs `cat_prioridades_alerta` (Crítica_Inmediata/Urgente/Temprana/Seguimiento, con SLA) — **no es el mismo eje**: decisión pendiente |
| `titulo_alerta`                                                   | **sin columna**                 | `core.alertas_tempranas` no tiene título. Hay que añadirlo en v9 o concatenarlo en `situacion_actual`                                                                                      |
| `situacion_actual`, `hechos_recientes`                            | `situacion_actual`              | fusionar                                                                                                                                                                                   |
| `descripcion_riesgo_alerta`                                       | `riesgos_json`                  | el legado es texto; v9 espera JSON (envolver: `jsonb_build_array(...)`)                                                                                                                    |
| `acciones_sugeridas`, `acciones_oaipcs`                           | `acciones_sugeridas_json`       | idem                                                                                                                                                                                       |
| `id_riesgos`                                                      | —                               | v9 no guarda nivel de riesgo en la alerta: vive en el caso                                                                                                                                 |
| `paso_actual`, `estado`, `fecha_validacion`, `fecha_remision`     | —                               | el flujo de la alerta no existe en v9 (§6.2)                                                                                                                                               |
| `tipo_fuente`, `descripcin_fuente`, `link_fuente`                 | `core.fuentes_evidencia` (L529) | **requiere** una fila de `core.caso_cronologia` padre: no se puede colgar de la alerta                                                                                                     |
| `fecha_envio_*`, `destinatarios_*`, `link_pdf_drive`, `fotografa` | —                               | sin destino                                                                                                                                                                                |
| `id_mesa_grupo`                                                   | —                               | depende de la tabla de mesas (§1.2 #5)                                                                                                                                                     |

`bridge_alerta_actor` (162) y `bridge_alerta_actorestado` (5) → `core.alertas_actores` (L461):
se pierden `rol_en_alerta` y `es_principal` (no hay columnas; la PK es sólo el par).

### 3.3 Demandas — el cambio de granularidad más delicado

`dim_demandas` (325) + `bridge_alerta_demandas` (231) + `bridge_caso_demandas` (12) →
`core.demandas` (L539–551) + `core.demandas_actores` (L552).

- El legado permite que una demanda cuelgue **de un caso y/o de una alerta**
  (`id_caso`, `id_alerta`, y además las dos tablas puente). v9 sólo admite `caso_id NOT NULL`.
- Consecuencia: **231 vínculos alerta↔demanda se pierden o deben re-parentarse al caso**, y las
  demandas ligadas a alertas sin caso no se pueden cargar (§1.2 #1).
- `descripcion_demanda` (TEXT) → `problema_3p` + `pedido_3p` (ambos `NOT NULL`): no hay
  separación 3P en el origen.
- `id_organizacion` (una) → `core.demandas_actores` (N:M) con `rol_en_demanda` obligatorio
  (`Formulador/Coadyuvante/Opositor/Afectado`), dato que el legado no tiene → default decidido.
- `tipo_evidencia_registro` + `link_evidencia_registro` → `core.demandas_evidencias` (L557):
  mapeo limpio (`Medios/Institucional/Relacionamiento` vs valores libres).

### 3.4 Actores y organizaciones

| Legado                                           |   Filas | v9                                                                      | Nota                                                                                              |
| ------------------------------------------------ | ------: | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dim_actores`                                    |     828 | `core.actores` + `core.actor_datos_personales` + `core.actor_membresia` | `dni INT` **no tiene columna** en v9; `email`, `fotografa`, `nivel_gobierno`, `categoria` tampoco |
| `dim_actores_estado`                             |     108 | `core.actores` (`naturaleza='persona'`, tipo `Público`)                 | se **fusiona** con la anterior: riesgo de duplicados → usar `kag.entity_merge_log` (L688)         |
| `dim_organizacion`                               |     224 | `core.actores` + `core.organizaciones`                                  | `ruc`, `integrantes`, `razon_social` encajan; `embarcaciones`/`armadores`/`perfil` no             |
| `dim_tipo_actor`                                 |       3 | `core.cat_tipos_actor` id 1–3                                           | **hay que sembrar v9** (§1.2 #2)                                                                  |
| `dim_rol_actor`                                  |       4 | `core.cat_roles_actor` id 1–3                                           | idem; el legado tiene 4, v9 contempla 3                                                           |
| `dim_tipo_org`                                   |       4 | `core.cat_tipos_actor`                                                  | eje distinto (tipo de organización ≠ tipo de actor): colisión semántica                           |
| `dim_perfil`                                     |       3 | `kag.actor_profile.resumen`                                             | `core.actores` no guarda perfil; `kag.actor_profile` sí (L619–622)                                |
| `bridge_caso_actor` / `bridge_caso_actor_estado` | 80 / 61 | `core.casos_actores` (L434)                                             | exige `nivel_influencia` 1–100 y `posicion` en 4 valores: **el legado no los tiene** → defaults   |

PII: `dni` (828 + 108 filas) y `telefono` no tienen destino en `core.actor_datos_personales`
(L322–328: sólo `telefono_contacto`, `genero`, `autoidentificacion_etnica`). Si el DNI debe
conservarse, v9 necesita una columna nueva (y `nivel_clasificacion = 3`, que es lo que ya prevé
la tabla). En el legado el DNI es `INT`, así que además **se perdieron los ceros a la izquierda**.

### 3.5 Cronología, hechos y evidencias

`fact_hechos_casos` (80) → `core.caso_cronologia` (L518–527) + `core.fuentes_evidencia` (L529) +
`cronologia_vinculos` (L534).

| Legado                                           | v9                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fecha`                                          | `fecha_evento DATE`                                                                                                                                                        |
| `descripcion`                                    | `descripcion_hecho TEXT NOT NULL`                                                                                                                                          |
| `tipo_hecho`, `hecho_crtico`                     | **sin columna** (v9 sólo tiene `es_hecho_verificable BOOLEAN`)                                                                                                             |
| `tipo_evidencia_hecho`, `link_evidencia`         | `fuentes_evidencia.tipo_fuente` + `url_referencia`                                                                                                                         |
| `id_clima`, `id_alerta`, `id_rr`, `id_redaccion` | `cronologia_vinculos` (sólo `alerta_id` **o** `documento_id`, `num_nonnulls = 1`) → **una fila de vínculo por cada referencia**; el legado puede tener las cuatro a la vez |

### 3.6 Documentos (el destino más rentable)

`core.documentos` (L492–503) con `core.cat_tipos_documento` (L265–271) absorbe cuatro tablas
legadas completas en clase C:

| Legado                       | Filas | `tipo_id`                                                                                                                        |
| ---------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------- |
| `dim_reporte_rapido`         |     1 | `reporte_rapido`                                                                                                                 |
| `dim_climasocial`            |     7 | `clima_social_general`                                                                                                           |
| `dim_climasocial_focalizado` |     6 | `clima_social_focalizado`                                                                                                        |
| `fact_analisis_casos`        |     1 | `analisis_caso` (sus columnas `JSON` pasan a `contenido_json` sin fricción: es la única tabla legada con narrativa estructurada) |
| `dim_redaccion`              |    51 | mapear `tipo_documento` a uno de los 12 códigos (`reporte_actividad`, `ayuda_memoria`, `relatoria`, `informe_oficial`…)          |
| `dim_coordinacion_tecnica`   |     4 | idem                                                                                                                             |

`link_pdf_drive` → `url_pdf`; `titulo_*` → `titulo`; `resumen_*` → `resumen_ejecutivo`; el resto
(flags de envío, fotografía, georreferencia, `estado`) → `contenido_json`. Los 12 códigos de
`cat_tipos_documento` **no** cubren todos los valores de `tipo_documento` del legado: hay que
listar los valores distintos antes de cargar (§9.2).

### 3.7 Territorio

`dim_departamentos` (27) → `core.regiones` (L276), `dim_provincias` (70) →
`core.provincias` (L279), `dim_distritos` (698) → `core.distritos` (L283). Clase A, pero:

- v9 exige `ubigeo CHAR(2|4|6)` con `CHECK (~ '^[0-9]{2|4|6}$')`; el legado es
  `VARCHAR(50)`. Hay que validar longitud y dígitos, no truncar.
- v9 normaliza la jerarquía por FK (`region_id`, `provincia_id`); el legado repite los nombres
  (`nombre_departamento`, `nombre_provincia`) en cada nivel → **el join debe ser por ubigeo, no
  por nombre** (los nombres tienen tildes inconsistentes).
- Se pierden `region_natural`, `alcance`, `latitud`, `longitud`, `capital`, `estado`. `alcance`
  es lo único con sustituto parcial: `core.cat_alcances_geograficos` (L213).

### 3.8 Usuarios y autenticación

| Legado                           | Filas | v9                                                   | Nota                                                                                                                                                     |
| -------------------------------- | ----: | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dim_sectoristas`                |    15 | `core.usuarios` + `core.usuario_roles('sectorista')` | `clave_sectorista` **se descarta**: v9 no guarda contraseñas (sólo `sso_subject`, L298)                                                                  |
| `dim_punto_focal`                |    17 | idem, rol `punto_focal`                              | **ese rol no existe** en `core.roles` (L294–296: sectorista, administrador, consulta_lectura, alta_direccion, servicio_agente, auditor, externo_publico) |
| `dim_autoridades`                |     2 | idem, rol `alta_direccion`                           | —                                                                                                                                                        |
| `log_accesos`                    |   857 | **sin destino**                                      | v9 no tiene auditoría de login; se delega al IdP/PIDE                                                                                                    |
| `bridge_sectorista_departamento` |    27 | **sin destino**                                      | v9 no modela "qué sectorista cubre qué departamento"; la RLS va por clasificación y actor, no por territorio                                             |

También hay un desajuste con el frontend: `frontend/types.ts` declara
`Role = 'Admin' | 'Sectorista' | 'Directora' | 'PuntoFocal' | 'Autoridad'`, mientras
`core.roles` usa `sectorista | administrador | consulta_lectura | alta_direccion | …`. Son dos
vocabularios distintos que habrá que reconciliar en la capa API.

---

## 4. Mapeo de valores de catálogo

### 4.1 Prioridad y estado

| Legado                                                                    | v9 (`core.cat_*`)                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fact_casos.prioridad` ∈ {Urgente, Moderado, Bajo}                        | `cat_prioridades_atencion` 1/2/3 — **coincide exacto**                                                                                                                          |
| `dim_riesgos.tipo_riesgo` (3 valores, presumiblemente Alto/Moderado/Bajo) | `cat_niveles_riesgo` 1–3                                                                                                                                                        |
| `dim_estado_proceso` (5 estados, `es_terminal`)                           | `cat_estados_caso` (4: Activo/En_seguimiento/Resuelto/Archivado) → **5→4, decisión requerida**                                                                                  |
| `dim_estado_proceso.color_pbi`                                            | se descarta                                                                                                                                                                     |
| `dim_nivel_alertas` (4)                                                   | `cat_niveles_conflicto` (Diferencia/Controversia/Conflicto/Crisis) **o** `cat_prioridades_alerta` (Crítica_Inmediata/Urgente/Temprana/Seguimiento) — ejes distintos, elegir uno |
| `dim_hitos.estado_hito`                                                   | `cat_estados_hito` (Registrado/En_ejecucion/Paralizado/Cumplido/Desestimado) — **coincide exacto**                                                                              |
| `dim_hitos.validacion_hito`                                               | `hitos_compromiso_estado_historico` (fecha de corte + estado)                                                                                                                   |

### 4.2 Geografía y especie

| Legado                                                              | v9                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `dim_departamentos.id_ubigeo`                                       | `core.regiones.ubigeo CHAR(2)`                         |
| `dim_provincias.id_ubigeo` (y `cod_inei`)                           | `core.provincias.ubigeo CHAR(4)`                       |
| `dim_distritos.id_ubigeo` (y `cod_inei`)                            | `core.distritos.ubigeo CHAR(6)`                        |
| `dim_recurso_pesca.nombre_comun_recurso` / `nombre_oficial_recurso` | `core.cat_especies.nombre_comun` / `nombre_cientifico` |
| `dim_recurso_pesca.familia`, `grupo_biolgico`, `mbito_recurso`      | sin columna (se pierden)                               |

### 4.3 Unidades orgánicas — dos niveles legados, uno en v9

`dim_entidad_responsable` (23) → `dim_area_responsable` (66) → `dim_unidades_organicas_responsa`
(27) es una jerarquía de tres niveles. v9 tiene **una sola** tabla,
`core.cat_unidades_organicas` (L255–258), con `UNIQUE (entidad_id, siglas)` y
`entidad_id` apuntando a `core.entidades`, que sólo contiene `PRODUCE` (L107).

- Las 23 entidades del legado son instituciones públicas (ministerios, gobiernos regionales), no
  tenants: su destino natural es `core.actores` con `tipo_actor = 'Público'`, no `core.entidades`.
- Las 66 áreas + 27 unidades colapsan en `cat_unidades_organicas`: **se pierde la jerarquía
  área→unidad** y hay riesgo de colisión de `siglas` (unique por entidad).

---

## 5. Las 23 tablas sin destino (clase D)

| Tabla                             | Filas | Por qué no tiene destino                                      | Opciones                                                                              |
| --------------------------------- | ----: | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `log_accesos`                     |   857 | v9 no audita login                                            | exportar al IdP, o tabla `core.auditoria_acceso`                                      |
| `fact_proceso_reporte`            |    99 | no hay modelo de flujo/SLA por paso                           | nueva tabla, o descartar (el SLA sí existe: `cat_prioridades_alerta.sla_horas`, L203) |
| `fact_proceso_caso`               |    36 | idem                                                          | idem                                                                                  |
| `dim_paso_proceso_caso`           |     4 | idem                                                          | idem                                                                                  |
| `dim_paso_proceso`                |     3 | idem                                                          | idem                                                                                  |
| `bridge_alerta_recurso`           |    32 | v9 no liga alerta↔especie                                     | `core.alerta_especies` nueva, o `riesgos_json`                                        |
| `dim_locales`                     |    27 | no hay catálogo de locales/sedes (aforo, equipos, contacto)   | nueva `core.locales`, o `territorio.lugares` con un tipo nuevo                        |
| `bridge_sectorista_departamento`  |    27 | v9 no modela cobertura territorial por usuario                | nueva `core.usuario_territorio`                                                       |
| `dim_mesas_grupos`                |    21 | no hay espacios de diálogo permanentes                        | nueva `core.espacios_dialogo` (+ participantes + normas) — **prioridad alta**         |
| `dim_capacitaciones`              |     1 | no hay capacitaciones                                         | nueva tabla, o descartar (1 fila)                                                     |
| `bridge_capacitacion_participant` |     9 | idem                                                          | idem                                                                                  |
| `bridge_clima_actor`              |     1 | `core.documentos` no liga actores (sólo las alertas lo hacen) | `core.documento_actores` nueva                                                        |
| `bridge_clima_actor_estado`       |     1 | idem                                                          | idem                                                                                  |
| `bridge_reporte_actor`            |     1 | idem                                                          | idem                                                                                  |
| `bridge_reporte_actor_estado`     |     1 | idem                                                          | idem                                                                                  |
| `fact_red_radar`                  |     1 | red de radares/nodos no es un lugar de desembarque            | `territorio.lugares` + tipo nuevo, o descartar                                        |
| `fact_nodo`                       |     1 | idem                                                          | idem                                                                                  |
| `bridge_radar_actor`              |     1 | idem                                                          | idem                                                                                  |
| `bridge_nodo_actor`               |     3 | idem                                                          | idem                                                                                  |
| `dim_tipo_actor_radar`            |     3 | idem                                                          | idem                                                                                  |
| `dim_destinatarios_fijos`         |     4 | no hay suscripciones de notificación                          | nueva `core.suscripcion_notificacion`                                                 |
| `dim_responsable`                 |     3 | puntero polimórfico (`tabla_origen`) — v9 usa FK explícitas   | descartar                                                                             |
| `dim_intervencion`                |     4 | no hay catálogo de tipos de intervención                      | `cat_tematicas`, o descartar                                                          |

Nótese el patrón: de las 23, **13 suman 88 filas** y son esencialmente descartables
(radar/nodos, capacitaciones, puentes de actor, punteros). Las caras de verdad son
`log_accesos` (857), el flujo de pasos (142 filas en 4 tablas) y `dim_mesas_grupos` (21 filas de
alto valor normativo).

---

## 6. Requisitos de v9 que el legado no puede cumplir

### 6.1 `NOT NULL` sin origen (bloqueantes duros)

| Tabla v9                 | Columna                                                                                                                       | Situación en el legado                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `core.casos`             | `distrito_principal_id`                                                                                                       | ubigeo ambiguo (3 columnas)                           |
| `core.casos`             | `subsector_id`, `tematica_id`                                                                                                 | existen como dims, pero los catálogos v9 están vacíos |
| `core.casos`             | `unidad_responsable_id`                                                                                                       | sólo hay `id_sectorista` (persona)                    |
| `core.casos`             | `nivel_conflicto_id`                                                                                                          | **no existe**                                         |
| `core.casos`             | `nivel_riesgo_id`                                                                                                             | existe (`id_riesgos`)                                 |
| `core.alertas_tempranas` | `caso_id`                                                                                                                     | opcional en el origen                                 |
| `core.alertas_tempranas` | `prioridad_id`                                                                                                                | existe como nivel, eje distinto                       |
| `core.demandas`          | `problema_3p`, `pedido_3p`                                                                                                    | una sola descripción                                  |
| `core.compromisos`       | `codigo_compromiso` (regex `_COMP[0-9]{3}$`), `fecha_inicio`, `accion_compromiso`, `tipo_compromiso`, `unidad_responsable_id` | no hay compromisos en el origen                       |
| `core.hitos_compromiso`  | `compromiso_id`, `codigo_hito UNIQUE`                                                                                         | hitos cuelgan del caso                                |
| `core.casos_actores`     | `nivel_influencia` 1–100, `posicion`                                                                                          | puentes sin atributos                                 |
| `core.actor_membresia`   | `valid_from`                                                                                                                  | sin fecha de inicio de vínculo                        |

### 6.2 Conceptos de v9 ausentes en el legado (no bloquean, pero dejan huecos)

`core.cat_niveles_conflicto`, `core.caso_factores`, `core.cat_factores_contexto`,
`core.derivaciones_alerta` (derivación a área con plazo), `core.compromisos` completos,
`core.planes_accion`/`plan_acciones`, `core.reuniones_dialogo` + participantes,
`core.capacidad_campo`, `kag.*` (grafo, perfiles, embeddings), `ind.*`, `policy.*`,
`domain.artefacto`. El legado no aporta nada a esas capas: se llenan después de la migración.

### 6.2.bis Lo que v9 perdió respecto del legado (para decidir si se readmite)

- `pct_avance` del caso (la UI lo muestra hoy).
- Título de la alerta (`core.alertas_tempranas` no tiene `titulo`).
- Trazabilidad de envíos (correo/WhatsApp), presente en 4 tablas legadas.
- Rol `punto_focal`, `autoridad`, `directora` en `core.roles`.
- Estado/validación de una alerta como entidad con flujo (`paso_actual`, `fecha_validacion`).
- Los 8 roles en español del frontend frente a los 7 códigos de `core.roles`.

### 6.3 RLS: el cargador tiene que abrir la puerta explícitamente

Nueve tablas de negocio se crean con `ENABLE` **y** `FORCE ROW LEVEL SECURITY` (L954–966):
`core.casos`, `core.actores`, `core.alertas_tempranas`, `core.documentos`, `core.demandas`,
`core.compromisos`, `core.caso_cronologia`, `core.reuniones_dialogo`,
`core.actor_datos_personales` (más `kag.aristas`, `kag.documento_*`, `kag.embedding`,
`kag.actor_profile_attribute`). El bucle de L954–966 cubre **14 tablas: 9 de `core` + 5 de
`kag`**; además, `core.acuerdo_ospa_sni` y `core.riesgo_social_ordinal` activan `FORCE ROW
LEVEL SECURITY` en sus propios bloques del DDL, fuera de ese bucle, de modo que `core` queda
con **11** tablas forzadas (ninguna de esas dos se carga en esta migración). `FORCE` aplica
**incluso al dueño de la tabla**, así que un
`INSERT` falla silenciosamente (§política `p_insert`, L962) si no se fija la sesión:

```sql
BEGIN;
SET LOCAL app.user_id            = '<uuid-del-usuario-de-carga>';
SET LOCAL app.clasificacion_max  = '3';
SET LOCAL app.staff_bypass_subject_rls = 'true';
-- ... carga ...
COMMIT;
```

`core.set_audit()` (L801–807) tolera que `app.user_id` falte (`NULLIF → NULL`), pero eso deja
`created_by` nulo en 4.649 filas: conviene fijarlo.

---

## 7. Defectos del legado que hay que resolver antes de cargar

### 7.1 El archivo no es ejecutable y los tipos están invertidos

- **`dim_recurso_pesca` declara una columna sin nombre** (L485: ` ` VARCHAR(50) ``). El
  `.sql` **no se puede ejecutar ni siquiera en MySQL**: falla en la tabla 25 de 86. Hay que
  renombrarla (presumiblemente `id_recurso`) para poder importar.
- Inversión de tipos por inferencia automática, muy visible en:
  - `fact_historial_estado`: `fecha_cambio VARCHAR(50)` e `id_estado_nuevo DATETIME` — están
    al revés.
  - `fact_casos`: `fecha_cierre`, `fecha_reapertura`, `motivo_cierre`, `link_pdf_drive`,
    `destinatarios_correo` como `DECIMAL(10,2)`.
  - `dim_alertas`: `fecha_validacion`, `fecha_remision`, `id_mesa_grupo` como `DECIMAL(10,2)`.
  - `dim_actores_estado`: casi todas las FKs como `DECIMAL(10,2)`.
  - `dim_capacitaciones.link_documento` como `DECIMAL(10,2)`.
- Fechas serializadas como número de Excel: si el valor viene como `45xxx.00`, la conversión es
  `DATE '1899-12-30' + n` (hay que verificarlo contra una muestra antes de aplicarlo a 325 filas
  de demanda y 35 de caso).

### 7.2 Identificadores

- `dni` es `INT` en `dim_actores`, `log_accesos`, `dim_sectoristas`: **los DNI con cero inicial
  se corrompieron en el origen**; hay que decidir si se rellenan a 8 con `lpad(..., 8, '0')` o
  se marcan como no confiables.
- `ruc` es `BIGINT`: mismo problema de ceros y de precisión (`dim_organizacion`).
- No hay `UNIQUE` en `dim_actores`, `dim_organizacion`, `dim_demandas` más allá de su PK
  declarada: el mismo actor puede aparecer dos veces con ids distintos, y `dim_actores` y
  `dim_actores_estado` son dos censos paralelos de personas.

### 7.3 Columnas basura

`unnamed__12` (`log_envios`), `unnamed__23`/`unnamed__24` (`dim_reporte_rapido`),
`unnamed__5` (`bridge_caso_depto`), `unnamed__6` (`bridge_caso_medios`): restos de celdas
vacías en Excel. Se descartan, pero hay que confirmar que no contienen datos (pueden).

Además, nombres mutilados por el generador (`descripcin`, `situacin`, `fotografa`,
`recomedaciones_strategicas_clima`, `bridge_caso_ineteres_comunes`, `id_rela_id_*`): no afectan
la carga —se mapean por posición— pero hacen que cualquier mapeo "por nombre" sea frágil.
**Mapear siempre por posición de columna, nunca por nombre.**

### 7.4 Duplicación de la verdad

- `dim_demandas.id_alerta` **y** `bridge_alerta_demandas` describen el mismo vínculo (231 filas
  vs 325 demandas). Hay que elegir una fuente y verificar que coincidan.
- `bridge_caso_depto` (87) duplica `fact_casos.id_ubigeo/id_provincia/id_distrito`.
- `dim_actores` / `dim_actores_estado` (personas), `bridge_caso_actor` /
  `bridge_caso_actor_estado` (vínculos).

---

## 8. Estrategia de carga propuesta

### 8.1 Esquema de aterrizaje

No cargar directo a `core.*`. Crear un schema `legacy` con las 86 tablas **todas de tipo
`TEXT`** (más `_row_id`), importar por CSV, y transformar con SQL. Ventajas: la importación
nunca falla por tipos, el mapeo es auditable, y se puede re-ejecutar.

### 8.2 Identidad determinista

Claves naturales donde existen (no requieren tabla de mapeo):

- `core.casos.codigo_caso` ← `fact_casos.id_caso`
- `core.alertas_tempranas.codigo_alerta` ← `dim_alertas.id_alerta`
- `core.documentos.codigo` ← id legado (`id_rr`, `id_clima`, `id_analisis`, `id_redaccion`, `id_ct`)
- `core.compromisos.codigo_compromiso` ← sintético `<caso>_COMP001`

Donde no hay clave (actores, organizaciones, usuarios), UUID determinista:

```sql
(md5('avisa2026:' || legacy_id)::uuid)   -- estable entre corridas => carga idempotente
```

### 8.3 Orden de carga (por dependencias reales de v9)

1. Catálogos que v9 deja vacíos: `cat_tematicas`, `cat_subsectores`, `cat_tipos_actor` 1–3,
   `cat_roles_actor` 1–3, `cat_especies`, `cat_unidades_organicas` (+ `core.entidades`).
2. Territorio: `regiones` → `provincias` → `distritos` (por ubigeo, no por nombre).
3. `core.actores` (personas) → `core.organizaciones` → `core.actor_membresia` →
   `core.actor_datos_personales` (`nivel_clasificacion = 3`).
4. `core.usuarios` + `usuario_roles` (necesita unidades orgánicas).
5. `core.casos` → `caso_distritos` → `caso_factores` → `caso_estado_historial` → `casos_actores`.
6. `core.documentos` (RR, CS, CSF, análisis, redacciones, CT).
7. `core.caso_cronologia` → `fuentes_evidencia` → `cronologia_vinculos`.
8. `core.demandas` → `demandas_actores` → `demandas_evidencias`.
9. `core.alertas_tempranas` → `alertas_actores` → `derivaciones_alerta`.
10. `core.compromisos` (sintéticos) → `hitos_compromiso` → `hitos_compromiso_estado_historico`.
11. `core.notificaciones` (desde `log_envios`, parcial).
12. Fase 2: `kag.actor_profile`, `kag.aristas` (desde las tablas puente de posición/interés,
    hoy vacías), `domain.artefacto` (no aplica al legado).

### 8.4 Marcas de procedencia (obligatorias en cada fila)

`origen_dato = 'AVISA_HISTORICO'`, `fuente_original = 'avisa_historico'`,
`es_seed_historico = TRUE` (sólo `core.casos`), `es_validado_humano = TRUE` (dato curado
manualmente por OAIPCS), `confidence = 1.0`, `nivel_clasificacion = 2` (3 para PII).

### 8.5 Idempotencia

`INSERT ... ON CONFLICT (clave_natural) DO UPDATE` sobre las tablas con clave natural; para las
UUID deterministas, `ON CONFLICT (id) DO NOTHING`. Un `TRUNCATE` selectivo por fase permite
re-correr sin `drop schema`.

---

## 9. Perfilado previo (ejecutar antes de escribir el cargador)

### 9.1 Volumen y forma

```sql
-- 1) ¿Los ids de caso/cción son realmente únicos y no nulos?
SELECT count(*), count(DISTINCT id_caso), count(*) FILTER (WHERE id_caso IS NULL) FROM legacy.fact_casos;
SELECT count(*), count(DISTINCT id_alerta) FROM legacy.dim_alertas;

-- 2) Alertas sin caso (bloquean core.alertas_tempranas.caso_id NOT NULL)
SELECT count(*) FROM legacy.dim_alertas WHERE id_caso_vinculado IS NULL OR id_caso_vinculado = '';

-- 3) Ubigeo: longitud y dígitos (v9 exige CHAR(2/4/6) numérico)
SELECT length(id_ubigeo), count(*) FROM legacy.dim_distritos GROUP BY 1 ORDER BY 1;
SELECT id_ubigeo FROM legacy.dim_provincias WHERE id_ubigeo !~ '^[0-9]{4}$';

-- 3b) ¿El ubigeo del distrito empieza por el de su provincia? (si no, la jerarquía está rota)
SELECT count(*) FROM legacy.dim_distritos d
  JOIN legacy.dim_provincias p ON p.id_provincia = d.id_provincia
 WHERE left(d.id_ubigeo, 4) <> p.id_ubigeo;

-- 4) Seriales de Excel en columnas DECIMAL que deberían ser fechas
SELECT date_cierre, count(*) FROM legacy.fact_casos
 WHERE date_cierre ~ '^[0-9]+\.?[0-9]*$' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

### 9.2 Categóricos: hay que ver los valores antes de mapear

```sql
SELECT prioridad, count(*) FROM legacy.fact_casos GROUP BY 1 ORDER BY 2 DESC;
SELECT nivel, categoria, count(*) FROM legacy.dim_nivel_alertas GROUP BY 1,2;
SELECT nombre_proceso, es_terminal, count(*) FROM legacy.dim_estado_proceso GROUP BY 1,2;
SELECT tipo_documento, count(*) FROM legacy.dim_redaccion GROUP BY 1 ORDER BY 2 DESC;
SELECT tipo_documento, count(*) FROM legacy.dim_coordinacion_tecnica GROUP BY 1 ORDER BY 2 DESC;
SELECT tipo_riesgo FROM legacy.dim_riesgos;
SELECT tipo_caso FROM legacy.dim_tipo_caso;
SELECT tipo_sector FROM legacy.dim_tipo_sector;
SELECT tipo_tematica FROM legacy.dim_tipo_tematica;
SELECT tipo_espacio, tipo_instrumento, con_norma, estado_vigencia, count(*)
  FROM legacy.dim_mesas_grupos GROUP BY 1,2,3,4 ORDER BY 5 DESC;
```

Sin estas listas, cualquier mapeo de catálogo es una suposición.

### 9.3 Duplicados de personas (el riesgo más caro)

```sql
-- DNI normalizado a 8 dígitos: ¿cuántos choques entre los dos censos de personas?
SELECT lpad(dni::text, 8, '0') AS dni8, count(*) FILTER (WHERE origen = 'actores') AS en_actores,
       count(*) FILTER (WHERE origen = 'estado') AS en_estado
  FROM (SELECT dni, 'actores' AS origen FROM legacy.dim_actores
        UNION ALL SELECT dni::numeric::text, 'estado' FROM legacy.dim_actores_estado) t
 GROUP BY 1 HAVING count(*) > 1;
```

---

## 10. Esfuerzo y riesgos

| Fase | Trabajo                                                                                      | Estimación                         |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| 0    | Decisiones de §1.2 + listados de §9.2 (OAIPCS)                                               | 1–2 días, **bloqueante**           |
| 1    | Sembrar catálogos vacíos de v9 con las dims legadas + parchear los id 1–3                    | 0,5 día                            |
| 2    | Importador a `legacy.*` (todas TEXT) + perfilado                                             | 1 día                              |
| 3    | Carga A+C (territorio, documentos, dims) — 1.432 filas                                       | 1 día                              |
| 4    | Carga B: actores/orgs (1.160), casos (35+33), demandas (368), alertas (250), cronología (80) | 2–3 días                           |
| 5    | Compromisos/hitos sintéticos + verificación de conteos y de RLS                              | 1 día                              |
| 6    | Tablas nuevas para la clase D acordada (mesas, locales, auditoría)                           | 2–4 días, fuera del alcance mínimo |

**Riesgo principal:** los catálogos de v9 están incompletos _y_ el legado es la única fuente; si
se siembra `cat_tematicas` con los 7 valores del Excel, esos 7 valores quedan como taxonomía
oficial del sistema nuevo. Es una decisión de negocio, no técnica.

**Riesgo secundario:** `pct_avance`, `tripleP`, `nivel_conflicto` y `mesas` son huecos de
modelo, no de datos. Si se fuerza su carga con valores por defecto, el sistema nuevo nace con
datos que _parecen_ completos y no lo están.

## 11. Preguntas abiertas para OAIPCS

1. `nivel_conflicto` (4 niveles de la Guía): ¿se deriva del `id_riesgos`/`id_nivel_alerta`, se
   deja en `Conflicto_social` por defecto, o se completa caso por caso?
2. Demandas: ¿se separan `problema`/`pedido` de `descripcion_demanda`, o se acepta duplicar el
   texto?
3. ¿Se conserva el vínculo alerta↔demanda (231 filas) o se re-parenta al caso?
4. `pct_avance` del caso: ¿se deriva de hitos, se guarda como columna nueva, o se abandona?
5. Mesas/grupos de diálogo (21 filas con base legal y vigencia): ¿tabla nueva en v9?
6. DNI y teléfonos: ¿se conservan (columna nueva en `core.actor_datos_personales`) o se
   descartan por política de datos personales?
7. ¿Se necesita la auditoría de accesos (857 filas) o se delega al IdP?

---

## Anexo A — Tabla completa: 86 tablas legadas

Clases: **A** directa · **B** transformación estructural · **C** absorbida en JSON/derivado ·
**D** sin destino en v9 · **X** vacía.

|   # | Tabla legada                      | Filas | Cols | Clase | Destino v9                                                                                            |
| --: | --------------------------------- | ----: | ---: | :---: | ----------------------------------------------------------------------------------------------------- |
|   1 | `respuestas_de_formulario_1`      |     1 |   23 |   B   | `core.alertas_tempranas` + `core.actores` (formulario Google; `avisa.raw_ingest.fuente` no lo admite) |
|   2 | `bridge_capacitacion_participant` |     9 |    5 |   D   | — (capacitaciones no modeladas)                                                                       |
|   3 | `dim_capacitaciones`              |     1 |   12 |   D   | —                                                                                                     |
|   4 | `fact_analisis_casos`             |     1 |   26 |   C   | `core.documentos` tipo `analisis_caso` (JSON → `contenido_json`)                                      |
|   5 | `bridge_alerta_recurso`           |    32 |    3 |   D   | propuesta `core.alerta_especies`                                                                      |
|   6 | `bridge_caso_actorestado`         |     1 |    3 |   B   | `core.casos_actores`                                                                                  |
|   7 | `log_accesos`                     |   857 |    5 |   D   | — (auditoría de login inexistente)                                                                    |
|   8 | `fact_casos`                      |    35 |   28 |   B   | `core.casos` + `caso_distritos` + `caso_factores`                                                     |
|   9 | `fact_proceso_caso`               |    36 |   10 |   D   | — (flujo por pasos)                                                                                   |
|  10 | `fact_red_radar`                  |     1 |    6 |   D   | — (red de radares)                                                                                    |
|  11 | `fact_nodo`                       |     1 |    9 |   D   | —                                                                                                     |
|  12 | `fact_proceso_reporte`            |    99 |    8 |   D   | — (flujo por pasos)                                                                                   |
|  13 | `dim_paso_proceso_caso`           |     4 |    6 |   D   | —                                                                                                     |
|  14 | `dim_paso_proceso`                |     3 |    5 |   D   | —                                                                                                     |
|  15 | `fact_historial_estado`           |    33 |   10 |   B   | `core.caso_estado_historial`                                                                          |
|  16 | `dim_tipo_cambio`                 |     6 |    3 |   C   | `core.caso_estado_historial.motivo`                                                                   |
|  17 | `log_envios`                      |    17 |   13 |   B   | `core.notificaciones` (parcial)                                                                       |
|  18 | `dim_alertas`                     |    83 |   31 |   B   | `core.alertas_tempranas` + `alertas_actores` + `derivaciones_alerta`                                  |
|  19 | `dim_reporte_rapido`              |     1 |   25 |   C   | `core.documentos` tipo `reporte_rapido`                                                               |
|  20 | `dim_climasocial`                 |     7 |   28 |   C   | `core.documentos` tipo `clima_social_general`                                                         |
|  21 | `dim_climasocial_focalizado`      |     6 |   26 |   C   | `core.documentos` tipo `clima_social_focalizado`                                                      |
|  22 | `dim_riesgos`                     |     3 |    2 |   A   | `core.cat_niveles_riesgo`                                                                             |
|  23 | `dim_locales`                     |    27 |   15 |   D   | propuesta `core.locales`                                                                              |
|  24 | `dim_destinatarios_fijos`         |     4 |    7 |   D   | propuesta `core.suscripcion_notificacion`                                                             |
|  25 | `dim_recurso_pesca`               |    37 |    6 |   A   | `core.cat_especies` (renombrar la columna sin nombre)                                                 |
|  26 | `dim_estado_proceso`              |     5 |    4 |   B   | `core.cat_estados_caso` (5 → 4)                                                                       |
|  27 | `bridge_caso_recurso`             |     0 |    3 |   X   | —                                                                                                     |
|  28 | `bridge_caso_demandas`            |    12 |    5 |   A   | `core.demandas.caso_id`                                                                               |
|  29 | `bridge_alerta_demandas`          |   231 |    5 |   B   | `core.demandas` (pierde el vínculo con la alerta)                                                     |
|  30 | `bridge_alerta_actorestado`       |     5 |    3 |   A   | `core.alertas_actores`                                                                                |
|  31 | `dim_tipo_tematica`               |     7 |    3 |   A   | `core.cat_tematicas` (semilla; hoy vacía)                                                             |
|  32 | `dim_demandas`                    |   325 |    9 |   B   | `core.demandas` (3P obligatorio)                                                                      |
|  33 | `dim_anuncios_acuerdos`           |     0 |    7 |   X   | —                                                                                                     |
|  34 | `dim_nivel_alertas`               |     4 |    4 |   B   | `cat_prioridades_alerta` o `cat_niveles_conflicto` (eje a decidir)                                    |
|  35 | `bridge_caso_descencadenantes`    |     1 |    4 |   C   | `documentos.contenido_json`                                                                           |
|  36 | `bridge_caso_impulsores`          |     5 |    4 |   C   | `documentos.contenido_json`                                                                           |
|  37 | `bridge_caso_causas`              |     4 |    4 |   C   | `documentos.contenido_json`                                                                           |
|  38 | `bridge_caso_medios`              |     4 |    7 |   C   | `documentos.contenido_json`                                                                           |
|  39 | `bridge_actor_grupo`              |     0 |    3 |   X   | — (`kag.aristas` cuando exista dato)                                                                  |
|  40 | `bridge_caso_posiciones`          |     0 |    5 |   X   | — (`core.casos_actores.posicion`)                                                                     |
|  41 | `bridge_caso_intereses`           |     0 |    5 |   X   | — (`kag.actor_profile_attribute`)                                                                     |
|  42 | `bridge_caso_necesidades`         |     0 |    5 |   X   | — (idem)                                                                                              |
|  43 | `bridge_caso_ineteres_comunes`    |     0 |    4 |   X   | —                                                                                                     |
|  44 | `dim_descencadenantes`            |     0 |    2 |   X   | —                                                                                                     |
|  45 | `dim_impulsores`                  |     0 |    2 |   X   | —                                                                                                     |
|  46 | `dim_causas`                      |     0 |    2 |   X   | —                                                                                                     |
|  47 | `dim_medios`                      |     0 |    5 |   X   | —                                                                                                     |
|  48 | `dim_tipo_proceso`                |     4 |    6 |   B   | `core.cat_tipos_documento`                                                                            |
|  49 | `dim_acciones_hitos`              |     8 |   13 |   B   | `core.plan_acciones` (requiere PAR/PAE)                                                               |
|  50 | `dim_hitos`                       |    12 |   13 |   B   | `core.hitos_compromiso` (requiere compromiso)                                                         |
|  51 | `dim_redaccion`                   |    51 |   13 |   C   | `core.documentos`                                                                                     |
|  52 | `dim_coordinacion_tecnica`        |     4 |   13 |   C   | `core.documentos`                                                                                     |
|  53 | `dim_mesas_grupos`                |    21 |   23 |   D   | propuesta `core.espacios_dialogo`                                                                     |
|  54 | `dim_organizacion`                |   224 |   16 |   A   | `core.actores` + `core.organizaciones`                                                                |
|  55 | `dim_tipo_org`                    |     4 |    2 |   B   | `core.cat_tipos_actor` (eje distinto)                                                                 |
|  56 | `dim_actores`                     |   828 |   16 |   B   | `core.actores` + `actor_datos_personales` + `actor_membresia`                                         |
|  57 | `dim_actores_estado`              |   108 |   15 |   B   | `core.actores` (fusionar con #56)                                                                     |
|  58 | `fact_hechos_casos`               |    80 |   13 |   B   | `core.caso_cronologia` + `fuentes_evidencia` + `cronologia_vinculos`                                  |
|  59 | `bridge_caso_depto`               |    87 |    6 |   A   | `core.caso_distritos`                                                                                 |
|  60 | `bridge_caso_actor`               |    80 |    3 |   B   | `core.casos_actores` (posicion/influencia por defecto)                                                |
|  61 | `bridge_radar_actor`              |     1 |    4 |   D   | —                                                                                                     |
|  62 | `bridge_nodo_actor`               |     3 |    4 |   D   | —                                                                                                     |
|  63 | `bridge_caso_actor_estado`        |    61 |    3 |   B   | `core.casos_actores`                                                                                  |
|  64 | `bridge_alerta_actor`             |   162 |    6 |   A   | `core.alertas_actores` (se pierden rol/es_principal)                                                  |
|  65 | `bridge_reporte_actor`            |     1 |    5 |   D   | propuesta `core.documento_actores`                                                                    |
|  66 | `bridge_reporte_actor_estado`     |     1 |    5 |   D   | idem                                                                                                  |
|  67 | `bridge_clima_actor`              |     1 |    5 |   D   | idem                                                                                                  |
|  68 | `bridge_clima_actor_estado`       |     1 |    5 |   D   | idem                                                                                                  |
|  69 | `bridge_sectorista_departamento`  |    27 |    3 |   D   | propuesta `core.usuario_territorio`                                                                   |
|  70 | `dim_departamentos`               |    27 |    8 |   A   | `core.regiones`                                                                                       |
|  71 | `dim_provincias`                  |    70 |    5 |   A   | `core.provincias`                                                                                     |
|  72 | `dim_distritos`                   |   698 |    8 |   A   | `core.distritos`                                                                                      |
|  73 | `dim_tipo_caso`                   |     4 |    3 |   B   | `core.cat_tematicas` (o descartar)                                                                    |
|  74 | `dim_rol_actor`                   |     4 |    3 |   A   | `core.cat_roles_actor` (sembrar 1–3)                                                                  |
|  75 | `dim_tipo_sector`                 |     3 |    3 |   A   | `core.cat_subsectores` (semilla; hoy vacía)                                                           |
|  76 | `dim_tipo_actor`                  |     3 |    2 |   A   | `core.cat_tipos_actor` (sembrar 1–3)                                                                  |
|  77 | `dim_tipo_actor_radar`            |     3 |    2 |   D   | —                                                                                                     |
|  78 | `dim_perfil`                      |     3 |    2 |   B   | `kag.actor_profile.resumen`                                                                           |
|  79 | `dim_intervencion`                |     4 |    2 |   D   | —                                                                                                     |
|  80 | `dim_sectoristas`                 |    15 |   13 |   B   | `core.usuarios` + `usuario_roles` (sin contraseña)                                                    |
|  81 | `dim_punto_focal`                 |    17 |   12 |   B   | idem (rol `punto_focal` **no existe** en v9)                                                          |
|  82 | `dim_autoridades`                 |     2 |   12 |   B   | idem (rol `alta_direccion`)                                                                           |
|  83 | `dim_responsable`                 |     3 |    4 |   D   | — (puntero polimórfico)                                                                               |
|  84 | `dim_entidad_responsable`         |    23 |    5 |   B   | `core.actores` (tipo Público)                                                                         |
|  85 | `dim_area_responsable`            |    66 |    5 |   B   | `core.cat_unidades_organicas`                                                                         |
|  86 | `dim_unidades_organicas_responsa` |    27 |    6 |   B   | `core.cat_unidades_organicas` (colisión con #85)                                                      |

Totales verificados: 86 tablas · 4.649 filas · A=14 (1.342 filas) · B=27 (2.077) · C=11 (90) ·
D=23 (1.140) · X=11 (0).

## Anexo B — Referencias al DDL v9

| Objeto v9                                                                                     | Línea                       |
| --------------------------------------------------------------------------------------------- | --------------------------- |
| `core.cat_niveles_conflicto` (y su trigger de gobernanza)                                     | 109, 141                    |
| `core.cat_niveles_riesgo` / `cat_prioridades_atencion` / `cat_prioridades_alerta`             | 192 / 197 / 202             |
| `core.cat_estados_caso` / `cat_alcances_geograficos` / `cat_estados_hito`                     | 208 / 213 / 227             |
| `core.cat_tematicas` / `cat_subsectores` / `cat_tipos_actor` / `cat_roles_actor`              | 253–260                     |
| `core.cat_tipos_documento` (12 códigos)                                                       | 261–271                     |
| `core.regiones` / `provincias` / `distritos`                                                  | 276 / 279 / 283             |
| `core.roles` (7 códigos) / `usuarios` / `usuario_roles`                                       | 290 / 297 / 303             |
| `core.actores` / `actor_datos_personales` / `organizaciones` / `actor_membresia`              | 308 / 322 / 329 / 336       |
| `core.casos` / `caso_distritos` / `caso_estado_historial` / `caso_factores` / `casos_actores` | 388 / 413 / 421 / 430 / 434 |
| `core.alertas_tempranas` / `alertas_actores` / `derivaciones_alerta`                          | 448 / 461 / 465             |
| `core.reuniones_dialogo` / `reunion_participantes`                                            | 473 / 487                   |
| `core.documentos` / `planes_accion` / `plan_acciones`                                         | 492 / 506 / 511             |
| `core.caso_cronologia` / `fuentes_evidencia` / `cronologia_vinculos`                          | 518 / 529 / 534             |
| `core.demandas` / `demandas_actores` / `demandas_evidencias`                                  | 539 / 552 / 557             |
| `core.compromisos` / `hitos_compromiso` (+histórico)                                          | 563 / 596 / 603             |
| `kag.actor_profile` / `nodos` / `aristas` / `entity_merge_log`                                | 619 / 651 / 667 / 688       |
| `core.set_audit()` (trigger de auditoría)                                                     | 801                         |
| `core.clasificacion_max()` / bloque RLS de 14 tablas                                          | 951 / 954–966               |
| `core.notificaciones`                                                                         | 786                         |
| `domain.artefacto` (RLS + triggers)                                                           | 2284                        |
| Semillas de `cat_tipos_actor` / `cat_roles_actor` (sólo 4–7 / 4–6)                            | 3055 / 3059                 |
