# Revisión de AVISA frente al ERS y al sistema actual

**Fecha:** 19 de noviembre de 2026  
**Alcance:** ERS entregado como adjunto en la conversación, aplicación actual de este repositorio y fuentes preservadas en `docs/avisa_actual/`.  
**Naturaleza del resultado:** auditoría del prototipo, no certificación de cumplimiento del sistema en producción.

## Resumen ejecutivo

El prototipo nuevo ofrece una consola operativa navegable para priorizar pendientes, consultar casos de demostración, revisar alertas y seguir compromisos. La arquitectura visual favorece jerarquía, legibilidad y estados de revisión humana. Sin embargo, **no permite todavía gestionar de punta a punta todas las pantallas núcleo del ERS**: varias acciones de alta están deshabilitadas o solo muestran un aviso, y no hay módulos de actores/organizaciones ni comunicaciones. Los datos visibles son simulados y el backend actual solo expone login y un resumen; por lo tanto, ninguna operación de este prototipo debe entenderse como persistida o protegida para uso institucional.

## Qué hacía el sistema anterior

`docs/avisa_actual/LEEME.md` describe el legado como la aplicación institucional en Google Sheets + Apps Script. La carpeta conserva el shell `index.html`, las fuentes `Código.txt`, `AppJs.txt` y `AppFixes.txt`, el bundle efectivamente servido, catálogos estáticos de funciones y diagramas. El catálogo del frontend documenta carga, listado, búsqueda/filtros, detalle y operaciones de alta/edición para casos, alertas, reportes rápidos, clima social, hechos, acciones e hitos, actores, sectoristas, puntos focales y autoridades; también registra login, permisos por rol, exportación, cronologías, puentes con actores/recursos, notificaciones y log de envíos/accesos.

El menú legado visible en `index.html` organizaba muchas áreas de trabajo —casos, mesas/grupos, diálogo, hechos, acciones, hitos, análisis, organizaciones, actores, locales, alertas, reportes, demandas, autoridades, capacitación y reportes— en una sola navegación lateral. Esa amplitud facilitaba **encontrar módulos y reconocer de inmediato el inventario del sistema**, así como saltar entre registros operativos y de referencia. El shell usaba una barra lateral azul oscuro, menú con iconografía, tablas, filtros, formularios y modales. La densidad y el acceso directo eran ventajas para usuarios expertos, aunque el extenso menú y la tecnología basada en bundles evaluados dificultaban modernización y mantenimiento.

> La existencia de una función en el catálogo legado indica capacidad documentada en el código fuente; no equivale a una prueba de que todos los flujos sigan operativos hoy.

## Qué hace el sistema nuevo (este prototipo)

- **Inicio / resumen operativo:** indicadores, señales y prioridades; todos rotulados como demostrativos.
- **Bandeja de trabajo:** reúne alertas pendientes, compromisos próximos/vencidos y casos de riesgo alto.
- **Casos y ficha:** búsqueda por texto y riesgo, consulta de resumen, cronología/evidencia, actores sintéticos y siguiente paso.
- **Alertas:** búsqueda y filtro por estado; permite editar una cita demostrativa, aprobar o descartar con motivo en estado local de la sesión. No publica ni envía alertas.
- **Compromisos:** listado filtrable con caso, responsable, fecha, avance y estado. La creación no está habilitada.
- **Vista ejecutiva:** resumen de tres indicadores de demostración, contexto explícito y acceso a evidencia.
- **Acceso:** pantalla de login conectada a un fixture de backend; el perfil de demostración ahora aparece como Edith Bautista, Directora.

Estas interacciones son una representación de interfaz: la API en `backend/main.py` actualmente ofrece autenticación demo, `/health` y `/api/dashboard`; las colecciones de casos/alertas/compromisos del workspace son datos locales de demostración.

## Comparación visual: qué se gana y qué falta

| Aspecto | Legado Apps Script | Prototipo nuevo | Diferencia/acción recomendada |
| --- | --- | --- | --- |
| Navegación | Menú amplio con numerosos módulos agrupados y acceso directo | Navegación corta centrada en resumen, bandeja, casos, alertas y compromisos | El prototipo reduce carga visual, pero elimina accesos que los usuarios expertos usaban. Recuperar módulos necesarios mediante navegación por rol y agrupación, no volver a un menú plano extenso. |
| Densidad | Tablas densas y muchas acciones en la misma pantalla | Tarjetas y listas jerarquizadas con menos datos simultáneos | Mejora lectura rápida; aún faltan tablas paginadas, búsqueda por zona/estado y directorio para trabajar con grandes volúmenes. |
| Fichas | Formularios y modales para múltiples entidades | Ficha de caso de lectura, sin edición de hechos/documentos/demandas | Se conserva el contexto, pero no la capacidad integral de captura/edición. |
| Estados | Badges y señales visuales presentes en la interfaz heredada | Estados con texto, puntos y colores; mensajes de demo y revisión | Más explícito sobre validación, pero faltan estados globales consistentes de carga, vacío, error y sin permiso en todas las pantallas. |
| Visión ejecutiva | Reportes y exportaciones en varias vistas | Resumen específico, de baja densidad, con 3 KPI | La separación operativa/ejecutiva es mejor; la vista aún no presenta comparativo regional de TAB-04 ni datos reales validados. |
| Confianza y fuente | Funciones de exportación, comunicación y auditoría visibles por rol | Evidencia/cita y barrera humana representadas visualmente | Se muestran las restricciones, pero no hay persistencia, envío real ni bitácora; la representación no implementa seguridad. |
| Adaptación móvil | Shell de escritorio con menú contraíble | Navegación responsive y estructura reducida | El prototipo prioriza móvil; se debe conservar legibilidad y filtros en tablas con datos reales. |

