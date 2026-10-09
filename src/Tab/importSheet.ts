// Spreadsheet import: pure functions (no React, no network) that turn a parsed sheet and the
// user's associations into the payload of POST /projects/:id/issues/import.
import type { IssueCategory, IssueConfig, Member } from "../shared/contracts";

export interface Sheet {
  headers: string[];
  rows: string[][];
}
export type FieldKey =
  | "title"
  | "description"
  | "externalRef"
  | "reporter"
  | "assignees"
  | "status"
  | "modules"
  | "submodules"
  | "labels"
  | "priority"
  | "estimate"
  | "reportedAt"
  | "deployedAt";
/** Header hints in order of preference, compared after `normalize`. */
export const importFields: { key: FieldKey; label: string; hints: string[] }[] =
  [
    { key: "title", label: "Título", hints: ["titulo", "title", "assunto"] },
    {
      key: "description",
      label: "Descrição",
      hints: ["informacoes/teste", "informacoes", "descricao", "description"],
    },
    { key: "externalRef", label: "Referência (ID)", hints: ["id", "ref"] },
    {
      key: "reporter",
      label: "Reporter",
      hints: ["utilizador", "reporter", "autor", "criado por"],
    },
    {
      key: "assignees",
      label: "Responsáveis",
      hints: ["user dsi", "responsaveis", "responsavel", "assignee"],
    },
    {
      key: "status",
      label: "Estado",
      hints: ["estado dsi", "estado", "status"],
    },
    { key: "modules", label: "Módulos", hints: ["modulo", "modulos"] },
    // Submodules become modules too: the issue gets both «Frontend» and «Carrinho».
    {
      key: "submodules",
      label: "Submódulos",
      hints: ["sub-modulo", "submodulo", "sub-modulos", "submodulos"],
    },
    { key: "labels", label: "Labels", hints: ["tipo", "labels", "label"] },
    {
      key: "priority",
      label: "Prioridade (1–5)",
      hints: ["prioridade dsi+dm", "prioridade", "priority"],
    },
    {
      key: "estimate",
      label: "Estimativa",
      hints: ["estimativa dsi", "estimativa", "estimate"],
    },
    {
      key: "reportedAt",
      label: "Data de criação",
      hints: ["data", "data de criacao", "criado em"],
    },
    {
      key: "deployedAt",
      label: "Data de deploy",
      hints: ["data deployed", "data de deploy", "deployed"],
    },
  ];
export const commentHints = ["obs dsi", "obs user", "observacoes", "notas"];
export type ColumnMapping = Record<FieldKey, number> & { comments: number[] };

/** Key of a value to create, shared by the decisions and the payload rows. */
export const importKey = (value: string) => normalize(value).slice(0, 60);
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const compact = (value: string) => normalize(value).replace(/[\s._-]/g, "");
/** "frontend" → "Frontend"; mixed case such as "eShop" is kept. */
const capitalize = (value: string) =>
  value === value.toLocaleLowerCase("pt-PT")
    ? value.charAt(0).toLocaleUpperCase("pt-PT") + value.slice(1)
    : value;

export function suggestColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalize);
  const taken = new Set<number>();
  const mapping = { comments: [] as number[] } as ColumnMapping;
  for (const field of importFields) {
    const index = field.hints
      .map((hint) => normalized.indexOf(hint))
      .find((found) => found >= 0 && !taken.has(found));
    mapping[field.key] = index ?? -1;
    if (index !== undefined) taken.add(index);
  }
  mapping.comments = normalized.flatMap((header, index) =>
    commentHints.includes(header) && !taken.has(index) ? [index] : [],
  );
  return mapping;
}

