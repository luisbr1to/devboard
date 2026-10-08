import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownTrayIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { Attachment } from "../shared/contracts";
import { api, apiBlob, uploadAttachment, type UploadTarget } from "./api";

export const attachmentAccept =
  ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.json";
const allowed = new Set(attachmentAccept.split(",").map((ext) => ext.slice(1)));
const maxSize = 10 * 1024 * 1024;

export const fileSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

interface Pending {
  key: string;
  name: string;
  size: number;
  attachment?: Attachment;
  error?: string;
}

/** Uploads files as soon as they are added; published with the comment by id. */
export function useAttachments(target: UploadTarget) {
  const key =
    "issueId" in target
      ? `issue:${target.issueId}`
      : `suite:${target.suiteId}:${target.testId || ""}`;
  const latestTarget = useRef(target);
  latestTarget.current = target;
  const [files, setFiles] = useState<Pending[]>([]);
  const published = useRef(false);
  const latest = useRef(files);
  latest.current = files;
  useEffect(
    () => () => {
      // Discard uploads that were never published (e.g. the panel was closed).
      if (published.current) return;
      for (const file of latest.current)
        if (file.attachment)
          void api(`/attachments/${file.attachment.id}`, "DELETE").catch(
            () => undefined,
          );
    },
    [],
  );
  const add = useCallback(
    (list: File[]) => {
      for (const file of list) {
        const key = crypto.randomUUID();
        const name =
          file.name ||
          `captura-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`;
        const extension = name.split(".").pop()?.toLowerCase() || "";
        const error = !allowed.has(extension)
          ? "Tipo não suportado"
          : file.size > maxSize
            ? "Excede 10 MB"
            : undefined;
        setFiles((current) => [
          ...current,
          { key, name, size: file.size, error },
        ]);
        if (error) continue;
        published.current = false;
        void uploadAttachment(
          latestTarget.current,
          name === file.name
            ? file
            : new File([file], name, { type: file.type }),
        )
          .then((attachment) =>
            setFiles((current) =>
              current.map((item) =>
                item.key === key ? { ...item, attachment } : item,
              ),
            ),
          )
          .catch((failure: Error) =>
            setFiles((current) =>
              current.map((item) =>
                item.key === key ? { ...item, error: failure.message } : item,
              ),
            ),
          );
      }
    },
    [key],
  );
  const remove = (key: string) => {
    const file = files.find((item) => item.key === key);
    if (file?.attachment)
      void api(`/attachments/${file.attachment.id}`, "DELETE").catch(
        () => undefined,
      );
    setFiles((current) => current.filter((item) => item.key !== key));
  };
  return {
    files,
    add,
    remove,
    ids: files.flatMap((file) => (file.attachment ? [file.attachment.id] : [])),
    uploading: files.some((file) => !file.attachment && !file.error),
    /** Call after the comment is saved: the uploads now belong to it. */
    clear() {
      published.current = true;
      setFiles([]);
    },
  };
}

export function PendingAttachments({
  files,
  onRemove,
}: {
  files: Pending[];
  onRemove(key: string): void;
}) {
  if (!files.length) return null;
  return (
    <ul className="pending-attachments" aria-label="Anexos a publicar">
      {files.map((file) => (
        <li
          key={file.key}
          className={`attachment-chip ${file.error ? "attachment-error" : ""}`}
        >
          {file.error ? (
            <ExclamationCircleIcon aria-hidden />
          ) : file.attachment ? (
            <DocumentTextIcon aria-hidden />
          ) : (
            <span className="attachment-spinner" aria-hidden />
          )}
          <span className="attachment-name">{file.name}</span>
          <small>
            {file.error ||
              (file.attachment ? fileSize(file.size) : "A enviar…")}
          </small>
          <button
            type="button"
            className="attachment-remove"
            aria-label={`Remover ${file.name}`}
            title="Remover"
            onClick={() => onRemove(file.key)}
          >
            <XMarkIcon aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

const blobs = new Map<string, Promise<Blob | null>>();
const loadBlob = (id: string) => {
  let blob = blobs.get(id);
  if (!blob) {
    blob = apiBlob(`/attachments/${id}`);
    blobs.set(id, blob);
    blob.catch(() => blobs.delete(id));
  }
  return blob;
};
function useObjectUrl(id: string, enabled: boolean) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let created: string | undefined;
    void loadBlob(id)
      .then((blob) => {
        if (!live || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id, enabled]);
  return url;
}
async function download(file: Attachment) {
  const blob = await loadBlob(file.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: file.fileName,
  });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Thumbnail({ file }: { file: Attachment }) {
  const url = useObjectUrl(file.id, true);
  return (
    <button
      type="button"
      className="attachment-thumb"
      title={`Abrir ${file.fileName}`}
      aria-label={`Abrir imagem ${file.fileName}`}
      onClick={() => url && window.open(url, "_blank", "noopener")}
    >
      {url ? <img src={url} alt="" /> : <span className="attachment-spinner" />}
    </button>
  );
}
/** Published attachments, loaded through the API with the user's session. */
export function AttachmentList({ files }: { files: Attachment[] }) {
  if (!files.length) return null;
  const images = files.filter((file) => file.contentType.startsWith("image/"));
  const others = files.filter((file) => !file.contentType.startsWith("image/"));
  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className="attachment-thumbs">
          {images.map((file) => (
            <Thumbnail key={file.id} file={file} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <ul className="attachment-files">
          {others.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="attachment-chip attachment-download"
                onClick={() => void download(file)}
              >
                <DocumentTextIcon aria-hidden />
                <span className="attachment-name">{file.fileName}</span>
                <small>{fileSize(file.size)}</small>
                <ArrowDownTrayIcon aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
