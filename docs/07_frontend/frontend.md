# Qué falta, pantalla por pantalla

Este documento responde **una sola pregunta**: de todo lo acordado para la interfaz
del sistema AVISA, ¿qué sigue pendiente y en qué pantalla se nota?

**Fecha de corte:** 2026-11-23.
**Dónde se construye:** la SPA Angular, en `angular/src/app`.
**Dónde se dibuja:** `docs/07_frontend/mockups/`, con su índice en `mockups/index.html`.
**De dónde sale:** del catálogo de 131 items. El detalle completo —hallazgos de base,
capa GIS, contratos de API y discusiones— vive en [`frontend_detalle.md`](frontend_detalle.md).

No se repite lo que ya está hecho. Si una pantalla no aparece en el resumen, no tiene
pendientes de interfaz.

---

## Cómo se lee

Cada pantalla tiene una tabla con cuatro columnas:

| Columna           | Qué contiene                                                     |
| ----------------- | ---------------------------------------------------------------- |
| `Item`            | Número del catálogo (1–131), para buscar el detalle en el anexo. |
| `Qué falta`       | La pieza concreta que no está en pantalla.                       |
| `Por qué no está` | Uno de los motivos de la tabla siguiente.                        |
| `Mockup`          | Artboard de referencia en `mockups/`, o `—` si no hay dibujo.    |

Los motivos son cinco, y no se mezclan:

| Motivo        | Significa                                                                   |
| ------------- | --------------------------------------------------------------------------- |
| `Implementar` | Está decidido y el dato existe. Sólo falta construir la pantalla.           |
| `Dato`        | Falta una columna, una tabla o una carga. La interfaz no lo puede inventar. |
| `API`         | Falta un endpoint, una regla del servidor o un permiso.                     |
| `Diseño`      | Falta decidir la forma. Por eso se entrega como mockup.                     |
| `Bloqueado`   | Depende de una decisión de producto o de un cambio de permisos.             |

**Regla que no cambia:** el dato ausente se declara, no se estima. Ningún mockup
rellena una celda que la base no pueda sostener.

---

## Mapa del sitio

```
/mapa ······················ Panorama territorial   ← pantalla de entrada
/resumen ··················· Resumen operativo
/bandeja ··················· Bandeja de trabajo

/casos ····················· Casos
  /casos/sin-caso ·········· Demandas sin caso
  /casos/:codigo ··········· Ficha del caso
/alertas ··················· Alertas tempranas
/compromisos ··············· Compromisos
/documentos ················ Documentos
/reportes ·················· Registro de reportes
/papelera ·················· Papelera

/directorio ················ Portada del directorio
  /directorio/actores ······ Actores
  /directorio/organizaciones
  /directorio/instituciones
  /directorio/locales ······· Auditorios
/direccion ················· Resumen de Dirección

/acceso ···················· Inicio de sesión
/busqueda ·················· Búsqueda global
/notificaciones ············ Centro de notificaciones
/ayuda ····················· Ayuda y criterios
/preferencias ·············· Preferencias
```

Son 22 rutas. El shell —cabecera, menú lateral y el botón «Registrar ▾»— no es una
ruta y tiene su propio apartado al final.

---

## Resumen de pendientes

Sólo las pantallas con algo pendiente. Lo más importante va primero.

| Pantalla             | Pendientes | Lo más importante                                                        |
| -------------------- | ---------: | ------------------------------------------------------------------------ |
| Panorama territorial |          8 | Dibujar la capa real de puntos                                           |
| Ficha del caso       |         10 | Edición por campo y documentos del caso                                  |
| Bandeja de trabajo   |          4 | Convertirla en tablero y persistir asignar/posponer                      |
| Alertas tempranas    |          3 | Acciones de Alta Dirección                                               |
| Compromisos          |          3 | Clasificación formal/verbal y adjuntos                                   |
| Documentos           |          3 | Fragmentos, versiones y OCR                                              |
| Resumen operativo    |          2 | Las tres dimensiones de la Guía                                          |
| Casos                |          3 | Archivar, duplicados y matriz de demandas–intervenciones (import/export) |
| Actores              |          2 | Alta con PII y fusión de duplicados                                      |
| Auditorios           |          1 | Distrito de los 27 y capa en el mapa                                     |
| Dirección            |          1 | Las variantes del resumen                                                |
| Preferencias         |          1 | Persistencia por usuario                                                 |
| Búsqueda             |          1 | Abrir la ficha de alertas, compromisos, documentos y actores             |
| Notificaciones       |          1 | Marcar leída y contador de la campana                                    |
| Acceso               |          1 | Expiración por inactividad y segundo factor                              |
| Shell                |          1 | Registrar desde cualquier pantalla sin cambiar de ruta                   |
| Transversal (todas)  |          9 | Permisos por territorio y pruebas                                        |

