# AVISA / SIPRECS · Consola de prevención y gestión de conflictos sociales

**OAIPCS · PRODUCE** · repositorio de entrega del sistema AVISA.

Este archivo es la puerta de entrada del **repositorio**; el índice del árbol
documental es [`docs/README.md`](docs/README.md). Si un documento y el código
discrepan, manda el código.

> **El avance ya alcanza para empezar.** El repositorio y sus documentos son el
> contrato: lo que no esté ahí se declara como faltante, no se supone.

## Estado del avance (corte 2026-11-24)

| Pieza                 | Estado                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Modelo de datos v10   | 266 tablas lógicas, 3 334 columnas físicas, 2 161 columnas comentadas, 561 políticas RLS                                                        |
| Carga del legado      | 35 casos, 83 alertas, 33 usuarios y 87 tablas de `legacy` cargadas y verificadas                                                                |
| API actual            | 30 rutas Next.js en `app/api/**` (`/api/auth/**` y `/api/v1/**`)                                                                                |
| Consola Angular       | 33 rutas con componente, 18 enlaces visibles en 8 grupos; paridad de lectura con los mockups                                                    |
| Destino de la entrega | SQL Server + API .NET + Angular en un servidor de PRODUCE; la migración la ejecuta el equipo entrante                                           |
| Artefactos SQL Server | `docs/sql_server/` (esquema sin FK, claves ajenas, informe) y `migration/mssql/` (alcance, rol, tipos, mapa SSMA, chequeos)                     |
| Limpieza del árbol    | 70 archivos retirados el 2026-11-24: `docs/_archivo/`, dos instantáneas de `migration/backup_*`, un volcado del 19-11 y 25 sondas de `scripts/` |

Lo que **falta**, pantalla por pantalla, está en
[`docs/07_frontend/frontend.md`](docs/07_frontend/frontend.md); el detalle
histórico, en
[`docs/07_frontend/frontend_detalle.md`](docs/07_frontend/frontend_detalle.md).

---

## 1 · Repositorio y acceso

- Remoto: <https://github.com/diegopaucarv/avisa.git>
- Rama de trabajo: **`main`**

Quien no tenga acceso debe pedirlo **antes de empezar**. No se trabaja sobre
copias enviadas por correo ni sobre volcados sueltos: el repositorio es la fuente
única.

---

## 2 · Documentos, en este orden

**2.a · Orden de entrega al equipo entrante** (siete pasos). Cada uno responde una
pregunta distinta; no se adelanta el siguiente sin haber entendido el anterior.

| #   | Documento                                                                                       | Qué resuelve                              |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | [`docs/README.md`](docs/README.md) §5.b                                                         | orden de lectura canónico (15 documentos) |
| 2   | [`docs/03_ejecucion/mvp.md`](docs/03_ejecucion/mvp.md)                                          | qué se entrega: MVP-45 sobre SQL Server   |
| 3   | [`docs/02_arquitectura/AVISA_PRODUCE_v10.md`](docs/02_arquitectura/AVISA_PRODUCE_v10.md)        | alcance y modelo de la v10                |
| 4   | [`docs/07_frontend/frontend.md`](docs/07_frontend/frontend.md) y `frontend_detalle.md`          | qué falta, pantalla por pantalla          |
| 5   | [`docs/07_frontend/mapa-sitio.md`](docs/07_frontend/mapa-sitio.md)                              | barra lateral, rutas y redirecciones      |
| 6   | [`docs/07_frontend/angular/CONTRATO_API_SPA.md`](docs/07_frontend/angular/CONTRATO_API_SPA.md)  | lo que la API en .NET debe preservar      |
| 7   | [`docs/06_operacion/DESPLIEGUE_VERCEL_NEON.md`](docs/06_operacion/DESPLIEGUE_VERCEL_NEON.md) §8 | destino .NET en un servidor de PRODUCE    |

**2.b · Orden de lectura canónico completo.** Reproducido de `docs/README.md`
§5.b; la autoridad de cada documento está en `docs/README.md` §2.

