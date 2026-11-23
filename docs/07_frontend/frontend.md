# Catálogo priorizado de cambios

**Estado (2026-11-22):** Angular es el frontend definitivo del producto y se construye en `angular/`; la UI Next (`app/`, `components/`) queda **congelada como referencia de diseño** y no se evoluciona. Las rutas y líneas que se citan aquí pertenecen a esa referencia congelada —siguen siendo válidas para leer el diseño— y cada cambio se implementa en la SPA Angular, donde a fecha de hoy están cableadas **las 22 pantallas** (`acceso`, `resumen`, `bandeja`, `busqueda`, `notificaciones`, `casos`, `casos/sin-caso`, `casos/:codigo`, `alertas`, `compromisos`, `documentos`, `papelera`, `reportes`, `mapa`, `directorio`, `directorio/actores`, `directorio/organizaciones`, `directorio/instituciones`, `directorio/locales`, `direccion`, `ayuda` y `preferencias`). Ninguna queda en `EnMigracionComponent`; desde el 2026-11-22 `/mapa` es la **ventana principal** de la SPA (`features/mapa/`): «Panorama territorial» con casos abiertos por ámbito y región, filtro por ámbito en la URL, recorte por las regiones de la sesión y una vista esquemática que **no inventa geometría**. La capa cartográfica —capas temáticas y agrupación de puntos— sigue aplazada, con dos excepciones desde el 2026-11-23: `gis/Infraestructuras.kml` aporta **13 456 puntos**, pero no son 13 456 instalaciones de PRODUCE: **13 229 son derechos acuícolas privados** (titular, resolución, área, especie y categoría productiva) y **227 son sedes institucionales** con `IDENTI` (ITP, DPA-GORE, SANIPES…). Todos traen `DEPARTAMEN`, `PROVINCIA` y `DISTRITO` (835 distritos por nombre, 861 combinaciones oficiales) y ya están tabulados con **ubigeo INEI resuelto en 13 404** de los 13 456 (`gis/derived/infraestructuras_puntos.csv`), así que alcanza para una nube de puntos simbolizable, para cortes por distrito, para filtrar por tipo de registro y para unir con el resto del modelo, pero no para polígonos. La segunda excepción es la **capa distrital** `gis/Poblacion Censo 2025 geogpsperu/`: un shapefile WGS84 con **1 892 polígonos** de distrito, `UBIGEO` INEI de seis dígitos, 196 provincias y 25 departamentos —la geometría distrital que faltaba—, más población por distrito. Está verificada como archivo y **todavía no cargada**; sus defectos y su numeración se detallan en «Capa distrital censal (2026-11-23)». El shell retiró el bloque «Gestión territorial» y, fuera del mapa, la cabecera muestra el ámbito vigente (la preferencia `avisa-alcance` o el de la sesión) enlazado a Preferencias.

Ordené los cambios por dificultad creciente y los aterricé en la arquitectura vigente: la **SPA Angular** (`angular/src/app`), que lee la API real (`app/api/v1/**`) y escribe en Postgres. El shell y la navegación (`avisa-dashboard.tsx`), las vistas y la ficha (`avisa-workspace.tsx`), los formularios (`avisa-crud.tsx`) y `AvisaProvider` con `avisa-demo-data.ts` pertenecen a la **UI Next congelada como referencia de diseño** (ver «Estado» arriba): se citan para leer el diseño y no son el destino del cambio. El esquema SQL AVISA V10 ya documenta entidades para casos, alertas, actores, cronología, demandas, documentos, compromisos e hitos, pero todavía hay que conectar y validar esa capa con la base que use la aplicación. Por eso distingo explícitamente los cambios visuales de los que requieren persistencia, autorización o integraciones.
**Escala:** D1 = bajo; D2 = medio; D3 = alto; D4 = muy alto; D5 = máximo. El número indica dificultad relativa, no calendario.

## D1 · Cambios acotados de presentación y vocabulario

1. **✔ Hecho (2026-11-22).** (SPA `features/casos/caso-detalle.page.html`: no muestra Punto focal, Origen del dato, Validado por persona, Avance 68 %, «Diálogo activo», Descripción del riesgo ni Código de acceso) **Ficha: retirar datos de la vista principal.** Ocultaría Punto focal, Origen del dato, Validado por persona, Avance registrado (68 %), el texto de estado “Diálogo activo”, Descripción del riesgo y Código de acceso. No borraría sus columnas o historial: dejaría los datos internos disponibles donde tengan uso operativo o de auditoría.
2. **✔ Hecho (2026-11-22).** (`core.cat_niveles_conflicto` = Diferencia · Controversia · Conflicto social · Crisis social, en campo separado del riesgo; SPA `features/casos/caso-detalle.page.html`) **Ficha: normalizar Nivel de conflictividad.** Cambiaría la etiqueta y el catálogo a Diferencia, Controversia, Conflicto social y Crisis social, dejando “Alto” para nivel de riesgo. La validación evitaría mezclar ambas escalas.
3. **✔ Hecho (2026-11-22).** (`core.cat_tematicas` con las seis temáticas de la Guía, sin «Otros» ni texto libre; SPA `features/casos/caso-detalle.page.html`) **Ficha: normalizar Temática.** Haría una selección única entre Infraestructura, Ordenamiento y acceso territorial, Normatividad, Distribución de beneficios, Gobernanza e Impactos de terceros; sustituiría los textos libres y el ejemplo “Acceso a infraestructura”.
4. **✔ Hecho (2026-11-22).** (`core.cat_subsectores` = Pesca y Acuicultura · MYPE e Industria; SPA `features/casos/caso-detalle.page.html`) **Ficha: normalizar Subsector.** Ofrecería Pesca y Acuicultura o MYPE e Industria; “Pesca artesanal” quedaría como subopción si se confirma que el catálogo la requiere, no como valor paralelo.
5. **✔ Hecho (2026-11-22).** (`core.cat_prioridades_atencion` = Urgente · Moderado · Bajo, en columna propia separada del riesgo; SPA `features/casos/caso-detalle.page.html`) **Ficha: normalizar Prioridad de atención.** Usaría Urgente, Moderado y Bajo, separada de riesgo y calculada desde la matriz correspondiente. Quitaría “Crítica” de esta categoría; si la prioridad no aporta a la ficha, la ocultaría, como plantea la nota.
6. **✔ Hecho (2026-11-22).** (`core.alcance_caso(uuid)` sobre `core.caso_regiones` y `core.regiones.alcance_id`; migración `migration/30_alcance_derivado.sql`; SPA `features/casos/caso-detalle.page.html`) **Ficha: vocabulario geográfico.** Cambiaría “Territorio” por “Región” en las etiquetas pertinentes y mostraría el alcance geográfico Norte, Centro, Sur, Oriente o Nacional calculado desde la región/distrito, no seleccionado manualmente. El alcance ya no se elige: se calcula en servidor desde las regiones del caso (una sola región → su alcance; varias → Nacional) y la ficha lo rotula «Derivado de las regiones del caso». Se retiró `casos.alcance_id` —la API rechaza un alcance manual con `422 ALCANCE_DERIVADO`— y la etiqueta «Región» ya se usaba.
7. **✔ Hecho (2026-11-22).** (SPA `shared/ui/glosario.component.ts` + `glosario.contenido.ts`, fuente única de las definiciones; usado en `features/casos/caso-detalle.page.html`, `features/compromisos/compromisos.page.html` y `compromiso-panel.component.html`) **Ficha: etiquetas y glosario.** Mostraría “GORE” donde hoy se lee “Gobierno regional”. Añadiría botones ⓘ discretos solo a Nivel de conflictividad, Nivel de riesgo, Temática, Subsector, Prioridad de atención, tipo y función de actor, 3P y tipo de acuerdo. Cada uno muestra una definición corta (`app-glosario`) y enlaza a su sección de `/ayuda`, sin duplicar textos; «GORE» ya se usa en el filtro y el panel de compromisos, y «tipo de acuerdo» quedó como «Tipo de compromiso».
8. **✔ Hecho (2026-11-22).** (`features/casos/ciclo.contenido.ts` + `features/casos/caso-detalle.page.html`: sección «Ruta de atención») **Ruta de atención: términos y explicación.** Sustituiría “Triangulación”, “saturación” y “validación” en esta vista por los cinco componentes del ciclo: Prevención estratégica; Prevención operativa; Intervención y tratamiento; Monitoreo de compromisos; Gestión de la información y del conocimiento (transversal). La ficha muestra los cinco en el orden de la Guía, con la aclaración visible de que pueden ocurrir simultáneamente y no son etapas rígidas, y la celda de la ficha pasó de «Etapa del ciclo» a «Componente del ciclo».

   **⚠ Obsoleto (2026-11-23, X1).** La Ruta de atención se retira de la ficha (item 96) y el vocabulario de los cinco componentes pasa a `/ayuda`: `ciclo.contenido.ts` se reutiliza allí, no se borra.

9. **✔ Hecho (2026-11-22).** (SPA `features/ayuda/ayuda.page.html` + `features/ayuda/ayuda.contenido.ts`: índice, búsqueda y fuente por sección) **Ayuda y criterios.** Reemplazaría el mensaje de una sola frase por una ayuda navegable que explique las categorías, los estados y cómo usar la pantalla; enlazaría cada definición a su sección de guía. Reutilizaría el mismo glosario del botón ⓘ para no duplicar textos.
10. **✔ Hecho (2026-11-22).** (SPA `features/resumen/resumen.page.html`: KPI con totales reales; sin «Señales de hoy», «Acuerdos a tiempo 78 %» ni «Intervenciones 18») **Resumen operativo: corregir cifras de demostración.** Verificaría la definición y fuente de “Señales de hoy” y retiraría “Acuerdos a tiempo 78 %” e “Intervenciones 18” de la interfaz hasta conectarlos a consultas reales: no se mantienen datos de demostración. No los presentaría como cifras institucionales sin una regla reproducible. **⚠ Superado en parte (2026-11-23).** El item 110 reorganiza estos KPI en tres dimensiones —prevención, gestión y seguimiento—; lo que este item cierra (retirar cifras de demostración) sigue vigente y se conserva.

**Ampliación 2026-11-22 (items 63–87).** Los items 63 a 87 recogen la automatización de los procesos que la Guía describe como manuales y los huecos de interfaz que aparecen al contrastarla con la SPA. Conservan la numeración 1–62 intacta porque este documento se cita por número de item, y por eso se numeran al final aunque se ubiquen en el tramo de dificultad que les corresponde. El orden dentro de cada tramo responde a dependencia, no a calendario.

63. **✔ Hecho (2026-11-22).** (`layouts/shell/shell.component.html`) **Shell: retirar el control muerto «Gestión territorial».** `layouts/shell/shell.component.html` tenía un `<button>` sin `routerLink` ni acción que no llevaba a ninguna parte y competía con la navegación real. Se retiró; después se eliminó también el bloque «Mapa territorial · Aplazado», que era el último resto: la barra lateral tiene ahora una sola entrada de territorio, **«Panorama territorial»**, ya navegable a `/mapa`, que además es la pantalla de entrada. No hubo cambio de datos ni de permisos.
64. **✔ Hecho (2026-11-22).** (`core/atajos/atajos.service.ts`, que escucha `document:keydown` y lo instala `layouts/shell/shell.component.ts` en su constructor; hoja de atajos en `features/ayuda/ayuda.contenido.ts`) **Accesos directos de teclado.** Añadiría `Ctrl/⌘+K` para abrir la búsqueda global desde cualquier vista y `/` para enfocar el buscador de la lista activa, con una hoja de atajos accesible desde Ayuda. Ambos atajos funcionan desde el shell; `/` enfoca el buscador de la vista activa y, si no hay ninguno, cae en la búsqueda global. No incluye el cierre de drawers: ese comportamiento ya pertenece al item 28 y no se repite aquí.

## D2 · Componentes, formularios e interacción

11. **◐ Parcial (2026-11-22).** **Nivel de riesgo en la ficha.** Lo mostraría a la derecha como atributo del caso —no de la alerta—, con acción para recalcularlo desde la ficha. Usaría Bajo, Moderado o Alto; si el caso no está activo, presentaría el nivel inactivo en gris. Mantendría la matriz del caso como fuente de cálculo y aclararía cuál valor se está mostrando. Falta: la acción para recalcularlo desde la ficha y el nivel inactivo en gris; hoy el riesgo del caso se muestra a la derecha como insignia y se marca como calculado en su ficha, pero no hay recálculo. **Hecho (2026-11-22):** la insignia pasa a gris cuando el caso no está abierto (`Resuelto`, `Archivado` o anulado) y se añadió la nota de que el valor proviene de la matriz del caso. El recálculo sigue bloqueado: exige la regla del servidor y `GET /api/v1/cases/{codigo}` no expone un endpoint para él.
12. **◐ Parcial (2026-11-22).** **Ficha: tabla de actores.** Cambiaría la lista actual por Apellidos | Nombres | Correo, con teléfono/móvil y correo opcionales. En cada actor mostraría etiquetas de tipo (Actor social, Actor público, Actor privado), función (Principal, Secundario, Tercero imparcial) y posicionamiento (Dialogante, Legitimante, Conflictivo). La tabla quedaría preparada para enlazarse al directorio existente. Falta: separar Apellidos | Nombres, el teléfono/móvil, el enlace al directorio y el alta desde la tabla; la columna Correo y las etiquetas de tipo, función y posicionamiento ya se muestran (Actor | Correo | Tipo | Función | Posicionamiento). **Hecho (2026-11-22):** el nombre enlaza a `/directorio/actores?q=…`. Sigue bloqueado separar apellidos y nombres porque el SQL de `lib/db/repos/cases.ts` devuelve `null::text` en ambos campos, y el teléfono porque `CaseActor` no lo selecciona: no se parten nombres por heurística.
13. **✔ Hecho (2026-11-22).** **Ficha: pestaña Demandas.** Conservaría la estructura interna Problema, Propuesta y Pedido (3P), pero agregaría formulario para crear y editar, estado de atención y vínculo directo al fragmento/documento que originó cada campo. Hoy se visualizan como lectura y una extracción aceptada no conserva toda esa trazabilidad. Falta: el fragmento o página dentro del documento de origen (item 61); la API ya tenía `POST`/`PATCH /api/v1/demandas`. **Hecho (2026-11-22):** alta y edición en panel lateral (`demanda-panel.component.*`) y vínculo al documento de origen: `lib/db/repos/cases.ts` devuelve `documento_origen_id`, `documento_origen_codigo` y `documento_origen_titulo` con `LEFT JOIN core.documentos doc ON doc.id = d.documento_origen_id`, y la ficha los pinta en la columna «Documento de origen» con enlace a `/documentos?q=<codigo>`. Lo que no existe todavía es el **fragmento o página** dentro de ese documento: exige la tabla de fragmentos del item 61 y no se simula.
14. **✔ Hecho (2026-11-22).** **Ficha: pestaña Cronología.** Ordenaría los eventos del más reciente al más antiguo y mostraría fecha, actor y acción. Añadiría el formulario de hecho con su evidencia y estados pendiente/validado; la validación humana quedaría como acción explícita, no implícita al registrar. **Hecho (2026-11-22):** la validación humana es una acción explícita por hecho —botones «Validar» y «Quitar validación» sobre `PATCH /v1/cases/{codigo}/events/{id}` con `{ validado }`—, la evidencia se edita en el panel (`evento-panel.component.*`) y el actor y el orden descendente ya se mostraban. La evidencia sigue siendo un enlace o referencia, no un archivo: el adjunto binario exige almacenamiento (item 61).
15. **◐ Parcial (2026-11-22).** **Ficha: pestaña Alertas.** Identificaría las alertas con los códigos/categorías AT, RR y PAR de la guía, preservando el enlace a la alerta original y su estado. **Hecho (2026-11-22):** la ficha muestra «Alertas vinculadas» con el código y el estado, y el código enlaza a `/alertas?q=…`; la categoría AT/RR/PAR no llega porque `CaseAlert` no la expone en el detalle.
16. **◐ Parcial (2026-11-22).** **Ficha: pestaña Compromisos.** Clasificaría cada registro como progresivo o parcial, entendimiento operativo o condicionado. Usaría los estados de compromiso Por iniciar, En proceso, Cumplido, Redefinido y Desestimado, y reservaría Paralizado para el estado de hito, separando ese estado del cálculo de vencimiento por fecha para no perder la alerta de plazo. Falta: la pestaña de compromisos en la ficha y la clasificación «progresivo o parcial / entendimiento operativo / condicionado»; los estados del compromiso y «Paralizado» como estado de hito sí existen en el módulo Compromisos.
17. **Ficha: documentación normativa.** Reemplazaría la tarjeta “Avance registrado” por una sección de Documentación normativa relacionada, con referencias, título, fecha y acceso al documento. No confundiría esa sección con los documentos de evidencia del caso. **⚠ Absorbido (2026-11-23).** La tarjeta «Avance registrado» se retiró con el item 1, así que la premisa de este item ya no existe, y la documentación normativa se resuelve en el bloque «Documentos del caso» del item 103. No se construye por separado.
18. **◐ Parcial (2026-11-22).** **Ficha: edición explícita.** Presentaría cada campo editable dentro de un recuadro con contenido centrado y comentario asociado cuando corresponda (por ejemplo, distrito). El clic fuera no cerraría ni cancelaría el formulario: solo los botones Cancelar y Guardar cambios finalizarían la edición. Aplicaría el mismo patrón a los drawers de edición pertinentes, incluidos la línea de tiempo y las alertas, donde la edición se abre en panel lateral en lugar de navegar a otra vista. Falta: la edición por campo en la ficha del caso; la cronología y las alertas ya se editan en panel lateral con Cancelar/Guardar.
19. **✔ Hecho (2026-11-22).** (`features/casos/proximo-paso.ts` + sección «Próximo paso» de la ficha) **Ficha: Próximo paso.** Sustituiría el texto genérico por una regla basada en el riesgo del caso y la Tabla 3 de la guía; por ejemplo, para riesgo Moderado, “Activar prevención y articulación intergubernamental”. Mostraría qué regla y qué valor de riesgo del caso originaron la recomendación.
20. **✔ Hecho (2026-11-22).** (SPA `features/casos/casos.page.ts|html`; `GET /api/v1/cases?conteos=true`) **Casos: listado.** Mantendría la cuadrícula existente y añadiría conmutador tabla/cuadrícula, orden por fecha/riesgo/prioridad, paginación en servidor y exportación —el endpoint ya existe (gap E5, cerrado) y el menú está en la cabecera de la lista—. Incorporaría filtros de estado, prioridad, alcance, temática y unidad además del filtro actual por riesgo, y una vista “Sin caso” para las demandas que aún no tienen caso vinculado, como vista dentro de Casos y no como ruta de primer nivel (ya cableada en `/casos/sin-caso` y enlazada desde la propia lista). Hecho (2026-11-22): los filtros de estado, prioridad, alcance, temática y unidad se resuelven en SQL y se validan contra catálogo (un valor inexistente devuelve `422 FILTRO_INVALIDO`), la vista los lleva a la URL y reinicia a página 1; el conmutador tabla/cuadrícula, el orden, la paginación en servidor, la exportación y la ruta «Sin caso» ya estaban. En la misma pasada se reordenó la barra —buscador, estado, prioridad, alcance, temática, unidad, orden—, el estado pasó de desplegable a **cuatro chips operativos con conteo** (`Todos · Abiertos · Resueltos · Archivados`). El catálogo tiene ahora tres valores (`Abierto · Resuelto · Archivado`, migración 33), así que los cuatro chips se corresponden uno a uno con la realidad del catálogo; `Abiertos` sigue filtrando por `es_activo` para que el indicador no dependa de la grafía del estado abierto. `GET /api/v1/cases?conteos=true` devuelve `{ todos, abiertos, resueltos, archivados }` en una sola consulta agregada que aplica los filtros vigentes —salvo `estado`/`abiertos`— y la RLS; cada chip lleva su número, se atenúa cuando es 0 pero sigue siendo clicable, y la exportación reenvía `abiertos` para no exportar un conjunto distinto del visible. La pestaña del registro pasó de «Activos · Anulados» a «Vigentes · Anulados». Las etiquetas se alinearon con la ficha: «Prioridad de atención», «Unidad responsable», «Ordenar por». La lista y la tabla muestran «Inicio» desde `fecha_inicio` (hallazgo 10). **Actualizado (2026-11-23):** el botón «Demandas sin caso» salió de la barra de Casos (item 93, X5); la ruta `/casos/sin-caso` sigue viva y se alcanza desde Bandeja, la búsqueda global y Resumen, ya no desde la propia lista.
21. **◐ Parcial (2026-11-22).** **Casos: formulario y selección territorial.** Incluiría Archivado en el formulario porque ya está en el tipo pero no en la interfaz. Reemplazaría territorio libre por un selector de distrito basado en ubigeo; validaría formato de código (CS-<PA|MI>-<INF|OAT|NOR|DBE|GOB|ITE>-<AAAA>-<NN>) y duplicados antes de guardar. **Hecho (2026-11-22):** alta de caso en panel lateral (`caso-panel.component.*`, `POST /v1/cases`) con título y regiones obligatorios y temática, subsector, riesgo, unidad responsable, resumen y fecha de inicio opcionales; el catálogo `regiones` se añadió a `/v1/catalogs` (`id`, `codigo`, `etiqueta`, `ubigeo`, `alcance_id`) y la vista previa del alcance replica `core.alcance_caso`. El formulario no pide código —lo emite `core.siguiente_codigo_caso()`— ni estado: `createCase` lo fija en servidor. Siguen bloqueados la deduplicación y la validación de formato del código en cliente, que dejó de tener sentido al generarlo el servidor. El **selector de distrito por ubigeo** dejó de estar bloqueado el 2026-11-23: la capa distrital trae los 1 892 ubigeos (item 128), así que falta cargarla, no conseguir el dataset. **Hecho (2026-11-23):** el selector ya está en el alta —ver «Catálogo territorial corregido y alta de caso por distrito»—, con los 1 891 distritos del INEI más los lugares operativos (Matarani entra como puerto de Islay).
22. **◐ Parcial (2026-11-22).** **Bandeja de trabajo.** Reemplazaría la concatenación actual de alertas, compromisos y casos de alto riesgo por una lista ordenada realmente por plazo, riesgo y revisión pendiente. Agregaría cuenta regresiva/SLA, filtro por tipo y vista del usuario; las acciones asignar, posponer y completar cambiarían estado con confirmación y quedarían registradas. Falta: la lista única ordenada por plazo/riesgo/revisión, el filtro por tipo, la vista del usuario y esas acciones; hoy son tres bloques con datos reales y SLA visible.
23. **◐ Parcial (2026-11-22).** **Alertas: controles de revisión.** Pediría confirmación al aprobar; permitiría volver a abrir una alerta descartada y deshacer una acción con permisos adecuados. Añadiría estados “Atendida” y visibilidad de la derivación, evitando que `derivacion` quede solo en los tipos de datos. Falta: confirmación al aprobar, reapertura de una alerta descartada, deshacer y visibilidad de `derivacion`; el estado «Atendida» ya está en el filtro y el flujo de cinco pasos se opera en panel lateral.
24. **◐ Parcial (2026-11-22).** **Compromisos: formulario y calendario.** Cambiaría la fecha de texto libre por selector de fecha y derivaría el estado según fechas y avance en vez de pedirlo como texto. La fecha de vencimiento se derivaría del próximo hito cuando no se ingrese a mano; si no hay hito, la interfaz abriría un popup para ingresarla. Añadiría los hitos en la ficha/formulario, clasificación formal/verbal, enlace al documento de origen y recordatorios; evidencias dejarían de ser solo un campo de texto y pasarían a archivos adjuntos. Falta: la clasificación formal/verbal, los recordatorios, los adjuntos (la evidencia es una URI) y el popup cuando no hay hito; el selector de fecha, el vencimiento derivado del próximo hito y el alta de hitos ya están. **Hecho (2026-11-22):** alta de compromiso completa desde la lista (`compromiso-panel.component.*` en modo alta, `POST /v1/commitments`): el caso se busca por código con `GET /v1/cases?q=` y el cuerpo no envía `estado`, que fija el servidor.
25. **◐ Parcial (2026-11-22).** **Compromisos: vistas de seguimiento.** Añadiría vista de calendario y desglose por responsable y nivel de gobierno. Incorporaría una exportación del Anexo 14 y reemplazaría la eliminación dura por anulación lógica con restauración, motivo e historial; la base y la API ya lo soportan (gap E2, cerrado), así que lo que falta es solo la interfaz. Falta: el desglose por responsable y nivel de gobierno y la exportación específica del Anexo 14; la vista de calendario ya está (conmutador Tabla · Calendario en la propia página), y la anulación con motivo obligatorio ya se ofrece en el panel del compromiso. **Hecho (2026-11-22):** el desglose por responsable y nivel de gobierno (`GORE`) está en el Resumen; la exportación del Anexo 14 sigue bloqueada porque `GET /api/v1/export` no acepta un parámetro de anexo ni existe ruta para `vw_anexo_14_seguimiento_compromisos`. **Restaurar ya es alcanzable**: el conmutador **Activos · Anulados** (`?ver=anulados`) lista la papelera con la fecha de anulación y un `Restaurar` por fila; la RLS se abre con `app.ver_anulados` (migración 26). El calendario se pinta vacío porque los 8 compromisos no tienen `fecha_vencimiento` y el único hito con fecha está `Cumplido`: es un hueco de datos, no de la vista.
26. **◐ Parcial (2026-11-22).** **Documentos: controles visibles.** Añadiría botón para validar o rechazar un documento y controles separados para validar cada fragmento. El filtro “Rechazado” tendría una acción que lo produzca. Permitiría relanzar extracción y consultar versiones anteriores. Falta: botones explícitos de validar/rechazar, la validación por fragmento, relanzar la extracción y consultar versiones; el estado se cambia con un selector y el filtro «Rechazado» ya existe. **Hecho (2026-11-22):** el selector se sustituyó por botones **Validar** / **Rechazar** con confirmación en línea, sobre `PATCH /v1/documents/{id}` con `{ estado }`; el filtro «Rechazado» ya tiene acción que lo produce. También hay **alta de documento** desde la lista (`documento-panel.component.*`, `POST /v1/documents`) con título y tipo obligatorios y metadatos más enlace: se registra la ficha, no se sube ningún archivo. Siguen bloqueados la validación por fragmento, la reextracción y las versiones: no hay rutas para ellas.
27. **◐ Parcial (2026-11-22).** **Mapa: controles de uso.** La pantalla ya existe como «Panorama territorial» (`features/mapa/`, ventana principal): ámbitos con conteo, regiones, enlace al listado y recorte por rol. El fondo cartográfico se recuperó como **teselas públicas de OpenStreetMap** declaradas referenciales (Leaflet, `TESELAS_OSM` en `mapa.page.ts`, rótulo «Mapa referencial · sin ubigeo distrital»), pero los puntos siguen siendo **círculos por región** sobre `centroides.regiones.ts`, no geometría propia. Falta lo que depende del dataset: leyenda, selección de capas, agrupación de puntos, límites ajustados a "Ver todos" y línea de tiempo de todos los eventos del caso. No se construye nada de eso mientras no exista ubigeo/centroide. **Hecho (2026-11-23):** «Ver casos» ya no abre un listado sin el recorte de la fila: la tabla de regiones envía `region` (nombre canónico de `core.regiones`), el ámbito vigente del mapa y `abiertos=true`, y la lista de Casos estrenó el selector **Región** (`?region=`, validado en servidor con `core.normalizar_ref`). Cuando no hay ámbito vigente se envía `alcance=todos` para que el listado no reaplique la preferencia guardada. Comprobado en base: la fila Piura (11) coincide con `region=Piura` (11) y los once nombres del panorama resuelven contra el catálogo. La fila **«Sin región»** no podía enlazarse con `region=`, porque no es una región del catálogo: se añadió su complemento `sinregion=true` en `GET /api/v1/cases` y en la exportación, y la fila del panorama envía ese criterio con el mismo ámbito y `abiertos=true`. El selector **Región** de Casos expone **Sin región** como una opción más (centinela `__sin_region__` que la barra traduce a `sinregion`, limpiando `region` para que nunca viajen juntos) y refleja el criterio cuando se llega desde el enlace. Hoy ese conjunto está vacío —los 34 casos abiertos tienen región principal—, así que la fila solo aparece cuando existan casos sin región; el listado lo declara con su estado vacío en lugar de estimarlo.
28. **◐ Parcial (2026-11-22).** **Preferencias y accesibilidad.** Ampliaría las preferencias que hoy cubren principalmente el tema con ámbito predeterminado, densidad y opciones de notificación. Auditaría todos los drawers y contraste; corregiría el drawer de preferencias con trampa de foco, Escape y retorno de foco al control que lo abrió. Guardaría las preferencias por usuario cuando exista perfil persistido, en vez de solo en el navegador. Falta: el ámbito predeterminado, las opciones de notificación, el tamaño de página (deshabilitado) y la persistencia por usuario; tema y densidad ya se guardan, hoy en el almacenamiento local. **Hecho (2026-11-22):** ámbito (`avisa-alcance`) y opciones de notificación (`avisa-notificaciones`) en `localStorage`; la lista de Casos aplica el ámbito como filtro inicial y las notificaciones aún no tienen consumidor. El tamaño de página y la persistencia por usuario siguen abiertos (item 47).
29. **Rango de fechas.** Mantendría 7/30/90 días y agregaría “Personalizado” con fecha inicial/final. Reutilizaría la misma selección en vistas y exportaciones para que el usuario no vea resultados distintos según la pantalla.
30. **◐ Parcial (2026-11-22).** **Búsqueda global.** Ampliaría los resultados actuales —que solo buscan casos— a alertas, actores, documentos y compromisos. Cada resultado mostraría tipo, código y territorio, y llevaría a su ficha; los límites territoriales y permisos también aplicarían a la búsqueda. Falta: que alertas, compromisos, documentos y actores abran su ficha (hoy abren el listado) y mostrar el territorio en cada resultado; la búsqueda ya cubre las seis entidades. **Hecho (2026-11-22):** seis grupos con cinco filas por grupo y «N sin mostrar», y cada resultado lleva a la ficha del caso o a la lista pre-filtrada `?q=` de su entidad, que es el detalle más profundo que hoy existe para esas cuatro entidades.
31. **◐ Parcial (2026-11-22).** **Centro de notificaciones.** Reemplazaría el punto fijo de la campana y el salto directo a alertas por una lista de notificaciones con estado leído, categoría, fecha y enlace al registro. El punto y el contador dependerían de notificaciones realmente pendientes; hoy `core.notificaciones` está vacía (no hay tráfico real) y la ruta no está cableada en la SPA. Falta: el enlace al registro concreto (hoy abre la sección), la acción de marcar como leída y el contador/punto de la campana; la pantalla con categoría, estado y fecha ya existe y está cableada. **Hecho (2026-11-22):** estado leído/no leído visible por fila, vacío explícito «Sin notificaciones registradas» y **el punto fijo de la campana se retiró**: no existe `PATCH /api/v1/notifications` ni conteo de pendientes, y un indicador sin dato sería falso. Marcar como leída y el contador exigen esos dos endpoints.
32. **◐ Parcial (2026-11-22).** **Estados de interfaz y pruebas.** Añadiría estados de carga, vacío, error y reintento a todas las vistas y límites de error para evitar una pantalla completa en blanco. Agregaría pruebas para formularios, filtros, permisos y transiciones de estado; incluiría una auditoría de teclado/contraste para los drawers restantes. Falta: las pruebas de formularios, filtros, permisos y transiciones (no hay archivos de prueba) y la auditoría de contraste; los estados de carga/vacío/error con reintento y los listeners globales de error ya están.
33. **Vistas parciales del mapa.** M_ACERVO, M_ZONA y M_MAPA siguen sin definir como modos separados: hoy hay una sola vista territorial (esquema por ámbito + tabla de regiones) y no se duplican componentes. Definir qué datos y capas comparte cada modo exige el dataset cartográfico.

