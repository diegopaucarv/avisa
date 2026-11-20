# Clasificación de componentes — AVISA actual: entrada · proceso · salida · infraestructura

Análisis derivado de:

- `docs/avisa_actual/Catálogo de funciones — Code.gs (AVISA OAIPCS).md` (backend, 244 funciones)
- `docs/avisa_actual/Catálogo de funciones — Frontend SIPRECS AVISA (AppJs AppFixes).md` (450 funciones, con ~35 redefiniciones)
- `docs/avisa_actual/clases.puml` (P1 Frontend, P2 Backend, P3 86 tablas)

El objetivo es responder a la pregunta operativa: **¿qué de lo que hoy se hace a mano es entrada irreductible, qué es salida automatizable y qué es proceso que puede delegarse a un agente?**

Como marco de destino se usa la arquitectura v9 (`docs/AVISA_PRODUCE_v10.md` §9.2 y
`backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql`), que distingue **agentes LLM** (A1, A2, A3) de
**servicios deterministas**, y que ya contiene las tablas donde aterrizan estas clases:
`avisa.raw_ingest` (entrada), `agent.*` (proceso), `ind.plantilla` + `core.cat_tipos_documento`
(salida).

---

## 1. Criterio de clasificación

No se clasifica por módulo de pantalla, sino por la **transformación de datos** que el componente
ejecuta. Un mismo módulo de interfaz puede contener las tres clases (p. ej. "Hechos ocurridos"
tiene un formulario de entrada, una línea de tiempo de salida y un guardado de proceso).

| Clase                       | Definición                                                                                                                       | Nivel v9              | Regla de decisión                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **I · Entrada manual**      | Captura de dato que solo existe en una cabeza o en un papel: testimonio, declaración, foto, acta, criterio de priorización.      | HITL                  | Si el dato no está en ninguna fuente online ni se puede inferir, es entrada. **No automatizar; sí asistir.** |
| **O · Salida automática**   | Render reproducible de datos que el sistema ya tiene. Determinista, sin juicio, con plantilla fija.                              | Servicio determinista | Si dos ejecuciones con el mismo input deben dar el mismo output, es salida.                                  |
| **P · Proceso con IA**      | Transformación no trivial sobre texto libre: extraer, clasificar, relacionar, resumir, redactar, priorizar. No reproducible 1:1. | A1 / A2 / A3 + HITL   | Si el output es una **afirmación sobre el mundo** y no un render de un dato, es proceso con IA.              |
| **INF · Infraestructura**   | No es ni entrada ni proceso de negocio: bootstrap, auth ampliada, navegación, storage, logging, mantenimiento de datos.          | Base de plataforma    | Si su función es servir o enlazar las otras tres clases, es infraestructura.                                 |
| **M · Muerto / consolidar** | Duplicado, redefinición que sobrescribe, alias de compatibilidad o versión básica sustituida por la completa.                    | Eliminar              | Si la última definición gana y la anterior no se invoca, no se migra.                                        |

> La distinción **I / P** es el eje que más importa. Un formulario de caso es I aunque tenga 20
> campos, y `getKPIsReporte` es O aunque calcule 21 indicadores, porque uno captura y el otro
> deriva.

---

## 2. PUNTOS DE ENTRADA — qué se captura hoy y quién lo hace

Lo manual del sistema actual se concentra en **6 puntos de captura** que generan casi todo el
volumen de datos. Tres de ellos son _re-ejercicios del mismo hecho_ (el conflicto se escribe hasta
cuatro veces con distinto nivel de detalle).

