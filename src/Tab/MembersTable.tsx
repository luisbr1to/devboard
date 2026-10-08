import { useState } from "react";
import {
  EyeIcon,
  LockClosedIcon,
  LockOpenIcon,
  PencilSquareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { Member, MemberRole, Project } from "../shared/contracts";
import { api } from "./api";
import {
  Button,
  Confirm,
  ErrorMessage,
  FilterMenu,
  IconButton,
  Modal,
  SearchField,
  UserAvatar,
} from "./components";
import { day } from "./presentation";

export const roleLabels: Record<MemberRole, string> = {
  owner: "Proprietário",
  member: "Membro",
  viewer: "Leitor",
};
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Filter = "all" | MemberRole | "blocked";

/** Project members with search, role filter and owner actions (read-only, block, remove). */
export function MembersTable({
  project,
  members,
  userId,
  refresh,
}: {
  project: Project;
  members: Member[];
  userId?: string;
  refresh(): void;
}) {
  const owner = project.role === "owner";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [blocking, setBlocking] = useState<Member>();
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    danger?: boolean;
    run(): Promise<void>;
  } | null>(null);
  const text = fold(query.trim());
  const visible = members.filter(
    (member) =>
      (filter === "all" ||
        (filter === "blocked" ? !!member.blockedAt : member.role === filter)) &&
      (!text ||
        fold(member.name).includes(text) ||
        fold(member.email).includes(text)),
  );
  const base = `/projects/${project.id}/members`;
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
  return (
    <>
      <div className="toolbar member-toolbar">
        <SearchField
          label="Pesquisar membros"
          placeholder="Procurar por nome ou email…"
          value={query}
          onChange={setQuery}
        />
        <div className="toolbar-filters">
          <FilterMenu
            name="memberRole"
            label="Papel"
            ariaLabel="Filtrar membros por papel"
            value={filter}
            onChange={(value: Filter) => setFilter(value)}
            options={[
              { value: "all", label: "Todos" },
              { value: "owner", label: "Proprietários" },
              { value: "member", label: "Membros" },
              { value: "viewer", label: "Leitores (só leitura)" },
              { value: "blocked", label: "Bloqueados" },
            ]}
          />
        </div>
      </div>
      {error && <ErrorMessage message={error} />}
      <div className="table-scroll">
        <table className="data-table member-table">
          <thead>
            <tr>
              <th>Membro</th>
              <th className="member-email">Email</th>
              <th>Papel</th>
              <th className="action-column">
                <span className="visually-hidden">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((member) => {
              const self = member.id === userId;
              const manageable = owner && !self && member.role !== "owner";
              return (
                <tr key={member.id}>
                  <td>
                    <span className="member-name">
                      <UserAvatar
                        projectId={project.id}
                        member={member}
                        size="small"
                      />
                      <span>
                        <strong>
                          {member.name}
                          {self && <span className="muted"> (eu)</span>}
                        </strong>
                        <small className="member-email-inline">
                          {member.email}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td className="member-email muted">{member.email}</td>
                  <td>
                    <span className="member-badges">
                      <span className={`role-chip role-${member.role}`}>
                        {roleLabels[member.role]}
                      </span>
                      {member.blockedAt && (
                        <span
                          className="role-chip role-blocked"
                          title={`Bloqueado desde ${day(member.blockedAt)}`}
                        >
                          <LockClosedIcon aria-hidden />
                          {member.blockedUntil
                            ? `Bloqueado até ${day(member.blockedUntil)}`
                            : "Bloqueado"}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="action-column">
                    <span className="member-actions">
                      {manageable &&
                        (member.role === "viewer" ? (
                          <IconButton
                            size="sm"
                            icon={<PencilSquareIcon />}
                            label={`Permitir edição a ${member.name}`}
                            onClick={() =>
                              void run(() =>
                                api(`${base}/${member.id}`, "PATCH", {
                                  role: "member",
                                }),
                              )
                            }
                          />
                        ) : (
                          <IconButton
                            size="sm"
                            icon={<EyeIcon />}
                            label={`Tornar ${member.name} só leitura`}
                            onClick={() =>
                              setConfirmation({
                                title: "Só leitura",
                                description: `${member.name} passa a ver o projeto sem poder editar, comentar, registar resultados ou ser responsável. As atribuições em testes e issues ativos são removidas (fica no histórico).`,
                                run: () =>
                                  run(() =>
                                    api(`${base}/${member.id}`, "PATCH", {
                                      role: "viewer",
                                    }),
                                  ),
                              })
                            }
                          />
                        ))}
                      {manageable &&
                        (member.blockedAt ? (
                          <IconButton
                            size="sm"
                            icon={<LockOpenIcon />}
                            label={`Desbloquear ${member.name}`}
                            onClick={() =>
                              void run(() =>
                                api(`${base}/${member.id}/unblock`, "POST"),
                              )
                            }
                          />
                        ) : (
                          <IconButton
                            size="sm"
                            icon={<LockClosedIcon />}
                            label={`Bloquear temporariamente ${member.name}`}
                            onClick={() => setBlocking(member)}
                          />
                        ))}
                      {owner && (
                        <IconButton
                          size="sm"
                          icon={<XMarkIcon />}
                          label={`Remover ${member.name}`}
                          onClick={() =>
                            setConfirmation({
                              title: "Remover membro",
                              danger: true,
                              description: `${member.name} deixará de ter acesso. As atribuições nos testes e issues ativos serão removidas e o histórico preservado.`,
                              run: () =>
                                run(() =>
                                  api(`${base}/${member.id}`, "DELETE"),
                                ),
                            })
                          }
                        />
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={4} className="muted member-empty">
                  Nenhum membro corresponde à pesquisa.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {blocking && (
        <BlockDialog
          member={blocking}
          onClose={() => setBlocking(undefined)}
          onBlock={async (until) => {
            await api(`${base}/${blocking.id}/block`, "POST", { until });
            refresh();
          }}
        />
      )}
      {confirmation && (
        <Confirm
          title={confirmation.title}
          description={confirmation.description}
          danger={confirmation.danger}
          confirmLabel={confirmation.danger ? "Remover" : undefined}
          onConfirm={confirmation.run}
          onClose={() => setConfirmation(null)}
        />
      )}
    </>
  );
}

function BlockDialog({
  member,
  onClose,
  onBlock,
}: {
  member: Member;
  onClose(): void;
  onBlock(until: string | null): Promise<void>;
}) {
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return (
    <Modal
      title="Bloquear acesso temporariamente"
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
            // Until the end of the chosen day, in the owner's time zone.
            await onBlock(
              until ? new Date(`${until}T23:59:59`).toISOString() : null,
            );
            onClose();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {member.name} deixa de ver o projeto, as suas notificações e os
          resultados de pesquisa até ser desbloqueado. Os dados, o papel e as
          atribuições ficam como estão.
        </p>
        <label className="field">
          Bloquear até (opcional)
          <input
            type="date"
            min={tomorrow}
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
          <small>Sem data, o bloqueio dura até o desbloquear.</small>
        </label>
        {error && <ErrorMessage message={error} />}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" type="submit" disabledFocusable={busy}>
            {busy ? "A bloquear…" : "Bloquear"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
