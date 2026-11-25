import { Routes } from '@angular/router';

import { sesionGuard, visitanteGuard } from './core/auth/sesion.guard';

/**
 * Rutas de la aplicación.
 *
 * Todo es `loadComponent` (lazy) para que el bundle inicial quede pequeño.
 * La raíz abre el panorama territorial, que es la ventana principal: distribuye
 * los casos abiertos por ámbito y región sin dibujar geometría (el dataset
 * ubigeo/centroide sigue aplazado).
 */
export const routes: Routes = [
  {
    path: 'acceso',
    canActivate: [visitanteGuard],
    loadComponent: () => import('./layouts/acceso/acceso.page').then((m) => m.AccesoPage),
  },
  {
    path: '',
    canActivate: [sesionGuard],
    loadComponent: () => import('./layouts/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'mapa' },

      {
        path: 'resumen',
        loadComponent: () => import('./features/resumen/resumen.page').then((m) => m.ResumenPage),
      },
      {
        path: 'bandeja',
        loadComponent: () => import('./features/bandeja/bandeja.page').then((m) => m.BandejaPage),
      },
      {
        path: 'busqueda',
        loadComponent: () =>
          import('./features/busqueda/busqueda.page').then((m) => m.BusquedaPage),
      },
      {
        path: 'notificaciones',
        loadComponent: () =>
          import('./features/notificaciones/notificaciones.page').then((m) => m.NotificacionesPage),
      },

      {
        path: 'casos',
        loadComponent: () => import('./features/casos/casos.page').then((m) => m.CasosPage),
      },
      {
        path: 'casos/sin-caso',
        loadComponent: () =>
          import('./features/casos/demandas-sin-caso.page').then((m) => m.DemandasSinCasoPage),
      },
      {
        path: 'casos/:codigo',
        loadComponent: () =>
          import('./features/casos/caso-detalle.page').then((m) => m.CasoDetallePage),
      },

      {
        path: 'alertas',
        loadComponent: () => import('./features/alertas/alertas.page').then((m) => m.AlertasPage),
      },
      {
        path: 'clima-social',
        loadComponent: () =>
          import('./features/clima-social/clima-social.page').then((m) => m.ClimaSocialPage),
      },
      {
        path: 'reuniones',
        loadComponent: () =>
          import('./features/reuniones/reuniones.page').then((m) => m.ReunionesPage),
      },
      {
        path: 'resultados',
        loadComponent: () =>
          import('./features/resultados/resultados.page').then((m) => m.ResultadosPage),
      },
      {
        path: 'compromisos',
        loadComponent: () =>
          import('./features/compromisos/compromisos.page').then((m) => m.CompromisosPage),
      },
      {
        path: 'documentos',
        loadComponent: () =>
          import('./features/documentos/documentos.page').then((m) => m.DocumentosPage),
      },
      {
        path: 'archivo',
        loadComponent: () => import('./features/archivo/archivo.page').then((m) => m.ArchivoPage),
      },
      {
        path: 'papelera',
        redirectTo: 'archivo',
        pathMatch: 'full',
      },
      {
        path: 'reportes',
        loadComponent: () =>
          import('./features/reportes/reportes.page').then((m) => m.ReportesPage),
      },
      {
        path: 'mapa',
        data: { titulo: 'Panorama territorial' },
        loadComponent: () => import('./features/mapa/mapa.page').then((m) => m.MapaPage),
      },
      {
        path: 'dashboard',
        data: { titulo: 'Dashboard analítico' },
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'red-radar',
        data: { titulo: 'Bandeja RED-RADAR' },
        loadComponent: () =>
          import('./features/red-radar/red-radar.page').then((m) => m.RedRadarPage),
      },
      {
        path: 'matriz-conflictividad',
        data: { titulo: 'Matriz de conflictividad' },
        loadComponent: () =>
          import('./features/matriz-conflictividad/matriz-conflictividad.page').then(
            (m) => m.MatrizConflictividadPage,
          ),
      },
      {
        path: 'gobierno-sugerencias',
        data: { titulo: 'Archivo de sugerencias' },
        loadComponent: () =>
          import('./features/gobierno-sugerencias/gobierno-sugerencias.page').then(
            (m) => m.GobiernoSugerenciasPage,
          ),
      },
      {
        path: 'exportaciones',
        data: { titulo: 'Exportaciones' },
        loadComponent: () =>
          import('./features/exportaciones/exportaciones.page').then((m) => m.ExportacionesPage),
      },
      {
        path: 'administracion/etl',
        data: { titulo: 'Consola ETL' },
        loadComponent: () => import('./features/etl/etl.page').then((m) => m.EtlPage),
      },
      {
        path: 'administracion',
        data: { titulo: 'Administración' },
        loadComponent: () =>
          import('./features/administracion/administracion.page').then((m) => m.AdministracionPage),
      },

      {
        path: 'directorio',
        loadComponent: () =>
          import('./features/directorio/directorio.page').then((m) => m.DirectorioPage),
      },
      {
        path: 'directorio/personas',
        data: { naturalezaFija: 'persona' },
        loadComponent: () =>
          import('./features/directorio/actores.page').then((m) => m.ActoresPage),
      },
      {
        path: 'directorio/actores',
        loadComponent: () =>
          import('./features/directorio/actores.page').then((m) => m.ActoresPage),
      },
      {
        path: 'directorio/organizaciones',
        loadComponent: () =>
          import('./features/directorio/organizaciones.page').then((m) => m.OrganizacionesPage),
      },
      {
        // Alias heredado: el directorio de organizaciones absorbió a las
        // antiguas «instituciones» (vocabulario que ya no se usa en la UI).
        path: 'directorio/instituciones',
        redirectTo: '/directorio/organizaciones',
        pathMatch: 'full',
      },
      {
        path: 'directorio/locales',
        loadComponent: () =>
          import('./features/directorio/locales.page').then((m) => m.LocalesPage),
      },
      {
        path: 'directorio/autoridades',
        loadComponent: () =>
          import('./features/directorio/autoridades.page').then((m) => m.AutoridadesPage),
      },

      {
        path: 'direccion',
        loadComponent: () =>
          import('./features/direccion/direccion.page').then((m) => m.DireccionPage),
      },
      {
        path: 'ayuda',
        loadComponent: () => import('./features/ayuda/ayuda.page').then((m) => m.AyudaPage),
      },
      {
        path: 'preferencias',
        loadComponent: () =>
          import('./features/preferencias/preferencias.page').then((m) => m.PreferenciasPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
