import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  ArchiveBoxXMarkIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  DocumentTextIcon,
  PaperClipIcon,
  PencilSquareIcon,
  PlusIcon,
  RocketLaunchIcon,
  TableCellsIcon,
  TrashIcon,
  ViewColumnsIcon,
} from "@heroicons/react/24/outline";
import {
  draftStateLabels,
  type DraftState,
  type DraftStep,
  type IssueColor,
  type IssueConfig,
  type IssueDraft,
  type Member,
  type Project,
} from "../shared/contracts";
import { api, useRemote } from "./api";
import {
  AttachmentList,
  PendingAttachments,
  useDirectUploads,
} from "./attachments";
import {
  Button,
  Confirm,
  Empty,
  ErrorMessage,
  IconButton,
  Loading,
  Markdown,
  MarkdownField,
  Modal,
  OverflowActions,
  SearchField,
  FilterMenu,
  MultiFilterMenu,
  scrollBoardNearEdge,
  type OverflowAction,
} from "./components";
import { IssueForm } from "./IssueForm";
import { Priority, priorityLabels, priorityOptions } from "./issueUi";
import { projectOptions } from "./Notes";
import { issueKey, plainSnippet, shortDate } from "./presentation";
import { personalHash, routeHash } from "./routes";
import { Select2 } from "./Select2";
import { TemplatePicker } from "./templates";

const columns: DraftState[] = ["todo", "doing", "done", "created", "discarded"];
const stateColors: Record<DraftState, IssueColor> = {
  todo: "amber",
  doing: "blue",
  done: "green",
  created: "purple",
  discarded: "gray",
};
type Movable = Exclude<DraftState, "created">;
const movable = (state: DraftState): state is Movable => state !== "created";
/** "Mover para …" for each other state the person can choose. */
const stateActions = (
  draft: IssueDraft,
  size: (state: DraftState) => number,
  move: (draft: IssueDraft, state: Movable, index: number) => void,
): OverflowAction[] =>
  movable(draft.state)
    ? columns
        .filter(
          (item): item is Movable => movable(item) && item !== draft.state,
        )
        .map((item) => ({
          label: `Mover para ${draftStateLabels[item]}`,
          icon: <ArrowRightIcon />,
          onClick: () => move(draft, item, size(item)),
        }))
    : [];
function StateTag({ state }: { state: DraftState }) {
  return (
    <span className={`tag tag-status tag-${stateColors[state]}`}>
      <span className="tag-dot" aria-hidden />
      {draftStateLabels[state]}
    </span>
  );
}
/** "2/5" checked steps, shown on cards and rows of tasks with steps. */
function StepProgress({ steps }: { steps: DraftStep[] }) {
  if (!steps.length) return null;
  const done = steps.filter((step) => step.done).length;
  return (
    <span
      className="board-card-comments mono"
      title={`${done} de ${steps.length} passos feitos`}
    >
      <CheckCircleIcon aria-hidden />
      {done}/{steps.length}
    </span>
  );
}
/** The steps go to the end of the issue's description as a Markdown checklist. */
const withSteps = (description: string, steps: DraftStep[]) =>
  steps.length
    ? [
        description.trim(),
        "## Passos",
        steps
          .map(
            (step) =>
              `- [${step.done ? "x" : " "}] ${step.body.replace(/\s+/g, " ")}`,
          )
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n")
    : description;
const projectText = (draft: IssueDraft) =>
  draft.projectName ||
  (draft.projectId ? "Projeto indisponível" : "Sem projeto");

/** «Issue criado» shows the latest first; the other columns keep the person's order. */
const columnOf = (drafts: IssueDraft[], state: DraftState) =>
  drafts
    .filter((draft) => draft.state === state)
    .sort((a, b) =>
      state === "created"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : a.position - b.position,
    );

type TaskSort = "updated" | "created" | "state" | "priority" | "title";
const taskOrder: Record<TaskSort, (a: IssueDraft, b: IssueDraft) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  state: (a, b) =>
    columns.indexOf(a.state) - columns.indexOf(b.state) ||
    a.position - b.position,
  priority: (a, b) =>
    (a.priority ?? 9) - (b.priority ?? 9) ||
    b.updatedAt.localeCompare(a.updatedAt),
  title: (a, b) => a.title.localeCompare(b.title, "pt-PT"),
};

