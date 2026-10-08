// Small building blocks shared by the issue table, board, panel and settings.
import {
  issueColors,
  type IssueColor,
  type IssueConfig,
  type Member,
  type IssueStatus,
  type IssueTag,
} from "../shared/contracts";
import { Avatar } from "./components";
import type { SelectOption } from "./Select2";

export const colorLabels: Record<IssueColor, string> = {
  gray: "Cinzento",
  blue: "Azul",
  teal: "Verde-água",
  green: "Verde",
  amber: "Âmbar",
  orange: "Laranja",
  red: "Vermelho",
  purple: "Roxo",
  pink: "Rosa",
};
export const colorOptions = issueColors.map((value) => ({
  value,
  label: colorLabels[value],
}));
export const priorityLabels: Record<number, string> = {
  1: "Crítica",
  2: "Alta",
  3: "Média",
  4: "Baixa",
  5: "Mínima",
};
const priorityColors: Record<number, IssueColor> = {
  1: "red",
  2: "orange",
  3: "amber",
  4: "blue",
  5: "gray",
};

export function Tag({ name, color }: { name: string; color: IssueColor }) {
  return <span className={`tag tag-${color}`}>{name}</span>;
}
export function StatusTag({ status }: { status?: IssueStatus }) {
  return status ? (
    <span className={`tag tag-status tag-${status.color}`}>
      <span className="tag-dot" aria-hidden />
      {status.name}
    </span>
  ) : (
    <span className="muted">—</span>
  );
}
export function Priority({ value }: { value: number | null }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span
      className={`tag tag-priority tag-${priorityColors[value]}`}
      title={`Prioridade: ${priorityLabels[value]}`}
    >
      {priorityLabels[value]}
    </span>
  );
}
export function TagList({ ids, items }: { ids: string[]; items: IssueTag[] }) {
  const tags = ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is IssueTag => !!item);
  if (!tags.length) return <span className="muted">—</span>;
  return (
    <span className="tag-list">
      {tags.map((tag) => (
        <Tag key={tag.id} name={tag.name} color={tag.color} />
      ))}
    </span>
  );
}
export const statusOf = (config: IssueConfig | undefined, id: string) =>
  config?.statuses.find((status) => status.id === id);
export const estimateText = (value: number | null) =>
  value === null ? "—" : String(value).replace(".", ",");
/** "2026-08-04" → "04/08/2026" without timezone shifts. */
export const dayText = (value: string | null) =>
  value ? value.split("-").reverse().join("/") : "—";

/* Options for Select2 (status, priority, modules, labels, people). */
export const statusOptions = (config: IssueConfig): SelectOption[] =>
  config.statuses.map((status) => ({
    value: status.id,
    label: status.name,
    render: <StatusTag status={status} />,
  }));
export const priorityOptions: SelectOption[] = [
  {
    value: "",
    label: "Sem prioridade",
    render: <span className="muted">Sem prioridade</span>,
  },
  ...[1, 2, 3, 4, 5].map((value) => ({
    value: String(value),
    label: priorityLabels[value],
    render: <Priority value={value} />,
  })),
];
export const tagOptions = (items: IssueTag[]): SelectOption[] =>
  items.map((item) => ({
    value: item.id,
    label: item.name,
    render: <Tag name={item.name} color={item.color} />,
  }));
/** Members with the current user first, marked "(eu)" for quick self-assignment. */
export const peopleOptions = (
  members: Member[],
  userId?: string,
): SelectOption[] =>
  [...members]
    .sort((a, b) => Number(b.id === userId) - Number(a.id === userId))
    .map((member) => {
      const label = member.id === userId ? `${member.name} (eu)` : member.name;
      return {
        value: member.id,
        label,
        render: (
          <span className="select2-person">
            <Avatar name={member.name} />
            {label}
          </span>
        ),
      };
    });

/** Columns of the issue table; the user chooses which optional ones are visible. */
export const issueColumns = [
  { id: "id", label: "ID", fixed: true },
  { id: "title", label: "Issue", fixed: true },
  { id: "status", label: "Estado" },
  { id: "priority", label: "Prioridade" },
  { id: "reporter", label: "Reporter" },
  { id: "assignees", label: "Responsáveis" },
  { id: "reported", label: "Criado em" },
  { id: "modules", label: "Módulos" },
  { id: "labels", label: "Labels" },
  { id: "estimate", label: "Estimativa" },
  { id: "deployed", label: "Data de deploy" },
  { id: "updated", label: "Atualizado" },
] as const;
export type IssueColumn = (typeof issueColumns)[number]["id"];
/** Always visible, always first; the other columns can be hidden and reordered. */
export const fixedColumns: IssueColumn[] = ["id", "title"];
export const defaultColumns: IssueColumn[] = [
  "id",
  "title",
  "status",
  "priority",
  "reporter",
  "assignees",
  "reported",
];