**Sin pendientes de interfaz:** `/casos/sin-caso`, `/reportes`, `/papelera`,
`/directorio`, `/directorio/organizaciones`, `/directorio/instituciones` y `/ayuda`.
En cada una se indica abajo si el hueco es de dato.

---

## Panorama territorial · `/mapa`

**Mockup:** `panorama-territorial.html` y su segundo estado `mapa-activos-radar-dpa.html`.
Ya están hechos: las tarjetas sin textos de apoyo, «Regiones con al menos un caso»,
«Alcance geográfico», el selector fijo, la columna ordenable, el cajón lateral de
«Ver casos», la tabla de casos bajo el mapa y el vocabulario **latente / manifiesto**
en las tarjetas, la columna de regiones y los casos priorizados, con los casos sin
nivel declarados aparte.

| Item   | Qué falta                                                                                 | Por qué no está       | Mockup                        |
| ------ | ----------------------------------------------------------------------------------------- | --------------------- | ----------------------------- |
| 27, 53 | Leyenda, selector de capas, agrupación de puntos y filtro temporal sobre el mapa          | `Diseño`              | `mapa-activos-radar-dpa.html` |
| 125    | Nube de los 13 456 puntos del KML: 13 229 derechos acuícolas y 227 sedes institucionales  | `Implementar`         | `mapa-activos-radar-dpa.html` |
| 126    | Redes RADAR y los 31 desembarcaderos DPA, con símbolo propio y filtro                     | `Dato`                | `mapa-activos-radar-dpa.html` |
| 127    | Estado de proyecto de cada DPA (etapa, expediente, avance)                                | `Dato`                | `mapa-activos-radar-dpa.html` |
| 128    | Cargar los polígonos distritales en PostGIS (1 892 distritos, `UBIGEO` INEI)              | `Dato`                | —                             |
| 129    | Coropletas por distrito sobre los polígonos, sin el rótulo «Mapa referencial»             | `Diseño` + `128`      | — (por dibujar)               |
| 131    | Tasas por 100 000 habitantes (la población sólo como denominador)                         | `Dato` + `128`        | —                             |
| 130    | Ubicar en el centroide de su distrito las sedes sin coordenada, rotuladas como «distrito» | `Implementar` + `128` | —                             |

**Lo que cambia el panorama.** La regla de latente/manifiesto ya está ratificada y no
necesita ni columna nueva ni hechos públicos: **latente** = `Diferencia` + `Controversia`;
**manifiesto** = `Conflicto social` + `Crisis social` (Guía §7.5.1). Si el caso no tiene
nivel declarado, la etiqueta no se estima: se declara como «sin nivel». **Aplicada en
pantalla** (2026-11-23): tarjetas, columna de regiones y tabla de casos priorizados.

**El bloqueo del mapa.** Todo lo que usa geometría distrital (129, 130 y 131) espera la
carga del item 128. Mientras tanto, la geometría existe como archivo
(`gis/derived/distritos_capa.geojson`), pero no en la base.

**Nota de dato.** Las redes RADAR no tienen fuente cargada. Los 31 desembarcaderos, sí:
ya están en el KML con nombre y distrito.

---

## Resumen operativo · `/resumen`

**Mockup:** `resumen-operativo.html`.
El mockup ya dibuja las tres dimensiones de la Guía (Prevención · Gestión ·
Seguimiento de compromisos) y la franja de operación que reemplaza al resumen suelto.
La SPA todavía muestra indicadores, últimas alertas y compromisos vencidos.

