# Guía de usuario de AVISA

Esta guía describe el uso de la aplicación AVISA tal como está construida en esta
versión del repositorio. Explica qué hace cada pantalla, qué puede hacer cada
perfil y qué límites tiene el sistema hoy. Cuando una función existe en el código
pero está desactivada o incompleta, se indica en la sección
«Limitaciones conocidas y pendientes».

Todas las fechas de esta guía se escriben en el formato `02NOV2026` (día a dos
dígitos, mes en mayúsculas de tres letras y año de cuatro dígitos).

---

## 1. Qué es AVISA y para quién

AVISA —App de Vigilancia y Sistematización de Información de Conflictos
Sociales— es la consola de prevención y gestión de conflictos sociales de la
Oficina de Articulación Intergubernamental y Prevención de Conflictos Sociales
(Dirección OAIPCS) del Ministerio de la Producción. La aplicación reúne, en un
solo lugar, el registro de casos, las alertas tempranas, el clima social, el
directorio de actores, los compromisos y los espacios de diálogo, y los presenta
en un panorama territorial.

Está dirigida a:

- **Sectoristas y analistas de la Dirección OAIPCS**, que registran y mantienen
  casos, alertas, actores y compromisos.
- **La Dirección OAIPCS**, que aprueba las alertas y decide la priorización de
  casos.
- **La Alta Dirección**, que consulta las vistas y recibe las alertas.
- **Perfiles de servicio, auditoría, lectura y consulta**, con acceso acotado
  según su rol.

Las vistas principales de la consola son:

| Módulo | Ruta | Para qué sirve |
|---|---|---|
| Panorama territorial | `/mapa` | Distribuye los casos abiertos por ámbito y región |
| Casos | `/casos` | Registro y seguimiento de casos |
| Alertas tempranas | `/alertas` | Registro, aprobación y remisión de alertas |
| Clima social | `/clima-social` | Consulta del reporte mensual de clima social |
| Productos del diálogo | `/resultados` | Productos de los espacios de diálogo |
| Compromisos | `/compromisos` | Seguimiento de acuerdos y compromisos |
| Mesas de diálogo | `/mesas` | Espacios de diálogo |
| Documentos | `/documentos` | Gestión documental |
| Archivo de sugerencias | `/gobierno-sugerencias` | Sugerencias y su archivo |
| Plantillas | `/exportaciones` | Plantillas y exportaciones |
| Directorios | `/directorio/*` | Actores, organizaciones, autoridades y auditorios |
| Mi espacio | `/resumen`, `/bandeja`, `/archivo` | Trabajo diario y papelera |
| Administración | `/administracion`, `/administracion/etl` | Catálogos y consola ETL |

---

## 2. Acceso y roles

### 2.1 Ingreso

El acceso se realiza en `/acceso` con **DNI y contraseña**. Si la sesión expira
por inactividad, la pantalla de acceso lo indica antes de pedir las credenciales
de nuevo.

### 2.2 Roles y capacidades

La aplicación replica la matriz de permisos de la base de datos. Los permisos de
escritura, anulación y acceso a datos personales se resuelven por rol.

| Rol | Qué ve | Editar | Aprobar / Anular |
|---|---|---|---|
| Administrador | Todas las vistas, incluida Administración y Consola ETL | Sí | Aprueba y anula (acumula todos los códigos) |
| Dirección OAIPCS | Todas las vistas operativas | Sí | Aprueba alertas (paso 3) y anula alertas; no anula otras entidades |
| Alta Dirección | Todas las vistas, en lectura | No | No |
| Sectorista | Vistas operativas y Archivo | Sí | Anula y restaura; no aprueba alertas |
| Servicio de agente | Vistas operativas | Sí | Remite alertas (paso 4); no anula |
| Analista cualitativo | Vistas operativas | Sí | No |
| Curador de política | Vistas operativas | Sí | No |
| Consulta | Vistas operativas, en lectura | No | No |
| Auditor | Vistas operativas, en lectura | No | No |
| Externo | Vistas públicas, en lectura | No | No |

