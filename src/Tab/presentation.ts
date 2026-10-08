// UI-only derivations over the existing API data. Nothing here is sent back to the server.
import type { Status, Suite } from "../shared/contracts";

/** Badge states. Only Status values come from the API; the rest are display-only. */
export type DisplayStatus = Status | "running" | "notStarted";

export function suiteDisplayStatus(suite: Suite): DisplayStatus {
  if (suite.status !== "pending") return suite.status;
  return suite.counts.approved + suite.counts.revoked > 0
    ? "running"
    : "notStarted";
}

export function statusCounts(counts: Record<Status, number>) {
  return {
    approved: counts.approved,
    revoked: counts.revoked,
    pending: counts.pending,
    executed: counts.approved + counts.revoked,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");
/** 06/10/2026 14:55 */
export const date = (value: string | null | undefined) => {
  if (!value) return "—";
  const at = new Date(value);
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
/** 06/10/2026 (local date, no time) */
export const day = (value: string | null | undefined) => {
  if (!value) return "—";
  const at = new Date(value);
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
};
/** 06/10 14:55 */
export const shortDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const at = new Date(value);
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

export const initials = (name: string) => {
  // Ignore separators such as "·" or "—" so "Loja · Demo" gives "LD".
  const words = name.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return (
    words.length === 1
      ? words[0].slice(0, 2)
      : words
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
  ).toLocaleUpperCase("pt-PT");
};

/** First readable sentence of a Markdown description, as plain text. */
export function plainSnippet(markdown: string) {
  const lines = markdown
    .replace(/<[^>]*>/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((candidate) => !/^#{1,6}\s/.test(candidate)) || "";
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^>\s?/, "")
    .replace(/[*_`~]/g, "")
    .trim();
}

export const suiteKey = (number: number) =>
  `SU-${String(number).padStart(2, "0")}`;
export const testKey = (number: number) => `TC-${number}`;
export const issueKey = (number: number) => `IS-${number}`;
/** People who can be given work: not read-only and not blocked. */
export const assignable = <
  T extends { role: string; blockedAt?: string | null },
>(
  members: T[],
) => members.filter((member) => member.role !== "viewer" && !member.blockedAt);