**Ampliación 2026-11-22.** Estos items atacan el cuello de botella del registro: la API ya admite escritura (`POST` en `/api/v1/cases`, `alerts`, `demandas`, `commitments` y `documents`), pero la SPA solo ofrece «Registrar hecho» y «Añadir hito». Sin alta en contexto, cada registro obliga a cambiar de pantalla o a pedirlo fuera del sistema.

65. **Acción global «Registrar ▾».** Añadiría al shell un menú con Caso, Alerta, Demanda, Compromiso, Reunión y Documento que abra el formulario en panel lateral sin perder la vista de origen, con el tipo preseleccionado cuando se lanza desde una ficha (una demanda dentro de un caso, por ejemplo). Cada opción se mostraría solo si el rol tiene capacidad de escritura sobre esa entidad, con la misma comprobación en servidor. Depende de 66 para no reconstruir seis formularios y de 72 para la opción Reunión.
66. **Formularios derivados de contrato.** Sustituiría los formularios escritos a mano por un descriptor por entidad —campos, catálogo, obligatoriedad, validación y texto de ayuda— que genere el alta y la edición del panel lateral y que lea los catálogos de `/api/v1/catalogs` en lugar de duplicar listas. Un solo kit evita que seis formularios se desalineen del vocabulario congelado del glosario, y permite que la ayuda de campo del item 7 y la del item 9 salgan del mismo descriptor.
67. **✔ Hecho (2026-11-22).** (`features/casos/riel-relaciones.component.ts` + `enlacesRiel()` de la ficha; los conteos salen de `GET /api/v1/cases/{codigo}`, no de llamadas por sección) **Ficha: riel de relaciones.** Añadiría a la ficha del caso una columna lateral con alertas, compromisos, reuniones, documentos y demandas vinculadas, con contador y salto a la pestaña correspondiente. Complementa el item 41 —que crea las pestañas— sin repetirlo: el riel responde «qué tiene este caso» de un vistazo y la pestaña responde «cómo está en detalle».
68. **✔ Hecho (2026-11-22).** (`features/casos/expediente-completitud.component.ts` sobre el bloque `completitud` que ya devuelve `lib/db/repos/cases.ts`) **Expediente: indicador de completitud.** Mostraría cuánto del expediente está cubierto según el estado del caso —hechos, actores con tipo y función, demandas con 3P, geografía y marco situacional— con la lista de lo que falta y un enlace que abre el formulario de cada faltante. Se calcularía con datos ya persistidos y con la robustez que expone `analytics.vw_marco_situacional_robustez`; no inventaría una puntuación nueva ni la usaría para bloquear el registro, solo para orientar la revisión. **⚠ Sin superficie (2026-11-23).** El componente existe (`features/casos/expediente-completitud.component.ts`) pero ya no se pinta en ninguna plantilla: el item 97 lo sacó del expediente y no se movió a bandeja ni a dirección porque no hay endpoint agregado. Se mantiene «hecho en código, sin superficie», igual que el item 8.
69. **Tablas: patrón único y comportamiento responsive.** Unificaría las listas en un componente de tabla con columnas prioritarias, expansión por fila en pantallas estrechas, paginación en servidor y estados de carga, vacío y error propios. Los items 20 y 25 ya piden paginación y conmutador para Casos y Compromisos; lo que falta es que Alertas, Demandas sin caso, Documentos, Reportes y Directorio usen el mismo componente en lugar de tablas distintas por pantalla.
70. **✔ Hecho (2026-11-22).** (`app-exportar-menu` en Alertas y Compromisos, con los filtros activos en la petición) **Exportación homogénea en las listas operativas.** Añadiría a Casos, Alertas y Compromisos el menú de exportación que ya tiene el Directorio (item 43), reutilizando `GET /api/v1/export` y pasando los filtros, la búsqueda y el orden activos, con la misma regla de fechas del item 29. Evita el resultado incoherente de exportar el conjunto completo cuando la pantalla muestra un subconjunto.
71. **Aviso de duplicados al registrar.** Al guardar demanda, alerta, reunión o compromiso, compararía contra registros recientes del mismo caso o territorio y marcaría coincidencias antes de confirmar, ofreciendo vincular al existente en lugar de crear otro. El item 38 pide búsqueda de duplicados en alertas; esto extiende la misma regla a las demás altas en vez de repetirla por pantalla.

## D3 · Flujos con estado, trazabilidad y datos persistentes

34. **✔ Hecho (2026-11-22).** (SPA `angular/src/app/core/http/` sobre la API `app/api/v1/**` con `withSession` y persistencia en Postgres; repos en `lib/db/repos/`) **Capa de datos común.** Sustituiría gradualmente las listas y acciones en memoria de `AvisaProvider` (UI Next congelada) por una capa de servicios/API con persistencia real; la SPA Angular ya lee la API real a través de `angular/src/app/core/http/`. Usaría las tablas y relaciones del esquema AVISA V10 como referencia para casos, actores, alertas, cronología, demandas, documentos, compromisos e hitos; comprobaría el esquema conectado y las reglas de acceso antes de escribir consultas o migraciones. Así, crear, editar y revisar no se perdería al recargar ni quedaría limitado a una sesión.
35. **◐ Parcial (2026-11-22).** **Alcance territorial seguro.** Corregiría el caso de fallo abierto: una lista de regiones asignadas que no se pueda mapear no debe terminar como “Todo el Perú”. Para perfiles restringidos, cero coincidencias significa cero datos o mensaje de configuración; el alcance nacional debe concederse explícitamente por rol. El filtrado se aplicaría en servidor/consultas, no solo en el cliente. Falta: definir perfiles restringidos y el recorte real por región; `resolveDataScope` devuelve siempre `mode: "all"` y ninguna consulta filtra por región (decisión de producto vigente).
36. **◐ Parcial (2026-11-22).** **Normalización de regiones.** Reemplazaría el `includes` sobre texto libre por identificadores estables de región/distrito (ubigeo) y relaciones del modelo territorial. Normalizaría alias y acentos al ingresar/importar y aplicaría el mismo criterio a casos, alertas, compromisos, documentos y directorio. Falta: identificadores estables (ubigeo) y normalización de alias/tildes; `resolveRegions` en `lib/db/repos/cases.ts` casa por `lower(nombre)` exacto.
37. **◐ Parcial (2026-11-22).** **Estados, borrado e historial de casos.** Haría que Archivar sea una transición visible y no una ausencia del formulario. En lugar de borrar caso y relaciones en cascada, permitiría archivar/restaurar con motivo y registraría quién cambió estado, riesgo y conflictividad, aprovechando el historial contemplado en el esquema. La anulación lógica del caso desactivaría sus alertas: las alertas no se anulan mientras el caso exista y, si el caso se elimina, sus alertas se desactivan y no se muestran. La anulación es en cascada desde el caso y la restauración lo revierte; los endpoints ya existen (gap E2, cerrado), así que lo que falta es exponer la operación en la ficha. Falta: que Archivar sea una transición visible y la interfaz de anular/restaurar con motivo; la anulación lógica en cascada (caso → alertas) y la auditoría de cambios ya existen en la API y la base (`core.anular_caso`).
38. **◐ Parcial (2026-11-22).** **Alertas: vínculo y trazabilidad de revisión.** Permitiría vincular/cambiar caso relacionado, guardar quién revisó, cuándo y qué decisión tomó, y persistir el motivo de descarte. Añadiría búsqueda de duplicados, paginación en servidor, SLA/antigüedad y enlace al documento o URL de fuente; incorporaría carga de adjuntos y conciliación con el documento original antes de aprobar. Falta: el motivo de descarte, la búsqueda de duplicados, la carga de adjuntos y la conciliación con el documento original; cambiar de caso, SLA, paginación en servidor, enlace a la fuente y quién/cuándo revisó ya se muestran. **Hecho (2026-11-22):** alta de alerta desde la lista (`alerta-panel.component.*`, `POST /v1/alerts`) con título y prioridad obligatorios —la prioridad sale del catálogo con respaldo en el vocabulario congelado—; el `nivel` se omite porque `/v1/catalogs` no expone `cat_niveles_alerta`, y sigue editable sólo en la modificación.
39. **◐ Parcial (2026-11-22).** **Compromisos: estado calculado y auditoría.** Guardaría fechas como fechas reales y derivaría el plazo (vencido o por vencer) con una regla explícita, manteniendo separado el estado de gestión del compromiso (Por iniciar, En proceso, Cumplido, Redefinido, Desestimado); “Paralizado” sería un estado de hito, no sinónimo automático de vencido. Persistiría hitos, evidencia, responsables, nivel y fuente, con recordatorios e historial, en vez de borrar el registro. Falta: los recordatorios y el historial visible; las fechas reales, el plazo derivado, la separación del estado de hito («Paralizado»), los hitos, la evidencia, los responsables, el nivel y la fuente ya se persisten.
40. **◐ Parcial (2026-11-22).** **Ficha: actores y relaciones.** Agregaría/desvincularía actores desde la ficha y guardaría tipo, función y posicionamiento como relación del caso, no como nombres concatenados. Reutilizaría el catálogo de actores para mantener consistencia con el Directorio. Falta: el alta y la desvinculación de actores desde la ficha; tipo, función y posicionamiento ya se guardan como relación del caso y se leen del catálogo.
41. **Ficha: pestañas operativas faltantes.** Añadiría Reuniones, Productos/Envíos e Historial/Auditoría, conectadas a las tablas/relaciones del caso. El historial registraría usuario, fecha, operación y valores modificados; el flujo `ConflictResolutionJourney`, que hoy solo mueve un contador local, se convertiría en estado del caso persistente, con reglas de transición y permisos.
42. **◐ Parcial (2026-11-22).** **Exportación de caso y reportes.** Implementaría exportación real en PDF, Excel y JSON —la API ya exporta por entidad y por base (gap E5, cerrado)— para listados y ficha —el JSON sirve además para el respaldo de una entidad y de la base completa—, con impresión de ficha y hoja de estilos de impresión. Cada exportación respetaría permisos/ámbito/filtros, mostraría fecha y fuente, y se registraría en auditoría cuando descargue datos sensibles. Falta: que la exportación respete filtros/q/orden, la hoja de impresión de la ficha y el registro en auditoría de la descarga; JSON/Excel/PDF, la exportación por `id` y `entidad=base` ya existen, y la base completa ya se ofrece en el menú de exportación de la SPA. **Hecho (2026-11-22):** la lista de Casos reenvía filtros, búsqueda y orden a la exportación, y la ficha tiene botón **Imprimir / Guardar PDF** con `@media print`. El registro en auditoría de la descarga sigue bloqueado.
43. **◐ Parcial (2026-11-22).** **Exportación del directorio.** Añadiría exportación en PDF, Excel y JSON con los campos permitidos por rol; aplicaría las reglas de acceso a los datos de contacto y registraría la descarga cuando corresponda. Falta: el registro en auditoría de la descarga; el menú de exportación ya está en actores, organizaciones, instituciones y locales.
44. **◐ Parcial (2026-11-22).** **Directorio: CRUD y detalles.** Pasaría las seis filas sintéticas embebidas en `avisa-directory.tsx` a registros persistentes. Incorporaría detalle, alta, edición, fusión de duplicados y baja lógica, relaciones con casos/compromisos y enlaces desde las fichas. Falta: el alta, la edición, la fusión de duplicados y la baja lógica (la API de actores solo expone lectura) y los enlaces desde las fichas de caso; el detalle en panel lateral y las cuatro pantallas del directorio ya son persistentes.
45. **◐ Parcial (2026-11-22).** **Registro de actores y privacidad.** Permitiría registro con o sin DNI, membresía OSPA y contacto opcional, con validaciones y campos personales segregados/protegidos como plantea el esquema. Los perfiles autorizados (sectoristas, dirección OAIPCS y alta dirección) ven DNI y teléfonos, y la PII se pide bajo demanda con motivo, quedando auditada: el descifrado se habilita por rol y lo que cambian son las reglas de acceso; una consulta RENIEC se implementaría solo tras validar disponibilidad, base legal, consentimiento/permisos y la integración aprobada, sin convertirla en requisito del formulario. Falta: el registro de actores con o sin DNI, la membresía OSPA y el contacto opcional (no hay formulario ni `POST`); la PII bajo demanda con motivo auditado y el acceso por rol ya funcionan.
46. **◐ Parcial (2026-11-22).** **Resumen operativo y trazabilidad de cifras.** Cambiaría “Acuerdos a tiempo 78 %” e “Intervenciones 18” de constantes a agregaciones persistentes y acordadas; validaría la definición de “Señales de hoy”. Añadiría “última sincronización” global con hora real y estado de fuente, no el texto fijo “hace menos de 1 min”. Falta: la «última sincronización» global; las cifras del resumen ya son agregaciones reales y la sincronización solo aparece por organización en su ficha.
47. **Preferencias por usuario.** Persistiría tema, ámbito predeterminado, densidad y notificaciones en el perfil del usuario; eliminaría dependencia de preferencias guardadas solo en el navegador y evitaría compartir configuración entre cuentas.
48. **◐ Parcial (2026-11-22).** **Autenticación de operación.** Implementaría expiración/inactividad de sesión y cierre de sesión seguro. Añadiría segundo factor solo después de definir el proveedor y el flujo institucional; no lo simularía en cliente ni reutilizaría la clave demo como autenticación real. El login básico ya existe en el prototipo, así que V_LOGIN se trataría como parte de la app y se integraría en este flujo, no se duplicaría como pantalla nueva. Falta: la expiración por inactividad (la sesión caduca a las 8 h) y el segundo factor; el login real contra la base, la cookie HMAC httpOnly y el cierre de sesión ya existen.
49. **✔ Hecho (2026-11-22).** (API con `requireSession`/`withSession` y RLS `core.puede_editar()`/`puede_eliminar()` en `core.casos`, `core.alertas_tempranas`, `core.compromisos` y `core.documentos`; `migration/17_usuarios_y_privilegios.sql`) **Control de acceso por rol.** Aplicaría autorización en API para vistas/acciones y también por pestaña de ETL. Ocultar una pestaña en el cliente no es control de seguridad: cada acción y conjunto de datos tendría verificación del lado servidor.
50. **Bandeja individual y acciones.** Persistiría asignación, posposición, finalización, fechas límite y usuario responsable. Los contadores/SLA se calcularían desde esos datos, con historial para reasignaciones y reaperturas.

**Ampliación 2026-11-22.** La Guía produce cada anexo a partir de las mismas reuniones, demandas y acuerdos; hoy el sistema no captura reuniones y por eso el Anexo 16 tiene vista y cero filas. Estos items construyen ese sustrato antes de automatizar la redacción.

72. **Capa de reuniones y espacios de diálogo.** Construiría el flujo completo de `core.reuniones_dialogo` —fecha, espacio, caso, territorio, etapa y estado programada/realizada—, con asistentes y su rol, puntos de agenda y acuerdos; `GET/POST/PATCH /api/v1/reuniones` con su repo, que hoy no existe; y la pestaña del item 41 más la vista que alimenta `analytics.vw_anexo_16_registro_reuniones`. Es el sustrato de los items 73, 74 y 77: sin reunión no hay acta, relatoría ni compromiso que trazar. El catálogo `core.cat_tipos_reunion` se retiró en la migración 21 y el eje correcto es `programada`; no lo reintroduciría.
73. **Captura desde acta o relatoría.** Permitiría cargar el texto de un acta y proponer, campo a campo, asistentes, demandas con 3P, acuerdos y compromisos candidatos, cada uno con su cita al párrafo de origen. La especialista acepta, corrige o descarta; nada se guarda sin aceptación explícita y la cita queda enlazada al documento. Automatiza la transcripción de los Anexos 10, 12 y 13 sin reemplazar la redacción: el acta sigue siendo un documento humano.
74. **Extracción de compromisos desde acuerdos.** A partir de los acuerdos aceptados, propondría compromiso con responsable, nivel de gobierno, plazo, hito y evidencia, y lo daría de alta en Compromisos solo tras confirmación, reutilizando `POST /api/v1/commitments` y las reglas del item 24. El valor está en que el compromiso nazca con su fuente y no se transcriba dos veces.
75. **Generador de anexos con contrato.** Un endpoint `POST /api/v1/anexos/{n}` que arme cada producto desde las vistas y el expediente, con un esquema JSON por anexo como contrato de campos y una plantilla DOCX/PDF/XLSX. Salida marcada como borrador, con fecha de corte y trazabilidad a la consulta que la originó, y revisión humana obligatoria antes de cualquier envío. Renderiza los formatos que hoy solo existen en la Guía: 1 (matriz de demandas), 3 (alerta), 6 (plan de acción rápida), 10 (acta) y 12 (ayuda memoria); 4, 5, 8, 9 y 13 tienen item propio porque son espacios de trabajo, no documentos de plantilla. Depende de 66 y 72, y de la exportación del item 42.
76. **Bandeja RED-RADAR.** Añadiría una cola de señales tempranas con triage: agrupación por caso y territorio, prioridad por riesgo, descarte con motivo y botón «convertir en alerta» que precargue los seis bloques del Anexo 3. Reutiliza el alta de alertas (item 38) y el paso a caso; no crea un registro nuevo, porque la señal es una alerta en estado inicial.
77. **Asistente de relatoría.** Automatizaría solo la parte aritmética del Anexo 13: contar menciones por problemática, agrupar demandas asociadas, numerarlas y detectar las que quedaron sin respuesta. La sección analítica se propone como borrador editable y nunca se publica sin revisión. Depende de 72 y 73.
78. **Reportes de clima social (Anexos 4 y 5).** Generaría el texto de mensajería del período —resumen ejecutivo, actores, clima y hechos recientes, demandas locales— desde los datos del caso y del territorio, con edición previa al envío y registro en el Anexo 17. Se separa del item 75 porque estos dos anexos se escriben para enviarse por mensajería: la salida es texto plano con marcas, no un documento.

