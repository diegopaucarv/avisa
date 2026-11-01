# Catálogo de funciones — Frontend SIPRECS/AVISA (AppJs.gs y AppFixes.gs)

Listado generado programáticamente (análisis estático) de las funciones JavaScript de frontend servidas por el backend de Google Apps Script como bundles de texto (`getAppJS()` y `getAppFixes()`, llamadas desde `index.html` vía `getJs1()`…`getJs7()` / similar, y ejecutadas con `eval()` en el cliente). Para cada función se indica su firma, una descripción breve derivada del nombre y del código, las líneas que ocupa en el archivo decodificado, y qué recursos usa (`dom` = manipula el DOM, `llama-backend-gas` = invoca `google.script.run` hacia el backend, `http-fetch`, `local-storage`, `confirm-dialog`, `file-read`, `excel-export`). Funciones con prefijo `_` son auxiliares internas.

Ambos archivos contienen el código fuente entre backticks/comillas tal como se sirve al navegador (no minificado); se decodificaron los escapes `\u` y `\n` propios de la cadena JS para recuperar el texto legible antes de analizarlo.

## Archivo: AppJs.txt — `getAppJS()` (158 funciones, módulos principales de la SPA)

## LOGIN — conecta con Apps Script

- `doLogin()` — Ejecuta login. \[usa: dom, llama-backend-gas\] *(líneas 23-72, 50L)*

## Enter para login

- `limpiarErr()` — Función: limpiar err. \[usa: dom\] *(líneas 82-86, 5L)*
- `mostrarError(msg)` — Muestra error. \[usa: dom\] *(líneas 87-90, 4L)*
- `doLogout()` — Ejecuta logout. \[usa: dom\] *(líneas 92-105, 14L)*

## INICIAR APP después del login exitoso

- `iniciarApp()` — Inicia app. \[usa: dom, llama-backend-gas\] *(líneas 110-143, 34L)*

## PERMISOS POR ROL

- `aplicarPermisosPorRol()` — Función: aplicar permisos por rol. \[usa: dom\] *(líneas 148-185, 38L)*

## Descarga PDF y Excel tienen el mismo permiso

- `puedeDescargar()` — Función: puede descargar. *(líneas 189-191, 3L)*
- `puedeCrear()` — Función: puede crear. *(líneas 194-196, 3L)*
- `puedeValidar(tipo)` — Función: puede validar. *(líneas 199-206, 8L)*
- `aplicarPermisoBotones(contenedor)` — Función: aplicar permiso botones. *(líneas 209-219, 11L)*

## NAVEGACIÓN

- `goM(id, el)` — Función: go m. \[usa: dom\] *(líneas 224-248, 25L)*
- `toggleSB()` — Alterna sb. \[usa: dom\] *(líneas 251-258, 8L)*
- `sTab(prefix, id, btn)` — Función: s tab. \[usa: dom\] *(líneas 260-272, 13L)*

## HELPERS

- `rBadge(r)` — Función: r badge. *(líneas 277-283, 7L)*
- `pBadge(p)` — Función: p badge. *(líneas 284-288, 5L)*
- `sBadge(s)` — Función: s badge. *(líneas 289-300, 12L)*
- `sLabel(id)` — Función: s label. *(líneas 301-303, 3L)*
- `fmtFecha(f)` — Función: fmt fecha. *(líneas 304-309, 6L)*

## Excel export

- `exportCSV(tableId, filename)` — Función: export csv. \[usa: dom\] *(líneas 312-327, 16L)*

## Toast

- `toast(msg, tipo='ok')` — Muestra notificación. \[usa: dom\] *(líneas 330-335, 6L)*

## Búsqueda global

- `buscarGlobal(q)` — Busca global. *(líneas 338-353, 16L)*

## DASHBOARD — carga desde Apps Script

- `cargarDashboard()` — Carga dashboard. \[usa: dom, llama-backend-gas\] *(líneas 358-385, 28L)*
- `renderDashboard()` — Renderiza dashboard. \[usa: dom, dom-render\] *(líneas 387-472, 86L)*

## MÓDULO DE CASOS

- `cargarCasos()` — Carga casos. \[usa: dom, llama-backend-gas\] *(líneas 488-538, 51L)*
- `renderCasosModule()` — Renderiza casos module. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 540-785, 246L)*
- `filtrarCasos()` — Filtra casos. \[usa: dom, dom-render\] *(líneas 787-838, 52L)*
- `abrirDetalleCaso(caso)` — Abre detalle caso. \[usa: dom, dom-render\] *(líneas 840-982, 143L)*
- `guardarNuevoCaso(tipo)` — Guarda nuevo caso. \[usa: dom, llama-backend-gas\] *(líneas 984-1081, 98L)*
- `actualizarPendientesBorradores()` — Actualiza pendientes borradores. \[usa: dom\] *(líneas 1083-1089, 7L)*
- `avanzarPasoCaso(idCaso, codigoCaso, pasoActual, accion)` — Avanza paso caso. \[usa: dom, llama-backend-gas\] *(líneas 1091-1110, 20L)*
- `generarPDFCaso(idCaso, codigoCaso)` — Genera pdf caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1112-1133, 22L)*
- `enviarCorreoCaso(idCaso, codigoCaso)` — Envía correo caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1135-1150, 16L)*
- `obtenerDestinatariosCaso(idCaso)` — Función: obtener destinatarios caso. *(líneas 1152-1160, 9L)*

## MÓDULO DE ALERTAS TEMPRANAS

- `cargarAlertas()` — Carga alertas. \[usa: dom, llama-backend-gas\] *(líneas 1165-1191, 27L)*
- `renderAlertasModule()` — Renderiza alertas module. \[usa: dom, dom-render\] *(líneas 1193-1350, 158L)*
- `filtrarAlertas()` — Filtra alertas. \[usa: dom, dom-render\] *(líneas 1352-1396, 45L)*
- `abrirDetalleAlerta(alerta)` — Abre detalle alerta. \[usa: dom, dom-render\] *(líneas 1398-1499, 102L)*

## WhatsApp con formato igual a la imagen del sectorista

