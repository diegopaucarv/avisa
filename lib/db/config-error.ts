/**
 * Fallo de configuración del servidor: una variable de entorno obligatoria
 * falta o es inválida.
 *
 * Se distingue de un 500 genérico a propósito. Un despliegue mal configurado
 * aparecía como "Error interno." y se confundía con una credencial incorrecta;
 * un 500 sin código de Postgres siempre fue esto o un fallo de red, nunca la
 * base diciendo que la clave está mal (eso es 28P01 → 503).
 *
 * No transporta valores secretos: sólo el nombre de la variable.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
