import { useEffect, useState } from "react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { api, useRemote } from "./api";
import type { Project, Member, Status, Suite } from "../shared/contracts";
import {
  Avatar,
  Button,
  Confirm,
  ErrorMessage,
  FilterMenu,
  MultiFilterMenu,
  Loading,
  Empty,
  OverflowActions,
  ProgressBar,
  SearchField,
  StatusBadge,
  Tabs,
} from "./components";
import {
  plainSnippet,
  shortDate,
  suiteDisplayStatus,
  suiteKey,
} from "./presentation";
import { DefinitionForm } from "./forms";
import { Pagination, usePageSize } from "./pagination";
export function SuiteList({
  project,
  members,
  revision,
  refresh,
  openSuite,
}: {
  project: Project;
  members: Member[];
  revision: number;
  refresh(): void;
  openSuite(id: string): void;
}) {
  const [archive, setArchive] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status[]>([]);
  const [assignee, setAssignee] = useState("all");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("suites.pageSize", 25);
  const [newSuite, setNewSuite] = useState(false);
  const [editSuite, setEditSuite] = useState<Suite>();
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    run(): Promise<void>;
    danger?: boolean;
  } | null>(null);
  const [notice, setNotice] = useState("");
  /** Suites picked for a bulk action, kept across pages with their versions. */
  const [checked, setChecked] = useState<Record<string, Suite>>({});
  const params = new URLSearchParams({
    archive,
    q: query,
    status: status.join(",") || "all",
    assignee,
    sort,
    page: String(page),
    pageSize: String(pageSize),
  });
  const suites = useRemote<{ items: Suite[]; total: number; pageSize: number }>(
    `/projects/${project.id}/suites?${params}`,
    revision,
  );
  const summary = useRemote<{ total: number; archived: number }>(
    `/projects/${project.id}/summary`,
    revision,
  ).data;
  const filter = (fn: () => void) => {
    fn();
    setPage(1);
    setChecked({});
    setNotice("");
  };
  const owner = project.role === "owner";
  const items = suites.data?.items || [];
  const checkedList = Object.values(checked);
  const pageChecked = items.filter((suite) => checked[suite.id]).length;
  const toggle = (list: Suite[], on: boolean) =>
    setChecked((current) => {
      const next = { ...current };
      for (const suite of list) {
        if (on) next[suite.id] = suite;
        else delete next[suite.id];
      }
      return next;
    });
  const suiteCount = (count: number) =>
    `${count} ${count === 1 ? "suite" : "suites"}`;
  const bulkTexts = {
    archive: {
      title: "Arquivar",
      done: ["arquivada", "arquivadas"],
      description: (count: number) =>
        `${count === 1 ? "Sai" : "Saem"} das vistas ativas e ${count === 1 ? "fica" : "ficam"} apenas de leitura em Arquivadas. Pode restaurá-${count === 1 ? "la" : "las"} mais tarde.`,
    },
    restore: {
      title: "Restaurar",
      done: ["restaurada", "restauradas"],
      description: (count: number) =>
        `${count === 1 ? "Volta" : "Voltam"} às vistas ativas com resultados e comentários preservados.`,
    },
    delete: {
      title: "Apagar",
      done: ["apagada", "apagadas"],
      description: (count: number) =>
        `${count === 1 ? "Deixa" : "Deixam"} de aparecer para toda a equipa. Os testes, resultados, comentários e anexos ficam guardados, mas esta ação não pode ser desfeita na aplicação.`,
    },
  } as const;
  /** Owners archive, restore or delete the selected suites in one transaction. */
  const bulk = (action: keyof typeof bulkTexts, list: Suite[]) => {
    const text = bulkTexts[action];
    setConfirmation({
      title: `${text.title} ${list.length === 1 ? "suite" : "suites"}`,
      description: `${text.title} ${suiteCount(list.length)}? ${text.description(list.length)}`,
      danger: action === "delete",
      run: async () => {
        const result = await api<Record<string, number>>(
          `/projects/${project.id}/suites/${action}`,
          "POST",
          {
            suites: list.map((suite) => ({
              id: suite.id,
              version: suite.version,
            })),
          },
        );
        const count = Object.values(result)[0];
        setChecked({});
        setNotice(`${suiteCount(count)} ${text.done[count === 1 ? 0 : 1]}.`);
        refresh();
      },
    });
  };
  const filtered = query || status.length > 0 || assignee !== "all";
  const actions = (suite: Suite) => {
    const edit = () => setEditSuite(suite);
    const duplicate = () =>
      setConfirmation({
        title: "Duplicar suite",
        description:
          "Criar uma cópia independente com todos os testes pendentes?",
        run: async () => {
          const copy = await api<Suite>(
            `/suites/${suite.id}/duplicate`,
            "POST",
          );
          refresh();
          openSuite(copy.id);
        },
      });
    const archiveSuite = () =>
      setConfirmation({
        title: suite.archivedAt ? "Restaurar suite" : "Arquivar suite",
        description: suite.archivedAt
          ? "A suite voltará às vistas ativas com resultados e comentários preservados."
          : "A suite sairá das vistas ativas e ficará apenas de leitura em Arquivadas. Pode restaurá-la mais tarde.",
        run: async () => {
          await api(
            `/suites/${suite.id}/${suite.archivedAt ? "restore" : "archive"}`,
            "POST",
            undefined,
            suite.version,
          );
          toggle([suite], false);
          refresh();
        },
      });
    const deleteSuite = () =>
      setConfirmation({
        title: "Apagar suite",
        danger: true,
        description: `A ${suiteKey(suite.number)} «${suite.title}» deixa de aparecer para toda a equipa. Os testes, resultados, comentários e anexos ficam guardados, mas esta ação não pode ser desfeita na aplicação.`,
        run: async () => {
          await api(`/suites/${suite.id}`, "DELETE", undefined, suite.version);
          toggle([suite], false);
          refresh();
        },
      });
    return (
      <div
        className="row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <OverflowActions
          label={`Ações de ${suite.title}`}
          actions={[
            {
              label: "Editar",
              icon: <PencilSquareIcon />,
              disabled: !!suite.archivedAt || project.role === "viewer",
              onClick: edit,
            },
            {
              label: "Duplicar",
              icon: <DocumentDuplicateIcon />,
              disabled: project.role === "viewer",
              onClick: duplicate,
            },
            ...(project.role === "owner"
              ? [
                  {
                    label: suite.archivedAt ? "Restaurar" : "Arquivar",
                    icon: suite.archivedAt ? (
                      <ArrowPathIcon />
                    ) : (
                      <ArchiveBoxIcon />
                    ),
                    onClick: archiveSuite,
                  },
                  {
                    label: "Apagar",
                    icon: <TrashIcon />,
                    onClick: deleteSuite,
                  },
                ]
              : []),
          ]}
        />
      </div>
    );
  };
  // A deletion or archive can leave the current page past the end.
  const lastPage = suites.data
    ? Math.max(1, Math.ceil(suites.data.total / suites.data.pageSize))
    : 1;
  useEffect(() => {
    if (suites.data && page > lastPage) setPage(lastPage);
  }, [suites.data, page, lastPage]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Suites de testes</h1>
          <p>Checklists de testes manuais do projeto {project.name}</p>
        </div>
        {project.role !== "viewer" && (
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => setNewSuite(true)}
          >
            Nova suite
          </Button>
        )}
      </div>
      <Tabs
        label="Vista das suites"
        value={archive}
        onChange={(value) => filter(() => setArchive(value))}
        tabs={[
          { value: "active", label: "Ativas", count: summary?.total },
          { value: "archived", label: "Arquivadas", count: summary?.archived },
        ]}
      />
      <div className="toolbar">
        <SearchField
          label="Pesquisar suites"
          placeholder="Filtrar suites…"
          value={query}
          onChange={(value) => filter(() => setQuery(value))}
        />
        <div className="toolbar-filters">
          <MultiFilterMenu<Status>
            name="status"
            label="Estado"
            ariaLabel="Filtrar por estado"
            value={status}
            onChange={(value) => filter(() => setStatus(value))}
            options={[
              { value: "pending", label: "Pendente" },
              { value: "approved", label: "Aprovada" },
              { value: "revoked", label: "Rejeitada" },
            ]}
          />
          <FilterMenu
            name="assignee"
            label="Responsável"
            ariaLabel="Filtrar por responsável"
            value={assignee}
            onChange={(value) => filter(() => setAssignee(value))}
            options={[
              { value: "all", label: "Todos" },
              ...members.map((member) => ({
                value: member.id,
                label: member.name,
              })),
            ]}
          />
          <FilterMenu
            sort
            name="sort"
            label="Ordenação"
            ariaLabel="Ordenar suites"
            value={sort}
            onChange={(value) => filter(() => setSort(value))}
            options={[
              { value: "updated", label: "Atualização recente" },
              { value: "created", label: "Criação recente" },
              { value: "title", label: "Título (A–Z)" },
            ]}
          />
        </div>
      </div>
      {owner && (
        <div className="bulk-bar" role="group" aria-label="Ações em lote">
          <span className="bulk-count">
            {checkedList.length
              ? `${suiteCount(checkedList.length)} ${checkedList.length === 1 ? "selecionada" : "selecionadas"}`
              : "Selecione suites para ações em lote."}
          </span>
          {checkedList.length > 0 && (
            <>
              {archive === "archived" ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<ArrowPathIcon />}
                  onClick={() => bulk("restore", checkedList)}
                >
                  Restaurar selecionadas
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<ArchiveBoxIcon />}
                  onClick={() => bulk("archive", checkedList)}
                >
                  Arquivar selecionadas
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                icon={<TrashIcon />}
                onClick={() => bulk("delete", checkedList)}
              >
                Apagar selecionadas
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked({})}>
                Limpar seleção
              </Button>
            </>
          )}
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {suites.error && <ErrorMessage message={suites.error} />}
      {!suites.data ? (
        <Loading />
      ) : !suites.data.items.length ? (
        <Empty
          title={
            archive === "archived"
              ? "Sem suites arquivadas"
              : "Nenhuma suite encontrada"
          }
        >
          {filtered
            ? "Experimente alterar os filtros."
            : archive === "archived"
              ? "As suites arquivadas aparecerão aqui com todo o histórico."
              : "Crie uma suite ou publique-a através da API de IA nas Definições."}
        </Empty>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="data-table suite-table">
              <thead>
                <tr>
                  {owner && (
                    <th className="select-column">
                      <input
                        type="checkbox"
                        aria-label="Selecionar as suites desta página"
                        checked={pageChecked === items.length}
                        ref={(input) => {
                          if (input)
                            input.indeterminate =
                              pageChecked > 0 && pageChecked < items.length;
                        }}
                        onChange={(event) =>
                          toggle(items, event.target.checked)
                        }
                      />
                    </th>
                  )}
                  <th className="id-column">ID</th>
                  <th className="title-column">Suite</th>
                  <th className="progress-column">Progresso</th>
                  <th className="status-column">Estado</th>
                  <th className="creator-column">Criada por</th>
                  <th className="date-column">
                    {archive === "archived" ? "Arquivada" : "Atualizada"}
                  </th>
                  <th className="action-column">
                    <span className="visually-hidden">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {suites.data.items.map((suite) => {
                  const snippet = plainSnippet(suite.description);
                  return (
                    <tr
                      key={suite.id}
                      className="clickable-row"
                      tabIndex={0}
                      aria-label={`Abrir ${suite.title}`}
                      onClick={() => openSuite(suite.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSuite(suite.id);
                        }
                      }}
                    >
                      {owner && (
                        <td
                          className="select-column"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${suiteKey(suite.number)} ${suite.title}`}
                            checked={!!checked[suite.id]}
                            onChange={(event) =>
                              toggle([suite], event.target.checked)
                            }
                          />
                        </td>
                      )}
                      <td className="id-column mono">
                        {suiteKey(suite.number)}
                      </td>
                      <td className="title-column">
                        <strong className="row-title">{suite.title}</strong>
                        {snippet && (
                          <span className="row-description">{snippet}</span>
                        )}
                      </td>
                      <td className="progress-column">
                        <ProgressBar
                          counts={suite.counts}
                          total={suite.total}
                        />
                      </td>
                      <td className="status-column">
                        <StatusBadge status={suiteDisplayStatus(suite)} suite />
                      </td>
                      <td className="creator-column">
                        <span className="assignee">
                          <Avatar name={suite.createdBy} />
                          <span title={suite.createdBy}>{suite.createdBy}</span>
                        </span>
                      </td>
                      <td className="mono date-column">
                        {shortDate(
                          archive === "archived"
                            ? suite.archivedAt
                            : suite.updatedAt,
                        )}
                        {archive === "archived" && (
                          <small>
                            {members.find(
                              (member) => member.id === suite.archivedBy,
                            )?.name || "Antigo membro"}
                          </small>
                        )}
                      </td>
                      <td className="action-column">{actions(suite)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {suites.data && suites.data.total > 0 && (
        <Pagination
          label="Paginação das suites"
          noun={["suite", "suites"]}
          total={suites.data.total}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
      {newSuite && (
        <DefinitionForm
          kind="suite"
          projectId={project.id}
          onClose={() => setNewSuite(false)}
          onSaved={(id) => {
            refresh();
            if (id) openSuite(id);
          }}
        />
      )}
      {editSuite && (
        <DefinitionForm
          kind="suite"
          suite={editSuite}
          onClose={() => setEditSuite(undefined)}
          onSaved={refresh}
        />
      )}
      {confirmation && (
        <Confirm
          title={confirmation.title}
          description={confirmation.description}
          onConfirm={confirmation.run}
          danger={confirmation.danger}
          confirmLabel={confirmation.danger ? "Apagar" : undefined}
          onClose={() => setConfirmation(null)}
        />
      )}
    </>
  );
}