| #   | Punto de entrada                  | Funciones actuales                                                                                                           | Dato que captura                                                                                                        | ¿Automatizable?                                                                                                                                  |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | **Caso**                          | `guardarNuevoCaso()`, `guardarCaso()`, `editarFichaCaso()`, `guardarEdicionCaso()`, `abrirDetalleCaso()`                     | Tipo, temática, sector, ubigeo, prioridad, riesgo, resumen ejecutivo, %avance.                                          | Título/temática/riesgo: **extraíbles** de un relato libre (A1). Ubigeo: **geocodificable**. Prioridad e intervención: **criterio humano**.       |
| I2  | **Hechos ocurridos**              | `guardarNuevoHecho()`, `guardarHecho()`, `editarHecho()`                                                                     | Fecha, tipo, crítico sí/no, descripción, foto/evidencia.                                                                | `descripcion` y foto → **A1 transcribe y estructura** (el catalog ya lee `foto` y `link_evidencia`).                                             |
| I3  | **Alerta temprana**               | `guardarNuevaAlerta()`, `guardarAlerta()`, `editarAlerta()`, `abrirDetalleAlerta()`                                          | Situación actual, hechos recientes, nivel de alerta, acciones sugeridas, acciones OAIPCS, fuente/link.                  | Redacción redactable por **A3**; nivel de alerta **proponible** por A2 y validado por persona. `ids_actores_existentes` → resolución automática. |
| I4  | **Reporte rápido / Clima social** | `guardarRR()`, `guardarClima()`, `guardarClimaSocial()`, `guardarClimaSocialFocalizado()`, `guardarBridgeAnunciosAcuerdos()` | Resumen, desarrollo de intervención, anuncios y acuerdos, situación, focos de tensión, oportunidades.                   | **A1** desde actas/transcripciones; `anuncios_acuerdos` ya está normalizado a filas y es buen punto de extracción.                               |
| I5  | **Análisis de conflictividad**    | `abrirFormAnalisisNuevo()`, `_guardarAnalisisForm()`, `guardarAnalisisCaso()`, `_buildListaRegistro()`, `_agregarMedio()`    | Manifestaciones, desencadenantes, impulsores, causas, medios, grupos/posiciones/intereses, agravantes, recomendaciones. | **El candidato más fuerte a A2**: son `JSON` libres en `fact_analisis_casos` sin catálogo obligatorio. Pauta guiada + HITL.                      |
| I6  | **Catálogos y maestros**          | `cargarMaestros()`, CRUD actores/organizaciones/locales/personal                                                             | Geografía, tipos, temáticas, riesgos, recursos, organizaciones, locales, sectoristas, PF, autoridades.                  | **No automatizar**: es dato de referencia. Sí **consolidar** (hoy de 2 fuentes: Sheets y `respuestas_de_formulario_1`).                          |

### Entrada semi-manual que debería dejar de serlo

Estos ya son entrada manual hoy pero **no tienen por qué serlo mañana**, porque el dato existe en
otra parte:

- **Ubicación geográfica** (depto/provincia/distrito) — hoy 5 selects en cascada (`cargarProvincias`,
  `cargarDistritos`, `_asegurarDeptos`). Es derivable de la dirección o del texto libre → geocoding.
- **Actores vinculados a un caso/alerta** (`agregarActor`, `agregarActorEstadoGen`,
  `llenarSelectActoresEstadoCaso`, `buildActoresSelect`) — hoy se eligen manualmente de caché. Es
  una **resolución de entidad** (Resolver: trigramas >0,85 fusiona; 0,6–0,85 HITL, v9 §9.2).
- **Demandas** (`agregarDemandaForm`, `agregarDemanda`, `guardarDemanda`) — hoy se teclean una por
  una. Son texto libre con temática → **extracción A1** sobre la descripción del hecho.
- **Recursos vinculados** (`agregarRecursoGen`) — derivable del tipo de intervención.

---

## 3. COMPONENTES DE PROCESO — qué tareas pueden usar IA

Son las transformaciones que hoy no existen en el sistema (el sistema solo _guarda y lee_, más una
maqueta de consultas con IA que nunca operó) y que en v9 pasan a los tres agentes.

