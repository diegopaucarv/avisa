# Mapa de sitio y barra lateral

Corte: **2026-11-24**. Este documento describe la organización vigente de la
consola Angular: los grupos de la barra lateral, las rutas que cada enlace abre
y las pantallas que existen pero no aparecen en el menú. La fuente de verdad del
menú es `angular/src/app/layouts/shell/shell.component.ts` (`ENLACES_NAV`): el
orden del arreglo es el orden de la barra y los grupos se forman por contigüidad.
Las rutas y sus componentes están en `angular/src/app/app.routes.ts` (todo
`loadComponent` perezoso).

Cuando este documento y el código discrepen, manda el código. El estado
pantalla por pantalla, con lo que falta, está en
`docs/07_frontend/frontend.md`.

## Barra lateral

Ocho grupos y 18 enlaces, en el orden del arreglo:

| Grupo                | Etiqueta               | Ruta                         | Condición             |
| -------------------- | ---------------------- | ---------------------------- | --------------------- |
| PANORAMA TERRITORIAL | Panorama territorial   | `/mapa`                      | —                     |
| PREVENCIÓN           | Casos                  | `/casos`                     | —                     |
| PREVENCIÓN           | Alertas tempranas      | `/alertas`                   | —                     |
| PREVENCIÓN           | Clima social           | `/clima-social`              | —                     |
| INTERVENCIÓN         | Productos del diálogo  | `/resultados`                | —                     |
| SEGUIMIENTO          | Compromisos            | `/compromisos`               | —                     |
| GESTIÓN DE IYC       | Documentos             | `/documentos`                | —                     |
| GESTIÓN DE IYC       | Archivo de sugerencias | `/gobierno-sugerencias`      | —                     |
| GESTIÓN DE IYC       | Plantillas             | `/exportaciones`             | —                     |
| DIRECTORIOS          | Actores                | `/directorio/personas`       | —                     |
| DIRECTORIOS          | Organizaciones         | `/directorio/organizaciones` | —                     |
| DIRECTORIOS          | Autoridades y agentes  | `/directorio/autoridades`    | —                     |
| DIRECTORIOS          | Auditorios             | `/directorio/locales`        | —                     |
| MI ESPACIO           | Resumen operativo      | `/resumen`                   | —                     |
| MI ESPACIO           | Bandeja de trabajo     | `/bandeja`                   | —                     |
| MI ESPACIO           | Archivo                | `/archivo`                   | `soloSiPuedeEliminar` |
| ADMINISTRACIÓN       | Administración         | `/administracion`            | `soloSiEsAdmin`       |
| ADMINISTRACIÓN       | Consola ETL            | `/administracion/etl`        | `soloSiEsAdmin`       |

**Retiradas del menú (2026-11-24).** Cinco entradas siguen en `ENLACES_NAV` marcadas `oculto: true` y sus rutas siguen vivas por URL: **Dashboard analítico** (`/dashboard`), **Bandeja RED-RADAR** (`/red-radar`), **Matriz de conflictividad** (`/matriz-conflictividad`), **Reuniones** (`/reuniones`) y **Reporte de actividad** (`/reportes`). No se borraron componentes ni rutas: sólo dejaron de dibujarse en la barra.

- **Archivo** sólo se muestra a los roles con capacidad de eliminar. Reúne en
  una sola vista los registros anulados de casos, alertas, demandas, documentos
  y compromisos. `/papelera` sigue existiendo como redirección a `/archivo`.
- **Administración** y **Consola ETL** sólo se dibujan para el rol
  `administrador`. `Administración` cubre usuarios, catálogos, configuración y
  lista blanca de correo; la consola ETL muestra ejecuciones y resumen de la
  última carga.
- **Actores** abre `/directorio/personas`: la vista de Actores con filtro fijo
  de personas (data `naturalezaFija: 'persona'`, mismo componente que
  `/directorio/actores`, la matriz completa).

## Criterio de agrupación

- **Panorama territorial** es la puerta de entrada geográfica. El panorama abre
  el listado de casos ya filtrado por región; no duplica la gestión del caso.
  El **Dashboard analítico** sigue en el mismo grupo, oculto de la barra, porque
  es otra lectura del mismo cuerpo de datos (series, distribuciones y
  comparaciones).
- **Prevención** reúne el trabajo preventivo: el caso y la alerta temprana. El
  triaje de señales de **RED-RADAR** y la **matriz de conflictividad** (Anexo 15)
  siguen en el grupo, ocultos de la barra; la lectura de clima social se mantiene
  visible.
- **Intervención** conserva los productos del diálogo (actas, ayudas memoria,
  relatorías) y los resultados. La reunión de diálogo sigue existiendo en
  `/reuniones`, oculta de la barra.
