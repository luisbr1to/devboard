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

/** Pasted screenshots have no name; type and size are checked before uploading. */
function check(file: File) {
  const name =
    file.name ||
    `captura-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`;
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const error = !allowed.has(extension)
    ? "Tipo não suportado"
    : file.size > maxSize
      ? "Excede 10 MB"
      : undefined;
  return { name, error };
}
interface Pending {
  key: string;
  name: string;
  size: number;
  attachment?: Attachment;
  error?: string;
}

/** Uploads files as soon as they are added; published with the comment by id. */
export function useAttachments(target: UploadTarget) {
  const key = JSON.stringify(target);
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
        const { name, error } = check(file);
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

/** Uploads that belong to a note or draft at once: no publishing step, nothing to clean up. */
export function useDirectUploads(target: UploadTarget, onUploaded: () => void) {
  const [files, setFiles] = useState<Pending[]>([]);
  const latest = useRef({ target, onUploaded });
  latest.current = { target, onUploaded };
  const add = useCallback((list: File[]) => {
    for (const file of list) {
      const key = crypto.randomUUID();
      const { name, error } = check(file);
      setFiles((current) => [
        ...current,
        { key, name, size: file.size, error },
      ]);
      if (error) continue;
      void uploadAttachment(
        latest.current.target,
        name === file.name ? file : new File([file], name, { type: file.type }),
      )
        .then(() => {
          setFiles((current) => current.filter((item) => item.key !== key));
          latest.current.onUploaded();
        })
        .catch((failure: Error) =>
          setFiles((current) =>
            current.map((item) =>
              item.key === key ? { ...item, error: failure.message } : item,
            ),
          ),
        );
    }
  }, []);
  const remove = (key: string) =>
    setFiles((current) => current.filter((item) => item.key !== key));
  return { files, add, remove };
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
/** `path` is the attachment's URL: `/attachments/:id` or, for notes and drafts, `/me/attachments/:id`. */
const loadBlob = (path: string) => {
  let blob = blobs.get(path);
  if (!blob) {
    blob = apiBlob(path);
    blobs.set(path, blob);
    blob.catch(() => blobs.delete(path));
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
async function download(path: string, file: Attachment) {
  const blob = await loadBlob(path);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: file.fileName,
  });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Thumbnail({ path, file }: { path: string; file: Attachment }) {
  const url = useObjectUrl(path, true);
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
export function AttachmentList({
  files,
  personal = false,
  onRemove,
}: {
  files: Attachment[];
  /** Files of the person's notes and drafts. */
  personal?: boolean;
  onRemove?(file: Attachment): void;
}) {
  if (!files.length) return null;
  const path = (file: Attachment) =>
    `${personal ? "/me" : ""}/attachments/${file.id}`;
  const remove = (file: Attachment) =>
    onRemove && (
      <button
        type="button"
        className="attachment-remove"
        aria-label={`Remover ${file.fileName}`}
        title="Remover"
        onClick={() => onRemove(file)}
      >
        <XMarkIcon aria-hidden />
      </button>
    );
  const images = files.filter((file) => file.contentType.startsWith("image/"));
  const others = files.filter((file) => !file.contentType.startsWith("image/"));
  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className="attachment-thumbs">
          {images.map((file) =>
            onRemove ? (
              <span key={file.id} className="attachment-thumb-item">
                <Thumbnail path={path(file)} file={file} />
                {remove(file)}
              </span>
            ) : (
              <Thumbnail key={file.id} path={path(file)} file={file} />
            ),
          )}
        </div>
      )}
      {others.length > 0 && (
        <ul className="attachment-files">
          {others.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="attachment-chip attachment-download"
                onClick={() => void download(path(file), file)}
              >
                <DocumentTextIcon aria-hidden />
                <span className="attachment-name">{file.fileName}</span>
                <small>{fileSize(file.size)}</small>
                <ArrowDownTrayIcon aria-hidden />
              </button>
              {remove(file)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
