import { z } from "zod";
import portuguese from "zod/v4/locales/pt.js";

z.config(portuguese());

export const statusSchema = z.enum(["pending", "approved", "revoked"]);
export type Status = z.infer<typeof statusSchema>;
export const statusLabels: Record<Status, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  revoked: "Rejeitado",
};
/** Comma-separated list query filter (`?status=a,b`); "all" or empty means no restriction. */
export const multiFilter = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .default("all")
    .transform((value) =>
      value === "all" ? [] : [...new Set(value.split(",").filter(Boolean))],
    )
    .pipe(z.array(item).max(50));
export const stepStatusSchema = z.enum(["pending", "passed", "failed"]);
export type StepStatus = z.infer<typeof stepStatusSchema>;
const title = z.string().trim().min(1).max(200);
const stepBody = z.string().trim().min(1).max(2000);
/** 1 (Crítica) to 5 (Mínima), shared by tests and issues. */
const priority = z.number().int().min(1).max(5).nullable();
const ids = (max: number) => z.array(z.string().uuid()).max(max).default([]);
const markdown = z.string().max(50000).default("");
const projectIcon = z
  .union([
    z
      .string()
      .max(50000)
      .regex(
        /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i,
        "Carregue uma imagem PNG, JPEG ou WebP válida.",
      ),
    z.null(),
  ])
  .optional();
export const projectInput = z
  .object({ name: title, description: markdown, icon: projectIcon })
  .strict();
export const testInput = z
  .object({
    title,
    instructions: markdown,
    /** Ordered steps. When omitted on creation, the first list of the instructions is used. */
    steps: z.array(stepBody).max(100).optional(),
    expectedResult: markdown,
    assigneeId: z.string().uuid().nullable().optional(),
    /** Omitted on an edit, the current priority is kept. */
    priority: priority.optional(),
  })
  .strict();
/** Suite creation may assign by email; the server resolves it to a project member. */
export const suiteTestInput = testInput
  .extend({ assigneeEmail: z.string().trim().email().max(320).optional() })
  .refine((data) => !(data.assigneeEmail && data.assigneeId), {
    message: "Indique assigneeId ou assigneeEmail, não ambos.",
    path: ["assigneeEmail"],
  });