- **Seguimiento** es el ciclo de los compromisos y sus hitos. Aloja además la
  matriz del equipo (demandas–intervenciones) y su importación desde Excel.
- **Gestión de IyC** agrupa la producción documental y los reportes: el árbol de
  documentos es además la vista central del RAG e incluye, junto a los
  documentos del expediente, las ramas **Normativas** (`core.normativas`) y
  **Otros documentos** (`core.otros_documentos`). Aquí viven también **Gobierno
  y sugerencias** (propuestas y su triaje) y **Plantillas**
  (`/exportaciones`: Anexos 14 y 15, informes y mensajería de clima social).
- **Directorios** expone cuatro vistas: personas, organizaciones, autoridades y
  agentes, y auditorios.
- **Mi espacio** son las vistas de trabajo personal y el archivo.
- **Administración** es la trastienda de sólo-lectura/gestión de parámetros y la
  consola de ejecuciones ETL, fuera del flujo operativo.

## Reportes de monitoreo

Los «reportes de monitoreo» del item 103 de los mockups no son un bloque ni una
ruta propios. Son el seguimiento de los compromisos, que ya vive en
`/compromisos`: compromisos, hitos, vencimientos y semáforo.

No se crea una vista aparte ni se duplica el dato. El seguimiento se consulta y
se actualiza en `/compromisos`.

## Rutas fuera del menú

Existen y siguen funcionando, aunque no tengan enlace en la barra. Todas las
listadas aquí tienen componente salvo las que se marcan como redirección.

| Ruta                        | Motivo                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/`                         | Redirige a `/mapa`.                                                                                                             |
| `/acceso`                   | Inicio de sesión; fuera del shell y protegido por `visitanteGuard`.                                                             |
| `/directorio`               | Portada visual con los accesos del directorio.                                                                                  |
| `/directorio/actores`       | Matriz histórica que mezcla personas y organizaciones; se conserva para enlaces directos (por ejemplo desde la ficha del caso). |
| `/directorio/instituciones` | **Redirección** a `/directorio/organizaciones` (alias heredado; «instituciones» ya no se usa en la UI).                         |
| `/casos/sin-caso`           | Demandas registradas que todavía no tienen caso.                                                                                |
| `/casos/:codigo`            | Detalle del caso.                                                                                                               |
| `/direccion`                | Tablero de dirección con desglose regional.                                                                                     |
| `/busqueda`                 | Búsqueda global.                                                                                                                |
| `/notificaciones`           | Bandeja de notificaciones.                                                                                                      |
| `/dashboard`                | **Oculta de la barra (2026-11-24).** Dashboard analítico.                                                                       |
| `/red-radar`                | **Oculta de la barra (2026-11-24).** Bandeja RED-RADAR.                                                                         |
| `/matriz-conflictividad`    | **Oculta de la barra (2026-11-24).** Matriz de conflictividad (Anexo 15).                                                       |
| `/reuniones`                | **Oculta de la barra (2026-11-24).** Compositor de mensajes de la reunión.                                                      |
| `/reportes`                 | **Oculta de la barra (2026-11-24).** Reporte de actividad (Anexo 17).                                                           |
| `/ayuda`                    | Ayuda y criterios.                                                                                                              |
| `/preferencias`             | Preferencias de la cuenta.                                                                                                      |
| `/papelera`                 | **Redirección** a `/archivo`.                                                                                                   |
| `/**`                       | Comodín que redirige a la raíz (y por tanto a `/mapa`).                                                                         |

## Etiquetas con criterio propio

Las etiquetas de `docs/07_frontend/mockups/` son la referencia, con estas
decisiones explícitas:

- **Auditorios** en el menú, **Locales** en la página: la navegación dice
  «Auditorios» (`ENLACES_NAV`) y la ruta sigue siendo `/directorio/locales`;
  el sustantivo interno de la vista es «local». Es una inconsistencia declarada
  y pendiente de unificar.
- **Archivo de sugerencias** es el rótulo literal de `ENLACES_NAV` para
  `/gobierno-sugerencias`; la ruta conserva el prefijo histórico `gobierno-`.
- **Organizaciones** en lugar de «Instituciones»: el directorio habla de
  organizaciones; la ruta heredada `/directorio/instituciones` redirige a
  `/directorio/organizaciones`.
- **Autoridades y agentes** es la cuarta vista del directorio; no existía en el
  mapa anterior y ya está en la barra.
- Las **alertas vinculadas** al caso se mantienen tal como están.

## Nomenclatura

- La conflictividad se describe como **latente** o **manifiesta**; nunca
  «activa».
- Se escribe **GORE** (gobierno regional).
- El dato ausente se declara («sin dato» o «—»); no se estima ni se completa.
