import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArchiveBoxXMarkIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentPlusIcon,
  DocumentTextIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  RectangleStackIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  draftStateLabels,
  type IssueDraft,
  type Note,
  type NoteFolder,
  type NoteSummary,
  type NoteTag,
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
  Tabs,
  date,
} from "./components";
import { priorityOptions } from "./issueUi";
import { noteItems, sourceKey } from "./noteItems";
import { personalHash } from "./routes";
import { Select2, type SelectOption } from "./Select2";

/** Folder names with their parents ("Reuniões / 2026"), in tree order. */
function folderPaths(folders: NoteFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path = (folder: NoteFolder): string => {
    const parent = folder.parentId && byId.get(folder.parentId);
    return parent ? `${path(parent)} / ${folder.name}` : folder.name;
  };
  return folders
    .map((folder) => ({ ...folder, path: path(folder) }))
    .sort((a, b) => a.path.localeCompare(b.path, "pt-PT"));
}
export const projectOptions = (projects: Project[]): SelectOption[] => [
  {
    value: "",
    label: "Sem projeto",
    render: <span className="muted">Sem projeto</span>,
  },
  ...projects
    .filter((project) => project.role !== "viewer")
    .map((project) => ({ value: project.id, label: project.name })),
];

/** Personal Markdown notes in folders, with tags, search and a recycle bin. */
export function Notes({
  noteId,
  projectId,
  projects,
  revision,
}: {
  noteId: string;
  /** Kept in links so the sidebar stays on the current project. */
  projectId: string;
  projects: Project[];
  revision: number;
}) {
  const [changes, setChanges] = useState(0);
  const version = revision + changes;
  const changed = () => setChanges((value) => value + 1);
  const [view, setView] = useState<"notes" | "trash">("notes");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (tag) params.set("tag", tag);
  if (view === "trash") params.set("deleted", "1");
  const notes = useRemote<NoteSummary[]>(`/me/notes?${params}`, version);
  const trash = useRemote<NoteSummary[]>("/me/notes?deleted=1", version);
  const folders = useRemote<NoteFolder[]>("/me/note-folders", version);
  const tags = useRemote<NoteTag[]>("/me/note-tags", version);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [folderForm, setFolderForm] = useState<{
    folder?: NoteFolder;
    parentId?: string | null;
  }>();
  const [removingFolder, setRemovingFolder] = useState<NoteFolder>();
  const [error, setError] = useState("");
  const open = (id = "") => {
    location.hash = personalHash("notes", projectId, id).slice(1);
  };
  const create = async (folderId: string | null = null) => {
    setError("");
    try {
      const note = await api<Note>("/me/notes", "POST", {
        title: `Nota de ${new Date().toLocaleDateString("pt-PT")}`,
        folderId,
      });
      changed();
      open(note.id);
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const flat = !!search || !!tag || view === "trash";
  const children = (parentId: string | null) =>
    (folders.data || [])
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
  const noteLink = (note: NoteSummary) => (
    <li key={note.id}>
      <a
        className="note-link"
        href={personalHash("notes", projectId, note.id)}
        aria-current={note.id === noteId ? "page" : undefined}
      >
        <DocumentTextIcon aria-hidden />
        <span>
          <span className="note-link-title">{note.title}</span>
          {flat && note.excerpt && <small>{note.excerpt}</small>}
        </span>
      </a>
    </li>
  );
  const tree = (parentId: string | null, depth = 0): ReactNode => {
    const items = (notes.data || []).filter(
      (note) => note.folderId === parentId,
    );
    const subfolders = children(parentId);
    if (!items.length && !subfolders.length) return null;
    return (
      <ul className="note-tree" role={depth ? "group" : undefined}>
        {subfolders.map((folder) => {
          const closed = collapsed.has(folder.id);
          return (
            <li key={folder.id} className="note-folder">
              <div className="note-folder-row">
                <button
                  type="button"
                  className="note-folder-toggle"
                  aria-expanded={!closed}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (closed) next.delete(folder.id);
                      else next.add(folder.id);
                      return next;
                    })
                  }
                >
                  {closed ? (
                    <ChevronRightIcon aria-hidden />
                  ) : (
                    <ChevronDownIcon aria-hidden />
                  )}
                  <FolderIcon aria-hidden />
                  <span>{folder.name}</span>
                </button>
                <OverflowActions
                  label={`Ações da pasta ${folder.name}`}
                  actions={[
                    {
                      label: "Nova nota aqui",
                      icon: <DocumentPlusIcon />,
                      onClick: () => void create(folder.id),
                    },
                    {
                      label: "Nova subpasta",
                      icon: <FolderPlusIcon />,
                      onClick: () => setFolderForm({ parentId: folder.id }),
                    },
                    {
                      label: "Renomear ou mover",
                      icon: <PencilIcon />,
                      onClick: () => setFolderForm({ folder }),
                    },
                    {
                      label: "Apagar pasta",
                      icon: <TrashIcon />,
                      onClick: () => setRemovingFolder(folder),
                    },
                  ]}
                />
              </div>
              {!closed && tree(folder.id, depth + 1)}
            </li>
          );
        })}
        {items.map(noteLink)}
      </ul>
    );
  };
  return (
    <div className="notes-page">
      <aside className="notes-sidebar" aria-label="Lista de notas">
        <div className="notes-sidebar-heading">
          <h1>Notas</h1>
          <IconButton
            size="sm"
            label="Nova pasta"
            icon={<FolderPlusIcon />}
            onClick={() => setFolderForm({ parentId: null })}
          />
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => void create()}
          >
            Nova nota
          </Button>
        </div>
        <SearchField
          label="Procurar nas notas"
          placeholder="Procurar no título e no texto…"
          value={query}
          onChange={setQuery}
        />
        {!!tags.data?.length && (
          <div className="note-tags" aria-label="Filtrar por tag">
            {tags.data.map((item) => (
              <button
                key={item.name}
                type="button"
                className="note-tag"
                aria-pressed={tag === item.name}
                onClick={() => setTag(tag === item.name ? "" : item.name)}
              >
                #{item.name}
                <span className="mono">{item.count}</span>
              </button>
            ))}
          </div>
        )}
        <Tabs<"notes" | "trash">
          label="Notas ativas ou na reciclagem"
          value={view}
          onChange={setView}
          tabs={[
            { value: "notes", label: "Notas" },
            {
              value: "trash",
              label: "Reciclagem",
              count: trash.data?.length || undefined,
            },
          ]}
        />
        {error && <ErrorMessage message={error} />}
        {notes.error && <ErrorMessage message={notes.error} />}
        {!notes.data || !folders.data ? (
          <Loading />
        ) : flat ? (
          notes.data.length ? (
            <ul className="note-tree">{notes.data.map(noteLink)}</ul>
          ) : (
            <p className="muted">
              {view === "trash"
                ? "A reciclagem está vazia."
                : "Nenhuma nota encontrada."}
            </p>
          )
        ) : (
          tree(null) || (
            <p className="muted">
              Ainda sem notas. Cole aqui a daily ou a ata de uma reunião.
            </p>
          )
        )}
      </aside>
      <section className="notes-editor">
        {noteId ? (
          <NoteEditor
            key={noteId}
            noteId={noteId}
            projectId={projectId}
            projects={projects}
            folders={folders.data || []}
            onChanged={changed}
            onClosed={() => open()}
          />
        ) : (
          <Empty title="Escolha ou crie uma nota">
            As notas são só suas. Use listas ou checklists para transformar os
            itens de uma daily ou reunião em rascunhos de issues.
          </Empty>
        )}
      </section>
      {folderForm && (
        <FolderForm
          folders={folders.data || []}
          {...folderForm}
          onClose={() => setFolderForm(undefined)}
          onSaved={changed}
        />
      )}
      {removingFolder && (
        <Confirm
          title="Apagar pasta"
          description={`As notas e subpastas de «${removingFolder.name}» passam para a pasta acima. Nenhuma nota é apagada.`}
          confirmLabel="Apagar pasta"
          danger
          onClose={() => setRemovingFolder(undefined)}
          onConfirm={async () => {
            await api(`/me/note-folders/${removingFolder.id}`, "DELETE");
            changed();
          }}
        />
      )}
    </div>
  );
}

