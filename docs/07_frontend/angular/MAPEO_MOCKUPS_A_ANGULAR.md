# Mapeo de mockups consolidados a Angular

**Actualizado:** 2026-11-23
**Alcance:** correspondencia entre los mockups elegidos/consolidados de `docs/07_frontend/mockups/` y la SPA Angular existente. Es un mapa de diseño e implementación; **no modifica los componentes Angular**.

## Criterio de aplicación

Los mockups son referencias de presentación, no fuentes para copiar registros de ejemplo ni para alterar el contrato. Mantener el shell, rutas, paginación, capacidades, datos reales y estados de carga/error de Angular. Los elementos de fondo del mockup (sidebar, navegación, contadores de muestra) no se duplican dentro de cada feature: el shell existente es `angular/src/app/layouts/shell/shell.component.{ts,html}`.

## Correspondencia por vista

### Perfil del actor

- **Mockup canónico:** `actores_ficha_modal_perfil_del_actor.html`.
- **Ruta y página:** `/directorio/actores` → `ActoresPage`, `angular/src/app/features/directorio/actores.page.{ts,html}`.
- **Componente de ficha:** `ActorPanelComponent` (`angular/src/app/features/directorio/actor-panel.component.{ts,html}`, selector `app-actor-panel`), abierto desde una fila de `ActoresPage`.
- **Qué actualizar:** jerarquía de identidad/perfil, datos de caracterización, organización y ubicación; puede guiar el rediseño del encabezado y las secciones del panel. El mockup usa una ficha modal centrada; Angular usa un drawer accesible. Es una decisión de presentación dentro de `ActorPanelComponent`, no una ruta nueva.
- **Límites que se preservan:** DNI, correo y teléfono no se muestran desde el listado. `ActorPanelComponent` consulta PII bajo demanda, la audita y oculta el control a roles sin permiso (`CapacidadesService`). El mockup no autoriza a revelar esos datos antes de la misma comprobación.

### Edición del actor

- **Mockup canónico:** `actores_editar_actor_modo_oscuro_2.html`.
- **Punto de entrada futuro:** acciones de `ActoresPage` (`actores.page.html` / `.ts`) y un componente separado —por ejemplo `ActorEdicionPanelComponent`— junto a `ActorPanelComponent`.
- **Estado Angular (2026-11-23):** `ActorPanelComponent` ofrece edición de atributos públicos para roles autorizados. `PATCH /api/v1/actors/[uid]` valida campos y catálogos, actualiza con la sesión/RLS vigente y registra auditoría en la misma transacción. No recibe DNI, correo ni teléfono: la PII permanece en su canal cifrado y con motivo auditado. Sigue sin existir alta de actores, captura de PII, fusión ni baja lógica.
- **Implicación:** el mockup define una futura superficie de formulario; para que guarde de verdad hacen falta contrato/ruta de escritura, autorización y mapeo de campos. No conviene convertir el panel de lectura en un formulario ficticio ni conectar los campos de muestra a una mutación inexistente. DNI/RENIEC e imagen también requieren contratos explícitos.

### Lista temporal, asistencia y fichas

- **Mockup canónico:** `actores_ventana_flotante_centrada_con_lista_de_asistencia_y_fichas.html`. Integra el directorio con acciones por fila, estado seleccionado, ventana flotante centrada/arrastrable, minimización/cierre, lista vacía, padrón de asistencia y exportación de fichas.
- **Punto Angular existente:** `ActoresPage` (`features/directorio/actores.page.{ts,html}`) contiene tabla paginada, filtros y apertura de la ficha.
- **Estado:** implementada lista temporal en `ActoresPage`; permite agregar/quitar actores, ver la selección y conservarla al paginar o filtrar mientras la vista permanece montada. La selección vive sólo en memoria, sin `localStorage` ni tabla, porque no hay requerimiento de persistencia. El diálogo de padrón descarga CSV con metadatos del evento y campos públicos institucionales, sin DNI, teléfono ni correo; neutraliza valores que podrían interpretarse como fórmulas. Siguen pendientes PDF/Excel y la exportación de fichas de perfil.
- **Exportación:** `app-exportar-menu` exporta la entidad/listado existente, pero no genera el formato de asistencia o un dossier de fichas. Esas dos salidas requieren especificar los formatos y comprobar qué campos están disponibles. No tratar el `alert()` del mockup como una exportación implementada.