Reglas que conviene retener:

- **La Alta Dirección no escribe.** La interfaz no le ofrece acciones de alta o
  modificación.
- **Solo el administrador y el sectorista anulan** registros en general. La
  anulación de **alertas** es la única excepción: la Dirección OAIPCS también
  puede anularlas, porque forma parte de su flujo.
- **El Archivo** (papelera) solo se muestra a quien puede anular y restaurar; la
  Dirección OAIPCS lo ve únicamente en la pestaña de alertas.
- **La clasificación de la información** que un perfil puede tratar tiene un
  tope por rol (de «reservado» a «confidencial»). Si un registro supera ese tope,
  la acción de modificar o anular queda bloqueada.
- **Los datos personales (DNI y teléfono)** solo los ven el administrador, la
  Dirección OAIPCS, la Alta Dirección y los sectoristas.

---

## 3. Navegación general

### 3.1 Barra superior

La barra superior contiene, de izquierda a derecha:

- El **menú lateral** (en pantallas pequeñas se abre y cierra con el botón de
  menú; en escritorio el panel es fijo y siempre visible).
- El logotipo **AVISA**, que lleva al Panorama territorial.
- El chip de **Ámbito**, que permite acotar lo que muestra la interfaz a la
  sesión o a un alcance territorial concreto. El propio chip advierte: «Recorta
  lo que muestra la interfaz; tus permisos no cambian».
- La **búsqueda transversal** (atajo `Ctrl+K`).
- El botón **«+ Nuevo»** y el botón **«Importar»**, visibles solo para perfiles
  con permiso de registro.
- La **campana de notificaciones**.
- El **perfil**, con las opciones Preferencias, Ayuda y criterios y Cerrar
  sesión.

### 3.2 Menú lateral

El menú se organiza en grupos:

| Grupo | Enlaces |
|---|---|
| PANORAMA TERRITORIAL | Panorama territorial |
| PREVENCIÓN | Casos · Alertas tempranas · Clima social |
| INTERVENCIÓN | Productos del diálogo |
| SEGUIMIENTO | Compromisos · Mesas de diálogo |
| GESTIÓN DE IYC | Documentos · Archivo de sugerencias · Plantillas |
| DIRECTORIOS | Actores · Organizaciones · Autoridades y agentes · Auditorios |
| MI ESPACIO | Resumen operativo · Bandeja de trabajo · Archivo (solo si puede anular) |
| ADMINISTRACIÓN | Administración · Consola ETL (solo administrador) |

### 3.3 Botón «+ Nuevo»

Solo aparece si el perfil puede registrar. Ofrece:

| Opción | Qué abre |
|---|---|
| Caso | Alta de un caso |
| Demanda | Alta de demanda; se habilita solo con un caso abierto |
| Compromiso | Alta de un compromiso |
| Alerta temprana | Alta de una alerta |
| Organización | Alta de una organización en el directorio |
| Institución | Alta de una institución (entidad pública) |
| Lista de asistencia | Importación de un padrón para generar la lista |
| Clima social | Lleva a la vista de Clima social |
| Boletín | Deshabilitado (requiere endpoint) |

### 3.4 Botón «Importar»

Abre el panel de importación agrupado por tipo de registro (Casos, Directorio,
Asistencia y Matriz). El panel acepta archivos CSV, TSV o celdas pegadas de
Excel y siempre previsualiza antes de escribir: «CSV, TSV o celdas pegadas de
Excel. Se previsualiza antes de escribir».

---

## 4. Panorama territorial

Es la pantalla de entrada de la consola y distribuye los casos abiertos del
ámbito de la sesión por región, sin estimar valores.

### 4.1 Qué muestra

- **Indicadores de cabecera:** casos latentes, casos manifiestos, regiones con al
  menos un caso y casos con riesgo alto. Si hay casos sin nivel declarado, se
  muestran aparte y cuentan como latentes.
