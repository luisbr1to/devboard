import { useState, type ReactNode } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolidIcon } from "@heroicons/react/16/solid";
import type { Activity, Member } from "../shared/contracts";
import {
  Avatar,
  Button,
  ErrorMessage,
  IconButton,
  Markdown,
  MarkdownField,
  UserAvatar,
} from "./components";
import { AttachmentList } from "./attachments";
import { CommentForm } from "./forms";
import { mentionIds } from "./mentions";
import { roleLabels } from "./MembersTable";
import { date } from "./presentation";
import { api, type UploadTarget } from "./api";

/** Who reads the comments of a test, suite or issue, and what they may change. */
export interface CommentScope {
  projectId: string;
  members: Member[];
  userId?: string;
  /** Left out where comments are read-only (viewers, archived items). */
  write?: {
    /** Where new comments and replies are posted. */
    commentsPath: string;
    /** `/suites/{id}` or `/issues/{id}`, which holds the comment and discussion endpoints. */
    basePath: string;
    target: UploadTarget;
    onChanged(): void;
  };
}
/** A comment of the timeline with the replies it gathers when it starts a discussion. */
export interface CommentEntry {
  item: Activity;
  replies: Activity[];
  /** Test the comment belongs to, when the timeline mixes several. */
  context: string | null;
  flash?: string;
  focusId?: string;
}

