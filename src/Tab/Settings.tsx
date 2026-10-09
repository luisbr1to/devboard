import { useState } from "react";
import {
  ClipboardDocumentIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  TrashIcon,
  UserPlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { api, useRemote } from "./api";
import type { Project, Member, IntegrationKey } from "../shared/contracts";
import {
  Button,
  Confirm,
  ErrorMessage,
  date,
  Markdown,
  Tabs,
} from "./components";
import { DefinitionForm } from "./forms";
import { IssueSettings } from "./IssueSettings";
import { MembersTable } from "./MembersTable";
import { RolesGuide } from "./RolesGuide";
interface DirectoryPerson {
  oid: string;
  name: string;
  email: string;
}
export function Settings({
  project,
  members,
  userId,
  revision,
  refresh,
  onDeleted,
}: {
  project: Project;
  members: Member[];
  userId?: string;
  revision: number;
  refresh(): void;
  onDeleted(): void;
}) {
  const [tab, setTab] = useState<"general" | "dev">("general");
  const [edit, setEdit] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [role, setRole] = useState("member");
  const [keyName, setKeyName] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    run(): Promise<void>;
  } | null>(null);
  const keys = useRemote<IntegrationKey[]>(
    project.role === "owner" ? `/projects/${project.id}/keys` : null,
    revision,
  );
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
      refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Definições</h1>
          <p>
            Gerir membros, acesso, publicação por IA e a configuração do
            Desenvolvimento.
          </p>
        </div>
      </div>
      <Tabs
        label="Secções das definições"
        value={tab}
        onChange={(value: "general" | "dev") => setTab(value)}
        tabs={[
          { value: "general", label: "Geral" },
          { value: "dev", label: "Desenvolvimento" },
        ]}
      />
      {error && <ErrorMessage message={error} />}
      {tab === "dev" ? (
        <IssueSettings project={project} revision={revision} />
      ) : (
        <div className="settings-grid">
          <section className="card project-card">
            <div className="project-card-text">
              <h2 className="card-title">{project.name}</h2>
              <Markdown>{project.description}</Markdown>
            </div>
            {project.role === "owner" && (
              <div className="project-card-actions">
                <Button
                  icon={<PencilSquareIcon />}
                  onClick={() => setEdit(true)}
                >
                  Editar projeto
                </Button>
                <Button
                  variant="danger"
                  icon={<TrashIcon />}
                  onClick={() =>
                    setConfirmation({
                      title: "Apagar projeto",
                      description:
                        "O projeto deixará de aparecer para toda a equipa. As suites, testes e histórico serão preservados de forma segura, mas esta ação não pode ser desfeita na aplicação.",
                      run: async () => {
                        await api(
                          `/projects/${project.id}`,
                          "DELETE",
                          undefined,
                          project.version,
                        );
                        onDeleted();
                      },
                    })
                  }
                >
                  Apagar projeto
                </Button>
              </div>
            )}
          </section>
          <section className="card members-card">
            <div className="card-heading">
              <h2 className="card-title">Membros do projeto</h2>
              <span className="count-pill mono">{members.length}</span>
              <RolesGuide />
            </div>
            <MembersTable
              project={project}
              members={members}
              userId={userId}
              refresh={refresh}
            />
            {project.role === "owner" && (
              <div className="member-add">
                <h3>Adicionar colega ou convidado</h3>
                <p className="muted">
                  Procure uma identidade já existente no diretório Microsoft
                  365. Selecionar um membro existente permite alterar o seu
                  papel.
                </p>
                <form
                  className="inline-form member-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () =>
                      setPeople(
                        await api(
                          `/projects/${project.id}/directory?q=${encodeURIComponent(query)}`,
                        ),
                      ),
                    );
                  }}
                >
                  <input
                    aria-label="Pesquisar no diretório"
                    minLength={2}
                    required
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nome ou e-mail"
                  />
                  <select
                    aria-label="Papel"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                  >
                    <option value="member">Membro</option>
                    <option value="viewer">Leitor (só leitura)</option>
                    <option value="owner">Proprietário</option>
                  </select>
                  <Button
                    icon={<MagnifyingGlassIcon />}
                    type="submit"
                    disabled={busy}
                  >
                    Pesquisar
                  </Button>
                </form>
                <ul className="member-list">
                  {people.map((person) => (
                    <li key={person.oid}>
                      <div>
                        <strong>{person.name}</strong>
                        <small>{person.email}</small>
                      </div>
                      <Button
                        icon={<UserPlusIcon />}
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api(
                              `/projects/${project.id}/members`,
                              "POST",
                              {
                                oid: person.oid,
                                role,
                              },
                            );
                            setPeople([]);
                          })
                        }
                      >
                        Adicionar / atualizar
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {project.role === "owner" && (
            <section className="card integrations">
              <h2 className="card-title">Publicação por IA</h2>
              <p>
                Publique suites em JSON com descrições em Markdown. Os testes
                são criados pendentes.
              </p>
              <code className="endpoint">
                POST /api/v1/projects/{project.id}/suites
              </code>
              <p>
                <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                  Contrato OpenAPI
                </a>{" "}
                · Envie <code>Authorization: Bearer …</code> e{" "}
                <code>Idempotency-Key</code>.
              </p>
              {secret && (
                <div className="secret-box">
                  <strong>
                    Guarde esta chave agora. Não será apresentada novamente.
                  </strong>
                  <code>{secret}</code>
                  <div>
                    <Button
                      icon={<ClipboardDocumentIcon />}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(secret)
                          .catch(() =>
                            setError(
                              "Não foi possível copiar. Selecione e copie manualmente.",
                            ),
                          )
                      }
                    >
                      Copiar chave
                    </Button>
                    <Button onClick={() => setSecret("")}>Já guardei</Button>
                  </div>
                </div>
              )}
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(async () => {
                    const result = await api<{ secret: string }>(
                      `/projects/${project.id}/keys`,
                      "POST",
                      { name: keyName },
                    );
                    setSecret(result.secret);
                    setKeyName("");
                  });
                }}
              >
                <input
                  aria-label="Nome da integração"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  required
                  maxLength={200}
                  placeholder="Ex.: Pipeline de QA"
                />
                <Button
                  variant="primary"
                  icon={<KeyIcon />}
                  type="submit"
                  disabled={busy}
                >
                  Criar chave
                </Button>
              </form>
              {keys.loading && !keys.data && (
                <p className="muted">A carregar…</p>
              )}
              {keys.error && <ErrorMessage message={keys.error} />}
              <ul className="member-list">
                {keys.data?.map((key) => (
                  <li key={key.id}>
                    <div>
                      <strong>{key.name}</strong>
                      <small>
                        {date(key.createdAt)} ·{" "}
                        {key.revokedAt ? "Chave revogada" : "Ativa"}
                      </small>
                    </div>
                    <Button
                      icon={<XMarkIcon />}
                      disabled={!!key.revokedAt}
                      onClick={() =>
                        setConfirmation({
                          title: "Revogar chave",
                          description:
                            "A integração deixará de poder publicar suites. As suites existentes serão preservadas.",
                          run: async () => {
                            await api(
                              `/projects/${project.id}/keys/${key.id}/revoke`,
                              "POST",
                            );
                            refresh();
                          },
                        })
                      }
                    >
                      Revogar chave
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {edit && (
        <DefinitionForm
          kind="project"
          project={project}
          onClose={() => setEdit(false)}
          onSaved={refresh}
        />
      )}
      {confirmation && (
        <Confirm
          title={confirmation.title}
          description={confirmation.description}
          onConfirm={confirmation.run}
          onClose={() => setConfirmation(null)}
        />
      )}
    </>
  );
}
