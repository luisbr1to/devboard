import { useEffect, useState } from "react";
import type { Attachment } from "../shared/contracts";
import type { Session } from "./auth";
let session: Session | null = null;
export function setSession(value: Session | null) {
  session = value;
}
export async function endSession() {
  const current = session;
  session = null;
  try {
    await current?.signOut?.();
  } catch {
    // The local token is already removed from browser storage in a finally block.
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  version?: number,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<T> {
  if (!session) throw new Error("Inicie sessão para continuar.");
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...headers,
      Authorization: `Bearer ${await session.getToken()}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(version !== undefined ? { "If-Match": String(version) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok) {
    const fieldMessages = result.fields?.fieldErrors
      ? Object.values(result.fields.fieldErrors)
          .flat()
          .filter(Boolean)
          .join(" ")
      : "";
    throw new Error(
      fieldMessages || result.error || "Não foi possível concluir a operação.",
    );
  }
  return result as T;
}
/** Where a comment's attachments are uploaded: a suite (optionally one of its tests) or an issue. */
export type UploadTarget =
  { suiteId: string; testId?: string } | { issueId: string };
export async function uploadAttachment(
  target: UploadTarget,
  file: File,
): Promise<Attachment> {
  if (!session) throw new Error("Inicie sessão para continuar.");
  const response = await fetch(
    "issueId" in target
      ? `/api/v1/issues/${target.issueId}/attachments`
      : `/api/v1/suites/${target.suiteId}/attachments${target.testId ? `?testId=${target.testId}` : ""}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await session.getToken()}`,
        // Always binary: the server decides the type from the extension and content.
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Não foi possível anexar o ficheiro.");
  return result as Attachment;
}
export async function apiBlob(path: string): Promise<Blob | null> {
  if (!session) throw new Error("Inicie sessão para continuar.");
  const response = await fetch(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${await session.getToken()}` },
  });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error("Não foi possível carregar a fotografia.");
  return response.blob();
}
export function useRemote<T>(path: string | null, revision: number) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
    path: string | null;
  }>({ loading: true, path: null });
  useEffect(() => {
    if (!path) {
      setState({ loading: false, path });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({
      ...(previous.path === path ? previous : {}),
      path,
      loading: true,
      error: undefined,
    }));
    void api<T>(path, "GET", undefined, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, path, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error.message,
          }));
      });
    return () => controller.abort();
  }, [path, revision]);
  return state.path === path
    ? state
    : { path, loading: !!path, data: undefined, error: undefined };
}