| Item | Qué falta                                                                                          | Por qué no está | Mockup                   |
| ---- | -------------------------------------------------------------------------------------------------- | --------------- | ------------------------ |
| 110  | Reorganizar el resumen en **Prevención · Gestión · Seguimiento de compromisos**, como pide la Guía | `Diseño`        | `resumen-operativo.html` |
| 85   | Panel de operación OAIPCS: cola de trabajo, carga del equipo y capacidad (superficie de esta ruta) | `Diseño`        | `resumen-operativo.html` |
| 46   | «Última sincronización» global con hora real, en lugar del texto fijo                              | `Dato`          | —                        |

Las cifras del resumen ya son agregaciones reales; lo que falta es el orden por
dimensiones, no un dato nuevo. El item 85 **no** se construye aparte: su lectura de
datos vive en la pestaña OAIPCS de `dashboard-analitico.html` y su superficie de uso
es esta ruta.

---

## Bandeja de trabajo · `/bandeja`

**Mockup:** `bandeja-unificada.html`.
Hoy son tres bloques: alertas pendientes, compromisos por vencer y demandas sin caso.

| Item    | Qué falta                                                                                      | Por qué no está | Mockup                   |
| ------- | ---------------------------------------------------------------------------------------------- | --------------- | ------------------------ |
| 111     | Convertirla en tablero: mapa, indicadores y resumen de casos, con la matriz de consulta debajo | `Implementar`   | `bandeja-unificada.html` |
| 22      | Una sola lista ordenada por plazo, riesgo y revisión pendiente, con filtro por tipo            | `Implementar`   | `bandeja-unificada.html` |
| 50      | Persistir asignación, posposición, finalización, fecha límite y responsable                    | `Dato`          | `bandeja-unificada.html` |
| 68 · X4 | Traer aquí el indicador de completitud que se retiró del expediente                            | `API`           | —                        |

Los contadores y el SLA se calculan desde esos datos. Sin el item 50 no hay bandeja
individual: se declara, no se simula.

---

## Casos · `/casos`

**Mockup:** `casos-tarjetas.html` y `casos_detalle_en_ventana_emergente_ajustes_22_nov.html`.
Ya están hechos: el desplegable de estado con conteos, el de **Nivel de conflictividad**,
el formato tarjetas/tabla, la búsqueda avanzada, las tarjetas a dos líneas, el filtro de
**Naturaleza** y la vista previa del caso.

| Item      | Qué falta                                                                            | Por qué no está | Mockup                            |
| --------- | ------------------------------------------------------------------------------------ | --------------- | --------------------------------- |
| 37, 21    | **Archivar** como transición visible, con anular y restaurar desde la ficha y motivo | `Implementar`   | `ficha-pestanas.html`             |
| 71        | Aviso de duplicados al registrar, con opción de vincular al registro existente       | `API`           | —                                 |
| — (nuevo) | **Matriz de demandas–intervenciones** por caso, con importación y exportación XLSX   | `API` + `Dato`  | `matriz-conflictividad-caso.html` |

**Matriz del equipo (lo nuevo).** El equipo compartió un Excel con varias filas por caso
(demandas, acciones e hitos sobre el mismo eje) y quiere mover esa información **hacia y
desde** AVISA. El mockup `matriz-conflictividad-caso.html` dibuja la matriz y la bandeja
de importación; la anatomía del Excel, la regla de parseo y el contrato de endpoints están
en [`MATRIZ_CONFLICTOS_EQUIPO.md`](MATRIZ_CONFLICTOS_EQUIPO.md).

**Exportar sí; importar todavía no.** Verificado en Neon (corte 2026-11-23). Las dos
mitades de la matriz **ya existen como vistas de `analytics`**, así que el export no
necesita cambio de esquema:

- `analytics.vw_anexo_15_matriz_conflictividad` — una fila por **caso**, 15 columnas
  (código, región, alcance, subsector, temática, responsable, nivel de conflicto, nivel de
  riesgo, descripción del riesgo, prioridad, nombre, narración, alertas, actores, punto
  focal).
