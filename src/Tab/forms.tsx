import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import type {
  Member,
  TestCase,
  Suite,
  Project,
  Status,
} from "../shared/contracts";
import { statusLabels } from "../shared/contracts";
import { priorityLabels } from "./issueUi";
import {
  Button,
  IconButton,
  Modal,
  MarkdownField,
  ErrorMessage,
} from "./components";
import { api, type UploadTarget } from "./api";
import { PendingAttachments, useAttachments } from "./attachments";
import { mentionIds } from "./mentions";

async function projectIcon(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type))
    throw new Error("Escolha uma imagem PNG, JPEG ou WebP.");
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 48 / source.width, 48 / source.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.toDataURL("image/png");
}

export function DefinitionForm({
  kind,
  projectId,
  suite,
  project,
  test,
  members = [],
  onSaved,
  onClose,
}: {
  kind: "project" | "suite" | "test";
  projectId?: string;
  suite?: Suite;
  project?: Project;
  test?: TestCase;
  members?: Member[];
  onSaved(id?: string): void;
  onClose(): void;
}) {
  const [openedVersion] = useState(
    kind === "project"
      ? project?.version
      : kind === "suite"
        ? suite?.version
        : (test?.version ?? suite?.version),
  );
  const [initialTest] = useState(test);
  const [title, setTitle] = useState(
    kind === "test"
      ? (test?.title ?? "")
      : kind === "suite"
        ? (suite?.title ?? "")
        : (project?.name ?? ""),
  );
  const [description, setDescription] = useState(
    kind === "test"
      ? (test?.instructions ?? "")
      : kind === "suite"
        ? (suite?.description ?? "")
        : (project?.description ?? ""),
  );
  const [steps, setSteps] = useState(
    () => test?.steps.map((step) => step.body) ?? [],
  );
  const cleanSteps = steps.map((step) => step.trim()).filter(Boolean);
  const [expected, setExpected] = useState(test?.expectedResult || "");
  const [assignee, setAssignee] = useState(test?.assigneeId || "");
  const [priority, setPriority] = useState(test?.priority ?? null);
  const [icon, setIcon] = useState<string | null>(project?.icon || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const reset = Boolean(
    initialTest &&
    initialTest.status !== "pending" &&
    (description !== initialTest.instructions ||
      expected !== initialTest.expectedResult ||
      JSON.stringify(cleanSteps) !==
        JSON.stringify(initialTest.steps.map((step) => step.body))),
  );
  const editing =
    kind === "project" ? !!project : kind === "suite" ? !!suite : !!test;
  const label =
    kind === "project" ? "projeto" : kind === "suite" ? "suite" : "teste";
  return (
    <Modal
      title={`${editing ? "Editar" : "Criar"} ${label}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (reset && !confirmed) {
            setError("Confirme que pretende repor o resultado para pendente.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            let result: { id: string };
            if (kind === "project")
              result = await api(
                project ? `/projects/${project.id}` : "/projects",
                project ? "PATCH" : "POST",
                { name: title, description, icon },
                openedVersion,
              );
            else if (kind === "suite")
              result = await api(
                suite ? `/suites/${suite.id}` : `/projects/${projectId}/suites`,
                suite ? "PATCH" : "POST",
                { title, description },
                openedVersion,
              );
            else
              result = await api(
                test ? `/tests/${test.id}` : `/suites/${suite!.id}/tests`,
                test ? "PATCH" : "POST",
                {
                  title,
                  instructions: description,
                  // New tests without steps let the server use the list in the instructions.
                  ...(test || cleanSteps.length ? { steps: cleanSteps } : {}),
                  expectedResult: expected,
                  assigneeId: assignee || null,
                  priority,
                },
                openedVersion,
              );
            onSaved(result.id);
            onClose();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {kind === "project" ? "Nome" : "Título"}
          <input
            required
            autoFocus
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <MarkdownField
          label={kind === "test" ? "Instruções de teste manual" : "Descrição"}
          value={description}
          onChange={setDescription}
        />
        {kind === "project" && (
          <div className="field">
            <span>Ícone do projeto</span>
            <div className="project-icon-field">
              <span className="project-icon-preview">
                {icon ? <img src={icon} alt="" /> : <PhotoIcon />}
              </span>
              <label className="file-button">
                <PhotoIcon />
                Carregar imagem
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void projectIcon(file)
                      .then(setIcon)
                      .catch((error) => setError(error.message));
                  }}
                />
              </label>
              {icon && (
                <Button
                  variant="ghost"
                  icon={<TrashIcon />}
                  onClick={() => setIcon(null)}
                >
                  Remover
                </Button>
              )}
            </div>
            <small>
              A imagem é reduzida automaticamente para um máximo de 48 × 48 px.
            </small>
          </div>
        )}
        {kind === "test" && (
          <>
            <StepsEditor steps={steps} onChange={setSteps} />
            <MarkdownField
              label="Resultado esperado"
              value={expected}
              onChange={setExpected}
            />
            <label className="field">
              Prioridade
              <select
                value={priority ?? ""}
                onChange={(event) =>
                  setPriority(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              >
                <option value="">Sem prioridade</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {priorityLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Responsável
              <select
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">Sem responsável</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {reset && (
          <label className="reset-warning">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            As instruções, os passos ou o resultado esperado mudaram. Confirmo
            que o resultado e os passos serão repostos para pendente.
          </label>
        )}
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={reset && !confirmed}
            disabledFocusable={busy}
          >
            {busy ? "A guardar…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function StepsEditor({
  steps,
  onChange,
}: {
  steps: string[];
  onChange(steps: string[]): void;
}) {
  const update = (index: number, value: string) =>
    onChange(
      steps.map((step, position) => (position === index ? value : step)),
    );
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="field steps-editor">
      <legend>Passos</legend>
      {steps.length ? (
        <ol>
          {steps.map((step, index) => (
            <li key={index}>
              <span className="step-number mono" aria-hidden>
                {index + 1}
              </span>
              <textarea
                rows={1}
                aria-label={`Passo ${index + 1}`}
                value={step}
                maxLength={2000}
                onChange={(event) => update(index, event.target.value)}
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
      ) : (
        <small>
          Sem passos. Se as instruções de um teste novo tiverem uma lista, cada
          item passa a ser um passo.
        </small>
      )}
      <Button
        size="sm"
        variant="dashed"
        icon={<PlusIcon />}
        disabled={steps.length >= 100}
        onClick={() => onChange([...steps, ""])}
      >
        Adicionar passo
      </Button>
    </fieldset>
  );
}
export function ResultForm({
  test,
  status,
  members,
  onSaved,
  onClose,
}: {
  test: TestCase;
  status: Status;
  members: Member[];
  onSaved(): void;
  onClose(): void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const files = useAttachments({ suiteId: test.suiteId, testId: test.id });
  return (
    <Modal
      title={`Registar resultado: ${statusLabels[status]}`}
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
            await api(
              `/tests/${test.id}/result`,
              "POST",
              {
                status,
                comment,
                mentions: mentionIds(comment),
                attachmentIds: files.ids,
              },
              test.version,
            );
            files.clear();
            onSaved();
            onClose();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          <strong>{test.title}</strong>
        </p>
        <MarkdownField
          label={
            status === "revoked"
              ? "Motivo da rejeição (obrigatório)"
              : "Comentário (opcional)"
          }
          value={comment}
          onChange={setComment}
          mentionables={members}
          onFiles={files.add}
          footer={
            <PendingAttachments files={files.files} onRemove={files.remove} />
          }
        />
        {status === "pending" && (
          <p className="muted">O histórico anterior será preservado.</p>
        )}
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              (status === "revoked" && !comment.trim()) || files.uploading
            }
            disabledFocusable={busy}
          >
            {busy ? "A guardar…" : "Registar resultado"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function CommentForm({
  path,
  target,
  members,
  onSaved,
}: {
  path: string;
  target: UploadTarget;
  members: Member[];
  onSaved(): void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const files = useAttachments(target);
  return (
    <form
      className="comment-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(path, "POST", {
            body,
            mentions: mentionIds(body),
            attachmentIds: files.ids,
          });
          setBody("");
          files.clear();
          onSaved();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <MarkdownField
        label="Adicionar comentário"
        placeholder="Descreva o que observou, cole uma captura ou escreva @ para mencionar…"
        value={body}
        onChange={setBody}
        compact
        mentionables={members}
        onFiles={files.add}
        footer={
          <PendingAttachments files={files.files} onRemove={files.remove} />
        }
        actions={
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={(!body.trim() && !files.ids.length) || files.uploading}
            disabledFocusable={busy}
          >
            {busy ? "A publicar…" : "Comentar"}
          </Button>
        }
      />
      {error && <ErrorMessage message={error} />}
    </form>
  );
}