- **Filtro por ámbito** (chips): «Todos» y cada alcance territorial, con su
  conteo.
- **Mapa referencial** con una capa opcional de límites distritales.
- **Casos por región** (tabla) con las columnas Región, Riesgo alto,
  Latentes/Manifiestos, % latente y Total. Al pie aparece la fila «Sin región»
  cuando corresponde. Al pulsar una fila se abre el detalle de sus casos; el
  nombre de la región abre el listado ya filtrado.
- **Casos abiertos** agrupados por ámbito, con barra de proporción y chips por
  región.
- **Casos priorizados**: tabla con Caso, Región, Distrito, Nivel de
  conflictividad, Riesgo e Inicio. La marca de priorizado la decide la Dirección
  OAIPCS desde el expediente del caso.

### 4.2 Qué no muestra

- Si la sesión está acotada a ciertas regiones y no hay casos en ellas, la vista
  lo declara y **no cae a «Todo el Perú»**.
- Los casos **sin región** no se reparten por región; se agrupan en la fila «Sin
  región» porque no se puede confirmar su pertenencia.
- No hay pronósticos ni valores estimados: cuando falta un dato, se declara el
  vacío.

---

## 5. Casos

### 5.1 Listado

- **Dos formatos de presentación:** Tarjetas y Tabla.
- **Exportar** la consulta en los formatos disponibles para el perfil.
- **«Nuevo caso»** para perfiles con permiso de registro.
- **Selección por fila** y «seleccionar todos los de la página», con barra de
  acciones para exportar o anular en lote.
- **Buscador** por texto.
- **Chips de riesgo** para filtrar por nivel.
- **Selector de Región**, con la opción «Sin región».
- **Interruptor Abiertos / Archivados**.
- **Búsqueda avanzada** con Nivel de conflictividad, «Resueltos (n)», Alcance,
  «Ordenar por» y «Limpiar filtros».

El orden por defecto es por **riesgo** (de Alto a Bajo). Otros órdenes
disponibles son por actualización reciente y por prioridad.

La tabla muestra las columnas **Caso, Región, Sectorista, Riesgo, Estado** y una
columna de **Relaciones** con accesos directos a Cronología, Compromisos,
Demandas y Actores del caso.

### 5.2 Vista previa lateral

Al abrir un caso desde la lista se muestra un panel lateral con:

- Código del caso y última actualización.
- Título y las insignias de Región, Riesgo, Estado y Nivel de conflictividad.
- Resumen del caso.
- Accesos a Línea de tiempo, Acuerdos, Demandas, Documentos y Actores.
- El bloque **«Caso de análisis (Canva)»**, editable si el perfil puede editar.

Al pie, el botón **«Abrir expediente completo»** lleva a la ficha del caso.

### 5.3 Expediente (vista de detalle)

El expediente es la vista de detalle del caso. Su cabecera ofrece:

| Acción | Comportamiento |
|---|---|
| Modificar | Alterna el modo de edición de la ficha |
| Archivar / Reabrir | Cambia el estado del caso (con confirmación) |
| Anular caso | Baja lógica con motivo; solo para perfiles que pueden anular |
| Exportar | Exporta la ficha en los formatos del perfil |
| Imprimir / Guardar PDF | Envía la ficha a impresión del navegador |
| Restaurar caso | Aparece si el caso está anulado |

Los **niveles de riesgo y de conflictividad** se cambian desde la cabecera. El
bloque de **Resumen del caso** incluye el «Riesgo concreto».

La ficha de datos permite editar, en modo edición, la **Temática**, el
**Subsector** y la **fecha de Inicio**, además del **Sectorista** y —solo para la
Dirección— la marca de **Priorizado**. Otros campos del registro no se editan
desde este bloque (véase «Limitaciones conocidas»).

Las secciones del expediente son:

| Sección | Contenido y acciones |
|---|---|
| Espacio de diálogo | Aparece cuando el caso refleja una mesa de diálogo |
| Actores | Vincular actor, copiar para mensajería, exportar CSV y desvincular (baja lógica) |
| Línea de tiempo | Registrar hecho, copiar en formato de mensajería y editar o quitar hechos (baja lógica) por ventana de meses |
| Demandas | Registrar demanda, copiar y eliminar demanda (baja lógica); columnas Demanda, Origen, Compromisos asociados y Estado de atención |
| Alertas vinculadas | Alerta, Fecha y acceso «Ver alerta» |
| Acuerdos y compromisos | Código, Compromiso, Clasificación y Carácter, Estado, Unidad y Vencimiento |
| Documentos | Documentos asociados al caso |
| Historial / Auditoría | Traza de cambios |
| Análisis de caso (Canva) | Riel lateral con anclas y el bloque editable de análisis |

En cada editor se advierte: «El clic fuera no cierra ni cancela: sólo «Cancelar»
o «Guardar cambios» terminan la edición».

### 5.4 Alta de un caso

| Campo | Observación |
|---|---|
| Título | Obligatorio |
| Regiones | Obligatorio; al menos una, por casillas |
| Ubicación | Buscador territorial |
| Alcance | Derivado de la ubicación; no editable |
| Temática | Si queda vacío, el código toma el sufijo `GEN` |
| Naturaleza | Catálogo |
| Subsector | Catálogo |
| Descripción del riesgo actual | Texto |
| Nivel de riesgo | Por defecto, Bajo |
| Unidad responsable | Catálogo |
| Resumen ejecutivo | Texto |
| Inicio | Fecha |

Durante el alta, la aplicación **detecta posibles duplicados** y permite
descartar el aviso con «No es duplicado».

---

## 6. Alertas tempranas

### 6.1 Listado

- **Indicadores:** Alertas, Atendidas, Pendientes y Sin caso.
- **«Registrar alerta»** para perfiles con permiso de registro.
- **Selección múltiple** con barra para exportar y anular en lote.
- **Filtros:** búsqueda por código o palabra, **Riesgo**, **Estado** y
  **Orden**.
- **Búsqueda avanzada:** Caso (Todos / Con caso / Sin caso, con contadores) y
  Archivo (Activas / Archivadas), más «Limpiar».

La tabla muestra el código, el título (con geografía y riesgo), el caso
vinculado (con opción de copiar el código), el revisor, el estado (incluida la
marca «Archivada») y las acciones de fila.

Las confirmaciones de flujo (aprobación definitiva, envío a revisión, devolución
a elaboración) se muestran en línea e incluyen un botón **Deshacer** tras la
acción.

### 6.2 Panel: lectura y edición

En **modo lectura**, el panel presenta las secciones 1) Situación actual,
2) Hechos, 3) Actores clave, 4) Demandas inmediatas, 5) Descripción del riesgo y
6) Acciones sugeridas; además, un bloque con el **caso vinculado** (resumen,
actores y demandas), los **adjuntos de la alerta** y la traza de estado,
modificación y último revisor. Al pie ofrece **Modificar contenido**, **Enviar
por WhatsApp** y Cerrar.

En **modo alta o edición**, los campos son:

| Campo | Observación |
|---|---|
| Título | Texto |
| Nivel de riesgo | Obligatorio |
| Alcance geográfico | Obligatorio: Distrito, Región o Nacional |
| Región o buscador | Región o búsqueda de distrito/provincia |
| Caso vinculado | Selector de caso |
| Situación actual | Texto |
| Hechos | Texto |
| Actores clave | Elegir del directorio o escribir un actor nuevo |
| Demandas inmediatas | Organización y demanda |
| Descripción del riesgo | Texto |
| Acciones sugeridas | Texto |

El formulario incluye un bloque plegable **«Pegar reporte completo»** con las
acciones **Aplicar al formulario** y **Copiar plantilla**, para trasladar un
reporte redactado con la plantilla institucional.