- `analytics.vw_anexo_14_seguimiento_compromisos` — una fila por **compromiso × hito**, 15
  columnas (código de compromiso y de caso, región, provincia, distrito, alcance,
  documento origen, fecha de inicio, temática, acción, área responsable, código y texto del
  hito, estado, semáforo).

Falta un ajuste: **ninguna de las dos trae `fecha_planificada` ni `fecha_real`**, las
columnas V y W del Excel. Hay que añadirlas **a la vista**, no sólo al export. Con eso,
exportar A..X con hoja «Sin datos» es un endpoint pequeño.

Lo que el export no puede rellenar es contenido: el Excel trae 23 demandas, 56 compromisos
y 111 hitos; AVISA tiene **325 demandas** (de otra fuente, `DEM-2026-XXXX`), **8
compromisos** y **12 hitos**, y esos 8 están en **3 casos**. Un export hoy sale 7–9× más
corto que el archivo del equipo.

**Lo que bloquea el import.** Dos decisiones que no son de pantalla:

1. **Mapeo Excel → `core.casos.codigo_caso`**: 2 de 31 códigos coinciden y ambos apuntan a
   otro caso.
2. **Responsable del hito**: `core.hitos_compromiso` no tiene columna;
   `core.compromisos.unidad_responsable_id` es área, no persona.

Y tres catálogos que no cuadran: `cat_estados_hito` no tiene **«No Cumplido»** (43 filas
del Excel), `cat_tematicas` no cubre «Recursos y Regulación» (18), «Socio-Ambiental» ni
«Mesas de Conflictos», y `cat_niveles_riesgo` tiene 3 valores frente a los 4 del equipo.

**Lo que AVISA ya tiene.** El **3P** (`problema_3p`, `propuesta_3p`, `pedido_3p`) está en
`core.demandas` y **no** en el Excel; `core.casos.link_reporte_pdf` puede alimentar la
columna G (Canva) que el front declara no disponible; `fecha_ultima_actualizacion` cubre la
fecha, no el estado «Actualizado / Pendiente / No aplica». Siguen sin tabla los **nudos
críticos semanales** y las **capacidades 1–5 / postura** por actor.

**Nota de despliegue.** El filtro `nivel` es superficie nueva de API: hasta que se
redespliegue el servidor, un backend antiguo lo ignora en silencio y la lista no se
recorta. No rompe la pantalla.

**Nota de dato.** `Territorial` está declarada en 0 casos y 27 siguen sin declarar: es
una decisión de OAIPCS caso por caso, no un pendiente de pantalla.

---

## Ficha del caso · `/casos/:codigo`

**Mockup:** `ficha-pestanas.html` y `ficha-reportes-monitoreo-documentos.html`.
Ya están hechos: la retirada de «Próximo paso», «Ruta de atención» y «Demandas» de
relaciones; el expediente de cuatro piezas; «Guardar PDF» para el perfil no
administrador; el riel de relaciones; la tabla de actores con exportación local.

| Item   | Qué falta                                                                                     | Por qué no está        | Mockup                                     |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| 11     | Acción para recalcular el nivel de riesgo desde la ficha                                      | `API`                  | —                                          |
| 12     | **Apellidos** y **nombres** separados, y teléfono o móvil por actor                           | `Dato`                 | —                                          |
| 15     | Categoría **AT / RR / PAR** en las alertas vinculadas                                         | `Dato`                 | —                                          |
| 16     | Pestaña **Compromisos**, con la clasificación progresivo/parcial, operativo o condicionado    | `Implementar` + `Dato` | `ficha-pestanas.html`                      |
| 18     | Edición por campo dentro de la ficha, con Cancelar y Guardar cambios                          | `Implementar`          | —                                          |
| 40     | Alta y desvinculación de actores desde la ficha                                               | `API`                  | —                                          |
| 41     | Pestañas **Reuniones**, **Productos/Envíos** e **Historial/Auditoría**                        | `API`                  | `ficha-pestanas.html`                      |
| 97     | «Caso de análisis (Canva)»: hoy no existe como enlace ni como campo; se declara no disponible | `Diseño`               | `ficha-pestanas.html`                      |
| 98, 99 | Exportar actores con organización y teléfono (Excel, PDF y WhatsApp)                          | `Dato`                 | `ficha-pestanas.html`                      |
| 103    | Bloques **Reportes de monitoreo** y **Documentos del caso** (PRODUCE y normativa)             | `Diseño`               | `ficha-reportes-monitoreo-documentos.html` |

