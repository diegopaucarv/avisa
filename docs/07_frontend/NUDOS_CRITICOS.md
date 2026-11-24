# Nudos críticos · Conducta funcional

**Aplicativo de apoyo a la gestión de conflictos sociales** · PRODUCE · OAIPCS
**Estado:** propuesta funcional para OAIPCS · 23 nov 2026
**Base del diseño:** `migration/41` y `migration/43`, propuestas y no ejecutadas.
**Alcance:** conducta funcional. No describe pantallas, colores ni componentes.
**Principio:** el dato ausente se declara, no se estima. Una celda vacía no es un cero; una mitad faltante no se completa por inferencia.

Este documento responde qué es un nudo crítico, quién lo escribe, cuándo, cómo cambia de estado, dónde se ve y cómo se importa desde la matriz del equipo. Los hechos de la fuente son los verificados en la hoja `Reporte de avance de casos punt` del archivo `23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx`.

---

## 1 · Qué es un nudo crítico en AVISA y qué no es

Un nudo crítico es el registro semanal del obstáculo concreto que impide avanzar en un caso, en uno de sus compromisos o en un hito, junto con el seguimiento de lo actuado para desatarlo. Se escribe a nivel de fila de la matriz: cada fila es un hito o una acción. Por eso un mismo caso puede tener varios nudos en la misma semana, y el modelo no impone «un nudo por semana».

| Objeto          | Qué es                                                  | Unidad de registro                       | Quién lo escribe                        | Qué produce                                       |
| --------------- | ------------------------------------------------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| Nudo crítico    | Obstáculo semanal declarado en texto, con seguimiento   | Caso + compromiso opcional + semana      | Punto focal del compromiso o sectorista | Historial semanal y explicación del estancamiento |
| Alerta temprana | Reporte de un hecho que puede escalar                   | Alerta con código, nivel y destinatarios | Sectorista                              | Flujo de alerta y aprobación                      |
| Hito            | Obligación verificable con fecha y validación           | Hito de compromiso                       | Responsable del hito                    | Cumplimiento del hito                             |
| Compromiso      | Obligación asumida con unidad responsable y punto focal | Compromiso                               | OAIPCS                                  | Seguimiento del cumplimiento                      |

**Lo que un nudo no es.**

- No es una alerta: no tiene nivel de alerta, no se aprueba, no se envía y no abre el flujo de alerta.
- No es un hito: no tiene fecha de cumplimiento ni validación de hito. Explica por qué un hito no se cumplió.
- No es un compromiso: no crea obligación, responsable ni fecha.
- No es un indicador de riesgo ni de conflictividad: no modifica `nivel_riesgo_id` ni el nivel del caso.
- No es una síntesis de la semana: es el texto de una celda, no un promedio ni un resumen elaborado.

**El nudo no asigna nivel de conflictividad.** El nivel se compone así:

| Nivel      | Composición                              | Regla                                                                |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Latente    | Diferencia · Controversia                | Se declara cuando el desacuerdo aún no se expresa como confrontación |
| Manifiesto | Conflicto social · Crisis social         | Se declara cuando la confrontación ya es pública o disruptiva        |
| «Activo»   | No existe en el vocabulario del proyecto | Prohibido su uso para el nivel de conflictividad                     |

Si el texto semanal describe una escalada, esa escalada se registra por el flujo del caso; el nudo sólo la menciona. Está prohibido rotular un nudo, un caso o un panel como «activo». La palabra «abierto», aplicada al nudo, califica su estado operativo y no el nivel de conflictividad.

---

## 2 · Quién lo escribe, quién lo valida y quién lo lee

**Regla de acceso.** El permiso se resuelve primero y el ámbito de subsector se aplica después. La Directora y el/la Secretario/a General ven ambos subsectores; cada Viceministerio ve sólo su subsector: Pesca y acuicultura o MYPE e industria. Un permiso de lectura no amplía el ámbito.

**Leyenda.** `E` escribe · `V` valida o cierra con cuatro ojos · `L` lee · `—` sin acceso.

