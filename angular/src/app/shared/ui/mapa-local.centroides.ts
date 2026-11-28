/**
 * Centroides **referenciales** de las 25 regiones del Perú para `mapa-local`.
 *
 * Es una copia deliberada del mínimo necesario de
 * `features/mapa/centroides.regiones.ts`: un componente de `shared/ui` no debe
 * depender de una feature, así que la tabla se duplica aquí en lugar de
 * importarse. Si esa tabla cambia, hay que replicar el cambio en ambos sitios.
 *
 * Cada fila es el punto aproximado del área departamental, útil sólo para
 * centrar un círculo de aproximación. **No** es un ubigeo distrital, no es la
 * capital de la región, no es un límite administrativo y no reemplaza la capa
 * cartográfica oficial. Si el nombre de la región no coincide, no se dibuja
 * nada: la vista no inventa una ubicación.
 */

export type CentroideRegion = {
  /** Código INEI de región (`character(2)`): `01` Amazonas … `25` Ucayali. */
  ubigeo: string;
  /** Nombre canónico de la región, con tildes. */
  region: string;
  lat: number;
  lng: number;
};

export const CENTROIDES_REGION: readonly CentroideRegion[] = [
  { ubigeo: '01', region: 'Amazonas', lat: -5.4, lng: -78.1 },
  { ubigeo: '02', region: 'Áncash', lat: -9.3, lng: -77.6 },
  { ubigeo: '03', region: 'Apurímac', lat: -14.05, lng: -73.05 },
  { ubigeo: '04', region: 'Arequipa', lat: -15.85, lng: -72.25 },
  { ubigeo: '05', region: 'Ayacucho', lat: -13.95, lng: -74.2 },
  { ubigeo: '06', region: 'Cajamarca', lat: -6.35, lng: -78.6 },
  { ubigeo: '07', region: 'Callao', lat: -12.03, lng: -77.13 },
  { ubigeo: '08', region: 'Cusco', lat: -13.55, lng: -72.15 },
  { ubigeo: '09', region: 'Huancavelica', lat: -13.1, lng: -75.0 },
  { ubigeo: '10', region: 'Huánuco', lat: -9.45, lng: -76.0 },
  { ubigeo: '11', region: 'Ica', lat: -14.3, lng: -75.7 },
  { ubigeo: '12', region: 'Junín', lat: -11.45, lng: -74.9 },
  { ubigeo: '13', region: 'La Libertad', lat: -7.95, lng: -78.4 },
  { ubigeo: '14', region: 'Lambayeque', lat: -6.35, lng: -79.8 },
  { ubigeo: '15', region: 'Lima', lat: -11.65, lng: -76.45 },
  { ubigeo: '16', region: 'Loreto', lat: -4.55, lng: -74.6 },
  { ubigeo: '17', region: 'Madre de Dios', lat: -12.15, lng: -70.4 },
  { ubigeo: '18', region: 'Moquegua', lat: -16.9, lng: -70.9 },
  { ubigeo: '19', region: 'Pasco', lat: -10.45, lng: -75.45 },
  { ubigeo: '20', region: 'Piura', lat: -5.1, lng: -80.1 },
  { ubigeo: '21', region: 'Puno', lat: -15.05, lng: -70.15 },
  { ubigeo: '22', region: 'San Martín', lat: -7.2, lng: -76.75 },
  { ubigeo: '23', region: 'Tacna', lat: -17.6, lng: -70.25 },
  { ubigeo: '24', region: 'Tumbes', lat: -3.85, lng: -80.6 },
  { ubigeo: '25', region: 'Ucayali', lat: -9.55, lng: -73.6 },
];

/** Minúsculas, sin tildes y con espacios simples, igual que la tabla canónica. */
function normalizarRegion(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const POR_NOMBRE = new Map<string, CentroideRegion>(
  CENTROIDES_REGION.map((centroide) => [normalizarRegion(centroide.region), centroide]),
);

/** Variante que aparece en los datos y no es el nombre canónico. */
const ALIAS: Readonly<Record<string, string>> = {
  'provincia constitucional del callao': 'callao',
};

/** Centroide de la región; `null` si el nombre no coincide con la tabla. */
export function centroideDeRegion(region: string | null | undefined): CentroideRegion | null {
  const texto = typeof region === 'string' ? region.trim() : '';
  if (!texto) return null;

  const clave = normalizarRegion(texto);
  const alias = ALIAS[clave];
  return POR_NOMBRE.get(clave) ?? (alias ? (POR_NOMBRE.get(alias) ?? null) : null);
}