- `generarMensajeWA(tipo, doc)` — Genera mensaje wa. *(líneas 1502-1532, 31L)*
- `abrirWhatsAppAlerta(idAlerta)` — Abre whats app alerta. *(líneas 1534-1556, 23L)*
- `registrarEnvioWA(tipo, idDoc)` — Registra envio wa. \[usa: llama-backend-gas\] *(líneas 1558-1576, 19L)*
- `guardarNuevaAlerta(tipo)` — Guarda nueva alerta. \[usa: dom, llama-backend-gas\] *(líneas 1578-1612, 35L)*
- `avanzarPasoReporte(tipo, idDoc, pasoActual, accion)` — Avanza paso reporte. \[usa: dom, llama-backend-gas\] *(líneas 1614-1627, 14L)*
- `generarPDFReporte(tipo, idDoc)` — Genera pdf reporte. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1629-1648, 20L)*
- `enviarCorreoReporte(tipo, idDoc)` — Envía correo reporte. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1650-1667, 18L)*

## MÓDULO REPORTE RÁPIDO

- `cargarRR()` — Carga rr. \[usa: dom, llama-backend-gas\] *(líneas 1672-1691, 20L)*
- `renderRRModule()` — Renderiza rr module. \[usa: dom, dom-render\] *(líneas 1693-1828, 136L)*
- `filtrarRR()` — Filtra rr. \[usa: dom, dom-render\] *(líneas 1830-1854, 25L)*
- `abrirDetalleRR(rr)` — Abre detalle rr. \[usa: dom, dom-render\] *(líneas 1856-1890, 35L)*
- `guardarRR(tipo)` — Guarda rr. \[usa: dom, llama-backend-gas\] *(líneas 1892-1919, 28L)*

## MÓDULO CLIMA SOCIAL

- `cargarClima()` — Carga clima. \[usa: dom, llama-backend-gas\] *(líneas 1924-1938, 15L)*
- `renderClimaModule()` — Renderiza clima module. \[usa: dom, dom-render\] *(líneas 1940-2052, 113L)*
- `filtrarClima()` — Filtra clima. \[usa: dom, dom-render\] *(líneas 2054-2077, 24L)*
- `abrirDetalleClima(c)` — Abre detalle clima. \[usa: dom, dom-render\] *(líneas 2079-2112, 34L)*
- `abrirWhatsAppClima(idClima)` — Abre whats app clima. *(líneas 2114-2124, 11L)*
- `guardarClima(tipo)` — Guarda clima. \[usa: dom, llama-backend-gas\] *(líneas 2126-2151, 26L)*

## HELPERS COMPARTIDOS

- `cerrarModal()` — Cierra modal. \[usa: dom\] *(líneas 2156-2158, 3L)*
- `sTabModal(prefix, id, btn)` — Función: s tab modal. \[usa: dom\] *(líneas 2163-2172, 10L)*
- `llenarSelect(id, data, valCol, txtCol)` — Llena select. \[usa: dom\] *(líneas 2174-2183, 10L)*
- `llenarSelectDeptos(id)` — Llena select deptos. \[usa: dom\] *(líneas 2185-2194, 10L)*
- `cargarProvincias(selId, deptoId)` — Carga provincias. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2196-2218, 23L)*
- `generarCodigoCaso()` — Genera codigo caso. *(líneas 2220-2224, 5L)*
- `previsualizarFoto(input, prevId, dropId)` — Función: previsualizar foto. \[usa: dom, file-read\] *(líneas 2226-2238, 13L)*
- `confirmarEliminar(tipo, id, codigo)` — Función: confirmar eliminar. \[usa: confirm-dialog\] *(líneas 2240-2246, 7L)*
- `enviarNotificacionValidacion(codigo, nombre, idSec)` — Envía notificacion validacion. \[usa: llama-backend-gas\] *(líneas 2248-2255, 8L)*

## MÓDULO HECHOS OCURRIDOS

- `cargarHechos()` — Carga hechos. \[usa: llama-backend-gas\] *(líneas 2265-2280, 16L)*
- `renderHechosModule()` — Renderiza hechos module. \[usa: dom, dom-render\] *(líneas 2282-2377, 96L)*
- `filtrarHechos()` — Filtra hechos. \[usa: dom, dom-render\] *(líneas 2379-2410, 32L)*
- `sincronizarCodigo(selId, inputId)` — Sincroniza codigo. \[usa: dom\] *(líneas 2412-2418, 7L)*
- `guardarHecho()` — Guarda hecho. \[usa: dom, llama-backend-gas\] *(líneas 2420-2444, 25L)*
- `abrirDetalleHecho(h)` — Abre detalle hecho. \[usa: dom, dom-render\] *(líneas 2446-2480, 35L)*
- `editarHecho(h)` — Edita hecho. \[usa: dom\] *(líneas 2482-2496, 15L)*
- `eliminarHecho(id)` — Elimina hecho. \[usa: confirm-dialog, llama-backend-gas\] *(líneas 2498-2508, 11L)*

## MÓDULO ACCIONES E HITOS

- `cargarAcciones()` — Carga acciones. \[usa: llama-backend-gas\] *(líneas 2513-2528, 16L)*
- `renderAccionesModule()` — Renderiza acciones module. \[usa: dom, dom-render\] *(líneas 2530-2659, 130L)*
- `filtrarAcciones()` — Filtra acciones. \[usa: dom, dom-render\] *(líneas 2661-2699, 39L)*
- `guardarAccion(tipo)` — Guarda accion. \[usa: dom, llama-backend-gas\] *(líneas 2701-2731, 31L)*
- `enviarNotifPF(datos)` — Envía notif pf. \[usa: llama-backend-gas\] *(líneas 2733-2741, 9L)*
- `abrirDetalleAccion(a)` — Abre detalle accion. \[usa: dom, dom-render\] *(líneas 2743-2788, 46L)*
- `editarAccion(a)` — Edita accion. \[usa: dom\] *(líneas 2790-2808, 19L)*
- `eliminarAccion(id)` — Elimina accion. \[usa: confirm-dialog, llama-backend-gas\] *(líneas 2810-2819, 10L)*

## MÓDULO ACTORES (con foto a Drive)

- `cargarActores()` — Carga actores. \[usa: llama-backend-gas\] *(líneas 2824-2834, 11L)*
- `renderActoresModule()` — Renderiza actores module. \[usa: dom, dom-render\] *(líneas 2836-2945, 110L)*
- `filtrarActores()` — Filtra actores. \[usa: dom, dom-render\] *(líneas 2947-2985, 39L)*
- `guardarActor()` — Guarda actor. \[usa: dom, file-read, llama-backend-gas\] *(líneas 2987-3030, 44L)*
- `guardarActorEnSheets(datos)` — Guarda actor en sheets. \[usa: llama-backend-gas\] *(líneas 3032-3044, 13L)*

