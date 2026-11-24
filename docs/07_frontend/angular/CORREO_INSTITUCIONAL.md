# Correo institucional (Gmail SMTP)

Envío real de correos desde la cuenta institucional de Gmail del Ministerio,
sin abrir el cliente de correo de la persona usuaria. La vista de **Reuniones**
mantiene el canal de WhatsApp (`wa.me`) y el de correo del cliente (`mailto:`)
como alternativas; el tercer canal, «Correo institucional», pasa por el
servidor.

## Estado

- Implementado en código: transporte, ruta `POST /api/v1/mensajes/correo` y
  acción en la SPA.
- **Sin prueba HTTP en vivo**: el contenedor Docker del proyecto no está
  disponible. La verificación hecha es `tsc`, `ng build` y `ng test`.
- Sin `GMAIL_USER` y `GMAIL_APP_PASSWORD`, la API responde `503` con
  `CONFIG_MISSING` y la SPA muestra «Correo institucional no configurado.».
  No se simula el envío ni se marca como enviado.

## Cómo obtener una contraseña de aplicación de Gmail

Gmail no acepta la contraseña normal de la cuenta desde SMTP: hace falta una
**contraseña de aplicación**, y para crearla la cuenta debe tener activada la
verificación en dos pasos.

1. Entrar a la cuenta institucional y activar la verificación en dos pasos
   (Cuenta de Google → Seguridad → Verificación en dos pasos).
2. Ir a Cuenta de Google → Seguridad → **Contraseñas de aplicación**.
3. Crear una contraseña para «Correo» / «Otro (nombre personalizado)», por
   ejemplo `AVISA servidor`.
4. Google muestra 16 caracteres en cuatro bloques. Se copian tal cual: el
   servidor elimina los espacios al leer `GMAIL_APP_PASSWORD`.
5. Guardar el valor en el gestor de secretos o en el `.env` del servidor. La
   contraseña no se vuelve a mostrar; si se pierde, se revoca y se crea otra.

El acceso debe estar permitido para la organización: si el administrador de
Google Workspace bloquea las contraseñas de aplicación o el protocolo SMTP, la
autenticación fallará aunque las credenciales sean correctas. Eso se resuelve
en la consola de administración, no en este repositorio.

## Variables de entorno

Sólo las lee el servidor de Next (`lib/mail/gmail.ts`). **Nunca** se copian a la
SPA, a `angular/src`, a `public/env.js` ni al repositorio.

| Variable              | Obligatoria | Uso                                                        |
| --------------------- | ----------- | ---------------------------------------------------------- |
| `GMAIL_USER`          | Sí          | Cuenta institucional que envía (dirección completa).       |
| `GMAIL_APP_PASSWORD`  | Sí          | Contraseña de aplicación de 16 caracteres.                 |
| `GMAIL_FROM_NAME`     | No          | Nombre visible del remitente, p. ej. «Ministerio de …».    |

Sin nombre, el remitente es sólo la dirección. Con nombre, el encabezado `From`
queda como `"Nombre" <cuenta>`; el nombre se limpia de saltos de línea y
comillas para no inyectar cabeceras.

Los nombres están listados (sin valores) en `.env.example`. En desarrollo se
definen en el `.env` local; en el servidor, en el entorno del proceso o en el
`env_file` del despliegue. El `.env` real está ignorado por Git.

Detalles del transporte: `smtp.gmail.com`, puerto `465`, `secure: true`,
timeouts de conexión, saludo y socket de 10 s, y acceso a archivos y URLs
deshabilitado en el mensaje.

## Contenedor y dependencia

El envío usa `nodemailer` (dependencia de producción en la raíz). Después de
incorporar el cambio, la imagen hay que reconstruirla o, dentro del contenedor,
ejecutar:

```sh
corepack pnpm install
```

Mientras Docker no esté operativo no se puede probar el envío real: el `503`
por configuración ausente sí se puede reproducir sin credenciales, porque la
ruta corta antes de conectar.

## Contrato de la ruta

`POST /api/v1/mensajes/correo` (runtime Node.js, sin caché).