| #   | Documento                                                 | Qué responde                                                                                   |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0   | `docs/01_requisitos/guia.md`                              | cuál es el **marco normativo sectorial**: manda sobre el vocabulario de todos los demás        |
| 1   | `docs/01_requisitos/GLOSARIO_ALINEACION_GUIA.md`          | cómo se traduce esa Guía a **vocabulario verificable**: los once ejes y la tabla de reemplazos |
| 2   | `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md`            | qué **debe hacer** el sistema: requisitos, roles, pantallas y arquitectura C4                  |
| 3   | `docs/02_arquitectura/AVISA_PRODUCE_v10.md`               | cómo está **modelado** el sistema                                                              |
| 4   | `docs/03_ejecucion/mvp.md`                                | qué se **entrega** en diciembre: MVP-45 sobre SQL Server                                       |
| 5   | `docs/03_ejecucion/PRIORIZACION_MVP_v10.md`               | qué tablas se **construyen primero**                                                           |
| 6   | `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` | qué **había antes** y cómo se reconoce                                                         |
| 7   | `docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md`         | cómo se **levanta** la base y se migra el legado                                               |
| 8   | `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`            | **dónde corre** el entorno de desarrollo                                                       |
| 9   | `docs/06_operacion/DESPLIEGUE_VERCEL_NEON.md`             | qué se **despliega** hoy y cuál es el **destino .NET**                                         |
| 10  | `docs/neon/README.md`                                     | cómo se **copia la base** a Neon y cómo se saca el volcado (`pg_dump` / `pg_restore`)          |
| 11  | `docs/07_frontend/frontend.md`                            | qué **falta en la interfaz**, pantalla por pantalla; su anexo es `frontend_detalle.md`         |
| 12  | `docs/07_frontend/angular/CONTRATO_API_SPA.md`            | qué **consume la SPA de la API**: lo que la API en .NET debe preservar                         |
| 13  | `docs/07_frontend/angular/ESTADO_MIGRACION_ANGULAR.md`    | qué está **construido y verificado** en la SPA Angular                                         |
| 14  | `docs/07_frontend/angular/DISENO_MIGRACION_ANGULAR.md`    | cómo se **reescribe la interfaz** en Angular sin tocar el backend                              |

**De consulta, no de corrido:** `docs/05_datos/DICCIONARIO_DATOS.md` (y su
versión máquina `diccionario_datos.csv`), `docs/05_datos/BRECHA_CAPA_DATOS_V9.md`,
`docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md`,
`docs/04_migracion/PLAN_PORTE_LEGADO_V9.md`,
`docs/04_migracion/ACTA_CIERRE_CARGA_V9.md`, los diecinueve informes de
`docs/04_migracion/parches/`, `docs/01_requisitos/GAPS_GUIA_SQL_UI.md` y
`docs/01_requisitos/AUDITORIA_ALINEACION_2026-11-22.md`.

---

## 3 · Vistas de la consola y sus archivos

La barra se genera de `ENLACES_NAV` en
`angular/src/app/layouts/shell/shell.component.ts`; las rutas, de
`angular/src/app/app.routes.ts` (todo `loadComponent` perezoso). Cada `*.page`
es un componente standalone con su `.html` al lado.

**3.a · Barra lateral — 18 enlaces visibles en ocho grupos** (archivos relativos a
`angular/src/app/`):