## SECTORISTAS, PF, AUTORIDADES (estructura similar a actores)

- `cargarSectoristas()` — Carga sectoristas. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3049-3059, 11L)*
- `renderSectoristasMod()` — Renderiza sectoristas mod. \[usa: dom, dom-render\] *(líneas 3061-3115, 55L)*
- `cargarPF()` — Carga pf. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3117-3127, 11L)*
- `renderPFMod()` — Renderiza pf mod. \[usa: dom, dom-render\] *(líneas 3129-3183, 55L)*
- `cargarAutoridades()` — Carga autoridades. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3185-3195, 11L)*
- `renderAutMod()` — Renderiza aut mod. \[usa: dom, dom-render\] *(líneas 3197-3252, 56L)*

## MÓDULO MAESTROS (solo Admin)

- `cargarMaestros()` — Carga maestros. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3257-3302, 46L)*
- `renderMaestroCard(key, data, cols, lbl)` — Renderiza maestro card. \[usa: dom, dom-render\] *(líneas 3304-3328, 25L)*

## LOG DE ENVÍOS (solo Admin/Directora)

- `cargarLog()` — Carga log. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3333-3352, 20L)*
- `renderLogModule(log)` — Renderiza log module. \[usa: dom, dom-render\] *(líneas 3354-3403, 50L)*
- `filtrarLog()` — Filtra log. \[usa: dom, dom-render\] *(líneas 3405-3433, 29L)*
- `cargarPendientes()` — Carga pendientes. \[usa: dom, llama-backend-gas\] *(líneas 3437-3459, 23L)*
- `renderPendientes(lista)` — Renderiza pendientes. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3461-3645, 185L)*
- `exportarPendientes()` — Exporta pendientes. *(líneas 3647-3649, 3L)*
- `irADocumento(tipo, id)` — Función: ir a documento. *(líneas 3651-3656, 6L)*

## SECTORISTAS - Lista + Nuevo

- `cargarSectoristas()` — Carga sectoristas. \[usa: llama-backend-gas\] *(líneas 3662-3667, 6L)*
- `renderSectoristasMod()` — Renderiza sectoristas mod. \[usa: dom, dom-render\] *(líneas 3669-3722, 54L)*
- `secTab(btn, paneId)` — Función: sec tab. \[usa: dom\] *(líneas 3724-3729, 6L)*
- `guardarNuevoSectorista()` — Guarda nuevo sectorista. \[usa: dom, file-read, llama-backend-gas\] *(líneas 3731-3764, 34L)*
- `_guardarPersonaFinal(datos, fnName, callback)` — \[Auxiliar interna\] Guarda persona final. \[usa: llama-backend-gas\] *(líneas 3766-3771, 6L)*

## PUNTOS FOCALES - Lista + Nuevo

- `cargarPF2()` — Carga p f2. *(líneas 3776-3776, 1L)*
- `renderPFMod()` — Renderiza pf mod. \[usa: dom, dom-render\] *(líneas 3778-3819, 42L)*
- `pfTab(btn, paneId)` — Función: pf tab. \[usa: dom\] *(líneas 3821-3826, 6L)*
- `guardarNuevoPF()` — Guarda nuevo pf. \[usa: dom, file-read, llama-backend-gas\] *(líneas 3828-3860, 33L)*

## AUTORIDADES - Lista + Nuevo

- `renderAutMod()` — Renderiza aut mod. \[usa: dom, dom-render\] *(líneas 3865-3907, 43L)*
- `autTab(btn, paneId)` — Función: aut tab. \[usa: dom\] *(líneas 3909-3914, 6L)*
- `guardarNuevaAutoridad()` — Guarda nueva autoridad. \[usa: dom, file-read, llama-backend-gas\] *(líneas 3916-3949, 34L)*

## POPUP PERSONA - usa data-idx para evitar JSON en onclick

- `verPersonaByIdx(btn)` — Función: ver persona by idx. *(líneas 3954-3961, 8L)*
- `verPersona(persona, tipo)` — Función: ver persona. \[usa: dom, dom-render\] *(líneas 3963-3988, 26L)*

## BIENVENIDA - una sola vez por DNI

- `mostrarBienvenida(usuario)` — Muestra bienvenida. \[usa: dom, dom-render, local-storage\] *(líneas 3993-4029, 37L)*
- `cerrarBienvenida()` — Cierra bienvenida. \[usa: dom, local-storage\] *(líneas 4031-4035, 5L)*

## DISTRITOS

- `cargarDistritos(selId, provId)` — Carga distritos. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4040-4053, 14L)*

## WhatsApp RR fix

- `abrirWhatsAppRR_btn(btn)` — Abre whats app r btn. *(líneas 4058-4064, 7L)*
- `xTab(contentId, paneId, btn)` — Función: x tab. \[usa: dom\] *(líneas 4067-4077, 11L)*
- `verPersonaByIdx(btn)` — Función: ver persona by idx. \[usa: dom, dom-render\] *(líneas 4079-4105, 27L)*
- `guardarNuevoSectorista()` — Guarda nuevo sectorista. \[usa: dom, llama-backend-gas\] *(líneas 4107-4121, 15L)*
- `guardarNuevoPF()` — Guarda nuevo pf. \[usa: dom, llama-backend-gas\] *(líneas 4123-4136, 14L)*
- `guardarNuevaAutoridad()` — Guarda nueva autoridad. \[usa: dom, llama-backend-gas\] *(líneas 4138-4151, 14L)*
- `mostrarBienvenida(usuario)` — Muestra bienvenida. \[usa: dom, dom-render, local-storage\] *(líneas 4153-4182, 30L)*
- `cerrarBienvenida()` — Cierra bienvenida. \[usa: dom, local-storage\] *(líneas 4184-4188, 5L)*
- `cargarDistritos(selId, provId)` — Carga distritos. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4190-4200, 11L)*
- `abrirWhatsAppRR_btn(btn)` — Abre whats app r btn. *(líneas 4202-4208, 7L)*
- `xTab(btn, contentId, paneId)` — Función: x tab. \[usa: dom\] *(líneas 4210-4221, 12L)*
- `xTabReset(contentId, paneId, tabsSelector)` — Función: x tab reset. \[usa: dom\] *(líneas 4223-4235, 13L)*
- `xTabD(btn)` — Función: x tab d. \[usa: dom\] *(líneas 4237-4250, 14L)*
- `xTabResetD(btn)` — Función: x tab reset d. \[usa: dom\] *(líneas 4252-4267, 16L)*
- `prevFoto(input, previewId)` — Función: prev foto. \[usa: dom, file-read\] *(líneas 4269-4281, 13L)*
- `editarSectorista(idx)` — Edita sectorista. \[usa: dom\] *(líneas 4283-4304, 22L)*
- `editarPF(idx)` — Edita pf. \[usa: dom\] *(líneas 4306-4326, 21L)*
- `editarAutoridad(idx)` — Edita autoridad. \[usa: dom\] *(líneas 4328-4348, 21L)*