## D4 · Módulos de análisis, mapas y operación integrada

51. **Biblioteca de gráficos y dashboard analítico.** Incorporaría una biblioteca de gráficos accesible (por ejemplo, Recharts mediante los componentes de gráficos del proyecto) y reemplazaría barras CSS cuando representen series/indicadores. Construiría T_COMP y T_ALTA_DET como vistas del módulo Analítico; T_ALTA_EST como vista Estratégica; además T_ESTANC, T_PANO, T_ALERTAS_EST y T_CLIMA. Cada gráfico tendría definición de métrica, filtros, consulta real, fuente/fecha y estado vacío; no se graficarían cifras fijas.
52. **◐ Parcial (2026-11-22).** **Resumen de Dirección.** Crearía las variantes requeridas a partir de un mismo conjunto de métricas y agregaciones, añadiendo desglose regional. Retiraría cifras cableadas y mostraría la fuente como referencia atribuible/enlazable, no como una cita suelta que parezca una conclusión estadística. Añadiría hoja de impresión probada en lugar de depender únicamente de `window.print()`. Falta: las variantes del módulo; la fuente citada, los datos reales, la exportación y la hoja de impresión (`@media print` en `styles/global.css`) ya están. **Hecho (2026-11-23):** el **desglose regional** ya está en la pantalla. `features/direccion/desglose-regiones.service.ts` lee el catálogo de `GET /api/v1/catalogs` y pide **sólo el `total`** de cada región (`pagina=1&tamano=1&region=<nombre>`), más `sinregion=true` para los casos sin región principal: no se traen filas y no se inventa un `/dashboard`. Cada fila de la tarjeta enlaza al listado de Casos con `region` (o `sinregion`) y `alcance=todos`, para que el número de la fila y el del listado coincidan. Si una consulta falla, la tarjeta no publica un desglose parcial: el error se declara.
53. **◐ Parcial (2026-11-22).** **Mapa con datos de casos.** «Panorama territorial» ya distribuye los casos reales por ámbito y región, con filtro en servidor (`alcance`) y recorte por rol, y resuelve el fallback tabular previsto para cuando no haya cartografía. Sobre esa base se añadió el **fondo de teselas OpenStreetMap** (referencial, sin geometría propia) para dar contexto geográfico a los círculos por región. Los **límites distritales** dejaron de estar aplazados el 2026-11-23 (capa de 1 892 polígonos, items 128–129); lo que sigue aplazado es la capa temática, la agrupación de puntos, el filtro temporal sobre el mapa y las teselas sin conexión. La pantalla de coordenadas se puede documentar en cuanto se cargue la capa.
54. **Módulos 2027.** Incorporaría M_RED y M_SIM como rutas nuevas del `WorkspaceView`, con componentes independientes, navegación y permisos propios. Antes de construir sus visualizaciones, definiría qué tablas/indicadores y filtros de 2027 consumen para no reutilizar datos de demo como si fueran históricos reales.
55. **V_ENVIOS y V_AUDITORIA.** Añadiría vistas de envíos/productos con destinatario, versión, estado, acuse y enlace al caso; y una auditoría consultable con actor, acción, fecha, objeto y cambios, filtro por usuario/periodo y permisos. Usaría la auditoría ya planteada en otras áreas como una única fuente, no registros locales independientes.
56. **V_ADMIN.** Agregaría administración protegida para catálogos, unidades, roles, parámetros y usuarios, con cambios auditados y validaciones de integridad. No expondría una interfaz de edición de tablas genérica ni permitiría al perfil operativo cambiar roles.
57. **◐ Parcial (2026-11-22).** **Series temporales y sincronización.** Para dashboards y bandeja, registraría tiempos y estados necesarios para tendencias, SLA, aging y “última sincronización”. Definiría zona horaria y el tratamiento de datos ausentes para evitar que los dashboards den por completa una carga parcial. Falta: tendencias, aging, «última sincronización» global y el tratamiento de zona horaria/datos ausentes; el SLA y las fechas ya se calculan en alertas y compromisos.

**Ampliación 2026-11-22.** Estos items convierten la información ya capturada en el marco situacional y en la memoria institucional que exige el capítulo 8.4 de la Guía, sin sustituir el juicio técnico.

79. **Motor de triangulación.** Implementaría el proceso de §7.7.2 como método y no como pantalla libre: matriz de contraste por dimensión interpretativa, con saturación —cuántas fuentes independientes sostienen cada afirmación— y estado de validación por dato, sobre `qda.segmento` y `kag.documento_fragmento`. Produciría el marco situacional del caso y su robustez, que `analytics.vw_marco_situacional_robustez` ya expone. Sin esto, el indicador del item 68 mide forma pero no calidad.
80. **Recurrencia y reforma normativa.** Agruparía demandas y temáticas entre casos y territorios para detectar patrones recurrentes —el insumo de §8.1.1.4— y separaría lo que es un problema de gestión local de lo que es una norma que hay que cambiar. La salida es un listado priorizado de temas recurrentes con casos de respaldo, no una recomendación automática de reforma.
81. **Casos análogos y memoria institucional.** Indexaría expedientes cerrados, anexos aprobados y lecciones aprendidas para recuperación semántica con cita obligatoria al expediente de origen. Responde «¿qué hicimos en un caso parecido?» sin depender de que alguien recuerde dónde lo leyó. Depende de 82 para tener corpus y debe respetar el ámbito territorial del item 35, incluida la PII segregada del item 45.
82. **Captura de lecciones aprendidas.** Al cerrar un caso, un formulario guiado registraría qué funcionó, qué no, qué condición cambió y qué se haría distinto, con campos derivados de la trayectoria real del expediente. Se publicaría al repositorio del item 81 y alimentaría la ayuda del item 9 con criterios verificados, no con anécdotas.
83. **Workspace de análisis de caso (Anexo 8).** Convertiría el análisis en un espacio de trabajo sobre el expediente: mapa de actores con posición, interés, necesidad y capacidad; causas por profundidad —estructural, proceso en curso o detonante—; geografía; estado y recomendaciones. Usaría el riel del item 67 y las relaciones ya persistidas; el análisis no es un documento aparte, es una proyección del caso.
84. **Argumentario institucional (Anexo 9).** Añadiría la matriz de preguntas críticas previsibles con respuesta, evidencia de respaldo y tono recomendado, ligada al expediente y a los riesgos identificados. Las respuestas se propondrían desde el propio expediente y quedarían marcadas como borrador hasta que la OAIPCS las apruebe, porque el argumentario no puede contradecir un dato del caso.
85. **Panel de operación OAIPCS.** Mostraría carga por especialista, casos por nivel y riesgo, compromisos vencidos, señales sin triage, cobertura regional y tiempo de primera respuesta. No repite el item 52 —que es el resumen de Dirección con sus variantes— porque aquí la unidad de análisis es la cola de trabajo y la capacidad del equipo, no el panorama institucional.

## D5 · ETL real, documentos pesados e integraciones sensibles

58. **V_ETL: módulo de tres pestañas.** Añadiría una vista ETL con pestañas de Ejecución, Fuentes e Historial (nombres ajustables a la terminología institucional). La pestaña de ejecución tendría selector de fuente y lector real de CSV, XLSX, TXT y texto de PDF; validaría extensión, MIME, tamaño y codificación, calcularía hash y deduplicaría antes de iniciar el pipeline. XLSX/PDF requerirían procesadores apropiados; no trataría la lectura de texto como OCR.
59. **V_ETL: pipeline observable.** Mostraría un stepper con estado en vivo y contadores por etapa, panel de tablas alimentadas con filas antes/después, tabla de rechazos/errores con motivo y opción de descargar errores, y tarjeta de conciliación que compruebe `cargados + fusionados + descartados + pendientes = registros fuente`. Persistiría ejecuciones, duración, costos/metadatos y reintentos para dejar un run log consultable.
60. **V_ETL: fuentes y permisos.** Añadiría el feed WhatsApp/Gemini cuando exista la integración, con el timestamp de la sincronización real; no se muestran registros simulados, porque la interfaz enseña datos reales. La interfaz y API separarían acceso por rol en cada pestaña; cuando se conecten fuentes reales, se gestionaría autorización/credenciales del lado servidor, no en el navegador.
61. **Lectura, OCR y trazabilidad documental.** Pasaría de guardar solo el nombre del archivo a almacenamiento de archivo más metadatos/hash, límites de tamaño/tipo, carga por lotes y extracción con versiones. Guardaría página/offset de cada fragmento y permitiría abrir el original en esa ubicación; compararía la cita literal propuesta con el texto fuente antes de aprobarla. OCR se incorporaría como etapa separada para PDFs escaneados, con idioma/confianza, costo, fallos y revisión humana.
62. **Documentos: fuentes permitidas y ejecución.** Implementaría la lista blanca de fuentes con control de cambios, el log de ejecuciones con duración/costo, reejecución versionada y vínculo bidireccional entre una propuesta aceptada y el registro que produjo. Mantendría el archivo y la propuesta originales para explicar qué versión sustentó cada alerta, compromiso, demanda o actor.

**Ampliación 2026-11-22.** El último tramo no añade pantallas: añade el gobierno de lo que producen las anteriores.

86. **Generación documental por lote.** Un job que produzca todos los anexos de un período y ámbito —por región, por caso o por mes— con run log, reintentos, versión y conciliación de `generados + omitidos + fallidos = solicitados`, reutilizando el stepper y el contrato del item 59. Necesita el generador del item 75 estable primero: en lote, un anexo mal formado se multiplica.
87. **Gobierno de las sugerencias asistidas.** Registraría cada propuesta automática y su resultado humano en `agent.run_log`, `feedback_log` y `lessons_learned`, con aceptación medida por tipo de sugerencia —demanda, compromiso, actor, alerta— y un conjunto de casos de regresión antes de cambiar prompt o modelo. Sin esto, la automatización de los items 73–78 no se puede auditar ni mejorar, y una regresión pasaría inadvertida.

## Estado de cumplimiento (2026-11-22)

| Bloque            | Hechos | Parciales | Pendientes | Absorbidos |
| ----------------- | -----: | --------: | ---------: | ---------: |
| D1 (1–10, 63–64)  |     12 |         0 |          0 |          0 |
| D2 (11–33, 65–71) |      7 |        16 |          6 |          1 |
| D3 (34–50, 72–78) |      2 |        12 |         10 |          0 |
| D4 (51–57, 79–85) |      0 |         3 |         11 |          0 |
| D5 (58–62, 86–87) |      0 |         0 |          7 |          0 |
| **TOTAL**         | **21** |    **31** |     **34** |      **1** |

De los 87 items del catálogo, 21 están cerrados (HECHO), 31 tienen avance parcial, 34 siguen pendientes y 1 queda absorbido por otro item (el 17, que se resuelve en el 103). Los items 63–87 se añadieron en la misma fecha al contrastar la Guía con la interfaz y no formaban parte del recuento anterior de 62. La pasada del 2026-11-22 cerró el item 13 (vínculo al documento de origen de la demanda) y el 14 (validación humana como acción), y abrió el 21 como parcial al añadir el alta de caso.

Este recuento cubre sólo los items 1–87. El tramo **88–131 («Ampliación 2026-11-23»)** se contabiliza aparte, al final del documento, porque nace de las observaciones del equipo y de la dirección. Estado al 2026-11-23 tras la primera pasada de implementación: de sus 44 items, **21 están hechos**, **2 son parciales** (98 y 99: la interfaz está, falta el dato), **8 son solo mockup** (103, 110, 114, 116, 119, 124, 126, 127), **4 requieren una columna o permiso que hoy no existen** (105, 120, 122, 123), **1 requiere cargar `legacy.dim_redaccion`** (117), **1 está bloqueado** por el modelo de permisos (113), **1 no procede** por decisión de producto (90) y **2 siguen en la cola de implementación** (111, y 121 en su parte de OSPA y caletas). Los items **128–131** se suman el 2026-11-23 con la capa distrital: **1 requiere carga** (128), **129 se puede dibujar ya con geometría real**, **130 sólo después de 128** —dibuja los polígonos que esa carga crea— y **131 requiere una decisión**, porque la población no calibra el riesgo. El detalle, con lo que quedó fuera de cada pieza, está en «Cierre del lote A» y en «Capa distrital censal».

**Cobertura de los anexos de la Guía.** El catálogo mezclaba pantallas con productos documentales, así que conviene fijar qué anexo ya tiene superficie y cuál no, para no construir dos veces lo mismo:

- **Con vista de datos:** 2 (`analytics.vw_anexo_02_panorama_regional`, item 52), 14 (`vw_anexo_14_seguimiento_compromisos`, item 25), 15 (`vw_anexo_15_matriz_conflictividad`) y 17 (`vw_anexo_17_registro_reportes`, gap E4 cerrado). El 16 (`vw_anexo_16_registro_reuniones`) tiene vista pero cero filas porque no existe captura: por eso el item 72 no es cosmético.
- **Con generación desde el expediente:** 1 (item 13 para captura, 75 para la matriz), 3 (76 y 75), 4 y 5 (78), 6 y 12 (75), 8 (83), 9 (84), 10 (73 y 75) y 13 (77).
- **Fuera de este catálogo:** cualquier otro formato de la Guía queda pendiente de que se defina su alcance operativo. No se documenta una pantalla sin esa decisión de producto.

## Entrega: implementable ahora frente a solo mockup

**Criterio.** Una pieza se implementa directamente en la SPA solo si se cumplen tres condiciones:
(a) el dato ya está persistido y la API lo expone; (b) la regla está decidida —o es literal en la
Guía— y no hay que inventarla; (c) no exige almacenamiento nuevo (archivos, OCR), una integración
externa ni un cambio de esquema. Cuando falla una, la pantalla se entrega como **mockup** con su
contrato de datos y el equipo que la construya pone la lógica interna. El objetivo del mockup no es
adivinar el backend: es fijar qué ve el usuario y qué dato necesita cada celda para que la
implementación no invente ni uno ni otro.

### A · Implementable ahora (de menor a mayor esfuerzo, con estado)

| #   | Cambio                                                                    | Estado                                                                                                                               |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 70  | Exportar en Alertas y Compromisos con los filtros activos                 | ✔ Hecho. `app-exportar-menu` montado en ambas listas.                                                                                |
| 30  | Búsqueda global: abrir la ficha de cada resultado y mostrar el territorio | ◐ Parcial. Seis grupos y enlace a ficha de caso o lista pre-filtrada `?q=`; las otras entidades no tienen ficha ni campo territorio. |
| 25  | Compromisos: desglose por responsable y nivel de gobierno                 | ✔ Hecho el desglose (Resumen). El Anexo 14 sigue bloqueado (no hay ruta de exportación por anexo).                                   |
| 42  | Exportación con filtros/q/orden y hoja de impresión de la ficha           | ◐ Parcial. Filtros y hoja de impresión hechos; falta el registro en auditoría de la descarga.                                        |
| 69  | Tabla única para las seis listas                                          | ◻ Pendiente por decisión: refactor sin ganancia visual, colisiona con el resto de la pasada.                                         |
| 13  | Alta y edición de demandas desde la ficha                                 | ✔ Hecho. Panel de alta/edición y columna «Documento de origen»; el fragmento/página queda en el item 61.                             |
| 28  | Preferencias: ámbito predeterminado y opciones de notificación            | ✔ Hecho en `localStorage`. El perfil persistido es el item 47.                                                                       |
| 15  | Ficha: alertas vinculadas con código y estado                             | ◐ Parcial. Código y estado hechos; falta la categoría AT/RR/PAR.                                                                     |
| 26  | Documentos: validar o rechazar con acción visible                         | ◐ Parcial. Botones por documento hechos; faltan fragmentos, reextracción y versiones.                                                |
| 11  | Riesgo del caso inactivo en gris y origen del valor                       | ◐ Parcial. Hecho el gris y la nota; el recálculo exige regla del servidor.                                                           |
| 12  | Ficha: actores con enlace al directorio                                   | ◐ Parcial. Enlace hecho; apellidos/nombres y teléfono no llegan por API.                                                             |
| 31  | Centro de notificaciones: leído, enlace y contador                        | ◐ Parcial. Leído/no leído y vacío hechos; el punto fijo se retiró; faltan `PATCH` y conteo.                                          |

Ninguno de estos doce mueve el modelo ni introduce una regla institucional. Los cerrados del
listado (70, 25 y 28) se implementaron el 2026-11-22; los parciales dejan anotado el endpoint o
la columna exacta que falta, y el 69 sigue pendiente a propósito porque es refactor sin efecto
visible.

**Altas en contexto (2026-11-22).** Cuatro items del tramo D2 dejaron de ser sólo lectura en esta
pasada, sin salir del criterio: **alta de caso** (item 21, `POST /v1/cases` + `regiones` en
`/v1/catalogs`), **alta de alerta** (item 38, título y prioridad), **alta de compromiso** (item 24,
`accion` más caso buscado por `q`) y **alta de documento** (item 26, metadatos y enlace, sin
binarios). Las cuatro abren panel lateral con el patrón canónico —Escape, fondo, foco encerrado y
devuelto— y verifican la capacidad de escritura en cliente y en servidor. Ninguna envía estado: lo
fija la API.

### B · Solo mockup (de menor a mayor complejidad)

| #   | Pieza                                  | Items             | Mockup                                |
| --- | -------------------------------------- | ----------------- | ------------------------------------- |
| 1   | Anexo 15 · matriz de conflictividad    | vista 15 · 42, 75 | `anexo-15-matriz-conflictividad.html` |
| 2   | Ficha por pestañas                     | 12–18, 41, 67, 68 | `ficha-pestanas.html`                 |
| 3   | Registrar ▾ en el shell                | 65, 66, 72        | `registrar-menu.html`                 |
| 4   | Bandeja única con SLA y acciones       | 22, 50, 111       | `bandeja-unificada.html`              |
| 5   | RED/RADAR, notificaciones y derivación | 76, 31, 23        | `bandeja-red-radar.html`              |
| 6   | Dashboard analítico                    | 51, 52, 57, 85    | `dashboard-analitico.html`            |
| 7   | Directorio CRUD y PII bajo demanda     | 43, 44, 45, 71    | `directorio-crud.html`                |
| 8   | ETL de tres pestañas                   | 58–62, 86, 87     | `etl-tres-pestanas.html`              |

Fuera de los mockups: **72–78** (reuniones, captura de actas, generador de anexos, relatoría, clima
social) dependen de la capa de reuniones, que no tiene tabla ni endpoint, y **79–84** (triangulación,
recurrencia, memoria institucional, argumentario) son capacidad analítica, no pantalla. Dibujarlos
sería fijar una forma sin saber qué la alimenta.

**Inventario frente a prioridad (2026-11-23).** Los ocho archivos de la ola 1 siguen siendo ocho, pero
dos absorben items de la ampliación y no se dibujan de nuevo: `ficha-pestanas.html` incorpora 95 y 102;
`bandeja-unificada.html` cubre 22 y 50 y es la pieza 111–112; `directorio-crud.html` es la 108. El 103
**no** estaba en `ficha-pestanas.html` —no tiene «Reportes de monitoreo» ni «Documentos del caso»—, así
que se dibuja aparte en `ficha-reportes-monitoreo-documentos.html`, junto con
`mapa-activos-radar-dpa.html` (125–127 y la capa del 128). El 110 ya está cubierto por
`resumen-operativo.html`, que sí trae las tres dimensiones: no se dibuja dos veces. Los artboards
que faltan se listan en «Prioridad visual unificada · mockups para Figma y para el equipo .NET».

### C · Aplazado por decisión de producto (no llevarlo a mockup)

**Se construyó la vista territorial y, desde el 2026-11-23, existe la geometría distrital.** 27, 33 y 53 tienen ya una superficie real con datos persistidos. Lo que estaba aplazado era la geometría: ubigeo, centroides y límites distritales. La capa `gis/Poblacion Censo 2025 geogpsperu/` trae **1 892 polígonos distritales** con `UBIGEO` INEI (196 provincias, 25 departamentos), así que el límite distrital deja de estar aplazado: los items 21, 27, 33, 35–36 y 53 quedan **desbloqueados para construir**, no construidos. Siguen aplazados 54 (módulos 2027) y las **capas temáticas y la agrupación de puntos**, que necesitan decisión de diseño además de dato. Falta cargar la capa y validarla (ver «Capa distrital censal»).

**El fondo OpenStreetMap se mantiene (decisión de producto, 2026-11-22).** «Panorama territorial»
conserva las teselas públicas de OSM como contexto referencial —sin geometría propia y con el rótulo
«Mapa referencial · sin ubigeo distrital»— porque un mapa vacío se lee como una función averiada,
mientras que un fondo real con círculos por región se lee como lo que es: cobertura aproximada a la
espera del ubigeo. No se retira: se mantiene debajo y por encima se dibuja la capa distrital, que ya existe como archivo y todavía no está cargada.

### Prioridad visual de los mockups

El orden de dibujo no se decide aquí. Hay una sola lista —**«Prioridad visual unificada · mockups
para Figma y para el equipo .NET»**, al final del documento— porque este apartado y el de la
ampliación ordenaban las mismas piezas con dos criterios distintos y dibujaban tres pantallas dos
veces (ficha, bandeja, directorio). El criterio único es **impacto visual por unidad de esfuerzo de
dibujo**, no esfuerzo de implementación.

Los archivos están en `docs/07_frontend/mockups/`, con su índice en
`docs/07_frontend/mockups/index.html`. Cada mockup declara arriba qué items cubre, qué dato necesita y
qué parte es solo forma; ninguno se integra al build de la SPA.

## Pendientes heredados de la base, la carga y el glosario (2026-11-22)

El catálogo de arriba dice **qué construir en la SPA**. Esta sección dice **qué sigue abierto en los datos, en las reglas y en los artefactos**, con la acción concreta y el efecto que tiene sobre la interfaz. No es una segunda lista de pantallas: cada pendiente se resuelve fuera del frontend, pero mientras siga abierto condiciona lo que la SPA puede mostrar sin inventar. Los defectos de redacción y de artefacto generado no se repiten aquí: se detallan en «Hallazgos» y en §3 solo figura su acción de cierre.

### 1 · Datos que esperan una decisión de OAIPCS

Ninguno bloquea la carga; todos entraron marcados y revisables, y por eso la interfaz debe mostrarlos como faltantes en lugar de estimarlos.

