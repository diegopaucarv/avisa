# Qué falta, pantalla por pantalla

Este documento responde **una sola pregunta**: de todo lo acordado para la interfaz
del sistema AVISA, ¿qué sigue pendiente y en qué pantalla se nota?

**Fecha de corte:** 2026-11-28, **verificado contra el código** (no contra el catálogo).
**Dónde se construye:** la SPA Angular, en `angular/src/app`.
**Dónde se dibuja:** `docs/07_frontend/mockups/`, con su índice en `mockups/index.html`.
**De dónde sale:** del catálogo de 131 items. El detalle completo —hallazgos de base,
capa GIS, contratos de API y discusiones— vive en [`frontend_detalle.md`](frontend_detalle.md).

No se repite lo que ya está hecho. Si una pantalla no aparece en el resumen, no tiene
pendientes de interfaz. Lo cerrado queda en «Ya está» de cada pantalla y, con la
evidencia de archivo y línea, en «Verificación 2026-11-24» de
[`frontend_detalle.md`](frontend_detalle.md).

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

La barra lateral se genera de `ENLACES_NAV` en
`layouts/shell/shell.component.ts`. Hoy dibuja **18 enlaces en ocho grupos**;
las rutas siguen siendo **33 con componente** (32 hijas del shell más `/acceso`)
y hay dos redirecciones de compatibilidad (`/papelera` → `/archivo`,
`/directorio/instituciones` → `/directorio/organizaciones`).

```
PANORAMA TERRITORIAL
/mapa ······················ Panorama territorial   ← pantalla de entrada

PREVENCIÓN
/casos ····················· Casos
  /casos/sin-caso ·········· Demandas sin caso          (fuera del menú)
  /casos/:codigo ··········· Ficha del caso             (fuera del menú)
/alertas ··················· Alertas tempranas
/clima-social ·············· Clima social

INTERVENCIÓN
/resultados ················ Productos del diálogo

SEGUIMIENTO
/compromisos ··············· Compromisos

GESTIÓN DE IYC
/documentos ················ Documentos
/gobierno-sugerencias ······ Archivo de sugerencias
/exportaciones ············· Plantillas

DIRECTORIOS
/directorio/personas ······· Actores (mismo componente que /directorio/actores)
/directorio/organizaciones · Organizaciones
/directorio/autoridades ···· Autoridades y agentes
/directorio/locales ········ Auditorios

MI ESPACIO
/resumen ··················· Resumen operativo
/bandeja ··················· Bandeja de trabajo
/archivo ··················· Archivo

ADMINISTRACIÓN
/administracion ············ Administración
/administracion/etl ········ Consola ETL

FUERA DEL MENÚ
/directorio ················ Portada del directorio
/directorio/actores ········ Matriz completa de actores
/direccion ················· Resumen de Dirección
/busqueda ·················· Búsqueda global
/notificaciones ············ Centro de notificaciones
/ayuda ····················· Ayuda y criterios
/preferencias ·············· Preferencias

OCULTAS DE LA BARRA (ruta viva, sin enlace)
/dashboard ················· Dashboard analítico
/red-radar ················· Bandeja RED-RADAR
/matriz-conflictividad ····· Matriz de conflictividad
/reuniones ················· Reuniones
/reportes ·················· Reporte de actividad

ACCESO
/acceso ···················· Inicio de sesión
```

Administración, Consola ETL y Archivo se ocultan sin la capacidad correspondiente
(`soloSiEsAdmin` y `soloSiPuedeEliminar`). Los cinco enlaces de «Ocultas de la
barra» llevan `oculto: true` desde el 2026-11-24: ni se borró su componente ni
su ruta, sólo dejaron de dibujarse. El shell —cabecera, menú lateral y el botón
«Registrar ▾»— no es una ruta y tiene su propio apartado al final.

---

## Resumen de pendientes

Sólo las pantallas con algo pendiente. Lo más importante va primero. Los conteos incluyen el
encargo del **2026-11-25** (paridad con la matriz de conflictividad del equipo), cuyo detalle
está en `frontend_detalle.md`.

| Pantalla               | Pendientes | Lo más importante                                                          |
| ---------------------- | ---------: | -------------------------------------------------------------------------- |
| Ficha del caso         |          9 | Riesgo recalculable, contacto de actores y pestañas de reuniones/productos |
| Transversal (todas)    |          9 | Recorte por región en servidor, rango de fechas compartido y auditoría     |
| Panorama territorial   |          5 | Agrupar puntos, leyenda y tasa regional                                    |
| Perfil territorial     |          6 | Catálogo de artes de pesca; no tiene ruta todavía                          |
| ETL de tres pestañas   |          6 | Ejecución real, fuentes e historial                                        |
| Casos                  |          5 | Selector de sectorista, franja de hitos en la tarjeta e importador         |
| Compromisos            |          7 | Validación del punto focal, recarga de la matriz y directorio de usuarios  |
| Documentos             |          3 | Validación por fragmento, versiones y lista blanca por fuente              |
| Reuniones              |          2 | Registro real de reuniones y banderas                                      |
| Alertas tempranas      |          2 | Motivo de descarte y envío real por WhatsApp                               |
| Resumen operativo      |          2 | Panel de operación OAIPCS y sincronización global                          |
| Bandeja de trabajo     |          2 | Mapa y resumen de casos; indicador de completitud                          |
| Clima social           |          1 | Región y carga desde la pantalla                                           |
| Auditorios             |          1 | Editar el distrito desde la pantalla                                       |
| Dashboard              |          1 | Aging / antigüedad de los casos                                            |
| RED-RADAR              |          1 | Conector de señales y «convertir en alerta»                                |
| Autoridades            |          1 | Universo fuera de PRODUCE y agenda                                         |
| Archivo de sugerencias |          1 | Registro automático en `agent.run_log` / `lessons_learned`                 |
| Envíos y auditoría     |          1 | Vista de envíos con acuse y auditoría consultable (sin ruta)               |
| Acceso                 |          1 | Segundo factor                                                             |
| Búsqueda               |          1 | Fichas propias de alertas, compromisos, documentos y actores               |
| Preferencias           |          1 | Tamaño de página efectivo y ámbito/avisos en servidor                      |
| Shell                  |          1 | Registrar sin cambiar de pantalla                                          |

**Sin pendientes de interfaz:** `/casos/sin-caso`, `/reportes`, `/archivo`,
`/directorio`, `/directorio/actores`, `/directorio/organizaciones`,
`/directorio/instituciones`, `/direccion`, `/resultados`, `/notificaciones` y `/ayuda`.
En cada una se indica abajo si el hueco es de dato.

---

## Panorama territorial · `/mapa`

