# Catálogo de funciones — Code.gs (AVISA / OAIPCS)

Listado generado programáticamente (análisis estático del archivo) de las 244 funciones definidas en el backend de Google Apps Script `Code.gs` del sistema AVISA (OAIPCS — Ministerio de la Producción). Para cada función se indica su firma, una descripción breve derivada de su nombre y del código, las líneas que ocupa en el archivo, y las APIs/servicios de Apps Script que utiliza internamente (spreadsheet, drive, email, doc-generation, pdf-export, html-serve, etc.). Las funciones agrupadas bajo "(sin sección / utilidades generales)" no tenían un comentario de sección `// ====` inmediatamente antes en el código original. Las funciones con prefijo `_` son auxiliares internas.

**Constantes clave:** `SPREADSHEET_ID` (hoja de cálculo única que centraliza todas las tablas DIM\_/FACT\_), `HOJA` (mapa de alias a nombres reales de pestañas), `COL_SEC/COL_PF/COL_AUT` (índices de columnas para login de Sectoristas, Puntos Focales y Autoridades), y `CARPETAS_FOTO`/`CARPETA_PDFS` (carpetas de Google Drive para fotos y PDFs generados).

## PUNTO DE ENTRADA

- `doGet(e)` — Punto de entrada web (HTTP GET): sirve la plantilla index.html como la interfaz de la app. \[usa: html-serve\] *(líneas 57-63, 7 líneas)*
- `include(filename)` — Inserta el contenido de un archivo HTML (usado para ensamblar la plantilla principal). \[usa: html-serve\] *(líneas 65-67, 3 líneas)*

## SERVIR JS EN 7 PARTES

- `getJs1()` a `getJs7()` — Sirven los 7 archivos JS del cliente (js1…js7) como texto. \[usa: html-serve\] *(líneas 72-78, 1 línea c/u)*

## LOGIN

- `verificarLogin(dni, clave)` — Valida credenciales contra las hojas de Sectoristas, Puntos Focales y Autoridades (en ese orden), normaliza el DNI, determina el rol (incluye Admin/Directora según cargo) y registra el acceso. \[usa: spreadsheet\] *(líneas 83-140, 58 líneas)*

## LEER HOJA COMPLETA

- `leerHoja(nombre)` — Lector genérico: devuelve cualquier hoja de cálculo como arreglo de objetos JSON, con fechas formateadas. \[usa: date-format, spreadsheet\] *(líneas 145-171, 27 líneas)*
- `getAreasResponsables()` — Obtiene areas responsables. *(líneas 173-184, 12 líneas)*

## CASCADA Entidad -> Area -> Unidad (Actor del Estado)

- `getEntidadesResponsables()` — Obtiene entidades responsables. *(líneas 189-195, 7 líneas)*
- `getAreasPorEntidad(idEntidad)` — Obtiene areas por entidad. *(líneas 197-215, 19 líneas)*
- `getUnidadesPorArea(idArea)` — Obtiene unidades por area. *(líneas 217-232, 16 líneas)*
- `getAlertas()` — Obtiene alertas. \[usa: spreadsheet\] *(líneas 235-314, 80 líneas)*
- `getHechosCaso(codigoCaso)` — Obtiene hechos caso. \[usa: date-format, spreadsheet\] *(líneas 316-390, 75 líneas)*
- `getProcesoCaso(codigoCaso)` — Obtiene proceso caso. \[usa: date-format, spreadsheet\] *(líneas 392-414, 23 líneas)*

## getFichaCasoCompleta — reúne todo lo vinculado a un caso

- `getFichaCasoCompleta(codigoCaso)` — Función central de lectura: reúne en un solo objeto todos los datos de un caso (hechos, proceso, demandas, actores, departamentos, recursos). \[usa: date-format, spreadsheet\] *(líneas 419-750, 332 líneas — la función más larga del archivo)*

## getCasos — con datos completos para traducción en ficha