## LÍNEA DE TIEMPO DEL CASO

- `verLineaTiempo(codigoCaso)` — Función: ver linea tiempo. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4353-4381, 29L)*
- `renderLineaTiempo(hechos, codigoCaso)` — Renderiza linea tiempo. \[usa: dom, dom-render\] *(líneas 4383-4399, 17L)*

## ACCIONES E HITOS DEL CASO

- `verAccionesHitosCaso(codigoCaso)` — Función: ver acciones hitos caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4404-4430, 27L)*
- `renderAccionesHitos(acciones, codigoCaso)` — Renderiza acciones hitos. \[usa: dom, dom-render\] *(líneas 4432-4452, 21L)*

## BRIDGE: Departamentos, Actores, Recursos vinculados al caso

- `agregarDepto()` — Agrega depto. \[usa: dom\] *(líneas 4457-4472, 16L)*
- `eliminarDepto(id)` — Elimina depto. *(líneas 4474-4477, 4L)*
- `agregarActor()` — Agrega actor. \[usa: dom\] *(líneas 4479-4491, 13L)*
- `eliminarActor(id)` — Elimina actor. *(líneas 4493-4496, 4L)*
- `agregarRecurso()` — Agrega recurso. \[usa: dom\] *(líneas 4498-4510, 13L)*
- `eliminarRecurso(id)` — Elimina recurso. *(líneas 4512-4515, 4L)*
- `renderBridgeLista(containerId, items, keyField, labelField, extraField, removeFn)` — Renderiza bridge lista. \[usa: dom, dom-render\] *(líneas 4517-4541, 25L)*

## FUNCIONES GENÉRICAS PARA BRIDGES (Alerta, RR, Clima)

- `iniciarBridgesGen(prefix)` — Inicia bridges gen. \[usa: dom, dom-render\] *(líneas 4548-4558, 11L)*
- `llenarSelectConCache(selId, cacheKey, valKey, lblKey, fn)` — Llena select con cache. \[usa: llama-backend-gas\] *(líneas 4560-4569, 10L)*
- `llenarSelectConCacheRecurso(selId)` — Llena select con cache recurso. \[usa: llama-backend-gas\] *(líneas 4571-4587, 17L)*
- `detectarColRecurso(data)` — Función: detectar col recurso. *(líneas 4589-4594, 6L)*
- `agregarDeptoGen(prefix)` — Agrega depto gen. \[usa: dom\] *(líneas 4596-4613, 18L)*
- `agregarActorGen(prefix)` — Agrega actor gen. \[usa: dom\] *(líneas 4615-4629, 15L)*
- `agregarRecursoGen(prefix)` — Agrega recurso gen. \[usa: dom\] *(líneas 4631-4645, 15L)*

## VER PROCESO / RECORRIDO DEL CASO O REPORTE

- `verRecorridoCaso(codigoCaso, nombreCaso)` — Función: ver recorrido caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4650-4677, 28L)*
- `verRecorridoReporte(idReporte, tituloReporte)` — Función: ver recorrido reporte. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4679-4706, 28L)*
- `renderRecorrido(pasos, tipo)` — Renderiza recorrido. \[usa: dom, dom-render\] *(líneas 4708-4755, 48L)*

## AVANZAR PASO DESDE PENDIENTES (Directora valida/rechaza)

- `modalAvanzarPaso(tipo, id, titulo, pasoActual)` — Función: modal avanzar paso. \[usa: dom, dom-render\] *(líneas 4760-4785, 26L)*
- `confirmarAvance(tipo, id, pasoActual, aprobar)` — Función: confirmar avance. \[usa: dom, llama-backend-gas\] *(líneas 4787-4809, 23L)*

## Archivo: AppFixes.txt — `getAppFixes()` (292 funciones, fixes/parches y módulos añadidos)

## (sin sección)

- `_toConsumableArray`, `_nonIterableSpread`, `_iterableToArray`, `_arrayWithoutHoles`, `_slicedToArray`, `_nonIterableRest`, `_unsupportedIterableToArray`, `_arrayLikeToArray`, `_iterableToArrayLimit`, `_arrayWithHoles` — \[Auxiliares internas\] Polyfills/helpers estándar generados por Babel para soportar destructuring y spread de iterables en navegadores antiguos (no son lógica de negocio del sistema).

## Normaliza cualquier URL/ID de Google Drive a una URL renderizable en \<img>

- `_driveImg(u)` — \[Auxiliar interna\] Función: drive img. *(líneas 5-22, 18L)*

## Genera el icono ❓ con tooltip flotante

- `tip(msg, required)` — Función: tip. *(líneas 109-112, 4L)*

## Genera label con asterisco para campos obligatorios

- `lbl(texto, msg, req)` — Función: lbl. *(líneas 115-117, 3L)*

## LOGIN — conecta con Apps Script

- `doLogin()` — Ejecuta login. \[usa: dom, llama-backend-gas\] *(líneas 145-189, 45L)*

## Enter para login — con null-check para evitar crash en eval()

- `limpiarErr()` — Función: limpiar err. \[usa: dom\] *(líneas 202-206, 5L)*
- `mostrarError(msg)` — Muestra error. \[usa: dom\] *(líneas 207-210, 4L)*
- `doLogout()` — Ejecuta logout. \[usa: dom\] *(líneas 211-246, 36L)*

## INICIAR APP después del login exitoso

- `iniciarApp()` — Inicia app. \[usa: dom, llama-backend-gas\] *(líneas 251-286, 36L)*

## PERMISOS POR ROL

- `aplicarPermisosPorRol()` — Función: aplicar permisos por rol. \[usa: dom\] *(líneas 291-344, 54L)*

## Descarga PDF y Excel tienen el mismo permiso

- `puedeDescargar()` — Función: puede descargar. *(líneas 348-350, 3L)*
- `puedeCrear()` — Función: puede crear. *(líneas 353-355, 3L)*
- `puedeValidar(tipo)` — Función: puede validar. *(líneas 358-365, 8L)*
- `aplicarPermisoBotones(contenedor)` — Función: aplicar permiso botones. *(líneas 368-382, 15L)*