**Mockup:** `panorama-territorial.html` y su segundo estado `mapa-activos-radar-dpa.html`.
Ya están hechos: las tarjetas sin textos de apoyo, «Regiones con al menos un caso»,
«Alcance geográfico», el selector de ámbito, la columna ordenable, la tabla de regiones
bajo el mapa y sus enlaces a Casos (con `region`/`sinregion`, ámbito vigente y
`abiertos=true`); el cajón lateral «Ver casos»; el vocabulario **latente / manifiesto**
en tarjetas y columnas; la tabla de casos priorizados del item 118.

**Capa distrital (2026-11-24).** El item **128 está hecho** (`migration/47_gis_distritos.sql`

- `scripts/cargar-gis-neon.mjs`, **1 892** filas en `territorio.distrito` con
  `geometry(MultiPolygon,4326)`, centroide `ST_PointOnSurface` y población con procedencia).
  Los items **129 y 131 están hechos en su parte de polígonos**: el mapa pinta los distritos
  reales con coropleta por casos abiertos (relleno por `distritoUbigeo`, nunca por nombre),
  control «Límites distritales» con `aria-pressed`, ficha territorial al pulsar un polígono
  (población con procedencia y tasa por 100 000 con la fórmula escrita) y la columna
  «Casos por 100 000 hab.» dentro de esa ficha. Se retiró el rótulo «sin ubigeo distrital».

**Puntos del KML (2026-11-24).** El item **125 está hecho**: `capas.service.ts` pagina
`GET /api/v1/territorio/capas`, y el mapa dibuja en una capa propia los **13 229 derechos
acuícolas** y las **227 sedes institucionales** con su control de capa.

**Auditorios por centroide (2026-11-24).** El item **130 está hecho**: la migración
`48_locales_distritos.sql` asignó `distrito_id` a los **27** locales y el mapa los dibuja
en el centroide del distrito, rotulados «distrito» (no «dirección»).

| Item   | Qué falta                                                                                                                       | Por qué no está | Mockup                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------- |
| 27, 53 | Agrupación de puntos y filtro temporal sobre el mapa                                                                            | `Implementar`   | `mapa-activos-radar-dpa.html` |
| 129    | Leyenda de la coropleta y número de casos sin distrito: se calculan (`escalaCoropleta`, `casosSinDistritoTotal`) y no se pintan | `Implementar`   | `mapa-activos-radar-dpa.html` |
| 131    | Columna «Casos por 100 000 hab.» en la tabla de regiones (hoy sólo en la ficha distrital)                                       | `Implementar`   | `mapa-activos-radar-dpa.html` |
| 126    | Símbolo y filtro propios de los 31 desembarcaderos; las redes RADAR no tienen fuente                                            | `Dato`          | `mapa-activos-radar-dpa.html` |
| 127    | Estado de proyecto de cada DPA (etapa, expediente, avance)                                                                      | `Dato`          | `mapa-activos-radar-dpa.html` |

**Lo que cambia el panorama.** La regla de latente/manifiesto ya está ratificada y no
necesita ni columna nueva ni hechos públicos: **latente** = `Diferencia` + `Controversia`;
**manifiesto** = `Conflicto social` + `Crisis social` (Guía §7.5.1). Si el caso no tiene
nivel declarado, la etiqueta no se estima: se declara como «sin nivel».

**Nota de dato.** Los 31 desembarcaderos `DPA - GORE` ya están en el KML con nombre y
distrito, pero entran al mapa como «institucional» y comparten el símbolo de cualquier
sede. Las redes RADAR no tienen fuente cargada: `lib/db/repos/red-radar.ts` es la cola de
triaje de alertas, no la red instalada. La población es **sólo denominador** (tasas por
100 000 habitantes), nunca un peso de riesgo.

---

## Resumen operativo · `/resumen`

**Mockup:** `resumen-operativo.html`.
**Item 110 hecho:** la portada se organiza en las tres etapas de la Guía —**Prevención ·
Gestión · Seguimiento**— mediante `etapas()` en `resumen.page.ts`, cada una con métricas,
notas de ausencia y accesos. Debajo quedan las franjas de alertas por atender y
compromisos vencidos.

| Item | Qué falta                                                                                                                  | Por qué no está | Mockup                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------ |
| 85   | Panel de operación OAIPCS: cola de trabajo, carga del equipo y capacidad (superficie de esta ruta)                         | `Implementar`   | `resumen-operativo.html` |
| 46   | «Última sincronización» global: hoy hay hora real de casos y alertas, y «sin dato» en compromisos, documentos y territorio | `Dato`          | —                        |

Las cifras del resumen ya son agregaciones reales. El item 85 **no** se construye aparte:
su lectura de datos vive en `/dashboard` y su superficie de uso es esta ruta.

---

## Bandeja de trabajo · `/bandeja`

**Mockup:** `bandeja-unificada.html`.
Ya están hechos: los KPI, el tablero por columnas (backlog · en curso · en espera · hecho),
la tabla ordenada por vencimiento y el filtro por tipo. **Item 50 hecho:** el movimiento y
la edición de una tarjeta persisten con `PATCH /api/v1/bandeja/{entidadTipo}/{entidadId}`
(columnas, asignación, responsable, fecha límite, posposición con motivo y orden), y cada
campo deja un evento en `core.tablero_tarjeta_evento`.

| Item    | Qué falta                                                                                                                                  | Por qué no está | Mockup                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------ |
| 111     | Completar el tablero con mapa y resumen de casos (las columnas, los KPI y la matriz ya están)                                              | `Implementar`   | `bandeja-unificada.html` |
| 68 · X4 | Traer aquí el indicador de completitud del expediente: `expediente-completitud.component.ts` existe y no está montado en ninguna plantilla | `API`           | —                        |

La cola ordena **la primera página de cada fuente** (5 filas por fuente): la API no tiene
un listado único ordenado en servidor, y la pantalla lo declara. Los contadores y el SLA se
calculan desde esos datos.

---

## Casos · `/casos`

**Mockup:** `casos-tarjetas.html` y `casos_detalle_en_ventana_emergente_ajustes_22_nov.html`.
Ya están hechos: el desplegable de estado con conteos, el de **Nivel de conflictividad**,
el formato tarjetas/tabla, la búsqueda avanzada, las tarjetas a dos líneas, el filtro de
**Naturaleza**, la vista previa del caso, la vitrina de **duplicados** (`GET /v1/cases/duplicados`
y descarte de candidatos) y Archivar/Reabrir (item 37).

| Item      | Qué falta                                                                        | Por qué no está | Mockup                            |
| --------- | -------------------------------------------------------------------------------- | --------------- | --------------------------------- |
| 71        | Vincular el duplicado al registro existente (el aviso y el descarte ya están)    | `API`           | —                                 |
| — (nuevo) | **Matriz de demandas–intervenciones** por caso: exportación XLSX de cuatro hojas | `API`           | `matriz-conflictividad-caso.html` |
| — (nuevo) | Importación de la matriz del equipo: hoy sólo hay previsualización por CSV       | `API` + `Dato`  | `matriz-conflictividad-caso.html` |

