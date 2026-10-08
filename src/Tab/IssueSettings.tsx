import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  issueCategories,
  issueCategoryLabels,
  type IssueCategory,
  type IssueColor,
  type IssueConfig,
  type IssueStatus,
  type IssueTag,
  type Project,
} from "../shared/contracts";
import { api, useRemote } from "./api";
import { Button, ErrorMessage, IconButton, Loading, Modal } from "./components";
import { StatusTag, Tag, colorOptions } from "./issueUi";

type Kind = "statuses" | "modules" | "labels";
type Item = IssueStatus | IssueTag;
const texts: Record<
  Kind,
  { title: string; help: string; placeholder: string; one: string }
> = {
  statuses: {
    title: "Estados",
    help: "As colunas do board, pela ordem indicada. A categoria define o que conta como «em aberto».",
    placeholder: "Ex.: Em revisão",
    one: "estado",
  },
  modules: {
    title: "Módulos",
    help: "Áreas a que um issue pertence (ex.: Backoffice, Frontend, E-mails). Um issue pode ter vários.",
    placeholder: "Ex.: Backoffice",
    one: "módulo",
  },
  labels: {
    title: "Labels",
    help: "Tipos ou etiquetas livres (ex.: Bug, Melhoria).",
    placeholder: "Ex.: Bug",
    one: "label",
  },
};

/** Definições → Desenvolvimento: statuses, modules and labels of the project. */
export function IssueSettings({
  project,
  revision,
}: {
  project: Project;
  revision: number;
}) {
  const [local, setLocal] = useState(0);
  const config = useRemote<IssueConfig>(
    `/projects/${project.id}/issue-config`,
    revision + local,
  );
  if (config.error) return <ErrorMessage message={config.error} />;
  if (!config.data) return <Loading />;
  return (
    <div className="settings-grid">
      {(["statuses", "modules", "labels"] as const).map((kind) => (
        <ConfigCard
          key={kind}
          kind={kind}
          items={config.data![kind]}
          statuses={config.data!.statuses}
          project={project}
          onChanged={() => setLocal((value) => value + 1)}
        />
      ))}
    </div>
  );
}