/**
 * The person's tasks (stored as issue drafts), as a table or a board: Por fazer →
 * Em curso → Concluído, or turned into an issue (Issue criado), or Descartado.
 */
export function Drafts({
  draftId,
  projectId,
  projects,
  revision,
}: {
  draftId: string;
  projectId: string;
  projects: Project[];
  revision: number;
}) {
  const [changes, setChanges] = useState(0);
  const changed = () => setChanges((value) => value + 1);
  const drafts = useRemote<IssueDraft[]>("/me/drafts", revision + changes);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<DraftState[]>([]);
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState<TaskSort>("updated");
  const preferences = useRemote<Record<string, unknown>>("/me/preferences", 0);
  const [view, setView] = useState<"table" | "board">();
  const activeView =
    view ?? (preferences.data?.["drafts.view"] === "table" ? "table" : "board");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const open = (id = "") => {
    location.hash = personalHash("drafts", projectId, id).slice(1);
  };
  // Search, project and priority apply to both views; the state filter and the
  // order only to the table, where the board's columns are the states.
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("pt-PT");
    return (drafts.data || []).filter(
      (draft) =>
        (filter === "all" ||
          (filter === "none"
            ? !draft.projectId
            : draft.projectId === filter)) &&
        (priority === "all" ||
          (priority === "none"
            ? !draft.priority
            : draft.priority === Number(priority))) &&
        (!search ||
          `${draft.title} ${draft.description}`
            .toLocaleLowerCase("pt-PT")
            .includes(search)),
    );
  }, [drafts.data, filter, priority, query]);
  const rows = useMemo(
    () =>
      visible
        .filter((draft) => !states.length || states.includes(draft.state))
        .sort(taskOrder[sort]),
    [visible, states, sort],
  );
  const move = async (draft: IssueDraft, state: Movable, position: number) => {
    setError("");
    try {
      await api(`/me/drafts/${draft.id}/move`, "POST", { state, position });
    } catch (failure) {
      setError((failure as Error).message);
    }
    changed();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Tarefas</h1>
          <p>
            Só suas. Organize o dia com tarefas e passos para marcar, criadas à
            mão ou a partir dos itens de uma nota, e transforme em issue as que
            o forem.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<PlusIcon />}
          onClick={() => setCreating(true)}
        >
          Nova tarefa
        </Button>
      </div>
      <div className="issue-tabs">
        <h2 className="section-label">Todas as tarefas</h2>
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
                void api("/me/preferences/drafts.view", "PUT", {
                  value,
                }).catch(() => undefined);
              }}
            >
              {text}
            </Button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <SearchField
          label="Pesquisar tarefas"
          placeholder="Filtrar pelo título ou descrição…"
          value={query}
          onChange={setQuery}
        />
        <div className="toolbar-filters">
          {activeView === "table" && (
            <MultiFilterMenu
              name="state"
              label="Estado"
              ariaLabel="Filtrar por estado"
              value={states}
              onChange={setStates}
              options={columns.map((state) => ({
                value: state,
                label: draftStateLabels[state],
              }))}
            />
          )}
          <FilterMenu
            name="project"
            label="Projeto"
            ariaLabel="Filtrar por projeto"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Todos" },
              { value: "none", label: "Sem projeto" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
          />
          <FilterMenu
            name="priority"
            label="Prioridade"
            ariaLabel="Filtrar por prioridade"
            value={priority}
            onChange={setPriority}
            options={[
              { value: "all", label: "Todas" },
              ...[1, 2, 3, 4, 5].map((value) => ({
                value: String(value),
                label: priorityLabels[value],
              })),
              { value: "none", label: "Sem prioridade" },
            ]}
          />
          {activeView === "table" && (
            <FilterMenu
              sort
              name="sort"
              label="Ordenação"
              ariaLabel="Ordenar tarefas"
              value={sort}
              onChange={(value) => setSort(value as TaskSort)}
              options={[
                { value: "updated", label: "Atualização recente" },
                { value: "created", label: "Criação recente" },
                { value: "state", label: "Estado" },
                { value: "priority", label: "Prioridade" },
                { value: "title", label: "Título (A–Z)" },
              ]}
            />
          )}
        </div>
      </div>
      {error && <ErrorMessage message={error} />}
      {drafts.error && <ErrorMessage message={drafts.error} />}
      {!drafts.data || (!view && preferences.loading) ? (
        <Loading />
      ) : activeView === "table" ? (
        <DraftTable
          drafts={rows}
          filtered={rows.length < (drafts.data?.length ?? 0)}
          projectId={projectId}
          onOpen={open}
          actions={(draft) =>
            stateActions(
              draft,
              (state) => columnOf(drafts.data!, state).length,
              (item, state, index) => void move(item, state, index),
            )
          }
        />
      ) : (
        <DraftBoard drafts={visible} onOpen={open} onMove={move} />
      )}
      {draftId && (
        <DraftPanel
          key={draftId}
          draftId={draftId}
          projects={projects}
          projectId={projectId}
          onChanged={changed}
          onClose={() => open()}
        />
      )}
      {creating && (
        <NewDraft
          projects={projects}
          projectId={filter !== "all" && filter !== "none" ? filter : projectId}
          onClose={() => setCreating(false)}
          onCreated={(draft) => {
            changed();
            open(draft.id);
          }}
        />
      )}
    </>
  );
}