- `getCasos()` — Obtiene el listado completo de casos con datos ya resueltos para mostrar en ficha. \[usa: date-format, spreadsheet\] *(líneas 755-948, 194 líneas)*

## FIX #1 — guardarCaso con columnas ALINEADAS correctamente

- `guardarCaso(datos)` — Guarda un caso nuevo, alineando columnas (corrección aplicada). \[usa: spreadsheet\] *(líneas 962-1008, 47 líneas)*

## FIX #2 y #3 — guardarBridgeDemandas graba DIM\_Demandas Y BRIDGE

- `guardarBridgeDemandas(codigoCaso, demandas)` — Guarda demandas tanto en la tabla DIM\_Demandas como en la tabla puente (bridge) con el caso. \[usa: date-format, spreadsheet\] *(líneas 1013-1070, 58 líneas)*

## guardarDemandasAlerta — demandas vinculadas a una Alerta Temprana

- `_asegurarColumnasDemanda(hDem)` — \[Auxiliar\] Asegura que la hoja de demandas tenga las columnas esperadas. *(líneas 1077-1083, 7 líneas)*
- `guardarDemandaDirecta(datos)` — Guarda demanda directa. \[usa: date-format, spreadsheet\] *(líneas 1084-1116, 33 líneas)*
- `actualizarDemandaDirecta(datos)` — Actualiza demanda directa. \[usa: spreadsheet\] *(líneas 1117-1139, 23 líneas)*
- `eliminarDemandaDirecta(idDemanda)` — Elimina demanda directa. \[usa: spreadsheet\] *(líneas 1140-1153, 14 líneas)*
- `subirEvidenciaDemanda(datos)` — Sube un archivo de evidencia asociado a una demanda a Drive. \[usa: drive\] *(líneas 1154-1166, 13 líneas)*
- `guardarDemandasAlerta(idAlerta, demandas)` — Guarda demandas vinculadas a una Alerta Temprana. \[usa: date-format, spreadsheet\] *(líneas 1167-1217, 51 líneas)*

## FIX #4 — guardarBridgeDeptos

- `guardarBridgeDeptos(codigoCaso, deptos)` — Vincula departamentos a un caso (tabla puente). \[usa: spreadsheet\] *(líneas 1223-1247, 25 líneas)*
- `guardarBridgeActores(codigoCaso, actores)` — Vincula actores a un caso. \[usa: spreadsheet\] *(líneas 1249-1260, 12 líneas)*
- `guardarBridgeRecursos(codigoCaso, recursos)` — Vincula recursos a un caso. \[usa: spreadsheet\] *(líneas 1262-1273, 12 líneas)*

## FIX #7 — getHitosPorAccion y getHechosPorCaso

- `getHitosPorAccion(idAccion)` — Obtiene hitos por accion. \[usa: spreadsheet\] *(líneas 1279-1304, 26 líneas)*

## CUADRO DE MANDO EJECUTIVO - KPIs (21 indicadores en 4 ejes)

- `getReporteActoresSociales(filtros)` — Reporte agregado de actores sociales según filtros. \[usa: date-format, spreadsheet\] *(líneas 1310-1378, 69 líneas)*
- `getReporteEjecutivoAnual(filtros)` — Calcula datos del reporte ejecutivo anual. \[usa: date-format, spreadsheet\] *(líneas 1380-1554, 175 líneas)*
- `getKPIsReporte(filtros)` — Calcula los 21 indicadores (KPIs) del cuadro de mando en 4 ejes. \[usa: spreadsheet\] *(líneas 1556-1729, 174 líneas)*
- `getDepartamentosReporte()` — Obtiene departamentos reporte. \[usa: spreadsheet\] *(líneas 1731-1744, 14 líneas)*
- `getHechosPorCaso(codigoCaso)` — Obtiene hechos por caso. \[usa: spreadsheet\] *(líneas 1746-1772, 27 líneas)*

## FIX #8 — eliminarFila (genérico, botón de papelera)

