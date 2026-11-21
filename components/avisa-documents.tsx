"use client";

import { useState } from "react";
import { Check, FileStack, Search, Sparkles, X } from "lucide-react";
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

export function AvisaDocuments({ regionScope, assignedRegions, unrestricted }: { regionScope: RegionScope; assignedRegions: RegionScope[]; unrestricted: boolean }) {
  const {
    documents,
    cases,
    simulateExtraction,
    validateDocument,
    acceptExtraction,
    rejectExtraction,
    deleteDocument,
  } = useAvisa();
  const [query, setQuery] = useState("");
  const [estado, setEstado] = useState("Todos");
  const [tipo, setTipo] = useState("Todos");
  const [selectedId, setSelectedId] = useState("");

  const inScope = (doc: DemoDocument) => {
    if (unrestricted && regionScope === "Todo el Perú") return true;
    const related = cases.find((item) => item.code === doc.casoCode);
    return related ? isTerritoryVisible(related.region, regionScope, assignedRegions, unrestricted) : unrestricted;
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
      <div className="demo-notice" role="status">
        <Sparkles size={15} />
        <span>
          <strong>Extracción de demostración</strong> — el extractor es
          heurístico y no usa un modelo real. Toda propuesta requiere revisión
          de una persona.
        </span>
      </div>
      <div className="filter-bar">
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
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Caso</th>
                <th>Fecha</th>
                <th>Estado</th>
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
                    <strong>{doc.titulo}</strong>
                    <small>
                      {doc.codigo} · {doc.archivo}
                    </small>
                  </td>
                  <td>{docKindLabels[doc.kind]}</td>
                  <td>{doc.casoCode ?? "—"}</td>
                  <td>{doc.fecha}</td>
                  <td>
                    <span
                      className={`commit-status commit-${doc.estado.toLowerCase().replace(" ", "-")}`}
                    >
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
          <DocumentReview
            doc={selected}
            onExtract={simulateExtraction}
            onValidate={validateDocument}
            onAccept={acceptExtraction}
            onReject={rejectExtraction}
            onDelete={deleteDocument}
          />
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
  onValidate,
  onAccept,
  onReject,
  onDelete,
}: {
  doc: DemoDocument;
  onExtract: (id: string) => void;
  onValidate: (id: string) => void;
  onAccept: (documentId: string, extractionId: string) => void;
  onReject: (documentId: string, extractionId: string) => void;
  onDelete: (id: string) => void;
}) {
  const canExtract = doc.estado === "Cargado" || doc.estado === "En análisis";
  const canValidate = doc.estado === "Extraído";
  return (
    <section className="surface detail-section">
      <div className="detail-section-title">
        <div>
          <p className="section-eyebrow">
            {docKindLabels[doc.kind].toLocaleUpperCase("es")} ·{" "}
            {doc.origen.toLocaleUpperCase("es")}
          </p>
          <h3>{doc.titulo}</h3>
          <p>
            {doc.codigo} · {doc.fecha} · {doc.archivo}
          </p>
        </div>
        <span
          className={`alert-state ${doc.estado === "Validado" ? "state-approved" : "state-pending"}`}
        >
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
      <div className="review-actions">
        {canExtract && (
          <button className="button-primary" onClick={() => onExtract(doc.id)}>
            <Sparkles size={15} />
            Ejecutar extracción
          </button>
        )}
        {canValidate && (
          <button className="button-primary" onClick={() => onValidate(doc.id)}>
            <Check size={15} />
            Validar documento
          </button>
        )}
        <DeleteButton onConfirm={() => onDelete(doc.id)} />
      </div>
      <h4 className="micro-label">FRAGMENTOS</h4>
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
                    className="button-secondary"
                    onClick={() => onAccept(doc.id, extraction.id)}
                  >
                    <Check size={14} />
                    Aceptar
                  </button>
                  <button
                    className="button-secondary"
                    onClick={() => onReject(doc.id, extraction.id)}
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
    </section>
  );
}