**Lo que ya está y no se toca.** La ventana emergente de la tarjeta, el mapa de actores
como tabla y la exportación local funcionan; lo que falta es el dato de contacto, no la
forma.

---

## Demandas sin caso · `/casos/sin-caso`

Sin pendientes de interfaz. La vista existe y sigue viva en su ruta propia; el acceso se
retiró de la barra de Casos a propósito (X5).

**Nota de dato.** Hoy hay **107 demandas sin caso**. Ocultar el hueco no lo cierra:
vincularlas es una decisión de OAIPCS, no una pantalla.

---

## Alertas tempranas · `/alertas`

**Mockup:** `alertas-operativas.html`.
Ya están hechos los filtros por código, prioridad, estado, riesgo y «Sin caso asignado»,
los anchos de columna, la prioridad con plazo y la exportación por perfil.

| Item | Qué falta                                                                                                 | Por qué no está | Mockup                    |
| ---- | --------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| 23   | Confirmación al aprobar, reapertura de una alerta descartada, deshacer y visibilidad de la derivación     | `Implementar`   | —                         |
| 38   | Motivo de descarte, búsqueda de duplicados, adjuntos y conciliación con el documento original             | `API`           | —                         |
| 105  | Columna **Acciones** para Alta Dirección (Aprobar · Solicitar modificación · Anular) y envío por WhatsApp | `API`           | `alertas-operativas.html` |

---

## Compromisos · `/compromisos`

**Mockup:** — (comparte el patrón de `alertas-operativas.html`); el panel del compromiso ya está.
Ya están hechos el calendario, el alta desde la lista, el estado calculado y la anulación
con motivo.

| Item | Qué falta                                                                                           | Por qué no está | Mockup |
| ---- | --------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 24   | Clasificación **formal / verbal**, recordatorios, adjuntos como archivos y popup cuando no hay hito | `Dato`          | —      |
| 39   | Recordatorios e historial visible por compromiso                                                    | `API`           | —      |
| 123  | Dimensión «asumido por el Señor Ministro», separada de la unidad responsable                        | `Dato`          | —      |

**Nota de dato.** El calendario se pinta vacío porque los 8 compromisos no tienen
`fecha_vencimiento` y el único hito con fecha está cumplido. Es un hueco de carga, no
de vista.

---

## Documentos · `/documentos`

**Mockup:** `etl-tres-pestanas.html` (la extracción comparte pantalla con la ETL).
Ya están hechos los botones Validar/Rechazar con confirmación y el alta de la ficha del
documento.

| Item | Qué falta                                                                             | Por qué no está | Mockup |
| ---- | ------------------------------------------------------------------------------------- | --------------- | ------ |
| 26   | Validación por **fragmento**, relanzar la extracción y consultar versiones anteriores | `API`           | —      |
| 61   | Almacenamiento del archivo con hash, página/offset por fragmento y OCR aparte         | `Dato`          | —      |
| 62   | Lista blanca de fuentes, log de ejecuciones y reejecución versionada                  | `API`           | —      |

---

## Registro de reportes · `/reportes`

Sin pendientes de interfaz. La pantalla lista y filtra los reportes registrados.

**Otra pantalla.** El dashboard analítico (item 51) no es esta vista: no tiene ruta
todavía. Ver «Pantallas que aún no tienen ruta».

---

## Papelera · `/papelera`

Sin pendientes. Lista los registros anulados con su fecha y permite restaurar.

---

## Directorio · `/directorio`

Sin pendientes. La portada con tarjetas por matriz ya está hecha (item 108).

---

## Actores · `/directorio/actores`

**Mockup:** `directorio-crud.html`.
Ya están hechos la lista temporal entre filtros, el padrón de asistencia en CSV, la
edición de atributos públicos, la búsqueda por territorio y el detalle en panel lateral.