| #   | Pendiente                                   | Alcance                                        | Acción                                                                                                                      | Efecto en la interfaz                                                        |
| --- | ------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P1  | 45 grupos de DNI compartido                 | 100 filas de 642                               | Revisar `core.migracion_conflicto` (`DNI_DUPLICADO`) y fusionar solo los que sean la misma persona                          | El directorio muestra como dos personas lo que puede ser una (items 12 y 44) |
| P2  | Actores sin organización                    | 368 referencias                                | Completar `legacy.dim_actores.id_organizacion`                                                                              | El riel y el mapa de actores subestiman la representación (items 67 y 83)    |
| P3  | `base_legal` de los datos personales        | 642 DNI, 606 teléfonos, 141 correos            | Sustituir `LEGADO_AVISA_2026` por la base legal formal (Ley 29733)                                                          | Mientras siga así, la PII no se expone fuera de `administrador` (item 45)    |
| P4  | 12 demandas con padre de serie anterior     | `CS-2026-xx`                                   | Decidir si se mapean a un caso real                                                                                         | Aparecen en «Sin caso» aunque su código mencione un caso                     |
| P5  | Alertas inexistentes y vínculos descartados | 9 + 14                                         | Confirmar que `AT-2026-19/27/29/31/33/34/35/39` no existen                                                                  | Esos vínculos no aparecen en la cronología ni en la ficha                    |
| P6  | Casos ausentes                              | `CS-PRODUCE-2026-037` y `038`                  | Crearlos o descartarlos                                                                                                     | Dos instancias de proceso quedan con código legado y sin `caso_id`           |
| P7  | Bloque `PR-001..PR-018` sin maestro         | 18 reportes                                    | Definir maestro de reportes o aceptar enlace blando                                                                         | El Anexo 17 muestra el código sin padre al que apuntar                       |
| P8  | `DEST-01` no es usuario                     | 6 filas                                        | Confirmar si es buzón colectivo y modelarlo como tal                                                                        | El responsable aparece como código en lugar de persona                       |
| P9  | Datos maestros menores                      | 3                                              | Ratificar unidad `OAIPCS`, descripción de `TEMA-03` y taxonomía `Sphyrna zygaena` / `lewini`                                | Etiquetas sin descripción o con nombre dudoso                                |
| P10 | Cobertura de distritos                      | 698 de 1 874 en la base; 1 892 en el shapefile | ✔ Resuelto en origen: `gis/Poblacion Censo 2025 geogpsperu/` trae **1 892 distritos** con UBIGEO; falta cargarlo (item 128) | El selector territorial podrá ofrecer todos los distritos (items 21 y 36)    |

Regla común: **el dato ausente se declara, no se estima.** El indicador de completitud (item 68) es el lugar donde eso se ve; ninguna pantalla debe rellenar un hueco con un valor verosímil.

**Refinado (2026-11-22).** «Demandas sin caso» pasó de **226 a 107** filas tras la
migración 37 y el hallazgo 14. De las 226, **119 sí tenían caso**: su alerta ya apuntaba a
uno y la carga no lo heredó. Las 107 restantes no lo tienen en ninguna fuente y se declaran:
**81** con alerta sin caso (por ejemplo `AT-2026-82/83`, hechos de 2022 que en el Excel no
tienen `ID_Caso_Vinculado`) y **26** sin alerta. Las 12 de P4 siguen dentro de ese grupo y no
se mapean.

### 2 · Reglas que la interfaz no puede inventar

**Prioridad de atención.** La Guía la lista como columna 10 del Anexo 15 (§8.3.1) pero no define cómo se calcula. Derivarla de la conflictividad o del riesgo sería inventar una regla institucional. Acción: pedir la regla a OAIPCS y, hasta entonces, mostrar el valor almacenado marcado como «sin regla definida» en la ficha y en la bandeja (items 5 y 22).

**Riesgo del caso.** La carga del legado usó una regla explícita y en orden: dato directo → alertas vinculadas → prioridad del caso → nulo. La SPA no debe recalcular con otra fórmula ni promediar señales; si se implementa el recálculo del item 11, debe invocar esa misma regla en servidor en lugar de reimplementarla en el cliente.

**Alertas históricas.** Las 83 alertas con `estado_legado = 'Archivado'` se documentan como `Atendidas` por decisión tomada, pero la migración de datos sigue pendiente. Consecuencia: el filtro «Atendida» no las encuentra aunque la decisión exista. Acción: migrar el estado antes de usar ese conteo en un reporte.

**Caso sin ciclo.** 1 de los 35 casos no tiene `ciclo_intervencion_id` (G-10). No es una desalineación de catálogo: es un dato incompleto que se completa desde la ficha cuando exista escritura (item 37).

**Orden de los catálogos.** `lib/db/repos/catalogs.ts` ordena por `id`, así que «Prevención estratégica» (id 5) aparece última aunque la Guía la describa primero. Acción: añadir una columna `orden` al catálogo o un mapa de orden en el dominio (item 8). No es un error de modelo: la Guía aclara que los componentes no son etapas sucesivas.

**Fecha de inicio del caso.** `core.casos.fecha_inicio` trae la fecha real del legado: 31 de los 34 casos vigentes, entre 2012-08-01 y 2026-05-01, y 3 sin fecha. El valor uniforme **2026-10-31** es `fecha_ultima_actualizacion` —el instante de carga—, no el inicio del caso, y no debe mostrarse como tal. La SPA normaliza a `YYYY-MM-DD` sin pasar por `Date` (`fechaIso` y `formatearFechaCaso` en `dominio/mapeo.ts`) para que una marca ISO no se corra un día por zona horaria, y declara el hueco con «—» (la explicación «Sin fecha de inicio registrada» queda en el `title` de la celda). El tramo abierto de `core.caso_estado_historial` quedó alineado con `fecha_inicio` por `migration/36_historial_desde_fecha_inicio.sql`, aplicada en local y en Neon el 2026-11-22: **32 de 35 tramos** toman la fecha real del caso y los **3 casos sin `fecha_inicio`** conservan el instante de carga, porque `desde` no admite nulos y no se inventa una fecha. En Casos, las filas sin fecha quedan al final del orden por fecha (`nulls last`).

**Estados y sus vocabularios.** El caso tiene tres y sólo tres (`Abierto · Resuelto · Archivado`, migración 33). Los demás ejes conservan su catálogo de la Guía y no se fusionan: compromiso `Por iniciar · En proceso · Cumplido · Redefinido · Desestimado`; hito `Registrado · En ejecución · Paralizado · Cumplido · Desestimado`; demanda `Pendiente · En proceso · Atendida · Desestimada`; documento, estados de escritura `Cargado · En análisis · Extraído · Validado · Rechazado` (la base heredada guarda `Activo` y la UI lo rotula «Cargado»; NULL se declara «Sin estado registrado»). La alerta no tiene columna de estado: se deriva de `paso_actual` en cinco valores (`Pendiente de revisión · En revisión · Validada · Aprobada · Atendida`) y desde esta pasada los cinco son filtrables —antes «En revisión» se emitía pero el `ESTADOS` del repositorio lo ignoraba—. Dos palabras siguen siendo ambiguas por origen y no se tocan sin decisión: `categoria` de compromiso también se llama `Abierto`/`Cerrado` (no se pinta) y `Atendida` es la grafía documentada para las 83 alertas legadas `Archivado` mientras la migración de ese dato siga pendiente.

**Evidencias y preferencias.** Las evidencias de compromiso como archivos exigen almacenamiento y quedan fuera del prototipo (item 24); las preferencias y el contraste por usuario viven hoy en `localStorage` y necesitan perfil persistido (item 47). Ninguna de las dos se simula.

### 3 · Esquema y artefactos: acciones de cierre

Cinco operaciones cortas que no son trabajo de interfaz pero que conviene cerrar antes de que el sistema crezca. Los hallazgos que las motivan están en la sección siguiente.

1. ~~`DROP FUNCTION core.siguiente_codigo_caso()`~~ **Hecho (migración 25).** La sobrecarga sin argumentos quedó retirada; `pg_proc` sólo conserva `(integer, integer)`. Comprobado además que la llamada sin argumentos no emitía el formato viejo: fallaba con `is not unique` (42725) por el `DEFAULT 1` de la firma vigente.
2. ~~Corregir el artefacto v10~~ **Hecho (2026-11-22).** `cat_roles_actor` figura con 4 posiciones (`:4799`) y `core.demandas.caso_id` ya no lleva `NOT NULL` (`:7107`). Residuo abierto: el SQL unificado sigue sembrando roles 4–6 (G-01).
3. ~~Regenerar `DICCIONARIO_DATOS.md` desde su fuente~~ **Hecho (2026-11-22).** Se corrigió el comentario de `es_grave` en la base, se alineó el Anexo A de `ANALISIS_PORTABILIDAD` (`dim_rol_actor` → «4 filas: 1, 2, 3 y 7») y se regeneró: sin `Critica_Inmediata` y sin «sembrar 1–3» en ese destino. Residuo: el literal sigue en `docs/PARCHE_23_*.sql`.
4. ~~Corregir el generador de `log_envios`~~ **Hecho (2026-11-22).** Corregida la fuente en `ANALISIS_PORTABILIDAD` y regenerada §11.5: `core.envios_comunicacion` es el único destino.
5. Reejecutar la rama de retirada de `cat_tipos_reunion` (D7) cuando se elimine la FK desde `core.reuniones_dialogo`; el catálogo está marcado obsoleto y no debe recibir valores nuevos.

**Cerrado (2026-11-22).** `migration/30_alcance_derivado.sql` retiró `core.casos.alcance_id` —el alcance ya no se elige— y añadió `core.alcance_caso(uuid)`, que lo deriva de `core.caso_regiones` (una región → su alcance; varias → Nacional; sin regiones asignadas → la región principal del caso y, en su defecto, la provincia). `core.regiones.alcance_id` quedó poblado por ubigeo y la API rechaza un alcance manual con `422 ALCANCE_DERIVADO`. En la misma migración, `analytics.vw_anexo_15_matriz_conflictividad` pasó a `security_invoker = true` y consume la función: la vista aplica la RLS del caso a quien consulta (22 filas como propietario, 21 como `avisa_app`, que no ve el caso anulado).

**Defectos operativos de la DDL v9** que se reportan pero no se corrigen aquí: no corre de una sola pasada (FK adelantada a `core.usuarios`), exige PostGIS, el seed de `cat_variables` viola su propia FK, `core.entidadess` no existe —el objeto real es `core.entidades`— y conviven `core.plan_acciones` y `core.planes_accion`. No se construye nada sobre esos nombres ni se citan como vigentes.

### 4 · Lo que sigue aplazado por decisión de producto

- **Calibración del riesgo:** aplazado expresamente; no se documenta ninguna fórmula. El ubigeo y los centroides **ya no** están en este grupo: el shapefile distrital (items 128–131) los aporta, y por eso «Panorama territorial» podrá dibujar geometría sin cambiar de pantalla.
- **RADAR / RED y NODO (D18):** `dim_tipo_actor_radar` (3 filas) se queda en `legacy.*` porque `territorio.*` no modela RED ni NODO. Los módulos 2027 dependen de ese modelo (item 54); inventarles un catálogo ahora fijaría un eje que no existe.
- **Pasos 4–6 del flujo `reporte`:** las 9 instancias se conservan sin `flujo_definicion_id` a propósito. Ampliar el catálogo a seis pasos inventaría tres pasos y su rol; el `NULL` está documentado en el comentario de la columna.

**Procedencia.** Los pendientes de §1 y §2 salen de `DECISIONES_CARGA_LEGADO_V9.md` (§5, §8, §10, A.4 y A.5), `GAPS_GUIA_SQL_UI.md` (§2.4, §3.2, §3.4 y §9) y `GLOSARIO_ALINEACION_GUIA.md` (§1.7 y §1.12); los de §3, de los hallazgos G-01 a G-06 y de `DECISIONES_D3_D4_D7_D9_D10.md` (D7); los de §4, de D9, D18 y de la decisión de producto sobre ubigeo.

Cierre: ninguno de estos pendientes se resuelve escribiendo en la SPA. La regla del capítulo 8.4 de la Guía —transformar datos dispersos en conocimiento útil— exige que la interfaz distinga lo que sabe de lo que supone; cuando el dato falta, lo declara.

## Hallazgos que exigen decisión o regeneración (2026-11-22)

Estos quince hallazgos no son erratas de redacción: cada uno cambia el modelo de datos, cambia un dato vivo u obliga a regenerar un artefacto. Se comprobaron contra la base viva y el código, no contra la documentación. Al final se registran dos falsos positivos que traía el inventario y que quedaron descartados al verificarlos.

**Estado al 2026-11-22.** Cerrados: **2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 y 15**. El **5** se retiró (API de demostración),
el **9** con `migration/24`, el **3** con `migration/25`, el **2** corrigiendo la v10, el **6**
regenerando §11.5 y el **8** portando el calendario. El **7** era de redacción. Quedan **parciales 1
y 4**: la v10 y el diccionario ya están alineados, pero el `AVISA_V10_ESQUEMA_UNIFICADO.sql` sigue
sembrando roles 4–6 y el literal `Critica_Inmediata` sobrevive en `docs/PARCHE_23_*.sql`, que el
glosario prohíbe editar a mano. El **10** cerró mostrando `fecha_inicio` en lugar de la fecha de carga;
el **11** pasó por `migration/31` y quedó definitivamente resuelto con `migration/33–34`, que unificó
el estado abierto en `Abierto` (el **13** documenta ese defecto). El **12** se cerró con `migration/32`
(`LEFT JOIN` + `—`): la vista del Anexo 15 ya no omite casos. La `migration/35` dejó
`core.casos.fecha_inicio` en la fecha del legado (31 casos con fecha, 3 sin fecha en origen) para
que «Inicio» no muestre la fecha de carga. Las migraciones **32–35 están aplicadas
también en Neon** (2026-11-22, rol `neondb_owner` por el host directo), así que la
UI en ejecución ya ve el estado corregido: tres estados (`Abierto`, `Resuelto`,
`Archivado`), 35 casos abiertos con un solo tramo de historial y **34 filas** en la
vista del Anexo 15 bajo RLS. Los hallazgos **14 y 15** se sumaron después de esa lista: la migración 37 vinculó las 100 demandas que tenían caso por su alerta y selló las 19 del caso anulado (218 con caso · 107 sin caso), y `listDemandas` publica la fecha del hecho desde la alerta en lugar de la fecha de carga.

### 1. `cat_roles_actor`: 7 filas en la v10 frente a 4 en la base

**Comprobado.** La base tiene 4 roles: `1 Principal`, `2 Secundario`, `3 Tercero imparcial`, `7 No determinado`. El archivo `AVISA_V10_ESQUEMA_UNIFICADO.sql` se contradice a sí mismo: en un bloque siembra esos mismos cuatro (`8780–8783`), pero en otros dos bloques añade `4 Proveedor MYPE`, `5 Exportador CITES` e `6 Inspector CITE` (`3280` y `7484`), y la comprobación de cierre del propio script espera siete filas (`9340`: `1,2,3,4,5,6,7`).

**Por qué importa.** Los roles 1–3 describen la **posición relacional** del actor en el conflicto (principal, secundario, tercero); los roles 4–6 describen una **función institucional** (representa a una MYPE, es exportador CITES, es inspector de CITE). El propio v10 lo reconoce más adelante al crear una tabla aparte, `core.cat_roles_funcionales` (`8789`), y lo justifica en un comentario: «sería una mentira semántica que rompe cualquier KPI de influencia» (`8773`). Es decir: las semillas 4–6 y la comprobación de siete filas son restos de un diseño ya superado. Si alguien aplicara el script tal cual, el catálogo de posiciones quedaría contaminado con funciones y cualquier indicador de influencia por posición saldría mal.

**Qué propongo.** El criterio correcto es el que ya está en la base: **4 posiciones** (incluida `No determinado`, que en v10 ocupa el hueco 7). Corregir el artefacto v10 para que no siembre 4–6 ni espere siete filas, y dejar las funciones en `cat_roles_funcionales`. El `id 7` significa hoy dos cosas distintas según se lea la base o el script, y eso es lo que hay que eliminar.

**Parcialmente resuelto (2026-11-22).** La tabla de la v10 ya da 4 filas (`:4799`) y el diccionario
regenerado también («Filas: 4»). Sigue inconsistente `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`: siembra
`4 Proveedor MYPE`, `5 Exportador CITES` y `6 Inspector CITE` en `core.cat_roles_actor` (`:3280` y
`:7484`) y su comprobación de cierre espera `1..7` (`:9340`). El origen son los parches, así que
corregirlo exige editar `docs/*.sql` y regenerar con `migration/consolidar_esquema.py`.

### 2. `core.demandas.caso_id` es `NOT NULL` en la v10 y anulable en la base

**Comprobado.** La v10 lo declara `caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE` (`4964`; igual en `759`). En la base viva la columna acepta nulos (`is_nullable = YES`).

**Por qué importa.** El requisito del producto es explícito: una demanda puede existir **sin caso** —de ahí la vista «Demandas sin caso» dentro de Casos y el contador `sinCasoTotal` del sobre de `GET /api/v1/demandas`—. Con `NOT NULL` esa función no se puede sostener: o se obliga a inventar un caso, o no se registra la demanda hasta vincularla. La base ya refleja la decisión correcta; el DDL de referencia quedó atrás.

**Qué propongo.** No hay nada que migrar en la base (ya es anulable). Lo que hay que corregir es el artefacto v10: `caso_id UUID NULL` y documentar que la demanda sin caso es un estado legítimo, no un dato incompleto.

**Resuelto (2026-11-22).** La v10 ya lo declara sin `NOT NULL` (`:7107`) y el diccionario publica la
columna como anulable. Queda anotado, sin tocar, que `problema_3p` y `pedido_3p` siguen `NOT NULL`
en ese mismo bloque aunque la base las tiene anulables.

### 3. `core.siguiente_codigo_caso()` tiene dos sobrecargas vivas

**Comprobado.** Conviven `core.siguiente_codigo_caso()` —sin argumentos, creada en `migration/12_anulacion_y_secuencia.sql`— y `core.siguiente_codigo_caso(integer, integer)`, creada en `migration/16_recodificacion_anexo15.sql` para emitir el código con subsector y temática. La aplicación llama sólo a la segunda (`lib/db/repos/cases.ts:763`: `select core.siguiente_codigo_caso($1::int, $2::int)`). La versión sin argumentos conserva su `comment on function` y su `grant execute` (`migration/12:445`), pero no tiene ninguna llamada.

**Por qué importa.** Es una trampa de ambigüedad: cualquiera que escriba `select core.siguiente_codigo_caso()` obtendrá una función válida que genera un código **con el formato anterior**, sin pasar por la plantilla del Anexo 15, y no fallará. Dos generadores de códigos coexistiendo es exactamente el tipo de defecto que aparece meses después con correlativos duplicados o con códigos que no cuadran con el patrón `CS-<PA|MI>-<INF|OAT|NOR|DBE|GOB|ITE|GEN>-<AAAA>-<NN>`.

**Qué propongo.** Retirar la sobrecarga sin argumentos en una migración breve (con su reversión), después de confirmar que ni el código ni las propias funciones la invocan por dentro. Es una operación de una línea y elimina el riesgo de forma definitiva.

**Resuelto (2026-11-22, `migration/25_retiro_sobrecarga_siguiente_codigo.sql`).** Comprobados 0
dependientes en `pg_depend`, `prosrc`, vistas, políticas, triggers y defaults, la sobrecarga se
retiró. **Corrección a este hallazgo:** la llamada sin argumentos no llegaba a emitir
`CS-PRODUCE-…`; fallaba con `function core.siguiente_codigo_caso() is not unique` (42725), porque el
`DEFAULT 1` de la firma de dos argumentos crea un segundo candidato. Tras el retiro se resuelve a esa
firma con `(1, 1)` y devuelve `CS-PA-INF-<AAAA>-NN`. El formato antiguo ya no es alcanzable.

### 4. El diccionario generado contiene un literal obsoleto: «sembrar 1–3»

**Comprobado.** `docs/05_datos/DICCIONARIO_DATOS.md:5995` documenta el destino de `legacy.dim_rol_actor` como «`core.cat_roles_actor` (sembrar 1–3)». La base tiene 4 filas, no 3.

**Por qué importa.** El diccionario es un artefacto **generado**: si se corrige a mano, la siguiente regeneración lo revierte. Y mientras diga «1–3», quien lo lea concluirá que el catálogo tiene tres roles y que `No determinado` sobra. Es el mismo desorden del hallazgo 1, pero en un documento que parece normativo.

**Qué propongo.** Corregir el literal **en la fuente del generador** (la definición de destinos de la tabla heredada), no en el Markdown, y regenerar. A mano sólo se pierde el cambio.

**Parcialmente resuelto (2026-11-22).** El diccionario **parsea** el Anexo A de
`ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md`; ahí estaba el defecto: `dim_rol_actor` declaraba 4 filas y
«sembrar 1–3». Corregido a «4 filas: 1, 2, 3 y 7» y regenerado, la ficha y la tabla del diccionario ya
lo dicen así (`dim_tipo_actor` conserva «1–3», que es correcto porque tiene 3 filas). Además se
corrigió el `COMMENT ON COLUMN` de `es_grave` en la base, que contenía `Critica_Inmediata`.
Queda un residuo en `docs/PARCHE_23_DESTINATARIOS_Y_CUATRO_OJOS.sql:156` y su copia en el SQL
unificado: mismo caso que el hallazgo 1, requiere autorización para editar `docs/*.sql`.

### 5. `backend/main.py` mantiene usuarios demo con la clave en claro

**Comprobado.** `backend/main.py` define tres usuarios con `"password": "demo"` y correos `demo-*@example.invalid`, y compara la clave con `user["password"] != payload.password` (`121`). Es el servicio FastAPI de `:8000` (`avisa-api`), hoy sellado.

**Por qué importa.** Son **dos sistemas de autenticación en paralelo**. El real es `core.autenticar_usuario` + cookie HMAC httpOnly que usa la aplicación; el de `backend/` es un atajo con credenciales escritas en el código y comparación en texto plano. Si alguien lo publica o lo toma como referencia, reproduce un login inseguro. Además contradice la regla ya adoptada de que los usuarios se identifican por **DNI** y no por correo.

**Qué propongo.** Hay que decidir su destino: retirarlo, o degradarlo explícitamente a arnés de demostración local con un aviso en el propio archivo y en el README. No conviene que siga existiendo sin etiqueta. **Esta decisión es tuya**; no requiere tocar la aplicación.

**Resuelto (2026-11-22).** Se retiró. Se borró `backend/` —el duplicado suelto— y también el código
del demo que construía el contenedor de verdad (`backups/backend/main.py`, `db.py`,
`requirements.txt`). El servicio `api` salió de `compose.yaml` junto con `docker/api/Dockerfile` y la
variable muerta `AVISA_API_URL`, que no leía nadie; el runbook
`docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md` §11 ya no describe la API de ejemplo. Nada dependía de
ella: las rutas las sirve Next desde `app/api/**` contra PostgreSQL, y el login usa
`core.autenticar_usuario`. Queda un contenedor `avisa-api` en ejecución que pasó a huérfano
(`docker rm -f avisa-api` para eliminarlo).

### 6. `legacy.log_envios` apunta a dos tablas distintas

**Comprobado.** El diccionario lo mapea a `core.notificaciones (parcial)` (`DICCIONARIO_DATOS.md:6310` y `6604`), mientras que `docs/05_datos/BRECHA_CAPA_DATOS_V9.md` y `LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md:105` lo mapean a `core.envios_comunicacion`, con el mismo recuento de 17 filas. En la base existen `core.envios_comunicacion` y `legacy.log_envios`; **no existe** `core.log_envios`.

**Por qué importa.** Los 17 envíos heredados son registros de mensajes enviados (con destinatario, canal y estado), que es lo que modela `core.envios_comunicacion`. `core.notificaciones` es otra cosa: avisos para el usuario dentro del sistema. Un mapeo que manda los envíos a notificaciones no sólo duplica destino: confunde «lo que el sistema envió» con «lo que el usuario debe leer», y eso afecta a la trazabilidad de comunicaciones y a cualquier cifra de envíos.

**Qué propongo.** Fijar `core.envios_comunicacion` como destino único (es la que existe y la que coincide 1:1 con las 17 filas), corregir la fuente del generador del diccionario y regenerar. Confirmar antes si algún indicador usa `notificaciones` para contar envíos; si lo hace, hay que corregir también esa consulta.

**Resuelto (2026-11-22).** Se corrigió la fuente en `ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md`
(`:467` y `:600`) y se regeneró §11.5. El documento ya no menciona `core.notificaciones` (0
coincidencias) y el diccionario apunta a `core.envios_comunicacion`. `core.notificaciones` existe,
pero tiene 0 filas: son avisos al usuario, no envíos.