```text
├─ PANORAMA TERRITORIAL
│  └─ Panorama territorial        /mapa                        features/mapa/mapa.page
├─ PREVENCIÓN
│  ├─ Casos                       /casos                       features/casos/casos.page
│  ├─ Alertas tempranas           /alertas                     features/alertas/alertas.page
│  └─ Clima social                /clima-social                features/clima-social/clima-social.page
├─ INTERVENCIÓN
│  └─ Productos del diálogo       /resultados                  features/resultados/resultados.page
├─ SEGUIMIENTO
│  └─ Compromisos                 /compromisos                 features/compromisos/compromisos.page
├─ GESTIÓN DE IYC
│  ├─ Documentos                  /documentos                  features/documentos/documentos.page
│  ├─ Archivo de sugerencias      /gobierno-sugerencias        features/gobierno-sugerencias/gobierno-sugerencias.page
│  └─ Plantillas                  /exportaciones               features/exportaciones/exportaciones.page
├─ DIRECTORIOS
│  ├─ Actores                     /directorio/personas         features/directorio/actores.page
│  ├─ Organizaciones              /directorio/organizaciones   features/directorio/organizaciones.page
│  ├─ Autoridades y agentes       /directorio/autoridades      features/directorio/autoridades.page
│  └─ Auditorios                  /directorio/locales          features/directorio/locales.page
├─ MI ESPACIO
│  ├─ Resumen operativo           /resumen                     features/resumen/resumen.page
│  ├─ Bandeja de trabajo          /bandeja                     features/bandeja/bandeja.page
│  └─ Archivo                     /archivo                     features/archivo/archivo.page        (soloSiPuedeEliminar)
└─ ADMINISTRACIÓN
   ├─ Administración              /administracion              features/administracion/administracion.page   (soloSiEsAdmin)
   └─ Consola ETL                 /administracion/etl          features/etl/etl.page                (soloSiEsAdmin)
```

**3.b · Pantallas fuera del menú**, todas con ruta viva:

```text
├─ Inicio de sesión               /acceso                      layouts/acceso/acceso.page
├─ Ficha del caso                 /casos/:codigo               features/casos/caso-detalle.page
├─ Demandas sin caso              /casos/sin-caso              features/casos/demandas-sin-caso.page
├─ Portada del directorio         /directorio                  features/directorio/directorio.page
├─ Matriz completa de actores     /directorio/actores          features/directorio/actores.page
├─ Resumen de Dirección           /direccion                   features/direccion/direccion.page
├─ Búsqueda global                /busqueda                    features/busqueda/busqueda.page
├─ Centro de notificaciones       /notificaciones              features/notificaciones/notificaciones.page
├─ Ayuda y criterios              /ayuda                       features/ayuda/ayuda.page
└─ Preferencias                   /preferencias                features/preferencias/preferencias.page
```

**3.c · Retiradas del menú el 2026-11-24.** Cinco entradas siguen marcadas
`oculto: true` en `ENLACES_NAV`: la ruta, el componente y el enrutado siguen
vivos, pero no se dibujan en la barra.

```text
├─ Dashboard analítico            /dashboard                   features/dashboard/dashboard.page
├─ Bandeja RED-RADAR              /red-radar                   features/red-radar/red-radar.page
├─ Matriz de conflictividad       /matriz-conflictividad       features/matriz-conflictividad/matriz-conflictividad.page
├─ Reuniones                      /reuniones                   features/reuniones/reuniones.page
└─ Reporte de actividad           /reportes                    features/reportes/reportes.page
```

En total: **33 rutas con componente** (32 hijas del shell más `/acceso`), **dos
redirecciones** de compatibilidad (`/papelera` → `/archivo` y
`/directorio/instituciones` → `/directorio/organizaciones`) y el comodín `/**` que
vuelve al inicio. El shell (`layouts/shell/shell.component`) no es una ruta: es
el marco con cabecera, barra lateral y el botón «Registrar ▾».

El detalle de condiciones por rol y redirecciones está en
[`docs/07_frontend/mapa-sitio.md`](docs/07_frontend/mapa-sitio.md); el estado
pantalla por pantalla, en
[`docs/07_frontend/frontend.md`](docs/07_frontend/frontend.md).

---

## 4 · Base de datos: volcado desde Neon con Docker

El objetivo es sacar un **volcado completo** de la base compartida (`avisa`, en
Neon) para poder recrearla en SQL Server. Se hace con `pg_dump` dentro de un
contenedor, sin instalar PostgreSQL en la máquina.

> **Si ya recibiste el paquete de entrega, no hace falta repetir esto.** El ZIP
> incluye `avisa_neon.dump` (volcado completo en formato `custom`) y
> `avisa_neon_schema.sql` (solo DDL, sin filas). Esta sección sirve para
> regenerarlos o para comprobar que lo recibido está íntegro: los dos números de
> abajo (§4.4) son la referencia.

