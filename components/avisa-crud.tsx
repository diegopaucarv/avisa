"use client";

import { useState, type ReactNode } from "react";
import { Pencil, Plus, Upload, X } from "lucide-react";
import {
  docKindLabels,
  type DemoAlert,
  type DemoCase,
  type DemoCommitment,
  type DemoDemanda,
  type DemoDocument,
  type DemandaFuente,
  type DocKind,
} from "./avisa-demo-data";
import { useAvisa } from "@/lib/avisa-store";
import {
  conflictLevels,
  deriveCommitmentStatus,
  deriveGeographicScope,
  priorities,
  subsectors,
  themes,
  toDateInputValue,
} from "./avisa-catalogs";
import {
  findDistrict,
  findDistrictByRegion,
  isValidUbigeo,
  regionLabelForDistrict,
  ubigeoCatalog,
  ubigeoDepartments,
} from "./avisa-ubigeo";

const threePFields = ["problema", "propuesta", "pedido"] as const;
type ThreePField = (typeof threePFields)[number];

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");

export function FormDrawer({
  open,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = "Guardar",
  lockDismiss = false,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  lockDismiss?: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="drawer-scrim"
      onClick={(event) => {
        if (!lockDismiss && event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          {!lockDismiss && (
            <button
              className="icon-button"
              aria-label="Cerrar formulario"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          )}
        </div>
        <form
          className="drawer-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="drawer-body">{children}</div>
          <div className="drawer-foot">
            <button
              type="button"
              className="button-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="button-primary" type="submit">
              {submitLabel}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
      {hint && <small className="form-hint">{hint}</small>}
    </label>
  );
}

export function DeleteButton({
  onConfirm,
  label = "Eliminar",
  confirmText = "¿Eliminar este registro de la demostración?",
}: {
  onConfirm: () => void;
  label?: string;
  confirmText?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button className="link-danger" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span className="confirm-inline">
      {confirmText}
      <button
        className="button-danger"
        onClick={() => {
          onConfirm();
          setArmed(false);
        }}
      >
        Sí, eliminar
      </button>
      <button className="button-secondary" onClick={() => setArmed(false)}>
        Cancelar
      </button>
    </span>
  );
}

export function CaseForm({ item }: { item?: DemoCase } = {}) {
  const { cases, createCase, updateCase } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => {
    const district = findDistrictByRegion(item?.region ?? "Piura · Paita");
    return {
      title: item?.title ?? "",
      region: item?.region ?? "Piura · Paita",
      districtUbigeo: district?.ubigeo ?? "",
      subject: item?.subject ?? "Pesca artesanal",
      risk: item?.risk ?? ("Moderado" as DemoCase["risk"]),
      estado: item?.estado ?? ("Activo" as NonNullable<DemoCase["estado"]>),
      summary: item?.summary ?? "",
      nivelConflicto:
        item?.nivelConflicto ??
        ("Diferencia" as NonNullable<DemoCase["nivelConflicto"]>),
      prioridad:
        item?.prioridad ?? ("Moderado" as NonNullable<DemoCase["prioridad"]>),
      alcance: item?.alcance ?? deriveGeographicScope(item?.region ?? "Piura"),
      tematica: item?.tematica ?? "Infraestructura",
      subsector:
        item?.subsector ??
        ("Pesca y Acuicultura" as NonNullable<DemoCase["subsector"]>),
      unidadResponsable: item?.unidadResponsable ?? "OAIPCS",
    };
  });
  const submit = () => {
    if (!form.title.trim())
      return setError("El nombre del caso es obligatorio.");
    if (!form.summary.trim())
      return setError("Registra al menos un resumen del riesgo.");
    const district = findDistrict(form.districtUbigeo);
    if (!isValidUbigeo(form.districtUbigeo) || !district)
      return setError(
        "Selecciona un distrito válido del catálogo UBIGEO (código de 6 dígitos).",
      );
    const region = regionLabelForDistrict(district);
    const duplicate = cases.some(
      (row) =>
        row.code !== item?.code &&
        normalizeText(row.title) === normalizeText(form.title) &&
        normalizeText(row.region) === normalizeText(region),
    );
    if (duplicate)
      return setError(
        "Ya existe un caso con el mismo título y distrito en la demostración. Revisa el listado antes de guardar.",
      );
    const payload = {
      title: form.title,
      region,
      subject: form.subject,
      risk: form.risk,
      stage: form.estado,
      estado: form.estado,
      summary: form.summary,
      nivelConflicto: form.nivelConflicto,
      prioridad: form.prioridad,
      alcance: deriveGeographicScope(region),
      tematica: form.tematica,
      subsector: form.subsector,
      unidadResponsable: form.unidadResponsable,
    };
    if (item) {
      updateCase(item.code, payload);
      setOpen(false);
      setError("");
      return;
    }
    createCase({ ...payload, origen: "Manual" });
    setOpen(false);
    setError("");
    setForm((prev) => ({
      ...prev,
      title: "",
      summary: "",
    }));
  };
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)}>
        {item ? (
          <>
            <Pencil size={14} />
            Editar caso
          </>
        ) : (
          <>
            <Plus size={15} />
            Nuevo caso
          </>
        )}
      </button>
      <FormDrawer
        open={open}
        title={item ? `Editar ${item.code}` : "Nuevo caso"}
        description={
          item
            ? "Los cambios del prototipo se guardan al confirmar."
            : "Alta manual en datos de demostración."
        }
        lockDismiss={Boolean(item)}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Crear caso"}
      >
        <Field label="Nombre del caso">
          <input
            className="form-input"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            placeholder="Ej.: Acceso a zona de desembarque"
          />
        </Field>
        <div className="form-grid">
          <Field
            label="Distrito (UBIGEO)"
            hint="Catálogo ilustrativo, no oficial. Se guarda como «Departamento · Distrito»."
          >
            <select
              className="form-select"
              value={form.districtUbigeo}
              onChange={(event) => {
                const district = findDistrict(event.target.value);
                if (!district) {
                  setForm({ ...form, districtUbigeo: "", region: "" });
                  return;
                }
                const region = regionLabelForDistrict(district);
                setForm({
                  ...form,
                  districtUbigeo: district.ubigeo,
                  region,
                  alcance: deriveGeographicScope(region),
                });
              }}
            >
              <option value="">Selecciona un distrito…</option>
              {ubigeoDepartments.map((department) => (
                <optgroup key={department} label={department}>
                  {ubigeoCatalog
                    .filter((district) => district.departamento === department)
                    .map((district) => (
                      <option key={district.ubigeo} value={district.ubigeo}>
                        {district.distrito} · {district.provincia} (
                        {district.ubigeo})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field
            label="Código UBIGEO"
            hint="Formato esperado: 6 dígitos. La validación es de demostración."
          >
            <input
              className="form-input"
              value={form.districtUbigeo}
              readOnly
              placeholder="000000"
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Región resultante"
            hint="Se deriva del distrito y mantiene el formato «Departamento · Distrito»."
          >
            <input className="form-input" value={form.region} readOnly />
          </Field>
          <Field label="Subsector">
            <select
              className="form-select"
              value={form.subsector}
              onChange={(event) => {
                const subsector = event.target.value as NonNullable<
                  DemoCase["subsector"]
                >;
                setForm({ ...form, subsector, subject: subsector });
              }}
            >
              {subsectors.map((subsector) => (
                <option key={subsector}>{subsector}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Nivel de conflictividad"
            hint="Grado de exteriorización pública de la discrepancia · guía 7.5.1"
          >
            <select
              className="form-select"
              value={form.nivelConflicto}
              onChange={(event) =>
                setForm({
                  ...form,
                  nivelConflicto: event.target.value as NonNullable<
                    DemoCase["nivelConflicto"]
                  >,
                })
              }
            >
              {conflictLevels.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Prioridad de atención"
            hint="Seguimiento según la matriz de conflictividad"
          >
            <select
              className="form-select"
              value={form.prioridad}
              onChange={(event) =>
                setForm({
                  ...form,
                  prioridad: event.target.value as NonNullable<
                    DemoCase["prioridad"]
                  >,
                })
              }
            >
              {priorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Alcance geográfico"
            hint="Autocompletado según la región"
          >
            <input className="form-input" value={form.alcance} readOnly />
          </Field>
          <Field label="Estado">
            <select
              className="form-select"
              value={form.estado}
              onChange={(event) =>
                setForm({
                  ...form,
                  estado: event.target.value as NonNullable<DemoCase["estado"]>,
                })
              }
            >
              <option>Activo</option>
              <option>En seguimiento</option>
              <option>Resuelto</option>
              <option>Archivado</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Unidad responsable">
            <input
              className="form-input"
              value={form.unidadResponsable}
              onChange={(event) =>
                setForm({ ...form, unidadResponsable: event.target.value })
              }
            />
          </Field>
          <Field label="Temática principal">
            <select
              className="form-select"
              value={form.tematica}
              onChange={(event) =>
                setForm({ ...form, tematica: event.target.value })
              }
            >
              {themes.map((theme) => (
                <option key={theme}>{theme}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Resumen del caso">
          <textarea
            className="form-textarea"
            value={form.summary}
            onChange={(event) =>
              setForm({ ...form, summary: event.target.value })
            }
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function AlertForm({
  caseCode,
  item,
}: {
  caseCode?: string;
  item?: DemoAlert;
}) {
  const { cases, createAlert, updateAlert } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    caseCode: item?.caseCode ?? caseCode ?? "",
    title: item?.title ?? "",
    location: item?.location ?? "",
    source: item?.source ?? "",
    published: item?.published ?? "19 nov · 10:24",
    priority: (item?.priority ?? "Alta") as NonNullable<
      "Crítica" | "Alta" | "Media"
    >,
    risk: item?.risk ?? ("Moderado" as NonNullable<DemoAlert["risk"]>),
    quote: item?.quote ?? "",
    note: item?.note ?? "",
    riesgos: item?.riesgos?.join(", ") ?? "",
    acciones: item?.acciones?.join(", ") ?? "",
  }));
  const sla =
    form.priority === "Crítica" ? 24 : form.priority === "Alta" ? 48 : 72;
  const submit = () => {
    if (!form.title.trim())
      return setError("El título de la alerta es obligatorio.");
    if (!form.quote.trim())
      return setError(
        "La cita textual es obligatoria: debe coincidir con la fuente (G20).",
      );
    const related = cases.find((row) => row.code === form.caseCode);
    const riesgos = form.riesgos
      ? form.riesgos
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    const acciones = form.acciones
      ? form.acciones
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    if (item) {
      updateAlert(item.id, {
        title: form.title,
        location: form.location || related?.region || item.location,
        source: form.source || item.source,
        published: form.published,
        priority: form.priority,
        risk: form.risk,
        quote: form.quote,
        note: form.note || item.note,
        caseCode: form.caseCode || undefined,
        slaHours: sla,
        riesgos,
        acciones,
      });
      setOpen(false);
      setError("");
      return;
    }
    createAlert({
      title: form.title,
      location: form.location || related?.region || "Sin región",
      source: form.source || "Registro manual",
      published: form.published,
      priority: form.priority,
      risk: form.risk,
      quote: form.quote,
      note:
        form.note ||
        "Registro manual del prototipo, pendiente de verificación.",
      caseCode: form.caseCode || undefined,
      slaHours: sla,
      origen: "Manual",
      riesgos,
      acciones,
    });
    setOpen(false);
    setError("");
    setForm((prev) => ({
      ...prev,
      title: "",
      quote: "",
      note: "",
      source: "",
      riesgos: "",
      acciones: "",
    }));
  };
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)}>
        {item ? <Pencil size={14} /> : <Plus size={15} />}
        {item ? "Editar alerta" : "Nueva alerta"}
      </button>
      <FormDrawer
        open={open}
        title={item ? `Editar ${item.id}` : "Nueva alerta temprana"}
        description={
          item
            ? "La cita textual sigue siendo obligatoria (G20). Solo «Cancelar» o «Guardar cambios» cierran esta edición."
            : "Prioridad con SLA y cita textual obligatoria."
        }
        lockDismiss={Boolean(item)}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Registrar alerta"}
      >
        <Field label="Caso vinculado">
          <select
            className="form-select"
            value={form.caseCode}
            onChange={(event) =>
              setForm({ ...form, caseCode: event.target.value })
            }
          >
            <option value="">Sin caso</option>
            {cases.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título">
          <input
            className="form-input"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Prioridad">
            <select
              className="form-select"
              value={form.priority}
              onChange={(event) =>
                setForm({
                  ...form,
                  priority: event.target.value as "Crítica" | "Alta" | "Media",
                })
              }
            >
              <option>Crítica</option>
              <option>Alta</option>
              <option>Media</option>
            </select>
          </Field>
          <Field
            label="Plazo máximo de atención"
            hint="Derivado de la prioridad (Anexo 3)"
          >
            <input className="form-input" value={`${sla} horas`} readOnly />
          </Field>
        </div>
        <Field
          label="Nivel de riesgo de la alerta"
          hint="Solo se refleja en el caso cuando la alerta se aprueba por revisión humana."
        >
          <select
            className="form-select"
            value={form.risk}
            onChange={(event) =>
              setForm({
                ...form,
                risk: event.target.value as NonNullable<DemoAlert["risk"]>,
              })
            }
          >
            <option>Alto</option>
            <option>Moderado</option>
            <option>Bajo</option>
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Región">
            <input
              className="form-input"
              value={form.location}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value })
              }
              placeholder="Heredado del caso si se deja vacío"
            />
          </Field>
          <Field label="Fuente autorizada">
            <input
              className="form-input"
              value={form.source}
              onChange={(event) =>
                setForm({ ...form, source: event.target.value })
              }
            />
          </Field>
        </div>
        <Field
          label="Cita textual"
          hint="Debe coincidir literalmente con el texto de la fuente."
        >
          <textarea
            className="form-textarea"
            value={form.quote}
            onChange={(event) =>
              setForm({ ...form, quote: event.target.value })
            }
          />
        </Field>
        <Field label="Nota de verificación">
          <textarea
            className="form-textarea"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Riesgos identificados">
            <input
              className="form-input"
              value={form.riesgos}
              onChange={(event) =>
                setForm({ ...form, riesgos: event.target.value })
              }
              placeholder="Separados por coma"
            />
          </Field>
          <Field label="Acciones sugeridas">
            <input
              className="form-input"
              value={form.acciones}
              onChange={(event) =>
                setForm({ ...form, acciones: event.target.value })
              }
              placeholder="Separadas por coma"
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function CommitmentForm({
  caseCode,
  item,
}: {
  caseCode?: string;
  item?: DemoCommitment;
}) {
  const {
    cases,
    commitments,
    documents,
    createCommitment,
    updateCommitment,
    addCommitmentEvidence,
  } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [nuevaEvidencia, setNuevaEvidencia] = useState("");
  const [evidenciasNuevas, setEvidenciasNuevas] = useState<string[]>([]);
  const live = item
    ? (commitments.find((row) => row.id === item.id) ?? item)
    : undefined;
  const [form, setForm] = useState(() => ({
    caseCode: item?.caseCode ?? caseCode ?? cases[0]?.code ?? "",
    title: item?.title ?? "",
    tipo: item?.tipo ?? ("Actividad" as NonNullable<DemoCommitment["tipo"]>),
    agreementType:
      item?.agreementType ??
      ("Progresivo o parcial" as NonNullable<DemoCommitment["agreementType"]>),
    clasificacion:
      item?.clasificacion ??
      ("Formal" as NonNullable<DemoCommitment["clasificacion"]>),
    owner: item?.owner ?? "",
    nivelGobierno:
      item?.nivelGobierno ??
      ("Nacional" as NonNullable<DemoCommitment["nivelGobierno"]>),
    due: toDateInputValue(item?.due),
    fechaInicio: toDateInputValue(item?.fechaInicio),
    atiendeGenero: item?.atiendeGenero ?? false,
    unidadResponsable: item?.unidadResponsable ?? "",
    documentoOrigenId: item?.documentoOrigenId ?? "",
    recordatorio: item?.recordatorios?.[0]?.toString() ?? "",
    paralizado: item?.status === "Paralizado",
    progress: item?.progress ?? 0,
  }));
  const caseDocuments = documents.filter(
    (doc) => doc.casoCode === form.caseCode,
  );
  const derivedStatus = deriveCommitmentStatus({
    progress: Number(form.progress) || 0,
    due: form.due || "Por definir",
    fechaInicio: form.fechaInicio || undefined,
    paralizado: form.paralizado,
  });
  const evidencias = [...(live?.evidencias ?? []), ...evidenciasNuevas];
  const addEvidenceDraft = () => {
    const name = nuevaEvidencia.trim();
    if (!name) return;
    setEvidenciasNuevas((prev) => [...prev, name]);
    setNuevaEvidencia("");
  };
  const submit = () => {
    if (!form.caseCode)
      return setError("Selecciona el caso al que pertenece el compromiso.");
    if (!form.title.trim())
      return setError("La acción del compromiso es obligatoria.");
    const progress = Math.max(0, Math.min(100, Number(form.progress) || 0));
    const status = deriveCommitmentStatus({
      progress,
      due: form.due || "Por definir",
      fechaInicio: form.fechaInicio || undefined,
      paralizado: form.paralizado,
    });
    const base = {
      title: form.title,
      caseCode: form.caseCode,
      owner: form.owner || "Por asignar",
      due: form.due || "Por definir",
      fechaInicio: form.fechaInicio || undefined,
      status,
      progress,
      agreementType: form.agreementType,
      tipo: form.tipo,
      nivelGobierno: form.nivelGobierno,
      atiendeGenero: form.atiendeGenero,
      unidadResponsable: form.unidadResponsable || undefined,
      documentoOrigenId: form.documentoOrigenId || undefined,
      clasificacion: form.clasificacion,
      recordatorios: form.recordatorio
        ? [Number(form.recordatorio)]
        : undefined,
    };
    if (item) {
      updateCommitment(item.id, base);
      evidenciasNuevas.forEach((name) => addCommitmentEvidence(item.id, name));
      setOpen(false);
      setError("");
      setEvidenciasNuevas([]);
      return;
    }
    const record = createCommitment({ ...base, origen: "Manual" });
    evidenciasNuevas.forEach((name) => addCommitmentEvidence(record.id, name));
    setOpen(false);
    setError("");
    setEvidenciasNuevas([]);
    setNuevaEvidencia("");
    setForm((prev) => ({
      ...prev,
      title: "",
      owner: "",
      due: "",
      fechaInicio: "",
    }));
  };
  return (
    <>
      <button
        className={item ? "table-link" : "button-secondary"}
        onClick={() => setOpen(true)}
      >
        {item ? (
          <>
            <Pencil size={13} />
            Editar
          </>
        ) : (
          <>
            <Plus size={15} />
            Nuevo compromiso
          </>
        )}
      </button>
      <FormDrawer
        open={open}
        title={item ? `Editar ${item.id}` : "Nuevo compromiso"}
        description={
          item
            ? "Edición explícita: solo «Cancelar» o «Guardar cambios» cierran el formulario. El estado se deriva de fechas y avance."
            : "Acción verificable con responsable, plazo, hitos y adjuntos."
        }
        lockDismiss={Boolean(item)}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Registrar compromiso"}
      >
        <Field label="Caso">
          <select
            className="form-select"
            value={form.caseCode}
            onChange={(event) =>
              setForm({ ...form, caseCode: event.target.value })
            }
          >
            {cases.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Acción comprometida">
          <textarea
            className="form-textarea"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Tipo">
            <select
              className="form-select"
              value={form.tipo}
              onChange={(event) =>
                setForm({
                  ...form,
                  tipo: event.target.value as NonNullable<
                    DemoCommitment["tipo"]
                  >,
                })
              }
            >
              <option>Actividad</option>
              <option>PIP</option>
            </select>
          </Field>
          <Field label="Nivel de gobierno">
            <select
              className="form-select"
              value={form.nivelGobierno}
              onChange={(event) =>
                setForm({
                  ...form,
                  nivelGobierno: event.target.value as NonNullable<
                    DemoCommitment["nivelGobierno"]
                  >,
                })
              }
            >
              <option>Nacional</option>
              <option value="Regional">GORE (gobierno regional)</option>
              <option>Local</option>
              <option>Empresa</option>
              <option>Sociedad Civil</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Tipo de acuerdo"
            hint="Clasificación del acuerdo según la guía"
          >
            <select
              className="form-select"
              value={form.agreementType}
              onChange={(event) =>
                setForm({
                  ...form,
                  agreementType: event.target.value as NonNullable<
                    DemoCommitment["agreementType"]
                  >,
                })
              }
            >
              <option>Progresivo o parcial</option>
              <option>Entendimiento operativo</option>
              <option>Condicionado</option>
            </select>
          </Field>
          <Field
            label="Clasificación formal / verbal"
            hint="Formal consta en acta o documento; verbal solo en el registro de la reunión."
          >
            <select
              className="form-select"
              value={form.clasificacion}
              onChange={(event) =>
                setForm({
                  ...form,
                  clasificacion: event.target.value as NonNullable<
                    DemoCommitment["clasificacion"]
                  >,
                })
              }
            >
              <option>Formal</option>
              <option>Verbal</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Fecha de inicio"
            hint="Opcional. Se usa junto con el vencimiento para calcular el plazo."
          >
            <input
              className="form-input"
              type="date"
              value={form.fechaInicio}
              onChange={(event) =>
                setForm({ ...form, fechaInicio: event.target.value })
              }
            />
          </Field>
          <Field
            label="Vencimiento"
            hint="Si se deja vacío se registra «Por definir»; una fecha no interpretable se muestra como sin fecha."
          >
            <input
              className="form-input"
              type="date"
              value={form.due}
              onChange={(event) =>
                setForm({ ...form, due: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Responsable / unidad">
            <input
              className="form-input"
              value={form.owner}
              onChange={(event) =>
                setForm({ ...form, owner: event.target.value })
              }
            />
          </Field>
          <Field label="Unidad responsable">
            <input
              className="form-input"
              value={form.unidadResponsable}
              onChange={(event) =>
                setForm({ ...form, unidadResponsable: event.target.value })
              }
              placeholder="Oficina o dirección a cargo"
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Documento de origen"
            hint="Solo se listan documentos vinculados al caso seleccionado."
          >
            <select
              className="form-select"
              value={form.documentoOrigenId}
              onChange={(event) =>
                setForm({ ...form, documentoOrigenId: event.target.value })
              }
            >
              <option value="">Sin documento vinculado</option>
              {caseDocuments.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.codigo} · {doc.titulo}
                </option>
              ))}
              {item?.documentoOrigenId &&
                !caseDocuments.some(
                  (doc) => doc.id === item.documentoOrigenId,
                ) && (
                  <option value={item.documentoOrigenId}>
                    {item.documentoOrigenId} (no listado en el caso)
                  </option>
                )}
            </select>
          </Field>
          <Field
            label="Recordatorio"
            hint="Días antes del vencimiento. Configuración de demostración."
          >
            <select
              className="form-select"
              value={form.recordatorio}
              onChange={(event) =>
                setForm({ ...form, recordatorio: event.target.value })
              }
            >
              <option value="">Sin recordatorio</option>
              <option value="7">7 días antes</option>
              <option value="3">3 días antes</option>
              <option value="1">1 día antes</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Avance (%)">
            <input
              className="form-input"
              type="number"
              min="0"
              max="100"
              value={form.progress}
              onChange={(event) =>
                setForm({ ...form, progress: Number(event.target.value) })
              }
            />
          </Field>
          <Field
            label="Estado derivado"
            hint="Se calcula con el avance y las fechas; no se pide como texto libre."
          >
            <input className="form-input" value={derivedStatus} readOnly />
          </Field>
        </div>
        <Field
          label="Anulación de gestión"
          hint="«Paralizado» es un estado de gestión y no significa que el plazo esté vencido. El vencimiento se calcula aparte."
        >
          <select
            className="form-select"
            value={form.paralizado ? "Paralizado" : "Automático"}
            onChange={(event) =>
              setForm({
                ...form,
                paralizado: event.target.value === "Paralizado",
              })
            }
          >
            <option value="Automático">Automático ({derivedStatus})</option>
            <option value="Paralizado">Paralizado (solo gestión)</option>
          </select>
        </Field>
        <div className="evidence-editor">
          <span className="micro-label">Evidencias adjuntas</span>
          {evidencias.length ? (
            <div className="evidence-chips">
              {evidencias.map((name, index) => {
                const label = typeof name === "string" ? name : name.nombre;
                return (
                  <span key={`${label}-${index}`} className="evidence-chip">
                    {label}
                  </span>
                );
              })}
            </div>
          ) : (
            <small className="form-hint">
              Sin adjuntos. La evidencia ya no se guarda como texto libre.
            </small>
          )}
          {live?.evidenciaUri && (
            <Field
              label="Evidencia heredada (URI)"
              hint="Se conserva como referencia; no se edita en este formulario."
            >
              <input
                className="form-input"
                value={live.evidenciaUri}
                readOnly
              />
            </Field>
          )}
          <div className="inline-form">
            <input
              className="form-input"
              aria-label="Nombre de la evidencia"
              value={nuevaEvidencia}
              onChange={(event) => setNuevaEvidencia(event.target.value)}
              placeholder="Nombre del archivo simulado"
            />
            <button
              type="button"
              className="button-secondary"
              onClick={addEvidenceDraft}
            >
              Añadir adjunto
            </button>
          </div>
        </div>
        <Field label="Atiende brecha de género">
          <select
            className="form-select"
            value={form.atiendeGenero ? "Sí" : "No"}
            onChange={(event) =>
              setForm({ ...form, atiendeGenero: event.target.value === "Sí" })
            }
          >
            <option>No</option>
            <option>Sí</option>
          </select>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

type FuenteDraft = { documentoId: string; fragmentoId: string };

function DemandaFuentePicker({
  field,
  label,
  documents,
  value,
  onChange,
}: {
  field: ThreePField;
  label: string;
  documents: DemoDocument[];
  value: FuenteDraft;
  onChange: (patch: Partial<FuenteDraft>) => void;
}) {
  return (
    <div className="fuente-field">
      <span className="micro-label">Fuente de {label}</span>
      <div className="form-grid">
        <Field
          label={`Documento (${label})`}
          hint="Solo documentos vinculados a este caso."
        >
          <select
            className="form-select"
            value={value.documentoId}
            onChange={(event) => onChange({ documentoId: event.target.value })}
          >
            <option value="">Sin fuente registrada</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.codigo} · {doc.titulo}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={`Fragmento (${label})`}
          hint="Opcional: id del fragmento, p. ej. DOC-2026-021-F1."
        >
          <input
            className="form-input"
            value={value.fragmentoId}
            onChange={(event) => onChange({ fragmentoId: event.target.value })}
            placeholder={field === "problema" ? "DOC-…-F1" : "Opcional"}
          />
        </Field>
      </div>
    </div>
  );
}

export function DemandaForm({
  caseCode,
  item,
  index,
}: {
  caseCode: string;
  item?: DemoDemanda;
  index?: number;
}) {
  const { addDemanda, updateDemanda, documents } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const caseDocuments = documents.filter((doc) => doc.casoCode === caseCode);
  const initialFuente = (campo: ThreePField): FuenteDraft => {
    const source = item?.fuentes?.find((row) => row.campo === campo);
    return {
      documentoId: source?.documentoId ?? "",
      fragmentoId: source?.fragmentoId ?? "",
    };
  };
  const [form, setForm] = useState(() => ({
    problema: item?.problema ?? "",
    propuesta: item?.propuesta ?? "",
    pedido: item?.pedido ?? "",
    estado: item?.estado ?? ("Pendiente" as DemoDemanda["estado"]),
  }));
  const [fuentes, setFuentes] = useState<Record<ThreePField, FuenteDraft>>(
    () => ({
      problema: initialFuente("problema"),
      propuesta: initialFuente("propuesta"),
      pedido: initialFuente("pedido"),
    }),
  );
  const setFuente = (campo: ThreePField, patch: Partial<FuenteDraft>) =>
    setFuentes((prev) => ({
      ...prev,
      [campo]: { ...prev[campo], ...patch },
    }));
  const submit = () => {
    if (!form.problema.trim())
      return setError("El problema es obligatorio en la estructura 3P.");
    if (!form.pedido.trim())
      return setError("El pedido es obligatorio en la estructura 3P.");
    const fuentesRegistradas: DemandaFuente[] = threePFields.flatMap(
      (campo) => {
        const { documentoId, fragmentoId } = fuentes[campo];
        if (!documentoId) return [];
        const doc = caseDocuments.find((row) => row.id === documentoId);
        return [
          {
            campo,
            documentoId,
            documentoCodigo: doc?.codigo,
            fragmentoId: fragmentoId.trim() || undefined,
          },
        ];
      },
    );
    const draft = {
      problema: form.problema,
      propuesta: form.propuesta.trim() || undefined,
      pedido: form.pedido,
      estado: form.estado,
      fuentes: fuentesRegistradas.length ? fuentesRegistradas : undefined,
    };
    if (item && typeof index === "number") {
      updateDemanda(caseCode, index, draft);
    } else {
      addDemanda(caseCode, draft);
    }
    setOpen(false);
    setError("");
  };
  return (
    <>
      <button
        className={item ? "table-link" : "button-secondary"}
        onClick={() => setOpen(true)}
      >
        {item ? (
          <>
            <Pencil size={13} /> Editar
          </>
        ) : (
          <>
            <Plus size={15} /> Nueva demanda
          </>
        )}
      </button>
      <FormDrawer
        open={open}
        title={item ? "Editar demanda" : "Nueva demanda"}
        description={
          item
            ? "Edición explícita: solo «Cancelar» o «Guardar cambios» cierran el formulario."
            : "Estructura 3P con vínculo opcional al documento y fragmento de origen."
        }
        lockDismiss={Boolean(item)}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Registrar demanda"}
      >
        <Field
          label="Problema"
          hint="Estructura 3P · Anexo 1. Describe la situación sin atribuir intenciones."
        >
          <textarea
            className="form-textarea"
            value={form.problema}
            onChange={(event) =>
              setForm({ ...form, problema: event.target.value })
            }
          />
        </Field>
        <DemandaFuentePicker
          field="problema"
          label="problema"
          documents={caseDocuments}
          value={fuentes.problema}
          onChange={(patch) => setFuente("problema", patch)}
        />
        <Field
          label="Propuesta"
          hint="Opcional: qué se propone para encauzar el problema."
        >
          <textarea
            className="form-textarea"
            value={form.propuesta}
            onChange={(event) =>
              setForm({ ...form, propuesta: event.target.value })
            }
          />
        </Field>
        <DemandaFuentePicker
          field="propuesta"
          label="propuesta"
          documents={caseDocuments}
          value={fuentes.propuesta}
          onChange={(patch) => setFuente("propuesta", patch)}
        />
        <Field label="Pedido" hint="Qué se solicita concretamente y a quién.">
          <textarea
            className="form-textarea"
            value={form.pedido}
            onChange={(event) =>
              setForm({ ...form, pedido: event.target.value })
            }
          />
        </Field>
        <DemandaFuentePicker
          field="pedido"
          label="pedido"
          documents={caseDocuments}
          value={fuentes.pedido}
          onChange={(patch) => setFuente("pedido", patch)}
        />
        <Field label="Estado de atención">
          <select
            className="form-select"
            value={form.estado}
            onChange={(event) =>
              setForm({
                ...form,
                estado: event.target.value as DemoDemanda["estado"],
              })
            }
          >
            <option>Pendiente</option>
            <option>En proceso</option>
            <option>Atendida</option>
            <option>Desestimada</option>
          </select>
        </Field>
        <p className="form-hint">
          Las demandas de demostración no tienen fuente trazada. Si no eliges
          documento, se guarda sin fuente y no se inventa trazabilidad.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function CaseEventForm({ caseCode }: { caseCode: string }) {
  const { addCaseEvent } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    actor: "",
    date: "",
    evidencia: "",
  });
  const submit = () => {
    if (!form.title.trim())
      return setError("El título del hecho es obligatorio.");
    if (!form.description.trim())
      return setError("Describe el hecho registrado.");
    addCaseEvent(caseCode, {
      title: form.title,
      description: form.description,
      actor: form.actor.trim() || undefined,
      date: form.date || undefined,
      evidencia: form.evidencia.trim() || undefined,
    });
    setOpen(false);
    setError("");
    setForm({ title: "", description: "", actor: "", date: "", evidencia: "" });
  };
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> Registrar hecho
      </button>
      <FormDrawer
        open={open}
        title="Registrar hecho"
        description="El hecho se guarda como pendiente: la validación humana es una acción explícita."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel="Registrar hecho"
      >
        <Field label="Título del hecho">
          <input
            className="form-input"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </Field>
        <Field label="Descripción">
          <textarea
            className="form-textarea"
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Actor">
            <input
              className="form-input"
              value={form.actor}
              onChange={(event) =>
                setForm({ ...form, actor: event.target.value })
              }
              placeholder="Alias o denominación institucional"
            />
          </Field>
          <Field
            label="Fecha"
            hint="Si se deja vacío se registra como «Hoy · ahora»."
          >
            <input
              className="form-input"
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm({ ...form, date: event.target.value })
              }
            />
          </Field>
        </div>
        <Field
          label="Evidencia"
          hint="Texto o referencia del medio de verificación. No se valida automáticamente."
        >
          <textarea
            className="form-textarea"
            value={form.evidencia}
            onChange={(event) =>
              setForm({ ...form, evidencia: event.target.value })
            }
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function DocumentUploadForm({ caseCode }: { caseCode?: string } = {}) {
  const { addDocument, cases } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    kind: "relatoria" as DocKind,
    titulo: "",
    fecha: "2026-11-19",
    archivo: "",
    origen: "Ingesta" as NonNullable<"Manual" | "Ingesta">,
    casoCode: caseCode ?? "",
    texto: "",
  });
  const submit = () => {
    if (!form.titulo.trim())
      return setError("El título del documento es obligatorio.");
    if (!form.archivo && !form.texto.trim())
      return setError("Adjunta un archivo o pega el texto a analizar.");
    addDocument({
      kind: form.kind,
      titulo: form.titulo,
      fecha: form.fecha,
      archivo: form.archivo || `${form.kind}.txt`,
      origen: form.origen,
      casoCode: form.casoCode || undefined,
      texto: form.texto,
    });
    setOpen(false);
    setError("");
    setForm((prev) => ({ ...prev, titulo: "", archivo: "", texto: "" }));
  };
  return (
    <>
      <button className="button-primary" onClick={() => setOpen(true)}>
        <Upload size={15} />
        Cargar documento
      </button>
      <FormDrawer
        open={open}
        title="Cargar documento"
        description="Relatoría, entrevista, informe, acta o dato externo. La extracción se revisa después."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel="Cargar y encolar"
      >
        <Field label="Tipo de documento">
          <select
            className="form-select"
            value={form.kind}
            onChange={(event) =>
              setForm({ ...form, kind: event.target.value as DocKind })
            }
          >
            {(Object.keys(docKindLabels) as DocKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {docKindLabels[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título">
          <input
            className="form-input"
            value={form.titulo}
            onChange={(event) =>
              setForm({ ...form, titulo: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Fecha del documento">
            <input
              className="form-input"
              type="date"
              value={form.fecha}
              onChange={(event) =>
                setForm({ ...form, fecha: event.target.value })
              }
            />
          </Field>
          <Field label="Caso vinculado">
            <select
              className="form-select"
              value={form.casoCode}
              onChange={(event) =>
                setForm({ ...form, casoCode: event.target.value })
              }
            >
              <option value="">Sin caso</option>
              {cases.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Archivo"
          hint="En el prototipo se registra el nombre; no se sube contenido real."
        >
          <input
            className="form-input"
            type="file"
            onChange={(event) =>
              setForm({ ...form, archivo: event.target.files?.[0]?.name ?? "" })
            }
          />
        </Field>
        <Field
          label="Texto para analizar"
          hint="Pega la transcripción o el extracto. Alimenta la extracción de demostración."
        >
          <textarea
            className="form-textarea"
            value={form.texto}
            onChange={(event) =>
              setForm({ ...form, texto: event.target.value })
            }
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}