### Tarjetas de casos

- **Mockup canónico:** `casos_vista_de_tarjetas_ajustes_22_nov.html`.
- **Vista Angular:** `/casos` → `CasosPage`, `angular/src/app/features/casos/casos.page.{ts,html}`. `casos.page.html` ya implementa `case-grid`, tarjetas activables, filtros, paginación y selección entre tarjetas/tabla; `casos.page.ts` mantiene el modo y abre la vista previa.
- **Detalle al seleccionar una tarjeta:** `CasoVistaPreviaComponent`, `features/casos/caso-vista-previa.component.{ts,html}`, selector `app-caso-vista-previa`. Actualmente es una vista previa en drawer con enlaces al expediente, no la ficha completa del mockup.
- **Qué actualizar:** jerarquía/tipografía y distribución de código, región, riesgo, resumen y fecha dentro de la tarjeta. Mantener valores provenientes de `GET /v1/cases`, filtros y página del servidor. Las nueve tarjetas y cifras del HTML son ejemplos visuales, no un catálogo que se copie al cliente.

### Detalle de alerta vinculada

- **Mockup canónico:** `alertas_tempranas_detalle_con_fondo_variante_1_drawer_cl_sico.html`.
- **Vista y apertura:** `/alertas` → `AlertasPage` (`features/alertas/alertas.page.{ts,html}`), que carga el detalle al seleccionar una fila y presenta `AlertaPanelComponent` (`features/alertas/alerta-panel.component.{ts,html}`, selector `app-alerta-panel`).
- **Qué actualizar:** encabezado del drawer, contexto de caso vinculado, secciones narrativas, datos de expediente, progreso y acciones; el panel Angular ya contempla estos grupos, demandas y estados de carga/error. La barra de flujo debe seguir derivándose de `pasoActual` y del catálogo en `alerta.mapeo.ts`.
- **No copiar literalmente:** AT-2026-46, fechas, nombres, ámbito, número de alertas vinculadas y texto narrativo son datos de muestra. La API/mapper determina lo que se muestra; un dato ausente conserva «—»/estado vacío.

### Panorama territorial consolidado

- **Mockup canónico:** `panorama-territorial.html`; absorbe el resumen KPI, las bandas de macroámbito, los chips de alcance y la tabla regional de `panorama_territorial_vista_geogr_fica_y_regiones.html`.
- **Vista Angular:** ruta `/mapa` → `MapaPage`, `angular/src/app/features/mapa/mapa.page.{ts,html}`.
- **Componentes/servicios de datos:** `PanoramaService` (`features/mapa/panorama.service.ts`) consulta casos abiertos paginados; `panorama.agregados.ts` produce bandas, conteos regionales y riesgo alto; `centroides.regiones.ts` aporta centroides referenciales. La página implementa mapa Leaflet, selección de ámbito, lista priorizada y cajón «Ver casos».
- **Qué actualizar:** orden y agrupación visual del resumen, barras por macroámbito, selector y desglose regional. El mapa sigue rotulado referencial: no convertir los esquemas del mockup en polígonos o geografía distrital. No trasladar cifras estáticas de la variante eliminada.

### Solicitud de modificación de alerta según usuario

- **Mockup consolidado:** `alertas_tempranas_solicitar_modificaci_n_1.html` (tema oscuro del flujo) con el contexto integrado del segundo mockup. Explicita `Dirección OAIPCS` como solicitante y `Sectorista asignado` como destinatario/subsanador, coherente con los responsables del flujo Angular.
- **Componente candidato:** estado/modal de solicitud dentro de `AlertaPanelComponent`; la página contenedora y sus mutaciones viven en `AlertasPage` (`alertas.page.ts`). Si la sección crece, separar la presentación en `SolicitudModificacionAlertaComponent` sin duplicar el panel ni el shell.
- **Estado Angular:** el panel ya tiene formulario de edición ordinaria y transiciones del flujo. `AlertasPage.accionFlujo()` envía `{ pasoActual }`; no existe en la SPA un formulario que guarde el texto de observación con autor/destinatario y dispare una notificación de devolución.
- **Dependencia de producto/API:** el copy y la matriz de permisos deben confirmar qué roles pueden solicitar y quién subsana. El textarea de 500 caracteres, el responsable, la transición a «En Modificación», la auditoría de la solicitud y la notificación no se deben fingir con el `PATCH` de campos normales: falta definir el contrato que los persiste y autoriza. La maqueta fusionada es referencia de diseño, no prueba de que ese flujo esté implementado.