| Acción                         | Punto focal del compromiso                   | Sectorista                             | Coordinador OAIPCS      | Dirección             | Consulta |
| ------------------------------ | -------------------------------------------- | -------------------------------------- | ----------------------- | --------------------- | -------- |
| Registrar nudo                 | `E` sólo en compromisos donde es punto focal | `E` en casos de su ámbito              | `E`                     | `—`                   | `—`      |
| Editar nudo en periodo abierto | `E` sólo si es autor                         | `E` si es autor o responsable del caso | `E`                     | `—`                   | `—`      |
| Cambiar estado del nudo        | `E` sólo 1→2 y 2→3, en nudos propios         | `E`                                    | `E`                     | `—`                   | `—`      |
| Validar contenido              | `—`                                          | `V` sólo si no es autor                | `V`                     | `—`                   | `—`      |
| Cerrar periodo semanal         | `—`                                          | `—`                                    | `V`                     | `—`                   | `—`      |
| Editar periodo cerrado         | `—`                                          | `—`                                    | `E` con motivo y rastro | `—`                   | `—`      |
| Anular nudo o semana           | `—`                                          | `—`                                    | `E` con motivo          | `—`                   | `—`      |
| Leer nudos del ámbito          | `L`                                          | `L`                                    | `L`                     | `L` ambos subsectores | `L`      |
| Exportar histórico             | `—`                                          | `L`                                    | `E`                     | `L`                   | `—`      |

**Regla del rol.**

| Rol                        | Regla                                                                                                                                                       | Sustento                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Punto focal del compromiso | Escribe sólo donde la matriz lo declara punto focal de la acción. Si la fuente sólo trae nombre y no usuario, el sectorista registra y se usa `autor_texto` | `core.compromisos.punto_focal_usuario_id` y `punto_focal_texto` |
| Sectorista                 | Responde por el caso y valida lo que no escribió. No valida sus propios nudos                                                                               | `sectorista_usuario_id` en el flujo de alertas                  |
| Coordinador OAIPCS         | Escribe, valida, cierra periodos, anula y exporta. No sustituye la autoría: toda edición conserva autor y fecha                                             | Rol `direccion_oaipcs`                                          |
| Dirección                  | Lee ambos subsectores y exporta. No escribe: el nudo es registro técnico, no acto de aprobación                                                             | `core.roles.puede_editar` es falso para `alta_direccion`        |
| Consulta                   | Sólo lectura, dentro de su ámbito. No exporta porque la exportación arrastra textos completos y nombres de autores                                          | Rol `consulta_lectura`                                          |
| Administrador              | No redacta. Anula o corrige con auditoría                                                                                                                   | Rol `administrador`                                             |
| Agente                     | Propone borrador con `origen_dato = agente`. Nunca valida ni cierra                                                                                         | Rol `servicio_agente`                                           |
| Auditor                    | Lee la bitácora. No escribe                                                                                                                                 | Rol `auditor`                                                   |
| Externo público            | Sin acceso al nudo                                                                                                                                          | Rol `externo_publico`                                           |

**Regla de la acción.**

| Acción                    | Regla                                                       | Excepción                                        |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Registrar                 | Escribe quien tiene vínculo con el compromiso o el caso     | El punto focal sólo donde la matriz lo declara   |
| Editar en periodo abierto | Edita el autor y quien responde por el caso                 | El coordinador edita cualquier nudo de su ámbito |
| Cambiar estado            | El autor mueve 1→2 y 2→3                                    | Los estados terminales exigen validación         |
| Validar                   | Cuatro ojos: nunca el autor del texto                       | El coordinador valida nudos del sectorista       |
| Cerrar periodo            | Cierra la edición, no el nudo                               | El coordinador puede cerrar antes del plazo      |
| Editar periodo cerrado    | Exige motivo, autor y fecha; conserva el texto anterior     | Sólo el coordinador                              |
| Anular                    | Baja lógica con motivo; no borra la fila ni el `origen_ref` | Sólo el coordinador                              |
| Leer                      | Todos los roles con ámbito                                  | El ámbito filtra después del permiso             |
| Exportar                  | Coordinación y dirección                                    | Consulta no exporta                              |

**Celdas que requieren justificación explícita.**