## Auditoría de pantallas núcleo del ERS

Leyenda: **Parcial** = hay una parte navegable pero no cubre la función completa; **No** = no existe aún en la aplicación; **Fuera de alcance** = expresamente secundaria/futura en el ERS.

| ERS | Estado en la aplicación | Brecha concreta |
| --- | --- | --- |
| PAN-01 Ingreso | Parcial | Login de demostración, no autenticación institucional `SVC-09`. |
| PAN-02 Inicio | Parcial | Hay navegación e inicio, pero no se filtran accesos por rol real. |
| PAN-03 Lista/búsqueda de casos | Parcial | Lista y búsqueda por texto/riesgo; faltan filtro de zona/estado, paginación y estado persistente. |
| PAN-04 Ficha de caso | Parcial | Lectura de resumen, cronología y actores sintéticos; faltan edición/registro de hechos, demandas, actores, compromisos y documentos. |
| PAN-05 Registro de alerta | No | No hay formulario de alta ni acción para registrar y guardar una alerta. |
| PAN-06 Revisión de alertas | Parcial | Revisión, edición, aprobación/descartar son demo en memoria; falta persistencia, auditoría y confirmación adicional de Dirección para crisis/críticas. |
| PAN-07 Actores y organizaciones | No | No hay listado, ficha, pertenencia OSPA ni contactos condicionados por permiso. |
| PAN-08 Compromisos e hitos | Parcial | Seguimiento de compromisos disponible; alta, edición, hitos y persistencia ausentes. |
| PAN-09 Envíos y comunicaciones | No | No hay selección de productos, destinatarios, envío ni registro de resultado. |
| PAN-10 Administración | Fuera de alcance secundario | No implementada; el ERS la clasifica secundaria. |
| PAN-11 Zona/directorio | Fuera de alcance futuro | No implementada; el ERS la desplaza a 2027/H-45. |

### Tableros

- **TAB-02 Seguimiento de compromisos:** parcialmente representado en la tabla actual; no conectado a la vista SQL requerida ni a datos operativos.
- **TAB-04 Foto Alta Dirección:** vista ejecutiva diferenciada, pero aún no desglosa casos activos/riesgo/compromisos vencidos por región.
- **TAB-03 Casos estancados:** no implementado; su inclusión depende de que alcance el tiempo según ERS.
- TAB-01, TAB-05 y vistas 2027/MADRE no forman parte del núcleo obligatorio descrito para diciembre.

### Flujos de usuario citados por el ERS

El extracto del ERS recibido enumera pantallas y enlaza historias de usuario; no incluye el texto íntegro de cada HU. Con lo que especifica el extracto y lo que permite observar el prototipo:

| Flujo referido | Cobertura observada | Resultado |
| --- | --- | --- |
| HU-03 · carga manual de alerta | No existe captura ni guardado de alertas nuevas | No cubierto |
| HU-04 · aprobar/editar/descartar con motivo | El componente permite edición y decisión en el navegador; el estado no persiste | Parcial; solo demostración |
| HU-06 · elegir productos y registrar envío | No existe selección de productos, destinatarios ni envío | No cubierto |
| HU-08 · registrar y seguir compromisos/hitos | Hay listado/seguimiento; no alta manual, gestión de hitos ni persistencia | Parcial |
| HU-09 · promover actor preservando historial | Sin módulo de actores ni acción de promoción | No cubierto |

Por tanto, el menú principal no debe confundirse con cobertura funcional: los flujos ausentes requieren pantallas de gestión y servicios de backend antes de que pueda afirmarse que todo se administra desde AVISA.

## Controles visuales del ERS contrastados

- **Estructura de trabajo:** el layout usa tarjetas, listas priorizadas y tablas, dentro del límite visual de cuatro zonas/paneles en vistas operativas. La vista ejecutiva es más escueta, pero no debe declararse validada hasta conectarla a indicadores reales.
- **Legibilidad:** CSS afinado para reforzar texto de controles, tablas, badges y navegación manteniendo la paleta institucional sobria.
- **Semáforos:** riesgo, prioridad y estado llevan texto junto a marca/color; no dependen únicamente del color.
- **Filtros:** hay búsqueda/filtro en casos, alertas y compromisos, pero el patrón no es aún completo ni uniforme (zona, estado y paginación).
- **Estados obligatorios:** existe mensaje vacío en alertas/compromisos y feedback de acciones; carga, error y falta de permiso no están cubiertos de forma sistemática en todos los módulos.
- **Seguridad:** etiquetas de prototipo y datos sintéticos reducen confusión; no sustituyen SSO, RLS, control por rol, cifrado, auditoría inmutable ni gating real.

## Conclusión y orden de cierre

No se puede afirmar que hoy “todo se gestiona desde el sistema”: el prototipo sí permite recorrer los cuatro ciclos de demo (priorizar, consultar caso, revisar alerta, seguir compromiso), pero no captura actores, alertas nuevas, casos/hechos, hitos ni comunicaciones. Para cumplir el núcleo del ERS, completar primero formularios reactivos y validación para PAN-04/05/07/08; luego PAN-09 con selección/destinatarios y registro de envío; implementar persistencia y autorización institucional antes de datos reales. Añadir filtros/tabla paginada y los estados normal/cargando/vacío/error/sin permiso en todos los módulos. Mantener fuera del MVP las vistas que el ERS reserva explícitamente para fases futuras.