### 4.0 · Instalar Docker (una vez)

1. Descargar **Docker Desktop** desde <https://www.docker.com/products/docker-desktop>
   e instalarlo.
2. Abrirlo y dejarlo corriendo. Si no está corriendo, cualquier `docker run`
   falla con `cannot connect to the Docker daemon`.
3. Comprobar en una terminal **nueva**:

   ```bash
   docker --version
   docker run --rm hello-world
   ```

### 4.1 · Reunir los datos de conexión

Los valores reales están en el archivo `.env` de la raíz del repositorio (no se
versiona: `.env` está en `.gitignore`) y en el panel de Neon → **Connect**. Si
acabas de clonar y no tienes `.env`, pídelo al responsable del proyecto por un
canal privado. Hacen falta cinco datos:

| Dato                  | De dónde sale                                                      |
| --------------------- | ------------------------------------------------------------------ |
| Host                  | cadena de conexión de Neon (endpoint **directo**, sin `-pooler`)   |
| Base                  | `avisa`                                                            |
| Usuario               | `neondb_owner` (dueño del DDL)                                     |
| Clave                 | la del proyecto; **no** se escribe en el repositorio ni en el chat |
| Versión de PostgreSQL | **18** (si el panel dice 17, usar `postgres:17-alpine`)            |

> Para `pg_dump` se usa el **host directo**: al nombre del pooler se le quita el
> sufijo `-pooler`. El pooler es para la aplicación, no para el volcado.

### 4.2 · Situarse en la raíz del repositorio y crear la carpeta

```bash
cd C:\Users\Julia\Downloads\avisa
mkdir backups -Force
```

`backups/*.dump` está en `.gitignore`: el volcado nunca entra al repositorio.

### 4.3 · Ejecutar el volcado