export const suiteInput = z
  .object({
    title,
    description: markdown,
    tests: z.array(suiteTestInput).max(500).default([]),
    provenance: z
      .object({
        repository: z.string().max(1000).optional(),
        branch: z.string().max(200).optional(),
        commit: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const suiteEditInput = suiteInput.pick({
  title: true,
  description: true,
});
export const resultInput = z
  .object({
    status: statusSchema,
    comment: z.string().trim().max(50000).optional(),
    mentions: ids(20),
    attachmentIds: ids(10),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === "revoked" && !data.comment?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["comment"],
        message: "Indique o motivo da rejeição.",
      });
  });
export const commentInput = z
  .object({
    body: z.string().trim().max(50000).default(""),
    mentions: ids(20),
    attachmentIds: ids(10),
  })
  .strict()
  .refine((data) => data.body || data.attachmentIds.length, {
    message: "Escreva um comentário ou anexe um ficheiro.",
    path: ["body"],
  });
export const stepResultInput = z.object({ status: stepStatusSchema }).strict();
export const setupInput = z
  .object({
    code: z.string().trim().min(1, "Indique o código de setup.").max(200),
  })
  .strict();
export const adminInput = z.object({ oid: z.string().uuid() }).strict();
export const memberInput = z
  .object({
    oid: z.string().uuid(),
    role: z.enum(["owner", "member", "viewer"]).default("member"),
  })
  .strict();
export const memberRoleInput = z
  .object({ role: z.enum(["owner", "member", "viewer"]) })
  .strict();
/** Without `until` the block lasts until an owner lifts it. */
export const memberBlockInput = z
  .object({
    until: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const keyInput = z.object({ name: title }).strict();

/* Development area: issues with configurable statuses, modules and labels. */
export const issueColors = [
  "gray",
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "purple",
  "pink",
] as const;
export type IssueColor = (typeof issueColors)[number];
export const issueCategories = ["todo", "doing", "done"] as const;
export type IssueCategory = (typeof issueCategories)[number];
export const issueCategoryLabels: Record<IssueCategory, string> = {
  todo: "Por fazer",
  doing: "Em progresso",
  done: "Concluído",
};
const configName = z.string().trim().min(1).max(60);
const color = z.enum(issueColors).default("gray");
export const issueStatusInput = z
  .object({
    name: configName,
    color,
    category: z.enum(issueCategories),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export const issueTagInput = z
  .object({
    name: configName,
    color,
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
/** Duplicates are ignored by the server. */
const uuids = (max: number) => z.array(z.string().uuid()).max(max);
const estimate = z.number().min(0).max(99999).nullable();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .nullable();
/** The reporter always comes from the authenticated actor and is never accepted from the client. */
export const issueInput = z
  .object({
    title,
    description: markdown,
    statusId: z.string().uuid().optional(),
    priority: priority.default(null),
    estimate: estimate.default(null),
    deployedAt: isoDate.default(null),
    moduleIds: uuids(50).default([]),
    labelIds: uuids(50).default([]),
    assigneeIds: uuids(50).default([]),
  })
  .strict();
export const issuePatchInput = z
  .object({
    title: title.optional(),
    description: z.string().max(50000).optional(),
    statusId: z.string().uuid().optional(),
    priority: priority.optional(),
    estimate: estimate.optional(),
    deployedAt: isoDate.optional(),
    moduleIds: uuids(50).optional(),
    labelIds: uuids(50).optional(),
    position: z.number().int().min(0).max(100000).optional(),
  })
  .strict();
export const issueAssigneesInput = z.object({ userIds: uuids(50) }).strict();
/** Archives every active issue in the given "done" statuses (e.g. all duplicates). */
export const issueArchiveRuleInput = z
  .object({ statusIds: uuids(50).min(1, "Escolha pelo menos um estado.") })
  .strict();
/** Items picked in a table for a bulk action; each version must still match. */
const selection = (message: string) =>
  z
    .array(
      z
        .object({ id: z.string().uuid(), version: z.number().int().min(1) })
        .strict(),
    )
    .min(1, message)
    .max(100);
/** Bulk archive, restore or delete of selected issues. */
export const issueSelectionInput = z
  .object({ issues: selection("Escolha pelo menos um issue.") })
  .strict();
/** Archiving takes either a status rule or a selection. */
export const issueArchiveInput = z.union([
  issueArchiveRuleInput,
  issueSelectionInput,
]);
/** Bulk archive, restore or delete of selected suites. */
export const suiteSelectionInput = z
  .object({ suites: selection("Escolha pelo menos uma suite.") })
  .strict();
const importName = z.string().trim().min(1).max(60);
export const issueImportInput = z
  .object({
    fileName: z.string().trim().max(200).default(""),
    newStatuses: z
      .array(
        z
          .object({
            key: importName,
            name: configName,
            category: z.enum(issueCategories).default("todo"),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    newModules: z
      .array(z.object({ key: importName, name: configName }).strict())
      .max(200)
      .default([]),
    newLabels: z
      .array(z.object({ key: importName, name: configName }).strict())
      .max(200)
      .default([]),
    rows: z
      .array(
        z
          .object({
            externalRef: z.string().trim().max(200).nullable().default(null),
            title,
            description: markdown,
            /** Existing status id or the key of an entry in newStatuses; empty uses the first status. */
            status: z.string().max(60).nullable().default(null),
            priority: priority.default(null),
            estimate: estimate.default(null),
            reportedAt: z
              .string()
              .datetime({ offset: true })
              .nullable()
              .default(null),
            deployedAt: isoDate.default(null),
            reporterId: z.string().uuid().nullable().default(null),
            reporterNote: z.string().trim().max(200).nullable().default(null),
            assigneeIds: uuids(20).default([]),
            /** Existing ids or keys of newModules / newLabels. */
            modules: z.array(z.string().max(60)).max(20).default([]),
            labels: z.array(z.string().max(60)).max(20).default([]),
            comments: z
              .array(z.string().trim().min(1).max(50000))
              .max(10)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export const preferenceKeys = [
  "issues.columns",
  "issues.view",
  "issues.pageSize",
  "suites.pageSize",
  "tests.pageSize",
] as const;
export const preferenceInput = z.union([
  z.array(z.string().max(40)).max(30),
  z.string().max(40),
]);
/** Per-project board layout: `issues.board.<projectId>`. */
export const boardPreferenceKey = (projectId: string) =>
  `issues.board.${projectId}`;
export const boardPreferencePattern = /^issues\.board\.([\da-f-]{36})$/;
/** Status columns in the user's order; hidden ones stay out of the board. */
export const boardPreferenceInput = z
  .object({
    order: z.array(z.string().uuid()).max(100),
    hidden: z.array(z.string().uuid()).max(100),
  })
  .strict();
export type BoardPreference = z.infer<typeof boardPreferenceInput>;
export interface User {
  id: string;
  oid: string;
  tenantId: string;
  name: string;
  email: string;
}
/** The signed-in person, with application-wide administration rights. */
export interface Me extends User {
  admin: boolean;
  master: boolean;
  /** No master administrator yet: only the setup page is available. */
  setupRequired: boolean;
}
export interface Admin extends User {
  master: boolean;
  createdAt: string;
  createdByName: string | null;
}
export type MemberRole = "owner" | "member" | "viewer";
export interface Member extends User {
  role: MemberRole;
  /** Set while a temporary block is active. */
  blockedAt?: string | null;
  blockedUntil?: string | null;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  icon: string | null;
  version: number;
  role: MemberRole;
}
export interface TestStep {
  id: string;
  position: number;
  body: string;
  status: StepStatus;
  updatedByName: string | null;
  updatedAt: string | null;
  version: number;
}
export interface Tester {
  id: string;
  name: string;
}
export interface TestCase {
  id: string;
  suiteId: string;
  number: number;
  title: string;
  instructions: string;
  expectedResult: string;
  assigneeId: string | null;
  priority: number | null;
  status: Status;
  position: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  steps: TestStep[];
  /** Members who recorded a result, commented or marked a step on this test. */
  testers: Tester[];
}
export interface Suite {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
  version: number;
  provenance: Record<string, string> | null;
  status: Status;
  progress: number;
  counts: Record<Status, number>;
  total: number;
  tests?: TestCase[];
}
export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}
export interface Activity {
  id: string;
  suiteId: string | null;
  testId: string | null;
  issueId?: string | null;
  actorName: string;
  kind: string;
  body: string;
  detail: Record<string, unknown>;
  createdAt: string;
  attachments: Attachment[];
}
export type NotificationKind =
  | "result"
  | "comment"
  | "mention"
  | "assignment"
  | "suite_created"
  | "test_added"
  | "suite_archived"
  | "suite_restored"
  | "suite_edited"
  | "test_edited"
  | "test_deleted"
  | "suite_deleted"
  | "issue_assignment"
  | "issue_comment"
  | "issue_mention"
  | "issue_status"
  | "issue_deleted";
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  actorName: string;
  detail: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  projectId: string;
  projectName: string;
  suiteId: string | null;
  suiteNumber: number | null;
  suiteTitle: string | null;
  suiteDeleted: boolean;
  testId: string | null;
  testNumber: number | null;
  testTitle: string | null;
  testDeleted: boolean;
  issueId: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  issueDeleted: boolean;
  activityId: string | null;
}
export interface SearchResults {
  suites: {
    id: string;
    projectId: string;
    projectName: string;
    number: number;
    title: string;
    archived: boolean;
  }[];
  tests: {
    id: string;
    suiteId: string;
    projectId: string;
    projectName: string;
    suiteNumber: number;
    suiteTitle: string;
    number: number;
    title: string;
  }[];
  issues: {
    id: string;
    projectId: string;
    projectName: string;
    number: number;
    title: string;
    archived: boolean;
  }[];
  comments: {
    id: string;
    suiteId: string | null;
    testId: string | null;
    issueId: string | null;
    projectId: string;
    projectName: string;
    suiteNumber: number | null;
    testNumber: number | null;
    issueNumber: number | null;
    actorName: string;
    excerpt: string;
    createdAt: string;
  }[];
}
export interface IssueStatus {
  id: string;
  projectId: string;
  name: string;
  color: IssueColor;
  category: IssueCategory;
  position: number;
  version: number;
}
export interface IssueTag {
  id: string;
  projectId: string;
  name: string;
  color: IssueColor;
  position: number;
  version: number;
}
export interface IssueConfig {
  statuses: IssueStatus[];
  modules: IssueTag[];
  labels: IssueTag[];
}
export interface IssuePerson {
  id: string;
  name: string;
}
export interface Issue {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  statusId: string;
  priority: number | null;
  estimate: number | null;
  reportedAt: string;
  deployedAt: string | null;
  reporterId: string;
  reporterName: string;
  reporterNote: string | null;
  externalRef: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
  assignees: IssuePerson[];
  moduleIds: string[];
  labelIds: string[];
  comments: number;
}
export interface IssuePage {
  items: Issue[];
  total: number;
  page: number;
  pageSize: number;
  counts: { active: number; archived: number; open: number };
}
export interface IssueImportResult {
  created: number;
  skipped: { externalRef: string; reason: string }[];
  statuses: number;
  modules: number;
  labels: number;
}
export interface IntegrationKey {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
}
export function summarize(statuses: Status[]) {
  const counts: Record<Status, number> = {
    pending: 0,
    approved: 0,
    revoked: 0,
  };
  statuses.forEach((status) => counts[status]++);
  const total = statuses.length;
  return {
    counts,
    total,
    status: (counts.revoked
      ? "revoked"
      : total && counts.approved === total
        ? "approved"
        : "pending") as Status,
    progress: total
      ? Math.round(((counts.approved + counts.revoked) / total) * 100)
      : 0,
  };
}