## NAVEGACIÓN

- `goM(id, el)` — Función: go m. \[usa: dom\] *(líneas 387-475, 89L)*
- `irAModulo(id)` — Función: ir a modulo. *(líneas 477-479, 3L)*
- `toggleSB()` — Alterna sb. \[usa: dom\] *(líneas 480-495, 16L)*
- `sTab(prefix, id, btn)` — Función: s tab. \[usa: dom\] *(líneas 496-529, 34L)*

## HELPERS

- `rBadge(r)` — Función: r badge. *(líneas 534-540, 7L)*
- `pBadge(p)` — Función: p badge. *(líneas 541-545, 5L)*
- `sBadge(s)` — Función: s badge. *(líneas 546-567, 22L)*
- `sLabel(id)` — Función: s label. *(líneas 568-570, 3L)*
- `fmtFecha(f)` — Función: fmt fecha. *(líneas 571-580, 10L)*

## Excel export

- `exportCSV(tableId, filename)` — Función: export csv. \[usa: dom\] *(líneas 583-611, 29L)*

## Helpers de resolución de nombres (área, departamento, provincia, distrito, intervención)

- `_areaNm(id)`, `_deptNm(id)`, `_provNm(id)`, `_distNm(id)`, `_intervNm(id)` — \[Auxiliares internas\] Resuelven el nombre legible de un ID consultando el `CACHE` correspondiente (áreas, departamentos, provincias, distritos, tipos de intervención). *(líneas 614-656)*

## Selects de ubicación geográfica y área responsable (poblado diferido tras inyectar HTML)

- `_asegurarDeptos(selectId, valorActual)` / `_llenarDeptos(...)` — \[Auxiliares internas\] Cargan y pueblan el select de Departamento. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 660-685)*
- `_asegurarAreas(selectId, valorActual)` / `_llenarAreas(...)` — \[Auxiliares internas\] Cargan y pueblan el select de Área Responsable. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 687-712)*
- `toast(msg)` — Muestra notificación. \[usa: dom\] *(líneas 714-737, 24L)*

## Búsqueda global

- `buscarGlobal(q)` — Busca global. *(líneas 740-761, 22L)*

## DASHBOARD — carga desde Apps Script

- `cargarDashboard()` — Carga dashboard. \[usa: dom, llama-backend-gas\] *(líneas 766-795, 30L)*
- `renderDashboard()` — Renderiza dashboard. \[usa: dom, dom-render\] *(líneas 796-837, 42L)*

## MÓDULO DE CASOS

- `cargarCasos()` — Carga casos. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 853-926, 74L)*
- `renderCasosModule()` — Renderiza casos module. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 927-1007, 81L)*
- `eliminarCasoConf(codigoCaso)` — Elimina caso conf. \[usa: confirm-dialog, llama-backend-gas\] *(líneas 1008-1019, 12L)*
- `filtrarCasos()` — Filtra casos. \[usa: dom, dom-render\] *(líneas 1020-1107, 88L)*
- `agregarDemandaForm()` / `eliminarDemandaForm(id)` / `renderDemandasForm()` — Gestionan la sublista de demandas dentro del formulario de un caso (en memoria, antes de guardar). \[usa: dom, dom-render\] *(líneas 1110-1151)*
- `llenarDemandaTipos()` — Llena demanda tipos. \[usa: dom, llama-backend-gas\] *(líneas 1152-1180, 29L)*
- `abrirWhatsAppCasoTabla(codigoCaso)` — Abre whats app caso tabla. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1182-1271, 90L)*
- `enviarCorreoCasoTabla(codigoCaso)` — Envía correo caso tabla. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1272-1342, 71L)*
- `abrirDetalleCaso(caso)` — Abre detalle caso. \[usa: dom, dom-render\] *(líneas 1343-1388, 46L)*
- `guardarNuevoCaso(tipo)` — Guarda nuevo caso. \[usa: dom, llama-backend-gas\] *(líneas 1389-1498, 110L)*
- `actualizarPendientesBorradores()` — Actualiza pendientes borradores. \[usa: dom\] *(líneas 1499-1505, 7L)*
- `avanzarPasoCaso(idCaso, codigoCaso, pasoActual, accion)` — Avanza paso caso. \[usa: dom, llama-backend-gas\] *(líneas 1506-1535, 30L)*
- `generarPDFCaso(idCaso, codigoCaso)` — Genera pdf caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1536-1560, 25L)*
- `enviarCorreoCaso(idCaso, codigoCaso)` — Envía correo caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1561-1575, 15L)*
- `obtenerDestinatariosCaso(idCaso)` — Función: obtener destinatarios caso. *(líneas 1576-1617, 42L)*

## MÓDULO DE ALERTAS TEMPRANAS

- `cargarAlertas()` — Carga alertas. \[usa: dom, llama-backend-gas\] *(líneas 1622-1668, 47L)*
- `renderAlertasModule()` — Renderiza alertas module. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1669-1769, 101L)*
- `filtrarAlertas()` — Filtra alertas. \[usa: dom, dom-render\] *(líneas 1770-1799, 30L)*
- `abrirDetalleAlerta(alerta)` — Abre detalle alerta. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 1800-1913, 114L)*

## WhatsApp con formato igual a la imagen del sectorista

- `generarMensajeWA(tipo, doc)` — Genera mensaje wa. *(líneas 1916-1970, 55L)*
- `abrirWhatsAppAlerta(idAlerta)` — Abre whats app alerta. *(líneas 1971-1998, 28L)*
- `registrarEnvioWA(tipo, idDoc)` — Registra envio wa. \[usa: llama-backend-gas\] *(líneas 1999-2012, 14L)*
- `guardarNuevaAlerta(tipo)` — Guarda nueva alerta. \[usa: dom, llama-backend-gas\] *(líneas 2013-2068, 56L)*
- `avanzarPasoReporte(tipo, idDoc, pasoActual, accion)` — Avanza paso reporte. \[usa: dom, llama-backend-gas\] *(líneas 2069-2082, 14L)*
- `generarPDFReporte(tipo, idDoc)` — Genera pdf reporte. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2083-2105, 23L)*
- `enviarCorreoReporte(tipo, idDoc)` — Envía correo reporte. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2106-2124, 19L)*

## MÓDULO REPORTE RÁPIDO

