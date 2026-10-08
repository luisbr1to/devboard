import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from "@fluentui/react-components";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlusIcon,
  TableCellsIcon,
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
  ViewColumnsIcon,
} from "@heroicons/react/24/outline";
import {
  boardPreferenceKey,
  type BoardPreference,
  type Issue,
  type IssueConfig,
  type IssuePage,
  type Member,
  type Project,
} from "../shared/contracts";
import { api, useRemote } from "./api";
import {
  AvatarStack,
  Button,
  Confirm,
  Empty,
  ErrorMessage,
  FilterMenu,
  MultiFilterMenu,
  Loading,
  OverflowActions,
  SearchField,
  Tabs,
  type OverflowAction,
} from "./components";
import {
  assignable,
  day,
  issueKey,
  plainSnippet,
  shortDate,
} from "./presentation";
import {
  Priority,
  StatusTag,
  TagList,
  dayText,
  defaultColumns,
  estimateText,
  fixedColumns,
  issueColumns,
  priorityLabels,
  statusOf,
  type IssueColumn,
} from "./issueUi";
import { IssueBoard } from "./IssueBoard";
import { IssueForm } from "./IssueForm";
import { IssuePanel } from "./IssuePanel";
import { Pagination, usePageSize } from "./pagination";

// The spreadsheet parsers are only downloaded when an owner opens the import.
const IssueImport = lazy(() =>
  import("./IssueImport").then((module) => ({ default: module.IssueImport })),
);
type View = "table" | "board";