### Detalle completo del caso consolidado

- **Mockup canónico:** `casos_detalle_en_ventana_emergente_ajustes_22_nov.html`; se integró en su tabla de actores el **cargo/representatividad** y **posicionamiento** que aportaba `casos_modal_detalle_y_mapa_de_actores.html`, conservando el layout de ajustes, navegación, exportación y secciones del canónico.
- **Expediente Angular:** `/casos/:codigo` → `CasoDetallePage`, `angular/src/app/features/casos/caso-detalle.page.{ts,html}`. Consume `GET /v1/cases/{codigo}` y muestra resumen, metadatos, actores, cronología, demandas, alertas, compromisos, documentos e historial; `RielRelacionesComponent` es el acceso lateral a secciones.
- **Relación con tarjetas:** `CasoVistaPreviaComponent` debe seguir siendo un reconocimiento compacto del caso. La maqueta de detalle completo actualiza el diseño de `CasoDetallePage`; no obliga a convertir toda la ficha en un modal ni a retirar la URL compartible `/casos/:codigo`.
- **Diferencia de datos:** Angular `ActorCaso` dispone de nombre, correo, tipo, función y posicionamiento. La implementación documenta que organización y teléfono aún no llegan por la API; el mockup puede mostrar esos campos como `—` hasta que el contrato los exponga. Cargos, contactos, cifras, Canva y relaciones no deben copiarse desde las filas ficticias del HTML.

## Resumen de impacto

| Mockup canónico | Angular existente a actualizar | Estado / trabajo faltante |
| --- | --- | --- |
| Perfil del actor | `ActoresPage` + `ActorPanelComponent` | Rediseño del drawer; preservar acceso PII auditado |
| Edición del actor | `ActoresPage` + `ActorPanelComponent` | ✔ Edición de atributos públicos y PATCH auditado; PII, alta, fusión y baja lógica pendientes |
| Lista temporal | `ActoresPage` | ✔ Selección temporal en memoria entre filtros/páginas; padrón de asistencia y exportación siguen pendientes |
| Tarjetas de casos | `CasosPage` + `CasoVistaPreviaComponent` | Base existente; aplicar presentación sin alterar filtros/datos |
| Detalle de alerta | `AlertasPage` + `AlertaPanelComponent` | Base de detalle/flujo existente; actualizar composición |
| Panorama territorial | `MapaPage` + `PanoramaService` + `panorama.agregados.ts` | Las dos variantes describían la misma superficie, ya hay mapa/bandas/tabla/cajón |
| Solicitud de modificación | `AlertaPanelComponent` + `AlertasPage` | Falta flujo específico, política por rol y contrato de auditoría/notificación |
| Detalle completo del caso | `CasoDetallePage`; vista previa como acceso corto | Mantener la ficha completa en ruta; revisar campos que la API aún no entrega |

## Alternativas retiradas

Se eliminaron 12 alternativas después de conservar ocho fuentes canónicas:

- `perfil_del_actor_ficha_modal.html`
- `actores_editar_actor_modo_oscuro_1.html`
- `actores_directorio_con_lista_temporal.html`
- `actores_directorio_con_lista_temporal_cerrada_y_columna_acciones.html`
- `actores_ventana_flotante_arrastrable_de_lista_temporal.html`
- `casos_vista_de_tarjetas.html`
- `alertas_tempranas_detalle_y_alertas_vinculadas_1.html`
- `alertas_tempranas_detalle_y_alertas_vinculadas_2.html`
- `alertas_tempranas_detalle_y_alertas_vinculadas_sidebar_colapsado.html`
- `panorama_territorial_vista_geogr_fica_y_regiones.html`
- `alertas_tempranas_solicitar_modificaci_n_2.html`
- `casos_modal_detalle_y_mapa_de_actores.html`

**Avance de implementación (2026-11-23).** La lista temporal y la edición de atributos públicos del mockup de actores ya están integradas en Angular; el `PATCH` aplica RLS y audita la mutación. Siguen pendientes la creación/captura de PII/fusión/baja de actores y la solicitud/auditoría/notificación de modificación de alertas, que requieren completar sus contratos antes de habilitar sus flujos.