- `cargarRR()` — Carga rr. \[usa: dom, llama-backend-gas\] *(líneas 2129-2161, 33L)*
- `renderRRModule()` — Renderiza rr module. \[usa: dom, dom-render\] *(líneas 2162-2184, 23L)*
- `filtrarRR()` — Filtra rr. \[usa: dom, dom-render\] *(líneas 2185-2206, 22L)*
- `abrirDetalleRR(rr)` — Abre detalle rr. \[usa: dom, dom-render\] *(líneas 2207-2226, 20L)*
- `guardarRR(tipo)` — Guarda rr. \[usa: dom, llama-backend-gas\] *(líneas 2227-2258, 32L)*

## MÓDULO CLIMA SOCIAL

- `cargarClima()` — Carga clima. \[usa: dom, llama-backend-gas\] *(líneas 2263-2288, 26L)*
- `renderClimaModule()` — Renderiza clima module. \[usa: dom, dom-render\] *(líneas 2289-2311, 23L)*
- `filtrarClima()` — Filtra clima. \[usa: dom, dom-render\] *(líneas 2312-2333, 22L)*
- `abrirDetalleClima(c)` — Abre detalle clima. \[usa: dom, dom-render\] *(líneas 2334-2352, 19L)*
- `abrirWhatsAppClima(idClima)` — Abre whats app clima. *(líneas 2353-2370, 18L)*
- `guardarClima(tipo)` — Guarda clima. \[usa: dom, llama-backend-gas\] *(líneas 2371-2402, 32L)*

## HELPERS COMPARTIDOS

- `cerrarModal()` — Cierra modal. \[usa: dom\] *(líneas 2407-2409, 3L)*
- `sTabModal(prefix, id, btn)` — Función: s tab modal. \[usa: dom\] *(líneas 2416-2429, 14L)*
- `llenarSelect(id, data, valCol, txtCol)` — Llena select. \[usa: dom, dom-render\] *(líneas 2430-2443, 14L)*
- `llenarSelectDeptos(id)` — Llena select deptos. \[usa: dom\] *(líneas 2444-2453, 10L)*
- `cargarProvincias(selId, deptoId)` — Carga provincias. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2454-2475, 22L)*
- `generarCodigoCaso()` — Genera codigo caso. *(líneas 2476-2480, 5L)*
- `previsualizarFoto(input, prevId, dropId)` — Función: previsualizar foto. \[usa: dom, file-read\] *(líneas 2481-2497, 17L)*
- `confirmarEliminar(tipo, id, codigo)` — Función: confirmar eliminar. \[usa: confirm-dialog\] *(líneas 2498-2504, 7L)*
- `enviarNotificacionValidacion(codigo, nombre, idSec)` — Envía notificacion validacion. \[usa: llama-backend-gas\] *(líneas 2505-2513, 9L)*

## MÓDULO HECHOS OCURRIDOS

- `renderHechosModule()` — Renderiza hechos module. \[usa: dom, dom-render\] *(líneas 2523-2548, 26L)*
- `sincronizarCodigo(selId, inputId)` — Sincroniza codigo. \[usa: dom\] *(líneas 2549-2556, 8L)*
- `guardarHecho()` — Guarda hecho. \[usa: dom, llama-backend-gas\] *(líneas 2557-2581, 25L)*
- `abrirDetalleHecho(h)` — Abre detalle hecho. \[usa: dom, dom-render\] *(líneas 2582-2591, 10L)*
- `editarHecho(h)` — Edita hecho. \[usa: dom\] *(líneas 2592-2608, 17L)*
- `eliminarHecho(id)` — Elimina hecho. \[usa: confirm-dialog, llama-backend-gas\] *(líneas 2609-2621, 13L)*

## MÓDULO ACCIONES E HITOS

- `renderAccionesModule()` — Renderiza acciones module. \[usa: dom, dom-render\] *(líneas 2627-2651, 25L)*
- `guardarAccion(tipo)` — Guarda accion. \[usa: dom, llama-backend-gas\] *(líneas 2652-2682, 31L)*
- `enviarNotifPF(datos)` — Envía notif pf. \[usa: llama-backend-gas\] *(líneas 2683-2691, 9L)*
- `abrirDetalleAccion(a)` — Abre detalle accion. \[usa: dom, dom-render\] *(líneas 2692-2701, 10L)*

## SECTORISTAS, PF, AUTORIDADES (estructura similar a actores)

- `cargarSectoristas()`, `renderSectoristasMod()`, `cargarPF()`, `renderPFMod()`, `cargarAutoridades()`, `renderAutMod()` — Cargan y renderizan los listados de Sectoristas, Puntos Focales y Autoridades. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2710-2769)*

## MÓDULO MAESTROS (solo Admin)

- `cargarMaestros()` — Carga maestros. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2774-2828, 55L)*
- `renderMaestroCard(key, data, cols, lbl)` — Renderiza maestro card. \[usa: dom, dom-render\] *(líneas 2829-2835, 7L)*

## LOG DE ENVÍOS (solo Admin/Directora)

- `cargarLog()` / `renderLogModule(log)` / `filtrarLog()` — Cargan, renderizan y filtran el log de envíos. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 2840-2881)*
- `cargarPendientes()` / `exportarPendientes()` / `irADocumento(tipo, id)` — Gestionan la bandeja de pendientes. \[usa: dom, dom-render\] *(líneas 2884-2907)*
- `renderSectoristasMod()`, `secTab(btn, paneId)`, `guardarNuevoSectorista()`, `_guardarPersonaFinal(datos, fnName, callback)` — **Nota:** redefinidos aquí (sobrescriben versiones anteriores del mismo archivo); forman parte de un formulario de alta de Sectorista con pestañas. \[usa: dom, dom-render, file-read, llama-backend-gas\] *(líneas 2910-2990)*

## PUNTOS FOCALES - Lista + Nuevo

- `cargarPF2()`, `renderPFMod()`, `pfTab(btn, paneId)`, `guardarNuevoPF()` — Alta y listado de Puntos Focales (variante con pestañas). \[usa: dom, dom-render, file-read, llama-backend-gas\] *(líneas 2995-3065)*

## AUTORIDADES - Lista + Nuevo

- `renderAutMod()`, `autTab(btn, paneId)`, `guardarNuevaAutoridad()` — Alta y listado de Autoridades (variante con pestañas). \[usa: dom, dom-render, file-read, llama-backend-gas\] *(líneas 3070-3138)*

## POPUP PERSONA - usa data-idx para evitar JSON en onclick