| Celda                                        | Por qué                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Punto focal escribe sólo compromisos propios | La matriz declara el punto focal por acción, no por caso; escribir fuera de ese vínculo rompe la trazabilidad |
| Punto focal no valida                        | Un solo actor no puede registrar y validar el mismo texto                                                     |
| Sectorista valida sólo si no es autor        | Evita la autoaprobación y mantiene los cuatro ojos                                                            |
| Dirección no escribe                         | La cadena de aprobación de alertas es otro flujo; el nudo no se aprueba                                       |
| Consulta no exporta                          | La exportación sale del aplicativo y pierde el control de ámbito                                              |
| Administrador no redacta                     | Su función es corregir con auditoría, no producir el dato                                                     |

---

## 3 · Cuándo se escribe

La cadencia es semanal. La semana no se calcula con un calendario propio: se toma el periodo que declara la fuente. Los ocho periodos verificados son:

| Par | Periodo                                                  | Observación                                 |
| --- | -------------------------------------------------------- | ------------------------------------------- |
| 1   | 01–09 feb 2026                                           | Nueve días                                  |
| 2   | 10–16 feb 2026                                           | Siete días                                  |
| 3   | 17–23 feb 2026                                           | Siete días                                  |
| 4   | 24 feb – 02 mar 2026                                     | Siete días                                  |
| 5   | 03–09 mar 2026                                           | Siete días                                  |
| 6   | 10–17 mar 2026                                           | Ocho días                                   |
| 7   | 18–23 mar 2026                                           | Seis días                                   |
| 8   | Nudo: 29 abr – 04 may 2026 · Seguimiento: 04–11 may 2026 | Descuadrado en origen; se conserva tal cual |

| Momento               | Regla                                                                                                                                    | Qué ve el usuario                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Apertura              | La semana existe cuando hay al menos una celda con contenido. Para captura manual nueva se propone lunes a domingo, guardado como fechas | «Semana del 23 al 29 nov 2026»                                          |
| Registro              | Se escribe dentro del periodo o después. El periodo real manda                                                                           | Fecha de captura visible junto al autor                                 |
| Registro tardío       | Se registra con su periodo real y se marca «registro tardío». Nunca se reasigna a la semana en curso ni se mueve para llenar un hueco    | «Registrado el 18 nov 2026 para la semana del 02 al 08 nov 2026»        |
| Cierre                | El periodo cierra a los siete días calendario siguientes a `semana_hasta`, a las 23:59, o cuando el coordinador lo cierra antes          | «Periodo cerrado» y el botón de edición cambia a «Solicitar corrección» |
| Semana sin registro   | Se declara «Sin registro en la semana». No se muestra 0                                                                                  | «Sin registro»                                                          |
| Anulación de semana   | Baja lógica con motivo y autor. No se borra el `origen_ref`                                                                              | «Semana anulada» con motivo                                             |
| Periodos descuadrados | El par 8 conserva el periodo del nudo y el del seguimiento por separado, con nota de origen                                              | Dos fechas visibles y la nota «descuadrado en origen»                   |
| Fin de periodo        | El cierre no cambia el estado del nudo. Un nudo puede quedar Registrado o En ejecución al cerrar la semana                               | El estado se conserva; la edición se congela                            |

**Regla del cierre.** Cerrar la semana no cierra el nudo, no cierra el hito y no cierra el compromiso. Sólo impide la edición sin rastro.

---

## 4 · Estados y transiciones

El estado pertenece al nudo, no al caso, al hito ni al compromiso. Se reutiliza `core.cat_estados_hito`: 1 Registrado, 2 En ejecución, 3 Paralizado, 4 Cumplido, 5 Desestimado, 6 No cumplido.

Máquina de estados en texto:

```text
Registrado ──► En ejecución ──► Cumplido
    │              │   │
    │              │   └──────► No cumplido ──► En ejecución (reapertura)
    │              └──────────► Desestimado
    └──────────────► Paralizado ──► En ejecución
    └──────────────► Desestimado
```

