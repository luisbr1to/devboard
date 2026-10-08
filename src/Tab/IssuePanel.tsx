import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import type { Activity, Issue, IssueConfig, Member } from "../shared/contracts";
import { api, useRemote } from "./api";
import {
  ErrorMessage,
  IconButton,
  Loading,
  Markdown,
  Modal,
  OverflowActions,
  Timeline,
  type OverflowAction,
} from "./components";
import { CommentForm } from "./forms";
import { assignable, day, issueKey } from "./presentation";
import {
  dayText,
  peopleOptions,
  priorityOptions,
  statusOptions,
  tagOptions,
} from "./issueUi";
import { Select2 } from "./Select2";

const fieldNames: Record<string, string> = {
  title: "o título",
  description: "a descrição",
  priority: "a prioridade",
  estimate: "a estimativa",
  deployedAt: "a data de deploy",
  modules: "os módulos",
  labels: "as labels",
};
const list = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`
    : items[0] || "";

export function IssuePanel({
  issueId,
  readOnly: viewer = false,
  config,
  members,
  userId,
  sequence,
  revision,
  focusActivity,
  focusKey,
  actions,
  onNavigate,
  onClose,
  onChanged,
}: {
  issueId: string;
  /** The current user is a read-only member. */
  readOnly?: boolean;
  config: IssueConfig;
  members: Member[];
  userId?: string;
  /** Visible issue ids, for previous/next. */
  sequence: string[];
  revision: number;
  focusActivity?: string;
  focusKey?: unknown;
  actions(issue: Issue): OverflowAction[];
  onNavigate(id: string): void;
  onClose(): void;
  onChanged(): void;
}) {
  const [local, setLocal] = useState(0);
  const [latest, setLatest] = useState<Issue>();
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const remote = useRemote<Issue>(`/issues/${issueId}`, revision + local);
  const activity = useRemote<Activity[]>(
    `/issues/${issueId}/activity`,
    revision + local,
  );
  // Keep the most recent copy: the PATCH answer may arrive before the refetch.
  const issue =
    latest?.id === issueId &&
    (!remote.data || latest.version >= remote.data.version)
      ? latest
      : remote.data;
  const position = sequence.indexOf(issueId);
  const readOnly = !!issue?.archivedAt || viewer;
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name || "antigo membro";

  async function save(run: () => Promise<Issue>, field: string) {
    setSaving(field);
    setError("");
    try {
      setLatest(await run());
      setLocal((value) => value + 1);
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
      setLocal((value) => value + 1);
    } finally {
      setSaving("");
    }
  }
  const patch = (body: object, field: string) =>
    issue &&
    void save(
      () => api<Issue>(`/issues/${issue.id}`, "PATCH", body, issue.version),
      field,
    );
  const describe = (item: Activity) => {
    const detail = item.detail as Record<string, any>;
    switch (item.kind) {
      case "issue_status_changed":
        return `mudou o estado de «${detail.from}» para «${detail.to}»`;
      case "issue_assigned": {
        const actorId = (item as Activity & { actorId?: string }).actorId;
        const added: string[] = detail.added || [];
        const removed: string[] = detail.removed || [];
        if (added.length === 1 && added[0] === actorId && !removed.length)
          return "atribuiu-se o issue";
        if (removed.length === 1 && removed[0] === actorId && !added.length)
          return "deixou de ser responsável";
        return [
          added.length && `atribuiu a ${list(added.map(name))}`,
          removed.length && `retirou ${list(removed.map(name))}`,
        ]
          .filter(Boolean)
          .join(" e ");
      }
      case "issue_archived":
        return detail.rule
          ? `arquivou o issue pela regra «${detail.rule}»`
          : undefined;
      case "issue_edited":
        return `alterou ${list((detail.changes || []).map((field: string) => fieldNames[field] || field))}`;
      case "issue_created":
        return detail.imported
          ? "importou o issue"
          : detail.duplicateOf
            ? `criou o issue como cópia de ${issueKey(detail.duplicateOf)}`
            : undefined;
      default:
        return undefined;
    }
  };
  return (
    <Modal
      title={issue?.title || "Issue"}
      variant="drawer"
      onClose={onClose}
      toolbar={
        <span className="drawer-path mono">
          {issue ? issueKey(issue.number) : "…"}
        </span>
      }
      actions={
        <>
          {issue && !viewer && (
            <OverflowActions
              label={`Ações de ${issue.title}`}
              actions={actions(issue)}
            />
          )}
          <IconButton
            icon={<ChevronUpIcon />}
            label="Issue anterior"
            disabled={position <= 0}
            onClick={() => onNavigate(sequence[position - 1])}
          />
          <IconButton
            icon={<ChevronDownIcon />}
            label="Issue seguinte"
            disabled={position < 0 || position >= sequence.length - 1}
            onClick={() => onNavigate(sequence[position + 1])}
          />
        </>
      }
    >
      {remote.error && !issue && <ErrorMessage message={remote.error} />}
      {!issue ? (
        <Loading />
      ) : (
        <>
          {issue.archivedAt && (
            <p className="notice">
              Este issue está arquivado e é apenas de leitura.
            </p>
          )}
          {error && <ErrorMessage message={error} />}
          <dl className="meta-list issue-meta">
            <div>
              <dt>Estado</dt>
              <dd>
                <Select2
                  label="Estado"
                  value={issue.statusId}
                  options={statusOptions(config)}
                  disabled={readOnly || !!saving}
                  onChange={(statusId) => patch({ statusId }, "status")}
                />
              </dd>
            </div>
            <div>
              <dt>Prioridade</dt>
              <dd>
                <Select2
                  label="Prioridade"
                  value={issue.priority ? String(issue.priority) : ""}
                  options={priorityOptions}
                  disabled={readOnly || !!saving}
                  onChange={(value) =>
                    patch(
                      { priority: value ? Number(value) : null },
                      "priority",
                    )
                  }
                />
              </dd>
            </div>
            <div>
              <dt>Responsáveis</dt>
              <dd>
                <Select2
                  multiple
                  deferred
                  label="Responsáveis"
                  placeholder="Atribuir…"
                  value={issue.assignees.map((person) => person.id)}
                  options={peopleOptions(assignable(members), userId)}
                  disabled={readOnly || !!saving}
                  onChange={(userIds) =>
                    void save(
                      () =>
                        api<Issue>(
                          `/issues/${issue.id}/assignees`,
                          "PUT",
                          { userIds },
                          issue.version,
                        ),
                      "assignees",
                    )
                  }
                />
              </dd>
            </div>
            <div>
              <dt>Reporter</dt>
              <dd>
                {issue.reporterName}
                <small className="muted">
                  {" "}
                  · {day(issue.reportedAt)}
                  {issue.reporterNote && ` · ${issue.reporterNote}`}
                </small>
              </dd>
            </div>
            {(["modules", "labels"] as const).map((kind) => (
              <div key={kind}>
                <dt>{kind === "modules" ? "Módulos" : "Labels"}</dt>
                <dd>
                  <Select2
                    multiple
                    deferred
                    label={kind === "modules" ? "Módulos" : "Labels"}
                    placeholder={
                      config[kind].length
                        ? "Adicionar…"
                        : "Configure nas Definições"
                    }
                    value={
                      kind === "modules" ? issue.moduleIds : issue.labelIds
                    }
                    options={tagOptions(config[kind])}
                    disabled={readOnly || !!saving}
                    onChange={(ids) =>
                      patch(
                        kind === "modules"
                          ? { moduleIds: ids }
                          : { labelIds: ids },
                        kind,
                      )
                    }
                  />
                </dd>
              </div>
            ))}
            <div>
              <dt>
                <label htmlFor="issue-estimate">Estimativa</label>
              </dt>
              <dd>
                <input
                  id="issue-estimate"
                  key={`${issue.id}:${issue.version}`}
                  className="compact-input"
                  inputMode="decimal"
                  defaultValue={
                    issue.estimate === null
                      ? ""
                      : String(issue.estimate).replace(".", ",")
                  }
                  disabled={readOnly || !!saving}
                  placeholder="—"
                  onBlur={(event) => {
                    const text = event.target.value.trim().replace(",", ".");
                    const value = text ? Number(text) : null;
                    if (value !== null && (Number.isNaN(value) || value < 0)) {
                      setError("Indique a estimativa como número (ex.: 2,5).");
                      return;
                    }
                    if (value !== issue.estimate)
                      patch({ estimate: value }, "estimate");
                  }}
                />
              </dd>
            </div>
            <div>
              <dt>
                <label htmlFor="issue-deployed">Data de deploy</label>
              </dt>
              <dd>
                {readOnly ? (
                  dayText(issue.deployedAt)
                ) : (
                  <input
                    id="issue-deployed"
                    type="date"
                    className="compact-input"
                    value={issue.deployedAt ?? ""}
                    disabled={!!saving}
                    onChange={(event) =>
                      patch(
                        { deployedAt: event.target.value || null },
                        "deployedAt",
                      )
                    }
                  />
                )}
              </dd>
            </div>
            {issue.externalRef && (
              <div>
                <dt>Referência</dt>
                <dd className="mono">{issue.externalRef}</dd>
              </div>
            )}
          </dl>
          <section className="drawer-section">
            <h3 className="section-label">Descrição</h3>
            <Markdown>{issue.description}</Markdown>
          </section>
          {!readOnly && (
            <section className="drawer-section">
              <h3 className="section-label">Comentários</h3>
              <CommentForm
                path={`/issues/${issue.id}/comments`}
                target={{ issueId: issue.id }}
                members={members}
                onSaved={() => {
                  setLocal((value) => value + 1);
                  onChanged();
                }}
              />
            </section>
          )}
          <section className="drawer-section">
            <h3 className="section-label">Atividade</h3>
            {activity.error ? (
              <ErrorMessage message={activity.error} />
            ) : !activity.data ? (
              <Loading />
            ) : (
              <Timeline
                items={activity.data}
                describe={describe}
                focusId={focusActivity}
                focusKey={focusKey}
              />
            )}
          </section>
        </>
      )}
    </Modal>
  );
}
