import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import type {
  IssueCategory,
  IssueConfig,
  IssueImportResult,
  Member,
  Project,
} from "../shared/contracts";
import { issueCategories, issueCategoryLabels } from "../shared/contracts";
import { api } from "./api";
import { Button, ErrorMessage, Modal } from "./components";
import {
  buildImport,
  distinct,
  distinctModules,
  guessCategory,
  importFields,
  splitLabels,
  splitPeople,
  suggestColumns,
  suggestMember,
  suggestStatus,
  suggestTag,
  toSheet,
  type ColumnMapping,
  type ImportDecisions,
  type Sheet,
  type TagDecision,
} from "./importSheet";

const maxRows = 1000;
/** CSV exported by Excel may be Windows-1252; UTF-8 is tried first. */
function decodeText(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}
async function readSpreadsheet(file: File): Promise<Sheet> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    const { default: Papa } = await import("papaparse");
    const parsed = Papa.parse<string[]>(decodeText(await file.arrayBuffer()), {
      skipEmptyLines: "greedy",
    });
    return toSheet(parsed.data);
  }
  if (extension === "xlsx") {
    const { readSheet } = await import("read-excel-file/browser");
    return toSheet((await readSheet(file)) as unknown[][]);
  }
  throw new Error("Escolha um ficheiro .xlsx ou .csv.");
}

