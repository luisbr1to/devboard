import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArchiveBoxIcon,
  ArrowDownIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { api, useRemote } from "./api";
import type {
  Project,
  Suite,
  Member,
  TestCase,
  Activity,
  Status,
  TestStep,
} from "../shared/contracts";
import {
  Assignee,
  Avatar,
  AvatarStack,
  Button,
  Confirm,
  Empty,
  ErrorMessage,
  FilterMenu,
  MultiFilterMenu,
  IconButton,
  Loading,
  Markdown,
  Modal,
  OverflowActions,
  ProgressBar,
  SearchField,
  StatusBadge,
  StatusIcon,
  Timeline,
  statusLabel,
  useFlash,
} from "./components";
import {
  date,
  shortDate,
  statusCounts,
  suiteDisplayStatus,
  suiteKey as formatSuiteKey,
  testKey,
  assignable,
} from "./presentation";
import { DefinitionForm, ResultForm, CommentForm } from "./forms";
import { Priority } from "./issueUi";
import { Pagination, pageSizes, usePageSize } from "./pagination";
export function SuiteDetail({
  project,
  suiteId,
  members,
  revision,
  refresh,
  navigate,
  onLoaded,
  focus,
  onTestChange,
  userId,
}: {
  project: Project;
  suiteId: string;
  members: Member[];
  revision: number;
  refresh(): void;
  navigate(suiteId?: string): void;
  onLoaded?(title: string): void;
  /** Anchor from a notification or search result; a new object re-applies it. */
  focus?: { testId: string; activityId: string };
  /** Keeps the address in sync with the open test panel. */
  onTestChange?(testId?: string): void;
  /** Current user, so the assignee of a test can delete it. */
  userId?: string;
}) {
  const remote = useRemote<Suite>(`/suites/${suiteId}`, revision);
  const [testPage, setTestPage] = useState(1);
  const [testQuery, setTestQuery] = useState("");
  const [testStatus, setTestStatus] = useState<Status[]>([]);
  const [testAssignee, setTestAssignee] = useState("all");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [edit, setEdit] = useState<"suite" | "test" | null>(null);
  const [editTest, setEditTest] = useState<TestCase>();
  const [selectedId, setSelectedId] = useState<string>();
  const [result, setResult] = useState<{
    test: TestCase;
    status: Status;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    run(): Promise<void>;
    danger?: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [savingStatus, setSavingStatus] = useState<Status | null>(null);
  const [draggedTestId, setDraggedTestId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    place: "before" | "after";
  }>();
  const activities = useRemote<Activity[]>(
    selectedId ? `/suites/${suiteId}/activity?testId=${selectedId}` : null,
    revision,
  );
  const suiteActivities = useRemote<Activity[]>(
    detailsOpen ? `/suites/${suiteId}/activity` : null,
    revision,
  );
  const suite = remote.data;
  const tests = suite?.tests || [];
  const selected = tests.find((test) => test.id === selectedId);
  const [testPageSize, setTestPageSize] = usePageSize("tests.pageSize", 10);
  const filteredTests = tests.filter(
    (test) =>
      test.title
        .toLocaleLowerCase("pt-PT")
        .includes(testQuery.trim().toLocaleLowerCase("pt-PT")) &&
      (!testStatus.length || testStatus.includes(test.status)) &&
      (testAssignee === "all" ||
        (testAssignee === "unassigned"
          ? !test.assigneeId
          : test.assigneeId === testAssignee)),
  );
  const testPageCount = Math.max(
    1,
    Math.ceil(filteredTests.length / testPageSize),
  );
  const testPageStart = (testPage - 1) * testPageSize;
  const visibleTests = filteredTests.slice(
    testPageStart,
    testPageStart + testPageSize,
  );
  useEffect(() => {
    setTestPage((page) => Math.min(page, testPageCount));
  }, [testPageCount]);
  useEffect(() => {
    setTestPage(1);
  }, [testQuery, testStatus, testAssignee]);
  const title = suite?.title;
  useEffect(() => {
    if (title) onLoaded?.(title);
  }, [title, onLoaded]);
  const loaded = !!suite;
  useEffect(() => {
    if (!focus || !loaded) return;
    if (focus.testId && tests.some((test) => test.id === focus.testId)) {
      setDetailsOpen(false);
      setSelectedId(focus.testId);
    } else if (focus.activityId) setDetailsOpen(true);
    // Only a new anchor (or the first load) should move the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, loaded]);
  const summaryFlash = useFlash(
    detailsOpen ? focus?.activityId : undefined,
    !!suiteActivities.data?.some((item) => item.id === focus?.activityId),
    focus,
  );
  const reported = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (reported.current === selectedId) return;
    reported.current = selectedId;
    onTestChange?.(selectedId);
  }, [selectedId, onTestChange]);
  if (!suite)
    return remote.error ? <ErrorMessage message={remote.error} /> : <Loading />;
  // Archived suites and read-only members (viewers) cannot change anything.
  const readOnly = !!suite.archivedAt || project.role === "viewer";
  const suiteKey = formatSuiteKey(suite.number);
  const indexOf = (id: string | null) =>
    id ? tests.findIndex((test) => test.id === id) : -1;
  const name = (id: string | null) =>
    members.find((member) => member.id === id)?.name ||
    (id ? "Antigo membro" : "Sem responsável");
  const counts = statusCounts(suite.counts);
  const nextTest = tests.find((test) => test.status === "pending");
  const sequence = filteredTests.some((test) => test.id === selectedId)
    ? filteredTests
    : tests;
  const position = sequence.findIndex((test) => test.id === selectedId);
  const activityAction = (item: Activity) => {
    const testIndex = indexOf(item.testId);
    const test = testIndex >= 0 ? tests[testIndex] : undefined;
    const testLink = test ? (
      <button
        type="button"
        className="activity-test-link mono"
        title={test.title}
        onClick={() => {
          setDetailsOpen(false);
          setSelectedId(test.id);
        }}
      >
        {testKey(test.number)}
      </button>
    ) : (
      <span>teste</span>
    );
    const status = item.detail.status;
    const resultStatus =
      status === "pending" || status === "approved" || status === "revoked"
        ? status
        : null;
    switch (item.kind) {
      case "comment":
        return item.testId ? (
          <>adicionou um comentário ao {testLink}</>
        ) : (
          <>adicionou um comentário à suite</>
        );
      case "result_recorded":
        return (
          <>
            marcou {testLink} como{" "}
            {resultStatus ? (
              <span className={`activity-status status-${resultStatus}`}>
                {statusLabel(resultStatus)}
              </span>
            ) : (
              "atualizado"
            )}
          </>
        );
      case "test_created":
        return <>adicionou o {testLink}</>;
      case "test_edited":
        return (
          <>
            atualizou o {testLink}
            {item.detail.resetToPending === true && (
              <span> · resultado reposto para Pendente</span>
            )}
          </>
        );
      case "assignment_changed":
        return <>alterou o responsável do {testLink}</>;
      case "suite_edited":
        return <>atualizou os detalhes da suite</>;
      case "suite_archived":
        return <>arquivou a suite</>;
      case "suite_restored":
        return <>restaurou a suite</>;
      case "test_deleted":
        return (
          <>
            apagou o{" "}
            <span className="mono">{testKey(Number(item.detail.number))}</span>{" "}
            «{String(item.detail.title)}»
          </>
        );
      case "suite_created":
        return <>criou a suite</>;
      default:
        return <>atualizou a suite</>;
    }
  };
  const deleteTest = (test: TestCase) =>
    setConfirmation({
      title: "Apagar teste",
      danger: true,
      description: `O ${testKey(test.number)} «${test.title}» deixa de aparecer para toda a equipa. Resultados, comentários e anexos ficam guardados, mas esta ação não pode ser desfeita na aplicação.`,
      run: async () => {
        await api(`/tests/${test.id}`, "DELETE", undefined, test.version);
        if (selectedId === test.id) setSelectedId(undefined);
        refresh();
      },
    });
  function deleteSuite() {
    setConfirmation({
      title: "Apagar suite",
      danger: true,
      description: `A ${formatSuiteKey(suite!.number)} «${suite!.title}» deixa de aparecer para toda a equipa. Os testes, resultados, comentários e anexos ficam guardados, mas esta ação não pode ser desfeita na aplicação.`,
      run: async () => {
        await api(`/suites/${suiteId}`, "DELETE", undefined, suite!.version);
        refresh();
        navigate();
      },
    });
  }
  function archive() {
    setConfirmation({
      title: suite!.archivedAt ? "Restaurar suite" : "Arquivar suite",
      description: suite!.archivedAt
        ? "A suite voltará às vistas ativas, com os resultados e comentários preservados."
        : "A suite sairá das vistas ativas e ficará apenas de leitura. Poderá restaurá-la na vista Arquivadas.",
      run: async () => {
        await api(
          `/suites/${suiteId}/${suite!.archivedAt ? "restore" : "archive"}`,
          "POST",
          undefined,
          suite!.version,
        );
        refresh();
      },
    });
  }
  async function move(test: TestCase, position: number) {
    try {
      await api(
        `/tests/${test.id}`,
        "PATCH",
        {
          title: test.title,
          instructions: test.instructions,
          expectedResult: test.expectedResult,
          assigneeId: test.assigneeId,
          position,
        },
        test.version,
      );
      refresh();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function record(test: TestCase, status: Status) {
    if (status === "revoked") {
      setSelectedId(undefined);
      setResult({ test, status });
      return;
    }
    setSavingStatus(status);
    setError("");
    try {
      await api(`/tests/${test.id}/result`, "POST", { status }, test.version);
      refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSavingStatus(null);
    }
  }
  /** Final index for the dragged test, or -1 when the drop would not change the order. */
  const dropIndex = (targetId: string, place: "before" | "after") => {
    const from = indexOf(draggedTestId || null);
    const to = indexOf(targetId);
    if (from < 0 || to < 0) return -1;
    const index = (place === "after" ? to + 1 : to) - (from < to ? 1 : 0);
    return index === from ? -1 : index;
  };
  const endDrag = () => {
    setDraggedTestId(undefined);
    setDropTarget(undefined);
  };
  const editTestAction = (test: TestCase) => {
    setEditTest(test);
    setEdit("test");
  };
  return (
    <>
      {remote.error && <ErrorMessage message={remote.error} />}
      {error && <ErrorMessage message={error} />}
      <div className="suite-header">
        <div className="suite-header-main">
          <div className="suite-tags">
            <span className="id-chip mono">{suiteKey}</span>
            <StatusBadge status={suiteDisplayStatus(suite)} suite />
            {suite.archivedAt && (
              <span className="archive-label">Arquivada</span>
            )}
          </div>
          <h1>{suite.title}</h1>
          <p className="suite-meta">
            Criada por {suite.createdBy} ·{" "}
            <span className="mono">{date(suite.createdAt)}</span> · atualizada{" "}
            <span className="mono">{shortDate(suite.updatedAt)}</span>
          </p>
        </div>
        <div className="heading-actions">
          <IconButton
            variant="secondary"
            icon={<PencilSquareIcon />}
            label="Editar suite"
            disabled={readOnly}
            onClick={() => setEdit("suite")}
          />
          <IconButton
            variant="secondary"
            icon={<DocumentDuplicateIcon />}
            label="Duplicar suite"
            disabled={project.role === "viewer"}
            onClick={() =>
              setConfirmation({
                title: "Duplicar suite",
                description:
                  "Criar uma suite independente com os testes pendentes, sem comentários ou resultados anteriores?",
                run: async () => {
                  const copy = await api<Suite>(
                    `/suites/${suiteId}/duplicate`,
                    "POST",
                  );
                  refresh();
                  navigate(copy.id);
                },
              })
            }
          />
          {project.role === "owner" && (
            <IconButton
              variant="secondary"
              icon={suite.archivedAt ? <ArrowPathIcon /> : <ArchiveBoxIcon />}
              label={suite.archivedAt ? "Restaurar suite" : "Arquivar suite"}
              onClick={archive}
            />
          )}
          {project.role === "owner" && (
            <IconButton
              variant="secondary"
              className="danger-icon"
              icon={<TrashIcon />}
              label="Apagar suite"
              onClick={deleteSuite}
            />
          )}
          {nextTest && !readOnly && (
            <Button
              variant="primary"
              icon={<PlayIcon />}
              onClick={() => setSelectedId(nextTest.id)}
            >
              {counts.executed ? "Continuar execução" : "Iniciar execução"}
            </Button>
          )}
        </div>
      </div>
      {suite.archivedAt && (
        <div className="notice">
          Esta suite está arquivada. Consulte o histórico ou restaure-a para
          continuar a colaborar.
        </div>
      )}
      <div className="summary-grid">
        <section
          className="card progress-card"
          aria-labelledby="progress-title"
        >
          <div className="card-heading">
            <h2 className="section-label" id="progress-title">
              Progresso da execução
            </h2>
            <span className="mono muted">
              {counts.executed}/{suite.total} executados
            </span>
          </div>
          <p className="progress-figure">
            <strong>{suite.progress}%</strong>
            <span>
              concluído ·{" "}
              {suite.total
                ? Math.round((counts.approved / suite.total) * 100)
                : 0}
              % aprovado
            </span>
          </p>
          <ProgressBar
            counts={suite.counts}
            total={suite.total}
            size="lg"
            showCount={false}
          />
          <ul className="legend" aria-label="Testes por estado">
            <li>
              <i className="legend-dot legend-pass" aria-hidden /> Aprovados{" "}
              <strong className="mono">{counts.approved}</strong>
            </li>
            <li>
              <i className="legend-dot legend-fail" aria-hidden /> Rejeitados{" "}
              <strong className="mono">{counts.revoked}</strong>
            </li>
            <li>
              <i className="legend-dot legend-pend" aria-hidden /> Pendentes{" "}
              <strong className="mono">{counts.pending}</strong>
            </li>
          </ul>
        </section>
        <section
          className="card description-card"
          aria-labelledby="description-title"
        >
          <h2 className="section-label" id="description-title">
            Descrição
          </h2>
          <div className="description-clamp">
            <Markdown>{suite.description}</Markdown>
          </div>
          {suite.provenance && Object.keys(suite.provenance).length > 0 && (
            <dl className="provenance">
              {Object.entries(suite.provenance).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {key === "repository"
                      ? "Repositório"
                      : key === "branch"
                        ? "Branch"
                        : "Commit"}
                  </dt>
                  <dd className="mono">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => setDetailsOpen(true)}
          >
            Ver detalhes <span aria-hidden>→</span>
          </button>
        </section>
      </div>
      <section className="table-card" aria-labelledby="tests-title">
        <div className="table-card-header">
          <h2 id="tests-title">
            Testes <span className="count-pill mono">{suite.total}</span>
          </h2>
          <div className="toolbar-filters">
            {tests.length > 0 && (
              <>
                <SearchField
                  label="Pesquisar testes"
                  placeholder="Filtrar testes…"
                  value={testQuery}
                  onChange={setTestQuery}
                />
                <MultiFilterMenu<Status>
                  name="testStatus"
                  label="Estado"
                  ariaLabel="Filtrar testes por estado"
                  value={testStatus}
                  onChange={setTestStatus}
                  options={[
                    { value: "pending", label: "Pendente" },
                    { value: "approved", label: "Aprovado" },
                    { value: "revoked", label: "Rejeitado" },
                  ]}
                />
                <FilterMenu
                  name="testAssignee"
                  label="Responsável"
                  ariaLabel="Filtrar testes por responsável"
                  value={testAssignee}
                  onChange={setTestAssignee}
                  options={[
                    { value: "all", label: "Todos" },
                    { value: "unassigned", label: "Sem responsável" },
                    ...members.map((member) => ({
                      value: member.id,
                      label: member.name,
                    })),
                  ]}
                />
              </>
            )}
            <Button
              size="sm"
              icon={<PlusIcon />}
              disabled={readOnly}
              onClick={() => {
                setEditTest(undefined);
                setEdit("test");
              }}
            >
              Adicionar teste
            </Button>
          </div>
        </div>
        {tests.length ? (
          !filteredTests.length ? (
            <Empty title="Nenhum teste encontrado">
              Experimente alterar os filtros.
            </Empty>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table test-table">
                  <thead>
                    <tr>
                      <th className="drag-column">
                        <span className="visually-hidden">Reordenar</span>
                      </th>
                      <th className="id-column">ID</th>
                      <th className="title-column">Teste</th>
                      <th className="priority-column">Prioridade</th>
                      <th className="status-column">Estado</th>
                      <th className="assignee-column">Responsável</th>
                      <th className="testers-column">Testers</th>
                      <th className="date-column">Atualizado</th>
                      <th className="action-column">
                        <span className="visually-hidden">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setDropTarget(undefined);
                    }}
                  >
                    {visibleTests.map((test) => {
                      const index = indexOf(test.id);
                      const stepCount = test.steps.length;
                      return (
                        <tr
                          key={test.id}
                          className={[
                            "clickable-row",
                            draggedTestId === test.id && "dragging",
                            dropTarget?.id === test.id &&
                              `drop-${dropTarget.place}`,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          tabIndex={0}
                          aria-label={`Abrir ${test.title}`}
                          onDragOver={(event) => {
                            if (readOnly || !draggedTestId) return;
                            const row =
                              event.currentTarget.getBoundingClientRect();
                            const place =
                              event.clientY < row.top + row.height / 2
                                ? "before"
                                : "after";
                            if (dropIndex(test.id, place) < 0) {
                              setDropTarget(undefined);
                              return;
                            }
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            if (
                              dropTarget?.id !== test.id ||
                              dropTarget.place !== place
                            )
                              setDropTarget({ id: test.id, place });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const dragged = tests.find(
                              (candidate) => candidate.id === draggedTestId,
                            );
                            const index = dropTarget
                              ? dropIndex(dropTarget.id, dropTarget.place)
                              : -1;
                            endDrag();
                            if (dragged && index >= 0)
                              void move(dragged, index);
                          }}
                          onClick={() => setSelectedId(test.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedId(test.id);
                            }
                          }}
                        >
                          <td
                            className="drag-column"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="drag-handle"
                              draggable={!readOnly}
                              disabled={readOnly}
                              aria-label={`Reordenar ${test.title}`}
                              title="Arrastar para reordenar"
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  test.id,
                                );
                                // Show the whole row under the pointer, not just the handle.
                                const row = event.currentTarget.closest("tr");
                                if (row) {
                                  const box = row.getBoundingClientRect();
                                  event.dataTransfer.setDragImage(
                                    row,
                                    event.clientX - box.left,
                                    event.clientY - box.top,
                                  );
                                }
                                setDraggedTestId(test.id);
                              }}
                              onDragEnd={endDrag}
                            >
                              <svg viewBox="0 0 16 16" aria-hidden>
                                {[3, 8, 13].flatMap((y) =>
                                  [6, 10].map((x) => (
                                    <circle
                                      key={`${x}-${y}`}
                                      cx={x}
                                      cy={y}
                                      r="1.2"
                                    />
                                  )),
                                )}
                              </svg>
                            </button>
                          </td>
                          <td className="id-column mono">
                            {testKey(test.number)}
                          </td>
                          <td className="title-column">
                            <strong className="row-title">{test.title}</strong>
                            {stepCount > 0 && (
                              <span className="row-meta">
                                {" "}
                                · {stepCount}{" "}
                                {stepCount === 1 ? "passo" : "passos"}
                              </span>
                            )}
                          </td>
                          <td className="priority-column">
                            <Priority value={test.priority} />
                          </td>
                          <td className="status-column">
                            <StatusBadge status={test.status} />
                          </td>
                          <td className="assignee-column">
                            <Assignee
                              projectId={project.id}
                              member={members.find(
                                (member) => member.id === test.assigneeId,
                              )}
                            />
                          </td>
                          <td className="testers-column">
                            <AvatarStack
                              projectId={project.id}
                              people={test.testers}
                              members={members}
                            />
                          </td>
                          <td className="mono date-column">
                            {shortDate(test.updatedAt)}
                          </td>
                          <td className="action-column">
                            <div
                              className="row-actions"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <OverflowActions
                                label={`Ações de ${test.title}`}
                                actions={[
                                  {
                                    label: "Editar",
                                    icon: <PencilSquareIcon />,
                                    disabled: readOnly,
                                    onClick: () => editTestAction(test),
                                  },
                                  {
                                    label: "Mover para cima",
                                    icon: <ArrowUpIcon />,
                                    disabled: readOnly || index === 0,
                                    onClick: () => void move(test, index - 1),
                                  },
                                  {
                                    label: "Mover para baixo",
                                    icon: <ArrowDownIcon />,
                                    disabled:
                                      readOnly || index === tests.length - 1,
                                    onClick: () => void move(test, index + 1),
                                  },
                                  ...(project.role === "owner" ||
                                  (userId && test.assigneeId === userId)
                                    ? [
                                        {
                                          label: "Apagar",
                                          icon: <TrashIcon />,
                                          disabled: readOnly,
                                          onClick: () => deleteTest(test),
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredTests.length > pageSizes[0] && (
                <Pagination
                  label="Paginação dos testes"
                  noun={["teste", "testes"]}
                  total={filteredTests.length}
                  page={testPage}
                  pageSize={testPageSize}
                  onPage={setTestPage}
                  onPageSize={(size) => {
                    setTestPageSize(size);
                    setTestPage(1);
                  }}
                />
              )}
            </>
          )
        ) : (
          <Empty title="Adicione o primeiro teste">
            Descreva os passos a verificar e o resultado esperado.
          </Empty>
        )}
      </section>
      {detailsOpen && (
        <Modal title="Detalhes da suite" onClose={() => setDetailsOpen(false)}>
          <div className="suite-details-drawer">
            <section>
              <h3 className="section-label">Descrição</h3>
              <Markdown>{suite.description}</Markdown>
            </section>
            <section>
              <h3 className="section-label">Metadados</h3>
              <dl className="meta-list">
                <div>
                  <dt>Estado</dt>
                  <dd>
                    <StatusBadge status={suiteDisplayStatus(suite)} suite />
                  </dd>
                </div>
                <div>
                  <dt>Criada por</dt>
                  <dd>{suite.createdBy}</dd>
                </div>
                <div>
                  <dt>Criada em</dt>
                  <dd className="mono">{date(suite.createdAt)}</dd>
                </div>
                <div>
                  <dt>Atualizada</dt>
                  <dd className="mono">{date(suite.updatedAt)}</dd>
                </div>
                {suite.archivedAt && (
                  <>
                    <div>
                      <dt>Arquivada em</dt>
                      <dd className="mono">{date(suite.archivedAt)}</dd>
                    </div>
                    <div>
                      <dt>Arquivada por</dt>
                      <dd>{name(suite.archivedBy)}</dd>
                    </div>
                  </>
                )}
                {suite.provenance &&
                  Object.entries(suite.provenance).map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {key === "repository"
                          ? "Repositório"
                          : key === "branch"
                            ? "Branch"
                            : "Commit"}
                      </dt>
                      <dd className="mono">{value}</dd>
                    </div>
                  ))}
              </dl>
            </section>
            <section>
              <h3 className="section-label">Resumo da atividade</h3>
              {suiteActivities.error && (
                <ErrorMessage message={suiteActivities.error} />
              )}
              {suiteActivities.loading ? (
                <Loading />
              ) : suiteActivities.data?.length ? (
                <ol className="timeline suite-activity-summary">
                  {suiteActivities.data
                    .slice(-20)
                    .reverse()
                    .map((item) => (
                      <li
                        key={item.id}
                        data-activity={item.id}
                        className={
                          item.id === summaryFlash
                            ? "timeline-flash"
                            : undefined
                        }
                      >
                        <span className="timeline-dot" aria-hidden />
                        <div className="timeline-entry">
                          <p>
                            <strong>{item.actorName}</strong>{" "}
                            {activityAction(item)}
                          </p>
                          <time className="mono" dateTime={item.createdAt}>
                            {date(item.createdAt)}
                          </time>
                        </div>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="muted">Ainda não existe atividade nesta suite.</p>
              )}
            </section>
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          title={selected.title}
          variant="drawer"
          onClose={() => setSelectedId(undefined)}
          toolbar={
            <span className="drawer-path mono">
              {suiteKey} / {testKey(selected.number)}
            </span>
          }
          actions={
            <>
              <IconButton
                icon={<ChevronUpIcon />}
                label="Teste anterior"
                disabled={position <= 0}
                onClick={() => setSelectedId(sequence[position - 1].id)}
              />
              <IconButton
                icon={<ChevronDownIcon />}
                label="Teste seguinte"
                disabled={position < 0 || position >= sequence.length - 1}
                onClick={() => setSelectedId(sequence[position + 1].id)}
              />
            </>
          }
          footer={
            <div className="drawer-footer">
              <div
                className="result-bar"
                role="group"
                aria-labelledby="result-label"
              >
                <span className="result-label" id="result-label">
                  Resultado
                </span>
                {(["approved", "revoked", "pending"] as Status[]).map(
                  (status) => (
                    <Button
                      key={status}
                      className={`result-button result-${status}`}
                      aria-pressed={selected.status === status}
                      icon={<StatusIcon status={status} />}
                      disabled={readOnly || savingStatus !== null}
                      onClick={() => {
                        if (status !== selected.status)
                          void record(selected, status);
                      }}
                    >
                      {savingStatus === status
                        ? "A guardar…"
                        : status === "approved"
                          ? "Aprovar"
                          : status === "revoked"
                            ? "Rejeitar"
                            : "Pendente"}
                    </Button>
                  ),
                )}
              </div>
              <Button
                className="next-test"
                icon={<ChevronRightIcon />}
                disabled={
                  position < 0 ||
                  position >= sequence.length - 1 ||
                  savingStatus !== null
                }
                onClick={() => setSelectedId(sequence[position + 1].id)}
              >
                Próximo
              </Button>
            </div>
          }
        >
          <TestPanel
            key={selected.id}
            test={selected}
            suite={suite}
            project={project}
            members={members}
            readOnly={readOnly}
            onSaved={refresh}
            activity={
              activities.error ? (
                <ErrorMessage message={activities.error} />
              ) : activities.loading ? (
                <Loading />
              ) : (
                <Timeline
                  items={(activities.data || []).filter(
                    (item) => item.testId === selected.id,
                  )}
                  focusId={focus?.activityId}
                  focusKey={focus}
                />
              )
            }
          />
        </Modal>
      )}
      {edit && (
        <DefinitionForm
          kind={edit}
          suite={suite}
          test={editTest}
          members={assignable(members)}
          onSaved={refresh}
          onClose={() => {
            setEdit(null);
            setEditTest(undefined);
          }}
        />
      )}
      {result && (
        <ResultForm
          {...result}
          members={members}
          onSaved={refresh}
          onClose={() => {
            setSelectedId(result.test.id);
            setResult(null);
          }}
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

function TestPanel({
  test,
  suite,
  project,
  members,
  readOnly,
  onSaved,
  activity,
}: {
  test: TestCase;
  suite: Suite;
  project: Project;
  members: Member[];
  readOnly: boolean;
  onSaved(): void;
  activity: ReactNode;
}) {
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState("");
  // Latest step returned by the API until the next refresh brings it in.
  const [updated, setUpdated] = useState<Record<string, TestStep>>({});
  const steps = test.steps.map((step) => {
    const latest = updated[step.id];
    return latest && latest.version > step.version ? latest : step;
  });
  const executed = steps.filter((step) => step.status !== "pending").length;
  async function mark(step: TestStep, status: "passed" | "failed") {
    setSaving(step.id);
    setError("");
    try {
      const result = await api<TestStep>(
        `/tests/${test.id}/steps/${step.id}/result`,
        "POST",
        { status: step.status === status ? "pending" : status },
        step.version,
      );
      setUpdated((current) => ({ ...current, [step.id]: result }));
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(undefined);
    }
  }
  return (
    <>
      <dl className="meta-list test-meta-list">
        <div>
          <dt>Estado</dt>
          <dd className="test-meta">
            <StatusBadge status={test.status} />
          </dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>
            <Priority value={test.priority} />
          </dd>
        </div>
        <div>
          <dt>Responsável</dt>
          <dd>
            <Assignee
              projectId={project.id}
              member={members.find((member) => member.id === test.assigneeId)}
            />
          </dd>
        </div>
        <div>
          <dt>Testers</dt>
          <dd>
            {test.testers.length ? (
              <ul className="tester-list">
                {test.testers.map((tester) => (
                  <li key={tester.id}>
                    <Avatar name={tester.name} />
                    {tester.name}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">Ainda sem testers</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Suite</dt>
          <dd className="accent">{suite.title}</dd>
        </div>
        {steps.length > 0 && (
          <div>
            <dt>Passos</dt>
            <dd className="mono">
              {executed}/{steps.length} executados
            </dd>
          </div>
        )}
      </dl>
      {test.instructions && (
        <section className="drawer-section">
          <h3 className="section-label">Instruções</h3>
          <Markdown>{test.instructions}</Markdown>
        </section>
      )}
      {steps.length > 0 && (
        <section className="drawer-section">
          <h3 className="section-label">Passos</h3>
          {error && <ErrorMessage message={error} />}
          <ol className="steps">
            {steps.map((step, index) => (
              <li key={step.id} className={`step step-${step.status}`}>
                <span className="step-number mono" aria-hidden>
                  {index + 1}
                </span>
                <div className="step-text">
                  <Markdown>{step.body}</Markdown>
                  {step.status !== "pending" && step.updatedByName && (
                    <small className="step-meta">
                      {step.status === "passed" ? "Passou" : "Falhou"} ·{" "}
                      {step.updatedByName} ·{" "}
                      <span className="mono">{shortDate(step.updatedAt)}</span>
                    </small>
                  )}
                </div>
                <div className="step-actions">
                  <IconButton
                    size="sm"
                    variant="secondary"
                    className="step-mark-pass"
                    icon={<CheckIcon />}
                    label={`Passo ${index + 1}: passou`}
                    aria-pressed={step.status === "passed"}
                    disabled={readOnly || saving === step.id}
                    onClick={() => void mark(step, "passed")}
                  />
                  <IconButton
                    size="sm"
                    variant="secondary"
                    className="step-mark-fail"
                    icon={<XMarkIcon />}
                    label={`Passo ${index + 1}: falhou`}
                    aria-pressed={step.status === "failed"}
                    disabled={readOnly || saving === step.id}
                    onClick={() => void mark(step, "failed")}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!test.instructions && !steps.length && (
        <section className="drawer-section">
          <h3 className="section-label">Instruções</h3>
          <p className="muted">Sem instruções.</p>
        </section>
      )}
      <section className="drawer-section">
        <h3 className="section-label">Resultado esperado</h3>
        <div className="expected-box">
          <Markdown>{test.expectedResult}</Markdown>
        </div>
      </section>
      <section className="drawer-section">
        <h3 className="section-label">Comentários</h3>
        {readOnly ? (
          <p className="muted">Suite arquivada: só de leitura.</p>
        ) : (
          <CommentForm
            path={`/tests/${test.id}/comments`}
            target={{ suiteId: suite.id, testId: test.id }}
            members={members}
            onSaved={onSaved}
          />
        )}
      </section>
      <section className="drawer-section">
        <h3 className="section-label">Atividade</h3>
        {activity}
      </section>
    </>
  );
}
