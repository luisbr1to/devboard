import { useState } from "react";
import {
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  builtInTemplates,
  type IssueTemplate,
  type Project,
} from "../shared/contracts";
import { api } from "./api";
import {
  Button,
  Confirm,
  ErrorMessage,
  IconButton,
  MarkdownField,
  Modal,
} from "./components";
import { Select2 } from "./Select2";

/**
 * Loads a description template into a form. Descriptions start empty; replacing
 * text the person already wrote asks first.
 */
export function TemplatePicker({
  templates,
  description,
  onLoad,
}: {
  /** The project's own templates, offered after the built-in ones. */
  templates: IssueTemplate[];
  description: string;
  onLoad(body: string): void;
}) {
  const all = [...builtInTemplates, ...templates];
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState<IssueTemplate>();
  return (
    <div className="field template-picker">
      <Select2
        showLabel
        label="Template"
        value={value}
        options={[
          {
            value: "",
            label: "Sem template",
            render: <span className="muted">Sem template</span>,
          },
          ...all.map((template) => ({
            value: template.id,
            label: template.name,
          })),
        ]}
        onChange={(id) => {
          const template = all.find((item) => item.id === id);
          if (!template) return setValue("");
          // An untouched template is replaced without asking.
          const written =
            !!description.trim() &&
            !all.some((item) => item.body === description);
          if (written) setReplacing(template);
          else {
            setValue(id);
            onLoad(template.body);
          }
        }}
      />
      {replacing && (
        <Confirm
          title="Substituir a descrição"
          description={`A descrição atual é substituída pelo template «${replacing.name}».`}
          confirmLabel="Substituir"
          onClose={() => setReplacing(undefined)}
          onConfirm={async () => {
            setValue(replacing.id);
            onLoad(replacing.body);
          }}
        />
      )}
    </div>
  );
}

/** Definições → Desenvolvimento: the built-in templates and the project's own (owners edit them). */
export function TemplatesCard({
  project,
  templates,
  onChanged,
}: {
  project: Project;
  templates: IssueTemplate[];
  onChanged(): void;
}) {
  const owner = project.role === "owner";
  const [editing, setEditing] = useState<IssueTemplate | "new">();
  const [removing, setRemoving] = useState<IssueTemplate>();
  return (
    <section className="card">
      <h2 className="card-title">Templates de issues</h2>
      <p className="muted">
        Descrições prontas a carregar ao criar um issue ou ao preparar uma
        tarefa deste projeto. A descrição começa vazia até se escolher um.
      </p>
      <ul className="member-list config-list">
        {[...builtInTemplates, ...templates].map((template) => (
          <li key={template.id}>
            <div>
              <strong>{template.name}</strong>
              {template.builtIn && <small>Predefinido</small>}
            </div>
            {owner && !template.builtIn && (
              <span className="config-actions">
                <IconButton
                  size="sm"
                  icon={<PencilSquareIcon />}
                  label={`Editar ${template.name}`}
                  onClick={() => setEditing(template)}
                />
                <IconButton
                  size="sm"
                  icon={<TrashIcon />}
                  label={`Apagar ${template.name}`}
                  onClick={() => setRemoving(template)}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <Button icon={<PlusIcon />} onClick={() => setEditing("new")}>
          Novo template
        </Button>
      )}
      {editing && (
        <TemplateForm
          project={project}
          template={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={onChanged}
        />
      )}
      {removing && (
        <Confirm
          title="Apagar template"
          description={`«${removing.name}» deixa de aparecer nos formulários. Os issues criados com ele não mudam.`}
          confirmLabel="Apagar"
          danger
          onClose={() => setRemoving(undefined)}
          onConfirm={async () => {
            await api(
              `/issue-templates/${removing.id}`,
              "DELETE",
              undefined,
              removing.version,
            );
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function TemplateForm({
  project,
  template,
  onClose,
  onSaved,
}: {
  project: Project;
  template?: IssueTemplate;
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={template ? "Editar template" : "Novo template"}
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
            if (template)
              await api(
                `/issue-templates/${template.id}`,
                "PATCH",
                { name, body },
                template.version,
              );
            else
              await api(`/projects/${project.id}/issue-templates`, "POST", {
                name,
                body,
              });
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
            maxLength={60}
            value={name}
            placeholder="Ex.: Pedido de suporte"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <MarkdownField label="Descrição" value={body} onChange={setBody} />
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabledFocusable={busy}>
            {busy ? "A guardar…" : template ? "Guardar" : "Criar template"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