### 6.3 Flujo de aprobación

El flujo tiene cinco pasos:

| Paso | Nombre | Responsable |
|---|---|---|
| 1 | Elaboración | Sectorista |
| 2 | Validación previa | Sectorista |
| 3 | Aprobación definitiva | Dirección OAIPCS |
| 4 | Remisión | Servicio de agente |
| 5 | Archivo | Sectorista |

El flujo admite devoluciones (de 3 a 2, de 3 a 1 y de 2 a 1). El paso 5 no tiene
transiciones: para reabrir una alerta archivada se registra una alerta nueva.

Las acciones de fila dependen del rol y del paso. La Dirección ve Aprobar alerta,
Solicitar modificación, Devolver a elaboración y Archivar sin caso (o Quitar del
archivo); los demás perfiles ven Enviar a revisión, Ordenar remisión, Devolver a
elaboración y Archivar alerta; y siempre están disponibles Modificar y Enviar por
mensajería instantánea.

### 6.4 Mensajería y adjuntos

La acción «Enviar alerta por mensajería instantánea» **no envía un mensaje**: abre
un panel con el texto de la alerta en **solo lectura**, un contador de caracteres
y el botón **Copiar mensaje**, que lo copia al portapapeles para que el usuario lo
pegue en su canal.

Los adjuntos de la alerta se consultan desde el modo lectura del panel.

---

## 7. Clima social

Clima social es la vista del **reporte mensual** de clima social. Se alimenta de
un documento de tipo clima social y es de **solo consulta**. Cuando el mes no
tiene reporte, la vista declara el vacío: nunca estima valores.

- **Navegación por mes** con anterior, siguiente y «Ir al mes actual».
- **Ficha del reporte** con Mes, Fecha, Tipo, Responsable, Código, Validación, el
  botón **Abrir reporte** (cuando existe el PDF) y la exportación.
- **Secciones de contenido:** resumen ejecutivo, actores, clima social y hechos
  recientes, demandas locales y foco PRODUCE.
- **Lectura del territorio:** indicadores y una tabla de casos abiertos por nivel
  de conflictividad.
- **Histórico de reportes** con la acción «Ver mes».

El registro de un nuevo reporte no se hace desde esta vista; véase
«Limitaciones conocidas».

---

## 8. Directorio de actores

### 8.1 Listado

- **«Nuevo»** ofrece **Nuevo actor** y **Nueva organización**.
- Barra de **selección y exportación**.
- **Filtro por organización activa**.
- **Buscador** por nombre, abreviatura o cargo, con filtro por **Tipo**.
- **Tabla** con selección, Foto, Apellidos y Nombres, Contacto (con opción de
  copiar teléfono y correo), Organización o Institución, Región y Acciones (Ver,
  Editar, Agregar o quitar de la lista temporal, Dar de baja o Restaurar).

### 8.2 Ficha del actor

La lectura muestra teléfono, correo y DNI; cuando el perfil no puede ver datos
personales, estos se presentan enmascarados. También muestra organización,
abreviatura, región, tipo de actor, función, nivel de gobierno, distrito,
categoría, validación humana y clasificación de la información. El bloque de
**identificación OSPA** (RUC, expediente, estado, vigencia y cantidad de
afiliados) se muestra cuando corresponde y **no se valida contra padrón**. Los
datos complementarios se leen de la descripción libre, y se muestra el
**posicionamiento** del actor.

### 8.3 Edición de la ficha

Al abrir la edición se advierte: «El DNI se descifra al abrir esta edición y la
consulta queda auditada. Teléfono y correo se guardan cifrados; déjelos vacíos
para no cambiarlos». El formulario agrupa datos personales y filiación,
representatividad e institución, identificación OSPA (si es organización),
clasificación territorial y rol, y descripción del perfil. La **foto** se cambia
con el lápiz sobre la imagen en modo edición.

### 8.4 Lista temporal y lista de asistencia

