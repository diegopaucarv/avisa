"use client";

import { useState } from "react";
import { Check, FileStack, RotateCcw, Search, Sparkles, X } from "lucide-react";
import {
  docKindLabels,
  type DemoDocument,
  type FragmentKind,
} from "./avisa-demo-data";
import { DeleteButton, DocumentUploadForm } from "./avisa-crud";
import { useAvisa } from "@/lib/avisa-store";
import { isTerritoryVisible, type RegionScope } from "./avisa-scope-filter";

const fragmentLabel: Record<FragmentKind, string> = {
  hecho: "Hecho verificable",
  cita: "Cita textual",
  demanda: "Demanda",
  acuerdo: "Acuerdo",
  riesgo: "Riesgo",
};

const extractionLabel: Record<
  DemoDocument["extracciones"][number]["tipo"],
  string
> = {
  alerta: "Alerta temprana",
  compromiso: "Compromiso",
  hecho: "Hecho",
  demanda: "Demanda 3P",
  actor: "Actor",
};

const extractionChip = (tipo: DemoDocument["extracciones"][number]["tipo"]) =>
  tipo === "compromiso"
    ? "acuerdo"
    : tipo === "hecho"
      ? "hecho"
      : tipo === "alerta"
        ? "riesgo"
        : "demanda";

const documentStateClass = (estado: DemoDocument["estado"]) =>
  estado === "Validado"
    ? "state-approved"
    : estado === "Rechazado"
      ? "state-dismissed"
      : "state-pending";

export function AvisaDocuments({
  regionScope,
  assignedRegions,
  unrestricted,
}: {
  regionScope: RegionScope;
  assignedRegions: RegionScope[];
  unrestricted: boolean;
}) {
  const { documents, cases, simulateExtraction } = useAvisa();
  const [query, setQuery] = useState("");
  const [estado, setEstado] = useState("Todos");
  const [tipo, setTipo] = useState("Todos");
  const [selectedId, setSelectedId] = useState("");

  const inScope = (doc: DemoDocument) => {
    if (unrestricted && regionScope === "Todo el Perú") return true;
    const related = cases.find((item) => item.code === doc.casoCode);
    return related
      ? isTerritoryVisible(
          related.region,
          regionScope,
          assignedRegions,
          unrestricted,
        )
      : unrestricted;
  };

  const filtered = documents
    .filter(inScope)
    .filter((doc) =>
      `${doc.codigo} ${doc.titulo} ${doc.casoCode ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter((doc) => estado === "Todos" || doc.estado === estado)
    .filter((doc) => tipo === "Todos" || doc.kind === tipo);
  const selected = filtered.find((doc) => doc.id === selectedId) ?? filtered[0];

  return (
    <>
      <div className="section-title-row">
        <div>
          <h2>Documentos y evidencia</h2>
          <p>
            Carga, extracción asistida y validación humana de la fuente
            original.
          </p>
        </div>
        <DocumentUploadForm />
      </div>
      <p className="doc-evidence-note">
        <FileStack size={14} />
        <span>
          <strong>Los documentos son evidencia del caso.</strong> Las
          referencias normativas se consultan en el caso, aparte de este flujo,
          y no se validan con la extracción documental.
        </span>
      </p>
      <div className="filter-bar filter-bar-wrap">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Buscar documentos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por código, título o caso"
          />
        </label>
        <label className="select-filter">
          Estado{" "}
          <select
            aria-label="Filtrar documentos por estado"
            value={estado}
            onChange={(event) => setEstado(event.target.value)}
          >
            <option>Todos</option>
            <option>Cargado</option>
            <option>En análisis</option>
            <option>Extraído</option>
            <option>Validado</option>
            <option>Rechazado</option>
          </select>
        </label>
        <label className="select-filter">
          Tipo{" "}
          <select
            aria-label="Filtrar documentos por tipo"
            value={tipo}
            onChange={(event) => setTipo(event.target.value)}
          >
            <option>Todos</option>
            <option value="relatoria">Relatoría</option>
            <option value="entrevista">Entrevista</option>
            <option value="informe">Informe / reporte</option>
            <option value="acta">Acta de acuerdo</option>
            <option value="dato_externo">Dato externo</option>
          </select>
        </label>
        <span className="result-count">{filtered.length} documentos</span>
      </div>
      <div className="doc-layout">
        <div className="table-wrap">
          <table className="data-table">
            <caption className="table-caption">
              Documentos de demostración · {filtered.length} resultados ·
              selecciona una fila para revisar la evidencia.
            </caption>
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Tipo</th>
                <th scope="col">Caso</th>
                <th scope="col">Fecha</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr
                  key={doc.id}
                  className={selected?.id === doc.id ? "row-selected" : ""}
                  onClick={() => setSelectedId(doc.id)}
                >
                  <td>
                    <button
                      type="button"
                      className="table-link"
                      aria-label={`Revisar el documento ${doc.codigo}: ${doc.titulo}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedId(doc.id);
                      }}
                    >
                      {doc.titulo}
                    </button>
                    <small>
                      {doc.codigo} · {doc.archivo}
                    </small>
                  </td>
                  <td>{docKindLabels[doc.kind]}</td>
                  <td>{doc.casoCode ?? "—"}</td>
                  <td>{doc.fecha}</td>
                  <td>
                    <span
                      className={`alert-state ${documentStateClass(doc.estado)}`}
                    >
                      <span className="status-dot" />
                      {doc.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty-state">
              No hay documentos para este filtro.
            </div>
          )}
        </div>
        {selected ? (
          <DocumentReview doc={selected} onExtract={simulateExtraction} />
        ) : (
          <div className="surface empty-state">
            Carga un documento para comenzar.
          </div>
        )}
      </div>
    </>
  );
}