- `eliminarFila(nombreHoja, columnaId, valor)` — Elimina genéricamente una fila de cualquier hoja según columna/valor ID (usado por el botón de papelera en el frontend). \[usa: spreadsheet\] *(líneas 1777-1802, 26 líneas)*
- `eliminarRegistro(nombreHoja, colId, valorId)` — Alias/variante de eliminación de registro. *(líneas 1805-1807, 3 líneas)*

## Demandas — lectura para el pop-up de caso

- `getDemandas(codigoCaso)` — Obtiene demandas. \[usa: spreadsheet\] *(líneas 1812-1872, 61 líneas)*

## GUARDAR ANÁLISIS DE CASO (FIX #9 — back-end robusto)

- `guardarAnalisisCaso(datos)` — Guarda analisis caso. \[usa: date-format, spreadsheet\] *(líneas 1877-1939, 63 líneas)*
- `getAnalisisCasos()` — Obtiene analisis casos. \[usa: spreadsheet\] *(líneas 1941-1965, 25 líneas)*
- `generarPDFAnalisis(idAnalisis, codigoCaso)` — Genera un documento PDF del análisis de caso (crea Google Doc, lo exporta a PDF y lo guarda en Drive). \[usa: date-format, doc-generation, drive, pdf-export, spreadsheet\] *(líneas 1967-2136, 170 líneas)*
- `_fichaCasoParaAnalisis(ss, cod)` — \[Auxiliar\] Arma los datos del caso específicos para el documento de análisis. \[usa: date-format, spreadsheet\] *(líneas 2139-2165, 27 líneas)*
- `_actoresDelCaso(ss, cod)` — \[Auxiliar\] Obtiene actores vinculados a un caso. \[usa: spreadsheet\] *(líneas 2168-2194, 27 líneas)*
- `guardarBridgeAnalisis(idAnalisis, codigoCaso, datos)` — Guarda bridge analisis. \[usa: spreadsheet\] *(líneas 2196-2237, 42 líneas)*

## RESTO DE FUNCIONES (sin cambios) — CRUD general del sistema