| desde        | hacia        | quién                                             | condición                                                             | efecto                                                      |
| ------------ | ------------ | ------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Registrado   | En ejecución | Punto focal, sectorista o coordinador             | Existe un seguimiento con acción iniciada                             | Sale de «nuevo»; entra en «nudo abierto»; no toca el hito   |
| Registrado   | Paralizado   | Sectorista o coordinador                          | Se declara causa externa y fecha estimada de reanudación en texto     | Sigue abierto; se muestra «paralizado»; no cambia el riesgo |
| Registrado   | Desestimado  | Coordinador                                       | Duplicado literal, error de captura o nudo que no corresponde al caso | Baja lógica con motivo; el periodo conserva el registro     |
| En ejecución | Paralizado   | Sectorista o coordinador                          | La acción se detuvo por causa declarada                               | Sigue abierto; se muestra «paralizado»                      |
| Paralizado   | En ejecución | Sectorista o coordinador                          | Se reanuda la acción y se registra seguimiento                        | Vuelve a «en ejecución»                                     |
| En ejecución | Cumplido     | Sectorista; coordinador si el autor es sectorista | Seguimiento con `[AÑO] + [ACTOR] + [ACCIÓN]` y evidencia declarada    | Terminal; no cierra el compromiso ni el hito                |
| En ejecución | No cumplido  | Sectorista o coordinador                          | Seguimiento explica por qué no se cumplió y qué queda pendiente       | Terminal; habilita reapertura sólo por coordinador          |
| En ejecución | Desestimado  | Coordinador                                       | El nudo perdió objeto o no era un obstáculo                           | Terminal; baja lógica con motivo                            |
| Paralizado   | Desestimado  | Coordinador                                       | El nudo perdió objeto durante la paralización                         | Terminal; baja lógica con motivo                            |
| No cumplido  | En ejecución | Coordinador                                       | Reapertura con motivo y nuevo seguimiento                             | Deja rastro; vuelve a «nudo abierto»                        |
| Cumplido     | En ejecución | Administrador                                     | Corrección administrativa con auditoría                               | Excepcional; deja rastro; no es una reapertura funcional    |
| Desestimado  | Registrado   | Administrador                                     | Corrección administrativa con auditoría                               | Excepcional; deja rastro                                    |

**Estados terminales.** Cumplido, No cumplido y Desestimado. Sólo se abandonan por corrección administrativa con auditoría.

**Estados de trabajo.** Registrado, En ejecución y Paralizado. «Nudo abierto» agrupa estos tres y no es un estado del catálogo.

**Evidencia.** La transición a Cumplido exige un seguimiento que nombre año, actor y acción, y la referencia documental cuando exista. Si no hay documento, se declara «sin documento adjunto»; no se inventa un adjunto. La transición a No cumplido exige el motivo y la constancia de lo intentado.

**Ninguna transición es automática.** El paso del tiempo no cierra, no paraliza ni desestima un nudo. Tampoco lo hace la existencia de un hito no cumplido.

---

## 5 · Reglas de contenido

| Regla                        | Definición                                                                                                          | Consecuencia                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Una de las dos mitades       | Debe existir descripción o seguimiento; la base impone `CHECK (descripcion IS NOT NULL OR seguimiento IS NOT NULL)` | Si ambas faltan, la fila no se crea                   |
| Prohibido dejar ambas vacías | No se admite una fila sin contenido                                                                                 | Rechazo en captura e importación                      |
| Longitud recomendada         | Descripción: 800 caracteres. Seguimiento: 1 200 caracteres                                                          | Aviso al 90 %; no se trunca en importación            |
| Par descuadrado permitido    | Un nudo sin seguimiento y un seguimiento sin nudo son válidos                                                       | Se declara la mitad faltante; no se infiere           |
| Formato del seguimiento      | `[AÑO] + [ACTOR] + [ACCIÓN]`                                                                                        | Validación blanda: aviso, nunca bloqueo               |
| Periodo cerrado              | No se edita sin motivo, autor y fecha                                                                               | Se conserva el texto anterior y se registra el cambio |
| Periodo real                 | No se reasigna ni se traslada una celda a otra semana                                                               | El periodo de origen manda                            |
| Texto calculado              | No se promedian, resumen ni sintetizan semanas                                                                      | Cada fila es un texto de origen                       |
| Celda con sólo espacios      | Se considera vacía                                                                                                  | No se importa; se informa                             |

**Formato `[AÑO] + [ACTOR] + [ACCIÓN]`.** La fuente lo pide en el rótulo del seguimiento. En AVISA se valida como aviso, no como candado, porque el texto real del equipo no siempre lo cumple y bloquear perdería el dato.