**Matriz del equipo (lo nuevo).** La matriz está montada dentro de `/compromisos`
(`<app-matriz-equipo />`), no en la ficha. Exporta **CSV** (`/v1/matriz/export` y
`/v1/matriz/mapeo`) e importa en dos tiempos: `POST /v1/matriz/previsualizar` valida y
calcula el plan; la aplicación definitiva la ejecuta
`scripts/matriz/importar_matriz.py --apply --confirmar`. El XLSX de cuatro hojas
(`Casos`, `Compromisos`, `Nudos`, `Sin datos`) sigue decidido y **no** implementado:
`app/api/v1/matriz/csv.ts` declara que no hay parser XLSX.

**Import: bloqueante estructural, con salida decidida.** El importador exigía `tematica_equipo`
en casos y compromisos, y la migración 41 dice expresamente que no se añade; por eso `--apply`
se negaba a escribir. El encargo del **2026-11-25** resuelve la contradicción sin crear esa
columna: en el Excel la columna M es **por fila, y en esa hoja cada fila con demanda es una
demanda**, así que su temática va a `core.demandas.tematica_id` (normalizando la errata
«Ordenanamiento»). La temática del compromiso se **hereda de su demanda** (`compromisos.tematica_id`).
El cambio de código sigue pendiente. **No hace falta ningún cambio de esquema**: la columna ya existe y el importador puede escribir en ella.

**Lo que el export no puede rellenar es contenido.** El Excel del equipo trae 23 demandas,
56 compromisos y 111 hitos; AVISA tiene **325 demandas** (de otra fuente, `DEM-2026-XXXX`),
**8 compromisos** y **12 hitos**, y esos 8 están en **3 casos**. El **3P** está en
`core.demandas` y **no** en el Excel; las **capacidades 1–5** y la postura por actor siguen
sin columna.

**Naturaleza del caso.** `casos.naturaleza_id` (migración 40) existe y se siembra, pero desde
el 2026-11-26 **no se filtra ni se muestra en el listado**: el control y la columna se
retiraron. Sigue siendo un campo del modelo y del formulario de alta.

**Encargo del 2026-11-25 · paridad con la matriz del equipo.** No requiere cambios de esquema: todo se resuelve con columnas que ya existen. Lo decidido y cerrado:

| Decisión                                                | Efecto en la pantalla                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Unidad responsable» pasa a **«Sectorista»**            | Se mostrará desde `casos.punto_focal_usuario_id`, que ya guarda a los sectoristas. `unidad_responsable_id` es una **unidad orgánica** (`cat_unidades_organicas`) y deja de competir con la persona en el listado. |
| **No se usa «Prioridad de atención»**                   | Sólo el **Nivel de riesgo** (Bajo/Medio/Alto). `casos.prioridad_id` queda en desuso, sin borrarse.                                                                                                                |
| **Descripción del riesgo actual** + **Nivel de riesgo** | Textarea y select en la misma fila, en alta, edición y expediente.                                                                                                                                                |
| **Temática obligatoria por demanda**                    | Select en alta y edición de demanda; la API responde `422` sin ella; columna «Temática» en el expediente; las antiguas se leen como «Sin temática».                                                               |
| **Compromiso → demanda**                                | Select «Demanda que atiende» obligatorio en registros nuevos; columna «Compromisos» en la tabla de demandas del expediente.                                                                                       |

**Entregado el 2026-11-26 (interfaz + API, sin tocar la base).** La barra quedó en **Buscar
palabra clave · Nivel de riesgo (chips) · Región · Sectorista · switch Abiertos/Archivados ·
Búsqueda avanzada** (esta última discreta). «Nivel de conflicto» y «Resueltos» pasaron a la
búsqueda avanzada; se retiraron «Prioridad de atención», «Naturaleza» y «Unidad responsable»
(columna y filtro). El listado abre ordenado por **riesgo** y los **archivados van al fondo**
(`sort=risk`, resuelto en el servidor). El caso archivado muestra **Riesgo: Inactivo** en tabla,
tarjeta y vista previa. El alta de caso ganó **Descripción del riesgo actual** junto al **Nivel
de riesgo**, con los campos sin recuadro.

**Sectorista.** La API lo expone como `sectorista` / `sectoristaUsuarioId`, derivado de
`core.casos.punto_focal_usuario_id`. Hay columna, filtro (`sectorista`), línea en la tarjeta y
campo en la ficha.

**Pendiente.** El **selector** de sectorista en alta/edición necesita un directorio de usuarios
legible sin rol de administrador (hoy sólo existe `/v1/admin/usuarios`); y la franja de hitos en
la tarjeta, que exige un resumen de hitos en el listado. El importador todavía no carga las
columnas C, D, I ni M.

**Nota de diseño.** `/matriz-conflictividad` **no** es esta matriz: es el listado del
Anexo 15 con detalle lateral, hoja imprimible y CSV.

---

## Ficha del caso · `/casos/:codigo`

**Mockup:** `ficha-pestanas.html` y `ficha-reportes-monitoreo-documentos.html`.
Ya están hechos: la retirada de «Próximo paso», «Ruta de atención» y «Demandas» de
relaciones; el expediente de cuatro piezas; «Guardar PDF» para el perfil no administrador;
el riel de relaciones; la tabla de actores con exportación local; la edición por campo con
Cancelar/Guardar (item 18); Archivar/Reabrir (item 37); el **alta y la desvinculación de
actores** (`POST` / `DELETE /v1/cases/{codigo}/actores`, item 40); la pestaña
**Historial / Auditoría**; el enlace de **análisis de caso** (Canva) separado de los
documentos; y la **exportación de actores** en CSV y «Copiar para WhatsApp» (items 98/99).

| Item   | Qué falta                                                                                                                                                                                                  | Por qué no está | Mockup                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| 11     | Acción para recalcular el nivel de riesgo desde la ficha                                                                                                                                                   | `API`           | —                                          |
| 12     | **Apellidos** y **nombres** separados (la API devuelve `null`) y teléfono del actor en la ficha                                                                                                            | `Dato`          | —                                          |
| 15     | Categoría **AT / RR / PAR** en las alertas vinculadas (no existe columna)                                                                                                                                  | `Dato`          | —                                          |
| 16     | Que la sección Compromisos traiga la **clasificación** (progresivo/parcial, operativo o condicionado): el esquema y la columna existen, pero `GET /v1/cases` no la selecciona y hoy muestra «Sin declarar» | `API`           | `ficha-pestanas.html`                      |
| 41     | Pestañas **Reuniones** y **Productos/Envíos**; en Reuniones, las 4 marcas y las reuniones sin caso (Historial ya está)                                                                                     | `API`           | `ficha-pestanas.html`                      |
| 97     | Autor en los documentos del caso (`documentos.autor_texto` existe y el export lo usa; la ficha no lo trae)                                                                                                 | `API`           | `ficha-pestanas.html`                      |
| 98, 99 | Exportación **PDF** de actores y que organización y teléfono lleguen por API (CSV y WhatsApp ya están)                                                                                                     | `Dato`          | `ficha-pestanas.html`                      |
| 103    | Bloques **Reportes de monitoreo** y **Documentos del caso** (PRODUCE y normativa)                                                                                                                          | `Diseño`        | `ficha-reportes-monitoreo-documentos.html` |