type Step = "file" | "associate" | "review" | "done";
export function IssueImport({
  project,
  config,
  members,
  onClose,
  onImported,
}: {
  project: Project;
  config: IssueConfig;
  members: Member[];
  onClose(): void;
  onImported(): void;
}) {
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<Sheet>();
  const [mapping, setMapping] = useState<ColumnMapping>();
  const [decisions, setDecisions] = useState<ImportDecisions>({
    people: {},
    statuses: {},
    modules: {},
    labels: {},
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IssueImportResult>();
  // One key per wizard: retrying the same import never duplicates issues.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const values = useMemo(() => {
    if (!sheet || !mapping) return null;
    const people = distinct(sheet, mapping.reporter, splitPeople);
    for (const [key, value] of distinct(sheet, mapping.assignees, splitPeople))
      if (!people.has(key)) people.set(key, value);
    return {
      people,
      statuses: distinct(sheet, mapping.status),
      modules: distinctModules(sheet, mapping),
      labels: distinct(sheet, mapping.labels, splitLabels),
    };
  }, [sheet, mapping]);
  /** Suggestions for every value the user has not decided yet. */
  const effective = useMemo<ImportDecisions>(() => {
    const result: ImportDecisions = {
      people: {},
      statuses: {},
      modules: {},
      labels: {},
    };
    if (!values) return result;
    for (const [key, { name }] of values.people)
      result.people[key] =
        decisions.people[key] ?? suggestMember(name, members);
    for (const [key, { name }] of values.statuses)
      result.statuses[key] =
        decisions.statuses[key] ?? suggestStatus(name, config);
    for (const [key, { name }] of values.modules)
      result.modules[key] =
        decisions.modules[key] ?? suggestTag(name, config.modules);
    for (const [key, { name }] of values.labels)
      result.labels[key] =
        decisions.labels[key] ?? suggestTag(name, config.labels);
    return result;
  }, [values, decisions, members, config]);
  const built = useMemo(
    () =>
      sheet && mapping
        ? buildImport(sheet, mapping, effective, fileName)
        : undefined,
    [sheet, mapping, effective, fileName],
  );

  const decide = (
    kind: Exclude<keyof ImportDecisions, "people">,
    key: string,
    decision: TagDecision,
  ) =>
    setDecisions((current) => ({
      ...current,
      [kind]: { ...current[kind], [key]: decision },
    }));
  const tagSelect = (
    kind: Exclude<keyof ImportDecisions, "people">,
    key: string,
    name: string,
    existing: { id: string; name: string }[],
  ) => {
    const decision = effective[kind][key];
    const value =
      decision.kind === "existing"
        ? decision.id
        : decision.kind === "create"
          ? "create"
          : "ignore";
    return (
      <select
        aria-label={`Associar «${name}»`}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          decide(
            kind,
            key,
            next === "create"
              ? {
                  kind: "create",
                  name,
                  category:
                    kind === "statuses" ? guessCategory(name) : undefined,
                }
              : next === "ignore"
                ? { kind: "ignore" }
                : { kind: "existing", id: next },
          );
        }}
      >
        {existing.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
        <option value="create">Criar «{name}»</option>
        <option value="ignore">
          {kind === "statuses" ? "Usar o estado inicial" : "Ignorar"}
        </option>
      </select>
    );
  };
  const section = (
    title: string,
    entries: [string, { name: string; count: number }][],
    render: (key: string, name: string) => ReactNode,
  ) =>
    entries.length > 0 && (
      <section className="drawer-section">
        <h3 className="section-label">{title}</h3>
        <table className="data-table import-table">
          <thead>
            <tr>
              <th>No ficheiro</th>
              <th>Linhas</th>
              <th>No projeto</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, { name, count }]) => (
              <tr key={key}>
                <td>{name}</td>
                <td className="mono">{count}</td>
                <td>{render(key, name)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );

  return (
    <Modal
      title="Importar issues"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ol className="import-steps" aria-label="Passos da importação">
        {(
          [
            ["file", "Ficheiro"],
            ["associate", "Associação"],
            ["review", "Confirmar"],
          ] as const
        ).map(([value, label], index) => (
          <li
            key={value}
            aria-current={step === value ? "step" : undefined}
            className={step === value ? "current" : ""}
          >
            <span className="mono">{index + 1}</span> {label}
          </li>
        ))}
      </ol>
      {error && <ErrorMessage message={error} />}
      {step === "file" && (
        <>
          <p>
            Carregue uma folha de cálculo <strong>.xlsx</strong> ou{" "}
            <strong>.csv</strong> com uma linha de cabeçalhos. A seguir associa
            as colunas, as pessoas, os estados, os módulos e as labels ao
            projeto. Nada é criado antes de confirmar e a importação não envia
            notificações.
          </p>
          <label className="file-button">
            <ArrowUpTrayIcon />
            Escolher ficheiro
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const parsed = await readSpreadsheet(file);
                  if (!parsed.headers.some(Boolean) || !parsed.rows.length)
                    throw new Error("O ficheiro não tem linhas para importar.");
                  if (parsed.rows.length > maxRows)
                    throw new Error(
                      `O ficheiro tem ${parsed.rows.length} linhas; importe no máximo ${maxRows} de cada vez.`,
                    );
                  setSheet(parsed);
                  setFileName(file.name);
                  setMapping(suggestColumns(parsed.headers));
                  setDecisions({
                    people: {},
                    statuses: {},
                    modules: {},
                    labels: {},
                  });
                  setStep("associate");
                } catch (failure) {
                  setError(
                    (failure as Error).message ||
                      "Não foi possível ler o ficheiro.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        </>
      )}
      {step === "associate" && sheet && mapping && values && (
        <>
          <p className="muted">
            {fileName} · {sheet.rows.length} linhas
          </p>
          <section className="drawer-section">
            <h3 className="section-label">Colunas</h3>
            <div className="form-grid">
              {importFields.map((field) => (
                <label key={field.key} className="field">
                  {field.label}
                  <select
                    value={mapping[field.key]}
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        [field.key]: Number(event.target.value),
                      })
                    }
                  >
                    <option value={-1}>
                      {field.key === "title"
                        ? "Gerar a partir da descrição"
                        : "Não importar"}
                    </option>
                    {sheet.headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header || `Coluna ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <fieldset className="field check-group">
              <legend>Colunas importadas como comentários</legend>
              {sheet.headers.map((header, index) =>
                header ? (
                  <label key={index}>
                    <input
                      type="checkbox"
                      checked={mapping.comments.includes(index)}
                      onChange={(event) =>
                        setMapping({
                          ...mapping,
                          comments: event.target.checked
                            ? [...mapping.comments, index]
                            : mapping.comments.filter(
                                (column) => column !== index,
                              ),
                        })
                      }
                    />
                    {header}
                  </label>
                ) : null,
              )}
            </fieldset>
          </section>
          {section("Pessoas", [...values.people], (key, name) => (
            <select
              aria-label={`Associar ${name}`}
              value={effective.people[key] || ""}
              onChange={(event) =>
                setDecisions((current) => ({
                  ...current,
                  people: { ...current.people, [key]: event.target.value },
                }))
              }
            >
              <option value="">Não associar</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
          ))}
          {values.people.size > 0 && (
            <p className="hint">
              Sem associação, o reporter passa a ser quem importa (com a nota
              «Reportado originalmente por …») e o responsável não é atribuído.
            </p>
          )}
          {section("Estados", [...values.statuses], (key, name) => {
            const decision = effective.statuses[key];
            return (
              <span className="import-decision">
                {tagSelect("statuses", key, name, config.statuses)}
                {decision.kind === "create" && (
                  <select
                    aria-label={`Categoria de «${name}»`}
                    value={decision.category || "todo"}
                    onChange={(event) =>
                      decide("statuses", key, {
                        ...decision,
                        category: event.target.value as IssueCategory,
                      })
                    }
                  >
                    {issueCategories.map((category) => (
                      <option key={category} value={category}>
                        {issueCategoryLabels[category]}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            );
          })}
          {section("Módulos", [...values.modules], (key, name) =>
            tagSelect("modules", key, name, config.modules),
          )}
          {section("Labels", [...values.labels], (key, name) =>
            tagSelect("labels", key, name, config.labels),
          )}
          <div className="form-actions">
            <Button onClick={() => setStep("file")}>Outro ficheiro</Button>
            <Button
              variant="primary"
              disabled={mapping.description < 0 && mapping.title < 0}
              onClick={() => setStep("review")}
            >
              Rever
            </Button>
          </div>
        </>
      )}
      {step === "review" && built && (
        <>
          <ul className="import-summary">
            <li>
              <strong className="mono">{built.payload.rows.length}</strong>{" "}
              issues a criar
            </li>
            {built.skipped > 0 && (
              <li>
                <strong className="mono">{built.skipped}</strong> linhas sem
                título nem descrição ignoradas
              </li>
            )}
            <li>
              <strong className="mono">
                {built.payload.newStatuses.length}
              </strong>{" "}
              estados,{" "}
              <strong className="mono">
                {built.payload.newModules.length}
              </strong>{" "}
              módulos e{" "}
              <strong className="mono">{built.payload.newLabels.length}</strong>{" "}
              labels novos
            </li>
            <li>
              <strong className="mono">
                {built.payload.rows.reduce(
                  (total, row) => total + row.comments.length,
                  0,
                )}
              </strong>{" "}
              comentários importados
            </li>
          </ul>
          <p className="hint">
            Linhas com uma referência já importada neste projeto são ignoradas.
          </p>
          <div className="table-card">
            <div className="table-scroll">
              <table className="data-table import-table">
                <thead>
                  <tr>
                    <th>Ref.</th>
                    <th>Título</th>
                    <th>Responsáveis</th>
                  </tr>
                </thead>
                <tbody>
                  {built.payload.rows.slice(0, 8).map((row, index) => (
                    <tr key={index}>
                      <td className="mono">{row.externalRef || "—"}</td>
                      <td>{row.title}</td>
                      <td>
                        {row.assigneeIds
                          .map(
                            (id) =>
                              members.find((member) => member.id === id)?.name,
                          )
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="form-actions">
            <Button disabled={busy} onClick={() => setStep("associate")}>
              Voltar
            </Button>
            <Button
              variant="primary"
              disabled={!built.payload.rows.length}
              disabledFocusable={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await fetchImport(
                    project.id,
                    built.payload,
                    idempotencyKey,
                  );
                  setResult(response);
                  setStep("done");
                  onImported();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "A importar…"
                : `Importar ${built.payload.rows.length} issues`}
            </Button>
          </div>
        </>
      )}
      {step === "done" && result && (
        <>
          <p className="notice">
            Foram criados <strong>{result.created}</strong> issues
            {result.statuses + result.modules + result.labels > 0 &&
              `, ${result.statuses} estados, ${result.modules} módulos e ${result.labels} labels`}
            .
          </p>
          {result.skipped.length > 0 && (
            <p className="hint">
              Ignorados por já existirem:{" "}
              {result.skipped.map((item) => item.externalRef).join(", ")}.
            </p>
          )}
          <div className="form-actions">
            <Button variant="primary" onClick={onClose}>
              Concluir
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
function fetchImport(
  projectId: string,
  payload: unknown,
  idempotencyKey: string,
) {
  return api<IssueImportResult>(
    `/projects/${projectId}/issues/import`,
    "POST",
    payload,
    undefined,
    undefined,
    { "Idempotency-Key": idempotencyKey },
  );
}