function ConfigCard({
  kind,
  items,
  statuses,
  project,
  onChanged,
}: {
  kind: Kind;
  items: Item[];
  statuses: IssueStatus[];
  project: Project;
  onChanged(): void;
}) {
  const owner = project.role === "owner";
  const text = texts[kind];
  const [name, setName] = useState("");
  const [color, setColor] = useState<IssueColor>("gray");
  const [category, setCategory] = useState<IssueCategory>("todo");
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<{
    name: string;
    color: IssueColor;
    category: IssueCategory;
  }>();
  const [removing, setRemoving] = useState<Item>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      onChanged();
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      onChanged();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const body = (
    item: Item,
    change: Partial<typeof draft> & { position?: number },
  ) => ({
    name: change?.name ?? item.name,
    color: change?.color ?? item.color,
    ...(kind === "statuses"
      ? { category: change?.category ?? (item as IssueStatus).category }
      : {}),
    ...(change?.position !== undefined ? { position: change.position } : {}),
  });
  const colorSelect = (
    value: IssueColor,
    onChange: (value: IssueColor) => void,
    label: string,
  ) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as IssueColor)}
    >
      {colorOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  const categorySelect = (
    value: IssueCategory,
    onChange: (value: IssueCategory) => void,
    label: string,
  ) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as IssueCategory)}
    >
      {issueCategories.map((option) => (
        <option key={option} value={option}>
          {issueCategoryLabels[option]}
        </option>
      ))}
    </select>
  );
  return (
    <section className={`card ${kind === "statuses" ? "integrations" : ""}`}>
      <h2 className="card-title">{text.title}</h2>
      <p className="muted">{text.help}</p>
      {error && <ErrorMessage message={error} />}
      {!items.length && (
        <p className="muted">Ainda sem {text.title.toLowerCase()}.</p>
      )}
      <ul className="member-list config-list">
        {items.map((item, index) =>
          editing === item.id && draft ? (
            <li key={item.id}>
              <form
                className="inline-form config-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() =>
                    api(
                      `/issue-${kind}/${item.id}`,
                      "PATCH",
                      body(item, draft),
                      item.version,
                    ),
                  ).then((ok) => ok && setEditing(undefined));
                }}
              >
                <input
                  aria-label={`Nome do ${text.one}`}
                  required
                  maxLength={60}
                  autoFocus
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
                {colorSelect(
                  draft.color,
                  (value) => setDraft({ ...draft, color: value }),
                  `Cor do ${text.one}`,
                )}
                {kind === "statuses" &&
                  categorySelect(
                    draft.category,
                    (value) => setDraft({ ...draft, category: value }),
                    "Categoria do estado",
                  )}
                <IconButton
                  type="submit"
                  size="sm"
                  icon={<CheckIcon />}
                  label="Guardar"
                  disabled={busy}
                />
                <IconButton
                  size="sm"
                  icon={<XMarkIcon />}
                  label="Cancelar"
                  onClick={() => setEditing(undefined)}
                />
              </form>
            </li>
          ) : (
            <li key={item.id}>
              <div>
                {kind === "statuses" ? (
                  <StatusTag status={item as IssueStatus} />
                ) : (
                  <Tag name={item.name} color={item.color} />
                )}
                {kind === "statuses" && (
                  <small>
                    {issueCategoryLabels[(item as IssueStatus).category]}
                  </small>
                )}
              </div>
              {owner && (
                <span className="config-actions">
                  <IconButton
                    size="sm"
                    icon={<ArrowUpIcon />}
                    label={`Subir ${item.name}`}
                    disabled={busy || index === 0}
                    onClick={() =>
                      void run(() =>
                        api(
                          `/issue-${kind}/${item.id}`,
                          "PATCH",
                          body(item, { position: index - 1 }),
                          item.version,
                        ),
                      )
                    }
                  />
                  <IconButton
                    size="sm"
                    icon={<ArrowDownIcon />}
                    label={`Descer ${item.name}`}
                    disabled={busy || index === items.length - 1}
                    onClick={() =>
                      void run(() =>
                        api(
                          `/issue-${kind}/${item.id}`,
                          "PATCH",
                          body(item, { position: index + 1 }),
                          item.version,
                        ),
                      )
                    }
                  />
                  <IconButton
                    size="sm"
                    icon={<PencilSquareIcon />}
                    label={`Editar ${item.name}`}
                    onClick={() => {
                      setEditing(item.id);
                      setDraft({
                        name: item.name,
                        color: item.color,
                        category: (item as IssueStatus).category || "todo",
                      });
                    }}
                  />
                  <IconButton
                    size="sm"
                    icon={<TrashIcon />}
                    label={`Apagar ${item.name}`}
                    onClick={() => setRemoving(item)}
                  />
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {owner && (
        <form
          className="inline-form config-add"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              api(`/projects/${project.id}/issue-${kind}`, "POST", {
                name,
                color,
                ...(kind === "statuses" ? { category } : {}),
              }),
            ).then((ok) => ok && setName(""));
          }}
        >
          <input
            aria-label={`Novo ${text.one}`}
            required
            maxLength={60}
            value={name}
            placeholder={text.placeholder}
            onChange={(event) => setName(event.target.value)}
          />
          {colorSelect(color, setColor, `Cor do novo ${text.one}`)}
          {kind === "statuses" &&
            categorySelect(category, setCategory, "Categoria do novo estado")}
          <Button icon={<PlusIcon />} type="submit" disabled={busy}>
            Adicionar
          </Button>
        </form>
      )}
      {removing && (
        <RemoveDialog
          kind={kind}
          item={removing}
          statuses={statuses}
          onClose={() => setRemoving(undefined)}
          onRemoved={onChanged}
        />
      )}
    </section>
  );
}

function RemoveDialog({
  kind,
  item,
  statuses,
  onClose,
  onRemoved,
}: {
  kind: Kind;
  item: Item;
  statuses: IssueStatus[];
  onClose(): void;
  onRemoved(): void;
}) {
  const others = statuses.filter((status) => status.id !== item.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={`Apagar ${texts[kind].one}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {kind === "statuses"
          ? `O estado «${item.name}» deixa de existir no board. Os issues que estiverem nele passam para o estado escolhido, e a mudança fica no histórico de cada um.`
          : `«${item.name}» deixa de aparecer nos filtros, nos seletores e nos issues. O histórico é preservado.`}
      </p>
      {kind === "statuses" && (
        <label className="field">
          Mover os issues para
          <select
            value={moveTo}
            onChange={(event) => setMoveTo(event.target.value)}
          >
            {others.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <ErrorMessage message={error} />}
      <div className="form-actions">
        <Button disabled={busy} onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          disabledFocusable={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(
                `/issue-${kind}/${item.id}${kind === "statuses" && moveTo ? `?moveTo=${moveTo}` : ""}`,
                "DELETE",
                undefined,
                item.version,
              );
              onRemoved();
              onClose();
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "A apagar…" : "Apagar"}
        </Button>
      </div>
    </Modal>
  );
}
