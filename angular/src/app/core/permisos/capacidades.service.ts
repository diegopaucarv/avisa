import { Injectable, computed, inject } from '@angular/core';

import { SesionStore } from '../auth/sesion.store';

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

/** Quién anula (borrado lógico) y restaura. */
const ANULAN = new Set<string>([ROL.administrador, ROL.direccionOaipcs]);

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

  readonly puedeEditar = computed(() => this.roles().some((rol) => ESCRIBEN.has(rol)));

  readonly puedeEliminar = computed(() => this.roles().some((rol) => ANULAN.has(rol)));

  readonly puedeVerPii = computed(() => this.roles().some((rol) => VEN_PII.has(rol)));

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