- `verPersonaByIdx(btn)` / `verPersona(persona, tipo)` — Muestran el popup de ficha de una persona (Sectorista/PF/Autoridad) a partir de su índice en caché. \[usa: dom, dom-render\] *(líneas 3143-3169)*

## BIENVENIDA - una sola vez por DNI

- `mostrarBienvenida(usuario)` / `cerrarBienvenida()` — Muestran/cierran un modal de bienvenida, controlado por `localStorage` para que aparezca una sola vez por DNI. \[usa: dom, dom-render, local-storage\] *(líneas 3174-3225)*

## DISTRITOS

- `cargarDistritos(selId, provId)` — Carga distritos. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3230-3251, 22L)*

## WhatsApp RR fix

- `abrirWhatsAppRR_btn(btn)`, `xTab(...)`, `verPersonaByIdx(btn)`, `guardarNuevoSectorista()`, `guardarNuevoPF()`, `guardarNuevaAutoridad()`, `mostrarBienvenida(usuario)`, `cerrarBienvenida()`, `cargarDistritos(...)`, `xTabReset(...)`, `xTabD(btn)`, `xTabResetD(btn)`, `prevFoto(...)`, `editarSectorista(idx)`, `editarPF(idx)`, `editarAutoridad(idx)` — **Bloque de redefiniciones/parches** (varias funciones ya definidas arriba se sobrescriben aquí con variantes corregidas) para los módulos de personal, pestañas genéricas, vista previa de foto y envío de RR por WhatsApp. \[usa: dom, dom-render, llama-backend-gas, local-storage, file-read\] *(líneas 3256-3653)*

## LÍNEA DE TIEMPO DEL CASO

- `verLineaTiempo(codigoCaso)` / `renderLineaTiempo(hechos, codigoCaso)` — Muestran la línea de tiempo de hechos de un caso. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3658-3696)*

## ACCIONES E HITOS DEL CASO

- `renderAccionesHitos(acciones, codigoCaso)` — Renderiza acciones hitos. \[usa: dom, dom-render\] *(líneas 3702-3713, 12L)*

## BRIDGE: Departamentos, Actores, Recursos vinculados al caso

- `agregarDepto()` / `eliminarDepto(id)` / `agregarRecurso()` / `eliminarRecurso(id)` / `renderBridgeLista(...)` — Gestionan las listas de departamentos y recursos vinculados a un caso dentro del formulario. \[usa: dom, dom-render\] *(líneas 3718-3812)*

## FUNCIONES GENÉRICAS PARA BRIDGES (Alerta, RR, Clima)

- `iniciarBridgesGen(prefix)`, `llenarSelectConCache(...)`, `detectarColRecursoID(data)`, `llenarSelectConCacheRecurso(selId)`, `detectarColRecurso(data)`, `agregarDeptoGen(prefix)`, `agregarActorGen(prefix)`, `agregarRecursoGen(prefix)` — Versión genérica (parametrizada por prefijo de formulario) de los bridges de departamentos/actores/recursos, reutilizable en Alertas, RR y Clima. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 3818-4070)*

## VER PROCESO / RECORRIDO DEL CASO O REPORTE

- `verRecorridoCaso(codigoCaso, nombreCaso)`, `renderLineaTiempo(codigoCaso, data)`, `verRecorridoReporte(idReporte, tituloReporte)`, `renderRecorrido(pasos, tipo)` — Muestran el recorrido/historial de pasos de un caso o reporte. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4075-4229)*

## AVANZAR PASO DESDE PENDIENTES (Directora valida/rechaza)

- `modalAvanzarPaso(tipo, id, titulo, pasoActual)` / `confirmarAvance(tipo, id, pasoActual, aprobar)` — Modal para aprobar/rechazar el avance de un caso o reporte desde la bandeja de pendientes. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4234-4308)*

## VER FICHA DEL CASO — popup solo lectura

- `verFichaCaso(tipo, id)` — Función: ver ficha caso (solo lectura). \[usa: dom, dom-render\] *(líneas 4313-4366, 54L)*

## EDITAR FICHA DEL CASO — formulario en modal

- `editarFichaCaso(tipo, id)`, `optArr`, `optCacheArr`, `esc2`, `fmtDate`, `guardarEdicionCaso(id)` — Formulario modal de edición de la ficha de un caso, con helpers de formato/escape HTML. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4371-4462)*

## MODAL ENVIAR A PUNTO FOCAL — Correo y/o WhatsApp

- `modalEnviarCaso(...)`, `actualizarContactoPF()`, `confirmarEnvio(...)` — Modal para enviar un caso/reporte al Punto Focal por correo y/o WhatsApp. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 4467-4573)*

## BLOQUE B — HECHOS OCURRIDOS (mejorado)

- `cargarHechos()`, `renderHechosModulo()`, `renderTablaHechos(hechos)`, `filtrarHechos()`, `abrirNuevoHecho(codigoCasoPresel)`, `abrirFormHecho()`, `guardarNuevoHecho()`, `editarHecho(id)`, `eliminarHechoConf(id)`, `verDetalleHecho(id)` — **Reescritura completa** del módulo de Hechos Ocurridos (reemplaza la versión básica de arriba), con alta desde la bandeja de casos, subida de foto y confirmación de borrado. \[usa: dom, dom-render, file-read, confirm-dialog, llama-backend-gas\] *(líneas 4580-4816)*

## MÓDULO ACCIONES PRODUCE — COMPLETO

- `cargarAcciones()`, `renderAccionesModulo()`, `renderTablaAcciones(acciones)`, `filtrarAcciones()`, `abrirNuevaAccion(...)`, `abrirFormAccion()`, `guardarNuevaAccion()`, `editarAccion(id)`, `eliminarAccion(id)` — **Reescritura completa** del módulo de Acciones/Hitos (reemplaza la versión básica de arriba). \[usa: dom, dom-render, file-read, confirm-dialog, llama-backend-gas\] *(líneas 4826-5052)*

## BLOQUE C — ACTORES SOCIALES (completamente rediseñado)

- `cargarActores()`, `renderActoresModulo()`, `renderActoresLista(actores)`, `renderActoresTbody(...)`, `renderTablaActores(actores)`, `filtrarActores()`, `editarActorInline(id)`, `renderFormActorInline(idEditar)`, `verPerfilActor(id)`, `abrirFormActor(idEditar)`, `editarActorForm(id)`, `guardarActorForm(idEditar)`, `eliminarActorConf(id)` — **Reescritura completa** del módulo de Actores Sociales, con edición inline, perfil de actor y foto. \[usa: dom, dom-render, file-read, confirm-dialog, llama-backend-gas\] *(líneas 5078-5421)*

