/**
 * Catálogo territorial ilustrativo para el prototipo.
 *
 * No es el padrón oficial de UBIGEO ni reemplaza la validación institucional:
 * solo incluye un conjunto curado de departamentos, provincias y distritos
 * para demostrar la selección territorial y el formato de seis dígitos.
 */
export type UbigeoDistrict = {
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
};

export const ubigeoCatalog: UbigeoDistrict[] = [
  { ubigeo: "010101", departamento: "Amazonas", provincia: "Chachapoyas", distrito: "Chachapoyas" },
  { ubigeo: "021101", departamento: "Áncash", provincia: "Huarmey", distrito: "Huarmey" },
  { ubigeo: "021103", departamento: "Áncash", provincia: "Huarmey", distrito: "Culebras" },
  { ubigeo: "021801", departamento: "Áncash", provincia: "Santa", distrito: "Chimbote" },
  { ubigeo: "030101", departamento: "Apurímac", provincia: "Abancay", distrito: "Abancay" },
  { ubigeo: "040101", departamento: "Arequipa", provincia: "Arequipa", distrito: "Arequipa" },
  { ubigeo: "050101", departamento: "Ayacucho", provincia: "Huamanga", distrito: "Ayacucho" },
  { ubigeo: "060101", departamento: "Cajamarca", provincia: "Cajamarca", distrito: "Cajamarca" },
  { ubigeo: "070101", departamento: "Callao", provincia: "Callao", distrito: "Callao" },
  { ubigeo: "080101", departamento: "Cusco", provincia: "Cusco", distrito: "Cusco" },
  { ubigeo: "090101", departamento: "Huancavelica", provincia: "Huancavelica", distrito: "Huancavelica" },
  { ubigeo: "100101", departamento: "Huánuco", provincia: "Huánuco", distrito: "Huánuco" },
  { ubigeo: "110101", departamento: "Ica", provincia: "Ica", distrito: "Ica" },
  { ubigeo: "120101", departamento: "Junín", provincia: "Huancayo", distrito: "Huancayo" },
  { ubigeo: "120301", departamento: "Junín", provincia: "Chanchamayo", distrito: "Chanchamayo" },
  { ubigeo: "120302", departamento: "Junín", provincia: "Chanchamayo", distrito: "Perené" },
  { ubigeo: "120303", departamento: "Junín", provincia: "Chanchamayo", distrito: "Pichanaqui" },
  { ubigeo: "120305", departamento: "Junín", provincia: "Chanchamayo", distrito: "San Ramón" },
  { ubigeo: "130101", departamento: "La Libertad", provincia: "Trujillo", distrito: "Trujillo" },
  { ubigeo: "140101", departamento: "Lambayeque", provincia: "Chiclayo", distrito: "Chiclayo" },
  { ubigeo: "150101", departamento: "Lima", provincia: "Lima", distrito: "Lima" },
  { ubigeo: "150122", departamento: "Lima", provincia: "Lima", distrito: "Miraflores" },
  { ubigeo: "160101", departamento: "Loreto", provincia: "Maynas", distrito: "Iquitos" },
  { ubigeo: "170101", departamento: "Madre de Dios", provincia: "Tambopata", distrito: "Tambopata" },
  { ubigeo: "180101", departamento: "Moquegua", provincia: "Mariscal Nieto", distrito: "Moquegua" },
  { ubigeo: "190101", departamento: "Pasco", provincia: "Pasco", distrito: "Chaupimarca" },
  { ubigeo: "200101", departamento: "Piura", provincia: "Piura", distrito: "Piura" },
  { ubigeo: "200104", departamento: "Piura", provincia: "Piura", distrito: "Catacaos" },
  { ubigeo: "200501", departamento: "Piura", provincia: "Paita", distrito: "Paita" },
  { ubigeo: "200504", departamento: "Piura", provincia: "Paita", distrito: "Colán" },
  { ubigeo: "200507", departamento: "Piura", provincia: "Paita", distrito: "Vichayal" },
  { ubigeo: "200801", departamento: "Piura", provincia: "Sechura", distrito: "Sechura" },
  { ubigeo: "210101", departamento: "Puno", provincia: "Puno", distrito: "Puno" },
  { ubigeo: "220101", departamento: "San Martín", provincia: "Moyobamba", distrito: "Moyobamba" },
  { ubigeo: "230101", departamento: "Tacna", provincia: "Tacna", distrito: "Tacna" },
  { ubigeo: "240101", departamento: "Tumbes", provincia: "Tumbes", distrito: "Tumbes" },
  { ubigeo: "250101", departamento: "Ucayali", provincia: "Coronel Portillo", distrito: "Callería" },
];

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");

/** Valida el formato del código UBIGEO usado por la demostración (6 dígitos). */
export function isValidUbigeo(value: string) {
  return /^\d{6}$/.test(value.trim());
}

/** Busca un distrito por código. Devuelve undefined si no existe o el formato falla. */
export function findDistrict(ubigeo: string) {
  const code = ubigeo.trim();
  if (!isValidUbigeo(code)) return undefined;
  return ubigeoCatalog.find((item) => item.ubigeo === code);
}

/** Busca el distrito a partir del formato de región usado por los casos. */
export function findDistrictByRegion(region: string) {
  const [department, district] = region.split(/[·,/-]/).map((part) => part.trim());
  if (!department || !district) return undefined;
  return ubigeoCatalog.find(
    (item) =>
      normalize(item.departamento) === normalize(department) &&
      normalize(item.distrito) === normalize(district),
  );
}

/** Etiqueta estable del territorio: «Departamento · Distrito». */
export function regionLabelForDistrict(district: UbigeoDistrict) {
  return `${district.departamento} · ${district.distrito}`;
}

export const ubigeoDepartments = Array.from(
  new Set(ubigeoCatalog.map((item) => item.departamento)),
).sort((left, right) => left.localeCompare(right, "es"));