**Cambios del 2026-11-26 (interfaz + API).** El interruptor «Activar la edición» pasó a un
botón visible **«Modificar»**, con el mismo control de permisos. El caso **archivado** muestra
`Nivel de riesgo: Inactivo`. La desvinculación de un actor ya no pide motivo: es una
confirmación directa, y el servidor ya acepta el `DELETE` sin `motivo` y **no devuelve** los
actores desvinculados (el filtro se movió de cliente a servidor). Se añadió la **Descripción
del riesgo actual** junto al **Nivel de riesgo** en datos generales.

**Demandas del expediente.** La tabla lleva **«Temática»** por demanda (las antiguas se leen
«Sin temática») y **«Compromisos»**, con los códigos `_COMP00#` enlazados a `/compromisos?q=`.
El alta y la edición de una demanda exigen **Temática**: la API responde `422
TEMATICA_REQUERIDA` y el formulario lo muestra.

**Se retiraron del expediente** «Nudos de la semana», «Matriz demandas – intervenciones» y el
bloque «Hitos del caso»: los hitos siguen viviendo donde corresponde, en **Compromisos**.

**Pendiente.** El directorio de usuarios legible por todos los roles (para elegir sectorista
en el alta) y el código de la demanda en el detalle del caso, que hoy no se envía: el selector
de compromisos rotula con el texto de la demanda.

**Lo que ya está y no se toca.** La ventana emergente de la tarjeta, el mapa de actores
como tabla, la exportación local, el alta/desvinculación de actores y el historial
funcionan.

**Nudos.** El backend sigue existiendo (`GET /v1/cases/{codigo}/nudos`, con semana,
descripción, seguimiento, estado y autor) y las tablas tienen 0 filas, pero la **sección se
retiró de la ficha el 2026-11-26** por decisión de producto. No se borró el endpoint.

---

## Demandas sin caso · `/casos/sin-caso`

Sin pendientes de interfaz. La vista existe y sigue viva en su ruta propia; el acceso se
retiró de la barra de Casos a propósito (X5).

**Nota de dato.** Las cifras dependen del entorno. La **base local reparada** queda en
**202 con caso · 123 sin caso** tras la migración 54. La consulta de verificación contra
**Neon** devolvió **200 con caso · 107 sin caso**. Ocultar el hueco no lo cierra: vincular
las demandas es una decisión de OAIPCS, no una pantalla.

---

## Alertas tempranas · `/alertas`

**Mockup:** `alertas-operativas.html`.
Ya están hechos los filtros por código, prioridad, estado, riesgo y «Sin caso asignado»,
los anchos de columna, la prioridad con plazo, la exportación por perfil, los controles de
revisión del item 23 (confirmación al aprobar, deshacer y visibilidad de la derivación),
la columna **Acciones** con Aprobar · Solicitar modificación · Anular (item 105) y el
**archivo con motivo**, distinto de anular (`POST /v1/alerts/{id}/archivar`, con
desarchivar).

| Item | Qué falta                                                                                                   | Por qué no está | Mockup                    |
| ---- | ----------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| 38   | Motivo de descarte, búsqueda de duplicados y conciliación con el documento original (los adjuntos ya están) | `API`           | —                         |
| 105  | Envío real por WhatsApp: hoy «Enviar por WhatsApp» sólo copia el texto al portapapeles                      | `API`           | `alertas-operativas.html` |

**Nota de archivo.** `archivado_en`/`motivo_archivo` existen en `core.alertas_tempranas`:
archivar no es anular, y la pantalla ya los separa.

---

## Clima social · `/clima-social`

Reporte mensual de clima social por período y región, con autor y archivo.
Ruta viva con componente real (`ClimaSocialPage`); mockup por dibujar.

| Item | Qué falta                                                                                                                     | Por qué no está | Mockup |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 116  | Campo **región** y carga del reporte desde la pantalla: la página ya lee los documentos `clima_social_general` / `focalizado` | `Dato`          | —      |

**Nota de dato.** Los reportes existen (7 generales y 6 focalizados, cargados por el
pipeline) y la pantalla los lista con mes, fecha, tipo, responsable, código y validación.
Lo que falta es región y la carga dedicada.

---

## Reuniones · `/reuniones`

Ruta viva, pero **no es el registro de reuniones**: `ReunionesPage` es un compositor de
mensajes (WhatsApp, correo, `POST /v1/mensajes/correo`) que declara «Sin reuniones
registradas». No hay endpoint de alta de reunión y la lectura sólo existe por
`GET /v1/resultados/reuniones`.

| Item           | Qué falta                                                                                                                 | Por qué no está | Mockup                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------ |
| 72–74, 77, 117 | Registro de reuniones con banderas (asistencia, AM, relatoría, publicación), reuniones sin caso y editor de ayuda memoria | `API`           | `reuniones-ayuda-memoria.html` |
| — (nuevo)      | Archivar reuniones sin caso, con motivo, distinto de anular                                                               | `Implementar`   | —                              |

**Nota de esquema.** Las cuatro banderas están en `migration/42_reuniones_sin_caso.sql`,
cuyo encabezado la marca como **propuesta, no ejecutada**; el archivo de reuniones está en
`migration/44_decisiones_2026_11_24.sql`. Ni las banderas ni el archivo tienen endpoint ni
pantalla: `/v1/resultados/reuniones` es sólo el listado para elegir a qué reunión cargar la
asistencia.

---

## Resultados · `/resultados`

Documentos que cierran la intervención: actas de acuerdo, ayudas memoria por temática y
relatoría de las reuniones. Ruta viva con componente real (`ResultadosPage`).

**Ya está:** cuatro pestañas (acta, ayuda memoria, relatoría, reporte de actividad), lectura
de `/v1/documents`, listas de asistencia y enlace a `/documentos`.
**Nota:** «Procesar con IA» es un aviso simulado (`setTimeout`), no una llamada real.

---

## Compromisos · `/compromisos`

**Mockup:** — (comparte el patrón de `alertas-operativas.html`); el panel del compromiso ya está.
Ya están hechos el calendario, el alta desde la lista, el estado calculado, la anulación con
motivo, la clasificación **formal / verbal**, los adjuntos como archivos, el **historial por
compromiso** (`GET /v1/commitments/{id}/historial` con notas) y la dimensión **«asumido por
el Señor Ministro»** separada de la unidad responsable (item 123).