## Demandas vinculadas a un caso (sección adicional en la ficha)

- `abrirModalDemandas(codigoCaso)`, `renderListaDemandas(...)`, `agregarDemanda(codigoCaso)`, `guardarDemanda(codigoCaso)`, `cargarDemandasCaso(codigoCaso)`, `eliminarDemanda(id, codigoCaso)` — Modal de demandas vinculadas a un caso, accesible desde su ficha. \[usa: dom, dom-render, confirm-dialog, llama-backend-gas\] *(líneas 5428-5520)*

## Bandeja de pendientes (por rol: Sectorista, PF, Directora)

- `renderPendientes(lista)` — Renderiza la bandeja de pendientes diferenciada por rol (Sectorista: casos nuevos; PF: casos remitidos a su área en Paso 4-5; Directora: validación final); es, junto con `getFichaCasoCompleta` del backend, de las funciones más extensas del sistema. \[usa: confirm-dialog, dom, dom-render, llama-backend-gas\] *(líneas 5532-5827, 296L)*

## MÓDULO ANÁLISIS DE CASOS DE CONFLICTIVIDAD — COMPLETO

- `cargarAnalisis()`, `_renderAnalisisLista()`, `_filtrarAnalisis()`, `_renderTablaAnalisis(listado)`, `abrirFormAnalisisRegNuevo()`, `_cargarCasosParaRegional(depto)`, `_guardarAnalisisRegional()`, `abrirFormAnalisisNuevo()`, `abrirFormAnalisisEditar(idOrIdx)`, `_abrirFormAnalisis(id, datosPrev)`, `_renderInfoRelacionada(...)`, `_cargarDatosCasoAnalisis(codigoCaso)`, `_buildListaRegistro(...)`, `_agregarItem(id)`, `_renderMediosLista(medios)`, `_agregarMedio()`, `_guardarAnalisisForm(idPrev)`, `exportarAnalisisPDF(idAnalisis)`, `eliminarAnalisisServer(id)` — Módulo completo de análisis de conflictividad de casos (individual y regional), con formularios dinámicos de actores/medios/hitos y exportación a PDF. \[usa: dom, dom-render, confirm-dialog, llama-backend-gas\] *(líneas 5833-6285)*

## Compatibilidad con funciones antiguas que puedan existir

- `iniciarNuevoAnalisis()`, `editarAnalisis(i)`, `eliminarAnalisis(i)`, `renderAnalisisLista(l)` — Alias de compatibilidad hacia atrás (shims) que delegan en las funciones nuevas del módulo de análisis. *(líneas 6288-6302)*

## MÓDULO HITOS PRODUCE — COMPLETO

- `cargarHitos()`, `_renderHitosLista()`, `filtrarHitosLista()`, `renderTablaHitos(hitos)`, `abrirNuevoHito(...)`, `nuevoHito()`, `cargarAccionesCaso(...)`, `guardarHito()`, `verDetalleHito(id)`, `enviarCorreoHito(id)`, `editarHito(id)`, `eliminarHito(id)` — Módulo completo de Hitos (metas de acciones) con alta, edición, envío de correo y borrado. \[usa: dom, dom-render, file-read, confirm-dialog, llama-backend-gas\] *(líneas 6308-6587)*

## MÓDULO ANÁLISIS REGIONAL

- `cargarAnalisisRegional()`, `_renderAnalisisRegional()`, `_filtrarRegional()`, `_renderResumenRegional(casos)`, `_generarReporteRegional()`, `_verReporteDepto(depto)` — Vista agregada de análisis por departamento, con resumen y reporte regional. \[usa: dom, dom-render, llama-backend-gas\] *(líneas 6591-6805)*
- `cargarRedRadar()`, `_renderRedesTabla(redes)`, `_renderNodosTabla(nodos)`, `verNodosDeRed(codigoRed)`, `abrirFormRedNueva()`, `_guardarRedRadar(idEditar)`, `abrirFormNodoNuevo(idEditar)`, `_guardarNodoRadar()`, `editarRedRadar(codigo)`, `editarNodoRadar(codigo)`, `eliminarRedConf(codigo)`, `eliminarNodoConf(codigo)` — Módulo de "Red de Radar" (redes y nodos de monitoreo territorial de actores). \[usa: dom, dom-render, confirm-dialog, llama-backend-gas\] *(líneas 6806-7093)*

## Mantener compatibilidad con función anterior

- `nuevoRadar()` / `guardarRadar()` — Alias de compatibilidad hacia atrás del módulo de Red Radar. *(líneas 7096-7101)*

## MÓDULO ACTORES DEL ESTADO (FIX 6)

- `cargarActoresEstado()`, `renderActoresEstadoMod(actores)`, `renderFormActorEstado()`, `guardarActorEstado()`, `eliminarActorEstadoConf(id)` — CRUD del módulo de Actores del Estado (funcionarios), con foto. \[usa: dom, dom-render, file-read, confirm-dialog, llama-backend-gas\] *(líneas 7106-7272)*

## FIX 7 — Selectores de actores filtrados por tipo

- `buildActoresSelect(elId, tipoFiltro)` — Construye un `<select>` de actores filtrado por tipo (uno o varios), reutilizable en los formularios de Casos/Alertas/Clima/RR. \[usa: dom, dom-render\] *(líneas 7277-7288, 12L)*

## MÓDULO DEMANDAS (Fix #4 sidebar)

- `cargarDemandas()`, `renderFormNuevaDemanda()`, `guardarDemanda()` — Vista de barra lateral (sidebar) con listado y alta de demandas directas (no ligadas a un caso específico mediante modal). \[usa: dom, dom-render, llama-backend-gas\] *(líneas 7296-7368)*
- `llenarSelectActoresEstadoCaso()`, `agregarActorEstadoGen(pref)`, `quitarActorEstado(btn)` — Selector y chips para vincular Actores del Estado a un caso o alerta (genérico por prefijo). \[usa: dom, dom-render, llama-backend-gas\] *(líneas 7369-7426)*
- `agregarDemandaAlerta()` — Agrega una demanda (en memoria) al formulario de una Alerta Temprana antes de guardarla. \[usa: dom, dom-render\] *(líneas 7428-7449, 22L)*
- `editarAlerta(idAlerta)` — Abre el detalle de una alerta para edición a partir de su ID en caché. *(líneas 7451-7455, 5L)*
