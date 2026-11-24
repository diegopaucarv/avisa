# Mapa de sitio y barra lateral

Este documento describe la organización vigente de la consola Angular: los
grupos de la barra lateral, las rutas que cada enlace abre y las pantallas que
existen pero no aparecen en el menú. La fuente de verdad del menú es
`angular/src/app/layouts/shell/shell.component.ts` (`ENLACES_NAV`): el orden del
arreglo es el orden de la barra y los grupos se forman por contigüidad.

## Barra lateral

| Grupo                | Etiqueta             | Ruta                         |
| -------------------- | -------------------- | ---------------------------- |
| PANORAMA TERRITORIAL | Panorama territorial | `/mapa`                      |
| PREVENCIÓN           | Casos                | `/casos`                     |
| PREVENCIÓN           | Alertas tempranas    | `/alertas`                   |
| PREVENCIÓN           | Clima social         | `/clima-social`              |
| INTERVENCIÓN         | Reuniones            | `/reuniones`                 |
| INTERVENCIÓN         | Resultados           | `/resultados`                |
| SEGUIMIENTO          | Compromisos          | `/compromisos`               |
| GESTIÓN DE IYC       | Reporte de actividad | `/reportes`                  |
| GESTIÓN DE IYC       | Documentos           | `/documentos`                |
| DIRECTORIOS          | Actores              | `/directorio/personas`       |
| DIRECTORIOS          | Organizaciones       | `/directorio/organizaciones` |
| DIRECTORIOS          | Locales              | `/directorio/locales`        |
| MI ESPACIO           | Resumen operativo    | `/resumen`                   |
| MI ESPACIO           | Bandeja de trabajo   | `/bandeja`                   |
| MI ESPACIO           | Archivo              | `/archivo`                   |

`Archivo` solo se muestra a los roles con capacidad de eliminar
(`soloSiPuedeEliminar`). Reúne en una sola vista los registros anulados de
casos, alertas, demandas, documentos y compromisos. `/papelera` sigue
existiendo como redirección a `/archivo`.

`Actores` abre `/directorio/personas`: la vista de Actores con filtro fijo de
personas (mismo componente que `/directorio/actores`, la matriz completa).

## Criterio de agrupación

- **Panorama territorial** es la puerta de entrada geográfica. El panorama abre
  el listado de casos ya filtrado por región; no duplica la gestión del caso.
- **Prevención** reúne el trabajo preventivo: el caso, la alerta temprana y la
  lectura de clima social.
- **Intervención** reúne la reunión de diálogo y sus productos (actas, ayudas
  memoria, relatorías).
- **Seguimiento** es el ciclo de los compromisos y sus hitos.
- **Gestión de IyC** agrupa la producción documental y los reportes: el árbol de
  documentos es además la vista central del RAG e incluye, junto a los
  documentos del expediente, las ramas **Normativas** (`core.normativas`) y
  **Otros documentos** (`core.otros_documentos`).
- **Directorios** expone las tres matrices: personas, organizaciones y locales.
- **Mi espacio** son las vistas de trabajo personal y el archivo.

## Reportes de monitoreo

Los «reportes de monitoreo» del item 103 de los mockups no son un bloque ni una
ruta propios. Son el seguimiento de los compromisos, que ya vive en
`/compromisos`: compromisos, hitos, vencimientos y semáforo.

No se crea una vista aparte ni se duplica el dato. El seguimiento se consulta y
se actualiza en `/compromisos`.

## Rutas fuera del menú

Existen y siguen funcionando, aunque no tengan enlace en la barra:

| Ruta                        | Motivo                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/`                         | Redirige a `/mapa`.                                                                                                             |
| `/directorio`               | Portada visual con los tres accesos del directorio.                                                                             |
| `/directorio/actores`       | Matriz histórica que mezcla personas y organizaciones; se conserva para enlaces directos (por ejemplo desde la ficha del caso). |
| `/directorio/instituciones` | Título «Organizaciones públicas», ruta heredada.                                                                                |
| `/casos/sin-caso`           | Demandas registradas que todavía no tienen caso.                                                                                |
| `/casos/:codigo`            | Detalle del caso.                                                                                                               |
| `/direccion`                | Tablero de dirección con desglose regional.                                                                                     |
| `/busqueda`                 | Búsqueda global.                                                                                                                |
| `/notificaciones`           | Bandeja de notificaciones.                                                                                                      |
| `/ayuda`                    | Ayuda.                                                                                                                          |
| `/preferencias`             | Preferencias de la cuenta.                                                                                                      |

## Etiquetas con criterio propio

Las etiquetas de `docs/07_frontend/mockups/` son la referencia, con estas
decisiones explícitas:

- **Locales** en lugar de «Auditorios»: la ruta sigue siendo
  `/directorio/locales` y el sustantivo visible es «local».
- **Organizaciones** en lugar de «Instituciones»: el directorio habla de
  organizaciones; la ruta heredada `/directorio/instituciones` muestra
  «Organizaciones públicas».
- Las **alertas vinculadas** al caso se mantienen tal como están.

## Nomenclatura

- La conflictividad se describe como **latente** o **manifiesta**; nunca
  «activa».
- Se escribe **GORE** (gobierno regional).
- El dato ausente se declara («sin dato» o «—»); no se estima ni se completa.