| Item      | Qué falta                                                                                           | Por qué no está | Mockup |
| --------- | --------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 24        | Recordatorios y el **aviso cuando no hay hito**: `avisoSinVencimiento` se calcula y no se renderiza | `Implementar`   | —      |
| 39        | Recordatorios por compromiso (el historial ya está)                                                 | `API`           | —      |
| — (nuevo) | Historial de **nudos críticos** del compromiso: hoy los nudos viven en la ficha del caso, no aquí   | `Implementar`   | —      |

**Encargo del 2026-11-25 · verificación e hitos.** No requiere cambios de esquema: punto focal,
vencimiento y fecha real ya tienen columna. Sólo la validación del punto focal carece de
dónde guardarse y queda **fuera de esta entrega**. Lo decidido y cerrado:

| Decisión                                            | Efecto en la pantalla                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Punto focal**                                     | Campo que sugiere usuarios y acepta texto libre; visible en tabla y panel. Ya existía en el esquema, no se usaba.                                         |
| **Fecha real del hito**                             | Campo nuevo en «Nuevo hito»; obligatorio al pasar el hito a **Cumplido** (por defecto, hoy).                                                              |
| **Validación del punto focal**                      | Botón «Marcar validado por el punto focal» y filtro **Sin validar**. Columnas nuevas en `compromisos`, `medios` y `adjunto`.                              |
| **Medios de verificación**                          | Etiqueta «Medios de verificación» (no «Evidencia (URI)»); se cargan del Excel como evidencia del compromiso.                                              |
| **Vencimiento calculado**                           | Si no hay vencimiento manual, se usa la fecha planificada del último hito abierto, con el semáforo que ya calcula la vista de las migraciones 44 y 45.    |
| **Términos técnicos ocultos**                       | Se retiran «Origen del dato: AVISA_HISTORICO», «Clasificación: 2», «Criterios SMART (JSON)», «Evidencia (URI)», «lista blanca de la API» y «baja lógica». |
| **Franja de hitos y una sola línea de indicadores** | Un punto de color por hito, en orden de fecha, repetido en cada fila; los indicadores pasan de tres tarjetas a una línea que filtra la tabla.             |

**Sobre el contador «En proceso».** El cliente envía el valor correcto (`En proceso`, con
espacio) y la API lo resuelve con `core.normalizar_ref`, que elimina espacios y guiones bajos:
`En proceso` y `En_proceso` producen la misma clave. El catálogo vivo usa `En proceso` (id 2).
El «—» solo aparece si la consulta falla o mientras carga; ya no se pinta como si fuera un
valor sin dato.

**Entregado el 2026-11-26.** Los indicadores pasaron a **una sola línea** con cifras
pulsables (compromisos, cumplidos, en proceso, vencidos); la tabla lleva la **franja de hitos**
con color por estado y anillo rojo si están vencidos; el vencimiento usa la fecha efectiva
calculada con su semáforo; la etiqueta es **«Medios de verificación»**; se ocultaron los
términos técnicos y los criterios SMART se leen como `clave: valor`; y «Registrar compromiso»
quedó sin recuadros por campo.

**Demanda, punto focal y fecha real.** El alta de compromiso pide **«Demanda que atiende»** con
las demandas del caso (`GET /v1/cases/{codigo}`), obligatoria cuando el caso tiene demandas; el
panel muestra la demanda y el punto focal. El compromiso hereda la **temática de su demanda**.
El campo **punto focal** sugiere usuarios y acepta texto libre, excluyentes. «Nuevo hito» gana
**Fecha real**, obligatoria cuando el estado es **Cumplido** (la API responde `422
FECHA_REAL_REQUERIDA`).

**Pendiente.** El typeahead de punto focal sólo sugiere usuarios a quien es administrador,
porque el único directorio es `/v1/admin/usuarios`: el resto usa texto libre. «Sin hitos» y
«Sin validar» siguen sin filtro en el servidor. La **validación del punto focal (B3)** queda
fuera: exigiría columnas nuevas. La columna «Demanda» no se puso en la tabla para no
degradar la lectura; vive en el panel.

**Nota de dato.** El calendario se pinta vacío porque los 8 compromisos no tienen
`fecha_vencimiento` y el único hito con fecha está cumplido. Es un hueco de carga, no de
vista.

---

## Documentos · `/documentos`

**Mockup:** `etl-tres-pestanas.html` (la extracción comparte pantalla con la ETL).
Ya están hechos los botones Validar/Rechazar con confirmación, el alta de la ficha del
documento, el **hash SHA-256** visible, la **reextracción** (`POST /v1/documents/{id}/extraccion`),
las **versiones** (`GET /v1/documents/{id}/versiones`) y el **OCR** por servicio externo.

| Item | Qué falta                                                                                                | Por qué no está | Mockup |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 26   | Validación **por fragmento**: hoy es por documento; la reextracción y las versiones ya están             | `API`           | —      |
| 61   | Página/offset por fragmento en la tabla propia: sólo existen en la capa legacy `kag.documento_fragmento` | `Dato`          | —      |
| 62   | Lista blanca **por fuente** (hoy es por tipo de archivo) y reejecución versionada del pipeline           | `API`           | —      |

---

## Reporte de actividad · `/reportes`

Sin pendientes de interfaz. La pantalla lista y filtra los reportes registrados
(`analytics.vw_anexo_17_registro_reportes`) en dos pestañas: actividad e informe oficial.

---

## Archivo · `/archivo`

Sin pendientes. Lista los registros anulados con su fecha y permite restaurar.
`/papelera` redirige a `/archivo`.

---

## Directorio · `/directorio`

Sin pendientes. La portada con tarjetas por matriz ya está hecha (item 108), con tres
accesos: Actores, Organizaciones y Locales. Autoridades se abre desde el menú, no desde la
portada.

---

## Actores · `/directorio/actores`

**Mockup:** `directorio-crud.html`.
Ya están hechos la lista temporal entre filtros, el padrón de asistencia en CSV, la edición
de atributos públicos, la búsqueda por territorio, el detalle en panel lateral, el **alta**
(`POST /v1/actors`), la **captura y edición de PII bajo demanda con motivo auditado**
(`GET /v1/actors/{uid}/pii`), la **fusión de duplicados** (`POST …/fusion`) y la **baja
lógica con restauración** (`POST …/baja` y `…/restaurar`). También el registro con o sin
DNI, la membresía OSPA y el contacto opcional (items 44 y 45).

Sin pendientes de interfaz.