### 7. Numeración duplicada en este documento (corregido)

**Comprobado.** Los items 2 y 5 estaban escritos como `2. 2.` y `5. 5.`, lo que rompía la referencia numérica que usa todo el resto del catálogo (y el propio apartado de orden de entrega).

**Por qué importa.** Poco en sí mismo, pero este documento se cita por número de item en los informes de avance; un número duplicado hace ambiguo el seguimiento.

**Estado.** Corregido en esta misma pasada: quedan como `2.` y `5.`.

### 8. El calendario de compromisos (resuelto en código; vacío por falta de fechas)

**Hallazgo.** Es el item 25 del catálogo. La vista `features/compromisos/compromisos.page.html` era
una tabla con filtros y paginación de servidor: no había calendario, no había desglose por responsable
ni por nivel de gobierno, y no existía una ruta de calendario.

**Por qué importa.** Los compromisos son el objeto que más se consulta por fecha: vencimientos, hitos y plazos son su razón de ser. Una tabla ordenada no responde a la pregunta operativa real («qué vence esta semana y de quién depende»). El dato ya está: `fecha_vencimiento`, hitos y responsables están persistidos; lo que falta es la vista, no el modelo.

**Qué propongo.** Construirlo como vista dentro de Compromisos —conmutador Tabla / Calendario, igual que el conmutador ya existente en Casos—, reutilizando la consulta paginada y el mismo filtro de fechas. No requiere migración.

**Resuelto en código (2026-11-22).** El conmutador Tabla · Calendario ya está en
`features/compromisos/compromisos.page.{ts,html}`, con rejilla mensual, navegación, estados
`Vencido` / `Por vencer` / `En plazo` y accesibilidad por teclado. El rango viaja al servidor:
`GET /api/v1/commitments` acepta `vencimiento_desde` y `vencimiento_hasta` (ISO `YYYY-MM-DD`,
inclusivos) y devuelve `400` si la fecha no existe o el rango está invertido. El rango se aplica
sobre el **vencimiento efectivo** —fecha manual y, si falta, el próximo hito no terminal—, que es la
misma fecha que muestra la tabla.

**Advertencia de datos:** hoy el calendario se pinta **vacío**, y es correcto. Los 8 compromisos
tienen `fecha_vencimiento` nula y el único hito con fecha (`2025-04-04`) está en estado `Cumplido`,
que es terminal y por tanto no cuenta como vencimiento pendiente. Sin fechas, la vista de calendario
no tiene qué mostrar: es un hueco de datos, no un defecto de la vista.

### 9. `core.demandas.estado_atencion` admite `En_proceso`

**Comprobado.** El `CHECK` vigente admite cuatro valores: `Pendiente`, `En_proceso`, `Atendida`, `Desestimada`. En la base hay **325 demandas y todas están en `Pendiente`**, así que los otros tres valores no tienen un solo registro.

**Por qué importa.** El vocabulario de la interfaz está congelado y usa `En proceso`, con espacio. Mientras la base use `En_proceso`, cada pantalla necesita traducir, y cualquier consulta escrita en SQL contra el valor «legible» devuelve cero filas sin avisar. Es el defecto más silencioso de la lista.

**Qué propongo.** Renombrar el valor del `CHECK` a `En proceso` (y revisar de paso si `Atendida`/`Desestimada` deben mantener esa forma). Como sólo hay filas en `Pendiente`, es un cambio de esquema sin migración de datos: se demuestra comprobando el recuento antes y después. Es una decisión de vocabulario, no de arquitectura, y por eso conviene cerrarla cuanto antes para no tener que tocar vistas después.

**Resuelto (2026-11-22).** `migration/24_estado_atencion_legible.sql` recrea el `CHECK` con
`Pendiente · En proceso · Atendida · Desestimada`. No movió datos: 0 filas tenían el valor viejo y
las 325 siguen en `Pendiente`. `lib/db/repos/demandas.ts` acepta la forma legada `En_proceso` y
escribe siempre la canónica, de modo que un cliente antiguo no se rompe. Los otros dos catálogos de
estado (`cat_estados_compromiso`, `cat_estados_hito`) ya estaban bien en la base; el único objeto del
esquema `core` con el literal heredado era este `CHECK`.

### 10. La fecha «Actualizado» de la ficha era la de la carga del legado

**Comprobado.** `core.casos.fecha_ultima_actualizacion` es `NOT NULL DEFAULT now()` y la carga histórica la escribió una sola vez: **las 35 filas comparten el mismo instante, 2026-10-31**. La ficha del caso la publicaba como «Actualizado», de modo que treinta y cinco expedientes abiertos entre 2012 y 2026 parecían haber sido tocados el mismo día.

**Por qué importa.** Una fecha que no distingue un caso de otro no informa: transmite que el sistema no registra actividad y hace dudar del resto de la ficha. La fecha real y variable ya está en `fecha_inicio` (2012–2026, con 3 casos nulos): sirve para ordenar y para situar el expediente, y no pretende medir actividad.

**Qué propongo.** Retirar «Actualizado» de la ficha y de la lista y mostrar «Inicio» desde `fecha_inicio`. Conservar la columna, porque las vistas analíticas la usan (`dias_estancado`, `ultima_actividad`), pero no presentarla como actividad del caso hasta que exista el historial de cambios del item 41 que la actualice de verdad.

**Resuelto en código (2026-11-22).** `Caso.inicio` se alimenta de `fecha_inicio` y `SORTS.recent` ordena por ella (`nulls last`); la celda «Actualizado» salió de la ficha y las tarjetas y la tabla de Casos muestran «Inicio». `Caso.actualizado` sigue en el modelo sin uso visible, a la espera del historial.

### 11. Los 34 casos abiertos estaban todos en `Activo`

**Comprobado.** Los 35 casos del legado comparten `estado_id = 1` (`Activo`); `En seguimiento`, `Resuelto` y `Archivado` no tienen una sola fila. El catálogo ya distingue los cuatro valores y los dos primeros están marcados `es_activo = true`: la base admite la distinción, la carga no la usó.

**Por qué importa.** El filtro de estado de Casos, el distintivo de cada tarjeta y los indicadores «Casos activos» mostraban una sola etiqueta para todo el universo. Un catálogo de cuatro valores que nunca se usa no informa: sugiere que el sistema no distingue seguimiento cuando sí puede.

**Qué propongo.** Reclasificar los expedientes abiertos a `En seguimiento` y reservar `Activo` para el alta de casos nuevos, que es lo que ya declara el `DEFAULT` de `core.casos`.

**Resuelto (2026-11-22).** `migration/31_casos_en_seguimiento.sql` cerró el tramo abierto de `core.caso_estado_historial`, insertó el tramo nuevo con motivo y movió los 35 casos a `En seguimiento` (35 actualizados, 35 tramos abiertos, 0 en otro estado). La API estrenó `abiertos=true`, que filtra por `es_activo` y no por etiqueta: lo usan los indicadores de Resumen y de Dirección, de modo que un alta nueva en `Activo` sigue contando. Como los dos estados tienen `es_activo = true`, ninguna vista analítica ni índice cambió de resultado. Reversión: un `UPDATE` de vuelta a `estado_id = 1` y el retiro de los tramos con el motivo de la reclasificación.

**Superado (2026-11-22).** La reclasificación a `En seguimiento` resolvía el síntoma, no la causa: `Activo` y `En seguimiento` eran dos nombres del mismo hecho. La migración 33 los unificó en `Abierto` y retiró el estado duplicado del catálogo (hallazgo 13).

### 12. El Anexo 15 oculta 13 de los 34 casos abiertos

**Comprobado.** `analytics.vw_anexo_15_matriz_conflictividad` ya es `security_invoker = true`
(migración 30), así que la RLS se aplica a `avisa_app` y el problema no es de permisos. Aun así
devuelve **21 filas para `avisa_app`** —y 22 como owner— frente a **34 casos no anulados**. Las 13
filas restantes desaparecen porque los `INNER JOIN` con distrito, nivel de conflicto, riesgo y
subsector/temática exigen un valor que esos expedientes no tienen: el `JOIN` no descarta la columna,
descarta la fila.

**Por qué importa.** Es el producto documental que se imprime y se lleva a una reunión (vista `analytics.vw_anexo_15_matriz_conflictividad`, migración 32; **ningún item del catálogo la genera**). Que muestre dos tercios del universo sin declararlo hace que el lector concluya que esos 13
casos no existen, y contradice la regla del capítulo 8.4 que este catálogo aplica al resto de la
interfaz: el dato ausente se declara, no se estima. Una matriz que esconde filas por un `NULL` es una
estimación por omisión.

**Qué propongo.** Cambiar los `INNER JOIN` por `LEFT JOIN` y publicar `—` en las columnas sin dato,
conservando las 15 columnas y el orden del Anexo 15. No requiere migrar datos ni cambiar permisos. El
`CREATE OR REPLACE VIEW` está redactado dentro de `docs/07_frontend/mockups/anexo-15-matriz-conflictividad.html`
y lo aplica `migration/32_anexo15_left_join.sql`.

**Resuelto (2026-11-22).** Decisión aprobada y migración 32 ejecutada en la base local: los ocho
`JOIN` de catálogo pasan a `LEFT JOIN` y la vista conserva 15 columnas, orden, `security_invoker = true`
y la RLS. Comprobación como propietario: **35 filas** (antes 22), de las cuales **12 no tienen región**
y salen con `—`. Con RLS activa, un rol ve las **34 vigentes**; el caso anulado sigue oculto por la
política de `core.casos`, no por un `JOIN`. El mockup ya no declara «21 de 34 visibles».

**Resuelto también en Neon (2026-11-22).** La migración 32 se aplicó primero al PostgreSQL local
(`avisa-db`) y después a la base que sirve la UI (`APP_DATABASE_URL`, Neon), ejecutada con
`neondb_owner` por el host directo. Verificación: `pg_get_viewdef` confirma los ocho `LEFT JOIN` y
`security_invoker = true`; como dueño la vista devuelve **35 filas** y como `avisa_api` con
`app.rol_codigo` **34** (el caso anulado sigue oculto por RLS, no por un `JOIN`); sin variables de
sesión devuelve **0 filas**, es decir, la política sigue intacta.

### 13. `Activo` y `En seguimiento` eran el mismo estado con dos nombres

**Comprobado.** `core.cat_estados_caso` tenía cuatro filas y las dos primeras —`Activo` (id 1) y
`En seguimiento` (id 2)— compartían `es_activo = true`. Ninguna vista, índice ni consulta los
distinguía: la diferencia era sólo de etiqueta. La interfaz mostraba «Abiertos» en los chips y
«En seguimiento» en la ficha y en el historial, así que el usuario leía dos nombres para el mismo hecho.

**Por qué importa.** Un catálogo con sinónimos obliga a explicar en cada pantalla cuál es el nombre
bueno, y cualquier informe que cruce ambos nombres produce series partidas. Tras la migración 31 los 35
expedientes estaban en el valor 2, de modo que el valor 1 quedaba como etiqueta reservada a futuras
altas que significaba exactamente lo mismo.

**Resuelto (2026-11-22).** `migration/33_estado_abierto_unico.sql` renombró el id 1 a `Abierto`, movió
los 35 casos a ese id y retiró el id 2 del catálogo: quedan **`Abierto · Resuelto · Archivado`**.
`migration/34_historial_tramo_unico.sql` retiró el tramo que el trigger `core.caso_historial()` abrió
al corregir `estado_id` y reabrió el original: cada caso conserva un único tramo, no un cambio ficticio del
día de la migración; `migration/36_historial_desde_fecha_inicio.sql` fecha ese tramo en la fecha real
del caso. En la SPA, `estadoDeCaso()`
(`dominio/mapeo.ts`) colapsa `Activo`, `En seguimiento` y `Abierto` en `Abierto`, de modo que mientras
una base siga sin migrar la interfaz sigue mostrando un solo nombre. `lib/api-mappers.ts` traduce
`Abierto → Activo` para el espejo Next congelado, sin editarlo.

### 14. 119 demandas tenían caso y se mostraban como «sin caso»

**Comprobado.** `migration/loader/phases/p09_demandas.py` resolvió `caso_id` **sólo** desde
`DIM_Demandas.ID_Caso` (decisión D1: 99 de 325) y nunca lo heredó de la alerta, aunque
`core.demandas.alerta_id` ya existía. Medido en local y en Neon, idénticos:

| situación de las 226 sin caso   | filas |
| ------------------------------- | ----: |
| su alerta tiene un caso vigente |   100 |
| su alerta tiene un caso anulado |    19 |
| su alerta no tiene caso         |    81 |
| no tienen alerta                |    26 |

No había un solo conflicto (`demandas.caso_id` distinto del de su alerta): la relación es
unívoca, así que heredar no fuerza ninguna equivalencia entre series (D19).

**Por qué importa.** La ficha del caso lista las demandas por `d.caso_id = c.id`, así que 119
demandas **no aparecían en la ficha de su caso** y sí en «Demandas sin caso», que las
presentaba como trabajo pendiente. Las 19 del caso anulado (`CS-MI-ITE-2026-02`) seguían
contando porque `core.anular_caso` cascada por `caso_id` y no las alcanzó al no estar
vinculadas.

**Resuelto (2026-11-22).** `migration/37_demandas_caso_desde_alerta.sql` vincula las 100 y
sella las 19 con **el mismo lote del caso** —no reejecuta `anular_caso`, que exige un caso
vigente y emitiría un lote nuevo—. Resultado: **107 sin caso · 218 con caso · 19 anuladas**.
`p09_demandas.py` hereda el caso de la alerta en cada carga y `checks.py` fija las nuevas
cifras (218 / 81 / 26) con una comprobación de que ninguna demanda contradice el caso de su
alerta. La ficha de `CS-PA-OAT-2026-01`, por ejemplo, pasó de 64 a 81 demandas visibles.

### 15. La fecha de «Demandas sin caso» era el día de la carga

**Comprobado.** La columna «Registro» mostraba `core.demandas.fecha_registro`, que se cargó
desde `DIM_Demandas` (columna 7) y es el **instante de la importación**: 2026-09-04 y
2026-09-18, idéntico para bloques enteros de filas. La fecha real del hecho está en la
alerta: `core.alertas_tempranas.fecha_reporte` (columna 4 del legado), que va de 2012 a 2026.
De las 107 demandas que siguen sin caso, **81** tienen alerta con fecha y **26** no tienen
alerta.

**Por qué importa.** Una lista donde todas las filas dicen «18/09/2026» afirma que todas las
demandas surgieron el mismo día, y oculta que la mayoría son hechos de 2022. Es el mismo
defecto que el hallazgo 10 en la ficha del caso, y la misma regla: una fecha de carga no se
presenta como fecha del hecho.

**Resuelto (2026-11-22).** `listDemandas` (`lib/db/repos/demandas.ts`) une
`core.alertas_tempranas` y publica `fechaHecho`; la columna de la SPA pasa a «Fecha del hecho»
y muestra `fechaRegistro` marcada con la etiqueta «registro» cuando la demanda no tiene
alerta, para no confundirla con la del hecho. `recent`/`oldest` ordenan por `fecha_reporte`
con `nulls last` y desempatan por registro. No se reescribe `fecha_registro`: sigue siendo el
instante de alta y conserva su uso de auditoría.

### Falsos positivos descartados

El inventario traía dos hallazgos que no lo son; los descarto dejando la comprobación:

- **«La guarda redirige a `/sin-permiso`».** Esa ruta no existe. `core/auth/sesion.guard.ts:17` redirige a `/acceso`, y `/acceso` sí está declarada en `app.routes.ts`. No hay enlace roto.
- **«Falta `provideZonelessChangeDetection()`».** Su ausencia es **correcta** en Angular 22: la detección de cambios sin zonas no es el valor por defecto de la plantilla y el proyecto no la necesita con la estrategia `OnPush` y señales que ya usa. Añadirla sería un cambio de comportamiento sin beneficio.

### Resumen

| #   | Hallazgo                                         | Tipo                   | ¿Requiere tu decisión?                                             |
| --- | ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------ |
| 1   | `cat_roles_actor` 7 vs 4                         | Modelo / artefacto v10 | Parcial: v10 y diccionario alineados; falta el SQL unificado       |
| 2   | `demandas.caso_id` `NOT NULL`                    | Artefacto v10          | Resuelto: v10 y diccionario anulables                              |
| 3   | Sobrecarga de `siguiente_codigo_caso()`          | Esquema vivo           | Resuelto: migración 25 (retirada)                                  |
| 4   | Literales obsoletos en el diccionario            | Artefacto generado     | Parcial: diccionario limpio; queda el parche 23                    |
| 5   | Usuario demo en `backend/`                       | Autenticación paralela | Resuelto: retirado                                                 |
| 6   | `log_envios` a dos tablas                        | Artefacto generado     | Resuelto: `core.envios_comunicacion`                               |
| 7   | Numeración duplicada                             | Documento              | No: corregido                                                      |
| 8   | Calendario de compromisos                        | Vista pendiente        | Resuelto en código; el calendario está vacío por falta de fechas   |
| 9   | `estado_atencion` con `En_proceso`               | Vocabulario / esquema  | Resuelto: migración 24                                             |
| 10  | «Actualizado» era la fecha de carga              | Dato heredado / vista  | Resuelto en código: se muestra `fecha_inicio`                      |
| 11  | Los 34 abiertos estaban en `Activo`              | Datos / vocabulario    | Resuelto: migración 31 y filtro `abiertos`                         |
| 12  | El Anexo 15 oculta 13 de 34 casos                | Vista / `INNER JOIN`   | Resuelto: migración 32 en local y en Neon (`LEFT JOIN` + «—»)      |
| 13  | `Activo` y `En seguimiento` eran el mismo estado | Datos / vocabulario    | Resuelto: migraciones 33–34, aplicadas en local y en Neon          |
| 14  | 119 demandas con caso listadas como «sin caso»   | Carga / vínculo        | Resuelto: migración 37, cargador y `checks` actualizados           |
| 15  | La fecha de la demanda era la de la carga        | Dato heredado / vista  | Resuelto: `fechaHecho` desde la alerta y columna «Fecha del hecho» |

## Orden recomendado de entrega

1. **Base segura primero:** permisos/ámbito territorial (35–36, 48–49), persistencia y auditoría (34, 37–39). Sin esto, nuevas vistas solo multiplican datos efímeros y riesgos de exposición.
2. **Alinear la ficha y sus catálogos:** cambios D1 y 11–19; luego actor, demandas, cronología, reuniones y auditoría (40–41). La guía y los valores correctos deben preceder los formularios y reportes.
3. **Cerrar los flujos diarios:** casos, bandeja, alertas, compromisos, directorio y documentos (20–27, 38–45, 50).
4. **Añadir explotación y consulta:** búsqueda, notificaciones, exportación, sincronización, gráficos y dashboards (29–32, 42–46, 51–52); la capa cartográfica del mapa ya tiene fuente (53): lo aplazado era la geometría, y llegó el 2026-11-23; cargarla es trabajo aparte.
5. **Construir módulos nuevos e integración:** V_ENVIOS, V_AUDITORIA, V_ADMIN, módulos 2027 y V_ETL; empezar ETL con archivos controlados y datos reales, después habilitar fuentes reales/OCR/integraciones autorizadas (54–62).
6. **Productos documentales y automatización asistida:** primero el kit de formularios y la capa de reuniones (65–66, 72), después captura, triage y extracción (73–78), luego el generador de anexos (75) y al final análisis, memoria y lote (79–87). La regla se mantiene en todo el tramo: la máquina propone, la especialista valida y la operación queda registrada.

**Atajo de ejecución.** Este orden es el de la dependencia técnica. Para decidir qué se construye ahora y qué se dibuja primero, la sección «Entrega: implementable ahora frente a solo mockup» separa lo que la SPA puede cerrar con los datos y endpoints actuales de lo que necesita un mockup, y la sección «Prioridad visual unificada · mockups para Figma y para el equipo .NET», al final del documento, ordena las quince piezas por impacto visual por unidad de esfuerzo de dibujo.

**Dependencia clave:** la UI Next congelada se apoya en estado React y datos de demostración; la SPA Angular ya lee datos reales y le faltan persistencia de escritura, auditoría y filtros seguros, que son la base para que los cambios se conviertan en un sistema operativo real. El esquema V10 ofrece una referencia de dominio útil, pero antes de cualquier migración revisaría el esquema efectivamente conectado, sus catálogos y políticas de acceso. El login demo no equivale a autenticación institucional. En la ampliación, la dependencia crítica es la capa de reuniones (72): los items 65, 73, 74 y 77 no tienen sustrato sin ella y el Anexo 16 seguirá sin una sola fila. El generador de anexos (75) depende de que el vocabulario y los formularios sean únicos (66); construirlo antes produce plantillas que reproducen datos inconsistentes a escala. Los pendientes P3 a P5 condicionan cualquier demostración con datos del legado: sin base legal formal no se expone PII fuera de `administrador` (item 45), y sin resolver los padres de demanda el Anexo 1 no cuadra aunque la vista funcione.

## Contrato de API: decisiones cerradas y lo que falta (2026-11-22)

Este catálogo decide **qué construir en la interfaz**. La costura entre la SPA y la API que la sirve —hoy Next en Vercel, después .NET en un servidor de PRODUCE— está inventariada en `docs/07_frontend/angular/CONTRATO_API_SPA.md`, que fija las 34 rutas verificadas, sus parámetros, sus cuerpos y sus formas de respuesta. Aquí queda solo el registro de lo decidido, para que ninguna de las dos partes lo reabra, y lo que sigue faltando.

### Decisiones cerradas

| #   | Tema                                   | Qué se decidió                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Por qué                                                                                                                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Grafía de los campos de respuesta      | Congelar **la que cada repositorio emite hoy**, sin añadir una segunda. En casos: `id`, `code`, `title`, `summary`, `progress`, `updated`, `updatedAt`, `region`, `risk`, `stage` en inglés, y `estado`, `prioridad`, `alcance`, `nivelConflicto`, `tematica`, `subsector`, `unidadResponsable`, `fechaInicio`, `anuladoEn`, `motivoAnulacion`, `anuladoPor`, `anulacionId` en español. Los campos nuevos, en camelCase. Los alias de los mapeos (`codigo \| code`) son tolerancia, no contrato. | Mientras convivan dos grafías conviven dos contratos, y los defectos aparecen solo por una de las ramas. La SPA ya tolera ambas: puede dejar de hacerlo cuando .NET respete esta. |
| C2  | Filtros publicados sin uso en pantalla | Conservar todos: `region` y `riesgo` en `/v1/cases`; `caso`, `unidad` y `sort` donde ya existen; `sort` en actores y organizaciones; `limit`/`limitPerType` heredados en `/v1/search`.                                                                                                                                                                                                                                                                                                           | Ya están implementados y probados, `riesgo` lo usa Dirección, y son la vía de consulta que la SPA necesitará sin inventar endpoints.                                              |
| C3  | `GET /v1/actors/{uid}`                 | Conservarlo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Es la ficha del actor y el destino del enlace desde el detalle del caso (item 12); que hoy nadie lo llame no lo hace sobrante.                                                    |

### Lo que sigue faltando

Ninguna bloquea al equipo de .NET: dos se resuelven solo en la SPA (F1, F4), tres dependen de la SPA y de la API a la vez (F3, F5, F6) y una es solo de la API (F7).

| #   | Falta                                                         | Dónde                         | Acción                                                                                   |
| --- | ------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| F1  | «Esta vista» exporta la entidad completa fuera de Compromisos | SPA (`app-exportar-menu`)     | pasar `[consulta]` con los filtros activos; `/v1/export` ya los reenvía (item 42)        |
| F2  | ✔ La exportación de «demandas sin caso» no filtraba           | SPA + API                     | Hecho: la SPA envía `sinCaso`, `q`, `estado` y `sort`; `/v1/export` publica esos filtros |
| F3  | La papelera se puede forzar por URL sin permiso               | SPA + API                     | la API ya responde 403; la SPA no debería construir la consulta si el rol no puede       |
| F4  | `consulta()` declara `mantener` y no lo implementa            | SPA (`core/http/consulta.ts`) | retirar la opción o implementarla; hoy no cambia el comportamiento                       |
| F5  | `expiresAt` se recibe y no se usa                             | SPA / API                     | se depende del 401; revisar solo si .NET implanta cookie deslizante                      |
| F6  | El panorama del mapa pagina en cliente con tope 100           | SPA / API                     | conservar el tope y un `total` exacto; un total desalineado trunca el mapa               |
| F7  | La descarga no queda en auditoría                             | API                           | registrar quién exportó qué y con qué filtros (item 42)                                  |