- **Lista temporal:** botón flotante con contador y cajón para **Generar lista**
  o **Vaciar**. Desde la tabla o la ficha se agrega o quita al actor de la lista.
- **Lista de asistencia:** diálogo con Título de sesión, Lugar o sede y Fecha
  (obligatorios), selección de incluidos (Seleccionar todos / Quitar selección) y
  el botón **Descargar Excel**. Si el perfil no puede ver datos personales, el
  diálogo avisa que las columnas de DNI y teléfono saldrán en blanco; las firmas
  se dejan en blanco.

---

## 9. Importación

La importación se abre desde el botón «Importar» (o desde algunas opciones del
menú «Nuevo»). Acepta archivos `.csv`, `.tsv`, `.txt` y hojas de Excel
(`.xlsx`, `.xls`, `.xlsm`), o celdas pegadas. Los encabezados se comparan sin
tildes ni mayúsculas y admiten sinónimos; las columnas desconocidas se ignoran e
informan.

### 9.1 Tipos de importación

| Tipo | Grupo | Columnas obligatorias |
|---|---|---|
| Casos: sólo información del caso | Casos | Título, Región |
| Casos con demandas | Casos | Título, Región, Demandas |
| Actores: personas | Directorio | Nombre |
| Actores: organizaciones | Directorio | Nombre |
| Actores: instituciones | Directorio | Nombre, Nivel de gobierno |
| Lista de asistencia | Asistencia | Nombre |
| Matriz de casos (Anexo 15) | Matriz | — |

### 9.2 Columnas esperadas

**Casos:** Título, Región, Temática, Subsector, Naturaleza, Nivel de riesgo,
Nivel de conflictividad, Unidad responsable, Prioridad, Fecha de inicio (en
formato `AAAA-MM-DD` o `DD/MM/AAAA`) y Resumen. El código lo emite la base y el
distrito no se importa.

**Actores (personas):** Nombre, Cargo, Tipo, Función (Principal, Secundario o
Tercero imparcial), Posicionamiento (Dialogante, Legitimante o Conflictivo),
Región, DNI, Teléfono y Correo.

**Organizaciones:** Nombre, Siglas, Tipo, Nivel de gobierno, Región, RUC,
Expediente OSPA, Estado OSPA y Vigencia desde y hasta.

### 9.3 Qué pasa con los datos faltantes y los errores

- Antes de escribir, **Previsualizar** muestra el resumen de filas leídas,
  válidas y rechazadas.
- Si faltan columnas obligatorias, la importación se detiene y lo informa.
- Las filas con problemas se listan en una **tabla de rechazos** (Fila, Código y
  Motivo; se muestran hasta cuarenta).
- «Nada se escribe en la base hasta que pulse el botón de importar». Tras aplicar,
  se listan los rechazos devueltos por la API (Fila, Registro, Código y Motivo).

### 9.4 Casos particulares

- **Membresías:** se vinculan después de crear el actor.
- **Demandas:** heredan la temática del caso.
- **Instituciones:** se tratan como organizaciones públicas.
- **Lista de asistencia:** no crea actores.
- **Matriz de casos (Anexo 15):** este panel no la aplica; solo enruta a su vista
  y el importador de escritorio la aplica con confirmación.

---

## 10. Exportaciones e impresión

El menú de exportación ofrece, para cada registro o consulta, los formatos
disponibles según el perfil:

| Formato | Extensión | Alcance |
|---|---|---|
| JSON | `.json` | Datos estructurados |
| Excel | `.xlsx` | Hoja de cálculo |
| PDF | `.pdf` | Tabla imprimible |

Además, el menú incluye **«Base completa»** en JSON, Excel (una hoja por
entidad) y PDF (respaldo imprimible).

El perfil **sectorista sin perfil de dirección** dispone únicamente de Excel y
PDF; los demás perfiles disponen de las tres salidas.

La **impresión** de la ficha del caso usa el diálogo del navegador (Imprimir /
Guardar PDF).