La columna «Organización» ya no se limita al ancla (`organizacion_ancla_uid`): pide
las membresías vigentes de la página entera con `GET /v1/actors/membresias?actorIds=…`
(una sola petición, como `/v1/media` con `entidadIds`) y lista todas las organizaciones
a las que pertenece cada persona, con su cargo. El panel lateral repite esa lista bajo
«Organizaciones a las que pertenece»; si no hay vínculo vigente se cae al ancla o se
declara «sin dato».

La vista admite el filtro `organizacion=<uid>`: cuando llega desde el botón de
organizaciones, un banner «Actores de <organización>» permite quitarlo. El identificador
es lo que filtra; el nombre sólo es la etiqueta de pantalla.

El enlace del menú «Actores» abre `/directorio/personas` (mismo componente, filtro fijo de
personas); `/directorio/actores` es la matriz completa fuera del menú.

**Otra pieza.** El cruce de actores por región y arte de pesca (item 120) y el maestro de
caletas (item 121) dependen del catálogo de artes: ver «Perfil territorial».

---

## Organizaciones · `/directorio/organizaciones`

Sin pendientes de interfaz.

Cada fila y el panel lateral ofrecen «Ver actores», que abre `/directorio/personas`
filtrado por esa organización (`organizacion=<uid>`); el identificador filtra y el
nombre viaja sólo como etiqueta de pantalla.

**Nota de dato.** 119 de 224 organizaciones tienen región; las 105 restantes están
declaradas y no se estiman.

---

## Instituciones · `/directorio/instituciones`

Sin pendientes: la ruta es un **alias** que redirige a `/directorio/organizaciones`, porque
el vocabulario «instituciones» ya no se usa en la interfaz. `instituciones.page.ts` quedó sin
enlace y se conserva sólo como referencia histórica.

---

## Auditorios · `/directorio/locales`

**Mockup:** `directorio-crud.html`.
Los 27 locales tienen aforo y contacto (23 de 27), **27 de 27 tienen `distrito_id`** desde
`migration/48_locales_distritos.sql`, y el mapa los dibuja en el centroide de su distrito.
En la navegación el nombre es «Auditorios»; la página todavía titula «Locales».

| Item | Qué falta                                                             | Por qué no está | Mockup                 |
| ---- | --------------------------------------------------------------------- | --------------- | ---------------------- |
| 115  | Editar el distrito desde la pantalla: la API de locales es sólo `GET` | `API`           | `directorio-crud.html` |

---

## Resumen de Dirección · `/direccion`

**Ya está:** el desglose por prioridad, riesgo y región, con cada fila enlazada al listado
filtrado, y las **variantes** del módulo (nacional, región y subsector) del item 52.

La **temática** no se muestra en ninguna vista (regla X7), tampoco en la ficha del caso.

---

## Dashboard analítico · `/dashboard`

**Mockup:** `dashboard-analitico.html`.
**Item 51 hecho:** la pantalla es real (`features/dashboard/`) y consume
`GET /v1/analitica` y `/v1/analitica/export`: KPIs de las siete entidades, series de
volumen, mezcla por nivel, actividad diaria y por usuario, resolución, filtros por región,
subsector, fechas y granularidad, y descarga CSV.

| Item | Qué falta                                                                              | Por qué no está | Mockup                     |
| ---- | -------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| 57   | **Aging / antigüedad** de los casos (las series temporales y la zona horaria ya están) | `Dato`          | `dashboard-analitico.html` |

---

## Bandeja RED-RADAR · `/red-radar`

**Mockup:** `bandeja-red-radar.html`.
**Real y con escritura:** cola con chips por estado, filtros, tabla, panel de detalle y
**triaje** (`PATCH /v1/red-radar/{id}/triaje`): confirmar, descartar con motivo, marcar
duplicada y devolver a pendiente. La pantalla declara que no existe conector RED-RADAR ni
tabla de señales: opera sobre `core.alerta_triaje`.

| Item | Qué falta                                                                           | Por qué no está | Mockup                   |
| ---- | ----------------------------------------------------------------------------------- | --------------- | ------------------------ |
| 76   | Conector de señales y «convertir en alerta»: hoy la cola triasea alertas existentes | `Dato`          | `bandeja-red-radar.html` |

---

## Matriz de conflictividad · `/matriz-conflictividad`

**Mockup:** `anexo-15-matriz-conflictividad.html`.
Es el **Anexo 15** como pantalla: tabla de 17 columnas, resumen latente/manifiesto, filtros,
paginación, detalle lateral, hoja imprimible y exportación CSV
(`GET /v1/conflictividad[/export]`). Sin pendientes de interfaz.

No confundir con la **matriz del equipo** (demandas–intervenciones por caso), que vive en
`/compromisos` y sigue necesitando XLSX e importación definitiva: ver «Casos».

---

## Archivo de sugerencias · `/gobierno-sugerencias`

**Mockup:** `gobierno-sugerencias.html`.
**Real y con escritura:** KPIs de decisiones (tasa de aceptación y tiempo medio), bandeja de
sugerencias con filtros, detalle con confianza y diff, alta y edición, cambio de estado con
nota, asignación y exportación CSV/PDF sobre `core.sugerencia`. Por diseño, el sistema
nunca aplica una sugerencia.

| Item | Qué falta                                                                                                                  | Por qué no está | Mockup                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------- |
| 87   | Registro automático en `agent.run_log`, `feedback_log` y `lessons_learned`: hoy el registro es manual en `core.sugerencia` | `Dato`          | `gobierno-sugerencias.html` |

---

## Exportaciones · `/exportaciones`

Ruta real sin mockup propio: galería de anexos con disponibilidad, número de registros y
campos faltantes, formatos HTML/PDF/XLSX/JSON, rango de fechas y código, vista previa en
iframe y descarga (`GET /v1/export/anexos` y `/v1/export/anexo-14|15`). Sin pendientes de
interfaz; los anexos que faltan son de generación (items 75 y 86).

---

## Administración · `/administracion`

Ruta real, sólo para `administrador`: resumen y cinco pestañas —usuarios y roles, catálogos,
lista blanca, configuración y migraciones— con `GET/POST/PATCH/PUT/DELETE` sobre
`/v1/admin/*`. Nunca expone `clave_hash`; los cambios se auditan. **Item 56 cubierto** en su
superficie de catálogos, unidades, roles, parámetros y usuarios.

---

## Consola ETL · `/administracion/etl`

**Mockup:** `etl-tres-pestanas.html`.
Tres pestañas reales —Extracción, Fuentes de integración e Historial de ejecuciones— sobre
`GET /v1/etl/resumen` y `/v1/etl/ejecuciones`. Es una consola de **diagnóstico**: «Analizar»,
«Agregar propuesta», «Editar/Suspender fuente» y «Reejecutar» están deshabilitados con el
motivo escrito.

