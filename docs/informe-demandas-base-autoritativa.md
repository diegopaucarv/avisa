# Demandas: base autoritativa (132 vs 325)

**Fecha:** 2026-11-27 · **Fuente:** consultas de sólo lectura contra Neon (`NEON_OWNER_URL`).
**Alcance:** decidir cuál es la fuente de verdad de las demandas y qué falta por portar.

---

## 1. La cifra

| Concepto | Valor |
| --- | --- |
| `core.demandas` (tabla operativa) | **132** |
| `legacy.dim_demandas` (matriz Excel portada) | **325** |
| Diferencia | **193** |

La diferencia no es aritmética simple: no son «193 que faltan» contando de más a menos. El cruce por clave lo aclara.

## 2. El cruce por `codigo_legado`

`core.demandas.codigo_legado` guarda el `DEM-2026-XXXX` de la matriz (`legacy.dim_demandas.c01`).

| Concepto | Valor |
| --- | --- |
| Filas de `legacy` presentes en `core` (mismo `DEM-…`) | **112** |
| Filas de `legacy` **sin** equivalente en `core` | **213** |
| Filas de `core` con `codigo_legado` | 112 |
| Filas de `core` **manuales** (sin `codigo_legado`) | **20** |

Comprobación: `112 + 213 = 325` (todo `legacy`), y `112 + 20 = 132` (todo `core`). Cuadra.

Es decir: **la tabla operativa sólo tiene el 34 % de las demandas de la matriz**, más 20 demandas creadas a mano dentro de AVISA.

## 3. La distribución del hueco es irregular

Por rango de código (`DEM-2026-NNN`):

| Rango | En `legacy` | En `core` |
| --- | --- | --- |
| 001–050 | 50 | 11 |
| 051–100 | 50 | 25 |
| 101–150 | 50 | 24 |
| 151–200 | 50 | 15 |
| 201–250 | 50 | 31 |
| 251–325 | 75 | 6 |

No hay un patrón de «se cortó al llegar a X»: el port tomó un subconjunto disperso. Los primeros códigos (`DEM-2026-0001` a `DEM-2026-0010`) **no están** en `core`, aunque sí `0011`, `0012`, `0013`, `0014`, `0024`…

## 4. Duplicados no explican el hueco

| Concepto | Valor |
| --- | --- |
| Textos distintos en `legacy` | 305 (sobre 325 filas → 20 textos repetidos) |
| Textos distintos en `core` | 127 (sobre 132 filas → 5 repetidos) |
| Textos de `legacy` **sin** equivalente textual en `core` | **195** |

Los 20 duplicados de texto de la matriz no son la causa: aun deduplicando `legacy` por texto (305), faltarían 195 textos por completo. **No es un problema de deduplicación; es un port incompleto.**

## 5. Calidad del dato en ambos lados

| Señal | `core.demandas` | `legacy.dim_demandas` |
| --- | --- | --- |
| Sin caso (`caso_id` nulo) | **107 de 132** | — (la matriz no tiene caso; tiene alerta `c05`) |
| Con alerta (`alerta_id`) | 86 | `c05` = `AT-2026-XX` en la mayoría; **77 filas sin alerta** |
| Sin temática | — | **48 de 325** |
| Origen | `AVISA_HISTORICO` 112 · `MANUAL` 20 | Matriz (Excel) |
| Vínculo a caso | Sólo 25 de 132 | Ninguno |

Conclusión de calidad: en `core` la mayoría de las demandas **no cuelgan de un caso** (107), y 86 cuelgan de una alerta. En `legacy` la mitad larga no cuelga de una alerta (77) y 48 no tienen temática. Ninguna de las dos bases está «limpia»; la diferencia es de **cobertura**, no de integridad.

## 6. Caso concreto: `CS-2026-0003` (Aceros Americanos)

`core.demandas` con `caso_id` de `CS-2026-0003`: **0**.
Las 16 demandas que `migration/37` parecía haber vinculado a ese caso no existen en `core` con ese `caso_id`. Coincide con el diagnóstico previo (`docs/diagnostico-datos-2026-11-27.md`): las demandas de la matriz no se portaron, y las que hay no apuntan al caso.

## 7. Decisión recomendada

**`legacy.dim_demandas` es la base autoritativa de las demandas de la matriz; `core.demandas` es el destino operativo, hoy incompleto.**

- Mientras `core` no tenga las 325, cualquier cifra que se muestre («demandas del caso», exportaciones, indicadores) es **parcial**. Hay que rotularlo o completar el port.
- Las 20 demandas de `core` sin `codigo_legado` son creación propia de AVISA: no se borran; se conservan y se distinguen por `origen_dato = 'MANUAL'`.
- La fuente para reimportar/completar es `legacy.dim_demandas` (o la matriz Excel), **no** `core`.

## 8. Qué hacer (sin ejecutar nada aquí)

1. **Port completo e idempotente** de las 213 faltantes: `insert … select … where not exists (codigo_legado)`, con `origen_dato = 'AVISA_HISTORICO'`, `tematica_id` resuelta desde `c06` (`TEMA-0X`) y alerta desde `c05` cuando exista.
2. **Resolver las 48 sin temática**: la API de alta exige temática; o se imputa una por defecto auditada, o se dejan en cuarentena con marca.
3. **Reparar el vínculo caso↔demanda**: la matriz no trae caso; el vínculo se hace por la alerta (`DEM → AT → caso`). Portar primero las alertas y luego derivar `caso_id`.
4. **Deduplicar por texto** sólo dentro del mismo caso/alerta (los 20 repetidos suelen ser la misma demanda citada por dos actores); nunca deduplicar entre casos distintos.
5. **Semáforo en la UI**: si una vista muestra demandas de un caso y el caso tiene demandas en `legacy` pero no en `core`, avisar «demandas pendientes de portar».

## 9. Cifras a recordar

- **325** demandas en `legacy` (autoritativo).
- **132** en `core` (operativo).
- **112** portadas por código, **213** pendientes.
- **195** textos de la matriz sin equivalente en `core`.
- **20** demandas manuales de AVISA.
- **107** demandas de `core` sin caso.