function Author({ item, scope }: { item: Activity; scope: CommentScope }) {
  const member = scope.members.find((person) => person.id === item.actorId);
  return member ? (
    <UserAvatar projectId={scope.projectId} member={member} />
  ) : (
    <Avatar name={item.actorName} size="medium" />
  );
}
function CommentEditor({
  item,
  path,
  members,
  onCancel,
  onSaved,
}: {
  item: Activity;
  path: string;
  members: Member[];
  onCancel(): void;
  onSaved(): void;
}) {
  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const empty = !body.trim() && !item.attachments?.length;
  return (
    <form
      className="note-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(path, "PATCH", { body, mentions: mentionIds(body) });
          onSaved();
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <MarkdownField
        label="Editar comentário"
        value={body}
        onChange={setBody}
        compact
        focusOnMount
        mentionables={members}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onCancel}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={empty || body.trim() === item.body.trim()}
              disabledFocusable={busy}
            >
              {busy ? "A guardar…" : "Guardar"}
            </Button>
          </>
        }
      />
      {error && <ErrorMessage message={error} />}
    </form>
  );
}
/** One comment with its author's avatar; the author edits it in place. */
function Note({
  item,
  scope,
  lead,
}: {
  item: Activity;
  scope: CommentScope;
  /** Text after the author's name (e.g. "comentou em TC-2"). */
  lead?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const role = scope.members.find((person) => person.id === item.actorId)?.role;
  const write = scope.write;
  const mine = !!write && !!scope.userId && item.actorId === scope.userId;
  return (
    <div className="note">
      <Author item={item} scope={scope} />
      <div className="note-main">
        <header className="note-header">
          <span className="note-byline">
            <strong>{item.actorName}</strong>
            {lead && <> {lead}</>}
            <span className="note-time">
              {" · "}
              <time className="mono" dateTime={item.createdAt}>
                {date(item.createdAt)}
              </time>
            </span>
          </span>
          <span className="note-tools">
            {role === "owner" && (
              <span className="note-role">{roleLabels.owner}</span>
            )}
            {mine && !editing && (
              <IconButton
                size="sm"
                label="Editar comentário"
                icon={<PencilIcon />}
                onClick={() => setEditing(true)}
              />
            )}
          </span>
        </header>
        {editing && write ? (
          <CommentEditor
            item={item}
            path={`${write.basePath}/comments/${item.id}`}
            members={scope.members}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              write.onChanged();
            }}
          />
        ) : (
          <div className="note-body">
            {item.body && <Markdown>{item.body}</Markdown>}
            <AttachmentList files={item.attachments || []} />
          </div>
        )}
        {item.editedAt && !editing && (
          <p className="note-edited">
            Editado em{" "}
            <time className="mono" dateTime={item.editedAt}>
              {date(item.editedAt)}
            </time>
          </p>
        )}
      </div>
    </div>
  );
}
/** Reply field and resolve button closing a discussion, as in GitLab threads. */
function DiscussionFooter({
  discussion,
  scope,
}: {
  discussion: Activity;
  scope: CommentScope & { write: NonNullable<CommentScope["write"]> };
}) {
  const { write } = scope;
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolved = !!discussion.resolvedAt;
  const me = scope.members.find((person) => person.id === scope.userId);
  async function resolve() {
    setBusy(true);
    setError("");
    try {
      await api(`${write.basePath}/discussions/${discussion.id}`, "PATCH", {
        resolved: !resolved,
      });
      setReplying(false);
      write.onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <footer className="discussion-footer">
      {me && <UserAvatar projectId={scope.projectId} member={me} />}
      <div className="discussion-footer-main">
        {replying ? (
          <CommentForm
            path={write.commentsPath}
            target={write.target}
            members={scope.members}
            replyTo={discussion.id}
            onCancel={() => setReplying(false)}
            onSaved={() => {
              setReplying(false);
              write.onChanged();
            }}
          />
        ) : (
          <div className="discussion-toolbar">
            <button
              type="button"
              className="discussion-reply-trigger"
              onClick={() => setReplying(true)}
            >
              Responder…
            </button>
            <Button
              size="sm"
              icon={resolved ? <ArrowPathIcon /> : <CheckCircleIcon />}
              disabledFocusable={busy}
              onClick={() => void resolve()}
            >
              {resolved ? "Reabrir discussão" : "Resolver discussão"}
            </Button>
          </div>
        )}
        {error && <ErrorMessage message={error} />}
      </div>
    </footer>
  );
}
/** First comment of a discussion with its replies; resolved discussions start folded. */
function Discussion({
  root,
  replies,
  context,
  flash,
  focusId,
  scope,
}: {
  root: Activity;
  replies: Activity[];
  context: string | null;
  flash?: string;
  focusId?: string;
  scope: CommentScope;
}) {
  const [shown, setShown] = useState<boolean>();
  const resolved = !!root.resolvedAt;
  const open =
    shown ?? (!resolved || replies.some((reply) => reply.id === focusId));
  const count = `${replies.length} ${replies.length === 1 ? "resposta" : "respostas"}`;
  const toggle = open
    ? "Ocultar discussão"
    : replies.length
      ? `Mostrar discussão (${count})`
      : "Mostrar discussão";
  return (
    <article className={`discussion${resolved ? " discussion-resolved" : ""}`}>
      <header className="discussion-header">
        <div className="discussion-summary">
          <p>
            <strong>{root.actorName}</strong> iniciou uma discussão
            {context && <> em {context}</>}
            <span className="note-time">
              {" · "}
              <time className="mono" dateTime={root.createdAt}>
                {date(root.createdAt)}
              </time>
            </span>
          </p>
          {resolved && (
            <p className="discussion-resolved-by">
              <CheckCircleSolidIcon aria-hidden />
              <span>
                Resolvida por{" "}
                <strong>{root.resolvedByName || "antigo membro"}</strong>
                <span className="note-time">
                  {" · "}
                  <time className="mono" dateTime={root.resolvedAt!}>
                    {date(root.resolvedAt!)}
                  </time>
                </span>
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          className="discussion-toggle"
          aria-expanded={open}
          aria-label={toggle}
          title={toggle}
          onClick={() => setShown(!open)}
        >
          {open ? (
            <ChevronUpIcon aria-hidden />
          ) : (
            <ChevronDownIcon aria-hidden />
          )}
          {open ? "Ocultar" : replies.length ? count : "Mostrar"}
        </button>
      </header>
      {open && (
        <>
          <ol className="discussion-notes">
            <li>
              <Note item={root} scope={scope} />
            </li>
            {replies.map((reply) => (
              <li
                key={reply.id}
                data-activity={reply.id}
                className={reply.id === flash ? "timeline-flash" : undefined}
              >
                <Note item={reply} scope={scope} />
              </li>
            ))}
          </ol>
          {scope.write && (
            <DiscussionFooter
              discussion={root}
              scope={{ ...scope, write: scope.write }}
            />
          )}
        </>
      )}
    </article>
  );
}
/** A plain comment, or a discussion with its replies, in the activity timeline. */
export function CommentThread({
  entry,
  scope,
}: {
  entry: CommentEntry;
  scope: CommentScope;
}) {
  const { item, context } = entry;
  return item.discussion ? (
    <Discussion
      root={item}
      replies={entry.replies}
      context={context}
      flash={entry.flash}
      focusId={entry.focusId}
      scope={scope}
    />
  ) : (
    <article className="timeline-comment note-card">
      <Note
        item={item}
        scope={scope}
        lead={
          <>
            {item.replyTo ? "respondeu a uma discussão" : "comentou"}
            {context && <> em {context}</>}
          </>
        }
      />
    </article>
  );
}