export const splitPeople = (value: string) =>
  value
    .split(/\s*[/,;&+]\s*|\s+e\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
export const splitModules = (value: string) =>
  value
    .split(/\s+[-–—]\s+|\s*[+/,;]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
export const splitLabels = (value: string) =>
  value
    .split(/\s*[,;/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Distinct values (by normalized key) with the first spelling found. */
export function distinct(
  sheet: Sheet,
  column: number,
  split: (value: string) => string[] = (value) => [value.trim()],
) {
  const values = new Map<string, { name: string; count: number }>();
  if (column < 0) return values;
  for (const row of sheet.rows)
    for (const part of split(row[column] || "")) {
      if (!part) continue;
      const key = importKey(part);
      const current = values.get(key);
      if (current) current.count++;
      else values.set(key, { name: part, count: 1 });
    }
  return values;
}

/** Values of the module and submodule columns, which both become modules. */
export function distinctModules(sheet: Sheet, mapping: ColumnMapping) {
  const values = distinct(sheet, mapping.modules, splitModules);
  for (const [key, value] of distinct(
    sheet,
    mapping.submodules,
    splitModules,
  )) {
    const current = values.get(key);
    if (current) current.count += value.count;
    else values.set(key, value);
  }
  return values;
}

/** "irocha" or "ines.rocha" ↔ Inês Rocha <ines.rocha@empresa.pt>. */
export function suggestMember(value: string, members: Member[]) {
  const target = compact(value);
  if (!target) return "";
  for (const member of members) {
    const words = normalize(member.name).split(" ").filter(Boolean);
    const local = member.email.split("@")[0] || "";
    const localParts = normalize(local).split(/[._-]/).filter(Boolean);
    const keys = new Set([
      compact(member.name),
      compact(local),
      compact(member.email),
      words.length > 1 ? `${words[0][0]}${words.at(-1)}` : "",
      localParts.length > 1 ? `${localParts[0][0]}${localParts.at(-1)}` : "",
      words[0] || "",
    ]);
    if (keys.has(target)) return member.id;
  }
  return "";
}

const statusAliases: Record<string, string> = {
  "aguarda informacao": "a aguardar informacao",
  "a aguardar info": "a aguardar informacao",
  "fechado auto": "fechado",
  tbr: "para testar",
  "em curso": "em curso",
};
export type TagDecision =
  | { kind: "existing"; id: string }
  | { kind: "create"; name: string; category?: IssueCategory }
  | { kind: "ignore" };
export function guessCategory(name: string): IssueCategory {
  const key = normalize(name);
  if (/resolvid|fechad|duplicad|conclu|cancelad|done|closed/.test(key))
    return "done";
  if (/curso|testar|progress|review|revis/.test(key)) return "doing";
  return "todo";
}
export function suggestStatus(name: string, config: IssueConfig): TagDecision {
  const key = normalize(name);
  const wanted = statusAliases[key] || key;
  const found = config.statuses.find(
    (status) => normalize(status.name) === wanted,
  );
  return found
    ? { kind: "existing", id: found.id }
    : { kind: "create", name: capitalize(name), category: guessCategory(name) };
}
export function suggestTag(
  name: string,
  items: { id: string; name: string }[],
): TagDecision {
  const found = items.find((item) => normalize(item.name) === normalize(name));
  return found
    ? { kind: "existing", id: found.id }
    : { kind: "create", name: capitalize(name) };
}

/** "04-08-2024", "4/8/2026", "2025-08-22" or "2025-08-22T…" → "2024-08-04". */
export function parseDay(value: string) {
  const text = value.trim();
  let year: number, month: number, day: number;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [year, month, day] = [+match[1], +match[2], +match[3]];
  else if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)))
    [day, month, year] = [+match[1], +match[2], +match[3]];
  else return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  )
    return null;
  return at.toISOString().slice(0, 10);
}
export function titleFrom(text: string) {
  const line =
    text
      .split(/\r?\n/)
      .map((part) => part.replace(/^[\s#>*\-+\d.)]+/, "").trim())
      .find(Boolean) || "";
  if (line.length <= 120) return line;
  const cut = line.slice(0, 117);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 117)}…`;
}

export interface ImportDecisions {
  people: Record<string, string>;
  statuses: Record<string, TagDecision>;
  modules: Record<string, TagDecision>;
  labels: Record<string, TagDecision>;
}
export interface ImportPayload {
  fileName: string;
  newStatuses: { key: string; name: string; category: IssueCategory }[];
  newModules: { key: string; name: string }[];
  newLabels: { key: string; name: string }[];
  rows: {
    externalRef: string | null;
    title: string;
    description: string;
    status: string | null;
    priority: number | null;
    estimate: number | null;
    reportedAt: string | null;
    deployedAt: string | null;
    reporterId: string | null;
    reporterNote: string | null;
    assigneeIds: string[];
    modules: string[];
    labels: string[];
    comments: string[];
  }[];
}
export function buildImport(
  sheet: Sheet,
  mapping: ColumnMapping,
  decisions: ImportDecisions,
  fileName: string,
): { payload: ImportPayload; skipped: number } {
  const cell = (row: string[], column: number) =>
    column >= 0 ? (row[column] || "").trim() : "";
  const fresh = <T extends { key: string }>(
    decided: Record<string, TagDecision>,
    make: (key: string, decision: TagDecision & { kind: "create" }) => T,
  ) =>
    Object.entries(decided).flatMap(([key, decision]) =>
      decision.kind === "create" ? [make(key, decision)] : [],
    );
  const resolve = (decided: Record<string, TagDecision>, value: string) => {
    const decision = decided[importKey(value)];
    if (!decision || decision.kind === "ignore") return null;
    return decision.kind === "existing" ? decision.id : importKey(value);
  };
  let skipped = 0;
  const rows: ImportPayload["rows"] = [];
  for (const row of sheet.rows) {
    const description = cell(row, mapping.description);
    const title = (cell(row, mapping.title) || titleFrom(description)).slice(
      0,
      200,
    );
    if (!title) {
      skipped++;
      continue;
    }
    const reporterName = cell(row, mapping.reporter);
    const reporterId = reporterName
      ? decisions.people[importKey(reporterName)] || null
      : null;
    const priority = Number.parseInt(cell(row, mapping.priority), 10);
    const estimate = Number(cell(row, mapping.estimate).replace(",", "."));
    const reported = parseDay(cell(row, mapping.reportedAt));
    const status = cell(row, mapping.status);
    rows.push({
      externalRef: cell(row, mapping.externalRef).slice(0, 200) || null,
      title,
      description: description.slice(0, 50000),
      status: status ? resolve(decisions.statuses, status) : null,
      priority: priority >= 1 && priority <= 5 ? priority : null,
      estimate:
        cell(row, mapping.estimate) &&
        Number.isFinite(estimate) &&
        estimate >= 0
          ? Math.min(Math.round(estimate * 100) / 100, 99999)
          : null,
      // Midday UTC keeps the same calendar day in any European time zone.
      reportedAt: reported ? `${reported}T12:00:00.000Z` : null,
      deployedAt: parseDay(cell(row, mapping.deployedAt)),
      reporterId,
      reporterNote:
        reporterName && !reporterId
          ? `Reportado originalmente por ${reporterName}`.slice(0, 200)
          : null,
      assigneeIds: [
        ...new Set(
          splitPeople(cell(row, mapping.assignees))
            .map((name) => decisions.people[importKey(name)])
            .filter(Boolean),
        ),
      ],
      modules: [
        ...new Set(
          [mapping.modules, mapping.submodules]
            .flatMap((column) => splitModules(cell(row, column)))
            .map((value) => resolve(decisions.modules, value))
            .filter((value): value is string => !!value),
        ),
      ],
      labels: [
        ...new Set(
          splitLabels(cell(row, mapping.labels))
            .map((value) => resolve(decisions.labels, value))
            .filter((value): value is string => !!value),
        ),
      ],
      comments: mapping.comments
        .map((column) => [sheet.headers[column], cell(row, column)] as const)
        .filter(([, text]) => text)
        .map(([header, text]) =>
          `**${header}** (importado)\n\n${text}`.slice(0, 50000),
        ),
    });
  }
  return {
    payload: {
      fileName,
      newStatuses: fresh(decisions.statuses, (key, decision) => ({
        key,
        name: decision.name.slice(0, 60),
        category: decision.category || "todo",
      })),
      newModules: fresh(decisions.modules, (key, decision) => ({
        key,
        name: decision.name.slice(0, 60),
      })),
      newLabels: fresh(decisions.labels, (key, decision) => ({
        key,
        name: decision.name.slice(0, 60),
      })),
      rows,
    },
    skipped,
  };
}

/** Cells to text; spreadsheet dates become "AAAA-MM-DD". */
export function toSheet(data: unknown[][]): Sheet {
  const text = (value: unknown) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value === null || value === undefined
        ? ""
        : String(value);
  const [head = [], ...body] = data;
  const headers = head.map((value) => text(value).trim());
  const rows = body
    .map((row) => headers.map((_, index) => text(row[index])))
    .filter((row) => row.some((value) => value.trim()));
  return { headers, rows };
}