| Item   | Qué falta                                                             | Por qué no está | Mockup                   |
| ------ | --------------------------------------------------------------------- | --------------- | ------------------------ |
| 58–60  | Motor de extracción, propuestas y aplicación por lote con transacción | `API`           | `etl-tres-pestanas.html` |
| 61, 62 | Ver «Documentos»                                                      | `Dato`/`API`    | `etl-tres-pestanas.html` |
| 86     | Generación documental por lote con run log y conciliación             | `API`           | `etl-tres-pestanas.html` |

---

## Autoridades y agentes · `/directorio/autoridades`

Ruta real (item 114, parcial): listado paginado con facetas por tipo, institución y región;
criterio autoridad vs. agente; panel con casos vinculados y PII bajo demanda con motivo
auditado (`GET /v1/autoridades[/{id}[/pii]]`).

| Item | Qué falta                                                                                                      | Por qué no está | Mockup          |
| ---- | -------------------------------------------------------------------------------------------------------------- | --------------- | --------------- |
| 114  | Prefectos, subprefectos, sectoristas PCM, alcaldes y direpros —fuera de PRODUCE— y la agenda de cada autoridad | `Dato`          | — (por dibujar) |

**Nota de dato.** El padrón de extensionistas ya está cargado
(`migration/63_autoridades_extensionistas_2026_11_25.sql`): **21 personas** —20 por
jurisdicción y la Coordinación Nacional— con `region_id` derivado de la jurisdicción,
`nivel_gobierno = 'Nacional'`, el detalle de provincias en `perfil_descripcion` y el
teléfono cifrado en `core.actor_datos_personales` (se lee con motivo auditado desde la
ficha). El universo «Actor público»/persona pasa de **108 a 129** filas: 102 autoridades y
27 agentes. Las 20 filas de jurisdicción llevan cargo «Extensionista» y aparecen como
agente; la Coordinación Nacional lleva «Coordinador Nacional» y aparece como autoridad.

---

## Inicio de sesión · `/acceso`

| Item | Qué falta                                                     | Por qué no está | Mockup |
| ---- | ------------------------------------------------------------- | --------------- | ------ |
| 48   | Sólo el segundo factor; la expiración por inactividad ya está | `Bloqueado`     | —      |

La sesión ya caduca a las 8 h, el login va contra la base y el cierre de sesión existe.
La **inactividad** ya expira a los 30 minutos, avisa en el último minuto con «Seguir en
sesión» y se coordina entre pestañas (`BroadcastChannel`); al expirar lleva a
`/acceso?motivo=inactividad`. El **segundo factor** sigue bloqueado hasta definir proveedor
y flujo institucional.

---

## Búsqueda global · `/busqueda`

| Item | Qué falta                                                                                                                                                                    | Por qué no está | Mockup |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 30   | Que alertas, compromisos, documentos y actores abran su **ficha propia**: hoy abren un panel con el territorio (región, provincia, distrito y ubigeo) y un enlace al listado | `API`           | —      |

La búsqueda ya cubre las seis entidades, agrupa los resultados y muestra el territorio.

---

## Centro de notificaciones · `/notificaciones`

Sin pendientes. La pantalla muestra categoría, estado y fecha, marca lectura (`POST /api/v1/notifications/{id}/leer`), desmarca (`PATCH /api/v1/notifications/{id}` con `estado=pendiente`) y «marcar todas» (`POST /api/v1/notifications/leer-todas`); resalta «Sin leer», lleva el contador «N sin leer» y filtra por estado en la URL. El **punto con contador de la campana ya está en el shell** (`layouts/shell/shell.component.html` + `core/http/notificaciones.service.ts`), alimentado por `noLeidas` del `GET`.

---

## Ayuda y criterios · `/ayuda`

Sin pendientes. La ayuda navegable, el glosario y la hoja de atajos ya están.

---

## Preferencias · `/preferencias`

| Item   | Qué falta                                                            | Por qué no está | Mockup |
| ------ | -------------------------------------------------------------------- | --------------- | ------ |
| 28, 47 | Tamaño de página efectivo y ámbito/avisos persistidos en el servidor | `Dato`          | —      |

Tema y densidad se guardan y **se persisten en la cuenta** (`PATCH /v1/preferences`, `core.usuario_preferencia`, migración 62). El tamaño de página aparece deshabilitado con nota: la API valida `tamanoPagina`, pero ningún listado lo consume todavía. El ámbito y los avisos siguen en `localStorage`.

---

## Shell · cabecera y menú

**Mockup:** `registrar-menu.html`.
Ya están hechos el nombre institucional, la navegación por grupos, los atajos `Ctrl/⌘+K` y
`/`, la marca que enlaza al panorama territorial (`/mapa`), el chip de ámbito con «Sesión» y
los cinco alcances (que actualiza la preferencia y el parámetro `alcance` en `/mapa` y
`/casos`), la navegación por teclado del menú y el contador de notificaciones.

| Item | Qué falta                                               | Por qué no está | Mockup                |
| ---- | ------------------------------------------------------- | --------------- | --------------------- |
| 65   | Abrir el formulario de registro sin cambiar de pantalla | `Implementar`   | `registrar-menu.html` |

Hoy «Registrar ▾» navega a la página de destino y abre el panel allí. «Reunión» sigue
visible y deshabilitada hasta que exista la capa de reuniones.

---

## Transversal a todas las pantallas

Pendientes que no pertenecen a una vista concreta.

| Item     | Qué falta                                                                                                                                                                     | Por qué no está | Estado    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------- |
| 29       | Rango de fechas compartido: `shared/ui/rango-fechas.component.ts` existe (7 d, 30 d, mes, año y fechas libres) y no lo consume ninguna vista                                  | `Implementar`   | Parcial   |
| 32       | Pruebas de formularios (19 `*.spec.ts`) y verificar contrastes AA del tema oscuro                                                                                             | `Implementar`   | Parcial   |
| 35       | Recorte territorial real por región: `/mapa` filtra en cliente y la API acepta `alcance` y `region`, pero no hay RLS de región ni lo aplica `/casos`                          | `Bloqueado`     | Parcial   |
| 36       | Usar el ubigeo como clave donde todavía se casa por nombre de región                                                                                                          | `Implementar`   | Parcial   |
| 42, 43   | Registrar en auditoría cada descarga de datos sensibles (hoy sólo se auditan escrituras)                                                                                      | `API`           | Pendiente |
| 57       | Aging / antigüedad para dashboards y bandeja (series y zona horaria ya están)                                                                                                 | `Dato`          | Parcial   |
| 66       | Un descriptor por entidad que genere los formularios y lea los catálogos de la API                                                                                            | `Implementar`   | Pendiente |
| 69       | Un solo componente de tabla: `shared/ui/tabla.component.ts` ya sirve alertas, compromisos, notificaciones y reportes; casos, documentos, actores y demandas mantienen la suya | `Implementar`   | Parcial   |
| 113 · X6 | Ámbito de subsector por rol: Dirección y Secretaría General ven ambos; cada Vice-ministerio el suyo                                                                           | `Bloqueado`     | Pendiente |

