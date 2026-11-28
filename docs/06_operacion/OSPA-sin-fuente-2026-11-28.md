# OSPA: no hay fuente para `expediente_ospa` ni `estado_ospa`

> Decisión registrada el **28/11/2026**. Campos `core.organizaciones.expediente_ospa`
> y `core.organizaciones.estado_ospa`: **0 de 224 filas con valor**. Se dejan
> vacíos por falta de fuente; no se estiman ni se derivan.

## Qué se buscó

| Fuente                                                               | Resultado                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.dim_organizacion` (c01–c16)                                  | No tiene expediente ni estado OSPA. Su `c07` es «inscripción en SUNARP» (22 filas) y su `c14` es el RUC (5 filas).                                                                                                                      |
| Todas las tablas de `legacy`                                         | El término «OSPA/OSPAS» sólo aparece en texto narrativo (alertas, demandas, hechos, redacción) y en 4 nombres de organización (`ORG-179`, `ORG-199`, `ORG-200`, `ORG-201`). Ninguna tabla guarda expediente ni estado de registro OSPA. |
| `docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx` | La hoja operativa no tiene columna OSPA. La hoja `DVPA` tiene «N° registro en SUNARP», con **0 valores** cargados; tampoco hay columna de expediente OSPA. `DVMYPE-I` es una plantilla vacía.                                           |
| Otras hojas y libros de `docs/05_datos/` y `scripts/`                | Sin columnas de expediente ni estado OSPA.                                                                                                                                                                                              |

Conclusión: **`inscripcion_sunarp` no es OSPA**. El número de SUNARP identifica
la partida registral de la organización, no su expediente ante el registro de
organizaciones sociales de pescadores artesanales.

## Qué habría que pedir para poblarlos

1. La **base del registro de OSPA** de la DGPA (o la dependencia que lo
   administre): expediente, estado (inscrito / vigente / suspendido / cancelado),
   fecha de inscripción y resolución que la sustenta.
2. La relación entre ese registro y las 224 organizaciones del directorio,
   preferiblemente por RUC; donde no haya RUC, por nombre y ámbito.
3. Si el registro no existe en formato digital, la fuente mínima aceptable es la
   **resolución de inscripción** de cada organización, de la que se derivan el
   número de expediente y el estado.

Mientras eso no llegue, la marca OSPA que describe `docs/07_frontend/DISENO_LOTE_C.md`
§121 no puede pintarse con datos reales y debe quedar como mockup.