**Regla de cambio.** Toda modificación del contrato se hace primero en `app/api/**` y se refleja el mismo día en `CONTRATO_API_SPA.md`; la SPA no se toca si el contrato se respeta. **Lo que no falta:** las 34 rutas del contrato existen y están verificadas contra `app/api/**`; no hay llamadas de la SPA sin implementación ni rutas documentadas sin uso. Las parciales de la sección «Entrega: implementable ahora» (items 11, 12, 15, 21, 24, 26, 30, 31, 38 y 42) son trabajo de interfaz o columnas concretas, no huecos de contrato. Las cuatro altas nuevas (caso, alerta, compromiso y documento) usan rutas que ya estaban en el contrato y no lo amplían.

## Ampliación 2026-11-23 · Observaciones del equipo y de la dirección

**Origen.** Tres fuentes que llegaron juntas y que se solapan entre sí: el documento de observaciones del equipo (mapas, panorama, bandeja, directorios y el recorrido pantalla por pantalla), la lista de la dirección sobre lo que pide la alta dirección, y las notas de alineación con la Guía. Se consolidan en un solo tramo numerado para que no se construya dos veces lo mismo.

**Convención de los items.** `N` = nuevo. `R` = refina un item del catálogo 1–87 y no lo duplica. `C` = contradice una decisión previa: **no se implementa hasta que se resuelva** y por eso vive en su propia tabla. La columna «Estado» se fijó el 2026-11-23 tras contrastar cada item con la SPA, la API y la base: `Implementable n` (n = dificultad), `Mockup`, `Requiere dato`, `Requiere carga`, `Bloqueado` o `No se hace`. El detalle está en «Diagnóstico y diseño».

**Dos escalas que no se mezclan.** `D1`–`D5` es la dificultad de implementación de los items 1–87 (§Escala). `A1`–`A5` son los tramos de esta ampliación: agrupan por tema y crecen en dificultad, pero no son la misma escala y no se suman entre sí. Un item de `A1` puede ser más caro que uno de `D3`.

**Regla que no cambia.** Nada de esta ampliación autoriza a estimar un dato. Lo que no exista se declara como faltante, igual que en §1 y §2 de este documento. Y ninguna pantalla nueva se dibuja antes de decidir si el dato existe: por eso la mitad de este tramo es mockup.

### Contradicciones con decisiones previas (resolver antes de dibujar)

| #   | Lo que pide la ampliación                                                                  | Lo que ya estaba decidido                                                                        | Lectura propuesta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Retirar **Ruta de atención** de la ficha (P11)                                             | Item 8: reescribir sus términos con los cinco componentes del ciclo                              | **Resuelto 2026-11-23: gana la retirada.** El item 8 se cierra como obsoleto. El vocabulario del ciclo no se pierde: `features/casos/ciclo.contenido.ts` se reutiliza en Ayuda, no en la ficha.                                                                                                                                                                                                                                                                                                                                                                                   |
| X2  | **Eliminar el mapa** del panorama porque es de 2027 (P2)                                   | Items 27, 33 y 53: capa cartográfica aplazada; el mapa referencial ya es la ventana principal    | **Resuelto 2026-11-23: se conserva el lienzo.** `/mapa` ya es la raíz de la navegación y la dirección lo quiere como ventana principal con KMZ, RADAR y desembarcaderos. El item 90 no se hace; el mapa sólo se retira cuando se sustituya por una capa con geometría real.                                                                                                                                                                                                                                                                                                       |
| X3  | Llamar a los casos **latentes** y **manifiestos** (E7)                                     | Estados congelados `Abierto · Resuelto · Archivado`; la escala de conflictividad es otra columna | No es un estado: es el grado de exteriorización pública, que ya mide «Nivel de conflictividad». Se propone mostrar «latente/manifiesto» como **lectura derivada** del nivel y de la existencia de hechos públicos, sin crear un cuarto estado en la base. **Adoptado por la dirección (2026-11-23):** el vocabulario cambia de «Casos activos» a **latente/manifiesto**, porque Edith es la directora y ese es el término de la Guía. Queda **pendiente** de implementación y de ratificación de la regla por OAIPCS; hasta entonces la tarjeta sigue rotulando «Casos abiertos». |
| X4  | Quitar «FALTA COMPLETAR» del expediente (P13)                                              | Item 68: indicador de completitud como lugar donde se ve el dato ausente                         | El indicador no desaparece: se mueve a bandeja y dirección. En el expediente se retira la etiqueta porque el propio hueco ya se ve.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| X5  | Quitar el botón «Demandas sin caso» (P7) y la dirección duda de que existan                | Hecho 2026-11-22: quedan **107** sin caso; 26 no tienen alerta y 81 no tienen caso en el origen  | El botón no se retira del acceso a datos: se saca de la barra de filtros de casos y se deja en la pantalla de demandas. Ocultar el hueco no lo cierra.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| X6  | Director/a y Secretaría General ven ambos subsectores; Vice-ministerios sólo el suyo (F13) | Items 35–36 y 48–49: ámbito territorial y permisos por rol                                       | No hay contradicción, hay un eje nuevo: además del territorio, el **subsector** recorta la consulta. Se implementa como ámbito de sesión, no como filtro de pantalla.                                                                                                                                                                                                                                                                                                                                                                                                             |

**Latentes y manifiestos: decisión adoptada, implementación pendiente (2026-11-23).**

- **Gana el vocabulario de la dirección.** Edith es la directora del sistema y pide «casos latentes» y
  «casos manifiestos», que son los términos de la Guía. Se adopta ese vocabulario y se retira el rename
  «Casos abiertos» → «Casos activos» que traía la anotación de P2: «activo» era ambiguo —podía leerse
  como estado operativo, que es otra cosa—, mientras que «latente/manifiesto» tiene un solo significado
  en la Guía. La tarjeta seguirá diciendo «Casos abiertos» sólo hasta que la pantalla implemente el
  cambio; no es que el cambio esté descartado.
- **No crea un cuarto estado.** `core.cat_estados_caso` conserva `Abierto · Resuelto · Archivado`.
  Latente/manifiesto es una **lectura derivada** del grado de exteriorización pública —nivel de
  conflictividad más existencia de hechos públicos—, no una columna nueva. Lo que queda **pendiente**
  son dos cosas concretas: que OAIPCS ratifique la regla de derivación y que la pantalla la aplique.
- **El mapa hereda la misma regla.** El item 126 ya dibuja RADAR y desembarcaderos con símbolo propio;
  distinguir latentes de manifiestos sobre el mapa usa la misma derivación, así que el símbolo se dibuja
  sin fijar la leyenda hasta la ratificación.

### A1 · Presentación, etiquetas y retiradas (items 88–99)

| #   | Item                                      | Qué cambia                                                                                                                                                                                              | Origen | Estado                                                                                                      |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| 88  | `N` Encabezado global                     | «Producción · OAIPCS» pasa a «Aplicativo de apoyo a la gestión de conflictos sociales».                                                                                                                 | E6     | ✔ Hecho 2026-11-23                                                                                          |
| 89  | `R` Panorama: tarjetas                    | «Regiones con casos» → «Regiones con al menos un caso»; se borran los textos de apoyo de las tarjetas; se revisa la tarjeta «Riesgo alto». ⏳ **Pendiente:** el vocabulario latente/manifiesto (X3).    | P2     | ✔ Hecho 2026-11-23                                                                                          |
| 90  | `C` Panorama: el mapa central             | Retirar el lienzo del panorama. Contradice X2.                                                                                                                                                          | P2     | No se hace (X2)                                                                                             |
| 91  | `R` Panorama: título y notas              | «Vista esquemática por ámbito» → «alcance geográfico»; se borran las dos notas que explican el ancho de banda y el aplazamiento del ubigeo.                                                             | P3     | ✔ Hecho 2026-11-23                                                                                          |
| 92  | `R` Panorama: cabecera y tabla            | El selector de ámbito queda fijo al desplazar; «Casos abiertos» ordenable de mayor a menor.                                                                                                             | P4     | ✔ Hecho 2026-11-23                                                                                          |
| 93  | `R` Casos: limpieza de cabecera y filtros | Fuera «Sistema Nacional de Información de Conflictos», «Red de Monitoreo Activa», el subtítulo «Seguimiento y gestión preventiva», «Monitoreo de compromiso» y el botón «Demandas sin caso» (X5).       | P7, P8 | ✔ Hecho 2026-11-23                                                                                          |
| 94  | `R` Casos: tarjetas normalizadas          | Resumen a 2 líneas con elipsis, etiqueta rotulada («Nivel de riesgo: Moderado»), región sin subsector y fecha de actualización con formato «18 nov 2026».                                               | P7, P8 | ✔ Hecho 2026-11-23                                                                                          |
| 95  | `R` Ficha: retiradas y descarga           | Fuera «Próximo paso» y «Ruta de atención» del cuerpo; en relaciones, fuera «Demandas» y «Última actualización»; el botón dice «Guardar PDF» para quien no es administrador; el ⓘ se pega a su etiqueta. | P10    | ✔ Hecho 2026-11-23                                                                                          |
| 96  | `C` Ruta de atención: eliminar el bloque  | Se borra entero, con sus cinco componentes. Cierra el item 8 como obsoleto (X1).                                                                                                                        | P11    | ✔ Hecho 2026-11-23 (X1)                                                                                     |
| 97  | `C` Expediente reducido a cuatro piezas   | Expediente = Línea de tiempo · Mapeo de actores · Caso de análisis (Canva) · Documentos vinculados. Fuera Hechos, Actores involucrados, Demandas con 3P, Geografía y «FALTA COMPLETAR» (X4).            | P13    | ✔ Hecho 2026-11-23 · Canva declarado no disponible (mockup)                                                 |
| 98  | `R` Tabla de actores del caso             | Columnas «Apellidos, Nombres»; fuera el botón Exportar junto al título y el bloque «Demandas (0)».                                                                                                      | P12    | ◐ Parcial: fila y exportación por fila hechas; falta el dato (apellidos, organización y teléfono por actor) |
| 99  | `N` Exportar con tres salidas             | Combo Excel · PDF · Copiar para WhatsApp. La tercera emite `- Apellidos, Nombres - Organización - teléfono - correo`, una línea por actor.                                                              | P12    | ◐ Parcial: WhatsApp y CSV locales hechos; falta el teléfono (PII)                                           |

### A2 · Componentes e interacción (items 100–109)

| #   | Item                                         | Qué cambia                                                                                                                                                                                                                              | Origen     | Estado                                                          |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| 100 | `N` Casos: filtros de la lista               | Selector desplegable de **Nivel de conflictividad**, independiente del desplegable de estado que sustituyó a los cuatro chips del item 20; el formato tarjetas/tabla pasa a un desplegable a la izquierda; alta de «Búsqueda avanzada». | P7, P8     | ✔ Hecho 2026-11-23 · requiere redeploy (`nivel`)                |
| 101 | `R` Caso: tarjeta y ventana emergente        | Tarjeta estandarizada (small multiples) y ventana con código, título, conflictividad y actualización en la cabecera, resumen y cuatro accesos: Línea de tiempo, Mapa de actores, Acuerdos, Canva.                                       | P7         | ✔ Hecho 2026-11-23 · Canva declarado no disponible              |
| 102 | `N` Mapa de actores como tabla               | El grafo se puede leer como tabla exportable a Excel, además de la vista gráfica.                                                                                                                                                       | P7, P9     | ✔ Hecho 2026-11-23 · CSV y portapapeles locales; falta teléfono |
| 103 | `N` Ventana del caso: dos bloques nuevos     | Menú «Reportes de monitoreo» (alertas, clima social, planes de acción) y bloque «Documentos del caso» con dos grupos: documentos PRODUCE (oficios, actas, informes) y normativa (RM, DS, leyes).                                        | P9         | Mockup                                                          |
| 104 | `R` Alertas: filtros                         | Buscador por código o palabra clave; prioridad con plazo; fuera el filtro «Nivel»; se añaden «Riesgo» y «Sin caso asignado».                                                                                                            | P17        | ✔ Hecho 2026-11-23                                              |
| 105 | `N` Alertas: acciones de Alta Dirección      | La columna Acciones sólo aparece para la alta dirección, con Aprobar · Solicitar modificación · Anular; y un «Enviar» con salida por WhatsApp en texto con negritas.                                                                    | P17        | Requiere dato                                                   |
| 106 | `R` Alertas: tabla                           | Anchos por columna (código estrecho, título ancho, caso estrecho); «Pulse una fila…» sobre la tabla; prioridad con plazo entre paréntesis; fecha «18 nov 2026»; «Atendida» en verde y el resto sin verde.                               | P17        | ✔ Hecho 2026-11-23                                              |
| 107 | `R` Alertas: exportación por perfil          | Dirección conserva todas las salidas; sectoristas sólo Excel y PDF.                                                                                                                                                                     | P17        | ✔ Hecho 2026-11-23                                              |
| 108 | `N` Directorios: portada visual              | Los cuatro directorios abren en una portada de íconos y botones; cada uno lleva a su matriz, que ya no aparece en la primera pantalla.                                                                                                  | F6, F7, E2 | ✔ Hecho 2026-11-23 (`/directorio`)                              |
| 109 | `N` Panorama: «Ver casos» como cajón lateral | El enlace abre un cajón de izquierda a derecha con medio ancho y fondo desenfocado, con el territorio y el ámbito ya aplicados.                                                                                                         | P4         | ✔ Hecho 2026-11-23                                              |

### A3 · Estado, permisos y vistas nuevas (items 110–118)

| #   | Item                                                      | Qué cambia                                                                                                                                                            | Origen | Estado                                                            |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| 110 | `N` Resumen operativo en tres dimensiones                 | Prevención (acciones previstas y alertas tempranas), Gestión (intervenciones y planes de acción) y Seguimiento de compromisos. Reemplaza los KPI sueltos del item 10. | F3     | Mockup (parcial)                                                  |
| 111 | `N` Bandeja: de lista a tablero                           | Tablero con mapa, indicadores y resumen de casos, más la matriz de consulta y edición. Se retira la presentación textual como pantalla de entrada.                    | F4     | Implementable 4                                                   |
| 112 | `N` Alertas, Compromisos y Documentos con el mismo patrón | Indicadores arriba, matriz debajo, igual que casos.                                                                                                                   | F5     | ✔ Hecho 2026-11-23                                                |
| 113 | `C` Ámbito de subsector por rol                           | Dirección y Secretaría General ven ambos subsectores; cada Vice-ministerio, sólo el suyo. Se resuelve en la sesión, no en un filtro.                                  | F13    | Bloqueado (F13)                                                   |
| 114 | `N` Autoridades y agendas por región                      | Directorio de prefectos, subprefectos, sectoristas PCM, extensionistas, alcaldes y direpros, con su agenda y vigencia.                                                | E3, D3 | Mockup                                                            |
| 115 | `N` Auditorios por región                                 | Inventario de sedes donde se hacen reuniones (por ejemplo, Piura), con capacidad y contacto, y su capa en el mapa.                                                    | E4, D4 | ✔ Hecho 2026-11-23 · capa del mapa pendiente (no hay coordenadas) |
| 116 | `N` Clima social: reporte mensual externo                 | No es un índice calculado: es el reporte que producen áreas externas una vez al mes. Se registra por período y región, con su autor y su archivo.                     | D5     | Mockup                                                            |
| 117 | `R` Ayuda memoria y relatoría de reuniones                | La capa de reuniones del item 72 con los documentos tipo 10 y 11 como enlaces y su casilla de cumplimiento.                                                           | D6     | Requiere carga                                                    |
| 118 | `N` Entrada de conflictividad                             | La vista inicial prioriza los casos de conflictividad, no las regiones; bajo el mapa, los casos ordenados por antigüedad y gravedad.                                  | F2     | ✔ Hecho 2026-11-23                                                |

### A4 · Modelo y datos nuevos (items 119–124)

| #   | Item                                           | Qué cambia                                                                                                                                                                                                                            | Origen        | Estado                   |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------ |
| 119 | `N` Catálogo de artes de pesca                 | Jerarquía por grupo (selectivos, cerco, buzos) con precisiones dentro (pinta, macaco…), atributos de tipo pasiva/activa, para qué se usa, dónde y nivel de impacto; y el rango de eslora 0–10, 10–20 y 20–32 m como dimensión aparte. | D1, dirección | Mockup                   |
| 120 | `N` Actores por región × arte de pesca         | Filtro compartido y columnas de contacto, perfil de diálogo y foto. Sin el catálogo 119 no hay eje.                                                                                                                                   | D1            | Requiere dato            |
| 121 | `N` OSPA por región y caleta                   | Marca de OSPA sobre la organización, maestro de caletas y vínculo organización–caleta.                                                                                                                                                | D2            | Implementable 2 + Mockup |
| 122 | `N` Demandas por OSPA                          | Atribución de la demanda a su solicitante para poder cortar por organización, región y arte.                                                                                                                                          | D7            | Requiere dato            |
| 123 | `N` Compromisos asumidos por el Señor Ministro | Dimensión de «asumido por» (Despacho Ministerial) separada de la unidad responsable, por región y arte.                                                                                                                               | D8            | Requiere dato            |
| 124 | `N` Conflictos por región y recurso            | Cerrar el puente caso–recurso del legado: hoy sólo 6 de 35 casos tienen especie, y siempre por la alerta, nunca por el caso.                                                                                                          | D9            | Mockup                   |

Los items **119–124** están dibujados en `docs/07_frontend/mockups/perfil-territorial.html` (2026-11-23): tres artboards con el catálogo de artes, el directorio con OSPA y caleta, y la matriz región × recurso. Los valores de ejemplo van marcados `≈`, cada artboard declara qué campo falta y las cifras citadas se midieron en la base ese día.

### A5 · Integraciones y operación (items 125–127)

| #   | Item                                              | Qué cambia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Origen | Estado                                                        |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| 125 | `N` Capa de derechos acuícolas y sedes en el mapa | El archivo disponible es `gis/Infraestructuras.kml`, no KMZ: **13 456 puntos** y **cero polígonos**. No usa `ExtendedData` (el bloque de metadatos estructurados que KML define junto a la geometría), pero **cada punto sí trae atributos** dentro del HTML de `<description>`. La capa mezcla dos poblaciones: **13 229 derechos acuícolas privados** (`codigo` único, titular, resolución, área, especie y categoría AREL/AMYPE/AMYGE) y **227 sedes institucionales** (`IDENTI`: ITP 34, `DPA - GORE` 30 + 1 con la errata `DPA -GORE`, TUEMPRESA 29, PNACP 27, FONDEPES 27, DIREPRO 26, SANIPES 18, IMARPE 17, anexas 9, INACAL 5, y cuatro con 1 cada una). `DEPARTAMEN`, `PROVINCIA` y `DISTRITO` en los 13 456, `DIRECCION` en 168. Son 835 distritos por nombre y 861 combinaciones oficiales. **Hecho (2026-11-23):** `scripts/kml_infraestructuras.py` tabula los 13 456 puntos con ubigeo INEI en 13 404 y documenta los 52 restantes en `gis/derived/`; `migration/39_gis_infraestructuras.sql` y `migration/loader/cargar_gis.py` los cargan en `gis.infraestructuras_puntos` (13 456 filas verificadas). | F1     | Hecho · los polígonos llegan por la capa distrital (item 128) |
| 126 | `N` RADAR y desembarcaderos FONDEPES en el mapa   | Las redes RADAR instaladas y los desembarcaderos, con símbolo propio y filtro. Los **31** desembarcaderos con nombre propio (`DPA La Islilla`, `DPA Paita`, `DPA Chimbote`) **ya están en el KML** como puntos con `IDENTI DPA - GORE` (uno con la errata `DPA -GORE`) y su distrito: lo que falta son sólo las redes RADAR y el símbolo/filtro de capa.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | E7     | Mockup                                                        |
| 127 | `N` Estado de proyectos de DPA                    | Etapa, expediente y avance de cada desembarcadero artesanal, desde una fuente externa (FONDEPES o Invierte.pe). La lista de los 31 DPA, con nombre, coordenada y distrito, sale del KML; el estado del proyecto **no tiene fuente todavía**, así que el mockup dibuja el panel con datos de ejemplo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | D10    | Mockup                                                        |

### A6 · Capa distrital censal (2026-11-23) — items 128–131

La capa apareció el 2026-11-23: `gis/Poblacion Censo 2025 geogpsperu/`, un shapefile ESRI WGS84 con **1 892 polígonos distritales**, `UBIGEO` INEI de seis dígitos y población por distrito. Su contenido, sus defectos (codificación, desfase en Tayacaja, variantes de nombre, PII del proveedor, procedencia) y lo que desbloquea se describen **una sola vez** en «Capa distrital censal (2026-11-23)»; no se repiten aquí.

| #   | Item                                    | Qué cambia                                                                                                                                                                                                                                                                                                          | Origen | Estado                             |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------- |
| 128 | `N` Cargar la capa distrital            | Tabla `territorio.distrito` (o `gis.distrito`) con `ubigeo` como PK de seis dígitos, `geometry(MultiPolygon,4326)`, centroide calculado en carga y población con su procedencia. El cargador es aparte del KML: son fuentes distintas y no comparten llave salvo `ubigeo`. Exige PostGIS, que la DDL v9 ya declara. | F1     | Requiere carga                     |
| 129 | `N` Panorama sobre límites reales       | Sustituir los 25 centroides compilados a mano (`features/mapa/centroides.regiones.ts`) por los polígonos: coropletas por distrito, los 13 456 puntos del KML dentro de su polígono y agrupación de puntos. Se retira el rótulo «Mapa referencial · sin ubigeo distrital». OSM se queda como fondo.                  | F2     | Mockup · geometría real disponible |
| 130 | `N` Ubicación referencial por centroide | Los auditorios (item 115) y cualquier sede sin coordenada se ubican en el centroide de su distrito. La precisión se declara «distrito», nunca «dirección»: es una ubicación referencial, no la puerta del local. Afecta a `core.locales` (27 filas).                                                                | E4     | Implementable tras 128             |
| 131 | `N` Denominadores poblacionales         | La población permite tasas por 100 000 habitantes en los cortes que ya existen (región, distrito). **No** habilita índice de riesgo ni prioridad de atención: esa regla sigue pendiente de OAIPCS (§2).                                                                                                             | —      | Requiere decisión                  |

**Regla que no cambia con la capa.** La geometría dice _dónde_ está un caso, no _cuánto_ pesa. La
población es denominador, no gravedad: la calibración del riesgo sigue aplazada (§4). Y la diferencia
entre los **1 892** distritos de la capa y los **1 874** de INEI se **declara**, no se corrige a mano:
un ubigeo inventado para cuadrar el total es peor que el descuadre.

### Diagnóstico y diseño (2026-11-23)

**Cómo se leyó.** Cada item se contrastó con la SPA (`angular/src/app`), con la API (`app/api/**`, `lib/db/**`) y con la base local. Los verdictos significan: `Implementable n` = se hace hoy con lo que hay, `n` es la dificultad del catálogo 1–5; `Mockup` = no hay dato ni fuente ratificada, se dibuja y se declara; `Requiere dato` = la columna no existe, o existe y el perfil no puede escribirla; `Bloqueado` = depende de una contradicción o de una decisión de producto.

**Hallazgos que cambian el pedido.**