| #       | Proceso                                                                                                  | Estado hoy                                                                                                                             | Destino IA                                                                                           | HITL obligatorio                                                              |
| ------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **P1**  | **Estructuración del relato del sectorista** → JSON tipado según schema                                  | Imposible: hay que rellenar 20 campos a mano.                                                                                          | **A1 (Extractor-Estructurador)** contra `avisa.raw_ingest` y `agent.cat_detalle_schema`.             | Sí: corregir campos con baja confianza.                                       |
| **P2**  | **Clasificación** (tipo de caso, temática, riesgo, nivel de alerta, tono)                                | Manual en cada formulario; sin catálogo obligatorio (las `descripcion_*` son texto libre).                                             | **A1** clasifica contra `dim_tipo_caso` / `dim_tipo_tematica` / `dim_riesgos` / `dim_nivel_alertas`. | Sí para nivel de alerta (tiene consecuencia institucional).                   |
| **P3**  | **Extracción de demandas y actores desde el texto**                                                      | Manual, uno por uno (`agregarDemandaForm`, `crearActorRapido`).                                                                        | **A1** NER + extracción de relaciones. Resolver con umbral para no duplicar `dim_actores`.           | Sí en la franja 0,6–0,85.                                                     |
| **P4**  | **Análisis de conflictividad** (manifestaciones, impulsores, causas, posiciones)                         | 15+ campos JSON libres sin guía; depende del analista y no es reproducible.                                                            | **A2 (Generador de Pautas)**: pauta, codificación sugerida, contrastes; sesión `agent.sesion`.       | **Alto**: es análisis, no extracción. Nunca cerrado sin decisión humana.      |
| **P5**  | **Triangulación y detección de contradicciones** entre casos, alertas, clima, medios y datos de contexto | No existe. Cada documento se redacta aislado.                                                                                          | **A2 / Critic**: contraste con `ctx` y `kag`; marca vacíos y contradicciones.                        | Sí: decidir ante la contradicción es incompatible con automatizar hoy (§9.5). |
| **P6**  | **Redacción de documentos** (Anexo 8, Minister View, resumen por depto)                                  | Manual: se rellenan campos y el sistema _imprime_ (`generarWordAnalisis`, `generarPDFAnalisis`).                                       | **A3 (Sintetizador)**: produce texto con citas a partir de los datos ya estructurados.               | Sí: una afirmación redactada sobre el territorio requiere cuatro ojos.        |
| **P7**  | **Priorización / riesgo latente**                                                                        | Manual por `prioridad` en `fact_casos`, sin criterio registrado.                                                                       | **A2** propone ranking; **servicio determinista** calcula indicadores base.                          | Sí.                                                                           |
| **P8**  | **Seguimiento de plazos y detección de demora**                                                          | Manual (`getPendientes`, `avanzarPaso*`); el paso depende de que alguien lo mueva.                                                     | **Servicio** (determinista, `fact_proceso_caso.dias_demora` vs `dim_paso_proceso.dias_plazo_max`).   | No es IA; alertas automáticas.                                                |
| **P9**  | **Deduplicación / reconciliación de registros**                                                          | Existe solo para alertas y como script suelto (`repararAlertasDuplicadas`, `diagnosticarAlertasDuplicadas`, `migrarLlavesUnificadas`). | **Resolver + servicio** sobre todos los `dim_*`; hoy se muta la fuente (deuda).                      | Sí en zona gris.                                                              |
| **P10** | **Mantenimiento de la calidad del esquema**                                                              | Si una columna no existe, el código la **crea** al escribir (`_asegurarColumnas*`, 12 funciones).                                      | **Proceso de validación de schema** antes de escribir; nunca mutar tablas en producción.             | — (es infraestructura, no IA).                                                |

### El hallazgo principal: el sistema actual **no procesa** (la IA quedó en maqueta)

No existe una sola función que _transforme_ un texto libre en estructura ordenada. Las 244 funciones
del backend son `get*` (lectura), `guardar*/actualizar*/eliminar*` (CRUD) y `generar*` (render). El
"procesamiento" ocurre hoy **en la cabeza del sectorista**, y es por eso que:

- los campos semánticos (`situacion_actual`, `hechos_recientes`, `resumen_ejecutivo`,
  `descripcion_riesgo`, `manifestaciones`, `causas`…) son `TEXT`/`JSON` sin catálogo;
- los auxiliares `_asegurarColumnas*` existen porque el esquema no se validaba.

**La salvedad de la IA.** El sistema anterior sí tenía un módulo de consultas con IA. En `Código.txt`
hay un conector a Gemini (`_llamarGemini`) con `analizarConsultaGeneral`, `buscarConIA` y
`analizarCasoConIA`, y en el navegador existe la pantalla «Consultas con IA». **Nunca operó**: la
clave era el marcador `PENDIENTE_API_KEY_GEMINI`, cada llamada devolvía el aviso de que faltaba
configurarla y no hay uso en producción. Era una maqueta, y por eso no altera el hallazgo: no
devolvía estructura, devolvía texto —y ni eso, porque nunca llegó a ejecutarse.

Es exactamente el vacío que cubren P1–P7. Por eso la migración de AVISA no consiste en _portar
funciones_ sino en **separar lo que el sistema nunca separó: capturar ≠ pensar ≠ imprimir**.

---

## 4. COMPONENTES DE SALIDA — automatizables sin IA

Estos son deterministas: con el mismo estado de base deben producir el mismo documento. Son el
mayor volumen de esfuerzo repetitivo hoy y **no necesitan modelo de lenguaje**.

### 4.1 Generadores de documento (`generar*`, 12 funciones, ~1 400 líneas)

| Función                                                                | Output                      | Líneas aprox. | Acción en v9                                                                    |
| ---------------------------------------------------------------------- | --------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `generarWordAnalisis`, `generarPDFAnalisis`                            | Anexo 8 (Word/PDF)          | ~340          | Plantilla (`ind.plantilla`/`core.cat_tipos_documento`); el render no es lógica. |
| `generarReporteAlerta`                                                 | Ficha de alerta + correo    | 309           | Plantilla + servicio de envío.                                                  |
| `generarReporteActoresPDF`                                             | Fichas de actores con fotos | 187           | Plantilla.                                                                      |
| `generarReporteDatosActores`                                           | Tabla de contacto           | —             | Consulta SQL + plantilla.                                                       |
| `generarReporteOrganizaciones`                                         | Fichas de organización      | —             | Plantilla.                                                                      |
| `generarReporteLocales`                                                | Fichas de locales           | ~100          | Plantilla.                                                                      |
| `_exportarReporte`, `_generarDocSimpleYGuardarLink`, `enviarDocumento` | Export y envío              | ~70           | Servicio de render/entrega.                                                     |

> **Riesgo actual en la salida**: hay ~9 auxiliares `_*Doc` (`_resolverNombreDim`, `_bridgeActoresDoc`,
> `_demandasPorTematica`, `_mapaDepartamentos`, `_mapaActores`, `_actoresConFotoDoc`…) que duplican
> lógica de lectura que ya existe en `getFichaCasoCompleta`. Cada generador resuelve nombres por su
> cuenta. En v9 la resolución de nombres es **una sola vista**, y el generador solo pinta.

### 4.2 Exportaciones y vistas

| Componente                                                                                                                                                 | Estímulo                                                         | Clase                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| `exportCSV`, `exportarPendientes`, Excel/PDF con mismo permiso                                                                                             | Bajo, ya automatizado.                                           | **O**                                   |
| **KPIs / Cuadro de mando** — `getKPIsReporte` (21 indicadores, 4 ejes), `getReporteEjecutivoAnual`, `getReporteActoresSociales`, `getDepartamentosReporte` | Hoy se recalculan en cada request sobre Sheets (175+174 líneas). | **O**                                   |
| Dashboard (`cargarDashboard`, `renderDashboard`)                                                                                                           | Render trivial.                                                  | **O**                                   |
| Línea de tiempo (`verLineaTiempo`, `renderLineaTiempo`)                                                                                                    | Deriva de `fact_hechos_casos`.                                   | **O**                                   |
| Recorrido del proceso (`verRecorridoCaso`, `verRecorridoReporte`)                                                                                          | Deriva de `fact_proceso_*.`                                      | **O**                                   |
| Bandeja de pendientes, por rol (`getPendientes`, `renderPendientes`, 296 líneas)                                                                           | Es una **consulta con reglas de rol** disfrazada de render.      | **O + INF**                             |
| Reporte regional (`_generarReporteRegional`, `_verReporteDepto`)                                                                                           | Agregación por departamento.                                     | **O**                                   |
| Vista Minister / Office (v9 §10)                                                                                                                           | **No existe hoy.** Es el hueco de salida más importante.         | **O** (una vez que A3 redacte el texto) |