**Sobre el 113.** No es una pantalla: es una regla de sesión. Hoy no existe rol de
viceministerio ni ámbito de subsector, así que primero hay que tocarlo en el modelo de
permisos y en la seguridad por fila.

---

## Pantallas sin ruta o sin cerrar

Piezas acordadas que todavía no son pantalla. Las demás se construyeron: Dashboard
(`/dashboard`), RED-RADAR (`/red-radar`), Matriz de conflictividad
(`/matriz-conflictividad`), Archivo de sugerencias (`/gobierno-sugerencias`), Exportaciones
(`/exportaciones`), Administración (`/administracion`), Consola ETL (`/administracion/etl`)
y Autoridades (`/directorio/autoridades`).

| Pantalla           | Items   | Qué falta                                                                                                                     | Por qué no está | Mockup                    |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| Perfil territorial | 119–124 | Catálogo de artes de pesca, OSPA por caleta, demandas por OSPA y matriz región × recurso; sin el catálogo de artes no hay eje | `Dato`          | `perfil-territorial.html` |
| Envíos y auditoría | 55      | Vistas de envíos con acuse y auditoría consultable                                                                            | `Diseño`        | —                         |

**Nota de dato.** `dim_autoridades` tiene 2 filas, clima social 7 y 6, y el puente
caso–recurso 0. El catálogo de artes de pesca no existe como tabla. El puente 119–124 está
dibujado en `mockups/perfil-territorial.html`; no se construye hasta tener el dato.

La **matriz del equipo** no es una pantalla pendiente: ya está montada en `/compromisos`.
Lo que falta son el XLSX y la aplicación del import (ver «Casos»).

---

## Lo que no es una pantalla

Productos documentales y capacidad de análisis. No se dibujan como vista porque su salida es
un documento, un trabajo en lote o un método.

| Pieza                                 | Items    | Qué es                                                                                                                                |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Anexo 15 · matriz de conflictividad   | vista 15 | Vista imprimible en `/matriz-conflictividad`; mockup en `anexo-15-matriz-conflictividad.html`.                                        |
| Anexo 14 · seguimiento de compromisos | 25       | **Hecho:** `GET /v1/export/anexo-14` en HTML, PDF, XLSX y JSON, y entrada en la galería de anexos.                                    |
| Generador de anexos                   | 75, 86   | Un endpoint y un run log por anexo, con plantilla y revisión humana (14 y 15 ya salen).                                               |
| Clima social para mensajería          | 78       | **Endpoint hecho** (`GET /v1/export/clima-social/mensajeria`); falta la aplicación que lo consume.                                    |
| Análisis del caso                     | 79–84    | Triangulación, recurrencia, análogos y lecciones. `GET /v1/export/caso/{codigo}/analisis` existe; los Anexos 8 y 9 siguen pendientes. |

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
| X7    | La temática no se muestra en la interfaz (2026-11-24). Se conserva en la base porque el segmento temático está impreso en `codigo_caso`.                          |

**X7 aplicado (2026-11-24).** La matriz demandas–intervenciones de la ficha del caso ya no
pinta la temática bajo la demanda (`caso-detalle.page.html`); el modelo y el selector de
alta se conservan, porque el segmento temático compone `codigo_caso`.

---

## Cierre del 2026-11-28

Lo que se construyó y verificó en esta ronda. No es una lista de pendientes: es la
evidencia de que los ítems correspondientes ya no aparecen arriba.

| Vista               | Qué quedó hecho                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Alertas**         | Botón **Exportar todo** (CSV y XLSX) que vuelca el listado completo con los filtros vigentes, vía `GET /api/v1/export/alertas`; tope de 5000 filas con aviso legible al superarlo.               |
| **Alertas**         | El panel muestra la **herencia del caso vinculado**: resumen, actores (nombre · cargo/rol) y demandas con su estado, tomados del detalle de la alerta y con `GET /cases/{codigo}` como respaldo. |
| **Alertas**         | Bloque «Pegar reporte completo» en el alta y la edición: copia la plantilla, pega el reporte y lo reparte en los campos con `parsearPlantillaAlerta`.                                            |
| **Alertas**         | Los hechos ya no guardan la fecha dentro del texto: `85` y `86` la movieron a `alerta_hechos.fecha` y quitaron la viñeta `*`; `hechos_recientes` se recompone como texto derivado.               |
| **Compromisos**     | Listado con las seis columnas pedidas: Redacción · Fuente · Fecha · Plazo · Oficina responsable · Estado de cumplimiento. El panel muestra la **institución** cuando la API la trae.             |
| **Directorio**      | Importación de actores desde **`.xlsx`/`.xlsm`** (además del CSV), con columna opcional **Foto** que sube el medio y deja `tieneContenido=false` si no hay bytes.                                |
| **Directorio**      | `Foto.tieneContenido` en el dominio y helper `urlFoto()`, que prefiere `/api/v1/media/<id>/contenido` y respeta las URL externas.                                                                |
| **Directorio**      | La ficha de contacto retira «Clasificación de la información» y «Descripción del perfil» pasa a **«Ámbito de acción»**, justificado.                                                             |
| **Locales**         | Mapa Leaflet por local (marcador exacto o centroide regional con nota de aproximación), dirección explícita cuando falta y sección «Otros riesgos» leída de la descripción en markdown.          |
| **Casos**           | Cronología y WhatsApp en fecha compacta `02NOV2025`; el formato es único en toda la SPA (`shared/formato-fecha.ts`).                                                                             |
| **Carga histórica** | `87` amplía a `text` `core.actores.cargo_actual` y `core.reuniones_dialogo.titulo`, para no truncar el libro del sectorista.                                                                     |

**Migraciones aplicadas en la ronda:** `85`, `86`, `87`. Sigue pendiente `82`
(porteo de mesas). El estado completo está en
[`../06_operacion/migraciones-neon-estado.md`](../06_operacion/migraciones-neon-estado.md).

---

## Dónde está el detalle

- [`frontend_detalle.md`](frontend_detalle.md) — catálogo de los 131 items, hallazgos de
  base y carga, capa GIS, contratos de API, duplicidades y prioridad de mockups, más la
  **verificación del 2026-11-24** con evidencia de archivo y línea.
- `mockups/index.html` — índice de los 18 artboards canónicos y 17 variantes.
- [`mapa-sitio.md`](mapa-sitio.md) — barra lateral, rutas y criterio de agrupación.
- [`angular/CONTRATO_API_SPA.md`](angular/CONTRATO_API_SPA.md) — qué endpoint y qué campo
  necesita cada celda.
- [`angular/ESTADO_MIGRACION_ANGULAR.md`](angular/ESTADO_MIGRACION_ANGULAR.md) — estado
  técnico de la migración.
