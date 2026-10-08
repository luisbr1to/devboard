import { useState } from "react";
import {
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { Admin as AdminRow, Me } from "../shared/contracts";
import { api, useRemote } from "./api";
import {
  Avatar,
  Button,
  Confirm,
  ErrorMessage,
  IconButton,
  Loading,
} from "./components";
import { BrandIcon } from "./BrandIcon";
import { day } from "./presentation";

interface DirectoryPerson {
  oid: string;
  name: string;
  email: string;
}

/** First-run page: whoever enters the setup code becomes the master administrator. */
export function Setup({
  me,
  onDone,
  onSignIn,
}: {
  me: Me;
  onDone(): void;
  onSignIn(): Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="welcome">
      <div className="welcome-card setup-card">
        <div className="brand-mark">
          <BrandIcon />
        </div>
        <span className="eyebrow">DEVBOARD · SETUP INICIAL</span>
        <h1>Configurar a aplicação</h1>
        <p>
          Ainda não existe um administrador. Quem concluir este passo fica
          administrador master: cria projetos, gere os administradores e tem
          acesso a todos os projetos. O master não pode ser removido.
        </p>
        <p className="setup-identity">
          Sessão iniciada como <strong>{me.name}</strong> · {me.email}
        </p>
        <form
          className="setup-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/setup", "POST", { code });
              onDone();
            } catch (failure) {
              setError((failure as Error).message);
              setBusy(false);
            }
          }}
        >
          <label className="field" htmlFor="setup-code">
            Código de setup
            <input
              id="setup-code"
              autoComplete="off"
              spellCheck={false}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <small className="muted">
            Definido em <code>TESTHUB_SETUP_CODE</code> no servidor; se não
            estiver definido, é mostrado no log do servidor.
          </small>
          <Button
            variant="primary"
            type="submit"
            icon={<ShieldCheckIcon />}
            disabledFocusable={busy}
          >
            {busy ? "A configurar…" : "Tornar-me administrador master"}
          </Button>
        </form>
        {error && <ErrorMessage message={error} />}
        <Button variant="ghost" onClick={() => void onSignIn()}>
          Entrar com outra conta
        </Button>
      </div>
    </main>
  );
}

/** Application administrators: list, add from the directory and remove (never the master). */
export function Administration({
  me,
  onChanged,
}: {
  me: Me;
  /** Removing yourself changes what the rest of the app may show. */
  onChanged(): void;
}) {
  const [revision, setRevision] = useState(0);
  const admins = useRemote<AdminRow[]>("/admins", revision);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<DirectoryPerson[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<AdminRow>();
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const isAdmin = (oid: string) =>
    admins.data?.some((admin) => admin.oid === oid);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Administração</h1>
          <p>
            Os administradores criam projetos e têm acesso de proprietário a
            todos os projetos, sem aparecerem como membros.
          </p>
        </div>
      </div>
      {error && <ErrorMessage message={error} />}
      {admins.error && <ErrorMessage message={admins.error} />}
      <div className="settings-grid">
        <section className="card members-card">
          <div className="card-heading">
            <h2 className="card-title">Administradores da aplicação</h2>
            {admins.data && (
              <span className="count-pill mono">{admins.data.length}</span>
            )}
          </div>
          {!admins.data ? (
            <Loading />
          ) : (
            <div className="table-scroll">
              <table className="data-table member-table">
                <thead>
                  <tr>
                    <th>Administrador</th>
                    <th className="member-email">Email</th>
                    <th>Desde</th>
                    <th className="action-column">
                      <span className="visually-hidden">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {admins.data.map((admin) => (
                    <tr key={admin.id}>
                      <td>
                        <span className="member-name">
                          <Avatar name={admin.name} size="small" />
                          <span>
                            <strong>
                              {admin.name}
                              {admin.id === me.id && (
                                <span className="muted"> (eu)</span>
                              )}
                            </strong>
                            <small className="member-email-inline">
                              {admin.email}
                            </small>
                          </span>
                          {admin.master && (
                            <span className="role-chip role-owner">Master</span>
                          )}
                        </span>
                      </td>
                      <td className="member-email muted">{admin.email}</td>
                      <td className="muted">
                        {day(admin.createdAt)}
                        {admin.createdByName && !admin.master
                          ? ` · por ${admin.createdByName}`
                          : ""}
                      </td>
                      <td className="action-column">
                        {!admin.master && (
                          <IconButton
                            size="sm"
                            icon={<XMarkIcon />}
                            label={`Remover ${admin.name} dos administradores`}
                            onClick={() => setRemoving(admin)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="member-add">
            <h3>Adicionar administrador</h3>
            <p className="muted">
              Procure uma pessoa no diretório Microsoft 365. Passa a ter acesso
              a todos os projetos e pode gerir os administradores.
            </p>
            <form
              className="inline-form member-search"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () =>
                  setPeople(
                    await api(
                      `/admins/directory?q=${encodeURIComponent(query)}`,
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
              <Button
                icon={<MagnifyingGlassIcon />}
                type="submit"
                disabled={busy}
              >
                Pesquisar
              </Button>
            </form>
            {people && !people.length && (
              <p className="muted">Ninguém encontrado.</p>
            )}
            <ul className="member-list">
              {people?.map((person) => (
                <li key={person.oid}>
                  <div>
                    <strong>{person.name}</strong>
                    <small>{person.email}</small>
                  </div>
                  {isAdmin(person.oid) ? (
                    <span className="muted">Já é administrador</span>
                  ) : (
                    <Button
                      icon={<UserPlusIcon />}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api("/admins", "POST", { oid: person.oid });
                          setPeople(undefined);
                          setQuery("");
                          setRevision((value) => value + 1);
                        })
                      }
                    >
                      Tornar administrador
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
      {removing && (
        <Confirm
          title="Remover administrador"
          danger
          confirmLabel="Remover"
          description={
            removing.id === me.id
              ? "Deixa de ser administrador: perde o acesso aos projetos de que não é membro e deixa de poder criar projetos ou gerir administradores."
              : `${removing.name} deixa de ser administrador: perde o acesso aos projetos de que não é membro e deixa de poder criar projetos ou gerir administradores.`
          }
          onConfirm={async () => {
            await api(`/admins/${removing.id}`, "DELETE");
            setRevision((value) => value + 1);
            if (removing.id === me.id) {
              location.hash = "";
              onChanged();
            }
          }}
          onClose={() => setRemoving(undefined)}
        />
      )}
    </>
  );
}