| Componente | Cómo se reconoce                  | Aviso si falta             | ¿Bloquea? |
| ---------- | --------------------------------- | -------------------------- | --------- |
| AÑO        | Cuatro dígitos entre 2020 y 2100  | «Falta el año»             | No        |
| ACTOR      | Nombre, cargo o rol identificable | «Falta el actor»           | No        |
| ACCIÓN     | Verbo con objeto                  | «Falta la acción»          | No        |
| Orden      | Año al inicio                     | «El año no está al inicio» | No        |

**Par descuadrado.** Hay 66 celdas con seguimiento sin nudo y otras con nudo sin seguimiento. Se guardan como están: `descripcion` nula o `seguimiento` nulo. La interfaz declara «Sin nudo declarado» o «Sin seguimiento declarado». No se copia una mitad sobre la otra.

**Periodo cerrado.** La edición posterior exige tres datos: autor, fecha y motivo. Si el cambio altera el texto, se conserva la versión anterior en la bitácora. Sin bitácora no hay edición: se declara la carencia y se bloquea.

---

## 6 · Relación con otros objetos

| Relación                       | Cardinalidad                  | Vínculo real                                                  | Qué dispara                                            | Qué no debe dispararse                           |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Nudo ↔ caso                    | N:1 obligatorio               | `caso_id`                                                     | Aparece en el expediente del caso                      | No cambia el estado del caso                     |
| Nudo ↔ compromiso              | N:1 opcional                  | `compromiso_id`                                               | Aparece en el historial del compromiso                 | No cierra ni cambia el cumplimiento              |
| Nudo ↔ hito                    | N:1 lógico, sin llave foránea | Se declara el código de hito en el texto; no existe `hito_id` | Explica por qué un hito no se cumplió                  | No valida el hito, no lo marca No cumplido       |
| Nudo ↔ alerta temprana         | N:M lógico, sin llave foránea | Una alerta puede originar un nudo; no existe `alerta_id`      | Deja constancia del origen en el texto y en el informe | No crea alerta, no cambia el estado de la alerta |
| Nudo ↔ panel operativo         | N:1 de lectura                | Indicador de casos con nudo abierto                           | Alimenta el contador del periodo                       | No altera prioridad ni responsable               |
| Nudo ↔ riesgo y conflictividad | Ninguna                       | No hay vínculo                                                | Nada                                                   | No recalcula riesgo ni nivel de conflictividad   |

**Vínculos que hoy no existen.** `core.caso_nudo_critico` no tiene `hito_id` ni `alerta_id`. La relación con el hito y con la alerta se declara en texto y en el informe de importación. No se simula con campos inventados ni con una tabla puente improvisada.

**Qué no se dispara automáticamente.**

- No se cierra un compromiso por tener nudo.
- No se cierra un hito por tener nudo.
- No se marca un hito como No cumplido por tener nudo.
- No se crea una alerta temprana desde un nudo.
- No se abre el flujo de aprobación de Alta Dirección.
- No se recalcula el nivel de riesgo ni el nivel de conflictividad.
- No se crea una demanda ni una reunión.
- No se notifica a actores externos.

---

## 7 · Dónde se ve en el producto

| Ubicación                 | Qué se muestra                                                                                                                                  | Qué se muestra cuando no hay dato                                                          | Qué no se muestra                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Expediente del caso       | Bloque «Nudos de la semana» con las semanas registradas en orden cronológico; por semana: nudo, seguimiento, estado y autor                     | «Sin nudo declarado», «Sin seguimiento declarado» o «Sin registro en la semana»            | Promedios, síntesis, semanas inventadas             |
| Bandeja y panel operativo | Indicador «Casos con nudo abierto esta semana»: casos con al menos un nudo en estado 1, 2 o 3 en el periodo vigente, sobre los casos del ámbito | «Periodo sin registro» si no hay carga; «Cobertura parcial: 5 de 8 semanas» si falta carga | Un 0 presentado como si la cobertura fuera completa |
| Detalle del compromiso    | Historial descendente por `semana_desde`: nudo, seguimiento, estado, autor y origen del dato                                                    | «Sin nudos registrados para este compromiso»                                               | Nudos de otros compromisos del mismo caso           |