- `getPendientes(idUsuario, rol)` — Obtiene las tareas/casos pendientes para un usuario según su rol. \[usa: spreadsheet\] *(líneas 2242-2346, 105 líneas)*
- `repararAlertasDuplicadas(modoSimulacion)` — Utilidad de mantenimiento: detecta y repara alertas duplicadas (con modo simulación/dry-run). \[usa: spreadsheet\] *(líneas 2348-2434, 87 líneas)*
- `diagnosticarAlertasDuplicadas()` — Utilidad de mantenimiento: diagnostica alertas duplicadas sin modificarlas. \[usa: spreadsheet\] *(líneas 2435-2531, 97 líneas)*
- `guardarAlerta(datos)` — Guarda una alerta temprana. \[usa: date-format, drive, spreadsheet\] *(líneas 2532-2643, 112 líneas)*
- `_generarDocSimpleYGuardarLink(nombreDoc, titulo, campos, hoja, filaNum)` — \[Auxiliar\] Genera un Google Doc simple a partir de campos y guarda el enlace en la hoja. \[usa: doc-generation, drive\] *(líneas 2645-2683, 39 líneas)*
- `_asegurarColumnasRR(hoja)` — \[Auxiliar\] Asegura columnas de Reporte Rápido. *(líneas 2684-2694, 11 líneas)*
- `_fechaLocalTxt(valor, tz, formato)` — \[Auxiliar\] Formatea una fecha a texto local. \[usa: date-format\] *(líneas 2695-2708, 14 líneas)*
- `guardarReporteRapido(datos)` — Guarda reporte rapido. \[usa: date-format, spreadsheet\] *(líneas 2709-2755, 47 líneas)*
- `_asegurarColumnasClima(hoja)` — \[Auxiliar\] Asegura columnas de Clima Social. *(líneas 2757-2767, 11 líneas)*
- `guardarClimaSocial(datos)` — Guarda clima social. \[usa: date-format, spreadsheet\] *(líneas 2768-2835, 68 líneas)*
- `_asegurarColumnasClimaFocalizado(hoja)` — \[Auxiliar\] Asegura columnas de Clima Social Focalizado. *(líneas 2836-2846, 11 líneas)*
- `guardarClimaSocialFocalizado(datos)` — Guarda clima social focalizado. \[usa: date-format, spreadsheet\] *(líneas 2847-2900, 54 líneas)*
- `getClimaSocialFocalizado()` — Obtiene clima social focalizado. \[usa: spreadsheet\] *(líneas 2901-2907, 7 líneas)*
- `agregarActorACaso(codigoCaso, idActor)` / `quitarActorDeCaso(...)` — Vincula/desvincula un actor social a un caso. \[usa: spreadsheet\] *(líneas 2909-2940)*
- `agregarActorEstadoACaso(codigoCaso, idActorEstado)` / `quitarActorEstadoDeCaso(...)` — Vincula/desvincula un actor del Estado a un caso. \[usa: spreadsheet\] *(líneas 2941-2972)*
- `actualizarHecho(datos)` — Actualiza hecho. \[usa: spreadsheet\] *(líneas 2973-3001, 29 líneas)*
- `subirEvidenciaAlerta(datos)` — Sube evidencia alerta. \[usa: drive\] *(líneas 3002-3018, 17 líneas)*
- `subirEvidenciaCaso(a, b, c, d)` — Sube evidencia caso. \[usa: drive\] *(líneas 3019-3053, 35 líneas)*
- `_asegurarColumnasHecho(hoja)` — \[Auxiliar\] Asegura columnas de Hechos. *(líneas 3054-3064, 11 líneas)*
- `guardarHecho(datos)` — Guarda hecho. \[usa: spreadsheet\] *(líneas 3065-3092, 28 líneas)*
- `guardarAccion(datos)` — Guarda accion. \[usa: spreadsheet\] *(líneas 3094-3101, 8 líneas)*
- `_asegurarColumnasHito(hoja)` — \[Auxiliar\] Asegura columnas de Hitos. *(líneas 3103-3113, 11 líneas)*
- `guardarHito(datos)` — Guarda hito. \[usa: spreadsheet\] *(líneas 3114-3140, 27 líneas)*
- `actualizarAvanceHito(idHito, datos)` — Actualiza avance hito. \[usa: spreadsheet\] *(líneas 3141-3159, 19 líneas)*
- `actualizarHito(datos)` — Actualiza hito. \[usa: spreadsheet\] *(líneas 3160-3183, 24 líneas)*
- `eliminarActor(idActor)` — Elimina actor. \[usa: spreadsheet\] *(líneas 3185-3196, 12 líneas)*
- `getActorEstadoDetalle(idActor)` — Obtiene actor estado detalle. \[usa: date-format, spreadsheet\] *(líneas 3198-3228, 31 líneas)*
- `eliminarActorEstado(idActor)` — Elimina actor estado. \[usa: spreadsheet\] *(líneas 3230-3243, 14 líneas)*
- `_normTexto(s)` / `_normDNI(dni)` — \[Auxiliares\] Normalizan texto y DNI (trim, formato). *(líneas 3245-3351)*
- `_resolverOrgIdBackend(ss, nombreOId)` — \[Auxiliar\] Resuelve el ID de una organización a partir de su nombre. \[usa: spreadsheet\] *(líneas 3248-3264, 17 líneas)*
- `actualizarActor(datos)` / `actualizarActorEstado(datos)` — Actualizan datos de un actor social / actor del Estado (incl. foto). \[usa: drive, spreadsheet\] *(líneas 3265-3343)*
- `crearActorRapido(nombreCompleto)` — Crea un actor social con datos mínimos (alta rápida). \[usa: spreadsheet\] *(líneas 3352-3363, 12 líneas)*
- `guardarActor(datos)` / `guardarActorEstado(datos)` — Guardan un nuevo actor social / actor del Estado. \[usa: drive, spreadsheet\] *(líneas 3364-3441)*
- `guardarSectorista(datos)` — Guarda sectorista. \[usa: spreadsheet\] *(líneas 3443-3445, 3 líneas)*
- `guardarPuntoFocal(datos)` / `guardarAutoridad(datos)` — Guardan un nuevo Punto Focal / Autoridad. \[usa: drive, spreadsheet\] *(líneas 3446-3485)*
- `actualizarCaso(datos)` — Actualiza caso. \[usa: spreadsheet\] *(líneas 3487-3498, 12 líneas)*
- `avanzarPasoCaso(...)` — Avanza un caso al siguiente paso del flujo de proceso. \[usa: spreadsheet\] *(líneas 3500-3522, 23 líneas)*
- `iniciarProcesoCaso(idCaso, idSectorista)` / `iniciarProcesoReporte(...)` — Inician el flujo de proceso de un caso/reporte. \[usa: spreadsheet\] *(líneas 3524-3530)*
- `registrarAcceso(dni,nombre,rol,resultado)` — Registra un intento de login (éxito/fallo) en el log. \[usa: spreadsheet\] *(líneas 3532-3534, 3 líneas)*
- `registrarEnvio(datos)` / `registrarEnvioWA(codigoCaso,telefono)` — Registran el envío de un documento/mensaje (incl. WhatsApp) en el log de envíos. \[usa: spreadsheet\] *(líneas 3536-3542)*
- `enviarCorreoCasoDirecto(...)` — Envía un correo directo relacionado a un caso. \[usa: email, spreadsheet\] *(líneas 3544-3546, 3 líneas)*
- `actualizarReporteRapido(datos)` — Actualiza reporte rapido. \[usa: spreadsheet\] *(líneas 3548-3570, 23 líneas)*
- `actualizarClimaSocial(datos)` — Actualiza clima social. \[usa: spreadsheet\] *(líneas 3571-3594, 24 líneas)*
- `guardarBridgeAnunciosAcuerdos(idRR, anuncios)` / `getAnunciosAcuerdos()` — Guardan/leen anuncios y acuerdos vinculados a un Reporte Rápido. \[usa: spreadsheet\] *(líneas 3595-3619)*
- `agregarActorAAlerta(...)` / `quitarActorDeAlerta(...)` / `agregarActorEstadoAAlerta(...)` / `quitarActorEstadoDeAlerta(...)` — Vinculan/desvinculan actores sociales y actores del Estado a una Alerta Temprana. \[usa: spreadsheet\] *(líneas 3620-3705)*
- `getDemandasAlerta(idAlerta)` / `eliminarDemandaAlerta(idDemanda)` — Lee/elimina demandas de una alerta. \[usa: spreadsheet\] *(líneas 3706-3773)*
- `guardarBridgeAlertaRecurso(idAlerta, recursos)` / `getRecursosAlerta(idAlerta)` / `quitarRecursoDeAlerta(...)` — Gestionan recursos vinculados a una alerta. \[usa: spreadsheet\] *(líneas 3774-3825)*
- `actualizarAlerta(datos)` — Actualiza alerta. \[usa: date-format, spreadsheet\] *(líneas 3826-3859, 34 líneas)*
- `abrirCarpetaCasoUrl(codigoCaso)` / `obtenerCarpetaCaso(codigoCaso)` — Obtienen la URL/carpeta de Drive asociada a un caso. \[usa: drive\] *(líneas 3860-3869)*
- `procesarFoto(base64Data,mimeType,modulo,idRegistro,nombrePersona)` — Procesa y guarda una foto subida en base64 a la carpeta correspondiente. \[usa: drive\] *(líneas 3871-3873, 3 líneas)*
- `getRecursos()` — Obtiene recursos. *(líneas 3875-3899, 25 líneas)*
- `guardarRedRadar(datos)` / `guardarNodoRadar(datos)` — Guardan una Red de Radar / un Nodo de Radar (estructuras de monitoreo territorial). \[usa: drive, spreadsheet\] *(líneas 3901-3966)*
- `_carpetaDe(tipo, id)` — \[Auxiliar\] Obtiene/crea la carpeta de Drive correspondiente a un tipo de entidad. \[usa: drive\] *(líneas 3968-3973, 6 líneas)*
- `subirEvidenciaRadar(...)` (dos definiciones — líneas 3975 y 4004) / `getEvidenciasRadar(...)` (dos definiciones — líneas 3991 y 4031) — **Nota:** estas funciones están definidas dos veces en el archivo; en Apps Script la segunda definición sobrescribe a la primera, por lo que las de las líneas 3975-4002 quedan inactivas (código muerto). \[usa: drive, spreadsheet, date-format\] *(líneas 3975-4049)*
- `eliminarRedRadar(idRadar)` / `eliminarNodoRadar(idNodo)` — Eliminan una Red/Nodo de Radar. \[usa: spreadsheet\] *(líneas 4051-4086)*
- `getIntegrantesRadar(idRadar)` / `getIntegrantesNodo(idNodo)` — Obtienen integrantes de una Red/Nodo de Radar. \[usa: spreadsheet\] *(líneas 4088-4114)*
- `guardarAnalisisRegional(datos)` — Guarda analisis regional. \[usa: spreadsheet\] *(líneas 4116-4118, 3 líneas)*
- `avanzarPasoSimple(...)` — Avanza un paso de proceso de forma simplificada. \[usa: spreadsheet\] *(líneas 4120-4122, 3 líneas)*
- `migrarLlavesUnificadas()` — Utilidad de migración de datos (unifica llaves/IDs). \[usa: spreadsheet\] *(líneas 4124-4126, 3 líneas)*