| Item | Qué falta                                                                                | Por qué no está | Mockup                 |
| ---- | ---------------------------------------------------------------------------------------- | --------------- | ---------------------- |
| 44   | Alta de actor, captura y edición de PII bajo demanda, fusión de duplicados y baja lógica | `API`           | `directorio-crud.html` |
| 45   | Registro con o sin DNI, membresía OSPA y contacto opcional (no hay `POST`)               | `API`           | `directorio-crud.html` |

**Otra pieza.** El cruce de actores por región y arte de pesca (item 120) y la marca
OSPA por caleta (121) dependen del catálogo de artes: ver «Perfil territorial».

---

## Organizaciones · `/directorio/organizaciones`

Sin pendientes de interfaz.

**Nota de dato.** 119 de 224 organizaciones tienen región; las 105 restantes están
declaradas y no se estiman.

---

## Instituciones · `/directorio/instituciones`

Sin pendientes de interfaz.

---

## Auditorios · `/directorio/locales`

**Mockup:** `directorio-crud.html`.
El rename a «Auditorios» ya está hecho en la navegación y en la pantalla.

| Item | Qué falta                                                                  | Por qué no está | Mockup                 |
| ---- | -------------------------------------------------------------------------- | --------------- | ---------------------- |
| 115  | Asignar distrito a los 27 auditorios y dibujarlos en el mapa por centroide | `Dato`          | `directorio-crud.html` |

Los 27 locales tienen aforo y contacto (23 de 27), pero **0 de 27** tienen
`distrito_id` y ninguno tiene coordenada. Con el distrito, el punto entra en el mapa a
precisión de distrito y así se rotula: no es la puerta del local.

---

## Resumen de Dirección · `/direccion`

**Ya está:** el desglose por prioridad, riesgo, temática y región, con cada fila
enlazada al listado filtrado.

| Item | Qué falta                                 | Por qué no está | Mockup                     |
| ---- | ----------------------------------------- | --------------- | -------------------------- |
| 52   | Las variantes del módulo que pide la Guía | `Diseño`        | `dashboard-analitico.html` |

---

## Inicio de sesión · `/acceso`

| Item | Qué falta                                                              | Por qué no está             | Mockup |
| ---- | ---------------------------------------------------------------------- | --------------------------- | ------ |
| 48   | Expiración por inactividad; segundo factor sólo tras definir proveedor | `Implementar` · `Bloqueado` | —      |

La sesión ya caduca a las 8 h, el login va contra la base y el cierre de sesión existe.

---

## Búsqueda global · `/busqueda`

| Item | Qué falta                                                                                                | Por qué no está | Mockup |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 30   | Que alertas, compromisos, documentos y actores abran su ficha, y mostrar el territorio en cada resultado | `API`           | —      |

La búsqueda ya cubre las seis entidades y agrupa los resultados; esas cuatro abren su
lista pre-filtrada porque no tienen ficha propia.

---

## Centro de notificaciones · `/notificaciones`

| Item | Qué falta                                             | Por qué no está | Mockup |
| ---- | ----------------------------------------------------- | --------------- | ------ |
| 31   | Marcar como leída y el contador o punto de la campana | `API`           | —      |

La pantalla ya existe con categoría, estado y fecha. El punto de la campana se retiró a
propósito: sin `PATCH` ni conteo, un indicador sería falso.

---

## Ayuda y criterios · `/ayuda`

Sin pendientes. La ayuda navegable, el glosario y la hoja de atajos ya están.

---

## Preferencias · `/preferencias`

| Item   | Qué falta                                                   | Por qué no está | Mockup |
| ------ | ----------------------------------------------------------- | --------------- | ------ |
| 28, 47 | Tamaño de página y persistencia de preferencias por usuario | `Dato`          | —      |

Tema, densidad, ámbito y notificaciones ya se guardan, hoy en el navegador.

---

## Shell · cabecera y menú

**Mockup:** `registrar-menu.html`.
Ya están hechos el nombre institucional, la navegación y los atajos
`Ctrl/⌘+K` y `/`. La marca enlaza al panorama territorial (`/mapa`) y el chip de
ámbito abre un menú con «Sesión» y los cinco alcances: actualiza la preferencia y,
en `/mapa` y `/casos`, el parámetro `alcance` de la URL sin perder los filtros
activos. El menú se recorre con flechas, Inicio/Fin y Escape, y en móvil el chip
se reduce al icono.

