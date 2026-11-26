import { Injectable, computed, inject } from '@angular/core';

import { SesionStore } from '../auth/sesion.store';
import type { FormatoExportacion } from '../http/descargas';

/**
 * Roles de la base (`core.roles.codigo`).
 *
 * ADMIN acumula todos los códigos, así que las comprobaciones por pertenencia
 * funcionan sin una rama especial: "Admin tiene todos los privilegios".
 */
export const ROL = {
  sectorista: 'sectorista',
  administrador: 'administrador',
  consultaLectura: 'consulta_lectura',
  altaDireccion: 'alta_direccion',
  servicioAgente: 'servicio_agente',
  auditor: 'auditor',
  externoPublico: 'externo_publico',
  analistaCualitativo: 'analista_cualitativo',
  curadorPolitica: 'curador_politica',
  direccionOaipcs: 'direccion_oaipcs',
} as const;

/**
 * Quién crea y modifica registros.
 *
 * Réplica exacta de `core.roles.puede_editar` (migración 17). Alta Dirección
 * consulta: la base le niega la escritura, así que la UI no debe ofrecerla.
 * Si la matriz cambia en la base, este cuadro se cambia aquí y en ningún otro
 * sitio del cliente.
 */
const ESCRIBEN = new Set<string>([
  ROL.administrador,
  ROL.direccionOaipcs,
  ROL.sectorista,
  ROL.servicioAgente,
  ROL.analistaCualitativo,
  ROL.curadorPolitica,
]);

/**
 * Quién anula (borrado lógico) y restaura.
 *
 * Réplica de `core.roles.puede_eliminar = true` (parche 15 de la DDL): sólo
 * `sectorista` y `administrador`. `direccion_oaipcs` edita pero no borra, así
 * que la UI no debe ofrecerle una acción que la RLS le negaría.
 */
const ANULAN = new Set<string>([ROL.administrador, ROL.sectorista]);

/**
 * Quién ve DNI y teléfonos (descifrado habilitado).
 *
 * Decisión del usuario: todos los sectoristas y la dirección (incluida la alta
 * dirección) acceden a los datos personales. No es un permiso de escritura.
 */
const VEN_PII = new Set<string>([
  ROL.administrador,
  ROL.direccionOaipcs,
  ROL.altaDireccion,
  ROL.sectorista,
]);

/**
 * Perfiles que conservan las tres salidas de exportación (item 107).
 *
 * «Dirección» incluye a quien dirige la oficina y a la alta dirección; el
 * administrador acumula todos los códigos, así que también cae aquí.
 */
const EXPORTA_COMPLETO = new Set<string>([
  ROL.administrador,
  ROL.altaDireccion,
  ROL.direccionOaipcs,
]);

/**
 * Quiénes componen la Dirección en la vista de alertas.
 *
 * Reúne al rol que aprueba (`direccion_oaipcs`), a la alta dirección —el
 * ministerio que recibe la alerta— y al administrador, que acumula todos los
 * códigos de `core.roles`. Es un cuadro de lectura de la UI, no de permisos:
 * aprobar, archivar o anular siguen exigiendo además `puedeEditar` y
 * `puedeEliminar`, que replican la matriz de la base. En particular,
 * `direccion_oaipcs` entra aquí para aprobar, pero no borra (`puede_eliminar =
 * false` en el parche 20), así que la vista no le ofrece «Anular».
 */
const DIRECCION = new Set<string>([ROL.administrador, ROL.direccionOaipcs, ROL.altaDireccion]);

const FORMATOS_COMPLETOS: readonly FormatoExportacion[] = ['json', 'excel', 'pdf'];

/** El sectorista en campo descarga hoja y PDF; el JSON queda para Dirección. */
const FORMATOS_SECTORISTA: readonly FormatoExportacion[] = ['excel', 'pdf'];