**Expediente del caso.** El bloque abre con un encabezado de cobertura: «8 semanas · 5 con nudo · 6 con seguimiento». Son cuentas de filas, no estimaciones. Cada semana muestra sus dos mitades por separado; si una falta, se declara. El bloque no ordena los nudos por gravedad ni los fusiona.

**Bandeja y panel operativo.** El indicador se llama «Casos con nudo abierto esta semana». Su denominador son los casos del ámbito del usuario; su numerador, los casos con al menos un nudo abierto en el periodo vigente. Se muestra como «X de Y casos». Si el periodo no tiene ninguna celda cargada, dice «Periodo sin registro» y no «0». Un caso con nudo cerrado no cuenta como abierto.

**Detalle del compromiso.** El historial muestra todas las semanas del compromiso, incluidas las que sólo tienen seguimiento. Cada fila declara su origen: importación, captura manual o agente. Un nudo sin compromiso no aparece aquí; aparece sólo en el expediente del caso.

**Regla común.** El dato ausente se declara con la frase exacta que corresponde. No se sustituye por un guion, un cero ni un espacio en blanco.

---

## 8 · Importación desde la matriz

**Volumen real de la fuente.**

| Concepto                    | Cifra | Lectura                                                |
| --------------------------- | ----- | ------------------------------------------------------ |
| Pares de columnas semanales | 8     | Nudo y seguimiento por semana                          |
| Celdas con nudo             | 118   | Incluye nudos repetidos y colisiones                   |
| Celdas con seguimiento      | 136   | 137 si se cuenta una celda con sólo un espacio         |
| Celdas no vacías            | 184   | Total real de filas a importar                         |
| Celdas con ambas mitades    | 70    | Derivado: 118 + 136 − 184                              |
| Nudos sin seguimiento       | 48    | Derivado: 118 − 70                                     |
| Seguimientos sin nudo       | 66    | Derivado: 136 − 70                                     |
| Colisiones reales           | 20    | Varios nudos distintos en la misma semana y compromiso |
| Repeticiones literales      | 21    | Mismo texto en la misma semana y compromiso            |

**Reglas de fidelidad.**

| Regla                  | Cómo se aplica                                                                                                                                | Resultado                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Una fila por celda     | Cada celda no vacía produce una fila; no se agrupa por caso ni por semana                                                                     | 184 filas, no 254                                                 |
| Identidad de origen    | `origen_ref` con el formato `MATRIZ-N0002-C22`, único parcial                                                                                 | Reejecutar no duplica                                             |
| Idempotencia           | Mismo `origen_ref` y mismo contenido: no hace nada. Mismo `origen_ref` y contenido distinto: conflicto declarado, no sobrescritura silenciosa | El informe distingue «sin cambio» de «conflicto»                  |
| Dedupe literal         | Índice único por `(caso_id, compromiso_id, semana_desde, descripcion, seguimiento)`                                                           | Las 21 repeticiones literales producen una sola fila              |
| Colisiones             | Varios nudos distintos en la misma semana y compromiso se conservan todos                                                                     | No se concatenan ni se elige uno                                  |
| Semana 8               | Se conservan los dos periodos descuadrados, con nota de origen                                                                                | Nudo del 29 abr al 04 may 2026; seguimiento del 04 al 11 may 2026 |
| Seguimiento sin nudo   | Se guarda con `descripcion` nula                                                                                                              | La interfaz declara «Sin nudo declarado»                          |
| Nudo sin seguimiento   | Se guarda con `seguimiento` nulo                                                                                                              | La interfaz declara «Sin seguimiento declarado»                   |
| Celda con sólo espacio | Se trata como vacía                                                                                                                           | No se importa; se informa                                         |
| Caso no resuelto       | Si no se puede resolver el caso de la fila, la celda no se importa                                                                            | Se declara en el informe con su `origen_ref`                      |
| Reejecución            | Se compara por `origen_ref`; nunca se borra lo importado                                                                                      | El informe es acumulativo por lote                                |

**Qué se rechaza y por qué.**