## GENERACIÓN REPORTE ALERTA TEMPRANA + CORREO

- `enviarDocumento(tipoKey, idDoc, htmlContenido, destinatarios)` — Envía por correo un documento generado (adjunto o enlace). \[usa: date-format, doc-generation, drive, email\] *(líneas 4136-4168, 33 líneas)*
- `generarReporteAlerta(datos, hojaAlertas, filaAlerta)` — Genera el documento/PDF completo de una Alerta Temprana (ficha con actores, demandas, mapas) y lo envía por correo; es la función más compleja de generación de reportes. \[usa: date-format, doc-generation, drive, email, pdf-export, spreadsheet\] *(líneas 4169-4477, 309 líneas — segunda función más larga del archivo)*
- `_resolverNombreDim(ss,hoja,colId,colNom,val)` — \[Auxiliar\] Resuelve el nombre legible de un ID en una tabla dimensión (DIM\_). \[usa: spreadsheet\] *(líneas 4479-4489, 11 líneas)*
- `_bridgeActoresDoc(ss,idA,hBrg,hAct,pk)` — \[Auxiliar\] Arma la lista de actores vinculados para el documento. \[usa: spreadsheet\] *(líneas 4490-4523, 34 líneas)*
- `_actoresConFotoDoc(ss,idA,hBrg,hAct,pk)` — \[Auxiliar\] Igual al anterior pero incluyendo la foto de cada actor. \[usa: spreadsheet\] *(líneas 4524-4547, 24 líneas)*
- `_demandasPorTematica(ss, idA)` — \[Auxiliar\] Agrupa demandas por temática para el documento. \[usa: spreadsheet\] *(líneas 4548-4577, 30 líneas)*
- `_bridgeDemandas(ss,idA)` — \[Auxiliar\] Arma la lista de demandas vinculadas. \[usa: spreadsheet\] *(líneas 4579-4620, 42 líneas)*
- `getActoresEstado()` / `getActoresSociales()` / `getActoresTodos()` — Listan actores del Estado / sociales / ambos combinados. \[usa: spreadsheet\] *(líneas 4623-4675)*
- `_mapaOrganizaciones(ss)` — \[Auxiliar\] Mapa ID→nombre de organizaciones. \[usa: spreadsheet\] *(líneas 4676-4687, 12 líneas)*
- `getPasosAlerta()` — Obtiene pasos alerta. \[usa: spreadsheet\] *(líneas 4691-4704, 14 líneas)*
- `getActores()` / `getDepartamentos()` — Listados simples (delegan en `leerHoja`). *(líneas 4708-4715)*

