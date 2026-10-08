import { useState } from "react";
import {
  Popover,
  PopoverSurface,
  PopoverTrigger,
} from "@fluentui/react-components";
import { BellIcon } from "@heroicons/react/24/outline";
import type { AppNotification, Status } from "../shared/contracts";
import { api, useRemote } from "./api";
import { Avatar, Button, statusLabel } from "./components";
import { date, issueKey, suiteKey, testKey } from "./presentation";
import { route } from "./routes";

function describe(item: AppNotification) {
  const test = item.testNumber ? testKey(item.testNumber) : "";
  const suite = item.suiteNumber ? suiteKey(item.suiteNumber) : "";
  const issue = item.issueNumber
    ? issueKey(item.issueNumber)
    : typeof item.detail.number === "number"
      ? issueKey(item.detail.number)
      : "o issue";
  const status = item.detail.status as Status | undefined;
  switch (item.kind) {
    case "result":
      return `${item.actorName} marcou ${test} como ${status ? statusLabel(status) : "atualizado"}`;
    case "comment":
      return test
        ? `${item.actorName} comentou em ${test}`
        : `${item.actorName} comentou na suite ${suite}`;
    case "mention":
      return `Menção de ${item.actorName} em ${test || suite}`;
    case "assignment":
      return `${item.actorName} atribuiu-lhe ${test}`;
    case "suite_created":
      return `${item.actorName} criou a suite ${suite}`;
    case "test_added":
      return `${item.actorName} adicionou ${test} à suite ${suite}`;
    case "suite_archived":
      return `${item.actorName} arquivou a suite ${suite}`;
    case "suite_restored":
      return `${item.actorName} restaurou a suite ${suite}`;
    case "suite_edited":
      return `${item.actorName} editou a suite ${suite}`;
    case "test_edited":
      return `${item.actorName} alterou ${test}`;
    case "test_deleted":
      return `${item.actorName} apagou ${test}`;
    case "suite_deleted":
      return `${item.actorName} apagou a suite ${suite}`;
    case "issue_assignment":
      return `${item.actorName} atribuiu-lhe ${issue}`;
    case "issue_comment":
      return `${item.actorName} comentou em ${issue}`;
    case "issue_mention":
      return `Menção de ${item.actorName} em ${issue}`;
    case "issue_status":
      return `${item.actorName} mudou ${issue} para ${String(item.detail.status || "outro estado")}`;
    case "issue_deleted":
      return `${item.actorName} apagou ${issue}`;
  }
}

/** Bell with unread count and a panel of recent notifications with links to their place. */
export function NotificationCenter({
  revision,
  refresh,
}: {
  revision: number;
  refresh(): void;
}) {
  const [open, setOpen] = useState(false);
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const remote = useRemote<{ items: AppNotification[]; unread: number }>(
    "/notifications?limit=30",
    revision,
  );
  const items = (remote.data?.items || []).map((item) =>
    readNow.has(item.id) && !item.readAt
      ? { ...item, readAt: new Date().toISOString() }
      : item,
  );
  const unread = Math.max(
    0,
    (remote.data?.unread || 0) -
      (remote.data?.items || []).filter(
        (item) => !item.readAt && readNow.has(item.id),
      ).length,
  );
  const markAll = async () => {
    setReadNow(new Set(items.map((item) => item.id)));
    await api("/notifications/read-all", "POST").catch(() => undefined);
    refresh();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      positioning="below-end"
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>
        <button
          type="button"
          className="btn btn-ghost btn-md btn-icon-only bell"
          aria-label={
            unread
              ? `Notificações, ${unread} por ler`
              : "Notificações, nenhuma por ler"
          }
          title="Notificações"
        >
          <BellIcon aria-hidden />
          {unread > 0 && (
            <span className="bell-count mono" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverSurface className="notification-panel" aria-label="Notificações">
        <header>
          <h2>Notificações</h2>
          <Button
            size="sm"
            variant="ghost"
            disabled={!unread}
            onClick={() => void markAll()}
          >
            Marcar todas como lidas
          </Button>
        </header>
        {items.length ? (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`notification ${item.readAt ? "" : "unread"}`}
                  onClick={() => {
                    if (!item.readAt) {
                      setReadNow((current) => new Set(current).add(item.id));
                      void api(`/notifications/${item.id}/read`, "POST").catch(
                        () => undefined,
                      );
                    }
                    setOpen(false);
                    // Deleted items open the closest place that still exists.
                    if (item.issueId)
                      route(item.projectId, "", "dev", {
                        issue: item.issueDeleted ? null : item.issueId,
                        activity: item.activityId,
                      });
                    else
                      route(
                        item.projectId,
                        item.suiteDeleted ? "" : item.suiteId || "",
                        "suites",
                        item.testDeleted
                          ? { activity: item.activityId }
                          : { test: item.testId, activity: item.activityId },
                      );
                  }}
                >
                  <Avatar name={item.actorName} />
                  <span className="notification-body">
                    <strong>{describe(item)}</strong>
                    <span className="notification-context">
                      {item.issueTitle ||
                        (typeof item.detail.title === "string" &&
                          item.kind === "issue_deleted" &&
                          item.detail.title) ||
                        item.testTitle ||
                        item.suiteTitle}
                      {(item.testDeleted ||
                        item.suiteDeleted ||
                        item.issueDeleted) &&
                        " (apagado)"}
                      {" · "}
                      {item.projectName}
                    </span>
                    {item.kind === "test_edited" &&
                      item.detail.resetToPending === true && (
                        <span className="notification-excerpt">
                          Instruções alteradas: resultado reposto para pendente
                        </span>
                      )}
                    {typeof item.detail.excerpt === "string" &&
                      item.detail.excerpt && (
                        <span className="notification-excerpt">
                          “{item.detail.excerpt}”
                        </span>
                      )}
                    <time className="mono" dateTime={item.createdAt}>
                      {date(item.createdAt)}
                    </time>
                  </span>
                  {!item.readAt && (
                    <span className="unread-dot" aria-label="Por ler" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted notification-empty">
            {remote.error || "Sem notificações."}
          </p>
        )}
      </PopoverSurface>
    </Popover>
  );
}