### 4.3 Notificaciones

`generarMensajeWA`, `abrirWhatsApp*`, `registrarEnvioWA`, `enviarCorreo*`, `enviarNotificacionValidacion`,
`enviarNotifPF`, `enviarCorreoCasoDirecto` — todos son **O + INF**: formatean un mensaje fijo y lo
entregan. No hay juicio. Hoy el envío requiere que una persona apriete el botón, y algunos abren
`wa.me` con texto prellenado; eso es automatizable vía servicio.

---

## 5. INFRAESTRUCTURA — ni entrada ni proceso

| Componente                                                                                           | Qué es                                                   | Comentario                                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `doGet`, `include`, `getJs1..7`                                                                      | Bootstrap que sirve 7 bundles y los ejecuta con `eval()` | **Deuda crítica**: sin módulos ni cacheable; bloquea cualquier rediseño de frontend. |
| `LoginUI`, `verificarLogin`, `registrarAcceso`, permisos por rol (`puedeDescargar`, `puedeValidar`…) | Auth con clave numérica en hoja.                         | v9 lo sustituye por SSO + RBAC (D7). Es funcional pero **no debe migrarse literal**. |
| `agregarDepto`, `eliminar*`, `renderBridgeLista`, `iniciarBridgesGen`…                               | Puentes N:N de UI.                                       | INF con innumerables duplicados; se disuelve en el modelo relacional.                |
| `procesarFoto`, `subirEvidencia*`, `abrirCarpetaCaso*`, `_carpetaDe`                                 | Storage en Drive.                                        | INF: sustituible por object storage institucional.                                   |
| `eliminarFila`, `eliminarRegistro`, `confirmarEliminar`                                              | Borrado genérico por hoja/columna.                       | INF. **Peligroso**: permite borrar cualquier hoja.                                   |
| `repararAlertasDuplicadas`, `diagnosticarAlertasDuplicadas`, `migrarLlavesUnificadas`                | Scripts de mantenimiento dentro del `Code.gs`.           | INF: sacar del runtime de negocio.                                                   |
| `toast`, `tip`, `lbl`, `_driveImg`, `fmtFecha`, `xTab*`, `goM`, `buscarGlobal`                       | UI pura.                                                 | INF.                                                                                 |
| Polyfills Babel (`_toConsumableArray`, etc.)                                                         | Ruido generado.                                          | **M**: eliminar.                                                                     |

---

## 6. DUPLICADOS Y CÓDIGO MUERTO — no migrar

En Apps Script **la última definición gana**: todo lo anterior es código inerte.

**Backend**

- `subirEvidenciaRadar` y `getEvidenciasRadar` definidas dos veces (ln ~3975-4049 y 4004/4031).
- `getActoresEstado` definida dos veces (ln 4623 y 5044).

**Frontend** (`AppFixes` sobrescribe `AppJs` en ~35 nombres)

- `doLogin`, `doLogout`, `iniciarApp`, `aplicarPermisosPorRol`, `goM`, `sTab`, `rBadge`, `sBadge`,
  `exportCSV`, `toast`, `buscarGlobal`, `cargarCasos`, `renderCasosModule`, `filtrarCasos`,
  `guardarNuevoCaso`, `cargarAlertas`, `cargarRR`, `cargarClima`, `guardarHecho`, `guardarAccion`,
  y los bloques "reescritura completa" de Hechos (B), Acciones (C) y Actores.