## FUNCIONES FALTANTES — Audit completo 19/jun/2026

Serie de listados simples (la mayoría de una sola línea, delegando en `leerHoja` sobre su hoja correspondiente), añadidos en una auditoría para cubrir catálogos faltantes del frontend:

- `getSectoristas()`, `getSectores()`, `getTematica()`, `getTematicas()`, `getNivelesAlerta()`, `getRiesgos()`, `getReportesRapidos()`, `getClimaSocial()`, `getAutoridades()`, `getPuntosFocales()`, `getProvincias()`, `getDistritos()`, `getBridgeAlertaActor()`, `getBridgeAlertaActorEstado()`, `getTipoCaso()`, `getIntervencion()` — catálogos/listados de una línea. *(líneas 4722-5051)*
- `getHechos()` — Obtiene hechos. \[usa: date-format, spreadsheet\] *(líneas 4732-4764, 33 líneas)*
- `getHitos()` — Obtiene hitos. \[usa: date-format, spreadsheet\] *(líneas 4766-4828, 63 líneas)*
- `getBridgeAlertaDemandas()` — Obtiene bridge alerta demandas. *(líneas 4833-4848, 16 líneas)*
- `getTodasLasDemandas()` — Obtiene el listado consolidado de todas las demandas del sistema (casos + alertas + directas). \[usa: date-format, spreadsheet\] *(líneas 4850-5041, 192 líneas)*
- `getActoresEstado()` — **Nota:** redefinida aquí (líneas 5044-5048); sobrescribe la versión de la línea 4623. *(líneas 5044-5048, 5 líneas)*