- Sesión obligatoria (`requireSession`); sin cookie válida, `401 NO_SESSION`.
- Cuerpo:

```json
{
  "destinatario": "nombre@dominio.gob.pe",
  "asunto": "Convocatoria a reunión de diálogo",
  "cuerpo": "Texto del mensaje"
}
```

- El **destinatario lo escribe la persona usuaria**. La ruta no lo busca en la
  base, no consulta fichas ni padrones, y no guarda ni el destinatario ni el
  cuerpo.
- Respuesta correcta (`200`):

```json
{
  "enviado": true,
  "canal": "correo-institucional",
  "generatedAt": "2026-01-01T00:00:00.000Z"
}
```

### Validaciones

| Campo         | Regla                                                        |
| ------------- | ------------------------------------------------------------ |
| `destinatario`| Correo con formato razonable, máximo 254 caracteres.         |
| `asunto`      | 1–150 caracteres, sin CR/LF.                                 |
| `cuerpo`      | 1–8000 caracteres, texto plano.                              |

El cuerpo sale en texto plano y en una versión HTML mínima con los caracteres
escapados (`&`, `<`, `>`, `"`, `'`); el HTML del usuario nunca se inyecta.

### Errores

| HTTP | `code`          | Cuándo                                                     |
| ---- | --------------- | ---------------------------------------------------------- |
| 400  | `INVALID_BODY`  | cuerpo mal formado o campo fuera de rango                  |
| 401  | `NO_SESSION`    | cookie ausente o inválida                                  |
| 429  | `RATE_LIMITED`  | más de 10 envíos por minuto para el mismo usuario          |
| 502  | `CORREO_FALLO`  | Gmail rechazó o no respondió; mensaje genérico             |
| 503  | `CONFIG_MISSING`| faltan `GMAIL_USER` o `GMAIL_APP_PASSWORD`                 |

El `503` conserva el sobre habitual `{ detail, code }` y añade el objeto
`error` documentado para este canal:

```json
{
  "detail": "Correo institucional no configurado.",
  "code": "CONFIG_MISSING",
  "error": {
    "code": "CONFIG_MISSING",
    "message": "Correo institucional no configurado."
  }
}
```

Un fallo de autenticación de Gmail se traduce siempre a `502 CORREO_FALLO` con
mensaje genérico: ni la credencial ni el mensaje crudo de SMTP llegan al
cliente. En el log del servidor sólo queda el resultado y el código acotado del
error (`EAUTH`, `ETIMEDOUT`, …), nunca el destinatario ni el cuerpo.

## Límite de envíos

`10` envíos por minuto por usuario, contados en memoria del proceso. Es una
defensa simple contra dobles clics y bucles, no una cuota global: con varias
instancias del servidor cada una lleva su propia cuenta. Si se necesita un
límite estricto entre instancias, habría que llevarlo a la base o a un
almacén compartido.

## Uso en la SPA

En **Reuniones**, el canal «Correo institucional»:

- usa `urlApi('/v1/mensajes/correo')` y la sesión por cookie del interceptor;
- deshabilita el botón mientras envía (`Enviando…`);
- muestra «Correo enviado desde la cuenta institucional.» al recibir `200`;
- muestra el mensaje del error en cualquier fallo, y «Correo institucional no
  configurado.» ante `503`/`CONFIG_MISSING`;
- deja el enlace `mailto:` como alternativa si se prefiere el cliente de
  correo local.

## Cómo verificarlo cuando Docker vuelva

1. Definir las tres variables en el entorno del servidor.
2. Reconstruir la imagen (o `corepack pnpm install` dentro del contenedor).
3. Iniciar sesión en la SPA, abrir Reuniones, elegir «Correo institucional»,
   escribir un destinatario propio y enviar.
4. Revisar la bandeja del destinatario y, si falla, el log del servidor: sólo
   debe aparecer `[avisa-correo] envío fallido { codigo: … }`.

Para probar la degradación sin credenciales: quitar `GMAIL_USER` y
`GMAIL_APP_PASSWORD`, reiniciar el servidor y enviar. Debe responder `503`
`CONFIG_MISSING` y la SPA debe mostrar el aviso honesto, sin conexión SMTP.