1. Varias anotaciones describen la UI **Next congelada**, no la SPA: «Sistema Nacional de Información de Conflictos», «Red de Monitoreo Activa», «Seguimiento y gestión preventiva» y «Monitoreo de compromiso» no existen en Angular. El item 93 queda reducido a retirar el enlace «Demandas sin caso».
2. **«Apellidos, Nombres» ya está en la UI**: `nombreActor()` concatena lo que llega. Lo que falta es el dato: `core.actores` sólo tiene `nombre_actual`, sin apellidos ni nombres separados.
3. **El teléfono no viaja con el actor del caso.** `ActorCaso` expone `correo` pero no `telefono`, y el teléfono es PII sujeta a `puedeVerPii`. Sin eso, la línea de WhatsApp del item 99 sale incompleta.
4. **«Nivel» y «Riesgo» de las alertas son el mismo campo** (`cat_niveles_alerta`): quitar uno y añadir el otro no cambia la fila. Lo que sí falta es `sinCaso`, que hay que añadir en `lib/db/repos/alerts.ts` y en `app/api/v1/alerts`.
5. **No hay rol de viceministerio ni ámbito de subsector.** `capacidades.service.ts` conoce 10 roles y `lib/db/scope.ts` devuelve siempre `{mode:"all"}`. El item 113 no es interfaz: es modelo de permisos más RLS.
6. **La ventana emergente del caso no existe**: `caso-panel.component` es el formulario de alta. El item 101 exige un componente de vista previa nuevo; el resto de la tarjeta ya está.
7. **El expediente y el riel ya son componentes** (`expediente-completitud.component`, `riel-relaciones.component`), así que el item 97 es retirar bloques, no construir. «Caso de análisis (Canva)» no existe como enlace ni como campo: esa parte es mockup.
8. **`/mapa` ya es la raíz de la navegación** y dibuja OpenStreetMap con un círculo por centroide. Por eso X2 se resuelve conservando el lienzo: borrarlo revertiría la decisión de producto de 2026-11-22.
9. **El menú de exportación es único y no ve las filas.** `exportar-menu.component` emite JSON/Excel/PDF desde el endpoint; «copiar para WhatsApp» necesita el contenido de la tabla, así que vive en la tabla de actores y no dentro del menú.

**Lo que la medición cambió respecto de la primera lectura.** Cuatro items bajan de dificultad porque el dato ya está cargado, y dos suben porque no existe:

| Item                       | Primera lectura  | Medición                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 115 Auditorios             | catálogo nuevo   | `core.locales` tiene **27 filas, 23 con aforo y contacto**, y la pantalla `/directorio/locales` existe: sólo faltan el rename y la capa del mapa.                                                                                                                                                                  |
| 117 Ayuda memoria          | mockup           | `legacy.dim_redaccion` tiene **51 filas** sin cargar: es trabajo de cargador, no de dibujo.                                                                                                                                                                                                                        |
| 121 OSPA por región        | mockup           | Con la migración 38 las 224 organizaciones ya tienen región donde el origen la trae (**119**); la marca OSPA (`expediente_ospa`/`estado_ospa`) y el maestro de caletas (`territorio.caleta_detalle`) **existen como estructura pero están vacíos** (0 de 224 y 0 filas), así que su contenido sigue siendo mockup. |
| 114 Autoridades            | directorio nuevo | `legacy.dim_autoridades` tiene **2 filas**: no hay fuente. Los 15 sectoristas sí existen como usuarios con territorio (`usuario_territorio`, 25).                                                                                                                                                                  |
| 116 Clima social           | reporte mensual  | `legacy.dim_climasocial` **7** y `dim_climasocial_focalizado` **6**: existe pero es demasiado ralo para una pantalla; se dibuja.                                                                                                                                                                                   |
| 124 Conflictos por recurso | puente a cerrar  | `legacy.bridge_caso_recurso` tiene **0 filas**: no hay puente que cerrar. Sólo `alerta_especies` (6 casos) sostiene el corte por recurso.                                                                                                                                                                          |

**Diseño por lote.** Los cambios se agrupan por pantalla para que un mismo componente no se toque dos veces.

- **Lote A · Casos y ficha** (88, 93, 94, 95, 96, 97, 100, 101, 102, 106). Es el patrón que copian los demás módulos: lista con conflictividad y tarjetas normalizadas, ficha sin «Próximo paso» ni «Ruta de atención», expediente de cuatro piezas y tabla de actores con exportación local. Nada de este lote necesita columnas nuevas salvo el teléfono (item 99).
- **Lote B · Panorama, alertas, directorios y bandeja** (89, 91, 92, 107, 108, 109, 111, 112, 115, 118). El panorama conserva el lienzo y gana casos priorizados debajo; alertas y directorios adoptan el patrón de portada con indicadores. Las capas KMZ y RADAR se dibujan sobre el mismo mapa.
- **Lote C · Datos y permisos** (98, 99, 104, 105, 113, 117, 119–124). Todo lo que exige columnas, roles o catálogos nuevos. Se entrega como diseño al equipo de .NET con el contrato de API al lado; la SPA sólo consume.
- **Reunión** (103, 110, 114, 116, 125–127). Pantallas sin fuente: se muestran como mockup y no se implementan hasta que OAIPCS ratifique el dato.

### Cierre del lote A (2026-11-23)

Se aplicó el lote A en la SPA, además del lote B (panorama, alertas, directorios y shell). Nada de esto añadió columnas nuevas; lo que faltaba es dato, no forma.

| Pieza       | Archivos                                                                                     | Qué trae                                                                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell       | `layouts/shell/shell.component.*`, `core/atajos/atajos.service.ts`                           | Ámbito vigente en lugar del badge fijo «Sistema operativo»; «Panorama territorial» primero en la navegación; retirado el `<button>` muerto «Gestión territorial»; `Ctrl/⌘+K` abre la búsqueda global y `/` enfoca el buscador de la lista activa (item 64).                                                                            |
| Casos       | `features/casos/casos.page.*`, `caso-vista-previa.component.*`                               | Estado en desplegable con conteos y **Nivel de conflictividad** en la URL (`?nivel=`), búsqueda avanzada plegable, vista tarjetas/tabla en desplegable, tarjetas normalizadas a 2 líneas con «Nivel de riesgo: X», «Actualización: dd mmm aaaa» e «Inicio» al final de la tabla; la tarjeta abre la vista previa (items 94, 100, 101). |
| Ficha       | `features/casos/caso-detalle.page.*`, `riel-relaciones.component.*`, `glosario.contenido.ts` | Fuera «Próximo paso» y «Ruta de atención»; riel de cuatro piezas con «Caso de análisis (Canva)» **declarado no disponible**; «Guardar PDF» para el perfil no administrador; tabla de actores con `Copiar para WhatsApp` y `Exportar CSV` locales; ⓘ de glosario en los nueve términos acordados (items 95–99, 102).                    |
| Alertas     | `features/alertas/*`, `shared/ui/exportar-menu.component.ts`                                 | Filtros de riesgo y «Sin caso asignado» (`sinCaso` en repositorio y ruta), anchos de columna, prioridad con plazo, «Atendida» en verde; exportación por perfil (items 104, 106, 107, 112).                                                                                                                                             |
| Panorama    | `features/mapa/*`                                                                            | «Regiones con al menos un caso», «Alcance geográfico», columna «Casos abiertos» ordenable, cajón lateral de «Ver casos» con la región y el ámbito aplicados, y tabla de casos abiertos por antigüedad y gravedad bajo el mapa (items 89, 91, 92, 109, 118).                                                                            |
| Directorios | `features/directorio/directorio.page.*`, `locales.page.html`                                 | Portada `/directorio` con tarjetas por matriz; «Locales» pasa a **Auditorios** en la navegación y en la pantalla (items 108, 115).                                                                                                                                                                                                     |

**Lo que el lote A deja abierto, con su motivo.**

1. **`nivel` es superficie nueva de API.** `lib/db/repos/cases.ts`, `app/api/v1/cases/route.ts` y `app/api/v1/export/route.ts` conocen el filtro; hasta el redeploy, un servidor antiguo lo ignora en silencio y la lista no se recorta. No rompe la pantalla y está anotado en `CONTRATO_API_SPA.md`.
2. **98 y 99 necesitan dato, no diseño.** `core.actores` sólo tiene `nombre_actual`: no hay apellidos y nombres separados, ni organización por actor en la ficha, ni teléfono en `ActorCaso` (es PII). Por eso la salida para WhatsApp emite la línea con los campos que existen y la organización/teléfono salen incompletos: se declara, no se rellena.
3. **La exportación de actores es local.** `/v1/export` no acepta `caso` como filtro de `actores`, así que `Copiar para WhatsApp` y `Exportar CSV` se construyen en cliente sobre `d.actores`; el menú de exportación sigue siendo la vía para las entidades completas.
4. **X4 a medias.** El indicador de completitud se retiró del expediente, pero **no se movió a bandeja ni a dirección**: no existe un endpoint agregado de completitud. Se declara aquí para no dar por cerrado lo que no lo está; construirlo exige una consulta nueva, no una pantalla.
5. **115 ya puede tener capa, pero sólo a precisión de distrito.** `core.locales` registra distrito y no coordenadas, y no se inventan posiciones. Con el shapefile distrital (item 128) el local se ubica en el **centroide de su distrito** (item 130): es una ubicación referencial y así se rotula, no la puerta del local.
6. **El filtro de conflictividad se validó contra la base local.** El catálogo tiene las cuatro etiquetas (`Diferencia`, `Controversia`, `Conflicto social`, `Crisis social`) y `filtrarPorCatalogo` las resuelve con `core.normalizar_ref`, igual que `riesgo`. Verificado: 35 casos (35 en estado `Abierto`, 34 vigentes), 13 en «Conflicto social», 20 en «Controversia», 1 en «Diferencia», 1 sin nivel declarado.
7. **El Anexo 15 quedó cerrado con `security_invoker=true`.** Confirmado en la base junto con los anexos 14, 16 y 17; los 35 casos tienen alcance derivado (`core.alcance_caso`) sin ningún nulo, y el `LEFT JOIN` de `migration/32` publica «—» en las columnas sin dato en vez de omitir la fila.

**Lo que no se dibuja todavía.** El item 90 queda descartado por X2. El 113 no se dibuja como pantalla: es una regla de sesión. El vocabulario **latente/manifiesto** de X3 está **adoptado por la dirección** y **pendiente** de ratificación de OAIPCS y de implementación: no se rotula todavía, y mientras tanto la ficha sigue midiendo «Nivel de conflictividad».

### Duplicidades resueltas (no se construye dos veces)

| Pedido nuevo                                | Item existente que ya lo cubre                    | Qué se hace                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Etiqueta «alcance geográfico» (P3)          | Item 6, alcance calculado desde región            | ✔ Hecho 2026-11-23: el renombrado y el cálculo derivado (`core.alcance_caso`) están; no se duplica.                                                |
| ⓘ del glosario junto a cada etiqueta (P10)  | Item 7                                            | Mismo componente; sólo cambia su posición en la ficha.                                                                                             |
| Quitar «Demandas» de relaciones (P10 y P13) | Item 12 y ficha de demandas                       | Se retira el acceso repetido, no la pantalla.                                                                                                      |
| Exportar por perfil (P17)                   | Items 30 y 42                                     | Mismo menú de exportación con reglas de rol; no hay un segundo botón.                                                                              |
| Reordenar y filtrar alertas (P17)           | Item 22                                           | Mismo catálogo y misma consulta; se amplían filtros.                                                                                               |
| Bandeja como tablero (F4)                   | Item 22                                           | Una sola bandeja: el 111 sustituye la concatenación del 22; no se dibujan dos.                                                                     |
| Documentación normativa en la ficha (P9)    | Item 17                                           | Absorbido por el bloque «Documentos del caso» del 103; el 17 no se construye.                                                                      |
| Directorios con portada visual (F6, F7)     | Items 45 y 46                                     | Se reordena la entrada, no se reescribe el CRUD.                                                                                                   |
| Auditorios por región (E4, D4)              | `core.locales` (27 filas) y `/directorio/locales` | ✔ Hecho el rename a «Auditorios». La capa del mapa sale del centroide de distrito (item 130), con precisión declarada; no hay coordenada de local. |
| Mapa como ventana principal (F2)            | Items 27, 33, 53 y 63                             | Un solo mapa y ya es la raíz de la navegación (X2 resuelta: se conserva).                                                                          |
| Completitud (X4)                            | Item 68                                           | Se retiró del expediente, pero **aún no se movió** a bandeja ni a dirección: no hay endpoint agregado.                                             |
| Mapa de actores como tabla (P7, P9)         | Tabla de actores de la ficha                      | Ya existe y ya exporta; se le añaden columnas, no una segunda tabla.                                                                               |

### Plomería que esta ampliación destapa

1. **`p12_envios.py`.** Verificado el 2026-11-23: el archivo existe con su nombre correcto y `registry.py` lo importa. No hay nada que corregir; el nombre duplicado que se vio en una lectura anterior era un artefacto de la terminal.
2. **Región de las organizaciones — hecho el 2026-11-23.** Las 224 organizaciones tenían `region_id` nulo porque `p05_actores.py` leía `DIM_ORGANIZACION.ID_Ubigeo` (columna 3) y lo descartaba. Corregido en dos piezas: el cargador resuelve la región desde el prefijo INEI de las provincias de ese departamento (misma regla que las fases 1 y 6) y la migración `migration/38_actores_region_organizaciones.sql` lo aplica sobre los datos ya cargados. Resultado idéntico en local y en Neon: **119 de 224 con región; 105 declaradas** (103 sin ubigeo en el origen y 2 con `DEP-20` «Más de Uno», que no es una región). `checks.py` fija esas dos cifras. Las personas no se tocaron: siguen 236 con región por el parche post-carga.
3. **Distrito de los actores.** Los 1 160 actores tienen `distrito_id` nulo por diseño: el ubigeo del origen es departamental. No se estima; se declara. Es el mismo bloqueo del item 21 y del pendiente P10.
4. **Fuentes del legado, ya medidas.** Antes de prometer los items 114, 116 y 124 había que saber si las tablas del staging tenían datos utilizables; medido el 2026-11-23: `dim_autoridades` **2**, `dim_climasocial` **7**, `dim_climasocial_focalizado` **6**, `dim_redaccion` **51**, `bridge_caso_recurso` **0**, `bridge_actor_grupo` **0**, `bridge_radar_actor` **1**, `bridge_nodo_actor` **3**, `dim_punto_focal` **17**, `dim_sectoristas` **15**. Conclusión: 117 es carga real; 114, 116, 124 y 126 no tienen masa crítica y se quedan en mockup.
5. **El artefacto V10 no conoce la región de las organizaciones.** El bloque de cierre de `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql` sólo rellena `core.actores.region_id` desde `legacy.dim_actores`. Al regenerarlo hay que añadir el bloque de `legacy.dim_organizacion`, o el cargador y el parche quedarán en desacuerdo en la próxima instalación limpia.

## Prioridad visual unificada · mockups para Figma y para el equipo .NET

**Qué reemplaza.** Las dos tablas de prioridad que convivían en el documento —«Prioridad visual de los
mockups» (§Entrega) y «Prioridad visual para la reunión con el equipo de .NET»—: ordenaban las mismas
piezas con dos criterios distintos y dibujaban tres pantallas dos veces (ficha, bandeja, directorio).
Aquí hay una sola lista, ordenada por **impacto visual por unidad de esfuerzo de dibujo**, que declara
la dificultad de implementación, el costo de dibujo y el lote de «Diseño por lote» de cada pieza.

**Tres escalas que no se confunden:**

| Escala      | Qué mide                                                                                      | Dónde vive          |
| ----------- | --------------------------------------------------------------------------------------------- | ------------------- |
| `D1`–`D5`   | Dificultad de **implementación**: dato, regla e integración                                   | items 1–87, §Escala |
| Impacto 1–5 | Cuánto nota un evaluador que la pieza falta y cuánto explica por sí sola la ausencia del dato | esta tabla          |
| Costo B/M/A | Esfuerzo de **dibujo** en Figma: bajo, medio, alto                                            | esta tabla          |

| #   | Pantalla                                        | Items                            | D     | Impacto | Dibujo | Lote      | Reunión | Por qué y qué dato exige                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------- | -------------------------------- | ----- | ------- | ------ | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Panorama territorial corregido                  | 89–92, 109, 118                  | D1–D2 | 5       | M      | B         | Sí      | Es la ventana de entrada y concentra ocho observaciones. Casos abiertos por ámbito y región (`/v1/cases?conteos=true`), catálogo `regiones` y teselas OSM. Lienzo conservado (X2). Los polígonos distritales y la nube de puntos del KML se dibujan sobre **este mismo artboard**, en la pieza 9.                                                                                                                                                                                                                                                                                                                      |
| 2   | Casos: tarjetas y ventana emergente             | 93–94, 100–102                   | D2    | 5       | M      | A         | Sí      | Es el flujo diario y define el patrón que copian los demás módulos (112). Riesgo, conflictividad, temática, región, `fecha_inicio`; el mapa de actores como tabla exige exportable.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | Directorios con portada visual                  | 108, 115                         | D1–D2 | 4       | M      | B         | Sí      | Cierra «no puedo ver los actores». `core.locales` ya tiene **27 filas y 23 con aforo y contacto**: sólo faltan el rename y la capa del mapa.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Alertas: filtros y acciones                     | 104–107                          | D2    | 4       | M      | B–C       | Sí      | Alto uso y roles claros. Una sola barra de acciones: 23 y 105 no pueden pintar dos; 107 reutiliza el menú de 42/70.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | Bandeja como tablero                            | 111–112                          | D3    | 4       | A      | B         | Sí      | Responde a «no queda clara su utilidad». Asignar, posponer y responsable no están persistidos (item 50): el hueco se declara.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | Resumen operativo en tres dimensiones           | 110                              | D2    | 4       | B      | Reunión   | Sí      | Alinea la portada analítica con la Guía. Comparte definición de métrica con el dashboard (51) o los dos se contradicen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | Anexo 15 · matriz de conflictividad             | vista 15 · 42                    | D3    | 4       | B      | —         | Sí      | Se imprime y se lleva a una reunión. La vista ya no omite casos (migración 32), así que el mockup explica la celda vacía, no una pantalla ausente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | Ficha del caso (dos artboards)                  | 12–18, 41, 67–68, 95–99, 102–103 | D2–D3 | 5       | A      | A–Reunión | Sí      | Es la pantalla más visitada y hoy es un scroll de nueve tablas apiladas. Sin «Próximo paso» ni «Ruta de atención» (95–96, X1 resuelto) y con la completitud fuera del expediente (X4). Reuniones (72), Historial (41) y Canva (103) se dibujan sin dato.                                                                                                                                                                                                                                                                                                                                                               |
| 9   | Mapa con activos, RADAR y desembarcaderos       | 125–126                          | D2–D5 | 4       | A      | Reunión   | Sí      | Es lo que la dirección quiere ver, sobre el mismo artboard de la fila 1. `gis/Infraestructuras.kml` da **13 456 puntos** reales —13 229 derechos acuícolas privados y 227 sedes institucionales— con departamento, provincia y distrito y, en las sedes, la institución dueña; el ubigeo INEI ya está resuelto en 13 404 de 13 456 (`gis/derived/infraestructuras_puntos.csv`); los polígonos distritales ya existen como archivo (`gis/Poblacion Censo 2025 geogpsperu/`, 1 892) y los de infraestructura no. Los 31 desembarcaderos (`IDENTI DPA - GORE`, uno con la errata `DPA -GORE`) ya salen del mismo archivo. |
| 10  | Perfil territorial: arte de pesca, OSPA, caleta | 119–124                          | D4    | 3       | M      | C         | Sí      | Necesita catálogo ratificado. Con la migración 38 las 224 organizaciones ya tienen región donde el origen la trae (119); la marca OSPA y el maestro de caletas existen como columna y tabla pero están vacíos (0 de 224 y 0 filas). `bridge_caso_recurso` tiene **0 filas**. Dibujado en `mockups/perfil-territorial.html`.                                                                                                                                                                                                                                                                                            |
| 11  | Autoridades, clima social y DPA                 | 114, 116–117, 127                | D4–D5 | 2       | M      | C–Reunión | Sí      | Mixta: **117 es carga real** (`legacy.dim_redaccion`, 51 filas) y se implementa al cargar; 114 (`dim_autoridades`, 2 filas), 116 (7 y 6) y 127 no tienen masa crítica y se quedan en mockup.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 12  | Registrar ▾ en el shell                         | 65–66, 72                        | D2    | 4       | B      | —         | No      | El archivo ya existe. Es el cuello de botella del registro: sin alta en contexto, cada registro obliga a cambiar de pantalla. La opción «Reunión» se dibuja deshabilitada hasta el item 72.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 13  | RED/RADAR, notificaciones y derivación          | 31, 76, 23                       | D3    | 3       | M      | —         | No      | El archivo ya existe. La campana sin centro es el hueco más visible del shell, pero el punto se retiró: el mockup no puede reintroducirlo ni mostrar un contador sin `PATCH`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 14  | Dashboard analítico                             | 51, 52, 57, 85                   | D4    | 3       | A      | —         | No      | El archivo ya existe y se mantiene en el plan. Se dibuja con métricas nombradas: cada gráfico declara consulta, fuente y estado vacío.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 15  | ETL de tres pestañas                            | 58–62, 86, 87                    | D5    | 2       | A      | —         | No      | El archivo ya existe. Operación interna que casi nunca se evalúa en una demo, pero sostiene la carga real.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Cuadrante impacto × costo de dibujo.** Las casillas dicen qué hacer en la sesión:

|                 | Dibujo bajo (B/M) | Dibujo alto (A) |
| --------------- | ----------------- | --------------- |
| **Impacto 5**   | 1, 2              | 8               |
| **Impacto 4**   | 3, 4, 6, 7, 12    | 5, 9            |
| **Impacto ≤ 3** | 10, 11, 13        | 14, 15          |

**Lo visualmente prioritario que sigue pendiente (2026-11-23).** De esta tabla, las filas **1, 2, 3, 4 y parte de la 8 ya están implementadas en la SPA** (items 89–118), así que no se dibujan para decidir forma: se dibujan, si acaso, como referencia de paridad para el equipo .NET. Lo que de verdad sigue pendiente y es lo más caro de ver cuando falta es esto, en orden de impacto:

| Orden | Pieza pendiente                                                       | Items                 | Por qué encabeza la lista                                                                                                             |
| ----- | --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Ficha del caso**: Historial, Reuniones, Canva y Documentos del caso | 41, 72, 103           | Es la pantalla más visitada y la que más se ha recortado (95–97, X1). Los cuatro bloques nuevos se dibujan sin dato y así se declara. |
| 2     | **Bandeja como tablero**                                              | 111                   | Responde a «no sé para qué sirve». Hoy es una lista; el mockup fija mapa + indicadores + matriz y el hueco de asignación (50).        |
| 3     | **Resumen operativo en tres dimensiones**                             | 110                   | Es la portada analítica y comparte definición de métrica con el dashboard: si no se dibujan juntos, se contradicen (51).              |
| 4     | **Mapa con activos, RADAR y desembarcaderos**                         | 125–126               | Lo que la dirección pide ver. Los 13 456 puntos y los 31 DPA existen; falta el símbolo, el filtro y las redes RADAR.                  |
| 5     | **Anexo 15 · matriz imprimible**                                      | vista 15 · 42         | Se lleva a una reunión. Ya no omite casos (migración 32): el mockup explica la celda vacía, no una pantalla ausente.                  |
| 6     | **Perfil territorial: arte de pesca, OSPA, caleta**                   | 119–123               | Es la petición más repetida de la directora, pero depende de un catálogo que no existe: se dibuja con datos de ejemplo y se declara.  |
| 7     | **Registrar ▾ en el shell**                                           | 65–66, 72             | Sin alta en contexto cada registro obliga a cambiar de pantalla; «Reunión» se dibuja deshabilitada hasta el item 72.                  |
| 8     | **RED/RADAR y notificaciones**                                        | 31, 76                | La campana sin centro es el hueco más visible del shell; el mockup no puede mostrar un contador que el `PATCH` aún no sostiene.       |
| 9     | **Autoridades, clima social y DPA**                                   | 114, 116–117, 127     | Impacto bajo y fuente rala (`dim_autoridades` 2 filas, clima social 7 y 6), salvo 117, que es carga real y se implementa al cargar.   |
| 10    | **Dashboard analítico y ETL**                                         | 51, 52, 57, 85, 58–62 | Archivos que ya existen y sólo se actualizan; no encabezan la sesión.                                                                 |

**Olas de producción.** El orden de la tabla es el de dibujo; las olas agrupan por sesión.

