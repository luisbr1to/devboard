import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  ArchiveBoxXMarkIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  DocumentTextIcon,
  PaperClipIcon,
  PlusIcon,
  RocketLaunchIcon,
  TableCellsIcon,
  TrashIcon,
  ViewColumnsIcon,
} from "@heroicons/react/24/outline";
import {
  draftStateLabels,
  type DraftState,
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
  Loading,
  Markdown,
  MarkdownField,
  Modal,
  OverflowActions,
  SearchField,
  Tabs,
  type OverflowAction,
} from "./components";
import { IssueForm } from "./IssueForm";
import { Priority, priorityOptions } from "./issueUi";
import { projectOptions } from "./Notes";
import { issueKey, plainSnippet, shortDate } from "./presentation";
import { personalHash, routeHash } from "./routes";
import { Select2 } from "./Select2";

const columns: DraftState[] = ["review", "ready", "created", "discarded"];
const stateColors: Record<DraftState, IssueColor> = {
  review: "amber",
  ready: "blue",
  created: "green",
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
const projectText = (draft: IssueDraft) =>
  draft.projectName ||
  (draft.projectId ? "Projeto indisponível" : "Sem projeto");

/** "Criado" shows the latest first; the other columns keep the person's order. */
const columnOf = (drafts: IssueDraft[], state: DraftState) =>
  drafts
    .filter((draft) => draft.state === state)
    .sort((a, b) =>
      state === "created"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : a.position - b.position,
    );

/** The person's issue drafts, as a table or a board: Por rever → Pronto a criar → Criado / Descartado. */
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
  const [tab, setTab] = useState<DraftState | "all">("review");
  const preferences = useRemote<Record<string, unknown>>("/me/preferences", 0);
  const [view, setView] = useState<"table" | "board">();
  const activeView =
    view ?? (preferences.data?.["drafts.view"] === "table" ? "table" : "board");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const open = (id = "") => {
    location.hash = personalHash("drafts", projectId, id).slice(1);
  };
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("pt-PT");
    return (drafts.data || []).filter(
      (draft) =>
        (filter === "all" ||
          (filter === "none"
            ? !draft.projectId
            : draft.projectId === filter)) &&
        (!search ||
          `${draft.title} ${draft.description}`
            .toLocaleLowerCase("pt-PT")
            .includes(search)),
    );
  }, [drafts.data, filter, query]);
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
          <h1>Rascunhos de issues</h1>
          <p>
            Só seus. Crie-os a partir dos itens de uma nota e transforme-os em
            issues quando estiverem prontos.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<PlusIcon />}
          onClick={() => setCreating(true)}
        >
          Novo rascunho
        </Button>
      </div>
      <div className="toolbar">
        <SearchField
          label="Pesquisar rascunhos"
          placeholder="Filtrar pelo título ou descrição…"
          value={query}
          onChange={setQuery}
        />
        <div className="draft-filter">
          <Select2
            label="Filtrar por projeto"
            value={filter}
            options={[
              { value: "all", label: "Todos os projetos" },
              { value: "none", label: "Sem projeto" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            onChange={setFilter}
          />
        </div>
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
      {error && <ErrorMessage message={error} />}
      {drafts.error && <ErrorMessage message={drafts.error} />}
      {!drafts.data || (!view && preferences.loading) ? (
        <Loading />
      ) : activeView === "table" ? (
        <>
          <div className="draft-tabs">
            <Tabs<DraftState | "all">
              label="Estado dos rascunhos"
              value={tab}
              onChange={setTab}
              tabs={[
                ...columns.map((state) => ({
                  value: state,
                  label: draftStateLabels[state],
                  count: visible.filter((draft) => draft.state === state)
                    .length,
                })),
                {
                  value: "all" as const,
                  label: "Todos",
                  count: visible.length,
                },
              ]}
            />
          </div>
          <DraftTable
            drafts={
              tab === "all"
                ? columns.flatMap((state) => columnOf(visible, state))
                : columnOf(visible, tab)
            }
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
        </>
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
      role="list"
      aria-label="Board de rascunhos"
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
            aria-label={`${draftStateLabels[state]}: ${cards.length} rascunhos`}
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
            {!cards.length && (
              <p className="board-empty muted">Sem rascunhos</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DraftTable({
  drafts,
  projectId,
  onOpen,
  actions,
}: {
  drafts: IssueDraft[];
  projectId: string;
  onOpen(id: string): void;
  actions(draft: IssueDraft): OverflowAction[];
}) {
  if (!drafts.length)
    return (
      <Empty title="Sem rascunhos">
        Crie rascunhos a partir dos itens de uma nota ou com «Novo rascunho».
      </Empty>
    );
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="data-table draft-table">
          <thead>
            <tr>
              <th>Rascunho</th>
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
                  aria-label={`Abrir rascunho ${draft.title}`}
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
  const [title, setTitle] = useState("");
  const writable = projects.some(
    (project) => project.id === projectId && project.role !== "viewer",
  );
  const [project, setProject] = useState(writable ? projectId : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Novo rascunho"
      variant="modal"
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
              items: [{ title }],
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
        <div className="field">
          <Select2
            showLabel
            label="Projeto"
            value={project}
            options={projectOptions(projects)}
            onChange={setProject}
          />
        </div>
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabledFocusable={busy}>
            {busy ? "A criar…" : "Criar rascunho"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Edits a draft and turns it into an issue of its project. */
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
  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setProject(draft.projectId || "");
    setPriority(draft.priority ? String(draft.priority) : "");
  }, [draft]);
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
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dirty =
    !!draft &&
    (title !== draft.title ||
      description !== draft.description ||
      project !== (draft.projectId || "") ||
      priority !== (draft.priority ? String(draft.priority) : ""));
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
      },
      draft.version,
    );
    refresh();
    return saved;
  };
  const created = draft?.state === "created";
  const target = projects.find((item) => item.id === project);
  const writable = !!target && target.role !== "viewer";
  return (
    <Modal
      title={draft?.title || "Rascunho"}
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
          <OverflowActions
            label={`Ações de ${draft.title}`}
            actions={
              draft.state === "discarded"
                ? [
                    {
                      label: "Repor em Por rever",
                      icon: <ArrowUturnLeftIcon />,
                      onClick: () =>
                        void run(async () => {
                          await api(`/me/drafts/${draftId}/move`, "POST", {
                            state: "review",
                            position: 0,
                          });
                          refresh();
                        }),
                    },
                    {
                      label: "Eliminar rascunho",
                      icon: <TrashIcon />,
                      onClick: () => setRemoving(true),
                    },
                  ]
                : [
                    {
                      label: "Descartar",
                      icon: <ArchiveBoxXMarkIcon />,
                      onClick: () =>
                        void run(async () => {
                          await api(`/me/drafts/${draftId}/move`, "POST", {
                            state: "discarded",
                            position: 0,
                          });
                          refresh();
                        }),
                    },
                  ]
            }
          />
        )
      }
    >
      {remote.error && !draft && <ErrorMessage message={remote.error} />}
      {!draft ? (
        !remote.error && <Loading />
      ) : created ? (
        <>
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
          <h3 className="section-label">Descrição do rascunho</h3>
          <Markdown>{draft.description}</Markdown>
          <AttachmentList files={draft.attachments} personal />
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(save);
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
          {draft.noteId && (
            <p className="muted">
              Da nota{" "}
              <a href={personalHash("notes", projectId, draft.noteId)}>
                {draft.noteTitle}
              </a>
              .
            </p>
          )}
          {error && <ErrorMessage message={error} />}
          <div className="form-actions">
            <Button type="submit" disabledFocusable={busy || !dirty}>
              {busy ? "A guardar…" : "Guardar"}
            </Button>
            <Button
              variant="primary"
              icon={<RocketLaunchIcon />}
              disabledFocusable={busy || !writable}
              title={
                writable
                  ? undefined
                  : "Escolha um projeto onde possa criar issues."
              }
              onClick={() =>
                void run(async () => {
                  const current = (await save()) || draft;
                  const [config, members] = await Promise.all([
                    api<IssueConfig>(`/projects/${project}/issue-config`),
                    api<Member[]>(`/projects/${project}/members`),
                  ]);
                  setIssueForm({
                    config,
                    members,
                    draft: {
                      ...current,
                      title,
                      description,
                      priority: priority ? Number(priority) : null,
                    },
                  });
                })
              }
            >
              Criar issue
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
          title="Eliminar rascunho"
          description="O rascunho e os seus anexos deixam de existir."
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
      {draft && created && draft.issueId && draft.projectId && (
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
    </Modal>
  );
}
