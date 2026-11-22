# Decisiones D3 · D4 · D7 · D9 · D10

> **Estado:** tomadas y aplicadas el **2026-11-22**.
> **Base normativa:** `docs/01_requisitos/guia.md`.
> **Registro de gaps:** `docs/01_requisitos/GAPS_GUIA_SQL_UI.md` §2.1 y §2.2.
>
> Este documento fija **qué se decidió**, **por qué** y **qué evidencia dejó en la base o en el
> código**. No es una propuesta: las cinco decisiones están aplicadas salvo donde se indica.

---

## Resumen

| #   | Decisión                                                                             | Estado                 | Dónde                                       |
| --- | ------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------- |
| D3  | Tipificar **sólo** los Anexos 1 y 2 como tipo documental                             | aplicada               | `migration/20_tipos_documento_anexos.sql`   |
| D4  | **No** unificar nivel de alerta con prioridad de alerta                              | resuelta sin migración | este documento                              |
| D7  | Retirar `cat_tipos_reunion`; imposible por FK → queda marcado obsoleto               | aplicada parcialmente  | `migration/21_retiro_cat_tipos_reunion.sql` |
| D9  | Alinear `cat_ciclos_intervencion` a las 5 etiquetas de la Guía, renombrando en sitio | aplicada               | `migration/22_ciclos_intervencion_guia.sql` |
| D10 | No tocar el `CHECK` de `origen_dato`; dar etiqueta explícita a `KAG` y `WORKFLOW`    | aplicada               | `angular/src/app/dominio/mapeo.ts`          |

---

## D3 · Anexos como tipo documental

**Decisión.** Se añaden a `core.cat_tipos_documento` **únicamente**:

| Anexo | Código                                     | Nombre                                        |
| ----- | ------------------------------------------ | --------------------------------------------- |
| 1     | `matriz_sistematizacion_demandas`          | Matriz de Sistematización de Demandas         |
| 2     | `reporte_regional_conflictividad_demandas` | Reporte Regional de Conflictividad y Demandas |

**No se añaden los Anexos 14 a 17.**

**Por qué.** Un tipo documental es una **plantilla de documento** que se archiva y se adjunta. Los
Anexos 14, 15 y 16 son **registros estructurados que ya tienen tabla propia**:

| Anexo | Ya modelado en                                                                         |
| ----- | -------------------------------------------------------------------------------------- |
| 14    | `core.compromisos` + `core.hitos_compromiso`                                           |
| 15    | `core.casos` (código `CS-<PA\|MI>-<TEMA>-<AAAA>-<NN>`)                                 |
| 16    | `core.reuniones_dialogo` + `core.reunion_participantes`                                |
| 17    | `analytics.vw_anexo_17_registro_reportes` (vista existente; **E4** se cerró sin tabla) |

Tipificar los 14–17 como documento habría creado una segunda vía de captura para datos que ya se
capturan en su tabla, con el riesgo de divergencia que eso implica.

**Evidencia.** `cat_tipos_documento` quedó en **17 filas**; las nuevas tienen `anexo_numero` 1 y 2 y
se insertaron con `max(id)+n`, no con id fijo, para no colisionar si el catálogo crece.

---

## D4 · Nivel de alerta y prioridad de alerta

**Decisión.** Se **conservan los dos catálogos**. No hay migración.

**Por qué.** Son ejes distintos y unificarlos destruye información:

| Eje                        | Catálogo                      | Valores                                                                                          | Para qué sirve       |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| **Nivel** de la alerta     | `core.cat_niveles_alerta`     | `Inmediato` · `Táctico` · `Preventivo` · `Monitoreo`                                             | Semáforo de atención |
| **Prioridad** de la alerta | `core.cat_prioridades_alerta` | `Crítica inmediata` · `Urgente` · `Temprana` · `Seguimiento`, con `sla_horas` 24/48/72/sin plazo | Plazo de respuesta   |

Un solo eje obligaría a elegir entre perder el nivel del semáforo o perder el SLA. El Anexo 3
(Formato de Alerta Temprana) usa el nivel para describir la situación, y el flujo de cinco pasos usa
la prioridad para medir plazos.

**No confundir** con `core.cat_prioridades_atencion` (Urgente · Moderado · Bajo), que es la prioridad
**del caso**, columna 10 del Anexo 15, y es un tercer eje independiente.

---

## D7 · `core.cat_tipos_reunion`

**Decisión.** Retirar el catálogo **si no tiene dependientes**. Como los tiene, **se conserva marcado
como obsoleto**.

**Hallazgo.** `core.reuniones_dialogo.tipo_id` referencia `core.cat_tipos_reunion` por FK
(`reuniones_dialogo_tipo_id_fkey`) y `analytics.vw_anexo_16_registro_reuniones` depende de
`core.reuniones_dialogo`. `pg_depend` confirma **1 dependencia normal** y **0 vistas** que lean el
catálogo directamente. Hay **0 reuniones** cargadas, así que no hay datos que migrar.

**Por qué no se fuerza el borrado.** Borrar el catálogo exigía alterar `core.reuniones_dialogo`, una
tabla de dominio con su propio contrato. El beneficio (eliminar un catálogo vacío) no compensa el
riesgo de tocar una tabla que sí persiste datos. La migración implementa **ambas ramas**: retira si no
hay FKs ni dependencias, y si las hay conserva y comenta.

**Evidencia.** Comentario aplicado:

> `OBSOLETO (D7): catálogo de tipos de reunión sin uso. Se conserva porque core.reuniones_dialogo.tipo_id lo referencia por FK y analytics.vw_anexo_16_registro_reuniones depende de esa tabla. El eje «programado / no programado» del Anexo 16 vive en core.reuniones_dialogo.programada. No agregar valores nuevos.`

**Pendiente.** Cuando se elimine la FK (o se decida que `reuniones_dialogo` no usa el catálogo), la
rama de retirada de la migración 21 se puede reejecutar.

---

## D9 · Ciclo de intervención

**Decisión.** Alinear `core.cat_ciclos_intervencion` a las **cinco etiquetas** de la Guía §8.1–8.4:

1. Prevención estratégica _(nueva)_
2. Prevención operativa
3. Intervención y tratamiento
4. Monitoreo de compromisos
5. Gestión de la información y del conocimiento

**Cómo se hizo.** **Renombrando las filas del catálogo en sitio**, no moviendo casos. El motivo es
concreto: `core.casos` no tiene `ciclo_id` sino `ciclo_intervencion_id`, y tiene **RLS forzada**; con
`core.clasificacion_max() = 0` y sin `app.rol_codigo`, un `UPDATE` masivo sobre `core.casos` habría
afectado **0 filas en silencio**. Al preservar los `id`, los casos quedan clasificados sin escribir en
la tabla protegida.

**Remapeo resultante** (verificado por SELECT):

| Valor legado                 | Etiqueta vigente                             | Casos |
| ---------------------------- | -------------------------------------------- | ----: |
| `Prevención`                 | Prevención operativa                         |     1 |
| `Intervención y tratamiento` | Intervención y tratamiento                   |     1 |
| `Seguimiento`                | Monitoreo de compromisos                     |    32 |
| `Gestión del Conocimiento`   | Gestión de la información y del conocimiento |     0 |
| —                            | Prevención estratégica                       |     0 |

**Resultado.** 34 casos con ciclo · **1 caso sin ciclo** · 0 etiquetas legadas restantes.

**Consecuencia en la UI.** La equivalencia explícita de `angular/src/app/dominio/mapeo.ts` pasa a
**identidad**: la base ya emite exactamente las etiquetas de la Guía. «Prevención estratégica» **ya se
puede emitir** (hoy con 0 casos).

**Dos observaciones que no son gaps de catálogo.**

- El caso sin ciclo es un **dato incompleto**, no una desalineación. Se completa desde la ficha cuando
  la UI permita escribir.
- El catálogo se ordena por `id` (`lib/db/repos/catalogs.ts`), así que «Prevención estratégica» (id 5)
  aparece última. No es un error de modelo —la Guía §8 aclara que los componentes «no deben entenderse
  como etapas sucesivas o rígidas»— pero si se quiere el orden de la Guía hace falta una columna
  `orden`.

---

## D10 · `origen_dato`

**Decisión.** **No se toca el `CHECK`.** Se corrige el mapeo de la UI.

**Por qué.** `MANUAL`, `KAG`, `WORKFLOW`, `AVISA_HISTORICO` y `WHATSAPP` son **códigos técnicos de
procedencia**, no etiquetas de presentación. Reducir el `CHECK` a lo que hoy se produce borraría la
capacidad de distinguir procedencias futuras, y el histórico sólo tiene `AVISA_HISTORICO` (35 filas),
de modo que el cambio no aportaba nada verificable.

**Qué estaba mal.** El mapeo de `dominio/mapeo.ts` sólo reconocía subcadenas (`historico`, `legado`,
`ingesta`, `importa`, `whatsapp`). Un `KAG` o un `WORKFLOW` caía en `Manual` por el **valor de
respaldo**: no era una equivalencia declarada, era un descarte silencioso.

**Corrección.**

| Código            | Etiqueta |
| ----------------- | -------- |
| `MANUAL`          | Manual   |
| `KAG`             | KAG      |
| `WORKFLOW`        | Workflow |
| `AVISA_HISTORICO` | Legado   |
| `WHATSAPP`        | WhatsApp |

`Caso.origen` se amplió en `dominio/modelos.ts` para admitir los seis valores; sin ese cambio el
typecheck fallaba. Se prefirió ampliar el tipo antes que un `as unknown as` que habría pasado la
compilación mintiendo sobre el dominio.

---

## Lo que queda fuera de estas decisiones

- **Ubigeo / centroide y calibración del riesgo**: aplazados por el usuario. Por eso `/mapa` sigue en
  marcador y no se documenta ninguna fórmula de riesgo.
- **E4 · Anexo 17 (Registro de reportes)**: se cerró **sin tabla nueva**, sirviéndolo desde la vista
  `analytics.vw_anexo_17_registro_reportes` con `security_invoker` (migración 23), más repo, API
  (`GET /api/v1/reportes`), pantalla `/reportes` y exportación `entidad=reportes`. Ningún mecanismo de
  la Guía queda sin soporte.
- **Anulación en la UI**: el backend la sostiene (E2 cerrado) y la interfaz ya existe —panel
  `shared/ui/anular-panel.component` con motivo obligatorio, montado en la ficha de caso, alertas,
  compromisos y documentos—. Restaurar sólo se ofrece donde la API proyecta el estado de anulación
  (hoy, casos); falta el panel en demandas y Reportes.
- **Vocabulario de `estado_atencion`**: el `CHECK` de `core.demandas` admitía `En_proceso`; la
  migración 24 lo dejó en `Pendiente` · `En proceso` · `Atendida` · `Desestimada` sin mover filas
  (ver `GAPS_GUIA_SQL_UI.md` §2.1, G-09, y el glosario §1.8).