/**
 * Clasificación de información máxima por rol (1 reservado … 3 confidencial).
 *
 * Réplica de `core.roles.max_clasificacion`. El nivel 3 es el que exige
 * `core.actor_datos_personales_descifrar`, de modo que sectoristas, dirección y
 * alta dirección pueden ver DNI y teléfonos (decisión del usuario), mientras
 * consulta y externo no.
 */
const MAX_CLASIFICACION: Record<string, number> = {
  [ROL.administrador]: 3,
  [ROL.direccionOaipcs]: 3,
  [ROL.altaDireccion]: 3,
  [ROL.sectorista]: 3,
  [ROL.analistaCualitativo]: 3,
  [ROL.curadorPolitica]: 2,
  [ROL.servicioAgente]: 3,
  [ROL.consultaLectura]: 2,
  [ROL.auditor]: 3,
  [ROL.externoPublico]: 1,
};

@Injectable({ providedIn: 'root' })
export class CapacidadesService {
  private readonly sesion = inject(SesionStore);

  private readonly roles = this.sesion.roles;

  readonly esAdmin = computed(() => this.roles().includes(ROL.administrador));

  /** Perfiles de dirección (ver el cuadro `DIRECCION`). */
  readonly esDireccion = computed(() => this.roles().some((rol) => DIRECCION.has(rol)));

  /**
   * Alias de `esDireccion` con el nombre que usa la vista de alertas («Edith» y
   * la Dirección OAIPCS comparten rol). Apunta a la misma señal: no hay dos
   * cuadros de roles que puedan desincronizarse.
   */
  readonly esDirectora = this.esDireccion;

  readonly puedeEditar = computed(() => this.roles().some((rol) => ESCRIBEN.has(rol)));

  readonly puedeEliminar = computed(() => this.roles().some((rol) => ANULAN.has(rol)));

  readonly puedeVerPii = computed(() => this.roles().some((rol) => VEN_PII.has(rol)));

  /**
   * Salidas de exportación que ofrece el perfil (item 107).
   *
   * El recorte alcanza al sectorista que no acumula un perfil de dirección: un
   * usuario con ambos papeles se queda con el conjunto amplio, porque el ADMIN
   * de la base acumula todos los códigos y no debe perder salidas.
   */
  readonly formatosExportacion = computed<readonly FormatoExportacion[]>(() =>
    this.roles().includes(ROL.sectorista) && !this.roles().some((rol) => EXPORTA_COMPLETO.has(rol))
      ? FORMATOS_SECTORISTA
      : FORMATOS_COMPLETOS,
  );

  readonly maxClasificacion = computed(() => {
    const valores = this.roles()
      .map((rol) => MAX_CLASIFICACION[rol] ?? 1)
      .filter((valor): valor is number => typeof valor === 'number');
    return valores.length ? Math.max(...valores) : 1;
  });

  /** Permiso de escritura sobre un registro concreto según su clasificación. */
  puedeModificar(clasificacion: number | null | undefined): boolean {
    if (!this.puedeEditar()) return false;
    if (this.esAdmin()) return true;
    return (clasificacion ?? 1) <= this.maxClasificacion();
  }

  /** Etiquetas legibles de los roles, para la ficha de perfil. */
  etiquetasRoles(): string[] {
    const MAPA: Record<string, string> = {
      [ROL.administrador]: 'Administrador',
      [ROL.direccionOaipcs]: 'Dirección OAIPCS',
      [ROL.altaDireccion]: 'Alta Dirección',
      [ROL.sectorista]: 'Sectorista',
      [ROL.consultaLectura]: 'Consulta',
      [ROL.analistaCualitativo]: 'Analista cualitativo',
      [ROL.curadorPolitica]: 'Curador de política',
      [ROL.servicioAgente]: 'Servicio de agente',
      [ROL.auditor]: 'Auditor',
      [ROL.externoPublico]: 'Externo',
    };
    return this.roles().map((rol) => MAPA[rol] ?? rol);
  }
}