export function IssueList({
  project,
  members,
  revision,
  refresh,
  userId,
  focus,
  onIssueChange,
}: {
  project: Project;
  members: Member[];
  revision: number;
  refresh(): void;
  userId?: string;
  focus?: { issueId: string; activityId: string };
  onIssueChange(issueId?: string): void;
}) {
  const [archive, setArchive] = useState<"active" | "archived">("active");
  const [view, setView] = useState<View>();
  const [columns, setColumns] = useState<IssueColumn[]>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [module, setModule] = useState("all");
  const [label, setLabel] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [reporter, setReporter] = useState("all");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState("reported");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("issues.pageSize", 25);
  const [selectedId, setSelectedId] = useState(focus?.issueId || undefined);
  const [form, setForm] = useState<{ issue?: Issue; statusId?: string }>();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Archived issues picked for a bulk restore, kept across pages with their versions. */
  const [checked, setChecked] = useState<Record<string, Issue>>({});
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    run(): Promise<void>;
    danger?: boolean;
  } | null>(null);
  useEffect(() => {
    if (focus?.issueId) setSelectedId(focus.issueId);
  }, [focus]);
  const select = (id?: string) => {
    setSelectedId(id);
    onIssueChange(id);
  };
  const preferences = useRemote<Record<string, unknown>>("/me/preferences", 0);
  const activeView: View =
    view ?? (preferences.data?.["issues.view"] === "board" ? "board" : "table");
  /** Visible columns in the user's order; ID and Issue always come first. */
  const activeColumns = useMemo(() => {
    const saved = columns ?? preferences.data?.["issues.columns"];
    const known = new Set(issueColumns.map((column) => column.id as string));
    const list =
      Array.isArray(saved) && saved.length
        ? (saved.filter((id) => known.has(id)) as IssueColumn[])
        : defaultColumns;
    return [
      ...fixedColumns,
      ...list.filter((id) => !fixedColumns.includes(id)),
    ] as IssueColumn[];
  }, [columns, preferences.data]);
  const [draggedColumn, setDraggedColumn] = useState<IssueColumn>();
  const [columnTarget, setColumnTarget] = useState<{
    id: IssueColumn;
    after: boolean;
  }>();
  const saveColumns = (next: IssueColumn[]) => {
    setColumns(next);
    remember("issues.columns", next);
  };
  /** Moves `id` next to `target` (before or after it); fixed columns never move. */
  const moveColumn = (id: IssueColumn, target: IssueColumn, after: boolean) => {
    if (id === target || fixedColumns.includes(id)) return;
    const rest = activeColumns.filter(
      (column) => column !== id && !fixedColumns.includes(column),
    );
    const index = fixedColumns.includes(target)
      ? 0
      : rest.indexOf(target) + (after ? 1 : 0);
    rest.splice(index, 0, id);
    saveColumns([...fixedColumns, ...rest]);
  };
  const remember = (key: string, value: unknown) =>
    void api(`/me/preferences/${key}`, "PUT", { value }).catch(() => undefined);
  const config = useRemote<IssueConfig>(
    `/projects/${project.id}/issue-config`,
    revision,
  );
  const board = activeView === "board";
  const boardKey = boardPreferenceKey(project.id);
  const [boardLayout, setBoardLayout] = useState<BoardPreference>();
  /**
   * Board columns in the user's order: saved statuses first, then any new ones in the
   * project's order. Hidden statuses stay out of the board but keep their place.
   */
  const boardStatuses = useMemo(() => {
    const statuses = config.data?.statuses || [];
    const saved =
      boardLayout ??
      (preferences.data?.[boardKey] as BoardPreference | undefined);
    const order = saved?.order || [];
    const rank = (id: string) => {
      const index = order.indexOf(id);
      return index < 0
        ? order.length + statuses.findIndex((item) => item.id === id)
        : index;
    };
    const all = [...statuses].sort((a, b) => rank(a.id) - rank(b.id));
    const hidden = new Set(saved?.hidden || []);
    return { all, visible: all.filter((item) => !hidden.has(item.id)) };
  }, [config.data, boardLayout, preferences.data, boardKey]);
  const saveBoard = (next: BoardPreference) => {
    setBoardLayout(next);
    remember(boardKey, next);
  };
  const hiddenStatuses = boardStatuses.all
    .filter((item) => !boardStatuses.visible.includes(item))
    .map((item) => item.id);
  /** Moves the `id` column next to `target` (before or after it). */
  const moveStatus = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    const rest = boardStatuses.all
      .map((item) => item.id)
      .filter((item) => item !== id);
    rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, id);
    saveBoard({ order: rest, hidden: hiddenStatuses });
  };
  const params = new URLSearchParams({
    view: activeView,
    archive,
    q: query,
    status: status.join(",") || "all",
    module,
    label,
    assignee,
    reporter,
    priority,
    sort,
    page: String(page),
    pageSize: String(pageSize),
  });
  const issues = useRemote<IssuePage>(
    `/projects/${project.id}/issues?${params}`,
    revision,
  );
  const filter = (fn: () => void) => {
    fn();
    setPage(1);
    setChecked({});
    setNotice("");
  };
  const filtered =
    !!query ||
    status.length > 0 ||
    [module, label, assignee, reporter, priority].some(
      (value) => value !== "all",
    );
  const owner = project.role === "owner";
  const viewer = project.role === "viewer";
  const items = issues.data?.items || [];
  const selectable = owner && !board;
  const checkedList = Object.values(checked);
  const pageChecked = items.filter((issue) => checked[issue.id]).length;
  const toggle = (list: Issue[], on: boolean) =>
    setChecked((current) => {
      const next = { ...current };
      for (const issue of list) {
        if (on) next[issue.id] = issue;
        else delete next[issue.id];
      }
      return next;
    });
  const doneStatuses = (config.data?.statuses || []).filter(
    (item) => item.category === "done",
  );
  // A deletion, archive or filter elsewhere can leave the current page past the end.
  const lastPage = issues.data
    ? Math.max(1, Math.ceil(issues.data.total / issues.data.pageSize))
    : 1;
  useEffect(() => {
    if (!board && issues.data && page > lastPage) setPage(lastPage);
  }, [board, issues.data, page, lastPage]);

  async function run(task: () => Promise<unknown>) {
    setError("");
    try {
      await task();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      refresh();
    }
  }
  const issueCount = (count: number) =>
    `${count} ${count === 1 ? "issue" : "issues"}`;
  /** Counts the matching active issues first, so the confirmation states the impact. */
  async function archiveByRule(statusIds: string[], scope: string) {
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams({
        archive: "active",
        status: statusIds.join(","),
        pageSize: "1",
      });
      const { total } = await api<IssuePage>(
        `/projects/${project.id}/issues?${query}`,
      );
      if (!total) {
        setNotice(`Não há issues ativos ${scope}.`);
        return;
      }
      setConfirmation({
        title: "Arquivar por regra",
        description: `Arquivar ${issueCount(total)} ${total === 1 ? "ativo" : "ativos"} ${scope}? Saem da tabela ativa e do board e ficam apenas de leitura em Arquivados. Pode restaurá-los mais tarde.`,
        run: async () => {
          const result = await api<{ archived: number }>(
            `/projects/${project.id}/issues/archive`,
            "POST",
            { statusIds },
          );
          setNotice(
            `${issueCount(result.archived)} ${result.archived === 1 ? "arquivado" : "arquivados"}.`,
          );
          refresh();
        },
      });
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  const bulkTexts = {
    archive: {
      title: "Arquivar",
      done: ["arquivado", "arquivados"],
      description: (count: number) =>
        `${count === 1 ? "Sai" : "Saem"} da tabela ativa e do board e ${count === 1 ? "fica" : "ficam"} apenas de leitura em Arquivados. Pode restaurá-${count === 1 ? "lo" : "los"} mais tarde.`,
    },
    restore: {
      title: "Restaurar",
      done: ["restaurado", "restaurados"],
      description: (count: number) =>
        `${count === 1 ? "Volta" : "Voltam"} às vistas ativas e ao fim das respetivas colunas do board.`,
    },
    delete: {
      title: "Apagar",
      done: ["apagado", "apagados"],
      description: (count: number) =>
        `${count === 1 ? "Deixa" : "Deixam"} de aparecer para toda a equipa. Os comentários, anexos e histórico ficam guardados, mas esta ação não pode ser desfeita na aplicação.`,
    },
  } as const;
  /** Owners archive, restore or delete the selected issues in one transaction. */
  const bulk = (action: keyof typeof bulkTexts, list: Issue[]) => {
    const text = bulkTexts[action];
    setConfirmation({
      title: `${text.title} ${list.length === 1 ? "issue" : "issues"}`,
      description: `${text.title} ${issueCount(list.length)}? ${text.description(list.length)}`,
      danger: action === "delete",
      run: async () => {
        const result = await api<Record<string, number>>(
          `/projects/${project.id}/issues/${action}`,
          "POST",
          {
            issues: list.map((issue) => ({
              id: issue.id,
              version: issue.version,
            })),
          },
        );
        const count = Object.values(result)[0];
        setChecked({});
        if (selectedId && list.some((issue) => issue.id === selectedId))
          select(undefined);
        setNotice(
          `${issueCount(count)} ${text.done[count === 1 ? 0 : 1]}.`,
        );
        refresh();
      },
    });
  };
  const actions = (issue: Issue): OverflowAction[] => {
    if (viewer) return [];
    const mine = issue.assignees.some((person) => person.id === userId);
    return [
      {
        label: "Editar",
        icon: <PencilSquareIcon />,
        disabled: !!issue.archivedAt,
        onClick: () => setForm({ issue }),
      },
      {
        label: mine ? "Deixar de ser responsável" : "Atribuir-me",
        icon: mine ? <UserMinusIcon /> : <UserPlusIcon />,
        disabled: !!issue.archivedAt,
        onClick: () =>
          void run(() =>
            api(`/issues/${issue.id}/assign-me`, mine ? "DELETE" : "POST"),
          ),
      },
      {
        label: "Duplicar",
        icon: <DocumentDuplicateIcon />,
        onClick: () =>
          setConfirmation({
            title: "Duplicar issue",
            description:
              "Criar uma cópia no estado inicial, com os mesmos módulos, labels, prioridade e responsáveis? Os comentários não são copiados e o reporter passa a ser você.",
            run: async () => {
              const copy = await api<Issue>(
                `/issues/${issue.id}/duplicate`,
                "POST",
              );
              refresh();
              select(copy.id);
            },
          }),
      },
      ...(owner
        ? [
            {
              label: issue.archivedAt ? "Restaurar" : "Arquivar",
              icon: issue.archivedAt ? <ArrowPathIcon /> : <ArchiveBoxIcon />,
              onClick: () =>
                setConfirmation({
                  title: issue.archivedAt
                    ? "Restaurar issue"
                    : "Arquivar issue",
                  description: issue.archivedAt
                    ? "O issue volta às vistas ativas e ao fim da sua coluna do board."
                    : "O issue sai da tabela ativa e do board e fica apenas de leitura em Arquivados. Pode restaurá-lo mais tarde.",
                  run: async () => {
                    await api(
                      `/issues/${issue.id}/${issue.archivedAt ? "restore" : "archive"}`,
                      "POST",
                      undefined,
                      issue.version,
                    );
                    toggle([issue], false);
                    refresh();
                  },
                }),
            },
          ]
        : []),
      ...(owner || issue.reporterId === userId
        ? [
            {
              label: "Apagar",
              icon: <TrashIcon />,
              onClick: () =>
                setConfirmation({
                  title: "Apagar issue",
                  danger: true,
                  description: `O ${issueKey(issue.number)} «${issue.title}» deixa de aparecer para toda a equipa. Os comentários, anexos e histórico ficam guardados, mas esta ação não pode ser desfeita na aplicação.`,
                  run: async () => {
                    await api(
                      `/issues/${issue.id}`,
                      "DELETE",
                      undefined,
                      issue.version,
                    );
                    if (selectedId === issue.id) select(undefined);
                    toggle([issue], false);
                    refresh();
                  },
                }),
            },
          ]
        : []),
    ];
  };
  const memberOptions = members.map((member) => ({
    value: member.id,
    label: member.name,
  }));
  const cell = (issue: Issue, column: IssueColumn) => {
    switch (column) {
      case "id":
        return issueKey(issue.number);
      case "title": {
        // Imported titles come from the description: do not repeat them.
        const text = plainSnippet(issue.description);
        const snippet = text.startsWith(issue.title.replace(/…$/, ""))
          ? ""
          : text;
        return (
          <>
            <strong className="row-title">{issue.title}</strong>
            {snippet && <span className="row-description">{snippet}</span>}
          </>
        );
      }
      case "status":
        return <StatusTag status={statusOf(config.data, issue.statusId)} />;
      case "priority":
        return <Priority value={issue.priority} />;
      case "reporter":
        // Avatar only (photo or initials); the name is in the tooltip and for screen readers.
        return (
          <AvatarStack
            projectId={project.id}
            people={[{ id: issue.reporterId, name: issue.reporterName }]}
            members={members}
            label="Reporter"
          />
        );
      case "assignees":
        return (
          <AvatarStack
            projectId={project.id}
            people={issue.assignees}
            members={members}
            label="Responsáveis"
          />
        );
      case "reported":
        return day(issue.reportedAt);
      case "modules":
        return (
          <TagList ids={issue.moduleIds} items={config.data?.modules || []} />
        );
      case "labels":
        return (
          <TagList ids={issue.labelIds} items={config.data?.labels || []} />
        );
      case "estimate":
        return estimateText(issue.estimate);
      case "deployed":
        return dayText(issue.deployedAt);
      case "updated":
        return shortDate(issue.updatedAt);
    }
  };
  const visibleColumns = activeColumns.map((id) =>
    issueColumns.find((column) => column.id === id)!,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Desenvolvimento</h1>
          <p>Issues do projeto {project.name}</p>
        </div>
        <div className="heading-actions">
          {owner && (
            <Button
              icon={<ArrowUpTrayIcon />}
              onClick={() => setImporting(true)}
            >
              Importar
            </Button>
          )}
          {!viewer && (
            <Button
              variant="primary"
              icon={<PlusIcon />}
              disabled={!config.data}
              onClick={() => setForm({})}
            >
              Novo issue
            </Button>
          )}
        </div>
      </div>
      <div className="issue-tabs">
        {board ? (
          <h2 className="section-label">Issues ativos</h2>
        ) : (
          <Tabs
            label="Vista dos issues"
            value={archive}
            onChange={(value) => filter(() => setArchive(value))}
            tabs={[
              {
                value: "active",
                label: "Ativos",
                count: issues.data?.counts.active,
              },
              {
                value: "archived",
                label: "Arquivados",
                count: issues.data?.counts.archived,
              },
            ]}
          />
        )}
        <div
          className="view-switch"
          role="group"
          aria-label="Modo de visualização"
        >
          {(
            [
              ["table", "Tabela", <TableCellsIcon key="t" />],
              ["board", "Board", <ViewColumnsIcon key="b" />],
            ] as const
          ).map(([value, text, icon]) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              icon={icon}
              aria-pressed={activeView === value}
              onClick={() => {
                setView(value);
                setPage(1);
                remember("issues.view", value);
              }}
            >
              {text}
            </Button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <SearchField
          label="Pesquisar issues"
          placeholder="Filtrar issues ou pelo número (ex.: 12)…"
          value={query}
          onChange={(value) => filter(() => setQuery(value))}
        />
        <div className="toolbar-filters">
          {board ? (
            <Menu
              positioning="below-start"
              checkedValues={{
                statuses: boardStatuses.visible.map((item) => item.id),
              }}
              onCheckedValueChange={(_, data) => {
                // At least one column stays visible.
                if (!data.checkedItems.length) return;
                saveBoard({
                  order: boardStatuses.all.map((item) => item.id),
                  hidden: boardStatuses.all
                    .map((item) => item.id)
                    .filter((id) => !data.checkedItems.includes(id)),
                });
              }}
            >
              <MenuTrigger disableButtonEnhancement>
                <Button
                  size="sm"
                  icon={<ViewColumnsIcon />}
                  aria-label="Estados visíveis no board"
                >
                  Estados
                  {hiddenStatuses.length > 0 &&
                    ` · ${boardStatuses.visible.length}/${boardStatuses.all.length}`}
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {boardStatuses.all.map((item) => (
                    <MenuItemCheckbox
                      key={item.id}
                      name="statuses"
                      value={item.id}
                      disabled={
                        boardStatuses.visible.length === 1 &&
                        boardStatuses.visible[0].id === item.id
                      }
                    >
                      {item.name}
                    </MenuItemCheckbox>
                  ))}
                  <MenuDivider />
                  <MenuItem
                    icon={<ArrowPathIcon />}
                    onClick={() => saveBoard({ order: [], hidden: [] })}
                  >
                    Repor ordem e estados
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : (
            <MultiFilterMenu
              name="status"
              label="Estado"
              ariaLabel="Filtrar por estado"
              value={status}
              onChange={(value) => filter(() => setStatus(value))}
              options={[
                { value: "open", label: "Em aberto" },
                ...(config.data?.statuses || []).map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          )}
          <FilterMenu
            name="assignee"
            label="Responsável"
            ariaLabel="Filtrar por responsável"
            value={assignee}
            onChange={(value) => filter(() => setAssignee(value))}
            options={[
              { value: "all", label: "Todos" },
              { value: "me", label: "Os meus" },
              { value: "none", label: "Sem responsável" },
              ...memberOptions,
            ]}
          />
          <FilterMenu
            name="module"
            label="Módulo"
            ariaLabel="Filtrar por módulo"
            value={module}
            onChange={(value) => filter(() => setModule(value))}
            options={[
              { value: "all", label: "Todos" },
              ...(config.data?.modules || []).map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
          />
          <FilterMenu
            name="label"
            label="Label"
            ariaLabel="Filtrar por label"
            value={label}
            onChange={(value) => filter(() => setLabel(value))}
            options={[
              { value: "all", label: "Todas" },
              ...(config.data?.labels || []).map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
          />
          <FilterMenu
            name="priority"
            label="Prioridade"
            ariaLabel="Filtrar por prioridade"
            value={priority}
            onChange={(value) => filter(() => setPriority(value))}
            options={[
              { value: "all", label: "Todas" },
              ...[1, 2, 3, 4, 5].map((value) => ({
                value: String(value),
                label: priorityLabels[value],
              })),
              { value: "none", label: "Sem prioridade" },
            ]}
          />
          <FilterMenu
            name="reporter"
            label="Reporter"
            ariaLabel="Filtrar por reporter"
            value={reporter}
            onChange={(value) => filter(() => setReporter(value))}
            options={[{ value: "all", label: "Todos" }, ...memberOptions]}
          />
          {!board && (
            <>
              <FilterMenu
                sort
                name="sort"
                label="Ordenação"
                ariaLabel="Ordenar issues"
                value={sort}
                onChange={(value) => filter(() => setSort(value))}
                options={[
                  { value: "reported", label: "Criação recente" },
                  { value: "updated", label: "Atualização recente" },
                  { value: "priority", label: "Prioridade" },
                  { value: "number", label: "Número" },
                  { value: "title", label: "Título (A–Z)" },
                ]}
              />
              <Menu
                positioning="below-end"
                checkedValues={{ columns: activeColumns }}
                onCheckedValueChange={(_, data) => {
                  // Keep the current order; newly shown columns go to the end.
                  const kept = activeColumns.filter(
                    (id) =>
                      fixedColumns.includes(id) ||
                      data.checkedItems.includes(id),
                  );
                  const added = issueColumns
                    .map((column) => column.id)
                    .filter(
                      (id) =>
                        data.checkedItems.includes(id) && !kept.includes(id),
                    );
                  saveColumns([...kept, ...added]);
                }}
              >
                <MenuTrigger disableButtonEnhancement>
                  <Button size="sm" icon={<ViewColumnsIcon />}>
                    Colunas
                  </Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {issueColumns.map((column) => (
                      <MenuItemCheckbox
                        key={column.id}
                        name="columns"
                        value={column.id}
                        disabled={"fixed" in column && column.fixed}
                      >
                        {column.label}
                      </MenuItemCheckbox>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
            </>
          )}
        </div>
      </div>
      {selectable && config.data && (
        <div className="bulk-bar" role="group" aria-label="Ações em lote">
          <span className="bulk-count">
            {checkedList.length
              ? `${issueCount(checkedList.length)} ${checkedList.length === 1 ? "selecionado" : "selecionados"}`
              : "Selecione issues para ações em lote."}
          </span>
          {checkedList.length > 0 && (
            <>
              {archive === "archived" ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<ArrowPathIcon />}
                  onClick={() => bulk("restore", checkedList)}
                >
                  Restaurar selecionados
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<ArchiveBoxIcon />}
                  onClick={() => bulk("archive", checkedList)}
                >
                  Arquivar selecionados
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                icon={<TrashIcon />}
                onClick={() => bulk("delete", checkedList)}
              >
                Apagar selecionados
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked({})}>
                Limpar seleção
              </Button>
            </>
          )}
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Button
                size="sm"
                className="bulk-rule"
                icon={<ArchiveBoxIcon />}
                disabled={!doneStatuses.length}
              >
                Arquivar por regra
                <ChevronDownIcon className="btn-caret" aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {doneStatuses.map((item) => (
                  <MenuItem
                    key={item.id}
                    onClick={() =>
                      void archiveByRule([item.id], `em «${item.name}»`)
                    }
                  >
                    Arquivar todos em «{item.name}»
                  </MenuItem>
                ))}
                {doneStatuses.length > 1 && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      onClick={() =>
                        void archiveByRule(
                          doneStatuses.map((item) => item.id),
                          "em estados concluídos",
                        )
                      }
                    >
                      Arquivar todos os concluídos
                    </MenuItem>
                  </>
                )}
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && <ErrorMessage message={error} />}
      {issues.error && <ErrorMessage message={issues.error} />}
      {config.error && <ErrorMessage message={config.error} />}
      {!issues.data || !config.data ? (
        <Loading />
      ) : board ? (
        <IssueBoard
          issues={items}
          config={config.data}
          statuses={boardStatuses.visible}
          onReorder={moveStatus}
          project={project}
          members={members}
          actions={actions}
          readOnly={viewer}
          onOpen={select}
          onCreate={(statusId) => setForm({ statusId })}
          onMove={(issue, statusId, position) =>
            run(() =>
              api(
                `/issues/${issue.id}`,
                "PATCH",
                statusId === issue.statusId
                  ? { position }
                  : { statusId, position },
                issue.version,
              ),
            )
          }
        />
      ) : !items.length ? (
        <Empty
          title={
            archive === "archived"
              ? "Sem issues arquivados"
              : "Nenhum issue encontrado"
          }
        >
          {filtered
            ? "Experimente alterar os filtros."
            : archive === "archived"
              ? "Os issues arquivados aparecerão aqui com todo o histórico."
              : "Crie um issue ou importe uma folha de cálculo."}
        </Empty>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="data-table issue-table">
              <thead>
                <tr>
                  {selectable && (
                    <th className="select-column">
                      <input
                        type="checkbox"
                        aria-label="Selecionar os issues desta página"
                        checked={pageChecked === items.length}
                        ref={(input) => {
                          if (input)
                            input.indeterminate =
                              pageChecked > 0 && pageChecked < items.length;
                        }}
                        onChange={(event) =>
                          toggle(items, event.target.checked)
                        }
                      />
                    </th>
                  )}
                  {visibleColumns.map((column, index) => {
                    const fixed = fixedColumns.includes(column.id);
                    const target =
                      columnTarget?.id === column.id ? columnTarget : undefined;
                    return (
                      <th
                        key={column.id}
                        className={[
                          `issue-col-${column.id}`,
                          !fixed && "movable-column",
                          draggedColumn === column.id && "dragging",
                          target &&
                            (target.after ? "drop-after" : "drop-before"),
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        draggable={!fixed}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", column.id);
                          setDraggedColumn(column.id);
                        }}
                        onDragOver={(event) => {
                          if (!draggedColumn || fixed) return;
                          event.preventDefault();
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          const after =
                            event.clientX > rect.left + rect.width / 2;
                          if (
                            columnTarget?.id !== column.id ||
                            columnTarget.after !== after
                          )
                            setColumnTarget({ id: column.id, after });
                        }}
                        onDragLeave={() => setColumnTarget(undefined)}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedColumn && target)
                            moveColumn(draggedColumn, column.id, target.after);
                          setDraggedColumn(undefined);
                          setColumnTarget(undefined);
                        }}
                        onDragEnd={() => {
                          setDraggedColumn(undefined);
                          setColumnTarget(undefined);
                        }}
                      >
                        {fixed ? (
                          column.label
                        ) : (
                          <button
                            type="button"
                            className="column-handle"
                            title="Arraste para reordenar (Alt+← / Alt+→)"
                            aria-label={`Coluna ${column.label}: Alt+seta para a esquerda ou direita para mover`}
                            onKeyDown={(event) => {
                              if (
                                !event.altKey ||
                                (event.key !== "ArrowLeft" &&
                                  event.key !== "ArrowRight")
                              )
                                return;
                              event.preventDefault();
                              const neighbour =
                                visibleColumns[
                                  index + (event.key === "ArrowLeft" ? -1 : 1)
                                ];
                              if (
                                neighbour &&
                                !fixedColumns.includes(neighbour.id)
                              )
                                moveColumn(
                                  column.id,
                                  neighbour.id,
                                  event.key === "ArrowRight",
                                );
                            }}
                          >
                            {column.label}
                          </button>
                        )}
                      </th>
                    );
                  })}
                  <th className="action-column">
                    <span className="visually-hidden">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((issue) => (
                  <tr
                    key={issue.id}
                    className="clickable-row"
                    tabIndex={0}
                    aria-label={`Abrir ${issueKey(issue.number)} ${issue.title}`}
                    onClick={() => select(issue.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select(issue.id);
                      }
                    }}
                  >
                    {selectable && (
                      <td
                        className="select-column"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${issueKey(issue.number)} ${issue.title}`}
                          checked={!!checked[issue.id]}
                          onChange={(event) =>
                            toggle([issue], event.target.checked)
                          }
                        />
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.id}
                        className={`issue-col-${column.id}${column.id === "id" ? " id-column mono" : ""}${["reported", "updated", "deployed", "estimate"].includes(column.id) ? " mono" : ""}`}
                      >
                        {cell(issue, column.id)}
                      </td>
                    ))}
                    <td className="action-column">
                      <div
                        className="row-actions"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {!viewer && (
                          <OverflowActions
                            label={`Ações de ${issue.title}`}
                            actions={actions(issue)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!board && issues.data && issues.data.total > 0 && (
        <Pagination
          label="Paginação dos issues"
          noun={["issue", "issues"]}
          total={issues.data.total}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
      {selectedId && config.data && (
        <IssuePanel
          key={selectedId}
          issueId={selectedId}
          config={config.data}
          members={members}
          readOnly={viewer}
          userId={userId}
          sequence={items.map((issue) => issue.id)}
          revision={revision}
          focusActivity={
            focus?.issueId === selectedId ? focus.activityId : undefined
          }
          focusKey={focus}
          actions={actions}
          onNavigate={select}
          onClose={() => select(undefined)}
          onChanged={refresh}
        />
      )}
      {form && config.data && (
        <IssueForm
          projectId={project.id}
          issue={form.issue}
          config={config.data}
          members={assignable(members)}
          initialStatusId={form.statusId}
          userId={userId}
          onClose={() => setForm(undefined)}
          onSaved={(saved) => {
            refresh();
            if (!form.issue) select(saved.id);
          }}
        />
      )}
      {importing && config.data && (
        <Suspense fallback={null}>
          <IssueImport
            project={project}
            config={config.data}
            members={members}
            onClose={() => setImporting(false)}
            onImported={refresh}
          />
        </Suspense>
      )}
      {confirmation && (
        <Confirm
          title={confirmation.title}
          description={confirmation.description}
          onConfirm={confirmation.run}
          danger={confirmation.danger}
          confirmLabel={confirmation.danger ? "Apagar" : undefined}
          onClose={() => setConfirmation(null)}
        />
      )}
    </>
  );
}