---

## 11. Reglas transversales

- **Fechas:** se muestran en el formato `02NOV2026`.
- **Modos de edición:** las fichas y paneles alternan entre lectura y edición. En
  edición solo se guardan los cambios con «Guardar cambios»; «Cancelar» los
  descarta.
- **El clic fuera no cierra los modales en edición:** solo los botones de
  Cancelar o Guardar terminan la edición. (Los menús de la barra superior, en
  cambio, sí se cierran al hacer clic fuera o con la tecla Escape.)
- **Bajas lógicas:** desvincular actores, eliminar demandas y quitar hechos no
  borran el registro; lo marcan como anulado y puede restaurarse desde el Archivo.
- **Datos personales (DNI y teléfono):** solo los ven el administrador, la
  Dirección OAIPCS, la Alta Dirección y los sectoristas. El motivo es proteger
  información sensible: el DNI se descifra solo al abrir una edición y esa
  consulta queda auditada; el teléfono y el correo se guardan cifrados. Sin
  permiso, las columnas de DNI y teléfono aparecen en blanco en las listas.

---

## 12. Limitaciones conocidas y pendientes

- **Menú lateral:** en escritorio es fijo y no se colapsa; solo en pantallas
  pequeñas se abre y cierra como panel superpuesto.
- **Boletín:** la opción del menú «Nuevo» está deshabilitada («requiere
  endpoint»).
- **Clima social:** es de solo lectura; no hay formulario de alta. La opción
  «Clima social» del menú «Nuevo» solo navega a la vista.
- **«Nudos de la semana» en el listado de casos:** el bloque está comentado en la
  plantilla y no se muestra.
- **Mensajería de alertas:** solo copia el texto al portapapeles; no envía
  mensajes por ningún canal.
- **Matriz de casos (Anexo 15):** no se aplica desde la interfaz; la ejecuta el
  importador de escritorio con confirmación.
- **Rutas ocultas del menú:** el Dashboard analítico, la Bandeja RED-RADAR, la
  Matriz de conflictividad, las Reuniones y el Reporte de actividad existen como
  rutas y se alcanzan por URL, pero no se dibujan en el menú.
- **Edición del expediente:** desde la ficha de datos solo se editan la Temática,
  el Subsector y la fecha de Inicio (más riesgo y conflictividad en la cabecera,
  el sectorista, la marca de priorizado, el resumen y el bloque Canva). El resto
  de campos del registro se admite por la API pero no se pinta en esta versión.
- **Bloque «Locales» de la ficha:** con la tabla de responsables locales vacía, el
  bloque no aparece.
- **Datos OSPA:** no se validan contra padrón; los datos complementarios se leen
  de la descripción libre.
- **Datos personales:** el DNI se descifra al abrir la edición (consulta
  auditada); sin permiso, las columnas correspondientes salen en blanco.

---

## 13. Glosario

| Término | Definición |
|---|---|
| Caso | Registro de una situación de conflictividad que se previene o se gestiona |
| Expediente | Vista de detalle de un caso |
| Alerta temprana | Instrumento que informa oportunamente una situación de riesgo social y formula recomendaciones de acción |
| Clima social | Reporte mensual sobre la situación social del territorio |
| Actor | Persona u organización con interés o participación en un caso |
| Organización | Entidad privada o de la sociedad civil del directorio |
| Institución | Entidad pública del directorio |
| Sectorista | Perfil que registra y mantiene la información operativa |
| Dirección OAIPCS | Oficina de Articulación Intergubernamental y Prevención de Conflictos Sociales; aprueba las alertas |
| Posicionamiento | Clasificación del actor como Dialogante, Legitimante o Conflictivo |
| Priorizado | Marca que la Dirección OAIPCS asigna a un caso para destacarlo |
| Baja lógica | Anulación de un registro sin borrarlo; puede restaurarse desde el Archivo |
| Papelera / Archivo | Vista de registros anulados con opción de restauración |