function DocumentReview({
  doc,
  onExtract,
}: {
  doc: DemoDocument;
  onExtract: (id: string) => void;
}) {
  const {
    validateDocument,
    rejectDocument,
    reextractDocument,
    validateFragment,
    acceptExtraction,
    rejectExtraction,
    deleteDocument,
  } = useAvisa();
  const [confirmValidate, setConfirmValidate] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [openVersion, setOpenVersion] = useState<number | null>(null);

  const canExtract = doc.estado === "Cargado" || doc.estado === "En análisis";
  const canValidate = doc.estado !== "Validado" && doc.estado !== "Rechazado";
  const validatedFragments = doc.fragmentos.filter(
    (fragmento) => fragmento.validado,
  ).length;
  const titleId = `doc-review-${doc.id}`;

  return (
    <section className="surface detail-section" aria-labelledby={titleId}>
      <div className="detail-section-title">
        <div>
          <p className="section-eyebrow">
            {docKindLabels[doc.kind].toLocaleUpperCase("es")} ·{" "}
            {doc.origen.toLocaleUpperCase("es")}
          </p>
          <h3 id={titleId}>{doc.titulo}</h3>
          <p>
            {doc.codigo} · {doc.fecha} · {doc.archivo}
          </p>
        </div>
        <span className={`alert-state ${documentStateClass(doc.estado)}`}>
          <span className="status-dot" />
          {doc.estado}
        </span>
      </div>
      {doc.casoCode && (
        <p className="privacy-caption">
          <FileStack size={13} /> Vinculado a {doc.casoCode}
        </p>
      )}
      {doc.confianza !== undefined && (
        <p className="quote-note">
          Confianza del extractor: {(doc.confianza * 100).toFixed(0)}% · no
          equivale a validación humana.
        </p>
      )}
      {doc.rechazoMotivo && (
        <div className="review-note">
          <strong>Motivo de rechazo registrado:</strong> {doc.rechazoMotivo}
        </div>
      )}
      <div className="review-actions document-actions">
        {canExtract && (
          <button
            type="button"
            className="button-primary"
            onClick={() => onExtract(doc.id)}
          >
            <Sparkles size={15} />
            Ejecutar extracción
          </button>
        )}
        <button
          type="button"
          className="button-secondary"
          onClick={() => reextractDocument(doc.id)}
        >
          <RotateCcw size={15} />
          Relanzar extracción
        </button>
        {canValidate &&
          (confirmValidate ? (
            <span className="confirm-inline">
              ¿Validar el documento y sus fragmentos como evidencia?
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  validateDocument(doc.id);
                  setConfirmValidate(false);
                }}
              >
                Sí, validar
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setConfirmValidate(false)}
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="button-primary"
              onClick={() => setConfirmValidate(true)}
            >
              <Check size={15} />
              Validar documento
            </button>
          ))}
        {doc.estado !== "Rechazado" &&
          (showReject ? (
            <div className="archive-form">
              <label htmlFor={`reject-${doc.id}`}>
                Motivo de rechazo (obligatorio)
              </label>
              <input
                id={`reject-${doc.id}`}
                className="form-input"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Ej.: archivo ilegible o fuente no trazable"
              />
              <button
                type="button"
                className="button-danger"
                disabled={!rejectReason.trim()}
                onClick={() => {
                  rejectDocument(doc.id, rejectReason);
                  setRejectReason("");
                  setShowReject(false);
                }}
              >
                Confirmar rechazo
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason("");
                }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setShowReject(true)}
            >
              <X size={15} />
              Rechazar documento
            </button>
          ))}
        <DeleteButton onConfirm={() => deleteDocument(doc.id)} />
      </div>
      <div className="fragment-head">
        <h4 className="micro-label">FRAGMENTOS</h4>
        <span className="fragment-counter" aria-live="polite">
          {validatedFragments} de {doc.fragmentos.length} fragmentos validados
        </span>
      </div>
      {doc.fragmentos.length === 0 ? (
        <div className="empty-state">
          Sin fragmentos: ejecuta la extracción.
        </div>
      ) : (
        <div className="fragment-list">
          {doc.fragmentos.map((fragmento) => (
            <div className="fragment" key={fragmento.id}>
              <span className={`chip chip-${fragmento.tipo}`}>
                {fragmentLabel[fragmento.tipo]}
              </span>
              <p>{fragmento.texto}</p>
              <small>
                {fragmento.validado
                  ? "Validado por persona"
                  : "Pendiente de validación"}
              </small>
              <div className="fragment-actions">
                <button
                  type="button"
                  className="link-button"
                  aria-pressed={fragmento.validado}
                  onClick={() =>
                    validateFragment(doc.id, fragmento.id, !fragmento.validado)
                  }
                >
                  {fragmento.validado
                    ? "Quitar validación"
                    : "Validar fragmento"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <h4 className="micro-label">PROPUESTAS DEL EXTRACTOR</h4>
      {doc.extracciones.length === 0 ? (
        <div className="empty-state">Sin propuestas todavía.</div>
      ) : (
        <div className="extraction-list">
          {doc.extracciones.map((extraction) => (
            <div
              key={extraction.id}
              className={`extraction extraction-${extraction.estado.toLowerCase()}`}
            >
              <div>
                <span
                  className={`chip chip-${extractionChip(extraction.tipo)}`}
                >
                  {extractionLabel[extraction.tipo]}
                </span>
                <strong>{extraction.titulo}</strong>
                <p>{extraction.detalle}</p>
                <small>{extraction.estado}</small>
              </div>
              {extraction.estado === "Propuesta" && (
                <div className="extraction-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => acceptExtraction(doc.id, extraction.id)}
                  >
                    <Check size={14} />
                    Aceptar
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => rejectExtraction(doc.id, extraction.id)}
                  >
                    <X size={14} />
                    Descartar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {doc.versiones?.length ? (
        <section className="document-versions">
          <h4 className="micro-label">VERSIONES ANTERIORES</h4>
          <ul className="version-list">
            {doc.versiones.map((version) => (
              <li key={version.n}>
                <button
                  type="button"
                  className="version-toggle"
                  aria-expanded={openVersion === version.n}
                  onClick={() =>
                    setOpenVersion(openVersion === version.n ? null : version.n)
                  }
                >
                  <span>
                    Versión {version.n} · {version.fecha} ·{" "}
                    {version.fragmentos.length} fragmentos
                  </span>
                  <span aria-hidden="true">
                    {openVersion === version.n ? "Ocultar" : "Ver"}
                  </span>
                </button>
                {openVersion === version.n && (
                  <div className="version-fragments">
                    {version.fragmentos.length === 0 ? (
                      <p className="form-hint">
                        Esta versión no tenía fragmentos extraídos.
                      </p>
                    ) : (
                      version.fragmentos.map((fragmento) => (
                        <div
                          className="fragment fragment-readonly"
                          key={fragmento.id}
                        >
                          <span className={`chip chip-${fragmento.tipo}`}>
                            {fragmentLabel[fragmento.tipo]}
                          </span>
                          <p>{fragmento.texto}</p>
                          <small>
                            {fragmento.validado
                              ? "Validado en esa versión"
                              : "Sin validación en esa versión"}{" "}
                            · lectura de solo consulta
                          </small>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
