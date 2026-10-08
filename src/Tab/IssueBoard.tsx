import { useEffect, useState, type DragEvent } from "react";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChatBubbleLeftIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import type {
  Issue,
  IssueConfig,
  IssueStatus,
  Member,
  Project,
} from "../shared/contracts";
import {
  AvatarStack,
  IconButton,
  OverflowActions,
  type OverflowAction,
} from "./components";
import { issueKey } from "./presentation";
import { Priority, StatusTag, TagList } from "./issueUi";

/** Kanban view: one column per visible status, in the user's order. */
export function IssueBoard({
  issues,
  config,
  statuses,
  onReorder,
  project,
  members,
  actions,
  onOpen,
  onCreate,
  onMove,
  readOnly = false,
}: {
  issues: Issue[];
  config: IssueConfig;
  /** Visible status columns, in the user's order. */
  statuses: IssueStatus[];
  /** Moves the `id` column next to `target`; a personal view, so every role may do it. */
  onReorder(id: string, target: string, after: boolean): void;
  project: Project;
  members: Member[];
  actions(issue: Issue): OverflowAction[];
  onOpen(id: string): void;
  onCreate(statusId: string): void;
  onMove(issue: Issue, statusId: string, position: number): Promise<void>;
  /** Read-only members see the board without moving or creating cards. */
  readOnly?: boolean;
}) {
  // Local order so a drop shows immediately; the next refresh brings the server's.
  const [items, setItems] = useState(issues);
  useEffect(() => setItems(issues), [issues]);
  const [dragged, setDragged] = useState<string>();
  const [target, setTarget] = useState<{ statusId: string; index: number }>();
  const [draggedColumn, setDraggedColumn] = useState<string>();
  const [columnTarget, setColumnTarget] = useState<{
    id: string;
    after: boolean;
  }>();
  const column = (statusId: string) =>
    items
      .filter((issue) => issue.statusId === statusId)
      .sort((a, b) => a.position - b.position);
  async function move(issue: Issue, statusId: string, index: number) {
    const source = column(issue.statusId);
    const from = source.findIndex((item) => item.id === issue.id);
    // `index` counts the dragged card when it stays in its column.
    const position =
      statusId === issue.statusId && index > from ? index - 1 : index;
    if (statusId === issue.statusId && position === from) return;
    const destination = column(statusId).filter((item) => item.id !== issue.id);
    destination.splice(position, 0, { ...issue, statusId });
    setItems((current) => [
      ...current.filter(
        (item) => item.statusId !== statusId && item.id !== issue.id,
      ),
      ...destination.map((item, order) => ({ ...item, position: order })),
    ]);
    await onMove(issue, statusId, position);
  }
  const dropIndex = (event: DragEvent<HTMLElement>, statusId: string) => {
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-card]"),
    ];
    const index = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    return { statusId, index: index < 0 ? cards.length : index };
  };
  return (
    <div className="board" role="list" aria-label="Board de issues">
      {statuses.map((status, statusIndex) => {
        const cards = column(status.id);
        const columnDrop =
          columnTarget?.id === status.id ? columnTarget : undefined;
        return (
          <section
            key={status.id}
            className={[
              "board-column",
              target?.statusId === status.id && "board-drop",
              draggedColumn === status.id && "dragging",
              columnDrop && (columnDrop.after ? "drop-after" : "drop-before"),
            ]
              .filter(Boolean)
              .join(" ")}
            role="listitem"
            aria-label={`${status.name}: ${cards.length} issues`}
            onDragOver={(event) => {
              if (draggedColumn) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const after = event.clientX > rect.left + rect.width / 2;
                if (columnDrop?.after !== after || !columnDrop)
                  setColumnTarget({ id: status.id, after });
                return;
              }
              if (!dragged) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const next = dropIndex(event, status.id);
              if (
                next.statusId !== target?.statusId ||
                next.index !== target?.index
              )
                setTarget(next);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setTarget(undefined);
                setColumnTarget(undefined);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedColumn) {
                if (columnDrop && draggedColumn !== status.id)
                  onReorder(draggedColumn, status.id, columnDrop.after);
                setDraggedColumn(undefined);
                setColumnTarget(undefined);
                return;
              }
              const issue = items.find((item) => item.id === dragged);
              const drop = dropIndex(event, status.id);
              setDragged(undefined);
              setTarget(undefined);
              if (issue) void move(issue, drop.statusId, drop.index);
            }}
          >
            <header
              className="board-column-header"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", status.id);
                setDraggedColumn(status.id);
              }}
              onDragEnd={() => {
                setDraggedColumn(undefined);
                setColumnTarget(undefined);
              }}
            >
              <button
                type="button"
                className="column-handle board-column-handle"
                title="Arraste para reordenar (Alt+← / Alt+→)"
                aria-label={`Coluna ${status.name}: Alt+seta para a esquerda ou direita para mover`}
                onKeyDown={(event) => {
                  if (
                    !event.altKey ||
                    (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  )
                    return;
                  event.preventDefault();
                  const left = event.key === "ArrowLeft";
                  const neighbour = statuses[statusIndex + (left ? -1 : 1)];
                  if (neighbour) onReorder(status.id, neighbour.id, !left);
                }}
              >
                <StatusTag status={status} />
              </button>
              <span className="count-pill mono">{cards.length}</span>
              {!readOnly && (
                <IconButton
                  size="sm"
                  icon={<PlusIcon />}
                  label={`Novo issue em ${status.name}`}
                  onClick={() => onCreate(status.id)}
                />
              )}
            </header>
            <ol className="board-cards">
              {cards.map((issue, index) => {
                const position = config.statuses.findIndex(
                  (item) => item.id === issue.statusId,
                );
                const keyboard: OverflowAction[] = [
                  {
                    label: "Mover para cima",
                    icon: <ArrowUpIcon />,
                    disabled: index === 0,
                    onClick: () => void move(issue, issue.statusId, index - 1),
                  },
                  {
                    label: "Mover para baixo",
                    icon: <ArrowDownIcon />,
                    disabled: index === cards.length - 1,
                    onClick: () => void move(issue, issue.statusId, index + 2),
                  },
                  ...config.statuses
                    .filter((_, order) => order !== position)
                    .map((item) => ({
                      label: `Mover para ${item.name}`,
                      icon: <ArrowRightIcon />,
                      onClick: () =>
                        void move(issue, item.id, column(item.id).length),
                    })),
                ];
                const dropBefore =
                  target?.statusId === status.id && target.index === index;
                return (
                  <li
                    key={issue.id}
                    data-card
                    className={[
                      "board-card",
                      dragged === issue.id && "dragging",
                      dropBefore && "drop-before",
                      target?.statusId === status.id &&
                        target.index === cards.length &&
                        index === cards.length - 1 &&
                        "drop-after",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", issue.id);
                      setDragged(issue.id);
                    }}
                    onDragEnd={() => {
                      setDragged(undefined);
                      setTarget(undefined);
                    }}
                  >
                    <button
                      type="button"
                      className="board-card-open"
                      onClick={() => onOpen(issue.id)}
                    >
                      <span className="board-card-key mono">
                        {issueKey(issue.number)}
                      </span>
                      <strong>{issue.title}</strong>
                    </button>
                    {(issue.priority ||
                      issue.moduleIds.length > 0 ||
                      issue.labelIds.length > 0) && (
                      <div className="board-card-tags">
                        {issue.priority && <Priority value={issue.priority} />}
                        {issue.moduleIds.length > 0 && (
                          <TagList
                            ids={issue.moduleIds}
                            items={config.modules}
                          />
                        )}
                        {issue.labelIds.length > 0 && (
                          <TagList ids={issue.labelIds} items={config.labels} />
                        )}
                      </div>
                    )}
                    <footer className="board-card-footer">
                      <AvatarStack
                        projectId={project.id}
                        people={issue.assignees}
                        members={members}
                        max={3}
                        label="Responsáveis"
                      />
                      {issue.comments > 0 && (
                        <span
                          className="board-card-comments mono"
                          title={`${issue.comments} comentários`}
                        >
                          <ChatBubbleLeftIcon aria-hidden />
                          {issue.comments}
                        </span>
                      )}
                      {!readOnly && (
                        <OverflowActions
                          label={`Ações de ${issue.title}`}
                          actions={
                            readOnly
                              ? actions(issue)
                              : [...keyboard, ...actions(issue)]
                          }
                        />
                      )}
                    </footer>
                  </li>
                );
              })}
            </ol>
            {!cards.length && <p className="board-empty muted">Sem issues</p>}
          </section>
        );
      })}
    </div>
  );
}
