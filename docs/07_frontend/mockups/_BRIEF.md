# Brief común · mockups AVISA

Documento de trabajo para quien dibuje artboards en `docs/07_frontend/mockups/`.
No es documentación de producto: es el contrato de forma.

## Qué se está haciendo

Se presentan mockups a la directora de OAIPCS y al equipo que implementa en .NET.
Los artboards son **HTML estático autónomo**: se abren con doble clic, sin servidor,
sin build, sin CDN. Nada de fuentes, scripts, iconos o imágenes remotas.

La app real es la SPA Angular (`angular/src/app`). Los mockups no entran al build.

## Las 26 rutas del mapa del sitio

```
/mapa ·········· Panorama territorial (entrada)
/resumen ······· Resumen operativo
/bandeja ······· Bandeja de trabajo
/casos ········· Casos
  /casos/sin-caso ·· Demandas sin caso
  /casos/:codigo ··· Ficha del caso
/alertas ······· Alertas tempranas
/clima-social ··· Clima social
/reuniones ····· Reuniones
/resultados ····· Resultados
/compromisos ··· Compromisos
/documentos ···· Documentos
/reportes ······ Registro de reportes
/archivo ······ Archivo
/directorio ···· Portada del directorio
  /directorio/actores
  /directorio/personas · Actores (filtro personas)
  /directorio/organizaciones
  /directorio/instituciones
  /directorio/locales ·· Auditorios
/direccion ····· Resumen de Dirección
/acceso ········ Inicio de sesión
/busqueda ······ Búsqueda global
/notificaciones · Centro de notificaciones
/ayuda ········· Ayuda y criterios
/preferencias ·· Preferencias
```

Menú del shell: **PANORAMA TERRITORIAL** (Panorama territorial) · **PREVENCIÓN** (Casos,
Alertas tempranas, Clima social) · **INTERVENCIÓN** (Reuniones, Resultados) ·
**SEGUIMIENTO** (Compromisos) · **GESTIÓN DE IYC** (Reporte de actividad, Documentos) ·
**DIRECTORIOS** (Actores, Organizaciones, Locales) · **MI ESPACIO** (Resumen operativo,
Bandeja de trabajo, Archivo). Botón «Registrar ▾».

Si un artboard no corresponde a ninguna ruta, se dice explícitamente en su cabecera:
**«sin ruta · no está en el menú»**, y se propone a qué pantalla pertenecería.

## Vocabulario obligatorio

| Se escribe                                                  | No se escribe                        |
| ----------------------------------------------------------- | ------------------------------------ |
| **latente**                                                 | abierto (para el nivel de conflicto) |
| **manifiesto**                                              | activo (para el nivel de conflicto)  |
| caso **abierto**                                            | — (sí es válido para el estado)      |
| **Pesca y acuicultura** / **MYPE e industria**              | Pesca / MYPE                         |
| **Aplicativo de apoyo a la gestión de conflictos sociales** | PRODUCCION - OAIPCS                  |
| **Auditorios**                                              | locales                              |
| **Nivel de conflictividad**                                 | nivel / conflictividad (a secas)     |

Regla X3, ratificada: **latente** = `Diferencia` + `Controversia`;
**manifiesto** = `Conflicto social` + `Crisis social`. No es un estado nuevo: es una
agrupación del nivel de conflictividad. Si el caso no declara nivel, la etiqueta no se
muestra. **Nunca** se usa «activo» como sinónimo de manifiesto.

Regla X6: **Dirección** y **Secretaría General** ven ambos subsectores; cada
**Viceministerio** ve sólo el suyo. Es ámbito de sesión, no un filtro de pantalla.

Fechas: `18 nov 2026` (mes en tres letras, minúscula, sin punto).
Miles: espacio fino (`13 456`). Porcentajes con coma decimal (`62,4 %`).

## El dato ausente se declara, no se estima

Ésta es la regla que no se rompe. En los valores de ejemplo se usa `≈` y se marca la
celda como ilustrativa. Si un campo no existe en la base, la celda dice **«no existe»**
o **«sin dato»**, nunca un número inventado.

Prohibido: rellenar una columna con datos plausibles para que el diseño «se vea
completo». Un hueco visible y rotulado vale más que una cifra falsa.

## Cabecera obligatoria de cada artboard

Arriba del todo, antes de la maqueta, un bloque `<details>` abierto o una tarjeta con
cinco apartados:

1. **Cubre** — números de item del catálogo y qué pantalla es.
2. **Dato por bloque** — qué campo de la base alimenta cada celda; si no existe, se dice.
3. **Sólo forma** — qué es decisión de diseño y no de dato.
4. **Bloqueado** — qué no se puede construir todavía y por qué.
5. **Roles** — quién ve cada bloque (Dirección, Secretaría General, Viceministerio,
   Sectorista, Especialista OAIPCS, Administrador).

Además: **ruta** (o «sin ruta») y el nombre del archivo.

## Tokens visuales

Copiar el `:root` de `panorama-territorial.html`. No inventar colores.

```css
--ink: #17283a;
--ink-2: #33475b;
--muted: #778797;
--line: #e6ebef;
--paper: #fff;
--canvas: #f5f7f8;
--blue: #2455a2;
--blue-dark: #1d427f;
--blue-pale: #eaf1fb;
--teal: #397c79;
--amber: #aa6a11;
--amber-pale: #fff4e2;
--red: #ad4d46;
--red-pale: #fbeceb;
--green: #34785b;
--green-pale: #e9f5ef;
--font-sans: "DM Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
--font-display:
  "Manrope", "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
```

Semántica de color: azul = estructura y enlace; verde = cumplido/atendida;
ámbar = por vencer/atención; rojo = vencido/crítico; gris = sin dato.
El verde nunca se usa para estados que no sean «cumplido» o «atendida».

Componentes: superficies blancas sobre `--canvas`, borde `1px solid var(--line)`,
radio 10–12 px, sombra muy suave. Tablas con `scope="col"`, cabecera `--ink-2` en
mayúsculas 11 px con `letter-spacing`, sin zebra. Densidad: 44 px de alto de fila.

Gráficos: **SVG en línea**. Nada de librerías. Mapas: SVG con contornos
esquemáticos declarados como «referencial» si no hay geometría real cargada.

## Accesibilidad mínima

- Contraste AA (4.5:1 en texto normal).
- Todo control con `<label>` o `aria-label`.
- Estado nunca sólo por color: siempre color + texto o icono.
- Foco visible (`:focus-visible` con `outline: 2px solid var(--blue)`).
- Navegable con teclado; el orden de tabulación sigue el orden visual.

## Prohibiciones

- No tocar `mockups/index.html` (lo actualiza la coordinación).
- No tocar `docs/07_frontend/frontend.md` (idem).
- No tocar otros mockups que el asignado.
- No usar imágenes externas ni data-URI de fotos.
- No escribir en Neon ni ejecutar migraciones.
- No hacer commit, push, reset ni pull.