## BRIDGES FALTANTES — Actores vinculados a Alertas y Casos

- `_asegurarColumnasBridgeAlertaActor(hoja)` / `_asegurarColumnasBridgeAlertaActorEstado(hoja)` — \[Auxiliares\] Aseguran columnas de las tablas puente alerta-actor. *(líneas 5055-5091)*
- `guardarBridgeAlertaActor(idAlerta, actores)` / `guardarBridgeAlertaActorEstado(idAlerta, actores)` — Guardan vínculos actor social/actor del Estado ↔ alerta. \[usa: spreadsheet\] *(líneas 5063-5111)*
- `guardarBridgeCasoActorEstado(codigoCaso, actores)` — Vincula actores del Estado a un caso. \[usa: spreadsheet\] *(líneas 5113-5125, 13 líneas)*
- `getActoresParaReportePDF()` — Prepara la lista de actores disponibles para selección en el reporte PDF. \[usa: spreadsheet\] *(líneas 5130-5169, 40 líneas)*

## REPORTE PDF DE ACTORES SOCIALES SELECCIONADOS

- `generarReporteActoresPDF(idsActores, formato)` — Genera un reporte (PDF o Word) con la ficha de los actores sociales seleccionados, incluyendo sus fotos. \[usa: date-format, doc-generation, drive, http-fetch, pdf-export, script-auth, spreadsheet\] *(líneas 5176-5362, 187 líneas)*
- `_obtenerBlobFoto(ref)` — \[Auxiliar\] Descarga/obtiene el blob de una foto (desde Drive o URL) para insertarla en un documento. \[usa: drive, http-fetch\] *(líneas 5365-5394, 30 líneas)*

## GENERAR WORD DE ANÁLISIS DE CASO - PLANTILLA ANEXO 8

- `generarWordAnalisis(idAnalisis, codigoCaso)` — Genera el documento Word (Anexo 8) del análisis de caso a partir de una plantilla. \[usa: doc-generation, drive, pdf-export, spreadsheet\]

