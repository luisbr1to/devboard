import { useState } from "react";
import { ArrowPathIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import type { Activity, Member } from "../shared/contracts";
import { Button, ErrorMessage } from "./components";
import { CommentForm } from "./forms";
import { api, type UploadTarget } from "./api";

/** Reply and resolve controls under a discussion, as in GitLab threads. */
export function DiscussionActions({
  discussion,
  path,
  resolvePath,
  target,
  members,
  onChanged,
}: {
  discussion: Activity;
  /** Where comments of this test, suite or issue are posted. */
  path: string;
  /** PATCH endpoint that resolves or reopens this discussion. */
  resolvePath: string;
  target: UploadTarget;
  members: Member[];
  onChanged(): void;
}) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolved = !!discussion.resolvedAt;
  async function resolve() {
    setBusy(true);
    setError("");
    try {
      await api(resolvePath, "PATCH", { resolved: !resolved });
      setReplying(false);
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {replying ? (
        <CommentForm
          path={path}
          target={target}
          members={members}
          replyTo={discussion.id}
          onCancel={() => setReplying(false)}
          onSaved={() => {
            setReplying(false);
            onChanged();
          }}
        />
      ) : (
        <div className="discussion-toolbar">
          {!resolved && (
            <button
              type="button"
              className="discussion-reply-trigger"
              onClick={() => setReplying(true)}
            >
              Responder…
            </button>
          )}
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
    </>
  );
}
