import { useState } from "react";
import type { Issue, IssueConfig, Member } from "../shared/contracts";
import { api } from "./api";
import { Button, ErrorMessage, MarkdownField, Modal } from "./components";
import {
  peopleOptions,
  priorityOptions,
  statusOptions,
  tagOptions,
} from "./issueUi";
import { Select2 } from "./Select2";

/** Create an issue (all fields) or edit its title and description. */
export function IssueForm({
  projectId,
  issue,
  config,
  members,
  initialStatusId,
  userId,
  onSaved,
  onClose,
}: {
  projectId: string;
  issue?: Issue;
  config: IssueConfig;
  members: Member[];
  initialStatusId?: string;
  userId?: string;
  onSaved(issue: Issue): void;
  onClose(): void;
}) {
  const [openedVersion] = useState(issue?.version);
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [statusId, setStatusId] = useState(
    initialStatusId || config.statuses[0]?.id || "",
  );
  const [priority, setPriority] = useState("");
  const [estimate, setEstimate] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={issue ? "Editar issue" : "Novo issue"}
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
            const saved = issue
              ? await api<Issue>(
                  `/issues/${issue.id}`,
                  "PATCH",
                  { title, description },
                  openedVersion,
                )
              : await api<Issue>(`/projects/${projectId}/issues`, "POST", {
                  title,
                  description,
                  statusId: statusId || undefined,
                  priority: priority ? Number(priority) : null,
                  estimate: estimate
                    ? Number(estimate.replace(",", "."))
                    : null,
                  assigneeIds: assignees,
                  moduleIds: modules,
                  labelIds: labels,
                });
            onSaved(saved);
            onClose();
          } catch (error) {
            setError((error as Error).message);
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
        <MarkdownField
          label="Descrição"
          value={description}
          onChange={setDescription}
        />
        {!issue && (
          <>
            <div className="form-grid">
              <div className="field">
                <Select2
                  showLabel
                  label="Estado"
                  value={statusId}
                  options={statusOptions(config)}
                  onChange={setStatusId}
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
              <label className="field">
                Estimativa
                <input
                  inputMode="decimal"
                  pattern="\d+([.,]\d{1,2})?"
                  value={estimate}
                  onChange={(event) => setEstimate(event.target.value)}
                  placeholder="Ex.: 2,5"
                />
              </label>
            </div>
            <div className="field">
              <Select2
                multiple
                showLabel
                label="Responsáveis"
                placeholder="Atribuir…"
                value={assignees}
                options={peopleOptions(members, userId)}
                onChange={setAssignees}
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <Select2
                  multiple
                  showLabel
                  label="Módulos"
                  placeholder={
                    config.modules.length
                      ? "Adicionar…"
                      : "Configure nas Definições"
                  }
                  value={modules}
                  options={tagOptions(config.modules)}
                  onChange={setModules}
                />
              </div>
              <div className="field">
                <Select2
                  multiple
                  showLabel
                  label="Labels"
                  placeholder={
                    config.labels.length
                      ? "Adicionar…"
                      : "Configure nas Definições"
                  }
                  value={labels}
                  options={tagOptions(config.labels)}
                  onChange={setLabels}
                />
              </div>
            </div>
          </>
        )}
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabledFocusable={busy}>
            {busy ? "A guardar…" : issue ? "Guardar" : "Criar issue"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