function DraftBoard({
  drafts,
  onOpen,
  onMove,
}: {
  drafts: IssueDraft[];
  onOpen(id: string): void;
  onMove(draft: IssueDraft, state: Movable, position: number): Promise<void>;
}) {
  // Local order so a drop shows immediately; the next refresh brings the server's.
  const [items, setItems] = useState(drafts);
  useEffect(() => setItems(drafts), [drafts]);
  const [dragged, setDragged] = useState<string>();
  const [target, setTarget] = useState<{ state: Movable; index: number }>();
  const column = (state: DraftState) => columnOf(items, state);
  async function move(draft: IssueDraft, state: Movable, index: number) {
    const from = column(draft.state).findIndex((item) => item.id === draft.id);
    // `index` counts the dragged card when it stays in its column.
    const position = state === draft.state && index > from ? index - 1 : index;
    if (state === draft.state && position === from) return;
    const destination = column(state).filter((item) => item.id !== draft.id);
    destination.splice(position, 0, { ...draft, state });
    setItems((current) => [
      ...current.filter((item) => item.state !== state && item.id !== draft.id),
      ...destination.map((item, order) => ({ ...item, position: order })),
    ]);
    await onMove(draft, state, position);
  }
  const dropIndex = (event: DragEvent<HTMLElement>, state: Movable) => {
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-card]"),
    ];
    const index = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    return { state, index: index < 0 ? cards.length : index };
  };
  return (
    <div
      className="board draft-board"
      onDragOver={scrollBoardNearEdge}
      role="list"
      aria-label="Board de tarefas"
    >
      {columns.map((state) => {
        const cards = column(state);
        const droppable = movable(state);
        return (
          <section
            key={state}
            className={[
              "board-column",
              `draft-column-${state}`,
              target?.state === state && "board-drop",
            ]
              .filter(Boolean)
              .join(" ")}
            role="listitem"
            aria-label={`${draftStateLabels[state]}: ${cards.length} tarefas`}
            onDragOver={(event) => {
              if (!dragged || !droppable) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const next = dropIndex(event, state);
              if (next.state !== target?.state || next.index !== target?.index)
                setTarget(next);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setTarget(undefined);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!droppable) return;
              const draft = items.find((item) => item.id === dragged);
              const drop = dropIndex(event, state);
              setDragged(undefined);
              setTarget(undefined);
              if (draft) void move(draft, drop.state, drop.index);
            }}
          >
            <header className="board-column-header">
              <StateTag state={state} />
              <span className="count-pill mono">{cards.length}</span>
            </header>
            <ol className="board-cards">
              {cards.map((draft, index) => {
                const open = movable(draft.state);
                const keyboard: OverflowAction[] = open
                  ? [
                      {
                        label: "Mover para cima",
                        icon: <ArrowUpIcon />,
                        disabled: index === 0,
                        onClick: () =>
                          void move(draft, draft.state as Movable, index - 1),
                      },
                      {
                        label: "Mover para baixo",
                        icon: <ArrowDownIcon />,
                        disabled: index === cards.length - 1,
                        onClick: () =>
                          void move(draft, draft.state as Movable, index + 2),
                      },
                      ...stateActions(
                        draft,
                        (state) => column(state).length,
                        (item, state, index) => void move(item, state, index),
                      ),
                    ]
                  : [];
                return (
                  <li
                    key={draft.id}
                    data-card
                    className={[
                      "board-card",
                      dragged === draft.id && "dragging",
                      target?.state === state &&
                        target.index === index &&
                        "drop-before",
                      target?.state === state &&
                        target.index === cards.length &&
                        index === cards.length - 1 &&
                        "drop-after",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={open}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", draft.id);
                      setDragged(draft.id);
                    }}
                    onDragEnd={() => {
                      setDragged(undefined);
                      setTarget(undefined);
                    }}
                  >
                    <button
                      type="button"
                      className="board-card-open"
                      onClick={() => onOpen(draft.id)}
                    >
                      {draft.issueNumber && (
                        <span className="board-card-key mono">
                          {issueKey(draft.issueNumber)}
                        </span>
                      )}
                      <strong>{draft.title}</strong>
                    </button>
                    <div className="board-card-tags">
                      {draft.priority && <Priority value={draft.priority} />}
                      <span className="draft-project">
                        {projectText(draft)}
                      </span>
                    </div>
                    <footer className="board-card-footer">
                      {draft.noteTitle ? (
                        <span className="draft-source" title="Nota de origem">
                          <DocumentTextIcon aria-hidden />
                          {draft.noteTitle}
                        </span>
                      ) : (
                        <span />
                      )}
                      <StepProgress steps={draft.steps} />
                      {draft.attachments.length > 0 && (
                        <span
                          className="board-card-comments mono"
                          title={`${draft.attachments.length} anexos`}
                        >
                          <PaperClipIcon aria-hidden />
                          {draft.attachments.length}
                        </span>
                      )}
                      {keyboard.length > 0 && (
                        <OverflowActions
                          label={`Ações de ${draft.title}`}
                          actions={keyboard}
                        />
                      )}
                    </footer>
                  </li>
                );
              })}
            </ol>
            {!cards.length && <p className="board-empty muted">Sem tarefas</p>}
          </section>
        );
      })}
    </div>
  );
}