Una sola línea en **PowerShell** (las `\` de continuación no funcionan ahí):

```powershell
docker run --rm -v "${PWD}\backups:/backup" -e PGHOST=TU_HOST.neon.tech -e PGPORT=5432 -e PGDATABASE=avisa -e PGUSER=neondb_owner -e PGPASSWORD=TU_CLAVE -e PGSSLMODE=require postgres:18-alpine pg_dump -Fc --no-owner -f /backup/avisa_neon.dump
```

En **cmd.exe**:

```bat
docker run --rm -v "%CD%\backups:/backup" -e PGHOST=TU_HOST.neon.tech -e PGPORT=5432 -e PGDATABASE=avisa -e PGUSER=neondb_owner -e PGPASSWORD=TU_CLAVE -e PGSSLMODE=require postgres:18-alpine pg_dump -Fc --no-owner -f /backup/avisa_neon.dump
```

En **Git Bash** de Windows, **WSL** o Linux sí sirve el formato multilínea. En Git
Bash hay que anular la conversión de rutas de MSYS (`MSYS_NO_PATHCONV=1`), o
`/backup/avisa_neon.dump` se convierte en `C:/Program Files/Git/backup/...` y el
volcado falla:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/backups:/backup" \
  -e PGHOST=TU_HOST.neon.tech -e PGPORT=5432 \
  -e PGDATABASE=avisa -e PGUSER=neondb_owner -e PGPASSWORD=TU_CLAVE \
  -e PGSSLMODE=require postgres:18-alpine \
  pg_dump -Fc --no-owner -f /backup/avisa_neon.dump
```

La primera vez descarga `postgres:18-alpine` (~80 MB). Si todo va bien, el
comando **no imprime nada**.

### 4.4 · Comprobar que salió

```bash
dir backups\avisa_neon.dump
```

Debe pesar varios MB. Para ver el contenido sin restaurarlo:

```bash
docker run --rm -v "${PWD}\backups:/backup" postgres:18-alpine pg_restore -l /backup/avisa_neon.dump
```

### 4.5 · Problemas típicos

| Síntoma                                                        | Causa                                                    | Arreglo                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `cannot connect to the Docker daemon`                          | Docker Desktop no está corriendo                         | abrirlo y esperar a que arranque                          |
| `server version mismatch`                                      | `pg_dump` de versión menor que el servidor (Neon es 18)  | usar la imagen `postgres:18-alpine`                       |
| `could not translate host name`                                | se usó el host del pooler o el endpoint es el equivocado | quitar `-pooler` del nombre                               |
| error de certificado con `PGSSLMODE=verify-full`               | la imagen alpine no trae el CA de Neon                   | usar `PGSSLMODE=require`                                  |
| `could not open output file "C:/Program Files/Git/backup/..."` | Git Bash reescribe las rutas del contenedor              | anteponer `MSYS_NO_PATHCONV=1` al `docker run`            |
| `permission denied` al escribir en `/backup`                   | carpeta mal montada en Windows                           | usar `${PWD}\backups` (PowerShell) o `%CD%\backups` (cmd) |

Procedimiento largo, restauración y errores esperados: `docs/neon/README.md`.

### 4.6 · Esquema y artefactos

| Artefacto                                      | Qué es                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`         | todo el esquema en un archivo (generado)                                                      |
| `docs/sql_server/AVISA_V10_ESQUEMA_SIN_FK.sql` | el mismo esquema traducido a SQL Server, sin claves ajenas                                    |
| `docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql`  | las claves ajenas para aplicar después de la carga                                            |
| `docs/sql_server/INFORME_FKS.md`               | qué claves se pudieron traducir y cuáles no                                                   |
| `migration/mssql/`                             | alcance del MVP, rol de migración, normalización de tipos, mapa SSMA y chequeos postmigración |

---

## 5 · Levantar el entorno en local

Los runbooks completos están en
[`docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`](docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md)
y [`docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md`](docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md).
En corto:

```bash
cp .env.example .env        # ajustar POSTGRES_PASSWORD y las claves de la app
./scripts/db.sh up          # build + arranque + verificación de la base (55433)
pnpm install
npm --prefix angular ci
pnpm build:spa              # compila la consola en public/
pnpm dev                    # API + consola en http://localhost:3000
```

La consola también puede correr con recarga rápida en `:4200` con
`npm --prefix angular start` (proxy hacia la API en `:3000`). Un clon limpio
responde `404` en `/` hasta que exista `public/`: es esperado, no un defecto.

---

## 6 · Reglas mínimas del contrato

Estas cuatro reglas no se negocian en la reescritura:

1. **El contrato de la API se preserva.** La API nueva conserva lo descrito en
   `docs/07_frontend/angular/CONTRATO_API_SPA.md`: ruta, método, parámetros,
   cuerpo y forma de respuesta, pantalla por pantalla.
2. **La cookie de sesión se preserva.** `avisa_session`, `HttpOnly`,
   `SameSite=Lax`, `Path=/`, `Secure` en producción, `exp` **en milisegundos** y
   cuerpo `{uid, rol, roles[], nom, cod, dn, area, cargo, regs[], exp}`.
3. **El riesgo se calcula en el servidor.** La SPA no promedia señales ni
   recalcula el riesgo; sólo lo muestra.
4. **Los datos personales no salen del entorno.** El volcado y las claves no
   entran al repositorio ni se envían por correo. La base contiene datos
   personales protegidos por la **Ley 29733**: el acceso se limita a quien lo
   necesite para la migración. El árbol de trabajo ya no contiene volcados —el
   del 19-11-2026 se retiró el 24-11—, pero **el historial de git todavía
   conserva ese archivo**: un clon completo lo trae. Si eso importa para el
   cumplimiento, hay que purgarlo con `git filter-repo` antes de abrir el
   repositorio a más gente.

---

## 7 · Dónde seguir

- Qué falta en la interfaz: [`docs/07_frontend/frontend.md`](docs/07_frontend/frontend.md).
- Qué está construido y verificado en Angular: [`docs/07_frontend/angular/ESTADO_MIGRACION_ANGULAR.md`](docs/07_frontend/angular/ESTADO_MIGRACION_ANGULAR.md).
- Índice documental completo: [`docs/README.md`](docs/README.md).