- Dentro del propio `AppFixes` hay **dos pasadas** de los mismos módulos (ln 2710-2907 y su
  reedición 4580-5421). La segunda es la vigente.
- Alias de compatibilidad sin uso: `iniciarNuevoAnalisis`, `editarAnalisis`, `eliminarAnalisis`,
  `renderAnalisisLista`, `nuevoRadar`, `guardarRadar`, `cargarPF2`.
- La suma `158 + 292 = 450` cuenta **todas** las definiciones, incluidas las que se sobrescriben
  dentro de un mismo archivo; la superficie de nombres únicos es menor.

**Impacto para la estimación**: de los 244 + 450 nombres, la superficie real de negocio ronda
las **300–350 funciones**, y de esas **~120 son clases O o INF** (CRUD + render). El alcance
funcional nuevo (lo que exige IA) es mucho menor de lo que sugiere el conteo bruto.

---

## 7. MATRIZ DE DECISIÓN — qué hacer con cada clase

| Clase                     | ¿Migrar?                                        | ¿Reescribir?   | ¿Agente? | Destino v9                                                               |
| ------------------------- | ----------------------------------------------- | -------------- | -------- | ------------------------------------------------------------------------ |
| **I Entrada manual**      | Sí, el dominio                                  | Sí, como UI    | No       | HITL + formularios asistidos; el texto libre entra a `avisa.raw_ingest`. |
| **P Proceso con IA**      | No existe en operación (la maqueta nunca operó) | Sí, es nuevo   | **Sí**   | A1 (P1–P3), A2 (P4, P5, P7), A3 (P6); `agent.*` para trazabilidad.       |
| **O Salida determinista** | Sí                                              | **No**, portar | No       | Plantillas (`ind.plantilla`), vistas SQL, servicios de entrega.          |
| **INF Infraestructura**   | Parcial                                         | Sí             | No       | SSO/RBAC, object storage, bootstrap modular.                             |
| **M Muerto**              | No                                              | —              | —        | Eliminar antes de contar líneas.                                         |

Recomendación de secuencia:

1. **Purgar M** primero: el conteo de funciones actual sobreestima el trabajo ~25–30 %.
2. **Portar O** con plantillas: es 100 % determinista y da valor visible sin modelo de lenguaje.
   Empieza por el cuadro de mando y los 6 generadores de plantilla.
3. **Construir P** con P1 (estructuración) como primer agente real: es el que alimenta todo lo
   demás y el que convierte al sectorista en validador en vez de transcriptor.
4. **Dejar I como está**, pero **asistirla**: el formulario actual crece con cada requisito; lo que
   debe hacer es recibir un relato libre y pre-rellenarse.

---

## 8. Resumen ejecutivo

- **Entrada (I)**: 6 puntos de captura (caso, hecho, alerta, RR/clima, análisis, catálogos). El
  dato del conflicto se re-escribe hasta cuatro veces con distinta granularidad — es la fuente del
  costo operativo y el lugar donde una mala captura se propaga a todos los reportes.
- **Proceso (P)**: **no existe en operación**. Ninguna de las 244 funciones transforma texto libre en
  estructura; la consulta con IA quedó en maqueta y nunca operó (§3). Ahí están los siete
  agentes/procesos de IA (P1–P7), y ahí está el valor de v9.
- **Salida (O)**: sí existe y es ~40 % de las funciones, concentrada en 12 `generar*` y el cuadro de
  mando. **No necesita IA**: necesita plantillas y una sola capa de resolución de nombres.
- **Infra (INF)**: el bootstrap `eval()` de 7 bundles y el auth por hoja son la deuda que condiciona
  todo lo demás; no son funcionalidad y no deberían consumir presupuesto de migración.
- **Muerto (M)**: duplicados amplios; limpiarlos antes de dimensionar.