- **Ola 1 · siete artboards (1–7).** Panorama, casos, directorios, alertas, bandeja, resumen y Anexo 15. Todas con dato salvo la bandeja (la asignación del item 50 no está persistida), los directorios (la capa del mapa) y el resumen (métricas declaradas). Es la pasada que se presenta.
- **Ola 2 · cuatro piezas (8–11).** Ficha en dos artboards, mapa con la nube de puntos, perfil
  territorial y las fuentes sin medir. La ficha es la más visitada y la más cara: si quedan cuarenta
  minutos al final de la ola 1, se empieza ahí en lugar de terminarla.
- **Ola 3 · cuatro redibujos (12–15).** Registrar, RED/RADAR, dashboard y ETL: archivos que ya existen
  y sólo se actualizan con lo decidido el 2026-11-23.

**Regla de anotación de cada artboard.** Cinco bloques en el encabezado, para que el equipo .NET pueda
dimensionar backend sin preguntar:

1. Items que cubre, con su número del catálogo y su fila de «Diseño por lote».
2. Dato que necesita cada celda, con el nombre del campo y la ruta de `CONTRATO_API_SPA.md`, o «no existe».
3. Qué es sólo forma y no debe implementarse.
4. Qué está bloqueado y por qué: `X1` (Ruta de atención), `X2` (lienzo del mapa), `X4` (completitud), `X5` (demandas sin caso).
5. Roles que ven cada bloque (105, 107 y el ámbito de subsector de 113, que no dibuja pantalla).

**Insumos que faltan pedir.** Dos piezas desbloquean más items que cualquier mockup. El ubigeo y la
composición de la capa ya no están entre ellas:

- **Polígonos de infraestructura** si se quieren áreas: `Infraestructuras.kml` trae puntos y la capa distrital trae polígonos de distritos, no de instalaciones; el requisito de polígonos del item 125 sigue sin cumplirse.
- ~~Los distritos que la tabla de equivalencias no trae~~ **Resuelto (2026-11-23) por la capa distrital.** De los 52 puntos del KML sin ubigeo, **50 se resuelven por nombre** contra `gis/Poblacion Censo 2025 geogpsperu/`: Boquerón `250307` (25 puntos), Huipoca `250306` (22), San Antonio `180107` (1), Hualla `051010` (1) y Unión Progreso `050512` (1). Quedan **2** que no son distrito: `MATARANI` (puerto de Islay) y `MAZAMARI - PANGOA` (dos distritos en una celda). **Resuelto y aplicado (2026-11-23):** el catálogo se reconstruyó desde el INEI y las 13 456 infraestructuras se re-vincularon por nombre; Matarani quedó sembrado como `lugar` de Islay. Ver «Catálogo territorial corregido y alta de caso por distrito».
- **Decisión sobre los 13 229 titulares**: la capa es mayoritariamente privada y `titular` es dato
  personal (Ley 29733). El GeoJSON ya los omite; falta decidir si la API pública agrega por distrito o
  aplica RLS.

**Lo que ya no hay que pedir.** El ubigeo está resuelto. `gis/equivalencia-ubigeos-oti-concytec.csv`
trae **1 874 distritos** con código INEI, RENIEC y SUNAT, y `scripts/kml_infraestructuras.py` deja los
13 456 puntos tabulados en `gis/derived/infraestructuras_puntos.csv` con ubigeo en 13 404, GeoJSON y una
columna `metodo_ubigeo` que dice qué se resolvió por corrección de `scripts/toponimos.json` y qué no se
resolvió a propósito. También está resuelta la composición: no son 13 456 instalaciones de PRODUCE,
sino 13 229 derechos acuícolas privados y 227 sedes institucionales, y el extractor ya separa ambas en
`tipo_registro`. La capa quedó cargada en `gis.infraestructuras_puntos` (13 456 filas), con
`distrito_id` resuelto en **13 454 de 13 456** (2026-11-23; antes 313 de 854, medido contra el catálogo roto). Eso desbloquea
21, 27, 33, 35–36 y 53 para construir, aunque el modelo todavía tenga que adoptar el código como llave
en lugar del texto libre. El **límite distrital** tampoco hay que pedirlo: la capa distrital lo trae (1 892 polígonos), con la salvedad del catálogo de distritos que se detalla más abajo.

**Notas de normalización de la capa GIS.** `scripts/toponimos.json` y la columna `*_inei` de la tabla
OTI/CONCYTEC fijan los nombres oficiales; el KML se conserva sólo como fuente:

- El departamento `CALLAO` existe, pero su provincia oficial es `PROV. CONST. DEL CALLAO` (4 distritos).
- El distrito de Puerto Maldonado se llama oficialmente **`TAMBOPATA`** (170101).
- El KML usa «TARAPOTO» como provincia; el distrito 220901 pertenece a **`SAN MARTIN`**.
- `PUERTO SUPE`→`SUPE PUERTO`, `QUILLCA`→`QUILCA`, `CALETA CARQUIN`→`CALETA DE CARQUIN`,
  `CERCADO DE LIMA`→`LIMA`, `VENTISEIS DE OCTUBRE`→`VEINTISEIS DE OCTUBRE`,
  `BANDA DE SHILCAYO`→`LA BANDA DE SHILCAYO`, `CAJAMRCA`→`CAJAMARCA` y otros seis se corrigieron;
  `metodo_ubigeo` dice cuál fue el caso de cada fila (`exacto`, `provincia aproximada`,
  `distrito corregido`, `truncado`, `fuera del ubigeo`, `parecido descartado`).
- El parecido ortográfico se descarta si no lo respalda `toponimos.json`: es mejor un hueco que un
  ubigeo inventado (por eso `MARISCAL NIETO / SAN ANTONIO` quedó sin código).
- `FECHA_EMIS`/`FECHA_VIGE` se emiten en ISO desde `d/m/yyyy`; `TIPO_COORD` se unifica a mayúsculas;
  `categoria_codigo` extrae AREL/AMYPE/AMYGE y conserva el texto completo en `categoria_productiva`.
- `titular` y `nombre` son PII: el GeoJSON los omite y expone `etiqueta` en su lugar
  («Derecho acuícola 7241», la sede del PNACP o el nombre de la instalación).

### Capa distrital censal (2026-11-23)

**Archivo.** `gis/Poblacion Censo 2025 geogpsperu/` es un _shapefile_ completo (`shp`, `shx`, `dbf`,
`prj`, `cpg`) en **WGS84**. Verificado el 2026-11-23: **1 892 registros**, todos de tipo polígono (5),
**1 906 partes** y **1 705 670 vértices**, con **ningún polígono vacío**. La extensión cubre
−81,33 a −68,65 de longitud y −18,35 a −0,04 de latitud —el territorio continental— y la capa resuelve
**196 provincias y 25 departamentos**: la estructura departamental y provincial completa.

**Atributos.** `UBIGEO` de seis dígitos, único y válido en las 1 892 filas; `DEPARTAMEN`, `PROVINCIA` y
`DISTRITO` por fila. Población por sexo, donde `C` es población **censada**, `O` **omitida** y
`Total = Total_C + Total_O` —comprobado aritméticamente en todas las filas muestreadas—; la suma de
`Total` es **34 157 732**.

**Qué desbloquea.** (a) Los **ubigeos que faltaban**: de los 52 puntos del KML sin ubigeo, **50 se
resuelven por nombre** contra esta capa. (b) La **geometría distrital** que exigían 21, 27, 33, 53 y el
selector de distrito por ubigeo. (c) La **población como denominador**, para tasas por distrito sin
estimar.

**Defectos que hay que corregir antes de cargar.** Se declaran, no se silencian:

1. **Codificación.** El `.dbf` está en UTF-8 y su `.cpg` no lo declara como tal; leído como latin-1,
   diecisiete nombres salen con mojibake (`QUEQUEÃ‘A`, `OCAÃ‘A`, `ENCAÃ‘ADA`, `KOSÃ‘IPATA`). Se lee
   como UTF-8 y se normaliza con `scripts/toponimos.json`.
2. **Desfase en Tayacaja (0907).** La capa **no trae `090708` (Huaribamba) ni `090712`
   (Salcabamba)** y los nombres de `090709` a `090721` quedan corridos una fila: `090709` dice
   `HUARIBAMBA` cuando debería decir `NAHUIMPUQUIO`. La población de esa provincia quedaría atribuida
   al distrito equivocado, así que se resuelve **por geometría**, no por nombre, antes de usarla.
3. **Variantes de nombre**, cuatro fuera de ese desfase: `SAN FRANCISCO DEL YESO` / `DE YESO`,
   `SANTA CRUZ DE TOLED` (truncado), `SAN PEDRO DE LARAOS` / `LARAOS` y `RAYMONDI` / `RAIMONDI`. El
   caso `051010` es el que hay que ratificar: la tabla OTI dice `HUAYA`, la capa dice `HUALLA` y el KML
   coincide con la capa, de modo que **no se corrige por mayoría**: se pide el nombre oficial.
4. **PII de terceros.** El `.dbf` trae `descargar`, `contacto` y `whatsapp` con los datos de contacto
   del proveedor. Se eliminan al derivar: no son atributos del territorio.
5. **Procedencia.** Es un archivo de un proveedor (`geogpsperu`) rotulado «Censo 2025», **no una
   publicación del INEI**. Se declara la procedencia y la cifra se presenta como _del archivo_ hasta
   que OGTI u OAIPCS la validen; no se rotula «cifra oficial».

**El catálogo de distritos arrastra un defecto que esta capa destapa.** `core.distritos` tiene **698**
filas frente a las 1 892 de la capa: 684 ubigeos coinciden y **1 208 distritos no están en el
catálogo**. Pero además, **68 de las 698 filas tienen un nombre que no corresponde a su `UBIGEO`
oficial** y 14 ubigeos no existen en la tabla OTI. Cotejado contra OTI, el error es del catálogo, no de
la capa: `120102` figura como _Carhuacallanga_ cuando la oficial es `120104`, y `070106`/`070107`
están invertidos (Ventanilla y Mi Perú). Esto no es cosmético: `gis.infraestructuras_puntos` tiene
**6 213 puntos con `distrito_id`** resuelto por ubigeo contra ese catálogo, así que en las provincias
afectadas el mapa nombra un distrito y muestra otro. La corrección es regenerar `core.distritos` desde
la capa (o desde OTI) y volver a resolver `distrito_id`; hasta entonces, la etiqueta de distrito del
mapa se marca como provisional.

**Cambios respecto a la tabla de la reunión (2026-11-23).** El Anexo 15 entra en la ola 1 y no se
queda fuera, como se decidió. El resumen en tres dimensiones también. El dashboard **no sale del plan**:
figura en la ola 3 junto a los otros tres archivos que ya existen. La ficha del caso se recupera como
pieza propia —era la única pantalla de alto impacto ausente de la lista— y se parte en dos artboards.
La antigua fila 9 se reduce a 114, 116, 117 y 127 porque 115 ya se había movido a Directorios; y dentro
de ella se separa 117, que es carga real, del resto, que no tiene fuente.

**Lo que sigue fuera.** 72–78 (reuniones, captura de actas, generador de anexos, relatoría, clima
social) no tienen tabla ni endpoint, y 79–84 (triangulación, recurrencia, memoria institucional,
argumentario) son capacidad analítica, no pantalla. Dibujarlos sería fijar una forma sin saber qué la
alimenta.

## Catálogo territorial corregido y alta de caso por distrito (2026-11-23)

**Qué estaba mal.** `core.distritos` tenía **698 filas** con el `ubigeo` asignado en secuencia
**alfabética y contigua** dentro de cada provincia, sin respetar los huecos de numeración del INEI.
El resultado: 68 nombres desalineados (`120104` decía `Chicche` cuando el INEI dice
`Carhuacallanga`), 14 ubigeos que el INEI nunca asignó, provincias corridas (Huancayo +2, Chiclayo
+2 con `Saña` y `Zaña` duplicadas, Callao con `Ventanilla`/`Mi Perú` invertidos, Lima con
`Miraflores`/`Pueblo Libre` invertidos) y sólo **70 de las 196 provincias** cargadas.

**Qué se hizo.** Se reconstruyó el catálogo desde el registro **INEI 2025**
(`gis/ubigeo_inei_2025.csv`, 1 891 distritos), conservando los `id` existentes para no romper las
claves ajenas:

| Acción                               | Filas | Regla                                                                                                                                                     |
| ------------------------------------ | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distritos re-anclados por **nombre** |   690 | nombre normalizado dentro de la provincia; nunca por ubigeo ni por posición                                                                               |
| Distritos fantasma borrados          |     8 | `Paria`, `Patay`, `Piruro`, `Poca`, `Pampashca`, `Puco` (centros poblados), `Zaña` (duplicado de `Saña`), `Pampas` de Corongo; **0 referencias** cada uno |
| Distritos insertados                 | 1 201 | el resto del registro INEI                                                                                                                                |
| Distritos re-numerados o acentuados  |   152 | p. ej. `020114→020112 Tarica`, `070106↔070107`, `120102→120104`…                                                                                          |

Resultado verificado contra el propio CSV del INEI: **1 891 distritos · 196 provincias · 25
regiones**, y **0** distritos con nombre distinto al INEI (la única provincia que difiere es
`061306`, donde el CSV crudo trae `Ninabamba` y la base ya tiene el correcto `Santa Cruz`).

**Tayacaja, la trampa.** La columna `ubigeo` del KML de infraestructuras está **corrida** en
`0907`: dice `090710 Pazos` cuando el INEI asigna `Pazos` a `090711`, y `090714 San Marcos de
Rocchac` cuando es `090716`. Por eso las **13 456** infraestructuras se re-vincularon por **nombre**
(región, luego provincia, luego ubigeo), no por el código del KML: 13 454 quedaron resueltas y las
**2** que no son distrito se dejan declaradas (`MATARANI`, puerto de Islay; `MAZAMARI - PANGOA`, dos
distritos en una celda). Los `distrito_id` previos se habían asignado con el catálogo roto, así que
se recalcularon todos, no sólo los nulos.

**Alta de caso: un solo buscador de territorio.** El formulario de crear caso deja de ser un select
plano y pasa a un buscador que consulta **dos** fuentes y las agrupa en la misma lista:

- **Distritos** — los 1 891 de `core.distritos`, con su departamento y provincia para desambiguar
  (hay 15 distritos llamados `Santa Rosa`). El input debe permitir buscar por nombre de distrito,
  de provincia o de departamento, y mostrar siempre la ruta completa («Santa Rosa · Chiclayo ·
  Lambayeque»).
- **Lugares** — `territorio.lugares`, para lo que no es distrito pero se nombra en los casos. Es
  donde entra **Matarani**: no es distrito, es un **puerto del distrito de Islay** (`040704`,
  provincia Islay, Arequipa). Se sembró como lugar `puerto` con las coordenadas del KML
  (−16,9997383 / −72,0966519) tomadas de `gis.infraestructuras_puntos` (`ID_100015`). El buscador lo
  muestra bajo «Islay» con la etiqueta `lugar · puerto`, para que nadie lo confunda con un distrito.

El payload del caso guarda `distrito_principal_id` (FK a `core.distritos`) y, si lo elegido fue
un lugar, lo enlaza en `core.caso_lugares` (FK a `territorio.lugares`). **No existe una columna
`lugar_id` en `core.casos`**: el lugar es un conjunto —un caso puede señalar el puerto y la caleta
donde ocurrió—, y guardar sólo el distrito de Matarani (Islay) sería escribir una ubicación que
nadie eligió. El mockup de «Registrar ▾ → Caso» (fila 12) es el que debe mostrar este buscador. El
resto de pantallas con territorio lo reutilizan con el mismo componente, con el grano que cada tabla
admite: ver «Reutilización del buscador territorial».

### Implementación (2026-11-23)

- **`GET /api/v1/territorio?q=<texto>&limite=20`** — devuelve dos colecciones, `distritos` y `lugares`,
  cada una con su `ruta` («Santa Rosa · Chiclayo · Lambayeque»). Busca por nombre de distrito,
  provincia, región y prefijo de `ubigeo` (`04` → Arequipa, `0407` → Islay). Compara con
  `core.normalizar_ref`, que quita tildes y mayúsculas, así que `mejia` encuentra `Mejía` y `nunoa`
  encuentra `Nuñoa`. Con menos de 2 letras responde `aplicada: false` y listas vacías en vez de
  devolver los 1 891 distritos.
- **`POST /api/v1/cases`** acepta `distritoPrincipalId` (entero validado contra `core.distritos`;
  un id inexistente es 422 `DISTRITO_INVALIDO`, no un 500 de clave ajena) y `lugarId` o `lugares[]`
  (validados contra `territorio.lugares`; 422 `LUGAR_INVALIDO`). `PATCH /api/v1/cases/{codigo}` los
  acepta con la misma forma: `null` limpia el distrito y un arreglo vacío vacía los lugares.
- **`angular/src/app/shared/ui/territorio-buscador.component.ts`** — autocompletar único con
  grupos «Distritos» y «Lugares operativos», navegable con teclado, que distingue el lugar con un
  sello de tipo (`PUERTO`). Es autónomo en HTTP: el panel de alta sigue sin conocer la API. Vive en
  `shared/ui` porque lo usan casos, alertas y actores. Tiene tres entradas para adaptarse al destino:
  `soloDistritos` (oculta lugares cuando la tabla de destino no los admite), `compacto` (barra de
  filtros: sin etiqueta visible ni ayudas, con `aria-label`) e `inicial` (etiqueta de un filtro
  restaurado desde la URL; el id viaja aparte y no se emite).
- **`caso-panel.component.ts`** — al elegir un distrito marca su región si no estaba seleccionada:
  un caso no debe quedar con un distrito de una región que no figura entre las del expediente.

**Resuelto (2026-11-23): `core.casos.tematica_id` pasa a anulable.** El hallazgo era que la base lo
declaraba `integer NOT NULL` sin valor por defecto mientras el panel ofrecía «Sin especificar»: un
alta sin temática salía como **500** por violación `23502`. La decisión no fue exigirla, sino
representar «pendiente» como `NULL`, porque el generador de código ya la contempla:
`core.codigo_tematica(NULL) = 'GEN'`, así que `core.siguiente_codigo_caso(sub, NULL)` emite
`CS-<sub>-GEN-<AAAA>-NN`. **No se siembra un «Sin clasificar» en `core.cat_tematicas`**: el sufijo
del código es inmutable y quedaría marcado para siempre.

- Migración `gis/derived/0003_casos_tematica_anulable.sql`: `alter column tematica_id drop not null`,
  respaldo en `core.casos_tematica_backup_20261123` (35 filas) y fila `casos_tematica_anulable` en
  `core.migracion_log`. Reversa documentada en el propio archivo (exige que no queden `NULL`).
- `POST /v1/cases` y `PATCH /v1/cases/{codigo}` guardan `NULL` si la temática falta o llega vacía, y
  siguen respondiendo 422 si el valor no existe en el catálogo (`resolveOptionalCatalog`).
- El panel muestra «Sin especificar» y el envío omite la temática vacía; el comentario de
  obligatoriedad se retiró.

**Cómo se verificó.** La búsqueda se ejecutó contra la base local —`matarani` devuelve **0 distritos y
1 lugar** (puerto de Islay); `mejia` encuentra `Mejía`; `nunoa` encuentra `Nuñoa`; `0407` lista los
de Islay— y el alta se evaluó dentro de una transacción con `rollback`: creó el caso con
`distrito_principal_id = 3303` y `core.caso_lugares` con Matarani, cambió el distrito, lo limpió con
`null`, vació los lugares y recibió los tres 422 esperados. Al revertir, `core.casos` volvió a **35**
filas: la prueba no dejó rastro.

**Alta sin temática (2026-11-23).** En la misma base, dentro de una transacción con `rollback`, se
insertó un caso con `tematica_id = null` usando el propio generador: el código salió
`CS-PA-GEN-2026-01` y la columna quedó `NULL`. `core.casos` siguió en **35** filas y no quedó fila en
`core.secuencia_codigo`. La prueba usó `core.siguiente_codigo_caso` dos veces (una sola, y otra en
el `insert`), de ahí que la primera lectura sea `…-01` y el caso insertado `…-02`.

### Reutilización del buscador territorial (2026-11-23)

El componente es el mismo; lo que cambia es el grano que cada tabla puede guardar. Esto es lo
medido en la base local, no una aspiración:

| Pantalla | Columna de destino                                       | Poblado hoy                                     | Uso del buscador                                                                                                                                            |
| -------- | -------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Casos    | `core.casos.distrito_principal_id` + `core.caso_lugares` | **23 de 35** casos con distrito                 | Alta y edición: distrito **y** lugares operativos (Matarani)                                                                                                |
| Alertas  | `core.alertas_tempranas.distrito_id`                     | **41 de 83** alertas                            | Alta (`soloDistritos`) **y** filtro del listado (compacto, con `distritoId` en la URL)                                                                      |
| Actores  | `core.actores.region_id`                                 | **0 de 1 160** con distrito; **355** con región | Filtro: el distrito elegido se traduce a su **región**, que es el grano real de la tabla                                                                    |
| Locales  | `core.locales.distrito_id`                               | **0 de 27**                                     | Sin control visible: el filtro daría 0 filas siempre. El parámetro `distritoId` ya existe en `GET /v1/locales`, listo para cuando se complete el inventario |

- **Alertas.** `GET /v1/alerts` acepta `distritoId` (id exacto; un valor no numérico es 422
  `DISTRITO_INVALIDO`). La exportación reenvía el filtro (`FILTROS_ALERTAS`). El alta envía
  `distritoId` sólo si lo elegido es distrito: la tabla no tiene lugares y degradar un puerto a su
  distrito escribiría una ubicación que nadie eligió. El filtro viaja en la URL como `distritoId` +
  `distritoNombre` (el segundo sólo pinta la etiqueta al recargar). **Pendiente:** la edición de una
  alerta aún no permite cambiar el distrito; la ficha lo muestra de sólo lectura y `updateAlert` no
  acepta todavía `distritoId` (sí `createAlert`).
- **Actores.** Se retiró el campo «Región (nombre exacto)», que obligaba a acertar la grafía de
  `core.regiones.nombre` (y convive con las formas sin tilde `Ancash`, `Apurimac`, `Huanuco`,
  `Junin`). Ahora se elige un distrito o lugar y se envía su **región** —`r.nombre` sale del mismo
  join (`distritos → provincias → regiones`) que usa `/v1/territorio`, así que la comparación exacta
  del repositorio se cumple—. Un distrito del Callao o de Lima funciona igual.
- **Locales / auditorios.** No se ofrece el control a propósito. Los 27 auditorios de `core.locales`
  tienen `distrito_id` en `NULL` y su `direccion` es texto libre: emparejar «Ica» contra esa cadena
  marcaría también el auditorio de Tacna (la subcadena aparece en apellidos y calles) y la regla del
  proyecto es declarar el dato ausente, no estimarlo. **Pendiente:** asignar `distrito_id` a los 27
  auditorios; con eso el filtro y el punto en el mapa (petición de la Dirección) funcionan sin tocar
  la interfaz, porque el componente y el parámetro de API ya están.

**Cómo se verificó (reutilización).** `distritos` no tiene región directa —va por `provincia_id`— y
una búsqueda `Arequipa` devuelve la región exacta `Arequipa`, que es la misma cadena que filtra
`listActors`. El filtro de alertas se comprobó con distritos que sí tienen alertas: `424` (Lima) →
**10**, `425` (Ancón) → **5**, `545` (Ilo) → **4**. Islay (`3303`) devuelve **0**, coherente con que
ninguna alerta de las 41 tenga ese distrito. `npx tsc --noEmit` y `npm --prefix angular run build`
pasan; el build es el único que valida las plantillas.

**Evidencia y artefactos.** `gis/derived/maestro_resumen.txt` fija las cifras; `distritos_maestro.csv`
es el catálogo final con centroide y área; `reconciliacion_distritos.csv` lista, fila por fila, qué
se mantuvo, borró o insertó; la migración es `gis/derived/0001_distritos_inei_2025.sql` y el seed de
Matarani `gis/derived/0002_territorio_lugares_matarani.sql`. Ambas dejaron respaldo en
`core.distritos_backup_20261123` y `core.provincias_backup_20261123`. Las regiones conservan su
nombre sin tilde (`Ancash`, `Apurimac`, `Huanuco`, `Junin`); si se acentúan (como en el INEI
`Áncash`…) hay que hacerlo en las 25 a la vez y revisar las cadenas fijas del frontend, no a medias.