function FolderForm({
  folder,
  parentId = null,
  folders,
  onClose,
  onSaved,
}: {
  folder?: NoteFolder;
  parentId?: string | null;
  folders: NoteFolder[];
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [parent, setParent] = useState(folder ? folder.parentId : parentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A folder cannot go inside itself or one of its subfolders.
  const inside = (id: string | null): boolean =>
    !!id &&
    (id === folder?.id ||
      inside(folders.find((item) => item.id === id)?.parentId ?? null));
  const options: SelectOption[] = [
    { value: "", label: "Raiz", render: <span className="muted">Raiz</span> },
    ...folderPaths(folders)
      .filter((item) => !inside(item.id))
      .map((item) => ({ value: item.id, label: item.path })),
  ];
  return (
    <Modal
      title={folder ? "Renomear pasta" : "Nova pasta"}
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
            if (folder)
              await api(`/me/note-folders/${folder.id}`, "PATCH", {
                name,
                parentId: parent,
              });
            else
              await api("/me/note-folders", "POST", { name, parentId: parent });
            onSaved();
            onClose();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Nome
          <input
            required
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="field">
          <Select2
            showLabel
            label="Dentro de"
            value={parent || ""}
            options={options}
            onChange={(value) => setParent(value || null)}
          />
        </div>
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabledFocusable={busy}>
            {busy ? "A guardar…" : folder ? "Guardar" : "Criar pasta"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Fields = Pick<Note, "title" | "body" | "folderId" | "tags">;
const fieldsOf = (note: Note): Fields => ({
  title: note.title,
  body: note.body,
  folderId: note.folderId,
  tags: note.tags,
});
const same = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b);

/** Saves on its own a second after the last change, and when leaving the note. */
function NoteEditor({
  noteId,
  projectId,
  projects,
  folders,
  onChanged,
  onClosed,
}: {
  noteId: string;
  projectId: string;
  projects: Project[];
  folders: NoteFolder[];
  onChanged(): void;
  onClosed(): void;
}) {
  const [reload, setReload] = useState(0);
  const remote = useRemote<Note>(`/me/notes/${noteId}`, reload);
  const [fields, setFields] = useState<Fields>();
  const [attachments, setAttachments] = useState<Note["attachments"]>([]);
  const saved = useRef<{ fields: Fields; version: number }>(undefined);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving">("saved");
  const [error, setError] = useState("");
  const [tagText, setTagText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [removing, setRemoving] = useState(false);
  const drafts = useRemote<IssueDraft[]>(
    `/me/drafts?noteId=${noteId}`,
    draftRevision,
  );
  useEffect(() => {
    if (!remote.data) return;
    saved.current = {
      fields: fieldsOf(remote.data),
      version: remote.data.version,
    };
    setFields(fieldsOf(remote.data));
    setAttachments(remote.data.attachments);
    setStatus("saved");
    setError("");
  }, [remote.data]);
  const latest = useRef(fields);
  latest.current = fields;
  const pending = useRef<Promise<void>>(undefined);
  const save = async () => {
    const current = latest.current;
    const base = saved.current;
    if (!current || !base || same(current, base.fields)) return;
    setStatus("saving");
    try {
      const note = await api<Note>(
        `/me/notes/${noteId}`,
        "PATCH",
        current,
        base.version,
      );
      saved.current = { fields: current, version: note.version };
      setStatus(same(latest.current!, current) ? "saved" : "dirty");
      setError("");
      onChanged();
    } catch (failure) {
      setStatus("dirty");
      setError((failure as Error).message);
    }
  };
  const flush = () => {
    pending.current = (pending.current || Promise.resolve()).then(save);
    return pending.current;
  };
  useEffect(() => {
    if (status !== "dirty" || error) return;
    const timer = window.setTimeout(() => void flush(), 1000);
    return () => window.clearTimeout(timer);
  }, [fields, status, error]);
  // Leaving the note (another note, another page) keeps what was typed.
  useEffect(() => () => void flush(), []);
  const uploads = useDirectUploads({ noteId }, () => {
    void api<Note>(`/me/notes/${noteId}`).then((note) =>
      setAttachments(note.attachments),
    );
  });
  const folderOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: "",
        label: "Sem pasta",
        render: <span className="muted">Sem pasta</span>,
      },
      ...folderPaths(folders).map((folder) => ({
        value: folder.id,
        label: folder.path,
      })),
    ],
    [folders],
  );
  if (remote.error && !remote.data)
    return <ErrorMessage message={remote.error} />;
  if (!remote.data || !fields) return <Loading />;
  const note = remote.data;
  const deleted = !!note.deletedAt;
  const change = (patch: Partial<Fields>) => {
    setFields((current) => current && { ...current, ...patch });
    setStatus("dirty");
  };
  const addTags = (text: string) => {
    const added = text
      .split(/[,\s]+/)
      .map((item) => item.replace(/#/g, "").trim().toLocaleLowerCase("pt-PT"))
      .filter((item) => item && item.length <= 40);
    if (added.length)
      change({ tags: [...new Set([...fields.tags, ...added])].slice(0, 20) });
    setTagText("");
  };
  if (deleted)
    return (
      <article className="note-sheet">
        <p className="notice">
          Esta nota está na reciclagem desde {date(note.deletedAt)}.
        </p>
        <div className="note-heading">
          <h2 className="note-title-static">{note.title}</h2>
          <Button
            icon={<ArrowUturnLeftIcon />}
            onClick={async () => {
              await api(`/me/notes/${noteId}/restore`, "POST");
              onChanged();
              setReload((value) => value + 1);
            }}
          >
            Restaurar
          </Button>
          <Button
            variant="danger"
            icon={<TrashIcon />}
            onClick={() => setRemoving(true)}
          >
            Eliminar definitivamente
          </Button>
        </div>
        <Markdown>{note.body}</Markdown>
        <AttachmentList files={attachments} personal />
        {removing && (
          <Confirm
            title="Eliminar nota definitivamente"
            description="A nota e os seus anexos deixam de existir. Os rascunhos criados a partir dela mantêm-se."
            confirmLabel="Eliminar"
            danger
            onClose={() => setRemoving(false)}
            onConfirm={async () => {
              await api(`/me/notes/${noteId}?permanent=1`, "DELETE");
              onChanged();
              onClosed();
            }}
          />
        )}
      </article>
    );
  return (
    <article className="note-sheet">
      <div className="note-heading">
        <label className="note-title-field">
          <span className="visually-hidden">Título da nota</span>
          <input
            maxLength={200}
            value={fields.title}
            onChange={(event) => change({ title: event.target.value })}
            onBlur={() => {
              if (!fields.title.trim()) change({ title: note.title });
            }}
          />
        </label>
        <span className="note-status muted" aria-live="polite">
          {status === "saving"
            ? "A guardar…"
            : status === "dirty"
              ? "Alterações por guardar"
              : `Guardado · ${date(note.updatedAt)}`}
        </span>
        <Button icon={<RectangleStackIcon />} onClick={() => setDrafting(true)}>
          Criar rascunhos de issues
        </Button>
        <OverflowActions
          label="Ações da nota"
          actions={[
            {
              label: "Mover para a reciclagem",
              icon: <ArchiveBoxXMarkIcon />,
              onClick: async () => {
                await flush();
                await api(`/me/notes/${noteId}`, "DELETE");
                onChanged();
                setReload((value) => value + 1);
              },
            },
          ]}
        />
      </div>
      {error && (
        <div className="note-conflict">
          <ErrorMessage message={error} />
          <Button size="sm" onClick={() => setReload((value) => value + 1)}>
            Recarregar a nota
          </Button>
        </div>
      )}
      <div className="note-meta">
        <div className="field">
          <Select2
            showLabel
            label="Pasta"
            value={fields.folderId || ""}
            options={folderOptions}
            onChange={(value) => change({ folderId: value || null })}
          />
        </div>
        <div className="field note-tag-field">
          <span>Tags</span>
          <div className="note-tag-input">
            {fields.tags.map((item) => (
              <span key={item} className="note-tag">
                #{item}
                <button
                  type="button"
                  aria-label={`Remover tag ${item}`}
                  onClick={() =>
                    change({ tags: fields.tags.filter((tag) => tag !== item) })
                  }
                >
                  <XMarkIcon aria-hidden />
                </button>
              </span>
            ))}
            <input
              aria-label="Adicionar tag"
              placeholder={fields.tags.length ? "" : "daily, reunião…"}
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTags(tagText);
                } else if (
                  event.key === "Backspace" &&
                  !tagText &&
                  fields.tags.length
                )
                  change({ tags: fields.tags.slice(0, -1) });
              }}
              onBlur={() => addTags(tagText)}
            />
          </div>
        </div>
      </div>
      <MarkdownField
        label="Conteúdo"
        value={fields.body}
        onChange={(body) => change({ body })}
        placeholder="Cole aqui a daily ou as notas da reunião. Use # para referenciar issues e testes."
        references
        onFiles={uploads.add}
        footer={
          <PendingAttachments files={uploads.files} onRemove={uploads.remove} />
        }
      />
      <AttachmentList
        files={attachments}
        personal
        onRemove={(file) =>
          void api(`/me/attachments/${file.id}`, "DELETE").then(() =>
            setAttachments((current) =>
              current.filter((item) => item.id !== file.id),
            ),
          )
        }
      />
      {!!drafts.data?.length && (
        <section className="note-drafts">
          <h3 className="section-label">Rascunhos desta nota</h3>
          <ul>
            {drafts.data.map((draft) => (
              <li key={draft.id}>
                <a href={personalHash("drafts", projectId, draft.id)}>
                  {draft.title}
                </a>
                <span className="muted">
                  {draftStateLabels[draft.state]}
                  {draft.projectName && ` · ${draft.projectName}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {drafting && (
        <DraftItemsDialog
          noteId={noteId}
          body={fields.body}
          drafts={drafts.data || []}
          projects={projects}
          projectId={projectId}
          onClose={() => setDrafting(false)}
          onCreated={() => setDraftRevision((value) => value + 1)}
          beforeCreate={flush}
        />
      )}
    </article>
  );
}

/** Picks list items of the note; each becomes a draft on the personal board. */
function DraftItemsDialog({
  noteId,
  body,
  drafts,
  projects,
  projectId,
  onClose,
  onCreated,
  beforeCreate,
}: {
  noteId: string;
  body: string;
  drafts: IssueDraft[];
  projects: Project[];
  projectId: string;
  onClose(): void;
  onCreated(): void;
  beforeCreate(): Promise<void>;
}) {
  const items = useMemo(() => noteItems(body), [body]);
  const drafted = new Set(
    drafts.map((draft) => draft.sourceText && sourceKey(draft.sourceText)),
  );
  const [chosen, setChosen] = useState(
    () =>
      new Set(
        items.flatMap((item, index) =>
          item.done || drafted.has(item.sourceText) ? [] : [index],
        ),
      ),
  );
  const writable = projects.filter((project) => project.role !== "viewer");
  const [project, setProject] = useState(
    writable.some((item) => item.id === projectId) ? projectId : "",
  );
  const [priority, setPriority] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(0);
  return (
    <Modal
      title="Criar rascunhos de issues"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {created ? (
        <>
          <p className="notice">
            {created === 1
              ? "Foi criado 1 rascunho em «Por rever»."
              : `Foram criados ${created} rascunhos em «Por rever».`}
          </p>
          <div className="form-actions">
            <Button onClick={onClose}>Fechar</Button>
            <Button
              variant="primary"
              onClick={() => {
                location.hash = personalHash("drafts", projectId).slice(1);
              }}
            >
              Abrir a board de rascunhos
            </Button>
          </div>
        </>
      ) : !items.length ? (
        <>
          <Empty title="Sem itens na nota">
            Escreva as ações como lista ou checklist: cada item de primeiro
            nível pode tornar-se um rascunho, com os subitens como descrição.
          </Empty>
          <div className="form-actions">
            <Button onClick={onClose}>Fechar</Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await beforeCreate();
              const list = items.filter((_, index) => chosen.has(index));
              await api<IssueDraft[]>("/me/drafts", "POST", {
                noteId,
                projectId: project || null,
                priority: priority ? Number(priority) : null,
                items: list.map(({ title, description, sourceText }) => ({
                  title,
                  description,
                  sourceText,
                })),
              });
              setCreated(list.length);
              onCreated();
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="draft-items">
            <legend>Itens da nota</legend>
            {items.map((item, index) => {
              const already = drafted.has(item.sourceText);
              return (
                <label key={index} className="draft-item">
                  <input
                    type="checkbox"
                    checked={chosen.has(index)}
                    onChange={(event) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(index);
                        else next.delete(index);
                        return next;
                      })
                    }
                  />
                  <span>
                    {item.title}
                    {(already || item.done || item.description) && (
                      <small>
                        {[
                          already && "Já em rascunho",
                          item.done && "Concluído na nota",
                          item.description &&
                            `${item.description.split("\n").length} linha(s) de detalhe`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
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
            <Button
              variant="primary"
              type="submit"
              disabledFocusable={busy || !chosen.size}
            >
              {busy
                ? "A criar…"
                : chosen.size === 1
                  ? "Criar 1 rascunho"
                  : `Criar ${chosen.size} rascunhos`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