| Item | Qué falta                                               | Por qué no está | Mockup                |
| ---- | ------------------------------------------------------- | --------------- | --------------------- |
| 65   | Abrir el formulario de registro sin cambiar de pantalla | `Implementar`   | `registrar-menu.html` |

Hoy «Registrar ▾» navega a la página de destino y abre el panel allí. «Reunión» sigue
visible y deshabilitada hasta que exista la capa de reuniones.

---

## Transversal a todas las pantallas

Pendientes que no pertenecen a una vista concreta.

| Item     | Qué falta                                                                                           | Por qué no está |
| -------- | --------------------------------------------------------------------------------------------------- | --------------- |
| 29       | Rango de fechas compartido (7/30/90 días y personalizado) entre vistas y exportaciones              | `Implementar`   |
| 32       | Pruebas de formularios, filtros, permisos y transiciones; auditoría de contraste                    | `Implementar`   |
| 35       | Recorte territorial real por región; hoy el alcance devuelve siempre «todo»                         | `Bloqueado`     |
| 36       | Usar el ubigeo como clave donde todavía se casa por nombre de región, y normalizar tildes           | `Implementar`   |
| 42, 43   | Registrar en auditoría cada descarga de datos sensibles                                             | `API`           |
| 57       | Series temporales, aging y zona horaria para dashboards y bandeja                                   | `Dato`          |
| 66       | Un descriptor por entidad que genere los formularios y lea los catálogos de la API                  | `Implementar`   |
| 69       | Un solo componente de tabla para las seis listas (hoy cada pantalla tiene la suya)                  | `Implementar`   |
| 113 · X6 | Ámbito de subsector por rol: Dirección y Secretaría General ven ambos; cada Vice-ministerio el suyo | `Bloqueado`     |

**Sobre el 113.** No es una pantalla: es una regla de sesión. Hoy no existe rol de
viceministerio ni ámbito de subsector, así que primero hay que tocarlo en el modelo de
permisos y en la seguridad por fila.

---

## Pantallas que aún no tienen ruta

Piezas acordadas que no están en el menú. Cada una necesita decidir primero si se
convierte en pantalla propia o en una pestaña de otra.

| Pantalla                  | Items          | Qué falta                                                                                                                                                                                                  | Por qué no está  | Mockup                            |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------- |
| Dashboard analítico       | 51, 57         | Biblioteca de gráficos dibujada; falta el endpoint de agregados y la serie histórica                                                                                                                       | `Diseño` + `API` | `dashboard-analitico.html`        |
| ETL de tres pestañas      | 58–62, 86      | Ejecución, fuentes e historial con lector real, pipeline observable y conciliación                                                                                                                         | `API`            | `etl-tres-pestanas.html`          |
| Bandeja RED-RADAR         | 76             | Cola de señales con triage, descarte con motivo y «convertir en alerta»                                                                                                                                    | `Dato`           | `bandeja-red-radar.html`          |
| Autoridades y agendas     | 114            | Prefectos, subprefectos, sectoristas PCM, extensionistas, alcaldes y direpros                                                                                                                              | `Dato`           | — (por dibujar)                   |
| Clima social              | 116            | Reporte mensual externo por período y región, con autor y archivo                                                                                                                                          | `Dato`           | — (por dibujar)                   |
| Perfil territorial        | 119–124        | Catálogo de artes de pesca, OSPA por caleta, demandas por OSPA y región × recurso                                                                                                                          | `Dato`           | `perfil-territorial.html`         |
| Reuniones y ayuda memoria | 72–74, 77, 117 | Registro de reuniones con banderas (asistencia, AM, relatoría, publicación) y editor de ayuda memoria                                                                                                      | `API`            | `reuniones-ayuda-memoria.html`    |
| Gobierno de sugerencias   | 87             | Bandeja de propuestas automáticas, diff contra el registro y lecciones aprendidas                                                                                                                          | `Diseño`         | `gobierno-sugerencias.html`       |
| Matriz de conflictividad  | — (nuevo)      | Matriz de demandas–intervenciones por caso, como pestaña de la ficha. Export viable hoy leyendo las vistas 14/15 (con V/W añadidas a la vista); import bloqueado por mapeo de casos y responsable del hito | `API` + `Dato`   | `matriz-conflictividad-caso.html` |
| Envíos y auditoría        | 55             | Vistas de envíos con acuse y auditoría consultable                                                                                                                                                         | `Diseño`         | —                                 |
| Administración            | 56             | Catálogos, unidades, roles, parámetros y usuarios, con cambios auditados                                                                                                                                   | `Diseño`         | —                                 |