| Motivo                                 | Ejemplo                                                         | Tratamiento                                                         |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Ambas mitades vacías                   | Celda con sólo un espacio                                       | Rechazo; se informa la celda                                        |
| Periodo inválido                       | `semana_hasta` anterior a `semana_desde`                        | Rechazo; se informa la celda                                        |
| Fila sin caso identificable            | Bloque sin nombre de caso resoluble                             | Rechazo; se informa el `origen_ref`                                 |
| `origen_ref` repetido en el mismo lote | Dos celdas con la misma referencia                              | Rechazo de la segunda; se informa                                   |
| Texto con error de referencia          | `#REF!` en la celda de nudo                                     | Rechazo; se conserva el literal en el informe                       |
| Duplicado literal                      | Misma descripción y seguimiento en la misma semana y compromiso | No se crea fila nueva; se informa la celda y se conserva la primera |

**Informe de importación.** Debe declarar, por celda: importada, sin cambio, duplicada literal, rechazada o con aviso. Los avisos incluyen formato incompleto, longitud excedida y periodo descuadrado. El informe no resume: enumera.

---

## 9 · Qué no se hace

1. No se inventa un nudo para llenar una semana sin registro.
2. No se convierte un seguimiento en nudo ni un nudo en seguimiento.
3. No se promedian, resumen ni sintetizan semanas.
4. No se traslada un nudo a otra semana para «cuadrar» la matriz.
5. No se copia la mitad faltante de un par descuadrado.
6. No se cierra un hito, un compromiso ni un caso por tener nudo.
7. No se marca un hito como No cumplido por tener nudo.
8. No se crea una alerta temprana desde un nudo.
9. No se cambia el nivel de riesgo ni el nivel de conflictividad desde un nudo.
10. No se usa «activo» para el nivel de conflictividad.
11. No se edita un periodo cerrado sin autor, fecha y motivo.
12. No se borra físicamente un nudo importado: se anula con motivo.
13. No se usa el nudo como resumen ejecutivo del caso.
14. No se muestra 0 cuando no hay carga: se declara «sin registro».
15. No se muestra un nudo fuera del ámbito de subsector del usuario.

---

## 10 · Pendientes de decisión de OAIPCS

Esta lista es cerrada. Cada decisión se ratifica en acta y se refleja en la migración que corresponda.

1. **Periodo de la semana.** (a) Semana fija de lunes a domingo; (b) periodo real declarado por el equipo; (c) híbrido: periodo real en importación y lunes a domingo en captura manual. Propuesta: (c).
2. **Nudos de compromisos ajenos.** ¿El punto focal puede escribir nudos de compromisos que no le corresponden? (a) No; (b) Sí, con autoría declarada; (c) Sólo lectura y comentario. Propuesta: (a), con el sectorista como única excepción.
3. **Varios nudos por compromiso y semana.** (a) Sólo uno; (b) Varios sin restricción; (c) Varios con aviso cuando el texto se parezca. Propuesta: (c), porque la fuente ya registra 20 colisiones reales.
4. **Anulación de una semana.** (a) Borrado lógico de la semana; (b) Anulación con motivo, autor y fecha, conservando las filas; (c) Bloqueo definitivo. Propuesta: (b).
5. **Validación del nudo.** (a) Columna `validado_por_usuario_id` y `validado_en`; (b) Validación como transición de estado; (c) Sin validación formal. Propuesta: (a), porque el estado del nudo y la validación del texto son cosas distintas.
6. **Evidencia para Cumplido.** (a) Basta el seguimiento con formato; (b) Seguimiento más documento cuando exista; (c) Documento obligatorio. Propuesta: (b), declarando «sin documento adjunto» cuando falte.
7. **Cierre y registro tardío.** (a) Sin plazo; (b) Cierre a los 7 días y tardío después; (c) Cierre a los 30 días. Propuesta: (b), con marca «registro tardío» y autorización del coordinador.
8. **Visibilidad para consulta.** (a) Texto completo dentro del ámbito; (b) Texto resumido; (c) Sin acceso. Propuesta: (a).
9. **Uso del origen agente.** (a) El agente no escribe; (b) Propone borrador que el punto focal confirma; (c) Escribe con validación posterior. Propuesta: (b).
10. **Vínculo con el hito.** ¿El nudo debe apuntar a un hito concreto? (a) Sólo al compromiso; (b) Hito obligatorio; (c) Hito opcional mediante `hito_id` nulable. Propuesta: (c), porque hoy la relación es indirecta y se declara en el texto.