function DraftTable({
  drafts,
  filtered,
  projectId,
  onOpen,
  actions,
}: {
  drafts: IssueDraft[];
  /** Some tasks are hidden by the search or the filters. */
  filtered: boolean;
  projectId: string;
  onOpen(id: string): void;
  actions(draft: IssueDraft): OverflowAction[];
}) {
  if (!drafts.length)
    return filtered ? (
      <Empty title="Nenhuma tarefa encontrada">
        Mude a pesquisa ou os filtros para ver outras tarefas.
      </Empty>
    ) : (
      <Empty title="Sem tarefas">
        Crie tarefas a partir dos itens de uma nota ou com «Nova tarefa».
      </Empty>
    );
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="data-table draft-table">
          <thead>
            <tr>
              <th>Tarefa</th>
              <th>Estado</th>
              <th>Projeto</th>
              <th>Prioridade</th>
              <th>Nota de origem</th>
              <th>Issue</th>
              <th className="date-column">Atualizado</th>
              <th className="action-column">
                <span className="visually-hidden">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const snippet = plainSnippet(draft.description);
              const menu = actions(draft);
              return (
                <tr
                  key={draft.id}
                  className="clickable-row"
                  tabIndex={0}
                  aria-label={`Abrir tarefa ${draft.title}`}
                  onClick={() => onOpen(draft.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(draft.id);
                    }
                  }}
                >
                  <td>
                    <strong className="row-title">
                      {draft.title}
                      <StepProgress steps={draft.steps} />
                      {draft.attachments.length > 0 && (
                        <span
                          className="board-card-comments mono"
                          title={`${draft.attachments.length} anexos`}
                        >
                          <PaperClipIcon aria-hidden />
                          {draft.attachments.length}
                        </span>
                      )}
                    </strong>
                    {snippet && (
                      <span className="row-description">{snippet}</span>
                    )}
                  </td>
                  <td>
                    <StateTag state={draft.state} />
                  </td>
                  <td className={draft.projectName ? "" : "muted"}>
                    {projectText(draft)}
                  </td>
                  <td>
                    <Priority value={draft.priority} />
                  </td>
                  <td>
                    {draft.noteId ? (
                      <a
                        href={personalHash("notes", projectId, draft.noteId)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {draft.noteTitle}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono">
                    {draft.issueNumber && draft.issueId && draft.projectId ? (
                      <a
                        href={routeHash(draft.projectId, "", "dev", {
                          issue: draft.issueId,
                        })}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {issueKey(draft.issueNumber)}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="date-column mono">
                    {shortDate(draft.updatedAt)}
                  </td>
                  <td className="action-column">
                    <div
                      className="row-actions"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {menu.length > 0 && (
                        <OverflowActions
                          label={`Ações de ${draft.title}`}
                          actions={menu}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** «Nova tarefa» opens the whole task in a drawer; files are added once it exists. */
function NewDraft({
  projects,
  projectId,
  onClose,
  onCreated,
}: {
  projects: Project[];
  projectId: string;
  onClose(): void;
  onCreated(draft: IssueDraft): void;
}) {
  const writable = projects.some(
    (project) => project.id === projectId && project.role !== "viewer",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState(writable ? projectId : "");
  const [priority, setPriority] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const templates = useRemote<IssueConfig>(
    project ? `/projects/${project}/issue-config` : null,
    0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Nova tarefa"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const [draft] = await api<IssueDraft[]>("/me/drafts", "POST", {
              projectId: project || null,
              priority: priority ? Number(priority) : null,
              items: [
                {
                  title,
                  description,
                  steps: steps
                    .map((step) => ({ ...step, body: step.body.trim() }))
                    .filter((step) => step.body),
                },
              ],
            });
            onClose();
            onCreated(draft);
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Título
          <input
            required
            autoFocus
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <TemplatePicker
          templates={templates.data?.templates || []}
          description={description}
          onLoad={setDescription}
        />
        <MarkdownField
          label="Descrição"
          value={description}
          onChange={setDescription}
          references
        />
        <TaskSteps steps={steps} onChange={setSteps} />
        <div className="form-grid">
          <div className="field">
            <Select2
              showLabel
              label="Projeto"
              value={project}
              options={projectOptions(projects)}
              onChange={setProject}
            />
          </div>
          <div className="field">
            <Select2
              showLabel
              label="Prioridade"
              value={priority}
              options={priorityOptions}
              onChange={setPriority}
            />
          </div>
        </div>
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabledFocusable={busy}>
            {busy ? "A criar…" : "Criar tarefa"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** States a task moves through by hand, shown as a bar at the bottom of the drawer. */
const taskStates: { state: Movable; label: string }[] = [
  { state: "todo", label: "Por fazer" },
  { state: "doing", label: "Em curso" },
  { state: "done", label: "Concluído" },
];

/**
 * A task in a drawer like a test of a suite: details, description and numbered
 * steps to tick, with the state at the bottom. «Editar» opens the fields.
 */
function DraftPanel({
  draftId,
  projects,
  projectId,
  onChanged,
  onClose,
}: {
  draftId: string;
  projects: Project[];
  projectId: string;
  onChanged(): void;
  onClose(): void;
}) {
  const [reload, setReload] = useState(0);
  const remote = useRemote<IssueDraft>(`/me/drafts/${draftId}`, reload);
  const draft = remote.data;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [editing, setEditing] = useState<boolean>();
  const reset = (current: IssueDraft) => {
    setTitle(current.title);
    setDescription(current.description);
    setProject(current.projectId || "");
    setPriority(current.priority ? String(current.priority) : "");
    setSteps(current.steps);
  };
  useEffect(() => {
    if (!draft) return;
    reset(draft);
    // A task with nothing written yet opens for editing.
    setEditing(
      (current) =>
        current ??
        (draft.state !== "created" &&
          !draft.description.trim() &&
          !draft.steps.length),
    );
  }, [draft]);
  // Templates of the chosen project, besides the built-in ones.
  const templates = useRemote<IssueConfig>(
    editing && projects.some((item) => item.id === project)
      ? `/projects/${project}/issue-config`
      : null,
    0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [issueForm, setIssueForm] = useState<{
    config: IssueConfig;
    members: Member[];
    draft: IssueDraft;
  }>();
  const uploads = useDirectUploads({ draftId }, () =>
    setReload((value) => value + 1),
  );
  const refresh = () => {
    setReload((value) => value + 1);
    onChanged();
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Empty steps are left out when saving.
  const cleanSteps = steps
    .map((step) => ({ ...step, body: step.body.trim() }))
    .filter((step) => step.body);
  const dirty =
    !!draft &&
    (title !== draft.title ||
      description !== draft.description ||
      project !== (draft.projectId || "") ||
      priority !== (draft.priority ? String(draft.priority) : "") ||
      JSON.stringify(cleanSteps) !== JSON.stringify(draft.steps));
  const save = async () => {
    if (!draft || !dirty) return draft;
    const saved = await api<IssueDraft>(
      `/me/drafts/${draftId}`,
      "PATCH",
      {
        title,
        description,
        projectId: project || null,
        priority: priority ? Number(priority) : null,
        steps: cleanSteps,
      },
      draft.version,
    );
    refresh();
    return saved;
  };
  /** Ticking a step while reading saves it at once. */
  const check = (index: number) =>
    draft &&
    void run(async () => {
      await api(
        `/me/drafts/${draftId}`,
        "PATCH",
        {
          steps: draft.steps.map((step, position) =>
            position === index ? { ...step, done: !step.done } : step,
          ),
        },
        draft.version,
      );
      refresh();
    });
  const move = (state: Movable) =>
    run(async () => {
      // The server keeps the position within the column; this puts it last.
      await api(`/me/drafts/${draftId}/move`, "POST", {
        state,
        position: 100000,
      });
      refresh();
    });
  const created = draft?.state === "created";
  const target = projects.find((item) => item.id === project);
  const writable = !!target && target.role !== "viewer";
  const done = draft?.steps.filter((step) => step.done).length ?? 0;
  const createIssue = () =>
    void run(async () => {
      const current = (await save()) || draft!;
      const [config, members] = await Promise.all([
        api<IssueConfig>(`/projects/${project}/issue-config`),
        api<Member[]>(`/projects/${project}/members`),
      ]);
      setIssueForm({
        config,
        members,
        draft: {
          ...current,
          description: withSteps(current.description, current.steps),
        },
      });
    });
  return (
    <Modal
      title={draft?.title || "Tarefa"}
      onClose={() => {
        if (!busy) onClose();
      }}
      toolbar={
        <span className="drawer-path">
          {draft ? draftStateLabels[draft.state] : "…"}
        </span>
      }
      actions={
        draft &&
        !created && (
          <>
            {!editing && (
              <IconButton
                icon={<PencilSquareIcon />}
                label="Editar tarefa"
                onClick={() => setEditing(true)}
              />
            )}
            <OverflowActions
              label={`Ações de ${draft.title}`}
              actions={[
                {
                  label: "Criar issue",
                  icon: <RocketLaunchIcon />,
                  disabled: !writable,
                  onClick: createIssue,
                },
                ...(draft.state === "discarded"
                  ? [
                      {
                        label: "Repor em Por fazer",
                        icon: <ArrowUturnLeftIcon />,
                        onClick: () => void move("todo"),
                      },
                      {
                        label: "Eliminar tarefa",
                        icon: <TrashIcon />,
                        onClick: () => setRemoving(true),
                      },
                    ]
                  : [
                      {
                        label: "Descartar",
                        icon: <ArchiveBoxXMarkIcon />,
                        onClick: () => void move("discarded"),
                      },
                    ]),
              ]}
            />
          </>
        )
      }
      footer={
        draft &&
        !created &&
        !editing && (
          <div className="drawer-footer">
            <div
              className="result-bar"
              role="group"
              aria-labelledby="task-state-label"
            >
              <span className="result-label" id="task-state-label">
                Estado
              </span>
              {taskStates.map(({ state, label }) => (
                <Button
                  key={state}
                  className={`result-button task-state-${state}`}
                  aria-pressed={draft.state === state}
                  icon={<CheckIcon />}
                  disabled={busy}
                  onClick={() => {
                    if (draft.state !== state) void move(state);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Button
              className="next-test"
              icon={<RocketLaunchIcon />}
              disabledFocusable={busy || !writable}
              title={
                writable
                  ? undefined
                  : "Escolha um projeto onde possa criar issues."
              }
              onClick={createIssue}
            >
              Criar issue
            </Button>
          </div>
        )
      }
    >
      {remote.error && !draft && <ErrorMessage message={remote.error} />}
      {!draft ? (
        !remote.error && <Loading />
      ) : !editing ? (
        <>
          {created && (
            <p className="notice">
              {draft.issueNumber && draft.issueId && draft.projectId ? (
                <>
                  Deu origem a{" "}
                  <a
                    href={routeHash(draft.projectId, "", "dev", {
                      issue: draft.issueId,
                    })}
                  >
                    {issueKey(draft.issueNumber)}
                  </a>{" "}
                  em {draft.projectName}.
                </>
              ) : (
                "Deu origem a um issue que já não está disponível."
              )}
            </p>
          )}
          <dl className="meta-list test-meta-list">
            <div>
              <dt>Estado</dt>
              <dd>
                <StateTag state={draft.state} />
              </dd>
            </div>
            <div>
              <dt>Prioridade</dt>
              <dd>
                <Priority value={draft.priority} />
              </dd>
            </div>
            <div>
              <dt>Projeto</dt>
              <dd className={draft.projectName ? "accent" : "muted"}>
                {projectText(draft)}
              </dd>
            </div>
            {draft.steps.length > 0 && (
              <div>
                <dt>Passos</dt>
                <dd className="mono">
                  {done}/{draft.steps.length} feitos
                </dd>
              </div>
            )}
            {draft.noteId && (
              <div>
                <dt>Nota de origem</dt>
                <dd>
                  <a href={personalHash("notes", projectId, draft.noteId)}>
                    {draft.noteTitle}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {error && <ErrorMessage message={error} />}
          <section className="drawer-section">
            <h3 className="section-label">Descrição</h3>
            {draft.description.trim() ? (
              <Markdown>{draft.description}</Markdown>
            ) : (
              <p className="muted">Sem descrição.</p>
            )}
          </section>
          {draft.steps.length > 0 && (
            <section className="drawer-section">
              <h3 className="section-label">Passos</h3>
              <ol className="steps">
                {draft.steps.map((step, index) => (
                  <li
                    key={index}
                    className={`step ${step.done ? "step-done" : ""}`}
                  >
                    <span className="step-number mono" aria-hidden>
                      {index + 1}
                    </span>
                    <div className="step-text">
                      <Markdown>{step.body}</Markdown>
                    </div>
                    <div className="step-actions">
                      <IconButton
                        size="sm"
                        variant="secondary"
                        className="step-mark-pass"
                        icon={<CheckIcon />}
                        label={`Passo ${index + 1}: feito`}
                        aria-pressed={step.done}
                        disabled={busy || created}
                        onClick={() => check(index)}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {draft.attachments.length > 0 && (
            <section className="drawer-section">
              <h3 className="section-label">Anexos</h3>
              <AttachmentList files={draft.attachments} personal />
            </section>
          )}
          {created && draft.issueId && draft.projectId && (
            <div className="form-actions">
              <Button
                icon={<ArrowTopRightOnSquareIcon />}
                onClick={() => {
                  location.hash = routeHash(draft.projectId!, "", "dev", {
                    issue: draft.issueId,
                  }).slice(1);
                }}
              >
                Abrir o issue
              </Button>
            </div>
          )}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(save).then((ok) => ok && setEditing(false));
          }}
        >
          <label className="field">
            Título
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <TemplatePicker
            templates={templates.data?.templates || []}
            description={description}
            onLoad={setDescription}
          />
          <MarkdownField
            label="Descrição"
            value={description}
            onChange={setDescription}
            references
            onFiles={uploads.add}
            footer={
              <PendingAttachments
                files={uploads.files}
                onRemove={uploads.remove}
              />
            }
          />
          <AttachmentList
            files={draft.attachments}
            personal
            onRemove={(file) =>
              void run(async () => {
                await api(`/me/attachments/${file.id}`, "DELETE");
                refresh();
              })
            }
          />
          <TaskSteps steps={steps} onChange={setSteps} />
          <div className="form-grid">
            <div className="field">
              <Select2
                showLabel
                label="Projeto"
                value={project}
                options={projectOptions(projects)}
                onChange={setProject}
              />
            </div>
            <div className="field">
              <Select2
                showLabel
                label="Prioridade"
                value={priority}
                options={priorityOptions}
                onChange={setPriority}
              />
            </div>
          </div>
          {error && <ErrorMessage message={error} />}
          <div className="form-actions">
            <Button
              disabled={busy}
              onClick={() => {
                reset(draft);
                setError("");
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabledFocusable={busy}>
              {busy ? "A guardar…" : "Guardar"}
            </Button>
          </div>
        </form>
      )}
      {issueForm && (
        <IssueForm
          projectId={project}
          config={issueForm.config}
          members={issueForm.members}
          draft={issueForm.draft}
          onClose={() => setIssueForm(undefined)}
          onSaved={refresh}
        />
      )}
      {removing && (
        <Confirm
          title="Eliminar tarefa"
          description="A tarefa, os seus passos e anexos deixam de existir."
          confirmLabel="Eliminar"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await api(`/me/drafts/${draftId}`, "DELETE");
            onChanged();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

/** Steps of a task while editing: text, order and done, like the steps of a test. */
function TaskSteps({
  steps,
  onChange,
}: {
  steps: DraftStep[];
  onChange(steps: DraftStep[]): void;
}) {
  const done = steps.filter((step) => step.done).length;
  const update = (index: number, body: string) =>
    onChange(
      steps.map((step, position) =>
        position === index ? { ...step, body } : step,
      ),
    );
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="field steps-editor task-steps">
      <legend>
        Passos
        {steps.length > 0 && (
          <span className="muted mono">
            {" "}
            · {done}/{steps.length}
          </span>
        )}
      </legend>
      {steps.length > 0 && (
        <ol>
          {steps.map((step, index) => (
            <li key={index} className={step.done ? "done" : ""}>
              <input
                type="checkbox"
                aria-label={`Passo ${index + 1} feito`}
                checked={step.done}
                onChange={() =>
                  onChange(
                    steps.map((item, position) =>
                      position === index ? { ...item, done: !item.done } : item,
                    ),
                  )
                }
              />
              <textarea
                rows={1}
                aria-label={`Passo ${index + 1}`}
                value={step.body}
                maxLength={2000}
                autoFocus={!step.body && index === steps.length - 1}
                onChange={(event) => update(index, event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the next step; Shift+Enter breaks the line.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (step.body.trim() && steps.length < 100)
                      onChange([
                        ...steps.slice(0, index + 1),
                        { body: "", done: false },
                        ...steps.slice(index + 1),
                      ]);
                  }
                }}
              />
              <IconButton
                size="sm"
                icon={<ArrowUpIcon />}
                label={`Mover passo ${index + 1} para cima`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              />
              <IconButton
                size="sm"
                icon={<ArrowDownIcon />}
                label={`Mover passo ${index + 1} para baixo`}
                disabled={index === steps.length - 1}
                onClick={() => move(index, 1)}
              />
              <IconButton
                size="sm"
                icon={<TrashIcon />}
                label={`Remover passo ${index + 1}`}
                onClick={() =>
                  onChange(steps.filter((_, position) => position !== index))
                }
              />
            </li>
          ))}
        </ol>
      )}
      <Button
        size="sm"
        variant="dashed"
        icon={<PlusIcon />}
        disabled={steps.length >= 100}
        onClick={() => onChange([...steps, { body: "", done: false }])}
      >
        Adicionar passo
      </Button>
    </fieldset>
  );
}