**Nota de dato.** Las fuentes de tres de estas pantallas no tienen masa crítica:
`dim_autoridades` tiene 2 filas, clima social 7 y 6, y el puente caso–recurso 0. El
catálogo de artes de pesca no existe como tabla; sin él no hay eje para 120.

---

## Lo que no es una pantalla

Productos documentales y capacidad de análisis. No se dibujan como vista porque su
salida es un documento, un trabajo en lote o un método.

| Pieza                                 | Items    | Qué es                                                                     |
| ------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Anexo 15 · matriz de conflictividad   | vista 15 | Vista imprimible; el mockup está en `anexo-15-matriz-conflictividad.html`. |
| Anexo 14 · seguimiento de compromisos | 25       | Exportación por anexo; hoy no hay ruta de exportación que la produzca.     |
| Generador de anexos                   | 75, 86   | Un endpoint y un run log por anexo, con plantilla y revisión humana.       |
| Clima social para mensajería          | 78       | Texto plano para enviar (Anexos 4 y 5), no una pantalla.                   |
| Análisis del caso                     | 79–84    | Triangulación, recurrencia, análogos, lecciones y los Anexos 8 y 9.        |

---

## Aplazado o descartado

| Item | Qué era                                       | Estado                                                               |
| ---- | --------------------------------------------- | -------------------------------------------------------------------- |
| 90   | Retirar el mapa del panorama                  | **Descartado.** El mapa se conserva: es la entrada del sistema.      |
| 33   | Modos M_ACERVO, M_ZONA y M_MAPA               | **Aplazado.** Hay una sola vista territorial por decisión de diseño. |
| 54   | Módulos M_RED y M_SIM                         | **Aplazado a 2027.** Antes hay que definir qué datos consumen.       |
| 8    | Ruta de atención con el vocabulario del ciclo | **Retirado de la ficha.** El vocabulario vive en `/ayuda`.           |
| 19   | «Próximo paso» en la ficha                    | **Retirado** junto con la ruta de atención.                          |
| 17   | Documentación normativa en la ficha           | **Absorbido** por «Documentos del caso» (item 103).                  |

---

## Reglas ya decididas (no reabrir)

| Regla | Qué quedó decidido                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1    | La Ruta de atención sale de la ficha. Los cinco componentes del ciclo se explican en `/ayuda`.                                                                    |
| X2    | El mapa se conserva y es la pantalla de entrada. Sólo se sustituye por una capa con geometría real.                                                               |
| X3    | **Latente** = Diferencia + Controversia. **Manifiesto** = Conflicto social + Crisis social. Se aplica agrupando el nivel de conflictividad; no crea estado nuevo. |
| X4    | La completitud sale del expediente y se muestra en bandeja y dirección.                                                                                           |
| X5    | «Demandas sin caso» sale de la barra de Casos y vive en su ruta propia.                                                                                           |
| X6    | Dirección y Secretaría General ven ambos subsectores; cada Vice-ministerio, sólo el suyo. Es ámbito de sesión.                                                    |

---

## Dónde está el detalle

- [`frontend_detalle.md`](frontend_detalle.md) — catálogo de los 131 items, hallazgos de
  base y carga, capa GIS, contratos de API, duplicidades y prioridad de mockups.
- `mockups/index.html` — índice de los artboards con lo que cubre cada uno.
- [`angular/CONTRATO_API_SPA.md`](angular/CONTRATO_API_SPA.md) — qué endpoint y qué
  campo necesita cada celda.