## ORGANIZACIONES SOCIALES - DIM\_ORGANIZACION

- `getOrganizaciones()` / `guardarOrganizacion(datos)` / `actualizarOrganizacion(datos)` / `eliminarOrganizacion(idOrg)` — CRUD completo de organizaciones sociales (tabla DIM\_Organizacion), incluyendo logo/foto. \[usa: drive, spreadsheet\]

## LOCALES - DIM\_Locales

- `getLocales()` / `guardarLocal(datos)` / `actualizarLocal(datos)` / `eliminarLocal(idLocal)` — CRUD completo de locales (espacios físicos para reuniones/eventos: aforo, equipos, contacto). \[usa: drive, spreadsheet\]

## REPORTE DE DATOS DE ACTORES (Nombre, DNI, Telefono, Email)

- `generarReporteDatosActores(idsActores, formato)` — Genera un reporte (PDF/Word) tabular con los datos de contacto básicos (nombre, DNI, teléfono, email) de los actores seleccionados. \[usa: date-format, doc-generation, drive, pdf-export, spreadsheet\]

## REPORTE DE ORGANIZACIONES (logo, nombre, depto, direccion, presidente)

- `generarReporteOrganizaciones(idsOrgs, formato)` — Genera un reporte (PDF/Word) con ficha de cada organización seleccionada (logo, nombre, departamento, dirección, presidente). \[usa: date-format, doc-generation, drive, pdf-export, spreadsheet\] (líneas \~7500-7564)
- `_exportarReporte(docId, nombreDoc, formato, carpetaId)` — \[Auxiliar\] Helper común a todos los generadores de reportes: mueve el Google Doc a la carpeta de destino y lo exporta a PDF o Word (.docx), configurando permisos de uso compartido. \[usa: doc-generation, drive, http-fetch, pdf-export, script-auth\] (líneas 7567-7596)
- `_mapaDepartamentos(ss)` — \[Auxiliar\] Mapa ID\_Ubigeo → nombre de Departamento. \[usa: spreadsheet\] (líneas 7599-7608)
- `_mapaActores(ss)` — \[Auxiliar\] Mapa Cod\_Actor → Nombre\_Actor. \[usa: spreadsheet\] (líneas 7611-7620)

## REPORTE DE LISTA DE LOCALES

- `generarReporteLocales(idsLocales, formato)` — Genera un reporte (PDF/Word) con una ficha por local seleccionado (foto, departamento, dirección, aforo, equipos, contacto, recomendación), usando `_exportarReporte` para el export final. \[usa: date-format, doc-generation, drive, pdf-export, spreadsheet\] (líneas 7626-7725)

---

**Observaciones generales del análisis estático:**

- El archivo tiene 7726 líneas y 244 funciones de nivel superior (sin contar funciones anidadas/anonimas internas).
- Patrón dominante: funciones `get*` (lectura desde Sheets), `guardar*`/`actualizar*`/`eliminar*` (CRUD), `generar*` (generación de reportes PDF/Word), y auxiliares con prefijo `_` no expuestas al cliente.
- Se detectaron al menos dos pares de funciones duplicadas (mismo nombre definido dos veces): `subirEvidenciaRadar` y `getEvidenciasRadar` (líneas \~3975-4049) y `getActoresEstado` (líneas 4623 y 5044). En JavaScript/Apps Script, la última definición en el archivo sobrescribe a las anteriores, por lo que las primeras versiones quedan como código muerto.
- Casi todas las funciones de escritura (`guardar*`, `actualizar*`) y de lectura compleja están envueltas en `try/catch` y devuelven objetos `{ ok: true/false, ... }`, consistente con el patrón de comunicación `google.script.run` hacia el frontend.
- Los generadores de reportes (`generarReporte*`, `generarPDF*`, `generarWord*`) comparten el mismo patrón: crean un `DocumentApp`, lo pueblan con tablas/párrafos con estilos de marca (azul `#0B2A6B`, gris `#444444`), y delegan el export final a `_exportarReporte`.
